"""Allowlisted complete Anima transport data, independent of local identities."""

from __future__ import annotations

from collections.abc import Iterator
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from animama.app.anima_creation_contract import Emotion, ImagePresentation, ReactionIntensityKey, SemanticKey
from animama.domain.anima_definition import normalize_display_name, normalize_identity
from animama.domain.anima_loadout import REACTION_INTENSITIES, REACTION_POOL_LIMIT
from animama.domain.content_catalog import ContentKind
from animama.domain.emotions import TRACKED_EMOTIONS

EntryId = Annotated[str, Field(min_length=1, max_length=128, pattern=r"^[A-Za-z0-9][A-Za-z0-9._:-]*$")]


class PortableModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, allow_inf_nan=False)


class PortableActionConfig(PortableModel):
    """Bounded union of implemented binding fields; applicability is checked against the Action."""

    duration_seconds: float | None = Field(default=None, gt=0)
    loop: bool | None = None
    loop_type: Literal["once", "repeat", "pingpong"] | None = None
    loop_count: int | None = Field(default=None, ge=1, le=2**53 - 1)
    time_scale: float | None = Field(default=None, gt=0)
    weight: float | None = Field(default=None, ge=0)
    blend_mode: Literal["normal", "additive"] | None = None
    emotion_weights: dict[Emotion, dict[Literal["1", "2", "3"], Annotated[float, Field(ge=0)]]] | None = None


class PortableActionSelection(PortableModel):
    entry_id: EntryId
    config: dict[str, Any] = Field(default_factory=dict)

    @field_validator("config")
    @classmethod
    def supported_config_shape(cls, value: dict[str, Any]) -> dict[str, Any]:
        if any(child is None for child in value.values()):
            raise ValueError("Binding fields must have explicit supported values")
        return PortableActionConfig.model_validate(value).model_dump(exclude_none=True)


class PortableGestureSelection(PortableActionSelection):
    semantic_key: SemanticKey


class PortableAppearanceSelection(PortableModel):
    entry_id: EntryId
    presentation: ImagePresentation


class PortableAnimaAppearance(PortableModel):
    profile: PortableAppearanceSelection | None
    background: PortableAppearanceSelection | None


IdleEntryList = Annotated[list[EntryId], Field(max_length=500)]
ReactionPoolEntries = Annotated[list[EntryId], Field(max_length=REACTION_POOL_LIMIT)]


class PortableIdlePool(PortableModel):
    """The Anima's Idle pool as Gesture entry ids.

    An emotion/intensity cell absent from ``cells`` holds no Gestures of its
    own; playback still mixes in ``default`` and the emotion's lower
    intensities. Lists are unique and present cells are non-empty, so each pool
    has one encoding.
    """

    default: IdleEntryList
    cells: dict[Emotion, dict[Literal["1", "2", "3"], IdleEntryList]]

    @field_validator("default")
    @classmethod
    def unique_default(cls, value: list[str]) -> list[str]:
        if len(set(value)) != len(value):
            raise ValueError("Idle pool Gestures must be unique")
        return value

    @field_validator("cells")
    @classmethod
    def canonical_cells(cls, value: dict[str, dict[str, list[str]]]) -> dict[str, dict[str, list[str]]]:
        for levels in value.values():
            if not levels:
                raise ValueError("Omit an emotion with no Idle cells")
            for members in levels.values():
                if not members or len(set(members)) != len(members):
                    raise ValueError("Idle cells must list unique Gestures; omit an empty cell")
        return value

    def members(self) -> Iterator[tuple[str, str]]:
        """Yield ``(cell, entry_id)``; ``cell`` is ``default`` or ``<emotion>-<intensity>``."""

        yield from (("default", entry_id) for entry_id in self.default)
        for emotion, levels in self.cells.items():
            for level, members in levels.items():
                yield from ((f"{emotion}-{level}", entry_id) for entry_id in members)


class PortableAnima(PortableModel):
    """Every equipment choice is explicit; only reviewed identity text is copied."""

    display_name: str = Field(min_length=1, max_length=40)
    identity_markdown: str
    avatar: EntryId
    gestures: list[PortableGestureSelection] = Field(max_length=500)
    # All 96 Reaction cells as Reaction entry-id pools of up to four; an empty list is an empty cell.
    reactions: dict[Emotion, dict[ReactionIntensityKey, ReactionPoolEntries]]
    idle: PortableIdlePool
    appearance: PortableAnimaAppearance
    # Only the active saved Pocket clone travels; provider profiles remain local.
    pocket_voice: EntryId | None = None

    @field_validator("display_name", mode="before")
    @classmethod
    def normalized_name(cls, value: str) -> str:
        if not isinstance(value, str):
            raise ValueError("Display name must be a string")
        return normalize_display_name(value)

    @field_validator("identity_markdown")
    @classmethod
    def normalized_identity(cls, value: str) -> str:
        return normalize_identity(value)

    @field_validator("gestures")
    @classmethod
    def unique_gestures(cls, value: list[PortableGestureSelection]) -> list[PortableGestureSelection]:
        if len({selection.semantic_key for selection in value}) != len(value):
            raise ValueError("Gesture semantic keys must be unique")
        return sorted(value, key=lambda selection: selection.semantic_key)

    @field_validator("reactions")
    @classmethod
    def complete_cells(cls, value: Any) -> Any:
        levels = {str(intensity) for intensity in REACTION_INTENSITIES}
        if set(value) != set(TRACKED_EMOTIONS) or any(set(cells) != levels for cells in value.values()):
            raise ValueError("All 96 Reaction cells must be explicit")
        if any(len(set(pool)) != len(pool) for cells in value.values() for pool in cells.values()):
            raise ValueError("A Reaction appears at most once in a cell")
        return value

    def reaction_members(self) -> Iterator[tuple[str, int, str]]:
        """Yield ``(emotion, intensity, entry_id)`` for every Reaction pool member."""

        for emotion, cells in self.reactions.items():
            for level, pool in cells.items():
                yield from ((emotion, int(level), entry_id) for entry_id in pool)

    def entry_references(self) -> tuple[tuple[str, ContentKind], ...]:
        """Return ordered unique typed roots, including independently selected images."""
        refs = [(self.avatar, ContentKind.AVATAR)]
        refs.extend((selection.entry_id, ContentKind.GESTURE) for selection in self.gestures)
        refs.extend((entry_id, ContentKind.REACTION) for _, _, entry_id in self.reaction_members())
        refs.extend((entry_id, ContentKind.GESTURE) for _, entry_id in self.idle.members())
        if self.pocket_voice is not None:
            refs.append((self.pocket_voice, ContentKind.VOICE))
        refs.extend(
            (selection.entry_id, ContentKind.APPEARANCE)
            for selection in (self.appearance.profile, self.appearance.background)
            if selection is not None
        )
        return tuple(dict.fromkeys(refs))
