from __future__ import annotations

import inspect
import os
from importlib import import_module
from pathlib import Path
from types import SimpleNamespace
from typing import Annotated

import pytest
from fastapi import Depends, FastAPI
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient

from animama.app.services import content_catalog_service, owner_bootstrap_service
from animama.domain.request_principal import RequestPrincipal
from animama.local.http.lifecycle import AdmittedLocalPrincipalResolver
from animama.runtime import cli
from animama.server.app import create_local_app
from animama.server.config import Settings
from animama.server.deps import get_current_principal
from animama.server.runtime_credentials import PinnedCredentialsMiddleware
from tests.route_support import served_routes


def test_local_app_stays_fail_closed_before_completed_bootstrap(tmp_path: Path) -> None:
    app = create_local_app(
        runtime_settings=Settings(
            animama_public_origin="http://localhost:8000",
            animama_content_root=tmp_path / "content",
            animama_data_root=tmp_path / "data",
        )
    )

    assert isinstance(app.state.request_principal_resolver, AdmittedLocalPrincipalResolver)
    client = TestClient(app, base_url="http://localhost:8000", raise_server_exceptions=False)
    try:
        # Avoid lifespan: startup must require the migration-owned principal.
        assert client.get("/health").status_code == 503
        response = client.get("/v1/users/me/profile")
    finally:
        client.close()
    assert response.status_code == 503
    assert response.json() == {"error": "local_runtime_unavailable"}


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

    def resolves_principal(dependency) -> bool:
        return dependency.call is get_current_principal or any(
            resolves_principal(child) for child in dependency.dependencies
        )

    unprotected = [
        route.path
        for route in served_routes(app)
        if isinstance(route, APIRoute) and route.path.startswith("/v1") and not resolves_principal(route.dependant)
    ]
    assert unprotected == []


@pytest.mark.parametrize("desktop_cli", [False, True])
def test_startup_admits_only_the_bootstrap_owner_without_gateway_assertions(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, desktop_cli: bool
) -> None:
    app_module = import_module("animama.server.app")
    principal_id = "11111111-1111-4111-8111-111111111111"

    class Bootstrap:
        async def ensure(self):
            return SimpleNamespace(principal_id=principal_id, failed_steps=(), content_ready=True)

    async def no_op(*args, **kwargs) -> None:
        return None

    monkeypatch.setattr(app_module, "initialize_local_runtime", lambda settings: object())
    monkeypatch.setattr(
        app_module,
        "create_local_installation_bootstrap_service",
        lambda **kwargs: Bootstrap(),
    )
    monkeypatch.setattr(app_module, "start_content_runtime", no_op)
    monkeypatch.setattr(app_module, "stop_content_runtime", no_op)
    # Upload processing needs real private roots and a database; admission does not.
    monkeypatch.setattr(app_module, "start_user_file_processing", lambda *args, **kwargs: None)
    monkeypatch.setattr(app_module, "stop_user_file_processing", no_op)

    runtime_settings = Settings(
        animama_content_root=tmp_path / "content",
        animama_data_root=tmp_path / "data",
        animama_public_origin="http://127.0.0.1:12345" if desktop_cli else "http://localhost:8000",
    )
    token = "e" * 64
    monkeypatch.setenv("ANIMAMA_CONNECTION_C1_API_KEY", "sk-connection-fixture")
    if desktop_cli:
        import uvicorn

        applications: list[FastAPI] = []
        web_root = tmp_path / "web"
        web_root.mkdir()
        (web_root / "index.html").write_text("<html>fixture</html>")
        monkeypatch.setenv("ANIMAMA_PUBLIC_ORIGIN", "http://127.0.0.1:12345")
        monkeypatch.setenv("ANIMAMA_WEB_ROOT", str(web_root))
        monkeypatch.setenv("ANIMAMA_DESKTOP_RENDERER_CAPABILITY", token)
        monkeypatch.setenv("ANIMAMA_DESKTOP_CONTROL_TOKEN", "c" * 64)
        monkeypatch.setenv("ANIMAMA_PROCESS_START_TOKEN", "11111111-1111-4111-8111-111111111111")
        monkeypatch.setattr(uvicorn, "run", lambda app, **kwargs: applications.append(app))
        assert cli.main(["serve", "--port", "12345"]) == 0
        application = applications[0]
    else:
        application = create_local_app(runtime_settings=runtime_settings)

    # Every request is pinned to its credentials, outside all other middleware.
    assert application.user_middleware[0].cls is PinnedCredentialsMiddleware  # type: ignore[comparison-overlap]
    # Only the desktop backend, whose keys change at runtime, drops them from its environment.
    credential_names = {"OPENAI_API_KEY", "ANIMAMA_CONNECTION_C1_API_KEY"}
    if desktop_cli:
        assert credential_names.isdisjoint(os.environ)
    else:
        assert credential_names <= set(os.environ)

    @application.get("/_test/principal")
    async def principal_probe(principal: Annotated[RequestPrincipal, Depends(get_current_principal)]) -> str:
        return principal.id

    # Real product routes precede the static catch-all. Keep the test probe in
    # that same position when the desktop fixture includes built assets.
    application.router.routes.insert(0, application.router.routes.pop())
    origin = runtime_settings.animama_public_origin
    browser = {"origin": origin, "sec-fetch-site": "same-origin"}
    if desktop_cli:
        browser["cookie"] = f"animama_renderer_capability={token}"
    with TestClient(application, base_url=origin, headers=browser) as client:
        assert isinstance(application.state.request_principal_resolver, AdmittedLocalPrincipalResolver)
        assert client.get("/_test/principal").json() == principal_id
        headers = {"X-Animama-Principal-Id": "forged", "X-Animama-Internal-Token": "forged"}
        assert client.get("/_test/principal", headers=headers).json() == principal_id
        assert client.get("/_test/principal", headers={"origin": "https://foreign.invalid"}).status_code == 403
