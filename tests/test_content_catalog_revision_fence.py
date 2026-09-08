from __future__ import annotations

import json
import struct
from pathlib import Path

from animama.adapters.content_store import FilesystemContentStore
from animama.domain.content_catalog import ContentSource


def _vrma() -> bytes:
    document = json.dumps(
        {
            "asset": {"version": "2.0"},
            "extensions": {"VRMC_vrm_animation": {"specVersion": "1.0"}},
        },
        separators=(",", ":"),
    ).encode()
    document += b" " * (-len(document) % 4)
    return (
        struct.pack("<4sII", b"glTF", 2, 20 + len(document))
        + struct.pack("<II", len(document), 0x4E4F534A)
        + document
    )


def _store(tmp_path: Path) -> FilesystemContentStore:
    included = tmp_path / "content/included"
    local = tmp_path / "content/local"
    included.mkdir(parents=True)
    local.mkdir(parents=True)
    return FilesystemContentStore(
        included_root=included,
        local_root=local,
        operations_root=tmp_path / "data/internal/operations",
    )


def test_standalone_filename_derived_meaning_advances_item_revision(tmp_path: Path) -> None:
    store = _store(tmp_path)
    gesture_root = tmp_path / "content/local/gestures"
    gesture_root.mkdir(parents=True)
    wave = gesture_root / "wave.vrma"
    wave.write_bytes(_vrma())

    first = next(item for item in store.scan(ContentSource.LOCAL) if item.relative_locator.endswith("wave.vrma"))
    wave.rename(gesture_root / "hello.vrma")
    second = next(item for item in store.scan(ContentSource.LOCAL) if item.relative_locator.endswith("hello.vrma"))

    assert first.files[0].sha256 == second.files[0].sha256
    assert first.display_name == "Wave"
    assert second.display_name == "Hello"
    assert first.revision_sha256 != second.revision_sha256


def test_typed_sidecar_semantics_and_file_roles_are_revision_fenced(tmp_path: Path) -> None:
    store = _store(tmp_path)
    gesture_root = tmp_path / "content/local/gestures"
    gesture_root.mkdir(parents=True)
    clip = gesture_root / "wave.vrma"
    clip.write_bytes(_vrma())
    sidecar = gesture_root / "wave.meta.json"
    sidecar.write_text(
        json.dumps(
            {
                "content_type": "gesture",
                "schema_version": 1,
                "name": "Wave",
                "semantic_key": "wave",
                "implementation": {"kind": "vrma", "file_role": "animation"},
            }
        ),
        encoding="utf-8",
    )
    first = next(item for item in store.scan(ContentSource.LOCAL) if item.relative_locator.endswith("wave.vrma"))

    sidecar.write_text(
        json.dumps(
            {
                "content_type": "gesture",
                "schema_version": 1,
                "name": "Greeting",
                "semantic_key": "greeting",
                "implementation": {"kind": "vrma", "file_role": "animation"},
            }
        ),
        encoding="utf-8",
    )
    second = next(item for item in store.scan(ContentSource.LOCAL) if item.relative_locator.endswith("wave.vrma"))

    assert {file.role for file in second.files} == {"animation", "metadata"}
    assert first.revision_sha256 != second.revision_sha256
