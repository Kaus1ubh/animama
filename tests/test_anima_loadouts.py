from __future__ import annotations

import pytest

from animama.app.services.anima_loadout_service import AnimaLoadoutService
from animama.domain.anima_loadout import AnimaLoadoutError
from tests.typed_loadout_support import (
    add_typed_item,
    catalog_source,
    cleanup_loadout_fixture,
    create_loadout_fixture,
)


@pytest.mark.asyncio
async def test_gesture_plan_commit_is_typed_revisioned_and_idempotent(async_session) -> None:  # noqa: ANN001
    fixture = await create_loadout_fixture(async_session)
    gesture = await add_typed_item(
        async_session,
        fixture,
        kind="gesture",
        name="Test Wave",
        metadata={
            "semantic_key": "test-wave",
            "implementation": {"kind": "vrma", "file_role": "animation"},
            "config": {},
        },
    )
    service = AnimaLoadoutService(async_session)
    intent = {
        "operation": "add",
        "source": catalog_source(gesture),
        "config_overrides": {"speed": 0.9},
    }
    try:
        plan = await service.plan(
            user_id=fixture.user_id,
            anima_id=fixture.anima_id,
            family="gesture",
            expected_revision=1,
            intent=intent,
        )
        assert plan.action == "add"
        assert plan.final_gesture_count == 1

        committed = await service.commit(
            user_id=fixture.user_id,
            anima_id=fixture.anima_id,
            family="gesture",
            expected_revision=1,
            intent=intent,
            plan_digest=plan.digest,
            idempotency_key="gesture-add-1",
        )
        assert (committed.revision, committed.action) == (2, "add")

        replay = await service.commit(
            user_id=fixture.user_id,
            anima_id=fixture.anima_id,
            family="gesture",
            expected_revision=1,
            intent=intent,
            plan_digest=plan.digest,
            idempotency_key="gesture-add-1",
        )
        assert replay.idempotent_replay is True
        assert replay.revision == 2

        loadout = await service.read_model(
            user_id=fixture.user_id,
            anima_id=fixture.anima_id,
        )
        custom = [binding for binding in loadout.gestures if binding.origin == "custom"]
        assert [(binding.name, binding.semantic_key) for binding in custom] == [("Test Wave", "test-wave")]
    finally:
        await cleanup_loadout_fixture(async_session, fixture)


@pytest.mark.asyncio
@pytest.mark.parametrize("with_hint", [False, True])
async def test_reaction_can_be_assigned_to_any_loadout_cell(async_session, with_hint: bool) -> None:  # noqa: ANN001
    fixture = await create_loadout_fixture(async_session)
    reaction = await add_typed_item(
        async_session,
        fixture,
        kind="reaction",
        name="Strong Joy",
        metadata={
            **({"placement_hint": {"emotion": "joy", "intensity": 4}} if with_hint else {}),
            "implementation": {"kind": "anima_clip", "file_role": "sequence"},
            "config": {},
        },
    )
    intent = {
        "operation": "add",
        "emotion": "sadness",
        "intensity": 1,
        "source": catalog_source(reaction),
    }
    service = AnimaLoadoutService(async_session)
    try:
        for missing_field in ("emotion", "intensity"):
            incomplete = {key: value for key, value in intent.items() if key != missing_field}
            with pytest.raises(AnimaLoadoutError, match="reaction_cell_invalid"):
                await service.plan(
                    user_id=fixture.user_id,
                    anima_id=fixture.anima_id,
                    family="reaction",
                    expected_revision=1,
                    intent=incomplete,
                )
        plan = await service.plan(
            user_id=fixture.user_id,
            anima_id=fixture.anima_id,
            family="reaction",
            expected_revision=1,
            intent=intent,
        )
        assert plan.action == "add"

        await service.commit(
            user_id=fixture.user_id,
            anima_id=fixture.anima_id,
            family="reaction",
            expected_revision=1,
            intent=intent,
            plan_digest=plan.digest,
            idempotency_key="reaction-cross-cell-1",
        )
        loadout = await service.read_model(
            user_id=fixture.user_id,
            anima_id=fixture.anima_id,
        )
        selected = next(cell for cell in loadout.reactions if cell.emotion == "sadness" and cell.intensity == 1)
        assert selected.state == "custom"
        [member] = selected.members
        assert member.name == "Strong Joy"
        assert member.source is not None
        assert member.source.catalog_item_id == reaction.id
    finally:
        await cleanup_loadout_fixture(async_session, fixture)


@pytest.mark.asyncio
async def test_gesture_using_an_unconverted_avatar_effect_is_refused(async_session) -> None:  # noqa: ANN001
    from animama.orm.content_catalog import ORMContentCatalogDependency

    fixture = await create_loadout_fixture(async_session)
    effect = await add_typed_item(
        async_session,
        fixture,
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
        fixture,
        kind="gesture",
        name="Marked Wave",
        metadata={
            "semantic_key": "marked-wave",
            "implementation": {"kind": "vrma", "file_role": "animation"},
            "config": {},
            "dependencies": [{"ref": effect.logical_key, "content_type": "avatar_effect", "alias": "mark"}],
        },
    )
    async_session.add(
        ORMContentCatalogDependency(
            item_id=gesture.id, ordinal=1, declared_ref=effect.logical_key, target_item_id=effect.id
        )
    )
    await async_session.commit()
    try:
        with pytest.raises(AnimaLoadoutError) as raised:
            await AnimaLoadoutService(async_session).plan(
                user_id=fixture.user_id,
                anima_id=fixture.anima_id,
                family="gesture",
                expected_revision=1,
                intent={"operation": "add", "source": catalog_source(gesture)},
            )
        assert raised.value.code == "avatar_effect_conversion_required"
    finally:
        await cleanup_loadout_fixture(async_session, fixture)


def test_loadout_warnings_carry_the_values_their_wording_needs() -> None:
    from animama.app.contracts.anima_loadout import PyLoadoutDiagnostic
    from animama.domain.anima_loadout import LoadoutDiagnostic

    warning = PyLoadoutDiagnostic.from_domain(
        LoadoutDiagnostic(
            code="gesture_semantic_key_conflict",
            message="Gesture おじぎ has a conflicting semantic key.",
            params={"name": "おじぎ"},
        )
    )
    assert warning.model_dump() == {
        "code": "gesture_semantic_key_conflict",
        "message": "Gesture おじぎ has a conflicting semantic key.",
        "scope": "target",
        "params": {"name": "おじぎ"},
    }
    assert PyLoadoutDiagnostic.from_domain(LoadoutDiagnostic(code="x", message="y")).params == {}
