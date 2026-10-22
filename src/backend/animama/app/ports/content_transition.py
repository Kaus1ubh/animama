"""Binding boundaries for local content transitions in the content mutation transaction."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Protocol


@dataclass(frozen=True, slots=True)
class MusicTransitionBinding:
    """Exact retired equipment facts, independent of a catalog row or audio file."""

    binding_id: str
    slot_key: str
    catalog_item_id: str
    kind: str
    config: dict[str, Any]
    created_at: str
    updated_at: str


@dataclass(frozen=True, slots=True)
class MusicTransitionAnima:
    """One checked aggregate update preserves and retires all its Music rows."""

    anima_id: str
    loadout_revision: int
    aggregate_revision: int
    starter_catalog_version: int
    bindings: tuple[MusicTransitionBinding, ...]


class ContentTransitionBindings(Protocol):
    """Rewrite equipment in the caller's content mutation transaction."""

    async def music_consumers(self, *, user_id: str) -> tuple[MusicTransitionAnima, ...]:
        """Snapshot Music rows by Anima without requiring their source catalog or files."""
        ...

    async def remove_music(self, *, user_id: str, before: MusicTransitionAnima) -> None:
        """Recheck the aggregate and exact Music set before removing its retired bindings."""
        ...
