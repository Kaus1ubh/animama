from __future__ import annotations

import json
from itertools import pairwise
from pathlib import Path
from typing import Any

import pytest

from tests.anima_creation_service_support import copy_tracked_included

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
    assert by_glob["poses/**/*.json"]["license_id"] == "LicenseRef-Animama-owner-authored"
    assert by_glob["gestures/**/*.json"]["license_id"] == "LicenseRef-Animama-owner-authored"
    # Mixamo motion ships only as the separate non-portable pack (see below).
    assert not any(rule["license_id"] == "LicenseRef-Adobe-Mixamo-embedded-product" for rule in rules)
    assert by_glob["vfx/scene/**/emoji-*.svg"]["license_id"] == "CC-BY-4.0-Twemoji-graphics"
    assert by_glob["vfx/particle/quark/**"]["license_id"] == "LicenseRef-Animama-generated-and-CC0-particle-VFX"


@pytest.mark.parametrize(
    ("pack_id", "license_id"),
    [
        ("mixamo-motion", "LicenseRef-Adobe-Mixamo-embedded-product"),
        ("wow-comedy-sfx", "LicenseRef-WOW-Sound-Media-embedded-product"),
    ],
)
def test_private_pack_inventories_are_public_safe_and_non_portable(pack_id: str, license_id: str) -> None:
    inventory = json.loads((ROOT / f"scripts/{pack_id}/inventory.json").read_text(encoding="utf-8"))
    manifest = json.loads((ROOT / f"src/backend/animama/resources/{pack_id}-manifest.json").read_text(encoding="utf-8"))

    assert inventory["schema_version"] == 1
    [rule] = inventory["rules"]
    # One rule matching every locator and file, so runtime and staging agree.
    assert rule["glob"] == "**"
    assert rule["distribution"] == "non-portable"
    assert rule["license_id"] == license_id
    assert rule["redistribution_review"] == "pending"
    text = json.dumps(inventory)
    assert "@" not in text and "/Users/" not in text and "X-Amz" not in text
    assert manifest["pack_id"] == pack_id
    assert all(set(item) == {"path", "size_bytes", "sha256"} for item in manifest["files"])


def test_the_preview_deny_list_holds_hashes_only() -> None:
    deny = json.loads(
        (ROOT / "src/backend/animama/resources/wow-comedy-sfx-preview-deny.json").read_text(encoding="utf-8")
    )

    assert deny["schema_version"] == 1
    assert deny["files"]
    assert all(set(item) == {"size_bytes", "sha256"} for item in deny["files"])


def test_typed_media_moved_but_browser_engine_assets_remained_public(tmp_path: Path) -> None:
    public = ROOT / "src/frontend/web/public"

    included = copy_tracked_included(tmp_path / "included")
    assert (included / "avatars/AvatarSample_A_1_New.vrm").is_file()
    assert not (included / "gestures/wave/wave.vrma").exists()
    assert not (included / "gestures/wave/wave.meta.json").exists()
    assert (ROOT / "scripts/mixamo-assets.json").is_file()
    assert not any((public / "vrm").glob("*.vrm"))
    assert not any((public / "vrm").glob("animations/*.vrma"))
    # Large ONNX inputs are external/dependency-backed; keep the reviewed manifest.
    assert (ROOT / "models/browser-runtime/manifest.json").is_file()
    assert (public / "basis").is_dir()


def test_included_tree_contains_no_symlinks_or_special_files() -> None:
    for path in (ROOT / "content/included").rglob("*"):
        assert not path.is_symlink()
        assert path.is_dir() or path.is_file()


def _included_action_metas() -> list[tuple[dict[str, Any], dict[str, Any]]]:
    """Each Included Reaction and Gesture as (meta, clip)."""
    actions = []
    for kind in ("reactions", "gestures"):
        for path in sorted((ROOT / "content/included" / kind).glob("*/*.meta.json")):
            meta = json.loads(path.read_text())
            sequence = next(file["path"] for file in meta["files"] if file["role"] == "sequence")
            actions.append((meta, json.loads((path.parent / sequence).read_text())))
    return actions


def test_no_included_action_plays_a_mouth_effect() -> None:
    """Mouth effects sit on the lip-synced mouth, so no Reaction or Gesture uses them."""
    mouth_effects = {"builtin:avatar-effect:mouth_w", "builtin:avatar-effect:mouth_hover_w"}
    users = [
        meta["content_id"]
        for meta, _clip in _included_action_metas()
        if mouth_effects & {dependency["ref"] for dependency in meta.get("dependencies", [])}
    ]
    assert users == []


def test_every_reaction_emotion_has_a_variant_with_an_avatar_effect() -> None:
    emotions: dict[str, bool] = {}
    for meta, clip in _included_action_metas():
        if meta["content_type"] != "reaction":
            continue
        emotion = meta["placement_hint"]["emotion"]
        effect_aliases = {
            dependency["alias"]
            for dependency in meta.get("dependencies", [])
            if dependency["content_type"] == "avatar_effect"
        }
        # An event must play the effect; a declared dependency alone does not count.
        has_effect = any(
            event["kind"] == "avatar_vfx" and event["effectId"] in effect_aliases for event in clip.get("events", [])
        )
        emotions[emotion] = emotions.get(emotion, False) or has_effect
    assert len(emotions) == 24
    assert [emotion for emotion, has_effect in emotions.items() if not has_effect] == []


def test_every_included_avatar_effect_has_one_optional_licensed_sound() -> None:
    """Each built-in Avatar Effect plays one sound from the private comedy pack."""

    manifest = json.loads(
        (ROOT / "src/backend/animama/resources/wow-comedy-sfx-manifest.json").read_text(encoding="utf-8")
    )
    shipped = {item["path"] for item in manifest["files"]}
    effects = sorted((ROOT / "content/included/vfx/avatar").glob("*/*.json"))
    assert effects
    for path in effects:
        document = json.loads(path.read_text(encoding="utf-8"))
        [edge] = document["dependencies"]
        assert edge["content_type"] == "sound_effect" and edge["optional"] is True, path.name
        assert document["definition"]["soundAlias"] == edge["alias"], path.name
        key = edge["ref"].removeprefix("builtin:sound-effect:")
        assert {f"sfx/wow-comedy/{key}.ogg", f"sfx/wow-comedy/{key}.meta.json"} <= shipped, path.name


def test_stacked_avatar_effects_play_one_accompanying_sound_at_a_time() -> None:
    """Effects applied together would otherwise play their sounds over each other."""

    for path in sorted((ROOT / "content/included").glob("*/*/*.json")):
        if path.parts[-3] not in {"reactions", "gestures"}:
            continue
        document = json.loads(path.read_text(encoding="utf-8"))
        events = document.get("events") if isinstance(document, dict) else None
        if not isinstance(events, list):
            continue
        audible = sorted(
            float(event.get("time", 0))
            for event in events
            if event.get("kind") == "avatar_vfx" and event.get("playAccompanyingSound", True)
        )
        assert all(later - earlier >= 0.3 for earlier, later in pairwise(audible)), path.name
