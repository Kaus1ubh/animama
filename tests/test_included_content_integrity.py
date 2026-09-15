from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).parents[1]


def test_included_license_inventory_records_the_release_gate() -> None:
    inventory = json.loads((ROOT / "content/included/licenses/inventory.json").read_text(encoding="utf-8"))

    assert inventory["schema_version"] == 1
    rules = inventory["rules"]
    assert rules
    assert all(rule["creator"] for rule in rules)
    assert all(rule["license_id"] for rule in rules)
    assert all(rule["redistribution_review"] == "pending" for rule in rules)
    assert rules[-1]["glob"] == "**/*"
    assert rules[-1]["creator"] == "Animama project owner"
    by_glob = {rule["glob"]: rule for rule in rules}
    assert by_glob["gestures/**/*.json"]["license_id"] == "LicenseRef-Animama-owner-authored"
    assert by_glob["gestures/**/*.vrma"]["license_id"] == "LicenseRef-Adobe-Mixamo-embedded-product"
    assert by_glob["gestures/**/*.vrma"].get("distribution") != "excluded"
    assert by_glob["vfx/scene/**/emoji-*.svg"]["license_id"] == "CC-BY-4.0-Twemoji-graphics"
    assert by_glob["vfx/particle/quark/**"]["license_id"] == "LicenseRef-Animama-generated-and-CC0-particle-VFX"


def test_typed_media_moved_but_browser_engine_assets_remained_public() -> None:
    public = ROOT / "src/frontend/web/public"

    assert (ROOT / "content/included/avatars/AvatarSample_A_1_New.vrm").is_file()
    assert (ROOT / "content/included/gestures/wave/wave.vrma").is_file()
    assert (ROOT / "content/included/gestures/wave/wave.meta.json").is_file()
    assert not any((public / "vrm").glob("*.vrm"))
    assert not any((public / "vrm").glob("animations/*.vrma"))
    assert (public / "onnx").is_dir()
    assert (public / "basis").is_dir()


def test_included_tree_contains_no_symlinks_or_special_files() -> None:
    for path in (ROOT / "content/included").rglob("*"):
        assert not path.is_symlink()
        assert path.is_dir() or path.is_file()
