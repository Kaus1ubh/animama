from __future__ import annotations

from collections.abc import AsyncGenerator, Callable
from typing import cast

from fastapi import FastAPI, Request
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

# Shared routes and local tests depend on, and override, these same objects.
from animama.product_http.principal import get_current_principal, resolve_websocket_principal

__all__ = [
    "get_async_session",
    "get_async_session_factory",
    "get_current_principal",
    "resolve_websocket_principal",
]


async def get_async_session(request: Request) -> AsyncGenerator[AsyncSession, None]:
    """Open one session from the requesting application's injected factory."""
    session_factory = get_async_session_factory(request.app)
    async with session_factory() as sess:
        yield sess


def get_async_session_factory(app: FastAPI) -> async_sessionmaker[AsyncSession]:
    """Resolve database resources explicitly owned by this application."""
    factory = getattr(app.state, "session_factory", None)
    if factory is not None:
        return cast(async_sessionmaker[AsyncSession], factory)
    provider = getattr(app.state, "session_factory_provider", None)
    if provider is None:
        raise RuntimeError("Application session factory is not configured")
    # App factories own both forms of this dynamically stored dependency.
    return cast(Callable[[], async_sessionmaker[AsyncSession]], provider)()
