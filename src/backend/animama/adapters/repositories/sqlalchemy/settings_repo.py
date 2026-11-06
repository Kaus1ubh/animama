"""SQLAlchemy settings repositories."""

from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from animama.adapters.mappers.settings_map import (
    anima_settings_domain_to_orm,
    anima_settings_orm_to_domain,
    apply_anima_settings_to_orm,
    apply_user_settings_to_orm,
    user_settings_domain_to_orm,
    user_settings_orm_to_domain,
)
from animama.app.ports.settings_port import AnimaSettingsRepository, UserSettingsRepository
from animama.domain.settings import AnimaSettings, UserSettings
from animama.orm.settings import ORMAnimaSettings, ORMUserSettings


class SQLAlchemyUserSettingsRepository(UserSettingsRepository):
    def __init__(self, session: AsyncSession) -> None:
        self._s = session

    async def get(self, user_id: str) -> UserSettings | None:
        orm = await self._s.get(ORMUserSettings, user_id)
        return user_settings_orm_to_domain(orm) if orm is not None else None

    async def upsert(self, settings: UserSettings) -> UserSettings:
        orm = await self._s.get(ORMUserSettings, settings.user_id)
        if orm is None:
            orm = user_settings_domain_to_orm(settings)
            self._s.add(orm)
        else:
            apply_user_settings_to_orm(orm, settings)
        await self._s.flush()
        await self._s.refresh(orm)
        return user_settings_orm_to_domain(orm)

    async def delete(self, user_id: str) -> bool:
        orm = await self._s.get(ORMUserSettings, user_id)
        if orm is None:
            return False
        await self._s.delete(orm)
        await self._s.flush()
        return True


class SQLAlchemyAnimaSettingsRepository(AnimaSettingsRepository):
    def __init__(self, session: AsyncSession) -> None:
        self._s = session

    async def get(self, *, user_id: str, anima_id: str) -> AnimaSettings | None:
        orm = await self._s.get(ORMAnimaSettings, (user_id, anima_id))
        return anima_settings_orm_to_domain(orm) if orm is not None else None

    async def upsert(self, settings: AnimaSettings) -> AnimaSettings:
        orm = await self._s.get(ORMAnimaSettings, (settings.user_id, settings.anima_id))
        if orm is None:
            orm = anima_settings_domain_to_orm(settings)
            self._s.add(orm)
        else:
            apply_anima_settings_to_orm(orm, settings)
        await self._s.flush()
        await self._s.refresh(orm)
        return anima_settings_orm_to_domain(orm)

    async def delete(self, *, user_id: str, anima_id: str) -> bool:
        orm = await self._s.get(ORMAnimaSettings, (user_id, anima_id))
        if orm is None:
            return False
        await self._s.delete(orm)
        await self._s.flush()
        return True
