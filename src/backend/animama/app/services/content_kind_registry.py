"""Closed typed-handler registry for the readable Content Catalog.

Each handler is the sole owner of one product kind's document contract,
dependency rules, semantic file roles, runtime projection, and package reference
rewriting. The filesystem/catalog layers remain intentionally generic.
"""

from __future__ import annotations

import json
import re
import struct
from collections.abc import Iterable, Iterator, Mapping
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import Any, Literal

from animama.domain.content_catalog import ContentDiagnostic, ContentKind
from animama.domain.content_documents import (
    ActionImplementationV1,
    AppearanceDocumentV1,
    AvatarDocumentV1,
    AvatarEffectDocumentV1,
    ContentDependencyV1,
    ContentDocumentError,
    ContentFileDeclarationV1,
    GestureDocumentV1,
    IdleAnimationDocumentV1,
    IdleStyleCellV2,
    IdleStyleDocumentV1,
    IdleStyleDocumentV2,
    MusicTrackDocumentV1,
    ParticleEffectDocumentV1,
    PoseClipDocumentV1,
    PoseDocumentV1,
    ReactionDocumentV1,
    SceneEffectDocumentV1,
    SoundEffectDocumentV1,
    TypedContentDocument,
    VoiceDocumentV1,
)
from animama.domain.emotions import TRACKED_EMOTION_SET

from .content_file_validation import ContentFileInvalidError
from .content_gltf import MAX_VRM_SOURCE_BYTES, validate_vrm_stream
from .content_image import MAX_APPEARANCE_SOURCE_BYTES, validate_appearance_image_stream
from .content_pose import validate_resolved_pose
from .content_svg import validate_svg_file

MAX_JSON_BYTES = 16 * 1024 * 1024
MAX_DOCUMENT_DEPTH = 32
MAX_DOCUMENT_NODES = 100_000
LOGICAL_KEY_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9:._-]{0,191}$")
SEMANTIC_KEY_PATTERN = re.compile(r"^[a-z0-9][a-z0-9._-]{0,127}$")
ROLE_PATTERN = re.compile(r"^[a-z][a-z0-9_-]{0,63}$")


@dataclass(frozen=True, slots=True)
class ContentKindDefinition:
    """Filesystem limits and naming policy attached to one typed handler."""

    kind: ContentKind
    directory: str
    standalone_extensions: frozenset[str]
    descriptor_suffix: str | None
    runtime_player: str
    max_file_bytes: int = 1024 * 1024 * 1024
    max_entry_files: int = 512
    max_entry_bytes: int = 2 * 1024 * 1024 * 1024


@dataclass(frozen=True, slots=True)
class ParsedContentDocument:
    """Validated handler output persisted as bounded catalog/search facts."""

    document: TypedContentDocument
    metadata: dict[str, Any]
    display_name: str
    logical_key: str | None
    dependencies: tuple[ContentDependencyV1, ...]


@dataclass(frozen=True, slots=True)
class RuntimeProjectionInput:
    """Transport-neutral facts supplied to a handler runtime projector."""

    item_id: str
    runtime_root_id: str
    slot_key: str
    source: dict[str, Any]
    revision: str
    context: dict[str, Any]
    files: list[dict[str, Any]]
    logical_files: dict[str, dict[str, Any]]
    dependency_files: dict[str, list[dict[str, Any]]]
    reference_map: dict[str, str]


@dataclass(frozen=True, slots=True)
class RuntimeProjection:
    """One discriminated product projection returned to the runtime service."""

    lane: Literal[
        "gesture",
        "pose",
        "reaction",
        "idle_style",
        "music_track",
        "avatar",
        "appearance",
        "support",
        "none",
    ]
    payload: dict[str, Any] | None


_MEDIA_TYPES = {
    ".bin": "application/octet-stream",
    ".flac": "audio/flac",
    ".jpeg": "image/jpeg",
    ".jpg": "image/jpeg",
    ".json": "application/json",
    ".mp3": "audio/mpeg",
    ".ogg": "audio/ogg",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".vrm": "model/gltf-binary",
    ".vrma": "model/gltf-binary",
    ".wav": "audio/wav",
    ".webp": "image/webp",
}

_COMMON_FIELDS = frozenset(
    {
        "schema_version",
        "content_type",
        "kind",
        "content_id",
        "id",
        "version",
        "name",
        "display_name",
        "description",
        "ai_description",
        "files",
        "dependencies",
        "provenance",
        "license",
        "redistribution_review",
        "notes",
        "authoring",
        "logical_resource_files",
    }
)

_KIND_FIELDS: dict[ContentKind, frozenset[str]] = {
    ContentKind.AVATAR: frozenset({"compatibility", "model_role"}),
    ContentKind.GESTURE: frozenset(
        {"semantic_key", "implementation", "config", "runtime_defaults", "technical_source"}
    ),
    ContentKind.POSE: frozenset({"pose"}),
    ContentKind.POSE_CLIP: frozenset(
        {
            "schema",
            "role",
            "playback",
            "defaultTransition",
            "fadeIn",
            "fadeOut",
            "poses",
            "poseKeyframes",
            "events",
            "config",
        }
    ),
    ContentKind.REACTION: frozenset(
        {"placement_hint", "implementation", "config", "runtime_defaults", "technical_source"}
    ),
    ContentKind.PARTICLE_EFFECT: frozenset({"runtime_defaults", "definition", "config", "technical_source"}),
    ContentKind.AVATAR_EFFECT: frozenset({"runtime_defaults", "definition", "config", "technical_source"}),
    ContentKind.SCENE_EFFECT: frozenset({"runtime_defaults", "definition", "config", "technical_source"}),
    ContentKind.SOUND_EFFECT: frozenset({"duration_seconds", "codec", "defaults", "config", "technical_source"}),
    ContentKind.IDLE_STYLE: frozenset(
        {
            "revision",
            "animations",
            "default_pool",
            "cells",
            "emotion_pools",
            "cross_fade_seconds",
            "compatibility",
            "config",
        }
    ),
    ContentKind.MUSIC_TRACK: frozenset(
        {"revision", "duration_seconds", "codec", "defaults", "config", "technical_source"}
    ),
    ContentKind.APPEARANCE: frozenset(
        {
            "width",
            "height",
            "avatar_model",
            "renderer_version",
            "capture_preset_version",
            "presentation",
            "config",
        }
    ),
    ContentKind.VOICE: frozenset({"codec", "language", "sample_rate_hz", "voices", "compatibility", "config"}),
    ContentKind.ANIMA: frozenset(),
}

_ALLOWED_DEPENDENCIES: dict[ContentKind, frozenset[ContentKind]] = {
    ContentKind.AVATAR: frozenset(),
    ContentKind.POSE: frozenset(),
    ContentKind.GESTURE: frozenset(
        {
            ContentKind.POSE_CLIP,
            ContentKind.PARTICLE_EFFECT,
            ContentKind.AVATAR_EFFECT,
            ContentKind.SCENE_EFFECT,
            ContentKind.SOUND_EFFECT,
        }
    ),
    ContentKind.POSE_CLIP: frozenset(
        {
            ContentKind.PARTICLE_EFFECT,
            ContentKind.AVATAR_EFFECT,
            ContentKind.SCENE_EFFECT,
            ContentKind.SOUND_EFFECT,
        }
    ),
    ContentKind.REACTION: frozenset(
        {
            ContentKind.POSE_CLIP,
            ContentKind.PARTICLE_EFFECT,
            ContentKind.AVATAR_EFFECT,
            ContentKind.SCENE_EFFECT,
            ContentKind.SOUND_EFFECT,
        }
    ),
    ContentKind.PARTICLE_EFFECT: frozenset({ContentKind.SOUND_EFFECT}),
    ContentKind.AVATAR_EFFECT: frozenset({ContentKind.SOUND_EFFECT}),
    ContentKind.SCENE_EFFECT: frozenset({ContentKind.SOUND_EFFECT}),
    ContentKind.SOUND_EFFECT: frozenset(),
    ContentKind.IDLE_STYLE: frozenset({ContentKind.GESTURE, ContentKind.POSE_CLIP}),
    ContentKind.MUSIC_TRACK: frozenset(),
    ContentKind.APPEARANCE: frozenset(),
    ContentKind.VOICE: frozenset(),
    ContentKind.ANIMA: frozenset(),
}

_LOCAL_REFERENCE_FIELDS = frozenset(
    {
        "catalog_item_id",
        "owner_user_id",
        "user_id",
        "host_locator",
        "storage_locator",
        "relative_locator",
        "file_ref",
        "preview_id",
        "runtime_revision",
        "effective_revision",
    }
)


def media_type_for(path: Path) -> str:
    """Return a stable media type for a handler-approved extension."""

    if path.suffix.lower() in {".vrm", ".vrma"}:
        try:
            with path.open("rb") as handle:
                return "model/gltf-binary" if handle.read(4) == b"glTF" else "model/gltf+json"
        except OSError:
            return "application/octet-stream"
    return _MEDIA_TYPES.get(path.suffix.lower(), "application/octet-stream")


def display_name_from_path(path: Path) -> str:
    """Derive a readable default without requiring a metadata file."""

    return path.stem.replace("_", " ").replace("-", " ").strip().title() or path.name


def parse_json_object(path: Path) -> tuple[dict[str, Any] | None, ContentDiagnostic | None]:
    """Parse a bounded UTF-8 JSON object with a safe diagnostic."""

    try:
        if path.stat().st_size > MAX_JSON_BYTES:
            return None, ContentDiagnostic("json_too_large", "JSON exceeds the supported size limit")
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError):
        return None, ContentDiagnostic("malformed_json", "File is not a valid UTF-8 JSON document")
    if not isinstance(value, dict):
        return None, ContentDiagnostic("invalid_json_shape", "Top-level JSON value must be an object")
    try:
        _validate_bounded_json(value)
    except ContentDocumentError as exc:
        return None, ContentDiagnostic(exc.code, str(exc))
    return value, None


def _validate_bounded_json(value: Any) -> None:
    nodes = 0

    def visit(current: Any, depth: int) -> None:
        nonlocal nodes
        nodes += 1
        if nodes > MAX_DOCUMENT_NODES:
            raise ContentDocumentError("document_too_complex", "Document contains too many values")
        if depth > MAX_DOCUMENT_DEPTH:
            raise ContentDocumentError("document_too_deep", "Document nesting exceeds the supported limit")
        if isinstance(current, dict):
            for key, child in current.items():
                if not isinstance(key, str):
                    raise ContentDocumentError("invalid_object_key", "Document object keys must be strings")
                visit(child, depth + 1)
        elif isinstance(current, list):
            for child in current:
                visit(child, depth + 1)
        elif current is not None and not isinstance(current, str | int | float | bool):
            raise ContentDocumentError("invalid_json_value", "Document contains an unsupported value")

    visit(value, 0)


def validate_standalone_file(
    definition: ContentKindDefinition,
    path: Path,
) -> tuple[ContentDiagnostic, ...]:
    """Perform bounded structural validation before a file enters the catalog."""

    suffix = path.suffix.lower()
    if suffix not in definition.standalone_extensions:
        return (ContentDiagnostic("unsupported_extension", f"{suffix or 'extensionless'} files are not supported"),)
    try:
        size = path.stat().st_size
        with path.open("rb") as handle:
            prefix = handle.read(16)
    except OSError:
        return (ContentDiagnostic("unreadable_file", "File could not be read"),)
    if size <= 0:
        return (ContentDiagnostic("empty_file", "Content files cannot be empty"),)
    if size > definition.max_file_bytes:
        return (ContentDiagnostic("file_too_large", "File exceeds the supported size limit"),)
    if suffix == ".svg":
        return validate_svg_file(path)
    if suffix == ".vrm" or definition.kind is ContentKind.APPEARANCE and suffix in {".png", ".jpg", ".jpeg", ".webp"}:
        try:
            with path.open("rb") as handle:
                if suffix == ".vrm":
                    validate_vrm_stream(content=handle, size_bytes=size)
                else:
                    validate_appearance_image_stream(extension=suffix, content=handle, size_bytes=size)
        except ContentFileInvalidError as exc:
            return (ContentDiagnostic(exc.reason, "Media failed bounded structural validation"),)
        except OSError:
            return (ContentDiagnostic("unreadable_file", "File could not be read"),)
    if suffix == ".vrma":
        value, gltf_error = _parse_gltf_document(path, size=size, binary=prefix[:4] == b"glTF")
        if gltf_error or value is None:
            return (gltf_error or ContentDiagnostic("invalid_gltf_container", "glTF data is invalid"),)
        asset = value.get("asset")
        if not isinstance(asset, dict) or not str(asset.get("version", "")).startswith("2"):
            return (ContentDiagnostic("invalid_gltf_asset", "VRM and VRMA require a glTF 2 asset"),)
        extensions = value.get("extensions")
        expected = {"VRM", "VRMC_vrm"} if suffix == ".vrm" else {"VRMC_vrm_animation"}
        if not isinstance(extensions, dict) or not expected.intersection(extensions):
            return (
                ContentDiagnostic(
                    "missing_vrm_extension",
                    "File does not contain the extension required by its VRM or VRMA type",
                ),
            )
    if suffix == ".json":
        _, error = parse_json_object(path)
        return (error,) if error else ()
    if suffix == ".png" and prefix[:8] != b"\x89PNG\r\n\x1a\n":
        return (ContentDiagnostic("invalid_png_header", "PNG signature is invalid"),)
    if suffix in {".jpg", ".jpeg"} and prefix[:2] != b"\xff\xd8":
        return (ContentDiagnostic("invalid_jpeg_header", "JPEG signature is invalid"),)
    if suffix == ".webp" and not (prefix[:4] == b"RIFF" and prefix[8:12] == b"WEBP"):
        return (ContentDiagnostic("invalid_webp_header", "WebP signature is invalid"),)
    if suffix == ".wav" and not (prefix[:4] == b"RIFF" and prefix[8:12] == b"WAVE"):
        return (ContentDiagnostic("invalid_wav_header", "WAV signature is invalid"),)
    if suffix == ".ogg" and prefix[:4] != b"OggS":
        return (ContentDiagnostic("invalid_ogg_header", "Ogg signature is invalid"),)
    if suffix == ".flac" and prefix[:4] != b"fLaC":
        return (ContentDiagnostic("invalid_flac_header", "FLAC signature is invalid"),)
    if suffix == ".mp3" and not (
        prefix[:3] == b"ID3" or (len(prefix) >= 2 and prefix[0] == 0xFF and prefix[1] & 0xE0 == 0xE0)
    ):
        return (ContentDiagnostic("invalid_mp3_header", "MP3 frame signature is invalid"),)
    return ()


def _parse_gltf_document(
    path: Path,
    *,
    size: int,
    binary: bool,
) -> tuple[dict[str, Any] | None, ContentDiagnostic | None]:
    """Parse bounded JSON metadata and verify the complete GLB chunk envelope."""

    if not binary:
        return parse_json_object(path)
    if size < 20:
        return None, ContentDiagnostic("invalid_gltf_container", "GLB header is truncated")
    try:
        with path.open("rb") as handle:
            header = handle.read(12)
            magic, version, declared_length = struct.unpack("<4sII", header)
            if magic != b"glTF" or version != 2 or declared_length != size:
                return None, ContentDiagnostic(
                    "invalid_gltf_container",
                    "GLB magic, version, or declared length is invalid",
                )
            offset = 12
            document: dict[str, Any] | None = None
            while offset < size:
                chunk_header = handle.read(8)
                if len(chunk_header) != 8:
                    return None, ContentDiagnostic("invalid_gltf_container", "GLB chunk header is truncated")
                chunk_length, chunk_type = struct.unpack("<II", chunk_header)
                offset += 8
                if chunk_length % 4 != 0 or offset + chunk_length > size:
                    return None, ContentDiagnostic("invalid_gltf_container", "GLB chunk bounds are invalid")
                if offset == 20:
                    if chunk_type != 0x4E4F534A or chunk_length > MAX_JSON_BYTES:
                        return None, ContentDiagnostic(
                            "invalid_gltf_container",
                            "GLB must begin with a bounded JSON chunk",
                        )
                    raw_document = handle.read(chunk_length)
                    parsed = json.loads(raw_document.decode("utf-8").rstrip(" \t\r\n\x00"))
                    if not isinstance(parsed, dict):
                        return None, ContentDiagnostic(
                            "invalid_gltf_container",
                            "GLB JSON chunk must contain an object",
                        )
                    document = parsed
                else:
                    handle.seek(chunk_length, 1)
                offset += chunk_length
            if offset != size or document is None:
                return None, ContentDiagnostic("invalid_gltf_container", "GLB chunks do not fill the file")
            return document, None
    except (OSError, UnicodeError, json.JSONDecodeError, struct.error):
        return None, ContentDiagnostic("invalid_gltf_container", "GLB metadata could not be parsed")


def _string(value: Any, *, field_name: str, fallback: str | None = None, maximum: int = 512) -> str:
    if value is None and fallback is not None:
        value = fallback
    if not isinstance(value, str) or not value.strip() or len(value.strip()) > maximum:
        raise ContentDocumentError("invalid_document_field", f"{field_name} must be a non-empty string")
    return value.strip()


def _optional_string(value: Any, *, field_name: str, maximum: int = 4_096) -> str | None:
    if value is None:
        return None
    return _string(value, field_name=field_name, maximum=maximum)


def _object(value: Any, *, field_name: str) -> dict[str, Any]:
    if value is None:
        return {}
    if not isinstance(value, dict):
        raise ContentDocumentError("invalid_document_field", f"{field_name} must be an object")
    return dict(value)


def _number(
    value: Any,
    *,
    field_name: str,
    default: float,
    minimum: float,
    maximum: float,
) -> float:
    if value is None:
        return default
    if isinstance(value, bool) or not isinstance(value, int | float):
        raise ContentDocumentError("invalid_document_field", f"{field_name} must be a number")
    result = float(value)
    if not minimum <= result <= maximum:
        raise ContentDocumentError("invalid_document_field", f"{field_name} is outside its supported range")
    return result


def _content_id(raw: Mapping[str, Any]) -> str | None:
    candidate = raw.get("content_id", raw.get("id"))
    if candidate is None:
        return None
    if not isinstance(candidate, str) or not LOGICAL_KEY_PATTERN.fullmatch(candidate):
        raise ContentDocumentError("invalid_logical_key", "content_id uses unsupported characters")
    return candidate


def _files(raw: Mapping[str, Any]) -> tuple[ContentFileDeclarationV1, ...]:
    value = raw.get("files", [])
    if not isinstance(value, list):
        raise ContentDocumentError("invalid_file_declarations", "files must be an array")
    result: list[ContentFileDeclarationV1] = []
    seen: set[str] = set()
    path: object
    for item in value:
        if isinstance(item, str):
            path = item
            role = "dependency"
        elif isinstance(item, dict):
            path = item.get("path")
            role = item.get("role", "dependency")
        else:
            raise ContentDocumentError("invalid_file_declaration", "files entries must be paths or objects")
        if not isinstance(path, str) or not _valid_dependency_reference(path):
            raise ContentDocumentError("invalid_file_declaration", "file paths must be safe relative paths")
        if not isinstance(role, str) or not ROLE_PATTERN.fullmatch(role):
            raise ContentDocumentError("invalid_file_role", "file roles must be lowercase identifiers")
        if path in seen:
            raise ContentDocumentError("duplicate_file_declaration", "file paths must be unique")
        seen.add(path)
        result.append(ContentFileDeclarationV1(path=path, role=role))
    return tuple(result)


def _dependency_reference(item: Any) -> str | None:
    if isinstance(item, str):
        return item
    if not isinstance(item, dict):
        return None
    for key in ("ref", "id", "content_id"):
        candidate = item.get(key)
        if isinstance(candidate, str):
            return candidate
    source = item.get("source")
    if isinstance(source, dict):
        candidate = source.get("content_id")
        if isinstance(candidate, str):
            return candidate
    return None


def _dependency_kind(item: Any) -> ContentKind | None:
    if not isinstance(item, dict):
        return None
    candidate = item.get("content_type", item.get("kind"))
    source = item.get("source")
    if candidate is None and isinstance(source, dict):
        candidate = source.get("content_type", source.get("kind"))
    try:
        return ContentKind(str(candidate)) if candidate is not None else None
    except ValueError:
        return None


def _dependencies(raw: Mapping[str, Any], kind: ContentKind) -> tuple[ContentDependencyV1, ...]:
    value = raw.get("dependencies", [])
    if not isinstance(value, list):
        raise ContentDocumentError("invalid_dependencies", "dependencies must be an array")
    result: list[ContentDependencyV1] = []
    seen_refs: set[str] = set()
    for item in value:
        reference = _dependency_reference(item)
        dependency_kind = _dependency_kind(item)
        if reference is None or not _valid_dependency_reference(reference):
            raise ContentDocumentError("invalid_dependency_reference", "dependency references must be portable")
        if dependency_kind is None:
            raise ContentDocumentError("dependency_kind_required", "every dependency must declare content_type")
        if dependency_kind not in _ALLOWED_DEPENDENCIES[kind]:
            raise ContentDocumentError(
                "dependency_kind_not_allowed",
                f"{kind.value} cannot depend on {dependency_kind.value}",
            )
        if reference in seen_refs:
            raise ContentDocumentError("duplicate_dependency", "dependency references must be unique")
        seen_refs.add(reference)
        alias: str | None = None
        config: dict[str, Any] = {}
        if isinstance(item, dict):
            raw_alias = item.get("alias")
            if raw_alias is not None:
                alias = _string(raw_alias, field_name="dependencies.alias", maximum=128)
            config = _object(item.get("config"), field_name="dependencies.config")
        result.append(ContentDependencyV1(reference, dependency_kind, alias, config))
    return tuple(result)


def _action_implementation(raw: Mapping[str, Any], *, default_kind: str) -> ActionImplementationV1:
    implementation = _object(raw.get("implementation"), field_name="implementation")
    raw_kind = implementation.get("kind", default_kind)
    if raw_kind not in {"anima_clip", "vrma"}:
        raise ContentDocumentError("invalid_action_implementation", "implementation.kind is unsupported")
    file_role = implementation.get("file_role")
    if file_role is not None and (not isinstance(file_role, str) or not ROLE_PATTERN.fullmatch(file_role)):
        raise ContentDocumentError("invalid_file_role", "implementation.file_role is invalid")
    dependency_ref: str | None = None
    technical = implementation.get("technical_source")
    if technical is not None:
        if not isinstance(technical, dict):
            raise ContentDocumentError("invalid_technical_source", "technical_source must be an object")
        source_type = technical.get("type")
        if source_type == "public_url":
            raise ContentDocumentError(
                "public_url_not_portable",
                "runtime media must use a registered file or content dependency",
            )
        if source_type == "content_dependency":
            dependency_ref = _string(technical.get("ref"), field_name="technical_source.ref")
        elif source_type == "runtime_catalog":
            raise ContentDocumentError(
                "runtime_catalog_not_portable",
                "runtime media must use registered files or a content dependency",
            )
        elif source_type is not None:
            raise ContentDocumentError("invalid_technical_source", "technical_source.type is unsupported")
    return ActionImplementationV1(raw_kind, file_role, dependency_ref)


def _base_values(
    raw: Mapping[str, Any],
    *,
    kind: ContentKind,
    fallback_name: str,
    files: tuple[ContentFileDeclarationV1, ...],
    dependencies: tuple[ContentDependencyV1, ...],
) -> dict[str, Any]:
    version = raw.get("version", 1)
    schema_version = raw.get("schema_version", 1)
    if isinstance(version, bool) or not isinstance(version, int) or version < 1:
        raise ContentDocumentError("invalid_document_version", "version must be a positive integer")
    if (
        isinstance(schema_version, bool)
        or not isinstance(schema_version, int)
        or schema_version not in ({1, 2} if kind is ContentKind.IDLE_STYLE else {1})
    ):
        raise ContentDocumentError("unsupported_schema_version", "unsupported document schema_version")
    return {
        "kind": kind,
        "name": _string(
            raw.get("name", raw.get("display_name")),
            field_name="name",
            fallback=fallback_name,
            maximum=120,
        ),
        "content_id": _content_id(raw),
        "description": _optional_string(
            raw.get("description", raw.get("ai_description")),
            field_name="description",
        ),
        "version": version,
        "schema_version": schema_version,
        "files": files,
        "dependencies": dependencies,
        "provenance": _object(raw.get("provenance"), field_name="provenance"),
    }


def idle_cells_projection(cells: Mapping[str, Mapping[str, IdleStyleCellV2]]) -> dict[str, Any]:
    """Serialize exact cells without turning inherited cells into explicit pools."""

    return {
        emotion: {
            intensity: {"mode": cell.mode, **({"gestures": list(cell.gestures)} if cell.mode == "pool" else {})}
            for intensity, cell in levels.items()
        }
        for emotion, levels in cells.items()
    }


def _idle_style_v2(raw: Mapping[str, Any], base: dict[str, Any]) -> IdleStyleDocumentV2:
    """Admit only complete Gesture references and the canonical exact-cell model."""

    if set(raw) & {"animations", "emotion_pools", "cross_fade_seconds", "config"} or base["files"]:
        raise ContentDocumentError(
            "idle_legacy_fields", "Idle Style v2 owns Gesture pools, not animation files or overrides"
        )
    dependencies = base["dependencies"]
    if any(edge.kind is not ContentKind.GESTURE or edge.config for edge in dependencies):
        raise ContentDocumentError(
            "idle_gesture_dependencies_required", "Idle pools require Gesture dependencies without overrides"
        )
    refs = {edge.ref for edge in dependencies}
    used: set[str] = set()

    def pool(value: Any, *, allow_empty: bool = False) -> tuple[str, ...]:
        if not isinstance(value, list) or any(not isinstance(ref, str) for ref in value):
            raise ContentDocumentError("idle_pool_invalid", "Idle pools must contain Gesture references")
        if (not value and not allow_empty) or len(set(value)) != len(value) or not set(value) <= refs:
            raise ContentDocumentError("idle_pool_invalid", "Idle pools require unique declared Gesture references")
        used.update(value)
        return tuple(value)

    default_pool = pool(raw.get("default_pool", []), allow_empty=True)
    cells: dict[str, dict[str, IdleStyleCellV2]] = {}
    for emotion, levels in _object(raw.get("cells"), field_name="cells").items():
        if emotion not in TRACKED_EMOTION_SET:
            raise ContentDocumentError(
                "idle_cell_invalid", "Idle cells require a tracked emotion; neutral uses Default"
            )
        cells[emotion] = {}
        for intensity, value in _object(levels, field_name="cells.emotion").items():
            cell = _object(value, field_name="cells.emotion.intensity")
            if (
                intensity not in {"1", "2", "3"}
                or not isinstance(cell.get("mode"), str)
                or cell["mode"] not in {"none", "pool"}
            ):
                raise ContentDocumentError(
                    "idle_cell_invalid", "Idle cells require intensity 1–3 and mode none or pool"
                )
            expected_fields = {"mode", "gestures"} if cell["mode"] == "pool" else {"mode"}
            if set(cell) != expected_fields:
                raise ContentDocumentError("idle_cell_invalid", "Idle cell fields do not match its mode")
            cells[emotion][intensity] = IdleStyleCellV2(
                mode=cell["mode"],
                gestures=pool(cell["gestures"]) if cell["mode"] == "pool" else (),
            )
    if used != refs:
        raise ContentDocumentError("idle_unused_dependency", "Every Idle Style dependency must belong to a pool")
    return IdleStyleDocumentV2(
        **base,
        default_pool=default_pool,
        cells=cells,
        compatibility=_object(raw.get("compatibility"), field_name="compatibility"),
    )


class ContentTypeHandler:
    """Closed behavior bundle for one scannable product content kind."""

    def __init__(self, definition: ContentKindDefinition, *, reserved: bool = False) -> None:
        self.definition = definition
        self.reserved = reserved

    @property
    def kind(self) -> ContentKind:
        return self.definition.kind

    @property
    def allowed_dependency_kinds(self) -> frozenset[ContentKind]:
        return _ALLOWED_DEPENDENCIES[self.kind]

    def parse_document(
        self,
        raw: Mapping[str, Any] | None,
        *,
        fallback_path: Path,
        descriptor_backed: bool,
    ) -> ParsedContentDocument:
        """Parse or derive this kind's exact V1 document and search projection."""

        if self.reserved:
            raise ContentDocumentError(
                "anima_descriptor_reserved",
                "Portable Anima descriptors are reserved for the Base Anima portability phase",
            )
        value = dict(raw or {})
        _validate_bounded_json(value)
        discriminator = value.get("content_type", value.get("kind"))
        if discriminator is not None and discriminator != self.kind.value:
            raise ContentDocumentError(
                "content_kind_mismatch",
                "directory kind and document content_type must agree",
            )
        if descriptor_backed and discriminator is None:
            raise ContentDocumentError("content_type_required", "descriptor-backed content requires content_type")
        unexpected = sorted(set(value) - _COMMON_FIELDS - _KIND_FIELDS[self.kind])
        if unexpected and not (self.kind is ContentKind.POSE_CLIP and value.get("schema") == "animaPoseClip/1.0"):
            raise ContentDocumentError(
                "unexpected_document_fields",
                f"Unexpected {self.kind.value} fields: {', '.join(unexpected)}",
            )
        files = _files(value)
        dependencies = _dependencies(value, self.kind)
        fallback_name = display_name_from_path(fallback_path)[:120]
        base = _base_values(
            value,
            kind=self.kind,
            fallback_name=fallback_name,
            files=files,
            dependencies=dependencies,
        )
        document = self._typed_document(value, base)
        projection = self.catalog_projection(document)
        return ParsedContentDocument(
            document=document,
            metadata=projection,
            display_name=document.name,
            logical_key=document.content_id,
            dependencies=document.dependencies,
        )

    def _typed_document(
        self,
        raw: Mapping[str, Any],
        base: dict[str, Any],
    ) -> TypedContentDocument:
        kind = self.kind
        if kind is ContentKind.GESTURE:
            semantic = raw.get("semantic_key") or str(base["content_id"] or base["name"]).rsplit(":", 1)[-1]
            semantic = _string(semantic, field_name="semantic_key", maximum=128).lower().replace(" ", "-")
            if not SEMANTIC_KEY_PATTERN.fullmatch(semantic):
                raise ContentDocumentError("invalid_semantic_key", "semantic_key uses unsupported characters")
            return GestureDocumentV1(
                **base,
                semantic_key=semantic,
                implementation=_action_implementation(raw, default_kind="vrma"),
                config=_object(raw.get("config"), field_name="config"),
            )
        if kind is ContentKind.REACTION:
            emotion = None
            intensity = None
            if "placement_hint" in raw:
                placement = _object(raw["placement_hint"], field_name="placement_hint")
                emotion = _string(placement.get("emotion"), field_name="placement_hint.emotion").lower()
                intensity = placement.get("intensity")
                if emotion not in TRACKED_EMOTION_SET or type(intensity) is not int or intensity not in {1, 2, 3}:
                    raise ContentDocumentError(
                        "invalid_reaction_cell",
                        "Reaction placement requires a tracked emotion and intensity 1, 2, or 3",
                    )
            return ReactionDocumentV1(
                **base,
                emotion=emotion,
                intensity=intensity,
                implementation=_action_implementation(raw, default_kind="anima_clip"),
                config=_object(raw.get("config"), field_name="config"),
            )
        if kind is ContentKind.POSE:
            if base["files"]:
                raise ContentDocumentError("pose_files_not_allowed", "A Pose has no external resource files")
            return PoseDocumentV1(
                **base,
                pose=validate_resolved_pose(raw.get("pose"), content_id=base["content_id"], name=base["name"]),
            )
        if kind is ContentKind.POSE_CLIP:
            schema = raw.get("schema")
            if raw and schema != "animaPoseClip/1.0":
                raise ContentDocumentError("pose_clip_schema_invalid", "Pose Clip schema must be animaPoseClip/1.0")
            keyframes = raw.get("poseKeyframes", [])
            poses = raw.get("poses", {})
            if not isinstance(keyframes, list) or not all(isinstance(item, dict) for item in keyframes):
                raise ContentDocumentError("pose_clip_keyframes_invalid", "poseKeyframes must be an object array")
            if not isinstance(poses, dict):
                raise ContentDocumentError("pose_clip_poses_invalid", "poses must be an object")
            return PoseClipDocumentV1(
                **base,
                clip_id=_string(raw.get("id"), field_name="id", fallback=str(base["name"])),
                role=_optional_string(raw.get("role"), field_name="role", maximum=64),
                playback=_object(raw.get("playback"), field_name="playback"),
                poses=dict(poses),
                pose_keyframes=tuple(dict(item) for item in keyframes),
                clip=dict(raw),
            )
        if kind is ContentKind.PARTICLE_EFFECT:
            return ParticleEffectDocumentV1(
                **base,
                runtime_defaults=_object(raw.get("runtime_defaults"), field_name="runtime_defaults"),
                definition=_object(raw.get("definition"), field_name="definition") or None,
            )
        if kind is ContentKind.AVATAR_EFFECT:
            return AvatarEffectDocumentV1(
                **base,
                technical_source=_technical_source(raw),
                runtime_defaults=_object(raw.get("runtime_defaults"), field_name="runtime_defaults"),
                definition=_object(raw.get("definition"), field_name="definition") or None,
            )
        if kind is ContentKind.SCENE_EFFECT:
            return SceneEffectDocumentV1(
                **base,
                technical_source=_technical_source(raw),
                runtime_defaults=_object(raw.get("runtime_defaults"), field_name="runtime_defaults"),
                definition=_object(raw.get("definition"), field_name="definition") or None,
            )
        if kind is ContentKind.SOUND_EFFECT:
            duration = raw.get("duration_seconds")
            return SoundEffectDocumentV1(
                **base,
                duration_seconds=(
                    _number(
                        duration,
                        field_name="duration_seconds",
                        default=0,
                        minimum=0,
                        maximum=86_400,
                    )
                    if duration is not None
                    else None
                ),
                codec=_optional_string(raw.get("codec"), field_name="codec", maximum=128),
                defaults=_object(raw.get("defaults"), field_name="defaults"),
            )
        if kind is ContentKind.IDLE_STYLE:
            if base["schema_version"] == 2:
                return _idle_style_v2(raw, base)
            animations = _idle_animations(raw)
            declared_files = {file.path: file.role for file in base["files"]}
            for animation in animations:
                if animation.file_ref and declared_files.get(animation.file_ref) != "animation":
                    raise ContentDocumentError(
                        "idle_animation_file_missing",
                        "Idle animation file_ref must name a declared animation file",
                    )
            animation_ids = {animation.animation_id for animation in animations}
            default_pool = _string_list(raw.get("default_pool", []), field_name="default_pool")
            pools = _emotion_pools(raw.get("emotion_pools", {}))
            used = set(default_pool)
            for pool in pools.values():
                used.update(pool)
            if not used.issubset(animation_ids):
                raise ContentDocumentError(
                    "idle_pool_animation_missing",
                    "Idle pools may reference only declared animations",
                )
            return IdleStyleDocumentV1(
                **base,
                animations=animations,
                default_pool=default_pool,
                emotion_pools=pools,
                cross_fade_seconds=_number(
                    raw.get("cross_fade_seconds"),
                    field_name="cross_fade_seconds",
                    default=0.35,
                    minimum=0,
                    maximum=10,
                ),
                compatibility=_object(raw.get("compatibility"), field_name="compatibility"),
            )
        if kind is ContentKind.MUSIC_TRACK:
            defaults = _object(raw.get("defaults"), field_name="defaults")
            gain = _number(
                defaults.get("gain"),
                field_name="defaults.gain",
                default=1,
                minimum=0,
                maximum=2,
            )
            loop = defaults.get("loop", True)
            autoplay = defaults.get("autoplay", False)
            if not isinstance(loop, bool) or not isinstance(autoplay, bool):
                raise ContentDocumentError("invalid_music_defaults", "Music loop/autoplay defaults must be booleans")
            return MusicTrackDocumentV1(
                **base,
                duration_seconds=_number(
                    raw.get("duration_seconds"),
                    field_name="duration_seconds",
                    default=0,
                    minimum=0,
                    maximum=86_400,
                ),
                codec=_string(raw.get("codec"), field_name="codec", fallback="unknown", maximum=128),
                loop=loop,
                gain=gain,
                autoplay=autoplay,
            )
        if kind is ContentKind.AVATAR:
            return AvatarDocumentV1(
                **base,
                model_role="model",
                compatibility=_object(raw.get("compatibility"), field_name="compatibility"),
            )
        if kind is ContentKind.APPEARANCE:
            return AppearanceDocumentV1(
                **base,
                width=_optional_positive_int(raw.get("width"), field_name="width"),
                height=_optional_positive_int(raw.get("height"), field_name="height"),
                avatar_model=_optional_string(raw.get("avatar_model"), field_name="avatar_model", maximum=256),
                presentation=_object(raw.get("presentation", raw.get("config")), field_name="presentation"),
            )
        if kind is ContentKind.VOICE:
            return VoiceDocumentV1(
                **base,
                codec=_optional_string(raw.get("codec"), field_name="codec", maximum=128),
                language=_optional_string(raw.get("language"), field_name="language", maximum=64),
                sample_rate_hz=_optional_positive_int(raw.get("sample_rate_hz"), field_name="sample_rate_hz"),
                voices=_string_list(raw.get("voices", []), field_name="voices"),
            )
        raise ContentDocumentError("content_kind_unsupported", f"{kind.value} is not admit-able")

    def catalog_projection(self, document: TypedContentDocument) -> dict[str, Any]:
        """Return bounded searchable/product metadata, never persistence authority."""

        result: dict[str, Any] = {
            "schema_version": document.schema_version,
            "content_type": document.kind.value,
            "version": document.version,
            "name": document.name,
        }
        if document.content_id:
            result["content_id"] = document.content_id
        if document.description:
            result["description"] = document.description
        if document.files:
            result["files"] = [{"path": item.path, "role": item.role} for item in document.files]
        if document.dependencies:
            result["dependencies"] = [
                {
                    "ref": item.ref,
                    "content_type": item.kind.value,
                    **({"alias": item.alias} if item.alias else {}),
                    **({"config": item.config} if item.config else {}),
                }
                for item in document.dependencies
            ]
        if document.provenance:
            result["provenance"] = document.provenance
        if isinstance(document, GestureDocumentV1):
            result.update(
                {
                    "semantic_key": document.semantic_key,
                    "implementation": _implementation_projection(document.implementation),
                    "config": document.config,
                }
            )
        elif isinstance(document, ReactionDocumentV1):
            result.update(
                {
                    "implementation": _implementation_projection(document.implementation),
                    "config": document.config,
                }
            )
            if document.emotion is not None and document.intensity is not None:
                result["placement_hint"] = {"emotion": document.emotion, "intensity": document.intensity}
        elif isinstance(document, PoseDocumentV1):
            result["pose"] = document.pose
        elif isinstance(document, PoseClipDocumentV1):
            return dict(document.clip)
        elif isinstance(document, ParticleEffectDocumentV1):
            result.update({"runtime_defaults": document.runtime_defaults, "definition": document.definition})
        elif isinstance(document, AvatarEffectDocumentV1 | SceneEffectDocumentV1):
            result.update(
                {
                    "technical_source": document.technical_source,
                    "runtime_defaults": document.runtime_defaults,
                    "definition": document.definition,
                }
            )
        elif isinstance(document, SoundEffectDocumentV1):
            result.update(
                {
                    "duration_seconds": document.duration_seconds,
                    "codec": document.codec,
                    "defaults": document.defaults,
                }
            )
        elif isinstance(document, IdleStyleDocumentV2):
            result.update(
                {
                    "default_pool": list(document.default_pool),
                    "cells": idle_cells_projection(document.cells),
                    "compatibility": document.compatibility,
                }
            )
        elif isinstance(document, IdleStyleDocumentV1):
            result.update(
                {
                    "animations": [
                        {
                            "animation_id": item.animation_id,
                            "name": item.name,
                            "description": item.description,
                            "file_ref": item.file_ref,
                            "dependency_ref": item.dependency_ref,
                            "playback": item.playback,
                        }
                        for item in document.animations
                    ],
                    "default_pool": list(document.default_pool),
                    "emotion_pools": {key: list(value) for key, value in document.emotion_pools.items()},
                    "cross_fade_seconds": document.cross_fade_seconds,
                    "compatibility": document.compatibility,
                }
            )
        elif isinstance(document, MusicTrackDocumentV1):
            result.update(
                {
                    "duration_seconds": document.duration_seconds,
                    "codec": document.codec,
                    "defaults": {
                        "loop": document.loop,
                        "gain": document.gain,
                        "autoplay": document.autoplay,
                    },
                }
            )
        elif isinstance(document, AvatarDocumentV1):
            result.update({"model_role": document.model_role, "compatibility": document.compatibility})
        elif isinstance(document, AppearanceDocumentV1):
            result.update(
                {
                    "width": document.width,
                    "height": document.height,
                    "avatar_model": document.avatar_model,
                    "presentation": document.presentation,
                }
            )
        elif isinstance(document, VoiceDocumentV1):
            result.update(
                {
                    "codec": document.codec,
                    "language": document.language,
                    "sample_rate_hz": document.sample_rate_hz,
                    "voices": list(document.voices),
                }
            )
        return {key: value for key, value in result.items() if value is not None}

    def admission_projection(self, document: TypedContentDocument) -> dict[str, Any]:
        """Return deterministic typed meaning included in the item revision fence.

        The catalog projection is already the normalized, migrated V1 document
        shape consumed by typed services. Keeping this method explicit makes
        revision ownership part of the handler contract rather than a scanner
        implementation detail.
        """

        return self.catalog_projection(document)

    def role_for_file(
        self,
        *,
        relative_path: str,
        descriptor_relative_path: str | None,
        document: TypedContentDocument,
        entry_relative_path: str,
    ) -> str:
        """Assign exactly one canonical semantic role to a registered file."""

        if relative_path == descriptor_relative_path:
            return "descriptor"
        if relative_path.endswith(".meta.json"):
            return "metadata"
        declared = {item.path: item.role for item in document.files}
        relative = PurePosixPath(relative_path)
        entry = PurePosixPath(entry_relative_path)
        try:
            local_path = relative.relative_to(entry).as_posix() if not entry.suffix else relative.name
        except ValueError:
            local_path = relative.name
        explicit = declared.get(local_path) or declared.get(relative.name)
        if explicit:
            return explicit
        suffix = relative.suffix.lower()
        if self.kind is ContentKind.AVATAR:
            return "model"
        if self.kind is ContentKind.GESTURE:
            return "animation" if suffix == ".vrma" else "sequence"
        if self.kind in {ContentKind.POSE_CLIP, ContentKind.REACTION, ContentKind.IDLE_STYLE}:
            return "animation" if suffix == ".vrma" else "sequence"
        if self.kind is ContentKind.PARTICLE_EFFECT:
            return "manifest" if suffix == ".json" else "texture"
        if self.kind in {ContentKind.AVATAR_EFFECT, ContentKind.SCENE_EFFECT}:
            return "manifest" if suffix == ".json" else "image"
        if self.kind is ContentKind.APPEARANCE:
            return "image"
        if self.kind in {ContentKind.SOUND_EFFECT, ContentKind.MUSIC_TRACK, ContentKind.VOICE}:
            return "audio"
        return "dependency"

    def validate_resolved_dependencies(
        self,
        dependencies: Iterable[tuple[ContentDependencyV1, ContentKind | None]],
    ) -> tuple[ContentDiagnostic, ...]:
        """Require each resolved target kind to match the typed declaration."""

        diagnostics: list[ContentDiagnostic] = []
        for declared, resolved_kind in dependencies:
            if resolved_kind is not None and resolved_kind is not declared.kind:
                diagnostics.append(
                    ContentDiagnostic(
                        "dependency_kind_mismatch",
                        (
                            f"Dependency {declared.ref} declares {declared.kind.value} "
                            f"but resolves to {resolved_kind.value}"
                        ),
                        declared.ref,
                    )
                )
        return tuple(diagnostics)

    def rewrite_package_document(
        self,
        payload: bytes,
        *,
        reference_rewrites: Mapping[str, str],
        descriptor_backed: bool,
    ) -> bytes:
        """Canonicalize a descriptor or standalone sidecar for a package."""

        try:
            value = json.loads(payload)
        except (UnicodeError, json.JSONDecodeError) as exc:
            raise ContentDocumentError("package_descriptor_invalid", "Package descriptor is invalid") from exc
        if not isinstance(value, dict):
            raise ContentDocumentError("package_descriptor_invalid", "Package descriptor must be an object")

        def rewrite(current: Any) -> Any:
            if isinstance(current, list):
                return [rewrite(item) for item in current]
            if not isinstance(current, dict):
                if isinstance(current, str):
                    return reference_rewrites.get(current, current)
                return current
            result: dict[str, Any] = {}
            for key, child in current.items():
                if key in _LOCAL_REFERENCE_FIELDS:
                    continue
                if key in {"ref", "content_id", "id"} and isinstance(child, str):
                    result[key] = reference_rewrites.get(child, child)
                else:
                    result[key] = rewrite(child)
            source = result.get("source")
            if isinstance(source, dict) and source.get("type") == "catalog":
                logical = source.get("logical_key") or source.get("content_id")
                if isinstance(logical, str):
                    result["ref"] = reference_rewrites.get(logical, logical)
                result.pop("source", None)
            return result

        rewritten = rewrite(value)
        self.parse_document(
            rewritten,
            fallback_path=Path("package"),
            descriptor_backed=descriptor_backed,
        )
        return (json.dumps(rewritten, indent=2, sort_keys=True, ensure_ascii=False) + "\n").encode()

    def project_runtime(
        self,
        document: TypedContentDocument,
        projection: RuntimeProjectionInput,
    ) -> RuntimeProjection:
        """Project one typed document without a generic kind switch in runtime code."""

        name = document.name
        description = document.description
        if isinstance(document, GestureDocumentV1 | ReactionDocumentV1):
            dependency_files = projection.dependency_files.get(
                document.implementation.content_dependency_ref or "",
                [],
            )
            files = dependency_files or projection.files
            payload: dict[str, Any] = {
                "runtime_root_id": projection.runtime_root_id,
                "binding_id": str(projection.context.get("binding_id") or projection.runtime_root_id),
                "content_type": document.kind.value,
                "source": projection.source,
                "name": name,
                "description": description,
                "implementation": {
                    "kind": document.implementation.kind,
                    "file_role": document.implementation.file_role or (files[0]["role"] if files else None),
                },
                "config": {
                    **getattr(document, "config", {}),
                    **_mapping(projection.context.get("config")),
                },
                "reference_map": projection.reference_map,
                "files": files,
            }
            if isinstance(document, GestureDocumentV1):
                payload["semantic_key"] = document.semantic_key
                return RuntimeProjection("gesture", payload)
            # A Reaction document's placement hint is its authoring default.
            # The equipped loadout slot owns when that exact Action is invoked.
            placement = projection.slot_key.removeprefix("reaction:")
            emotion, separator, raw_intensity = placement.rpartition("-")
            try:
                intensity = int(raw_intensity) if separator else document.intensity
            except ValueError:
                intensity = document.intensity
            payload["emotion"] = emotion if emotion in TRACKED_EMOTION_SET else document.emotion
            payload["intensity"] = intensity if intensity in {1, 2, 3} else document.intensity
            return RuntimeProjection("reaction", payload)
        if isinstance(document, IdleStyleDocumentV2):
            return RuntimeProjection(
                "idle_style",
                {
                    "schema_version": 2,
                    "runtime_root_id": projection.runtime_root_id,
                    "name": document.name,
                    "description": document.description,
                    "source": projection.source,
                    "revision": projection.revision,
                    "default_pool": list(document.default_pool),
                    "cells": idle_cells_projection(document.cells),
                    "gestures": [],
                },
            )
        if isinstance(document, IdleStyleDocumentV1):
            animations: list[dict[str, Any]] = []
            for index, animation in enumerate(document.animations):
                if animation.dependency_ref:
                    files = projection.dependency_files.get(animation.dependency_ref, [])
                elif animation.file_ref:
                    direct = projection.logical_files.get(animation.file_ref)
                    files = [direct] if direct is not None else []
                else:
                    # Retain the legacy ordinal lane for old Local documents.
                    files = projection.files[index : index + 1]
                animations.append(
                    {
                        "animation_id": animation.animation_id,
                        "name": animation.name,
                        "description": animation.description,
                        "playback": animation.playback,
                        "files": files,
                    }
                )
            pools = {key: list(value) for key, value in document.emotion_pools.items()}
            default_pool = list(document.default_pool)
            for key, value in _mapping(projection.context.get("pool_overrides")).items():
                if isinstance(value, list) and all(isinstance(item, str) for item in value):
                    if key == "default":
                        default_pool = list(value)
                    else:
                        pools[key] = list(value)
            return RuntimeProjection(
                "idle_style",
                {
                    "runtime_root_id": projection.runtime_root_id,
                    "name": name,
                    "description": description,
                    "source": projection.source,
                    "revision": projection.revision,
                    "animations": animations,
                    "default_pool": default_pool,
                    "emotion_pools": pools,
                    "cross_fade_seconds": document.cross_fade_seconds,
                },
            )
        if isinstance(document, AvatarDocumentV1):
            return RuntimeProjection(
                "avatar",
                {
                    "runtime_root_id": projection.runtime_root_id,
                    "source": projection.source,
                    "avatar_id": str(projection.context.get("avatar_id") or projection.item_id),
                    "revision": projection.revision,
                    "files": projection.files,
                },
            )
        if isinstance(document, AppearanceDocumentV1):
            return RuntimeProjection(
                "appearance",
                {
                    "runtime_root_id": projection.runtime_root_id,
                    "binding_id": str(projection.context.get("binding_id") or projection.runtime_root_id),
                    "use": str(projection.context.get("use") or projection.slot_key.split(":", 1)[-1]),
                    "source": projection.source,
                    "revision": projection.revision,
                    "width": document.width or 0,
                    "height": document.height or 0,
                    "presentation": {
                        "fit": projection.context.get("fit", "cover"),
                        "focal_x": projection.context.get("focal_x", 0.5),
                        "focal_y": projection.context.get("focal_y", 0.5),
                        "zoom": projection.context.get("zoom", 1),
                    },
                    "files": projection.files,
                },
            )
        if isinstance(
            document,
            ParticleEffectDocumentV1 | AvatarEffectDocumentV1 | SceneEffectDocumentV1 | SoundEffectDocumentV1,
        ):
            slot = {
                ContentKind.PARTICLE_EFFECT: "particle_vfx",
                ContentKind.AVATAR_EFFECT: "avatar_vfx",
                ContentKind.SCENE_EFFECT: "scene_vfx",
                ContentKind.SOUND_EFFECT: "sfx",
            }[document.kind]
            runtime_defaults = getattr(document, "runtime_defaults", {})
            defaults = _mapping(_mapping(runtime_defaults).get("slots")).get(slot, {})
            config = {**_mapping(defaults), **_mapping(projection.context.get("config"))}
            return RuntimeProjection(
                "support",
                {
                    "runtime_id": projection.slot_key.split(":", 1)[-1],
                    "runtime_root_ids": [projection.runtime_root_id],
                    "content_type": document.kind.value,
                    "source": projection.source,
                    "name": name,
                    "config": config,
                    "definition": getattr(document, "definition", None),
                    "reference_map": projection.reference_map,
                    "logical_resource_files": {},
                    "logical_resource_urls": {},
                    "provenance": [],
                    "files": projection.files,
                },
            )
        return RuntimeProjection("none", None)


class ContentTypeHandlerRegistry:
    """Exhaustive immutable registry indexed by content kind and directory."""

    def __init__(self, handlers: Iterable[ContentTypeHandler]) -> None:
        values = tuple(handlers)
        by_kind = {handler.kind: handler for handler in values}
        if len(by_kind) != len(values) or set(by_kind) != set(ContentKind):
            raise RuntimeError("content type handler registry must contain every ContentKind exactly once")
        directories = [handler.definition.directory for handler in values]
        if len(set(directories)) != len(directories):
            raise RuntimeError("content type handler directories must be unique")
        self._handlers = values
        self._by_kind = by_kind

    def __iter__(self) -> Iterator[ContentKindDefinition]:
        """Keep scanner iteration source-compatible while exposing definitions only."""

        return iter(handler.definition for handler in self._handlers)

    def handler_for(self, kind: ContentKind) -> ContentTypeHandler:
        return self._by_kind[kind]

    def definition_for(self, kind: ContentKind) -> ContentKindDefinition:
        return self.handler_for(kind).definition

    @property
    def handlers(self) -> tuple[ContentTypeHandler, ...]:
        return self._handlers


def _technical_source(raw: Mapping[str, Any]) -> dict[str, Any] | None:
    source = raw.get("technical_source")
    if source is None:
        return None
    if not isinstance(source, dict):
        raise ContentDocumentError("invalid_technical_source", "technical_source must be an object")
    source_type = source.get("type")
    if source_type == "public_url":
        raise ContentDocumentError(
            "public_url_not_portable",
            "runtime media must use a registered file or content dependency",
        )
    if source_type == "runtime_catalog":
        raise ContentDocumentError(
            "runtime_catalog_not_portable",
            "runtime media must use registered files or a content dependency",
        )
    if source_type != "content_dependency":
        raise ContentDocumentError("invalid_technical_source", "technical_source.type is unsupported")
    return dict(source)


def _string_list(value: Any, *, field_name: str) -> tuple[str, ...]:
    if not isinstance(value, list) or not all(isinstance(item, str) and item for item in value):
        raise ContentDocumentError("invalid_document_field", f"{field_name} must be a string array")
    if len(set(value)) != len(value):
        raise ContentDocumentError("invalid_document_field", f"{field_name} cannot contain duplicates")
    return tuple(value)


def _emotion_pools(value: Any) -> dict[str, tuple[str, ...]]:
    if not isinstance(value, dict):
        raise ContentDocumentError("invalid_idle_emotion_pools", "emotion_pools must be an object")
    result: dict[str, tuple[str, ...]] = {}
    for emotion, pool in value.items():
        if emotion not in TRACKED_EMOTION_SET:
            raise ContentDocumentError("invalid_idle_emotion", "Idle pools require canonical tracked emotions")
        result[emotion] = _string_list(pool, field_name=f"emotion_pools.{emotion}")
    return result


def _idle_animations(raw: Mapping[str, Any]) -> tuple[IdleAnimationDocumentV1, ...]:
    value = raw.get("animations", [])
    if not isinstance(value, list) or not value:
        raise ContentDocumentError("idle_animations_required", "Idle Style requires at least one animation")
    result: list[IdleAnimationDocumentV1] = []
    seen: set[str] = set()
    for item in value:
        if not isinstance(item, dict):
            raise ContentDocumentError("invalid_idle_animation", "Idle animations must be objects")
        unexpected = set(item) - {
            "animation_id",
            "name",
            "description",
            "file_ref",
            "dependency_ref",
            "ordinal",
            "playback",
            "technical_source",
        }
        if unexpected:
            raise ContentDocumentError(
                "unexpected_idle_animation_fields",
                f"Unexpected idle animation fields: {', '.join(sorted(unexpected))}",
            )
        animation_id = _string(item.get("animation_id"), field_name="animations.animation_id", maximum=128)
        if animation_id in seen:
            raise ContentDocumentError("duplicate_idle_animation", "Idle animation IDs must be unique")
        seen.add(animation_id)
        dependency_ref = item.get("dependency_ref")
        technical = item.get("technical_source")
        if technical is not None:
            if not isinstance(technical, dict):
                raise ContentDocumentError("invalid_technical_source", "Idle technical_source must be an object")
            if technical.get("type") == "public_url":
                raise ContentDocumentError(
                    "public_url_not_portable",
                    "Idle animations must use a registered dependency",
                )
            if technical.get("type") == "content_dependency":
                dependency_ref = technical.get("ref")
        if dependency_ref is not None and (
            not isinstance(dependency_ref, str) or not _valid_dependency_reference(dependency_ref)
        ):
            raise ContentDocumentError("invalid_dependency_reference", "Idle dependency_ref is invalid")
        file_ref = item.get("file_ref")
        if file_ref is not None and (not isinstance(file_ref, str) or not _valid_dependency_reference(file_ref)):
            raise ContentDocumentError("invalid_file_declaration", "Idle file_ref is invalid")
        if dependency_ref is None and file_ref is None and not isinstance(item.get("ordinal"), int):
            raise ContentDocumentError(
                "idle_animation_source_required",
                "Idle animation requires dependency_ref, file_ref, or ordinal",
            )
        result.append(
            IdleAnimationDocumentV1(
                animation_id=animation_id,
                name=_string(item.get("name"), field_name="animations.name", maximum=120),
                description=_optional_string(item.get("description"), field_name="animations.description"),
                file_ref=file_ref,
                dependency_ref=dependency_ref,
                playback=_object(item.get("playback"), field_name="animations.playback"),
            )
        )
    return tuple(result)


def _optional_positive_int(value: object, *, field_name: str) -> int | None:
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
        raise ContentDocumentError("invalid_document_field", f"{field_name} must be a positive integer")
    return value


def _implementation_projection(value: ActionImplementationV1) -> dict[str, Any]:
    result: dict[str, Any] = {"kind": value.kind}
    if value.file_role:
        result["file_role"] = value.file_role
    if value.content_dependency_ref:
        result["technical_source"] = {
            "type": "content_dependency",
            "ref": value.content_dependency_ref,
        }
    return result


def _mapping(value: Any) -> dict[str, Any]:
    return dict(value) if isinstance(value, dict) else {}


def _valid_dependency_reference(value: str) -> bool:
    if not value or len(value) > 512 or "\\" in value or "\x00" in value:
        return False
    relative = PurePosixPath(value)
    return not relative.is_absolute() and all(part not in {"", ".", ".."} for part in relative.parts)


# Persisted rows and receipts retain their original kind. Public admission must
# exclude these kinds while conversion can still use their exact old handlers.
RETIRED_CONTENT_KINDS = frozenset({ContentKind.POSE_CLIP, ContentKind.MUSIC_TRACK})


CONTENT_TYPE_HANDLERS = ContentTypeHandlerRegistry(
    (
        ContentTypeHandler(
            ContentKindDefinition(
                ContentKind.AVATAR,
                "avatars",
                frozenset({".vrm"}),
                None,
                "vrm_avatar",
                max_file_bytes=MAX_VRM_SOURCE_BYTES,
            )
        ),
        ContentTypeHandler(
            ContentKindDefinition(
                ContentKind.GESTURE,
                "gestures",
                frozenset({".vrma"}),
                ".meta.json",
                "gesture",
            )
        ),
        ContentTypeHandler(
            ContentKindDefinition(
                ContentKind.POSE,
                "poses",
                frozenset(),
                ".json",
                "pose",
                max_file_bytes=1024 * 1024,
                max_entry_files=1,
                max_entry_bytes=1024 * 1024,
            )
        ),
        ContentTypeHandler(
            ContentKindDefinition(ContentKind.POSE_CLIP, "pose-clips", frozenset({".json"}), None, "pose_clip")
        ),
        ContentTypeHandler(
            ContentKindDefinition(ContentKind.REACTION, "reactions", frozenset(), ".meta.json", "reaction")
        ),
        ContentTypeHandler(
            ContentKindDefinition(
                ContentKind.PARTICLE_EFFECT,
                "vfx/particle",
                frozenset({".json"}),
                ".json",
                "particle_effect",
            )
        ),
        ContentTypeHandler(
            ContentKindDefinition(
                ContentKind.AVATAR_EFFECT,
                "vfx/avatar",
                # Images are effect resources; only authored descriptors define playback.
                frozenset(),
                ".json",
                "avatar_effect",
            )
        ),
        ContentTypeHandler(
            ContentKindDefinition(
                ContentKind.SCENE_EFFECT,
                "vfx/scene",
                frozenset({".svg", ".json", ".png", ".jpg", ".jpeg", ".webp"}),
                ".json",
                "scene_effect",
            )
        ),
        ContentTypeHandler(
            ContentKindDefinition(
                ContentKind.SOUND_EFFECT,
                "sfx",
                frozenset({".mp3", ".ogg", ".wav", ".flac"}),
                ".json",
                "sound_effect",
            )
        ),
        ContentTypeHandler(
            ContentKindDefinition(
                ContentKind.IDLE_STYLE,
                "idle-styles",
                frozenset({".json"}),
                ".json",
                "idle_style",
            )
        ),
        ContentTypeHandler(
            ContentKindDefinition(
                ContentKind.MUSIC_TRACK,
                "music",
                frozenset({".mp3", ".ogg", ".wav", ".flac"}),
                ".json",
                "music_track",
            )
        ),
        ContentTypeHandler(
            ContentKindDefinition(
                ContentKind.APPEARANCE,
                "appearances",
                frozenset({".png", ".jpg", ".jpeg", ".webp"}),
                ".json",
                "appearance",
                max_file_bytes=MAX_APPEARANCE_SOURCE_BYTES,
            )
        ),
        ContentTypeHandler(
            ContentKindDefinition(
                ContentKind.VOICE,
                "voices",
                frozenset({".mp3", ".ogg", ".wav", ".flac", ".bin"}),
                ".json",
                "voice",
            )
        ),
        ContentTypeHandler(
            ContentKindDefinition(ContentKind.ANIMA, "animas", frozenset({".json"}), ".json", "none"),
            reserved=True,
        ),
    )
)

# Transitional import name retained for scanner/config callers. It is a closed
# registry object, not the former passive tuple of definitions.
CONTENT_KIND_REGISTRY = CONTENT_TYPE_HANDLERS


def definition_for_kind(kind: ContentKind) -> ContentKindDefinition:
    return CONTENT_TYPE_HANDLERS.definition_for(kind)


def handler_for_kind(kind: ContentKind) -> ContentTypeHandler:
    return CONTENT_TYPE_HANDLERS.handler_for(kind)


def validate_descriptor(
    path: Path,
    *,
    kind: ContentKind | None = None,
) -> tuple[dict[str, Any] | None, tuple[ContentDiagnostic, ...]]:
    """Parse a descriptor and, when known, apply its exact typed handler."""

    value, parse_error = parse_json_object(path)
    if parse_error or value is None:
        return None, (parse_error or ContentDiagnostic("malformed_json", "Descriptor is invalid"),)
    if kind is None:
        candidate = value.get("content_type", value.get("kind"))
        try:
            kind = ContentKind(str(candidate))
        except ValueError:
            return value, (ContentDiagnostic("content_type_required", "Descriptor content_type is invalid"),)
    try:
        parsed = handler_for_kind(kind).parse_document(
            value,
            fallback_path=path.parent,
            descriptor_backed=True,
        )
    except ContentDocumentError as exc:
        return value, (ContentDiagnostic(exc.code, str(exc)),)
    return parsed.metadata, ()


def validate_metadata_sidecar(
    path: Path,
    *,
    kind: ContentKind | None = None,
    primary_path: Path | None = None,
) -> tuple[dict[str, Any] | None, tuple[ContentDiagnostic, ...]]:
    """Parse a standalone sidecar through its kind handler when supplied."""

    value, parse_error = parse_json_object(path)
    if parse_error or value is None:
        return None, (parse_error or ContentDiagnostic("malformed_json", "Metadata is invalid"),)
    if kind is None:
        return value, ()
    try:
        parsed = handler_for_kind(kind).parse_document(
            value,
            fallback_path=primary_path or path,
            descriptor_backed=False,
        )
    except ContentDocumentError as exc:
        return value, (ContentDiagnostic(exc.code, str(exc)),)
    return parsed.metadata, ()


def descriptor_file_paths(value: Mapping[str, Any]) -> tuple[str, ...]:
    return tuple(item.path for item in _files(value))


def descriptor_file_roles(value: Mapping[str, Any]) -> dict[str, str]:
    return {item.path: item.role for item in _files(value)}


def descriptor_dependencies(value: Mapping[str, Any]) -> tuple[str, ...]:
    raw = value.get("dependencies", [])
    if not isinstance(raw, list):
        return ()
    result: list[str] = []
    for item in raw:
        reference = _dependency_reference(item)
        if reference is not None and _valid_dependency_reference(reference):
            result.append(reference)
    return tuple(result)


def logical_key_from_metadata(value: Mapping[str, Any]) -> str | None:
    try:
        return _content_id(value)
    except ContentDocumentError:
        return None


def display_name_from_metadata(value: Mapping[str, Any], fallback: Path) -> str:
    candidate = value.get("display_name", value.get("name"))
    if isinstance(candidate, str) and candidate.strip() and len(candidate.strip()) <= 120:
        return candidate.strip()
    return display_name_from_path(fallback)[:120]


def descriptor_filename(definition: ContentKindDefinition, entry_name: str) -> str:
    if definition.descriptor_suffix is None:
        raise ValueError(f"{definition.kind.value} does not use a folder descriptor")
    return f"{entry_name}{definition.descriptor_suffix}"


def is_descriptor_path(definition: ContentKindDefinition, path: Path, type_root: Path) -> bool:
    return (
        definition.descriptor_suffix is not None
        and path.parent != type_root
        and path.name == descriptor_filename(definition, path.parent.name)
    )


__all__ = [
    "CONTENT_KIND_REGISTRY",
    "RETIRED_CONTENT_KINDS",
    "CONTENT_TYPE_HANDLERS",
    "ContentKindDefinition",
    "ContentTypeHandler",
    "ContentTypeHandlerRegistry",
    "MAX_JSON_BYTES",
    "ParsedContentDocument",
    "RuntimeProjection",
    "RuntimeProjectionInput",
    "definition_for_kind",
    "descriptor_dependencies",
    "descriptor_file_paths",
    "descriptor_file_roles",
    "descriptor_filename",
    "display_name_from_metadata",
    "display_name_from_path",
    "handler_for_kind",
    "is_descriptor_path",
    "logical_key_from_metadata",
    "media_type_for",
    "parse_json_object",
    "validate_descriptor",
    "validate_metadata_sidecar",
    "validate_standalone_file",
]
