"""Immutable import review and durable result contracts, with private destinations separate."""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict

from animama.app.contracts.content_package import PackageContentKind, PackageManifest
from animama.app.contracts.portable_anima import PortableAnima


class ImportModel(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class ReviewedImportItem(ImportModel):
    entry_id: str
    kind: PackageContentKind
    original_name: str
    name: str
    selected: bool


class ReviewedNonPortableItem(ImportModel):
    """A non-portable item the sender omitted, and what this installation does with it.

    ``rebound`` uses this installation's own matching item; ``unavailable`` falls
    back (no Gesture, the Default pool without it, or no Idle Style).
    """

    kind: PackageContentKind
    name: str
    outcome: Literal["rebound", "unavailable"]


class PlannedNonPortableItem(ReviewedNonPortableItem):
    logical_key: str
    item_id: str | None


class ReviewedPackageImport(ImportModel):
    """User-visible whole-package proposal; never exposes receiver paths or reserved IDs."""

    stage_id: str
    operation_id: str
    filename: str
    package_sha256: str
    size_bytes: int
    expires_at: datetime
    kind: Literal["content", "anima"]
    selected_count: int
    required_count: int
    items: tuple[ReviewedImportItem, ...]
    anima: PortableAnima | None
    review_digest: str
    non_portable: tuple[ReviewedNonPortableItem, ...] = ()


class PlannedImportItem(ReviewedImportItem):
    """Private, preallocated destinations are not catalog reservations."""

    item_id: str
    logical_key: str
    relative_locator: str


class ReviewedImportPlan(ImportModel):
    schema_version: Literal[1] = 1
    stage_id: str
    operation_id: str
    package_sha256: str
    size_bytes: int
    manifest: PackageManifest
    items: tuple[PlannedImportItem, ...]
    anima: PortableAnima | None
    default_model_provider_id: str | None
    non_portable: tuple[PlannedNonPortableItem, ...] = ()


class ImportedPackageItem(ImportModel):
    entry_id: str
    kind: PackageContentKind
    item_id: str
    revision_sha256: str
    logical_key: str | None
    name: str
    selected: bool


class PackageImportResult(ImportModel):
    """Saved once with the catalog transaction and replayed without consulting live rows."""

    schema_version: Literal[1] = 1
    operation_id: str
    review_digest: str
    package_sha256: str
    items: tuple[ImportedPackageItem, ...]
    anima_id: str | None = None


class LegacyImportedPackageItem(ImportModel):
    """Historical kinds are display facts, never current package admission choices."""

    entry_id: str
    kind: str
    item_id: str
    logical_key: str | None
    name: str
    selected: bool


class LegacyPackageImportResult(ImportModel):
    """Safe projection of a historical completed receipt; never admits old package formats."""

    schema_version: Literal[0] = 0
    operation_id: str
    items: tuple[LegacyImportedPackageItem, ...]
    skipped_existing_item_ids: tuple[str, ...]


class PackageOperationStatus(ImportModel):
    operation_id: str
    state: Literal["pending", "recovery_needed", "completed", "not_found"]
    stage_id: str | None = None
    review_digest: str | None = None
    result: PackageImportResult | LegacyPackageImportResult | None = None
