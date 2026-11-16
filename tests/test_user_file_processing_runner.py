"""The core server processes uploads itself (spec R1.1 to R1.4 and R1.7)."""

from __future__ import annotations

import asyncio
import sys
import time
from collections.abc import AsyncIterator, Awaitable, Callable, Iterator
from contextlib import contextmanager
from datetime import UTC, datetime, timedelta
from io import BytesIO
from pathlib import Path
from types import SimpleNamespace
from typing import Any, cast

import pytest
from fastapi import FastAPI
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from animama.adapters.content_store.private_file_store import PrivateFileNotFoundError, PrivateFileReadError
from animama.adapters.parsers.isolated_user_file_parser import IsolatedUserFileParser
from animama.app.ports.private_file_storage import PrivateFileStorage
from animama.app.ports.text_embedder import TextEmbedder
from animama.app.ports.user_file_parser_port import UserFileParser, UserFileParseRejectedError
from animama.domain.request_principal import RequestPrincipal
from animama.domain.user_file import STATUS_FAILED, STATUS_PROCESSING, STATUS_READY, STATUS_UPLOADED
from animama.domain.user_file_processing import (
    JOB_STATUS_FAILED,
    JOB_STATUS_QUEUED,
    JOB_STATUS_RUNNING,
    JOB_STATUS_SUCCEEDED,
    PROCESSING_INTERRUPTED_ERROR,
    ParsedUserFileDocument,
)
from animama.orm.runtime_worker import ORMRuntimeWorkerHeartbeat
from animama.orm.user_file import ORMUserFile
from animama.orm.user_file_chunk import ORMUserFileChunk
from animama.orm.user_file_processing_job import ORMUserFileProcessingJob
from animama.server import user_file_processing as user_file_processing_module
from animama.server.config import Settings, settings
from animama.server.deps import get_async_session, get_current_principal
from animama.server.local_runtime import resolve_local_runtime_paths
from animama.server.routers import user_files
from animama.server.user_file_processing import (
    UserFileProcessingRunner,
    get_user_file_processing_runner,
    start_user_file_processing,
    stop_user_file_processing,
)
from tests.local_http_client import local_client
from tests.user_file_fixtures import simple_docx

OWNER = "runner-owner"


class _MemoryStorage:
    """Private storage holding exact upload bytes by locator; an unknown locator is missing."""

    def __init__(self) -> None:
        self.files: dict[str, bytes] = {}
        self.unreadable: set[str] = set()

    @contextmanager
    def open_bounded(self, locator: str, *, expected_size_bytes: int) -> Iterator[SimpleNamespace]:
        if locator in self.unreadable:
            raise PrivateFileReadError("Private file changed or became unreadable") from PermissionError(13, "denied")
        if locator not in self.files:
            raise PrivateFileNotFoundError(locator)
        payload = self.files[locator]
        assert expected_size_bytes == len(payload)
        yield SimpleNamespace(stream=BytesIO(payload), size_bytes=len(payload), sha256="unused")


class _TextParser:
    async def parse(self, *, payload: bytes, filename: str, extension: str) -> ParsedUserFileDocument:
        return ParsedUserFileDocument(text=payload.decode(), parser_name="test", metadata={"parser": "test"})


class _RejectingParser:
    async def parse(self, *, payload: bytes, filename: str, extension: str) -> ParsedUserFileDocument:
        raise UserFileParseRejectedError("Encrypted or password-protected documents are not supported")


class _ExplodingParser:
    async def parse(self, *, payload: bytes, filename: str, extension: str) -> ParsedUserFileDocument:
        raise RuntimeError("parser exploded")


class _BlockingParser:
    """Never finishes, like a parse that is still running when the server stops."""

    def __init__(self) -> None:
        self.started = asyncio.Event()

    async def parse(self, *, payload: bytes, filename: str, extension: str) -> ParsedUserFileDocument:
        self.started.set()
        await asyncio.Event().wait()
        raise AssertionError("unreachable")


async def _embeddings_off(_session: AsyncSession, _user_id: str) -> TextEmbedder | None:
    return None


def _settings(**overrides: Any) -> Settings:
    values: dict[str, Any] = {
        "animama_user_file_processing_enabled": True,
        "anima_user_file_processing_poll_seconds": 60.0,
        "anima_user_file_processing_lease_seconds": 300,
        "anima_user_file_processing_max_attempts": 3,
        "anima_user_file_max_process_bytes": 1024 * 1024,
    }
    return settings.model_copy(update={**values, **overrides})


def _runner(
    session_factory: async_sessionmaker[AsyncSession],
    storage: _MemoryStorage,
    parser: UserFileParser,
    **runtime_settings: Any,
) -> UserFileProcessingRunner:
    return UserFileProcessingRunner(
        session_factory,
        # Only open_bounded is used.
        private_storage=cast(PrivateFileStorage, storage),
        parser=parser,
        embedder_resolver=_embeddings_off,
        runtime_settings=_settings(**runtime_settings),
        heartbeat_seconds=0.1,
        stop_grace_seconds=0.3,
    )


@pytest.fixture
async def clean_tables(async_session_factory: async_sessionmaker[AsyncSession]) -> AsyncIterator[None]:
    async def clean() -> None:
        async with async_session_factory() as session:
            await session.execute(delete(ORMUserFileProcessingJob))
            await session.execute(delete(ORMUserFileChunk))
            await session.execute(delete(ORMUserFile))
            await session.execute(delete(ORMRuntimeWorkerHeartbeat))
            await session.commit()

    await clean()
    yield
    await clean()


async def _queue(
    session_factory: async_sessionmaker[AsyncSession],
    storage: _MemoryStorage,
    *,
    file_id: str,
    payload: bytes = b"Uploaded text the Anima can search.",
    extension: str = ".txt",
    status: str = JOB_STATUS_QUEUED,
    attempts: int = 0,
    max_attempts: int = 3,
    locked_at: datetime | None = None,
    store: bool = True,
) -> None:
    locator = f"user-files/{OWNER}/{file_id}/original"
    if store:
        storage.files[locator] = payload
    now = datetime.now(UTC)
    async with session_factory() as session:
        session.add(
            ORMUserFile(
                id=file_id,
                user_id=OWNER,
                storage_locator=locator,
                original_filename=f"{file_id}{extension}",
                normalized_extension=extension,
                declared_content_type="text/plain",
                declared_size_bytes=len(payload),
                stored_size_bytes=len(payload),
                status=STATUS_PROCESSING,
                upload_expires_at=now + timedelta(minutes=10),
                metadata_={},
            )
        )
        session.add(
            ORMUserFileProcessingJob(
                id=f"job-{file_id}",
                file_id=file_id,
                user_id=OWNER,
                status=status,
                attempts=attempts,
                max_attempts=max_attempts,
                run_after=now - timedelta(seconds=1),
                locked_by="previous-server" if locked_at is not None else None,
                locked_at=locked_at,
                metadata_={},
            )
        )
        await session.commit()


async def _rows(
    session_factory: async_sessionmaker[AsyncSession], file_id: str
) -> tuple[ORMUserFile, ORMUserFileProcessingJob, int]:
    async with session_factory() as session:
        file = await session.get(ORMUserFile, file_id)
        job = await session.get(ORMUserFileProcessingJob, f"job-{file_id}")
        chunks = (
            await session.execute(select(func.count(ORMUserFileChunk.id)).where(ORMUserFileChunk.file_id == file_id))
        ).scalar_one()
    assert file is not None and job is not None
    return file, job, int(chunks)


async def _eventually(check: Callable[[], Awaitable[bool]], *, timeout: float = 10.0) -> None:
    deadline = time.monotonic() + timeout
    while not await check():
        if time.monotonic() > deadline:
            raise AssertionError("condition was not met in time")
        await asyncio.sleep(0.05)


@pytest.mark.parametrize(
    ("extension", "payload", "file_status", "job_status", "last_error"),
    [
        (".txt", b"The runner read this upload.", STATUS_READY, JOB_STATUS_SUCCEEDED, None),
        (".json", b'{"topic": "budget"}', STATUS_READY, JOB_STATUS_SUCCEEDED, None),
        (".docx", simple_docx("The runner read this Word document."), STATUS_READY, JOB_STATUS_SUCCEEDED, None),
        (".docx", b"PK\x03\x04 office", STATUS_FAILED, JOB_STATUS_FAILED, "The .docx file is damaged or incomplete."),
    ],
)
async def test_runner_processes_uploads_through_the_parse_child(
    async_session_factory: async_sessionmaker[AsyncSession],
    clean_tables: None,
    extension: str,
    payload: bytes,
    file_status: str,
    job_status: str,
    last_error: str | None,
) -> None:
    storage = _MemoryStorage()
    await _queue(async_session_factory, storage, file_id="upload", payload=payload, extension=extension)

    runner = _runner(async_session_factory, storage, IsolatedUserFileParser())
    assert await runner.process_once() is True

    file, job, chunks = await _rows(async_session_factory, "upload")
    assert (file.status, file.last_error) == (file_status, last_error)
    assert (job.status, job.last_error) == (job_status, last_error)
    # A file the child cannot read fails on its first attempt.
    assert job.attempts == 1
    assert (chunks > 0) == (file_status == STATUS_READY)
    assert await runner.process_once() is False


async def test_runner_chunks_with_the_configured_chunk_size(
    async_session_factory: async_sessionmaker[AsyncSession], clean_tables: None
) -> None:
    storage = _MemoryStorage()
    paragraphs = "\n\n".join(f"Paragraph {index} describes the plan for the coming season." for index in range(40))
    await _queue(async_session_factory, storage, file_id="sized", payload=paragraphs.encode())

    runner = _runner(async_session_factory, storage, _TextParser(), anima_user_file_chunk_max_tokens=64)
    assert await runner.process_once() is True

    async with async_session_factory() as session:
        estimates = (
            (await session.execute(select(ORMUserFileChunk.token_estimate).where(ORMUserFileChunk.file_id == "sized")))
            .scalars()
            .all()
        )
    assert len(estimates) > 1
    assert max(estimates) <= 64


async def test_wake_claims_new_work_without_waiting_for_the_next_poll(
    async_session_factory: async_sessionmaker[AsyncSession], clean_tables: None
) -> None:
    storage = _MemoryStorage()
    runner = _runner(async_session_factory, storage, _TextParser(), anima_user_file_processing_poll_seconds=60.0)
    runner.start()
    try:
        # The first pass finds nothing and rests for the full poll interval.
        await asyncio.sleep(0.5)
        await _queue(async_session_factory, storage, file_id="woken")
        runner.wake()

        async def ready() -> bool:
            file, _job, _chunks = await _rows(async_session_factory, "woken")
            return file.status == STATUS_READY

        await _eventually(ready, timeout=10)
    finally:
        await runner.stop()


async def test_parse_rejection_fails_the_file_on_its_first_attempt(
    async_session_factory: async_sessionmaker[AsyncSession], clean_tables: None
) -> None:
    storage = _MemoryStorage()
    await _queue(async_session_factory, storage, file_id="encrypted", max_attempts=3)

    assert await _runner(async_session_factory, storage, _RejectingParser()).process_once() is True

    file, job, _chunks = await _rows(async_session_factory, "encrypted")
    reason = "Encrypted or password-protected documents are not supported"
    assert (file.status, file.last_error) == (STATUS_FAILED, reason)
    assert (job.status, job.last_error, job.attempts) == (JOB_STATUS_FAILED, reason, 1)
    assert job.finished_at is not None and job.locked_by is None


async def test_missing_upload_fails_without_retrying(
    async_session_factory: async_sessionmaker[AsyncSession], clean_tables: None
) -> None:
    storage = _MemoryStorage()
    await _queue(async_session_factory, storage, file_id="missing", store=False)

    await _runner(async_session_factory, storage, _TextParser()).process_once()

    file, job, _chunks = await _rows(async_session_factory, "missing")
    assert file.status == STATUS_FAILED
    assert (job.status, job.attempts) == (JOB_STATUS_FAILED, 1)
    assert job.last_error == "Uploaded file was not found in private local storage"


async def test_upload_over_the_processing_limit_fails_without_retrying(
    async_session_factory: async_sessionmaker[AsyncSession], clean_tables: None
) -> None:
    """A file over the processing limit fails at once, never chunked from a truncated read."""

    storage = _MemoryStorage()
    await _queue(async_session_factory, storage, file_id="large", payload=b"x" * 64)

    await _runner(async_session_factory, storage, _TextParser(), anima_user_file_max_process_bytes=32).process_once()

    file, job, chunks = await _rows(async_session_factory, "large")
    assert file.status == STATUS_FAILED
    assert (job.status, job.attempts) == (JOB_STATUS_FAILED, 1)
    assert job.last_error == "Uploaded object exceeds the 32 byte limit"
    assert chunks == 0


async def test_unreadable_upload_is_retried(
    async_session_factory: async_sessionmaker[AsyncSession], clean_tables: None
) -> None:
    """A permission problem may be fixed meanwhile; only a missing or resized file fails at once."""

    storage = _MemoryStorage()
    await _queue(async_session_factory, storage, file_id="locked", max_attempts=3)
    storage.unreadable.add(f"user-files/{OWNER}/locked/original")

    await _runner(async_session_factory, storage, _TextParser()).process_once()

    file, job, _chunks = await _rows(async_session_factory, "locked")
    assert file.status == STATUS_PROCESSING
    assert (job.status, job.attempts) == (JOB_STATUS_QUEUED, 1)
    assert job.last_error == "Private file changed or became unreadable"


async def test_parse_child_that_crashes_is_retried(
    async_session_factory: async_sessionmaker[AsyncSession], clean_tables: None
) -> None:
    storage = _MemoryStorage()
    await _queue(async_session_factory, storage, file_id="crash", max_attempts=3)
    crashing = IsolatedUserFileParser(command=[sys.executable, "-c", "import os; os._exit(3)"])

    await _runner(async_session_factory, storage, crashing).process_once()

    file, job, _chunks = await _rows(async_session_factory, "crash")
    assert (file.status, file.last_error) == (STATUS_PROCESSING, "The file could not be read.")
    assert (job.status, job.attempts) == (JOB_STATUS_QUEUED, 1)


async def test_failed_parse_is_logged_with_its_job_and_failure_type_only(
    async_session_factory: async_sessionmaker[AsyncSession], clean_tables: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    storage = _MemoryStorage()
    await _queue(async_session_factory, storage, file_id="malformed", payload=b"{secret content", extension=".json")
    warnings: list[tuple[str, dict[str, Any]]] = []

    class RecordingLog:
        def warning(self, message: str, **fields: Any) -> None:
            warnings.append((message, fields))

        def info(self, message: str, **fields: Any) -> None:
            pass

    monkeypatch.setattr(user_file_processing_module, "_log", RecordingLog())

    await _runner(async_session_factory, storage, IsolatedUserFileParser()).process_once()

    (message, fields), *_ = [entry for entry in warnings if entry[0] == "User-file processing job failed"]
    assert fields["job_id"] == "job-malformed"
    assert fields["file_id"] == "malformed"
    assert fields["extension"] == ".json"
    assert fields["error_type"] == "JSONDecodeError"
    assert fields["retryable"] is False
    assert "secret content" not in repr(warnings)


async def test_unexpected_failure_is_retried_with_backoff(
    async_session_factory: async_sessionmaker[AsyncSession], clean_tables: None
) -> None:
    storage = _MemoryStorage()
    await _queue(async_session_factory, storage, file_id="flaky", max_attempts=3)

    await _runner(async_session_factory, storage, _ExplodingParser()).process_once()

    file, job, _chunks = await _rows(async_session_factory, "flaky")
    assert (file.status, file.last_error) == (STATUS_PROCESSING, "parser exploded")
    assert (job.status, job.attempts, job.last_error) == (JOB_STATUS_QUEUED, 1, "parser exploded")
    assert job.run_after > datetime.now(UTC)


async def test_interrupted_job_is_claimed_again_once_its_lease_expires(
    async_session_factory: async_sessionmaker[AsyncSession], clean_tables: None
) -> None:
    storage = _MemoryStorage()
    expired = datetime.now(UTC) - timedelta(minutes=10)
    await _queue(
        async_session_factory, storage, file_id="expired", status=JOB_STATUS_RUNNING, attempts=1, locked_at=expired
    )
    await _queue(
        async_session_factory,
        storage,
        file_id="in-progress",
        status=JOB_STATUS_RUNNING,
        attempts=1,
        locked_at=datetime.now(UTC),
    )
    runner = _runner(async_session_factory, storage, _TextParser())

    assert await runner.process_once() is True
    # Another live server still holds this lease.
    assert await runner.process_once() is False

    file, job, _chunks = await _rows(async_session_factory, "expired")
    assert file.status == STATUS_READY
    assert (job.status, job.attempts) == (JOB_STATUS_SUCCEEDED, 2)
    file, job, _chunks = await _rows(async_session_factory, "in-progress")
    assert (file.status, job.status, job.attempts) == (STATUS_PROCESSING, JOB_STATUS_RUNNING, 1)


async def test_interrupted_last_attempt_fails_the_file_with_a_reason(
    async_session_factory: async_sessionmaker[AsyncSession], clean_tables: None
) -> None:
    storage = _MemoryStorage()
    await _queue(
        async_session_factory,
        storage,
        file_id="interrupted",
        status=JOB_STATUS_RUNNING,
        attempts=3,
        max_attempts=3,
        locked_at=datetime.now(UTC) - timedelta(minutes=10),
    )
    await _queue(
        async_session_factory,
        storage,
        file_id="last-attempt-running",
        status=JOB_STATUS_RUNNING,
        attempts=3,
        max_attempts=3,
        locked_at=datetime.now(UTC),
    )

    assert await _runner(async_session_factory, storage, _TextParser()).process_once() is False

    file, job, _chunks = await _rows(async_session_factory, "interrupted")
    assert PROCESSING_INTERRUPTED_ERROR == "Processing was interrupted"
    assert (file.status, file.last_error) == (STATUS_FAILED, PROCESSING_INTERRUPTED_ERROR)
    assert (job.status, job.last_error, job.locked_by) == (JOB_STATUS_FAILED, PROCESSING_INTERRUPTED_ERROR, None)
    assert job.finished_at is not None
    file, job, _chunks = await _rows(async_session_factory, "last-attempt-running")
    assert (file.status, job.status) == (STATUS_PROCESSING, JOB_STATUS_RUNNING)


async def test_runner_heartbeat_reports_it_live_and_stop_clears_it(
    async_session_factory: async_sessionmaker[AsyncSession], clean_tables: None
) -> None:
    runner = _runner(async_session_factory, _MemoryStorage(), _TextParser())
    runner.start()

    async def recorded() -> bool:
        async with async_session_factory() as session:
            heartbeat = await session.get(ORMRuntimeWorkerHeartbeat, "document-processing")
            return heartbeat is not None and heartbeat.instance_id == runner.instance_id

    try:
        await _eventually(recorded)
    finally:
        await runner.stop()
    async with async_session_factory() as session:
        assert await session.get(ORMRuntimeWorkerHeartbeat, "document-processing") is None


async def test_stop_returns_an_unfinished_job_to_the_queue_without_spending_an_attempt(
    async_session_factory: async_sessionmaker[AsyncSession], clean_tables: None
) -> None:
    storage = _MemoryStorage()
    await _queue(async_session_factory, storage, file_id="unfinished")
    parser = _BlockingParser()
    runner = _runner(async_session_factory, storage, parser)
    runner.start()
    try:
        await asyncio.wait_for(parser.started.wait(), timeout=10)
        _file, job, _chunks = await _rows(async_session_factory, "unfinished")
        claimed_at = job.locked_at
        assert claimed_at is not None

        async def renewed() -> bool:
            _file, current, _chunks = await _rows(async_session_factory, "unfinished")
            return current.locked_at is not None and current.locked_at > claimed_at

        # The heartbeat keeps the lease of a long parse.
        await _eventually(renewed)
    finally:
        started = time.monotonic()
        await runner.stop()
    assert time.monotonic() - started < 5

    file, job, _chunks = await _rows(async_session_factory, "unfinished")
    assert (file.status, file.last_error) == (STATUS_PROCESSING, None)
    assert (job.status, job.attempts, job.locked_by, job.locked_at) == (JOB_STATUS_QUEUED, 0, None, None)
    assert job.run_after <= datetime.now(UTC)

    # The next server processes it at once, on the attempt it was given back.
    assert await _runner(async_session_factory, storage, _TextParser()).process_once() is True
    file, job, _chunks = await _rows(async_session_factory, "unfinished")
    assert (file.status, job.status, job.attempts) == (STATUS_READY, JOB_STATUS_SUCCEEDED, 1)


async def test_processing_starts_only_when_enabled(
    async_session_factory: async_sessionmaker[AsyncSession], clean_tables: None, tmp_path: Path
) -> None:
    app = FastAPI()
    paths = resolve_local_runtime_paths(
        Settings(animama_content_root=tmp_path / "content", animama_data_root=tmp_path / "data")
    )
    disabled = _settings(animama_user_file_processing_enabled=False)

    assert (
        start_user_file_processing(app, session_factory=async_session_factory, paths=paths, runtime_settings=disabled)
        is None
    )
    assert get_user_file_processing_runner(app) is None
    await stop_user_file_processing(app)

    runner = start_user_file_processing(
        app, session_factory=async_session_factory, paths=paths, runtime_settings=_settings()
    )
    try:
        assert runner is not None
        assert get_user_file_processing_runner(app) is runner
    finally:
        await stop_user_file_processing(app)


def _route_app(session: AsyncSession, tmp_path: Path, *, enabled: bool) -> FastAPI:
    app = FastAPI()
    app.state.runtime_settings = Settings(
        animama_content_root=tmp_path / "content",
        animama_data_root=tmp_path / "data",
        animama_user_file_processing_enabled=enabled,
    )
    app.include_router(user_files.router)

    async def principal() -> RequestPrincipal:
        return RequestPrincipal(id=OWNER)

    async def database() -> AsyncIterator[AsyncSession]:
        yield session

    app.dependency_overrides[get_current_principal] = principal
    app.dependency_overrides[get_async_session] = database
    return app


@pytest.mark.parametrize("enabled", [True, False])
async def test_process_route_wakes_the_runner_and_still_refuses_when_disabled(
    async_session: AsyncSession,
    async_session_factory: async_sessionmaker[AsyncSession],
    clean_tables: None,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    enabled: bool,
) -> None:
    async_session.add(
        ORMUserFile(
            id="route-upload",
            user_id=OWNER,
            storage_locator=f"user-files/{OWNER}/route-upload/original",
            original_filename="notes.txt",
            normalized_extension=".txt",
            declared_size_bytes=4,
            stored_size_bytes=4,
            status=STATUS_UPLOADED,
            upload_expires_at=datetime.now(UTC) + timedelta(minutes=10),
            metadata_={},
        )
    )
    await async_session.commit()
    app = _route_app(async_session, tmp_path, enabled=enabled)
    runner = _runner(async_session_factory, _MemoryStorage(), _TextParser())
    woken: list[bool] = []
    monkeypatch.setattr(runner, "wake", lambda: woken.append(True))
    app.state.user_file_processing_runner = runner

    async with local_client(app) as client:
        response = await client.post("/v1/files/route-upload:process", json={})

    if enabled:
        assert response.status_code == 202, response.text
        assert response.json()["job_status"] == JOB_STATUS_QUEUED
        assert woken == [True]
    else:
        assert response.status_code == 409
        assert response.json()["detail"] == {"code": "file_processing_unavailable"}
        assert woken == []
