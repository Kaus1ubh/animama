"""Structural admission for the animaPoseClip/2.0 clips consumed by idle playback.

Keep this boundary aligned with frontend poses/animaPoseClip/schemaV2.ts and
clipVocabulary.ts (fades and events). Shared JSON fixtures exercise these checks and the
actual parsers; the 2.0 vocabulary below is compared with the shared
``fixtures/v2-vocabulary.json``. This validates playable shape, without
rewriting authored poses or event values.
"""

from __future__ import annotations

import math
import re
from decimal import ROUND_HALF_UP, Decimal
from typing import Any

from animama.app.services.content_pose import HUMAN_BONE_NAMES
from animama.domain.content_documents import ContentDocumentError

_EASINGS = {
    "linear",
    "easeInSine",
    "easeOutSine",
    "easeInOutSine",
    "easeInCubic",
    "easeOutCubic",
    "easeInOutCubic",
    "back",
    "elastic",
    "bounce",
}
_PARTICLE_ANCHORS = {"root", "hips", "spine", "chest", "neck", "head", "leftHand", "rightHand", "leftFoot", "rightFoot"}


def _require(condition: bool, field: str, requirement: str) -> None:
    if not condition:
        raise ContentDocumentError("idle_motion_invalid", f"Gesture clip {field} {requirement}")


def _record(value: Any, field: str) -> dict[str, Any]:
    _require(isinstance(value, dict), field, "must be an object")
    return dict(value)


def _array(value: Any, field: str) -> list[Any]:
    _require(isinstance(value, list), field, "must be an array")
    return list(value)


def _string(value: Any, field: str) -> str:
    _require(isinstance(value, str) and bool(value.strip()), field, "must be a nonempty string")
    return str(value).strip()


def _number(value: Any, field: str, *, minimum: float | None = None, maximum: float | None = None) -> float:
    _require(type(value) in (int, float), field, "must be a finite number")
    try:
        number = float(value)
    except OverflowError as exc:
        raise ContentDocumentError("idle_motion_invalid", f"Gesture clip {field} must be a finite number") from exc
    _require(math.isfinite(number), field, "must be a finite number")
    _require(minimum is None or number >= minimum, field, f"must be at least {minimum}")
    _require(maximum is None or number <= maximum, field, f"must be at most {maximum}")
    return number


def _enum(value: Any, field: str, allowed: set[str]) -> None:
    _require(isinstance(value, str) and value in allowed, field, "has an unsupported value")


def _optional_bool(value: dict[str, Any], key: str, field: str) -> None:
    if key in value:
        _require(isinstance(value[key], bool), f"{field}.{key}", "must be boolean")


def _transition(value: Any, field: str) -> None:
    transition = _record(value, field)
    if "easing" in transition:
        _enum(transition["easing"], f"{field}.easing", _EASINGS)
    if "interpolation" in transition:
        interpolation = _record(transition["interpolation"], f"{field}.interpolation")
        for key, allowed in (
            ("humanoidRotation", {"slerp", "nlerp", "step"}),
            ("humanoidPosition", {"linear", "step"}),
            ("expression", {"linear", "step"}),
        ):
            if key in interpolation:
                _enum(interpolation[key], f"{field}.interpolation.{key}", allowed)


def _vfx_fields(event: dict[str, Any], field: str) -> None:
    duration = None
    if "duration" in event:
        duration = _number(event["duration"], f"{field}.duration")
        _require(duration > 0, field, "VFX duration must be positive")
    _require(
        duration is not None or not ({"envelope", "parameterKeyframes"} & event.keys()),
        field,
        "VFX envelopes and parameter keyframes require duration",
    )
    if "envelope" in event:
        envelope = _record(event["envelope"], f"{field}.envelope")
        if "intensity" in envelope:
            intensity = _record(envelope["intensity"], f"{field}.envelope.intensity")
            for key in ("from", "to", "fadeIn", "fadeOut"):
                if key in intensity:
                    _number(
                        intensity[key],
                        f"{field}.intensity.{key}",
                        minimum=0,
                        maximum=1 if key in {"from", "to"} else None,
                    )
            if "easing" in intensity:
                _enum(intensity["easing"], f"{field}.intensity.easing", _EASINGS)
    if "parameterKeyframes" in event:
        previous = None
        parameter_names = None
        for raw in _array(event["parameterKeyframes"], f"{field}.parameterKeyframes"):
            frame = _record(raw, f"{field}.parameterKeyframe")
            time = _number(frame.get("time"), f"{field}.parameterKeyframe.time", minimum=0, maximum=duration)
            _require(
                time == 0 if previous is None else time > previous,
                field,
                "VFX keyframe times must start at zero and increase",
            )
            names: set[str] = set()
            for key, value in _record(frame.get("values"), f"{field}.parameterKeyframe.values").items():
                name = _string(key, f"{field}.parameter name")
                _require(name not in names, field, "contains duplicate parameter names")
                names.add(name)
                _number(value, f"{field}.parameters.{name}")
            _require(
                bool(names) and (parameter_names is None or names == parameter_names),
                field,
                "VFX keyframes must share nonempty parameter names",
            )
            if "transition" in frame:
                _transition(frame["transition"], f"{field}.parameterKeyframe.transition")
            parameter_names = names
            previous = time


def _particle_fields(event: dict[str, Any], field: str) -> None:
    if "anchor" in event:
        _enum(event["anchor"], f"{field}.anchor", _PARTICLE_ANCHORS)
    _optional_bool(event, "followAnchor", field)
    if "transform" not in event:
        return
    transform = _record(event["transform"], f"{field}.transform")
    if "depthOffset" in transform:
        _number(transform["depthOffset"], f"{field}.transform.depthOffset")
    for key in ("offset", "rotation", "scale"):
        if key not in transform:
            continue
        triple = _record(transform[key], f"{field}.transform.{key}")
        for axis in ("x", "y", "z"):
            if axis in triple:
                number = _number(triple[axis], f"{field}.transform.{key}.{axis}")
                _require(key != "scale" or number > 0, field, "particle scale must be positive")


def _event(event: dict[str, Any], field: str) -> None:
    kind = event.get("kind")
    _enum(kind, f"{field}.kind", {"avatar_vfx", "scene_vfx", "particle_vfx", "sfx"})
    if kind == "sfx":
        _require(
            not ({"duration", "envelope", "parameterKeyframes"} & event.keys()),
            field,
            "sound events cannot have VFX fields",
        )
        _string(event.get("cueId"), f"{field}.cueId")
        if "volume" in event:
            _number(event["volume"], f"{field}.volume", minimum=0, maximum=1)
        return
    if kind == "scene_vfx":
        _enum(event.get("sceneKind"), f"{field}.sceneKind", {"background_layers", "focus_lines"})
        _string(event.get("presetId"), f"{field}.presetId")
    else:
        _string(event.get("effectId"), f"{field}.effectId")
    if kind == "particle_vfx":
        _particle_fields(event, field)
    else:
        _optional_bool(event, "playAccompanyingSound", field)
    _vfx_fields(event, field)


V2_EASES = _EASINGS | {"smooth", "hold"}
V2_HAND_PRESETS = frozenset({"fist", "open-spread", "open-together", "relaxed", "point", "peace", "thumbs-up"})
V2_HAND_ADJUSTMENT_LIMITS = {"curl": 90, "spread": 30}
V2_MIN_SPACING_SECONDS = 0.0005
V2_LIMITS = {
    "durationSeconds": 3600,
    "beats": 1000,
    "tracks": 400,
    "keys": 50000,
    "beatIdLength": 64,
    "labelLength": 80,
}
V2_VALUE_BOUNDS = {"jointDegrees": 360, "hipsMetres": 1, "minQuaternionLength": 1e-6}


def _v2_joint_components() -> dict[str, tuple[str, ...]]:
    axial = ("flexion", "lateralFlexion", "rotation")
    joints: dict[str, tuple[str, ...]] = {
        name: axial for name in ("hips", "spine", "chest", "upperChest", "neck", "head")
    }
    joints["eyes"] = ("yaw", "pitch", "roll")
    sided: dict[str, tuple[str, ...]] = {
        "Shoulder": ("elevation", "protraction", "rotation"),
        "UpperArm": ("elevation", "planeOfElevation", "rotation"),
        "LowerArm": ("flexion", "supination", "deviation"),
        "Hand": ("flexion", "deviation", "rotation"),
        "UpperLeg": ("flexion", "abduction", "rotation"),
        "LowerLeg": ("flexion", "rotation", "deviation"),
        "Foot": ("dorsiflexion", "inversion", "rotation"),
        "Toes": ("flexion", "rotation", "deviation"),
    }
    for digit in ("Index", "Middle", "Ring", "Little"):
        for segment in ("Proximal", "Intermediate", "Distal"):
            sided[digit + segment] = ("curl", "splay", "twist")
    for segment in ("Proximal", "Distal"):
        sided["Thumb" + segment] = ("curl", "palmarAbduction", "twist")
    for side in ("left", "right"):
        for suffix, components in sided.items():
            joints[side + suffix] = components
    return joints


# Anatomical components each joint accepts (frontend poses/anatomy/anatomy.ts).
V2_JOINT_COMPONENTS = _v2_joint_components()
_V2_LEG = re.compile(r"^(left|right)(UpperLeg|LowerLeg|Foot)$")
_V2_TICKS_PER_SECOND = 10_000


# Larger magnitudes cannot lie inside a clip; rejecting them first keeps the
# decimal rounding below its precision limit.
_V2_MAX_TIME_MAGNITUDE = 1e9


def _beat_name(value: Any, beat_ticks: dict[str, int], field: str) -> str:
    """Return a key's beat after checking that it names a declared beat."""
    _require(isinstance(value, str) and value in beat_ticks, field, "must name a beat")
    return str(value)


def _v2_ticks(seconds: float, field: str) -> int:
    """Whole 0.1 ms ticks, rounded as the frontend saves times (half away from zero)."""
    _require(abs(seconds) <= _V2_MAX_TIME_MAGNITUDE, field, "is out of range")
    return int(Decimal(seconds).quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP) * _V2_TICKS_PER_SECOND)


def _utf16_length(value: str) -> int:
    """String length as JavaScript counts it, so length limits agree with the frontend.

    JSON may carry lone surrogates; ``surrogatepass`` counts each as one unit,
    as JavaScript does, instead of raising.
    """
    return len(value.encode("utf-16-le", "surrogatepass")) // 2


def validate_clip_v2_timeline(clip: dict[str, Any]) -> float:
    """Admit an animaPoseClip/2.0 clip's structure and return its duration.

    Mirrors the frontend ``validateAnimaPoseClipV2``: beats, key ownership and
    offsets within each beat's neighbours, track names, value types and bounds.
    Times are compared in the 0.1 ms ticks a saved file holds. Callers check
    ``schema`` and ``loop``; package validation removes a lifetime
    ``playback`` before calling.
    """
    for key in ("id", "name"):
        _string(clip.get(key), key)
    _require("playback" not in clip, "playback", "must be absent for finite idle playback")
    if "role" in clip:
        _enum(clip["role"], "role", {"motion", "reaction"})
    duration = _number(clip.get("duration"), "duration", minimum=0, maximum=V2_LIMITS["durationSeconds"])
    end = _v2_ticks(duration, "duration")
    _require(end > 0, "duration", "must be positive")
    for key in ("plantFeet",):
        _optional_bool(clip, key, "clip")
    if "basePose" in clip:
        _string(clip["basePose"], "basePose")
    for key in ("fadeIn", "fadeOut"):
        if key in clip:
            fade = _record(clip[key], key)
            _number(fade.get("duration"), f"{key}.duration", minimum=0)
            _transition(fade, key)
    plant_feet = clip.get("plantFeet") is True
    spacing = _v2_ticks(V2_MIN_SPACING_SECONDS, "spacing")

    beats = _array(clip.get("beats"), "beats")
    _require(len(beats) <= V2_LIMITS["beats"], "beats", f"must number at most {V2_LIMITS['beats']}")
    beat_ticks: dict[str, int] = {}
    order: list[str] = []
    previous: int | None = None
    for index, raw_beat in enumerate(beats):
        field = f"beats[{index}]"
        beat = _record(raw_beat, field)
        # Keys name the id exactly as written, so it is kept unstripped.
        _string(beat.get("id"), f"{field}.id")
        beat_id = beat["id"]
        _require(_utf16_length(beat_id) <= V2_LIMITS["beatIdLength"], f"{field}.id", "is too long")
        _require(beat_id not in beat_ticks, f"{field}.id", "must be unique")
        _string(beat.get("label"), f"{field}.label")
        _require(_utf16_length(beat["label"]) <= V2_LIMITS["labelLength"], f"{field}.label", "is too long")
        ticks = _v2_ticks(_number(beat.get("time"), f"{field}.time"), f"{field}.time")
        _require(0 <= ticks <= end, f"{field}.time", "must be within the clip duration")
        _require(previous is None or ticks >= previous + spacing, f"{field}.time", "must follow the previous beat")
        if "ease" in beat:
            _enum(beat["ease"], f"{field}.ease", V2_EASES)
        beat_ticks[beat_id] = ticks
        order.append(beat_id)
        previous = ticks

    position_of = {beat_id: position for position, beat_id in enumerate(order)}
    counts = {"tracks": 0, "keys": 0}

    def keys(raw: Any, field: str, check_value: Any) -> None:
        counts["tracks"] += 1
        items = _array(raw, field)
        _require(bool(items), field, "must contain keys")
        counts["keys"] += len(items)
        last: int | None = None
        for index, raw_key in enumerate(items):
            key_field = f"{field}[{index}]"
            key = _record(raw_key, key_field)
            owner = _beat_name(key.get("beat"), beat_ticks, f"{key_field}.beat")
            position = position_of[owner]
            dt = _v2_ticks(_number(key.get("dt", 0), f"{key_field}.dt"), f"{key_field}.dt")
            time = beat_ticks[owner] + dt
            _require(0 <= time <= end, f"{key_field}.dt", "must keep the key within the clip")
            lower = beat_ticks[order[position - 1]] + spacing if position > 0 else None
            upper = beat_ticks[order[position + 1]] - spacing if position + 1 < len(order) else None
            _require(
                (lower is None or time >= lower) and (upper is None or time <= upper),
                f"{key_field}.dt",
                "must keep the key between its beat's neighbours",
            )
            _require(last is None or time >= last + spacing, f"{key_field}.dt", "must follow the previous key")
            last = time
            if "ease" in key:
                _enum(key["ease"], f"{key_field}.ease", V2_EASES)
            check_value(key, key_field)

    def scalar(minimum: float, maximum: float, allow_base: bool) -> Any:
        def check(key: dict[str, Any], field: str) -> None:
            if not (allow_base and key.get("v") == "base"):
                _number(key.get("v"), f"{field}.v", minimum=minimum, maximum=maximum)
            if "tangent" in key:
                _enum(key["tangent"], f"{field}.tangent", {"auto", "flat"})

        return check

    degrees = V2_VALUE_BOUNDS["jointDegrees"]
    joint_bones: set[str] = set()
    for joint_id, raw_components in _record(clip.get("joints", {}), "joints").items():
        field = f"joints.{joint_id}"
        _require(joint_id in V2_JOINT_COMPONENTS, field, "is not a known joint")
        _require(not (plant_feet and _V2_LEG.match(joint_id)), field, "is solved while plantFeet is true")
        joint_bones.update(("leftEye", "rightEye") if joint_id == "eyes" else (joint_id,))
        components = _record(raw_components, field)
        _require(bool(components), field, "must name at least one component")
        for component, raw in components.items():
            _require(component in V2_JOINT_COMPONENTS[joint_id], f"{field}.{component}", "is not a known component")
            keys(raw, f"{field}.{component}", scalar(-degrees, degrees, True))

    def quaternion(key: dict[str, Any], field: str) -> None:
        values = _array(key.get("q"), f"{field}.q")
        _require(len(values) == 4, f"{field}.q", "must have four components")
        numbers = [_number(value, f"{field}.q") for value in values]
        _require(math.hypot(*numbers) >= V2_VALUE_BOUNDS["minQuaternionLength"], f"{field}.q", "must not be zero")

    for bone, raw in _record(clip.get("rotations", {}), "rotations").items():
        field = f"rotations.{bone}"
        _require(bone in HUMAN_BONE_NAMES, field, "is not a humanoid bone")
        _require(bone not in joint_bones, field, "already has anatomical tracks")
        _require(not (plant_feet and _V2_LEG.match(bone)), field, "is solved while plantFeet is true")
        keys(raw, field, quaternion)

    for axis, raw in _record(clip.get("hipsPosition", {}), "hipsPosition").items():
        _enum(axis, "hipsPosition axis", {"x", "y", "z"})
        metres = V2_VALUE_BOUNDS["hipsMetres"]
        keys(raw, f"hipsPosition.{axis}", scalar(-metres, metres, True))

    def hand_shape(key: dict[str, Any], field: str) -> None:
        _enum(key.get("preset"), f"{field}.preset", set(V2_HAND_PRESETS))
        for adjustment, limit in V2_HAND_ADJUSTMENT_LIMITS.items():
            if adjustment in key:
                _number(key[adjustment], f"{field}.{adjustment}", minimum=-limit, maximum=limit)

    for side, raw in _record(clip.get("hands", {}), "hands").items():
        _enum(side, "hands side", {"left", "right"})
        keys(raw, f"hands.{side}", hand_shape)

    for name, raw in _record(clip.get("expressions", {}), "expressions").items():
        _require(bool(name.strip()) and name != "__proto__", f"expressions.{name}", "must be an expression name")
        keys(raw, f"expressions.{name}", scalar(0, 1, False))

    for index, raw_contact in enumerate(_array(clip.get("contacts", []), "contacts")):
        field = f"contacts[{index}]"
        contact = _record(raw_contact, field)
        for key in ("bone", "target"):
            bone_name = contact.get(key)
            is_bone = isinstance(bone_name, str) and bone_name in HUMAN_BONE_NAMES
            _require(is_bone, f"{field}.{key}", "must be a humanoid bone")
        owner = _beat_name(contact.get("beat"), beat_ticks, f"{field}.beat")
        start = beat_ticks[owner] + _v2_ticks(_number(contact.get("from"), f"{field}.from"), f"{field}.from")
        stop = beat_ticks[owner] + _v2_ticks(_number(contact.get("to"), f"{field}.to"), f"{field}.to")
        _require(0 <= start <= stop <= end, field, "must lie within the clip")
        if "offset" in contact:
            offset = _array(contact["offset"], f"{field}.offset")
            _require(len(offset) == 3, f"{field}.offset", "must have three components")
            for value in offset:
                _number(value, f"{field}.offset")
        if "tolerance" in contact:
            _require(_number(contact["tolerance"], f"{field}.tolerance") > 0, f"{field}.tolerance", "must be positive")

    ids: set[str] = set()
    events = _array(clip.get("events", []), "events")
    for raw_event in events:
        event = _record(raw_event, "event")
        event_id = _string(event.get("id"), "event.id")
        _require(event_id not in ids, "events", "must have unique ids")
        ids.add(event_id)
        _number(event.get("time"), f"event.{event_id}.time", minimum=0, maximum=end / _V2_TICKS_PER_SECOND)
        _event(event, f"event.{event_id}")

    _require(counts["tracks"] <= V2_LIMITS["tracks"], "tracks", f"must number at most {V2_LIMITS['tracks']}")
    _require(counts["keys"] <= V2_LIMITS["keys"], "keys", f"must number at most {V2_LIMITS['keys']}")
    _require(bool(counts["keys"] or events), "timeline", "requires a track key or event")
    return end / _V2_TICKS_PER_SECOND
