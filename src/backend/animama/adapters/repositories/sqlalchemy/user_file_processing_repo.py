"""SQLAlchemy repository for user-file processing jobs, chunks, and debug search."""

from __future__ import annotations

from copy import deepcopy
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import and_, delete, desc, func, or_, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from animama.app.ports.user_file_processing_port import UserFileProcessingRepository
from animama.domain.search_terms import WEB_SEARCH_CLAUSE_PATTERN, substring_pattern
from animama.domain.user_file import (
    STATUS_ABORTED,
    STATUS_DELETE_PENDING,
    STATUS_DELETED,
    STATUS_FAILED,
    STATUS_PROCESSING,
    STATUS_READY,
    STATUS_READY_KEYWORD_ONLY,
    UserFile,
)
from animama.domain.user_file_processing import (
    ACTIVE_PROCESSING_JOB_STATUSES,
    JOB_STATUS_FAILED,
    JOB_STATUS_QUEUED,
    JOB_STATUS_RUNNING,
    JOB_STATUS_SUCCEEDED,
    JOB_TYPE_PROCESS_FILE,
    ClaimedUserFileProcessingJob,
    UserFileChunkDraft,
    UserFileProcessingInfo,
    UserFileProcessingJob,
    UserFileProcessingJobSummary,
    UserFileReadableChunk,
    UserFileSearchResult,
)
from animama.orm.user_file import ORMUserFile
from animama.orm.user_file_chunk import ORMUserFileChunk
from animama.orm.user_file_processing_job import ORMUserFileProcessingJob

SEARCHABLE_FILE_STATUSES = (STATUS_READY, STATUS_READY_KEYWORD_ONLY)


def _utcnow() -> datetime:
    return datetime.now(UTC)


def _as_aware_utc(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


class SQLAlchemyUserFileProcessingRepository(UserFileProcessingRepository):
    """Persist user-file processing queues and chunks using async SQLAlchemy sessions."""

    def __init__(self, session: AsyncSession) -> None:
        self._s = session

    @staticmethod
    def _file_to_domain(obj: ORMUserFile) -> UserFile:
        return UserFile(
            id=obj.id,
            user_id=obj.user_id,
            storage_locator=obj.storage_locator,
            original_filename=obj.original_filename,
            normalized_extension=obj.normalized_extension,
            declared_content_type=obj.declared_content_type,
            detected_content_type=obj.detected_content_type,
            declared_size_bytes=obj.declared_size_bytes,
            stored_size_bytes=obj.stored_size_bytes,
            sha256=obj.sha256,
            status=obj.status,
            upload_expires_at=obj.upload_expires_at,
            processed_at=obj.processed_at,
            last_error=obj.last_error,
            metadata=dict(obj.metadata_ or {}),
            created_at=obj.created_at,
            updated_at=obj.updated_at,
        )

    @staticmethod
    def _job_to_domain(obj: ORMUserFileProcessingJob) -> UserFileProcessingJob:
        return UserFileProcessingJob(
            id=obj.id,
            file_id=obj.file_id,
            user_id=obj.user_id,
            job_type=obj.job_type,
            status=obj.status,
            attempts=obj.attempts,
            max_attempts=obj.max_attempts,
            run_after=obj.run_after,
            locked_by=obj.locked_by,
            locked_at=obj.locked_at,
            started_at=obj.started_at,
            finished_at=obj.finished_at,
            last_error=obj.last_error,
            metadata=dict(obj.metadata_ or {}),
            created_at=obj.created_at,
            updated_at=obj.updated_at,
        )

    @classmethod
    def _job_summary(cls, obj: ORMUserFileProcessingJob) -> UserFileProcessingJobSummary:
        return UserFileProcessingJobSummary(
            job_id=obj.id,
            status=obj.status,
            attempts=obj.attempts,
            max_attempts=obj.max_attempts,
            last_error=obj.last_error,
            run_after=obj.run_after,
            started_at=obj.started_at,
            finished_at=obj.finished_at,
            created_at=obj.created_at,
            updated_at=obj.updated_at,
        )

    async def get_user_file(self, *, user_id: str, file_id: str, include_deleted: bool = False) -> UserFile | None:
        stmt = select(ORMUserFile).where(ORMUserFile.id == file_id, ORMUserFile.user_id == user_id)
        if not include_deleted:
            stmt = stmt.where(ORMUserFile.status != STATUS_DELETED)
        result = await self._s.execute(stmt)
        obj = result.scalar_one_or_none()
        return self._file_to_domain(obj) if obj is not None else None

    async def list_processing_info(
        self,
        *,
        user_id: str,
        file_ids: list[str],
    ) -> dict[str, UserFileProcessingInfo]:
        if not file_ids:
            return {}

        counts_stmt = (
            select(ORMUserFileChunk.file_id, func.count(ORMUserFileChunk.id))
            .where(ORMUserFileChunk.user_id == user_id, ORMUserFileChunk.file_id.in_(file_ids))
            .group_by(ORMUserFileChunk.file_id)
        )
        counts_rows = await self._s.execute(counts_stmt)
        counts = {str(file_id): int(count) for file_id, count in counts_rows.all()}

        jobs_stmt = (
            select(ORMUserFileProcessingJob)
            .where(
                ORMUserFileProcessingJob.user_id == user_id,
                ORMUserFileProcessingJob.file_id.in_(file_ids),
            )
            .order_by(desc(ORMUserFileProcessingJob.created_at), desc(ORMUserFileProcessingJob.id))
        )
        jobs_rows = await self._s.execute(jobs_stmt)
        latest_jobs: dict[str, UserFileProcessingJobSummary] = {}
        for job in jobs_rows.scalars():
            latest_jobs.setdefault(job.file_id, self._job_summary(job))

        return {
            file_id: UserFileProcessingInfo(
                file_id=file_id,
                chunk_count=counts.get(file_id, 0),
                latest_job=latest_jobs.get(file_id),
            )
            for file_id in file_ids
        }

    async def count_chunks(self, *, user_id: str, file_id: str) -> int:
        stmt = select(func.count(ORMUserFileChunk.id)).where(
            ORMUserFileChunk.user_id == user_id,
            ORMUserFileChunk.file_id == file_id,
        )
        result = await self._s.execute(stmt)
        return int(result.scalar_one() or 0)

    async def read_chunks(
        self,
        *,
        user_id: str,
        file_id: str,
        start_chunk: int,
        limit: int,
    ) -> list[UserFileReadableChunk]:
        """Read bounded chunks while rechecking ownership and searchable status."""

        stmt = (
            select(ORMUserFileChunk.chunk_index, ORMUserFileChunk.text)
            .join(
                ORMUserFile,
                and_(
                    ORMUserFile.id == ORMUserFileChunk.file_id,
                    ORMUserFile.user_id == ORMUserFileChunk.user_id,
                ),
            )
            .where(
                ORMUserFileChunk.user_id == user_id,
                ORMUserFileChunk.file_id == file_id,
                ORMUserFileChunk.chunk_index >= max(0, start_chunk),
                ORMUserFile.user_id == user_id,
                ORMUserFile.status.in_(SEARCHABLE_FILE_STATUSES),
            )
            .order_by(ORMUserFileChunk.chunk_index)
            .limit(max(0, limit))
        )
        result = await self._s.execute(stmt)
        return [UserFileReadableChunk(chunk_index=chunk_index, text=text) for chunk_index, text in result.all()]

    async def get_reusable_job(self, *, user_id: str, file_id: str) -> UserFileProcessingJob | None:
        stmt = (
            select(ORMUserFileProcessingJob)
            .where(
                ORMUserFileProcessingJob.user_id == user_id,
                ORMUserFileProcessingJob.file_id == file_id,
                ORMUserFileProcessingJob.status.in_(ACTIVE_PROCESSING_JOB_STATUSES),
            )
            .order_by(desc(ORMUserFileProcessingJob.created_at), desc(ORMUserFileProcessingJob.id))
            .limit(1)
        )
        result = await self._s.execute(stmt)
        obj = result.scalar_one_or_none()
        return self._job_to_domain(obj) if obj is not None else None

    async def get_latest_job(self, *, user_id: str, file_id: str) -> UserFileProcessingJob | None:
        stmt = (
            select(ORMUserFileProcessingJob)
            .where(ORMUserFileProcessingJob.user_id == user_id, ORMUserFileProcessingJob.file_id == file_id)
            .order_by(desc(ORMUserFileProcessingJob.created_at), desc(ORMUserFileProcessingJob.id))
            .limit(1)
        )
        result = await self._s.execute(stmt)
        obj = result.scalar_one_or_none()
        return self._job_to_domain(obj) if obj is not None else None

    async def create_processing_job(
        self,
        *,
        job: UserFileProcessingJob,
        set_file_processing: bool = True,
    ) -> UserFileProcessingJob:
        obj = ORMUserFileProcessingJob(
            id=job.id,
            file_id=job.file_id,
            user_id=job.user_id,
            job_type=job.job_type,
            status=job.status,
            attempts=job.attempts,
            max_attempts=job.max_attempts,
            run_after=job.run_after or _utcnow(),
            locked_by=job.locked_by,
            locked_at=job.locked_at,
            started_at=job.started_at,
            finished_at=job.finished_at,
            last_error=job.last_error,
            metadata_=dict(job.metadata or {}),
        )
        self._s.add(obj)

        if set_file_processing:
            file_obj = await self._s.get(ORMUserFile, job.file_id)
            if file_obj is not None and file_obj.user_id == job.user_id:
                file_obj.status = STATUS_PROCESSING
                file_obj.last_error = None

        await self._s.flush()
        await self._s.refresh(obj)
        return self._job_to_domain(obj)

    async def claim_next_job(
        self,
        *,
        worker_id: str,
        lease_seconds: int,
        now: datetime,
        limit_file_id: str | None = None,
    ) -> ClaimedUserFileProcessingJob | None:
        lease_cutoff = now - timedelta(seconds=max(1, lease_seconds))
        stale_running = and_(
            ORMUserFileProcessingJob.status == JOB_STATUS_RUNNING,
            ORMUserFileProcessingJob.locked_at.is_not(None),
            ORMUserFileProcessingJob.locked_at <= lease_cutoff,
        )
        queued_ready = and_(
            ORMUserFileProcessingJob.status == JOB_STATUS_QUEUED,
            ORMUserFileProcessingJob.run_after <= now,
        )

        stmt = (
            select(ORMUserFileProcessingJob, ORMUserFile)
            .join(ORMUserFile, ORMUserFile.id == ORMUserFileProcessingJob.file_id)
            .where(
                ORMUserFileProcessingJob.job_type == JOB_TYPE_PROCESS_FILE,
                or_(queued_ready, stale_running),
                ORMUserFileProcessingJob.attempts < ORMUserFileProcessingJob.max_attempts,
                ORMUserFile.status.not_in([STATUS_ABORTED, STATUS_DELETED, STATUS_DELETE_PENDING]),
            )
            .order_by(ORMUserFileProcessingJob.run_after, ORMUserFileProcessingJob.created_at)
            .with_for_update(skip_locked=True, of=ORMUserFileProcessingJob)
            .limit(1)
        )
        if limit_file_id is not None:
            stmt = stmt.where(ORMUserFileProcessingJob.file_id == limit_file_id)

        result = await self._s.execute(stmt)
        row = result.first()
        if row is None:
            return None

        job_obj, file_obj = row
        job_obj.status = JOB_STATUS_RUNNING
        job_obj.locked_by = worker_id
        job_obj.locked_at = now
        job_obj.started_at = job_obj.started_at or now
        job_obj.finished_at = None
        job_obj.attempts += 1
        file_obj.status = STATUS_PROCESSING
        file_obj.last_error = None

        await self._s.flush()
        await self._s.refresh(job_obj)
        await self._s.refresh(file_obj)
        return ClaimedUserFileProcessingJob(
            job=self._job_to_domain(job_obj),
            storage_locator=file_obj.storage_locator,
            original_filename=file_obj.original_filename,
            normalized_extension=file_obj.normalized_extension,
            stored_size_bytes=file_obj.stored_size_bytes,
            declared_size_bytes=file_obj.declared_size_bytes,
        )

    async def replace_chunks_and_mark_success(
        self,
        *,
        job_id: str,
        user_id: str,
        file_id: str,
        sha256: str,
        chunks: list[UserFileChunkDraft],
        file_status: str,
        processing_metadata: dict[str, Any],
        file_metadata_updates: dict[str, Any] | None = None,
        processed_at: datetime,
        embedding_model_id: str | None = None,
    ) -> UserFileProcessingJob:
        job_obj = await self._s.get(ORMUserFileProcessingJob, job_id)
        file_obj = await self._s.get(ORMUserFile, file_id)
        if job_obj is None or job_obj.user_id != user_id or job_obj.file_id != file_id:
            raise ValueError(f"processing job not found: {job_id}")
        if file_obj is None or file_obj.user_id != user_id:
            raise ValueError(f"user file not found: {file_id}")

        await self._s.execute(delete(ORMUserFileChunk).where(ORMUserFileChunk.file_id == file_id))
        for chunk in sorted(chunks, key=lambda item: item.chunk_index):
            self._s.add(
                ORMUserFileChunk(
                    id=f"chunk-{file_id}-{chunk.chunk_index:06d}",
                    file_id=file_id,
                    user_id=user_id,
                    chunk_index=chunk.chunk_index,
                    text=chunk.text,
                    embedding_text=chunk.embedding_text if chunk.embedding_text != chunk.text else None,
                    embedding=chunk.embedding,
                    embedding_model_id=embedding_model_id if chunk.embedding is not None else None,
                    char_count=chunk.char_count,
                    token_estimate=chunk.token_estimate,
                    metadata_=dict(chunk.metadata),
                )
            )

        metadata_updates = dict(file_metadata_updates or {})
        if "processing" in metadata_updates:
            raise ValueError("file_metadata_updates cannot replace reserved processing metadata")
        metadata = {**dict(file_obj.metadata_ or {}), **metadata_updates}
        metadata["processing"] = dict(processing_metadata)
        metadata["processing"]["chunk_count"] = len(chunks)
        file_obj.status = file_status
        file_obj.sha256 = sha256
        file_obj.processed_at = processed_at
        file_obj.last_error = None
        file_obj.metadata_ = metadata

        job_metadata = dict(job_obj.metadata_ or {})
        job_metadata["chunk_count"] = len(chunks)
        job_metadata["file_status"] = file_status
        job_obj.status = JOB_STATUS_SUCCEEDED
        job_obj.finished_at = processed_at
        job_obj.locked_at = None
        job_obj.locked_by = None
        job_obj.last_error = None
        job_obj.metadata_ = job_metadata

        await self._s.flush()
        await self._s.refresh(job_obj)
        return self._job_to_domain(job_obj)

    async def reuse_processed_file(
        self,
        *,
        job_id: str,
        user_id: str,
        file_id: str,
        sha256: str,
        processed_at: datetime,
        embedding_model_id: str | None = None,
    ) -> UserFileProcessingJob | None:
        """Atomically clone a same-user digest match into the claimed target file.

        Vectors are copied only from ``embedding_model_id``; other chunks are
        left for re-embedding.
        """

        job_obj = await self._s.get(ORMUserFileProcessingJob, job_id)
        file_obj = await self._s.get(ORMUserFile, file_id)
        if job_obj is None or job_obj.user_id != user_id or job_obj.file_id != file_id:
            raise ValueError(f"processing job not found: {job_id}")
        if file_obj is None or file_obj.user_id != user_id:
            raise ValueError(f"user file not found: {file_id}")

        source_has_chunks = (
            select(ORMUserFileChunk.id)
            .where(
                ORMUserFileChunk.file_id == ORMUserFile.id,
                ORMUserFileChunk.user_id == user_id,
            )
            .exists()
        )
        source_stmt = (
            select(ORMUserFile)
            .where(
                ORMUserFile.user_id == user_id,
                ORMUserFile.id != file_id,
                ORMUserFile.sha256 == sha256,
                ORMUserFile.normalized_extension == file_obj.normalized_extension,
                ORMUserFile.status.in_(SEARCHABLE_FILE_STATUSES),
                source_has_chunks,
            )
            .order_by(desc(ORMUserFile.processed_at), desc(ORMUserFile.created_at), ORMUserFile.id)
            .limit(1)
        )
        source_file = (await self._s.execute(source_stmt)).scalar_one_or_none()
        if source_file is None:
            return None

        chunk_stmt = (
            select(ORMUserFileChunk)
            .where(
                ORMUserFileChunk.user_id == user_id,
                ORMUserFileChunk.file_id == source_file.id,
            )
            .order_by(ORMUserFileChunk.chunk_index)
        )
        source_chunks = list((await self._s.execute(chunk_stmt)).scalars())
        if not source_chunks:
            return None

        await self._s.execute(delete(ORMUserFileChunk).where(ORMUserFileChunk.file_id == file_id))
        for chunk in source_chunks:
            current_model = embedding_model_id is not None and chunk.embedding_model_id == embedding_model_id
            vector = chunk.embedding if current_model else None
            chunk_metadata = deepcopy(chunk.metadata_ or {})
            if "filename" in chunk_metadata:
                chunk_metadata["filename"] = file_obj.original_filename
            if "extension" in chunk_metadata:
                chunk_metadata["extension"] = file_obj.normalized_extension
            self._s.add(
                ORMUserFileChunk(
                    id=f"chunk-{file_id}-{chunk.chunk_index:06d}",
                    file_id=file_id,
                    user_id=user_id,
                    chunk_index=chunk.chunk_index,
                    text=chunk.text,
                    embedding_text=chunk.embedding_text,
                    embedding=list(vector) if vector is not None else None,
                    embedding_model_id=embedding_model_id if vector is not None else None,
                    char_count=chunk.char_count,
                    token_estimate=chunk.token_estimate,
                    metadata_=chunk_metadata,
                )
            )

        source_metadata = deepcopy(source_file.metadata_ or {})
        target_metadata = deepcopy(file_obj.metadata_ or {})
        if "overview" in source_metadata:
            target_metadata["overview"] = source_metadata["overview"]
        else:
            target_metadata.pop("overview", None)
        source_processing = source_metadata.get("processing")
        processing_metadata = deepcopy(source_processing) if isinstance(source_processing, dict) else {}
        parser_metadata = processing_metadata.get("parser_metadata")
        if isinstance(parser_metadata, dict):
            if "filename" in parser_metadata:
                parser_metadata["filename"] = file_obj.original_filename
            if "extension" in parser_metadata:
                parser_metadata["extension"] = file_obj.normalized_extension
        processing_metadata["content_reused"] = True
        processing_metadata["chunk_count"] = len(source_chunks)
        target_metadata["processing"] = processing_metadata

        file_obj.status = source_file.status
        file_obj.sha256 = sha256
        file_obj.processed_at = processed_at
        file_obj.last_error = None
        file_obj.metadata_ = target_metadata

        job_metadata = dict(job_obj.metadata_ or {})
        job_metadata["content_reused"] = True
        job_metadata["chunk_count"] = len(source_chunks)
        job_metadata["file_status"] = source_file.status
        job_obj.status = JOB_STATUS_SUCCEEDED
        job_obj.finished_at = processed_at
        job_obj.locked_at = None
        job_obj.locked_by = None
        job_obj.last_error = None
        job_obj.metadata_ = job_metadata

        await self._s.flush()
        await self._s.refresh(job_obj)
        return self._job_to_domain(job_obj)

    async def mark_job_failure(
        self,
        *,
        job_id: str,
        user_id: str,
        file_id: str,
        error: str,
        now: datetime,
        retry_delay_seconds: int,
    ) -> UserFileProcessingJob:
        job_obj = await self._s.get(ORMUserFileProcessingJob, job_id)
        file_obj = await self._s.get(ORMUserFile, file_id)
        if job_obj is None or job_obj.user_id != user_id or job_obj.file_id != file_id:
            raise ValueError(f"processing job not found: {job_id}")
        if file_obj is None or file_obj.user_id != user_id:
            raise ValueError(f"user file not found: {file_id}")

        concise_error = error[:500]
        job_obj.last_error = concise_error
        job_obj.locked_at = None
        job_obj.locked_by = None

        if job_obj.attempts >= job_obj.max_attempts:
            job_obj.status = JOB_STATUS_FAILED
            job_obj.finished_at = now
            file_obj.status = STATUS_FAILED
            file_obj.last_error = concise_error
        else:
            job_obj.status = JOB_STATUS_QUEUED
            job_obj.run_after = now + timedelta(seconds=max(1, retry_delay_seconds))
            file_obj.status = STATUS_PROCESSING
            file_obj.last_error = concise_error

        await self._s.flush()
        await self._s.refresh(job_obj)
        return self._job_to_domain(job_obj)

    async def delete_chunks_for_file(self, *, user_id: str, file_id: str) -> None:
        await self._s.execute(
            delete(ORMUserFileChunk).where(
                ORMUserFileChunk.user_id == user_id,
                ORMUserFileChunk.file_id == file_id,
            )
        )
        await self._s.flush()

    async def keyword_search(
        self,
        *,
        user_id: str,
        query: str,
        limit: int,
        file_ids: list[str] | None = None,
    ) -> list[UserFileSearchResult]:
        params: dict[str, Any] = {"user_id": user_id, "limit": limit}
        file_filter = _file_filter_sql(file_ids, params)
        text_filter = _keyword_text_filter_sql(query, params)
        stmt = text(f"""
            SELECT
                c.id AS chunk_id,
                c.file_id,
                c.chunk_index,
                c.text,
                c.metadata AS chunk_metadata,
                f.original_filename,
                f.normalized_extension,
                ts_rank_cd(
                    to_tsvector('english', c.text),
                    websearch_to_tsquery('english', :query)
                ) AS score
            FROM user_file_chunk c
            JOIN user_file f ON f.id = c.file_id AND f.user_id = c.user_id
            WHERE c.user_id = :user_id
                AND f.status IN ('ready', 'ready_keyword_only')
                {text_filter}
                {file_filter}
            ORDER BY score DESC, c.file_id, c.chunk_index
            LIMIT :limit
        """)
        rows = await self._s.execute(stmt, params)
        return [_search_row_to_domain(row, "keyword") for row in rows]

    async def semantic_search(
        self,
        *,
        user_id: str,
        embedding: list[float],
        embedding_model_id: str,
        limit: int,
        file_ids: list[str] | None = None,
    ) -> list[UserFileSearchResult]:
        params: dict[str, Any] = {
            "user_id": user_id,
            "query_embedding": str([float(value) for value in embedding]),
            "embedding_model_id": embedding_model_id,
            "limit": limit,
        }
        file_filter = _file_filter_sql(file_ids, params)
        stmt = text(f"""
            SELECT
                c.id AS chunk_id,
                c.file_id,
                c.chunk_index,
                c.text,
                c.metadata AS chunk_metadata,
                f.original_filename,
                f.normalized_extension,
                1 - (c.embedding <=> CAST(:query_embedding AS vector)) AS score
            FROM user_file_chunk c
            JOIN user_file f ON f.id = c.file_id AND f.user_id = c.user_id
            WHERE c.user_id = :user_id
                AND f.status IN ('ready', 'ready_keyword_only')
                AND c.embedding IS NOT NULL
                AND c.embedding_model_id = :embedding_model_id
                {file_filter}
            ORDER BY c.embedding <=> CAST(:query_embedding AS vector), c.file_id, c.chunk_index
            LIMIT :limit
        """)
        rows = await self._s.execute(stmt, params)
        return [_search_row_to_domain(row, "semantic") for row in rows]

    async def count_stale_chunks(
        self,
        *,
        user_id: str,
        embedding_model_id: str,
        file_ids: list[str] | None = None,
    ) -> int:
        params: dict[str, Any] = {"user_id": user_id, "embedding_model_id": embedding_model_id}
        file_filter = _file_filter_sql(file_ids, params)
        stmt = text(f"""
            SELECT count(*)
            FROM user_file_chunk c
            JOIN user_file f ON f.id = c.file_id AND f.user_id = c.user_id
            WHERE c.user_id = :user_id
                AND f.status IN ('ready', 'ready_keyword_only')
                AND c.embedding_model_id IS DISTINCT FROM :embedding_model_id
                {file_filter}
        """)
        return int((await self._s.execute(stmt, params)).scalar_one())


_KEYWORD_FULL_TEXT_SQL = "to_tsvector('english', c.text) @@ websearch_to_tsquery('english', :query)"


# A chunk containing every non-ASCII query word whose other words match too. Without other words, or with
# only stop words, their tsquery is empty and matches nothing, so it then adds no condition.
_KEYWORD_SUBSTRING_SQL = """(
                    c.text ILIKE ALL (CAST(:required_patterns AS text[]))
                    AND (
                        numnode(websearch_to_tsquery('english', :ascii_query)) = 0
                        OR to_tsvector('english', c.text) @@ websearch_to_tsquery('english', :ascii_query)
                    )
                )"""


def _keyword_text_filter_sql(query: str, params: dict[str, Any]) -> str:
    """Return the conditions matching chunk text to a web-search query, and bind its parameters.

    The whole query keeps its full-text match, so every chunk it found before
    still matches, across ``OR`` too. A word or phrase containing a non-ASCII
    letter or digit (see ``animama.domain.search_terms``) also matches as a
    substring: a chunk matches when it contains every such word and its other
    words match. A non-ASCII ``-term`` excludes chunks containing it.
    """

    params["query"] = query
    ascii_clauses: list[str] = []
    required: list[str] = []
    excluded: list[str] = []
    for clause in WEB_SEARCH_CLAUSE_PATTERN.findall(query):
        pattern = substring_pattern(clause)
        if pattern is None:
            ascii_clauses.append(clause)
        else:
            (excluded if clause.startswith("-") else required).append(pattern)
    if not required:
        conditions = [f"AND {_KEYWORD_FULL_TEXT_SQL}"]
    else:
        params["ascii_query"] = " ".join(ascii_clauses)
        params["required_patterns"] = required
        conditions = [f"AND ({_KEYWORD_FULL_TEXT_SQL} OR {_KEYWORD_SUBSTRING_SQL})"]
    if excluded:
        params["excluded_patterns"] = excluded
        conditions.append("AND NOT (c.text ILIKE ANY (CAST(:excluded_patterns AS text[])))")
    return "\n                ".join(conditions)


def _file_filter_sql(file_ids: list[str] | None, params: dict[str, Any]) -> str:
    if not file_ids:
        return ""
    names: list[str] = []
    for index, file_id in enumerate(file_ids):
        key = f"file_id_{index}"
        params[key] = file_id
        names.append(f":{key}")
    return f"AND c.file_id IN ({', '.join(names)})"


def _search_row_to_domain(row: Any, match_type: str) -> UserFileSearchResult:
    metadata = getattr(row, "chunk_metadata", None)
    if not isinstance(metadata, dict):
        metadata = {}
    score = getattr(row, "score", 0.0)
    return UserFileSearchResult(
        chunk_id=str(row.chunk_id),
        file_id=str(row.file_id),
        chunk_index=int(row.chunk_index),
        text=str(row.text),
        score=float(score or 0.0),
        metadata=dict(metadata),
        original_filename=str(row.original_filename),
        normalized_extension=str(row.normalized_extension),
        match_type=match_type,
    )


__all__ = ["SQLAlchemyUserFileProcessingRepository"]
