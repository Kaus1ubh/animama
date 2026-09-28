"""Structural admission for the animaPoseClip shapes consumed by idle playback.

Keep this boundary aligned with frontend poses/animaPoseClip/schema.ts and
animaPose.ts. Shared JSON fixtures exercise these checks and the actual parser.
This validates playable shape, without rewriting authored poses or event values.
"""

from __future__ import annotations

import math
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


def _pose(value: Any, field: str) -> None:
    """Match clip snapshots, including empty landmarks and authoring transforms.

    Static content's validate_resolved_pose is deliberately stricter: the clip
    parser also supports Euler angles, quaternion normalization and weight clamps.
    """
    pose = _record(value, field)
    if "ref" in pose:
        _require(set(pose) == {"ref"}, field, "pose references must contain only ref")
        _string(pose["ref"], f"{field}.ref")
        return
    _require("parent" not in pose, field, "snapshots cannot inherit a parent")
    _require(pose.get("schema", "animaPose/1.0") == "animaPose/1.0", field, "has an unsupported Pose schema")
    for key in ("id", "name"):
        if key in pose:
            _string(pose[key], f"{field}.{key}")
    if "rotationOrder" in pose:
        _enum(pose["rotationOrder"], f"{field}.rotationOrder", {"XYZ"})
    if "humanoid" in pose:
        for bone, raw_transform in _record(pose["humanoid"], f"{field}.humanoid").items():
            _require(bone in HUMAN_BONE_NAMES, field, "contains an unknown humanoid bone")
            transform = _record(raw_transform, f"{field}.humanoid.{bone}")
            _require(
                not ("rotation" in transform and "rotationEulerDegrees" in transform),
                field,
                "cannot specify both quaternion and Euler rotation",
            )
            for key, size in (("position", 3), ("rotation", 4), ("rotationEulerDegrees", 3)):
                if key not in transform:
                    continue
                components = _array(transform[key], f"{field}.{bone}.{key}")
                _require(len(components) == size, field, f"{key} requires {size} numbers")
                numbers = [_number(component, f"{field}.{bone}.{key}") for component in components]
                if key == "rotation":
                    _require(math.hypot(*numbers) > 0.000001, field, "quaternion must have nonzero length")
    if "expressions" in pose:
        for key, weight in _record(pose["expressions"], f"{field}.expressions").items():
            _string(key, f"{field}.expression name")
            _number(weight, f"{field}.expressions.{key}")


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


def validate_idle_clip_timeline(clip: dict[str, Any], duration: float | None) -> float:
    """Admit the player's clip structure and return its authored timeline horizon.

    Caller rejects lifetime playback and validates explicit duration/loop values.
    External Pose and event dependencies remain owned by typed closure validation.
    """
    for key in ("id", "name"):
        _string(clip.get(key), key)
    _require("playback" not in clip, "playback", "must be absent for finite idle playback")
    if "role" in clip:
        _enum(clip["role"], "role", {"motion", "reaction"})
    if "basePose" in clip:
        _string(clip["basePose"], "basePose")
    if "defaultTransition" in clip:
        _transition(clip["defaultTransition"], "defaultTransition")
    for key in ("fadeIn", "fadeOut"):
        if key in clip:
            fade = _record(clip[key], key)
            _number(fade.get("duration"), f"{key}.duration", minimum=0)
            _transition(fade, key)
    aliases: set[str] = set()
    for raw_alias, pose in _record(clip.get("poses"), "poses").items():
        alias = _string(raw_alias, "pose alias")
        _require(alias not in aliases, "poses", "contains duplicate aliases")
        aliases.add(alias)
        _pose(pose, f"poses.{alias}")
    keyframes = _array(clip.get("poseKeyframes"), "poseKeyframes")
    previous = None
    horizon = 0.0
    for raw_frame in keyframes:
        frame = _record(raw_frame, "poseKeyframe")
        time = _number(frame.get("time"), "poseKeyframe.time", minimum=0, maximum=duration)
        _require(previous is None or time > previous, "poseKeyframes", "times must strictly increase")
        pose_alias = _string(frame.get("pose"), "poseKeyframe.pose")
        _require(pose_alias in aliases, "poseKeyframe.pose", "must reference a clip pose alias")
        if "transition" in frame:
            _transition(frame["transition"], "poseKeyframe.transition")
        previous = time
        horizon = max(horizon, time)
    events = _array(clip.get("events", []), "events")
    ids: set[str] = set()
    for raw_event in events:
        event = _record(raw_event, "event")
        event_id = _string(event.get("id"), "event.id")
        _require(event_id not in ids, "events", "must have unique ids")
        ids.add(event_id)
        time = _number(event.get("time"), f"event.{event_id}.time", minimum=0, maximum=duration)
        _event(event, f"event.{event_id}")
        horizon = max(horizon, time)
    _require(bool(keyframes or events), "timeline", "requires a pose keyframe or event")
    return duration if duration is not None else horizon
