"""Legacy Music bindings remain readable but cannot be newly equipped."""

from __future__ import annotations

from typing import Any, cast

import pytest

from animama.app.services.anima_loadout_service import AnimaLoadoutService
from animama.domain.anima_loadout import AnimaLoadoutError
from tests.typed_loadout_support import cleanup_loadout_fixture, create_loadout_fixture


async def test_music_loadout_plan_is_retired(async_session) -> None:
    fixture = await create_loadout_fixture(async_session)
    try:
        with pytest.raises(AnimaLoadoutError, match="content_kind_retired"):
            await AnimaLoadoutService(async_session).plan(
                user_id=fixture.user_id,
                anima_id=fixture.anima_id,
                family=cast(Any, "music_track"),
                expected_revision=1,
                intent={"operation": "add", "enabled": True, "autoplay": True},
            )
    finally:
        await cleanup_loadout_fixture(async_session, fixture)


@pytest.mark.parametrize("explicit_options", [False, True])
async def test_music_commit_only_replays_exact_historical_receipt(async_session, explicit_options):
    import hashlib
    import json
    from datetime import UTC, datetime, timedelta
    from uuid import uuid4

    from fastapi import FastAPI
    from sqlalchemy import func, select, update

    from animama.domain.request_principal import RequestPrincipal
    from animama.orm.anima import ORMAnima
    from animama.orm.anima_loadout import ORMAnimaLoadout, ORMAnimaLoadoutMutationReceipt
    from animama.orm.content_catalog import ORMAnimaContentBinding
    from animama.product_http.ports import install_product_ports
    from animama.product_http.principal import get_current_principal
    from animama.product_http.routes.loadouts import router
    from tests.local_http_client import local_client
    from tests.product_http_support import SessionPorts

    fixture = await create_loadout_fixture(async_session)
    application = FastAPI()
    application.include_router(router)

    async def principal():
        return RequestPrincipal(id=fixture.user_id)

    application.dependency_overrides[get_current_principal] = principal
    install_product_ports(application, SessionPorts(async_session))
    # The source and binding can have disappeared since the successful operation.
    # Reproduce the historical router's defaults and recursive exclude_none dump.
    source = {"type": "catalog", "catalog_item_id": "retired-missing-track", "source": "local"}
    options = {"enabled": True, "autoplay": True, "loop": False, "gain": 0.75} if explicit_options else {}
    original_intent = {"operation": "add", "source": source, "enabled": True, "autoplay": False, **options}
    request: dict[str, Any] = {
        "expected_revision": 1,
        "plan_digest": "a" * 64,
        "idempotency_key": "old-music-commit",
        "intent": {"operation": "add", "source": {**source, "logical_key": None}, **options},
    }
    if not explicit_options:
        request["intent"].update({"binding_id": None, "loop": None, "gain": None})
    digest = hashlib.sha256(
        json.dumps(
            {
                "anima_id": fixture.anima_id,
                "family": "music_track",
                "expected_revision": 1,
                "intent": original_intent,
                "plan_digest": "a" * 64,
            },
            sort_keys=True,
            separators=(",", ":"),
            ensure_ascii=False,
        ).encode()
    ).hexdigest()
    async_session.add(
        ORMAnimaLoadoutMutationReceipt(
            id=str(uuid4()),
            owner_user_id=fixture.user_id,
            anima_id=fixture.anima_id,
            idempotency_key="old-music-commit",
            request_digest=digest,
            resulting_revision=2,
            result={"action": "add", "aggregate_revision": 3},
            expires_at=datetime.now(UTC) + timedelta(days=1),
        )
    )
    await async_session.execute(
        update(ORMAnimaLoadout).where(ORMAnimaLoadout.anima_id == fixture.anima_id).values(revision=7)
    )
    await async_session.execute(update(ORMAnima).where(ORMAnima.id == fixture.anima_id).values(aggregate_revision=9))
    await async_session.commit()
    try:
        route = f"/v1/animas/{fixture.anima_id}/music-tracks:commit"
        async with local_client(application) as client:
            replay = await client.post(route, json=request)
            assert replay.status_code == 200, replay.text
            assert replay.json() == {
                "anima_id": fixture.anima_id,
                "revision": 2,
                "action": "add",
                "idempotent_replay": True,
                "aggregate_revision": 3,
            }
            changed = await client.post(route, json={**request, "intent": {**request["intent"], "gain": 1.5}})
            assert changed.status_code == 409 and changed.json()["detail"]["code"] == "idempotency_key_reused"
            fresh = await client.post(route, json={**request, "idempotency_key": "new-music-commit"})
            assert fresh.status_code == 409 and fresh.json()["detail"]["code"] == "content_kind_retired"
            assert (await client.post(route.replace(":commit", ":plan"), json=request)).status_code == 404
        assert not any("music" in path for path in application.openapi()["paths"])
        assert not any("Music" in model for model in application.openapi()["components"]["schemas"])
        assert (
            await async_session.scalar(
                select(func.count())
                .select_from(ORMAnimaContentBinding)
                .where(
                    ORMAnimaContentBinding.anima_id == fixture.anima_id, ORMAnimaContentBinding.kind == "music_track"
                )
            )
            == 0
        )
        assert (
            await async_session.scalar(
                select(ORMAnimaLoadout.revision).where(ORMAnimaLoadout.anima_id == fixture.anima_id)
            )
            == 7
        )
        assert (
            await async_session.scalar(select(ORMAnima.aggregate_revision).where(ORMAnima.id == fixture.anima_id)) == 9
        )
    finally:
        await cleanup_loadout_fixture(async_session, fixture)
