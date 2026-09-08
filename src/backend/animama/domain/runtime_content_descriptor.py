"""Exact mount-time closure records for readable runtime content.

These records deliberately separate the public descriptor from the internal
filesystem facts needed to serve an already-issued revision.  A browser sees
opaque member references, sizes, media types, and digests; it never receives a
host path.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from pathlib import PurePosixPath
from typing import Any

from animama.domain.content_catalog import ContentKind, ContentSource

MAX_ADMITTED_ITEM_REVISIONS = 500
MAX_ADMITTED_ITEM_REVISIONS_BYTES = 128 * 1024
_CATALOG_ITEM_ID = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
    re.IGNORECASE,
)
_REVISION_SHA256 = re.compile(r"^[0-9a-f]{64}$")


@dataclass(frozen=True, slots=True)
class RuntimeContentRootSelection:
    """One logical loadout slot requested for the next runtime mount."""

    slot_key: str
    catalog_item_id: str
    kind: ContentKind
    context: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class RuntimeContentMember:
    """One deduplicated exact byte member admitted to a runtime revision."""

    file_ref: str
    item_id: str
    source: ContentSource
    relative_path: str
    role: str
    media_type: str
    size_bytes: int
    sha256: str

    @property
    def filename(self) -> str:
        return PurePosixPath(self.relative_path).name


@dataclass(frozen=True, slots=True)
class RuntimeContentEntry:
    """One exact catalog revision in an admitted root's flattened closure."""

    item_id: str
    kind: ContentKind
    display_name: str
    revision_sha256: str
    logical_key: str | None
    member_refs: tuple[str, ...]
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class RuntimeContentRoot:
    """A valid independently resolved root and its exact transitive closure."""

    root_id: str
    slot_key: str
    item_id: str
    kind: ContentKind
    revision_sha256: str
    entry_ids: tuple[str, ...]
    member_refs: tuple[str, ...]
    context: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class RuntimeContentDiagnostic:
    """Reason-coded root omission safe to show without filesystem details."""

    root_id: str
    slot_key: str
    code: str
    message: str
    item_id: str | None = None


@dataclass(frozen=True, slots=True)
class RuntimeContentDescriptor:
    """Complete exact byte inventory for one mount boundary."""

    loadout_revision: int
    roots: tuple[RuntimeContentRoot, ...]
    entries: tuple[RuntimeContentEntry, ...]
    members: tuple[RuntimeContentMember, ...]
    diagnostics: tuple[RuntimeContentDiagnostic, ...]
    admitted_item_revisions: dict[str, str]
    total_bytes: int
    revision: str
    schema_version: int = 2


def validate_admitted_item_revisions(value: dict[str, str]) -> dict[str, str]:
    """Validate and canonicalize the bounded item-level runtime admission map."""

    if len(value) > MAX_ADMITTED_ITEM_REVISIONS:
        raise ValueError("runtime admitted item count exceeds the supported limit")
    canonical = dict(sorted(value.items()))
    if any(not _CATALOG_ITEM_ID.fullmatch(item_id) for item_id in canonical):
        raise ValueError("runtime admitted item IDs must be catalog UUIDs")
    if any(not _REVISION_SHA256.fullmatch(revision) for revision in canonical.values()):
        raise ValueError("runtime admitted revisions must be 64-character SHA-256 values")
    encoded = json.dumps(canonical, sort_keys=True, separators=(",", ":")).encode()
    if len(encoded) > MAX_ADMITTED_ITEM_REVISIONS_BYTES:
        raise ValueError("runtime admitted item map exceeds the supported byte limit")
    return canonical


__all__ = [
    "RuntimeContentDescriptor",
    "RuntimeContentDiagnostic",
    "RuntimeContentEntry",
    "RuntimeContentMember",
    "RuntimeContentRoot",
    "RuntimeContentRootSelection",
    "MAX_ADMITTED_ITEM_REVISIONS",
    "MAX_ADMITTED_ITEM_REVISIONS_BYTES",
    "validate_admitted_item_revisions",
]
