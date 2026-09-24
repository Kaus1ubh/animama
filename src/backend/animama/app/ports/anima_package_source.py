"""Saved authority required for exporting one owned Anima, with no runtime state."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Protocol


@dataclass(frozen=True, slots=True)
class SavedAnimaBinding:
    slot_key: str
    kind: str
    catalog_item_id: str
    config: dict[str, Any]


@dataclass(frozen=True, slots=True)
class SavedAnimaPackageSource:
    """Private snapshot fence. This object must never be serialized into a package."""

    owner_user_id: str
    anima_id: str
    display_name: str
    aggregate_revision: int
    identity_entry_id: str
    identity_version: int
    identity_sha256: str
    identity_markdown: str
    avatar_catalog_item_id: str | None
    avatar_relative_locator: str | None
    avatar_presentation_revision: int | None
    loadout_revision: int
    starter_catalog_version: int
    starter_exclusions: tuple[dict[str, Any], ...]
    idle_style_empty: bool
    bindings: tuple[SavedAnimaBinding, ...]


class AnimaPackageSourceRepository(Protocol):
    async def read_owned(self, *, user_id: str, anima_id: str) -> SavedAnimaPackageSource:
        """Read fresh raw authority under the common aggregate lock; never commit."""
        ...
