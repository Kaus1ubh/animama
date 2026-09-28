"""Binding and retained-original boundaries for the local idle format transition."""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Any, Protocol


@dataclass(frozen=True, slots=True)
class IdleTransitionBinding:
    """An exact pre-transition equipment selection, including implicit starters."""

    anima_id: str
    loadout_revision: int
    aggregate_revision: int
    binding_id: str | None
    config: dict[str, Any] = field(default_factory=dict)


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
    starter_exclusions: tuple[dict[str, str], ...]
    idle_style_empty: bool
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
    """An affected explicit selection or currently consumed implicit starter."""

    slot_key: str
    kind: str
    catalog_item_id: str
    binding_id: str | None
    config: dict[str, Any]
    starter_content_id: str | None = None
    starter_version: int | None = None


@dataclass(frozen=True, slots=True)
class ContentTransitionAnima:
    """One revision fence for all converted Action/Style selections of an Anima."""

    anima_id: str
    loadout_revision: int
    aggregate_revision: int
    starter_catalog_version: int
    starter_exclusions: tuple[dict[str, str], ...]
    idle_style_empty: bool
    bindings: tuple[ContentTransitionBinding, ...]
    selections: tuple[ContentTransitionSelection, ...]


class ContentTransitionBindings(Protocol):
    """Rewrite equipment in the caller's content mutation transaction."""

    async def idle_consumers(
        self, *, user_id: str, item_id: str, is_starter: bool
    ) -> tuple[IdleTransitionBinding, ...]:
        """Read exact explicit selections and consumers of an implicit starter."""
        ...

    async def replace_idle(self, *, user_id: str, before: IdleTransitionBinding, item_id: str) -> None:
        """Recheck a selection, bind its converted Style and retire pool overrides."""
        ...

    async def music_consumers(self, *, user_id: str) -> tuple[MusicTransitionAnima, ...]:
        """Snapshot Music rows by Anima without requiring their source catalog or files."""
        ...

    async def remove_music(self, *, user_id: str, before: MusicTransitionAnima) -> None:
        """Recheck the aggregate and exact Music set before removing its retired bindings."""
        ...

    async def content_consumers(
        self, *, user_id: str, item_ids: tuple[str, ...], included_by_logical: Mapping[str, str]
    ) -> tuple[ContentTransitionAnima, ...]:
        """Snapshot affected explicit and implicit Action/Style consumers by Anima."""
        ...

    async def replace_content(
        self, *, user_id: str, before: ContentTransitionAnima, replacements: Mapping[str, str]
    ) -> None:
        """Recheck the complete equipment snapshot and replace its affected selections once."""
        ...
