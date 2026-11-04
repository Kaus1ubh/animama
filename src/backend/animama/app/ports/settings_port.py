"""Settings repository protocol."""

from __future__ import annotations

from typing import Protocol

from animama.domain.settings import AnimaSettings, UserSettings


class UserSettingsRepository(Protocol):
    async def get(self, user_id: str) -> UserSettings | None:
        raise NotImplementedError

    async def upsert(self, settings: UserSettings) -> UserSettings:
        raise NotImplementedError

    async def delete(self, user_id: str) -> bool:
        raise NotImplementedError


class AnimaSettingsRepository(Protocol):
    async def get(self, *, user_id: str, anima_id: str) -> AnimaSettings | None:
        raise NotImplementedError

    async def upsert(self, settings: AnimaSettings) -> AnimaSettings:
        raise NotImplementedError

    async def delete(self, *, user_id: str, anima_id: str) -> bool:
        raise NotImplementedError
