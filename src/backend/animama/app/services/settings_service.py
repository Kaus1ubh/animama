"""Settings service."""

from __future__ import annotations

from enum import Enum
from typing import Any, cast

from ...domain.settings import AnimaSettings, UserSettings
from ...logging import get_logger
from ..ports import AnimaSettingsRepository, UnitOfWork, UserSettingsRepository


class _Unset(Enum):
    VALUE = "unset"


_UNSET = _Unset.VALUE


def default_anima_preferences() -> dict[str, Any]:
    return {
        "memory": {"disable_influence": False, "disable_updates": False},
        "emotion": {"disable_influence": False, "disable_updates": False},
        "presentation": {
            "disable_animation": False,
            "disable_vfx": False,
        },
    }


class SettingsService:
    def __init__(
        self,
        *,
        user_settings: UserSettingsRepository,
        anima_settings: AnimaSettingsRepository,
        uow: UnitOfWork,
    ) -> None:
        self._user_settings = user_settings
        self._anima_settings = anima_settings
        self._uow = uow
        self._log = get_logger("app.services.settings")

    async def get_user_settings(self, user_id: str) -> UserSettings | None:
        return await self._user_settings.get(user_id)

    async def patch_user_settings(
        self,
        *,
        user_id: str,
        theme: str | None | _Unset = _UNSET,
        locale: str | None | _Unset = _UNSET,
        last_active_anima_id: str | None | _Unset = _UNSET,
        preferences: dict[str, Any] | None | _Unset = _UNSET,
    ) -> UserSettings:
        current = await self._user_settings.get(user_id)
        if current is None:
            current = UserSettings(user_id=user_id)
        # Keep explicit null patches distinct from omitted fields. The repository
        # normalizes preferences and preserves database rejection/default behavior
        # for null theme/locale; only its returned record is fully materialized.
        updated = UserSettings(
            user_id=user_id,
            theme=current.theme if theme is _UNSET else cast(str, theme),
            locale=current.locale if locale is _UNSET else cast(str, locale),
            last_active_anima_id=(
                current.last_active_anima_id if last_active_anima_id is _UNSET else last_active_anima_id
            ),
            preferences=(
                dict(current.preferences or {}) if preferences is _UNSET else cast(dict[str, Any], preferences)
            ),
            created_at=current.created_at,
            updated_at=current.updated_at,
        )
        stored = await self._user_settings.upsert(updated)
        await self._uow.commit()
        self._log.info("UserSettings Updated", user_id=user_id)
        return stored

    async def delete_user_settings(self, user_id: str) -> bool:
        ok = await self._user_settings.delete(user_id)
        if ok:
            await self._uow.commit()
        self._log.info("UserSettings Deleted", user_id=user_id, ok=ok)
        return ok

    async def get_anima_settings(self, *, user_id: str, anima_id: str) -> AnimaSettings | None:
        return await self._anima_settings.get(user_id=user_id, anima_id=anima_id)

    async def patch_anima_settings(
        self,
        *,
        user_id: str,
        anima_id: str,
        theme: dict[str, Any] | None | _Unset = _UNSET,
        background: str | None | _Unset = _UNSET,
        favorited: bool | None | _Unset = _UNSET,
        preferences: dict[str, Any] | None | _Unset = _UNSET,
    ) -> AnimaSettings:
        current = await self._anima_settings.get(user_id=user_id, anima_id=anima_id)
        if current is None:
            current = AnimaSettings(
                user_id=user_id,
                anima_id=anima_id,
                preferences=default_anima_preferences(),
            )
        # The repository normalizes nullable favorited/preferences on write.
        updated = AnimaSettings(
            user_id=user_id,
            anima_id=anima_id,
            theme=current.theme if theme is _UNSET else theme,
            background=current.background if background is _UNSET else background,
            favorited=current.favorited if favorited is _UNSET else cast(bool, favorited),
            preferences=(
                dict(current.preferences or {}) if preferences is _UNSET else cast(dict[str, Any], preferences)
            ),
            created_at=current.created_at,
            updated_at=current.updated_at,
        )
        stored = await self._anima_settings.upsert(updated)
        await self._uow.commit()
        self._log.info("AnimaSettings Updated", user_id=user_id, anima_id=anima_id)
        return stored

    async def delete_anima_settings(self, *, user_id: str, anima_id: str) -> bool:
        ok = await self._anima_settings.delete(user_id=user_id, anima_id=anima_id)
        if ok:
            await self._uow.commit()
        self._log.info("AnimaSettings Deleted", user_id=user_id, anima_id=anima_id, ok=ok)
        return ok
