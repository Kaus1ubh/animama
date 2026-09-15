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
async def test_idle_style_selection_and_pool_overrides_remain_typed(async_session) -> None:  # noqa: ANN001
    fixture = await create_loadout_fixture(async_session)
    idle = await add_typed_item(
        async_session,
        fixture,
        kind="idle_style",
        name="Calm Idle",
        metadata={
            "animations": [
                {
                    "animation_id": "calm",
                    "name": "Calm",
                    "file_ref": "calm.vrma",
                    "playback": {"loop_type": "repeat"},
                },
                {
                    "animation_id": "sway",
                    "name": "Sway",
                    "file_ref": "sway.vrma",
                    "playback": {"loop_type": "pingpong"},
                },
            ],
            "files": [
                {"path": "calm.vrma", "role": "animation"},
                {"path": "sway.vrma", "role": "animation"},
            ],
            "default_pool": ["calm"],
            "emotion_pools": {"joy": ["sway"]},
            "cross_fade_seconds": 0.4,
            "compatibility": {},
        },
    )
    service = AnimaLoadoutService(async_session)
    intent = {
        "operation": "set",
        "source": catalog_source(idle),
        "pool_overrides": {"default": ["sway"], "joy": ["calm"]},
    }
    try:
        plan = await service.plan(
            user_id=fixture.user_id,
            anima_id=fixture.anima_id,
            family="idle_style",
            expected_revision=1,
            intent=intent,
        )
        await service.commit(
            user_id=fixture.user_id,
            anima_id=fixture.anima_id,
            family="idle_style",
            expected_revision=1,
            intent=intent,
            plan_digest=plan.digest,
            idempotency_key="idle-set-1",
        )
        loadout = await service.read_model(
            user_id=fixture.user_id,
            anima_id=fixture.anima_id,
        )
        assert loadout.idle_style.state == "custom"
        assert loadout.idle_style.effective_default_pool == ("sway",)
        assert loadout.idle_style.effective_emotion_pools["joy"] == ("calm",)

        with pytest.raises(AnimaLoadoutError, match="idle_pool_overrides_invalid"):
            await service.plan(
                user_id=fixture.user_id,
                anima_id=fixture.anima_id,
                family="idle_style",
                expected_revision=2,
                intent={
                    "operation": "reconfigure",
                    "source": catalog_source(idle),
                    "pool_overrides": {"default": ["missing"]},
                },
            )
    finally:
        await cleanup_loadout_fixture(async_session, fixture)
