"""Generated HTTP contracts for strict private Anima creation (not Blueprints)."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from animama.app.anima_creation_contract import (
    AnimaSpec,
    GestureSelection,
    ItemRevisionRef,
    ReactionMatrix,
    SourceRevision,
    StarterId,
    StarterPackIdentity,
)


class CreationResponseModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class AnimaCreationDiagnostic(CreationResponseModel):
    code: str
    message: str
    path: str
    item_id: str | None = None
    declaring_action_item_id: str | None = None
    expected_revision_sha256: str | None = None
    current_revision_sha256: str | None = None


class AnimaCreationErrorDetail(CreationResponseModel):
    code: str
    message: str
    retryable: bool
    issues: list[AnimaCreationDiagnostic] = Field(max_length=100)


class AnimaCreationErrorResponse(CreationResponseModel):
    detail: AnimaCreationErrorDetail


class AnimaCreationResult(CreationResponseModel):
    schema_version: Literal[1]
    anima_id: str
    aggregate_revision: Literal[1]
    identity_version: Literal[1]
    loadout_revision: Literal[1]
    idempotent_replay: bool
    warnings: list[AnimaCreationDiagnostic]


class AnimaValidationResult(CreationResponseModel):
    schema_version: Literal[1]
    spec: AnimaSpec
    warnings: list[AnimaCreationDiagnostic]


class AnimaCreationLimits(CreationResponseModel):
    display_name_max_characters: int
    identity_max_bytes: int
    avatar_max_bytes: int
    image_max_bytes: int
    image_max_dimension: int
    image_max_pixels: int
    source_max_items: int
    source_max_bytes: int
    runtime_config_max_bytes: int


class RecommendedAnimaActions(CreationResponseModel):
    gestures: list[GestureSelection]
    reactions: ReactionMatrix


class AnimaCreationCounts(CreationResponseModel):
    recommended_gestures: int
    recommended_reaction_cells: int
    available_gestures: int
    available_reaction_cells: int


class AnimaCreationDefaultIdle(CreationResponseModel):
    source: ItemRevisionRef | None
    expected_source_revisions: dict[str, SourceRevision]


class AnimaCreationOptions(CreationResponseModel):
    schema_version: Literal[1]
    limits: AnimaCreationLimits
    starter_pack: StarterPackIdentity
    recommended: RecommendedAnimaActions
    counts: AnimaCreationCounts
    default_idle: AnimaCreationDefaultIdle
    expected_source_revisions: dict[str, SourceRevision]
    diagnostics: list[AnimaCreationDiagnostic]


class AnimaStarterResult(CreationResponseModel):
    starter_id: StarterId
    spec_version: int
    anima_id: str | None
    outcome: Literal["created", "existing", "adopted", "deleted", "repair_required"]
    diagnostics: list[AnimaCreationDiagnostic]


class EnsureAnimaStartersResult(CreationResponseModel):
    schema_version: Literal[1]
    complete: bool
    starters: list[AnimaStarterResult]
