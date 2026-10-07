"""Preview bundle row locks must not deadlock against concurrent rescans."""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from uuid import uuid4

from sqlalchemy import delete, select, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from animama.adapters.repositories.sqlalchemy.content_catalog_repo import SQLAlchemyContentCatalog
from animama.domain.content_catalog import ContentSource
from animama.orm.content_catalog import ORMContentCatalogDependency, ORMContentCatalogItem


def _item(*, item_id: str, source: ContentSource, owner_user_id: str | None) -> ORMContentCatalogItem:
    return ORMContentCatalogItem(
        id=item_id,
        source=source.value,
        scope="included" if source is ContentSource.INCLUDED else "owner",
        owner_user_id=owner_user_id,
        kind="pose",
        relative_locator=f"poses/{item_id}.json",
        display_name=item_id,
        status="valid",
        revision_sha256="a" * 64,
    )


async def _lock_source_rows(session: AsyncSession, *, source: ContentSource, item_ids: tuple[str, ...]) -> None:
    """Lock rows the way reconciliation does: one source at a time, by ID."""

    await session.execute(
        select(ORMContentCatalogItem.id)
        .where(ORMContentCatalogItem.source == source.value, ORMContentCatalogItem.id.in_(item_ids))
        .order_by(ORMContentCatalogItem.id)
        .with_for_update()
    )


async def _preview_waits_then_completes(
    factory: async_sessionmaker[AsyncSession],
    *,
    before_preview: Callable[[AsyncSession, str, str], Awaitable[None]],
    while_preview_waits: Callable[[AsyncSession, str, str], Awaitable[None]],
) -> None:
    """Interleave one rescan-like transaction with a mixed-source preview lock.

    The Local ID sorts before the Included ID, so locking by ID alone would take
    the Local row before the Included row that a full rescan locks first.
    """

    suffix = uuid4().hex
    user_id = f"owner-{suffix}"
    local_id = f"a-local-{suffix}"
    included_id = f"z-included-{suffix}"
    item_ids = (local_id, included_id)
    async with factory() as setup:
        setup.add_all(
            [
                _item(item_id=local_id, source=ContentSource.LOCAL, owner_user_id=user_id),
                _item(item_id=included_id, source=ContentSource.INCLUDED, owner_user_id=None),
            ]
        )
        await setup.commit()

    try:
        async with factory() as rescan, factory() as preview:
            await rescan.execute(text("SET lock_timeout = '5s'"))
            await before_preview(rescan, local_id, included_id)

            preview_pid = await preview.scalar(text("SELECT pg_backend_pid()"))
            preview_task = asyncio.create_task(
                SQLAlchemyContentCatalog(preview).lock_items(user_id=user_id, item_ids=item_ids)
            )
            try:
                async with factory() as observer:
                    for _ in range(200):
                        waiting = await observer.scalar(
                            text("SELECT count(*) FROM pg_locks WHERE pid = :pid AND NOT granted"),
                            {"pid": preview_pid},
                        )
                        await observer.rollback()
                        if waiting:
                            break
                        await asyncio.sleep(0.02)
                    else:
                        raise AssertionError("The preview lock never waited for the rescan")

                # Postgres aborts one side here if the preview holds a row the
                # rescan needs next.
                await while_preview_waits(rescan, local_id, included_id)
                if preview_task.done():
                    raise AssertionError(f"The preview lock failed: {preview_task.exception()!r}")
                await rescan.commit()

                await asyncio.wait_for(preview_task, timeout=5)
                await preview.commit()
            finally:
                # Stop a preview still waiting on a lock before its session closes.
                if not preview_task.done():
                    preview_task.cancel()
                await asyncio.gather(preview_task, return_exceptions=True)
    finally:
        async with factory() as cleanup:
            await cleanup.execute(
                delete(ORMContentCatalogDependency).where(ORMContentCatalogDependency.item_id.in_(item_ids))
            )
            await cleanup.execute(delete(ORMContentCatalogItem).where(ORMContentCatalogItem.id.in_(item_ids)))
            await cleanup.commit()


async def test_mixed_source_preview_lock_waits_for_full_rescan(async_session_factory) -> None:
    """A full rescan locks every Included row, then every Local row."""

    async def lock_included(session: AsyncSession, local_id: str, included_id: str) -> None:
        await _lock_source_rows(session, source=ContentSource.INCLUDED, item_ids=(local_id, included_id))

    async def lock_local(session: AsyncSession, local_id: str, included_id: str) -> None:
        await _lock_source_rows(session, source=ContentSource.LOCAL, item_ids=(local_id, included_id))

    await _preview_waits_then_completes(
        async_session_factory, before_preview=lock_included, while_preview_waits=lock_local
    )


async def test_mixed_source_preview_lock_waits_for_local_rescan(async_session_factory) -> None:
    """A Local-only rescan locks Local rows, then re-inserts dependency edges.

    Each edge's foreign-key check takes KEY SHARE on its Included target, which
    the preview has already locked.
    """

    async def lock_local(session: AsyncSession, local_id: str, included_id: str) -> None:
        await _lock_source_rows(session, source=ContentSource.LOCAL, item_ids=(local_id, included_id))

    async def insert_dependency(session: AsyncSession, local_id: str, included_id: str) -> None:
        session.add(
            ORMContentCatalogDependency(
                item_id=local_id, ordinal=1, declared_ref=included_id, target_item_id=included_id
            )
        )
        await session.flush()

    await _preview_waits_then_completes(
        async_session_factory, before_preview=lock_local, while_preview_waits=insert_dependency
    )
