"""Application service for user-file processing jobs, chunks, and debug search."""

from __future__ import annotations

import csv
import hashlib
import json
import math
import time
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import datetime, timezone
from io import StringIO
from typing import Any
from uuid import uuid4
from xml.etree import ElementTree

from animama.app.ports.uow_port import UnitOfWork
from animama.app.ports.user_file_parser_port import UserFileParser
from animama.app.ports.user_file_processing_port import UserFileProcessingRepository
from animama.app.services.user_file_overview import (
    build_user_file_overview,
    fallback_user_file_overview,
    serialize_user_file_overview,
)
from animama.domain.user_file import (
    STATUS_FAILED,
    STATUS_PENDING_UPLOAD,
    STATUS_PROCESSING,
    STATUS_READY,
    STATUS_READY_KEYWORD_ONLY,
    STATUS_UPLOADED,
)
from animama.domain.user_file_processing import (
    JOB_STATUS_SUCCEEDED,
    JOB_TYPE_PROCESS_FILE,
    SEARCH_MODE_HYBRID,
    SEARCH_MODE_KEYWORD,
    SEARCH_MODE_SEMANTIC,
    ClaimedUserFileProcessingJob,
    ParsedUserFileDocument,
    SearchMode,
    UserFileChunkDraft,
    UserFileProcessingInfo,
    UserFileProcessingJob,
    UserFileSearchResult,
)
from animama.logging import get_logger

PROCESSABLE_FILE_STATUSES = {
    STATUS_UPLOADED,
    STATUS_PROCESSING,
    STATUS_READY,
    STATUS_READY_KEYWORD_ONLY,
    STATUS_FAILED,
}

LIGHTWEIGHT_EXTENSIONS = frozenset({".txt", ".rst", ".org", ".json", ".tsv", ".xml"})
DEFAULT_TARGET_CHARS = 2500
DEFAULT_OVERLAP_CHARS = 250
RRF_K = 60


class UserFileProcessingServiceError(Exception):
    """Base error raised by user-file processing services."""

    def __init__(self, detail: str) -> None:
        super().__init__(detail)
        self.detail = detail


class UserFileProcessingValidationError(UserFileProcessingServiceError):
    """Raised when a processing or search request is invalid."""


class UserFileProcessingNotFoundError(UserFileProcessingServiceError):
    """Raised when a current-user processing target cannot be found."""


class UserFileProcessingConflictError(UserFileProcessingServiceError):
    """Raised when a file status does not allow the requested operation."""


class UserFileProcessingUnavailableError(UserFileProcessingServiceError):
    """Raised when semantic search dependencies are unavailable."""


@dataclass(frozen=True, slots=True)
class ProcessFileResult:
    """Response payload for enqueueing or reusing a processing job."""

    file_id: str
    job_id: str | None
    file_status: str
    job_status: str | None
    reused_existing_job: bool


@dataclass(frozen=True, slots=True)
class UserFileSearchResults:
    """Debug search results plus dependency warnings."""

    query: str
    mode: SearchMode
    results: list[UserFileSearchResult]
    warnings: list[str]


def new_user_file_processing_job_id() -> str:
    """Return an opaque user-file processing job identifier."""

    return f"job-{uuid4().hex}"


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def estimate_tokens(text: str) -> int:
    """Estimate token count without importing tokenizer dependencies."""

    stripped = text.strip()
    if not stripped:
        return 0
    return max(1, math.ceil(len(stripped) / 4))


def parse_lightweight_user_file(*, payload: bytes, filename: str, extension: str) -> ParsedUserFileDocument:
    """Parse simple formats with stdlib checks instead of invoking Docling."""

    text = _decode_text_payload(payload)
    normalized_extension = extension.lower()
    metadata: dict[str, Any] = {
        "parser": "stdlib",
        "filename": filename,
        "extension": normalized_extension,
    }

    if normalized_extension == ".json":
        try:
            parsed = json.loads(text)
        except json.JSONDecodeError as exc:
            raise UserFileProcessingValidationError(f"Invalid JSON document: {exc.msg}") from exc
        return ParsedUserFileDocument(
            text=json.dumps(parsed, indent=2, sort_keys=True, ensure_ascii=False),
            parser_name="stdlib-json",
            metadata={**metadata, "format": "json"},
        )

    if normalized_extension == ".xml":
        try:
            ElementTree.fromstring(text)
        except ElementTree.ParseError as exc:
            raise UserFileProcessingValidationError("Invalid XML document") from exc
        return ParsedUserFileDocument(
            text=text.strip(),
            parser_name="stdlib-xml",
            metadata={**metadata, "format": "xml"},
        )

    if normalized_extension == ".tsv":
        rows = list(csv.reader(StringIO(text), delimiter="\t"))
        table = _rows_to_markdown_table(rows)
        return ParsedUserFileDocument(
            text=table,
            parser_name="stdlib-tsv",
            metadata={**metadata, "format": "tsv", "table_only": True, "row_count": len(rows)},
            tables=[{"table_index": 0, "rows": rows, "source": "tsv"}],
        )

    return ParsedUserFileDocument(
        text=text.strip(),
        parser_name="stdlib-text",
        metadata={**metadata, "format": normalized_extension.lstrip(".") or "text"},
    )


def _decode_text_payload(payload: bytes) -> str:
    try:
        return payload.decode("utf-8")
    except UnicodeDecodeError:
        return payload.decode("utf-8", errors="replace")


def _rows_to_markdown_table(rows: list[list[str]]) -> str:
    if not rows:
        return ""
    width = max(len(row) for row in rows)
    normalized = [[cell.strip() for cell in row] + [""] * (width - len(row)) for row in rows]
    header = normalized[0]
    lines = [
        "| " + " | ".join(header) + " |",
        "| " + " | ".join("---" for _ in header) + " |",
    ]
    for row in normalized[1:]:
        lines.append("| " + " | ".join(row) + " |")
    return "\n".join(lines)


def chunk_parsed_user_file_document(
    document: ParsedUserFileDocument,
    *,
    target_chars: int = DEFAULT_TARGET_CHARS,
    overlap_chars: int = DEFAULT_OVERLAP_CHARS,
) -> list[UserFileChunkDraft]:
    """Split parsed text into deterministic prose or table-oriented chunks."""

    if document.metadata.get("table_only") and document.tables:
        table_chunks = _chunk_tables(document, target_chars=target_chars)
        if table_chunks:
            return table_chunks

    text = _normalize_chunk_text(document.text)
    if not text:
        return []

    chunks: list[UserFileChunkDraft] = []
    start = 0
    index = 0
    text_length = len(text)
    while start < text_length:
        end = min(text_length, start + target_chars)
        if end < text_length:
            boundary = text.rfind("\n\n", start + target_chars // 2, end)
            if boundary == -1:
                boundary = text.rfind("\n", start + target_chars // 2, end)
            if boundary != -1 and boundary > start:
                end = boundary
        chunk_text = text[start:end].strip()
        if chunk_text:
            chunks.append(_chunk_draft(index, chunk_text, {**document.metadata, "chunk_type": "prose"}))
            index += 1
        if end >= text_length:
            break
        next_start = max(end - overlap_chars, start + 1)
        start = next_start
    return chunks


def _chunk_tables(document: ParsedUserFileDocument, *, target_chars: int) -> list[UserFileChunkDraft]:
    chunks: list[UserFileChunkDraft] = []
    chunk_index = 0
    for table_index, table in enumerate(document.tables or []):
        rows = table.get("rows")
        if not isinstance(rows, list) or not rows:
            continue
        header = rows[0]
        body_rows = rows[1:] or []
        group: list[list[str]] = []
        row_start = 1
        for offset, row in enumerate(body_rows, start=1):
            candidate = [header, *group, row]
            candidate_text = _rows_to_markdown_table([[str(cell) for cell in r] for r in candidate])
            if group and len(candidate_text) > target_chars:
                chunk_text = _rows_to_markdown_table([[str(cell) for cell in r] for r in [header, *group]])
                chunks.append(
                    _chunk_draft(
                        chunk_index,
                        chunk_text,
                        {
                            **document.metadata,
                            "chunk_type": "table",
                            "table_index": table.get("table_index", table_index),
                            "row_start": row_start,
                            "row_end": offset - 1,
                        },
                    )
                )
                chunk_index += 1
                group = [row]
                row_start = offset
            else:
                group.append(row)
        if group or not body_rows:
            chunk_text = _rows_to_markdown_table([[str(cell) for cell in r] for r in [header, *group]])
            chunks.append(
                _chunk_draft(
                    chunk_index,
                    chunk_text,
                    {
                        **document.metadata,
                        "chunk_type": "table",
                        "table_index": table.get("table_index", table_index),
                        "row_start": row_start if body_rows else 0,
                        "row_end": row_start + len(group) - 1 if group else 0,
                    },
                )
            )
            chunk_index += 1
    return chunks


def _normalize_chunk_text(text: str) -> str:
    return "\n".join(line.rstrip() for line in text.replace("\r\n", "\n").replace("\r", "\n").split("\n")).strip()


def _chunk_draft(index: int, text: str, metadata: dict[str, Any]) -> UserFileChunkDraft:
    return UserFileChunkDraft(
        chunk_index=index,
        text=text,
        char_count=len(text),
        token_estimate=estimate_tokens(text),
        metadata=dict(metadata),
    )


class UserFileProcessingService:
    """Coordinate user-file processing queue, worker, and debug search use cases."""

    def __init__(
        self,
        *,
        processing: UserFileProcessingRepository,
        uow: UnitOfWork,
        max_attempts: int = 3,
        processing_enabled: bool = True,
    ) -> None:
        self._processing = processing
        self._uow = uow
        self._max_attempts = max(1, max_attempts)
        self._processing_enabled = processing_enabled
        self._log = get_logger("app.services.user_file_processing")

    async def list_processing_info(self, *, user_id: str, file_ids: list[str]) -> dict[str, UserFileProcessingInfo]:
        return await self._processing.list_processing_info(user_id=user_id, file_ids=file_ids)

    async def enqueue_processing_job(
        self,
        *,
        user_id: str,
        file_id: str,
        force: bool = False,
    ) -> ProcessFileResult:
        if not self._processing_enabled:
            raise UserFileProcessingConflictError("file_processing_unavailable")
        self._log.info("UserFileProcessingService.enqueue_processing_job", file_id=file_id, user_id=user_id)
        user_file = await self._processing.get_user_file(user_id=user_id, file_id=file_id)
        if user_file is None:
            raise UserFileProcessingNotFoundError("File not found")
        if user_file.status == STATUS_PENDING_UPLOAD:
            raise UserFileProcessingConflictError("File upload is not finalized")
        if user_file.status not in PROCESSABLE_FILE_STATUSES:
            raise UserFileProcessingConflictError("File cannot be processed in its current state")

        if not force:
            reusable = await self._processing.get_reusable_job(user_id=user_id, file_id=file_id)
            if reusable is not None:
                return ProcessFileResult(
                    file_id=file_id,
                    job_id=reusable.id,
                    file_status=user_file.status,
                    job_status=reusable.status,
                    reused_existing_job=True,
                )

            chunk_count = await self._processing.count_chunks(user_id=user_id, file_id=file_id)
            if user_file.status in {STATUS_READY, STATUS_READY_KEYWORD_ONLY} and chunk_count > 0:
                latest = await self._processing.get_latest_job(user_id=user_id, file_id=file_id)
                return ProcessFileResult(
                    file_id=file_id,
                    job_id=latest.id if latest is not None else None,
                    file_status=user_file.status,
                    job_status=latest.status if latest is not None else JOB_STATUS_SUCCEEDED,
                    reused_existing_job=latest is not None,
                )

        job = UserFileProcessingJob(
            id=new_user_file_processing_job_id(),
            user_id=user_id,
            file_id=file_id,
            job_type=JOB_TYPE_PROCESS_FILE,
            max_attempts=self._max_attempts,
            run_after=_utcnow(),
            metadata={"force": force},
        )
        created = await self._processing.create_processing_job(job=job, set_file_processing=True)
        await self._uow.commit()
        return ProcessFileResult(
            file_id=file_id,
            job_id=created.id,
            file_status=STATUS_PROCESSING,
            job_status=created.status,
            reused_existing_job=False,
        )

    async def claim_next_job(
        self,
        *,
        worker_id: str,
        lease_seconds: int,
        limit_file_id: str | None = None,
    ) -> ClaimedUserFileProcessingJob | None:
        claimed = await self._processing.claim_next_job(
            worker_id=worker_id,
            lease_seconds=lease_seconds,
            now=_utcnow(),
            limit_file_id=limit_file_id,
        )
        if claimed is not None:
            await self._uow.commit()
        return claimed

    async def complete_claimed_job(
        self,
        *,
        claimed: ClaimedUserFileProcessingJob,
        payload: bytes | None,
        parser: UserFileParser,
        embedder: Any | None,
        max_process_bytes: int,
    ) -> UserFileProcessingJob:
        if payload is None:
            raise UserFileProcessingValidationError("Uploaded file was not found in private local storage")
        if len(payload) <= 0:
            raise UserFileProcessingValidationError("Uploaded object is empty")
        if len(payload) > max_process_bytes:
            raise UserFileProcessingValidationError(f"Uploaded object exceeds the {max_process_bytes} byte limit")

        content_sha256 = hashlib.sha256(payload).hexdigest()
        force_processing = (claimed.job.metadata or {}).get("force") is True
        if not force_processing:
            reused = await self._processing.reuse_processed_file(
                job_id=claimed.job.id,
                user_id=claimed.job.user_id,
                file_id=claimed.job.file_id,
                sha256=content_sha256,
                processed_at=_utcnow(),
            )
            if reused is not None:
                self._log.info(
                    "User-file processed content reused",
                    job_id=claimed.job.id,
                    file_id=claimed.job.file_id,
                    user_id=claimed.job.user_id,
                )
                await self._uow.commit()
                return reused

        extension = claimed.normalized_extension.lower()
        parse_started = time.perf_counter()
        self._log.info(
            "User-file parsing started",
            job_id=claimed.job.id,
            file_id=claimed.job.file_id,
            user_id=claimed.job.user_id,
            extension=extension,
            byte_count=len(payload),
            parser="stdlib" if extension in LIGHTWEIGHT_EXTENSIONS else "docling",
        )
        if extension in LIGHTWEIGHT_EXTENSIONS:
            parsed = parse_lightweight_user_file(
                payload=payload,
                filename=claimed.original_filename,
                extension=extension,
            )
        else:
            parsed = await parser.parse(
                payload=payload,
                filename=claimed.original_filename,
                extension=extension,
            )
        self._log.info(
            "User-file parsing finished",
            job_id=claimed.job.id,
            file_id=claimed.job.file_id,
            user_id=claimed.job.user_id,
            parser=parsed.parser_name,
            text_chars=len(parsed.text),
            parser_chunk_count=len(parsed.chunks) if parsed.chunks is not None else None,
            duration_seconds=round(time.perf_counter() - parse_started, 3),
        )

        if parsed.chunks is not None:
            chunks = parsed.chunks
            self._log.info(
                "User-file parser-provided chunks selected",
                job_id=claimed.job.id,
                file_id=claimed.job.file_id,
                user_id=claimed.job.user_id,
                chunk_count=len(chunks),
            )
        else:
            chunk_started = time.perf_counter()
            self._log.info(
                "User-file fallback chunking started",
                job_id=claimed.job.id,
                file_id=claimed.job.file_id,
                user_id=claimed.job.user_id,
                parser=parsed.parser_name,
            )
            chunks = chunk_parsed_user_file_document(parsed)
            self._log.info(
                "User-file fallback chunking finished",
                job_id=claimed.job.id,
                file_id=claimed.job.file_id,
                user_id=claimed.job.user_id,
                chunk_count=len(chunks),
                duration_seconds=round(time.perf_counter() - chunk_started, 3),
            )
        if not chunks:
            raise UserFileProcessingValidationError("No searchable text was extracted from the uploaded file")

        overview_warning: str | None = None
        try:
            overview = build_user_file_overview(
                filename=claimed.original_filename,
                document=parsed,
                chunks=chunks,
            )
        except Exception as exc:
            message = str(exc).strip() or exc.__class__.__name__
            overview_warning = f"Overview generation failed; using safe fallback: {message[:300]}"
            self._log.warning(
                "User-file overview generation failed",
                job_id=claimed.job.id,
                file_id=claimed.job.file_id,
                user_id=claimed.job.user_id,
                error=message,
            )
            overview = fallback_user_file_overview(
                filename=claimed.original_filename,
                document=parsed,
                chunks=chunks,
            )

        embedding_warning: str | None = None
        embedded_chunks = chunks
        if embedder is not None:
            embedding_inputs = [chunk.embedding_text or chunk.text for chunk in chunks]
            embedding_started = time.perf_counter()
            self._log.info(
                "User-file embedding started",
                job_id=claimed.job.id,
                file_id=claimed.job.file_id,
                user_id=claimed.job.user_id,
                chunk_count=len(chunks),
                contextualized_chunk_count=sum(1 for chunk in chunks if chunk.embedding_text),
                input_chars=sum(len(text) for text in embedding_inputs),
            )
            try:
                vectors = await embedder.embed_texts(embedding_inputs)
                self._log.info(
                    "User-file embedding finished",
                    job_id=claimed.job.id,
                    file_id=claimed.job.file_id,
                    user_id=claimed.job.user_id,
                    chunk_count=len(chunks),
                    vector_count=len(vectors),
                    duration_seconds=round(time.perf_counter() - embedding_started, 3),
                )
                if len(vectors) == len(chunks):
                    embedded_chunks = [
                        UserFileChunkDraft(
                            chunk_index=chunk.chunk_index,
                            text=chunk.text,
                            char_count=chunk.char_count,
                            token_estimate=chunk.token_estimate,
                            metadata=chunk.metadata,
                            embedding_text=chunk.embedding_text,
                            embedding=vector,
                        )
                        for chunk, vector in zip(chunks, vectors, strict=True)
                    ]
                else:
                    embedding_warning = "Embedding provider returned an unexpected number of vectors"
            except Exception as exc:
                self._log.warning(
                    "User-file embedding failed",
                    job_id=claimed.job.id,
                    file_id=claimed.job.file_id,
                    user_id=claimed.job.user_id,
                    duration_seconds=round(time.perf_counter() - embedding_started, 3),
                    error=str(exc),
                )
                embedding_warning = f"Embedding failed: {exc}"
        else:
            embedding_warning = "Embedding provider unavailable"

        file_status = STATUS_READY if embedding_warning is None else STATUS_READY_KEYWORD_ONLY
        processing_warnings = [warning for warning in (embedding_warning, overview_warning) if warning]
        processing_metadata: dict[str, Any] = {
            "parser": parsed.parser_name,
            "source_extension": extension,
            "embedded": embedding_warning is None,
            "warnings": processing_warnings,
            "parser_metadata": parsed.metadata,
        }
        completed = await self._processing.replace_chunks_and_mark_success(
            job_id=claimed.job.id,
            user_id=claimed.job.user_id,
            file_id=claimed.job.file_id,
            sha256=content_sha256,
            chunks=embedded_chunks,
            file_status=file_status,
            processing_metadata=processing_metadata,
            file_metadata_updates={"overview": serialize_user_file_overview(overview)},
            processed_at=_utcnow(),
        )
        await self._uow.commit()
        return completed

    async def record_claimed_job_failure(
        self,
        *,
        claimed: ClaimedUserFileProcessingJob,
        error: str,
    ) -> UserFileProcessingJob:
        retry_delay = _retry_delay_seconds(claimed.job.attempts)
        updated = await self._processing.mark_job_failure(
            job_id=claimed.job.id,
            user_id=claimed.job.user_id,
            file_id=claimed.job.file_id,
            error=error,
            now=_utcnow(),
            retry_delay_seconds=retry_delay,
        )
        await self._uow.commit()
        return updated

    async def delete_chunks_for_file(self, *, user_id: str, file_id: str) -> None:
        await self._processing.delete_chunks_for_file(user_id=user_id, file_id=file_id)
        await self._uow.commit()

    async def search(
        self,
        *,
        user_id: str,
        query: str,
        mode: SearchMode,
        limit: int,
        file_ids: list[str] | None = None,
        embedder: Any | None = None,
    ) -> UserFileSearchResults:
        return await search_user_file_chunks(
            processing=self._processing,
            user_id=user_id,
            query=query,
            mode=mode,
            limit=limit,
            file_ids=file_ids,
            embedder=embedder,
        )

    async def _owned_file_filters(self, *, user_id: str, file_ids: list[str] | None) -> list[str] | None:
        return await _owned_file_filters(processing=self._processing, user_id=user_id, file_ids=file_ids)


async def search_user_file_chunks(
    *,
    processing: UserFileProcessingRepository,
    user_id: str,
    query: str,
    mode: SearchMode,
    limit: int,
    file_ids: list[str] | None = None,
    embedder: Any | None = None,
) -> UserFileSearchResults:
    """Search current-user processed upload chunks through the shared retrieval policy."""

    normalized_query = query.strip()
    if not normalized_query:
        raise UserFileProcessingValidationError("Search query is required")
    bounded_limit = min(max(1, limit), 50)
    filters = await _owned_file_filters(processing=processing, user_id=user_id, file_ids=file_ids)

    warnings: list[str] = []
    if mode == SEARCH_MODE_KEYWORD:
        results = await processing.keyword_search(
            user_id=user_id,
            query=normalized_query,
            limit=bounded_limit,
            file_ids=filters,
        )
        return UserFileSearchResults(query=normalized_query, mode=mode, results=results, warnings=warnings)

    if mode == SEARCH_MODE_SEMANTIC:
        embedding = await _embed_query(embedder, normalized_query)
        results = await processing.semantic_search(
            user_id=user_id,
            embedding=embedding,
            limit=bounded_limit,
            file_ids=filters,
        )
        return UserFileSearchResults(query=normalized_query, mode=mode, results=results, warnings=warnings)

    if mode != SEARCH_MODE_HYBRID:
        raise UserFileProcessingValidationError("Unsupported search mode")

    keyword_results = await processing.keyword_search(
        user_id=user_id,
        query=normalized_query,
        limit=bounded_limit * 2,
        file_ids=filters,
    )
    try:
        embedding = await _embed_query(embedder, normalized_query)
        semantic_results = await processing.semantic_search(
            user_id=user_id,
            embedding=embedding,
            limit=bounded_limit * 2,
            file_ids=filters,
        )
    except UserFileProcessingUnavailableError as exc:
        semantic_results = []
        warnings.append(exc.detail)

    fused = _reciprocal_rank_fusion(keyword_results, semantic_results, limit=bounded_limit)
    return UserFileSearchResults(query=normalized_query, mode=mode, results=fused, warnings=warnings)


async def _owned_file_filters(
    *,
    processing: UserFileProcessingRepository,
    user_id: str,
    file_ids: list[str] | None,
) -> list[str] | None:
    if not file_ids:
        return None
    owned: list[str] = []
    for file_id in dict.fromkeys(file_ids):
        user_file = await processing.get_user_file(user_id=user_id, file_id=file_id)
        if user_file is None:
            raise UserFileProcessingNotFoundError("File not found")
        owned.append(file_id)
    return owned


async def _embed_query(embedder: Any | None, query: str) -> list[float]:
    if embedder is None:
        raise UserFileProcessingUnavailableError("Semantic search embedding provider unavailable")
    try:
        vectors = await embedder.embed_texts([query])
    except Exception as exc:
        raise UserFileProcessingUnavailableError(f"Semantic search embedding failed: {exc}") from exc
    if not vectors or not vectors[0]:
        raise UserFileProcessingUnavailableError("Semantic search embedding returned no vector")
    return [float(value) for value in vectors[0]]


def _reciprocal_rank_fusion(
    keyword_results: Iterable[UserFileSearchResult],
    semantic_results: Iterable[UserFileSearchResult],
    *,
    limit: int,
) -> list[UserFileSearchResult]:
    by_id: dict[str, UserFileSearchResult] = {}
    scores: dict[str, float] = {}
    match_types: dict[str, set[str]] = {}
    for ranked_results, match_type in ((list(keyword_results), "keyword"), (list(semantic_results), "semantic")):
        for rank, result in enumerate(ranked_results, start=1):
            by_id.setdefault(result.chunk_id, result)
            scores[result.chunk_id] = scores.get(result.chunk_id, 0.0) + 1.0 / (RRF_K + rank)
            match_types.setdefault(result.chunk_id, set()).add(match_type)

    fused: list[UserFileSearchResult] = []
    for chunk_id, score in sorted(
        scores.items(),
        key=lambda item: (-item[1], by_id[item[0]].file_id, by_id[item[0]].chunk_index),
    ):
        result = by_id[chunk_id]
        fused.append(
            UserFileSearchResult(
                chunk_id=result.chunk_id,
                file_id=result.file_id,
                chunk_index=result.chunk_index,
                text=result.text,
                score=score,
                metadata=result.metadata,
                original_filename=result.original_filename,
                normalized_extension=result.normalized_extension,
                match_type="+".join(sorted(match_types[chunk_id])),
            )
        )
        if len(fused) >= limit:
            break
    return fused


def _retry_delay_seconds(attempts: int) -> int:
    return min(300, 2 ** max(0, attempts - 1))


__all__ = [
    "LIGHTWEIGHT_EXTENSIONS",
    "PROCESSABLE_FILE_STATUSES",
    "ProcessFileResult",
    "UserFileProcessingConflictError",
    "UserFileProcessingNotFoundError",
    "UserFileProcessingService",
    "UserFileProcessingServiceError",
    "UserFileProcessingUnavailableError",
    "UserFileProcessingValidationError",
    "UserFileSearchResults",
    "chunk_parsed_user_file_document",
    "estimate_tokens",
    "new_user_file_processing_job_id",
    "parse_lightweight_user_file",
    "search_user_file_chunks",
]
