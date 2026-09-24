"""Versioned product documents stored above the neutral Content Catalog.

The catalog deliberately knows only identities, files, revisions, and edges.
These records describe the product meaning of those files without importing
FastAPI, Pydantic, SQLAlchemy, or filesystem adapters.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal

from .content_catalog import ContentKind


@dataclass(frozen=True, slots=True)
class ContentFileDeclarationV1:
    """One descriptor-relative file and its handler-approved semantic role."""

    path: str
    role: str


@dataclass(frozen=True, slots=True)
class ContentDependencyV1:
    """One typed, portable edge to another logical content item."""

    ref: str
    kind: ContentKind
    alias: str | None = None
    config: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class ContentDocumentV1:
    """Fields shared by all schema-version-one portable product documents."""

    kind: ContentKind
    name: str
    content_id: str | None = None
    description: str | None = None
    version: int = 1
    schema_version: int = 1
    files: tuple[ContentFileDeclarationV1, ...] = ()
    dependencies: tuple[ContentDependencyV1, ...] = ()
    provenance: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class ActionImplementationV1:
    """Playback implementation selected by a Gesture or Reaction document."""

    kind: Literal["anima_clip", "vrma"]
    file_role: str | None = None
    content_dependency_ref: str | None = None


@dataclass(frozen=True, slots=True)
class GestureDocumentV1(ContentDocumentV1):
    """Editable Gesture identity and its dependency-complete Action root."""

    semantic_key: str = "gesture"
    implementation: ActionImplementationV1 = field(
        default_factory=lambda: ActionImplementationV1(kind="vrma", file_role="animation")
    )
    config: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class ReactionDocumentV1(ContentDocumentV1):
    """Editable Reaction with an optional suggested emotion/intensity placement."""

    emotion: str | None = None
    intensity: int | None = None
    implementation: ActionImplementationV1 = field(
        default_factory=lambda: ActionImplementationV1(kind="anima_clip", file_role="sequence")
    )
    config: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class PoseDocumentV1(ContentDocumentV1):
    """Self-contained static humanoid/expression state, with no live parents."""

    pose: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class PoseClipDocumentV1(ContentDocumentV1):
    """A validated animaPoseClip document used by Actions and Idle Styles."""

    clip_id: str = "pose"
    role: str | None = None
    playback: dict[str, Any] = field(default_factory=dict)
    poses: dict[str, Any] = field(default_factory=dict)
    pose_keyframes: tuple[dict[str, Any], ...] = ()
    clip: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class ParticleEffectDocumentV1(ContentDocumentV1):
    """Particle effect configuration plus its registered manifest/resources."""

    runtime_defaults: dict[str, Any] = field(default_factory=dict)
    definition: dict[str, Any] | None = None


@dataclass(frozen=True, slots=True)
class AvatarEffectDocumentV1(ContentDocumentV1):
    """Avatar-attached visual effect backed by an app engine or registered files."""

    technical_source: dict[str, Any] | None = None
    runtime_defaults: dict[str, Any] = field(default_factory=dict)
    definition: dict[str, Any] | None = None


@dataclass(frozen=True, slots=True)
class SceneEffectDocumentV1(ContentDocumentV1):
    """Scene visual effect backed by an app engine or registered files."""

    technical_source: dict[str, Any] | None = None
    runtime_defaults: dict[str, Any] = field(default_factory=dict)
    definition: dict[str, Any] | None = None


@dataclass(frozen=True, slots=True)
class SoundEffectDocumentV1(ContentDocumentV1):
    """Short audio effect used transitively by an Action or visual effect."""

    duration_seconds: float | None = None
    codec: str | None = None
    defaults: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class IdleAnimationDocumentV1:
    """One registered animation lane contained by an Idle Style."""

    animation_id: str
    name: str
    description: str | None = None
    file_ref: str | None = None
    dependency_ref: str | None = None
    playback: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class IdleStyleDocumentV1(ContentDocumentV1):
    """Emotion-aware idle animation pools and cross-fade behavior."""

    animations: tuple[IdleAnimationDocumentV1, ...] = ()
    default_pool: tuple[str, ...] = ()
    emotion_pools: dict[str, tuple[str, ...]] = field(default_factory=dict)
    cross_fade_seconds: float = 0.35
    compatibility: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class IdleStyleCellV2:
    """An explicit cell; an omitted cell inherits the Style's Default pool."""

    mode: Literal["none", "pool"]
    gestures: tuple[str, ...] = ()


@dataclass(frozen=True, slots=True)
class IdleStyleDocumentV2(ContentDocumentV1):
    """Style-owned pools of complete Gesture dependencies, with no Anima overrides."""

    schema_version: int = 2
    default_pool: tuple[str, ...] = ()
    cells: dict[str, dict[str, IdleStyleCellV2]] = field(default_factory=dict)
    compatibility: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class MusicTrackDocumentV1(ContentDocumentV1):
    """Background track metadata and safe default playback controls."""

    duration_seconds: float = 0.0
    codec: str = "unknown"
    loop: bool = True
    gain: float = 1.0
    autoplay: bool = False


@dataclass(frozen=True, slots=True)
class AvatarDocumentV1(ContentDocumentV1):
    """Portable VRM avatar model metadata."""

    model_role: str = "model"
    compatibility: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class AppearanceDocumentV1(ContentDocumentV1):
    """Portable image presentation material such as portraits/backgrounds."""

    width: int | None = None
    height: int | None = None
    avatar_model: str | None = None
    presentation: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class VoiceDocumentV1(ContentDocumentV1):
    """Portable voice material; provider credentials/config are never included."""

    codec: str | None = None
    language: str | None = None
    sample_rate_hz: int | None = None
    voices: tuple[str, ...] = ()


type TypedContentDocument = (
    GestureDocumentV1
    | ReactionDocumentV1
    | PoseDocumentV1
    | PoseClipDocumentV1
    | ParticleEffectDocumentV1
    | AvatarEffectDocumentV1
    | SceneEffectDocumentV1
    | SoundEffectDocumentV1
    | IdleStyleDocumentV1
    | IdleStyleDocumentV2
    | MusicTrackDocumentV1
    | AvatarDocumentV1
    | AppearanceDocumentV1
    | VoiceDocumentV1
)


class ContentDocumentError(ValueError):
    """A product document cannot be admitted by its registered type handler."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


__all__ = [
    "IdleStyleCellV2",
    "IdleStyleDocumentV2",
    "ActionImplementationV1",
    "AppearanceDocumentV1",
    "AvatarDocumentV1",
    "AvatarEffectDocumentV1",
    "ContentDependencyV1",
    "ContentDocumentError",
    "ContentDocumentV1",
    "ContentFileDeclarationV1",
    "GestureDocumentV1",
    "IdleAnimationDocumentV1",
    "IdleStyleDocumentV1",
    "MusicTrackDocumentV1",
    "ParticleEffectDocumentV1",
    "PoseDocumentV1",
    "PoseClipDocumentV1",
    "ReactionDocumentV1",
    "SceneEffectDocumentV1",
    "SoundEffectDocumentV1",
    "TypedContentDocument",
    "VoiceDocumentV1",
]
