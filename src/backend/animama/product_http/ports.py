"""Ports each composition installs for the shared product routes (ADR 0021).

A composition installs one ``ProductPorts`` object with ``install_product_ports``
when it builds its app. Shared handlers obtain every collaborator through it and
never construct repositories or stores or read process-global settings. Without
ports, shared routes fail closed with 503 ``product_ports_unavailable``. Families add
the ports they need as they move into this package.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import AbstractAsyncContextManager
from typing import Annotated, Protocol, cast

from fastapi import Depends, FastAPI, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession

from animama.domain.request_principal import RequestPrincipal
from animama.product_http.principal import get_current_principal


class ProductPorts(Protocol):
    """The composition-owned collaborators of shared product handlers."""

    def read_session(self, principal: RequestPrincipal) -> AbstractAsyncContextManager[AsyncSession]:
        """Open a session for a handler that only reads ``principal``'s data."""
        ...

    def write_session(self, principal: RequestPrincipal) -> AbstractAsyncContextManager[AsyncSession]:
        """Open a session for a handler that changes ``principal``'s data.

        Handlers commit through the session as usual, but commit authority stays
        with the composition: it may defer a requested commit (for example to
        settle metering or recheck a lease) and must complete or roll it back when
        the context exits. That exit runs after the handler returns and before the
        response is sent.
        """
        ...


def install_product_ports(app: FastAPI, ports: ProductPorts) -> None:
    """Install a composition's ports; the annotation lets type checks confirm conformance."""
    app.state.product_ports = ports


def get_product_ports(request: Request) -> ProductPorts:
    """Require the ports installed by the application factory."""
    ports = getattr(request.app.state, "product_ports", None)
    if ports is None:
        raise HTTPException(status_code=503, detail={"code": "product_ports_unavailable"})
    # Starlette state is dynamic; install_product_ports stores this protocol.
    return cast(ProductPorts, ports)


# A session opens only after the principal resolves, so unadmitted requests never
# reach the database, and the composition always knows whose session it opens.
async def get_read_session(
    ports: Annotated[ProductPorts, Depends(get_product_ports)],
    principal: Annotated[RequestPrincipal, Depends(get_current_principal)],
) -> AsyncIterator[AsyncSession]:
    async with ports.read_session(principal) as session:
        yield session


async def get_write_session(
    ports: Annotated[ProductPorts, Depends(get_product_ports)],
    principal: Annotated[RequestPrincipal, Depends(get_current_principal)],
) -> AsyncIterator[AsyncSession]:
    async with ports.write_session(principal) as session:
        yield session


ReadSession = Annotated[AsyncSession, Depends(get_read_session)]
# Function scope ends the session, and any deferred commit, before the response
# is sent, so a failed commit is reported instead of an earlier success. The
# session is therefore closed before a streaming body runs.
WriteSession = Annotated[AsyncSession, Depends(get_write_session, scope="function")]
