"""Ports each composition installs for the shared product routes (ADR 0021).

A composition sets ``app.state.product_ports`` to one ``ProductPorts`` object when
it builds its app. Shared handlers obtain every collaborator through it and never
construct repositories or stores or read process-global settings. Without ports,
shared routes fail closed with 503 ``product_ports_unavailable``. Families add the
ports they need as they move into this package.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import AbstractAsyncContextManager
from typing import Annotated, Protocol, cast

from fastapi import Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession


class ProductPorts(Protocol):
    """The composition-owned collaborators of shared product handlers."""

    def read_session(self) -> AbstractAsyncContextManager[AsyncSession]:
        """Open a session for a handler that only reads owner data."""
        ...

    def write_session(self) -> AbstractAsyncContextManager[AsyncSession]:
        """Open a session for a handler that changes owner data.

        Handlers commit through the session as usual, but commit authority stays
        with the composition: it may defer a requested commit (for example to
        settle metering or recheck a lease) and must complete or roll it back when
        the context exits. That exit runs after the handler returns and before the
        response is sent.
        """
        ...


def get_product_ports(request: Request) -> ProductPorts:
    """Require the ports installed by the application factory."""
    ports = getattr(request.app.state, "product_ports", None)
    if ports is None:
        raise HTTPException(status_code=503, detail={"code": "product_ports_unavailable"})
    # Starlette state is dynamic; the composition installs this protocol.
    return cast(ProductPorts, ports)


async def get_read_session(ports: Annotated[ProductPorts, Depends(get_product_ports)]) -> AsyncIterator[AsyncSession]:
    async with ports.read_session() as session:
        yield session


async def get_write_session(ports: Annotated[ProductPorts, Depends(get_product_ports)]) -> AsyncIterator[AsyncSession]:
    async with ports.write_session() as session:
        yield session


Ports = Annotated[ProductPorts, Depends(get_product_ports)]
ReadSession = Annotated[AsyncSession, Depends(get_read_session)]
# Function scope ends the session, and any deferred commit, before the response
# is sent, so a failed commit is reported instead of an earlier success.
WriteSession = Annotated[AsyncSession, Depends(get_write_session, scope="function")]
