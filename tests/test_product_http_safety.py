"""The shared crisis-resource route reads only the caller's preference (ADR 0021)."""

from __future__ import annotations

from pathlib import Path
from uuid import uuid4

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from animama.orm.settings import ORMUserSettings
from animama.product_http.routes import safety
from tests.product_http_support import DeferredCommitPorts, TwoOwnerComposition, product_app

CRISIS_RESOURCES = "/v1/safety/crisis-resources"


async def test_each_owner_sees_only_its_own_crisis_resource_preference(
    async_session_factory: async_sessionmaker[AsyncSession], tmp_path: Path
) -> None:
    ports = DeferredCommitPorts(async_session_factory)
    owner_a, owner_b = f"owner-a-{uuid4().hex[:8]}", f"owner-b-{uuid4().hex[:8]}"
    composition = TwoOwnerComposition(product_app(safety.router, ports=ports), tmp_path, owners=(owner_a, owner_b))
    async with async_session_factory() as session:
        session.add(ORMUserSettings(user_id=owner_a, preferences={"safety": {"crisis_resource_region": "GB"}}))
        await session.commit()

    async with composition.client(owner_a) as a:
        preferred = (await a.get(CRISIS_RESOURCES, params={"locale": "en-AU"})).json()
        assert (preferred["preferred_region"], preferred["resolved"]["code"]) == ("GB", "GB")

    async with composition.client(owner_b) as b:
        by_locale = (await b.get(CRISIS_RESOURCES, params={"locale": "en-AU"})).json()
        assert (by_locale["preferred_region"], by_locale["resolved"]["code"]) == (None, "AU")
        assert {"US", "CA", "GB", "IE", "AU"} <= {region["code"] for region in by_locale["regions"]}

    # Reads open each owner's own read session and commit nothing.
    assert ports.owners == [owner_a, owner_b]
    assert ports.commits == ports.commits_requested == 0
