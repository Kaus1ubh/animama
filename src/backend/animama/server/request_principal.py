"""Neutral delivery-level principal resolver installed by a host composition."""

from __future__ import annotations

from typing import Protocol

from fastapi import HTTPException, Request, WebSocket, WebSocketException, status

from animama.domain.request_principal import RequestPrincipal


class RequestPrincipalResolver(Protocol):
    """Resolve an already authenticated owner without choosing a trust mechanism."""

    async def resolve_http(self, request: Request) -> RequestPrincipal:
        raise NotImplementedError

    async def resolve_websocket(self, websocket: WebSocket) -> RequestPrincipal:
        raise NotImplementedError


def principal_resolver(scope: Request | WebSocket) -> RequestPrincipalResolver:
    """Require the resolver explicitly installed by the application factory."""
    resolver = getattr(scope.app.state, "request_principal_resolver", None)
    if resolver is None:
        if isinstance(scope, WebSocket):
            raise WebSocketException(code=status.WS_1008_POLICY_VIOLATION, reason="request_principal_unavailable")
        raise HTTPException(status_code=503, detail={"code": "request_principal_unavailable"})
    return resolver
