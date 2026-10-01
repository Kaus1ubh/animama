"""Replacement browser policy preserves installation ownership without Hono."""

from __future__ import annotations

import hashlib
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Annotated

import httpx
import pytest
from fastapi import Depends, FastAPI, File, Request, UploadFile

from animama.domain.request_principal import RequestPrincipal
from animama.local.http.assets import PARAKEET_MOUNT, LocalAssets, ModelFile, ModelMount, StaticModelMounts
from animama.local.http.composition import install_local_http
from animama.local.http.config import CAPABILITY_COOKIE, DesktopAccess, LocalHTTPConfig
from animama.local.http.telemetry import TelemetryConfig, TelemetryForwarder
from animama.server.deps import get_current_principal

ORIGIN = "http://localhost:8200"
DESKTOP = DesktopAccess(renderer_capability="r" * 64, control_token="c" * 64)
BROWSER = {"origin": ORIGIN, "sec-fetch-site": "same-origin", "x-animama-csrf": "1"}
COOKIE = {"cookie": f"{CAPABILITY_COOKIE}={DESKTOP.renderer_capability}"}


def make_app(
    *,
    desktop: bool = False,
    ready: bool = True,
    max_body_bytes: int = 128 * 1024 * 1024,
    allow_same_site_fetches: bool = False,
) -> FastAPI:
    app = FastAPI()

    @app.get("/v1/owner")
    async def owner(principal: Annotated[RequestPrincipal, Depends(get_current_principal)]) -> dict[str, str]:
        return {"id": principal.id}

    @app.post("/v1/body")
    async def body(
        request: Request, principal: Annotated[RequestPrincipal, Depends(get_current_principal)]
    ) -> dict[str, object]:
        return {"id": principal.id, "body": (await request.body()).decode()}

    @app.post("/v1/file")
    async def upload(file: Annotated[UploadFile, File()]) -> dict[str, int]:
        return {"size": len(await file.read())}

    config = LocalHTTPConfig(
        ORIGIN,
        desktop=DESKTOP if desktop else None,
        max_body_bytes=max_body_bytes,
        allow_same_site_fetches=allow_same_site_fetches,
    )
    lifecycle = install_local_http(app, config)
    if ready:
        lifecycle.mark_ready("installation-owner")
    return app


@pytest.mark.parametrize(
    ("extra", "expected"),
    [
        ({}, 200),
        ({"host": "evil.test"}, 421),
        ({"host": "localhost:8400"}, 421),
        ({"origin": "http://evil.test"}, 403),
        ({"origin": "null"}, 403),
        ({"origin": ORIGIN + "/"}, 403),
        ({"sec-fetch-site": "cross-site"}, 403),
        ({"sec-fetch-site": "same-site"}, 403),
        ({"sec-fetch-site": "invalid"}, 403),
        ({"sec-fetch-site": "none"}, 200),
        ({"origin": ORIGIN, "sec-fetch-site": "same-origin"}, 200),
        ({"x-forwarded-host": "evil.test", "x-forwarded-proto": "https"}, 200),
    ],
)
async def test_host_origin_fetch_boundary(extra: dict[str, str], expected: int) -> None:
    async with httpx.AsyncClient(transport=httpx.ASGITransport(make_app()), base_url=ORIGIN) as client:
        response = await client.get("/v1/owner", headers=extra)
    assert response.status_code == expected
    if expected == 200:
        assert response.json() == {"id": "installation-owner"}
    else:
        assert response.json() == {"error": "gateway_request_rejected"}


@pytest.mark.parametrize(
    ("headers", "expected"),
    [
        ({}, 403),
        ({"x-animama-csrf": "1"}, 403),
        ({"x-animama-csrf": "1", "sec-fetch-site": "none"}, 200),
        ({"origin": ORIGIN, "x-animama-csrf": "1"}, 403),
        ({"origin": ORIGIN, "sec-fetch-site": "same-origin"}, 403),
        (BROWSER, 200),
        ({**BROWSER, "x-animama-csrf": "true"}, 403),
        ({**BROWSER, "sec-fetch-site": "cross-site"}, 403),
    ],
)
async def test_mutations_need_explicit_metadata(headers: dict[str, str], expected: int) -> None:
    async with httpx.AsyncClient(transport=httpx.ASGITransport(make_app()), base_url=ORIGIN) as client:
        response = await client.post("/v1/body", headers=headers, content="reviewed")
    assert response.status_code == expected


@pytest.mark.parametrize(
    ("headers", "expected"),
    [
        (BROWSER, 401),
        ({**BROWSER, "cookie": f"{CAPABILITY_COOKIE}=old"}, 401),
        ({**BROWSER, **COOKIE}, 200),
        (COOKIE, 403),
        ({**COOKIE, "sec-fetch-site": "none"}, 200),
        ({**COOKIE, "sec-fetch-site": "same-origin"}, 200),
        ({**BROWSER, "cookie": f"{CAPABILITY_COOKIE}={DESKTOP.control_token}"}, 401),
        ({**BROWSER, "cookie": COOKIE["cookie"] + "; " + COOKIE["cookie"]}, 401),
    ],
)
async def test_desktop_cookie_is_per_launch_not_a_control_credential(headers: dict[str, str], expected: int) -> None:
    async with httpx.AsyncClient(transport=httpx.ASGITransport(make_app(desktop=True)), base_url=ORIGIN) as client:
        response = await client.get("/v1/owner", headers=headers)
    assert response.status_code == expected


async def test_desktop_originless_mutation_is_rejected_even_with_cookie() -> None:
    async with httpx.AsyncClient(transport=httpx.ASGITransport(make_app(desktop=True)), base_url=ORIGIN) as client:
        response = await client.post("/v1/body", headers={**COOKIE, "sec-fetch-site": "none", "x-animama-csrf": "1"})
    assert response.status_code == 403


async def test_headers_never_select_owner_or_bypass_readiness() -> None:
    forged = {
        **BROWSER,
        "x-animama-principal-id": "attacker",
        "x-animama-internal-token": "fake",
        "x-user-id": "attacker",
    }
    app = make_app(ready=False)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app), base_url=ORIGIN) as client:
        assert (await client.get("/v1/owner", headers=forged)).status_code == 503
        app.state.local_http_lifecycle.mark_ready("actual-owner")
        assert (await client.get("/v1/owner", headers=forged)).json() == {"id": "actual-owner"}


@pytest.mark.parametrize("header", ["host", "origin", "sec-fetch-site", "x-animama-csrf", "content-length"])
async def test_duplicate_authority_headers_are_rejected(header: str) -> None:
    headers = [("host", "localhost:8200"), (header, "untrusted"), (header, "untrusted")]
    async with httpx.AsyncClient(transport=httpx.ASGITransport(make_app()), base_url=ORIGIN) as client:
        assert (await client.get("/v1/owner", headers=headers)).status_code == 400


@pytest.mark.parametrize("path", ["/docs", "/docs/oauth2-redirect", "/redoc", "/openapi.json", "/api/auth/me"])
async def test_http_docs_and_retired_auth_are_unavailable(path: str) -> None:
    async with httpx.AsyncClient(transport=httpx.ASGITransport(make_app()), base_url=ORIGIN) as client:
        assert (await client.get(path)).status_code == 404


@pytest.mark.parametrize("desktop", [False, True])
async def test_renderer_cannot_quiesce_or_authorize_private_controls(desktop: bool) -> None:
    app = make_app(desktop=desktop)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app), base_url=ORIGIN) as client:
        for credentials in (COOKIE, {"x-animama-desktop-control": DESKTOP.renderer_capability}):
            response = await client.post("/_desktop/runtime:quiesce", headers={**BROWSER, **credentials})
            assert response.status_code == 404
            assert not app.state.local_http_lifecycle.quiescing
        if not desktop:
            response = await client.post(
                "/_desktop/runtime:quiesce", headers={"x-animama-desktop-control": DESKTOP.control_token}
            )
            assert response.status_code == 404


async def test_private_quiesce_works_before_readiness_and_is_idempotent() -> None:
    app = make_app(desktop=True, ready=False)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app), base_url=ORIGIN) as client:
        for _ in range(2):
            response = await client.post(
                "/_desktop/runtime:quiesce", headers={"x-animama-desktop-control": DESKTOP.control_token}
            )
            assert response.status_code == 200
            assert response.json() == {"schema_version": 1, "state": "quiesced"}
        response = await client.get("/v1/owner", headers={**BROWSER, **COOKIE})
        assert response.status_code == 503
        assert response.json() == {"error": "runtime_quiescing"}
    assert app.state.local_http_lifecycle.active_requests == 0


async def test_streamed_body_limit_precedes_multipart_parsing() -> None:
    app = make_app(max_body_bytes=64)

    async def chunks() -> AsyncIterator[bytes]:
        yield b"--boundary\r\n"
        yield b'Content-Disposition: form-data; name="file"; filename="x"\r\n\r\n'
        yield b"a" * 65
        yield b"\r\n--boundary--\r\n"

    async with httpx.AsyncClient(transport=httpx.ASGITransport(app), base_url=ORIGIN) as client:
        response = await client.post(
            "/v1/file", headers={**BROWSER, "content-type": "multipart/form-data; boundary=boundary"}, content=chunks()
        )
        assert response.status_code == 413
        assert response.json() == {"detail": {"code": "request_body_too_large"}}
        assert app.state.local_http_lifecycle.active_requests == 0
        assert (await client.get("/v1/owner")).status_code == 200


async def test_declared_oversize_never_dispatches_and_closes_connection() -> None:
    async with httpx.AsyncClient(transport=httpx.ASGITransport(make_app(max_body_bytes=2)), base_url=ORIGIN) as client:
        response = await client.post("/v1/body", headers=BROWSER, content="large")
    assert response.status_code == 413
    assert response.headers["connection"] == "close"


async def test_same_site_exception_requires_explicit_composition_and_exact_origin() -> None:
    app = make_app(allow_same_site_fetches=True)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app), base_url=ORIGIN) as client:
        assert (await client.post("/v1/body", headers={**BROWSER, "sec-fetch-site": "same-site"})).status_code == 200
        assert (
            await client.post(
                "/v1/body", headers={**BROWSER, "sec-fetch-site": "same-site", "origin": "http://localhost:9999"}
            )
        ).status_code == 403


async def test_asset_conditionals_and_disabled_telemetry_still_require_admission(tmp_path: Path) -> None:
    app = FastAPI()
    web = tmp_path / "web"
    web.mkdir()
    (web / "index.html").write_text("<html>application</html>")
    model = tmp_path / "models"
    model.mkdir()
    model_bytes = b"verified-model-bytes"
    (model / "model.onnx").write_bytes(model_bytes)
    digest = hashlib.sha256(model_bytes).hexdigest()
    mount = ModelMount(model, "1.0.0", (ModelFile("model.onnx", len(model_bytes), digest, "application/octet-stream"),))
    assets = LocalAssets(web, mount_source=StaticModelMounts({PARAKEET_MOUNT: mount}))
    telemetry = TelemetryForwarder(TelemetryConfig())
    lifecycle = install_local_http(app, LocalHTTPConfig(ORIGIN, desktop=DESKTOP), assets=assets, telemetry=telemetry)
    lifecycle.mark_ready("installation-owner")
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app), base_url=ORIGIN) as client:
        for path in ("/", PARAKEET_MOUNT + "model.onnx?v=1.0.0"):
            authorized = {**BROWSER, **COOKIE, "accept": "text/html"}
            response = await client.get(path, headers=authorized)
            assert response.status_code == 200
            conditional = {**authorized, "if-none-match": response.headers["etag"]}
            assert (await client.get(path, headers=conditional)).status_code == 304
            del conditional["cookie"]
            denied = await client.get(path, headers=conditional)
            assert denied.status_code == 401
            assert denied.headers["cache-control"] == "no-store"
        assert (await client.post("/api/telemetry/traces", headers=BROWSER)).status_code == 401
        assert (await client.post("/api/telemetry/traces", headers={**BROWSER, **COOKIE})).status_code == 204
        assert (
            await client.get("/v1/missing", headers={**BROWSER, **COOKIE, "accept": "text/html"})
        ).status_code == 404
    await telemetry.aclose()
