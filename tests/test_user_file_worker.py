from __future__ import annotations

from contextlib import contextmanager
from datetime import UTC, datetime, timedelta
from io import BytesIO
from types import SimpleNamespace

import pytest
from sqlalchemy import delete, select

from animama.domain.user_file import STATUS_FAILED, STATUS_READY
from animama.domain.user_file_processing import (
    JOB_STATUS_FAILED,
    JOB_STATUS_SUCCEEDED,
    ClaimedUserFileProcessingJob,
    ParsedUserFileDocument,
    UserFileChunkDraft,
    UserFileProcessingJob,
)
from animama.orm.user_file import ORMUserFile
from animama.orm.user_file_chunk import ORMUserFileChunk
from animama.orm.user_file_processing_job import ORMUserFileProcessingJob
from animama.workers.user_file_processing import UserFileProcessingWorker


class _FakeEmbedder:
    async def embed_texts(self, texts):
        return [[1.0, 0.0, float(index)] for index, _text in enumerate(texts)]


class _FailingParser:
    async def parse(self, *, payload: bytes, filename: str, extension: str):
        raise RuntimeError("parser exploded")


class _ParserProvidedChunksParser:
    async def parse(self, *, payload: bytes, filename: str, extension: str):
        return ParsedUserFileDocument(
            text="",
            parser_name="docling",
            metadata={"parser": "docling"},
            chunks=[
                UserFileChunkDraft(
                    chunk_index=0,
                    text="Worker display text",
                    embedding_text="Worker heading\nWorker display text",
                    char_count=len("Worker display text"),
                    token_estimate=8,
                    metadata={"parser": "docling", "chunker": "docling_hybrid"},
                )
            ],
        )


class _WarmupParser:
    def __init__(self, *, fail: bool = False) -> None:
        self.fail = fail
        self.warmed = False

    async def warm_up(self) -> None:
        self.warmed = True
        if self.fail:
            raise RuntimeError("warmup failed")


def _now() -> datetime:
    return datetime.now(UTC)


@pytest.fixture
async def clean_user_file_tables(async_session):
    await async_session.execute(delete(ORMUserFileProcessingJob))
    await async_session.execute(delete(ORMUserFileChunk))
    await async_session.execute(delete(ORMUserFile))
    await async_session.commit()
    yield
    await async_session.execute(delete(ORMUserFileProcessingJob))
    await async_session.execute(delete(ORMUserFileChunk))
    await async_session.execute(delete(ORMUserFile))
    await async_session.commit()


async def _insert_file_and_job(
    session,
    *,
    file_id: str = "file-1",
    user_id: str = "user-1",
    extension: str = ".txt",
    max_attempts: int = 1,
) -> None:
    session.add(
        ORMUserFile(
            id=file_id,
            user_id=user_id,
            storage_locator=f"user-files/{user_id}/{file_id}/original",
            original_filename=f"{file_id}{extension}",
            normalized_extension=extension,
            declared_content_type="text/plain",
            declared_size_bytes=64,
            stored_size_bytes=64,
            status="uploaded",
            upload_expires_at=_now() + timedelta(minutes=10),
            metadata_={},
        )
    )
    session.add(
        ORMUserFileProcessingJob(
            id=f"job-{file_id}",
            file_id=file_id,
            user_id=user_id,
            attempts=0,
            max_attempts=max_attempts,
            run_after=_now() - timedelta(seconds=1),
            metadata_={},
        )
    )
    await session.commit()


def _worker(
    async_session_factory,
    *,
    object_loader,
    parser=None,
    max_process_bytes: int = 1024,
) -> UserFileProcessingWorker:
    worker = UserFileProcessingWorker(
        database_url="unused",
        worker_id="test-worker",
        poll_seconds=0.1,
        batch_size=1,
        lease_seconds=300,
        max_attempts=1,
        max_process_bytes=max_process_bytes,
        parser=parser,
        embedder_factory=lambda: _FakeEmbedder(),
        object_loader=object_loader,
    )
    worker._session_factory = async_session_factory
    worker._embedder = _FakeEmbedder()
    return worker


@pytest.mark.asyncio
async def test_worker_process_once_success_replaces_chunks(async_session_factory, clean_user_file_tables) -> None:
    async with async_session_factory() as session:
        await _insert_file_and_job(session, file_id="file-worker-success")

    worker = _worker(async_session_factory, object_loader=lambda _key: b"Alpha worker success text")
    processed = await worker.process_once()

    async with async_session_factory() as session:
        file_obj = await session.get(ORMUserFile, "file-worker-success")
        job_obj = await session.get(ORMUserFileProcessingJob, "job-file-worker-success")

    assert processed == 1
    assert file_obj is not None
    assert file_obj.status == STATUS_READY
    assert job_obj is not None
    assert job_obj.status == JOB_STATUS_SUCCEEDED


@pytest.mark.asyncio
async def test_worker_warm_parser_invokes_parser_warmup() -> None:
    parser = _WarmupParser()
    worker = UserFileProcessingWorker(
        database_url="unused",
        worker_id="test-worker",
        poll_seconds=0.1,
        batch_size=1,
        lease_seconds=300,
        max_attempts=1,
        max_process_bytes=1024,
        parser=parser,
        object_loader=lambda _key: b"",
    )

    await worker._warm_parser()

    assert parser.warmed is True


async def test_worker_stop_preserves_original_and_queued_job_for_reinstallation(
    async_session_factory, clean_user_file_tables
) -> None:
    async with async_session_factory() as session:
        await _insert_file_and_job(session, file_id="pack-reinstall")

    stopped = _worker(async_session_factory, object_loader=lambda _key: b"Preserved original")
    await stopped.stop()
    assert await stopped.process_once() == 0
    async with async_session_factory() as session:
        assert (await session.get(ORMUserFile, "pack-reinstall")).status == "uploaded"
        assert (await session.get(ORMUserFileProcessingJob, "job-pack-reinstall")).status == "queued"

    replacement = _worker(async_session_factory, object_loader=lambda _key: b"Preserved original")
    assert await replacement.process_once() == 1
    async with async_session_factory() as session:
        original = await session.get(ORMUserFile, "pack-reinstall")
        assert original.status == STATUS_READY
        assert original.storage_locator == "user-files/user-1/pack-reinstall/original"
        assert (await session.get(ORMUserFileProcessingJob, "job-pack-reinstall")).status == JOB_STATUS_SUCCEEDED


@pytest.mark.asyncio
async def test_worker_process_once_with_parser_provided_chunks_stores_embeddings(
    async_session_factory,
    clean_user_file_tables,
) -> None:
    async with async_session_factory() as session:
        await _insert_file_and_job(session, file_id="file-worker-parser-chunks", extension=".pdf")

    worker = _worker(
        async_session_factory,
        object_loader=lambda _key: b"%PDF-1.7\nbody",
        parser=_ParserProvidedChunksParser(),
    )
    processed = await worker.process_once()

    async with async_session_factory() as session:
        file_obj = await session.get(ORMUserFile, "file-worker-parser-chunks")
        job_obj = await session.get(ORMUserFileProcessingJob, "job-file-worker-parser-chunks")
        chunks = (
            (
                await session.execute(
                    select(ORMUserFileChunk).where(ORMUserFileChunk.file_id == "file-worker-parser-chunks")
                )
            )
            .scalars()
            .all()
        )

    assert processed == 1
    assert file_obj is not None
    assert file_obj.status == STATUS_READY
    assert job_obj is not None
    assert job_obj.status == JOB_STATUS_SUCCEEDED
    assert len(chunks) == 1
    assert chunks[0].text == "Worker display text"
    assert chunks[0].embedding is not None
    assert list(chunks[0].embedding) == [1.0, 0.0, 0.0]
    assert chunks[0].metadata_["chunker"] == "docling_hybrid"


@pytest.mark.asyncio
async def test_worker_process_once_parser_failure_marks_final_failure(
    async_session_factory,
    clean_user_file_tables,
) -> None:
    async with async_session_factory() as session:
        await _insert_file_and_job(session, file_id="file-worker-parser", extension=".pdf", max_attempts=1)

    worker = _worker(async_session_factory, object_loader=lambda _key: b"%PDF-1.7", parser=_FailingParser())
    processed = await worker.process_once()

    async with async_session_factory() as session:
        file_obj = await session.get(ORMUserFile, "file-worker-parser")
        job_obj = await session.get(ORMUserFileProcessingJob, "job-file-worker-parser")

    assert processed == 1
    assert file_obj is not None
    assert file_obj.status == STATUS_FAILED
    assert job_obj is not None
    assert job_obj.status == JOB_STATUS_FAILED
    assert "parser exploded" in (job_obj.last_error or "")


@pytest.mark.asyncio
async def test_worker_process_once_missing_object_marks_failure(async_session_factory, clean_user_file_tables) -> None:
    async with async_session_factory() as session:
        await _insert_file_and_job(session, file_id="file-worker-missing", max_attempts=1)

    worker = _worker(async_session_factory, object_loader=lambda _key: None)
    processed = await worker.process_once()

    async with async_session_factory() as session:
        file_obj = await session.get(ORMUserFile, "file-worker-missing")
        job_obj = await session.get(ORMUserFileProcessingJob, "job-file-worker-missing")

    assert processed == 1
    assert file_obj is not None
    assert file_obj.status == STATUS_FAILED
    assert job_obj is not None
    assert job_obj.status == JOB_STATUS_FAILED
    assert "not found" in (job_obj.last_error or "")


@pytest.mark.asyncio
async def test_worker_process_once_oversized_object_marks_failure(
    async_session_factory,
    clean_user_file_tables,
) -> None:
    async with async_session_factory() as session:
        await _insert_file_and_job(session, file_id="file-worker-oversized", max_attempts=1)

    worker = _worker(async_session_factory, object_loader=lambda _key: b"too large", max_process_bytes=3)
    processed = await worker.process_once()

    async with async_session_factory() as session:
        file_obj = await session.get(ORMUserFile, "file-worker-oversized")
        job_obj = await session.get(ORMUserFileProcessingJob, "job-file-worker-oversized")

    assert processed == 1
    assert file_obj is not None
    assert file_obj.status == STATUS_FAILED
    assert job_obj is not None
    assert job_obj.status == JOB_STATUS_FAILED
    assert "byte limit" in (job_obj.last_error or "")


@pytest.mark.asyncio
async def test_worker_stop_marks_loop_not_running() -> None:
    worker = UserFileProcessingWorker(
        database_url="unused",
        worker_id="test-worker",
        poll_seconds=0.1,
        batch_size=1,
        lease_seconds=300,
        max_attempts=1,
        max_process_bytes=1024,
        object_loader=lambda _key: b"",
    )
    worker._running = True

    await worker.stop()

    assert worker._running is False


def test_worker_reads_exact_bytes_through_private_storage_port() -> None:
    payload = b"local worker bytes"

    class FakePrivateStorage:
        @contextmanager
        def open_bounded(self, locator: str, *, expected_size_bytes: int):  # noqa: ANN202
            assert locator == "user-files/user-1/file-1/original"
            assert expected_size_bytes == len(payload)
            yield SimpleNamespace(
                stream=BytesIO(payload),
                size_bytes=len(payload),
                sha256="unused",
            )

    worker = UserFileProcessingWorker(
        database_url="unused",
        worker_id="test-worker",
        poll_seconds=0.1,
        batch_size=1,
        lease_seconds=300,
        max_attempts=1,
        max_process_bytes=1024,
        parser=_WarmupParser(),
        private_storage=FakePrivateStorage(),  # type: ignore[arg-type]
    )
    claimed = ClaimedUserFileProcessingJob(
        job=UserFileProcessingJob(id="job-1", file_id="file-1", user_id="user-1"),
        storage_locator="user-files/user-1/file-1/original",
        original_filename="notes.txt",
        normalized_extension=".txt",
        stored_size_bytes=len(payload),
        declared_size_bytes=len(payload),
    )

    assert worker._load_payload(claimed) == payload
