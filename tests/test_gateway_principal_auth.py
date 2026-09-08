from __future__ import annotations

import os
from pathlib import Path
from typing import Annotated

import pytest
from fastapi import Depends, FastAPI, WebSocket
from fastapi.testclient import TestClient
from httpx import ASGITransport, AsyncClient
from starlette.websockets import WebSocketDisconnect

from animama.domain.request_principal import RequestPrincipal
from animama.local.gateway_principal import (
    LocalGatewayConfigurationError,
    LocalGatewayPrincipalResolver,
    load_internal_gateway_token,
)
from animama.server.deps import get_current_principal, resolve_websocket_principal

PRINCIPAL_ID = "11111111-1111-4111-8111-111111111111"
INTERNAL_TOKEN = "c" * 64


def _app() -> FastAPI:
    application = FastAPI()
    application.state.request_principal_resolver = LocalGatewayPrincipalResolver(
        principal_id=PRINCIPAL_ID,
        internal_token=INTERNAL_TOKEN,
    )

    @application.get("/product")
    async def product(
        principal: Annotated[RequestPrincipal, Depends(get_current_principal)],
    ) -> dict[str, str]:
        return {"principal_id": principal.id}

    @application.websocket("/socket")
    async def socket(websocket: WebSocket) -> None:
        principal = await resolve_websocket_principal(websocket)
        await websocket.accept()
        await websocket.send_json({"principal_id": principal.id})
        await websocket.close()

    return application


async def test_http_gateway_assertion_resolves_only_the_loaded_principal() -> None:
    async with AsyncClient(transport=ASGITransport(app=_app()), base_url="http://test") as client:
        response = await client.get(
            "/product",
            headers={
                "X-Animama-Principal-Id": PRINCIPAL_ID,
                "X-Animama-Internal-Token": INTERNAL_TOKEN,
            },
        )

    assert response.status_code == 200
    assert response.json() == {"principal_id": PRINCIPAL_ID}


@pytest.mark.parametrize("token", [None, "d" * 64])
async def test_missing_and_wrong_tokens_share_one_generic_failure(token: str | None) -> None:
    headers = {"X-Animama-Principal-Id": PRINCIPAL_ID}
    if token is not None:
        headers["X-Animama-Internal-Token"] = token

    async with AsyncClient(transport=ASGITransport(app=_app()), base_url="http://test") as client:
        response = await client.get("/product", headers=headers)

    assert response.status_code == 401
    assert response.json() == {"detail": {"code": "local_gateway_auth_failed"}}
    assert INTERNAL_TOKEN not in response.text
    assert PRINCIPAL_ID not in response.text


async def test_valid_token_with_mismatched_principal_is_forbidden() -> None:
    async with AsyncClient(transport=ASGITransport(app=_app()), base_url="http://test") as client:
        response = await client.get(
            "/product",
            headers={
                "X-Animama-Principal-Id": "22222222-2222-4222-8222-222222222222",
                "X-Animama-Internal-Token": INTERNAL_TOKEN,
            },
        )

    assert response.status_code == 403
    assert response.json() == {"detail": {"code": "local_gateway_principal_mismatch"}}


def test_websocket_gateway_assertion_is_checked_before_accept() -> None:
    with TestClient(_app()) as client:
        with client.websocket_connect(
            "/socket",
            headers={
                "X-Animama-Principal-Id": PRINCIPAL_ID,
                "X-Animama-Internal-Token": INTERNAL_TOKEN,
            },
        ) as websocket:
            assert websocket.receive_json() == {"principal_id": PRINCIPAL_ID}

        with pytest.raises(WebSocketDisconnect) as exc_info:
            with client.websocket_connect("/socket"):
                pass
        assert exc_info.value.code == 1008


def test_internal_token_file_requires_exact_mode_and_32_bytes(tmp_path: Path) -> None:
    token_file = tmp_path / "gateway-token"
    token_file.write_text(f"{INTERNAL_TOKEN}\n", encoding="utf-8")
    token_file.chmod(0o600)
    assert load_internal_gateway_token(path=token_file) == INTERNAL_TOKEN

    token_file.chmod(0o644)
    with pytest.raises(LocalGatewayConfigurationError, match="0600"):
        load_internal_gateway_token(path=token_file)

    token_file.chmod(0o600)
    token_file.write_text("short", encoding="utf-8")
    with pytest.raises(LocalGatewayConfigurationError, match="32 bytes"):
        load_internal_gateway_token(path=token_file)

    symlink = tmp_path / "gateway-token-link"
    try:
        symlink.symlink_to(token_file)
    except OSError:
        pytest.skip("symlinks are unavailable on this platform")
    with pytest.raises(LocalGatewayConfigurationError, match="regular file"):
        load_internal_gateway_token(path=symlink)

    # Keep permission changes explicit on Windows, where chmod may be advisory.
    if os.name == "nt":
        pytest.skip("POSIX file modes are unavailable on Windows")
