"""Test compositions for shared product routes (ADR 0021).

``product_app`` mounts routers with explicit ports and a test-only resolver.
``DeferredCommitPorts`` mimics a consumer's commit authority, and
``TwoOwnerComposition`` serves two owners from one database with separate roots.
Nothing here is installed outside tests.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from fastapi import APIRouter, FastAPI, HTTPException, Request, WebSocket
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from animama.domain.request_principal import RequestPrincipal
from animama.product_http.ports import ProductPorts, install_product_ports

OWNER_HEADER = "X-Test-Owner"


class HeaderOwnerResolver:
    """Test-only: the request names its owner. Never install this outside tests."""

    def _owner(self, owner: str | None) -> RequestPrincipal:
        if not owner:
            raise HTTPException(status_code=401, detail={"code": "test_owner_missing"})
        return RequestPrincipal(id=owner)

    async def resolve_http(self, request: Request) -> RequestPrincipal:
        return self._owner(request.headers.get(OWNER_HEADER))

    async def resolve_websocket(self, websocket: WebSocket) -> RequestPrincipal:
        return self._owner(websocket.headers.get(OWNER_HEADER))


@dataclass
class DeferredCommitPorts:
    """Ports whose write sessions defer handler commits to the session's end.

    A handler's ``session.commit()`` only flushes. When the session ends after the
    handler returned, the composition commits if the handler asked to and rolls back
    otherwise; it also rolls back if the handler raised. This is the commit authority
    a hosted consumer keeps (for example to settle metering first). Limits: changes
    made after the last requested commit are committed with it, and
    ``session.begin()`` after a deferred commit fails because a transaction is open.
    Each opened session records the owner it was opened for in ``owners``.
    """

    session_factory: async_sessionmaker[AsyncSession]
    commits_requested: int = 0
    commits: int = 0
    rollbacks: int = 0
    owners: list[str] = field(default_factory=list)

    @asynccontextmanager
    async def read_session(self, principal: RequestPrincipal) -> AsyncIterator[AsyncSession]:
        self.owners.append(principal.id)
        async with self.session_factory() as session:
            yield session

    @asynccontextmanager
    async def write_session(self, principal: RequestPrincipal) -> AsyncIterator[AsyncSession]:
        self.owners.append(principal.id)
        async with self.session_factory() as session:
            commit = session.commit
            requested = False

            async def deferred_commit() -> None:
                nonlocal requested
                requested = True
                self.commits_requested += 1
                await session.flush()

            session.commit = deferred_commit  # type: ignore[method-assign]
            try:
                yield session
            except BaseException:
                await session.rollback()
                self.rollbacks += 1
                raise
            if requested:
                await commit()
                self.commits += 1
            else:
                await session.rollback()
                self.rollbacks += 1


def product_app(*routers: APIRouter, ports: ProductPorts | None, resolver: Any = None) -> FastAPI:
    """A bare app mounting shared routers with explicit ports and resolver."""

    app = FastAPI()
    app.state.request_principal_resolver = resolver or HeaderOwnerResolver()
    if ports is not None:
        install_product_ports(app, ports)
    for router in routers:
        app.include_router(router)
    return app


@dataclass
class TwoOwnerComposition:
    """Two owners served by one app and one database, each with its own root."""

    app: FastAPI
    root: Path
    owners: tuple[str, str] = ("owner-a", "owner-b")
    roots: dict[str, Path] = field(init=False)

    def __post_init__(self) -> None:
        self.roots = {}
        for owner in self.owners:
            self.roots[owner] = self.root / owner
            self.roots[owner].mkdir(parents=True)

    def client(self, owner: str) -> AsyncClient:
        """A client whose requests resolve to ``owner``, on the test's event loop."""

        return AsyncClient(transport=ASGITransport(app=self.app), base_url="http://test", headers={OWNER_HEADER: owner})
