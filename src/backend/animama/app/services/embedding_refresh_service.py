"""Re-embed stored upload chunks and archive passages for the embeddings role.

When the owner assigns a different embeddings model, existing vectors belong to
the old model and are never compared with the new one. This service replaces
them in batches. Text the model rejects (too long, or refused while other texts
succeed) and blank text are recorded as having no vector, so one bad passage
cannot stall the rest.
"""

from __future__ import annotations

from collections.abc import Sequence

from animama.app.model_clients import ModelClientError
from animama.app.model_clients.error_categories import (
    ERROR_BAD_REQUEST,
    ERROR_CONTEXT_EXCEEDED,
    ERROR_PROVIDER_ERROR,
    model_error_category,
)
from animama.app.ports.embedding_refresh_port import (
    EmbeddingRefreshCounts,
    EmbeddingRefreshRepository,
    StaleEmbeddingText,
)
from animama.app.ports.text_embedder import TextEmbedder
from animama.app.ports.uow_port import UnitOfWork
from animama.logging import get_logger

DEFAULT_EMBEDDING_REFRESH_BATCH_SIZE = 32
# Failures that may come from one text rather than the model or server. Server
# errors are excluded: they are usually temporary (a model still loading), and
# llama.cpp's oversized-input 500 already counts as context exceeded.
_PER_TEXT_CATEGORIES = frozenset({ERROR_CONTEXT_EXCEEDED, ERROR_BAD_REQUEST, ERROR_PROVIDER_ERROR})


class EmbeddingRefreshError(RuntimeError):
    """The embeddings model returned an unusable answer for a batch."""


class EmbeddingRefreshService:
    def __init__(
        self,
        *,
        store: EmbeddingRefreshRepository,
        uow: UnitOfWork,
        batch_size: int = DEFAULT_EMBEDDING_REFRESH_BATCH_SIZE,
    ) -> None:
        self._store = store
        self._uow = uow
        self._batch_size = max(1, batch_size)
        self._log = get_logger("app.services.embedding_refresh")

    async def pending(self, *, owner_id: str, embedding_model_id: str) -> EmbeddingRefreshCounts:
        return await self._store.count_stale(owner_id=owner_id, embedding_model_id=embedding_model_id)

    async def refresh_batch(self, *, owner_id: str, embedder: TextEmbedder) -> int:
        """Re-embed one batch of stale chunks, else passages; return the rows handled.

        Returns 0 when every stored vector already comes from ``embedder``.
        """

        model_id = embedder.model_id
        chunks = await self._store.stale_chunks(owner_id=owner_id, embedding_model_id=model_id, limit=self._batch_size)
        if chunks:
            vectors = await self._embed(embedder, chunks)
            await self._store.store_chunk_vectors(embedding_model_id=model_id, vectors=vectors)
            await self._store.mark_embedded_files_ready(owner_id=owner_id, embedding_model_id=model_id)
            await self._uow.commit()
            return len(chunks)
        passages = await self._store.stale_passages(
            owner_id=owner_id, embedding_model_id=model_id, limit=self._batch_size
        )
        if passages:
            vectors = await self._embed(embedder, passages)
            await self._store.store_passage_vectors(embedding_model_id=model_id, vectors=vectors)
            await self._uow.commit()
            return len(passages)
        return 0

    async def _embed(
        self,
        embedder: TextEmbedder,
        items: Sequence[StaleEmbeddingText],
    ) -> list[tuple[StaleEmbeddingText, list[float] | None]]:
        # Blank text has nothing to embed; record it so it is not retried.
        results: list[tuple[StaleEmbeddingText, list[float] | None]] = [
            (item, None) for item in items if not item.embedding_input.strip()
        ]
        texts = [item for item in items if item.embedding_input.strip()]
        if texts:
            results.extend(await self._embed_texts(embedder, texts))
        return results

    async def _embed_texts(
        self,
        embedder: TextEmbedder,
        items: Sequence[StaleEmbeddingText],
    ) -> list[tuple[StaleEmbeddingText, list[float] | None]]:
        try:
            vectors = await embedder.embed_texts([item.embedding_input for item in items])
        except ModelClientError as exc:
            category = model_error_category(exc.code, exc.raw_metadata)
            if category == ERROR_CONTEXT_EXCEEDED and len(items) == 1:
                self._log.warning(
                    "Text is too long for the embeddings model; it will not be found by semantic search",
                    embedding_model_id=embedder.model_id,
                    input_chars=len(items[0].embedding_input),
                )
                return [(items[0], None)]
            if category not in _PER_TEXT_CATEGORIES or len(items) == 1:
                raise
            return await self._embed_one_by_one(embedder, items, batch_error=exc)
        if len(vectors) != len(items) or not all(vectors):
            raise EmbeddingRefreshError(f"The embeddings model returned {len(vectors)} vectors for {len(items)} texts")
        return [(item, [float(value) for value in vector]) for item, vector in zip(items, vectors, strict=True)]

    async def _embed_one_by_one(
        self,
        embedder: TextEmbedder,
        items: Sequence[StaleEmbeddingText],
        *,
        batch_error: ModelClientError,
    ) -> list[tuple[StaleEmbeddingText, list[float] | None]]:
        """Find the texts the model rejects instead of failing the whole batch.

        A text is recorded without a vector only when others in the batch were
        embedded; when every text fails, the model or server is at fault and
        the batch fails so it is retried.
        """

        embedded: list[tuple[StaleEmbeddingText, list[float] | None]] = []
        rejected: list[StaleEmbeddingText] = []
        for item in items:
            try:
                embedded.extend(await self._embed_texts(embedder, [item]))
            except ModelClientError as exc:
                if model_error_category(exc.code, exc.raw_metadata) not in _PER_TEXT_CATEGORIES:
                    raise
                rejected.append(item)
        if rejected and not embedded:
            raise batch_error
        for item in rejected:
            self._log.warning(
                "The embeddings model rejected a text; it will not be found by semantic search",
                embedding_model_id=embedder.model_id,
                input_chars=len(item.embedding_input),
            )
        return embedded + [(item, None) for item in rejected]


__all__ = ["DEFAULT_EMBEDDING_REFRESH_BATCH_SIZE", "EmbeddingRefreshError", "EmbeddingRefreshService"]
