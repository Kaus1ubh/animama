"""Read and save an owner's settings (wind and materials) for one Avatar.

Local and Included Avatars alike keep the settings in the owner-scoped
``avatar_setting_overrides`` table, keyed by Avatar item only. Saving never
writes Avatar files or mints a revision, so it applies live and an updated
Avatar keeps the owner's choice.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable

from animama.app.contracts.avatar_settings import AvatarSettingsState, AvatarSettingsUpdate
from animama.app.ports.avatar_settings import AvatarSettingField, AvatarSettingOverrideRepository, AvatarSettingValue
from animama.app.ports.content_catalog import ContentCatalog
from animama.app.services.avatar_settings import AVATAR_SETTING_FIELDS, settings_state, stored_setting
from animama.domain.content_catalog import ContentKind, ContentNotFoundError, ContentStatus


class AvatarSettingsService:
    """Owner-scoped Avatar settings authority for current admitted Avatars."""

    def __init__(
        self,
        *,
        catalog: ContentCatalog,
        overrides: AvatarSettingOverrideRepository,
        commit: Callable[[], Awaitable[None]] | None = None,
    ) -> None:
        self._catalog = catalog
        self._overrides = overrides
        self._commit = commit

    async def _avatar_id(self, *, user_id: str, item_id: str) -> str:
        """Return the id of a valid Avatar the owner can see, else raise ``ContentNotFoundError``.

        Visibility is the ownership boundary: another owner's Local Avatar is
        reported exactly like an unknown item.
        """

        item = await self._catalog.get_visible_item(item_id=item_id, user_id=user_id)
        if item is None or item.kind is not ContentKind.AVATAR or item.status is not ContentStatus.VALID:
            raise ContentNotFoundError("typed catalog item was not found")
        return item.id

    async def get(self, *, user_id: str, item_id: str) -> AvatarSettingsState:
        """Return the effective settings and whether each was stored or defaulted."""

        avatar_id = await self._avatar_id(user_id=user_id, item_id=item_id)
        overrides = await self._overrides.list_for_items(owner_user_id=user_id, avatar_item_ids=[avatar_id])
        return settings_state(avatar_id, overrides.get(avatar_id))

    async def save(self, *, user_id: str, item_id: str, update: AvatarSettingsUpdate) -> AvatarSettingsState:
        """Change the settings named in ``update`` and keep the others.

        ``automatic`` or ``null`` clears a setting; the owner's row is removed
        once every setting is Automatic. Raises ``ContentNotFoundError`` for an
        unknown, invalid or non-Avatar item.
        """

        avatar_id = await self._avatar_id(user_id=user_id, item_id=item_id)
        changes: dict[AvatarSettingField, AvatarSettingValue | None] = {
            name: stored_setting(getattr(update, name))
            for name in AVATAR_SETTING_FIELDS
            if name in update.model_fields_set
        }
        stored = await self._overrides.update(owner_user_id=user_id, avatar_item_id=avatar_id, changes=changes)
        if changes and self._commit is not None:
            await self._commit()
        return settings_state(avatar_id, stored)


__all__ = ["AvatarSettingsService"]
