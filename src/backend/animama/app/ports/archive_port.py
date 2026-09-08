"""Archive repository protocol for anima-scoped archives and passages."""

from __future__ import annotations

from typing import Protocol

from ...domain.archive import Archive, ArchivePassage


class ArchiveRepository(Protocol):
    """Repository operations for archives and their passages."""

    async def get_archive(self, archive_id: str) -> Archive | None:
        raise NotImplementedError

    async def create_archive(
        self,
        *,
        name: str,
        description: str | None = None,
        metadata: dict | None = None,
        organization_id: str | None = None,
    ) -> Archive:
        raise NotImplementedError

    async def update_archive(self, archive: Archive) -> Archive:
        raise NotImplementedError

    async def list_passages(self, *, archive_id: str, limit: int = 100, offset: int = 0) -> list[ArchivePassage]:
        raise NotImplementedError

    async def get_passage(self, passage_id: int) -> ArchivePassage | None:
        raise NotImplementedError

    async def create_passage(
        self,
        *,
        archive_id: str,
        text: str,
        embedding: list[float] | None = None,
        metadata: dict | None = None,
        tags: list[str] | None = None,
        source_id: str | None = None,
        file_id: str | None = None,
    ) -> ArchivePassage:
        raise NotImplementedError

    async def update_passage(self, passage: ArchivePassage) -> ArchivePassage:
        raise NotImplementedError

    async def delete_passage(self, passage_id: int) -> bool:
        raise NotImplementedError

    async def search_passages(
        self,
        *,
        embedding: list[float],
        limit: int = 5,
        threshold: float = 0.1,
        archive_id: str | None = None,
    ) -> list[ArchivePassage]:
        raise NotImplementedError


__all__ = ["ArchiveRepository"]
