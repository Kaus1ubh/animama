"""User-owned markdown memory entry tree service."""

from __future__ import annotations

import hashlib
import re
import uuid
from dataclasses import replace
from datetime import datetime
from typing import Any, NoReturn

from animama.domain.anima_definition import (
    ANIMA_IDENTITY_KIND,
    ANIMA_IDENTITY_PATH,
    AnimaDefinitionError,
    normalize_identity,
)
from animama.domain.memory_entry import (
    MEMORY_ENTRY_OPERATION_CREATE,
    MEMORY_ENTRY_OPERATION_DELETE,
    MEMORY_ENTRY_OPERATION_MOVE,
    MEMORY_ENTRY_OPERATION_REVERT,
    MEMORY_ENTRY_OPERATION_UNDO,
    MEMORY_ENTRY_OPERATION_UPDATE,
    MEMORY_ENTRY_TYPE_DIRECTORY,
    MEMORY_ENTRY_TYPE_FILE,
    MemoryEntry,
    MemoryEntryHeader,
    MemoryEntryHeaderListing,
    MemoryEntryListing,
    MemoryEntrySearchResult,
    MemoryEntryVersion,
    MemoryEntryVersionDetail,
    MemoryEntryVersionFieldChange,
    MemoryEntryVersionListing,
)
from animama.domain.memory_episode import MEMORY_EPISODE_LOG_ENTRY_KIND
from animama.logging import get_logger

from ..ports.anima_port import AnimaRepository
from ..ports.memory_entry_port import MemoryEntryRepository, MemoryEntryRepositoryConflictError
from ..ports.uow_port import UnitOfWork
from .memory_entry_diff import build_memory_unified_diff

MEMORY_ENTRY_DEFAULT_MAX_BYTES = 32 * 1024
MEMORY_ENTRY_MAX_PATH_CHARS = 512
MEMORY_ENTRY_MAX_NAME_CHARS = 128
MEMORY_ENTRY_EPISODES_ROOT_PATH = "episodes"
MEMORY_ENTRY_VERSION_DEFAULT_LIMIT = 50
MEMORY_ENTRY_VERSION_MAX_LIMIT = 100
_MEMORY_ENTRY_VERSION_CONSTRAINT = "uq_memory_entry_versions_entry_version"

_CONTROL_CHAR_RE = re.compile(r"[\x00-\x1f\x7f]")
_ENTRY_NAME_RE = re.compile(r"^[A-Za-z0-9._\-{}]+$")


class MemoryEntryError(Exception):
    """Base class for memory-entry service errors."""

    def __init__(self, detail: str) -> None:
        super().__init__(detail)
        self.detail = detail


class MemoryEntryValidationError(MemoryEntryError):
    """Raised when a path, name, payload, or request shape is invalid."""


class MemoryEntryNotFoundError(MemoryEntryError):
    """Raised when the current user has no live matching entry."""


class MemoryEntryConflictError(MemoryEntryError):
    """Raised when an optimistic version or namespace check fails."""


class MemoryEntryProtectedError(MemoryEntryError):
    """Raised when callers try to mutate generated or otherwise protected memory."""


class MemoryEntryConfigurationError(MemoryEntryError):
    """Raised when the service is missing collaborators needed for a scope."""


def new_memory_entry_id() -> str:
    """Return a durable ID for a memory entry lineage."""

    return f"mem-{uuid.uuid4()}"


def is_anima_identity(entry: MemoryEntry) -> bool:
    """The reserved path is authoritative even for an old, untyped seed."""

    return (
        entry.anima_id is not None
        and entry.type == MEMORY_ENTRY_TYPE_FILE
        and (entry.normalized_path == ANIMA_IDENTITY_PATH or entry.kind == ANIMA_IDENTITY_KIND)
    )


def normalize_memory_entry_name(name: str) -> tuple[str, str]:
    """Validate a stable POSIX path segment and return display/comparison names."""

    if not isinstance(name, str):
        raise MemoryEntryValidationError("Memory entry name must be a string")
    normalized = name.strip()
    if not normalized:
        raise MemoryEntryValidationError("Memory entry name is required")
    if normalized in {".", ".."}:
        raise MemoryEntryValidationError("Memory entry names cannot be . or ..")
    if len(normalized) > MEMORY_ENTRY_MAX_NAME_CHARS:
        raise MemoryEntryValidationError("Memory entry names are too long")
    if "/" in normalized or "\\" in normalized:
        raise MemoryEntryValidationError("Memory entry names cannot contain path separators")
    if _CONTROL_CHAR_RE.search(normalized):
        raise MemoryEntryValidationError("Memory entry names cannot contain control characters")
    if not _ENTRY_NAME_RE.fullmatch(normalized):
        raise MemoryEntryValidationError("Memory entry names may only use stable identifier characters")
    return normalized, normalized.casefold()


def normalize_memory_entry_path(path: str) -> tuple[str, str]:
    """Validate and normalize a relative POSIX memory entry path."""

    if not isinstance(path, str) or not path.strip():
        raise MemoryEntryValidationError("Memory entry path is required")
    raw = path.strip()
    if len(raw) > MEMORY_ENTRY_MAX_PATH_CHARS:
        raise MemoryEntryValidationError("Memory entry path is too long")
    if raw.startswith("/"):
        raise MemoryEntryValidationError("Memory entry paths must be relative")
    if "\\" in raw:
        raise MemoryEntryValidationError("Memory entry paths must use POSIX separators")
    if _CONTROL_CHAR_RE.search(raw):
        raise MemoryEntryValidationError("Memory entry paths cannot contain control characters")
    segments = raw.split("/")
    if any(segment == "" for segment in segments):
        raise MemoryEntryValidationError("Memory entry paths cannot contain empty segments")
    names = [normalize_memory_entry_name(segment)[0] for segment in segments]
    normalized_names = [normalize_memory_entry_name(segment)[1] for segment in segments]
    clean_path = "/".join(names)
    if len(clean_path) > MEMORY_ENTRY_MAX_PATH_CHARS:
        raise MemoryEntryValidationError("Memory entry path is too long")
    return clean_path, "/".join(normalized_names)


def normalize_memory_file_path(path: str) -> tuple[str, str]:
    """Validate a relative markdown file path."""

    clean_path, normalized_path = normalize_memory_entry_path(path)
    if not clean_path.endswith(".md"):
        raise MemoryEntryValidationError("Memory file entry paths must end with .md")
    return clean_path, normalized_path


def normalize_memory_directory_path(path: str | None) -> tuple[str, str]:
    """Validate an optional relative directory path."""

    if path is None or path == "":
        return "", ""
    clean_path, normalized_path = normalize_memory_entry_path(path)
    if clean_path.endswith(".md"):
        raise MemoryEntryValidationError("Memory directory paths cannot end with .md")
    return clean_path, normalized_path


def normalize_memory_entry_description(description: str | None) -> str | None:
    """Normalize optional memory-entry descriptions for storage."""

    if description is None:
        return None
    if not isinstance(description, str):
        raise MemoryEntryValidationError("Memory entry description must be a string")
    normalized = description.strip()
    return normalized or None


def is_protected_memory_entry(entry: MemoryEntry | MemoryEntryHeader) -> bool:
    """Return true when an entry is generated/system-managed memory."""

    return entry.kind == MEMORY_EPISODE_LOG_ENTRY_KIND or is_protected_memory_path(entry.path)


def is_protected_memory_path(path: str) -> bool:
    """Return true when a path is reserved for generated episodic memory."""

    try:
        _clean_path, normalized_path = normalize_memory_entry_path(path)
    except MemoryEntryValidationError:
        return False
    return normalized_path == MEMORY_ENTRY_EPISODES_ROOT_PATH or normalized_path.startswith(
        f"{MEMORY_ENTRY_EPISODES_ROOT_PATH}/"
    )


def is_protected_memory_kind(kind: str | None) -> bool:
    """Return true when an entry kind belongs to generated/system-managed memory."""

    return kind == MEMORY_EPISODE_LOG_ENTRY_KIND


def _content_hash_and_size(content: str, *, max_bytes: int) -> tuple[str, int]:
    if not isinstance(content, str):
        raise MemoryEntryValidationError("Memory file content must be a string")
    payload = content.encode("utf-8")
    size = len(payload)
    if size > max_bytes:
        raise MemoryEntryValidationError(f"Memory file content exceeds the {max_bytes} byte limit")
    return hashlib.sha256(payload).hexdigest(), size


def _version_from_entry(
    entry: MemoryEntry,
    *,
    operation: str,
    change_metadata: dict[str, Any] | None = None,
) -> MemoryEntryVersion:
    version_change_metadata = (
        dict(change_metadata) if change_metadata is not None else _known_change_metadata(entry.metadata)
    )
    return MemoryEntryVersion(
        id=None,
        entry_id=entry.id,
        user_id=entry.user_id,
        anima_id=entry.anima_id,
        parent_id=entry.parent_id,
        type=entry.type,
        name=entry.name,
        normalized_name=entry.normalized_name,
        path=entry.path,
        normalized_path=entry.normalized_path,
        version=entry.version,
        operation=operation,
        content=entry.content,
        content_sha256=entry.content_sha256,
        size_bytes=entry.size_bytes,
        kind=entry.kind,
        description=entry.description,
        metadata=dict(entry.metadata or {}),
        change_metadata=version_change_metadata,
        deleted_at=entry.deleted_at,
    )


def _known_change_metadata(metadata: dict[str, Any] | None) -> dict[str, Any]:
    """Project compact provenance from metadata already carried by established writers."""

    entry_metadata = dict(metadata or {})
    ai_write = entry_metadata.get("last_ai_write")
    if isinstance(ai_write, dict):
        allowed_keys = (
            "actor_type",
            "anima_id",
            "chat_id",
            "run_id",
            "provider",
            "model_provider_id",
            "model",
            "tool_name",
            "tool_type",
            "operation",
            "tool_call_id",
        )
        return {
            "source_type": "ai_write",
            **{key: ai_write[key] for key in allowed_keys if key in ai_write},
        }

    source = entry_metadata.get("source")
    if isinstance(source, dict) and isinstance(source.get("type"), str):
        return {
            "source_type": source["type"],
            **{key: source[key] for key in ("id", "avatar_id", "template_version") if key in source},
        }
    return {}


class MemoryEntryService:
    """CRUD service for the current user's scoped memory entry tree."""

    def __init__(
        self,
        *,
        memory_entries: MemoryEntryRepository,
        uow: UnitOfWork,
        animas: AnimaRepository | None = None,
        max_file_bytes: int = MEMORY_ENTRY_DEFAULT_MAX_BYTES,
        commit_on_write: bool = True,
    ) -> None:
        self._memory_entries = memory_entries
        self._uow = uow
        self._animas = animas
        self._max_file_bytes = max_file_bytes
        self._commit_on_write = commit_on_write
        self._log = get_logger("app.services.memory_entry")

    async def list_entries(
        self,
        *,
        user_id: str,
        anima_id: str | None = None,
        parent_id: str | None = None,
        recursive: bool = False,
    ) -> MemoryEntryListing:
        scope_anima_id = anima_id
        if parent_id is not None:
            parent = await self._memory_entries.get_entry(user_id=user_id, entry_id=parent_id)
            if parent is None:
                raise MemoryEntryNotFoundError("Memory entry parent not found")
            if parent.type != MEMORY_ENTRY_TYPE_DIRECTORY:
                raise MemoryEntryValidationError("Memory entry parent must be a directory")
            if anima_id is not None and parent.anima_id != anima_id:
                raise MemoryEntryValidationError("Memory entry parent scope does not match requested scope")
            scope_anima_id = parent.anima_id
        await self._require_anima_scope_owned(user_id=user_id, anima_id=scope_anima_id)
        entries = await self._memory_entries.list_entries(
            user_id=user_id,
            anima_id=scope_anima_id,
            parent_id=parent_id,
            recursive=recursive,
        )
        return MemoryEntryListing(parent_id=parent_id, recursive=recursive, entries=entries)

    async def list_entry_headers(
        self,
        *,
        user_id: str,
        anima_id: str | None = None,
        parent_id: str | None = None,
        recursive: bool = False,
    ) -> MemoryEntryHeaderListing:
        scope_anima_id = anima_id
        if parent_id is not None:
            parent = await self._memory_entries.get_entry(user_id=user_id, entry_id=parent_id)
            if parent is None:
                raise MemoryEntryNotFoundError("Memory entry parent not found")
            if parent.type != MEMORY_ENTRY_TYPE_DIRECTORY:
                raise MemoryEntryValidationError("Memory entry parent must be a directory")
            if anima_id is not None and parent.anima_id != anima_id:
                raise MemoryEntryValidationError("Memory entry parent scope does not match requested scope")
            scope_anima_id = parent.anima_id
        await self._require_anima_scope_owned(user_id=user_id, anima_id=scope_anima_id)
        entries = await self._memory_entries.list_entry_headers(
            user_id=user_id,
            anima_id=scope_anima_id,
            parent_id=parent_id,
            recursive=recursive,
        )
        return MemoryEntryHeaderListing(parent_id=parent_id, recursive=recursive, entries=entries)

    async def get_entry(self, *, user_id: str, entry_id: str) -> MemoryEntry:
        entry = await self._memory_entries.get_entry(user_id=user_id, entry_id=entry_id)
        if entry is None:
            raise MemoryEntryNotFoundError("Memory entry not found")
        await self._require_anima_scope_owned(user_id=user_id, anima_id=entry.anima_id)
        return await self._with_aggregate_revision(entry)

    async def list_versions(
        self,
        *,
        user_id: str,
        entry_id: str,
        before_version: int | None = None,
        limit: int = MEMORY_ENTRY_VERSION_DEFAULT_LIMIT,
    ) -> MemoryEntryVersionListing:
        """List an owned entry's immutable snapshots newest first."""

        await self._load_history_entry(user_id=user_id, entry_id=entry_id)
        if before_version is not None and before_version < 1:
            raise MemoryEntryValidationError("before_version must be at least 1")
        bounded_limit = min(MEMORY_ENTRY_VERSION_MAX_LIMIT, max(1, int(limit)))
        rows = await self._memory_entries.list_versions(
            user_id=user_id,
            entry_id=entry_id,
            before_version=before_version,
            limit=bounded_limit + 1,
        )
        versions = rows[:bounded_limit]
        next_before_version = versions[-1].version if len(rows) > bounded_limit else None
        return MemoryEntryVersionListing(
            entry_id=entry_id,
            versions=versions,
            next_before_version=next_before_version,
        )

    async def get_version_detail(
        self,
        *,
        user_id: str,
        entry_id: str,
        version: int,
    ) -> MemoryEntryVersionDetail:
        """Read Version N and compute only its Version N-1 adjacent changes."""

        await self._load_history_entry(user_id=user_id, entry_id=entry_id)
        if version < 1:
            raise MemoryEntryValidationError("Memory entry version must be at least 1")
        selected = await self._memory_entries.get_version(
            user_id=user_id,
            entry_id=entry_id,
            version=version,
        )
        if selected is None:
            raise MemoryEntryNotFoundError("Memory entry version not found")

        previous_version = version - 1
        previous: MemoryEntryVersion | None = None
        if previous_version > 0:
            previous = await self._memory_entries.get_version(
                user_id=user_id,
                entry_id=entry_id,
                version=previous_version,
            )
            if previous is None:
                raise MemoryEntryConflictError("Memory entry version history is incomplete")

        old_path = previous.path if previous is not None else None
        old_description = previous.description if previous is not None else None
        return MemoryEntryVersionDetail(
            entry=selected,
            previous_version=previous_version,
            unified_diff=build_memory_unified_diff(
                old_path=old_path,
                new_path=selected.path,
                old_content=previous.content if previous is not None else None,
                new_content=selected.content,
            ),
            path_change=(
                MemoryEntryVersionFieldChange(old=old_path, new=selected.path) if old_path != selected.path else None
            ),
            description_change=(
                MemoryEntryVersionFieldChange(old=old_description, new=selected.description)
                if old_description != selected.description
                else None
            ),
        )

    async def get_entry_by_path(
        self,
        *,
        user_id: str,
        anima_id: str | None = None,
        path: str,
        type: str | None = MEMORY_ENTRY_TYPE_FILE,
    ) -> MemoryEntry:
        await self._require_anima_scope_owned(user_id=user_id, anima_id=anima_id)
        normalized_path = self._normalize_lookup_path(path, type=type)
        entry = await self._memory_entries.get_entry_by_path(
            user_id=user_id,
            anima_id=anima_id,
            normalized_path=normalized_path,
            type=type,
        )
        if entry is None:
            raise MemoryEntryNotFoundError("Memory entry not found")
        return await self._with_aggregate_revision(entry)

    async def search_files(
        self,
        *,
        user_id: str,
        anima_id: str | None = None,
        query: str,
        path_prefix: str | None = None,
        include_episodic_memory: bool = True,
        limit: int = 10,
        context_chars: int = 500,
    ) -> list[MemoryEntrySearchResult]:
        if not isinstance(query, str) or not query.strip():
            raise MemoryEntryValidationError("Search query is required")
        if not isinstance(include_episodic_memory, bool):
            raise MemoryEntryValidationError("include_episodic_memory must be a boolean")
        await self._require_anima_scope_owned(user_id=user_id, anima_id=anima_id)
        normalized_prefix: str | None = None
        if path_prefix:
            clean_prefix, normalized = normalize_memory_entry_path(path_prefix)
            normalized_prefix = normalized if clean_prefix.endswith("/") else f"{normalized}/"
        bounded_limit = min(50, max(1, int(limit)))
        bounded_context = min(1000, max(80, int(context_chars)))
        return await self._memory_entries.search_files(
            user_id=user_id,
            anima_id=anima_id,
            query=query.strip(),
            normalized_path_prefix=normalized_prefix,
            include_episodic_memory=include_episodic_memory,
            limit=bounded_limit,
            context_chars=bounded_context,
        )

    async def create_entry(
        self,
        *,
        user_id: str,
        anima_id: str | None = None,
        parent_id: str | None = None,
        type: str,
        name: str,
        content: str | None = None,
        kind: str | None = None,
        description: str | None = None,
        metadata: dict[str, Any] | None = None,
        change_metadata: dict[str, Any] | None = None,
        expected_version: int | None = 0,
        expected_aggregate_revision: int | None = None,
        create_parents: bool = False,
        allow_system_managed: bool = False,
    ) -> MemoryEntry:
        if create_parents:
            if type != MEMORY_ENTRY_TYPE_FILE:
                raise MemoryEntryValidationError("Missing parent directories can only be created for file entries")
            relative_path, _normalized_relative_path = normalize_memory_file_path(name)
            parent = await self._load_create_parent(
                user_id=user_id,
                parent_id=parent_id,
                anima_id=anima_id,
            )
            scope_anima_id = parent.anima_id if parent is not None else anima_id
            target_path = f"{parent.path}/{relative_path}" if parent is not None else relative_path
            return await self.put_file_by_path(
                user_id=user_id,
                anima_id=scope_anima_id,
                path=target_path,
                content=content,
                kind=kind,
                description=description,
                metadata=metadata,
                change_metadata=change_metadata,
                expected_version=expected_version,
                expected_aggregate_revision=expected_aggregate_revision,
                create_parents=True,
                allow_system_managed=allow_system_managed,
            )

        try:
            if expected_version not in (None, 0):
                raise MemoryEntryConflictError("Memory entry does not exist at the expected version")
            parent = await self._load_create_parent(user_id=user_id, parent_id=parent_id, anima_id=anima_id)
            scope_anima_id = parent.anima_id if parent is not None else anima_id
            await self._require_anima_scope_owned(user_id=user_id, anima_id=scope_anima_id)
            clean_name, _normalized_name = normalize_memory_entry_name(name)
            target_path = f"{parent.path}/{clean_name}" if parent is not None else clean_name
            await self._lock_identity_scope(
                user_id=user_id,
                anima_id=scope_anima_id,
                path=target_path,
                expected_revision=expected_aggregate_revision,
            )
            if not allow_system_managed:
                self._require_unprotected_new_entry(path=target_path, kind=kind)
            stored = await self._create_entry(
                user_id=user_id,
                anima_id=scope_anima_id,
                parent=parent,
                type=type,
                name=name,
                content=content,
                kind=kind,
                description=description,
                metadata=metadata,
                change_metadata=change_metadata,
            )
            await self._record_identity_change(stored, expected_aggregate_revision, reason="identity_repair")
            await self._commit_if_enabled()
        except MemoryEntryRepositoryConflictError as exc:
            await self._raise_repository_conflict(exc)
        except Exception:
            await self._rollback_if_enabled()
            raise
        self._log.info("MemoryEntryService.create_entry.created", user_id=user_id, entry_id=stored.id)
        return stored

    async def put_file_by_path(
        self,
        *,
        user_id: str,
        anima_id: str | None = None,
        path: str,
        content: str,
        kind: str | None = None,
        description: str | None = None,
        metadata: dict[str, Any] | None = None,
        change_metadata: dict[str, Any] | None = None,
        expected_version: int | None = None,
        expected_aggregate_revision: int | None = None,
        create_parents: bool = False,
        allow_system_managed: bool = False,
    ) -> MemoryEntry:
        try:
            clean_path, normalized_path = normalize_memory_file_path(path)
            await self._require_anima_scope_owned(user_id=user_id, anima_id=anima_id)
            await self._lock_identity_scope(
                user_id=user_id,
                anima_id=anima_id,
                path=normalized_path,
                expected_revision=expected_aggregate_revision,
            )
            current = await self._memory_entries.get_entry_by_path_for_update(
                user_id=user_id,
                anima_id=anima_id,
                normalized_path=normalized_path,
                type=MEMORY_ENTRY_TYPE_FILE,
            )
            if current is not None:
                if not allow_system_managed:
                    self._require_unprotected_existing_entry(current)
                    if is_protected_memory_kind(kind):
                        raise MemoryEntryProtectedError("Generated episode logs are read-only")
                self._require_expected_version(current=current, expected_version=expected_version)
                stored = await self._update_file_entry(
                    current=current,
                    content=content,
                    kind=kind,
                    kind_set=kind is not None or not is_anima_identity(current),
                    description=description,
                    description_set=True,
                    metadata=metadata,
                    metadata_set=True,
                    operation=MEMORY_ENTRY_OPERATION_UPDATE,
                    change_metadata=change_metadata,
                )
                await self._record_identity_change(stored, expected_aggregate_revision, reason="identity_update")
                await self._commit_if_enabled()
                self._log.info("MemoryEntryService.put_file_by_path.updated", user_id=user_id, path=clean_path)
                return stored

            if expected_version not in (None, 0):
                raise MemoryEntryConflictError("Memory entry does not exist at the expected version")
            if not allow_system_managed:
                self._require_unprotected_new_entry(path=clean_path, kind=kind)
            parts = clean_path.split("/")
            parent = None
            if len(parts) > 1:
                if not create_parents:
                    raise MemoryEntryNotFoundError("Memory entry parent not found")
                parent = await self._ensure_directory_path(
                    user_id=user_id,
                    anima_id=anima_id,
                    directory_path="/".join(parts[:-1]),
                    change_metadata=change_metadata,
                )
            stored = await self._create_entry(
                user_id=user_id,
                anima_id=anima_id,
                parent=parent,
                type=MEMORY_ENTRY_TYPE_FILE,
                name=parts[-1],
                content=content,
                kind=kind,
                description=description,
                metadata=metadata,
                change_metadata=change_metadata,
            )
            await self._record_identity_change(stored, expected_aggregate_revision, reason="identity_repair")
            await self._commit_if_enabled()
        except MemoryEntryRepositoryConflictError as exc:
            await self._raise_repository_conflict(exc)
        except Exception:
            await self._rollback_if_enabled()
            raise
        self._log.info("MemoryEntryService.put_file_by_path.created", user_id=user_id, path=clean_path)
        return stored

    async def patch_entry(
        self,
        *,
        user_id: str,
        entry_id: str,
        expected_version: int | None,
        expected_aggregate_revision: int | None = None,
        content: str | None = None,
        content_set: bool = False,
        kind: str | None = None,
        kind_set: bool = False,
        description: str | None = None,
        description_set: bool = False,
        metadata: dict[str, Any] | None = None,
        metadata_set: bool = False,
        change_metadata: dict[str, Any] | None = None,
        name: str | None = None,
        name_set: bool = False,
        parent_id: str | None = None,
        parent_id_set: bool = False,
        allow_system_managed: bool = False,
    ) -> MemoryEntry:
        move_requested = name_set or parent_id_set
        edit_requested = content_set or kind_set or description_set or metadata_set
        if not move_requested and not edit_requested:
            raise MemoryEntryValidationError("Patch must include edit or move fields")
        if move_requested and edit_requested:
            raise MemoryEntryValidationError("Patch cannot mix move or rename fields with file or metadata edits")

        try:
            await self._lock_identity_entry(
                user_id=user_id,
                entry_id=entry_id,
                expected_revision=expected_aggregate_revision,
            )
            current = await self._memory_entries.get_entry_for_update(user_id=user_id, entry_id=entry_id)
            if current is None:
                raise MemoryEntryNotFoundError("Memory entry not found")
            await self._require_anima_scope_owned(user_id=user_id, anima_id=current.anima_id)
            if not allow_system_managed:
                self._require_unprotected_existing_entry(current)
            self._require_expected_version(current=current, expected_version=expected_version)

            if move_requested:
                self._require_not_identity(current)
                stored = await self._move_entry(
                    current=current,
                    name=name,
                    name_set=name_set,
                    parent_id=parent_id,
                    parent_id_set=parent_id_set,
                    allow_system_managed=allow_system_managed,
                    change_metadata=change_metadata,
                )
            else:
                if not allow_system_managed and is_protected_memory_kind(kind if kind_set else current.kind):
                    raise MemoryEntryProtectedError("Generated episode logs are read-only")
                stored = await self._update_file_entry(
                    current=current,
                    content=content,
                    kind=kind,
                    kind_set=kind_set,
                    description=description,
                    description_set=description_set,
                    metadata=metadata,
                    metadata_set=metadata_set,
                    operation=MEMORY_ENTRY_OPERATION_UPDATE,
                    content_set=content_set,
                    change_metadata=change_metadata,
                )
            await self._record_identity_change(stored, expected_aggregate_revision, reason="identity_update")
            await self._commit_if_enabled()
        except MemoryEntryRepositoryConflictError as exc:
            await self._raise_repository_conflict(exc)
        except Exception:
            await self._rollback_if_enabled()
            raise
        self._log.info("MemoryEntryService.patch_entry.updated", user_id=user_id, entry_id=entry_id)
        return stored

    async def delete_entry(
        self,
        *,
        user_id: str,
        entry_id: str,
        expected_version: int | None,
        recursive: bool = False,
        allow_system_managed: bool = False,
        change_metadata: dict[str, Any] | None = None,
    ) -> None:
        try:
            current = await self._memory_entries.get_entry_for_update(user_id=user_id, entry_id=entry_id)
            if current is None:
                raise MemoryEntryNotFoundError("Memory entry not found")
            await self._require_anima_scope_owned(user_id=user_id, anima_id=current.anima_id)
            self._require_not_identity(current)
            if not allow_system_managed:
                self._require_unprotected_existing_entry(current)
            self._require_expected_version(current=current, expected_version=expected_version)

            if current.type == MEMORY_ENTRY_TYPE_DIRECTORY:
                has_descendants = await self._memory_entries.has_live_descendant(user_id=user_id, entry=current)
                if has_descendants and not recursive:
                    raise MemoryEntryConflictError("Directory is not empty")

            deleted_at = datetime.utcnow()
            deleted = replace(current, version=current.version + 1, deleted_at=deleted_at)
            stored = await self._memory_entries.update_entry(deleted)
            await self._memory_entries.append_version(
                _version_from_entry(
                    stored,
                    operation=MEMORY_ENTRY_OPERATION_DELETE,
                    change_metadata=change_metadata,
                )
            )
            if current.type == MEMORY_ENTRY_TYPE_DIRECTORY and recursive:
                await self._memory_entries.soft_delete_live_descendants(
                    user_id=user_id,
                    entry=current,
                    deleted_at=deleted_at,
                )
            await self._commit_if_enabled()
        except MemoryEntryRepositoryConflictError as exc:
            await self._raise_repository_conflict(exc)
        self._log.info("MemoryEntryService.delete_entry.deleted", user_id=user_id, entry_id=entry_id)

    async def undo_approved_update(
        self,
        *,
        user_id: str,
        entry_id: str,
        expected_version: int,
        old_content: str,
        old_description: str | None,
        change_metadata: dict[str, Any],
    ) -> MemoryEntry:
        """Restore one approved update's prior content and description."""

        try:
            current = await self._memory_entries.get_entry_for_update(
                user_id=user_id,
                entry_id=entry_id,
                include_deleted=True,
            )
            if current is None:
                raise MemoryEntryNotFoundError("Memory entry not found")
            if current.deleted_at is not None:
                raise MemoryEntryConflictError("Memory entry is no longer live")
            await self._require_anima_scope_owned(user_id=user_id, anima_id=current.anima_id)
            self._require_not_identity(current)
            self._require_unprotected_existing_entry(current)
            if current.type != MEMORY_ENTRY_TYPE_FILE:
                raise MemoryEntryValidationError("Only memory files can be undone")
            self._require_expected_version(current=current, expected_version=expected_version)
            stored = await self._update_file_entry(
                current=current,
                content=old_content,
                kind=None,
                kind_set=False,
                description=old_description,
                description_set=True,
                metadata=None,
                metadata_set=False,
                operation=MEMORY_ENTRY_OPERATION_UNDO,
                change_metadata=change_metadata,
            )
            await self._commit_if_enabled()
        except MemoryEntryRepositoryConflictError as exc:
            await self._raise_repository_conflict(exc)
        except Exception:
            await self._rollback_if_enabled()
            raise
        return stored

    async def undo_approved_create(
        self,
        *,
        user_id: str,
        entry_id: str,
        expected_version: int,
        change_metadata: dict[str, Any],
    ) -> MemoryEntry:
        """Soft-delete one approved created file as an Undo Version."""

        try:
            current = await self._memory_entries.get_entry_for_update(
                user_id=user_id,
                entry_id=entry_id,
                include_deleted=True,
            )
            if current is None:
                raise MemoryEntryNotFoundError("Memory entry not found")
            if current.deleted_at is not None:
                raise MemoryEntryConflictError("Memory entry is no longer live")
            await self._require_anima_scope_owned(user_id=user_id, anima_id=current.anima_id)
            self._require_not_identity(current)
            self._require_unprotected_existing_entry(current)
            if current.type != MEMORY_ENTRY_TYPE_FILE:
                raise MemoryEntryValidationError("Only memory files can be undone")
            self._require_expected_version(current=current, expected_version=expected_version)
            deleted = replace(
                current,
                version=current.version + 1,
                deleted_at=datetime.utcnow(),
            )
            stored = await self._memory_entries.update_entry(deleted)
            await self._memory_entries.append_version(
                _version_from_entry(
                    stored,
                    operation=MEMORY_ENTRY_OPERATION_UNDO,
                    change_metadata=change_metadata,
                )
            )
            await self._commit_if_enabled()
        except MemoryEntryRepositoryConflictError as exc:
            await self._raise_repository_conflict(exc)
        except Exception:
            await self._rollback_if_enabled()
            raise
        return stored

    async def revert_entry(
        self,
        *,
        user_id: str,
        entry_id: str,
        target_version: int,
        expected_version: int,
        expected_aggregate_revision: int | None = None,
    ) -> MemoryEntry:
        """Copy historical content and description into one new Revert Version."""

        try:
            await self._lock_identity_entry(
                user_id=user_id,
                entry_id=entry_id,
                expected_revision=expected_aggregate_revision,
            )
            current = await self._memory_entries.get_entry_for_update(
                user_id=user_id,
                entry_id=entry_id,
                include_deleted=True,
            )
            if current is None:
                raise MemoryEntryNotFoundError("Memory entry not found")
            if current.deleted_at is not None:
                raise MemoryEntryValidationError("Deleted memory entries cannot be reverted")
            await self._require_anima_scope_owned(user_id=user_id, anima_id=current.anima_id)
            if is_protected_memory_entry(current):
                raise MemoryEntryValidationError("Generated episode logs are read-only")
            if current.type != MEMORY_ENTRY_TYPE_FILE:
                raise MemoryEntryValidationError("Only memory files can be reverted")
            self._require_expected_version(current=current, expected_version=expected_version)
            if target_version >= current.version:
                raise MemoryEntryValidationError("Revert target must be older than the current Version")

            target = await self._memory_entries.get_version(
                user_id=user_id,
                entry_id=entry_id,
                version=target_version,
            )
            if target is None:
                raise MemoryEntryNotFoundError("Memory entry version not found")
            if target.type != MEMORY_ENTRY_TYPE_FILE or target.deleted_at is not None or target.content is None:
                raise MemoryEntryValidationError("Revert target must be a live memory file Version")

            target_description = normalize_memory_entry_description(target.description)
            if current.content == target.content and current.description == target_description:
                raise MemoryEntryValidationError("The selected Version already matches current memory")

            stored = await self._update_file_entry(
                current=current,
                content=target.content,
                kind=None,
                kind_set=False,
                description=target_description,
                description_set=True,
                metadata=None,
                metadata_set=False,
                operation=MEMORY_ENTRY_OPERATION_REVERT,
                change_metadata={
                    "source_type": "memory_entry_revert",
                    "source_id": entry_id,
                    "target_version": target_version,
                },
            )
            await self._record_identity_change(stored, expected_aggregate_revision, reason="identity_revert")
            await self._commit_if_enabled()
        except MemoryEntryRepositoryConflictError as exc:
            await self._raise_repository_conflict(exc)
        except Exception:
            await self._rollback_if_enabled()
            raise
        self._log.info(
            "MemoryEntryService.revert_entry.updated",
            user_id=user_id,
            entry_id=entry_id,
            target_version=target_version,
        )
        return stored

    async def _create_entry(
        self,
        *,
        user_id: str,
        anima_id: str | None,
        parent: MemoryEntry | None,
        type: str,
        name: str,
        content: str | None,
        kind: str | None,
        description: str | None,
        metadata: dict[str, Any] | None,
        change_metadata: dict[str, Any] | None = None,
    ) -> MemoryEntry:
        clean_name, normalized_name = normalize_memory_entry_name(name)
        if type not in {MEMORY_ENTRY_TYPE_FILE, MEMORY_ENTRY_TYPE_DIRECTORY}:
            raise MemoryEntryValidationError("Memory entry type must be file or directory")
        if type == MEMORY_ENTRY_TYPE_FILE and not clean_name.endswith(".md"):
            raise MemoryEntryValidationError("Memory file entry names must end with .md")
        if type == MEMORY_ENTRY_TYPE_DIRECTORY and clean_name.endswith(".md"):
            raise MemoryEntryValidationError("Memory directory names cannot end with .md")

        path = f"{parent.path}/{clean_name}" if parent is not None else clean_name
        normalized_path = f"{parent.normalized_path}/{normalized_name}" if parent is not None else normalized_name
        identity_location = anima_id is not None and normalized_path == ANIMA_IDENTITY_PATH
        if kind == ANIMA_IDENTITY_KIND and not identity_location:
            raise MemoryEntryValidationError("Anima identity must be the Anima-scoped identity.md file")
        if identity_location:
            if type != MEMORY_ENTRY_TYPE_FILE or kind not in {None, ANIMA_IDENTITY_KIND}:
                raise MemoryEntryValidationError("Anima identity must be a file with kind anima_identity")
            content = self._normalize_identity(content)
            kind = ANIMA_IDENTITY_KIND
        if len(path) > MEMORY_ENTRY_MAX_PATH_CHARS:
            raise MemoryEntryValidationError("Memory entry path is too long")
        existing = await self._memory_entries.get_entry_by_path_for_update(
            user_id=user_id,
            anima_id=anima_id,
            normalized_path=normalized_path,
        )
        if existing is not None:
            raise MemoryEntryConflictError("Memory entry already exists")

        normalized_description = normalize_memory_entry_description(description)
        content_sha256: str | None = None
        size_bytes: int | None = None
        stored_content: str | None = None
        if type == MEMORY_ENTRY_TYPE_FILE:
            if content is None:
                raise MemoryEntryValidationError("Memory file content is required")
            content_sha256, size_bytes = _content_hash_and_size(content, max_bytes=self._max_file_bytes)
            stored_content = content
        elif content is not None:
            raise MemoryEntryValidationError("Memory directories cannot store content")

        created = MemoryEntry(
            id=new_memory_entry_id(),
            user_id=user_id,
            anima_id=anima_id,
            parent_id=parent.id if parent is not None else None,
            type=type,
            name=clean_name,
            normalized_name=normalized_name,
            path=path,
            normalized_path=normalized_path,
            content=stored_content,
            content_sha256=content_sha256,
            size_bytes=size_bytes,
            version=1,
            kind=kind,
            description=normalized_description,
            metadata=dict(metadata or {}),
        )
        stored = await self._memory_entries.create_entry(created)
        await self._memory_entries.append_version(
            _version_from_entry(
                stored,
                operation=MEMORY_ENTRY_OPERATION_CREATE,
                change_metadata=change_metadata,
            )
        )
        return stored

    async def _ensure_directory_path(
        self,
        *,
        user_id: str,
        anima_id: str | None,
        directory_path: str,
        change_metadata: dict[str, Any] | None = None,
    ) -> MemoryEntry:
        clean_path, normalized_path = normalize_memory_entry_path(directory_path)
        parent: MemoryEntry | None = None
        accumulated: list[str] = []
        normalized_parts = normalized_path.split("/")
        for index, part in enumerate(clean_path.split("/")):
            accumulated.append(part)
            current_normalized = "/".join(normalized_parts[: index + 1])
            existing = await self._memory_entries.get_entry_by_path_for_update(
                user_id=user_id,
                anima_id=anima_id,
                normalized_path=current_normalized,
            )
            if existing is not None:
                if existing.type != MEMORY_ENTRY_TYPE_DIRECTORY:
                    raise MemoryEntryConflictError("Memory file exists where a directory is required")
                parent = existing
                continue
            parent = await self._create_entry(
                user_id=user_id,
                anima_id=anima_id,
                parent=parent,
                type=MEMORY_ENTRY_TYPE_DIRECTORY,
                name=part,
                content=None,
                kind=None,
                description=None,
                metadata={},
                change_metadata=change_metadata,
            )
        if parent is None:
            raise MemoryEntryValidationError("Memory directory path is required")
        return parent

    async def _update_file_entry(
        self,
        *,
        current: MemoryEntry,
        content: str | None,
        kind: str | None,
        kind_set: bool,
        description: str | None,
        description_set: bool,
        metadata: dict[str, Any] | None,
        metadata_set: bool,
        operation: str,
        content_set: bool = True,
        change_metadata: dict[str, Any] | None = None,
    ) -> MemoryEntry:
        if content_set and current.type != MEMORY_ENTRY_TYPE_FILE:
            raise MemoryEntryValidationError("Only file entries can store content")
        next_content = content if content_set else current.content
        if is_anima_identity(current):
            if kind_set and kind != ANIMA_IDENTITY_KIND:
                raise MemoryEntryProtectedError("Anima identity kind cannot be changed")
            next_content = self._normalize_identity(next_content)
        elif kind_set and kind == ANIMA_IDENTITY_KIND:
            raise MemoryEntryValidationError("Anima identity must be the Anima-scoped identity.md file")
        content_sha256 = current.content_sha256
        size_bytes = current.size_bytes
        if current.type == MEMORY_ENTRY_TYPE_FILE:
            if next_content is None:
                raise MemoryEntryValidationError("Memory file content is required")
            content_sha256, size_bytes = _content_hash_and_size(next_content, max_bytes=self._max_file_bytes)
        elif content_set:
            raise MemoryEntryValidationError("Memory directories cannot store content")

        normalized_description = normalize_memory_entry_description(description) if description_set else None
        updated = replace(
            current,
            content=next_content if current.type == MEMORY_ENTRY_TYPE_FILE else None,
            content_sha256=content_sha256 if current.type == MEMORY_ENTRY_TYPE_FILE else None,
            size_bytes=size_bytes if current.type == MEMORY_ENTRY_TYPE_FILE else None,
            version=current.version + 1,
            kind=kind if kind_set else current.kind,
            description=normalized_description if description_set else current.description,
            metadata=dict(metadata or {}) if metadata_set else dict(current.metadata or {}),
        )
        stored = await self._memory_entries.update_entry(updated)
        await self._memory_entries.append_version(
            _version_from_entry(
                stored,
                operation=operation,
                change_metadata=change_metadata,
            )
        )
        return stored

    async def _move_entry(
        self,
        *,
        current: MemoryEntry,
        name: str | None,
        name_set: bool,
        parent_id: str | None,
        parent_id_set: bool,
        allow_system_managed: bool = False,
        change_metadata: dict[str, Any] | None = None,
    ) -> MemoryEntry:
        clean_name, normalized_name = (
            normalize_memory_entry_name(name)
            if name_set and name is not None
            else (current.name, current.normalized_name)
        )
        if name_set and name is None:
            raise MemoryEntryValidationError("Memory entry name is required")
        if current.type == MEMORY_ENTRY_TYPE_FILE and not clean_name.endswith(".md"):
            raise MemoryEntryValidationError("Memory file entry names must end with .md")
        if current.type == MEMORY_ENTRY_TYPE_DIRECTORY and clean_name.endswith(".md"):
            raise MemoryEntryValidationError("Memory directory names cannot end with .md")

        target_parent_id = parent_id if parent_id_set else current.parent_id
        if target_parent_id == current.id:
            raise MemoryEntryConflictError("Cannot move a directory under itself")
        target_parent = await self._load_parent(
            user_id=current.user_id,
            parent_id=target_parent_id,
            anima_id=current.anima_id,
        )

        if current.type == MEMORY_ENTRY_TYPE_DIRECTORY and target_parent is not None:
            if await self._memory_entries.has_live_descendant(
                user_id=current.user_id,
                entry=current,
                descendant_id=target_parent.id,
            ):
                raise MemoryEntryConflictError("Cannot move a directory under one of its descendants")

        next_path = f"{target_parent.path}/{clean_name}" if target_parent is not None else clean_name
        next_normalized_path = (
            f"{target_parent.normalized_path}/{normalized_name}" if target_parent is not None else normalized_name
        )
        if current.anima_id is not None and next_normalized_path == ANIMA_IDENTITY_PATH:
            raise MemoryEntryProtectedError(
                "Use explicit identity repair instead of moving another file to identity.md"
            )
        if not allow_system_managed and is_protected_memory_path(next_path):
            raise MemoryEntryProtectedError("Generated episode logs are read-only")
        if len(next_path) > MEMORY_ENTRY_MAX_PATH_CHARS:
            raise MemoryEntryValidationError("Memory entry path is too long")

        existing = await self._memory_entries.get_entry_by_path_for_update(
            user_id=current.user_id,
            anima_id=current.anima_id,
            normalized_path=next_normalized_path,
        )
        if existing is not None and existing.id != current.id:
            raise MemoryEntryConflictError("Memory entry already exists")

        old_path_prefix = f"{current.path}/"
        old_normalized_prefix = f"{current.normalized_path}/"
        new_path_prefix = f"{next_path}/"
        new_normalized_prefix = f"{next_normalized_path}/"
        if current.type == MEMORY_ENTRY_TYPE_DIRECTORY:
            max_suffix_length = await self._memory_entries.max_live_descendant_path_suffix_length(
                user_id=current.user_id,
                entry=current,
            )
            if max_suffix_length is not None and len(new_path_prefix) + max_suffix_length > MEMORY_ENTRY_MAX_PATH_CHARS:
                raise MemoryEntryValidationError("Memory entry path is too long")

        moved = replace(
            current,
            parent_id=target_parent.id if target_parent is not None else None,
            name=clean_name,
            normalized_name=normalized_name,
            path=next_path,
            normalized_path=next_normalized_path,
            version=current.version + 1,
        )
        stored = await self._memory_entries.update_entry(moved)
        await self._memory_entries.append_version(
            _version_from_entry(
                stored,
                operation=MEMORY_ENTRY_OPERATION_MOVE,
                change_metadata=change_metadata,
            )
        )
        if current.type == MEMORY_ENTRY_TYPE_DIRECTORY:
            await self._memory_entries.move_live_descendants(
                user_id=current.user_id,
                entry=current,
                old_path_prefix=old_path_prefix,
                old_normalized_path_prefix=old_normalized_prefix,
                new_path_prefix=new_path_prefix,
                new_normalized_path_prefix=new_normalized_prefix,
            )
        return stored

    async def initialize_anima_identity(
        self,
        *,
        user_id: str,
        anima_id: str,
        content: str,
        description: str,
        metadata: dict[str, Any] | None = None,
    ) -> MemoryEntry:
        """Seed Version 1 inside a materializer's transaction, without a commit.

        The materializer appends aggregate Revision 1 after all children exist.
        Normal repair/edit APIs cannot use this entry point to skip their guard.
        """

        if self._commit_on_write:
            raise MemoryEntryConfigurationError("Identity initialization requires a caller-owned transaction")
        await self._lock_identity_scope(
            user_id=user_id,
            anima_id=anima_id,
            path=ANIMA_IDENTITY_PATH,
            expected_revision=1,
        )
        return await self._create_entry(
            user_id=user_id,
            anima_id=anima_id,
            parent=None,
            type=MEMORY_ENTRY_TYPE_FILE,
            name=ANIMA_IDENTITY_PATH,
            content=content,
            kind=ANIMA_IDENTITY_KIND,
            description=description,
            metadata=metadata,
        )

    def _normalize_identity(self, content: str | None) -> str:
        try:
            return normalize_identity(content or "", max_bytes=self._max_file_bytes)
        except AnimaDefinitionError as exc:
            raise MemoryEntryValidationError(exc.code) from exc

    @staticmethod
    def _require_not_identity(entry: MemoryEntry) -> None:
        if is_anima_identity(entry):
            raise MemoryEntryProtectedError("Required Anima identity cannot be moved, renamed, deleted, or AI-undone")

    async def _lock_identity_scope(
        self,
        *,
        user_id: str,
        anima_id: str | None,
        path: str,
        expected_revision: int | None,
    ) -> None:
        if anima_id is None or path.casefold() != ANIMA_IDENTITY_PATH:
            return
        await self._require_anima_scope_owned(user_id=user_id, anima_id=anima_id)
        if expected_revision is None:
            raise MemoryEntryConflictError("Expected aggregate revision is required for Anima identity")
        assert self._animas is not None
        try:
            await self._animas.lock_definition(
                user_id=user_id,
                anima_id=anima_id,
                expected_revision=expected_revision,
            )
        except AnimaDefinitionError as exc:
            if exc.code == "anima_not_found":
                raise MemoryEntryNotFoundError("Anima not found") from exc
            raise MemoryEntryConflictError(
                f"Anima aggregate revision conflict (current {exc.current_revision})"
            ) from exc

    async def _lock_identity_entry(self, *, user_id: str, entry_id: str, expected_revision: int | None) -> None:
        # Discover scope without taking a memory row lock: all definition
        # writers acquire Anima -> memory/loadout locks in the same order.
        entry = await self._memory_entries.get_entry(user_id=user_id, entry_id=entry_id)
        if entry is not None and is_anima_identity(entry):
            await self._lock_identity_scope(
                user_id=user_id,
                anima_id=entry.anima_id,
                path=ANIMA_IDENTITY_PATH,
                expected_revision=expected_revision,
            )

    async def _record_identity_change(self, entry: MemoryEntry, expected_revision: int | None, *, reason: str) -> None:
        if not is_anima_identity(entry):
            return
        assert self._animas is not None and entry.anima_id is not None and expected_revision is not None
        anima = await self._animas.record_definition_revision(
            user_id=entry.user_id,
            anima_id=entry.anima_id,
            expected_revision=expected_revision,
            reason=reason,
        )
        entry.aggregate_revision = anima.aggregate_revision

    async def _with_aggregate_revision(self, entry: MemoryEntry) -> MemoryEntry:
        if is_anima_identity(entry) and self._animas is not None:
            anima = await self._animas.get(entry.anima_id)
            if anima is not None:
                entry.aggregate_revision = anima.aggregate_revision
        return entry

    async def _load_parent(
        self,
        *,
        user_id: str,
        parent_id: str | None,
        anima_id: str | None,
    ) -> MemoryEntry | None:
        if parent_id is None:
            return None
        parent = await self._memory_entries.get_entry_for_update(user_id=user_id, entry_id=parent_id)
        if parent is None:
            raise MemoryEntryNotFoundError("Memory entry parent not found")
        if parent.type != MEMORY_ENTRY_TYPE_DIRECTORY:
            raise MemoryEntryValidationError("Memory entry parent must be a directory")
        if parent.anima_id != anima_id:
            raise MemoryEntryValidationError("Memory entry parent scope does not match requested scope")
        return parent

    async def _load_history_entry(self, *, user_id: str, entry_id: str) -> MemoryEntry:
        """Authorize history reads through the current, possibly deleted, row."""

        entry = await self._memory_entries.get_entry(
            user_id=user_id,
            entry_id=entry_id,
            include_deleted=True,
        )
        if entry is None:
            raise MemoryEntryNotFoundError("Memory entry not found")
        await self._require_anima_scope_owned(user_id=user_id, anima_id=entry.anima_id)
        return entry

    async def _require_anima_scope_owned(self, *, user_id: str, anima_id: str | None) -> None:
        if anima_id is None:
            return
        if self._animas is None:
            raise MemoryEntryConfigurationError("MemoryEntryService is not configured to validate anima-scoped memory")
        if not await self._animas.is_owned_by_user(user_id=user_id, anima_id=anima_id):
            raise MemoryEntryNotFoundError("Anima not found")

    async def _load_create_parent(
        self,
        *,
        user_id: str,
        parent_id: str | None,
        anima_id: str | None,
    ) -> MemoryEntry | None:
        if parent_id is None:
            return None
        parent = await self._memory_entries.get_entry_for_update(user_id=user_id, entry_id=parent_id)
        if parent is None:
            raise MemoryEntryNotFoundError("Memory entry parent not found")
        if parent.type != MEMORY_ENTRY_TYPE_DIRECTORY:
            raise MemoryEntryValidationError("Memory entry parent must be a directory")
        if anima_id is not None and parent.anima_id != anima_id:
            raise MemoryEntryValidationError("Memory entry parent scope does not match requested scope")
        return parent

    @staticmethod
    def _normalize_lookup_path(path: str, *, type: str | None) -> str:
        if type == MEMORY_ENTRY_TYPE_FILE:
            _clean, normalized = normalize_memory_file_path(path)
            return normalized
        _clean, normalized = normalize_memory_entry_path(path)
        return normalized

    @staticmethod
    def _require_expected_version(*, current: MemoryEntry, expected_version: int | None) -> None:
        if expected_version is None:
            raise MemoryEntryConflictError("Expected version is required")
        if expected_version != current.version:
            raise MemoryEntryConflictError("Memory entry version conflict")

    @staticmethod
    def _require_unprotected_existing_entry(entry: MemoryEntry) -> None:
        if is_protected_memory_entry(entry):
            raise MemoryEntryProtectedError("Generated episode logs are read-only")

    @staticmethod
    def _require_unprotected_new_entry(*, path: str, kind: str | None) -> None:
        if is_protected_memory_path(path) or is_protected_memory_kind(kind):
            raise MemoryEntryProtectedError("Generated episode logs are read-only")

    async def _commit_if_enabled(self) -> None:
        if self._commit_on_write:
            await self._uow.commit()

    async def _rollback_if_enabled(self) -> None:
        if self._commit_on_write:
            await self._uow.rollback()

    async def _raise_repository_conflict(self, exc: MemoryEntryRepositoryConflictError) -> NoReturn:
        if self._commit_on_write:
            await self._uow.rollback()
        if exc.constraint_name == _MEMORY_ENTRY_VERSION_CONSTRAINT:
            raise MemoryEntryConflictError("Memory entry version conflict") from exc
        raise MemoryEntryConflictError("Memory entry already exists") from exc


__all__ = [
    "MEMORY_ENTRY_DEFAULT_MAX_BYTES",
    "MEMORY_ENTRY_EPISODES_ROOT_PATH",
    "MEMORY_ENTRY_MAX_NAME_CHARS",
    "MEMORY_ENTRY_MAX_PATH_CHARS",
    "MEMORY_ENTRY_VERSION_DEFAULT_LIMIT",
    "MEMORY_ENTRY_VERSION_MAX_LIMIT",
    "MemoryEntryConfigurationError",
    "MemoryEntryConflictError",
    "MemoryEntryError",
    "MemoryEntryNotFoundError",
    "MemoryEntryProtectedError",
    "MemoryEntryService",
    "MemoryEntryValidationError",
    "is_protected_memory_entry",
    "is_protected_memory_kind",
    "is_protected_memory_path",
    "new_memory_entry_id",
    "normalize_memory_directory_path",
    "normalize_memory_entry_description",
    "normalize_memory_entry_name",
    "normalize_memory_entry_path",
    "normalize_memory_file_path",
]
