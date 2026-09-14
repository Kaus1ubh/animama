from __future__ import annotations

from contextlib import asynccontextmanager
from copy import deepcopy
from pathlib import Path

import httpx
import pytest
from fastapi import FastAPI

from animama.local.http.assets import LocalAssets
from animama.local.http.composition import install_local_http
from animama.local.http.config import DesktopAccess, LocalHTTPConfig
from animama.local.http.lifecycle import LocalHTTPLifecycle
from animama.local.http.telemetry import TelemetryConfig, TelemetryDestinations, TelemetryForwarder


@pytest.mark.parametrize("custom_lifespan", [False, True])
async def test_installed_telemetry_cleanup_preserves_default_and_custom_application_lifespans(
    custom_lifespan: bool,
) -> None:
    events = []

    @asynccontextmanager
    async def lifespan(application: FastAPI):
        events.append("startup")
        try:
            yield {"existing_lifespan_state": "preserved"}
        finally:
            events.append("shutdown")

    application = FastAPI(lifespan=lifespan) if custom_lifespan else FastAPI()
    destinations = TelemetryDestinations(
        traces="http://collector:4318/v1/traces",
        metrics="http://collector:4318/v1/metrics",
        logs="http://collector:4318/v1/logs",
    )
    forwarder = TelemetryForwarder(
        TelemetryConfig(enabled=True, destinations=destinations),
        transport=httpx.MockTransport(lambda _: pytest.fail("Application lifecycle must not send telemetry")),
    )
    install_local_http(application, LocalHTTPConfig(public_origin="http://localhost:3000"), telemetry=forwarder)
    async with application.router.lifespan_context(application) as state:
        assert forwarder._client is not None and not forwarder._client.is_closed
        if custom_lifespan:
            assert state == {"existing_lifespan_state": "preserved"}
            assert events == ["startup"]
    assert forwarder._client.is_closed
    assert events == (["startup", "shutdown"] if custom_lifespan else [])


async def test_failed_application_startup_still_closes_installed_telemetry_client() -> None:
    @asynccontextmanager
    async def failing_lifespan(application: FastAPI):
        raise RuntimeError("bootstrap failed")
        yield  # pragma: no cover - establishes the async context-manager protocol

    application = FastAPI(lifespan=failing_lifespan)
    destinations = TelemetryDestinations(
        traces="http://collector:4318/v1/traces",
        metrics="http://collector:4318/v1/metrics",
        logs="http://collector:4318/v1/logs",
    )
    forwarder = TelemetryForwarder(
        TelemetryConfig(enabled=True, destinations=destinations),
        transport=httpx.MockTransport(lambda _: pytest.fail("Failed bootstrap must not send telemetry")),
    )
    install_local_http(application, LocalHTTPConfig(public_origin="http://localhost:3000"), telemetry=forwarder)
    with pytest.raises(RuntimeError, match="bootstrap failed"):
        async with application.router.lifespan_context(application):
            pytest.fail("Failed application startup entered the running lifespan")
    assert forwarder._client is not None and forwarder._client.is_closed


def test_installing_boundary_twice_refuses_without_replacing_the_first_lifecycle() -> None:
    application = FastAPI()
    config = LocalHTTPConfig(public_origin="http://localhost:3000")
    lifecycle = LocalHTTPLifecycle()
    assert install_local_http(application, config, lifecycle=lifecycle) is lifecycle
    original_resolver = application.state.request_principal_resolver
    original_routes = list(application.router.routes)
    original_middleware = list(application.user_middleware)
    with pytest.raises(RuntimeError, match="already installed"):
        install_local_http(application, config, lifecycle=LocalHTTPLifecycle())
    assert application.state.local_http_lifecycle is lifecycle
    assert application.state.request_principal_resolver is original_resolver
    assert application.router.routes == original_routes
    assert application.user_middleware == original_middleware


async def test_installing_replacement_preserves_full_offline_product_openapi_without_startup(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from animama.server.app import create_local_app
    from animama.server.config import Settings

    monkeypatch.setenv("OTEL_SDK_DISABLED", "true")
    application = create_local_app(
        runtime_settings=Settings(animama_content_root=tmp_path / "content", animama_data_root=tmp_path / "data")
    )
    before = deepcopy(application.openapi())
    assert "/health" in before["paths"]
    assert "/v1/chats" in before["paths"]
    assert "/v1/animas/{anima_id}/chat:sse" in before["paths"]
    forwarder = TelemetryForwarder(TelemetryConfig())
    lifecycle = install_local_http(
        application,
        LocalHTTPConfig(
            public_origin="http://localhost:3000",
            desktop=DesktopAccess(renderer_capability="a" * 32, control_token="b" * 32),
        ),
        telemetry=forwarder,
        assets=LocalAssets(tmp_path / "web"),
    )
    # Discard FastAPI's cache so equality checks the actual mounted route graph.
    application.openapi_schema = None
    after = application.openapi()
    assert after == before
    assert after["paths"]["/health"] == before["paths"]["/health"]
    assert "/api/telemetry/{signal}" not in after["paths"]
    assert "/_desktop/runtime:quiesce" not in after["paths"]
    assert "/{asset_path}" not in after["paths"]
    assert not lifecycle.ready
    assert not (tmp_path / "content").exists()
    assert not (tmp_path / "data").exists()
    assert {"/docs", "/redoc", "/openapi.json", "/docs/oauth2-redirect"}.isdisjoint(
        {getattr(route, "path", None) for route in application.router.routes}
    )
    await forwarder.aclose()
