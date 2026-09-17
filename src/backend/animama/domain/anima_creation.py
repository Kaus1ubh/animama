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
    idle_style: CatalogContentEntry | None
    reactions: tuple[ResolvedReactionSelection, ...]
    gestures: tuple[CatalogContentEntry, ...] = ()
    profile: ResolvedAppearanceSelection | None = None
    background: ResolvedAppearanceSelection | None = None
    # Internal callers may supply an already locally validated voice choice.
    # No provider call or browser field is introduced at this boundary.
    voice_profile: dict[str, Any] | None = None
