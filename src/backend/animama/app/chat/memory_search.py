from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from animama.app.ports.user_file_processing_port import UserFileProcessingRepository
from animama.app.services.user_file_processing_service import search_user_file_chunks
from animama.app.services.user_memory_read_tools import (
    DEFAULT_MEMORY_SEARCH_CONTEXT_CHARS,
    DEFAULT_MEMORY_SEARCH_LIMIT,
)
from animama.domain.search_terms import snippet_terms
from animama.domain.user_file import STATUS_READY, STATUS_READY_KEYWORD_ONLY, UserFile
from animama.domain.user_file_processing import SEARCH_MODE_HYBRID, UserFileSearchResult
from animama.logging import get_logger

_log = get_logger("app.chat.memory_search")


@dataclass(frozen=True, slots=True)
class UploadedFileSearchResult:
    """Model-facing uploaded-file chunk search result."""

    filename: str
    chunk_index: int
    snippet: str

    def to_payload(self) -> dict[str, str | int]:
        return {
            "filename": self.filename,
            "chunk_index": self.chunk_index,
            "snippet": self.snippet,
        }


@dataclass(frozen=True, slots=True)
class ValidatedAttachedUserFile:
    """Searchable current-user attachment plus its persisted chunk count."""

    user_file: UserFile
    chunk_count: int


async def search_uploaded_files(
    *,
    user_file_processing: UserFileProcessingRepository,
    user_id: str,
    query: str,
    uploaded_file_ids: tuple[str, ...] | list[str],
    user_file_embedder_factory: Callable[[], Any] | None,
    limit: int = DEFAULT_MEMORY_SEARCH_LIMIT,
    context_chars: int = DEFAULT_MEMORY_SEARCH_CONTEXT_CHARS,
) -> tuple[UploadedFileSearchResult, ...]:
    """Search attached processed upload chunks with hybrid retrieval and keyword fallback."""

    allowed_file_ids = tuple(dict.fromkeys(file_id for file_id in uploaded_file_ids if file_id))
    if not allowed_file_ids:
        return ()

    try:
        embedder = user_file_embedder_factory() if user_file_embedder_factory is not None else None
        search_results = await search_user_file_chunks(
            processing=user_file_processing,
            user_id=user_id,
            query=query,
            mode=SEARCH_MODE_HYBRID,
            limit=limit,
            file_ids=list(allowed_file_ids),
            embedder=embedder,
        )
    except Exception as exc:
        _log.warning(
            "Uploaded-file hybrid tool search failed; falling back to keyword",
            user_id=user_id,
            error=str(exc),
        )
        await _rollback_processing_after_search_failure(user_file_processing)
        uploaded_hits = await user_file_processing.keyword_search(
            user_id=user_id,
            query=query,
            limit=limit,
            file_ids=list(allowed_file_ids),
        )
        return tuple(_uploaded_file_result(hit, query=query, context_chars=context_chars) for hit in uploaded_hits)

    for warning in search_results.warnings:
        _log.warning(
            "Uploaded-file hybrid tool search degraded",
            user_id=user_id,
            warning=warning,
        )
    if search_results.mode != SEARCH_MODE_HYBRID:
        _log.warning(
            "Memory uploaded-file search returned unexpected mode",
            user_id=user_id,
            mode=search_results.mode,
        )
    return tuple(_uploaded_file_result(hit, query=query, context_chars=context_chars) for hit in search_results.results)


async def _rollback_processing_after_search_failure(user_file_processing: UserFileProcessingRepository) -> None:
    session = getattr(user_file_processing, "_s", None)
    rollback = getattr(session, "rollback", None)
    if rollback is not None:
        try:
            await rollback()
        except Exception as exc:
            _log.warning("Uploaded-file search rollback after semantic failure failed", error=str(exc))


async def validate_searchable_attached_files(
    *,
    user_file_processing: UserFileProcessingRepository,
    user_id: str,
    file_ids: tuple[str, ...] | list[str] | None,
) -> tuple[ValidatedAttachedUserFile, ...]:
    """Return attached current-user files whose processed chunks are searchable."""

    if not file_ids:
        return ()

    allowed: list[ValidatedAttachedUserFile] = []
    for file_id in dict.fromkeys(file_id.strip() for file_id in file_ids if isinstance(file_id, str)):
        if not file_id:
            continue
        user_file = await user_file_processing.get_user_file(user_id=user_id, file_id=file_id)
        if user_file is None:
            _log.info("Attached upload ignored because it is missing or not owned", user_id=user_id, file_id=file_id)
            continue
        if user_file.status not in {STATUS_READY, STATUS_READY_KEYWORD_ONLY}:
            _log.info(
                "Attached upload ignored because it is not searchable",
                user_id=user_id,
                file_id=file_id,
                status=user_file.status,
            )
            continue
        chunk_count = await user_file_processing.count_chunks(user_id=user_id, file_id=file_id)
        if chunk_count <= 0:
            _log.info(
                "Attached upload ignored because it has no chunks",
                user_id=user_id,
                file_id=file_id,
            )
            continue
        allowed.append(ValidatedAttachedUserFile(user_file=user_file, chunk_count=chunk_count))
    return tuple(allowed)


def _uploaded_file_result(
    hit: UserFileSearchResult,
    *,
    query: str,
    context_chars: int,
) -> UploadedFileSearchResult:
    return UploadedFileSearchResult(
        filename=hit.original_filename,
        chunk_index=hit.chunk_index,
        snippet=_snippet_for_query(hit.text, query, max_chars=max(80, int(context_chars))),
    )


def _snippet_for_query(value: str, query: str, *, max_chars: int) -> str:
    text_value = " ".join(value.split())
    if len(text_value) <= max_chars:
        return text_value

    terms = snippet_terms(query)
    lowered = text_value.lower()
    first_idx = -1
    for term in terms:
        idx = lowered.find(term)
        if idx >= 0 and (first_idx < 0 or idx < first_idx):
            first_idx = idx

    if first_idx < 0:
        return f"{text_value[: max_chars - 3].rstrip()}..."

    window_start = max(0, first_idx - max_chars // 3)
    window_end = min(len(text_value), window_start + max_chars)
    window_start = max(0, window_end - max_chars)
    snippet = text_value[window_start:window_end].strip()
    if window_start > 0:
        snippet = "..." + snippet
    if window_end < len(text_value):
        snippet = snippet.rstrip() + "..."
    return snippet


__all__ = [
    "DEFAULT_MEMORY_SEARCH_CONTEXT_CHARS",
    "DEFAULT_MEMORY_SEARCH_LIMIT",
    "UploadedFileSearchResult",
    "ValidatedAttachedUserFile",
    "search_uploaded_files",
    "validate_searchable_attached_files",
]
