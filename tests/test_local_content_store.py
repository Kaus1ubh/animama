from __future__ import annotations

import json
import os
import struct
from io import BytesIO
from pathlib import Path
from typing import TypedDict

import pytest

from animama.adapters.content_store import FilesystemContentStore
from animama.domain.content_catalog import (
    ContentKind,
    ContentPathError,
    ContentSource,
    ContentStatus,
    ContentValidationError,
)
from animama.domain.content_sources import IncludedContentSource
from animama.server.config import Settings
from animama.server.local_runtime import initialize_local_runtime
from tests.filesystem_links import link_directory, require_symlinks


class _ReadArguments(TypedDict):
    source: ContentSource
    relative_path: str
    expected_size_bytes: int
    expected_sha256: str
    media_type: str


def _glb(label: str | None = None) -> bytes:
    value = {
        "asset": {"version": "2.0"},
        "extensions": {"VRMC_vrm_animation": {"specVersion": "1.0"}},
    }
    if label is not None:
        value["extras"] = {"label": label}
    document = json.dumps(value, separators=(",", ":")).encode()
    document += b" " * (-len(document) % 4)
    return (
        struct.pack("<4sII", b"glTF", 2, 20 + len(document)) + struct.pack("<II", len(document), 0x4E4F534A) + document
    )


def _store(tmp_path: Path) -> tuple[FilesystemContentStore, Path, Path]:
    paths = initialize_local_runtime(
        Settings(animama_content_root=tmp_path / "content", animama_data_root=tmp_path / "data")
    )
    return (
        FilesystemContentStore(
            included_root=paths.included_root,
            local_root=paths.local_root,
            operations_root=paths.operations_root,
        ),
        paths.local_root,
        paths.operations_root,
    )


def test_included_mount_custody_and_local_writes_are_separate(tmp_path: Path) -> None:
    core, extra, local = (tmp_path / name for name in ("core", "extra", "local"))
    local.mkdir()
    for root, name in ((core, "first"), (extra, "second")):
        (root / "gestures").mkdir(parents=True)
        (root / f"gestures/{name}.vrma").write_bytes(_glb(name))
    store = FilesystemContentStore(
        included_root=core,
        local_root=local,
        operations_root=tmp_path / "operations",
        included_sources=(
            IncludedContentSource("core", "v1", core),
            IncludedContentSource("expanded", "v2", extra, "expanded-included-content"),
        ),
    )
    items = store.scan(ContentSource.INCLUDED)
    assert {item.source_mount_id for item in items} == {"core@v1", "expanded@v2"}
    for item in items:
        file = item.files[0]
        arguments: _ReadArguments = {
            "source": ContentSource.INCLUDED,
            "relative_path": file.relative_path,
            "expected_size_bytes": file.size_bytes,
            "expected_sha256": file.sha256,
            "media_type": file.media_type,
        }
        opened = store.open_verified_file(**arguments, source_mount_id=item.source_mount_id)
        with opened.handle:
            assert len(opened.handle.read()) == file.size_bytes
        for missing_mount in (None, "expanded@wrong-version"):
            with pytest.raises(ContentPathError, match="not mounted"):
                store.open_verified_file(**arguments, source_mount_id=missing_mount)
    store.save_standalone(kind=ContentKind.GESTURE, relative_locator="gestures/local.vrma", payload=_glb())
    assert (local / "gestures/local.vrma").is_file()
    assert not (core / "gestures/local.vrma").exists()
    assert not (extra / "gestures/local.vrma").exists()
    (extra / "gestures/FIRST.vrma").write_bytes(_glb())
    with pytest.raises(ContentPathError, match="colliding"):
        store.scan(ContentSource.INCLUDED)


def test_save_standalone_is_direct_atomic_and_receipted(tmp_path: Path) -> None:
    store, local_root, operations_root = _store(tmp_path)

    operation_id = store.save_standalone(
        kind=ContentKind.GESTURE,
        relative_locator="gestures/wave.vrma",
        payload=_glb(),
    )

    assert (local_root / "gestures/wave.vrma").read_bytes() == _glb()
    receipt = json.loads((operations_root / f"{operation_id}.json").read_text(encoding="utf-8"))
    assert receipt["status"] == "completed"
    assert receipt["relative_locator"] == "gestures/wave.vrma"
    entries = store.scan(ContentSource.LOCAL)
    assert len(entries) == 1
    assert entries[0].status is ContentStatus.VALID


def test_streamed_standalone_save_rejects_a_size_mismatch_without_replacing_current_bytes(tmp_path: Path) -> None:
    store, local_root, _ = _store(tmp_path)
    original = _glb("original")
    replacement = _glb("replacement")
    store.save_standalone(
        kind=ContentKind.GESTURE,
        relative_locator="gestures/wave.vrma",
        payload=original,
        operation_id="stream-original",
    )

    with pytest.raises(ContentValidationError, match="size does not match"):
        store.save_standalone_stream(
            kind=ContentKind.GESTURE,
            relative_locator="gestures/wave.vrma",
            payload_stream=BytesIO(replacement),
            payload_size_bytes=len(replacement) + 1,
            operation_id="stream-mismatch",
        )

    assert (local_root / "gestures/wave.vrma").read_bytes() == original


def test_descriptor_save_publishes_descriptor_last_and_scans_as_one_entry(tmp_path: Path) -> None:
    store, local_root, _ = _store(tmp_path)
    descriptor = json.dumps(
        {
            "schema_version": 1,
            "content_type": "reaction",
            "id": "local:reaction:happy",
            "name": "Happy",
            "placement_hint": {"emotion": "joy", "intensity": 2},
            "files": ["smile.vrma", "sparkle.json"],
            "dependencies": [],
        }
    ).encode()

    store.save_descriptor_entry(
        kind=ContentKind.REACTION,
        relative_locator="reactions/happy",
        descriptor=descriptor,
        companion_files={"smile.vrma": _glb(), "sparkle.json": b'{"schema_version": 1}'},
    )

    assert (local_root / "reactions/happy/happy.meta.json").is_file()
    entries = store.scan(ContentSource.LOCAL)
    assert [(entry.relative_locator, entry.status) for entry in entries] == [("reactions/happy", ContentStatus.VALID)]
    assert len(entries[0].files) == 3


def test_descriptor_save_validates_companion_structure(tmp_path: Path) -> None:
    store, _, _ = _store(tmp_path)
    descriptor = json.dumps(
        {
            "schema_version": 1,
            "name": "Broken",
            "files": ["broken.vrma"],
            "dependencies": [],
        }
    ).encode()

    with pytest.raises(ContentValidationError):
        store.save_descriptor_entry(
            kind=ContentKind.REACTION,
            relative_locator="reactions/broken",
            descriptor=descriptor,
            companion_files={"broken.vrma": b"not gltf"},
        )


def test_descriptor_save_rejects_an_ambiguous_nested_descriptor(tmp_path: Path) -> None:
    store, _, _ = _store(tmp_path)
    descriptor = json.dumps(
        {
            "schema_version": 1,
            "content_type": "reaction",
            "name": "Happy",
            "placement_hint": {"emotion": "joy", "intensity": 2},
            "files": ["nested/nested.meta.json"],
            "dependencies": [],
        }
    ).encode()

    with pytest.raises(ContentValidationError, match="descriptor parameter"):
        store.save_descriptor_entry(
            kind=ContentKind.REACTION,
            relative_locator="reactions/happy",
            descriptor=descriptor,
            companion_files={"nested/nested.meta.json": b'{"schema_version": 1}'},
        )


def test_descriptor_save_does_not_follow_nested_symlink(tmp_path: Path) -> None:
    store, local_root, _ = _store(tmp_path)
    entry_root = local_root / "reactions/linked"
    entry_root.mkdir()
    outside = tmp_path / "outside"
    outside.mkdir()
    link_directory(entry_root / "assets", outside)
    descriptor = json.dumps(
        {
            "schema_version": 1,
            "name": "Linked",
            "files": ["assets/smile.vrma"],
            "dependencies": [],
        }
    ).encode()

    with pytest.raises(ContentPathError):
        store.save_descriptor_entry(
            kind=ContentKind.REACTION,
            relative_locator="reactions/linked",
            descriptor=descriptor,
            companion_files={"assets/smile.vrma": _glb()},
        )

    assert list(outside.iterdir()) == []


def test_interrupted_descriptor_commit_stays_invalid(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    store, local_root, _ = _store(tmp_path)
    descriptor = json.dumps(
        {
            "schema_version": 1,
            "content_type": "reaction",
            "name": "Happy",
            "placement_hint": {"emotion": "joy", "intensity": 2},
            "files": ["a.vrma", "b.vrma"],
            "dependencies": [],
        }
    ).encode()
    store.save_descriptor_entry(
        kind=ContentKind.REACTION,
        relative_locator="reactions/happy",
        descriptor=descriptor,
        companion_files={"a.vrma": _glb(), "b.vrma": _glb()},
    )
    real_replace = os.replace

    def fail_second_companion(source: Path, destination: Path) -> None:
        if Path(destination) == local_root / "reactions/happy/b.vrma":
            raise OSError("simulated interrupted commit")
        real_replace(source, destination)

    monkeypatch.setattr("animama.adapters.content_store.filesystem_store.os.replace", fail_second_companion)
    with pytest.raises(OSError, match="simulated interrupted commit"):
        store.save_descriptor_entry(
            kind=ContentKind.REACTION,
            relative_locator="reactions/happy",
            descriptor=descriptor,
            companion_files={"a.vrma": _glb("a"), "b.vrma": _glb("b")},
        )

    marker = local_root / "reactions/happy/.animama-operation"
    assert marker.is_file()
    entry = store.scan(ContentSource.LOCAL)[0]
    assert entry.status is ContentStatus.INVALID
    assert any(diagnostic.code == "incomplete_operation" for diagnostic in entry.diagnostics)


def test_save_rejects_traversal_wrong_kind_and_malformed_bytes(tmp_path: Path) -> None:
    store, _, _ = _store(tmp_path)

    with pytest.raises(ContentPathError):
        store.save_standalone(
            kind=ContentKind.GESTURE,
            relative_locator="gestures/../escape.vrma",
            payload=_glb(),
        )
    with pytest.raises(ContentPathError):
        store.save_standalone(
            kind=ContentKind.GESTURE,
            relative_locator="avatars/wave.vrma",
            payload=_glb(),
        )
    with pytest.raises(ContentValidationError):
        store.save_standalone(
            kind=ContentKind.GESTURE,
            relative_locator="gestures/broken.vrma",
            payload=b"not gltf",
        )
    with pytest.raises(ContentValidationError):
        store.save_standalone(
            kind=ContentKind.GESTURE,
            relative_locator="gestures/forged.vrma",
            payload=b"glTF" + b"\x00" * 20,
        )


def test_scan_reports_a_linked_directory_without_entering_it(tmp_path: Path) -> None:
    store, local_root, _ = _store(tmp_path)
    outside = tmp_path / "outside"
    outside.mkdir()
    (outside / "wave.vrma").write_bytes(_glb())
    link_directory(local_root / "gestures/linked", outside)

    files, unsafe = store._walk_definition(local_root)

    assert unsafe["gestures/linked"].code == "symlink_rejected"
    assert all(outside not in path.parents and "linked" not in path.parts for path in files)


def test_scan_does_not_follow_symlinks_or_admit_arbitrary_files(tmp_path: Path) -> None:
    require_symlinks(tmp_path)
    store, local_root, _ = _store(tmp_path)
    outside = tmp_path / "outside.vrma"
    outside.write_bytes(_glb())
    (local_root / "gestures/linked.vrma").symlink_to(outside)
    (local_root / "gestures/notes.txt").write_text("not content", encoding="utf-8")

    assert store.scan(ContentSource.LOCAL) == []
