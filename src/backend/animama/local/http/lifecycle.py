"""Readiness and drain accounting owned by one local ASGI event loop."""

from __future__ import annotations

import asyncio
import math

from fastapi import HTTPException, Request, WebSocket, WebSocketException
from starlette.types import Scope

from animama.domain.request_principal import RequestPrincipal

_ADMISSION_STATE = "animama_local_http_admission"


class LocalHTTPLifecycle:
    """Close admission before waiting, and retain active work until its cleanup ends.

    Synchronous enter/leave operations run on the ASGI loop, so quiesce cannot
    race between checking admission and recording an active request. A restart
    creates a new lifecycle; there is deliberately no in-process resume method.
    """

    def __init__(self) -> None:
        self._principal: RequestPrincipal | None = None
        self._admission = object()
        self._active = 0
        self._quiescing = False
        self._idle = asyncio.Event()
        self._idle.set()

    @property
    def active_requests(self) -> int:
        return self._active

    @property
    def quiescing(self) -> bool:
        return self._quiescing

    @property
    def ready(self) -> bool:
        return self._principal is not None

    def mark_ready(self, principal_id: str) -> None:
        """Called by completed bootstrap, never by an HTTP bootstrap assertion."""
        if not isinstance(principal_id, str) or not principal_id.strip():
            raise ValueError("Completed bootstrap must supply an installation principal")
        if self._quiescing or self._principal is not None:
            raise RuntimeError("Installation readiness may only be established once per runtime")
        self._principal = RequestPrincipal(id=principal_id)

    def admit(self, scope: Scope) -> str | None:
        """Return a safe failure code or mark and count one admitted product scope."""
        if _ADMISSION_STATE in scope.get("state", {}):
            raise RuntimeError("A scope may only receive one local HTTP admission")
        if self._quiescing:
            return "runtime_quiescing"
        if self._principal is None:
            return "local_runtime_unavailable"
        self._active += 1
        self._idle.clear()
        # The marker is an object identity, not a client-selectable owner ID.
        scope.setdefault("state", {})[_ADMISSION_STATE] = self._admission
        return None

    def release(self, scope: Scope) -> None:
        """Release only our own admission and only after the ASGI app finishes."""
        state = scope.get("state", {})
        if state.get(_ADMISSION_STATE) is not self._admission:
            raise RuntimeError("Cannot release a scope without local HTTP admission")
        del state[_ADMISSION_STATE]
        self._active -= 1
        if self._active == 0:
            self._idle.set()

    def admitted_principal(self, scope: Scope) -> RequestPrincipal | None:
        """A quiescing runtime lets previously admitted requests finish normally."""
        if scope.get("state", {}).get(_ADMISSION_STATE) is self._admission:
            return self._principal
        return None

    async def quiesce(self, timeout: float = 15.0) -> bool:
        """Idempotently stop admission; timeout does not reopen or cancel work."""
        if not math.isfinite(timeout) or not 0 < timeout <= 15:
            raise ValueError("Quiescence timeout must be positive and no longer than 15 seconds")
        self._quiescing = True
        try:
            await asyncio.wait_for(self._idle.wait(), timeout=timeout)
        except asyncio.TimeoutError:
            return False
        return True


class AdmittedLocalPrincipalResolver:
    """Implement the shared resolver using only server-owned admission state."""

    def __init__(self, lifecycle: LocalHTTPLifecycle) -> None:
        self._lifecycle = lifecycle

    async def resolve_http(self, request: Request) -> RequestPrincipal:
        principal = self._lifecycle.admitted_principal(request.scope)
        if principal is None:
            raise HTTPException(status_code=503, detail={"code": "local_runtime_unavailable"})
        return principal

    async def resolve_websocket(self, websocket: WebSocket) -> RequestPrincipal:
        principal = self._lifecycle.admitted_principal(websocket.scope)
        if principal is None:
            raise WebSocketException(code=1008, reason="local_runtime_unavailable")
        return principal
