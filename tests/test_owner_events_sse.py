from __future__ import annotations

import pytest

from animama.server import mm_events
from animama.server.routers import router


def test_owner_events_sse_route_is_mounted() -> None:
    paths = {getattr(route, "path", None) for route in router.routes}
    assert "/v1/events:sse" in paths


@pytest.mark.asyncio
async def test_owner_events_sse_yields_heartbeat_only() -> None:
    stream = mm_events.iter_owner_events("owner-1", heartbeat_interval=0.01)
    try:
        frame = await anext(stream)
    finally:
        await stream.aclose()

    assert frame == ": heartbeat\n\n"
