from __future__ import annotations

import json
import shutil
import subprocess
import wave
from dataclasses import replace
from pathlib import Path

import pytest

from animama.app.services.typed_content_service import TypedContentAdmissionError
from animama.domain.content_catalog import ContentKind, ContentSource, ContentStatus, ScannedContentEntry
from animama.runtime.starter_content import _regular_path, catalog_from_scan, starter_inventory


@pytest.fixture(scope="module")
def staged_core(tmp_path_factory: pytest.TempPathFactory) -> Path:
    repo = Path(__file__).resolve().parents[1]
    source = repo / "content/included"
    # Match the production stage, including on developers' checkouts with private SFX.
    tracked = subprocess.check_output(["git", "ls-files", "-z", "--", "content/included"], cwd=repo)
    allowed = {name.removeprefix("content/included/") for name in tracked.decode().split("\0") if name}
    inventory = starter_inventory(source, allowed_paths=allowed)
    # Check both partitions, including companion metadata and thumbnails. The
    # policy excludes downloaded examples without removing starter portraits.
    excluded_prefixes = ("sfx/", "voices/", "music/", "appearances/tokyo-", "appearances/thumbs/tokyo-")
    assert not any(file["path"].startswith(excluded_prefixes) for file in inventory["files"])
    assert not any("avatarchibi_2" in file["path"].lower() for file in inventory["files"])
    assert not any("avatarchibi-2" in file["path"].lower() for file in inventory["files"])
    assert not any("avatarsample_r2" in file["path"].lower() for file in inventory["files"])
    assert not any("avatarsample-r2" in file["path"].lower() for file in inventory["files"])
    excluded_examples = {
        "avatars/AvatarChibi_2.vrm",
        "appearances/avatar-portraits/app-avatar-model-avatarchibi-2-v1.webp",
        "avatars/AvatarSample_R2.vrm",
        "appearances/avatar-portraits/app-avatar-model-avatarsample-r2-v1.webp",
        "voices/melina_original.mp3",
        "voices/donald-trump.wav",
        "music/bgm_sample_1.mp3",
        "appearances/tokyo-day.png",
        "appearances/thumbs/tokyo-day.jpg",
    }
    # A public checkout has already omitted these private inputs. When present
    # in a maintainer checkout they must still be rejected from both partitions.
    assert excluded_examples & allowed <= {
        entry["locator"] for entry in inventory["excluded"] if entry["reason"] == "redistribution_excluded"
    }
    root = tmp_path_factory.mktemp("desktop-starter-core")
    for file in inventory["files"]:
        if file["partition"] != "core":
            continue
        destination = root / file["path"]
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source / file["path"], destination)
    (root / "licenses").mkdir()
    shutil.copyfile(source / "licenses/inventory.json", root / "licenses/inventory.json")
    return root


def test_actual_core_resolves_both_starters_without_expanded_content(staged_core: Path) -> None:
    inventory = starter_inventory(staged_core)
    assert [starter["name"] for starter in inventory["starters"]] == ["Annie", "Caitlyn"]
    assert all(not starter["diagnostics"] for starter in inventory["starters"])
    assert "avatars/AvatarSample_R1.vrm" in inventory["starters"][1]["roots"]
    assert "builtin:avatar-portrait:AvatarSample_R1" in inventory["starters"][1]["roots"]
    assert all(file["partition"] == "core" for file in inventory["files"])
    assert all(
        not entry["dependencies"] or set(entry["dependencies"]) <= {e["locator"] for e in inventory["entries"]}
        for entry in inventory["entries"]
    )
    assert not inventory["excluded"]
    assert starter_inventory(staged_core)["id"] == inventory["id"]


def test_missing_required_dependency_fails_instead_of_trimming_a_starter(staged_core: Path) -> None:
    allowed = {
        p.relative_to(staged_core).as_posix()
        for p in staged_core.rglob("*")
        if p.is_file() and not p.relative_to(staged_core).as_posix().startswith("idle-styles/starter/")
    }
    with pytest.raises(TypedContentAdmissionError, match="source_unavailable"):
        starter_inventory(staged_core, allowed_paths=allowed)


def test_missing_license_record_is_a_hard_failure(staged_core: Path, tmp_path: Path) -> None:
    root = tmp_path / "included"
    shutil.copytree(staged_core, root)
    (root / "licenses/inventory.json").write_text(json.dumps({"rules": []}))
    with pytest.raises(ValueError, match="Missing license record"):
        starter_inventory(root)


def test_excluded_required_avatar_fails_instead_of_entering_either_pack(staged_core: Path, tmp_path: Path) -> None:
    root = tmp_path / "included"
    shutil.copytree(staged_core, root)
    license_path = root / "licenses/inventory.json"
    policy = json.loads(license_path.read_text())
    policy["rules"].insert(
        0,
        {
            "glob": "avatars/AvatarSample_R1.vrm",
            "license_id": "test-excluded",
            "provenance": "Explicitly excluded test input",
            "distribution": "excluded",
        },
    )
    license_path.write_text(json.dumps(policy))
    with pytest.raises(TypedContentAdmissionError, match="source_unavailable"):
        starter_inventory(root)


def test_excluded_optional_audio_never_enters_either_pack(staged_core: Path, tmp_path: Path) -> None:
    """Prove exclusion with generated bytes even when all private examples are absent."""

    root = tmp_path / "included"
    shutil.copytree(staged_core, root)
    (root / "voices").mkdir()
    with wave.open(str(root / "voices/excluded-fixture.wav"), "wb") as audio:
        audio.setparams((1, 2, 8_000, 0, "NONE", "not compressed"))
        audio.writeframes(b"\0\0" * 800)

    inventory = starter_inventory(root)

    assert {"locator": "voices/excluded-fixture.wav", "reason": "redistribution_excluded"} in inventory["excluded"]
    assert not any(file["path"].startswith("voices/") for file in inventory["files"])


def test_logical_identity_collisions_are_not_resolved_by_filename_order() -> None:
    first = ScannedContentEntry(
        ContentSource.INCLUDED,
        ContentKind.GESTURE,
        "gestures/a.vrma",
        "A",
        ContentStatus.VALID,
        "a" * 64,
        logical_key="builtin:gesture:a",
    )
    with pytest.raises(ValueError, match="Colliding Included identity"):
        catalog_from_scan([first, replace(first, relative_locator="gestures/b.vrma")])


def test_special_and_escaping_files_never_enter_a_content_inventory(tmp_path: Path) -> None:
    (tmp_path / "file").write_text("content")
    (tmp_path / "link").symlink_to(tmp_path / "file")
    for candidate in ("../file", "/file", "link", "x\\file"):
        with pytest.raises(ValueError):
            _regular_path(tmp_path, candidate)
