from __future__ import annotations

from dataclasses import replace
from datetime import UTC, datetime
from uuid import uuid4

import pytest
from fastapi import FastAPI
from sqlalchemy import delete

from animama.adapters.repositories.sqlalchemy.companion_safety_repo import SQLAlchemyCompanionSafetyRepository
from animama.adapters.repositories.sqlalchemy.user_profile_repo import SQLAlchemyUserProfileRepository
from animama.app.services.owner_bootstrap_service import OwnerBootstrapResult, OwnerBootstrapService
from animama.domain.request_principal import RequestPrincipal
from animama.domain.user_profile import UserProfile
from animama.local.installation_model import ORMInstallationSettings
from animama.local.installation_principal import InstallationPrincipalInvalidError
from animama.server.deps import get_async_session, get_current_principal
from animama.server.local_installation_bootstrap import LocalInstallationBootstrapService
from animama.server.routers import runtime_context
from tests.local_http_client import local_client


class FakeOwnerBootstrap(OwnerBootstrapService):
    def __init__(self, calls: list[str], result: OwnerBootstrapResult | None = None) -> None:
        self._calls = calls
        self._result = result or OwnerBootstrapResult()

    async def ensure(self, *, owner_id: str, policy):  # noqa: ANN001
        assert policy.profile_template_version == "1"
        self._calls.append(owner_id)
        return self._result


class RecoveringOwnerBootstrap(OwnerBootstrapService):
    def __init__(self) -> None:
        self.calls = 0

    async def ensure(self, *, owner_id: str, policy):  # noqa: ANN001
        del owner_id, policy
        self.calls += 1
        if self.calls == 1:
            return OwnerBootstrapResult(failed_steps=("local_profile",))
        return OwnerBootstrapResult()


async def _replace_principal(session_factory, principal_id: str | None) -> None:  # noqa: ANN001
    async with session_factory() as session:
        await session.execute(delete(ORMInstallationSettings))
        if principal_id is not None:
            session.add(ORMInstallationSettings(id=1, installation_principal_id=principal_id))
        await session.commit()


async def test_local_bootstrap_reuses_the_migration_owned_principal(async_session_factory) -> None:
    principal_id = str(uuid4())
    await _replace_principal(async_session_factory, principal_id)
    owner_calls: list[str] = []
    reconciliation_calls: list[str] = []

    async def reconcile(owner_id: str) -> None:
        reconciliation_calls.append(owner_id)

    service = LocalInstallationBootstrapService(
        session_factory=async_session_factory,
        owner_service_factory=lambda _session: FakeOwnerBootstrap(owner_calls),
        reconcile_content=reconcile,
    )

    first = await service.ensure()
    second = await service.ensure()
    assert first.principal_id == second.principal_id == principal_id
    assert first.status == second.status == "ready"
    assert owner_calls == [principal_id, principal_id]
    assert reconciliation_calls == [principal_id, principal_id]


async def test_local_bootstrap_maps_content_failure_to_a_bounded_repair_step(async_session_factory) -> None:
    principal_id = str(uuid4())
    await _replace_principal(async_session_factory, principal_id)

    async def fail_reconcile(_owner_id: str) -> None:
        raise RuntimeError("private path details must not escape")

    service = LocalInstallationBootstrapService(
        session_factory=async_session_factory,
        owner_service_factory=lambda _session: FakeOwnerBootstrap([]),
        reconcile_content=fail_reconcile,
    )
    state = await service.ensure()
    assert state.status == "repair_required"
    assert state.failed_steps == ("starter_animas",)


async def test_local_bootstrap_retries_a_bounded_owner_failure(async_session_factory) -> None:
    principal_id = str(uuid4())
    await _replace_principal(async_session_factory, principal_id)
    owner_bootstrap = RecoveringOwnerBootstrap()
    service = LocalInstallationBootstrapService(
        session_factory=async_session_factory,
        owner_service_factory=lambda _session: owner_bootstrap,
        reconcile_content=lambda _owner_id: _noop(),
    )

    first = await service.ensure()
    second = await service.ensure()

    assert first.failed_steps == ("local_profile",)
    assert second.status == "ready"
    assert owner_bootstrap.calls == 2


async def test_missing_installation_singleton_fails_closed(async_session_factory) -> None:
    await _replace_principal(async_session_factory, None)
    service = LocalInstallationBootstrapService(
        session_factory=async_session_factory,
        owner_service_factory=lambda _session: FakeOwnerBootstrap([]),
        reconcile_content=lambda _owner_id: _noop(),
    )

    with pytest.raises(InstallationPrincipalInvalidError):
        await service.ensure()


async def _runtime_app(session_factory, principal_id: str) -> FastAPI:
    """Provide real runtime routes with an explicit test principal and private DB."""
    await _replace_principal(session_factory, principal_id)
    async with session_factory() as session:
        await SQLAlchemyUserProfileRepository(session).create_profile(UserProfile(user_id=principal_id))
        await session.commit()

    service = LocalInstallationBootstrapService(
        session_factory=session_factory,
        owner_service_factory=lambda _session: FakeOwnerBootstrap([]),
        reconcile_content=lambda _owner_id: _noop(),
    )
    await service.ensure()

    app = FastAPI()
    app.state.local_installation_bootstrap_service = service
    app.include_router(runtime_context.router)

    async def principal() -> RequestPrincipal:
        return RequestPrincipal(id=principal_id)

    async def database():
        async with session_factory() as session:
            yield session

    app.dependency_overrides[get_current_principal] = principal
    app.dependency_overrides[get_async_session] = database
    return app


async def test_runtime_context_is_bounded_and_rejects_a_mismatched_principal(async_session_factory) -> None:
    principal_id = str(uuid4())
    app = await _runtime_app(async_session_factory, principal_id)

    async with local_client(app) as client:
        response = await client.get("/v1/runtime-context")
        assert response.status_code == 200
        assert response.json() == {
            "schema_version": 1,
            "principal_id": principal_id,
            "bootstrap_status": "ready",
            "failed_steps": [],
            "first_run_complete": False,
            "display_name": None,
        }

        app.dependency_overrides[get_current_principal] = lambda: RequestPrincipal(id=str(uuid4()))
        mismatch = await client.get("/v1/runtime-context")
        assert mismatch.status_code == 403
        assert mismatch.json()["detail"]["code"] == "installation_principal_mismatch"


async def test_runtime_context_requires_a_name_even_after_an_earlier_skip(async_session_factory) -> None:
    principal_id = str(uuid4())
    app = await _runtime_app(async_session_factory, principal_id)
    async with async_session_factory() as session:
        installation = await session.get(ORMInstallationSettings, 1)
        installation.first_run_completed_at = datetime.now(UTC)
        await SQLAlchemyCompanionSafetyRepository(session).record_age_status(
            principal_id, status="adult", source="self_attestation", recorded_at=datetime.now(UTC)
        )
        await session.commit()

    async with local_client(app) as client:
        for name in [None, " \t ", "Ada"]:
            async with async_session_factory() as session:
                profiles = SQLAlchemyUserProfileRepository(session)
                profile = await profiles.get_profile(principal_id)
                assert profile is not None
                await profiles.update_profile(replace(profile, display_name=name))
                await session.commit()
            response = await client.get("/v1/runtime-context")
            assert response.status_code == 200
            assert response.json()["first_run_complete"] is (name == "Ada")
            assert response.json()["principal_id"] == principal_id


@pytest.mark.parametrize(
    "payload",
    [
        {},
        {"display_name": None, "adult_confirmed": True},
        {"display_name": "", "adult_confirmed": True},
        {"display_name": " \t ", "adult_confirmed": True},
        {"display_name": "x" * 81, "adult_confirmed": True},
        {"display_name": "Ada"},
        {"display_name": "Ada", "adult_confirmed": False},
    ],
)
async def test_onboarding_api_rejects_missing_blank_or_overlong_names(async_session_factory, payload) -> None:
    principal_id = str(uuid4())
    app = await _runtime_app(async_session_factory, principal_id)
    async with local_client(app) as client:
        response = await client.post("/v1/runtime/onboarding:complete", json=payload)
        assert response.status_code == 422
        context = (await client.get("/v1/runtime-context")).json()
        assert context["first_run_complete"] is False
        assert context["display_name"] is None


async def _noop() -> None:
    return None


async def test_runtime_context_requires_the_adult_confirmation(async_session_factory) -> None:
    principal_id = str(uuid4())
    app = await _runtime_app(async_session_factory, principal_id)
    async with async_session_factory() as session:
        installation = await session.get(ORMInstallationSettings, 1)
        installation.first_run_completed_at = datetime.now(UTC)
        profiles = SQLAlchemyUserProfileRepository(session)
        profile = await profiles.get_profile(principal_id)
        assert profile is not None
        await profiles.update_profile(replace(profile, display_name="Ada"))
        await session.commit()

    async with local_client(app) as client:
        assert (await client.get("/v1/runtime-context")).json()["first_run_complete"] is False
