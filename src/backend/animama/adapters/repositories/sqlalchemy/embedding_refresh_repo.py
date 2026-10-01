"""SQLAlchemy queries for re-embedding upload chunks and archive passages."""

from __future__ import annotations

from collections.abc import Sequence

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from animama.app.ports.embedding_refresh_port import EmbeddingRefreshCounts, StaleEmbeddingText

# A chunk is embeddable once its file is processed and searchable.
_STALE_CHUNKS_WHERE = """
    c.user_id = :owner_id
    AND c.embedding_model_id IS DISTINCT FROM :embedding_model_id
    AND EXISTS (
        SELECT 1 FROM user_file f
        WHERE f.id = c.file_id AND f.user_id = c.user_id AND f.status IN ('ready', 'ready_keyword_only')
    )
"""
# Archives belong to the owner through their Animas.
_STALE_PASSAGES_WHERE = """
    p.embedding_model_id IS DISTINCT FROM :embedding_model_id
    AND p.archive_id IN (SELECT a.archive_id FROM anima a WHERE a.user_id = :owner_id AND a.archive_id IS NOT NULL)
"""


class SQLAlchemyEmbeddingRefreshRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._s = session

    async def owners_with_embeddable_content(self) -> list[str]:
        result = await self._s.execute(
            text("""
                SELECT DISTINCT user_id FROM user_file_chunk
                UNION
                SELECT DISTINCT a.user_id FROM anima a
                WHERE a.user_id IS NOT NULL
                    AND a.archive_id IS NOT NULL
                    AND EXISTS (SELECT 1 FROM archive_passages p WHERE p.archive_id = a.archive_id)
            """)
        )
        return sorted(str(row[0]) for row in result)

    async def count_stale(self, *, owner_id: str, embedding_model_id: str) -> EmbeddingRefreshCounts:
        params = {"owner_id": owner_id, "embedding_model_id": embedding_model_id}
        chunks = await self._s.execute(
            text(f"SELECT count(*) FROM user_file_chunk c WHERE {_STALE_CHUNKS_WHERE}"), params
        )
        passages = await self._s.execute(
            text(f"SELECT count(*) FROM archive_passages p WHERE {_STALE_PASSAGES_WHERE}"), params
        )
        return EmbeddingRefreshCounts(chunks=int(chunks.scalar_one()), passages=int(passages.scalar_one()))

    async def stale_chunks(self, *, owner_id: str, embedding_model_id: str, limit: int) -> list[StaleEmbeddingText]:
        result = await self._s.execute(
            text(f"""
                SELECT c.id, c.text, COALESCE(c.embedding_text, c.text) AS embedding_input
                FROM user_file_chunk c
                WHERE {_STALE_CHUNKS_WHERE}
                ORDER BY c.file_id, c.chunk_index
                LIMIT :limit
            """),
            {"owner_id": owner_id, "embedding_model_id": embedding_model_id, "limit": limit},
        )
        return [StaleEmbeddingText(id=row.id, text=row.text, embedding_input=row.embedding_input) for row in result]

    async def stale_passages(self, *, owner_id: str, embedding_model_id: str, limit: int) -> list[StaleEmbeddingText]:
        result = await self._s.execute(
            text(f"""
                SELECT p.id, p.text
                FROM archive_passages p
                WHERE {_STALE_PASSAGES_WHERE}
                ORDER BY p.id
                LIMIT :limit
            """),
            {"owner_id": owner_id, "embedding_model_id": embedding_model_id, "limit": limit},
        )
        return [StaleEmbeddingText(id=row.id, text=row.text, embedding_input=row.text) for row in result]

    async def store_chunk_vectors(
        self,
        *,
        embedding_model_id: str,
        vectors: Sequence[tuple[StaleEmbeddingText, list[float] | None]],
    ) -> None:
        await self._store_vectors(
            "user_file_chunk",
            embedded_text_sql="COALESCE(embedding_text, text)",
            embedding_model_id=embedding_model_id,
            vectors=vectors,
        )

    async def store_passage_vectors(
        self,
        *,
        embedding_model_id: str,
        vectors: Sequence[tuple[StaleEmbeddingText, list[float] | None]],
    ) -> None:
        await self._store_vectors(
            "archive_passages", embedded_text_sql="text", embedding_model_id=embedding_model_id, vectors=vectors
        )

    async def record_chunk_rejections(
        self, *, embedding_model_id: str, items: Sequence[StaleEmbeddingText]
    ) -> dict[str | int, int]:
        return await self._record_rejections(
            "user_file_chunk",
            embedded_text_sql="COALESCE(embedding_text, text)",
            embedding_model_id=embedding_model_id,
            items=items,
        )

    async def record_passage_rejections(
        self, *, embedding_model_id: str, items: Sequence[StaleEmbeddingText]
    ) -> dict[str | int, int]:
        return await self._record_rejections(
            "archive_passages", embedded_text_sql="text", embedding_model_id=embedding_model_id, items=items
        )

    async def mark_embedded_files_ready(self, *, owner_id: str, embedding_model_id: str) -> None:
        await self._s.execute(
            text("""
                UPDATE user_file f SET status = 'ready', updated_at = CURRENT_TIMESTAMP
                WHERE f.user_id = :owner_id
                    AND f.status = 'ready_keyword_only'
                    AND EXISTS (SELECT 1 FROM user_file_chunk c WHERE c.file_id = f.id)
                    AND NOT EXISTS (
                        SELECT 1 FROM user_file_chunk c
                        WHERE c.file_id = f.id AND c.embedding_model_id IS DISTINCT FROM :embedding_model_id
                    )
            """),
            {"owner_id": owner_id, "embedding_model_id": embedding_model_id},
        )

    async def _store_vectors(
        self,
        table: str,
        *,
        embedded_text_sql: str,
        embedding_model_id: str,
        vectors: Sequence[tuple[StaleEmbeddingText, list[float] | None]],
    ) -> None:
        # The text guards skip rows edited or reprocessed since they were read;
        # they stay stale and are embedded again with their new text.
        statement = text(f"""
            UPDATE {table}
            SET embedding = CAST(:embedding AS vector), embedding_model_id = :embedding_model_id,
                embedding_rejections = 0, embedding_rejected_model_id = NULL
            WHERE id = :id AND text = :text AND {embedded_text_sql} = :embedding_input
        """)
        for item, vector in vectors:
            await self._s.execute(
                statement,
                {
                    "id": item.id,
                    "text": item.text,
                    "embedding_input": item.embedding_input,
                    "embedding": str([float(value) for value in vector]) if vector is not None else None,
                    "embedding_model_id": embedding_model_id,
                },
            )

    async def _record_rejections(
        self,
        table: str,
        *,
        embedded_text_sql: str,
        embedding_model_id: str,
        items: Sequence[StaleEmbeddingText],
    ) -> dict[str | int, int]:
        # Rejections by an earlier model start a new count; edited rows are skipped.
        statement = text(f"""
            UPDATE {table}
            SET embedding_rejections = CASE
                    WHEN embedding_rejected_model_id = :embedding_model_id THEN embedding_rejections + 1
                    ELSE 1
                END,
                embedding_rejected_model_id = :embedding_model_id
            WHERE id = :id AND text = :text AND {embedded_text_sql} = :embedding_input
            RETURNING embedding_rejections
        """)
        counts: dict[str | int, int] = {}
        for item in items:
            result = await self._s.execute(
                statement,
                {
                    "id": item.id,
                    "text": item.text,
                    "embedding_input": item.embedding_input,
                    "embedding_model_id": embedding_model_id,
                },
            )
            count = result.scalar_one_or_none()
            if count is not None:
                counts[item.id] = int(count)
        return counts


__all__ = ["SQLAlchemyEmbeddingRefreshRepository"]
