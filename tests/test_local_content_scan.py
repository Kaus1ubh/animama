from __future__ import annotations

import json
import shutil
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
                "schema": "animaPoseClip/2.0",
                "id": "happy",
                "name": "Happy",
                "duration": 1,
                "beats": [{"id": "expression", "label": "Expression", "time": 0}],
                "expressions": {"happy": [{"beat": "expression", "v": 1}]},
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


@pytest.mark.parametrize(
    ("kind", "schema", "message"),
    [
        ("gesture", "animaPoseClip/1.0", "retired animaPoseClip/1.0 format"),
        ("reaction", "animaPoseClip/1.0", "retired animaPoseClip/1.0 format"),
        ("reaction", "animaPoseClip/9.0", 'Unsupported clip format "animaPoseClip/9.0"'),
    ],
)
def test_scan_rejects_clips_in_unsupported_formats(tmp_path: Path, kind: str, schema: str, message: str) -> None:
    paths = initialize_local_runtime(
        Settings(animama_content_root=tmp_path / "content", animama_data_root=tmp_path / "data")
    )
    entry = paths.local_root / f"{kind}s/old"
    entry.mkdir(parents=True, exist_ok=True)
    (entry / "old.json").write_text(
        json.dumps(
            {
                "schema": schema,
                "id": "old",
                "name": "Old",
                "poses": {"a": {"expressions": {"happy": 1}}},
                "poseKeyframes": [{"time": 0, "pose": "a"}],
            }
        ),
        encoding="utf-8",
    )
    (entry / "old.meta.json").write_text(
        json.dumps(
            {
                "schema_version": 1,
                "content_type": kind,
                "id": f"local:{kind}:old",
                "name": "Old",
                "implementation": {"kind": "anima_clip", "file_role": "sequence"},
                "files": [{"path": "old.json", "role": "sequence"}],
            }
        ),
        encoding="utf-8",
    )

    entries = FilesystemContentStore(
        included_root=paths.included_root,
        local_root=paths.local_root,
        operations_root=paths.operations_root,
    ).scan(ContentSource.LOCAL)
    scanned = {item.relative_locator: item for item in entries}[f"{kind}s/old"]

    assert scanned.status is ContentStatus.INVALID
    assert [diagnostic.code for diagnostic in scanned.diagnostics] == ["clip_format_unsupported"]
    assert message in scanned.diagnostics[0].message
    assert "animaPoseClip/2.0" in scanned.diagnostics[0].message


@pytest.mark.parametrize("source", [ContentSource.INCLUDED, ContentSource.LOCAL])
def test_avatar_effect_scan_keeps_authored_effects_without_listing_loose_artwork(
    tmp_path: Path, source: ContentSource
) -> None:
    paths = initialize_local_runtime(
        Settings(animama_content_root=tmp_path / "content", animama_data_root=tmp_path / "data")
    )
    root = paths.included_root if source is ContentSource.INCLUDED else paths.local_root
    effect_root = root / "vfx/avatar"
    effect_root.mkdir(parents=True, exist_ok=True)
    shipped_eye = Path(__file__).parents[1] / "content/included/vfx/avatar/eye"
    shutil.copytree(shipped_eye, effect_root / "eye")
    if source is ContentSource.INCLUDED:
        shutil.copytree(shipped_eye.parents[2] / "licenses", root / "licenses", dirs_exist_ok=True)
    for extension in ("png", "jpg", "jpeg", "webp", "svg"):
        # Artwork is not a playable entry, regardless of its image format.
        (effect_root / f"loose.{extension}").write_bytes((shipped_eye / "eye_=_r.png").read_bytes())

    entries = FilesystemContentStore(
        included_root=paths.included_root,
        local_root=paths.local_root,
        operations_root=paths.operations_root,
    ).scan(source)

    assert [entry.relative_locator for entry in entries] == ["vfx/avatar/eye"]
    assert entries[0].status is ContentStatus.VALID
    assert all((effect_root / f"loose.{extension}").exists() for extension in ("png", "jpg", "jpeg", "webp", "svg"))
