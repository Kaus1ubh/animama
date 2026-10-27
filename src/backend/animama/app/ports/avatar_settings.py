"""Owner-scoped storage for per-Avatar settings (wind and materials)."""

from __future__ import annotations

from collections.abc import Collection, Mapping
from dataclasses import dataclass
from typing import Literal, Protocol

# The stored setting columns; a NULL column means Automatic.
AvatarSettingField = Literal["spring_mode", "material_mode"]


@dataclass(frozen=True, slots=True)
class AvatarSettingOverride:
    """One owner's stored, non-Automatic settings for one Avatar item.

    At least one value is set: a row whose values are all Automatic is removed.
    """

    avatar_item_id: str
    spring_mode: str | None = None
    material_mode: str | None = None


class AvatarSettingOverrideRepository(Protocol):
    """Every method is scoped to ``owner_user_id``; none commits."""

    async def list_for_items(
        self, *, owner_user_id: str, avatar_item_ids: Collection[str]
    ) -> dict[str, AvatarSettingOverride]:
        """Return the owner's stored settings for these items, keyed by item id, in one query."""
        ...

    async def update(
        self, *, owner_user_id: str, avatar_item_id: str, changes: Mapping[AvatarSettingField, str | None]
    ) -> AvatarSettingOverride | None:
        """Set each named column (``None`` clears it) and keep the other columns, atomically.

        Values are already validated and never ``automatic``. The row is removed
        when no value is left; the result is the stored row, or ``None``.
        """
        ...


__all__ = ["AvatarSettingField", "AvatarSettingOverride", "AvatarSettingOverrideRepository"]
