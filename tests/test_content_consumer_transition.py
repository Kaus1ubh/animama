"""Included Action copies replace only consumed equipment in one Anima revision."""

from __future__ import annotations

from collections.abc import AsyncIterator, Mapping
from dataclasses import dataclass
from pathlib import Path

import pytest
import pytest_asyncio
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from animama.adapters.repositories.sqlalchemy.content_transition_repo import SQLAlchemyContentTransitionBindings
from animama.app.ports.content_transition import ContentTransitionAnima
from animama.app.services.content_catalog_service import ContentCatalogService
from animama.app.services.starter_loadout_policy import starter_loadout_policy
from animama.domain.anima_definition import AnimaDefinitionError
from animama.domain.anima_loadout import reaction_slot_key
from animama.domain.content_catalog import ContentConflictError
from animama.orm.anima import ORMAnima
from animama.orm.anima_loadout import ORMAnimaLoadout
from animama.orm.content_catalog import ORMAnimaContentBinding, ORMContentCatalogItem
from tests.content_package_helpers import package_services
from tests.typed_loadout_support import LoadoutFixture, add_typed_item, cleanup_loadout_fixture, create_loadout_fixture


@dataclass
class _Consumers:
    owner: LoadoutFixture
    content: ContentCatalogService
    originals: dict[str, str]
    included: dict[str, str]
    replacements: dict[str, str]
    slots: dict[str, str]
    unrelated_binding: str


@pytest_asyncio.fixture
async def consumers(async_session: AsyncSession, tmp_path: Path) -> AsyncIterator[_Consumers]:
    owner = await create_loadout_fixture(async_session)
    _, _, content, _, _ = package_services(async_session, tmp_path)
    policy = starter_loadout_policy(1)
    gesture, reaction = policy["gestures"][0], policy["reactions"][0]
    logical = {
        "gesture": gesture["content_id"],
        "reaction": reaction["content_id"],
    }
    originals, included, replacements = {}, {}, {}
    for kind, content_id in logical.items():
        original = await add_typed_item(
            async_session,
            owner,
            kind=kind,
            name=f"Included {kind}",
            metadata={"content_id": content_id},
        )
        original.source, original.scope, original.owner_user_id = "included", "included", None
        await async_session.commit()
        local = await add_typed_item(async_session, owner, kind=kind, name=f"Local {kind}", metadata={})
        originals[kind], included[content_id], replacements[original.id] = original.id, original.id, local.id
    # A Reaction is only ever an explicit pool member; its slot names the cell and the member.
    slots = {
        "gesture": f"gesture:{gesture['content_id'].rsplit(':', 1)[-1]}",
        "reaction": reaction_slot_key(f"{reaction['emotion']}-{reaction['intensity']}", originals["reaction"]),
    }
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
    anima = await async_session.get(ORMAnima, owner.anima_id)
    assert anima is not None
    anima.display_name = "Keep companion identity"
    anima.metadata_ = {"private": "preserve"}
    await async_session.commit()
    try:
        yield _Consumers(owner, content, originals, included, replacements, slots, unrelated_binding)
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


async def test_implicit_starter_gesture_is_materialized_and_no_reaction_is_implied(
    async_session: AsyncSession,
    consumers: _Consumers,
) -> None:
    fixture = consumers
    repository = SQLAlchemyContentTransitionBindings(async_session)
    snapshots = await repository.content_consumers(
        user_id=fixture.owner.user_id,
        item_ids=tuple(fixture.originals.values()),
        included_by_logical=fixture.included,
    )

    assert len(snapshots) == 1
    before = snapshots[0]
    # The policy's Reaction is not a pool member here, so only the Gesture is consumed.
    assert [selection.slot_key for selection in before.selections] == [fixture.slots["gesture"]]
    assert all(selection.binding_id is None and selection.config == {} for selection in before.selections)
    assert {selection.starter_content_id for selection in before.selections} == {
        content_id for content_id, item_id in fixture.included.items() if item_id == fixture.originals["gesture"]
    }
    assert [binding.binding_id for binding in before.bindings] == [fixture.unrelated_binding]
    async with fixture.content.mutations.catalog.mutation_transaction():
        await repository.replace_content(
            user_id=fixture.owner.user_id, before=before, replacements=fixture.replacements
        )
    rows = {row.slot_key: row for row in await _bindings(async_session, fixture.owner.anima_id)}
    assert set(rows) == {fixture.slots["gesture"], "gesture:unrelated"}
    slot = fixture.slots["gesture"]
    assert rows[slot].kind == "gesture"
    assert rows[slot].catalog_item_id == fixture.replacements[fixture.originals["gesture"]]
    assert rows[slot].config == {}
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
    assert (
        await repository.content_consumers(
            user_id=fixture.owner.user_id,
            item_ids=tuple(fixture.originals.values()),
            included_by_logical=fixture.included,
        )
        == ()
    )


async def test_explicit_selections_keep_binding_ids_configs_and_starter_exclusions(
    async_session: AsyncSession,
    consumers: _Consumers,
) -> None:
    fixture = consumers
    configs = {
        "gesture": {"time_scale": 0.4, "custom": {"keep": [True, "value"]}},
        "reaction": {},
    }
    for kind, item_id in fixture.originals.items():
        async_session.add(
            ORMAnimaContentBinding(
                id=f"explicit-{kind}-{fixture.owner.suffix}",
                anima_id=fixture.owner.anima_id,
                slot_key=fixture.slots[kind],
                kind=kind,
                catalog_item_id=item_id,
                config=configs[kind],
            )
        )
    root = await async_session.get(ORMAnimaLoadout, fixture.owner.anima_id)
    assert root is not None
    exclusions = [{"slot": "gesture", "runtime_id": fixture.slots["gesture"].split(":", 1)[1]}]
    root.starter_exclusions = exclusions
    await async_session.commit()
    repository = SQLAlchemyContentTransitionBindings(async_session)
    before = (
        await repository.content_consumers(
            user_id=fixture.owner.user_id,
            item_ids=tuple(fixture.originals.values()),
            included_by_logical=fixture.included,
        )
    )[0]
    assert len(before.selections) == 2
    assert all(
        selection.binding_id is not None and selection.starter_content_id is None for selection in before.selections
    )
    async with fixture.content.mutations.catalog.mutation_transaction():
        await repository.replace_content(
            user_id=fixture.owner.user_id, before=before, replacements=fixture.replacements
        )
    rows = {row.slot_key: row for row in await _bindings(async_session, fixture.owner.anima_id)}
    for kind, slot in fixture.slots.items():
        assert rows[slot].id == f"explicit-{kind}-{fixture.owner.suffix}"
        assert rows[slot].config == configs[kind]
        assert rows[slot].catalog_item_id == fixture.replacements[fixture.originals[kind]]
    await async_session.refresh(root)
    assert root.revision == 2 and root.starter_exclusions == exclusions


@pytest.mark.parametrize("disabled,occupied", [("gesture", "reaction"), (None, "gesture")])
async def test_disabled_or_occupied_starters_are_not_materialized(
    async_session: AsyncSession,
    consumers: _Consumers,
    disabled: str | None,
    occupied: str,
) -> None:
    fixture = consumers
    root = await async_session.get(ORMAnimaLoadout, fixture.owner.anima_id)
    assert root is not None
    # A disabled or occupied starter Gesture is not implied, and a Reaction never is.
    root.starter_exclusions = (
        [{"slot": disabled, "runtime_id": fixture.slots[disabled].split(":", 1)[1]}] if disabled else []
    )
    async_session.add(
        ORMAnimaContentBinding(
            id=f"occupied-{fixture.owner.suffix}",
            anima_id=fixture.owner.anima_id,
            kind=occupied,
            slot_key=fixture.slots[occupied],
            catalog_item_id=fixture.replacements[fixture.originals[occupied]],
            config={"keep": "occupied"},
        )
    )
    await async_session.commit()
    repository = SQLAlchemyContentTransitionBindings(async_session)
    assert (
        await repository.content_consumers(
            user_id=fixture.owner.user_id,
            item_ids=tuple(fixture.originals.values()),
            included_by_logical=fixture.included,
        )
        == ()
    )
    assert len(await _bindings(async_session, fixture.owner.anima_id)) == 2
    await async_session.refresh(root)
    assert root.revision == 1


async def test_only_affected_starter_items_are_selected(async_session: AsyncSession, consumers: _Consumers) -> None:
    fixture = consumers
    repository = SQLAlchemyContentTransitionBindings(async_session)
    before = (
        await repository.content_consumers(
            user_id=fixture.owner.user_id,
            item_ids=(fixture.originals["gesture"],),
            included_by_logical=fixture.included,
        )
    )[0]
    assert [selection.slot_key for selection in before.selections] == [fixture.slots["gesture"]]
    async with fixture.content.mutations.catalog.mutation_transaction():
        await repository.replace_content(
            user_id=fixture.owner.user_id, before=before, replacements=fixture.replacements
        )
    assert {row.slot_key for row in await _bindings(async_session, fixture.owner.anima_id)} == {
        "gesture:unrelated",
        fixture.slots["gesture"],
    }


@pytest.mark.parametrize("change", ["aggregate", "loadout", "exclusions", "config", "occupied"])
async def test_stale_aggregate_root_or_binding_snapshot_prevents_every_replacement(
    async_session: AsyncSession,
    consumers: _Consumers,
    change: str,
) -> None:
    fixture = consumers
    repository = SQLAlchemyContentTransitionBindings(async_session)
    before = (
        await repository.content_consumers(
            user_id=fixture.owner.user_id,
            item_ids=tuple(fixture.originals.values()),
            included_by_logical=fixture.included,
        )
    )[0]
    root = await async_session.get(ORMAnimaLoadout, fixture.owner.anima_id)
    anima = await async_session.get(ORMAnima, fixture.owner.anima_id)
    assert root is not None and anima is not None
    if change == "aggregate":
        anima.aggregate_revision += 1
    elif change == "loadout":
        root.revision += 1
    elif change == "exclusions":
        root.starter_exclusions = [{"slot": "gesture", "runtime_id": "changed"}]
    elif change == "config":
        row = await async_session.get(ORMAnimaContentBinding, fixture.unrelated_binding)
        assert row is not None
        row.config = {"nested": {"new": [3, 4]}}
        assert before.bindings[0].config == {"time_scale": 0.7, "nested": {"preserve": [1, 2]}}
    else:
        async_session.add(
            ORMAnimaContentBinding(
                id=f"new-occupied-{fixture.owner.suffix}",
                anima_id=fixture.owner.anima_id,
                kind="gesture",
                slot_key=fixture.slots["gesture"],
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
    before = (
        await repository.content_consumers(
            user_id=fixture.owner.user_id,
            item_ids=tuple(fixture.originals.values()),
            included_by_logical=fixture.included,
        )
    )[0]
    with pytest.raises(RuntimeError, match="interrupted after grouped"):
        async with fixture.content.mutations.catalog.mutation_transaction():
            await repository.replace_content(
                user_id=fixture.owner.user_id, before=before, replacements=fixture.replacements
            )
    assert (
        await repository.content_consumers(
            user_id=fixture.owner.user_id,
            item_ids=tuple(fixture.originals.values()),
            included_by_logical=fixture.included,
        )
    )[0] == before


async def test_other_owner_cannot_snapshot_or_replace_consumers(
    async_session: AsyncSession, consumers: _Consumers
) -> None:
    fixture = consumers
    repository = SQLAlchemyContentTransitionBindings(async_session)
    assert (
        await repository.content_consumers(
            user_id="other-owner",
            item_ids=tuple(fixture.originals.values()),
            included_by_logical=fixture.included,
        )
        == ()
    )
    before = (
        await repository.content_consumers(
            user_id=fixture.owner.user_id,
            item_ids=tuple(fixture.originals.values()),
            included_by_logical=fixture.included,
        )
    )[0]
    with pytest.raises(AnimaDefinitionError):
        async with fixture.content.mutations.catalog.mutation_transaction():
            await repository.replace_content(user_id="other-owner", before=before, replacements=fixture.replacements)
    assert (
        await repository.content_consumers(
            user_id=fixture.owner.user_id,
            item_ids=tuple(fixture.originals.values()),
            included_by_logical=fixture.included,
        )
    )[0] == before


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
        await async_session.commit()
        repository = SQLAlchemyContentTransitionBindings(async_session)
        snapshots = await repository.content_consumers(
            user_id=fixture.owner.user_id,
            item_ids=tuple(fixture.originals.values()),
            included_by_logical=fixture.included,
        )
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
