"""The local composition's ports for the shared product routes (ADR 0021)."""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from sqlalchemy.ext.asyncio import AsyncSession

from animama.adapters.repositories.sqlalchemy.product_repositories import SQLAlchemyProductRepositories
from animama.app.contracts.runtime_capabilities import RuntimeCapabilities
from animama.app.safety.crisis_resources import CrisisResourceTable
from animama.domain.request_principal import RequestPrincipal
from animama.product_http.ports import ProductPolicy, ProductRefusal
from animama.server.companion_safety import runtime_crisis_resources
from animama.server.deps import get_async_session_factory
from animama.server.embedding_refresh import wake_embedding_refresh
from animama.server.installation_personalization import (
    FirstRunIncompleteError,
    InstallationPersonalizationService,
    InstallationPrincipalMismatchError,
)
from animama.server.runtime_capabilities import local_runtime_capabilities, runtime_settings_for


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
        settings = runtime_settings_for(self._app)
        return ProductPolicy(memory_file_max_bytes=settings.anima_memory_file_max_bytes)

    @asynccontextmanager
    async def read_session(self, principal: RequestPrincipal) -> AsyncIterator[AsyncSession]:
        async with get_async_session_factory(self._app)() as session:
            yield session

    write_session = read_session

    def repositories(self, session: AsyncSession) -> SQLAlchemyProductRepositories:
        return SQLAlchemyProductRepositories(session)

    async def update_display_name(self, session: AsyncSession, principal: RequestPrincipal, display_name: str) -> str:
        # The installation owner's name also personalizes its memory files.
        try:
            result = await InstallationPersonalizationService(session).update_display_name(
                principal_id=principal.id, display_name=display_name
            )
        except FirstRunIncompleteError as exc:
            raise ProductRefusal(409, "first_run_incomplete") from exc
        except InstallationPrincipalMismatchError as exc:
            raise ProductRefusal(403, "installation_principal_mismatch") from exc
        return result.display_name

    def crisis_resources(self) -> CrisisResourceTable:
        # The packaged table, or an operator-supplied one (ANIMAMA_CRISIS_RESOURCES_PATH).
        return runtime_crisis_resources(runtime_settings_for(self._app))

    async def runtime_capabilities(self, session: AsyncSession, principal: RequestPrincipal) -> RuntimeCapabilities:
        return await local_runtime_capabilities(self._app, session)

    def user_settings_changed(self, principal: RequestPrincipal) -> None:
        # The embeddings role may have changed; re-check stored vectors now.
        wake_embedding_refresh(self._app)
