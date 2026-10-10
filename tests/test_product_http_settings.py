"""Shared settings routes isolate owners and commit through the composition (ADR 0021)."""

from __future__ import annotations

from pathlib import Path
from uuid import uuid4

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from animama.orm import ORMAnima
from animama.product_http.routes import settings
from tests.product_http_support import DeferredCommitPorts, TwoOwnerComposition, product_app

USER_SETTINGS = "/v1/users/me/settings"


async def test_owners_keep_separate_settings_and_cannot_reach_each_others_animas(
    async_session_factory: async_sessionmaker[AsyncSession], tmp_path: Path
) -> None:
    ports = DeferredCommitPorts(async_session_factory)
    owner_a, owner_b = f"owner-a-{uuid4().hex[:8]}", f"owner-b-{uuid4().hex[:8]}"
    composition = TwoOwnerComposition(product_app(settings.router, ports=ports), tmp_path, owners=(owner_a, owner_b))
    anima_id = f"anima-{uuid4().hex}"
    async with async_session_factory() as session:
        session.add(ORMAnima(id=anima_id, user_id=owner_a))
        await session.commit()

    async with composition.client(owner_a) as a:
        assert (await a.post(USER_SETTINGS, json={"locale": "fr-FR"})).status_code == 201
        assert (await a.patch(f"/v1/animas/{anima_id}/settings", json={"favorited": True})).status_code == 200
    commits = ports.commits

    async with composition.client(owner_b) as b:
        # Owner b sees only its own (default) user settings and creates its own row.
        assert (await b.get(USER_SETTINGS)).json()["locale"] == "en-US"
        assert (await b.post(USER_SETTINGS, json={"theme": "dusk"})).status_code == 201
        assert (await b.patch(USER_SETTINGS, json={"locale": "de-DE"})).status_code == 200
        assert (await b.delete(USER_SETTINGS)).status_code == 204
        for request in (b.get, b.delete):
            assert (await request(f"/v1/animas/{anima_id}/settings")).status_code == 404
        assert (await b.patch(f"/v1/animas/{anima_id}/settings", json={"favorited": False})).status_code == 404

    async with composition.client(owner_a) as a:
        assert (await a.get(USER_SETTINGS)).json()["locale"] == "fr-FR"
        assert (await a.get(f"/v1/animas/{anima_id}/settings")).json()["favorited"] is True
        assert (await a.delete(f"/v1/animas/{anima_id}/settings")).status_code == 204
        assert (await a.get(f"/v1/animas/{anima_id}/settings")).json()["favorited"] is False

    # Owner b's three writes and owner a's delete committed through the composition;
    # owner b's refused Anima writes committed nothing.
    assert ports.commits == commits + 4
    assert ports.commits == ports.commits_requested
    # Each user-settings write told the composition whose settings changed.
    assert ports.settings_changes == [owner_a, owner_b, owner_b, owner_b]
