"""Strict private creation commands and pure, state-independent normalization.

These application inputs are not catalog documents or portable Blueprints.
Configured limits and catalog/default validation run only after receipt replay.
"""

from __future__ import annotations

import hashlib
import json
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from animama.domain.anima_definition import (
    ANIMA_DISPLAY_NAME_MAX_CHARACTERS,
    normalize_display_name,
    normalize_identity,
)
from animama.domain.emotions import TRACKED_EMOTIONS

ItemId = Annotated[str, Field(min_length=1, max_length=128, pattern=r"^[A-Za-z0-9][A-Za-z0-9:_-]*$")]
RevisionSha256 = Annotated[str, Field(pattern=r"^[0-9a-f]{64}$")]
IdempotencyKey = Annotated[str, Field(min_length=1, max_length=128, pattern=r"^[A-Za-z0-9][A-Za-z0-9._:-]*$")]
SemanticKey = Annotated[str, Field(pattern=r"^[a-z0-9][a-z0-9._-]{0,127}$")]
SourceKind = Literal[
    "voice",
    "avatar",
    "appearance",
    "gesture",
    "reaction",
    "idle_style",
    "pose",
    "particle_effect",
    "avatar_effect",
    "scene_effect",
    "sound_effect",
]
Emotion = Literal[
    "admiration",
    "caring",
    "love",
    "respect",
    "confidence",
    "gratitude",
    "amusement",
    "excitement",
    "joy",
    "desire",
    "curiosity",
    "optimism",
    "fear",
    "nervousness",
    "confusion",
    "anger",
    "annoyance",
    "disapproval",
    "disgust",
    "embarrassment",
    "remorse",
    "disappointment",
    "grief",
    "sadness",
]


class StrictCreationModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, allow_inf_nan=False)

    @field_validator("schema_version", "version", check_fields=False, mode="before")
    @classmethod
    def strict_version(cls, value: Any) -> Any:
        """Literal integers must not accept JSON booleans or floating-point 1."""

        if type(value) is not int:
            raise ValueError("Version must be an integer")
        return value


class ItemRevisionRef(StrictCreationModel):
    item_id: ItemId
    revision_sha256: RevisionSha256


class SourceRevision(StrictCreationModel):
    kind: SourceKind
    revision_sha256: RevisionSha256


class ImagePresentation(StrictCreationModel):
    fit: Literal["cover", "contain"]
    focal_x: float = Field(ge=0, le=1)
    focal_y: float = Field(ge=0, le=1)
    zoom: float = Field(ge=1, le=4)


class AppearanceChoice(StrictCreationModel):
    source: ItemRevisionRef
    presentation: ImagePresentation


class AnimaAppearance(StrictCreationModel):
    profile: AppearanceChoice | None
    background: AppearanceChoice | None


class GestureSelection(StrictCreationModel):
    semantic_key: SemanticKey
    source: ItemRevisionRef


class StarterPackIdentity(StrictCreationModel):
    id: Literal["builtin:starter-loadout"]
    version: Literal[1]
    revision_sha256: RevisionSha256


ReactionCells = dict[Literal["1", "2", "3"], ItemRevisionRef | None]
ReactionMatrix = dict[Emotion, ReactionCells]


class CreationPocketPreset(StrictCreationModel):
    type: Literal["preset"]
    voice_id: str = Field(pattern=r"^[a-z][a-z0-9_-]{0,127}$")


class CreationPocketClone(StrictCreationModel):
    type: Literal["clone"]
    source: ItemRevisionRef


class CreationVoice(StrictCreationModel):
    """Both provider choices persist; only the selected provider needs a usable ID."""

    provider: Literal["pocket_tts", "elevenlabs"]
    pocket: Annotated[CreationPocketPreset | CreationPocketClone, Field(discriminator="type")]
    elevenlabs_voice_id: Annotated[str, Field(pattern=r"^[A-Za-z0-9_-]{1,128}$")] | None

    @model_validator(mode="after")
    def require_active_voice(self) -> CreationVoice:
        if self.provider == "elevenlabs" and self.elevenlabs_voice_id is None:
            raise ValueError("Enter an ElevenLabs voice ID")
        return self


class _AnimaSpecFields(StrictCreationModel):
    """Explicit creation choices; legacy voice omission retains its original default."""

    schema_version: Literal[1]
    display_name: str = Field(min_length=1, max_length=ANIMA_DISPLAY_NAME_MAX_CHARACTERS)
    identity_markdown: str
    avatar: ItemRevisionRef
    # Omission preserves pre-voice commands and their exact receipt hashes.
    voice: CreationVoice | None = None
    appearance: AnimaAppearance
    gestures: list[GestureSelection] = Field(max_length=500)
    reactions: ReactionMatrix
    starter_pack: StarterPackIdentity

    @field_validator("display_name", mode="before")
    @classmethod
    def normalize_name(cls, value: str) -> str:
        return normalize_display_name(value)

    @field_validator("identity_markdown")
    @classmethod
    def normalize_markdown(cls, value: str) -> str:
        return normalize_identity(value)

    @field_validator("gestures")
    @classmethod
    def unique_gestures(cls, values: list[GestureSelection]) -> list[GestureSelection]:
        if len({value.semantic_key for value in values}) != len(values):
            raise ValueError("Gesture semantic keys must be unique")
        return sorted(values, key=lambda value: value.semantic_key)

    @field_validator("reactions")
    @classmethod
    def complete_reactions(cls, value: ReactionMatrix) -> ReactionMatrix:
        if set(value) != set(TRACKED_EMOTIONS) or any(set(cells) != {"1", "2", "3"} for cells in value.values()):
            raise ValueError("All 24 emotions and all 72 Reaction cells must be explicit")
        return value


class AnimaSpec(_AnimaSpecFields):
    """New creation commands can reference only currently supported content."""

    expected_source_revisions: dict[ItemId, SourceRevision] = Field(max_length=500)


class LegacySourceRevision(StrictCreationModel):
    """Private receipt input retained for exact pre-retirement retries."""

    kind: Literal["pose_clip"]
    revision_sha256: RevisionSha256


class LegacyAnimaSpec(_AnimaSpecFields):
    """Decode old source maps without admitting them as new creation commands."""

    expected_source_revisions: dict[ItemId, SourceRevision | LegacySourceRevision] = Field(max_length=500)


class LegacyCreateAnimaRequest(LegacyAnimaSpec):
    idempotency_key: IdempotencyKey

    def spec(self) -> LegacyAnimaSpec:
        """Preserve the exact normalized legacy digest before checking a receipt."""

        return LegacyAnimaSpec.model_validate(self.model_dump(exclude={"idempotency_key"}))


class CreateAnimaRequest(AnimaSpec):
    idempotency_key: IdempotencyKey

    def spec(self) -> AnimaSpec:
        """Drop only the key, keeping normalized nulls and exact source choices."""

        return AnimaSpec.model_validate(self.model_dump(exclude={"idempotency_key"}))


def canonical_spec_hash(spec: AnimaSpec | LegacyAnimaSpec) -> str:
    """Hash normalized input, independent of key, owner and live source state."""

    def normalize_numbers(value: Any) -> Any:
        if isinstance(value, float) and value.is_integer():
            return int(value)
        if isinstance(value, dict):
            return {key: normalize_numbers(item) for key, item in value.items()}
        if isinstance(value, list):
            return [normalize_numbers(item) for item in value]
        return value

    encoded = json.dumps(
        normalize_numbers(spec.model_dump(exclude={"voice"} if spec.voice is None else set())),
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
        allow_nan=False,
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


StarterId = Literal["starter:annie", "starter:caitlyn"]


class AdoptStarterRepair(StrictCreationModel):
    starter_id: StarterId
    action: Literal["adopt"]
    anima_id: ItemId


class CreateMissingStarterRepair(StrictCreationModel):
    starter_id: StarterId
    action: Literal["create_missing"]


StarterRepair = Annotated[AdoptStarterRepair | CreateMissingStarterRepair, Field(discriminator="action")]


class EnsureAnimaStartersRequest(StrictCreationModel):
    schema_version: Literal[1]
    repairs: list[StarterRepair] = Field(max_length=2)

    @field_validator("repairs")
    @classmethod
    def unique_repairs(cls, values: list[StarterRepair]) -> list[StarterRepair]:
        if len({value.starter_id for value in values}) != len(values):
            raise ValueError("Each starter may have only one repair")
        return values
