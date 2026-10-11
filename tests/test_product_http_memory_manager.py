"""Shared Memory Manager routes isolate owners and commit through the composition (ADR 0021)."""

from __future__ import annotations

from pathlib import Path
from uuid import uuid4

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from animama.orm import ORMAnima
from animama.product_http.routes import memory_manager
from tests.product_http_support import DeferredCommitPorts, TwoOwnerComposition, product_app

RUNS = "/v1/memory/manager/runs"
APPROVALS = "/v1/memory/manager/approvals"


async def test_owners_reach_only_their_own_runs_and_approvals(
    async_session_factory: async_sessionmaker[AsyncSession], tmp_path: Path
) -> None:
    ports = DeferredCommitPorts(async_session_factory)
    owner_a, owner_b = f"owner-a-{uuid4().hex[:8]}", f"owner-b-{uuid4().hex[:8]}"
    composition = TwoOwnerComposition(
        product_app(memory_manager.router, ports=ports), tmp_path, owners=(owner_a, owner_b)
    )
    anima_id = f"anima-{uuid4().hex}"
    async with async_session_factory() as session:
        session.add(ORMAnima(id=anima_id, user_id=owner_a))
        await session.commit()

    async with composition.client(owner_a) as a:
        created = await a.post(RUNS, json={"message": "Remember notes/tea.md: I like green tea"})
    assert created.status_code == 201, created.text
    run_id = created.json()["run"]["id"]
    approval_id = created.json()["approvals"][0]["id"]
    commits = ports.commits

    async with composition.client(owner_b) as b:
        # Owner a's open run, approval and Anima are not owner b's.
        assert (await b.get(f"{RUNS}/current")).json() is None
        assert (await b.get(f"{RUNS}/{run_id}")).status_code == 404
        assert (await b.post(f"{RUNS}/{run_id}:complete")).status_code == 404
        assert (await b.post(f"{RUNS}/{run_id}/messages", json={"content": "notes/tea.md too"})).status_code == 404
        assert (await b.post(f"{APPROVALS}/{approval_id}:decide", json={"decision": "approve"})).status_code == 404
        assert (await b.post(f"{APPROVALS}/{approval_id}:undo")).status_code == 404
        assert (await b.post(f"{RUNS}:reflect", json={"anima_id": anima_id})).status_code == 404
        # Nothing of owner b's committed, and owner a's open run does not block owner b's own.
        assert ports.commits == commits
        assert (await b.post(RUNS, json={"message": "Hello"})).status_code == 201
    assert ports.commits == commits + 1

    async with composition.client(owner_a) as a:
        assert (await a.get(f"{RUNS}/current")).json()["run"]["id"] == run_id
        assert (await a.get(f"{RUNS}/{run_id}")).status_code == 200
        decided = await a.post(f"{APPROVALS}/{approval_id}:decide", json={"decision": "approve"})
        assert (decided.status_code, decided.json()["status"]) == (200, "approved")
        assert (await a.post(f"{APPROVALS}/{approval_id}:undo")).status_code == 200
        assert (await a.post(f"{RUNS}/{run_id}:complete")).json()["run"]["status"] == "completed"

    # Each of owner a's three writes committed once through the composition; the two
    # reads ran on read sessions, which refuse writes.
    assert ports.commits == commits + 4
    assert set(ports.owners) == {owner_a, owner_b}
