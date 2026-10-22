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

IDLE_DEFAULT_CELL = "default"
"""Cell key of the Idle pool used for neutral and for every empty emotion cell."""

IDLE_INTENSITIES: tuple[int, ...] = (1, 2, 3)
"""Idle cell intensities; they follow the Anima's emotion state, which has three levels."""

REACTION_INTENSITIES: tuple[int, ...] = (1, 2, 3, 4)
"""Reaction intensities Mild, Moderate, Strong and Intense: 24 emotions x 4 = 96 cells per Anima."""

REACTION_POOL_LIMIT = 4
"""Most Reactions one emotion/intensity cell may hold; chat plays one member at random."""

ReactionIntensity = Literal[1, 2, 3, 4]


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
    """One equipped AI-callable Gesture: a ``gesture:<semantic_key>`` row."""

    binding_id: str
    name: str
    semantic_key: str
    implementation_kind: Literal["anima_clip", "vrma"]
    source: CatalogLoadoutSource
    description: str | None = None
    config_overrides: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class ReactionMember:
    """One Reaction in a cell's pool; chat picks a member at random for each emotion event.

    ``origin`` is ``starter`` when the member is one of the cell's Included
    starter Reactions. ``available`` is false when the catalog item is missing
    or invalid; such a member stays visible so it can be removed.
    """

    binding_id: str
    item_id: str
    name: str
    available: bool
    origin: Literal["starter", "custom"]
    source: CatalogLoadoutSource | None = None
    description: str | None = None


@dataclass(frozen=True, slots=True)
class ReactionCell:
    """One emotion/intensity cell and its pool of up to ``REACTION_POOL_LIMIT`` Reactions.

    ``state`` is ``empty`` without members, ``starter`` when the members are
    exactly the cell's available starter Reactions, else ``custom``.
    """

    emotion: str
    intensity: int
    state: Literal["starter", "custom", "empty"]
    members: tuple[ReactionMember, ...] = ()


def cell_key(emotion: object, intensity: object, *, intensities: tuple[int, ...], error_code: str) -> str:
    """Return ``<emotion>-<intensity>`` for a tracked emotion and an allowed intensity.

    Raises ``AnimaLoadoutError(error_code)`` for any other pair.
    """

    if emotion not in TRACKED_EMOTIONS or type(intensity) is not int or intensity not in intensities:
        raise AnimaLoadoutError(error_code)
    return f"{emotion}-{intensity}"


def parse_cell_key(cell: str, *, intensities: tuple[int, ...] = REACTION_INTENSITIES) -> tuple[str, int] | None:
    """Split ``<emotion>-<intensity>`` into its parts, or ``None`` when either is unknown.

    Tracked emotion names contain no hyphen, so the first hyphen ends the emotion.
    """

    emotion, separator, level = cell.partition("-")
    if not separator or emotion not in TRACKED_EMOTIONS:
        return None
    intensity = next((value for value in intensities if str(value) == level), None)
    return None if intensity is None else (emotion, intensity)


def _parse_member_slot(slot_key: str, prefix: str) -> tuple[str, str] | None:
    """Split ``<prefix>:<cell>:<catalog_item_id>``; the item id may itself contain hyphens or colons."""

    head, _, rest = slot_key.partition(":")
    cell, separator, item_id = rest.partition(":")
    if head != prefix or not separator or not cell or not item_id:
        return None
    return cell, item_id


def idle_cell_key(emotion: str | None, intensity: int | None) -> str:
    """Return ``default`` for the Default pool, else ``<emotion>-<intensity>``.

    Raises ``AnimaLoadoutError("idle_cell_invalid")`` for any other pair.
    """

    if emotion is None and intensity is None:
        return IDLE_DEFAULT_CELL
    return cell_key(emotion, intensity, intensities=IDLE_INTENSITIES, error_code="idle_cell_invalid")


def idle_slot_key(cell: str, item_id: str) -> str:
    """Binding slot of one Idle pool member; one row per Gesture per cell."""

    return f"idle:{cell}:{item_id}"


def parse_idle_slot_key(slot_key: str) -> tuple[str, str] | None:
    """Split an Idle member slot into ``(cell, catalog_item_id)``, or ``None`` for other slots."""

    return _parse_member_slot(slot_key, "idle")


def reaction_cell_key(emotion: object, intensity: object) -> str:
    """Return ``<emotion>-<intensity>`` for a Reaction cell, else raise ``reaction_cell_invalid``."""

    return cell_key(emotion, intensity, intensities=REACTION_INTENSITIES, error_code="reaction_cell_invalid")


def reaction_slot_key(cell: str, item_id: str) -> str:
    """Binding slot of one Reaction pool member: ``reaction:<emotion>-<intensity>:<catalog_item_id>``."""

    return f"reaction:{cell}:{item_id}"


def parse_reaction_slot_key(slot_key: str) -> tuple[str, str] | None:
    """Split a Reaction member slot into ``(cell, catalog_item_id)``, or ``None`` for any other slot.

    The cell must name a tracked emotion and a Reaction intensity. The row's
    ``catalog_item_id`` stays authoritative; the slot only names the cell.
    """

    parsed = _parse_member_slot(slot_key, "reaction")
    if parsed is None or parse_cell_key(parsed[0], intensities=REACTION_INTENSITIES) is None:
        return None
    return parsed


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
    """The Anima's built-in Idle pool: Default plus all 72 emotion/intensity cells (three intensities)."""

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
    """Typed equipment; Gestures, Reactions and Idle members are exactly the stored rows."""

    anima_id: str
    revision: int
    starter_version: int
    gestures: tuple[GestureBinding, ...]
    reactions: tuple[ReactionCell, ...]
    idle: IdlePool
    avatar_source: CatalogLoadoutSource | None = None
    appearances: tuple[AppearanceBinding, ...] = ()
    voice_source: CatalogLoadoutSource | None = None
    warnings: tuple[LoadoutDiagnostic, ...] = ()
    aggregate_revision: int = 1


@dataclass(frozen=True, slots=True)
class LoadoutPlan:
    action: Literal["add", "update", "replace", "remove", "revert", "unchanged"]
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
    "IDLE_INTENSITIES",
    "IdleCell",
    "IdleMember",
    "IdlePool",
    "LoadoutCommitResult",
    "LoadoutDiagnostic",
    "LoadoutPlan",
    "REACTION_INTENSITIES",
    "REACTION_POOL_LIMIT",
    "ReactionCell",
    "ReactionIntensity",
    "ReactionMember",
    "cell_key",
    "idle_cell_key",
    "idle_slot_key",
    "parse_cell_key",
    "parse_idle_slot_key",
    "parse_reaction_slot_key",
    "reaction_cell_key",
    "reaction_slot_key",
]
