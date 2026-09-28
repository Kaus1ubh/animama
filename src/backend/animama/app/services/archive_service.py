"""Archive service.

Application service over the archive repository, used by HTTP routers and
function-node utilities. Works with domain Archive/ArchivePassage types.

Passages are embedded with the embeddings-role model when one is assigned.
Search compares only vectors from that model and uses full-text search while
embeddings are off, while passages wait for re-embedding, or when embedding
the query fails.
"""

from __future__ import annotations

from typing import Any

from ...domain.archive import Archive, ArchivePassage
from ...logging import get_logger
from ..ports.archive_port import ArchiveRepository
from ..ports.text_embedder import TextEmbedder
from ..ports.uow_port import UnitOfWork


class ArchiveService:
    def __init__(
        self,
        *,
        archives: ArchiveRepository,
        uow: UnitOfWork,
        embedder: TextEmbedder | None = None,
    ) -> None:
        self._archives = archives
        self._uow = uow
        self._embedder = embedder
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
    ) -> ArchivePassage:
        self._log.info("ArchiveService.create_passage", archive_id=archive_id)
        embedding = await self._embed_passage(text)
        created = await self._archives.create_passage(
            archive_id=archive_id,
            text=text,
            embedding=embedding,
            embedding_model_id=self._embedder.model_id if embedding is not None and self._embedder else None,
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
        """Store ``passage``; changed text is embedded again or left for re-embedding."""

        self._log.info("ArchiveService.update_passage", passage_id=passage.id, archive_id=passage.archive_id)
        current = await self._archives.get_passage(passage.id)
        if current is not None and current.text != passage.text:
            passage.embedding = await self._embed_passage(passage.text)
            passage.embedding_model_id = (
                self._embedder.model_id if passage.embedding is not None and self._embedder else None
            )
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
        query: str,
        limit: int = 5,
        threshold: float = 0.1,
        archive_id: str,
    ) -> list[ArchivePassage]:
        """Rank passages by vector similarity, or by full-text match when vectors are unusable.

        ``threshold`` applies only to vector similarity.
        """

        self._log.info("ArchiveService.search_passages", archive_id=archive_id, limit=limit, threshold=threshold)
        query_embedding = await self._query_embedding(query, archive_id=archive_id)
        if query_embedding is not None and self._embedder is not None:
            return await self._archives.search_passages(
                embedding=query_embedding,
                embedding_model_id=self._embedder.model_id,
                limit=limit,
                threshold=threshold,
                archive_id=archive_id,
            )
        return await self._archives.keyword_search_passages(query=query, limit=limit, archive_id=archive_id)

    async def _query_embedding(self, query: str, *, archive_id: str) -> list[float] | None:
        if self._embedder is None:
            return None
        stale = await self._archives.count_stale_passages(
            archive_id=archive_id, embedding_model_id=self._embedder.model_id
        )
        if stale:
            self._log.info("Archive search uses full text while passages are re-embedded", stale_passages=stale)
            return None
        return await self._embed_passage(query)

    async def _embed_passage(self, text: str) -> list[float] | None:
        """Embed one text; failures are logged and leave the passage for re-embedding."""

        if self._embedder is None:
            return None
        try:
            vectors = await self._embedder.embed_texts([text])
        except Exception as exc:
            self._log.warning("Archive embedding failed", error_type=exc.__class__.__name__, error=str(exc))
            return None
        return [float(value) for value in vectors[0]] if vectors and vectors[0] else None

    async def get_passage(self, passage_id: int) -> ArchivePassage | None:
        self._log.info("ArchiveService.get_passage", passage_id=passage_id)
        return await self._archives.get_passage(passage_id)


__all__ = ["ArchiveService"]
