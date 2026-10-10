"""The local composition's ports for the shared product routes (ADR 0021)."""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from sqlalchemy.ext.asyncio import AsyncSession

from animama.server.deps import get_async_session_factory


class LocalProductPorts:
    """Serve shared routes from the local app's own database resources.

    Construction performs no IO: each session resolves the app's lazily created
    factory when it opens. Local handlers' commits take effect immediately, so a
    write session is an ordinary session.
    """

    def __init__(self, app: FastAPI) -> None:
        self._app = app

    @asynccontextmanager
    async def read_session(self) -> AsyncIterator[AsyncSession]:
        async with get_async_session_factory(self._app)() as session:
            yield session

    write_session = read_session
