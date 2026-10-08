"""Owner-scoped storage for face-part corrections of read-only Avatars."""

from __future__ import annotations

from collections.abc import Collection
from dataclasses import dataclass
from typing import Any, Protocol


@dataclass(frozen=True, slots=True)
class AvatarFacePartOverride:
    """One owner's stored correction and the Avatar revision it was saved against."""

    avatar_item_id: str
    avatar_revision_sha256: str
    parts: dict[str, Any]


class AvatarFacePartOverrideRepository(Protocol):
    """Every method is scoped to ``owner_user_id``; none commits."""

    async def list_for_items(
        self, *, owner_user_id: str, avatar_item_ids: Collection[str]
    ) -> dict[str, AvatarFacePartOverride]:
        """Return the owner's overrides for these items, keyed by item id, in one query."""
        ...

    async def upsert(
        self, *, owner_user_id: str, avatar_item_id: str, avatar_revision_sha256: str, parts: dict[str, Any]
    ) -> None:
        """Create or replace the owner's override for one Avatar item."""
        ...

    async def delete(self, *, owner_user_id: str, avatar_item_id: str) -> None:
        """Remove the owner's override for one Avatar item, if any."""
        ...


__all__ = ["AvatarFacePartOverride", "AvatarFacePartOverrideRepository"]
