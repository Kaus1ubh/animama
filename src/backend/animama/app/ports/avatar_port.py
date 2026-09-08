"""Avatar repository protocol."""

from __future__ import annotations

from typing import Protocol

from ...domain.avatar import Avatar
from ...domain.content_catalog import CatalogContentEntry


class AvatarRepository(Protocol):
    """Repository operations for persisted Avatars."""

    async def get(self, avatar_id: str) -> Avatar | None:
        raise NotImplementedError

    async def list(self, user_id: str | None = None, include_public: bool = True) -> list[Avatar]:
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
