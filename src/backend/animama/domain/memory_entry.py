from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any

MEMORY_ENTRY_TYPE_FILE = "file"
MEMORY_ENTRY_TYPE_DIRECTORY = "directory"

MEMORY_ENTRY_OPERATION_CREATE = "create"
MEMORY_ENTRY_OPERATION_UPDATE = "update"
MEMORY_ENTRY_OPERATION_MOVE = "move"
MEMORY_ENTRY_OPERATION_DELETE = "delete"
MEMORY_ENTRY_OPERATION_UNDO = "undo"
MEMORY_ENTRY_OPERATION_REVERT = "revert"


@dataclass(slots=True)
class MemoryEntry:
    """User-owned memory filesystem entry.

    Entries are scoped by ``user_id`` plus nullable ``anima_id``. A null
    ``anima_id`` is account-wide user memory; a non-null value selects one
    anima-specific tree. ``path`` is a cached POSIX path from that scope root.
    """

    id: str
    user_id: str
    anima_id: str | None
    parent_id: str | None
    type: str
    name: str
    normalized_name: str
    path: str
    normalized_path: str
    version: int
    content: str | None = None
    content_sha256: str | None = None
    size_bytes: int | None = None
    kind: str | None = None
    description: str | None = None
    metadata: dict[str, Any] | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None
    deleted_at: datetime | None = None
    # Read/write projection only; the authoritative counter lives on Anima.
    aggregate_revision: int | None = None

    @property
    def is_file(self) -> bool:
        return self.type == MEMORY_ENTRY_TYPE_FILE

    @property
    def is_directory(self) -> bool:
        return self.type == MEMORY_ENTRY_TYPE_DIRECTORY


@dataclass(slots=True)
class MemoryEntryVersion:
    """Internal append-only audit snapshot for a memory entry version."""

    id: int | None
    entry_id: str
    user_id: str
    anima_id: str | None
    parent_id: str | None
    type: str
    name: str
    normalized_name: str
    path: str
    normalized_path: str
    version: int
    operation: str
    content: str | None = None
    content_sha256: str | None = None
    size_bytes: int | None = None
    kind: str | None = None
    description: str | None = None
    metadata: dict[str, Any] | None = None
    change_metadata: dict[str, Any] | None = None
    created_at: datetime | None = None
    deleted_at: datetime | None = None


@dataclass(frozen=True, slots=True)
class MemoryEntryVersionFieldChange:
    """Structured old/new values for one adjacent version field."""

    old: str | None
    new: str | None


@dataclass(slots=True)
class MemoryEntryVersionListing:
    """Newest-first immutable versions for one stable memory entry ID."""

    entry_id: str
    versions: list[MemoryEntryVersion]
    next_before_version: int | None = None


@dataclass(slots=True)
class MemoryEntryVersionDetail:
    """One immutable version plus the changes from its predecessor."""

    entry: MemoryEntryVersion
    previous_version: int
    unified_diff: str
    path_change: MemoryEntryVersionFieldChange | None = None
    description_change: MemoryEntryVersionFieldChange | None = None


@dataclass(slots=True)
class MemoryEntryListing:
    """Current live memory entries under one parent or subtree."""

    parent_id: str | None
    recursive: bool
    entries: list[MemoryEntry]


@dataclass(slots=True)
class MemoryEntryHeader:
    """Content-free memory entry header for list-heavy reads."""

    id: str
    user_id: str
    anima_id: str | None
    parent_id: str | None
    type: str
    name: str
    normalized_name: str
    path: str
    normalized_path: str
    version: int
    content_sha256: str | None = None
    size_bytes: int | None = None
    kind: str | None = None
    description: str | None = None
    metadata: dict[str, Any] | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None
    deleted_at: datetime | None = None

    @property
    def is_file(self) -> bool:
        return self.type == MEMORY_ENTRY_TYPE_FILE

    @property
    def is_directory(self) -> bool:
        return self.type == MEMORY_ENTRY_TYPE_DIRECTORY


@dataclass(slots=True)
class MemoryEntryHeaderListing:
    """Current live content-free memory entries under one parent or subtree."""

    parent_id: str | None
    recursive: bool
    entries: list[MemoryEntryHeader]


@dataclass(slots=True)
class MemoryEntrySearchResult:
    """Full-text search hit for a current memory file entry."""

    entry: MemoryEntry
    snippet: str
    score: float


__all__ = [
    "MEMORY_ENTRY_OPERATION_CREATE",
    "MEMORY_ENTRY_OPERATION_DELETE",
    "MEMORY_ENTRY_OPERATION_MOVE",
    "MEMORY_ENTRY_OPERATION_REVERT",
    "MEMORY_ENTRY_OPERATION_UNDO",
    "MEMORY_ENTRY_OPERATION_UPDATE",
    "MEMORY_ENTRY_TYPE_DIRECTORY",
    "MEMORY_ENTRY_TYPE_FILE",
    "MemoryEntry",
    "MemoryEntryListing",
    "MemoryEntryVersion",
    "MemoryEntryVersionDetail",
    "MemoryEntryVersionFieldChange",
    "MemoryEntryVersionListing",
    "MemoryEntrySearchResult",
    "MemoryEntryHeader",
    "MemoryEntryHeaderListing",
]
