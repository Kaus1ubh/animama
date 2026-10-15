"""Internal resolved creation inputs; these are not public HTTP commands.

AnimaCreationService validates the strict AnimaSpec and its complete source fence before
passing admitted catalog snapshots to this materialization boundary.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from .content_catalog import CatalogContentEntry


@dataclass(frozen=True, slots=True)
class ResolvedReactionSelection:
    emotion: str
    intensity: int
    source: CatalogContentEntry | None
    config: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class ResolvedGestureSelection:
    """An exact Gesture source with caller-validated binding configuration."""

    source: CatalogContentEntry
    config: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class ResolvedIdleMember:
    """One exact Gesture placed in an Idle pool cell (``default`` or ``<emotion>-<intensity>``)."""

    source: CatalogContentEntry
    cell: str


@dataclass(frozen=True, slots=True)
class ResolvedAppearanceSelection:
    source: CatalogContentEntry
    presentation: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class ResolvedAnimaSpec:
    """A private definition with explicit, exact typed loadout selections."""

    display_name: str
    identity: str
    avatar: CatalogContentEntry
    reactions: tuple[ResolvedReactionSelection, ...]
    gestures: tuple[ResolvedGestureSelection, ...] = ()
    # Creation resolves the starter Idle seed; package import supplies its own pool.
    idle: tuple[ResolvedIdleMember, ...] = ()
    profile: ResolvedAppearanceSelection | None = None
    background: ResolvedAppearanceSelection | None = None
    # Internal callers may supply an already locally validated voice choice.
    # No provider call or browser field is introduced at this boundary.
    voice_profile: dict[str, Any] | None = None
    speech_preferences: dict[str, Any] | None = None
    voice_source: CatalogContentEntry | None = None
