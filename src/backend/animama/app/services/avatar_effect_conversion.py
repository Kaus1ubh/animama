"""Convert ``animama/avatar-effect/1`` definitions to ``animama/avatar-effect/2``.

One converter serves the Local content transition
(:class:`AvatarEffectTransitionService`) and the repository script
``scripts/content/convert_avatar_effects.py`` for descriptor folders. The
mapping keeps every rendered property:

- ``hover``/``eye_hover`` becomes a ``face_landmark`` on ``eyes``;
  ``mouth_hover`` becomes ``mouth``; ``box_hover`` placements become
  ``forehead``, ``top`` or ``top_edge`` with a ``position``.
- ``face_anchored`` becomes ``face_surface`` on ``face_skin`` with the same area,
  layout, side, mirror and pivot.
- ``texture`` becomes ``face_surface`` on its target part; ``single_eye`` and
  ``double_eye`` become the ``eyes`` area with a ``single`` or ``span`` layout,
  and ``full_face`` becomes ``full``.
- Rotations change from radians to degrees. Animation, region, sound and the
  eye and mouth options are kept. Legacy ``lifetime`` and ``emotions`` are
  dropped, as are values the ``/1`` renderer ignored (for example ``z`` scale on a
  texture, or a side on a full-face texture).

A ``/2`` input is returned unchanged, so conversion is idempotent.
"""

from __future__ import annotations

import copy
import math
import re
from typing import Any

from pydantic import ValidationError

from animama.app.contracts.avatar_effect import (
    AVATAR_EFFECT_SCHEMA_V1,
    AVATAR_EFFECT_SCHEMA_V2,
    AvatarEffectDefinitionV2,
)
from animama.domain.content_documents import AvatarEffectDocumentV1, ContentDocumentError

CONVERSION_FAILED = "avatar_effect_conversion_failed"
CONVERSION_REQUIRED = "avatar_effect_conversion_required"
LOCAL_CONVERSION_COMMAND = "uv run python -m animama.server.content_cli"
# Named by refusals of a /1 definition at Save, preview and loadout.
CONVERSION_HINT = (
    "Avatar Effects use animama/avatar-effect/2; /1 is no longer accepted. Local effects convert automatically "
    f"at startup or on Rescan, or with `{LOCAL_CONVERSION_COMMAND}` (it takes no arguments). If a conversion "
    "failed, the effect's Content Health diagnostic names the field to repair. Included or other descriptor "
    "folders convert with `uv run python scripts/content/convert_avatar_effects.py --write <folder>`."
)
# Named when a content package still declares /1. A package cannot be converted
# in place: its manifest, digests and sizes cover the original bytes.
PACKAGE_CONVERSION_HINT = (
    "This package contains animama/avatar-effect/1 Avatar Effects, which can no longer be imported. In the "
    "Animama installation that exported it, let its Local effects convert to /2 (automatic at startup or on "
    f"Rescan, or `{LOCAL_CONVERSION_COMMAND}`), then export the package again."
)

_V1_FIELDS = frozenset(
    "schema kind region image transform animationConfig lifetime emotions soundAlias hoverKind placement side "
    "requiresMirror skinBackdrop anchor pivot layout targetRole assetShape applyMode disableTargetRoles forceBlink "
    "autoDisableEyeMaterials faceCleanup".split()
)
_BOX_PLACEMENTS = {
    "forehead-left": ("forehead", "left"),
    "forehead-middle": ("forehead", "middle"),
    "forehead-right": ("forehead", "right"),
    "top-left": ("top", "left"),
    "top-middle": ("top", "middle"),
    "top-right": ("top", "right"),
    "top-edge-left-corner": ("top_edge", "left_corner"),
    "top-edge-left": ("top_edge", "left"),
    "top-edge-middle": ("top_edge", "middle"),
    "top-edge-right": ("top_edge", "right"),
    "top-edge-right-corner": ("top_edge", "right_corner"),
}
_TEXTURE_SHAPES = {
    "single_eye": ("eyes", "single"),
    "double_eye": ("eyes", "span"),
    "full_face": ("full", None),
}
# Degrees are rounded for readable descriptors; 1e-6 degrees is far below a pixel.
_DEGREE_DIGITS = 6


def _fail(message: str, field: str | None = None) -> ContentDocumentError:
    return ContentDocumentError(CONVERSION_FAILED, message, field=field)


def _number(value: Any, field: str) -> float:
    if type(value) not in (int, float) or not math.isfinite(value):
        raise _fail(f"{field} must be a finite number", field)
    return float(value)


def _degrees(radians: Any, field: str) -> float:
    value = round(math.degrees(_number(radians, field)), _DEGREE_DIGITS)
    return 0.0 if value == 0 else value


def _axes(transform: dict[str, Any], key: str, default: float) -> dict[str, float]:
    raw = transform.get(key, {})
    if not isinstance(raw, dict):
        raise _fail(f"transform.{key} must be an object", f"definition.transform.{key}")
    return {
        axis: (_number(raw[axis], f"definition.transform.{key}.{axis}") if axis in raw else default)
        for axis in ("x", "y", "z")
    }


def _scale(value: float, field: str) -> float:
    # The /1 renderer used the absolute scale and clamped zero to an invisible size.
    if value == 0:
        raise _fail("scale must not be zero", field)
    return abs(value)


def _compact(values: dict[str, float], default: float) -> dict[str, float] | None:
    """Keep a vector only when it differs from its default, for readable descriptors."""
    return values if any(value != default for value in values.values()) else None


def _flag(definition: dict[str, Any], key: str) -> bool | None:
    value = definition.get(key)
    if value is None:
        return None
    if type(value) is not bool:
        raise _fail(f"{key} must be boolean", f"definition.{key}")
    return value


def _motion(definition: dict[str, Any]) -> dict[str, Any]:
    raw = definition.get("animationConfig")
    if raw is None:
        return {}
    if not isinstance(raw, dict):
        raise _fail("animationConfig must be an object", "definition.animationConfig")
    path = "definition.animationConfig"
    motion: dict[str, Any] = {}
    pulse = {
        target: _number(raw[source], f"{path}.{source}")
        for source, target in (
            ("pulseScaleMin", "scaleMin"),
            ("pulseScaleMax", "scaleMax"),
            ("pulseCyclesPerSecond", "cyclesPerSecond"),
        )
        if raw.get(source) is not None
    }
    if pulse:
        motion["pulse"] = pulse
    spin: dict[str, Any] = {}
    if raw.get("rotationRadiansPerSecond") is not None:
        spin["degreesPerSecond"] = _degrees(raw["rotationRadiansPerSecond"], f"{path}.rotationRadiansPerSecond")
    if raw.get("rotationAmountTurns") is not None:
        spin["amountTurns"] = _number(raw["rotationAmountTurns"], f"{path}.rotationAmountTurns")
    if raw.get("rotationDirection") is not None:
        spin["direction"] = raw["rotationDirection"]
    if spin:
        motion["spin"] = spin
    drift_raw = raw.get("driftPerSecond")
    if drift_raw is not None:
        if not isinstance(drift_raw, dict):
            raise _fail("driftPerSecond must be an object", f"{path}.driftPerSecond")
        present = {
            axis: _number(drift_raw[axis], f"{path}.driftPerSecond.{axis}")
            for axis in ("x", "y")
            if drift_raw.get(axis) is not None
        }
        if present:
            # /1 filled a missing axis with its preset default (x 0.03, y 0);
            # /2 treats a missing axis as still, so write both explicitly.
            motion["drift"] = {"x": present.get("x", 0.03), "y": present.get("y", 0)}
    unknown = set(raw) - {
        "pulseScaleMin",
        "pulseScaleMax",
        "pulseCyclesPerSecond",
        "rotationRadiansPerSecond",
        "rotationAmountTurns",
        "rotationDirection",
        "driftPerSecond",
    }
    if unknown:
        key = sorted(unknown)[0]
        raise _fail(f"Unsupported animationConfig field: {key}", f"{path}.{key}")
    return motion


def _face_options(definition: dict[str, Any], names: tuple[str, ...]) -> dict[str, Any] | None:
    """Keep only the eye and mouth options that the /1 renderer honoured here."""
    options: dict[str, Any] = {}
    renamed = {"autoDisableEyeMaterials": "hideEyeDetails", "disableTargetRoles": "hideParts"}
    for name in names:
        if name == "disableTargetRoles":
            roles = definition.get(name)
            if roles is not None:
                if not isinstance(roles, list):
                    raise _fail("disableTargetRoles must be an array", f"definition.{name}")
                options["hideParts"] = list(roles)
            continue
        value = _flag(definition, name)
        if value is not None:
            options[renamed.get(name, name)] = value
    return options or None


def _landmark(definition: dict[str, Any], transform: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any] | None]:
    hover = definition.get("hoverKind")
    offset = _axes(transform, "offset", 0)
    scale = _axes(transform, "scale", 1)
    rotation = _axes(transform, "rotation", 0)
    attachment: dict[str, Any] = {"kind": "face_landmark"}
    if hover == "eye_hover":
        attachment["landmark"] = "eyes"
        if definition.get("side") is not None:
            attachment["side"] = definition["side"]
        if _flag(definition, "requiresMirror"):
            attachment["mirror"] = True
        options = _face_options(
            definition,
            ("forceBlink", "autoDisableEyeMaterials", "faceCleanup", "skinBackdrop", "disableTargetRoles"),
        )
    elif hover == "mouth_hover":
        attachment["landmark"] = "mouth"
        options = _face_options(definition, ("faceCleanup", "skinBackdrop"))
    elif hover == "box_hover":
        placement = definition.get("placement")
        if placement not in _BOX_PLACEMENTS:
            raise _fail("Unsupported hover placement", "definition.placement")
        attachment["landmark"], attachment["position"] = _BOX_PLACEMENTS[placement]
        options = None
    else:
        raise _fail("Unsupported hover kind", "definition.hoverKind")
    if (value := _compact(offset, 0)) is not None:
        attachment["offset"] = value
    xy_scale = {
        "x": _scale(scale["x"], "definition.transform.scale.x"),
        "y": _scale(scale["y"], "definition.transform.scale.y"),
    }
    if (value := _compact(xy_scale, 1)) is not None:
        attachment["scale"] = value
    degrees = {axis: _degrees(rotation[axis], f"definition.transform.rotation.{axis}") for axis in ("x", "y", "z")}
    if (value := _compact(degrees, 0)) is not None:
        attachment["rotationDeg"] = value
    return attachment, options


def _surface(definition: dict[str, Any], transform: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any] | None]:
    kind = definition.get("kind")
    offset = _axes(transform, "offset", 0)
    scale = _axes(transform, "scale", 1)
    rotation = _axes(transform, "rotation", 0)
    attachment: dict[str, Any] = {"kind": "face_surface"}
    options: dict[str, Any] | None
    if kind == "face_anchored":
        anchor = definition.get("anchor")
        attachment.update({"part": "face_skin", "area": anchor})
        if anchor != "mouth":
            attachment["layout"] = definition.get("layout")
        layout = attachment.get("layout")
        options = _face_options(definition, ("faceCleanup",)) if anchor == "mouth" else None
    else:
        shape = definition.get("assetShape")
        if shape not in _TEXTURE_SHAPES:
            raise _fail("Unsupported texture shape", "definition.assetShape")
        area, layout = _TEXTURE_SHAPES[shape]
        attachment.update({"part": definition.get("targetRole"), "area": area})
        if layout is not None:
            attachment["layout"] = layout
        if definition.get("applyMode") == "replace":
            attachment["mode"] = "replace"
        elif definition.get("applyMode") != "overlay":
            raise _fail("Unsupported texture application", "definition.applyMode")
        options = _face_options(definition, ("disableTargetRoles",))
    if layout == "single":
        if definition.get("side") is not None:
            attachment["side"] = definition["side"]
        # The /1 renderer mirrored a single placement only when it had a side.
        if attachment.get("side") is not None and _flag(definition, "requiresMirror"):
            attachment["mirror"] = True
    if kind == "face_anchored" and definition.get("pivot") is not None:
        attachment["pivot"] = definition["pivot"]
    if (value := _compact({"x": offset["x"], "y": offset["y"]}, 0)) is not None:
        attachment["offset"] = value
    xy_scale = {
        "x": _scale(scale["x"], "definition.transform.scale.x"),
        "y": _scale(scale["y"], "definition.transform.scale.y"),
    }
    if (value := _compact(xy_scale, 1)) is not None:
        attachment["scale"] = value
    degrees = _degrees(rotation["z"], "definition.transform.rotation.z")
    if degrees != 0:
        attachment["rotationDeg"] = degrees
    return attachment, options


def convert_avatar_effect_definition(definition: Any) -> dict[str, Any]:
    """Return the ``/2`` form of one definition; a ``/2`` input is returned unchanged.

    Raises ``ContentDocumentError(code="avatar_effect_conversion_failed")`` with a
    JSON path for malformed input or values outside the ``/2`` bounds.
    """
    if not isinstance(definition, dict):
        raise _fail("Effect definition must be an object", "definition")
    schema = definition.get("schema")
    if schema == AVATAR_EFFECT_SCHEMA_V2:
        return copy.deepcopy(definition)
    if schema != AVATAR_EFFECT_SCHEMA_V1:
        raise _fail("Unsupported effect definition schema", "definition.schema")
    unknown = sorted(set(definition) - _V1_FIELDS)
    if unknown:
        raise _fail(f"Unsupported Avatar Effect field: {unknown[0]}", f"definition.{unknown[0]}")
    transform = definition.get("transform", {})
    if not isinstance(transform, dict):
        raise _fail("transform must be an object", "definition.transform")
    kind = definition.get("kind")
    if kind == "hover":
        attachment, options = _landmark(definition, transform)
    elif kind in {"face_anchored", "texture"}:
        attachment, options = _surface(definition, transform)
    else:
        raise _fail("Unsupported Avatar Effect kind", "definition.kind")
    converted: dict[str, Any] = {
        "schema": AVATAR_EFFECT_SCHEMA_V2,
        "region": definition.get("region"),
        "attachment": attachment,
        "art": {"image": definition.get("image")},
    }
    motion = _motion(definition)
    if motion:
        converted["motion"] = motion
    if options:
        converted["faceOptions"] = options
    if definition.get("soundAlias") is not None:
        converted["soundAlias"] = definition["soundAlias"]
    try:
        AvatarEffectDefinitionV2.model_validate(converted)
    except ValidationError as exc:
        path, message = avatar_effect_validation_error(exc)
        raise _fail(f"Converted definition is invalid: {message}", path) from exc
    return converted


OFFSET_MIRRORED = "avatar_effect_offset_mirrored"


def mirrors_offset_differently(definition: Any) -> bool:
    """Return whether a ``/1`` definition will look different because ``/2`` mirrors offsets.

    ``/1`` moved both eyes of a mirrored eye hover or iris texture by the same
    ``transform.offset.x``; ``/2`` mirrors it on the other eye. Face decals
    already mirrored their offsets, so they are unaffected.
    """
    if not isinstance(definition, dict) or definition.get("schema") != AVATAR_EFFECT_SCHEMA_V1:
        return False
    transform = definition.get("transform")
    offset = transform.get("offset") if isinstance(transform, dict) else None
    x = offset.get("x") if isinstance(offset, dict) else None
    if type(x) not in (int, float) or x == 0 or definition.get("requiresMirror") is not True:
        return False
    if definition.get("kind") == "hover":
        return definition.get("hoverKind") == "eye_hover"
    return (
        definition.get("kind") == "texture"
        and definition.get("assetShape") == "single_eye"
        and definition.get("side") is not None
    )


def is_unconverted_avatar_effect(document: object) -> bool:
    """Return whether a typed document is an Avatar Effect still holding a ``/1`` definition."""
    return (
        isinstance(document, AvatarEffectDocumentV1)
        and isinstance(document.definition, dict)
        and document.definition.get("schema") == AVATAR_EFFECT_SCHEMA_V1
    )


def require_converted_avatar_effect(document: object) -> None:
    """Refuse a ``/1`` Avatar Effect with the conversion hint; other documents pass."""
    if is_unconverted_avatar_effect(document):
        raise ContentDocumentError(CONVERSION_REQUIRED, CONVERSION_HINT, field="definition.schema")


_ATTACHMENT_TAGS = frozenset({"face_surface", "face_landmark", "body", "sticker", "silhouette"})
_RELATIVE_PATH = re.compile(r"^([A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)*): (.+)$", re.DOTALL)


def avatar_effect_error_path(location: tuple[Any, ...]) -> str:
    """Map a Pydantic error location to the JSON path under ``definition``.

    Discriminated-union tags (``attachment.face_surface``) are not JSON keys, so
    they are removed: ``("attachment", "face_surface", "offset", "x")`` becomes
    ``definition.attachment.offset.x``.
    """
    path = "definition"
    previous: Any = None
    for part in location:
        if previous == "attachment" and part in _ATTACHMENT_TAGS:
            previous = part
            continue
        path = f"{path}[{part}]" if isinstance(part, int) else f"{path}.{part}"
        previous = part
    return path


def avatar_effect_validation_error(exc: ValidationError) -> tuple[str, str]:
    """Return ``(json_path, message)`` for the first error of a ``/2`` validation.

    Cross-field validators prefix their message with a path relative to the
    model that raised it, which is appended to the error location.
    """
    error = exc.errors()[0]
    path = avatar_effect_error_path(tuple(error["loc"]))
    message = str(error["msg"]).removeprefix("Value error, ")
    if error["type"] == "value_error" and (match := _RELATIVE_PATH.match(message)):
        path = f"{path}.{match.group(1)}"
        message = match.group(2)
    return path, message


__all__ = [
    "PACKAGE_CONVERSION_HINT",
    "CONVERSION_FAILED",
    "CONVERSION_REQUIRED",
    "OFFSET_MIRRORED",
    "is_unconverted_avatar_effect",
    "mirrors_offset_differently",
    "require_converted_avatar_effect",
    "CONVERSION_HINT",
    "avatar_effect_error_path",
    "avatar_effect_validation_error",
    "convert_avatar_effect_definition",
]
