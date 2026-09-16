"""Shared model-facing navigation and read tools for user memory files."""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass
from typing import Any

from animama.domain.memory_entry import (
    MEMORY_ENTRY_TYPE_FILE,
    MemoryEntry,
    MemoryEntryHeader,
    MemoryEntrySearchResult,
)

from .memory_entry_service import (
    MemoryEntryError,
    MemoryEntryNotFoundError,
    MemoryEntryService,
    MemoryEntryValidationError,
    is_protected_memory_entry,
    normalize_memory_file_path,
)
from .memory_patch_document import render_memory_patch_document

DEFAULT_MEMORY_SEARCH_LIMIT = 10
DEFAULT_MEMORY_SEARCH_CONTEXT_CHARS = 500
MAX_MEMORY_READ_FILES = 10
MAX_MEMORY_READ_CONTENT_BYTES = 128 * 1024


@dataclass(frozen=True, slots=True)
class UserMemoryFileReference:
    """Content-free model-facing reference to one navigable memory file."""

    path: str
    description: str | None

    def to_payload(self) -> dict[str, str | None]:
        """Return the stable JSON-safe representation exposed to models."""

        return {"path": self.path, "description": self.description}


@dataclass(frozen=True, slots=True)
class UserMemorySearchResult:
    """Compact model/debug-facing result from user memory full-text search."""

    path: str
    description: str | None
    snippet: str

    def to_payload(self) -> dict[str, str | None]:
        """Return the stable JSON-safe result exposed to callers."""

        return {
            "path": self.path,
            "description": self.description,
            "snippet": self.snippet,
        }


def select_user_memory_file_references(
    entries: Iterable[MemoryEntry | MemoryEntryHeader],
) -> tuple[UserMemoryFileReference, ...]:
    """Select the deterministic user-root files exposed by maps and list tools."""

    references = [
        UserMemoryFileReference(path=entry.path, description=entry.description)
        for entry in entries
        if entry.anima_id is None and entry.type == MEMORY_ENTRY_TYPE_FILE and not is_protected_memory_entry(entry)
    ]
    references.sort(key=lambda item: item.path)
    return tuple(references)


def render_user_memory_file_map(entries: Iterable[MemoryEntry | MemoryEntryHeader]) -> str:
    """Render the canonical request-local, content-free user memory map."""

    references = select_user_memory_file_references(entries)
    lines = ["# List of memory files", ""]
    if not references:
        lines.append("files: []")
        return "\n".join(lines)
    lines.append("files:")
    for reference in references:
        lines.extend(
            (
                f"  - path: {reference.path}",
                f"    description: {_description_yaml_value(reference.description)}",
            )
        )
    return "\n".join(lines)


async def search_user_memory_files(
    *,
    user_id: str,
    query: str,
    memory_entries: MemoryEntryService,
    include_episodic_memory: bool = True,
    limit: int = DEFAULT_MEMORY_SEARCH_LIMIT,
    context_chars: int = DEFAULT_MEMORY_SEARCH_CONTEXT_CHARS,
) -> tuple[UserMemorySearchResult, ...]:
    """Search current-user markdown memory files and return compact hits."""

    hits = await memory_entries.search_files(
        user_id=user_id,
        anima_id=None,
        query=query,
        include_episodic_memory=include_episodic_memory,
        limit=limit,
        context_chars=context_chars,
    )
    return tuple(_search_result(hit) for hit in hits)


class UserMemoryReadToolService:
    """Serve one shared list/read/search contract to every model runtime."""

    def __init__(self, *, memory_entries: MemoryEntryService) -> None:
        self._memory_entries = memory_entries

    async def list_files(self, *, user_id: str) -> dict[str, Any]:
        """List deterministic navigable user memory file references."""

        try:
            references = await self._list_file_references(user_id=user_id)
        except MemoryEntryError as exc:
            return _service_error(exc)
        return {"ok": True, "files": [reference.to_payload() for reference in references]}

    async def render_memory_map(self, *, user_id: str) -> str:
        """Render the same navigation projection used by ``list_files``."""

        listing = await self._memory_entries.list_entry_headers(
            user_id=user_id,
            anima_id=None,
            recursive=True,
        )
        return render_user_memory_file_map(listing.entries)

    async def read_files(
        self,
        *,
        user_id: str,
        paths: object,
        native_patch_mode: bool = False,
    ) -> dict[str, Any]:
        """Read one or more files with ordered partial success and byte limits."""

        requested, request_error = _requested_paths(paths)
        if request_error is not None:
            return {"ok": False, "files": [], "errors": [request_error]}

        files: list[dict[str, str | None]] = []
        errors: list[dict[str, Any]] = []
        accepted_paths = 0
        returned_content_bytes = 0
        seen_normalized_paths: set[str] = set()
        for requested_path in requested:
            try:
                clean_path, normalized_path = _normalize_read_path(requested_path)
            except MemoryEntryValidationError as exc:
                errors.append(_path_error(requested_path, "invalid_path", exc.detail, retryable=False))
                continue
            if normalized_path in seen_normalized_paths:
                continue
            seen_normalized_paths.add(normalized_path)
            accepted_paths += 1
            if accepted_paths > MAX_MEMORY_READ_FILES:
                errors.append(
                    _path_error(
                        requested_path,
                        "path_limit_exceeded",
                        f"At most {MAX_MEMORY_READ_FILES} unique memory files may be read per call",
                        retryable=False,
                    )
                )
                continue

            try:
                entry = await self._memory_entries.get_entry_by_path(
                    user_id=user_id,
                    anima_id=None,
                    path=clean_path,
                    type=MEMORY_ENTRY_TYPE_FILE,
                )
            except MemoryEntryNotFoundError:
                errors.append(
                    _path_error(
                        requested_path,
                        "not_found",
                        "Memory file not found",
                        retryable=True,
                    )
                )
                continue
            except MemoryEntryError as exc:
                errors.append(
                    _path_error(
                        requested_path,
                        "memory_entry_error",
                        exc.detail,
                        retryable=True,
                    )
                )
                continue

            content = entry.content or ""
            content_bytes = len(content.encode("utf-8"))
            if returned_content_bytes + content_bytes > MAX_MEMORY_READ_CONTENT_BYTES:
                errors.append(
                    _path_error(
                        requested_path,
                        "content_limit_exceeded",
                        f"Reading this file would exceed the {MAX_MEMORY_READ_CONTENT_BYTES} byte response limit",
                        retryable=True,
                    )
                )
                continue
            returned_content_bytes += content_bytes
            files.append(
                {
                    "path": entry.path,
                    "description": entry.description,
                    "content": (
                        render_memory_patch_document(
                            description=entry.description,
                            content=content,
                        )
                        if native_patch_mode
                        else content
                    ),
                }
            )
        return {"ok": True, "files": files, "errors": errors}

    async def search_files(
        self,
        *,
        user_id: str,
        query: str,
        include_episodic_memory: bool = True,
    ) -> dict[str, Any]:
        """Search user-root memory files, optionally excluding episode logs."""

        try:
            hits = await search_user_memory_files(
                user_id=user_id,
                query=query,
                memory_entries=self._memory_entries,
                include_episodic_memory=include_episodic_memory,
            )
        except MemoryEntryError as exc:
            return _service_error(exc)
        return {
            "ok": True,
            "memory_results": [hit.to_payload() for hit in hits],
        }

    async def _list_file_references(self, *, user_id: str) -> tuple[UserMemoryFileReference, ...]:
        listing = await self._memory_entries.list_entry_headers(
            user_id=user_id,
            anima_id=None,
            recursive=True,
        )
        return select_user_memory_file_references(listing.entries)


def _requested_paths(paths: object) -> tuple[list[str], dict[str, Any] | None]:
    if isinstance(paths, str):
        return [paths], None
    if isinstance(paths, list) and paths and all(isinstance(path, str) for path in paths):
        return paths, None
    return [], {
        "path": None,
        "code": "invalid_paths",
        "message": "paths must be a string or a non-empty list of strings",
        "retryable": False,
    }


def _normalize_read_path(path: str) -> tuple[str, str]:
    clean_path, normalized_path = normalize_memory_file_path(path)
    first_segment = normalized_path.split("/", 1)[0]
    if first_segment == "animas":
        raise MemoryEntryValidationError("Memory tools may only access current user-root files")
    return clean_path, normalized_path


def _path_error(
    path: str,
    code: str,
    message: str,
    *,
    retryable: bool,
) -> dict[str, Any]:
    return {
        "path": path,
        "code": code,
        "message": message,
        "retryable": retryable,
    }


def _service_error(exc: MemoryEntryError) -> dict[str, Any]:
    return {
        "ok": False,
        "code": "invalid_request" if isinstance(exc, MemoryEntryValidationError) else "memory_entry_error",
        "message": exc.detail,
        "retryable": not isinstance(exc, MemoryEntryValidationError),
    }


def _description_yaml_value(description: str | None) -> str:
    if description is None:
        return '""'
    normalized = " ".join(description.split())
    return normalized or '""'


def _search_result(hit: MemoryEntrySearchResult) -> UserMemorySearchResult:
    return UserMemorySearchResult(
        path=hit.entry.path,
        description=hit.entry.description,
        snippet=hit.snippet,
    )


__all__ = [
    "DEFAULT_MEMORY_SEARCH_CONTEXT_CHARS",
    "DEFAULT_MEMORY_SEARCH_LIMIT",
    "MAX_MEMORY_READ_CONTENT_BYTES",
    "MAX_MEMORY_READ_FILES",
    "UserMemoryFileReference",
    "UserMemoryReadToolService",
    "UserMemorySearchResult",
    "render_user_memory_file_map",
    "search_user_memory_files",
    "select_user_memory_file_references",
]
