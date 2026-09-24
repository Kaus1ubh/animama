"""HTTP models for one exact, mount-scoped Anima content runtime."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from animama.server.schemas.idle_style import PyIdleCell, PyIdlePlayback


class PyRuntimeFile(BaseModel):
    """One exact byte member prepared by the browser for this mount."""

    model_config = ConfigDict(extra="forbid")

    file_ref: str
    role: str
    ordinal: int
    filename: str
    media_type: str
    size_bytes: int
    sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    url: str


class PyRuntimeCatalogItemSource(BaseModel):
    """Catalog provenance for a mounted Included or Local entry."""

    model_config = ConfigDict(extra="forbid")

    type: Literal["catalog_item"] = "catalog_item"
    item_id: str
    source: Literal["included", "local"]
    revision: str = Field(pattern=r"^[0-9a-f]{64}$")


PyRuntimeSource = PyRuntimeCatalogItemSource


class PyRuntimeActionImplementation(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kind: Literal["anima_clip", "vrma"]
    file_role: str | None = None


class PyRuntimeAction(BaseModel):
    model_config = ConfigDict(extra="forbid")

    binding_id: str
    content_type: Literal["gesture", "reaction", "pose_clip"]
    runtime_root_id: str | None = None
    source: PyRuntimeSource
    name: str
    description: str | None = None
    semantic_key: str | None = None
    emotion: str | None = None
    intensity: int | None = None
    implementation: PyRuntimeActionImplementation
    config: dict[str, Any] = Field(default_factory=dict)
    reference_map: dict[str, str] = Field(default_factory=dict)
    files: list[PyRuntimeFile] = Field(default_factory=list)


class PyRuntimeSupport(BaseModel):
    model_config = ConfigDict(extra="forbid")

    runtime_id: str
    runtime_root_ids: list[str] = Field(default_factory=list)
    content_type: Literal[
        "particle_effect",
        "avatar_effect",
        "scene_effect",
        "sound_effect",
    ]
    source: PyRuntimeSource
    name: str
    config: dict[str, Any] = Field(default_factory=dict)
    definition: dict[str, Any] | None = None
    reference_map: dict[str, str] = Field(default_factory=dict)
    logical_resource_files: dict[str, dict[str, Any]] = Field(default_factory=dict)
    logical_resource_urls: dict[str, str] = Field(default_factory=dict)
    provenance: list[str] = Field(default_factory=list)
    files: list[PyRuntimeFile] = Field(default_factory=list)


class PyRuntimeIdleAnimation(BaseModel):
    model_config = ConfigDict(extra="forbid")

    animation_id: str
    name: str
    description: str | None = None
    playback: dict[str, Any] = Field(default_factory=dict)
    files: list[PyRuntimeFile] = Field(default_factory=list)


class PyRuntimeIdleGesture(PyRuntimeAction):
    """A complete Action admitted for idle use, never an AI-selectable Gesture."""

    content_type: Literal["gesture"] = "gesture"
    idle_playback: PyIdlePlayback


class PyRuntimeIdleStyle(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str
    runtime_root_id: str | None = None
    description: str | None = None
    source: PyRuntimeSource
    revision: str
    schema_version: Literal[1, 2] = 1
    gestures: list[PyRuntimeIdleGesture] = Field(default_factory=list)
    cells: dict[str, dict[str, PyIdleCell]] = Field(default_factory=dict)
    animations: list[PyRuntimeIdleAnimation] = Field(default_factory=list)
    default_pool: list[str]
    emotion_pools: dict[str, list[str]] = Field(default_factory=dict)
    cross_fade_seconds: float = 0.35


class PyRuntimeMusicTrack(BaseModel):
    model_config = ConfigDict(extra="forbid")

    binding_id: str
    runtime_root_id: str | None = None
    runtime_id: str
    name: str
    description: str | None = None
    source: PyRuntimeSource
    revision: str
    duration_seconds: float
    codec: str
    config: dict[str, Any]
    files: list[PyRuntimeFile] = Field(default_factory=list)


class PyRuntimeAvatar(BaseModel):
    model_config = ConfigDict(extra="forbid")

    source: PyRuntimeSource
    runtime_root_id: str | None = None
    avatar_id: str
    revision: str
    files: list[PyRuntimeFile] = Field(default_factory=list)


class PyRuntimeAppearance(BaseModel):
    model_config = ConfigDict(extra="forbid")

    binding_id: str
    runtime_root_id: str | None = None
    use: Literal["profile", "background"]
    source: PyRuntimeSource
    revision: str
    width: int
    height: int
    presentation: dict[str, Any]
    files: list[PyRuntimeFile] = Field(default_factory=list)


class PyRuntimeContentMember(BaseModel):
    model_config = ConfigDict(extra="forbid")

    file_ref: str
    item_id: str
    role: str
    filename: str
    media_type: str
    size_bytes: int = Field(gt=0)
    sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    url: str


class PyRuntimeContentEntry(BaseModel):
    model_config = ConfigDict(extra="forbid")

    item_id: str
    kind: str
    display_name: str
    revision_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    logical_key: str | None = None
    member_refs: list[str] = Field(default_factory=list)


class PyRuntimeContentRoot(BaseModel):
    model_config = ConfigDict(extra="forbid")

    root_id: str
    slot_key: str
    item_id: str
    kind: str
    revision_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    entry_ids: list[str] = Field(default_factory=list)
    member_refs: list[str] = Field(default_factory=list)


class PyRuntimeContentDiagnostic(BaseModel):
    model_config = ConfigDict(extra="forbid")

    root_id: str
    slot_key: str
    code: str
    message: str
    item_id: str | None = None


class PyRuntimeContentDescriptor(BaseModel):
    model_config = ConfigDict(extra="forbid")

    schema_version: int = 2
    revision: str
    admitted_item_revisions: dict[str, str] = Field(default_factory=dict)
    total_bytes: int = Field(ge=0)
    roots: list[PyRuntimeContentRoot] = Field(default_factory=list)
    entries: list[PyRuntimeContentEntry] = Field(default_factory=list)
    members: list[PyRuntimeContentMember] = Field(default_factory=list)
    diagnostics: list[PyRuntimeContentDiagnostic] = Field(default_factory=list)


class PyRuntimeWarning(BaseModel):
    model_config = ConfigDict(extra="forbid")

    code: str
    message: str
    scope: str


class PyRuntimeJsonBundle(BaseModel):
    """Optional delivery hint; original descriptor members remain the integrity authority."""

    model_config = ConfigDict(extra="forbid")

    version: Literal[1] = 1
    url: str
    file_refs: list[str] = Field(min_length=2, max_length=256)
    total_bytes: int = Field(gt=0, le=2 * 1024 * 1024)


class PyAnimaRuntime(BaseModel):
    """Prepared catalog projection and exact descriptor for one mount."""

    model_config = ConfigDict(extra="forbid")

    catalog_version: int = 4
    loadout_revision: int
    effective_revision: str
    lease_expires_at: datetime
    can_chat: bool = True
    content_descriptor: PyRuntimeContentDescriptor
    json_bundle: PyRuntimeJsonBundle | None = None
    gestures: list[PyRuntimeAction] = Field(default_factory=list)
    poses: list[PyRuntimeAction] = Field(default_factory=list)
    reactions: list[PyRuntimeAction] = Field(default_factory=list)
    idle_style: PyRuntimeIdleStyle | None = None
    music_tracks: list[PyRuntimeMusicTrack] = Field(default_factory=list)
    avatar: PyRuntimeAvatar | None = None
    appearances: list[PyRuntimeAppearance] = Field(default_factory=list)
    particle_effects: list[PyRuntimeSupport] = Field(default_factory=list)
    avatar_effects: list[PyRuntimeSupport] = Field(default_factory=list)
    scene_effects: list[PyRuntimeSupport] = Field(default_factory=list)
    sound_effects: list[PyRuntimeSupport] = Field(default_factory=list)
    warnings: list[PyRuntimeWarning] = Field(default_factory=list)


class PyRuntimeLease(BaseModel):
    model_config = ConfigDict(extra="forbid")

    effective_revision: str
    expires_at: datetime


__all__ = [name for name in globals() if name.startswith("Py")]
