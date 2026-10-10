"""The local composition's ports for the shared product routes (ADR 0021)."""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from sqlalchemy.ext.asyncio import AsyncSession

from animama.adapters.repositories.sqlalchemy.product_repositories import SQLAlchemyProductRepositories
from animama.domain.request_principal import RequestPrincipal
from animama.product_http.ports import ProductPolicy
from animama.server.deps import get_async_session_factory


class LocalProductPorts:
    """Serve shared routes from the local app's own database resources.

    Construction performs no IO: each session resolves the app's lazily created
    factory when it opens. The installation has one owner, so sessions do not vary
    by principal, and local handlers' commits take effect immediately.
    """

    def __init__(self, app: FastAPI) -> None:
        self._app = app

    @property
    def policy(self) -> ProductPolicy:
        # The app's own runtime settings, read per request like the sessions.
        settings = self._app.state.runtime_settings
        return ProductPolicy(memory_file_max_bytes=settings.anima_memory_file_max_bytes)

    @asynccontextmanager
    async def read_session(self, principal: RequestPrincipal) -> AsyncIterator[AsyncSession]:
        async with get_async_session_factory(self._app)() as session:
            yield session

    write_session = read_session

    def repositories(self, session: AsyncSession) -> SQLAlchemyProductRepositories:
        return SQLAlchemyProductRepositories(session)
