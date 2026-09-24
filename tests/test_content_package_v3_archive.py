"""Hostile archives are rejected before a private inspection can be admitted."""

from __future__ import annotations

import hashlib
import io
import json
import os
import stat
import struct
import wave
from pathlib import Path
from typing import Any
from zipfile import ZIP_STORED, ZipExtFile, ZipFile, ZipInfo

import pytest

from animama.adapters.content_store import FilesystemContentStore
from animama.app.contracts.content_package import portable_revision
from animama.app.services.content_package_archive import ContentPackageArchive
from animama.domain.content_catalog import ContentConflictError


def sound_package() -> tuple[dict[str, Any], dict[str, bytes]]:
    audio = io.BytesIO()
    with wave.open(audio, "wb") as target:
        target.setnchannels(1)
        target.setsampwidth(2)
        target.setframerate(8_000)
        target.writeframes(b"\x00\x00" * 8)
    payloads = {
        "entries/0000/tone.wav": audio.getvalue(),
        "entries/0000/tone.meta.json": json.dumps(
            {
                "schema_version": 1,
                "content_type": "sound_effect",
                "content_id": "sound",
                "name": "Tone",
            }
        ).encode(),
    }
    files = [
        {
            "archive_path": path,
            "relative_path": Path(path).name,
            "role": "metadata" if path.endswith("json") else "audio",
            "ordinal": index,
            "media_type": "application/json" if path.endswith("json") else "audio/wav",
            "size_bytes": len(payload),
            "sha256": hashlib.sha256(payload).hexdigest(),
        }
        for index, (path, payload) in enumerate(payloads.items(), 1)
    ]
    manifest = {
        "schema": "animama-content-package/3",
        "kind": "content",
        "root_entry_ids": ["sound"],
        "entries": [
            {
                "package_entry_id": "sound",
                "kind": "sound_effect",
                "logical_key": "sound",
                "display_name": "Tone",
                "portable_revision_sha256": portable_revision(files),
                "dependencies": [],
                "files": files,
            }
        ],
        "avatar_portraits": [],
        "capabilities": [],
    }
    return manifest, payloads


def write_package(path: Path, manifest: dict[str, Any], payloads: dict[str, bytes], *, mode: int | None = None) -> None:
    with ZipFile(path, "w", compression=ZIP_STORED) as archive:
        archive.writestr("package.json", json.dumps(manifest))
        for name, payload in payloads.items():
            info = ZipInfo(name)
            info.external_attr = (mode if mode is not None else stat.S_IFREG | 0o600) << 16
            archive.writestr(info, payload)


def inspector(tmp_path: Path) -> ContentPackageArchive:
    store = FilesystemContentStore(
        included_root=tmp_path / "included", local_root=tmp_path / "local", operations_root=tmp_path / "operations"
    )
    return ContentPackageArchive(store=store)


@pytest.mark.parametrize(
    "case", ["wrong-hash", "wrong-size", "missing", "undeclared", "symlink", "device", "directory"]
)
def test_rejects_unverified_members_and_removes_private_tree(tmp_path: Path, case: str) -> None:
    manifest, payloads = sound_package()
    mode = None
    if case == "wrong-hash":
        payloads["entries/0000/tone.wav"] = payloads["entries/0000/tone.wav"][:-1] + b"x"
    elif case == "wrong-size":
        payloads["entries/0000/tone.wav"] += b"x"
    elif case == "missing":
        payloads.pop("entries/0000/tone.wav")
    elif case == "undeclared":
        payloads["hidden.json"] = b"{}"
    elif case == "symlink":
        mode = stat.S_IFLNK | 0o600
    elif case == "device":
        mode = stat.S_IFCHR | 0o600
    else:
        payloads["folder/"] = b""
    archive = tmp_path / "hostile.animama"
    write_package(archive, manifest, payloads, mode=mode)
    destination = tmp_path / "inspection"
    with pytest.raises(ContentConflictError):
        inspector(tmp_path).inspect(archive, destination=destination)
    assert not destination.exists()
    assert not (tmp_path / "local").exists()
    assert not (tmp_path / "operations").exists()


def test_valid_inspection_returns_verified_paths_without_touching_library(tmp_path: Path) -> None:
    manifest, payloads = sound_package()
    archive = tmp_path / "tone.animama"
    write_package(archive, manifest, payloads)
    result = inspector(tmp_path).inspect(archive, destination=tmp_path / "inspection")
    entry = result.entries["sound"]
    assert entry.document.content_id == "sound"
    assert entry.scanned.display_name == "Tone"
    assert {name: path.read_bytes() for name, path in entry.files.items()} == {
        Path(name).name: value for name, value in payloads.items()
    }
    assert not (tmp_path / "local").exists()
    assert not (tmp_path / "operations").exists()


@pytest.mark.parametrize("case", ["role", "media-type", "unknown-metadata", "metadata-identity", "duplicate-json-key"])
def test_consistent_hashes_do_not_bypass_typed_metadata_validation(tmp_path: Path, case: str) -> None:
    manifest, payloads = sound_package()
    entry = manifest["entries"][0]
    if case == "role":
        entry["files"][0]["role"] = "model"
    elif case == "media-type":
        entry["files"][0]["media_type"] = "text/plain"
    else:
        metadata_path = "entries/0000/tone.meta.json"
        value = json.loads(payloads[metadata_path])
        if case == "unknown-metadata":
            value["execute"] = "shell-script"
        elif case == "metadata-identity":
            value["content_id"] = "sender-local-secret-id"
        payload = json.dumps(value).encode()
        if case == "duplicate-json-key":
            payload = payload[:-1] + b', "name": "Tone"}'
        payloads[metadata_path] = payload
        entry["files"][1]["size_bytes"] = len(payload)
        entry["files"][1]["sha256"] = hashlib.sha256(payload).hexdigest()
    entry["portable_revision_sha256"] = portable_revision(entry["files"])
    archive = tmp_path / "invalid.animama"
    write_package(archive, manifest, payloads)
    with pytest.raises(ContentConflictError):
        inspector(tmp_path).inspect(archive, destination=tmp_path / "inspection")
    assert not (tmp_path / "inspection").exists()


@pytest.mark.parametrize("limit", ["files", "manifest", "archive", "expanded", "ratio", "metadata"])
def test_reduced_resource_limits_include_manifest(tmp_path: Path, monkeypatch: pytest.MonkeyPatch, limit: str) -> None:
    from animama.app.services import content_package_archive as reader

    manifest, payloads = sound_package()
    archive = tmp_path / "bounded.animama"
    write_package(archive, manifest, payloads)
    if limit == "files":
        monkeypatch.setattr(reader, "MAX_PACKAGE_FILES", 1)
    elif limit == "manifest":
        monkeypatch.setattr(reader, "MAX_MANIFEST_BYTES", len(json.dumps(manifest).encode()) - 1)
    elif limit == "archive":
        monkeypatch.setattr(reader, "MAX_PACKAGE_BYTES", archive.stat().st_size - 1)
    elif limit == "expanded":
        # Compress the metadata so compressed bytes fit while expanded bytes do not.
        from zipfile import ZIP_DEFLATED

        with ZipFile(archive, "w", compression=ZIP_DEFLATED) as target:
            target.writestr("package.json", json.dumps(manifest))
            for name, payload in payloads.items():
                target.writestr(name, payload)
        expanded = len(json.dumps(manifest).encode()) + sum(map(len, payloads.values()))
        assert archive.stat().st_size < expanded
        monkeypatch.setattr(reader, "MAX_PACKAGE_BYTES", expanded - 1)
    elif limit == "metadata":
        monkeypatch.setattr(reader, "MAX_PACKAGE_METADATA_BYTES", 1)
    else:
        monkeypatch.setattr(reader, "MAX_COMPRESSION_RATIO", 0)
    if limit != "metadata":
        with pytest.raises(ContentConflictError):
            ContentPackageArchive.expanded_size(archive)
    with pytest.raises(ContentConflictError):
        inspector(tmp_path).inspect(archive, destination=tmp_path / "inspection")
    assert not (tmp_path / "inspection").exists()


def test_existing_destination_is_preserved(tmp_path: Path) -> None:
    manifest, payloads = sound_package()
    archive = tmp_path / "valid.animama"
    write_package(archive, manifest, payloads)
    destination = tmp_path / "inspection"
    destination.mkdir()
    (destination / "keep").write_text("unrelated")
    with pytest.raises(ContentConflictError, match="destination_exists"):
        inspector(tmp_path).inspect(archive, destination=destination)
    assert (destination / "keep").read_text() == "unrelated"


@pytest.mark.parametrize("case", ["duplicate", "traversal", "backslash", "encrypted", "truncated", "directory-budget"])
def test_zip_structure_cannot_bypass_inspection(tmp_path: Path, monkeypatch: pytest.MonkeyPatch, case: str) -> None:
    from animama.app.services import content_package_archive as reader

    manifest, payloads = sound_package()
    archive = tmp_path / "bad-zip.animama"
    write_package(archive, manifest, payloads)
    if case in {"duplicate", "traversal", "backslash"}:
        name = {"duplicate": "entries/0000/tone.wav", "traversal": "../outside", "backslash": "..\\outside"}[case]
        with ZipFile(archive, "a") as target:
            target.writestr(name, b"untrusted")
    elif case == "encrypted":
        raw = bytearray(archive.read_bytes())
        index = raw.index(b"PK\x01\x02")
        struct.pack_into("<H", raw, index + 8, 1)
        archive.write_bytes(raw)
    elif case == "truncated":
        archive.write_bytes(archive.read_bytes()[:-10])
    else:
        monkeypatch.setattr(reader, "MAX_ZIP_DIRECTORY_BYTES", 1)
    with pytest.raises(ContentConflictError):
        inspector(tmp_path).inspect(archive, destination=tmp_path / "inspection")
    assert not (tmp_path / "inspection").exists()
    assert not (tmp_path / "outside").exists()


def test_disk_failure_removes_only_its_private_staging(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    manifest, payloads = sound_package()
    archive = tmp_path / "valid.animama"
    write_package(archive, manifest, payloads)
    open_path = Path.open

    def fail_payload(path: Path, mode: str = "r", *args: Any, **kwargs: Any):  # noqa: ANN202
        if mode == "xb" and path.suffix == ".wav":
            raise OSError(28, "fixture disk is full")
        return open_path(path, mode, *args, **kwargs)

    monkeypatch.setattr(Path, "open", fail_payload)
    with pytest.raises(ContentConflictError, match="package_archive_invalid"):
        inspector(tmp_path).inspect(archive, destination=tmp_path / "inspection")
    assert not (tmp_path / "inspection").exists()
    assert archive.exists()


def test_large_member_is_streamed_in_bounded_reads(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """Exercise a real member above 128 MiB without creating an equally large buffer."""
    manifest, payloads = sound_package()
    payload_path = tmp_path / "large.wav"
    chunk = os.urandom(1024 * 1024)
    with wave.open(str(payload_path), "wb") as target:
        target.setnchannels(1)
        target.setsampwidth(2)
        target.setframerate(48_000)
        for _ in range(129):
            target.writeframesraw(chunk)
    digest = hashlib.sha256()
    with payload_path.open("rb") as source:
        while block := source.read(1024 * 1024):
            digest.update(block)
    member = manifest["entries"][0]["files"][0]
    member["size_bytes"] = payload_path.stat().st_size
    member["sha256"] = digest.hexdigest()
    manifest["entries"][0]["portable_revision_sha256"] = portable_revision(manifest["entries"][0]["files"])
    archive = tmp_path / "large.animama"
    with ZipFile(archive, "w", compression=ZIP_STORED) as package:
        package.writestr("package.json", json.dumps(manifest))
        package.write(payload_path, "entries/0000/tone.wav")
        package.writestr("entries/0000/tone.meta.json", payloads["entries/0000/tone.meta.json"])
    reads: list[int] = []
    original_read = ZipExtFile.read

    def bounded_read(source: ZipExtFile, size: int = -1) -> bytes:
        if source.name != "package.json":
            assert 0 < size <= 1024 * 1024
            reads.append(size)
        return original_read(source, size)

    monkeypatch.setattr(ZipExtFile, "read", bounded_read)
    result = inspector(tmp_path).inspect(archive, destination=tmp_path / "inspection")
    assert len(reads) > 128
    assert result.entries["sound"].files["tone.wav"].stat().st_size == member["size_bytes"]


@pytest.mark.parametrize("loop_count,accepted", [(2, True), (None, False)])
@pytest.mark.parametrize("implementation", ["anima_clip", "vrma"])
def test_idle_style_requires_its_actual_owned_motion_to_finish(
    tmp_path: Path, loop_count: int | None, accepted: bool, implementation: str
) -> None:
    """An otherwise valid looping Action needs a finite bound when used for idle."""
    clip = {
        "schema": "animaPoseClip/1.0",
        "id": "motion",
        "name": "Motion",
        "duration": 1,
        "loop": True,
        "poses": {"turn": {"humanoid": {"head": {"rotationEulerDegrees": [0, 15, 0]}}}},
        "poseKeyframes": [{"time": 0, "pose": "turn"}],
        "events": [],
    }
    gesture = {
        "schema_version": 1,
        "content_type": "gesture",
        "content_id": "motion",
        "name": "Motion",
        "implementation": {"kind": "anima_clip", "file_role": "sequence"},
        "semantic_key": "motion",
        "config": {} if loop_count is None else {"loop_count": loop_count},
        "files": [{"path": "motion.json", "role": "sequence"}],
        "dependencies": [],
    }
    motion_name, motion_role, motion_payload = "motion.json", "sequence", json.dumps(clip).encode()
    if implementation == "vrma":
        from tests.test_content_gltf import _fixture_document, _glb_source

        gltf, binary = _fixture_document(buffer_uri=None)
        motion_name, motion_role, motion_payload = "motion.vrma", "animation", _glb_source(gltf, binary)
        # An omitted file_role uses the same implementation default as ordinary
        # Gesture playback and Idle preview; the archive must preserve that rule.
        gesture["implementation"] = {"kind": "vrma"}
        gesture["config"] = {"loop_type": "repeat", **({"loop_count": loop_count} if loop_count else {})}
        gesture["files"] = [{"path": motion_name, "role": motion_role}]
    style = {
        "schema_version": 2,
        "content_type": "idle_style",
        "content_id": "style",
        "name": "Style",
        "default_pool": ["motion"],
        "cells": {},
        "dependencies": [{"ref": "motion", "content_type": "gesture"}],
    }
    manifest: dict[str, Any] = {
        "schema": "animama-content-package/3",
        "kind": "content",
        "root_entry_ids": ["style"],
        "entries": [],
        "avatar_portraits": [],
        "capabilities": ["VRMC_vrm_animation/1.0"]
        if implementation == "vrma"
        else ["animaPose/1.0", "animaPoseClip/1.0"],
    }
    payloads = {}
    for document, documents in (
        (gesture, [("motion.meta.json", "descriptor", gesture), (motion_name, motion_role, motion_payload)]),
        (style, [("style.json", "descriptor", style)]),
    ):
        files = []
        for index, (name, role, value) in enumerate(documents, 1):
            path = f"entries/{document['content_id']}/{name}"
            payload = value if isinstance(value, bytes) else json.dumps(value).encode()
            payloads[path] = payload
            files.append(
                {
                    "archive_path": path,
                    "relative_path": name,
                    "role": role,
                    "ordinal": index,
                    "media_type": "model/gltf-binary" if name.endswith(".vrma") else "application/json",
                    "size_bytes": len(payload),
                    "sha256": hashlib.sha256(payload).hexdigest(),
                }
            )
        manifest["entries"].append(
            {
                "package_entry_id": document["content_id"],
                "kind": document["content_type"],
                "logical_key": document["content_id"],
                "display_name": document["name"],
                "portable_revision_sha256": portable_revision(files),
                "dependencies": document["dependencies"],
                "files": files,
            }
        )
    archive = tmp_path / "idle.animama"
    write_package(archive, manifest, payloads)
    if accepted:
        assert set(inspector(tmp_path).inspect(archive, destination=tmp_path / "inspection").entries) == {
            "style",
            "motion",
        }
    else:
        with pytest.raises(ContentConflictError, match="idle_repetitions_invalid"):
            inspector(tmp_path).inspect(archive, destination=tmp_path / "inspection")
        assert not (tmp_path / "inspection").exists()


@pytest.mark.parametrize("motion_count,file_role", [(0, None), (0, "descriptor"), (2, None)])
def test_ordinary_gesture_requires_one_registered_implementation_motion(
    tmp_path: Path, motion_count: int, file_role: str | None
) -> None:
    from tests.test_content_gltf import _fixture_document, _glb_source

    gltf, binary = _fixture_document(buffer_uri=None)
    motion = _glb_source(gltf, binary)
    document: dict[str, Any] = {
        "schema_version": 1,
        "content_type": "gesture",
        "content_id": "motion",
        "name": "Motion",
        "implementation": {"kind": "vrma"},
        "semantic_key": "motion",
        "dependencies": [],
        "files": [{"path": f"motion-{index}.vrma", "role": "animation"} for index in range(motion_count)],
    }
    if file_role is not None:
        document["implementation"]["file_role"] = file_role
    payloads = {"entries/motion/motion.meta.json": json.dumps(document).encode()}
    payloads.update({f"entries/motion/motion-{index}.vrma": motion for index in range(motion_count)})
    files = [
        {
            "archive_path": path,
            "relative_path": Path(path).name,
            "role": "descriptor" if path.endswith("json") else "animation",
            "ordinal": index,
            "media_type": "application/json" if path.endswith("json") else "model/gltf-binary",
            "size_bytes": len(payload),
            "sha256": hashlib.sha256(payload).hexdigest(),
        }
        for index, (path, payload) in enumerate(payloads.items(), 1)
    ]
    manifest = {
        "schema": "animama-content-package/3",
        "kind": "content",
        "root_entry_ids": ["motion"],
        "entries": [
            {
                "package_entry_id": "motion",
                "kind": "gesture",
                "logical_key": "motion",
                "display_name": "Motion",
                "portable_revision_sha256": portable_revision(files),
                "dependencies": [],
                "files": files,
            }
        ],
        "avatar_portraits": [],
        "capabilities": ["VRMC_vrm_animation/1.0"] if motion_count else [],
    }
    archive = tmp_path / "ambiguous.animama"
    write_package(archive, manifest, payloads)
    with pytest.raises(ContentConflictError):
        inspector(tmp_path).inspect(archive, destination=tmp_path / "inspection")


def with_zip64_directory(archive: Path, *, classic_sentinels: bool = False) -> int:
    """Add a real ZIP64 locator, independently of the classic EOCD's hints."""
    raw = archive.read_bytes()
    end = raw.rindex(b"PK\x05\x06")
    _, _, _, disk_count, count, directory_size, directory_offset, _ = struct.unpack("<4s4H2IH", raw[end:])
    zip64 = struct.pack(
        "<4sQ2H2I4Q", b"PK\x06\x06", 44, 45, 45, 0, 0, disk_count, count, directory_size, directory_offset
    )
    locator = struct.pack("<4sIQI", b"PK\x06\x07", 0, end, 1)
    classic = struct.pack(
        "<4s4H2IH",
        b"PK\x05\x06",
        0,
        0,
        0xFFFF if classic_sentinels else 0,
        0xFFFF if classic_sentinels else 0,
        0xFFFFFFFF if classic_sentinels else 0,
        0xFFFFFFFF if classic_sentinels else 0,
        0,
    )
    archive.write_bytes(raw[:end] + zip64 + locator + classic)
    return int(directory_size)


@pytest.mark.parametrize("limit", ["directory", "files"])
def test_zip64_limits_are_checked_before_zipfile_allocation_without_classic_sentinels(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, limit: str
) -> None:
    from animama.app.services import content_package_archive as reader

    manifest, payloads = sound_package()
    archive = tmp_path / "zip64.animama"
    write_package(archive, manifest, payloads)
    directory_size = with_zip64_directory(archive)
    if limit == "directory":
        monkeypatch.setattr(reader, "MAX_ZIP_DIRECTORY_BYTES", directory_size - 1)
    else:
        monkeypatch.setattr(reader, "MAX_PACKAGE_FILES", 1)

    def parser_must_not_run(*args: Any, **kwargs: Any) -> None:
        raise AssertionError("ZIP parser reached before authoritative ZIP64 metadata admission")

    monkeypatch.setattr(reader, "ZipFile", parser_must_not_run)
    with pytest.raises(ContentConflictError, match="package_zip_directory_budget"):
        ContentPackageArchive.expanded_size(archive)
    with pytest.raises(ContentConflictError, match="package_zip_directory_budget"):
        inspector(tmp_path).inspect(archive, destination=tmp_path / "inspection")
    assert not (tmp_path / "inspection").exists()


@pytest.mark.parametrize("sentinels", [False, True])
def test_supported_zip64_directory_inspects_normally(tmp_path: Path, sentinels: bool) -> None:
    manifest, payloads = sound_package()
    archive = tmp_path / "zip64.animama"
    write_package(archive, manifest, payloads)
    with_zip64_directory(archive, classic_sentinels=sentinels)
    assert ContentPackageArchive.expanded_size(archive) == len(json.dumps(manifest).encode()) + sum(
        map(len, payloads.values())
    )
    assert set(inspector(tmp_path).inspect(archive, destination=tmp_path / "inspection").entries) == {"sound"}


def test_actual_central_record_count_is_bounded_before_parser_allocation(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from animama.app.services import content_package_archive as reader

    manifest, payloads = sound_package()
    archive = tmp_path / "false-count.animama"
    write_package(archive, manifest, payloads)
    raw = bytearray(archive.read_bytes())
    end = raw.rindex(b"PK\x05\x06")
    struct.pack_into("<2H", raw, end + 8, 0, 0)
    archive.write_bytes(raw)
    monkeypatch.setattr(reader, "MAX_PACKAGE_FILES", 1)

    def parser_must_not_run(*args: Any, **kwargs: Any) -> None:
        raise AssertionError("ZIP parser reached despite excess actual central records")

    monkeypatch.setattr(reader, "ZipFile", parser_must_not_run)
    with pytest.raises(ContentConflictError, match="package_zip_directory_budget"):
        inspector(tmp_path).inspect(archive, destination=tmp_path / "inspection")


@pytest.mark.parametrize("valid_motion", [False, True])
def test_inferred_sequence_role_still_requires_real_clip_validation(tmp_path: Path, valid_motion: bool) -> None:
    descriptor = {
        "schema_version": 1,
        "content_type": "gesture",
        "content_id": "motion",
        "name": "Motion",
        "implementation": {"kind": "anima_clip"},
        "semantic_key": "motion",
        "dependencies": [],
    }
    clip = (
        {
            "schema": "animaPoseClip/1.0",
            "id": "motion",
            "name": "Motion",
            "duration": 1,
            "loop": False,
            "poses": {"turn": {"humanoid": {"head": {"rotationEulerDegrees": [0, 15, 0]}}}},
            "poseKeyframes": [{"time": 0, "pose": "turn"}],
            "events": [],
        }
        if valid_motion
        else {"not": "an animation"}
    )
    payloads = {
        "entries/motion/motion.meta.json": json.dumps(descriptor).encode(),
        "entries/motion/motion.json": json.dumps(clip).encode(),
    }
    files = [
        {
            "archive_path": path,
            "relative_path": Path(path).name,
            "role": "descriptor" if path.endswith("meta.json") else "sequence",
            "ordinal": index,
            "media_type": "application/json",
            "size_bytes": len(payload),
            "sha256": hashlib.sha256(payload).hexdigest(),
        }
        for index, (path, payload) in enumerate(payloads.items(), 1)
    ]
    manifest = {
        "schema": "animama-content-package/3",
        "kind": "content",
        "root_entry_ids": ["motion"],
        "entries": [
            {
                "package_entry_id": "motion",
                "kind": "gesture",
                "logical_key": "motion",
                "display_name": "Motion",
                "portable_revision_sha256": portable_revision(files),
                "dependencies": [],
                "files": files,
            }
        ],
        "avatar_portraits": [],
        "capabilities": ["animaPose/1.0", "animaPoseClip/1.0"] if valid_motion else [],
    }
    archive = tmp_path / "inferred.animama"
    write_package(archive, manifest, payloads)
    if valid_motion:
        assert set(inspector(tmp_path).inspect(archive, destination=tmp_path / "inspection").entries) == {"motion"}
    else:
        with pytest.raises(ContentConflictError):
            inspector(tmp_path).inspect(archive, destination=tmp_path / "inspection")
        assert not (tmp_path / "inspection").exists()
