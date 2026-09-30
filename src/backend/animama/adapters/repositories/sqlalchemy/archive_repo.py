"""Archive repository for vector similarity search and passage storage."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from animama.domain.archive import Archive as ArchiveDomain, ArchivePassage as ArchivePassageDomain
from animama.orm.archive import ORMArchive
from animama.orm.archive_passage import ORMArchivePassage


@dataclass
class ArchivePassageResult:
    """Result from archive similarity search."""

    id: int
    text: str
    score: float
    metadata: dict[str, Any] | None = None
    archive_id: str | None = None


class SQLAlchemyArchiveRepository:
    """Repository for archive and passage operations with vector search."""

    def __init__(self, session: AsyncSession) -> None:
        self._s = session

    # ------------------------------------------------------------------
    # Archive helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _orm_archive_to_domain(obj: ORMArchive) -> ArchiveDomain:
        return ArchiveDomain(
            id=obj.id,
            name=obj.name,
            description=obj.description,
            organization_id=getattr(obj, "organization_id", None),
            metadata=obj.metadata_,
            created_at=getattr(obj, "created_at", None),
            updated_at=getattr(obj, "updated_at", None),
        )

    @staticmethod
    def _orm_passage_to_domain(obj: ORMArchivePassage) -> ArchivePassageDomain:
        return ArchivePassageDomain(
            id=obj.id,
            archive_id=obj.archive_id,
            text=obj.text,
            tags=obj.tags,
            metadata=obj.metadata_,
            source_id=obj.source_id,
            file_id=obj.file_id,
            created_at=getattr(obj, "created_at", None),
            updated_at=getattr(obj, "updated_at", None),
            embedding=obj.embedding,
            embedding_model_id=obj.embedding_model_id,
        )

    @staticmethod
    def _result_to_domain(res: ArchivePassageResult) -> ArchivePassageDomain:
        return ArchivePassageDomain(
            id=res.id,
            archive_id=res.archive_id or "",
            text=res.text,
            tags=None,
            metadata=res.metadata,
            source_id=None,
            file_id=None,
            created_at=None,
            updated_at=None,
            score=res.score,
            embedding=None,
        )

    async def get_archive(self, archive_id: str) -> ArchiveDomain | None:
        """Fetch an archive by id."""
        obj = await self._s.get(ORMArchive, archive_id)
        if obj is None:
            return None
        return self._orm_archive_to_domain(obj)

    async def create_archive(
        self,
        *,
        name: str,
        description: str | None = None,
        metadata: dict[str, Any] | None = None,
        organization_id: str | None = None,
    ) -> ArchiveDomain:
        """Create a new archive row."""
        obj = ORMArchive(
            name=name,
            description=description,
            metadata_=metadata or {},
            organization_id=organization_id,
        )
        self._s.add(obj)
        await self._s.flush()
        await self._s.refresh(obj)
        return self._orm_archive_to_domain(obj)

    async def update_archive(self, archive: ArchiveDomain) -> ArchiveDomain:
        """Update an existing archive."""
        obj = await self._s.get(ORMArchive, archive.id)
        if obj is None:
            raise ValueError(f"archive not found: {archive.id}")
        obj.name = archive.name
        obj.description = archive.description
        obj.metadata_ = archive.metadata
        obj.organization_id = archive.organization_id
        await self._s.flush()
        await self._s.refresh(obj)
        return self._orm_archive_to_domain(obj)

    async def search_passages(
        self,
        *,
        embedding: list[float],
        embedding_model_id: str,
        limit: int = 5,
        threshold: float = 0.1,
        archive_id: str | None = None,
    ) -> list[ArchivePassageDomain]:
        """Search passages by pgvector cosine similarity (highest first).

        Only vectors from ``embedding_model_id`` are compared; ``threshold`` is
        the minimum similarity from 0.0 to 1.0.
        """
        archive_filter = "AND archive_id = :archive_id" if archive_id else ""
        # Use CAST() instead of :: to avoid SQLAlchemy parameter parsing issues.
        query = text(f"""
            SELECT
                id,
                text,
                metadata_ as metadata,
                archive_id,
                1 - (embedding <=> CAST(:query_embedding AS vector)) as score
            FROM archive_passages
            WHERE embedding IS NOT NULL
                AND embedding_model_id = :embedding_model_id
                AND 1 - (embedding <=> CAST(:query_embedding AS vector)) >= :threshold
                {archive_filter}
            ORDER BY embedding <=> CAST(:query_embedding AS vector)
            LIMIT :limit
        """)
        params: dict[str, Any] = {
            "query_embedding": str(embedding),
            "embedding_model_id": embedding_model_id,
            "threshold": threshold,
            "limit": limit,
        }
        if archive_id:
            params["archive_id"] = archive_id
        return await self._search_results(query, params)

    async def keyword_search_passages(
        self,
        *,
        query: str,
        limit: int = 5,
        archive_id: str | None = None,
    ) -> list[ArchivePassageDomain]:
        """Search passages by Postgres full-text rank (highest first)."""

        archive_filter = "AND archive_id = :archive_id" if archive_id else ""
        statement = text(f"""
            SELECT
                id,
                text,
                metadata_ as metadata,
                archive_id,
                ts_rank_cd(to_tsvector('english', text), websearch_to_tsquery('english', :query)) as score
            FROM archive_passages
            WHERE to_tsvector('english', text) @@ websearch_to_tsquery('english', :query)
                {archive_filter}
            ORDER BY score DESC, id
            LIMIT :limit
        """)
        params: dict[str, Any] = {"query": query, "limit": limit}
        if archive_id:
            params["archive_id"] = archive_id
        return await self._search_results(statement, params)

    async def count_stale_passages(self, *, archive_id: str, embedding_model_id: str) -> int:
        """Count passages whose vector is missing or from another embedding model."""

        result = await self._s.execute(
            text("""
                SELECT count(*) FROM archive_passages
                WHERE archive_id = :archive_id AND embedding_model_id IS DISTINCT FROM :embedding_model_id
            """),
            {"archive_id": archive_id, "embedding_model_id": embedding_model_id},
        )
        return int(result.scalar_one())

    async def _search_results(self, query: Any, params: dict[str, Any]) -> list[ArchivePassageDomain]:
        rows = (await self._s.execute(query, params)).fetchall()
        return [
            self._result_to_domain(
                ArchivePassageResult(
                    id=row.id,
                    text=row.text,
                    score=row.score,
                    metadata=row.metadata,
                    archive_id=row.archive_id,
                )
            )
            for row in rows
        ]

    async def create_passage(
        self,
        *,
        archive_id: str,
        text: str,
        embedding: list[float] | None = None,
        embedding_model_id: str | None = None,
        metadata: dict[str, Any] | None = None,
        tags: list[str] | None = None,
        source_id: str | None = None,
        file_id: str | None = None,
    ) -> ArchivePassageDomain:
        """Create a new passage in the archive."""
        passage = ORMArchivePassage(
            archive_id=archive_id,
            text=text,
            embedding=embedding,
            embedding_model_id=embedding_model_id if embedding is not None else None,
            metadata_=metadata or {},
            tags=tags,
            source_id=source_id,
            file_id=file_id,
        )
        self._s.add(passage)
        await self._s.flush()
        await self._s.refresh(passage)
        return self._orm_passage_to_domain(passage)

    async def get_passage(self, passage_id: int) -> ArchivePassageDomain | None:
        """Get a passage by ID."""
        result = await self._s.get(ORMArchivePassage, passage_id)
        if result is None:
            return None
        return self._orm_passage_to_domain(result)

    async def update_passage(self, passage: ArchivePassageDomain) -> ArchivePassageDomain:
        """Update an existing passage."""
        obj = await self._s.get(ORMArchivePassage, passage.id)
        if obj is None:
            raise ValueError(f"archive passage not found: {passage.id}")
        if obj.text != passage.text:
            # Rejections belonged to the old text.
            obj.embedding_rejections = 0
            obj.embedding_rejected_model_id = None
        obj.text = passage.text
        obj.tags = passage.tags
        obj.metadata_ = passage.metadata
        obj.source_id = passage.source_id
        obj.file_id = passage.file_id
        obj.embedding = passage.embedding
        obj.embedding_model_id = passage.embedding_model_id if passage.embedding is not None else None
        await self._s.flush()
        await self._s.refresh(obj)
        return self._orm_passage_to_domain(obj)

    async def delete_passage(self, passage_id: int) -> bool:
        """Delete a passage by ID."""
        obj = await self._s.get(ORMArchivePassage, passage_id)
        if obj is None:
            return False
        await self._s.delete(obj)
        await self._s.flush()
        return True

    async def list_passages(
        self,
        *,
        archive_id: str,
        limit: int = 100,
        offset: int = 0,
    ) -> list[ArchivePassageDomain]:
        """List passages in an archive."""
        query = text("""
            SELECT * FROM archive_passages
            WHERE archive_id = :archive_id
            ORDER BY created_at DESC
            LIMIT :limit OFFSET :offset
        """)
        result = await self._s.execute(query, {"archive_id": archive_id, "limit": limit, "offset": offset})
        rows = result.fetchall()

        passages: list[ArchivePassageDomain] = []
        for row in rows:
            obj = ORMArchivePassage(
                id=row.id,
                archive_id=row.archive_id,
                text=row.text,
                embedding=row.embedding,
                embedding_model_id=row.embedding_model_id,
                metadata_=row.metadata_,
                tags=row.tags,
                source_id=row.source_id,
                file_id=row.file_id,
            )
            passages.append(self._orm_passage_to_domain(obj))
        return passages
