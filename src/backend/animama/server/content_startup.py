"""Startup reconciliation and invalidation watcher for readable content."""

from __future__ import annotations

import asyncio
from contextlib import suppress

from fastapi import FastAPI
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from animama.adapters.content_store import ContentWatcher
from animama.adapters.repositories.sqlalchemy.content_catalog_repo import SQLAlchemyContentCatalog
from animama.adapters.repositories.sqlalchemy.content_transition_repo import SQLAlchemyContentTransitionBindings
from animama.app.services.anima_runtime_service import AnimaRuntimeService
from animama.app.services.content_catalog_service import ContentCatalogService
from animama.app.services.content_package_staging import PackageStageService
from animama.app.services.content_transition_service import ContentTransitionService
from animama.logging_config import get_logger
from animama.server.deps import get_async_session_factory
from animama.server.local_runtime import LocalRuntimePaths, local_content_store

_log = get_logger("server.content_startup")


async def rescan_content_once(
    paths: LocalRuntimePaths,
    *,
    owner_id: str,
    session_factory: async_sessionmaker[AsyncSession],
    include_included: bool = True,
) -> None:
    """Rebuild the authoritative catalog after schema availability."""

    async with session_factory() as session:
        catalog = SQLAlchemyContentCatalog(session)
        service = ContentCatalogService(
            store=local_content_store(paths),
            catalog=catalog,
        )
        await ContentTransitionService(
            content=service, bindings=SQLAlchemyContentTransitionBindings(session)
        ).transition(user_id=owner_id, include_included=include_included)


async def start_content_runtime(
    app: FastAPI,
    *,
    owner_id: str,
    perform_initial_scan: bool = True,
) -> None:
    """Start cleanup and validated change reconciliation for local content."""

    paths: LocalRuntimePaths = app.state.local_runtime_paths
    try:
        # Package stages are private transient work, separate from Local mutation
        # recovery. Their OS leases protect active requests across processes.
        await asyncio.to_thread(
            PackageStageService(paths.imports_staging_root, paths.exports_staging_root).sweep_expired
        )
        # Bootstrap and explicit scans recover Local journals under the catalog
        # source fence. Never restore files independently after bootstrap scans.
        session_factory = get_async_session_factory(app)
        async with session_factory() as session:
            await AnimaRuntimeService(session).cleanup_expired()
            await session.commit()
        if perform_initial_scan:
            await rescan_content_once(paths, owner_id=owner_id, session_factory=session_factory)
    except Exception as exc:
        # reset.sh may still be applying Alembic on a brand-new database. It
        # runs a post-migration scan explicitly, so serving health stays safe.
        _log.warning("Local content startup scan deferred", error=str(exc), exc_type=exc.__class__.__name__)

    watcher = ContentWatcher(
        included_root=paths.included_root, local_root=paths.local_root, watch_included=not paths.included_sources
    )
    rescan_requested = asyncio.Event()

    async def reconcile_changes() -> None:
        """Coalesce filesystem bursts before asking the scanner to admit bytes."""

        while True:
            await rescan_requested.wait()
            rescan_requested.clear()

            # Creator saves and manual file copies commonly produce several
            # adjacent notifications.  Wait for a quiet window so only stable
            # files reach the scanner.
            while True:
                await asyncio.sleep(0.35)
                if not rescan_requested.is_set():
                    break
                rescan_requested.clear()

            try:
                await rescan_content_once(
                    paths,
                    owner_id=owner_id,
                    session_factory=get_async_session_factory(app),
                    include_included=not paths.included_sources,
                )
            except Exception as exc:
                _log.warning(
                    "Changed content could not be reconciled",
                    error=str(exc),
                    exc_type=exc.__class__.__name__,
                )

    async def invalidate(source, relative_paths: tuple[str, ...]) -> None:  # noqa: ANN001
        try:
            session_factory = get_async_session_factory(app)
            async with session_factory() as session:
                await ContentCatalogService(
                    store=local_content_store(paths), catalog=SQLAlchemyContentCatalog(session)
                ).invalidate_watched_changes(
                    source=source,
                    relative_paths=relative_paths,
                )
            rescan_requested.set()
        except Exception as exc:
            _log.warning(
                "Local content watcher could not invalidate catalog",
                source=source.value,
                error=str(exc),
                exc_type=exc.__class__.__name__,
            )

    app.state.content_rescan_task = asyncio.create_task(reconcile_changes())
    app.state.content_watcher_task = asyncio.create_task(watcher.run(invalidate))


async def stop_content_runtime(app: FastAPI) -> None:
    tasks = tuple(
        task
        for task in (
            getattr(app.state, "content_watcher_task", None),
            getattr(app.state, "content_rescan_task", None),
        )
        if task is not None
    )
    for task in tasks:
        task.cancel()
    for task in tasks:
        with suppress(asyncio.CancelledError):
            await task


__all__ = ["rescan_content_once", "start_content_runtime", "stop_content_runtime"]
