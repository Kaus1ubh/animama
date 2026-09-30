"""Background re-embedding for the local composition.

One task, started by the application lifespan, keeps every stored upload chunk
and archive passage on its owner's embeddings model. It works in batches, rests
while nothing is stale, wakes early when the embeddings role changes, and backs
off after a failure. While rows are stale, search uses keyword retrieval.
"""

from __future__ import annotations

import asyncio
from contextlib import suppress
from dataclasses import dataclass
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from animama.adapters.repositories.sqlalchemy.embedding_refresh_repo import SQLAlchemyEmbeddingRefreshRepository
from animama.adapters.repositories.sqlalchemy.uow import SQLAlchemyUnitOfWork
from animama.app.model_clients import ModelClientError
from animama.app.model_clients.error_categories import ERROR_PROVIDER_ERROR, model_error_category
from animama.app.ports.embedding_refresh_port import EmbeddingRefreshCounts
from animama.app.services.embedding_refresh_service import EmbeddingRefreshService
from animama.logging import get_logger
from animama.server.embeddings import role_embedder
from animama.server.model_roles import ModelRoleSettings
from animama.server.runtime_credentials import runtime_credentials

EMBEDDING_REFRESH_IDLE_SECONDS = 60.0
EMBEDDING_REFRESH_MIN_BACKOFF_SECONDS = 5.0
EMBEDDING_REFRESH_MAX_BACKOFF_SECONDS = 600.0

EMBEDDINGS_STATE_OFF = "off"
EMBEDDINGS_STATE_CURRENT = "current"
EMBEDDINGS_STATE_REEMBEDDING = "re_embedding"
EMBEDDINGS_STATE_RETRYING = "retrying"

_STATE_ATTR = "embedding_refresh_worker"
_log = get_logger("server.embedding_refresh")


@dataclass(frozen=True, slots=True)
class EmbeddingRefreshStatus:
    """Re-embedding progress for one owner, reported with the embeddings role."""

    state: str
    pending: int = 0
    error_category: str | None = None


class EmbeddingRefreshWorker:
    """Re-embed stale vectors for every owner until each matches its embeddings role."""

    def __init__(
        self,
        session_factory: async_sessionmaker[AsyncSession],
        *,
        roles: ModelRoleSettings,
        idle_seconds: float = EMBEDDING_REFRESH_IDLE_SECONDS,
    ) -> None:
        self._session_factory = session_factory
        self._roles = roles
        self._idle_seconds = idle_seconds
        self._wake = asyncio.Event()
        self._errors: dict[str, str] = {}
        self._task: asyncio.Task[None] | None = None

    def start(self) -> None:
        if self._task is None:
            self._task = asyncio.create_task(self._run(), name="embedding-refresh")

    async def stop(self) -> None:
        if self._task is not None:
            self._task.cancel()
            with suppress(asyncio.CancelledError):
                await self._task
            self._task = None

    def wake(self) -> None:
        """Start the next pass now, for example after the embeddings role changed."""

        self._wake.set()

    def error_category(self, owner_id: str) -> str | None:
        """Return the category of the owner's last failed batch, if it has not recovered."""

        return self._errors.get(owner_id)

    async def refresh_once(self) -> tuple[bool, bool]:
        """Run one batch for each owner; return ``(progressed, failed)``."""

        progressed = failed = False
        async with self._session_factory() as session:
            owners = await SQLAlchemyEmbeddingRefreshRepository(session).owners_with_embeddable_content()
        for owner_id in owners:
            async with self._session_factory() as session:
                try:
                    handled = await self._refresh_owner(session, owner_id)
                except Exception as exc:
                    await session.rollback()
                    failed = True
                    self._errors[owner_id] = _error_category(exc)
                    _log.warning(
                        "Re-embedding batch failed",
                        owner_id=owner_id,
                        error_category=self._errors[owner_id],
                        error_type=exc.__class__.__name__,
                    )
                    continue
            self._errors.pop(owner_id, None)
            progressed = progressed or handled > 0
        return progressed, failed

    async def _refresh_owner(self, session: AsyncSession, owner_id: str) -> int:
        # One key for the whole batch, even if keys change while it runs.
        with runtime_credentials.pinned():
            embedder = await role_embedder(session, owner_id, self._roles)
            if embedder is None:
                return 0
            service = EmbeddingRefreshService(
                store=SQLAlchemyEmbeddingRefreshRepository(session),
                uow=SQLAlchemyUnitOfWork(session),
            )
            return await service.refresh_batch(owner_id=owner_id, embedder=embedder)

    async def _run(self) -> None:
        backoff = 0.0
        while True:
            try:
                progressed, failed = await self.refresh_once()
            except Exception as exc:
                # Database unavailable or similar; retry like a failed batch.
                _log.warning("Re-embedding pass failed", error_type=exc.__class__.__name__)
                progressed, failed = False, True
            if failed and not progressed:
                backoff = min(
                    max(backoff * 2, EMBEDDING_REFRESH_MIN_BACKOFF_SECONDS), EMBEDDING_REFRESH_MAX_BACKOFF_SECONDS
                )
                await self._rest(backoff)
            elif progressed:
                backoff = 0.0
                await asyncio.sleep(0)
            else:
                backoff = 0.0
                await self._rest(self._idle_seconds)

    async def _rest(self, seconds: float) -> None:
        with suppress(TimeoutError):
            await asyncio.wait_for(self._wake.wait(), timeout=seconds)
        self._wake.clear()


def _error_category(exc: BaseException) -> str:
    if isinstance(exc, ModelClientError):
        return model_error_category(exc.code, exc.raw_metadata)
    return ERROR_PROVIDER_ERROR


def start_embedding_refresh(app: Any, *, session_factory: async_sessionmaker[AsyncSession]) -> None:
    worker = EmbeddingRefreshWorker(session_factory, roles=ModelRoleSettings.for_app(app))
    setattr(app.state, _STATE_ATTR, worker)
    worker.start()


async def stop_embedding_refresh(app: Any) -> None:
    worker = get_embedding_refresh_worker(app)
    if worker is not None:
        await worker.stop()


def wake_embedding_refresh(app: Any) -> None:
    """Re-check stored vectors now; call after preferences or models change."""

    worker = get_embedding_refresh_worker(app)
    if worker is not None:
        worker.wake()


def get_embedding_refresh_worker(app: Any) -> EmbeddingRefreshWorker | None:
    worker = getattr(app.state, _STATE_ATTR, None)
    return worker if isinstance(worker, EmbeddingRefreshWorker) else None


async def embedding_refresh_status(
    session: AsyncSession,
    *,
    owner_id: str,
    embedding_model_id: str | None,
    worker: EmbeddingRefreshWorker | None,
) -> EmbeddingRefreshStatus:
    """Report whether the owner's stored vectors match the embeddings role."""

    if embedding_model_id is None:
        return EmbeddingRefreshStatus(state=EMBEDDINGS_STATE_OFF)
    counts: EmbeddingRefreshCounts = await EmbeddingRefreshService(
        store=SQLAlchemyEmbeddingRefreshRepository(session),
        uow=SQLAlchemyUnitOfWork(session),
    ).pending(owner_id=owner_id, embedding_model_id=embedding_model_id)
    if counts.total == 0:
        return EmbeddingRefreshStatus(state=EMBEDDINGS_STATE_CURRENT)
    error_category = worker.error_category(owner_id) if worker is not None else None
    return EmbeddingRefreshStatus(
        state=EMBEDDINGS_STATE_RETRYING if error_category else EMBEDDINGS_STATE_REEMBEDDING,
        pending=counts.total,
        error_category=error_category,
    )


__all__ = [
    "EMBEDDINGS_STATE_CURRENT",
    "EMBEDDINGS_STATE_OFF",
    "EMBEDDINGS_STATE_REEMBEDDING",
    "EMBEDDINGS_STATE_RETRYING",
    "EmbeddingRefreshStatus",
    "EmbeddingRefreshWorker",
    "embedding_refresh_status",
    "get_embedding_refresh_worker",
    "start_embedding_refresh",
    "stop_embedding_refresh",
    "wake_embedding_refresh",
]
