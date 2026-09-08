from __future__ import annotations

from typing import Annotated

from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient
from httpx import ASGITransport, AsyncClient
from starlette.websockets import WebSocketDisconnect

from animama.domain.request_principal import RequestPrincipal
from animama.local.gateway_principal import FailClosedLocalPrincipalResolver
from animama.server.deps import get_current_principal
from animama.server.routers import logs


async def test_fail_closed_http_dependency_returns_stable_error() -> None:
    app = FastAPI()
    app.state.request_principal_resolver = FailClosedLocalPrincipalResolver()

    @app.get("/product")
    async def product(
        _principal: Annotated[RequestPrincipal, Depends(get_current_principal)],
    ) -> dict[str, bool]:
        return {"ok": True}

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get("/product", headers={"X-Animama-Principal-Id": "spoofed"})

    assert response.status_code == 503
    assert response.json() == {"detail": {"code": "local_gateway_unavailable"}}


def test_fail_closed_websocket_closes_before_accept() -> None:
    app = FastAPI()
    app.state.request_principal_resolver = FailClosedLocalPrincipalResolver()
    app.include_router(logs.router)

    with TestClient(app) as client:
        try:
            with client.websocket_connect("/v1/logs"):
                raise AssertionError("the fail-closed WebSocket must not connect")
        except WebSocketDisconnect as exc:
            assert getattr(exc, "code", None) == 1008
