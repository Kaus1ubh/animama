"""Re-embed stored upload chunks and archive passages for the embeddings role.

When the owner assigns a different embeddings model, existing vectors belong to
the old model and are never compared with the new one. This service replaces
them in batches. Text the model rejects (too long, refused while other texts
succeed, or refused on its own three times) and blank text are recorded as
having no vector, so one bad passage cannot stall the rest.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable, Sequence

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
# Isolated rejections of one text by one model before it is recorded without a
# vector. Earlier passes fail, so the role reports ``retrying`` meanwhile.
MAX_TEXT_REJECTIONS = 3
# Embedded to tell a text the model refuses from a model or server that refuses
# everything right now; it contains no owner content.
_MODEL_CHECK_TEXT = "Animama embeddings check"

_Vectors = list[tuple[StaleEmbeddingText, list[float] | None]]
_RecordRejections = Callable[..., Awaitable[dict[str | int, int]]]


class EmbeddingRefreshError(RuntimeError):
    """The embeddings model returned an unusable answer for a batch."""


class _TextsRejected(Exception):
    """Each text was sent on its own and rejected with a per-text category."""

    def __init__(self, items: Sequence[StaleEmbeddingText], error: ModelClientError) -> None:
        super().__init__(str(error))
        self.items = list(items)
        self.error = error


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
            vectors = await self._embed_batch(embedder, chunks, record_rejections=self._store.record_chunk_rejections)
            await self._store.store_chunk_vectors(embedding_model_id=model_id, vectors=vectors)
            await self._store.mark_embedded_files_ready(owner_id=owner_id, embedding_model_id=model_id)
            await self._uow.commit()
            return len(vectors)
        passages = await self._store.stale_passages(
            owner_id=owner_id, embedding_model_id=model_id, limit=self._batch_size
        )
        if passages:
            vectors = await self._embed_batch(
                embedder, passages, record_rejections=self._store.record_passage_rejections
            )
            await self._store.store_passage_vectors(embedding_model_id=model_id, vectors=vectors)
            await self._uow.commit()
            return len(vectors)
        return 0

    async def _embed_batch(
        self,
        embedder: TextEmbedder,
        items: Sequence[StaleEmbeddingText],
        *,
        record_rejections: _RecordRejections,
    ) -> _Vectors:
        """Embed a batch; when every text is rejected on its own, count the rejections.

        The batch still fails, so it is retried, until a text reaches
        ``MAX_TEXT_REJECTIONS``; that text is then recorded without a vector.
        Rejections count only while the model embeds a known check text: a
        model or server that refuses everything (misconfigured, or failing
        right now) keeps retrying instead of dropping vectors.
        """

        try:
            return await self._embed(embedder, items)
        except _TextsRejected as rejected:
            model_id = embedder.model_id
            if not await self._model_embeds_now(embedder):
                raise rejected.error from None
            counts = await record_rejections(embedding_model_id=model_id, items=rejected.items)
            exhausted = [item for item in rejected.items if counts.get(item.id, 0) >= MAX_TEXT_REJECTIONS]
            if not exhausted:
                await self._uow.commit()
                raise rejected.error from None
            for item in exhausted:
                self._log.warning(
                    "The embeddings model always rejects a text; it will not be found by semantic search",
                    embedding_model_id=model_id,
                    input_chars=len(item.embedding_input),
                    rejections=counts[item.id],
                )
            return [(item, None) for item in exhausted]

    @staticmethod
    async def _model_embeds_now(embedder: TextEmbedder) -> bool:
        try:
            vectors = await embedder.embed_texts([_MODEL_CHECK_TEXT])
        except ModelClientError:
            return False
        return len(vectors) == 1 and bool(vectors[0])

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
            if category not in _PER_TEXT_CATEGORIES:
                raise
            if len(items) == 1:
                raise _TextsRejected(items, exc) from exc
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

        A text is recorded without a vector at once when others in the batch
        were embedded; when every text fails, the batch fails so it is retried
        (see ``_embed_batch``).
        """

        embedded: list[tuple[StaleEmbeddingText, list[float] | None]] = []
        rejected: list[StaleEmbeddingText] = []
        for item in items:
            try:
                embedded.extend(await self._embed_texts(embedder, [item]))
            except _TextsRejected:
                rejected.append(item)
        if rejected and not embedded:
            raise _TextsRejected(rejected, batch_error)
        for item in rejected:
            self._log.warning(
                "The embeddings model rejected a text; it will not be found by semantic search",
                embedding_model_id=embedder.model_id,
                input_chars=len(item.embedding_input),
            )
        return embedded + [(item, None) for item in rejected]


__all__ = [
    "DEFAULT_EMBEDDING_REFRESH_BATCH_SIZE",
    "MAX_TEXT_REJECTIONS",
    "EmbeddingRefreshError",
    "EmbeddingRefreshService",
]
