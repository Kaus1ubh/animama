"""Closed compatibility requirements for local content packages.

These versions describe implemented renderers, not a sender's catalog snapshot.
The shared frontend fixtures exercise the real parsers and built-in registries.
Only data is admitted; resource references must name registered package files.
"""

from __future__ import annotations

import json
import math
import re
import struct
import xml.etree.ElementTree as ET
from collections.abc import Iterable, Mapping
from pathlib import Path, PurePosixPath
from typing import Any, BinaryIO

from animama.domain.content_catalog import ContentKind
from animama.domain.content_documents import (
    AvatarEffectDocumentV1,
    ContentDocumentError,
    GestureDocumentV1,
    IdleStyleDocumentV2,
    ParticleEffectDocumentV1,
    PoseDocumentV1,
    ReactionDocumentV1,
    SceneEffectDocumentV1,
    TypedContentDocument,
)

from .idle_clip_validation import validate_idle_clip_timeline

MAX_DEFINITION_BYTES = 16 * 1024 * 1024
# Runtime-only poses remain app primitives, not independent package/catalog roots.
BUILTIN_POSES = frozenset(
    "arms-crossed cat-monster-rawr cat-monster-rawr-2 cheeky-finger-guns cheeky-finger-guns-2 "
    "double-peace-sign double-thumbs-down double-thumbs-up hands-on-hips heart-hands left-ok-sign "
    "left-peace-sign meme-dab relaxedRest right-face-palm right-finger-point right-thumbs-down "
    "right-thumbs-up shy-finger-poke-1 shy-finger-poke-2 single-hand-on-heart soldier-salute "
    "soldier-salute-2 thinking-hand-on-chin thinking-head-scratch-1 thinking-head-scratch-2".split()
)
BUILTIN_EMOJI = frozenset(
    "1f305 1f327 1f338 1f380 1f389 1f3af 1f3c5 1f44e 1f451 1f496 1f4a2 1f4a5 1f4a6 1f4ab "
    "1f602 1f61e 1f622 1f633 1f64f 1f914 1f917 1f922 1f929 1f97a 26a0 2728 2753 2b50".split()
)
SUPPORTED_CAPABILITIES = frozenset(
    {
        "animaPose/1.0",
        "animaPoseClip/1.0",
        "VRM/0.0",
        "VRMC_vrm/1.0",
        "VRMC_vrm_animation/1.0",
        "animama/avatar-effect/1",
        "animama/scene-effect/1",
        "three.quarks/3.0",
    }
    | {f"animama/builtin-pose/1/{name}" for name in BUILTIN_POSES}
    | {f"animama/twemoji/14.0.2/{name}" for name in BUILTIN_EMOJI}
)
_AVATAR_ROLES = frozenset("eye_iris eye_highlight eyeline eyelash face_skin".split())
_PARTICLE_TYPES = frozenset(
    "ConstantValue IntervalValue PiecewiseBezier ConstantColor ColorRange RandomColor RandomColorBetweenGradient "
    "Gradient CLinearFunction AxisAngle Euler RandomQuat ColorOverLife ForceOverLife FrameOverLife "
    "LimitSpeedOverLife Noise OrbitOverLife Rotation3DOverLife RotationOverLife SizeOverLife SpeedOverLife "
    "TurbulenceField WidthOverLength point sphere cone rectangle".split()
)
_PARTICLE_BEHAVIORS = frozenset(
    "ColorOverLife ForceOverLife FrameOverLife LimitSpeedOverLife Noise OrbitOverLife Rotation3DOverLife "
    "RotationOverLife SizeOverLife SpeedOverLife TurbulenceField WidthOverLength".split()
)
# Avatar.ts registers VRM + VRMAnimation plugins on Three's GLTFLoader. Draco,
# Meshopt and Basis decoders are not configured there, so their required formats
# cannot be treated as available just because the upstream loader knows the name.
_GLTF_EXTENSIONS = frozenset(
    "VRM VRMC_vrm VRMC_vrm_animation VRMC_springBone VRMC_materials_mtoon VRMC_node_constraint "
    "VRMC_materials_hdr_emissiveMultiplier KHR_lights_punctual KHR_materials_clearcoat KHR_materials_dispersion "
    "KHR_materials_ior KHR_materials_sheen KHR_materials_specular KHR_materials_transmission "
    "KHR_materials_iridescence KHR_materials_anisotropy KHR_materials_unlit KHR_materials_volume "
    "KHR_texture_transform KHR_mesh_quantization KHR_materials_emissive_strength EXT_materials_bump "
    "EXT_texture_webp EXT_texture_avif EXT_mesh_gpu_instancing".split()
)


def _require(condition: bool, message: str) -> None:
    if not condition:
        raise ContentDocumentError("package_definition_invalid", message)


def _object(value: Any, field: str) -> dict[str, Any]:
    _require(isinstance(value, dict), f"{field} must be an object")
    return dict(value)


def _array(value: Any, field: str) -> list[Any]:
    _require(isinstance(value, list), f"{field} must be an array")
    return list(value)


def _string(value: Any, field: str) -> str:
    _require(isinstance(value, str) and bool(value.strip()), f"{field} must be a nonempty string")
    return str(value)


def _enum(value: Any, allowed: Iterable[str], field: str) -> str:
    _require(isinstance(value, str) and value in allowed, f"Unsupported {field} primitive")
    return str(value)


def _fields(value: dict[str, Any], allowed: str, field: str) -> None:
    _require(not set(value).difference(allowed.split()), f"Unsupported {field} fields")


def _number(value: Any, field: str) -> float:
    _require(type(value) in (float, int), f"{field} must be finite")
    try:
        number = float(value)
    except OverflowError as exc:
        raise ContentDocumentError("package_definition_invalid", f"{field} must be finite") from exc
    _require(math.isfinite(number), f"{field} must be finite")
    return number


def _numbers(value: dict[str, Any], fields: str) -> None:
    for field in fields.split():
        _number(value.get(field), field)


def _booleans(value: dict[str, Any], fields: str) -> None:
    for field in fields.split():
        if field in value:
            _require(type(value[field]) is bool, f"{field} must be boolean")


def _safe_data(value: Any) -> None:
    """Bound nested data and reject executable or external-resource escape hatches."""
    pending = [(value, 0)]
    count = 0
    while pending:
        item, depth = pending.pop()
        count += 1
        _require(depth <= 32 and count <= 100_000, "Package definition exceeds structural limits")
        if isinstance(item, dict):
            for key, child in item.items():
                _require(
                    key.lower() not in {"script", "scripts", "code", "javascript", "vertexshader", "fragmentshader"},
                    "Executable package definitions are unsupported",
                )
                if key.lower() in {"url", "uri", "src", "href", "assetpath"} and isinstance(child, str):
                    embedded = child.startswith(
                        (
                            "data:application/octet-stream;base64,",
                            "data:application/gltf-buffer;base64,",
                            "data:image/png;base64,",
                            "data:image/jpeg;base64,",
                            "data:image/webp;base64,",
                        )
                    )
                    _require(
                        embedded or not child.startswith(("/", "\\")) and ":" not in child and "\\" not in child,
                        "External package resources are unsupported",
                    )
                pending.append((child, depth + 1))
        elif isinstance(item, list):
            pending.extend((child, depth + 1) for child in item)
        elif type(item) in (int, float):
            _number(item, "Definition number")


def _resource(value: Any, document: TypedContentDocument, roles: set[str]) -> None:
    name = _string(value, "Resource reference")
    _require(
        any(file.path == name and file.role in roles for file in document.files),
        "Resource reference must name a registered package file",
    )


def _sound(definition: dict[str, Any], document: TypedContentDocument) -> None:
    if "soundAlias" in definition:
        alias = _string(definition["soundAlias"], "soundAlias")
        _require(
            any(
                dep.kind is ContentKind.SOUND_EFFECT and (dep.alias or dep.ref) == alias
                for dep in document.dependencies
            ),
            "Sound alias must name a bundled Sound Effect dependency",
        )


def validate_declared_capabilities(capabilities: Iterable[str]) -> None:
    """Reject unsupported or duplicate claims before archive extraction."""
    seen: set[str] = set()
    for capability in capabilities:
        if not isinstance(capability, str) or capability not in SUPPORTED_CAPABILITIES:
            raise ContentDocumentError("package_capability_unsupported", "Package requires an unavailable capability")
        if capability in seen:
            raise ContentDocumentError("package_capabilities_mismatch", "Package declares a duplicate capability")
        seen.add(capability)


def validate_capabilities(declared: Iterable[str], required: Iterable[str]) -> None:
    """Require an exact declaration of the capabilities derived from package data."""
    declarations = tuple(declared)
    requirements = frozenset(required)
    validate_declared_capabilities(declarations)
    validate_declared_capabilities(requirements)
    if frozenset(declarations) != requirements:
        raise ContentDocumentError("package_capabilities_mismatch", "Package capabilities do not match its content")


def _avatar_effect(definition: dict[str, Any], document: TypedContentDocument) -> None:
    _fields(
        definition,
        "schema kind region image transform animationConfig lifetime soundAlias hoverKind "
        "placement side requiresMirror skinBackdrop anchor pivot layout targetRole assetShape applyMode "
        "disableTargetRoles",
        "Avatar Effect",
    )
    kind = _enum(definition.get("kind"), {"hover", "face_anchored", "texture"}, "Avatar Effect kind")
    _enum(definition.get("region"), {"eyes", "undereye", "blush", "mouth", "emote", "full_face"}, "region")
    _resource(definition.get("image"), document, {"image", "texture"})
    _booleans(definition, "requiresMirror skinBackdrop")
    if "side" in definition:
        _enum(definition["side"], {"left", "right"}, "side")
    if "disableTargetRoles" in definition:
        for role in _array(definition["disableTargetRoles"], "disableTargetRoles"):
            _enum(role, _AVATAR_ROLES, "disabled target role")
    if kind == "hover":
        hover = _enum(definition.get("hoverKind"), {"eye_hover", "mouth_hover", "box_hover"}, "hover")
        if hover == "box_hover":
            _enum(
                definition.get("placement"),
                {
                    "forehead-left",
                    "forehead-middle",
                    "forehead-right",
                    "top-left",
                    "top-middle",
                    "top-right",
                    "top-edge-left-corner",
                    "top-edge-left",
                    "top-edge-middle",
                    "top-edge-right",
                    "top-edge-right-corner",
                },
                "hover placement",
            )
    elif kind == "face_anchored":
        anchor = _enum(definition.get("anchor"), {"undereye", "blush", "mouth"}, "face anchor")
        if anchor != "mouth":
            layout = _enum(definition.get("layout"), {"single", "span"}, "face layout")
            if layout == "single":
                _enum(definition.get("side"), {"left", "right"}, "face side")
        if "pivot" in definition:
            _enum(
                definition["pivot"],
                {
                    "top-left",
                    "top-center",
                    "top-right",
                    "center-left",
                    "center",
                    "center-right",
                    "bottom-left",
                    "bottom-center",
                    "bottom-right",
                },
                "face pivot",
            )
    else:
        _enum(definition.get("targetRole"), _AVATAR_ROLES, "texture role")
        _enum(definition.get("assetShape"), {"single_eye", "double_eye", "full_face"}, "texture shape")
        _enum(definition.get("applyMode"), {"replace", "overlay"}, "texture application")
    if "transform" in definition:
        transform = _object(definition["transform"], "transform")
        _fields(transform, "offset scale rotation", "transform")
        for key, value in transform.items():
            axes = _object(value, key)
            _fields(axes, "x y z", key)
            _numbers(axes, " ".join(axes))
    if "animationConfig" in definition:
        animation = _object(definition["animationConfig"], "animationConfig")
        _fields(
            animation,
            "pulseScaleMin pulseScaleMax pulseCyclesPerSecond rotationAmountTurns "
            "rotationRadiansPerSecond rotationDirection driftPerSecond",
            "Avatar animation",
        )
        for key, value in animation.items():
            if key == "rotationDirection":
                _enum(value, {"clockwise", "counterclockwise"}, key)
            elif key == "driftPerSecond":
                axes = _object(value, key)
                _fields(axes, "x y", key)
                _numbers(axes, " ".join(axes))
            else:
                _number(value, key)
    if "lifetime" in definition:
        lifetime = _object(definition["lifetime"], "lifetime")
        lifetime_kind = _enum(lifetime.get("kind"), {"duration", "turns"}, "Avatar lifetime")
        _fields(lifetime, "kind runEndBufferSec" if lifetime_kind == "duration" else "kind turns", "lifetime")
        _number(lifetime.get("runEndBufferSec" if lifetime_kind == "duration" else "turns"), "lifetime")


def _scene_effect(definition: dict[str, Any], document: TypedContentDocument) -> set[str]:
    _fields(
        definition,
        "schema kind durationMs coverUiOverlays dismissOnInput soundAlias solid pattern marquee "
        "renderPlacement lineCount color opacity baseThicknessPx thicknessVariationPx lengthVariation "
        "overscanPx target animation seed",
        "Scene Effect",
    )
    kind = _enum(definition.get("kind"), {"background_layers", "focus_lines"}, "Scene Effect kind")
    _booleans(definition, "coverUiOverlays dismissOnInput")
    if definition.get("durationMs") is not None:
        _number(definition["durationMs"], "durationMs")
    extra: set[str] = set()
    if kind == "focus_lines":
        _enum(definition.get("renderPlacement"), {"behind_avatar", "front_of_avatar"}, "focus placement")
        _numbers(definition, "lineCount opacity baseThicknessPx thicknessVariationPx lengthVariation overscanPx")
        _string(definition.get("color"), "focus color")
        if definition.get("seed") is not None:
            _number(definition["seed"], "seed")
        target = _object(definition.get("target"), "target")
        target_kind = _enum(target.get("kind"), {"avatar_face", "manual_box"}, "focus target")
        if target_kind == "avatar_face":
            _fields(target, "kind paddingXPx paddingYPx", "target")
            _numbers(target, "paddingXPx paddingYPx")
        else:
            _fields(target, "kind rect", "target")
            rect = _object(target.get("rect"), "target rectangle")
            _fields(rect, "x y width height", "target rectangle")
            _numbers(rect, "x y width height")
        animation = _object(definition.get("animation"), "focus animation")
        fields = "minVisibleMs maxVisibleMs minHiddenMs maxHiddenMs opacityJitter"
        _fields(animation, fields, "focus animation")
        _numbers(animation, fields)
        return extra
    solid = _object(definition.get("solid"), "solid")
    _fields(solid, "enabled color", "solid")
    _require(type(solid.get("enabled")) is bool, "Solid enabled must be boolean")
    _string(solid.get("color"), "solid color")
    pattern = _object(definition.get("pattern"), "pattern")
    _fields(pattern, "enabled pattern color size spacing opacity", "pattern")
    _require(type(pattern.get("enabled")) is bool, "Pattern enabled must be boolean")
    _enum(pattern.get("pattern"), {"none", "polkadot", "heart", "star"}, "background pattern")
    _string(pattern.get("color"), "pattern color")
    _numbers(pattern, "size spacing opacity")
    marquee = _object(definition.get("marquee"), "marquee")
    _fields(
        marquee,
        "enabled items itemSize gap rowGap direction itemRotationMode itemRotationOffsetDeg speedPxPerSec opacity",
        "marquee",
    )
    _require(type(marquee.get("enabled")) is bool, "Marquee enabled must be boolean")
    _numbers(marquee, "itemSize gap rowGap itemRotationOffsetDeg speedPxPerSec opacity")
    _enum(
        marquee.get("direction"),
        {
            "static",
            "left",
            "right",
            "up",
            "down",
            "diagonal-up-left",
            "diagonal-down-left",
            "diagonal-up-right",
            "diagonal-down-right",
        },
        "marquee direction",
    )
    _enum(marquee.get("itemRotationMode"), {"upright", "follow-track"}, "marquee rotation")
    for raw in _array(marquee.get("items"), "marquee items"):
        item = _object(raw, "marquee item")
        _fields(item, "id kind label image emoji provider", "marquee item")
        _string(item.get("id"), "marquee item id")
        _string(item.get("label"), "marquee item label")
        if _enum(item.get("kind"), {"image", "emoji"}, "marquee item") == "image":
            _resource(item.get("image"), document, {"image", "texture"})
        else:
            _enum(item.get("provider", "twemoji"), {"twemoji"}, "emoji provider")
            glyph = _string(item.get("emoji"), "emoji")
            codepoint = "-".join(f"{ord(char):x}" for char in glyph)
            _require(codepoint in BUILTIN_EMOJI, "Emoji resource is unavailable in this app")
            extra.add(f"animama/twemoji/14.0.2/{codepoint}")
    return extra


def derive_document_capabilities(document: TypedContentDocument) -> tuple[str, ...]:
    """Validate actual typed definitions, never catalog-version compatibility claims."""
    if isinstance(document, PoseDocumentV1):
        return ("animaPose/1.0",)
    if isinstance(document, AvatarEffectDocumentV1 | SceneEffectDocumentV1):
        definition = _object(document.definition, "Effect definition")
        _safe_data(definition)
        schema = "animama/avatar-effect/1" if isinstance(document, AvatarEffectDocumentV1) else "animama/scene-effect/1"
        _require(definition.get("schema") == schema, "Unsupported effect definition schema")
        _sound(definition, document)
        if isinstance(document, AvatarEffectDocumentV1):
            _avatar_effect(definition, document)
            return (schema,)
        return tuple(sorted({schema} | _scene_effect(definition, document)))
    if isinstance(document, ParticleEffectDocumentV1):
        _require(document.definition is None, "Particle Effects require a registered Quarks manifest")
        _require(
            sum(file.role == "manifest" for file in document.files) == 1,
            "Particle Effect requires one registered manifest",
        )
    if isinstance(document, GestureDocumentV1 | ReactionDocumentV1):
        _require(document.implementation.content_dependency_ref is None, "Actions must own their animation resource")
        role = document.implementation.file_role or (
            "animation" if document.implementation.kind == "vrma" else "sequence"
        )
        # Standalone VRMA files have no explicit declarations; their suffix is checked below.
        _require(
            not document.files or sum(file.role == role for file in document.files) == 1,
            "Action requires one active animation resource",
        )
    if document.kind is ContentKind.IDLE_STYLE:
        _require(isinstance(document, IdleStyleDocumentV2), "Only Gesture-pool Idle Styles are portable")
    _require(
        document.kind not in {ContentKind.MUSIC_TRACK, ContentKind.POSE_CLIP, ContentKind.VOICE, ContentKind.ANIMA},
        "Unsupported package content kind",
    )
    return ()


def _read_json(content: BinaryIO, *, size: int | None = None) -> dict[str, Any]:
    length = MAX_DEFINITION_BYTES + 1 if size is None else size
    _require(length <= MAX_DEFINITION_BYTES + 1, "Package definition exceeds byte limit")
    raw = content.read(length)
    _require(
        len(raw) <= MAX_DEFINITION_BYTES and (size is None or len(raw) == size),
        "Package definition is oversized or truncated",
    )
    try:
        value = json.loads(raw)
    except (ValueError, UnicodeError, RecursionError) as exc:
        raise ContentDocumentError("package_definition_invalid", "Package resource is not bounded valid JSON") from exc
    result = _object(value, "Package resource")
    _safe_data(result)
    return result


def _builtin_pose(value: Any) -> str:
    pose = _string(value, "App Pose reference")
    _require(pose in BUILTIN_POSES, "Unknown app Pose reference")
    return f"animama/builtin-pose/1/{pose}"


def normalized_action_selector(value: str) -> str:
    """Match the frontend's String.trim for authored cue/effect/preset IDs.

    ECMAScript trims BOM but not NEL or the information separators removed by
    Python's default strip. Keep names, descriptions and other fields untouched.
    """
    whitespace = "\u0009\u000a\u000b\u000c\u000d\u0020\u00a0\u1680\u2028\u2029\u202f\u205f\u3000\ufeff"
    whitespace += "".join(chr(codepoint) for codepoint in range(0x2000, 0x200B))
    _require(isinstance(value, str), "Action event selector must be a string")
    result = value.strip(whitespace)
    _require(bool(result), "Action event selector cannot be empty")
    return result


def _clip_event_dependencies(
    value: dict[str, Any], document: TypedContentDocument, documents: Mapping[str, TypedContentDocument] | None
) -> None:
    """Require exactly one typed edge for every Action FX/audio selector.

    Pose/Twemoji capabilities describe checked app primitives. FX/audio names
    have no such fallback: their content must be in the reviewed package graph.
    Count aliases across every kind before checking the expected kind, because
    runtime alias maps cannot disambiguate a same-name edge of another type.
    """
    targets = {
        "sfx": ("cueId", ContentKind.SOUND_EFFECT),
        "avatar_vfx": ("effectId", ContentKind.AVATAR_EFFECT),
        "scene_vfx": ("presetId", ContentKind.SCENE_EFFECT),
        "particle_vfx": ("effectId", ContentKind.PARTICLE_EFFECT),
    }
    for event in value.get("events", []):
        field, kind = targets[event["kind"]]
        selector = normalized_action_selector(event[field])
        matches = [edge for edge in document.dependencies if selector in {edge.alias, edge.ref}]
        _require(
            len(matches) == 1 and matches[0].kind is kind,
            "Action event selector must name one bundled dependency of the matching kind",
        )
        if kind is ContentKind.SCENE_EFFECT:
            target = documents.get(matches[0].ref) if documents is not None else None
            _require(
                isinstance(target, SceneEffectDocumentV1)
                and target.definition is not None
                and target.definition.get("kind") == event["sceneKind"],
                "Action scene selector must resolve to the requested bundled Scene Effect primitive",
            )


def _clip(
    value: dict[str, Any], document: TypedContentDocument, documents: Mapping[str, TypedContentDocument] | None
) -> set[str]:
    _require(value.get("schema") == "animaPoseClip/1.0", "Unsupported Action clip schema")
    _booleans(value, "loop")
    duration = None if "duration" not in value else _number(value["duration"], "Clip duration")
    _require(duration is None or duration > 0, "Clip duration must be positive")
    if "playback" in value:
        playback = _object(value["playback"], "playback")
        _fields(playback, "lifetime", "playback")
        lifetime = _object(playback.get("lifetime"), "playback lifetime")
        kind = _enum(lifetime.get("kind"), {"whileInteractionPhase", "whileAvatarState"}, "clip lifetime")
        key = "phases" if kind == "whileInteractionPhase" else "states"
        _fields(lifetime, f"kind scope {key}", "clip lifetime")
        _enum(lifetime.get("scope", "activeRun"), {"activeRun"}, "clip scope")
        allowed = (
            {"idle", "listening", "thinking", "gesture", "talking"}
            if key == "states"
            else {
                "idle",
                "user_typing",
                "listening",
                "user_speaking",
                "semantic_check",
                "submitting",
                "thinking",
                "responding_no_tts",
                "talking",
            }
        )
        values = _array(lifetime.get(key), key)
        _require(bool(values), "Clip lifetime selection cannot be empty")
        for selected in values:
            _enum(selected, allowed, key)
        _require(len(set(values)) == len(values), "Clip lifetime selections must be unique")
    # The existing validator admits the same timeline/pose/event primitives. Its
    # finite-idle policy excludes lifetime, already checked above for general Actions.
    try:
        validate_idle_clip_timeline({key: item for key, item in value.items() if key != "playback"}, duration)
    except ContentDocumentError as exc:
        raise ContentDocumentError(
            "package_definition_invalid", str(exc).replace("Gesture clip", "Action clip")
        ) from exc
    _clip_event_dependencies(value, document, documents)
    requirements = {"animaPoseClip/1.0", "animaPose/1.0"}
    if "basePose" in value:
        requirements.add(_builtin_pose(value["basePose"]))
    for pose in value["poses"].values():
        if "ref" in pose:
            requirements.add(_builtin_pose(pose["ref"]))
    return requirements


def _particle(value: dict[str, Any], document: TypedContentDocument) -> None:
    _fields(value, "metadata geometries materials textures images object animations", "Quarks document")
    _require(not value.get("animations"), "Separate Three animations are unsupported")
    for image in _array(value.get("images", []), "Quarks images"):
        _resource(_object(image, "Quarks image").get("url"), document, {"texture", "image"})
    for geometry in _array(value.get("geometries", []), "Quarks geometries"):
        _enum(_object(geometry, "Quarks geometry").get("type"), {"PlaneGeometry"}, "Quarks geometry")
    for material in _array(value.get("materials", []), "Quarks materials"):
        _enum(_object(material, "Quarks material").get("type"), {"MeshBasicMaterial"}, "Quarks material")
    pending = [_object(value.get("object"), "Quarks root")]
    emitters = 0
    while pending:
        node = pending.pop()
        kind = _enum(node.get("type"), {"Group", "ParticleEmitter"}, "Quarks node")
        pending.extend(_object(child, "Quarks child") for child in _array(node.get("children", []), "children"))
        if kind != "ParticleEmitter":
            continue
        emitters += 1
        ps = _object(node.get("ps"), "Particle system")
        _require(ps.get("version") == "3.0", "Unsupported particle system version")
        _require(type(ps.get("renderMode")) is int and ps["renderMode"] in range(6), "Unsupported particle render mode")
        _require(_number(ps.get("duration"), "Particle duration") > 0, "Particle duration must be positive")
        _enum(
            _object(ps.get("shape"), "Particle shape").get("type"),
            {"point", "sphere", "cone", "rectangle"},
            "Particle shape",
        )
        for behavior in _array(ps.get("behaviors", []), "Particle behaviors"):
            _enum(_object(behavior, "Particle behavior").get("type"), _PARTICLE_BEHAVIORS, "Particle behavior")
        objects = [ps]
        while objects:
            current = objects.pop()
            for key, child in current.items():
                if key == "type":
                    _enum(child, _PARTICLE_TYPES, "Particle behavior or generator")
                elif key == "subType":
                    _enum(child, {"Number", "Color"}, "Particle generator subtype")
                elif isinstance(child, dict):
                    objects.append(child)
                elif isinstance(child, list):
                    objects.extend(part for part in child if isinstance(part, dict))
    _require(emitters > 0, "Particle resource must contain an emitter")


def _gltf(content: BinaryIO, relative_path: str) -> str:
    prefix = content.read(20)
    if prefix[:4] == b"glTF":
        _require(len(prefix) == 20, "Truncated GLB header")
        _, version, total, length, chunk_type = struct.unpack("<4sIIII", prefix)
        _require(
            version == 2 and chunk_type == 0x4E4F534A and 0 < length <= MAX_DEFINITION_BYTES and total >= length + 20,
            "Unsupported GLB container",
        )
        value = _read_json(content, size=length)
    else:
        content.seek(0)
        value = _read_json(content)
    for field in ("buffers", "images"):
        for resource in _array(value.get(field, []), f"glTF {field}"):
            uri = _object(resource, f"glTF {field}").get("uri")
            _require(
                uri is None or isinstance(uri, str) and uri.startswith("data:"), "glTF resources must be self-contained"
            )
    for field in ("extensionsRequired", "extensionsUsed"):
        for extension in _array(value.get(field, []), field):
            _enum(extension, _GLTF_EXTENSIONS, "glTF extension")
    extensions = _object(value.get("extensions"), "glTF extensions")
    for extension in extensions:
        _enum(extension, _GLTF_EXTENSIONS, "glTF extension")
    if relative_path.lower().endswith(".vrma"):
        extension = _object(extensions.get("VRMC_vrm_animation"), "VRMA extension")
        _require(extension.get("specVersion") == "1.0", "Unsupported VRMA version")
        return "VRMC_vrm_animation/1.0"
    if "VRMC_vrm" in extensions:
        _require(
            _object(extensions["VRMC_vrm"], "VRM extension").get("specVersion") == "1.0", "Unsupported VRM version"
        )
        return "VRMC_vrm/1.0"
    _require(_object(extensions.get("VRM"), "VRM extension").get("specVersion") == "0.0", "Unsupported VRM version")
    return "VRM/0.0"


def _svg(content: BinaryIO) -> None:
    raw = content.read(MAX_DEFINITION_BYTES + 1)
    _require(len(raw) <= MAX_DEFINITION_BYTES, "SVG resource exceeds byte limit")
    _require(b"<!DOCTYPE" not in raw.upper() and b"<!ENTITY" not in raw.upper(), "SVG entities are unsupported")
    try:
        root = ET.fromstring(raw)
    except ET.ParseError as exc:
        raise ContentDocumentError("package_definition_invalid", "Invalid SVG resource") from exc
    _require(root.tag.rsplit("}", 1)[-1] == "svg", "Resource must contain an SVG root")
    for element in root.iter():
        _require(
            element.tag.rsplit("}", 1)[-1].lower() not in {"script", "foreignobject", "style"},
            "Executable SVG resources are unsupported",
        )
        for key, value in element.attrib.items():
            attribute = key.rsplit("}", 1)[-1].lower()
            _require(not attribute.startswith("on"), "SVG event handlers are unsupported")
            if attribute in {"href", "src"}:
                _require(value.startswith("#"), "External SVG resources are unsupported")
            for target in re.findall(r"url\((.*?)\)", value, flags=re.IGNORECASE):
                _require(target.strip(" \"'").startswith("#"), "External SVG resources are unsupported")


def derive_file_capabilities(
    kind: ContentKind,
    document: TypedContentDocument,
    relative_path: str,
    content: BinaryIO,
    *,
    role: str | None = None,
    documents: Mapping[str, TypedContentDocument] | None = None,
) -> tuple[str, ...]:
    """Inspect one verified stream sequentially; caller may rewind it for ZIP output.

    Full media validation and file-registration ownership remain at the catalog
    boundary. Supply the verified catalog/scanner role to include inferred files
    whose author did not write a descriptor file declaration.
    """
    _require(document.kind == kind, "Package kind disagrees with typed document")
    suffix = PurePosixPath(relative_path).suffix.lower()
    declared_roles = {file.role for file in document.files if file.path == relative_path}
    _require(
        role is None or not declared_roles or declared_roles == {role},
        "Registered package resource role disagrees with its declaration",
    )
    roles = {role} if role is not None else declared_roles
    if suffix == ".svg":
        _svg(content)
    if suffix in {".vrm", ".vrma"}:
        return (_gltf(content, relative_path),)
    if isinstance(document, GestureDocumentV1 | ReactionDocumentV1):
        if document.implementation.kind == "anima_clip" and (document.implementation.file_role or "sequence") in roles:
            return tuple(sorted(_clip(_read_json(content), document, documents)))
    if kind is ContentKind.PARTICLE_EFFECT and "manifest" in roles:
        _particle(_read_json(content), document)
        return ("three.quarks/3.0",)
    _require(
        suffix
        in {".json", ".png", ".jpg", ".jpeg", ".webp", ".svg", ".bin", ".wav", ".ogg", ".mp3", ".flac", ".txt", ".md"},
        "Unsupported or executable package resource",
    )
    return ()


def derive_capabilities(
    kind: ContentKind,
    document: TypedContentDocument,
    files: Mapping[str, Path],
    *,
    roles: Mapping[str, str] | None = None,
    documents: Mapping[str, TypedContentDocument] | None = None,
) -> tuple[str, ...]:
    """Validate a staged entry with at most one resource handle open at a time."""
    _require(document.kind == kind, "Package kind disagrees with typed document")
    requirements = set(derive_document_capabilities(document))
    _require(all(file.path in files for file in document.files), "A registered package resource is missing")
    _require(roles is None or files.keys() == roles.keys(), "Registered package resource roles are incomplete")
    for relative_path, path in files.items():
        with path.open("rb") as content:
            requirements.update(
                derive_file_capabilities(
                    kind,
                    document,
                    relative_path,
                    content,
                    role=roles[relative_path] if roles is not None else None,
                    documents=documents,
                )
            )
    return tuple(sorted(requirements))
