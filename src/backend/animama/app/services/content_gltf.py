"""Bounded VRM/VRMA parsing, validation, and canonical GLB writing."""

from __future__ import annotations

import base64
import binascii
import json
import math
import re
import struct
from dataclasses import dataclass
from typing import Any, BinaryIO, TypedDict

from .content_file_validation import ContentFileInvalidError

GLB_MAGIC = b"glTF"
GLB_VERSION = 2
GLB_JSON_CHUNK_TYPE = 0x4E4F534A
GLB_BIN_CHUNK_TYPE = 0x004E4942
MAX_VRMA_SOURCE_BYTES = 50 * 1024 * 1024
MAX_VRM_SOURCE_BYTES = 100 * 1024 * 1024
MAX_GLTF_JSON_BYTES = 16 * 1024 * 1024
MAX_VRMA_BINARY_BYTES = 50 * 1024 * 1024
MAX_VRM_BINARY_BYTES = 100 * 1024 * 1024
MAX_VRMA_NODES = 2048
MAX_VRMA_BUFFER_VIEWS = 4096
MAX_VRMA_ACCESSORS = 4096
MAX_VRMA_ANIMATION_TRACKS = 4096
MAX_VRMA_KEYFRAMES = 1_000_000
MAX_VRMA_DURATION_SECONDS = 3600.0
MAX_VRM_NODES = 8192
MAX_VRM_BUFFER_VIEWS = 16384
MAX_VRM_ACCESSORS = 16384
REQUIRED_VRM_HUMANOID_BONES = frozenset(
    {
        "hips",
        "spine",
        "head",
        "leftUpperLeg",
        "leftLowerLeg",
        "leftFoot",
        "rightUpperLeg",
        "rightLowerLeg",
        "rightFoot",
        "leftUpperArm",
        "leftLowerArm",
        "leftHand",
        "rightUpperArm",
        "rightLowerArm",
        "rightHand",
    }
)

_DATA_URI_PATTERN = re.compile(
    r"^data:(?P<media>[A-Za-z0-9!#$&^_.+-]+/[A-Za-z0-9!#$&^_.+-]+);base64,"
    r"(?P<data>[^\s]*)$"
)
_COMPONENT_FORMAT = {
    5120: ("b", 1),
    5121: ("B", 1),
    5122: ("h", 2),
    5123: ("H", 2),
    5125: ("I", 4),
    5126: ("f", 4),
}
_TYPE_COMPONENTS = {
    "SCALAR": 1,
    "VEC2": 2,
    "VEC3": 3,
    "VEC4": 4,
    "MAT2": 4,
    "MAT3": 9,
    "MAT4": 16,
}


@dataclass(frozen=True, slots=True)
class CanonicalVrma:
    """One canonical GLB plus bounded facts about its accepted source."""

    content: bytes
    source_container: str
    node_count: int
    track_count: int
    keyframe_count: int
    duration_seconds: float
    warnings: tuple[str, ...]


@dataclass(slots=True)
class _ParsedGltf:
    document: dict[str, Any]
    buffers: list[bytes]
    source_container: str
    warnings: list[str]


def canonicalize_vrma_stream(
    *,
    content: BinaryIO,
    size_bytes: int,
    repair_missing_spec_version: bool = False,
) -> CanonicalVrma:
    """Read JSON/GLB VRMA, validate its runtime structure, and emit stable GLB."""

    raw = _read_bounded(
        content,
        size_bytes,
        maximum_bytes=MAX_VRMA_SOURCE_BYTES,
        size_reason="vrma_size_limit",
    )
    parsed = _parse_glb(raw) if raw.startswith(GLB_MAGIC) else _parse_json_gltf(raw)
    source_extension = _source_vrma_extension(parsed.document)
    missing_spec_version = source_extension.get("specVersion") is None
    _require_vrma_extension(
        parsed.document,
        repair_missing_spec_version=repair_missing_spec_version,
    )
    if repair_missing_spec_version and missing_spec_version:
        parsed.warnings.append("app_missing_spec_version_repaired")
    document, binary = _merge_embedded_resources(
        parsed.document,
        parsed.buffers,
        maximum_binary_bytes=MAX_VRMA_BINARY_BYTES,
    )
    facts = _validate_vrma_document(document, binary)
    canonical = _write_glb(document, binary)
    if len(canonical) > MAX_VRMA_SOURCE_BYTES:
        raise ContentFileInvalidError(field="file", reason="vrma_canonical_size_limit")
    return CanonicalVrma(
        content=canonical,
        source_container=parsed.source_container,
        node_count=facts["node_count"],
        track_count=facts["track_count"],
        keyframe_count=facts["keyframe_count"],
        duration_seconds=facts["duration_seconds"],
        warnings=tuple(parsed.warnings),
    )


def validate_vrma_stream(
    *,
    content: BinaryIO,
    size_bytes: int,
) -> tuple[str, dict[str, Any]]:
    """Validate one VRMA source and return detected media type plus safe facts."""

    canonical = canonicalize_vrma_stream(content=content, size_bytes=size_bytes)
    return (
        "model/gltf-binary",
        {
            "container": canonical.source_container,
            "vrm_animation": True,
            "spec_version": "1.0",
            "animation_count": 1,
            "node_count": canonical.node_count,
            "track_count": canonical.track_count,
            "keyframe_count": canonical.keyframe_count,
            "duration_seconds": canonical.duration_seconds,
        },
    )


def validate_vrm_stream(
    *,
    content: BinaryIO,
    size_bytes: int,
) -> tuple[str, dict[str, Any]]:
    """Validate a complete self-contained VRM 0.x or 1.0 binary GLB."""

    try:
        raw = _read_bounded(
            content,
            size_bytes,
            maximum_bytes=MAX_VRM_SOURCE_BYTES,
            size_reason="vrm_size_limit",
        )
        if not raw.startswith(GLB_MAGIC):
            raise ContentFileInvalidError(field="file", reason="vrm_invalid_container")
        parsed = _parse_glb(raw, maximum_binary_bytes=MAX_VRM_BINARY_BYTES)
        document, binary = _merge_embedded_resources(
            parsed.document,
            parsed.buffers,
            maximum_binary_bytes=MAX_VRM_BINARY_BYTES,
        )
        facts = _validate_gltf_structure(
            document,
            binary,
            maximum_nodes=MAX_VRM_NODES,
            maximum_views=MAX_VRM_BUFFER_VIEWS,
            maximum_accessors=MAX_VRM_ACCESSORS,
            allow_sparse=True,
        )
        vrm_spec = _validate_vrm_humanoid(document, len(facts["nodes"]))
    except ContentFileInvalidError as exc:
        reason = exc.reason.replace("vrma_", "vrm_", 1) if exc.reason.startswith("vrma_") else exc.reason
        if reason == exc.reason:
            raise
        raise ContentFileInvalidError(field=exc.field, reason=reason) from exc
    return (
        "model/gltf-binary",
        {
            "container": "glb2",
            "vrm": True,
            "vrm_spec": vrm_spec,
            "node_count": len(facts["nodes"]),
            "buffer_view_count": len(facts["views"]),
            "accessor_count": len(facts["accessors"]),
        },
    )


def _read_bounded(
    content: BinaryIO,
    size_bytes: int,
    *,
    maximum_bytes: int,
    size_reason: str,
) -> bytes:
    if size_bytes < 1 or size_bytes > maximum_bytes:
        raise ContentFileInvalidError(field="file", reason=size_reason)
    content.seek(0)
    raw = content.read(size_bytes)
    if len(raw) != size_bytes or content.read(1):
        raise ContentFileInvalidError(field="size_bytes", reason="mismatch")
    return raw


def _parse_json_gltf(raw: bytes) -> _ParsedGltf:
    if len(raw) > MAX_GLTF_JSON_BYTES:
        raise ContentFileInvalidError(field="file", reason="vrma_json_size_limit")
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise ContentFileInvalidError(field="file", reason="vrma_invalid_json") from exc
    document = _load_json_object(text)
    buffers = _decode_declared_buffers(document, glb_binary=None)
    return _ParsedGltf(
        document=document,
        buffers=buffers,
        source_container="gltf_json_embedded",
        warnings=[],
    )


def _parse_glb(
    raw: bytes,
    *,
    maximum_binary_bytes: int = MAX_VRMA_BINARY_BYTES,
) -> _ParsedGltf:
    if len(raw) < 20:
        raise ContentFileInvalidError(field="file", reason="vrma_invalid_container")
    magic, version, declared_length = struct.unpack_from("<4sII", raw, 0)
    if magic != GLB_MAGIC or version != GLB_VERSION:
        raise ContentFileInvalidError(field="file", reason="vrma_invalid_container")
    if declared_length != len(raw):
        raise ContentFileInvalidError(field="file", reason="vrma_glb_length")

    chunks: list[tuple[int, bytes]] = []
    offset = 12
    while offset < len(raw):
        if offset + 8 > len(raw):
            raise ContentFileInvalidError(field="file", reason="vrma_glb_chunks")
        chunk_length, chunk_type = struct.unpack_from("<II", raw, offset)
        offset += 8
        if chunk_length % 4 or offset + chunk_length > len(raw):
            raise ContentFileInvalidError(field="file", reason="vrma_glb_chunks")
        chunks.append((chunk_type, raw[offset : offset + chunk_length]))
        offset += chunk_length
    if (
        offset != len(raw)
        or not chunks
        or chunks[0][0] != GLB_JSON_CHUNK_TYPE
        or len(chunks[0][1]) > MAX_GLTF_JSON_BYTES
        or len(chunks) > 2
        or (len(chunks) == 2 and chunks[1][0] != GLB_BIN_CHUNK_TYPE)
    ):
        raise ContentFileInvalidError(field="file", reason="vrma_glb_chunks")
    try:
        json_text = chunks[0][1].rstrip(b" \t\r\n\x00").decode("utf-8")
    except UnicodeDecodeError as exc:
        raise ContentFileInvalidError(field="file", reason="vrma_invalid_json") from exc
    document = _load_json_object(json_text)
    binary = chunks[1][1] if len(chunks) == 2 else None
    buffers = _decode_declared_buffers(
        document,
        glb_binary=binary,
        maximum_binary_bytes=maximum_binary_bytes,
    )
    return _ParsedGltf(
        document=document,
        buffers=buffers,
        source_container="glb2",
        warnings=[],
    )


def _load_json_object(text: str) -> dict[str, Any]:
    def reject_constant(_value: str) -> None:
        raise ValueError

    try:
        value = json.loads(text, parse_constant=reject_constant)
    except (json.JSONDecodeError, RecursionError, ValueError) as exc:
        raise ContentFileInvalidError(field="file", reason="vrma_invalid_json") from exc
    if not isinstance(value, dict):
        raise ContentFileInvalidError(field="file", reason="vrma_invalid_json")
    _require_finite_json(value)
    return value


def _decode_declared_buffers(
    document: dict[str, Any],
    *,
    glb_binary: bytes | None,
    maximum_binary_bytes: int = MAX_VRMA_BINARY_BYTES,
) -> list[bytes]:
    raw_buffers = document.get("buffers", [])
    if not isinstance(raw_buffers, list):
        raise ContentFileInvalidError(field="file", reason="vrma_invalid_structure")
    decoded: list[bytes] = []
    for index, item in enumerate(raw_buffers):
        if not isinstance(item, dict):
            raise ContentFileInvalidError(field="file", reason="vrma_invalid_structure")
        uri = item.get("uri")
        if uri is not None and (not isinstance(uri, str) or _DATA_URI_PATTERN.fullmatch(uri) is None):
            raise ContentFileInvalidError(field="file", reason="vrma_external_resource")
        declared = _nonnegative_int(item.get("byteLength"))
        if uri is None:
            if index != 0 or glb_binary is None:
                raise ContentFileInvalidError(field="file", reason="vrma_external_resource")
            if declared > len(glb_binary) or len(glb_binary) - declared > 3:
                raise ContentFileInvalidError(field="file", reason="vrma_binary_range")
            decoded.append(glb_binary[:declared])
            continue
        payload, media_type = _decode_data_uri(uri)
        if media_type not in {
            "application/octet-stream",
            "application/gltf-buffer",
        }:
            raise ContentFileInvalidError(field="file", reason="vrma_invalid_base64")
        if len(payload) != declared:
            raise ContentFileInvalidError(field="file", reason="vrma_binary_range")
        decoded.append(payload)
    if glb_binary is not None and not raw_buffers and glb_binary.rstrip(b"\x00"):
        raise ContentFileInvalidError(field="file", reason="vrma_binary_range")
    if sum(len(buffer) for buffer in decoded) > maximum_binary_bytes:
        raise ContentFileInvalidError(field="file", reason="vrma_binary_size_limit")
    return decoded


def _decode_data_uri(uri: str) -> tuple[bytes, str]:
    match = _DATA_URI_PATTERN.fullmatch(uri)
    if match is None:
        raise ContentFileInvalidError(field="file", reason="vrma_external_resource")
    try:
        payload = base64.b64decode(match.group("data"), validate=True)
    except (binascii.Error, ValueError) as exc:
        raise ContentFileInvalidError(field="file", reason="vrma_invalid_base64") from exc
    return payload, match.group("media").lower()


def _source_vrma_extension(document: dict[str, Any]) -> dict[str, Any]:
    extensions = document.get("extensions")
    if not isinstance(extensions, dict):
        raise ContentFileInvalidError(field="file", reason="vrma_extension_missing")
    extension = extensions.get("VRMC_vrm_animation")
    if not isinstance(extension, dict):
        raise ContentFileInvalidError(field="file", reason="vrma_extension_missing")
    return extension


def _require_vrma_extension(
    document: dict[str, Any],
    *,
    repair_missing_spec_version: bool,
) -> dict[str, Any]:
    asset = document.get("asset")
    if not isinstance(asset, dict) or asset.get("version") != "2.0":
        raise ContentFileInvalidError(field="file", reason="vrma_invalid_gltf_version")
    used = document.get("extensionsUsed")
    if not isinstance(used, list) or "VRMC_vrm_animation" not in used:
        raise ContentFileInvalidError(field="file", reason="vrma_extension_missing")
    extension = _source_vrma_extension(document)
    spec_version = extension.get("specVersion")
    if spec_version is None and repair_missing_spec_version:
        extension["specVersion"] = "1.0"
        return extension
    if spec_version != "1.0":
        raise ContentFileInvalidError(field="file", reason="vrma_unsupported_spec_version")
    return extension


def _merge_embedded_resources(
    document: dict[str, Any],
    buffers: list[bytes],
    *,
    maximum_binary_bytes: int,
) -> tuple[dict[str, Any], bytes]:
    """Merge source buffers and embedded images into one aligned GLB BIN chunk."""

    merged = bytearray()
    buffer_offsets: list[int] = []
    for payload in buffers:
        _pad_binary(merged)
        buffer_offsets.append(len(merged))
        merged.extend(payload)

    raw_views = document.get("bufferViews", [])
    if not isinstance(raw_views, list):
        raise ContentFileInvalidError(field="file", reason="vrma_invalid_structure")
    for view in raw_views:
        if not isinstance(view, dict):
            raise ContentFileInvalidError(field="file", reason="vrma_invalid_structure")
        buffer_index = _nonnegative_int(view.get("buffer", 0))
        if buffer_index >= len(buffer_offsets):
            raise ContentFileInvalidError(field="file", reason="vrma_binary_range")
        byte_offset = _nonnegative_int(view.get("byteOffset", 0))
        byte_length = _positive_int(view.get("byteLength"))
        if byte_offset + byte_length > len(buffers[buffer_index]):
            raise ContentFileInvalidError(field="file", reason="vrma_binary_range")
        view["buffer"] = 0
        view["byteOffset"] = buffer_offsets[buffer_index] + byte_offset

    images = document.get("images", [])
    if not isinstance(images, list):
        raise ContentFileInvalidError(field="file", reason="vrma_invalid_structure")
    for image in images:
        if not isinstance(image, dict):
            raise ContentFileInvalidError(field="file", reason="vrma_invalid_structure")
        uri = image.get("uri")
        if uri is None:
            continue
        if not isinstance(uri, str):
            raise ContentFileInvalidError(field="file", reason="vrma_external_resource")
        payload, media_type = _decode_data_uri(uri)
        if media_type not in {"image/png", "image/jpeg", "image/webp"}:
            raise ContentFileInvalidError(field="file", reason="vrma_invalid_image")
        _pad_binary(merged)
        view_index = len(raw_views)
        raw_views.append(
            {
                "buffer": 0,
                "byteOffset": len(merged),
                "byteLength": len(payload),
            }
        )
        merged.extend(payload)
        image.pop("uri", None)
        image["bufferView"] = view_index
        image["mimeType"] = media_type
        if len(merged) > maximum_binary_bytes:
            raise ContentFileInvalidError(field="file", reason="vrma_binary_size_limit")

    if raw_views:
        document["bufferViews"] = raw_views
    elif "bufferViews" in document:
        document["bufferViews"] = []
    for item in images:
        if "uri" in item:
            raise ContentFileInvalidError(field="file", reason="vrma_external_resource")
    if merged:
        document["buffers"] = [{"byteLength": len(merged)}]
    else:
        document.pop("buffers", None)
    return document, bytes(merged)


class _VrmaFacts(TypedDict):
    node_count: int
    track_count: int
    keyframe_count: int
    duration_seconds: float


def _validate_vrma_document(
    document: dict[str, Any],
    binary: bytes,
) -> _VrmaFacts:
    _require_finite_json(document)
    structure = _validate_gltf_structure(
        document,
        binary,
        maximum_nodes=MAX_VRMA_NODES,
        maximum_views=MAX_VRMA_BUFFER_VIEWS,
        maximum_accessors=MAX_VRMA_ACCESSORS,
    )
    nodes = structure["nodes"]
    accessors = structure["accessors"]
    accessor_layouts = structure["accessor_layouts"]
    animations = document.get("animations")
    if not isinstance(animations, list) or len(animations) != 1:
        raise ContentFileInvalidError(field="file", reason="vrma_animation_count")

    track_count, keyframe_count, duration = _validate_animation(
        animations[0],
        nodes,
        accessors,
        accessor_layouts,
        binary,
    )
    _validate_vrma_humanoid_nodes(document, len(nodes))
    return {
        "node_count": len(nodes),
        "track_count": track_count,
        "keyframe_count": keyframe_count,
        "duration_seconds": duration,
    }


def _validate_gltf_structure(
    document: dict[str, Any],
    binary: bytes,
    *,
    maximum_nodes: int,
    maximum_views: int,
    maximum_accessors: int,
    allow_sparse: bool = False,
) -> dict[str, Any]:
    """Validate shared glTF graph and binary ranges used by VRM and VRMA.

    ``allow_sparse`` admits bounded sparse and zero-filled accessors (VRM morph
    targets); VRMA animation data stays dense because its samplers are read
    directly.
    """

    _require_finite_json(document)
    asset = document.get("asset")
    if not isinstance(asset, dict) or asset.get("version") != "2.0":
        raise ContentFileInvalidError(field="file", reason="vrma_invalid_gltf_version")
    nodes = _bounded_array(document, "nodes", maximum_nodes)
    views = _bounded_array(document, "bufferViews", maximum_views)
    accessors = _bounded_array(document, "accessors", maximum_accessors)
    _validate_nodes(nodes)
    view_ranges = _validate_buffer_views(views, len(binary))
    accessor_layouts = _validate_accessors(accessors, views, view_ranges, binary, allow_sparse=allow_sparse)
    _validate_images(document.get("images", []), len(views))
    _validate_gltf_references(document, nodes, accessors)
    return {
        "nodes": nodes,
        "views": views,
        "accessors": accessors,
        "accessor_layouts": accessor_layouts,
    }


def _validate_gltf_references(
    document: dict[str, Any],
    nodes: list[Any],
    accessors: list[Any],
) -> None:
    """Validate the model references exercised by GLTFLoader/VRMLoaderPlugin."""

    meshes = _bounded_array(document, "meshes", 8192)
    materials = _bounded_array(document, "materials", 8192)
    textures = _bounded_array(document, "textures", 8192)
    samplers = _bounded_array(document, "samplers", 8192)
    skins = _bounded_array(document, "skins", 8192)
    images = _bounded_array(document, "images", 8192)
    scenes = _bounded_array(document, "scenes", 1024)

    for node in nodes:
        for key, collection in (("mesh", meshes), ("skin", skins)):
            if key in node and _nonnegative_int(node[key]) >= len(collection):
                raise ContentFileInvalidError(field="file", reason="vrma_invalid_structure")
    for mesh in meshes:
        if not isinstance(mesh, dict) or not isinstance(mesh.get("primitives"), list) or not mesh["primitives"]:
            raise ContentFileInvalidError(field="file", reason="vrma_invalid_structure")
        for primitive in mesh["primitives"]:
            if not isinstance(primitive, dict) or not isinstance(primitive.get("attributes"), dict):
                raise ContentFileInvalidError(field="file", reason="vrma_invalid_structure")
            for accessor_index in primitive["attributes"].values():
                if _nonnegative_int(accessor_index) >= len(accessors):
                    raise ContentFileInvalidError(field="file", reason="vrma_invalid_structure")
            if "indices" in primitive and _nonnegative_int(primitive["indices"]) >= len(accessors):
                raise ContentFileInvalidError(field="file", reason="vrma_invalid_structure")
            if "material" in primitive and _nonnegative_int(primitive["material"]) >= len(materials):
                raise ContentFileInvalidError(field="file", reason="vrma_invalid_structure")
    for skin in skins:
        if not isinstance(skin, dict) or not isinstance(skin.get("joints"), list) or not skin["joints"]:
            raise ContentFileInvalidError(field="file", reason="vrma_invalid_structure")
        if any(_nonnegative_int(node) >= len(nodes) for node in skin["joints"]):
            raise ContentFileInvalidError(field="file", reason="vrma_invalid_structure")
        if "inverseBindMatrices" in skin and _nonnegative_int(skin["inverseBindMatrices"]) >= len(accessors):
            raise ContentFileInvalidError(field="file", reason="vrma_invalid_structure")
    for texture in textures:
        if not isinstance(texture, dict):
            raise ContentFileInvalidError(field="file", reason="vrma_invalid_structure")
        if "source" in texture and _nonnegative_int(texture["source"]) >= len(images):
            raise ContentFileInvalidError(field="file", reason="vrma_invalid_structure")
        webp = (
            texture.get("extensions", {}).get("EXT_texture_webp")
            if isinstance(texture.get("extensions"), dict)
            else None
        )
        if webp is not None and (not isinstance(webp, dict) or _nonnegative_int(webp.get("source")) >= len(images)):
            raise ContentFileInvalidError(field="file", reason="vrma_invalid_structure")
        if "sampler" in texture and _nonnegative_int(texture["sampler"]) >= len(samplers):
            raise ContentFileInvalidError(field="file", reason="vrma_invalid_structure")
    for scene in scenes:
        if not isinstance(scene, dict) or not isinstance(scene.get("nodes", []), list):
            raise ContentFileInvalidError(field="file", reason="vrma_invalid_structure")
        if any(_nonnegative_int(node) >= len(nodes) for node in scene.get("nodes", [])):
            raise ContentFileInvalidError(field="file", reason="vrma_invalid_structure")
    if "scene" in document and _nonnegative_int(document["scene"]) >= len(scenes):
        raise ContentFileInvalidError(field="file", reason="vrma_invalid_structure")


def _validate_vrm_humanoid(document: dict[str, Any], node_count: int) -> str:
    extensions = document.get("extensions")
    used = document.get("extensionsUsed")
    if not isinstance(extensions, dict) or not isinstance(used, list):
        raise ContentFileInvalidError(field="file", reason="vrm_extension_missing")
    if "VRMC_vrm" in used and isinstance(extensions.get("VRMC_vrm"), dict):
        vrm = extensions["VRMC_vrm"]
        if vrm.get("specVersion") != "1.0":
            raise ContentFileInvalidError(field="file", reason="vrm_unsupported_spec_version")
        bones = vrm.get("humanoid", {}).get("humanBones") if isinstance(vrm.get("humanoid"), dict) else None
        if not isinstance(bones, dict):
            raise ContentFileInvalidError(field="file", reason="vrm_invalid_humanoid")
        mapping = {
            name: bone.get("node") for name, bone in bones.items() if isinstance(name, str) and isinstance(bone, dict)
        }
        spec = "1.0"
    elif "VRM" in used and isinstance(extensions.get("VRM"), dict):
        vrm = extensions["VRM"]
        if vrm.get("specVersion") != "0.0":
            raise ContentFileInvalidError(field="file", reason="vrm_unsupported_spec_version")
        humanoid = vrm.get("humanoid")
        bones = humanoid.get("humanBones") if isinstance(humanoid, dict) else None
        if not isinstance(bones, list):
            raise ContentFileInvalidError(field="file", reason="vrm_invalid_humanoid")
        mapping = {
            bone["bone"]: bone.get("node")
            for bone in bones
            if isinstance(bone, dict) and isinstance(bone.get("bone"), str)
        }
        spec = "0.0"
    else:
        raise ContentFileInvalidError(field="file", reason="vrm_extension_missing")
    if not REQUIRED_VRM_HUMANOID_BONES.issubset(mapping):
        raise ContentFileInvalidError(field="file", reason="vrm_invalid_humanoid")
    node_indices = list(mapping.values())
    if any(
        isinstance(node, bool) or not isinstance(node, int) or node < 0 or node >= node_count for node in node_indices
    ) or len(set(node_indices)) != len(node_indices):
        raise ContentFileInvalidError(field="file", reason="vrm_invalid_humanoid")
    return spec


def _bounded_array(
    document: dict[str, Any],
    key: str,
    maximum: int,
) -> list[Any]:
    value = document.get(key, [])
    if not isinstance(value, list):
        raise ContentFileInvalidError(field="file", reason="vrma_invalid_structure")
    if len(value) > maximum:
        raise ContentFileInvalidError(field="file", reason="vrma_structure_limit")
    return value


def _validate_nodes(nodes: list[Any]) -> None:
    graph: list[list[int]] = []
    parent_counts = [0] * len(nodes)
    for node in nodes:
        if not isinstance(node, dict):
            raise ContentFileInvalidError(field="file", reason="vrma_invalid_structure")
        children = node.get("children", [])
        if not isinstance(children, list):
            raise ContentFileInvalidError(field="file", reason="vrma_invalid_structure")
        normalized_children: list[int] = []
        for child in children:
            index = _nonnegative_int(child)
            if index >= len(nodes):
                raise ContentFileInvalidError(field="file", reason="vrma_invalid_structure")
            normalized_children.append(index)
            parent_counts[index] += 1
            if parent_counts[index] > 1:
                raise ContentFileInvalidError(field="file", reason="vrma_invalid_structure")
        graph.append(normalized_children)

    state = [0] * len(nodes)
    for root in range(len(nodes)):
        if state[root] == 2:
            continue
        stack: list[tuple[int, bool]] = [(root, False)]
        while stack:
            index, leaving = stack.pop()
            if leaving:
                state[index] = 2
                continue
            if state[index] == 1:
                raise ContentFileInvalidError(field="file", reason="vrma_invalid_structure")
            if state[index] == 2:
                continue
            state[index] = 1
            stack.append((index, True))
            stack.extend((child, False) for child in reversed(graph[index]))


def _validate_images(images: Any, view_count: int) -> None:
    if not isinstance(images, list):
        raise ContentFileInvalidError(field="file", reason="vrma_invalid_structure")
    for image in images:
        if not isinstance(image, dict) or "uri" in image:
            raise ContentFileInvalidError(field="file", reason="vrma_external_resource")
        view_index = _nonnegative_int(image.get("bufferView"))
        if view_index >= view_count or image.get("mimeType") not in {"image/png", "image/jpeg", "image/webp"}:
            raise ContentFileInvalidError(field="file", reason="vrma_invalid_image")


def _validate_buffer_views(
    views: list[Any],
    binary_length: int,
) -> list[tuple[int, int]]:
    ranges: list[tuple[int, int]] = []
    for view in views:
        if not isinstance(view, dict) or view.get("buffer", 0) != 0:
            raise ContentFileInvalidError(field="file", reason="vrma_binary_range")
        start = _nonnegative_int(view.get("byteOffset", 0))
        length = _positive_int(view.get("byteLength"))
        end = start + length
        stride = view.get("byteStride")
        if stride is not None:
            stride_value = _positive_int(stride)
            if stride_value < 4 or stride_value > 252 or stride_value % 4:
                raise ContentFileInvalidError(field="file", reason="vrma_invalid_structure")
        if end > binary_length:
            raise ContentFileInvalidError(field="file", reason="vrma_binary_range")
        ranges.append((start, end))
    return ranges


def _validate_accessors(
    accessors: list[Any],
    views: list[Any],
    view_ranges: list[tuple[int, int]],
    binary: bytes,
    *,
    allow_sparse: bool,
) -> list[tuple[int, int, int, str, int] | None]:
    """Bound every accessor's data to its buffer view.

    With ``allow_sparse``, an accessor may omit its buffer view: it reads as
    zeros, overridden by its ``sparse`` values when present. Loaders allocate
    every sparse or zero-filled accessor as a full array, and sparse views may
    be shared, so their combined expanded size shares the binary chunk limit.
    Checking it before scanning sparse indices also bounds that scan.
    Returns each accessor's dense layout, or ``None`` for a zero-based one.
    """
    layouts: list[tuple[int, int, int, str, int] | None] = []
    expanded_bytes = 0
    for accessor in accessors:
        if not isinstance(accessor, dict) or ("sparse" in accessor and not allow_sparse):
            raise ContentFileInvalidError(field="file", reason="vrma_invalid_structure")
        component_type = _nonnegative_int(accessor.get("componentType"))
        component = _COMPONENT_FORMAT.get(component_type)
        type_name = accessor.get("type")
        components = _TYPE_COMPONENTS.get(type_name) if isinstance(type_name, str) else None
        count = _positive_int(accessor.get("count"))
        if component is None or components is None:
            raise ContentFileInvalidError(field="file", reason="vrma_invalid_structure")
        component_format, component_size = component
        element_size = component_size * components
        if allow_sparse and ("sparse" in accessor or "bufferView" not in accessor):
            expanded_bytes += count * element_size
            if expanded_bytes > MAX_VRM_BINARY_BYTES:
                raise ContentFileInvalidError(field="file", reason="vrma_structure_limit")
        if "sparse" in accessor:
            _validate_sparse(accessor["sparse"], count, element_size, component_size, views, view_ranges, binary)
        if allow_sparse and "bufferView" not in accessor:
            layouts.append(None)
            continue
        view_index = _nonnegative_int(accessor.get("bufferView"))
        if view_index >= len(views):
            raise ContentFileInvalidError(field="file", reason="vrma_binary_range")
        view = views[view_index]
        stride = _positive_int(view.get("byteStride", element_size))
        if stride < element_size:
            raise ContentFileInvalidError(field="file", reason="vrma_binary_range")
        start = _view_offset(view_ranges[view_index], accessor.get("byteOffset", 0), component_size)
        end = start + element_size + (count - 1) * stride
        if end > view_ranges[view_index][1]:
            raise ContentFileInvalidError(field="file", reason="vrma_binary_range")
        layouts.append((start, stride, count, component_format, components))
    return layouts


_SPARSE_INDEX_FORMAT = {5121: ("B", 1), 5123: ("H", 2), 5125: ("I", 4)}


def _view_offset(view_range: tuple[int, int], byte_offset: object, alignment: int) -> int:
    """Absolute start of data at ``byte_offset`` inside a view, aligned for its components."""
    start = view_range[0] + _nonnegative_int(byte_offset)
    if start % alignment:
        raise ContentFileInvalidError(field="file", reason="vrma_binary_range")
    return start


def _sparse_view(
    reference: object,
    views: list[Any],
    view_ranges: list[tuple[int, int]],
    length: int,
    alignment: int,
) -> int:
    """Start of a tightly packed sparse indices or values block of ``length`` bytes."""
    if not isinstance(reference, dict):
        raise ContentFileInvalidError(field="file", reason="vrma_invalid_structure")
    view_index = _nonnegative_int(reference.get("bufferView"))
    if view_index >= len(views):
        raise ContentFileInvalidError(field="file", reason="vrma_binary_range")
    if "byteStride" in views[view_index]:
        raise ContentFileInvalidError(field="file", reason="vrma_invalid_structure")
    start = _view_offset(view_ranges[view_index], reference.get("byteOffset", 0), alignment)
    if start + length > view_ranges[view_index][1]:
        raise ContentFileInvalidError(field="file", reason="vrma_binary_range")
    return start


def _validate_sparse(
    sparse: object,
    count: int,
    element_size: int,
    component_size: int,
    views: list[Any],
    view_ranges: list[tuple[int, int]],
    binary: bytes,
) -> None:
    """Check a sparse substitution: bounded count, in-range ranges, strictly increasing indices."""
    if not isinstance(sparse, dict):
        raise ContentFileInvalidError(field="file", reason="vrma_invalid_structure")
    sparse_count = _positive_int(sparse.get("count"))
    indices = sparse.get("indices")
    if sparse_count > count or not isinstance(indices, dict):
        raise ContentFileInvalidError(field="file", reason="vrma_invalid_structure")
    index_format = _SPARSE_INDEX_FORMAT.get(_nonnegative_int(indices.get("componentType")))
    if index_format is None:
        raise ContentFileInvalidError(field="file", reason="vrma_invalid_structure")
    index_code, index_size = index_format
    index_start = _sparse_view(indices, views, view_ranges, sparse_count * index_size, index_size)
    _sparse_view(sparse.get("values"), views, view_ranges, sparse_count * element_size, component_size)
    previous = -1
    for (index,) in struct.iter_unpack(f"<{index_code}", binary[index_start : index_start + sparse_count * index_size]):
        if index <= previous or index >= count:
            raise ContentFileInvalidError(field="file", reason="vrma_invalid_structure")
        previous = index


def _validate_animation(
    animation: Any,
    nodes: list[Any],
    accessors: list[Any],
    layouts: list[tuple[int, int, int, str, int] | None],
    binary: bytes,
) -> tuple[int, int, float]:
    if not isinstance(animation, dict):
        raise ContentFileInvalidError(field="file", reason="vrma_invalid_structure")
    samplers = animation.get("samplers")
    channels = animation.get("channels")
    if (
        not isinstance(samplers, list)
        or not samplers
        or not isinstance(channels, list)
        or not channels
        or len(samplers) > MAX_VRMA_ANIMATION_TRACKS
        or len(channels) > MAX_VRMA_ANIMATION_TRACKS
    ):
        raise ContentFileInvalidError(field="file", reason="vrma_structure_limit")

    total_keyframes = 0
    maximum_duration = 0.0
    sampler_counts: list[tuple[int, int, str, int]] = []
    for sampler in samplers:
        if not isinstance(sampler, dict):
            raise ContentFileInvalidError(field="file", reason="vrma_invalid_structure")
        input_index = _nonnegative_int(sampler.get("input"))
        output_index = _nonnegative_int(sampler.get("output"))
        if input_index >= len(accessors) or output_index >= len(accessors):
            raise ContentFileInvalidError(field="file", reason="vrma_invalid_structure")
        interpolation = sampler.get("interpolation", "LINEAR")
        if interpolation not in {"LINEAR", "STEP", "CUBICSPLINE"}:
            raise ContentFileInvalidError(field="file", reason="vrma_invalid_structure")
        input_accessor = accessors[input_index]
        output_accessor = accessors[output_index]
        if input_accessor.get("type") != "SCALAR" or input_accessor.get("componentType") != 5126:
            raise ContentFileInvalidError(field="file", reason="vrma_invalid_structure")
        if output_accessor.get("componentType") != 5126:
            raise ContentFileInvalidError(field="file", reason="vrma_invalid_structure")
        input_count = _positive_int(input_accessor.get("count"))
        output_count = _positive_int(output_accessor.get("count"))
        base_output_count = input_count * (3 if interpolation == "CUBICSPLINE" else 1)
        if output_count < base_output_count or output_count % base_output_count:
            raise ContentFileInvalidError(field="file", reason="vrma_invalid_structure")
        input_layout = layouts[input_index]
        output_layout = layouts[output_index]
        if input_layout is None or output_layout is None:
            raise ContentFileInvalidError(field="file", reason="vrma_invalid_structure")
        times = _read_accessor_values(input_layout, binary)
        if (
            not times
            or any(value < 0 for value in times)
            or any(current <= previous for previous, current in zip(times, times[1:], strict=False))
        ):
            raise ContentFileInvalidError(field="file", reason="vrma_invalid_structure")
        _require_finite_accessor(output_layout, binary)
        duration = float(times[-1])
        if duration > MAX_VRMA_DURATION_SECONDS:
            raise ContentFileInvalidError(field="file", reason="vrma_structure_limit")
        maximum_duration = max(maximum_duration, duration)
        total_keyframes += input_count
        if total_keyframes > MAX_VRMA_KEYFRAMES:
            raise ContentFileInvalidError(field="file", reason="vrma_structure_limit")
        sampler_counts.append((input_count, output_count, interpolation, output_index))

    targets: set[tuple[int, str]] = set()
    for channel in channels:
        if not isinstance(channel, dict):
            raise ContentFileInvalidError(field="file", reason="vrma_invalid_structure")
        sampler_index = _nonnegative_int(channel.get("sampler"))
        target = channel.get("target")
        if sampler_index >= len(samplers) or not isinstance(target, dict):
            raise ContentFileInvalidError(field="file", reason="vrma_invalid_structure")
        node_index = _nonnegative_int(target.get("node"))
        path = target.get("path")
        if node_index >= len(nodes) or path not in {"translation", "rotation", "scale", "weights"}:
            raise ContentFileInvalidError(field="file", reason="vrma_invalid_structure")
        target_key = (node_index, path)
        if target_key in targets:
            raise ContentFileInvalidError(field="file", reason="vrma_invalid_structure")
        targets.add(target_key)
        input_count, output_count, interpolation, output_index = sampler_counts[sampler_index]
        output_type = accessors[output_index].get("type")
        expected_type = {
            "translation": "VEC3",
            "rotation": "VEC4",
            "scale": "VEC3",
            "weights": "SCALAR",
        }[path]
        if output_type != expected_type:
            raise ContentFileInvalidError(field="file", reason="vrma_invalid_structure")
        expected_output_count = input_count * (3 if interpolation == "CUBICSPLINE" else 1)
        if path != "weights" and output_count != expected_output_count:
            raise ContentFileInvalidError(field="file", reason="vrma_invalid_structure")
    return len(channels), total_keyframes, maximum_duration


def _read_accessor_values(
    layout: tuple[int, int, int, str, int],
    binary: bytes,
) -> list[float]:
    start, stride, count, component_format, components = layout
    values: list[float] = []
    format_string = f"<{components}{component_format}"
    for index in range(count):
        unpacked = struct.unpack_from(format_string, binary, start + index * stride)
        for value in unpacked:
            number = float(value)
            if not math.isfinite(number):
                raise ContentFileInvalidError(field="file", reason="vrma_non_finite_number")
            values.append(number)
    return values


def _require_finite_accessor(
    layout: tuple[int, int, int, str, int],
    binary: bytes,
) -> None:
    if layout[3] == "f":
        _read_accessor_values(layout, binary)


def _validate_vrma_humanoid_nodes(
    document: dict[str, Any],
    node_count: int,
) -> None:
    extension = _source_vrma_extension(document)
    humanoid = extension.get("humanoid")
    if not isinstance(humanoid, dict):
        raise ContentFileInvalidError(field="file", reason="vrma_invalid_structure")
    bones = humanoid.get("humanBones")
    if not isinstance(bones, dict) or not bones:
        raise ContentFileInvalidError(field="file", reason="vrma_invalid_structure")
    seen: set[int] = set()
    for bone in bones.values():
        if not isinstance(bone, dict):
            raise ContentFileInvalidError(field="file", reason="vrma_invalid_structure")
        node = _nonnegative_int(bone.get("node"))
        if node >= node_count or node in seen:
            raise ContentFileInvalidError(field="file", reason="vrma_invalid_structure")
        seen.add(node)


def _require_finite_json(value: Any) -> None:
    stack = [value]
    while stack:
        current = stack.pop()
        if isinstance(current, dict):
            stack.extend(current.values())
        elif isinstance(current, list):
            stack.extend(current)
        elif isinstance(current, float) and not math.isfinite(current):
            raise ContentFileInvalidError(field="file", reason="vrma_non_finite_number")


def _nonnegative_int(value: object) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise ContentFileInvalidError(field="file", reason="vrma_invalid_structure")
    return value


def _positive_int(value: Any) -> int:
    result = _nonnegative_int(value)
    if result < 1:
        raise ContentFileInvalidError(field="file", reason="vrma_invalid_structure")
    return result


def _pad_binary(output: bytearray) -> None:
    output.extend(b"\x00" * (-len(output) % 4))


def _write_glb(document: dict[str, Any], binary: bytes) -> bytes:
    json_chunk = json.dumps(
        document,
        allow_nan=False,
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")
    json_chunk += b" " * (-len(json_chunk) % 4)
    binary_chunk = binary + b"\x00" * (-len(binary) % 4)
    total_length = 12 + 8 + len(json_chunk)
    if binary_chunk:
        total_length += 8 + len(binary_chunk)
    output = bytearray(struct.pack("<4sII", GLB_MAGIC, GLB_VERSION, total_length))
    output.extend(struct.pack("<II", len(json_chunk), GLB_JSON_CHUNK_TYPE))
    output.extend(json_chunk)
    if binary_chunk:
        output.extend(struct.pack("<II", len(binary_chunk), GLB_BIN_CHUNK_TYPE))
        output.extend(binary_chunk)
    return bytes(output)


__all__ = [
    "CanonicalVrma",
    "MAX_GLTF_JSON_BYTES",
    "MAX_VRMA_ACCESSORS",
    "MAX_VRMA_ANIMATION_TRACKS",
    "MAX_VRMA_BUFFER_VIEWS",
    "MAX_VRMA_DURATION_SECONDS",
    "MAX_VRMA_KEYFRAMES",
    "MAX_VRMA_NODES",
    "canonicalize_vrma_stream",
    "validate_vrm_stream",
    "validate_vrma_stream",
]
