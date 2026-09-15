"""Explicit local HTTP wiring shared by the real factory and isolated tests."""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import TYPE_CHECKING, Any

from fastapi import FastAPI, Request
from starlette.responses import JSONResponse, Response

from animama.local.http.admission import LocalHTTPAdmission
from animama.local.http.config import LocalHTTPConfig
from animama.local.http.lifecycle import AdmittedLocalPrincipalResolver, LocalHTTPLifecycle

if TYPE_CHECKING:
    from animama.local.http.assets import LocalAssets
    from animama.local.http.telemetry import TelemetryForwarder


def install_local_http(
    application: FastAPI,
    config: LocalHTTPConfig,
    *,
    lifecycle: LocalHTTPLifecycle | None = None,
    assets: LocalAssets | None = None,
    telemetry: TelemetryForwarder | None = None,
) -> LocalHTTPLifecycle:
    """Install once before startup, after product routers and before bootstrap.

    The caller owns product composition and calls mark_ready only after its
    installation bootstrap has completed. No environment switch or fallback
    identity is introduced by this installer.
    """
    if getattr(application.state, "local_http_lifecycle", None) is not None:
        raise RuntimeError("Local HTTP components are already installed")
    lifecycle = lifecycle if lifecycle is not None else LocalHTTPLifecycle()
    application.state.local_http_lifecycle = lifecycle
    application.state.request_principal_resolver = AdmittedLocalPrincipalResolver(lifecycle)
    # Disable HTTP documentation while keeping offline application.openapi().
    docs_paths = {
        path
        for path in (
            application.docs_url,
            application.redoc_url,
            application.openapi_url,
            application.swagger_ui_oauth2_redirect_url,
        )
        if path is not None
    }
    application.router.routes[:] = [
        route for route in application.router.routes if getattr(route, "path", None) not in docs_paths
    ]
    application.docs_url = application.redoc_url = application.openapi_url = None
    application.swagger_ui_oauth2_redirect_url = None

    if config.desktop is not None:

        async def quiesce() -> Response:
            """Private admission already checked the separate control credential."""
            if not await lifecycle.quiesce():
                return JSONResponse(
                    {"detail": {"code": "runtime_busy"}}, status_code=409, headers={"cache-control": "no-store"}
                )
            return JSONResponse({"schema_version": 1, "state": "quiesced"}, headers={"cache-control": "no-store"})

        application.add_api_route("/_desktop/runtime:quiesce", quiesce, methods=["POST"], include_in_schema=False)

    if telemetry is not None:

        async def forward_telemetry(request: Request, signal: str) -> Response:
            return await telemetry.response(request, signal)

        application.add_api_route(
            "/api/telemetry/{signal}", forward_telemetry, methods=["POST"], include_in_schema=False
        )
        original_lifespan = application.router.lifespan_context

        @asynccontextmanager
        async def lifespan_with_telemetry(app: FastAPI) -> AsyncIterator[Any]:
            """Close the collector client even with custom lifespan or failed startup."""
            try:
                async with original_lifespan(app) as state:
                    yield state
            finally:
                await telemetry.aclose()

        application.router.lifespan_context = lifespan_with_telemetry

    if assets is not None:

        async def serve_asset(request: Request) -> Response:
            return await assets.response(request)

        application.add_api_route("/{asset_path:path}", serve_asset, methods=["GET", "HEAD"], include_in_schema=False)

    application.add_middleware(LocalHTTPAdmission, config=config, lifecycle=lifecycle)
    return lifecycle
