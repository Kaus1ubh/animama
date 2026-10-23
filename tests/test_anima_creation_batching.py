"""Creation reads, locks and writes an Anima's Gestures and Reactions in batches (#648 R2)."""

from __future__ import annotations

from dataclasses import replace
from uuid import uuid4

import pytest
from sqlalchemy import select

from animama.adapters.repositories.sqlalchemy.anima_aggregate_uow import SQLAlchemyAnimaAggregateUnitOfWork
from animama.adapters.repositories.sqlalchemy.content_catalog_repo import SQLAlchemyContentCatalog
from animama.domain.anima_creation import ResolvedGestureSelection, ResolvedReactionMember
from animama.domain.anima_loadout import AnimaLoadoutError, reaction_slot_key
from animama.domain.content_catalog import CatalogContentEntry
from animama.orm.content_catalog import ORMAnimaContentBinding, ORMContentCatalogDependency
from tests.statement_counting import counted_statements
from tests.test_anima_materializer import _required, creation, owned_gesture  # noqa: F401
from tests.typed_loadout_support import LoadoutFixture, add_typed_item


async def _owned_reaction(async_session, user_id: str, name: str) -> CatalogContentEntry:  # noqa: ANN001
    """Add one owner Reaction; the creation fixture's owner cleanup retires it."""

    row = await add_typed_item(
        async_session,
        LoadoutFixture(user_id, "", "", ""),
        kind="reaction",
        name=name,
        metadata={"implementation": {"kind": "anima_clip", "file_role": "sequence"}},
    )
    return _required(await SQLAlchemyContentCatalog(async_session).get_visible_item(user_id=user_id, item_id=row.id))


async def _sources(async_session, user_id: str, size: int):  # noqa: ANN001, ANN202
    """``size`` configured owner Gestures with distinct semantic keys and ``size`` owner Reactions, one per cell."""

    suffix = uuid4().hex[:8]
    gestures = [
        ResolvedGestureSelection(
            await owned_gesture(async_session, user_id, f"Batch {suffix} {index}"), {"time_scale": 0.5 + index / 10}
        )
        for index in range(size)
    ]
    reactions = [
        ResolvedReactionMember("joy", index % 4 + 1, await _owned_reaction(async_session, user_id, f"React {index}"))
        for index in range(size)
    ]
    return gestures, reactions


@pytest.mark.asyncio
async def test_the_creation_statement_count_does_not_grow_with_gestures_and_reactions(async_session, creation) -> None:  # noqa: F811
    fixture = creation
    counts = []
    for size in (1, 4):
        gestures, reactions = await _sources(async_session, fixture.user_id, size)
        spec = replace(fixture.spec, gestures=tuple(gestures), reactions=tuple(reactions))
        uow = SQLAlchemyAnimaAggregateUnitOfWork(async_session)
        with counted_statements(async_session) as statements:
            anima = await fixture.materializer.materialize(user_id=fixture.user_id, spec=spec, uow=uow)
        rows = await async_session.execute(
            select(
                ORMAnimaContentBinding.slot_key, ORMAnimaContentBinding.catalog_item_id, ORMAnimaContentBinding.config
            ).where(
                ORMAnimaContentBinding.anima_id == anima.id,
                ORMAnimaContentBinding.kind.in_(["gesture", "reaction"]),
                ~ORMAnimaContentBinding.slot_key.startswith("idle:"),
            )
        )
        # Each Gesture keeps its own configuration under its declared key; Reaction members carry none.
        assert {slot: (item_id, config) for slot, item_id, config in rows} == {
            **{
                f"gesture:{selection.source.display_name.lower().replace(' ', '_')}": (
                    selection.source.id,
                    selection.config,
                )
                for selection in gestures
            },
            **{
                reaction_slot_key(f"joy-{reaction.intensity}", reaction.source.id): (reaction.source.id, {})
                for reaction in reactions
            },
        }
        counts.append(len(statements))
        await uow.rollback()
    assert counts[0] == counts[1], counts


@pytest.mark.asyncio
@pytest.mark.parametrize("family", ["gesture", "reaction"])
async def test_creation_reports_the_first_failing_member(async_session, creation, family: str) -> None:  # noqa: F811
    fixture = creation
    gestures, reactions = await _sources(async_session, fixture.user_id, 2)
    if family == "gesture":
        valid, other = (selection.source for selection in gestures)
    else:
        valid, other = (reaction.source for reaction in reactions)
    stale = replace(other, revision_sha256="0" * 64)
    missing = replace(other, id=f"{family}-{uuid4().hex}")
    for members, code in (
        ([valid, stale, missing], "loadout_source_stale"),
        ([valid, missing, stale], "loadout_source_unavailable"),
    ):
        if family == "gesture":
            spec = replace(fixture.spec, gestures=tuple(ResolvedGestureSelection(source) for source in members))
        else:
            spec = replace(
                fixture.spec,
                reactions=tuple(
                    ResolvedReactionMember("joy", index + 1, source) for index, source in enumerate(members)
                ),
            )
        uow = SQLAlchemyAnimaAggregateUnitOfWork(async_session)
        with pytest.raises(AnimaLoadoutError, match=code):
            await fixture.materializer.materialize(user_id=fixture.user_id, spec=spec, uow=uow)
        await uow.rollback()


@pytest.mark.asyncio
async def test_creation_refuses_two_gestures_under_one_semantic_key(async_session, creation) -> None:  # noqa: F811
    fixture = creation
    first = await owned_gesture(async_session, fixture.user_id, "Shared Key")
    second = await owned_gesture(async_session, fixture.user_id, "Shared Key")
    for sources in ((first, second), (first, first)):
        spec = replace(fixture.spec, gestures=tuple(ResolvedGestureSelection(source) for source in sources))
        uow = SQLAlchemyAnimaAggregateUnitOfWork(async_session)
        with pytest.raises(AnimaLoadoutError, match="gesture_semantic_key_conflict"):
            await fixture.materializer.materialize(user_id=fixture.user_id, spec=spec, uow=uow)
        await uow.rollback()


@pytest.mark.asyncio
async def test_creation_refuses_a_gesture_behind_an_unconverted_avatar_effect(async_session, creation) -> None:  # noqa: F811
    fixture = creation
    owner = LoadoutFixture(fixture.user_id, "", "", "")
    effect = await add_typed_item(
        async_session,
        owner,
        kind="avatar_effect",
        name="Legacy Mark",
        metadata={
            "definition": {
                "schema": "animama/avatar-effect/1",
                "kind": "hover",
                "region": "emote",
                "hoverKind": "box_hover",
                "placement": "forehead-left",
                "image": "mark.png",
            }
        },
    )
    gesture = await add_typed_item(
        async_session,
        owner,
        kind="gesture",
        name="Marked Wave",
        metadata={
            "semantic_key": "marked_wave",
            "implementation": {"kind": "vrma", "file_role": "animation"},
            "dependencies": [{"ref": effect.logical_key, "content_type": "avatar_effect", "alias": "mark"}],
        },
    )
    async_session.add(
        ORMContentCatalogDependency(
            item_id=gesture.id, ordinal=1, declared_ref=effect.logical_key, target_item_id=effect.id
        )
    )
    await async_session.commit()
    source = _required(
        await SQLAlchemyContentCatalog(async_session).get_visible_item(user_id=fixture.user_id, item_id=gesture.id)
    )
    uow = SQLAlchemyAnimaAggregateUnitOfWork(async_session)
    with pytest.raises(AnimaLoadoutError, match="avatar_effect_conversion_required"):
        await fixture.materializer.materialize(
            user_id=fixture.user_id,
            spec=replace(fixture.spec, gestures=(ResolvedGestureSelection(source),)),
            uow=uow,
        )
    await uow.rollback()
