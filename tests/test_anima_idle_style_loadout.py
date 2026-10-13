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
async def test_idle_style_selection_uses_style_cells_and_rejects_anima_overrides(async_session) -> None:  # noqa: ANN001
    fixture = await create_loadout_fixture(async_session)
    idle = await add_typed_item(
        async_session,
        fixture,
        kind="idle_style",
        name="Calm Idle",
        metadata={
            "schema_version": 2,
            "default_pool": [],
            "cells": {"joy": {"2": {"mode": "none"}}},
            "compatibility": {},
        },
    )
    service = AnimaLoadoutService(async_session)
    intent = {
        "operation": "set",
        "source": catalog_source(idle),
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
        assert loadout.idle_style.schema_version == 2
        assert loadout.idle_style.default_pool == ()
        assert loadout.idle_style.cells["joy"]["2"].mode == "none"

        with pytest.raises(AnimaLoadoutError, match="idle_pool_overrides_retired"):
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
        await add_typed_item(
            async_session,
            fixture,
            kind="idle_style",
            name="Starter",
            metadata={"schema_version": 2, "content_id": "builtin:idle-style:starter", "default_pool": []},
        )
        idle.status = "invalid"
        await async_session.commit()
        unavailable = await service.read_model(user_id=fixture.user_id, anima_id=fixture.anima_id)
        assert unavailable.idle_style.state == "empty"
        assert any(
            warning.code == "loadout_source_unavailable" and warning.params.get("slot")
            for warning in unavailable.warnings
        )
    finally:
        await cleanup_loadout_fixture(async_session, fixture)
