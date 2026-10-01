"""Repository protocol for re-embedding stored chunks and archive passages."""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Protocol


@dataclass(frozen=True, slots=True)
class StaleEmbeddingText:
    """A stored text whose vector is missing or from another embedding model.

    ``text`` guards the write: a vector is stored only while the row still
    holds this text. ``embedding_input`` is what the model embeds.
    """

    id: str | int
    text: str
    embedding_input: str


@dataclass(frozen=True, slots=True)
class EmbeddingRefreshCounts:
    """Rows of one owner still waiting for a vector from the current model."""

    chunks: int = 0
    passages: int = 0

    @property
    def total(self) -> int:
        return self.chunks + self.passages


class EmbeddingRefreshRepository(Protocol):
    """Find and update vectors that do not come from an owner's embeddings model."""

    async def owners_with_embeddable_content(self) -> list[str]:
        raise NotImplementedError

    async def count_stale(self, *, owner_id: str, embedding_model_id: str) -> EmbeddingRefreshCounts:
        raise NotImplementedError

    async def stale_chunks(self, *, owner_id: str, embedding_model_id: str, limit: int) -> list[StaleEmbeddingText]:
        """Return searchable upload chunks whose vector is missing or from another model."""

        raise NotImplementedError

    async def stale_passages(self, *, owner_id: str, embedding_model_id: str, limit: int) -> list[StaleEmbeddingText]:
        """Return archive passages of the owner's Animas whose vector is missing or from another model."""

        raise NotImplementedError

    async def store_chunk_vectors(
        self,
        *,
        embedding_model_id: str,
        vectors: Sequence[tuple[StaleEmbeddingText, list[float] | None]],
    ) -> None:
        """Store vectors; ``None`` records that the model cannot embed that text."""

        raise NotImplementedError

    async def store_passage_vectors(
        self,
        *,
        embedding_model_id: str,
        vectors: Sequence[tuple[StaleEmbeddingText, list[float] | None]],
    ) -> None:
        raise NotImplementedError

    async def record_chunk_rejections(
        self, *, embedding_model_id: str, items: Sequence[StaleEmbeddingText]
    ) -> dict[str | int, int]:
        """Count one isolated rejection of each chunk; return each row's count for this model."""

        raise NotImplementedError

    async def record_passage_rejections(
        self, *, embedding_model_id: str, items: Sequence[StaleEmbeddingText]
    ) -> dict[str | int, int]:
        """Count one isolated rejection of each archive passage, as for chunks."""

        raise NotImplementedError

    async def mark_embedded_files_ready(self, *, owner_id: str, embedding_model_id: str) -> None:
        """Mark keyword-only files ready once every chunk has a current vector."""

        raise NotImplementedError


__all__ = ["EmbeddingRefreshCounts", "EmbeddingRefreshRepository", "StaleEmbeddingText"]
