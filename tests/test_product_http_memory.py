"""Shared memory routes isolate owners and commit through the composition (ADR 0021)."""

from __future__ import annotations

from datetime import UTC, date, datetime
from pathlib import Path
from uuid import uuid4

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from animama.orm import ORMAnima, ORMMemoryEntry, ORMMemoryEpisodeItem
from animama.product_http.routes import memory
from tests.product_http_support import DeferredCommitPorts, TwoOwnerComposition, product_app


def composition_for(
    factory: async_sessionmaker[AsyncSession], root: Path
) -> tuple[TwoOwnerComposition, DeferredCommitPorts]:
    ports = DeferredCommitPorts(factory)
    owners = (f"owner-a-{uuid4().hex[:8]}", f"owner-b-{uuid4().hex[:8]}")
    return TwoOwnerComposition(product_app(memory.router, ports=ports), root, owners=owners), ports


async def stored_entry(factory: async_sessionmaker[AsyncSession], entry_id: str) -> ORMMemoryEntry | None:
    async with factory() as session:
        return await session.get(ORMMemoryEntry, entry_id)


async def test_an_owner_never_reaches_another_owners_memory(
    async_session_factory: async_sessionmaker[AsyncSession], tmp_path: Path
) -> None:
    composition, ports = composition_for(async_session_factory, tmp_path)
    owner_a, owner_b = composition.owners
    marker = f"zebra{uuid4().hex[:8]}"
    path = f"notes/{marker}.md"
    anima_id = f"anima-{uuid4().hex}"
    async with async_session_factory() as session:
        session.add(ORMAnima(id=anima_id, user_id=owner_a))
        session.add(
            ORMMemoryEpisodeItem(
                id=f"episode-{uuid4()}",
                user_id=owner_a,
                occurred_at=datetime(2026, 9, 26, 12, tzinfo=UTC),
                local_date=date(2026, 9, 26),
                episode_path="episodes/2026/09/2026-09-26.md",
                kind="chat_turn",
                text=marker,
                status="pending",
            )
        )
        await session.commit()

    async with composition.client(owner_a) as a:
        created = await a.post(
            "/v1/memory/entries",
            json={"type": "file", "name": path, "content": f"{marker} a", "create_parents": True},
        )
        assert created.status_code == 201, created.text
        entry_id = created.json()["id"]
        assert (
            await a.patch(f"/v1/memory/entries/{entry_id}", json={"expected_version": 1, "content": f"{marker} v2"})
        ).status_code == 200
        assert (await a.post(f"/v1/memory/anima-memories/{anima_id}:repair")).status_code == 200
    # Create, patch and repair each committed once, through the composition.
    assert ports.commits == ports.commits_requested == 3
    commits_before = ports.commits

    async with composition.client(owner_b) as b:
        assert entry_id not in {
            entry["id"] for entry in (await b.get("/v1/memory/entries", params={"recursive": True})).json()["entries"]
        }
        assert anima_id not in {
            item["anima_id"] for item in (await b.get("/v1/memory/anima-identities")).json()["identities"]
        }
        assert (await b.post(f"/v1/memory/anima-memories/{anima_id}:repair")).status_code == 404
        foreign = {"anima_id": anima_id, "type": "file", "name": "identity.md", "content": marker}
        for refused in (
            await b.post("/v1/memory/entries", json=foreign),
            await b.get("/v1/memory/entries", params={"anima_id": anima_id}),
        ):
            assert (refused.status_code, refused.json()) == (404, {"detail": "Anima not found"})
        assert (await b.get("/v1/memory/entries/by-path", params={"path": path})).status_code == 404
        assert (await b.get(f"/v1/memory/entries/{entry_id}/versions")).status_code == 404
        assert (await b.get(f"/v1/memory/entries/{entry_id}/versions/1")).status_code == 404
        assert (await b.get(f"/v1/memory/entries/{entry_id}")).status_code == 404
        search = await b.post("/v1/memory/debug/search-memory-files", json={"query": marker})
        assert search.json()["memory_results"] == []
        assert (
            await b.patch(f"/v1/memory/entries/{entry_id}", json={"expected_version": 2, "content": "x"})
        ).status_code == 404
        revert = await b.post(
            f"/v1/memory/entries/{entry_id}:revert", json={"target_version": 1, "expected_version": 2}
        )
        assert revert.status_code == 404
        assert (await b.delete(f"/v1/memory/entries/{entry_id}", params={"expected_version": 2})).status_code == 404
        assert marker not in {item["text"] for item in (await b.get("/v1/memory/episodes")).json()["items"]}

    async with composition.client(owner_a) as a:
        assert marker in {item["text"] for item in (await a.get("/v1/memory/episodes")).json()["items"]}
        assert [
            hit["path"]
            for hit in (await a.post("/v1/memory/debug/search-memory-files", json={"query": marker})).json()[
                "memory_results"
            ]
        ] == [path]

    # Owner b's refusals changed nothing and committed nothing.
    entry = await stored_entry(async_session_factory, entry_id)
    assert entry is not None and entry.user_id == owner_a and entry.version == 2 and entry.deleted_at is None
    assert ports.commits == commits_before


async def test_memory_writes_commit_through_the_composition(
    async_session_factory: async_sessionmaker[AsyncSession], tmp_path: Path
) -> None:
    composition, ports = composition_for(async_session_factory, tmp_path)
    owner_a = composition.owners[0]
    async with composition.client(owner_a) as a:
        created = await a.post("/v1/memory/entries", json={"type": "file", "name": "plan.md", "content": "one"})
        assert created.status_code == 201, created.text
        entry_id = created.json()["id"]
        assert (await stored_entry(async_session_factory, entry_id)) is not None
        assert (
            await a.patch(f"/v1/memory/entries/{entry_id}", json={"expected_version": 1, "content": "two"})
        ).status_code == 200
        reverted = await a.post(
            f"/v1/memory/entries/{entry_id}:revert", json={"target_version": 1, "expected_version": 2}
        )
        assert reverted.status_code == 200 and reverted.json()["content"] == "one"
        assert (await a.delete(f"/v1/memory/entries/{entry_id}", params={"expected_version": 3})).status_code == 204
    entry = await stored_entry(async_session_factory, entry_id)
    assert entry is not None and entry.deleted_at is not None
    # Each write committed once, through the composition, after its handler.
    assert ports.commits == ports.commits_requested == 4
