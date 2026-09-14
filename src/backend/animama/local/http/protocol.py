"""Local header-receipt guard for the reviewed Uvicorn h11 transport.

Uvicorn 0.38.0 exposes no header-receipt timeout. Its keepalive timer only
covers idle time between responses and is cleared by incoming bytes. This
small protocol hook adds the existing local 15-second header deadline without
copying the HTTP parser, imposing a response timeout on SSE, or adding a proxy.
Dependency upgrades must rerun the real-transport compatibility tests.
"""

from __future__ import annotations

import asyncio
from typing import Any

import h11
from uvicorn.config import Config
from uvicorn.protocols.http.h11_impl import H11Protocol
from uvicorn.server import ServerState

REVIEWED_UVICORN_VERSION = "0.38.0"


class LocalH11Protocol(H11Protocol):
    """Close incomplete HTTP headers after one absolute, non-sliding deadline.

    A new deadline starts when the connection can accept its next request.
    Complete headers cancel it, so request-body receipt and streamed responses
    retain their own lifetimes. Pipelined requests become eligible after the
    prior response completes; bytes already buffered by h11 are still parsed
    by Uvicorn. WebSocket transfers cancel this HTTP-only timer permanently.

    Select this class explicitly with ``Config(http=LocalH11Protocol)``. The
    serving composition separately supplies the five-second keepalive and
    fifteen-second graceful-shutdown settings. The class attribute permits
    short deadlines in isolated transport tests without a runtime mode flag.
    """

    headers_timeout_seconds = 15.0

    def __init__(
        self,
        config: Config,
        server_state: ServerState,
        app_state: dict[str, Any],
        _loop: asyncio.AbstractEventLoop | None = None,
    ) -> None:
        super().__init__(config, server_state, app_state, _loop)
        self._headers_timer: asyncio.TimerHandle | None = None
        self._websocket_transferred = False

    def connection_made(self, transport: asyncio.Transport) -> None:  # type: ignore[override]
        """Start the initial deadline even if the peer sends no bytes."""

        super().connection_made(transport)
        self._sync_headers_deadline()

    def handle_events(self) -> None:
        """Observe parser state after normal and pipelined request processing."""

        try:
            super().handle_events()
        finally:
            self._sync_headers_deadline()

    def handle_websocket_upgrade(self, event: h11.Request) -> None:
        """Do not let an abandoned HTTP timer close the new WebSocket owner."""

        self._websocket_transferred = True
        self._cancel_headers_deadline()
        super().handle_websocket_upgrade(event)

    def connection_lost(self, exc: Exception | None) -> None:
        """Release the timer on every close, including transport errors."""

        self._cancel_headers_deadline()
        super().connection_lost(exc)

    def shutdown(self) -> None:
        """Leave graceful task completion to Uvicorn after timer cleanup."""

        self._cancel_headers_deadline()
        super().shutdown()

    def _sync_headers_deadline(self) -> None:
        """Trickled header bytes must not reset an already running deadline."""

        if self._websocket_transferred or self.transport.is_closing() or self.conn.their_state is not h11.IDLE:
            self._cancel_headers_deadline()
        elif self._headers_timer is None:
            self._headers_timer = self.loop.call_later(self.headers_timeout_seconds, self._headers_expired)

    def _cancel_headers_deadline(self) -> None:
        if self._headers_timer is not None:
            self._headers_timer.cancel()
            self._headers_timer = None

    def _headers_expired(self) -> None:
        """Drop unauthenticated incomplete requests without creating ASGI work."""

        self._headers_timer = None
        if not self._websocket_transferred and not self.transport.is_closing() and self.conn.their_state is h11.IDLE:
            self.transport.close()
