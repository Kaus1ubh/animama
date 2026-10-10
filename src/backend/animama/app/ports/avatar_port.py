"""Avatar repository protocol."""

from __future__ import annotations

from typing import Protocol

from ...domain.avatar import Avatar
from ...domain.content_catalog import CatalogContentEntry


class AvatarRepository(Protocol):
    """Repository operations for persisted Avatars."""

    async def get(self, avatar_id: str, *, for_update: bool = False) -> Avatar | None:
        raise NotImplementedError

    async def get_by_catalog_item(self, catalog_item_id: str) -> Avatar | None:
        """The logical Avatar registered for one catalog item, if any."""

        raise NotImplementedError

    async def list_readable(self, user_id: str) -> list[Avatar]:
        """Public Avatars and ``user_id``'s private ones, ordered by name, then id."""

        raise NotImplementedError

    async def list(self, user_id: str | None = None, include_public: bool = True) -> list[Avatar]:
        raise NotImplementedError

    async def is_in_use(self, avatar_id: str) -> bool:
        """Whether any Anima still uses the Avatar."""

        raise NotImplementedError

    async def create_owned(self, avatar: Avatar) -> Avatar:
        """Create an owner's Avatar; raise ``AvatarNameConflictError`` when the owner uses its name."""

        raise NotImplementedError

    async def update_owned(self, avatar: Avatar) -> Avatar:
        """Save an owner's edits; raise ``AvatarNameConflictError`` when the owner uses the name."""

        raise NotImplementedError

    async def create(self, avatar: Avatar) -> Avatar:
        raise NotImplementedError

    async def update(self, avatar: Avatar) -> Avatar:
        raise NotImplementedError

    async def delete(self, avatar_id: str) -> bool:
        raise NotImplementedError

    async def resolve_catalog_avatar(self, *, user_id: str, item: CatalogContentEntry) -> Avatar:
        """Associate one admitted item with a logical Avatar, without committing."""

        raise NotImplementedError
