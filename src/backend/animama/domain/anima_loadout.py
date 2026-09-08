"""Typed, catalog-backed equipment state for one Anima.

Pose Clips, effects, and sounds intentionally do not appear here: they are
support members owned transitively by Gesture and Reaction Action roots.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal

from .content_catalog import ContentSource
from .runtime_content_slot import RuntimeContentSlot


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
    code: str
    message: str
    scope: Literal["source", "target"] = "target"


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


@dataclass(frozen=True, slots=True)
class IdleAnimationSummary:
    animation_id: str
    name: str
    description: str | None = None


@dataclass(frozen=True, slots=True)
class IdleStyleBinding:
    state: Literal["starter", "custom", "empty"]
    name: str | None = None
    description: str | None = None
    source: CatalogLoadoutSource | None = None
    animations: tuple[IdleAnimationSummary, ...] = ()
    document_default_pool: tuple[str, ...] = ()
    document_emotion_pools: dict[str, tuple[str, ...]] = field(default_factory=dict)
    effective_default_pool: tuple[str, ...] = ()
    effective_emotion_pools: dict[str, tuple[str, ...]] = field(default_factory=dict)
    pool_overrides: dict[str, tuple[str, ...]] = field(default_factory=dict)
    cross_fade_seconds: float = 0.35


@dataclass(frozen=True, slots=True)
class MusicTrackBinding:
    binding_id: str
    item_id: str
    name: str
    source: CatalogLoadoutSource
    enabled: bool
    autoplay: bool
    effective_loop: bool
    effective_gain: float
    description: str | None = None
    loop_override: bool | None = None
    gain_override: float | None = None
    duration_seconds: float = 0
    codec: str = "unknown"


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
    idle_style: IdleStyleBinding
    music_tracks: tuple[MusicTrackBinding, ...] = ()
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
    "IdleAnimationSummary",
    "IdleStyleBinding",
    "LoadoutCommitResult",
    "LoadoutDiagnostic",
    "LoadoutPlan",
    "MusicTrackBinding",
    "ReactionCell",
    "StarterEntryIdentity",
]
