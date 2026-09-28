"""Framework-neutral records for the readable self-hosted content library."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from pathlib import Path
from typing import Any, BinaryIO


class ContentSource(str, Enum):
    """Physical library partition containing a catalog entry."""

    INCLUDED = "included"
    LOCAL = "local"


class ContentScope(str, Enum):
    """Authorization scope attached by the catalog, never inferred from a path."""

    INCLUDED = "included"
    OWNER = "owner"
    INSTALLATION_SHARED = "installation_shared"


class ContentStatus(str, Enum):
    """Current authoritative scan state for one logical entry."""

    VALID = "valid"
    INVALID = "invalid"
    MISSING = "missing"
    SCAN_REQUIRED = "scan_required"


class ContentKind(str, Enum):
    """Readable-library content kinds and their runtime ownership boundaries."""

    AVATAR = "avatar"
    GESTURE = "gesture"
    POSE = "pose"
    POSE_CLIP = "pose_clip"
    REACTION = "reaction"
    PARTICLE_EFFECT = "particle_effect"
    AVATAR_EFFECT = "avatar_effect"
    SCENE_EFFECT = "scene_effect"
    SOUND_EFFECT = "sound_effect"
    IDLE_STYLE = "idle_style"
    MUSIC_TRACK = "music_track"
    APPEARANCE = "appearance"
    VOICE = "voice"
    ANIMA = "anima"


@dataclass(frozen=True, slots=True)
class ContentDiagnostic:
    """Safe reason-coded scan result; paths are library-relative only."""

    code: str
    message: str
    relative_path: str | None = None


@dataclass(frozen=True, slots=True)
class ScannedContentFile:
    """One verified regular file discovered beneath Included or Local."""

    relative_path: str
    role: str
    media_type: str
    size_bytes: int
    sha256: str


@dataclass(frozen=True, slots=True)
class ScannedContentEntry:
    """Filesystem projection ready to reconcile into the SQL catalog."""

    source: ContentSource
    kind: ContentKind
    relative_locator: str
    display_name: str
    status: ContentStatus
    revision_sha256: str | None
    files: tuple[ScannedContentFile, ...] = ()
    descriptor_relative_path: str | None = None
    logical_key: str | None = None
    dependencies: tuple[str, ...] = ()
    provenance: dict[str, Any] = field(default_factory=dict)
    metadata: dict[str, Any] = field(default_factory=dict)
    diagnostics: tuple[ContentDiagnostic, ...] = ()
    source_mount_id: str | None = None


@dataclass(frozen=True, slots=True)
class CatalogContentFile:
    """Opaque catalog registration for one exact readable-library byte file."""

    file_ref: str
    item_id: str
    source: ContentSource
    relative_path: str
    role: str
    media_type: str
    size_bytes: int
    sha256: str
    source_mount_id: str | None = None


@dataclass(frozen=True, slots=True)
class CatalogContentEntry:
    """Persisted logical catalog item returned to application services."""

    id: str
    source: ContentSource
    scope: ContentScope
    owner_user_id: str | None
    kind: ContentKind
    relative_locator: str
    display_name: str
    status: ContentStatus
    revision_sha256: str | None
    files: tuple[CatalogContentFile, ...]
    logical_key: str | None = None
    dependencies: tuple[str, ...] = ()
    dependency_item_ids: tuple[str, ...] = ()
    provenance: dict[str, Any] = field(default_factory=dict)
    metadata: dict[str, Any] = field(default_factory=dict)
    diagnostics: tuple[ContentDiagnostic, ...] = ()
    scanned_at: datetime | None = None
    source_mount_id: str | None = None


@dataclass(slots=True)
class VerifiedContentFile:
    """Open verified file descriptor owned by the caller until response completion."""

    handle: BinaryIO
    size_bytes: int
    sha256: str
    media_type: str


@dataclass(frozen=True, slots=True)
class ContentScanSummary:
    """Counts from one authoritative source reconciliation."""

    source: ContentSource
    scanned: int
    valid: int
    invalid: int
    missing: int


@dataclass(frozen=True, slots=True)
class SavedContent:
    """Result of one direct creator Save into the ordinary Local library."""

    operation_id: str
    item: CatalogContentEntry


@dataclass(frozen=True, slots=True)
class ContentPreviewFile:
    """Exact file registration frozen for one short-lived preview session."""

    file_ref: str
    source: ContentSource
    relative_path: str
    role: str
    media_type: str
    size_bytes: int
    sha256: str
    source_mount_id: str | None = None


@dataclass(frozen=True, slots=True)
class ContentPreview:
    """Owner-scoped preview of one exact validated catalog revision."""

    id: str
    owner_user_id: str
    item_id: str
    revision_sha256: str
    files: tuple[ContentPreviewFile, ...]
    expires_at: datetime


@dataclass(frozen=True, slots=True)
class PreparedPackageFile:
    """One already-digest-verified package member ready for private staging."""

    relative_path: str
    handle: BinaryIO | None
    size_bytes: int
    source_path: Path | None = None


@dataclass(frozen=True, slots=True)
class PreparedPackageEntry:
    """One typed entry in a closure-wide atomic filesystem installation."""

    kind: ContentKind
    relative_locator: str
    files: tuple[PreparedPackageFile, ...]


class ContentError(Exception):
    """Base error for readable-library operations."""


class ContentPathError(ContentError):
    """A requested locator escaped or violated the filesystem contract."""


class ContentValidationError(ContentError):
    """Content bytes or a descriptor failed typed validation."""


class ContentIntegrityError(ContentError):
    """Registered bytes no longer match their catalog digest or size."""


class ContentNotFoundError(ContentError):
    """An opaque catalog registration was absent or unavailable."""


class ContentConflictError(ContentError):
    """A direct Save, preview, or Equip precondition no longer holds."""

    def __init__(
        self,
        code: str,
        *,
        current_revision: str | int | None = None,
        field: str | None = None,
    ) -> None:
        super().__init__(code)
        self.code = code
        self.current_revision = current_revision
        self.field = field


__all__ = [
    "CatalogContentEntry",
    "CatalogContentFile",
    "ContentDiagnostic",
    "ContentError",
    "ContentConflictError",
    "ContentIntegrityError",
    "ContentKind",
    "ContentNotFoundError",
    "ContentPathError",
    "ContentPreview",
    "ContentPreviewFile",
    "ContentScanSummary",
    "ContentScope",
    "ContentSource",
    "ContentStatus",
    "ContentValidationError",
    "ScannedContentEntry",
    "ScannedContentFile",
    "SavedContent",
    "PreparedPackageEntry",
    "PreparedPackageFile",
    "VerifiedContentFile",
]
