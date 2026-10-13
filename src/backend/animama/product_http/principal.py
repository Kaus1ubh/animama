"""The request principal every shared product route depends on (ADR 0021).

Each composition installs its own resolver as ``app.state.request_principal_resolver``;
shared routes never choose a trust mechanism. Without a resolver, HTTP routes fail
closed with 503 ``request_principal_unavailable`` and WebSockets close with a policy
violation.
"""

from __future__ import annotations

from typing import Protocol, cast

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
    # Starlette state is dynamic; the composition installs this resolver protocol.
    return cast(RequestPrincipalResolver, resolver)


async def get_current_principal(request: Request) -> RequestPrincipal:
    """Delegate ownership resolution to the current application composition."""

    return await principal_resolver(request).resolve_http(request)


async def resolve_websocket_principal(websocket: WebSocket) -> RequestPrincipal:
    """Resolve a WebSocket owner before the route accepts the connection."""

    return await principal_resolver(websocket).resolve_websocket(websocket)
