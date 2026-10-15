"""Shared loadout routes isolate owners and commit through the composition (ADR 0021)."""

from __future__ import annotations

from pathlib import Path
from uuid import uuid4

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from animama.product_http.routes import loadouts
from tests.product_http_support import DeferredCommitPorts, TwoOwnerComposition, product_app
from tests.typed_loadout_support import add_typed_item, catalog_source, cleanup_loadout_fixture, create_loadout_fixture

# A minimal valid intent for each plan/commit family; none needs owned content.
FAMILY_INTENTS: dict[str, dict[str, object]] = {
    "gestures": {"operation": "disable_starter", "starter_id": "x"},
    # Intensity-1 starter pools are empty, so restoring one is a valid no-op.
    "reactions": {"operation": "restore_starter", "emotion": "amusement", "intensity": 1},
    # Removing a Gesture that is not in the Default Idle pool is a valid no-op.
    "idle": {"operation": "remove", "binding_id": "x"},
    "avatar": {"operation": "remove"},
    "voice": {"operation": "remove"},
    "appearance": {"operation": "remove", "use": "profile"},
}
# The retired music command only replays historical receipts.
MUSIC_REPLAY = {"operation": "remove", "binding_id": "x"}


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


async def test_every_loadout_command_refuses_another_owners_anima(
    async_session_factory: async_sessionmaker[AsyncSession], tmp_path: Path
) -> None:
    async with async_session_factory() as session:
        fixture = await create_loadout_fixture(session)
    # Idle routes read the owner's content store for finite Gesture playback.
    ports = DeferredCommitPorts(async_session_factory, content_root=tmp_path)
    other = f"owner-b-{uuid4().hex[:8]}"
    composition = TwoOwnerComposition(
        product_app(loadouts.router, ports=ports), tmp_path, owners=(fixture.user_id, other)
    )
    base = f"/v1/animas/{fixture.anima_id}"
    commit = {"plan_digest": "0" * 64, "idempotency_key": "other-key"}
    requests = [
        (f"{base}/{family}:plan", {"expected_revision": 1, "intent": intent})
        for family, intent in FAMILY_INTENTS.items()
    ]
    requests += [
        (f"{base}/{family}:commit", {"expected_revision": 1, "intent": intent, **commit})
        for family, intent in FAMILY_INTENTS.items()
    ]
    requests.append((f"{base}/music-tracks:commit", {"expected_revision": 1, "intent": MUSIC_REPLAY, **commit}))
    try:
        async with composition.client(other) as b:
            for path, body in requests:
                refused = await b.post(path, json=body)
                assert (refused.status_code, refused.json()) == (404, {"detail": {"code": "anima_not_found"}}), path
        assert len(requests) == 13
        assert ports.commits == ports.commits_requested == 0
    finally:
        async with async_session_factory() as session:
            await cleanup_loadout_fixture(session, fixture)


async def test_every_loadout_family_commits_once_through_the_composition(
    async_session_factory: async_sessionmaker[AsyncSession], tmp_path: Path
) -> None:
    async with async_session_factory() as session:
        fixture = await create_loadout_fixture(session)
    ports = DeferredCommitPorts(async_session_factory, content_root=tmp_path)
    composition = TwoOwnerComposition(
        product_app(loadouts.router, ports=ports), tmp_path, owners=(fixture.user_id, f"owner-b-{uuid4().hex[:8]}")
    )
    base = f"/v1/animas/{fixture.anima_id}"
    try:
        async with composition.client(fixture.user_id) as a:
            for family, intent in FAMILY_INTENTS.items():
                # Plans run on read sessions, which refuse to write.
                revision = (await a.get(f"{base}/loadout")).json()["revision"]
                plan = {"expected_revision": revision, "intent": intent}
                planned = await a.post(f"{base}/{family}:plan", json=plan)
                assert planned.status_code == 200, (family, planned.text)
                commit = {**plan, "plan_digest": planned.json()["plan_digest"], "idempotency_key": f"owner-{family}"}
                committed = await a.post(f"{base}/{family}:commit", json=commit)
                assert committed.status_code == 200, (family, committed.text)
            retired = await a.post(
                f"{base}/music-tracks:commit",
                json={"expected_revision": 1, "intent": MUSIC_REPLAY, "plan_digest": "0" * 64, "idempotency_key": "m"},
            )
            assert (retired.status_code, retired.json()) == (409, {"detail": {"code": "content_kind_retired"}})
        # Each family committed once, through the composition; the refused replay rolled back.
        assert ports.commits == ports.commits_requested == len(FAMILY_INTENTS)
        assert ports.rollbacks == 1
    finally:
        async with async_session_factory() as session:
            await cleanup_loadout_fixture(session, fixture)
