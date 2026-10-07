"""Clip event selectors must resolve inside the reviewed typed package closure."""

from __future__ import annotations

import hashlib
import io
import json
from pathlib import Path
from typing import Any

import pytest

from animama.app.contracts.content_package import portable_revision
from animama.app.services.content_kind_registry import handler_for_kind
from animama.app.services.content_package_capabilities import derive_file_capabilities, normalized_action_selector
from animama.domain.content_catalog import ContentConflictError, ContentKind
from animama.domain.content_documents import ContentDocumentError, SceneEffectDocumentV1, TypedContentDocument
from tests.test_content_package_v3_archive import inspector, sound_package, write_package

EVENTS = {
    "sfx": ("cueId", "sound_effect"),
    "avatar_vfx": ("effectId", "avatar_effect"),
    "scene_vfx": ("presetId", "scene_effect"),
    "particle_vfx": ("effectId", "particle_effect"),
}


def _clip(kind: str, selector: str) -> dict[str, Any]:
    field, _ = EVENTS[kind]
    event = {"id": "event", "time": 0, "kind": kind, field: selector}
    if kind == "scene_vfx":
        event["sceneKind"] = "focus_lines"
    return {
        "schema": "animaPoseClip/1.0",
        "id": "clip",
        "name": "Clip",
        "duration": 1,
        "poses": {},
        "poseKeyframes": [],
        "events": [event],
    }


def _derive(
    kind: str, selector: str, dependencies: list[dict[str, Any]], *, include_target_documents: bool = True
) -> tuple[str, ...]:
    raw = {
        "schema_version": 1,
        "content_type": "gesture",
        "content_id": "action",
        "name": "Action",
        "implementation": {"kind": "anima_clip", "file_role": "sequence"},
        "dependencies": dependencies,
        "files": [{"path": "clip.json", "role": "sequence"}],
    }
    document = (
        handler_for_kind(ContentKind.GESTURE)
        .parse_document(
            raw,
            fallback_path=Path("action.meta.json"),
            descriptor_backed=True,
        )
        .document
    )
    documents: dict[str, TypedContentDocument] = {
        edge["ref"]: SceneEffectDocumentV1(
            kind=ContentKind.SCENE_EFFECT,
            name="Target",
            definition={"schema": "animama/scene-effect/1", "kind": "focus_lines"},
        )
        for edge in dependencies
        if edge["content_type"] == "scene_effect"
    }
    return derive_file_capabilities(
        document.kind,
        document,
        "clip.json",
        io.BytesIO(json.dumps(_clip(kind, selector)).encode()),
        documents=documents if include_target_documents else None,
    )


@pytest.mark.parametrize("kind", EVENTS)
@pytest.mark.parametrize("selector_form", ["alias", "ref", "padded-alias", "padded-ref"])
def test_events_resolve_exact_typed_alias_or_portable_reference(kind: str, selector_form: str) -> None:
    _, dependency_kind = EVENTS[kind]
    selector = "selected" if selector_form.endswith("alias") else "dependency"
    if selector_form.startswith("padded-"):
        selector = f" \ufeff{selector}\n"
    result = _derive(kind, selector, [{"ref": "dependency", "alias": "selected", "content_type": dependency_kind}])
    assert set(result) == {"animaPose/1.0", "animaPoseClip/1.0"}


@pytest.mark.parametrize("kind", EVENTS)
@pytest.mark.parametrize("case", ["missing", "wrong-kind", "duplicate-alias", "alias-shadows-ref"])
def test_events_cannot_resolve_missing_mistyped_or_ambiguous_targets(kind: str, case: str) -> None:
    _, dependency_kind = EVENTS[kind]
    wrong_kind = "avatar_effect" if dependency_kind == "sound_effect" else "sound_effect"
    dependencies: list[dict[str, Any]] = [{"ref": "dependency", "alias": "selected", "content_type": dependency_kind}]
    if case == "missing":
        dependencies = []
    elif case == "wrong-kind":
        dependencies[0]["content_type"] = wrong_kind
    elif case == "duplicate-alias":
        dependencies.append({"ref": "another", "alias": "selected", "content_type": wrong_kind})
    else:
        dependencies.append({"ref": "selected", "content_type": dependency_kind})
    with pytest.raises(ContentDocumentError, match="selector"):
        _derive(kind, "selected", dependencies)


@pytest.mark.parametrize("selector", ["local:sound:sender-only", "bright_idea_01"])
def test_local_or_builtin_looking_names_cannot_bypass_bundled_sound_dependency(selector: str) -> None:
    with pytest.raises(ContentDocumentError, match="selector"):
        _derive("sfx", selector, [])


def _event_package(case: str) -> tuple[dict[str, Any], dict[str, bytes]]:
    manifest, payloads = sound_package()
    deps = [{"ref": "sound", "alias": "tone", "content_type": "sound_effect"}]
    kind, selector = "sfx", "tone"
    if case == "missing":
        deps = []
        selector = "local:sound:sender-only"
        manifest["entries"] = []
        payloads = {}
    elif case == "wrong-kind":
        kind = "particle_vfx"
    elif case in {"ref", "padded-ref"}:
        selector = "sound"
    if case.startswith("padded-"):
        selector = f" \t\ufeff{selector}\u00a0\n"
    document = {
        "schema_version": 1,
        "content_type": "gesture",
        "content_id": "action",
        "name": "Action",
        "semantic_key": "action",
        "implementation": {"kind": "anima_clip", "file_role": "sequence"},
        "dependencies": deps,
        "files": [{"path": "clip.json", "role": "sequence"}],
    }
    files: list[dict[str, Any]] = []
    for name, role, value in [
        ("action.meta.json", "descriptor", document),
        ("clip.json", "sequence", _clip(kind, selector)),
    ]:
        archive_path = f"entries/action/{name}"
        payload = json.dumps(value).encode()
        payloads[archive_path] = payload
        files.append(
            {
                "archive_path": archive_path,
                "relative_path": name,
                "role": role,
                "ordinal": len(files) + 1,
                "media_type": "application/json",
                "size_bytes": len(payload),
                "sha256": hashlib.sha256(payload).hexdigest(),
            }
        )
    manifest["entries"].append(
        {
            "package_entry_id": "action",
            "kind": "gesture",
            "logical_key": "action",
            "display_name": "Action",
            "portable_revision_sha256": portable_revision(files),
            "dependencies": [{"ref": edge["ref"], "content_type": edge["content_type"]} for edge in deps],
            "files": files,
        }
    )
    manifest["root_entry_ids"] = ["action"]
    manifest["capabilities"] = ["animaPose/1.0", "animaPoseClip/1.0"]
    return manifest, payloads


@pytest.mark.parametrize("case", ["missing", "wrong-kind"])
def test_full_inspection_rejects_unresolved_event_and_discards_private_tree(tmp_path: Path, case: str) -> None:
    manifest, payloads = _event_package(case)
    archive = tmp_path / "unresolved.zip"
    write_package(archive, manifest, payloads)
    destination = tmp_path / "inspection"
    with pytest.raises(ContentConflictError, match="package_definition_invalid"):
        inspector(tmp_path).inspect(archive, destination=destination)
    assert not destination.exists()
    assert not (tmp_path / "local").exists()


@pytest.mark.parametrize("case", ["alias", "ref", "padded-alias", "padded-ref"])
def test_full_inspection_accepts_event_with_matching_bundled_dependency(tmp_path: Path, case: str) -> None:
    manifest, payloads = _event_package(case)
    archive = tmp_path / "complete.zip"
    write_package(archive, manifest, payloads)
    assert set(inspector(tmp_path).inspect(archive, destination=tmp_path / "inspection").entries) == {"sound", "action"}


@pytest.mark.parametrize("padding", [" \t\n", "\ufeff", "\u00a0", "\u2007", "\u2028\u2029"])
def test_selector_normalization_matches_javascript_trim(padding: str) -> None:
    assert normalized_action_selector(f"{padding}tone{padding}") == "tone"


def test_selector_normalization_preserves_non_ecmascript_whitespace() -> None:
    assert normalized_action_selector("\u0085tone\u0085") == "\u0085tone\u0085"


def test_scene_event_cannot_claim_compatibility_without_the_actual_target_document() -> None:
    with pytest.raises(ContentDocumentError, match="primitive"):
        _derive(
            "scene_vfx",
            "scene",
            [{"ref": "target", "alias": "scene", "content_type": "scene_effect"}],
            include_target_documents=False,
        )


@pytest.mark.parametrize("selector", ["", " \ufeff\n"])
def test_empty_selector_after_runtime_normalization_is_rejected(selector: str) -> None:
    with pytest.raises(ContentDocumentError, match="selector"):
        normalized_action_selector(selector)


def _scene_package(
    target_kind: str, requested_kind: str, selector: str = "scene"
) -> tuple[dict[str, Any], dict[str, bytes]]:
    manifest, payloads = _event_package("alias")
    fixture = json.loads(
        (Path(__file__).parents[1] / "src/frontend/web/src/lib/content/fixtures/package-capabilities.json").read_text()
    )
    definition = next(
        value["definition"] for value in fixture["effects"] if value["definition"].get("kind") == target_kind
    )
    if target_kind == "background_layers":
        definition["marquee"]["items"] = []
    scene = {
        "schema_version": 1,
        "content_type": "scene_effect",
        "content_id": "target",
        "name": "Target",
        "definition": definition,
        "dependencies": [],
        "files": [],
    }
    for member in manifest["entries"][0]["files"]:
        del payloads[member["archive_path"]]
    scene_path = "entries/target/target.json"
    payloads[scene_path] = json.dumps(scene).encode()
    manifest["entries"][0] = {
        "package_entry_id": "target",
        "kind": "scene_effect",
        "logical_key": "target",
        "display_name": "Target",
        "dependencies": [],
        "files": [
            {
                "archive_path": scene_path,
                "relative_path": "target.json",
                "role": "descriptor",
                "ordinal": 1,
                "media_type": "application/json",
            }
        ],
    }
    action = json.loads(payloads["entries/action/action.meta.json"])
    action["dependencies"] = [{"ref": "target", "alias": "scene", "content_type": "scene_effect"}]
    payloads["entries/action/action.meta.json"] = json.dumps(action).encode()
    clip = _clip("scene_vfx", selector)
    clip["events"][0]["sceneKind"] = requested_kind
    payloads["entries/action/clip.json"] = json.dumps(clip).encode()
    manifest["entries"][1]["dependencies"] = [{"ref": "target", "content_type": "scene_effect"}]
    for entry in manifest["entries"]:
        for member in entry["files"]:
            payload = payloads[member["archive_path"]]
            member["size_bytes"] = len(payload)
            member["sha256"] = hashlib.sha256(payload).hexdigest()
        entry["portable_revision_sha256"] = portable_revision(entry["files"])
    manifest["capabilities"].append("animama/scene-effect/1")
    return manifest, payloads


@pytest.mark.parametrize(
    "target_kind,requested_kind", [("focus_lines", "background_layers"), ("background_layers", "focus_lines")]
)
def test_full_inspection_rejects_scene_selector_for_wrong_actual_primitive(
    tmp_path: Path, target_kind: str, requested_kind: str
) -> None:
    manifest, payloads = _scene_package(target_kind, requested_kind)
    archive = tmp_path / "wrong-scene.zip"
    write_package(archive, manifest, payloads)
    with pytest.raises(ContentConflictError, match="package_definition_invalid"):
        inspector(tmp_path).inspect(archive, destination=tmp_path / "inspection")
    assert not (tmp_path / "inspection").exists()


@pytest.mark.parametrize("kind", ["focus_lines", "background_layers"])
@pytest.mark.parametrize("selector", ["scene", "target", " \tscene\n", " \ttarget\n"])
def test_full_inspection_checks_actual_scene_primitive_after_selector_normalization(
    tmp_path: Path, kind: str, selector: str
) -> None:
    manifest, payloads = _scene_package(kind, kind, selector)
    archive = tmp_path / "scene.zip"
    write_package(archive, manifest, payloads)
    assert set(inspector(tmp_path).inspect(archive, destination=tmp_path / "inspection").entries) == {
        "action",
        "target",
    }
