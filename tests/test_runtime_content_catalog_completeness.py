from __future__ import annotations

from pathlib import Path

from animama.adapters.content_store import FilesystemContentStore
from animama.app.services.content_kind_registry import handler_for_kind
from animama.domain.content_catalog import ContentKind, ContentSource, ContentStatus
from tests.anima_creation_service_support import copy_tracked_included, write_supplied_animation_fixture

RUNTIME_KINDS = set(ContentKind) - {ContentKind.ANIMA}


def test_every_supplied_runtime_item_is_handler_validated_and_file_registered(tmp_path: Path) -> None:
    """Tracked descriptors with original supplied motion close through the catalog."""

    entries = FilesystemContentStore(
        included_root=write_supplied_animation_fixture(tmp_path / "included"),
        local_root=tmp_path / "local",
        operations_root=tmp_path / "operations",
    ).scan(ContentSource.INCLUDED)

    runtime_entries = [entry for entry in entries if entry.kind in RUNTIME_KINDS]
    assert runtime_entries
    required_kinds = RUNTIME_KINDS - {
        ContentKind.POSE_CLIP,
        ContentKind.IDLE_STYLE,
        ContentKind.SOUND_EFFECT,
        ContentKind.VOICE,
        ContentKind.MUSIC_TRACK,
    }
    assert {entry.kind for entry in runtime_entries} >= required_kinds
    # Actions own their one-use Pose Clips. Private audio examples stay omitted;
    # the fixture supplies original motion structures without changing descriptors.
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


def test_reserved_anima_directory_has_no_admitted_portable_entry(tmp_path: Path) -> None:
    entries = FilesystemContentStore(
        included_root=copy_tracked_included(tmp_path / "included"),
        local_root=tmp_path / "local",
        operations_root=tmp_path / "operations",
    ).scan(ContentSource.INCLUDED)

    assert all(entry.kind is not ContentKind.ANIMA for entry in entries)
