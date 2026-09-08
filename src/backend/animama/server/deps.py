from __future__ import annotations

from collections.abc import AsyncGenerator

from fastapi import FastAPI, Request, WebSocket
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from animama.domain.request_principal import RequestPrincipal
from animama.embeddings import Embedder
from animama.server.request_principal import principal_resolver

_embedder: Embedder | None = None


def get_embedder() -> Embedder:  # type: ignore[name-defined]
    """Return a singleton Embedder configured from environment."""

    global _embedder
    if _embedder is None:
        from animama.embeddings import Embedder

        _embedder = Embedder()
    return _embedder


async def get_async_session(request: Request) -> AsyncGenerator[AsyncSession, None]:
    """Open one session from the requesting application's injected factory."""
    session_factory = get_async_session_factory(request.app)
    async with session_factory() as sess:
        yield sess


def get_async_session_factory(app: FastAPI) -> async_sessionmaker[AsyncSession]:
    """Resolve database resources explicitly owned by this application."""
    factory = getattr(app.state, "session_factory", None)
    if factory is not None:
        return factory
    provider = getattr(app.state, "session_factory_provider", None)
    if provider is None:
        raise RuntimeError("Application session factory is not configured")
    return provider()


async def get_current_principal(request: Request) -> RequestPrincipal:
    """Delegate ownership resolution to the current application composition."""

    return await principal_resolver(request).resolve_http(request)


async def resolve_websocket_principal(websocket: WebSocket) -> RequestPrincipal:
    """Resolve a WebSocket owner before the route accepts the connection."""

    return await principal_resolver(websocket).resolve_websocket(websocket)
