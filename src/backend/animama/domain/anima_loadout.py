"""Typed, catalog-backed equipment state for one Anima.

Pose Clips, effects, and sounds intentionally do not appear here: they are
support members owned transitively by Gesture and Reaction Action roots.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Any, Literal

from .content_catalog import ContentSource
from .emotions import TRACKED_EMOTIONS
from .runtime_content_slot import RuntimeContentSlot

IDLE_DEFAULT_CELL = "default"
"""Cell key of the Idle pool used for neutral and for every empty emotion cell."""


@dataclass(frozen=True, slots=True, order=True)
class StarterEntryIdentity:
    """Semantic identity of one excluded Included default entry."""

    slot: RuntimeContentSlot
    runtime_id: str


@dataclass(frozen=True, slots=True)
class CatalogLoadoutSource:
    """Stable logical selection resolved to fresh bytes only on remount."""

    catalog_item_id: str
    source: ContentSource
    logical_key: str | None = None


@dataclass(frozen=True, slots=True)
class LoadoutDiagnostic:
    """A Loadout warning. Clients word it from ``code`` and ``params``; ``message`` is English detail."""

    code: str
    message: str
    scope: Literal["source", "target"] = "target"
    params: Mapping[str, str] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class GestureBinding:
    binding_id: str
    name: str
    semantic_key: str
    origin: Literal["starter", "custom"]
    implementation_kind: Literal["anima_clip", "vrma"]
    source: CatalogLoadoutSource
    description: str | None = None
    config_overrides: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class ReactionCell:
    emotion: str
    intensity: int
    state: Literal["starter", "custom", "empty"]
    binding_id: str | None = None
    name: str | None = None
    source: CatalogLoadoutSource | None = None
    config_overrides: dict[str, Any] = field(default_factory=dict)


def idle_cell_key(emotion: str | None, intensity: int | None) -> str:
    """Return ``default`` for the Default pool, else ``<emotion>-<intensity>``.

    Raises ``AnimaLoadoutError("idle_cell_invalid")`` for any other pair.
    """

    if emotion is None and intensity is None:
        return IDLE_DEFAULT_CELL
    if emotion not in TRACKED_EMOTIONS or intensity not in {1, 2, 3}:
        raise AnimaLoadoutError("idle_cell_invalid")
    return f"{emotion}-{intensity}"


def idle_slot_key(cell: str, item_id: str) -> str:
    """Binding slot of one Idle pool member; one row per Gesture per cell."""

    return f"idle:{cell}:{item_id}"


def parse_idle_slot_key(slot_key: str) -> tuple[str, str] | None:
    """Split an Idle member slot into ``(cell, catalog_item_id)``, or ``None`` for other slots."""

    prefix, _, rest = slot_key.partition(":")
    cell, separator, item_id = rest.partition(":")
    if prefix != "idle" or not separator or not cell or not item_id:
        return None
    return cell, item_id


@dataclass(frozen=True, slots=True)
class IdleMember:
    """One Gesture in an Anima's Idle pool. Membership never equips it for AI invocation."""

    binding_id: str
    item_id: str
    name: str
    available: bool
    source: CatalogLoadoutSource | None = None
    description: str | None = None


@dataclass(frozen=True, slots=True)
class IdleCell:
    """One emotion/intensity cell; higher intensities also play it, and Default is always mixed in."""

    emotion: str
    intensity: int
    gestures: tuple[IdleMember, ...] = ()


@dataclass(frozen=True, slots=True)
class IdlePool:
    """The Anima's built-in Idle pool: Default plus all 72 emotion/intensity cells."""

    default_pool: tuple[IdleMember, ...] = ()
    cells: tuple[IdleCell, ...] = ()


@dataclass(frozen=True, slots=True)
class AppearanceBinding:
    binding_id: str
    use: Literal["profile", "background"]
    item_id: str
    name: str
    source: CatalogLoadoutSource
    width: int | None
    height: int | None
    presentation: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class AnimaLoadout:
    """Effective typed equipment, including source-controlled defaults."""

    anima_id: str
    revision: int
    starter_version: int
    gestures: tuple[GestureBinding, ...]
    disabled_starter_gestures: tuple[str, ...]
    reactions: tuple[ReactionCell, ...]
    idle: IdlePool
    avatar_source: CatalogLoadoutSource | None = None
    appearances: tuple[AppearanceBinding, ...] = ()
    voice_source: CatalogLoadoutSource | None = None
    warnings: tuple[LoadoutDiagnostic, ...] = ()
    aggregate_revision: int = 1


@dataclass(frozen=True, slots=True)
class LoadoutPlan:
    action: Literal["add", "update", "replace", "remove", "revert", "leave_empty", "unchanged"]
    digest: str
    final_gesture_count: int
    current_name: str | None = None
    target_name: str | None = None
    included_resource_counts: dict[str, int] = field(default_factory=dict)
    warnings: tuple[LoadoutDiagnostic, ...] = ()
    aggregate_revision: int = 1


@dataclass(frozen=True, slots=True)
class LoadoutCommitResult:
    anima_id: str
    revision: int
    action: str
    idempotent_replay: bool = False
    aggregate_revision: int | None = None


class AnimaLoadoutError(Exception):
    """Stable error raised by typed loadout planning and commits."""

    def __init__(self, code: str, *, current_revision: int | None = None) -> None:
        super().__init__(code)
        self.code = code
        self.current_revision = current_revision


__all__ = [
    "AnimaLoadout",
    "AnimaLoadoutError",
    "AppearanceBinding",
    "CatalogLoadoutSource",
    "GestureBinding",
    "IDLE_DEFAULT_CELL",
    "IdleCell",
    "IdleMember",
    "IdlePool",
    "LoadoutCommitResult",
    "LoadoutDiagnostic",
    "LoadoutPlan",
    "ReactionCell",
    "StarterEntryIdentity",
    "idle_cell_key",
    "idle_slot_key",
    "parse_idle_slot_key",
]
