from __future__ import annotations

from animama.app.services.settings_service import SettingsService
from animama.domain.settings import AnimaSettings, UserSettings


class _FakeUserSettingsRepo:
    def __init__(self) -> None:
        self._items: dict[str, UserSettings] = {}

    async def get(self, user_id: str) -> UserSettings | None:
        return self._items.get(user_id)

    async def upsert(self, settings: UserSettings) -> UserSettings:
        self._items[settings.user_id] = settings
        return settings

    async def delete(self, user_id: str) -> bool:
        return self._items.pop(user_id, None) is not None


class _FakeAnimaSettingsRepo:
    def __init__(self) -> None:
        self._items: dict[tuple[str, str], AnimaSettings] = {}

    async def get(self, *, user_id: str, anima_id: str) -> AnimaSettings | None:
        return self._items.get((user_id, anima_id))

    async def upsert(self, settings: AnimaSettings) -> AnimaSettings:
        self._items[(settings.user_id, settings.anima_id)] = settings
        return settings

    async def delete(self, *, user_id: str, anima_id: str) -> bool:
        return self._items.pop((user_id, anima_id), None) is not None


class _FakeUnitOfWork:
    def __init__(self) -> None:
        self.commits = 0

    async def commit(self) -> None:
        self.commits += 1

    async def rollback(self) -> None:
        return None


async def test_patch_anima_settings_allows_clearing_background_with_null() -> None:
    user_repo = _FakeUserSettingsRepo()
    anima_repo = _FakeAnimaSettingsRepo()
    uow = _FakeUnitOfWork()
    service = SettingsService(
        user_settings=user_repo,
        anima_settings=anima_repo,
        uow=uow,
    )

    await anima_repo.upsert(
        AnimaSettings(
            user_id="user-1",
            anima_id="anima-1",
            background="tokyo-real-day",
        )
    )

    updated = await service.patch_anima_settings(
        user_id="user-1",
        anima_id="anima-1",
        background=None,
    )

    assert updated.background is None
    assert uow.commits == 1


async def test_patch_anima_settings_preserves_background_when_omitted() -> None:
    user_repo = _FakeUserSettingsRepo()
    anima_repo = _FakeAnimaSettingsRepo()
    uow = _FakeUnitOfWork()
    service = SettingsService(
        user_settings=user_repo,
        anima_settings=anima_repo,
        uow=uow,
    )

    await anima_repo.upsert(
        AnimaSettings(
            user_id="user-1",
            anima_id="anima-1",
            background="tokyo-real-day",
            favorited=False,
        )
    )

    updated = await service.patch_anima_settings(
        user_id="user-1",
        anima_id="anima-1",
        favorited=True,
    )

    assert updated.background == "tokyo-real-day"
    assert updated.favorited is True


async def test_patch_user_settings_allows_clearing_last_active_anima_id_with_null() -> None:
    user_repo = _FakeUserSettingsRepo()
    anima_repo = _FakeAnimaSettingsRepo()
    uow = _FakeUnitOfWork()
    service = SettingsService(
        user_settings=user_repo,
        anima_settings=anima_repo,
        uow=uow,
    )

    await user_repo.upsert(
        UserSettings(
            user_id="user-1",
            last_active_anima_id="anima-1",
        )
    )

    updated = await service.patch_user_settings(
        user_id="user-1",
        last_active_anima_id=None,
    )

    assert updated.last_active_anima_id is None
    assert uow.commits == 1
