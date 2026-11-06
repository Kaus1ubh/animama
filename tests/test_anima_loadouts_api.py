from __future__ import annotations

import pytest
from fastapi import FastAPI

from animama.domain.request_principal import RequestPrincipal
from animama.product_http.ports import install_product_ports
from animama.product_http.principal import get_current_principal
from animama.product_http.routes.loadouts import router
from tests.local_http_client import local_client
from tests.product_http_support import SessionPorts
from tests.typed_loadout_support import (
    add_typed_item,
    catalog_source,
    cleanup_loadout_fixture,
    create_loadout_fixture,
)


@pytest.mark.asyncio
async def test_typed_gesture_plan_commit_and_loadout_http_contract(async_session) -> None:
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

    app.dependency_overrides[get_current_principal] = user
    install_product_ports(app, SessionPorts(async_session))
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
        assert len(initial.json()["reactions"]) == 24 * 4

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
        custom = loadout.json()["gestures"]
        assert [(row["name"], row["semantic_key"]) for row in custom] == [("API Wave", "api-wave")]
    finally:
        await client.aclose()
        await cleanup_loadout_fixture(async_session, fixture)
