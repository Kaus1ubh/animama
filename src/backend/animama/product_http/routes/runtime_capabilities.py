"""Runtime capability discovery, shared by every composition (ADR 0021).

Each composition reports what it offers through its ports, as the shared
``RuntimeCapabilities`` contract from :mod:`animama.app.contracts.runtime_capabilities`.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends

from animama.app.contracts.runtime_capabilities import RuntimeCapabilities
from animama.domain.request_principal import RequestPrincipal
from animama.product_http.ports import Ports, ReadSession
from animama.product_http.principal import get_current_principal

router = APIRouter()


@router.get("/v1/runtime-capabilities", response_model=RuntimeCapabilities)
async def get_runtime_capabilities(
    principal: Annotated[RequestPrincipal, Depends(get_current_principal)],
    ports: Ports,
    session: ReadSession,
) -> RuntimeCapabilities:
    """A stale worker may still accept durable jobs; an absent pack may not."""

    # The description above is the public operation's; the composition decides the values.
    return await ports.runtime_capabilities(session, principal)
