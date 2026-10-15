"""Generated-client contracts for typed catalog-backed Anima loadouts."""

from __future__ import annotations

from typing import Any, Literal, cast

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from animama.domain.anima_loadout import (
    AnimaLoadout,
    AppearanceBinding,
    CatalogLoadoutSource,
    GestureBinding,
    IdleCell,
    IdleMember,
    IdlePool,
    LoadoutCommitResult,
    LoadoutDiagnostic,
    LoadoutPlan,
    ReactionCell,
)
from animama.domain.emotions import TRACKED_EMOTIONS


class PyCatalogLoadoutSource(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: Literal["catalog"] = "catalog"
    catalog_item_id: str
    source: Literal["included", "local"]
    logical_key: str | None = None

    @classmethod
    def from_domain(cls, value: CatalogLoadoutSource) -> PyCatalogLoadoutSource:
        return cls(
            catalog_item_id=value.catalog_item_id,
            source=value.source.value,
            logical_key=value.logical_key,
        )


class PyLoadoutDiagnostic(BaseModel):
    """A Loadout warning; clients word it from ``code`` and ``params``."""

    model_config = ConfigDict(extra="forbid")

    code: str
    message: str = Field(description="English detail for logs and API clients.")
    scope: Literal["source", "target"] = "target"
    params: dict[str, str] = Field(default_factory=dict, description="Values for the code's wording.")

    @classmethod
    def from_domain(cls, value: LoadoutDiagnostic) -> PyLoadoutDiagnostic:
        return cls(code=value.code, message=value.message, scope=value.scope, params=dict(value.params))


class PyGestureIntent(BaseModel):
    """One reviewed Gesture mutation; support content cannot be targeted."""

    model_config = ConfigDict(extra="forbid")

    operation: Literal[
        "add",
        "update",
        "reconfigure",
        "remove",
        "disable_starter",
        "restore_starter",
    ]
    source: PyCatalogLoadoutSource | None = None
    binding_id: str | None = None
    starter_id: str | None = None
    config_overrides: dict[str, Any] = Field(default_factory=dict)

    @model_validator(mode="after")
    def validate_target(self) -> PyGestureIntent:
        if self.operation in {"add", "update", "reconfigure"} and self.source is None:
            raise ValueError("source is required")
        if self.operation in {"update", "reconfigure", "remove"} and not self.binding_id:
            raise ValueError("binding_id is required")
        if self.operation in {"disable_starter", "restore_starter"} and not self.starter_id:
            raise ValueError("starter_id is required")
        return self


class PyReactionIntent(BaseModel):
    model_config = ConfigDict(extra="forbid")

    operation: Literal["add", "replace", "update", "reconfigure", "revert", "leave_empty"]
    emotion: str = Field(min_length=1, max_length=64)
    intensity: Literal[1, 2, 3]
    source: PyCatalogLoadoutSource | None = None
    config_overrides: dict[str, Any] = Field(default_factory=dict)

    @field_validator("emotion")
    @classmethod
    def canonical_emotion(cls, value: str) -> str:
        if value not in TRACKED_EMOTIONS:
            raise ValueError("emotion must be a canonical tracked emotion")
        return value

    @model_validator(mode="after")
    def validate_source(self) -> PyReactionIntent:
        if self.operation in {"add", "replace", "update", "reconfigure"} and self.source is None:
            raise ValueError("source is required")
        return self


class PyIdleIntent(BaseModel):
    """Add a Gesture to one cell of the Anima's Idle pool, or remove one member.

    ``add`` takes the Gesture ``source`` and the cell; omit ``emotion`` and
    ``intensity`` for the Default pool. ``remove`` takes the member's
    ``binding_id``, so an unavailable member can be removed too. The pool itself
    always exists; no operation removes or replaces it as a whole.
    """

    model_config = ConfigDict(extra="forbid")

    operation: Literal["add", "remove"]
    emotion: str | None = Field(default=None, min_length=1, max_length=64)
    intensity: Literal[1, 2, 3] | None = None
    source: PyCatalogLoadoutSource | None = None
    binding_id: str | None = Field(default=None, min_length=1, max_length=128)

    @field_validator("emotion")
    @classmethod
    def canonical_emotion(cls, value: str | None) -> str | None:
        if value is not None and value not in TRACKED_EMOTIONS:
            raise ValueError("emotion must be a canonical tracked emotion")
        return value

    @model_validator(mode="after")
    def operation_fields(self) -> PyIdleIntent:
        if self.operation == "add":
            if self.source is None or self.binding_id is not None:
                raise ValueError("add takes a source and no binding_id")
            if (self.emotion is None) != (self.intensity is None):
                raise ValueError("emotion and intensity must be given together")
        elif self.binding_id is None or self.source is not None or self.emotion or self.intensity:
            raise ValueError("remove takes only a binding_id")
        return self


class LegacyMusicTrackIntent(BaseModel):
    """Decode the original Music command solely for committed-receipt replay."""

    model_config = ConfigDict(extra="forbid")

    operation: Literal["add", "update", "reconfigure", "remove"]
    binding_id: str | None = None
    source: PyCatalogLoadoutSource | None = None
    enabled: bool = True
    autoplay: bool = False
    loop: bool | None = None
    gain: float | None = Field(default=None, ge=0, le=2)

    @model_validator(mode="after")
    def validate_target(self) -> LegacyMusicTrackIntent:
        if self.operation in {"update", "reconfigure", "remove"} and not self.binding_id:
            raise ValueError("binding_id is required")
        if self.operation != "remove" and self.source is None:
            raise ValueError("source is required")
        if self.operation == "remove" and self.source is not None:
            raise ValueError("remove does not accept source")
        if self.autoplay and not self.enabled:
            raise ValueError("autoplay requires an enabled track")
        return self


class LegacyMusicTrackCommitRequest(BaseModel):
    """Keep historical defaults and null omission stable for the original digest."""

    model_config = ConfigDict(extra="forbid")

    expected_revision: int = Field(ge=1)
    intent: LegacyMusicTrackIntent
    plan_digest: str = Field(pattern=r"^[0-9a-f]{64}$")
    idempotency_key: str = Field(min_length=1, max_length=128)


class PySingleSelectionIntent(BaseModel):
    model_config = ConfigDict(extra="forbid")

    operation: Literal["set", "remove"]
    source: PyCatalogLoadoutSource | None = None
    config: dict[str, Any] = Field(default_factory=dict)

    @model_validator(mode="after")
    def validate_source(self) -> PySingleSelectionIntent:
        if self.operation == "set" and self.source is None:
            raise ValueError("source is required")
        if self.operation == "remove" and self.source is not None:
            raise ValueError("remove does not accept source")
        return self


class PyAppearanceIntent(PySingleSelectionIntent):
    use: Literal["profile", "background"]


class PyGesturePlanRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expected_revision: int = Field(ge=1)
    intent: PyGestureIntent


class PyReactionPlanRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expected_revision: int = Field(ge=1)
    intent: PyReactionIntent


class PyIdlePlanRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expected_revision: int = Field(ge=1)
    intent: PyIdleIntent


class PySingleSelectionPlanRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expected_revision: int = Field(ge=1)
    intent: PySingleSelectionIntent


class PyAppearancePlanRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expected_revision: int = Field(ge=1)
    intent: PyAppearanceIntent


class PyGestureCommitRequest(PyGesturePlanRequest):
    plan_digest: str = Field(pattern=r"^[0-9a-f]{64}$")
    idempotency_key: str = Field(min_length=1, max_length=128)


class PyReactionCommitRequest(PyReactionPlanRequest):
    plan_digest: str = Field(pattern=r"^[0-9a-f]{64}$")
    idempotency_key: str = Field(min_length=1, max_length=128)


class PyIdleCommitRequest(PyIdlePlanRequest):
    plan_digest: str = Field(pattern=r"^[0-9a-f]{64}$")
    idempotency_key: str = Field(min_length=1, max_length=128)


class PySingleSelectionCommitRequest(PySingleSelectionPlanRequest):
    plan_digest: str = Field(pattern=r"^[0-9a-f]{64}$")
    idempotency_key: str = Field(min_length=1, max_length=128)


class PyAppearanceCommitRequest(PyAppearancePlanRequest):
    plan_digest: str = Field(pattern=r"^[0-9a-f]{64}$")
    idempotency_key: str = Field(min_length=1, max_length=128)


class PyLoadoutPlan(BaseModel):
    model_config = ConfigDict(extra="forbid")
    aggregate_revision: int = Field(ge=1)

    action: Literal["add", "update", "replace", "remove", "revert", "leave_empty", "unchanged"]
    plan_digest: str = Field(pattern=r"^[0-9a-f]{64}$")
    current_name: str | None = None
    target_name: str | None = None
    included_resource_counts: dict[str, int] = Field(default_factory=dict)
    final_gesture_count: int = Field(ge=0)
    warnings: list[PyLoadoutDiagnostic] = Field(default_factory=list)

    @classmethod
    def from_domain(cls, value: LoadoutPlan) -> PyLoadoutPlan:
        return cls(
            aggregate_revision=value.aggregate_revision,
            action=value.action,
            plan_digest=value.digest,
            current_name=value.current_name,
            target_name=value.target_name,
            included_resource_counts=value.included_resource_counts,
            final_gesture_count=value.final_gesture_count,
            warnings=[PyLoadoutDiagnostic.from_domain(item) for item in value.warnings],
        )


class PyLoadoutCommitResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    anima_id: str
    revision: int = Field(ge=1)
    action: str
    idempotent_replay: bool = False
    aggregate_revision: int | None = Field(None, ge=1)

    @classmethod
    def from_domain(cls, value: LoadoutCommitResult) -> PyLoadoutCommitResult:
        return cls(
            anima_id=value.anima_id,
            revision=value.revision,
            action=value.action,
            idempotent_replay=value.idempotent_replay,
            aggregate_revision=value.aggregate_revision,
        )


class PyGestureBinding(BaseModel):
    model_config = ConfigDict(extra="forbid")

    binding_id: str
    name: str
    description: str | None = None
    semantic_key: str
    origin: Literal["starter", "custom"]
    implementation_kind: Literal["anima_clip", "vrma"]
    logical_item_id: str | None = None
    source: PyCatalogLoadoutSource
    config_overrides: dict[str, Any] = Field(default_factory=dict)

    @classmethod
    def from_domain(cls, value: GestureBinding) -> PyGestureBinding:
        return cls(
            binding_id=value.binding_id,
            name=value.name,
            description=value.description,
            semantic_key=value.semantic_key,
            origin=value.origin,
            implementation_kind=value.implementation_kind,
            logical_item_id=value.source.logical_key,
            source=PyCatalogLoadoutSource.from_domain(value.source),
            config_overrides=value.config_overrides,
        )


class PyReactionCell(BaseModel):
    model_config = ConfigDict(extra="forbid")

    emotion: str
    intensity: Literal[1, 2, 3]
    state: Literal["starter", "custom", "empty"]
    binding_id: str | None = None
    logical_item_id: str | None = None
    name: str | None = None
    source: PyCatalogLoadoutSource | None = None
    config_overrides: dict[str, Any] = Field(default_factory=dict)

    @classmethod
    def from_domain(cls, value: ReactionCell) -> PyReactionCell:
        return cls(
            emotion=value.emotion,
            intensity=value.intensity,
            state=value.state,
            binding_id=value.binding_id,
            logical_item_id=value.source.logical_key if value.source else None,
            name=value.name,
            source=PyCatalogLoadoutSource.from_domain(value.source) if value.source else None,
            config_overrides=value.config_overrides,
        )


class PyIdleMember(BaseModel):
    """One Gesture in the Idle pool; ``available`` is false when its catalog item is missing or invalid."""

    model_config = ConfigDict(extra="forbid")

    binding_id: str
    item_id: str
    name: str
    description: str | None = None
    available: bool
    source: PyCatalogLoadoutSource | None = None

    @classmethod
    def from_domain(cls, value: IdleMember) -> PyIdleMember:
        return cls(
            binding_id=value.binding_id,
            item_id=value.item_id,
            name=value.name,
            description=value.description,
            available=value.available,
            source=PyCatalogLoadoutSource.from_domain(value.source) if value.source else None,
        )


class PyIdleCell(BaseModel):
    """One emotion/intensity cell; higher intensities also play it, and Default is always mixed in."""

    model_config = ConfigDict(extra="forbid")

    emotion: str
    intensity: Literal[1, 2, 3]
    gestures: list[PyIdleMember] = Field(default_factory=list)

    @classmethod
    def from_domain(cls, value: IdleCell) -> PyIdleCell:
        return cls(
            emotion=value.emotion,
            intensity=cast(Literal[1, 2, 3], value.intensity),
            gestures=[PyIdleMember.from_domain(item) for item in value.gestures],
        )


class PyAnimaIdle(BaseModel):
    """The Anima's built-in Idle pool: Default plus all 72 emotion/intensity cells."""

    model_config = ConfigDict(extra="forbid")

    default_pool: list[PyIdleMember] = Field(default_factory=list)
    cells: list[PyIdleCell] = Field(default_factory=list)

    @classmethod
    def from_domain(cls, value: IdlePool) -> PyAnimaIdle:
        return cls(
            default_pool=[PyIdleMember.from_domain(item) for item in value.default_pool],
            cells=[PyIdleCell.from_domain(cell) for cell in value.cells],
        )


class PyAnimaAppearance(BaseModel):
    model_config = ConfigDict(extra="forbid")

    binding_id: str
    use: Literal["profile", "background"]
    item_id: str
    name: str
    source: PyCatalogLoadoutSource
    width: int | None = None
    height: int | None = None
    presentation: dict[str, Any] = Field(default_factory=dict)

    @classmethod
    def from_domain(cls, value: AppearanceBinding) -> PyAnimaAppearance:
        return cls(
            binding_id=value.binding_id,
            use=value.use,
            item_id=value.item_id,
            name=value.name,
            source=PyCatalogLoadoutSource.from_domain(value.source),
            width=value.width,
            height=value.height,
            presentation=value.presentation,
        )


class PyAnimaLoadout(BaseModel):
    model_config = ConfigDict(extra="forbid")

    anima_id: str
    revision: int = Field(ge=1)
    aggregate_revision: int = Field(ge=1)
    starter_version: int = Field(ge=1)
    gestures: list[PyGestureBinding]
    disabled_starter_gestures: list[str]
    starter_gesture_implementation_kinds: dict[str, Literal["anima_clip", "vrma"]] = Field(default_factory=dict)
    reactions: list[PyReactionCell]
    idle: PyAnimaIdle
    avatar_source: PyCatalogLoadoutSource | None = None
    appearances: list[PyAnimaAppearance] = Field(default_factory=list)
    voice_source: PyCatalogLoadoutSource | None = None
    warnings: list[PyLoadoutDiagnostic] = Field(default_factory=list)

    @classmethod
    def from_domain(
        cls,
        value: AnimaLoadout,
        *,
        starter_implementation_kinds: dict[str, Literal["anima_clip", "vrma"]] | None = None,
    ) -> PyAnimaLoadout:
        return cls(
            anima_id=value.anima_id,
            revision=value.revision,
            aggregate_revision=value.aggregate_revision,
            starter_version=value.starter_version,
            gestures=[PyGestureBinding.from_domain(item) for item in value.gestures],
            disabled_starter_gestures=list(value.disabled_starter_gestures),
            starter_gesture_implementation_kinds=starter_implementation_kinds or {},
            reactions=[PyReactionCell.from_domain(item) for item in value.reactions],
            idle=PyAnimaIdle.from_domain(value.idle),
            avatar_source=(PyCatalogLoadoutSource.from_domain(value.avatar_source) if value.avatar_source else None),
            appearances=[PyAnimaAppearance.from_domain(item) for item in value.appearances],
            voice_source=(PyCatalogLoadoutSource.from_domain(value.voice_source) if value.voice_source else None),
            warnings=[PyLoadoutDiagnostic.from_domain(item) for item in value.warnings],
        )


__all__ = [name for name in globals() if name.startswith("Py")]
