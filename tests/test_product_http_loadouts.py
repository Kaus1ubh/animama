"""Shared loadout routes isolate owners and commit through the composition (ADR 0021)."""

from __future__ import annotations

from pathlib import Path
from uuid import uuid4

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from animama.product_http.routes import loadouts
from tests.product_http_support import DeferredCommitPorts, TwoOwnerComposition, product_app
from tests.typed_loadout_support import add_typed_item, catalog_source, cleanup_loadout_fixture, create_loadout_fixture


async def test_an_owner_never_reaches_another_owners_loadout(
    async_session_factory: async_sessionmaker[AsyncSession], tmp_path: Path
) -> None:
    async with async_session_factory() as session:
        fixture = await create_loadout_fixture(session)
        gesture = await add_typed_item(
            session,
            fixture,
            kind="gesture",
            name="Owner Wave",
            metadata={
                "semantic_key": "owner-wave",
                "implementation": {"kind": "vrma", "file_role": "animation"},
                "config": {},
            },
        )
        source = catalog_source(gesture)
    ports = DeferredCommitPorts(async_session_factory)
    owner, other = fixture.user_id, f"owner-b-{uuid4().hex[:8]}"
    composition = TwoOwnerComposition(product_app(loadouts.router, ports=ports), tmp_path, owners=(owner, other))
    base = f"/v1/animas/{fixture.anima_id}"
    plan = {"expected_revision": 1, "intent": {"operation": "add", "source": source, "config_overrides": {}}}
    try:
        async with composition.client(other) as b:
            assert (await b.get(f"{base}/loadout")).status_code == 404
            assert (await b.post(f"{base}/gestures:plan", json=plan)).status_code == 404
            refused = await b.post(
                f"{base}/gestures:commit", json={**plan, "plan_digest": "0" * 64, "idempotency_key": "other-add"}
            )
            assert refused.status_code == 404
            assert refused.json() == {"detail": {"code": "anima_not_found"}}
        # Owner b's refusals committed nothing.
        assert ports.commits == ports.commits_requested == 0

        async with composition.client(owner) as a:
            planned = await a.post(f"{base}/gestures:plan", json=plan)
            assert planned.status_code == 200, planned.text
            commit = {**plan, "plan_digest": planned.json()["plan_digest"], "idempotency_key": "owner-add"}
            committed = await a.post(f"{base}/gestures:commit", json=commit)
            assert committed.status_code == 200, committed.text
            assert committed.json()["revision"] == 2
            replayed = await a.post(f"{base}/gestures:commit", json=commit)
            assert replayed.status_code == 200 and replayed.json()["idempotent_replay"] is True
            loadout = (await a.get(f"{base}/loadout")).json()
            assert loadout["revision"] == 2
            assert [row["name"] for row in loadout["gestures"] if row["origin"] == "custom"] == ["Owner Wave"]
        # Only the first commit wrote, once, through the composition; the replay read its receipt.
        assert ports.commits == ports.commits_requested == 1
    finally:
        async with async_session_factory() as session:
            await cleanup_loadout_fixture(session, fixture)
