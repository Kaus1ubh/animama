"""Binding boundaries for local content transitions in the content mutation transaction."""

from __future__ import annotations

from collections.abc import Mapping
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


@dataclass(frozen=True, slots=True)
class ContentTransitionBinding:
    """Exact persisted equipment, including unrelated occupied slots."""

    binding_id: str
    slot_key: str
    catalog_item_id: str
    kind: str
    config: dict[str, Any]
    created_at: str
    updated_at: str


@dataclass(frozen=True, slots=True)
class ContentTransitionSelection:
    """An affected Gesture or Reaction binding row."""

    slot_key: str
    kind: str
    catalog_item_id: str
    binding_id: str
    config: dict[str, Any]


@dataclass(frozen=True, slots=True)
class ContentTransitionAnima:
    """One revision fence for all converted Action selections of an Anima."""

    anima_id: str
    loadout_revision: int
    aggregate_revision: int
    starter_catalog_version: int
    bindings: tuple[ContentTransitionBinding, ...]
    selections: tuple[ContentTransitionSelection, ...]


class ContentTransitionBindings(Protocol):
    """Rewrite equipment in the caller's content mutation transaction."""

    async def music_consumers(self, *, user_id: str) -> tuple[MusicTransitionAnima, ...]:
        """Snapshot Music rows by Anima without requiring their source catalog or files."""
        ...

    async def remove_music(self, *, user_id: str, before: MusicTransitionAnima) -> None:
        """Recheck the aggregate and exact Music set before removing its retired bindings."""
        ...

    async def content_consumers(self, *, user_id: str, item_ids: tuple[str, ...]) -> tuple[ContentTransitionAnima, ...]:
        """Snapshot the Animas whose Gesture or Reaction rows use an affected item."""
        ...

    async def replace_content(
        self, *, user_id: str, before: ContentTransitionAnima, replacements: Mapping[str, str]
    ) -> None:
        """Recheck the complete equipment snapshot and replace its affected selections once."""
        ...
