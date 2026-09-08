from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse

from animama.domain.request_principal import RequestPrincipal
from animama.server.deps import get_current_principal
from animama.server.mm_events import stream_owner_events_sse

router = APIRouter()


@router.get("/v1/events:sse", response_class=StreamingResponse)
async def get_owner_events_sse(
    principal: Annotated[RequestPrincipal, Depends(get_current_principal)],
) -> StreamingResponse:
    """Stream installation-owner notifications through the trusted gateway."""
    return stream_owner_events_sse(principal)
