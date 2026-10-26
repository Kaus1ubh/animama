"""The application's model catalog, read-only, and chat's shared model client registry.

Database and server imports stay inside the functions: the dry runs need no
database, and the test suite patches the engine these functions open.
"""

from __future__ import annotations

from collections.abc import AsyncIterator, Sequence
from contextlib import asynccontextmanager

from animama.app.model_clients import StaticModelClientRegistry
from animama.app.ports import ModelProviderRepository
from animama.domain import ModelProvider
from animama.domain.model_connection import MODEL_KIND_CHAT

__all__ = ["build_model_client_registry", "chat_model_rows", "read_only_model_providers"]


@asynccontextmanager
async def read_only_model_providers() -> AsyncIterator[ModelProviderRepository]:
    """Open the application database's model catalog in a read-only transaction."""

    from sqlalchemy import text
    from sqlalchemy.ext.asyncio import async_sessionmaker

    from animama.adapters.repositories.sqlalchemy.model_provider_repo import SQLAlchemyModelProviderRepository
    from animama.local.database import dispose_engine, get_engine

    engine = get_engine()
    try:
        async with async_sessionmaker(engine)() as session:
            await session.execute(text("SET TRANSACTION READ ONLY"))
            yield SQLAlchemyModelProviderRepository(session)
    finally:
        await dispose_engine(engine=engine)


async def chat_model_rows(model_providers: ModelProviderRepository) -> Sequence[ModelProvider]:
    """Return the catalog's active chat rows."""

    rows = await model_providers.list_active()
    return [row for row in rows if row.model_kind == MODEL_KIND_CHAT]


def build_model_client_registry() -> StaticModelClientRegistry:
    """Build chat's shared model clients; each request reads its connection's key from the credential store."""

    from animama.server.model_clients import build_model_client_registry as build

    return build()
