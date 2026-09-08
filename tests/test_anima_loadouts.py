from __future__ import annotations

import pytest

from animama.app.services.anima_loadout_service import AnimaLoadoutService
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
        assert [(binding.name, binding.semantic_key) for binding in custom] == [
            ("Test Wave", "test-wave")
        ]
    finally:
        await cleanup_loadout_fixture(async_session, fixture)


@pytest.mark.asyncio
async def test_reaction_can_be_assigned_to_any_loadout_cell(async_session) -> None:  # noqa: ANN001
    fixture = await create_loadout_fixture(async_session)
    reaction = await add_typed_item(
        async_session,
        fixture,
        kind="reaction",
        name="Strong Joy",
        metadata={
            "placement_hint": {"emotion": "joy", "intensity": 3},
            "implementation": {"kind": "anima_clip", "file_role": "sequence"},
            "config": {},
        },
    )
    intent = {
        "operation": "replace",
        "emotion": "sadness",
        "intensity": 1,
        "source": catalog_source(reaction),
    }
    service = AnimaLoadoutService(async_session)
    try:
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
        selected = next(
            cell
            for cell in loadout.reactions
            if cell.emotion == "sadness" and cell.intensity == 1
        )
        assert selected.state == "custom"
        assert selected.name == "Strong Joy"
        assert selected.source is not None
        assert selected.source.catalog_item_id == reaction.id
    finally:
        await cleanup_loadout_fixture(async_session, fixture)
