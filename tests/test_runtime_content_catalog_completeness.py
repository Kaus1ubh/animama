from __future__ import annotations

from pathlib import Path

from animama.adapters.content_store import FilesystemContentStore
from animama.app.services.content_kind_registry import handler_for_kind
from animama.domain.content_catalog import ContentKind, ContentSource, ContentStatus

ROOT = Path(__file__).parents[1]
RUNTIME_KINDS = set(ContentKind) - {ContentKind.ANIMA}


def test_every_included_runtime_item_is_handler_validated_and_file_registered() -> None:
    """Included playback content has no browser-only source outside the catalog."""

    entries = FilesystemContentStore(
        included_root=ROOT / "content/included",
        local_root=ROOT / "content/local",
        operations_root=ROOT / "data/internal/operations",
    ).scan(ContentSource.INCLUDED)

    runtime_entries = [entry for entry in entries if entry.kind in RUNTIME_KINDS]
    assert runtime_entries
    required_kinds = RUNTIME_KINDS - {
        ContentKind.POSE_CLIP,
        ContentKind.SOUND_EFFECT,
        ContentKind.VOICE,
        ContentKind.MUSIC_TRACK,
    }
    assert {entry.kind for entry in runtime_entries} >= required_kinds
    # Shipped Actions own their one-use Pose Clips. Private audio examples are
    # omitted from public source; any locally present examples still pass every
    # handler and file-registration assertion below.
    assert all(entry.kind is not ContentKind.POSE_CLIP for entry in runtime_entries)

    for entry in runtime_entries:
        assert entry.status is ContentStatus.VALID, entry.relative_locator
        assert entry.files, entry.relative_locator
        assert all(file.role not in {"primary", "dependency"} for file in entry.files), (
            entry.relative_locator,
            [file.role for file in entry.files],
        )
        parsed = handler_for_kind(entry.kind).parse_document(
            entry.metadata,
            fallback_path=Path(entry.relative_locator),
            descriptor_backed=False,
        )
        assert parsed.document.kind is entry.kind


def test_reserved_anima_directory_has_no_admitted_portable_entry() -> None:
    entries = FilesystemContentStore(
        included_root=ROOT / "content/included",
        local_root=ROOT / "content/local",
        operations_root=ROOT / "data/internal/operations",
    ).scan(ContentSource.INCLUDED)

    assert all(entry.kind is not ContentKind.ANIMA for entry in entries)
