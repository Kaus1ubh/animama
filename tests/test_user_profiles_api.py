from __future__ import annotations

from datetime import datetime, timezone
from uuid import uuid4

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy import delete

from animama.adapters.repositories.sqlalchemy.uow import SQLAlchemyUnitOfWork
from animama.adapters.repositories.sqlalchemy.user_profile_repo import SQLAlchemyUserProfileRepository
from animama.app.services.user_profile_service import UserProfileService
from animama.domain.request_principal import RequestPrincipal
from animama.local.installation_model import ORMInstallationSettings
from animama.server.deps import get_async_session, get_current_principal
from animama.server.routers import user_profiles


def _app(session, owner_id: str) -> FastAPI:
    app = FastAPI()
    app.include_router(user_profiles.router)

    async def principal() -> RequestPrincipal:
        return RequestPrincipal(id=owner_id)

    async def database():
        yield session

    app.dependency_overrides[get_current_principal] = principal
    app.dependency_overrides[get_async_session] = database
    return app


async def _seed_owner(async_session, *, first_run_complete: bool = True) -> str:
    owner_id = str(uuid4())
    await async_session.execute(delete(ORMInstallationSettings))
    async_session.add(
        ORMInstallationSettings(
            id=1,
            installation_principal_id=owner_id,
            first_run_completed_at=datetime.now(timezone.utc) if first_run_complete else None,
        )
    )
    await async_session.commit()
    await UserProfileService(
        profiles=SQLAlchemyUserProfileRepository(async_session),
        uow=SQLAlchemyUnitOfWork(async_session),
    ).ensure_profile(user_id=owner_id)
    return owner_id


async def test_profile_can_start_unnamed_but_updates_require_a_private_name(async_session) -> None:
    owner_id = await _seed_owner(async_session)
    app = _app(async_session, owner_id)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get("/v1/users/me/profile")
        assert response.status_code == 200
        assert response.json() == {"display_name": None}

        updated = await client.patch("/v1/users/me/profile", json={"display_name": "  Ada   Lovelace "})
        assert updated.status_code == 200
        assert updated.json() == {"display_name": "Ada Lovelace"}


@pytest.mark.parametrize(
    "payload", [{}, {"display_name": None}, {"display_name": ""}, {"display_name": " \t "}, {"display_name": "x" * 81}]
)
async def test_profile_patch_cannot_clear_the_required_name(async_session, payload) -> None:
    owner_id = await _seed_owner(async_session)
    app = _app(async_session, owner_id)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        assert (await client.patch("/v1/users/me/profile", json={"display_name": "Ada"})).status_code == 200
        rejected = await client.patch("/v1/users/me/profile", json=payload)
        assert rejected.status_code == 422
        assert (await client.get("/v1/users/me/profile")).json() == {"display_name": "Ada"}


async def test_profile_patch_requires_completed_first_run(async_session) -> None:
    owner_id = await _seed_owner(async_session, first_run_complete=False)
    app = _app(async_session, owner_id)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.patch("/v1/users/me/profile", json={"display_name": "Ada"})
    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "first_run_incomplete"


async def test_local_profile_has_no_account_or_public_creator_fields(async_session) -> None:
    owner_id = await _seed_owner(async_session)
    app = _app(async_session, owner_id)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        rejected = await client.patch(
            "/v1/users/me/profile",
            json={"display_name": "Ada", "username": "ada", "bio": "public"},
        )
        assert rejected.status_code == 422
        assert (await client.post("/v1/users/me/profile:ensure")).status_code == 404
        assert (await client.post("/v1/users/me/username:check", json={"username": "ada"})).status_code == 404
        assert (await client.get("/v1/creators/ada")).status_code == 404
