from __future__ import annotations

import json
import struct
from pathlib import Path

import pytest

from animama.adapters.content_store import FilesystemContentStore
from animama.domain.content_catalog import ContentSource, ContentStatus
from animama.server.config import Settings
from animama.server.local_runtime import initialize_local_runtime


def _glb() -> bytes:
    document = json.dumps(
        {
            "asset": {"version": "2.0"},
            "extensions": {"VRMC_vrm_animation": {"specVersion": "1.0"}},
        },
        separators=(",", ":"),
    ).encode()
    document += b" " * (-len(document) % 4)
    return (
        struct.pack("<4sII", b"glTF", 2, 20 + len(document)) + struct.pack("<II", len(document), 0x4E4F534A) + document
    )


@pytest.mark.parametrize("with_hint", [False, True])
def test_scan_admits_simple_sidecar_and_descriptor_entries_independently(tmp_path: Path, with_hint: bool) -> None:
    paths = initialize_local_runtime(
        Settings(animama_content_root=tmp_path / "content", animama_data_root=tmp_path / "data")
    )
    (paths.local_root / "gestures/wave.vrma").write_bytes(_glb())
    (paths.local_root / "gestures/wave.meta.json").write_text(
        json.dumps({"id": "local:gesture:wave", "name": "Friendly Wave"}), encoding="utf-8"
    )
    reaction = paths.local_root / "reactions/happy"
    reaction.mkdir()
    (reaction / "happy.json").write_text(
        json.dumps(
            {
                "schema": "animaPoseClip/1.0",
                "id": "happy",
                "name": "Happy",
                "duration": 1,
                "poses": {"expression": {"expressions": {"happy": 1}}},
                "poseKeyframes": [{"time": 0, "pose": "expression"}],
            }
        ),
        encoding="utf-8",
    )
    (reaction / "happy.meta.json").write_text(
        json.dumps(
            {
                "schema_version": 1,
                "content_type": "reaction",
                "id": "local:reaction:happy",
                "name": "Happy",
                **({"placement_hint": {"emotion": "joy", "intensity": 2}} if with_hint else {}),
                "implementation": {"kind": "anima_clip", "file_role": "sequence"},
                "files": [{"path": "happy.json", "role": "sequence"}],
            }
        ),
        encoding="utf-8",
    )
    generic_reaction = paths.local_root / "reactions/generic"
    generic_reaction.mkdir()
    (generic_reaction / "reaction.json").write_text(
        json.dumps({"schema_version": 1, "name": "Generic"}), encoding="utf-8"
    )
    (paths.local_root / "pose-clips/broken.json").write_text("{", encoding="utf-8")
    (paths.local_root / "gestures/bad-id.vrma").write_bytes(_glb())
    (paths.local_root / "gestures/bad-id.meta.json").write_text(
        json.dumps({"id": "../unsafe", "name": "Bad ID"}), encoding="utf-8"
    )

    entries = FilesystemContentStore(
        included_root=paths.included_root,
        local_root=paths.local_root,
        operations_root=paths.operations_root,
    ).scan(ContentSource.LOCAL)
    by_locator = {entry.relative_locator: entry for entry in entries}

    assert by_locator["gestures/wave.vrma"].display_name == "Friendly Wave"
    assert by_locator["gestures/wave.vrma"].logical_key == "local:gesture:wave"
    assert by_locator["reactions/happy"].status is ContentStatus.VALID
    assert "reactions/generic" not in by_locator
    assert by_locator["pose-clips/broken.json"].status is ContentStatus.INVALID
    assert by_locator["pose-clips/broken.json"].diagnostics[0].code == "malformed_json"
    assert by_locator["gestures/bad-id.vrma"].status is ContentStatus.INVALID
    assert by_locator["gestures/bad-id.vrma"].logical_key is None
    assert by_locator["gestures/bad-id.vrma"].diagnostics[0].code == "invalid_logical_key"
