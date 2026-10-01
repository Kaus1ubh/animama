from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from animama.app.ports.web_search_settings_port import WebSearchSettingsRepository
from animama.domain.web_search import WebSearchSettings
from animama.orm.web_search_settings import WEB_SEARCH_SETTINGS_ID, ORMWebSearchSettings


class SQLAlchemyWebSearchSettingsRepository(WebSearchSettingsRepository):
    """SQLAlchemy-backed storage for the installation's web search backend."""

    def __init__(self, session: AsyncSession) -> None:
        self._s = session

    async def get(self) -> WebSearchSettings | None:
        orm = await self._s.get(ORMWebSearchSettings, WEB_SEARCH_SETTINGS_ID, populate_existing=True)
        return _to_domain(orm) if orm is not None else None

    async def save(self, settings: WebSearchSettings) -> WebSearchSettings:
        orm = await self._s.get(ORMWebSearchSettings, WEB_SEARCH_SETTINGS_ID)
        if orm is None:
            orm = ORMWebSearchSettings(id=WEB_SEARCH_SETTINGS_ID, backend=settings.backend)
            self._s.add(orm)
        orm.backend = settings.backend
        orm.base_url = settings.base_url
        orm.credential_env = settings.credential_env
        orm.timeout_seconds = settings.timeout_seconds
        await self._s.flush()
        await self._s.refresh(orm)
        return _to_domain(orm)

    async def clear(self) -> None:
        orm = await self._s.get(ORMWebSearchSettings, WEB_SEARCH_SETTINGS_ID)
        if orm is not None:
            await self._s.delete(orm)
            await self._s.flush()


def _to_domain(orm: ORMWebSearchSettings) -> WebSearchSettings:
    return WebSearchSettings(
        backend=orm.backend,
        base_url=orm.base_url,
        credential_env=orm.credential_env,
        timeout_seconds=orm.timeout_seconds,
        updated_at=orm.updated_at,
    )


__all__ = ["SQLAlchemyWebSearchSettingsRepository"]
