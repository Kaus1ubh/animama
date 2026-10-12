"""Shared model-facing navigation and read tools for user memory files."""

from __future__ import annotations

from collections.abc import Callable, Iterable
from dataclasses import dataclass
from typing import Any

from animama.domain.anima_definition import ANIMA_IDENTITY_PATH, ANIMA_MEMORIES_PATH
from animama.domain.memory_entry import (
    MEMORY_ENTRY_TYPE_FILE,
    MemoryEntry,
    MemoryEntryHeader,
    MemoryEntrySearchResult,
)

from .anima_identity_memory import (
    ANIMA_SELF_MEMORIES_ALIAS,
    ANIMA_SELF_MEMORIES_MISSING_MESSAGE,
    AnimaManagerPath,
    ManagerFileAccess,
    get_anima_file_or_none,
    is_anima_self_memories_alias,
    parse_anima_manager_path,
)
from .memory_entry_service import (
    MemoryEntryError,
    MemoryEntryNotFoundError,
    MemoryEntryService,
    MemoryEntryValidationError,
    is_protected_memory_entry,
    is_reserved_user_memory_path,
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
    # Set only for Anima files listed to Memory Manager.
    anima_name: str | None = None

    def to_payload(self) -> dict[str, str | None]:
        """Return the stable JSON-safe representation exposed to models."""

        payload: dict[str, str | None] = {"path": self.path, "description": self.description}
        if self.anima_name is not None:
            payload["anima_name"] = self.anima_name
        return payload


@dataclass(frozen=True, slots=True)
class _ReadTarget:
    """One resolved read path: the model-facing path plus where the file is stored.

    ``anima_file`` is set for Anima files, including the chat alias; user memory
    files leave it ``None``.
    """

    path: str
    dedupe_key: str
    anima_file: AnimaManagerPath | None = None
    is_self_memories: bool = False


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

    return render_memory_file_references(select_user_memory_file_references(entries))


def render_memory_file_references(references: Iterable[UserMemoryFileReference]) -> str:
    """Render content-free file references as the model-facing memory map."""

    references = tuple(references)
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
        if reference.anima_name is not None:
            lines.append(f"    anima: {_description_yaml_value(reference.anima_name)}")
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
    """Serve one shared list/read/search contract to every model runtime.

    ``manager_access`` is reserved for Memory Manager runs: it adds the Anima
    files the run may reach, at ``animas/<anima_id>/IDENTITY.md`` and
    ``animas/<anima_id>/MEMORIES.md``, to the list, map and reads. Normal chat
    keeps the user-only contract plus its own ``[self]/MEMORIES.md`` alias.
    """

    def __init__(
        self,
        *,
        memory_entries: MemoryEntryService,
        manager_access: ManagerFileAccess | None = None,
    ) -> None:
        self._memory_entries = memory_entries
        self._manager_access = manager_access

    async def list_files(self, *, user_id: str) -> dict[str, Any]:
        """List deterministic navigable user memory file references."""

        try:
            references = await self._list_file_references(user_id=user_id)
        except MemoryEntryError as exc:
            return _service_error(exc)
        return {"ok": True, "files": [reference.to_payload() for reference in references]}

    async def render_memory_map(self, *, user_id: str) -> str:
        """Render the same navigation projection used by ``list_files``."""

        return render_memory_file_references(await self.file_references(user_id=user_id))

    async def file_references(self, *, user_id: str) -> tuple[UserMemoryFileReference, ...]:
        """Return the navigable file references behind ``list_files`` and the memory map."""

        return await self._list_file_references(user_id=user_id)

    async def read_files(
        self,
        *,
        user_id: str,
        paths: object,
        native_patch_mode: bool = False,
        self_anima_id: str | None = None,
        on_self_memories_read: Callable[[MemoryEntry], None] | None = None,
    ) -> dict[str, Any]:
        """Read one or more files with ordered partial success and byte limits.

        ``self_anima_id`` lets a chat turn read its own Anima's ``MEMORIES.md``
        through the ``[self]/MEMORIES.md`` alias; without it the alias is an
        invalid path. ``on_self_memories_read`` observes each successful alias
        read so the caller can track which version the model has seen.
        """

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
                target = self._resolve_read_path(requested_path, self_anima_id=self_anima_id)
            except MemoryEntryValidationError as exc:
                errors.append(_path_error(requested_path, "invalid_path", exc.detail, retryable=False))
                continue
            if target.dedupe_key in seen_normalized_paths:
                continue
            seen_normalized_paths.add(target.dedupe_key)
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
                entry = await self._read_entry(user_id=user_id, target=target)
            except MemoryEntryNotFoundError:
                errors.append(
                    _path_error(
                        requested_path,
                        "not_found",
                        ANIMA_SELF_MEMORIES_MISSING_MESSAGE if target.is_self_memories else "Memory file not found",
                        retryable=not target.is_self_memories,
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
            if target.is_self_memories and on_self_memories_read is not None:
                on_self_memories_read(entry)
            files.append(
                {
                    "path": target.path if target.anima_file is not None else entry.path,
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
        references = select_user_memory_file_references(listing.entries)
        access = self._manager_access
        if access is None or not access.anima_files:
            return references
        summaries = await self._memory_entries.list_anima_identities(user_id=user_id)
        anima_references: list[UserMemoryFileReference] = []
        for summary in summaries:
            # Missing files are omitted; each Anima's identity precedes its MEMORIES.md.
            for filename, header in ((ANIMA_IDENTITY_PATH, summary.identity), (ANIMA_MEMORIES_PATH, summary.memories)):
                target = AnimaManagerPath(anima_id=summary.anima_id, filename=filename)
                if header is not None and access.allows(target):
                    anima_references.append(
                        UserMemoryFileReference(
                            path=target.path,
                            description=header.description,
                            anima_name=summary.display_name,
                        )
                    )
        return references + tuple(anima_references)

    def _resolve_read_path(self, path: str, *, self_anima_id: str | None) -> _ReadTarget:
        """Normalize a read path; Anima files resolve only when their caller enables them."""

        if self_anima_id is not None and is_anima_self_memories_alias(path):
            return _ReadTarget(
                path=ANIMA_SELF_MEMORIES_ALIAS,
                dedupe_key=ANIMA_SELF_MEMORIES_ALIAS.casefold(),
                anima_file=AnimaManagerPath(anima_id=self_anima_id, filename=ANIMA_MEMORIES_PATH),
                is_self_memories=True,
            )
        access = self._manager_access
        if access is not None and access.anima_files:
            anima_file = parse_anima_manager_path(path)
            if anima_file is not None:
                if not access.allows(anima_file):
                    raise MemoryEntryValidationError(access.denied_message(anima_file.path))
                return _ReadTarget(path=anima_file.path, dedupe_key=anima_file.path.casefold(), anima_file=anima_file)
        clean_path, normalized_path = _normalize_read_path(path)
        return _ReadTarget(path=clean_path, dedupe_key=normalized_path)

    async def _read_entry(self, *, user_id: str, target: _ReadTarget) -> MemoryEntry:
        if target.anima_file is None:
            return await self._memory_entries.get_entry_by_path(
                user_id=user_id,
                anima_id=None,
                path=target.path,
                type=MEMORY_ENTRY_TYPE_FILE,
            )
        entry = await get_anima_file_or_none(self._memory_entries, user_id=user_id, target=target.anima_file)
        if entry is None:
            raise MemoryEntryNotFoundError(f"Anima {target.anima_file.filename} not found")
        return entry


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
    if is_reserved_user_memory_path(clean_path):
        raise MemoryEntryValidationError(
            "Memory tools may only access current user-root files; animas/ is reserved for Anima files"
        )
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
    "render_memory_file_references",
    "render_user_memory_file_map",
    "search_user_memory_files",
    "select_user_memory_file_references",
]
