from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator

from fastapi.responses import StreamingResponse

from animama.domain.request_principal import RequestPrincipal

OWNER_EVENT_HEARTBEAT_SECONDS = 15.0


def _heartbeat() -> str:
    return ": heartbeat\n\n"


async def iter_owner_events(
    user_id: str,
    *,
    heartbeat_interval: float = OWNER_EVENT_HEARTBEAT_SECONDS,
) -> AsyncIterator[str]:
    """Yield heartbeat-only owner SSE frames for a reserved notification stream."""
    _ = user_id
    while True:
        yield _heartbeat()
        await asyncio.sleep(heartbeat_interval)


def stream_owner_events_sse(principal: RequestPrincipal) -> StreamingResponse:
    """Create the gateway-authenticated installation-owner SSE stream."""
    headers = {
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
    }
    return StreamingResponse(
        iter_owner_events(principal.id),
        media_type="text/event-stream",
        headers=headers,
    )


__all__ = [
    "OWNER_EVENT_HEARTBEAT_SECONDS",
    "iter_owner_events",
    "stream_owner_events_sse",
]
