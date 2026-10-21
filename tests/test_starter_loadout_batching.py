"""A starter loadout reads, locks and writes its pools in batches (#630 requirement 6)."""

from __future__ import annotations

from dataclasses import replace
from unittest.mock import Mock
from uuid import uuid4

import pytest
from sqlalchemy import delete, text, update
from sqlalchemy.exc import DBAPIError

from animama.adapters.repositories.sqlalchemy.content_catalog_repo import (
    SHARED_CATALOG_ROWS_IMMUTABLE,
    SQLAlchemyContentCatalog,
)
from animama.app.services import anima_loadout_service
from animama.app.services.anima_loadout_service import AnimaLoadoutService
from animama.app.services.starter_loadout_policy import starter_reaction_pools
from animama.domain.anima_creation import ResolvedIdleMember
from animama.domain.anima_loadout import AnimaLoadoutError
from animama.orm.anima_loadout import ORMAnimaLoadout
from animama.orm.content_catalog import ORMContentCatalogItem
from tests.statement_counting import counted_statements
from tests.test_anima_idle_pool import _idle_gesture
from tests.test_anima_reaction_pools import _included_reaction
from tests.typed_loadout_support import LoadoutFixture, cleanup_loadout_fixture, create_loadout_fixture

# Distinct starter policy keys, so each test Reaction fills a policy slot.
STARTER_KEYS = list(dict.fromkeys(key for keys in starter_reaction_pools(1).values() for key in keys))


def _idle(monkeypatch: pytest.MonkeyPatch, members: list[ResolvedIdleMember]) -> None:
    """Seed the starter Idle pool with ``members`` instead of the installed seed."""

    async def resolved(**_: object) -> tuple[ResolvedIdleMember, ...]:
        return tuple(members)

    monkeypatch.setattr(anima_loadout_service, "resolve_starter_idle_pool", resolved)


async def _pools(session, fixture: LoadoutFixture, size: int) -> tuple[list[str], list[ResolvedIdleMember]]:  # noqa: ANN001
    """``size`` Included starter Reactions and ``size`` owner Idle Gestures, committed."""

    reactions = [
        (await _included_reaction(session, key, f"Starter {index}")).id for index, key in enumerate(STARTER_KEYS[:size])
    ]
    catalog = SQLAlchemyContentCatalog(session)
    idle = []
    for index in range(size):
        gesture = await _idle_gesture(session, fixture, f"Idle {index} {uuid4().hex[:6]}")
        entry = await catalog.get_visible_item(item_id=gesture.id, user_id=fixture.user_id)
        assert entry is not None
        idle.append(ResolvedIdleMember(entry, "default"))
    return reactions, idle


async def _fixture(session) -> LoadoutFixture:  # noqa: ANN001
    fixture = await create_loadout_fixture(session)
    await session.execute(delete(ORMAnimaLoadout).where(ORMAnimaLoadout.anima_id == fixture.anima_id))
    await session.commit()
    return fixture


async def _cleanup(factory, fixture: LoadoutFixture, reactions: list[str]) -> None:  # noqa: ANN001
    async with factory() as cleanup:
        await cleanup_loadout_fixture(cleanup, fixture)
        await cleanup.execute(delete(ORMContentCatalogItem).where(ORMContentCatalogItem.id.in_(reactions)))
        await cleanup.commit()


async def _edit_blocked(factory, item_id: str) -> bool:  # noqa: ANN001
    """Whether another transaction's edit of ``item_id`` waits on a row lock."""

    async with factory() as editor:
        await editor.execute(text("SET LOCAL lock_timeout = '100ms'"))
        try:
            await editor.execute(
                update(ORMContentCatalogItem).where(ORMContentCatalogItem.id == item_id).values(display_name="Edit")
            )
        except DBAPIError as error:
            assert getattr(error.orig, "sqlstate", None) == "55P03", error
            return True
        finally:
            await editor.rollback()
    return False


@pytest.mark.asyncio
async def test_starting_a_loadout_locks_every_pool_member_until_commit(
    async_session_factory,  # noqa: ANN001
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async with async_session_factory() as setup:
        fixture = await _fixture(setup)
        reactions, idle = await _pools(setup, fixture, 1)
    _idle(monkeypatch, idle)
    members = [reactions[0], idle[0].source.id]
    try:
        async with async_session_factory() as starter:
            await AnimaLoadoutService(starter).create_starter_loadout(
                user_id=fixture.user_id, anima_id=fixture.anima_id, store=Mock()
            )
            assert [await _edit_blocked(async_session_factory, item) for item in members] == [True, True]
            await starter.rollback()
        # The locks were the starter transaction's: they end with it.
        assert [await _edit_blocked(async_session_factory, item) for item in members] == [False, False]
    finally:
        await _cleanup(async_session_factory, fixture, reactions)


@pytest.mark.asyncio
async def test_a_composition_with_immutable_shared_rows_locks_only_owner_rows(
    async_session_factory,  # noqa: ANN001
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async with async_session_factory() as setup:
        fixture = await _fixture(setup)
        reactions, idle = await _pools(setup, fixture, 1)
    _idle(monkeypatch, idle)
    shared, owned = reactions[0], idle[0].source.id
    try:
        async with async_session_factory() as starter:
            starter.info[SHARED_CATALOG_ROWS_IMMUTABLE] = True
            await AnimaLoadoutService(starter).create_starter_loadout(
                user_id=fixture.user_id, anima_id=fixture.anima_id, store=Mock()
            )
            assert await _edit_blocked(async_session_factory, shared) is False
            assert await _edit_blocked(async_session_factory, owned) is True
            loadout = await AnimaLoadoutService(starter).read_model(user_id=fixture.user_id, anima_id=fixture.anima_id)
            assert [member.item_id for member in loadout.idle.default_pool] == [owned]
            assert shared in {member.item_id for cell in loadout.reactions for member in cell.members}
            await starter.rollback()
        async with async_session_factory() as reader:
            reader.info[SHARED_CATALOG_ROWS_IMMUTABLE] = True
            catalog = SQLAlchemyContentCatalog(reader)
            for item_id, blocked in ((shared, False), (owned, True)):
                entry = await catalog.get_visible_item(item_id=item_id, user_id=fixture.user_id, for_update=True)
                assert entry is not None
                assert await _edit_blocked(async_session_factory, item_id) is blocked
            await reader.rollback()
    finally:
        await _cleanup(async_session_factory, fixture, reactions)


@pytest.mark.asyncio
async def test_the_first_failing_idle_member_decides_the_error(
    async_session_factory,  # noqa: ANN001
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async with async_session_factory() as setup:
        fixture = await _fixture(setup)
        reactions, (valid, other) = await _pools(setup, fixture, 2)
        missing = ResolvedIdleMember(replace(other.source, id=f"gesture-{uuid4().hex}"), "default")
        stale = ResolvedIdleMember(replace(other.source, revision_sha256="0" * 64), "default")
    try:
        for members, code in (
            ([valid, stale, missing], "loadout_source_stale"),
            ([valid, missing, stale], "loadout_source_unavailable"),
        ):
            _idle(monkeypatch, members)
            async with async_session_factory() as starter:
                with pytest.raises(AnimaLoadoutError, match=code):
                    await AnimaLoadoutService(starter).create_starter_loadout(
                        user_id=fixture.user_id, anima_id=fixture.anima_id, store=Mock()
                    )
                await starter.rollback()
    finally:
        await _cleanup(async_session_factory, fixture, reactions)


@pytest.mark.asyncio
async def test_the_statement_count_does_not_grow_with_the_pools(
    async_session_factory,  # noqa: ANN001
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    counts = []
    for size in (1, 4):
        async with async_session_factory() as setup:
            fixture = await _fixture(setup)
            reactions, idle = await _pools(setup, fixture, size)
        _idle(monkeypatch, idle)
        try:
            async with async_session_factory() as starter:
                with counted_statements(starter) as statements:
                    await AnimaLoadoutService(starter).create_starter_loadout(
                        user_id=fixture.user_id, anima_id=fixture.anima_id, store=Mock()
                    )
                loadout = await AnimaLoadoutService(starter).read_model(
                    user_id=fixture.user_id, anima_id=fixture.anima_id
                )
                assert len(loadout.idle.default_pool) == size
                assert len({member.item_id for cell in loadout.reactions for member in cell.members}) == size
                counts.append(len(statements))
                await starter.rollback()
        finally:
            await _cleanup(async_session_factory, fixture, reactions)
    assert counts[0] == counts[1], counts
