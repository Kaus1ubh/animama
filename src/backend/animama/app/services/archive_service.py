"""Archive service.

Thin application service over the archive repository, used by HTTP routers
and function-node utilities. Works with domain Archive/ArchivePassage types.
"""

from __future__ import annotations

from typing import Any

from ...domain.archive import Archive, ArchivePassage
from ...logging import get_logger
from ..ports.archive_port import ArchiveRepository
from ..ports.uow_port import UnitOfWork


class ArchiveService:
    def __init__(self, *, archives: ArchiveRepository, uow: UnitOfWork) -> None:
        self._archives = archives
        self._uow = uow
        self._log = get_logger("app.services.archive")

    async def get_archive(self, archive_id: str) -> Archive | None:
        self._log.info("ArchiveService.get_archive", archive_id=archive_id)
        return await self._archives.get_archive(archive_id)

    async def create_archive(
        self,
        *,
        name: str,
        description: str | None = None,
        metadata: dict[str, Any] | None = None,
        organization_id: str | None = None,
    ) -> Archive:
        self._log.info("ArchiveService.create_archive", name=name, organization_id=organization_id)
        created = await self._archives.create_archive(
            name=name,
            description=description,
            metadata=metadata,
            organization_id=organization_id,
        )
        await self._uow.commit()
        return created

    async def update_archive(self, archive: Archive) -> Archive:
        self._log.info("ArchiveService.update_archive", archive_id=archive.id)
        updated = await self._archives.update_archive(archive)
        await self._uow.commit()
        return updated

    async def list_passages(
        self,
        *,
        archive_id: str,
        limit: int = 100,
        offset: int = 0,
    ) -> list[ArchivePassage]:
        self._log.info("ArchiveService.list_passages", archive_id=archive_id, limit=limit, offset=offset)
        return await self._archives.list_passages(archive_id=archive_id, limit=limit, offset=offset)

    async def create_passage(
        self,
        *,
        archive_id: str,
        text: str,
        tags: list[str] | None = None,
        metadata: dict[str, Any] | None = None,
        source_id: str | None = None,
        file_id: str | None = None,
        embedding: list[float] | None = None,
    ) -> ArchivePassage:
        self._log.info("ArchiveService.create_passage", archive_id=archive_id)
        created = await self._archives.create_passage(
            archive_id=archive_id,
            text=text,
            embedding=embedding,
            metadata=metadata,
            tags=tags,
            source_id=source_id,
            file_id=file_id,
        )
        await self._uow.commit()
        return created

    async def update_passage(
        self,
        *,
        passage: ArchivePassage,
    ) -> ArchivePassage:
        self._log.info("ArchiveService.update_passage", passage_id=passage.id, archive_id=passage.archive_id)
        updated = await self._archives.update_passage(passage)
        await self._uow.commit()
        return updated

    async def delete_passage(self, *, passage_id: int) -> bool:
        self._log.info("ArchiveService.delete_passage", passage_id=passage_id)
        ok = await self._archives.delete_passage(passage_id)
        if ok:
            await self._uow.commit()
        return ok

    async def search_passages(
        self,
        *,
        embedding: list[float],
        limit: int = 5,
        threshold: float = 0.1,
        archive_id: str | None = None,
    ) -> list[ArchivePassage]:
        self._log.info(
            "ArchiveService.search_passages",
            archive_id=archive_id,
            limit=limit,
            threshold=threshold,
        )
        return await self._archives.search_passages(
            embedding=embedding,
            limit=limit,
            threshold=threshold,
            archive_id=archive_id,
        )

    async def get_passage(self, passage_id: int) -> ArchivePassage | None:
        self._log.info("ArchiveService.get_passage", passage_id=passage_id)
        return await self._archives.get_passage(passage_id)


__all__ = ["ArchiveService"]
