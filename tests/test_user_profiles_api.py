from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from uuid import uuid4

import pytest
from fastapi import FastAPI
from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession

from animama.adapters.repositories.sqlalchemy.uow import SQLAlchemyUnitOfWork
from animama.adapters.repositories.sqlalchemy.user_profile_repo import SQLAlchemyUserProfileRepository
from animama.app.services.user_profile_service import UserProfileService
from animama.domain.request_principal import RequestPrincipal
from animama.local.installation_model import ORMInstallationSettings
from animama.product_http.ports import install_product_ports
from animama.product_http.principal import get_current_principal
from animama.product_http.routes import profile
from animama.server.product_ports import LocalProductPorts
from tests.local_http_client import local_client


def _app(session: AsyncSession, owner_id: str) -> FastAPI:
    """The shared profile routes behind the local composition's ports and the test's session."""

    app = FastAPI()
    app.include_router(profile.router)

    async def principal() -> RequestPrincipal:
        return RequestPrincipal(id=owner_id)

    @asynccontextmanager
    async def database() -> AsyncIterator[AsyncSession]:
        yield session

    app.state.session_factory = database
    install_product_ports(app, LocalProductPorts(app))
    app.dependency_overrides[get_current_principal] = principal
    return app


async def _seed_owner(async_session, *, first_run_complete: bool = True) -> str:
    owner_id = str(uuid4())
    await async_session.execute(delete(ORMInstallationSettings))
    async_session.add(
        ORMInstallationSettings(
            id=1,
            installation_principal_id=owner_id,
            first_run_completed_at=datetime.now(UTC) if first_run_complete else None,
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

    async with local_client(app) as client:
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

    async with local_client(app) as client:
        assert (await client.patch("/v1/users/me/profile", json={"display_name": "Ada"})).status_code == 200
        rejected = await client.patch("/v1/users/me/profile", json=payload)
        assert rejected.status_code == 422
        assert (await client.get("/v1/users/me/profile")).json() == {"display_name": "Ada"}


async def test_profile_patch_requires_completed_first_run(async_session) -> None:
    owner_id = await _seed_owner(async_session, first_run_complete=False)
    app = _app(async_session, owner_id)

    async with local_client(app) as client:
        response = await client.patch("/v1/users/me/profile", json={"display_name": "Ada"})
    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "first_run_incomplete"


async def test_profile_patch_refuses_a_principal_that_does_not_own_the_installation(async_session) -> None:
    await _seed_owner(async_session)
    app = _app(async_session, str(uuid4()))

    async with local_client(app) as client:
        response = await client.patch("/v1/users/me/profile", json={"display_name": "Ada"})
    assert response.status_code == 403
    assert response.json()["detail"]["code"] == "installation_principal_mismatch"


async def test_local_profile_has_no_account_or_public_creator_fields(async_session) -> None:
    owner_id = await _seed_owner(async_session)
    app = _app(async_session, owner_id)

    async with local_client(app) as client:
        rejected = await client.patch(
            "/v1/users/me/profile",
            json={"display_name": "Ada", "username": "ada", "bio": "public"},
        )
        assert rejected.status_code == 422
        assert (await client.post("/v1/users/me/profile:ensure")).status_code == 404
        assert (await client.post("/v1/users/me/username:check", json={"username": "ada"})).status_code == 404
        assert (await client.get("/v1/creators/ada")).status_code == 404
