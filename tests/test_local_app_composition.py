from __future__ import annotations

import inspect
from importlib import import_module
from pathlib import Path
from types import SimpleNamespace
from typing import Annotated

import pytest
from fastapi import Depends
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient

from animama.app.services import content_catalog_service, owner_bootstrap_service
from animama.local.gateway_principal import (
    FailClosedLocalPrincipalResolver,
    LocalGatewayPrincipalResolver,
    RequestPrincipal,
)
from animama.runtime import cli
from animama.server.app import create_local_app
from animama.server.config import Settings
from animama.server.deps import get_current_principal


def test_local_app_stays_fail_closed_before_startup_installs_gateway_resolver(tmp_path: Path) -> None:
    app = create_local_app(
        runtime_settings=Settings(
            animama_content_root=tmp_path / "content",
            animama_data_root=tmp_path / "data",
        )
    )

    assert isinstance(app.state.request_principal_resolver, FailClosedLocalPrincipalResolver)
    client = TestClient(app, raise_server_exceptions=False)
    try:
        # Avoid lifespan: startup requires the migrated principal and token file.
        assert client.get("/health").json() == {"status": "ok"}
        response = client.get("/v1/users/me/profile")
    finally:
        client.close()
    assert response.status_code == 503
    assert response.json()["detail"]["code"] == "local_gateway_unavailable"


def test_shared_owner_services_do_not_import_local_installation_state() -> None:
    for module in (owner_bootstrap_service, content_catalog_service):
        source = inspect.getsource(module)
        assert "installation_settings" not in source
        assert "ORMInstallationSettings" not in source


def test_every_local_product_http_route_requires_the_principal_dependency(tmp_path: Path) -> None:
    app = create_local_app(
        runtime_settings=Settings(
            animama_content_root=tmp_path / "content",
            animama_data_root=tmp_path / "data",
        )
    )

    def resolves_principal(dependency) -> bool:  # noqa: ANN001
        return dependency.call is get_current_principal or any(
            resolves_principal(child) for child in dependency.dependencies
        )

    unprotected = [
        route.path
        for route in app.routes
        if isinstance(route, APIRoute) and route.path.startswith("/v1") and not resolves_principal(route.dependant)
    ]
    assert unprotected == []


@pytest.mark.parametrize("desktop_cli", [False, True])
def test_startup_installs_the_gateway_resolver_from_bootstrap_state(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, desktop_cli: bool
) -> None:
    app_module = import_module("animama.server.app")
    principal_id = "11111111-1111-4111-8111-111111111111"

    class Bootstrap:
        async def ensure(self):  # noqa: ANN202
            return SimpleNamespace(principal_id=principal_id, failed_steps=())

    async def no_op(*args, **kwargs) -> None:  # noqa: ANN002, ANN003
        return None

    monkeypatch.setattr(app_module, "initialize_local_runtime", lambda settings: object())
    monkeypatch.setattr(
        app_module,
        "create_local_installation_bootstrap_service",
        lambda **kwargs: Bootstrap(),
    )
    monkeypatch.setattr(app_module, "start_content_runtime", no_op)
    monkeypatch.setattr(app_module, "stop_content_runtime", no_op)

    runtime_settings = Settings(
        animama_content_root=tmp_path / "content",
        animama_data_root=tmp_path / "data",
        animama_internal_token_file=None,
    )
    token = "e" * 64
    if desktop_cli:
        import uvicorn

        applications = []
        monkeypatch.setattr(app_module, "settings", runtime_settings)
        monkeypatch.setenv("ANIMAMA_INTERNAL_GATEWAY_TOKEN", token)
        monkeypatch.setattr(uvicorn, "run", lambda app, **kwargs: applications.append(app))
        assert cli.main(["serve", "--port", "12345"]) == 0
        application = applications[0]
    else:
        application = create_local_app(runtime_settings=runtime_settings, internal_gateway_token=token)

    @application.get("/_test/principal")
    async def principal_probe(principal: Annotated[RequestPrincipal, Depends(get_current_principal)]) -> str:
        return principal.id

    with TestClient(application) as client:
        assert isinstance(application.state.request_principal_resolver, LocalGatewayPrincipalResolver)
        assert client.get("/_test/principal").status_code == 401
        headers = {"X-Animama-Principal-Id": principal_id, "X-Animama-Internal-Token": token}
        assert client.get("/_test/principal", headers=headers).json() == principal_id
        headers["X-Animama-Internal-Token"] = "f" * 64
        assert client.get("/_test/principal", headers=headers).status_code == 401
