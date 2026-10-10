"""Shared Anima routes isolate owners and commit through the composition (ADR 0021)."""

from __future__ import annotations

from pathlib import Path
from uuid import uuid4

from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from animama.adapters.repositories.sqlalchemy.model_provider_repo import SQLAlchemyModelProviderRepository
from animama.domain import ModelProvider
from animama.orm import ORMModelProvider
from animama.product_http.routes import animas
from tests.product_http_support import DeferredCommitPorts, TwoOwnerComposition, product_app
from tests.typed_loadout_support import cleanup_loadout_fixture, create_loadout_fixture

NOT_FOUND = (404, {"detail": "Anima not found"})


async def test_an_owner_never_reaches_another_owners_animas(
    async_session_factory: async_sessionmaker[AsyncSession], tmp_path: Path
) -> None:
    model = f"model-{uuid4().hex[:8]}"
    provider = ModelProvider(
        id=f"Provider:{model}",
        provider_type="Provider",
        model=model,
        model_label=model,
        provider_label="Provider",
        active=True,
    )
    async with async_session_factory() as session:
        fixture = await create_loadout_fixture(session)
        await SQLAlchemyModelProviderRepository(session).upsert_many([provider])
        await session.commit()
    ports = DeferredCommitPorts(async_session_factory)
    owner, other = fixture.user_id, f"owner-b-{uuid4().hex[:8]}"
    composition = TwoOwnerComposition(product_app(animas.router, ports=ports), tmp_path, owners=(owner, other))
    base = f"/v1/animas/{fixture.anima_id}"
    try:
        async with composition.client(other) as b:
            assert fixture.anima_id not in {anima["id"] for anima in (await b.get("/v1/animas")).json()}
            for response in (
                await b.get(base),
                await b.patch(base, json={"anima": {"display_name": "Taken"}, "expected_aggregate_revision": 1}),
                await b.patch(f"{base}/chat-profile", json={"default_model_provider_id": "model"}),
                await b.put(f"{base}/emotional-state", json={}),
                await b.delete(base),
            ):
                assert (response.status_code, response.json()) == NOT_FOUND
        assert ports.commits == ports.commits_requested == 0

        async with composition.client(owner) as a:
            assert fixture.anima_id in {anima["id"] for anima in (await a.get("/v1/animas")).json()}
            current = (await a.get(base)).json()
            renamed = await a.patch(
                base,
                json={
                    "anima": {"display_name": "Renamed"},
                    "expected_aggregate_revision": current["aggregate_revision"],
                },
            )
            assert renamed.status_code == 200, renamed.text
            chosen = await a.patch(f"{base}/chat-profile", json={"default_model_provider_id": provider.id})
            assert chosen.json()["chat_profile"]["default_model_provider_id"] == provider.id
            assert (await a.put(f"{base}/emotional-state", json={})).status_code == 200
            assert (await a.delete(base)).status_code == 204
            assert (await a.get(base)).status_code == 404
        # The rename, the chat model, the emotional state and the delete each committed
        # through the composition.
        assert ports.commits == 4
    finally:
        async with async_session_factory() as session:
            await cleanup_loadout_fixture(session, fixture)
            await session.execute(delete(ORMModelProvider).where(ORMModelProvider.id == provider.id))
            await session.commit()
