"""Filesystem boundary for the readable Included and Local libraries."""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Any, BinaryIO, Protocol

from animama.domain.content_catalog import (
    CatalogContentEntry,
    ContentKind,
    ContentSource,
    PreparedPackageEntry,
    ScannedContentEntry,
    VerifiedContentFile,
)


@dataclass(frozen=True, slots=True)
class ContentMutationJournal:
    """Identity used to reconcile filesystem recovery with a durable catalog receipt."""

    journal_id: str
    operation_id: str
    user_id: str
    request_digest: str


class ContentStore(Protocol):
    """Scan, safely save, and open exact registered local content bytes."""

    def begin_mutation(self, *, operation_id: str, user_id: str, request_digest: str) -> str:
        """Start recoverable writes after the caller has acquired the Local mutation lock."""

        raise NotImplementedError

    def pending_mutations(self) -> tuple[ContentMutationJournal, ...]:
        """Return unresolved identities for authoritative catalog receipt lookup."""

        raise NotImplementedError

    def finalize_mutation(self, *, journal_id: str, commit: bool, expected_request_digest: str | None = None) -> None:
        """Finalize matching work, retaining conflicts and leaving newer attempts untouched."""

        raise NotImplementedError

    def recover_mutations(self, *, committed_journal_ids: set[str]) -> None:
        """Reconcile journals under the Local lock using catalog-confirmed committed identities."""

        raise NotImplementedError

    def retain_transition_originals(
        self, *, operation_id: str, entry: CatalogContentEntry | None, binding_facts: list[dict[str, Any]]
    ) -> None:
        """Keep verified originals outside scanned roots, independently of journal cleanup."""

        raise NotImplementedError

    def scan(self, source: ContentSource) -> list[ScannedContentEntry]:
        raise NotImplementedError

    def inspect_package_tree(self, root: Path) -> list[ScannedContentEntry]:
        """Validate an isolated private tree without scanning or mutating installed roots."""

        raise NotImplementedError

    def open_verified_file(
        self,
        *,
        source: ContentSource,
        relative_path: str,
        expected_size_bytes: int,
        expected_sha256: str,
        media_type: str,
        source_mount_id: str | None = None,
    ) -> VerifiedContentFile:
        raise NotImplementedError

    def save_standalone(
        self,
        *,
        kind: ContentKind,
        relative_locator: str,
        payload: bytes,
        metadata_sidecar: bytes | None = None,
        operation_id: str | None = None,
    ) -> str:
        """Atomically replace a supported standalone Local file and return its operation ID."""

        raise NotImplementedError

    def save_standalone_stream(
        self,
        *,
        kind: ContentKind,
        relative_locator: str,
        payload_stream: BinaryIO,
        payload_size_bytes: int,
        metadata_sidecar: bytes | None = None,
        operation_id: str | None = None,
    ) -> str:
        """Stream and atomically replace a supported standalone Local file."""

        raise NotImplementedError

    def save_descriptor_entry(
        self,
        *,
        kind: ContentKind,
        relative_locator: str,
        descriptor: bytes,
        companion_files: Mapping[str, bytes],
        operation_id: str | None = None,
        require_new: bool = False,
    ) -> str:
        """Commit validated companion files followed by the type descriptor."""

        raise NotImplementedError

    def save_descriptor_entry_streams(
        self,
        *,
        kind: ContentKind,
        relative_locator: str,
        descriptor: bytes,
        companion_files: Mapping[str, tuple[BinaryIO, int]],
        operation_id: str | None = None,
        require_new: bool = False,
    ) -> str:
        """Stream companion files, then publish the validated descriptor last."""

        raise NotImplementedError

    def delete_entry(self, *, entry: CatalogContentEntry) -> None:
        """Delete only exact files registered for one editable Local entry."""

        raise NotImplementedError

    def install_package_atomic(
        self,
        *,
        entries: tuple[PreparedPackageEntry, ...],
        operation_id: str,
        require_new: bool = False,
    ) -> None:
        """Validate and promote a complete package closure or expose none of it."""

        raise NotImplementedError

    def package_destination_exists(self, *, relative_locator: str) -> bool:
        """Check a proposed fresh Local entry, including unregistered host files."""

        raise NotImplementedError

    def recover_package_installs(self) -> None:
        """Compensate interrupted package promotions before the first scan."""

        raise NotImplementedError

    def finalize_package_install(self, *, operation_id: str, commit: bool) -> None:
        """Release or compensate a promoted package after catalog reconciliation."""

        raise NotImplementedError


__all__ = ["ContentMutationJournal", "ContentStore"]
