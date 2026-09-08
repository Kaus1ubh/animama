"""Repository protocol for markdown memory entries."""

from __future__ import annotations

from datetime import datetime
from typing import Protocol

from animama.domain.memory_entry import (
    MemoryEntry,
    MemoryEntryHeader,
    MemoryEntrySearchResult,
    MemoryEntryVersion,
)


class MemoryEntryRepositoryConflictError(Exception):
    """Raised when storage detects a memory-entry uniqueness conflict."""

    def __init__(self, *, constraint_name: str | None = None) -> None:
        super().__init__(constraint_name or "Memory entry repository conflict")
        self.constraint_name = constraint_name


class MemoryEntryRepository(Protocol):
    """Persistence operations for current memory entries and versions."""

    async def create_entry(self, entry: MemoryEntry) -> MemoryEntry:
        raise NotImplementedError

    async def get_entry(self, *, user_id: str, entry_id: str, include_deleted: bool = False) -> MemoryEntry | None:
        raise NotImplementedError

    async def get_entry_for_update(
        self,
        *,
        user_id: str,
        entry_id: str,
        include_deleted: bool = False,
    ) -> MemoryEntry | None:
        raise NotImplementedError

    async def get_entry_by_path(
        self,
        *,
        user_id: str,
        anima_id: str | None,
        normalized_path: str,
        type: str | None = None,
    ) -> MemoryEntry | None:
        raise NotImplementedError

    async def get_entry_by_path_for_update(
        self,
        *,
        user_id: str,
        anima_id: str | None,
        normalized_path: str,
        type: str | None = None,
    ) -> MemoryEntry | None:
        raise NotImplementedError

    async def list_entries(
        self,
        *,
        user_id: str,
        anima_id: str | None,
        parent_id: str | None,
        recursive: bool,
    ) -> list[MemoryEntry]:
        raise NotImplementedError

    async def list_entry_headers(
        self,
        *,
        user_id: str,
        anima_id: str | None,
        parent_id: str | None,
        recursive: bool,
    ) -> list[MemoryEntryHeader]:
        raise NotImplementedError

    async def list_live_children(self, *, user_id: str, parent_id: str) -> list[MemoryEntry]:
        raise NotImplementedError

    async def list_live_descendants(self, *, user_id: str, entry: MemoryEntry) -> list[MemoryEntry]:
        raise NotImplementedError

    async def has_live_descendant(
        self,
        *,
        user_id: str,
        entry: MemoryEntry,
        descendant_id: str | None = None,
    ) -> bool:
        raise NotImplementedError

    async def max_live_descendant_path_suffix_length(self, *, user_id: str, entry: MemoryEntry) -> int | None:
        raise NotImplementedError

    async def move_live_descendants(
        self,
        *,
        user_id: str,
        entry: MemoryEntry,
        old_path_prefix: str,
        old_normalized_path_prefix: str,
        new_path_prefix: str,
        new_normalized_path_prefix: str,
    ) -> list[MemoryEntry]:
        raise NotImplementedError

    async def soft_delete_live_descendants(
        self,
        *,
        user_id: str,
        entry: MemoryEntry,
        deleted_at: datetime,
    ) -> list[MemoryEntry]:
        raise NotImplementedError

    async def search_files(
        self,
        *,
        user_id: str,
        anima_id: str | None,
        query: str,
        normalized_path_prefix: str | None,
        include_episodic_memory: bool = True,
        limit: int,
        context_chars: int,
    ) -> list[MemoryEntrySearchResult]:
        raise NotImplementedError

    async def update_entry(self, entry: MemoryEntry) -> MemoryEntry:
        raise NotImplementedError

    async def update_entries(self, entries: list[MemoryEntry]) -> list[MemoryEntry]:
        raise NotImplementedError

    async def list_versions(
        self,
        *,
        user_id: str,
        entry_id: str,
        before_version: int | None,
        limit: int,
    ) -> list[MemoryEntryVersion]:
        raise NotImplementedError

    async def get_version(
        self,
        *,
        user_id: str,
        entry_id: str,
        version: int,
    ) -> MemoryEntryVersion | None:
        raise NotImplementedError

    async def append_version(self, version: MemoryEntryVersion) -> MemoryEntryVersion:
        raise NotImplementedError


__all__ = ["MemoryEntryRepository", "MemoryEntryRepositoryConflictError"]
