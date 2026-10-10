"""Shared profile routes isolate owners and commit through the composition (ADR 0021)."""

from __future__ import annotations

from pathlib import Path
from uuid import uuid4

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from animama.adapters.repositories.sqlalchemy.product_repositories import SQLAlchemyProductRepositories
from animama.app.services.user_profile_service import UserProfileService
from animama.product_http.routes import profile
from tests.product_http_support import DeferredCommitPorts, TwoOwnerComposition, product_app

PROFILE = "/v1/users/me/profile"


async def test_owners_keep_separate_profiles_and_writes_commit_through_the_composition(
    async_session_factory: async_sessionmaker[AsyncSession], tmp_path: Path
) -> None:
    ports = DeferredCommitPorts(async_session_factory)
    owner_a, owner_b = f"owner-a-{uuid4().hex[:8]}", f"owner-b-{uuid4().hex[:8]}"
    composition = TwoOwnerComposition(product_app(profile.router, ports=ports), tmp_path, owners=(owner_a, owner_b))
    async with async_session_factory() as session:
        repositories = SQLAlchemyProductRepositories(session)
        service = UserProfileService(profiles=repositories.user_profiles, uow=repositories.unit_of_work)
        for owner in composition.owners:
            await service.ensure_profile(user_id=owner)

    async with composition.client(owner_a) as a:
        updated = await a.patch(PROFILE, json={"display_name": " Ada  Lovelace "})
        assert updated.status_code == 200
        assert updated.json() == {"display_name": "Ada Lovelace"}

    async with composition.client(owner_b) as b:
        assert (await b.get(PROFILE)).json() == {"display_name": None}
        assert (await b.patch(PROFILE, json={"display_name": "Grace"})).status_code == 200

    async with composition.client(owner_a) as a:
        assert (await a.get(PROFILE)).json() == {"display_name": "Ada Lovelace"}

    async with composition.client(f"owner-c-{uuid4().hex[:8]}") as c:
        # An owner without a profile is refused, and the refusal commits nothing.
        missing = await c.patch(PROFILE, json={"display_name": "Nobody"})
        assert missing.status_code == 404
        assert missing.json() == {"detail": {"code": "user_profile_missing"}}
        assert (await c.get(PROFILE)).status_code == 404

    # Each saved name committed once, through the composition, after its handler.
    assert ports.commits == ports.commits_requested == 2
