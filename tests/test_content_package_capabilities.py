"""Compatibility declarations describe actual renderer-consumable package data."""

from __future__ import annotations

import io
import json
import struct
from pathlib import Path
from typing import Any

import pytest

from animama.app.services.content_kind_registry import CONTENT_KIND_REGISTRY
from animama.app.services.content_package_capabilities import (
    BUILTIN_POSES,
    derive_capabilities,
    derive_document_capabilities,
    derive_file_capabilities,
    validate_avatar_effect_document,
    validate_capabilities,
    validate_declared_capabilities,
)
from animama.domain.content_catalog import ContentKind
from animama.domain.content_documents import AvatarEffectDocumentV1, ContentDocumentError, TypedContentDocument

FRONTEND = Path(__file__).parents[1] / "src/frontend/web/src/lib"
FIXTURES = json.loads((FRONTEND / "content/fixtures/package-capabilities.json").read_text())


def _document(kind: str, **values: object) -> TypedContentDocument:
    return (
        CONTENT_KIND_REGISTRY.handler_for(ContentKind(kind))
        .parse_document(
            {"schema_version": 1, "content_type": kind, "name": "Shared", **values},
            fallback_path=Path("shared.json"),
            descriptor_backed=True,
        )
        .document
    )


@pytest.mark.parametrize("capability", ["unknown/1", "animaPoseClip/3.0", "animama/avatar-effect/3"])
def test_rejects_unavailable_renderer_before_install(capability: str) -> None:
    with pytest.raises(ContentDocumentError, match="capability"):
        validate_declared_capabilities([capability])


def test_v1_avatar_effect_package_is_refused_with_the_conversion_hint() -> None:
    with pytest.raises(ContentDocumentError) as raised:
        validate_declared_capabilities(["animama/avatar-effect/1"])
    assert raised.value.code == "avatar_effect_conversion_required"
    # A package cannot be converted in place; it must be exported again after conversion.
    assert "export the package again" in str(raised.value)
    assert "convert_avatar_effects.py" not in str(raised.value)


def test_declarations_must_match_actual_requirements() -> None:
    with pytest.raises(ContentDocumentError):
        validate_capabilities([], ["animaPoseClip/2.0"])
    with pytest.raises(ContentDocumentError):
        validate_declared_capabilities(["animaPoseClip/2.0", "animaPoseClip/2.0"])
    validate_capabilities(["animaPoseClip/2.0"], ["animaPoseClip/2.0"])


def test_retired_clip_format_package_is_refused_with_its_reason() -> None:
    with pytest.raises(ContentDocumentError) as raised:
        validate_declared_capabilities(["animaPoseClip/1.0"])
    assert raised.value.code == "clip_format_unsupported"
    assert "retired animaPoseClip/1.0 format" in str(raised.value)


@pytest.mark.parametrize("schema", ["animaPoseClip/1.0", "animaPoseClip/3.0", None])
def test_clip_files_in_other_formats_are_refused(schema: str | None) -> None:
    document = _document(
        "gesture",
        implementation={"kind": "anima_clip", "file_role": "sequence"},
        files=[{"path": "action.json", "role": "sequence"}],
    )
    data = {"id": "a", "name": "A", "poses": {}, "poseKeyframes": [], **({"schema": schema} if schema else {})}
    with pytest.raises(ContentDocumentError) as raised:
        derive_file_capabilities(document.kind, document, "action.json", io.BytesIO(json.dumps(data).encode()))
    assert raised.value.code == "clip_format_unsupported"
    assert "Only animaPoseClip/2.0 clips" in str(raised.value)


@pytest.mark.parametrize("fixture", FIXTURES["effects"])
def test_shared_effect_definitions_derive_real_versions(fixture: dict[str, Any]) -> None:
    document = _document(fixture["kind"], definition=fixture["definition"], files=fixture["files"])
    assert derive_document_capabilities(document) == (fixture["definition"]["schema"],)


def test_fixtures_cover_every_current_avatar_effect_kind() -> None:
    shapes = set()
    for fixture in FIXTURES["effects"]:
        if fixture["kind"] != "avatar_effect":
            continue
        attachment = fixture["definition"]["attachment"]
        variant = attachment.get("landmark") or attachment.get("area")
        if attachment["kind"] == "face_surface" and attachment["area"] in {"undereye", "blush"}:
            variant = attachment["layout"]
        shapes.add((attachment["kind"], variant))
    # One fixture per /1 kind the creator could write, in its /2 form, plus each attachment new in /2.
    assert shapes == {
        ("body", None),
        ("sticker", None),
        ("silhouette", None),
        ("face_landmark", "eyes"),
        ("face_landmark", "mouth"),
        ("face_landmark", "forehead"),
        ("face_surface", "single"),
        ("face_surface", "span"),
        ("face_surface", "mouth"),
        ("face_surface", "eyes"),
    }


def _avatar_fixture(**selector: str) -> dict[str, Any]:
    return next(
        fixture
        for fixture in FIXTURES["effects"]
        if fixture["kind"] == "avatar_effect"
        and all(fixture["definition"]["attachment"].get(key) == value for key, value in selector.items())
    )


@pytest.mark.parametrize(
    ("selector", "mutation", "field"),
    [
        (
            {"landmark": "forehead"},
            {"attachment": {"kind": "face_landmark", "landmark": "forehead", "position": "behind"}},
            "definition.attachment.position",
        ),
        (
            {"landmark": "eyes"},
            {"faceOptions": {"forceBlink": "yes"}},
            "definition.faceOptions.forceBlink",
        ),
        ({"landmark": "eyes"}, {"glow": True}, "definition.glow"),
        (
            {"landmark": "eyes"},
            {"faceOptions": {"hideParts": ["eye_iris", "tongue"]}},
            "definition.faceOptions.hideParts[1]",
        ),
        (
            {"area": "eyes"},
            {
                "attachment": {
                    "kind": "face_surface",
                    "part": "eye_iris",
                    "area": "eyes",
                    "layout": "single",
                    "mode": "erase",
                }
            },
            "definition.attachment.mode",
        ),
        ({"area": "eyes"}, {"art": {"image": "missing.png"}}, "definition.art.image"),
        (
            {"area": "eyes"},
            {"art": {"image": "star.png", "otherEyeImage": "missing.png"}},
            "definition.art.otherEyeImage",
        ),
        ({"area": "eyes"}, {"schema": "animama/avatar-effect/9"}, "definition.schema"),
        (
            {"area": "eyes"},
            {"attachment": {"kind": "face_surface", "part": "eye_iris", "area": "eyes", "offset": {"x": "far"}}},
            "definition.attachment.offset.x",
        ),
        (
            {"area": "eyes"},
            {"attachment": {"kind": "face_surface", "part": "eye_iris", "area": "eyes", "layout": "span", "skew": 1}},
            "definition.attachment.skew",
        ),
        ({"layout": "span"}, {"motion": {"drift": {"x": 0, "z": 1}}}, "definition.motion.drift.z"),
        (
            {"area": "mouth"},
            {"attachment": {"kind": "face_surface", "part": "face_skin", "area": "chin"}},
            "definition.attachment.area",
        ),
        ({"area": "mouth"}, {"soundAlias": "boop"}, "definition.soundAlias"),
        ({"area": "eyes"}, {"emotions": [{"emotion": "joy", "value": 0}]}, "definition.emotions"),
        ({"area": "eyes"}, {"appearance": {"tint": "red"}}, "definition.appearance.tint"),
        (
            {"area": "eyes"},
            {"art": {"image": "star.png", "flipbook": {"columns": 2, "rows": 2, "frames": 5, "fps": 12}}},
            "definition.art.flipbook.frames",
        ),
        (
            {"area": "eyes"},
            {"motion": {"keyframes": {"frames": [{"t": 1}, {"t": 0.5}]}}},
            "definition.motion.keyframes.frames",
        ),
        ({"area": "eyes"}, {"region": "body"}, "definition.region"),
    ],
)
def test_avatar_effect_validation_names_the_offending_field(
    selector: dict[str, str], mutation: dict[str, Any], field: str
) -> None:
    fixture = _avatar_fixture(**selector)
    document = _document(fixture["kind"], definition={**fixture["definition"], **mutation}, files=fixture["files"])
    assert isinstance(document, AvatarEffectDocumentV1)
    with pytest.raises(ContentDocumentError) as raised:
        validate_avatar_effect_document(document, code="avatar_effect_definition_invalid")
    assert raised.value.code == "avatar_effect_definition_invalid"
    assert raised.value.field == field
    # Package export keeps its existing code and reports the same field path.
    with pytest.raises(ContentDocumentError) as exported:
        derive_document_capabilities(document)
    assert exported.value.code == "package_definition_invalid"
    assert exported.value.field == field


def test_avatar_effect_v1_definition_requires_conversion() -> None:
    fixture = _avatar_fixture(landmark="forehead")
    legacy = {"schema": "animama/avatar-effect/1", "kind": "hover", "hoverKind": "box_hover", "image": "angry.png"}
    document = _document(fixture["kind"], definition=legacy, files=fixture["files"])
    with pytest.raises(ContentDocumentError) as raised:
        derive_document_capabilities(document)
    assert raised.value.code == "avatar_effect_conversion_required"
    assert raised.value.field == "definition.schema"


def test_avatar_effect_other_eye_image_must_be_registered() -> None:
    fixture = _avatar_fixture(landmark="eyes")
    definition = {**fixture["definition"], "art": {"image": "eye.png", "otherEyeImage": "eye-left.png"}}
    document = _document(fixture["kind"], definition=definition, files=fixture["files"])
    with pytest.raises(ContentDocumentError) as raised:
        derive_document_capabilities(document)
    assert raised.value.field == "definition.art.otherEyeImage"
    registered = _document(
        fixture["kind"],
        definition=definition,
        files=[*fixture["files"], {"path": "eye-left.png", "role": "image"}],
    )
    assert derive_document_capabilities(registered) == ("animama/avatar-effect/2",)


def test_unknown_primitive_cannot_hide_behind_supported_schema() -> None:
    fixture = FIXTURES["effects"][0]
    definition = {**fixture["definition"], "attachment": {"kind": "custom_shader"}}
    document = _document(fixture["kind"], definition=definition, files=fixture["files"])
    with pytest.raises(ContentDocumentError):
        derive_document_capabilities(document)


@pytest.mark.parametrize("filename", ["compatibility-valid.json", "compatibility-advanced-valid.json"])
def test_quarks_uses_same_fixtures_as_real_runtime_deserializer(filename: str) -> None:
    document = _document("particle_effect", files=[{"path": "particle.json", "role": "manifest"}])
    payload = (FRONTEND / "avatar/particle-vfx/fixtures" / filename).read_bytes()
    assert derive_file_capabilities(document.kind, document, "particle.json", io.BytesIO(payload)) == (
        "three.quarks/3.0",
    )


def test_particle_unknown_behavior_cannot_silently_fallback() -> None:
    document = _document("particle_effect", files=[{"path": "particle.json", "role": "manifest"}])
    data = json.loads((FRONTEND / "avatar/particle-vfx/fixtures/compatibility-valid.json").read_text())
    data["object"]["children"][0]["ps"]["behaviors"] = [{"type": "RunJavaScript", "code": "alert(1)"}]
    with pytest.raises(ContentDocumentError):
        derive_file_capabilities(document.kind, document, "particle.json", io.BytesIO(json.dumps(data).encode()))


@pytest.mark.parametrize("behavior", [{"type": "point"}, {"type": "ColorOverLife", "color": {"type": "unknown"}}])
def test_particle_behavior_discriminator_is_not_a_generic_type_allowlist(behavior: dict[str, Any]) -> None:
    document = _document("particle_effect", files=[{"path": "particle.json", "role": "manifest"}])
    data = json.loads((FRONTEND / "avatar/particle-vfx/fixtures/compatibility-valid.json").read_text())
    data["object"]["children"][0]["ps"]["behaviors"] = [behavior]
    with pytest.raises(ContentDocumentError):
        derive_file_capabilities(document.kind, document, "particle.json", io.BytesIO(json.dumps(data).encode()))


def test_registered_particle_texture_required_even_for_local_looking_paths() -> None:
    document = _document("particle_effect", files=[{"path": "particle.json", "role": "manifest"}])
    data = json.loads((FRONTEND / "avatar/particle-vfx/fixtures/compatibility-valid.json").read_text())
    data["images"] = [{"uuid": "missing-image", "url": "textures/missing.png"}]
    with pytest.raises(ContentDocumentError):
        derive_file_capabilities(document.kind, document, "particle.json", io.BytesIO(json.dumps(data).encode()))


def test_clip_timeline_and_lifetime_use_renderer_grammar(tmp_path: Path) -> None:
    data = json.loads((FRONTEND / "avatar/poses/animaPoseClip/fixtures/compatibility-valid-v2.json").read_text())
    data["playback"] = {"lifetime": {"kind": "whileAvatarState", "states": ["gesture"], "scope": "activeRun"}}
    data["events"] = [
        {
            "id": "avatar-vfx",
            "time": 0.1,
            "kind": "avatar_vfx",
            "effectId": "star",
            "duration": 0.4,
            "envelope": {"intensity": {"from": 0, "to": 1, "fadeIn": 0.1, "fadeOut": 0.1, "easing": "linear"}},
            "parameterKeyframes": [{"time": 0, "values": {"intensity": 0}}, {"time": 0.4, "values": {"intensity": 1}}],
        },
        {"id": "scene-vfx", "time": 0.2, "kind": "scene_vfx", "sceneKind": "focus_lines", "presetId": "light-streak"},
        {
            "id": "particle-vfx",
            "time": 0.3,
            "kind": "particle_vfx",
            "effectId": "twinkle-shimmer",
            "anchor": "head",
            "followAnchor": True,
            "transform": {
                "offset": {"y": 0.2},
                "depthOffset": 0.1,
                "rotation": {"z": 0.25},
                "scale": {"x": 1, "y": 1, "z": 1},
            },
        },
        {"id": "sfx", "time": 0.4, "kind": "sfx", "cueId": "bright_idea_01", "volume": 0.8},
    ]
    dependencies = []
    for event in data["events"]:
        key, kind = {
            "sfx": ("cueId", "sound_effect"),
            "avatar_vfx": ("effectId", "avatar_effect"),
            "scene_vfx": ("presetId", "scene_effect"),
            "particle_vfx": ("effectId", "particle_effect"),
        }[event["kind"]]
        dependencies.append({"ref": f"fixture-{event['kind']}", "alias": event[key], "content_type": kind})
    document = _document("reaction", files=[{"path": "action.json", "role": "sequence"}], dependencies=dependencies)
    path = tmp_path / "action.json"
    path.write_text(json.dumps(data))
    scene_fixture = next(item for item in FIXTURES["effects"] if item["definition"].get("kind") == "focus_lines")
    documents = {"fixture-scene_vfx": _document("scene_effect", definition=scene_fixture["definition"])}
    requirements = derive_capabilities(document.kind, document, {"action.json": path}, documents=documents)
    assert set(requirements) == {"animaPoseClip/2.0", "animama/builtin-pose/1/relaxedRest"}
    data["events"][0]["kind"] = "custom-script-event"
    path.write_text(json.dumps(data))
    with pytest.raises(ContentDocumentError):
        derive_capabilities(document.kind, document, {"action.json": path})


def test_unavailable_base_pose_rejected() -> None:
    document = _document(
        "gesture",
        implementation={"kind": "anima_clip", "file_role": "sequence"},
        files=[{"path": "action.json", "role": "sequence"}],
    )
    data = {
        "schema": "animaPoseClip/2.0",
        "id": "a",
        "name": "A",
        "duration": 1,
        "basePose": "some-other-installation-only-pose",
        "beats": [{"id": "rest", "label": "Rest", "time": 0}],
        "expressions": {"happy": [{"beat": "rest", "v": 1}]},
    }
    with pytest.raises(ContentDocumentError, match="Unknown app Pose"):
        derive_file_capabilities(document.kind, document, "action.json", io.BytesIO(json.dumps(data).encode()))


@pytest.mark.parametrize(
    "mutation",
    [
        {"art": {"image": "https://example.com/tracker.png"}},
        {"attachment": {"kind": "face_surface", "part": "unsupported_future_primitive", "area": "full"}},
        {"script": "alert(1)"},
        {"motion": {"spin": {"direction": "teleport"}}},
    ],
)
def test_effect_unsafe_or_unsupported_data_blocks_package(mutation: dict[str, Any]) -> None:
    fixture = next(f for f in FIXTURES["effects"] if f["definition"].get("attachment", {}).get("area") == "eyes")
    document = _document(fixture["kind"], definition={**fixture["definition"], **mutation}, files=fixture["files"])
    with pytest.raises(ContentDocumentError):
        derive_document_capabilities(document)


@pytest.mark.parametrize(
    "payload",
    [
        b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
        b'<svg xmlns="http://www.w3.org/2000/svg"><image href="https://example.com/a.png"/></svg>',
        b'<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>',
    ],
)
def test_svg_cannot_smuggle_executable_or_external_resources(payload: bytes) -> None:
    document = _document("scene_effect", definition={"schema": "animama/scene-effect/1"})
    with pytest.raises(ContentDocumentError):
        derive_file_capabilities(document.kind, document, "effect.svg", io.BytesIO(payload))


def test_builtin_capabilities_match_shared_inventory() -> None:
    assert BUILTIN_POSES == frozenset(FIXTURES["builtinPoses"])


@pytest.mark.parametrize("version", ["2.0", "1.1", None])
def test_vrma_must_claim_the_actual_supported_extension_version(version: str | None) -> None:
    document = _document("gesture")
    data = {"asset": {"version": "2.0"}, "extensions": {"VRMC_vrm_animation": {"specVersion": version}}}
    with pytest.raises(ContentDocumentError):
        derive_file_capabilities(document.kind, document, "motion.vrma", io.BytesIO(json.dumps(data).encode()))


def test_vrma_rejects_remote_buffer_even_with_supported_version() -> None:
    document = _document("gesture")
    data = {
        "asset": {"version": "2.0"},
        "extensions": {"VRMC_vrm_animation": {"specVersion": "1.0"}},
        "buffers": [{"uri": "https://example.com/private.bin"}],
    }
    with pytest.raises(ContentDocumentError, match="External"):
        derive_file_capabilities(document.kind, document, "motion.vrma", io.BytesIO(json.dumps(data).encode()))


def test_relative_gltf_buffers_cannot_fetch_outside_the_archive() -> None:
    document = _document("gesture")
    data = {
        "asset": {"version": "2.0"},
        "extensions": {"VRMC_vrm_animation": {"specVersion": "1.0"}},
        "buffers": [{"uri": "../private.bin"}],
    }
    with pytest.raises(ContentDocumentError):
        derive_file_capabilities(document.kind, document, "motion.vrma", io.BytesIO(json.dumps(data).encode()))


def test_declared_glb_json_size_is_checked_before_reading_it() -> None:
    document = _document("avatar")
    oversized = struct.pack("<4sIIII", b"glTF", 2, 2**30 + 20, 2**30, 0x4E4F534A)
    with pytest.raises(ContentDocumentError):
        derive_file_capabilities(document.kind, document, "model.vrm", io.BytesIO(oversized))


@pytest.mark.parametrize("extension", ["UNKNOWN_custom_player", "KHR_draco_mesh_compression"])
def test_gltf_cannot_require_an_unavailable_runtime_plugin(extension: str) -> None:
    document = _document("gesture")
    data = {
        "asset": {"version": "2.0"},
        "extensions": {"VRMC_vrm_animation": {"specVersion": "1.0"}},
        "extensionsRequired": [extension],
    }
    with pytest.raises(ContentDocumentError):
        derive_file_capabilities(document.kind, document, "motion.vrma", io.BytesIO(json.dumps(data).encode()))


def test_self_contained_vrma_buffer_is_not_an_external_resource() -> None:
    document = _document("gesture")
    data = {
        "asset": {"version": "2.0"},
        "extensions": {"VRMC_vrm_animation": {"specVersion": "1.0"}},
        "buffers": [{"uri": "data:application/octet-stream;base64,AAAA", "byteLength": 3}],
    }
    assert derive_file_capabilities(document.kind, document, "motion.vrma", io.BytesIO(json.dumps(data).encode())) == (
        "VRMC_vrm_animation/1.0",
    )


@pytest.mark.parametrize("extension", [".exe", ".so", ".dll", ".rb"])
def test_executable_companion_cannot_be_included_as_an_unknown_file_role(extension: str) -> None:
    document = _document("sound_effect")
    with pytest.raises(ContentDocumentError, match="resource"):
        derive_file_capabilities(document.kind, document, f"payload{extension}", io.BytesIO(b"code"))


def test_shipped_typed_content_uses_supported_portable_primitives() -> None:
    included = Path(__file__).parents[1] / "content/included"
    entries: list[tuple[Path, TypedContentDocument]] = []
    for path in included.rglob("*.json"):
        raw = json.loads(path.read_text())
        if not isinstance(raw, dict) or raw.get("content_type") not in {
            "avatar_effect",
            "scene_effect",
            "particle_effect",
            "gesture",
            "reaction",
            "pose",
        }:
            continue
        document = (
            CONTENT_KIND_REGISTRY.handler_for(ContentKind(raw["content_type"]))
            .parse_document(
                raw,
                fallback_path=path,
                descriptor_backed=True,
            )
            .document
        )
        entries.append((path, document))
    documents = {document.content_id: document for _, document in entries if document.content_id is not None}
    for path, document in entries:
        requirements = derive_capabilities(
            document.kind,
            document,
            {file.path: path.parent / file.path for file in document.files},
            documents=documents,
        )
        validate_declared_capabilities(requirements)
    assert entries
