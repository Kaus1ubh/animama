"""Local gateway token loading and installation-owner assertion verification."""

from __future__ import annotations

import re
import secrets
import stat
from pathlib import Path

from fastapi import HTTPException, Request, WebSocket, WebSocketException, status

from animama.domain.request_principal import RequestPrincipal


class FailClosedLocalPrincipalResolver:
    """Resolver used while the local composition has not reached readiness."""

    async def resolve_http(self, request: Request) -> RequestPrincipal:
        _ = request
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={"code": "local_gateway_unavailable"},
        )

    async def resolve_websocket(self, websocket: WebSocket) -> RequestPrincipal:
        _ = websocket
        raise WebSocketException(code=status.WS_1008_POLICY_VIOLATION, reason="local_gateway_unavailable")


_INTERNAL_TOKEN_RE = re.compile(r"^[a-f0-9]{64}$", re.IGNORECASE)
_PRINCIPAL_HEADER = "X-Animama-Principal-Id"
_TOKEN_HEADER = "X-Animama-Internal-Token"


class LocalGatewayConfigurationError(RuntimeError):
    """Raised when the private local gateway assertion cannot be configured."""


def _validated_internal_token(value: str) -> str:
    normalized = value.strip().lower()
    if not _INTERNAL_TOKEN_RE.fullmatch(normalized):
        raise LocalGatewayConfigurationError("internal gateway token must encode exactly 32 bytes")
    return normalized


def load_internal_gateway_token(*, value: str | None = None, path: Path | None = None) -> str:
    """Load one injected or mode-0600 token without exposing it in errors."""

    if (value is None) == (path is None):
        raise LocalGatewayConfigurationError("configure exactly one internal gateway token source")
    if value is not None:
        return _validated_internal_token(value)

    assert path is not None
    try:
        metadata = path.lstat()
        if stat.S_ISLNK(metadata.st_mode) or not stat.S_ISREG(metadata.st_mode):
            raise LocalGatewayConfigurationError("internal gateway token source must be a regular file")
        if stat.S_IMODE(metadata.st_mode) != 0o600:
            raise LocalGatewayConfigurationError("internal gateway token file must have mode 0600")
        return _validated_internal_token(path.read_text(encoding="utf-8"))
    except LocalGatewayConfigurationError:
        raise
    except OSError as exc:
        raise LocalGatewayConfigurationError("internal gateway token file is unavailable") from exc


class LocalGatewayPrincipalResolver:
    """Authenticate Hono assertions against immutable process-local state."""

    def __init__(self, *, principal_id: str, internal_token: str) -> None:
        normalized_principal = principal_id.strip()
        if not normalized_principal:
            raise LocalGatewayConfigurationError("installation principal is required")
        self._principal_id = normalized_principal
        self._internal_token = _validated_internal_token(internal_token)

    def _resolve(self, *, asserted_principal: str | None, received_token: str | None) -> RequestPrincipal:
        supplied_token = (received_token or "").strip().lower()
        if not secrets.compare_digest(supplied_token, self._internal_token):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail={"code": "local_gateway_auth_failed"},
            )
        if (asserted_principal or "").strip() != self._principal_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail={"code": "local_gateway_principal_mismatch"},
            )
        return RequestPrincipal(id=self._principal_id)

    async def resolve_http(self, request: Request) -> RequestPrincipal:
        return self._resolve(
            asserted_principal=request.headers.get(_PRINCIPAL_HEADER),
            received_token=request.headers.get(_TOKEN_HEADER),
        )

    async def resolve_websocket(self, websocket: WebSocket) -> RequestPrincipal:
        try:
            return self._resolve(
                asserted_principal=websocket.headers.get(_PRINCIPAL_HEADER),
                received_token=websocket.headers.get(_TOKEN_HEADER),
            )
        except HTTPException as exc:
            raise WebSocketException(
                code=status.WS_1008_POLICY_VIOLATION,
                reason="local_gateway_auth_failed",
            ) from exc
