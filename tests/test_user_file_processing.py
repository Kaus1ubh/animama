from __future__ import annotations

import hashlib
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from typing import Any

import pytest
from fastapi import HTTPException
from sqlalchemy import delete, select

from animama.adapters.parsers import docling_user_file_parser as docling_parser_module
from animama.adapters.parsers.docling_user_file_parser import DoclingUserFileParser, DoclingUserFileParserError
from animama.adapters.repositories.sqlalchemy.runtime_worker_repo import record_document_heartbeat
from animama.adapters.repositories.sqlalchemy.uow import SQLAlchemyUnitOfWork
from animama.adapters.repositories.sqlalchemy.user_file_processing_repo import SQLAlchemyUserFileProcessingRepository
from animama.app.services import user_file_processing_service as processing_service_module
from animama.app.services.user_file_processing_service import (
    UserFileProcessingService,
    chunk_parsed_user_file_document,
    parse_lightweight_user_file,
)
from animama.domain.user_file import (
    STATUS_FAILED,
    STATUS_PROCESSING,
    STATUS_READY,
    STATUS_READY_KEYWORD_ONLY,
    STATUS_UPLOADED,
)
from animama.domain.user_file_processing import (
    JOB_STATUS_FAILED,
    JOB_STATUS_QUEUED,
    JOB_STATUS_RUNNING,
    JOB_STATUS_SUCCEEDED,
    ClaimedUserFileProcessingJob,
    ParsedUserFileDocument,
    UserFileChunkDraft,
    UserFileOutlineItem,
    UserFileProcessingJob,
    UserFileSearchResult,
)
from animama.orm.user_file import ORMUserFile
from animama.orm.user_file_chunk import ORMUserFileChunk
from animama.orm.user_file_processing_job import ORMUserFileProcessingJob
from animama.server.routers import user_files as user_files_router
from animama.server.schemas.user_file import PyUserFileProcessRequest, PyUserFileSearchRequest


class _FakeEmbedder:
    async def embed_texts(self, texts):
        return [[1.0, 0.0, float(index)] for index, _text in enumerate(texts)]


class _RecordingEmbedder:
    def __init__(self) -> None:
        self.texts: list[str] = []

    async def embed_texts(self, texts):
        self.texts = list(texts)
        return [[1.0, 0.0, float(index)] for index, _text in enumerate(texts)]


class _FailingEmbedder:
    async def embed_texts(self, texts):
        raise RuntimeError(f"embedding unavailable for {len(texts)} chunks")


class _HybridRepo:
    async def get_user_file(self, *, user_id: str, file_id: str, include_deleted: bool = False):
        return SimpleNamespace(id=file_id, user_id=user_id)

    async def keyword_search(self, *, user_id: str, query: str, limit: int, file_ids: list[str] | None = None):
        return [
            UserFileSearchResult(
                chunk_id="chunk-a",
                file_id="file-1",
                chunk_index=0,
                text="keyword",
                score=0.8,
                metadata={},
                original_filename="a.txt",
                normalized_extension=".txt",
                match_type="keyword",
            ),
            UserFileSearchResult(
                chunk_id="chunk-b",
                file_id="file-1",
                chunk_index=1,
                text="both",
                score=0.5,
                metadata={},
                original_filename="a.txt",
                normalized_extension=".txt",
                match_type="keyword",
            ),
        ]

    async def semantic_search(
        self,
        *,
        user_id: str,
        embedding: list[float],
        limit: int,
        file_ids: list[str] | None = None,
    ):
        return [
            UserFileSearchResult(
                chunk_id="chunk-b",
                file_id="file-1",
                chunk_index=1,
                text="both",
                score=0.9,
                metadata={},
                original_filename="a.txt",
                normalized_extension=".txt",
                match_type="semantic",
            )
        ]


class _NoopUow:
    async def commit(self) -> None:
        pass

    async def rollback(self) -> None:
        pass


class _CapturingProcessingRepo:
    def __init__(self, *, reuse_result: UserFileProcessingJob | None = None) -> None:
        self.chunks: list[UserFileChunkDraft] = []
        self.file_metadata: dict[str, Any] | None = None
        self.file_metadata_updates: dict[str, Any] | None = None
        self.file_status: str | None = None
        self.sha256: str | None = None
        self.reuse_calls: list[dict[str, Any]] = []
        self.reuse_result = reuse_result

    async def reuse_processed_file(
        self,
        *,
        job_id: str,
        user_id: str,
        file_id: str,
        sha256: str,
        processed_at: datetime,
    ) -> UserFileProcessingJob | None:
        self.reuse_calls.append(
            {
                "job_id": job_id,
                "user_id": user_id,
                "file_id": file_id,
                "sha256": sha256,
                "processed_at": processed_at,
            }
        )
        return self.reuse_result

    async def replace_chunks_and_mark_success(
        self,
        *,
        job_id: str,
        user_id: str,
        file_id: str,
        sha256: str,
        chunks: list[UserFileChunkDraft],
        file_status: str,
        processing_metadata: dict,
        file_metadata_updates: dict | None = None,
        processed_at: datetime,
    ) -> UserFileProcessingJob:
        self.chunks = chunks
        self.file_metadata = processing_metadata
        self.file_metadata_updates = file_metadata_updates
        self.file_status = file_status
        self.sha256 = sha256
        return UserFileProcessingJob(
            id=job_id,
            user_id=user_id,
            file_id=file_id,
            status=JOB_STATUS_SUCCEEDED,
            finished_at=processed_at,
            metadata={"chunk_count": len(chunks)},
        )


class _StaticParser:
    def __init__(self, parsed: ParsedUserFileDocument) -> None:
        self.parsed = parsed

    async def parse(self, *, payload: bytes, filename: str, extension: str) -> ParsedUserFileDocument:
        return self.parsed


class _UnexpectedParser:
    async def parse(self, *, payload: bytes, filename: str, extension: str) -> ParsedUserFileDocument:
        pytest.fail("duplicate content should not be parsed")


class _RouterProcessingService:
    async def enqueue_processing_job(self, *, user_id: str, file_id: str, force: bool = False):
        if file_id == "missing":
            from animama.app.services.user_file_processing_service import UserFileProcessingNotFoundError

            raise UserFileProcessingNotFoundError("File not found")
        return SimpleNamespace(
            file_id=file_id,
            job_id="job-forced" if force else "job-1",
            file_status=STATUS_PROCESSING,
            job_status=JOB_STATUS_QUEUED,
            reused_existing_job=not force,
        )

    async def search(
        self,
        *,
        user_id: str,
        query: str,
        mode: str,
        limit: int,
        file_ids: list[str] | None,
        embedder: Any,
    ):
        return SimpleNamespace(
            query=query,
            mode=mode,
            warnings=[],
            results=[
                UserFileSearchResult(
                    chunk_id="chunk-1",
                    file_id="file-1",
                    chunk_index=0,
                    text="alpha result",
                    score=1.0,
                    metadata={},
                    original_filename="notes.txt",
                    normalized_extension=".txt",
                    match_type=mode,
                )
            ],
        )


def _now() -> datetime:
    return datetime.now(timezone.utc)


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


async def _insert_file(
    session,
    *,
    file_id: str = "file-1",
    user_id: str = "user-1",
    status: str = STATUS_UPLOADED,
    extension: str = ".txt",
    storage_locator: str | None = None,
    original_filename: str | None = None,
    sha256: str | None = None,
    metadata: dict[str, Any] | None = None,
) -> None:
    session.add(
        ORMUserFile(
            id=file_id,
            user_id=user_id,
            storage_locator=storage_locator or f"users/{user_id}/files/{file_id}/original{extension}",
            original_filename=original_filename or f"{file_id}{extension}",
            normalized_extension=extension,
            declared_content_type="text/plain",
            declared_size_bytes=64,
            stored_size_bytes=64,
            sha256=sha256,
            status=status,
            upload_expires_at=_now() + timedelta(minutes=10),
            metadata_=dict(metadata or {}),
        )
    )
    await session.commit()


async def _insert_job(
    session,
    *,
    job_id: str = "job-1",
    file_id: str = "file-1",
    user_id: str = "user-1",
    status: str = JOB_STATUS_QUEUED,
    attempts: int = 0,
    max_attempts: int = 3,
    locked_at: datetime | None = None,
    run_after: datetime | None = None,
) -> None:
    session.add(
        ORMUserFileProcessingJob(
            id=job_id,
            file_id=file_id,
            user_id=user_id,
            status=status,
            attempts=attempts,
            max_attempts=max_attempts,
            run_after=run_after or _now() - timedelta(seconds=1),
            locked_by="old-worker" if locked_at else None,
            locked_at=locked_at,
            metadata_={},
        )
    )
    await session.commit()


def _claimed_processing_job(
    *,
    file_id: str = "file-1",
    extension: str = ".pdf",
    force: bool = False,
) -> ClaimedUserFileProcessingJob:
    return ClaimedUserFileProcessingJob(
        job=UserFileProcessingJob(
            id=f"job-{file_id}",
            user_id="user-1",
            file_id=file_id,
            attempts=1,
            max_attempts=3,
            metadata={"force": True} if force else {},
        ),
        storage_locator=f"users/user-1/files/{file_id}/original{extension}",
        original_filename=f"{file_id}{extension}",
        normalized_extension=extension,
        stored_size_bytes=64,
        declared_size_bytes=64,
    )


async def test_worker_heartbeat_renews_only_its_own_running_job(async_session, clean_user_file_tables):
    before = _now() - timedelta(seconds=600)
    for name, status in (("own", JOB_STATUS_RUNNING), ("foreign", JOB_STATUS_RUNNING), ("queued", JOB_STATUS_QUEUED)):
        await _insert_file(async_session, file_id=name)
        await _insert_job(async_session, job_id=name, file_id=name, status=status, locked_at=before)
    foreign = await async_session.get(ORMUserFileProcessingJob, "foreign")
    foreign.locked_by = "other-worker"
    await async_session.commit()

    await record_document_heartbeat(async_session, instance_id="installation-worker", worker_id="old-worker")
    async_session.expire_all()
    own = await async_session.get(ORMUserFileProcessingJob, "own")
    foreign = await async_session.get(ORMUserFileProcessingJob, "foreign")
    queued = await async_session.get(ORMUserFileProcessingJob, "queued")
    assert own.locked_at > _now() - timedelta(seconds=5)
    assert foreign.locked_at == before
    assert queued.locked_at == before
    assert queued.status == JOB_STATUS_QUEUED


@pytest.mark.asyncio
async def test_processing_enqueue_reuses_active_job_and_force_creates_new(
    async_session,
    clean_user_file_tables,
) -> None:
    await _insert_file(async_session, file_id="file-enqueue")
    service = UserFileProcessingService(
        processing=SQLAlchemyUserFileProcessingRepository(async_session),
        uow=SQLAlchemyUnitOfWork(async_session),
        max_attempts=3,
    )

    first = await service.enqueue_processing_job(user_id="user-1", file_id="file-enqueue")
    reused = await service.enqueue_processing_job(user_id="user-1", file_id="file-enqueue")
    forced = await service.enqueue_processing_job(user_id="user-1", file_id="file-enqueue", force=True)

    assert first.reused_existing_job is False
    assert reused.reused_existing_job is True
    assert reused.job_id == first.job_id
    assert forced.reused_existing_job is False
    assert forced.job_id != first.job_id


@pytest.mark.asyncio
async def test_process_endpoint_returns_accepted_response(monkeypatch) -> None:
    monkeypatch.setattr(
        user_files_router, "_processing_service", lambda _session, **_policy: _RouterProcessingService()
    )

    response = await user_files_router.process_user_file(
        "file-1",
        session=object(),
        user=SimpleNamespace(id="user-1"),
        req=PyUserFileProcessRequest(force=True),
    )

    assert response.file_id == "file-1"
    assert response.job_id == "job-forced"
    assert response.file_status == STATUS_PROCESSING
    assert response.job_status == JOB_STATUS_QUEUED
    assert response.reused_existing_job is False


@pytest.mark.asyncio
async def test_process_endpoint_enforces_current_user_not_found(monkeypatch) -> None:
    monkeypatch.setattr(
        user_files_router, "_processing_service", lambda _session, **_policy: _RouterProcessingService()
    )

    with pytest.raises(HTTPException) as exc_info:
        await user_files_router.process_user_file(
            "missing",
            session=object(),
            user=SimpleNamespace(id="user-1"),
            req=PyUserFileProcessRequest(),
        )

    assert exc_info.value.status_code == 404


@pytest.mark.asyncio
async def test_debug_search_endpoint_returns_results_without_embedder_for_keyword(monkeypatch) -> None:
    monkeypatch.setattr(user_files_router, "_processing_service", lambda _session: _RouterProcessingService())
    monkeypatch.setattr(user_files_router, "get_embedder", lambda: pytest.fail("keyword search should not embed"))

    response = await user_files_router.search_user_file_chunks(
        PyUserFileSearchRequest(query="alpha", mode="keyword", limit=5),
        session=object(),
        user=SimpleNamespace(id="user-1"),
    )

    assert response.query == "alpha"
    assert response.mode == "keyword"
    assert response.results[0].file_id == "file-1"


@pytest.mark.asyncio
async def test_claim_next_job_skips_locked_rows(async_session_factory, clean_user_file_tables) -> None:
    async with async_session_factory() as setup:
        await _insert_file(setup, file_id="file-lock-1")
        await _insert_file(setup, file_id="file-lock-2")
        await _insert_job(setup, job_id="job-lock-1", file_id="file-lock-1")
        await _insert_job(setup, job_id="job-lock-2", file_id="file-lock-2")

    async with async_session_factory() as session1, async_session_factory() as session2:
        repo1 = SQLAlchemyUserFileProcessingRepository(session1)
        repo2 = SQLAlchemyUserFileProcessingRepository(session2)
        claimed1 = await repo1.claim_next_job(worker_id="worker-1", lease_seconds=300, now=_now())
        claimed2 = await repo2.claim_next_job(worker_id="worker-2", lease_seconds=300, now=_now())

        assert claimed1 is not None
        assert claimed2 is not None
        assert claimed1.job.id == "job-lock-1"
        assert claimed2.job.id == "job-lock-2"

        await session1.rollback()
        await session2.rollback()


@pytest.mark.asyncio
async def test_claim_next_job_recovers_stale_running_lease(async_session, clean_user_file_tables) -> None:
    await _insert_file(async_session, file_id="file-stale")
    await _insert_job(
        async_session,
        job_id="job-stale",
        file_id="file-stale",
        status=JOB_STATUS_RUNNING,
        attempts=1,
        locked_at=_now() - timedelta(minutes=10),
    )
    repo = SQLAlchemyUserFileProcessingRepository(async_session)

    claimed = await repo.claim_next_job(worker_id="worker-new", lease_seconds=300, now=_now())

    assert claimed is not None
    assert claimed.job.id == "job-stale"
    assert claimed.job.attempts == 2
    assert claimed.job.locked_by == "worker-new"


@pytest.mark.asyncio
async def test_replace_chunks_success_and_search_modes(async_session, clean_user_file_tables) -> None:
    await _insert_file(
        async_session,
        file_id="file-search",
        metadata={"preserved": "yes", "overview": {"version": 0, "description": "stale"}},
    )
    await _insert_job(async_session, job_id="job-search", file_id="file-search", status=JOB_STATUS_RUNNING, attempts=1)
    repo = SQLAlchemyUserFileProcessingRepository(async_session)
    parsed = ParsedUserFileDocument(
        text="Alpha project notes.\n\nBeta budget table.",
        parser_name="test",
        metadata={"parser": "test"},
    )
    chunks = chunk_parsed_user_file_document(parsed, target_chars=40, overlap_chars=5)

    completed = await repo.replace_chunks_and_mark_success(
        job_id="job-search",
        user_id="user-1",
        file_id="file-search",
        sha256="a" * 64,
        chunks=[
            type(chunk)(
                chunk_index=chunk.chunk_index,
                text=chunk.text,
                char_count=chunk.char_count,
                token_estimate=chunk.token_estimate,
                metadata=chunk.metadata,
                embedding=[1.0, 0.0, float(chunk.chunk_index)],
            )
            for chunk in chunks
        ],
        file_status=STATUS_READY,
        processing_metadata={"parser": "test"},
        file_metadata_updates={"overview": {"version": 1}},
        processed_at=_now(),
    )
    await async_session.commit()

    keyword = await repo.keyword_search(user_id="user-1", query="Alpha", limit=5)
    semantic = await repo.semantic_search(user_id="user-1", embedding=[1.0, 0.0, 0.0], limit=5)
    ordered_chunks = await repo.read_chunks(
        user_id="user-1",
        file_id="file-search",
        start_chunk=0,
        limit=5,
    )
    later_chunks = await repo.read_chunks(
        user_id="user-1",
        file_id="file-search",
        start_chunk=1,
        limit=1,
    )
    foreign_read = await repo.read_chunks(
        user_id="user-2",
        file_id="file-search",
        start_chunk=0,
        limit=5,
    )
    stored_file = await async_session.get(ORMUserFile, "file-search")

    assert completed.status == JOB_STATUS_SUCCEEDED
    assert keyword[0].file_id == "file-search"
    assert "Alpha" in keyword[0].text
    assert semantic[0].file_id == "file-search"
    assert [chunk.chunk_index for chunk in ordered_chunks] == list(range(len(chunks)))
    assert [chunk.chunk_index for chunk in later_chunks] == ([1] if len(chunks) > 1 else [])
    assert foreign_read == []
    assert stored_file is not None
    assert stored_file.sha256 == "a" * 64
    assert stored_file.metadata_["preserved"] == "yes"
    assert stored_file.metadata_["processing"] == {"parser": "test", "chunk_count": len(chunks)}
    assert stored_file.metadata_["overview"] == {"version": 1}

    stored_file.status = STATUS_PROCESSING
    await async_session.flush()
    assert (
        await repo.read_chunks(
            user_id="user-1",
            file_id="file-search",
            start_chunk=0,
            limit=5,
        )
        == []
    )


@pytest.mark.asyncio
async def test_reuse_processed_file_clones_same_user_digest_result_atomically(
    async_session,
    clean_user_file_tables,
) -> None:
    digest = hashlib.sha256(b"same bytes").hexdigest()
    await _insert_file(
        async_session,
        file_id="file-source",
        status=STATUS_READY,
        sha256=digest,
        metadata={
            "source_only": "not copied",
            "overview": {"version": 1, "description": "Reusable overview"},
            "processing": {"parser": "docling", "embedded": True, "chunk_count": 1},
        },
    )
    async_session.add(
        ORMUserFileChunk(
            id="chunk-file-source-000000",
            file_id="file-source",
            user_id="user-1",
            chunk_index=0,
            text="Reusable source chunk",
            embedding=[1.0, 2.0, 3.0],
            char_count=21,
            token_estimate=5,
            metadata_={
                "headings": ["Reusable"],
                "filename": "file-source.txt",
                "extension": ".txt",
            },
        )
    )
    await _insert_file(
        async_session,
        file_id="file-target",
        status=STATUS_PROCESSING,
        metadata={"preserved": "target", "overview": {"version": 0}},
    )
    await _insert_job(
        async_session,
        job_id="job-target",
        file_id="file-target",
        status=JOB_STATUS_RUNNING,
        attempts=1,
    )
    repo = SQLAlchemyUserFileProcessingRepository(async_session)

    completed = await repo.reuse_processed_file(
        job_id="job-target",
        user_id="user-1",
        file_id="file-target",
        sha256=digest,
        processed_at=_now(),
    )
    await async_session.commit()

    target = await async_session.get(ORMUserFile, "file-target")
    target_chunks = list(
        (
            await async_session.execute(select(ORMUserFileChunk).where(ORMUserFileChunk.file_id == "file-target"))
        ).scalars()
    )
    source_chunks = list(
        (
            await async_session.execute(select(ORMUserFileChunk).where(ORMUserFileChunk.file_id == "file-source"))
        ).scalars()
    )

    assert completed is not None
    assert completed.status == JOB_STATUS_SUCCEEDED
    assert completed.metadata is not None
    assert completed.metadata["content_reused"] is True
    assert target is not None
    assert target.status == STATUS_READY
    assert target.sha256 == digest
    assert target.metadata_["preserved"] == "target"
    assert "source_only" not in target.metadata_
    assert target.metadata_["overview"] == {"version": 1, "description": "Reusable overview"}
    assert target.metadata_["processing"] == {
        "parser": "docling",
        "embedded": True,
        "chunk_count": 1,
        "content_reused": True,
    }
    assert len(target_chunks) == 1
    assert target_chunks[0].id == "chunk-file-target-000000"
    assert target_chunks[0].text == "Reusable source chunk"
    assert target_chunks[0].embedding is not None
    assert list(target_chunks[0].embedding) == [1.0, 2.0, 3.0]
    assert target_chunks[0].metadata_ == {
        "headings": ["Reusable"],
        "filename": "file-target.txt",
        "extension": ".txt",
    }
    assert len(source_chunks) == 1
    assert source_chunks[0].id == "chunk-file-source-000000"


@pytest.mark.asyncio
async def test_reuse_processed_file_ignores_foreign_or_empty_digest_matches(
    async_session,
    clean_user_file_tables,
) -> None:
    digest = hashlib.sha256(b"same bytes").hexdigest()
    await _insert_file(
        async_session,
        file_id="file-foreign-source",
        user_id="user-2",
        status=STATUS_READY,
        sha256=digest,
    )
    async_session.add(
        ORMUserFileChunk(
            id="chunk-file-foreign-source-000000",
            file_id="file-foreign-source",
            user_id="user-2",
            chunk_index=0,
            text="Foreign content",
            embedding=None,
            char_count=15,
            token_estimate=4,
            metadata_={},
        )
    )
    await _insert_file(
        async_session,
        file_id="file-empty-source",
        status=STATUS_READY,
        sha256=digest,
    )
    await _insert_file(
        async_session,
        file_id="file-wrong-extension-source",
        status=STATUS_READY,
        extension=".md",
        sha256=digest,
    )
    async_session.add(
        ORMUserFileChunk(
            id="chunk-file-wrong-extension-source-000000",
            file_id="file-wrong-extension-source",
            user_id="user-1",
            chunk_index=0,
            text="Markdown content",
            embedding=None,
            char_count=16,
            token_estimate=4,
            metadata_={},
        )
    )
    await _insert_file(async_session, file_id="file-target", status=STATUS_PROCESSING)
    await _insert_job(
        async_session,
        job_id="job-target",
        file_id="file-target",
        status=JOB_STATUS_RUNNING,
        attempts=1,
    )
    repo = SQLAlchemyUserFileProcessingRepository(async_session)

    completed = await repo.reuse_processed_file(
        job_id="job-target",
        user_id="user-1",
        file_id="file-target",
        sha256=digest,
        processed_at=_now(),
    )

    target = await async_session.get(ORMUserFile, "file-target")
    assert completed is None
    assert target is not None
    assert target.status == STATUS_PROCESSING
    assert target.sha256 is None


@pytest.mark.asyncio
async def test_mark_job_failure_retries_then_fails_file(async_session, clean_user_file_tables) -> None:
    await _insert_file(async_session, file_id="file-failure", status=STATUS_PROCESSING)
    await _insert_job(
        async_session,
        job_id="job-failure",
        file_id="file-failure",
        status=JOB_STATUS_RUNNING,
        attempts=1,
        max_attempts=2,
    )
    repo = SQLAlchemyUserFileProcessingRepository(async_session)

    retried = await repo.mark_job_failure(
        job_id="job-failure",
        user_id="user-1",
        file_id="file-failure",
        error="parse failed",
        now=_now(),
        retry_delay_seconds=10,
    )
    await async_session.commit()
    failed_claim = await repo.claim_next_job(
        worker_id="worker-1",
        lease_seconds=300,
        now=_now() + timedelta(seconds=11),
    )
    assert failed_claim is not None
    final = await repo.mark_job_failure(
        job_id="job-failure",
        user_id="user-1",
        file_id="file-failure",
        error="parse failed again",
        now=_now(),
        retry_delay_seconds=10,
    )
    file_obj = await async_session.get(ORMUserFile, "file-failure")

    assert retried.status == JOB_STATUS_QUEUED
    assert final.status == JOB_STATUS_FAILED
    assert file_obj is not None
    assert file_obj.status == STATUS_FAILED


@pytest.mark.asyncio
async def test_complete_claimed_job_uses_parser_chunks_and_embedding_text() -> None:
    parsed = ParsedUserFileDocument(
        text="",
        parser_name="docling",
        metadata={"parser": "docling"},
        chunks=[
            UserFileChunkDraft(
                chunk_index=0,
                text="Display chunk text",
                embedding_text="Heading breadcrumb\nDisplay chunk text",
                char_count=len("Display chunk text"),
                token_estimate=7,
                metadata={"parser": "docling", "chunker": "docling_hybrid"},
            )
        ],
    )
    repo = _CapturingProcessingRepo()
    embedder = _RecordingEmbedder()
    service = UserFileProcessingService(processing=repo, uow=_NoopUow())

    completed = await service.complete_claimed_job(
        claimed=_claimed_processing_job(file_id="file-parser-chunks"),
        payload=b"%PDF-1.7\nbody",
        parser=_StaticParser(parsed),
        embedder=embedder,
        max_process_bytes=1024,
    )

    assert completed.status == JOB_STATUS_SUCCEEDED
    assert embedder.texts == ["Heading breadcrumb\nDisplay chunk text"]
    assert repo.file_status == STATUS_READY
    assert repo.sha256 == hashlib.sha256(b"%PDF-1.7\nbody").hexdigest()
    assert len(repo.reuse_calls) == 1
    assert len(repo.chunks) == 1
    assert repo.chunks[0].text == "Display chunk text"
    assert repo.chunks[0].embedding_text == "Heading breadcrumb\nDisplay chunk text"
    assert repo.chunks[0].embedding == [1.0, 0.0, 0.0]
    assert repo.file_metadata is not None
    assert repo.file_metadata["embedded"] is True
    assert repo.file_metadata_updates is not None
    assert repo.file_metadata_updates["overview"]["description"] == "Display chunk text"


@pytest.mark.asyncio
async def test_complete_claimed_job_reuses_verified_content_before_parsing() -> None:
    reused_job = UserFileProcessingJob(
        id="job-file-duplicate",
        user_id="user-1",
        file_id="file-duplicate",
        status=JOB_STATUS_SUCCEEDED,
        metadata={"content_reused": True, "chunk_count": 2},
    )
    repo = _CapturingProcessingRepo(reuse_result=reused_job)
    service = UserFileProcessingService(processing=repo, uow=_NoopUow())
    payload = b"%PDF-1.7\nidentical bytes"

    completed = await service.complete_claimed_job(
        claimed=_claimed_processing_job(file_id="file-duplicate"),
        payload=payload,
        parser=_UnexpectedParser(),
        embedder=_FailingEmbedder(),
        max_process_bytes=1024,
    )

    assert completed is reused_job
    assert repo.chunks == []
    assert repo.reuse_calls[0]["sha256"] == hashlib.sha256(payload).hexdigest()


@pytest.mark.asyncio
async def test_complete_claimed_job_force_bypasses_content_reuse() -> None:
    parsed = ParsedUserFileDocument(
        text="Forced processing content.",
        parser_name="docling",
        metadata={"parser": "docling"},
        chunks=[
            UserFileChunkDraft(
                chunk_index=0,
                text="Forced processing content.",
                char_count=26,
                token_estimate=7,
                metadata={"parser": "docling"},
            )
        ],
    )
    repo = _CapturingProcessingRepo()
    service = UserFileProcessingService(processing=repo, uow=_NoopUow())

    await service.complete_claimed_job(
        claimed=_claimed_processing_job(file_id="file-forced", force=True),
        payload=b"%PDF-1.7\nforced bytes",
        parser=_StaticParser(parsed),
        embedder=None,
        max_process_bytes=1024,
    )

    assert repo.reuse_calls == []
    assert len(repo.chunks) == 1


@pytest.mark.asyncio
async def test_complete_claimed_job_keeps_overview_when_embedding_fails() -> None:
    parsed = ParsedUserFileDocument(
        text="A durable overview remains available even when semantic embedding fails.",
        parser_name="docling",
        metadata={"parser": "docling", "extension": ".pdf"},
        chunks=[
            UserFileChunkDraft(
                chunk_index=0,
                text="Searchable display text",
                char_count=len("Searchable display text"),
                token_estimate=5,
                metadata={"parser": "docling"},
            )
        ],
        source_outline=(UserFileOutlineItem(level=1, title="Overview title"),),
    )
    repo = _CapturingProcessingRepo()
    service = UserFileProcessingService(processing=repo, uow=_NoopUow())

    await service.complete_claimed_job(
        claimed=_claimed_processing_job(file_id="file-embedding-failure"),
        payload=b"%PDF-1.7\nbody",
        parser=_StaticParser(parsed),
        embedder=_FailingEmbedder(),
        max_process_bytes=1024,
    )

    assert repo.file_status == STATUS_READY_KEYWORD_ONLY
    assert repo.file_metadata is not None
    assert repo.file_metadata["embedded"] is False
    assert repo.file_metadata_updates is not None
    assert repo.file_metadata_updates["overview"]["outline"] == [{"level": 1, "title": "Overview title"}]


@pytest.mark.asyncio
async def test_complete_claimed_job_uses_safe_overview_fallback_on_builder_failure(monkeypatch) -> None:
    parsed = ParsedUserFileDocument(
        text="Fallback source text remains safe and searchable.",
        parser_name="docling",
        metadata={"parser": "docling", "extension": ".pdf"},
        chunks=[
            UserFileChunkDraft(
                chunk_index=0,
                text="Fallback source text remains safe and searchable.",
                char_count=49,
                token_estimate=12,
                metadata={"parser": "docling"},
            )
        ],
    )
    repo = _CapturingProcessingRepo()
    service = UserFileProcessingService(processing=repo, uow=_NoopUow())

    def _fail_overview(**_kwargs):
        raise RuntimeError("overview exploded")

    monkeypatch.setattr(processing_service_module, "build_user_file_overview", _fail_overview)

    await service.complete_claimed_job(
        claimed=_claimed_processing_job(file_id="file-overview-failure"),
        payload=b"%PDF-1.7\nbody",
        parser=_StaticParser(parsed),
        embedder=None,
        max_process_bytes=1024,
    )

    assert repo.file_metadata is not None
    assert any("Overview generation failed" in warning for warning in repo.file_metadata["warnings"])
    assert repo.file_metadata_updates is not None
    assert repo.file_metadata_updates["overview"] == {
        "version": 1,
        "description": "Fallback source text remains safe and searchable.",
        "outline": [],
        "method": "fallback_excerpt",
        "outline_truncated": False,
    }


def test_chunking_uses_overlap_and_deterministic_indexes() -> None:
    parsed = ParsedUserFileDocument(
        text="First paragraph is long enough.\n\nSecond paragraph is also long enough.\n\nThird paragraph closes.",
        parser_name="test",
        metadata={"parser": "test"},
    )

    chunks = chunk_parsed_user_file_document(parsed, target_chars=45, overlap_chars=8)

    assert [chunk.chunk_index for chunk in chunks] == list(range(len(chunks)))
    assert len(chunks) > 1
    assert all(chunk.char_count == len(chunk.text) for chunk in chunks)


def test_chunking_groups_table_rows() -> None:
    parsed = parse_lightweight_user_file(
        payload=b"name\tvalue\nalpha\t1\nbeta\t2\ngamma\t3\n",
        filename="sheet.tsv",
        extension=".tsv",
    )

    chunks = chunk_parsed_user_file_document(parsed, target_chars=45, overlap_chars=0)

    assert chunks
    assert all(chunk.metadata["chunk_type"] == "table" for chunk in chunks)
    assert chunks[0].metadata["row_start"] == 1


def test_lightweight_parsers_validate_json_and_xml() -> None:
    parsed_json = parse_lightweight_user_file(payload=b'{"b": 2, "a": 1}', filename="data.json", extension=".json")
    parsed_xml = parse_lightweight_user_file(payload=b"<root><item /></root>", filename="data.xml", extension=".xml")

    assert '"a": 1' in parsed_json.text
    assert parsed_xml.text.startswith("<root>")


def test_docling_parser_normalizes_table_mode_and_threads() -> None:
    parser = DoclingUserFileParser(table_mode="accurate", num_threads=2)
    fallback = DoclingUserFileParser(table_mode="unexpected", num_threads=0)

    assert parser._table_mode == "accurate"
    assert parser._num_threads == 2
    assert fallback._table_mode == "fast"
    assert fallback._num_threads >= 1


@pytest.mark.asyncio
async def test_docling_parser_uses_converter_and_exports_metadata(monkeypatch) -> None:
    class _Label:
        def __init__(self, name: str) -> None:
            self.name = name

    class _Item:
        def __init__(self, label: str, text: str) -> None:
            self.label = _Label(label)
            self.text = text

    class _Doc:
        def export_to_markdown(self, compact_tables: bool = False) -> str:
            return "Converted markdown"

        def export_to_dict(self) -> dict[str, Any]:
            return {"texts": [{"text": "Converted markdown"}], "tables": []}

        def iterate_items(self):
            return [
                (_Item("TITLE", "Native paper title"), 1),
                (_Item("SECTION_HEADER", "Results"), 2),
                (_Item("TEXT", "Ignored body"), 2),
            ]

    class _Converter:
        def convert(self, path):
            assert str(path).endswith(".pdf")
            return SimpleNamespace(document=_Doc())

    parser = DoclingUserFileParser()
    monkeypatch.setattr(parser, "_make_converter", lambda: _Converter())

    parsed = await parser.parse(payload=b"%PDF-1.7\nbody", filename="paper.pdf", extension=".pdf")

    assert parsed.parser_name == "docling"
    assert parsed.text == "Converted markdown"
    assert parsed.metadata["docling"]["texts_count"] == 1
    assert parsed.source_outline == (
        UserFileOutlineItem(level=1, title="Native paper title"),
        UserFileOutlineItem(level=2, title="Results"),
    )


@pytest.mark.asyncio
async def test_docling_outline_failure_records_warning_and_keeps_markdown_fallback(monkeypatch) -> None:
    class _Doc:
        def export_to_markdown(self, compact_tables: bool = False) -> str:
            return "# Markdown title\n\nFallback prose."

        def export_to_dict(self) -> dict[str, Any]:
            return {"texts": [{"text": "Fallback prose."}]}

        def iterate_items(self):
            raise RuntimeError("tree unavailable")

    class _Converter:
        def convert(self, path):
            return SimpleNamespace(document=_Doc())

    parser = DoclingUserFileParser()
    monkeypatch.setattr(parser, "_make_converter", lambda: _Converter())

    parsed = await parser.parse(payload=b"%PDF-1.7\nbody", filename="paper.pdf", extension=".pdf")

    assert parsed.source_outline == ()
    assert parsed.source_outline_truncated is False
    assert any("Docling outline extraction failed" in warning for warning in parsed.metadata["warnings"])


@pytest.mark.asyncio
async def test_docling_parser_uses_hybrid_chunks_and_compacts_metadata(monkeypatch) -> None:
    class _Doc:
        def export_to_markdown(self, compact_tables: bool = False) -> str:
            return "Converted markdown"

        def export_to_dict(self) -> dict[str, Any]:
            return {"texts": [{"text": "Converted markdown"}], "tables": []}

    class _Converter:
        def convert(self, path):
            return SimpleNamespace(document=_Doc())

    class _Meta:
        def export_json_dict(self) -> dict[str, Any]:
            return {
                "headings": ["Section A"],
                "captions": ["Figure 1"],
                "origin": {
                    "filename": "paper.pdf",
                    "mimetype": "application/pdf",
                    "binary_hash": 123,
                    "uri": "file:///tmp/paper.pdf",
                },
                "doc_items": [
                    {
                        "self_ref": f"#/texts/{index}",
                        "label": "text",
                        "text": f"Item {index}",
                        "prov": [{"page_no": index + 1}],
                    }
                    for index in range(10)
                ],
            }

    class _Chunk:
        text = "Display text"
        meta = _Meta()

    class _Tokenizer:
        def count_tokens(self, *, text: str) -> int:
            assert text == "Section A\nDisplay text"
            return 42

    class _Chunker:
        tokenizer = _Tokenizer()

        def chunk(self, *, dl_doc):
            return [_Chunk()]

        def contextualize(self, chunk) -> str:
            return f"{chunk.meta.export_json_dict()['headings'][0]}\n{chunk.text}"

    def _fake_make_hybrid_chunker(*, max_tokens: int, tokenizer_model: str):
        assert max_tokens == 123
        assert tokenizer_model == "text-embedding-3-small"
        return _Chunker()

    parser = DoclingUserFileParser(chunk_max_tokens=123, tokenizer_model="text-embedding-3-small")
    monkeypatch.setattr(parser, "_make_converter", lambda: _Converter())
    monkeypatch.setattr(docling_parser_module, "_make_hybrid_chunker", _fake_make_hybrid_chunker)

    parsed = await parser.parse(payload=b"%PDF-1.7\nbody", filename="paper.pdf", extension=".pdf")

    assert parsed.chunks is not None
    assert len(parsed.chunks) == 1
    chunk = parsed.chunks[0]
    assert chunk.text == "Display text"
    assert chunk.embedding_text == "Section A\nDisplay text"
    assert chunk.token_estimate == 42
    assert chunk.metadata == {
        "parser": "docling",
        "chunker": "docling_hybrid",
        "headings": ["Section A"],
        "captions": ["Figure 1"],
        "origin": {
            "filename": "paper.pdf",
            "mimetype": "application/pdf",
            "binary_hash": 123,
            "uri": "file:///tmp/paper.pdf",
        },
        "doc_items": [
            {"self_ref": f"#/texts/{index}", "label": "text", "text": f"Item {index}", "page_no": index + 1}
            for index in range(8)
        ],
        "doc_item_count": 10,
        "token_count": 42,
    }


@pytest.mark.asyncio
async def test_docling_parser_falls_back_when_hybrid_chunker_fails(monkeypatch) -> None:
    class _Doc:
        def export_to_markdown(self, compact_tables: bool = False) -> str:
            return "Converted markdown"

        def export_to_dict(self) -> dict[str, Any]:
            return {"texts": [{"text": "Converted markdown"}]}

    class _Converter:
        def convert(self, path):
            return SimpleNamespace(document=_Doc())

    class _FailingChunker:
        def chunk(self, *, dl_doc):
            raise RuntimeError("chunking exploded")

    parser = DoclingUserFileParser()
    monkeypatch.setattr(parser, "_make_converter", lambda: _Converter())
    monkeypatch.setattr(docling_parser_module, "_make_hybrid_chunker", lambda **_kwargs: _FailingChunker())

    parsed = await parser.parse(payload=b"%PDF-1.7\nbody", filename="paper.pdf", extension=".pdf")

    assert parsed.text == "Converted markdown"
    assert parsed.chunks is None
    assert parsed.metadata["warnings"] == ["HybridChunker failed; using Markdown fallback chunking: chunking exploded"]


@pytest.mark.asyncio
async def test_docling_parser_rejects_bad_headers() -> None:
    parser = DoclingUserFileParser()

    with pytest.raises(DoclingUserFileParserError):
        await parser.parse(payload=b"not a pdf", filename="paper.pdf", extension=".pdf")


@pytest.mark.asyncio
async def test_hybrid_search_dedupes_with_rrf() -> None:
    service = UserFileProcessingService(processing=_HybridRepo(), uow=_NoopUow())

    response = await service.search(
        user_id="user-1",
        query="both",
        mode="hybrid",
        limit=5,
        embedder=_FakeEmbedder(),
    )

    assert [result.chunk_id for result in response.results] == ["chunk-b", "chunk-a"]
    assert response.results[0].match_type == "keyword+semantic"
