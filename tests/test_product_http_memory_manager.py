"""Shared Memory Manager routes isolate owners and commit through the composition (ADR 0021)."""

from __future__ import annotations

from datetime import UTC, date, datetime
from pathlib import Path
from uuid import uuid4

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from animama.adapters.repositories.sqlalchemy.product_repositories import SQLAlchemyProductRepositories
from animama.app.contracts.memory_entry import PyMemoryEntryCreateRequest
from animama.app.services.memory_entry_service import MemoryEntryService
from animama.app.services.memory_episode_service import MemoryEpisodeService
from animama.domain.request_principal import RequestPrincipal
from animama.orm import ORMAnima, ORMChat, ORMChatMessage
from animama.product_http.ports import ProductRefusal
from animama.product_http.routes import memory, memory_manager
from tests.product_http_support import TEST_POLICY, DeferredCommitPorts, TwoOwnerComposition, product_app

RUNS = "/v1/memory/manager/runs"
APPROVALS = "/v1/memory/manager/approvals"


async def _seed_anima_with_a_turn(session: AsyncSession, owner: str) -> str:
    """An Anima with valid identity files and one uncovered chat turn to reflect on."""

    anima_id = f"anima-{uuid4().hex}"
    session.add(ORMAnima(id=anima_id, user_id=owner, display_name="Mika"))
    await session.flush()
    repositories = SQLAlchemyProductRepositories(session)
    principal = RequestPrincipal(id=owner)
    await memory.create_memory_entry(
        PyMemoryEntryCreateRequest(
            anima_id=anima_id,
            expected_aggregate_revision=1,
            type="file",
            name="IDENTITY.md",
            content="# Mika\n\nWarm and curious.\n",
            description="Who Mika is",
        ),
        repositories=repositories,
        policy=TEST_POLICY,
        user=principal,
    )
    await memory.repair_anima_memories(anima_id, repositories=repositories, policy=TEST_POLICY, user=principal)
    chat_id = f"chat-{uuid4().hex}"
    session.add(ORMChat(id=chat_id, user_id=owner, anima_id=anima_id, title="Tea"))
    await session.flush()
    at = datetime(2026, 7, 7, 9)  # chat message times are stored without a zone
    run_id = f"run-{uuid4().hex}"
    session.add_all(
        [
            ORMChatMessage(
                chat_id=chat_id, run_id=run_id, message_type="message", role="user", content="I love tea", created_at=at
            ),
            ORMChatMessage(
                chat_id=chat_id,
                run_id=run_id,
                message_type="message",
                role="assistant",
                content='{"display": "Tea it is"}',
                message_data={"structured": {"display": "Tea it is"}, "memory": {"updates_enabled": True}},
                created_at=at,
            ),
        ]
    )
    return anima_id


async def _seed_pending_episode(session: AsyncSession, owner: str) -> None:
    repositories = SQLAlchemyProductRepositories(session)
    await MemoryEpisodeService(
        memory_episodes=repositories.memory_episodes,
        memory_entries=MemoryEntryService(memory_entries=repositories.memory_entries, uow=repositories.unit_of_work),
        uow=repositories.unit_of_work,
    ).create_episode_item(
        user_id=owner,
        source_chat_id="chat-episode",
        source_run_id="run-episode",
        text="The owner drinks green tea.",
        occurred_at=datetime(2026, 7, 7, 12, tzinfo=UTC),
        local_date=date(2026, 7, 7),
    )


async def test_owners_reach_only_their_own_runs_and_approvals(
    async_session_factory: async_sessionmaker[AsyncSession], tmp_path: Path
) -> None:
    ports = DeferredCommitPorts(async_session_factory)
    owner_a, owner_b = f"owner-a-{uuid4().hex[:8]}", f"owner-b-{uuid4().hex[:8]}"
    composition = TwoOwnerComposition(
        product_app(memory_manager.router, ports=ports), tmp_path, owners=(owner_a, owner_b)
    )
    async with async_session_factory() as session:
        anima_id = await _seed_anima_with_a_turn(session, owner_a)
        await _seed_pending_episode(session, owner_a)
        await session.commit()

    async with composition.client(owner_a) as a:
        created = await a.post(RUNS, json={"message": "Remember notes/tea.md: I like green tea"})
    assert created.status_code == 201, created.text
    run_id = created.json()["run"]["id"]
    approval_id = created.json()["approvals"][0]["id"]
    commits = ports.commits

    async with composition.client(owner_b) as b:
        # Owner a's open run, approval, Anima and pending episode are not owner b's.
        assert (await b.get(f"{RUNS}/current")).json() is None
        assert (await b.get(f"{RUNS}/{run_id}")).status_code == 404
        assert (await b.post(f"{RUNS}/{run_id}:complete")).status_code == 404
        assert (await b.post(f"{RUNS}/{run_id}/messages", json={"content": "notes/tea.md too"})).status_code == 404
        assert (await b.post(f"{APPROVALS}/{approval_id}:decide", json={"decision": "approve"})).status_code == 404
        assert (await b.post(f"{APPROVALS}/{approval_id}:undo")).status_code == 404
        assert (await b.post(f"{RUNS}:reflect", json={"anima_id": anima_id})).status_code == 404
        assert (await b.post(f"{RUNS}:process-episodes", json={})).status_code == 409
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
        assert (await a.post(f"{RUNS}/{run_id}/messages", json={"content": "Thank you"})).status_code == 200
        assert (await a.post(f"{RUNS}/{run_id}:complete")).json()["run"]["status"] == "completed"
        processing = await a.post(f"{RUNS}:process-episodes", json={})
        assert processing.status_code == 201, processing.text
        # The batch's note waits for approval; approving it finishes the processing run.
        episode_approval = processing.json()["approvals"][0]["id"]
        assert (await a.post(f"{APPROVALS}/{episode_approval}:decide", json={"decision": "approve"})).status_code == 200
        reflection = await a.post(f"{RUNS}:reflect", json={"anima_id": anima_id})
        assert reflection.status_code == 201, reflection.text

    # Each of owner a's seven writes committed once through the composition; the
    # reads ran on read sessions, which refuse writes.
    assert ports.commits == commits + 1 + 7
    assert set(ports.owners) == {owner_a, owner_b}


class _AdmittingPorts(DeferredCommitPorts):
    """A composition whose admission refuses Memory Manager work for now."""

    async def memory_manager(self, session, principal):  # noqa: ANN001, ANN201
        raise ProductRefusal(429, "memory_manager_busy")


async def test_a_composition_refusal_keeps_its_status_and_code(
    async_session_factory: async_sessionmaker[AsyncSession], tmp_path: Path
) -> None:
    ports = _AdmittingPorts(async_session_factory)
    composition = TwoOwnerComposition(product_app(memory_manager.router, ports=ports), tmp_path)

    async with composition.client(composition.owners[0]) as client:
        response = await client.post(RUNS, json={"message": "Hello"})

    assert (response.status_code, response.json()) == (429, {"detail": {"code": "memory_manager_busy"}})
    assert ports.commits == 0
