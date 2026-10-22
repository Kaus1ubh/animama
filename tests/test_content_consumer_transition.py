"""Included Action copies replace only consumed equipment in one Anima revision."""

from __future__ import annotations

from collections.abc import AsyncIterator, Mapping
from dataclasses import dataclass
from pathlib import Path
from uuid import uuid4

import pytest
import pytest_asyncio
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from animama.adapters.repositories.sqlalchemy.content_transition_repo import SQLAlchemyContentTransitionBindings
from animama.app.ports.content_transition import ContentTransitionAnima
from animama.app.services.content_catalog_service import ContentCatalogService
from animama.domain.anima_definition import AnimaDefinitionError
from animama.domain.anima_loadout import reaction_slot_key
from animama.domain.content_catalog import ContentConflictError
from animama.orm.anima import ORMAnima
from animama.orm.anima_loadout import ORMAnimaLoadout
from animama.orm.content_catalog import ORMAnimaContentBinding, ORMContentCatalogItem
from tests.content_package_helpers import package_services
from tests.typed_loadout_support import LoadoutFixture, add_typed_item, cleanup_loadout_fixture, create_loadout_fixture

CONFIGS = {"gesture": {"time_scale": 0.4, "custom": {"keep": [True, "value"]}}, "reaction": {}}


@dataclass
class _Consumers:
    owner: LoadoutFixture
    content: ContentCatalogService
    originals: dict[str, str]
    replacements: dict[str, str]
    slots: dict[str, str]
    unrelated_binding: str


def _bind(session: AsyncSession, fixture: _Consumers, anima_id: str, kind: str, binding_id: str) -> None:
    """Equip one affected Included original on ``anima_id`` as an explicit row."""

    session.add(
        ORMAnimaContentBinding(
            id=binding_id,
            anima_id=anima_id,
            slot_key=fixture.slots[kind],
            kind=kind,
            catalog_item_id=fixture.originals[kind],
            config=CONFIGS[kind],
        )
    )


@pytest_asyncio.fixture
async def consumers(async_session: AsyncSession, tmp_path: Path) -> AsyncIterator[_Consumers]:
    """An Anima equipping an Included Gesture and Reaction, each with a Local replacement."""

    owner = await create_loadout_fixture(async_session)
    _, _, content, _, _ = package_services(async_session, tmp_path)
    originals, replacements = {}, {}
    for kind in ("gesture", "reaction"):
        original = await add_typed_item(
            async_session,
            owner,
            kind=kind,
            name=f"Included {kind}",
            metadata={"content_id": f"builtin:{kind}:wave-{uuid4().hex[:8]}"},
        )
        original.source, original.scope, original.owner_user_id = "included", "included", None
        await async_session.commit()
        local = await add_typed_item(async_session, owner, kind=kind, name=f"Local {kind}", metadata={})
        originals[kind], replacements[original.id] = original.id, local.id
    # A Reaction is only ever an explicit pool member; its slot names the cell and the member.
    slots = {"gesture": "gesture:wave", "reaction": reaction_slot_key("joy-3", originals["reaction"])}
    unrelated = await add_typed_item(async_session, owner, kind="gesture", name="Unrelated", metadata={})
    unrelated_binding = f"keep-{owner.suffix}"
    async_session.add(
        ORMAnimaContentBinding(
            id=unrelated_binding,
            anima_id=owner.anima_id,
            kind="gesture",
            slot_key="gesture:unrelated",
            catalog_item_id=unrelated.id,
            config={"time_scale": 0.7, "nested": {"preserve": [1, 2]}},
        )
    )
    fixture = _Consumers(owner, content, originals, replacements, slots, unrelated_binding)
    for kind in ("gesture", "reaction"):
        _bind(async_session, fixture, owner.anima_id, kind, f"explicit-{kind}-{owner.suffix}")
    anima = await async_session.get(ORMAnima, owner.anima_id)
    assert anima is not None
    anima.display_name = "Keep companion identity"
    anima.metadata_ = {"private": "preserve"}
    await async_session.commit()
    try:
        yield fixture
    finally:
        await async_session.rollback()
        await cleanup_loadout_fixture(async_session, owner)
        await async_session.execute(
            delete(ORMContentCatalogItem).where(ORMContentCatalogItem.id.in_(originals.values()))
        )
        await async_session.commit()


async def _bindings(session: AsyncSession, anima_id: str) -> list[ORMAnimaContentBinding]:
    return list(
        (
            await session.scalars(
                select(ORMAnimaContentBinding)
                .where(ORMAnimaContentBinding.anima_id == anima_id)
                .order_by(ORMAnimaContentBinding.slot_key)
                .execution_options(populate_existing=True)
            )
        ).all()
    )


async def _consumers(
    repository: SQLAlchemyContentTransitionBindings, fixture: _Consumers, *, user_id: str | None = None
):  # noqa: ANN202
    return await repository.content_consumers(
        user_id=user_id or fixture.owner.user_id, item_ids=tuple(fixture.originals.values())
    )


async def test_affected_rows_keep_their_ids_and_configs_and_are_replaced_in_place(
    async_session: AsyncSession,
    consumers: _Consumers,
) -> None:
    fixture = consumers
    repository = SQLAlchemyContentTransitionBindings(async_session)
    snapshots = await _consumers(repository, fixture)
    assert len(snapshots) == 1
    before = snapshots[0]
    assert [(selection.slot_key, selection.binding_id, selection.config) for selection in before.selections] == [
        (fixture.slots["gesture"], f"explicit-gesture-{fixture.owner.suffix}", CONFIGS["gesture"]),
        (fixture.slots["reaction"], f"explicit-reaction-{fixture.owner.suffix}", CONFIGS["reaction"]),
    ]
    async with fixture.content.mutations.catalog.mutation_transaction():
        await repository.replace_content(
            user_id=fixture.owner.user_id, before=before, replacements=fixture.replacements
        )
    rows = {row.slot_key: row for row in await _bindings(async_session, fixture.owner.anima_id)}
    assert set(rows) == {*fixture.slots.values(), "gesture:unrelated"}
    for kind, slot in fixture.slots.items():
        assert rows[slot].id == f"explicit-{kind}-{fixture.owner.suffix}"
        assert rows[slot].config == CONFIGS[kind]
        assert rows[slot].catalog_item_id == fixture.replacements[fixture.originals[kind]]
    assert rows["gesture:unrelated"].id == fixture.unrelated_binding
    assert rows["gesture:unrelated"].config == {"time_scale": 0.7, "nested": {"preserve": [1, 2]}}
    root = await async_session.get(ORMAnimaLoadout, fixture.owner.anima_id, populate_existing=True)
    anima = await async_session.get(ORMAnima, fixture.owner.anima_id, populate_existing=True)
    assert root is not None and anima is not None
    assert (root.revision, anima.aggregate_revision) == (2, 2)
    assert (anima.display_name, anima.avatar_id, anima.metadata_) == (
        "Keep companion identity",
        fixture.owner.avatar_id,
        {"private": "preserve"},
    )
    assert await _consumers(repository, fixture) == ()


async def test_an_anima_without_an_affected_row_is_not_a_consumer(
    async_session: AsyncSession,
    consumers: _Consumers,
) -> None:
    """No Included Gesture is implied: only a stored row makes an Anima a consumer."""

    fixture = consumers
    for kind in ("gesture", "reaction"):
        row = await async_session.get(ORMAnimaContentBinding, f"explicit-{kind}-{fixture.owner.suffix}")
        assert row is not None
        await async_session.delete(row)
    await async_session.commit()
    assert await _consumers(SQLAlchemyContentTransitionBindings(async_session), fixture) == ()


async def test_only_affected_items_are_selected(async_session: AsyncSession, consumers: _Consumers) -> None:
    fixture = consumers
    repository = SQLAlchemyContentTransitionBindings(async_session)
    before = (
        await repository.content_consumers(user_id=fixture.owner.user_id, item_ids=(fixture.originals["gesture"],))
    )[0]
    assert [selection.slot_key for selection in before.selections] == [fixture.slots["gesture"]]
    async with fixture.content.mutations.catalog.mutation_transaction():
        await repository.replace_content(
            user_id=fixture.owner.user_id, before=before, replacements=fixture.replacements
        )
    rows = {row.slot_key: row.catalog_item_id for row in await _bindings(async_session, fixture.owner.anima_id)}
    assert rows[fixture.slots["gesture"]] == fixture.replacements[fixture.originals["gesture"]]
    assert rows[fixture.slots["reaction"]] == fixture.originals["reaction"]


@pytest.mark.parametrize("change", ["aggregate", "loadout", "config", "occupied"])
async def test_stale_aggregate_root_or_binding_snapshot_prevents_every_replacement(
    async_session: AsyncSession,
    consumers: _Consumers,
    change: str,
) -> None:
    fixture = consumers
    repository = SQLAlchemyContentTransitionBindings(async_session)
    before = (await _consumers(repository, fixture))[0]
    root = await async_session.get(ORMAnimaLoadout, fixture.owner.anima_id)
    anima = await async_session.get(ORMAnima, fixture.owner.anima_id)
    assert root is not None and anima is not None
    if change == "aggregate":
        anima.aggregate_revision += 1
    elif change == "loadout":
        root.revision += 1
    elif change == "config":
        row = await async_session.get(ORMAnimaContentBinding, fixture.unrelated_binding)
        assert row is not None
        row.config = {"nested": {"new": [3, 4]}}
        unrelated = next(binding for binding in before.bindings if binding.binding_id == fixture.unrelated_binding)
        assert unrelated.config == {"time_scale": 0.7, "nested": {"preserve": [1, 2]}}
    else:
        async_session.add(
            ORMAnimaContentBinding(
                id=f"new-occupied-{fixture.owner.suffix}",
                anima_id=fixture.owner.anima_id,
                kind="gesture",
                slot_key="gesture:new",
                catalog_item_id=fixture.replacements[fixture.originals["gesture"]],
                config={},
            )
        )
    await async_session.commit()
    ids_before = [row.id for row in await _bindings(async_session, fixture.owner.anima_id)]
    with pytest.raises((AnimaDefinitionError, ContentConflictError)):
        async with fixture.content.mutations.catalog.mutation_transaction():
            await repository.replace_content(
                user_id=fixture.owner.user_id, before=before, replacements=fixture.replacements
            )
    assert [row.id for row in await _bindings(async_session, fixture.owner.anima_id)] == ids_before
    await async_session.refresh(root)
    await async_session.refresh(anima)
    assert (root.revision, anima.aggregate_revision) == (
        2 if change == "loadout" else 1,
        2 if change == "aggregate" else 1,
    )


async def test_grouped_replacement_rolls_back_every_row_after_late_failure(
    async_session: AsyncSession,
    consumers: _Consumers,
) -> None:
    fixture = consumers

    class InterruptedBindings(SQLAlchemyContentTransitionBindings):
        async def replace_content(
            self,
            *,
            user_id: str,
            before: ContentTransitionAnima,
            replacements: Mapping[str, str],
        ) -> None:
            await super().replace_content(user_id=user_id, before=before, replacements=replacements)
            raise RuntimeError("interrupted after grouped replacement")

    repository = InterruptedBindings(async_session)
    before = (await _consumers(repository, fixture))[0]
    with pytest.raises(RuntimeError, match="interrupted after grouped"):
        async with fixture.content.mutations.catalog.mutation_transaction():
            await repository.replace_content(
                user_id=fixture.owner.user_id, before=before, replacements=fixture.replacements
            )
    assert (await _consumers(repository, fixture))[0] == before


async def test_other_owner_cannot_snapshot_or_replace_consumers(
    async_session: AsyncSession, consumers: _Consumers
) -> None:
    fixture = consumers
    repository = SQLAlchemyContentTransitionBindings(async_session)
    assert await _consumers(repository, fixture, user_id="other-owner") == ()
    before = (await _consumers(repository, fixture))[0]
    with pytest.raises(AnimaDefinitionError):
        async with fixture.content.mutations.catalog.mutation_transaction():
            await repository.replace_content(user_id="other-owner", before=before, replacements=fixture.replacements)
    assert (await _consumers(repository, fixture))[0] == before


async def test_affected_animas_are_grouped_and_revised_independently(
    async_session: AsyncSession,
    consumers: _Consumers,
) -> None:
    fixture = consumers
    second = await create_loadout_fixture(async_session)
    try:
        anima = await async_session.get(ORMAnima, second.anima_id)
        root = await async_session.get(ORMAnimaLoadout, second.anima_id)
        assert anima is not None and root is not None
        anima.user_id = fixture.owner.user_id
        root.owner_user_id = fixture.owner.user_id
        _bind(async_session, fixture, second.anima_id, "gesture", f"second-gesture-{second.suffix}")
        await async_session.commit()
        repository = SQLAlchemyContentTransitionBindings(async_session)
        snapshots = await _consumers(repository, fixture)
        assert {before.anima_id for before in snapshots} == {fixture.owner.anima_id, second.anima_id}
        async with fixture.content.mutations.catalog.mutation_transaction():
            for before in snapshots:
                await repository.replace_content(
                    user_id=fixture.owner.user_id,
                    before=before,
                    replacements=fixture.replacements,
                )
        for anima_id in (fixture.owner.anima_id, second.anima_id):
            updated_anima = await async_session.get(ORMAnima, anima_id, populate_existing=True)
            updated_root = await async_session.get(ORMAnimaLoadout, anima_id, populate_existing=True)
            assert updated_anima is not None and updated_root is not None
            assert (updated_anima.aggregate_revision, updated_root.revision) == (2, 2)
    finally:
        await async_session.rollback()
        await cleanup_loadout_fixture(async_session, second)
