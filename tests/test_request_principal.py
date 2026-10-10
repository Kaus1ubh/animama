from __future__ import annotations

from typing import Annotated

from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient
from httpx import ASGITransport, AsyncClient
from starlette.websockets import WebSocketDisconnect

from animama.domain.request_principal import RequestPrincipal
from animama.local.http.lifecycle import AdmittedLocalPrincipalResolver, LocalHTTPLifecycle
from animama.server.deps import get_current_principal
from animama.server.routers import logs


async def test_fail_closed_http_dependency_returns_stable_error() -> None:
    app = FastAPI()
    app.state.request_principal_resolver = AdmittedLocalPrincipalResolver(LocalHTTPLifecycle())

    @app.get("/product")
    async def product(
        _principal: Annotated[RequestPrincipal, Depends(get_current_principal)],
    ) -> dict[str, bool]:
        return {"ok": True}

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get("/product", headers={"X-Animama-Principal-Id": "spoofed"})

    assert response.status_code == 503
    assert response.json() == {"detail": {"code": "local_runtime_unavailable"}}


def test_fail_closed_websocket_closes_before_accept() -> None:
    app = FastAPI()
    app.state.request_principal_resolver = AdmittedLocalPrincipalResolver(LocalHTTPLifecycle())
    app.include_router(logs.router)

    with TestClient(app) as client:
        try:
            with client.websocket_connect("/v1/logs"):
                raise AssertionError("the fail-closed WebSocket must not connect")
        except WebSocketDisconnect as exc:
            assert getattr(exc, "code", None) == 1008


async def test_missing_resolver_fails_closed_with_a_stable_code() -> None:
    app = FastAPI()

    @app.get("/product")
    async def product(
        _principal: Annotated[RequestPrincipal, Depends(get_current_principal)],
    ) -> dict[str, bool]:
        return {"ok": True}

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get("/product")

    assert response.status_code == 503
    assert response.json() == {"detail": {"code": "request_principal_unavailable"}}


def test_server_deps_reexports_the_shared_principal_objects() -> None:
    # Dependency overrides and the route-dependency check rely on object identity.
    from animama.product_http import principal
    from animama.server import deps

    assert deps.get_current_principal is principal.get_current_principal
    assert deps.resolve_websocket_principal is principal.resolve_websocket_principal
