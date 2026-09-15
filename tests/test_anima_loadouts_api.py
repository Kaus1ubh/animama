from __future__ import annotations

import pytest
from fastapi import FastAPI

from animama.domain.request_principal import RequestPrincipal
from animama.server.deps import get_async_session, get_current_principal
from animama.server.routers.anima_loadouts import router
from tests.local_http_client import local_client
from tests.typed_loadout_support import (
    add_typed_item,
    catalog_source,
    cleanup_loadout_fixture,
    create_loadout_fixture,
)


@pytest.mark.asyncio
async def test_typed_gesture_plan_commit_and_loadout_http_contract(async_session) -> None:  # noqa: ANN001
    fixture = await create_loadout_fixture(async_session)
    gesture = await add_typed_item(
        async_session,
        fixture,
        kind="gesture",
        name="API Wave",
        metadata={
            "semantic_key": "api-wave",
            "implementation": {"kind": "vrma", "file_role": "animation"},
            "config": {},
        },
    )
    app = FastAPI()
    app.include_router(router)

    async def user() -> RequestPrincipal:
        return RequestPrincipal(id=fixture.user_id)

    async def session():  # noqa: ANN202
        yield async_session

    app.dependency_overrides[get_current_principal] = user
    app.dependency_overrides[get_async_session] = session
    client = local_client(app)
    intent = {
        "operation": "add",
        "source": catalog_source(gesture),
        "config_overrides": {},
    }
    try:
        initial = await client.get(f"/v1/animas/{fixture.anima_id}/loadout")
        assert initial.status_code == 200, initial.text
        assert initial.json()["revision"] == 1
        assert len(initial.json()["reactions"]) == 24 * 3

        planned = await client.post(
            f"/v1/animas/{fixture.anima_id}/gestures:plan",
            json={"expected_revision": 1, "intent": intent},
        )
        assert planned.status_code == 200, planned.text
        assert planned.json()["action"] == "add"

        committed = await client.post(
            f"/v1/animas/{fixture.anima_id}/gestures:commit",
            json={
                "expected_revision": 1,
                "intent": intent,
                "plan_digest": planned.json()["plan_digest"],
                "idempotency_key": "api-wave-add",
            },
        )
        assert committed.status_code == 200, committed.text
        assert committed.json()["revision"] == 2

        loadout = await client.get(f"/v1/animas/{fixture.anima_id}/loadout")
        custom = [row for row in loadout.json()["gestures"] if row["origin"] == "custom"]
        assert [(row["name"], row["semantic_key"]) for row in custom] == [("API Wave", "api-wave")]
    finally:
        await client.aclose()
        await cleanup_loadout_fixture(async_session, fixture)
