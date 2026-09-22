"""Strict admission for resolved animaPose/1.0 content payloads.

Authoring resolves inheritance and Euler rotations before persistence. This
boundary accepts only self-contained values the frontend parser can consume
without depending on a catalog or silently clamping invalid expression weights.
"""

from __future__ import annotations

import math
from typing import Any

from animama.domain.content_documents import ContentDocumentError

# VRM 1.0 humanoid names, matching @pixiv/three-vrm's VRMHumanBoneName.
HUMAN_BONE_NAMES = frozenset(
    {"hips", "spine", "chest", "upperChest", "neck", "head", "leftEye", "rightEye", "jaw"}
    | {
        side + bone
        for side in ("left", "right")
        for bone in (
            "UpperLeg",
            "LowerLeg",
            "Foot",
            "Toes",
            "Shoulder",
            "UpperArm",
            "LowerArm",
            "Hand",
            "ThumbMetacarpal",
            "ThumbProximal",
            "ThumbDistal",
            "IndexProximal",
            "IndexIntermediate",
            "IndexDistal",
            "MiddleProximal",
            "MiddleIntermediate",
            "MiddleDistal",
            "RingProximal",
            "RingIntermediate",
            "RingDistal",
            "LittleProximal",
            "LittleIntermediate",
            "LittleDistal",
        )
    }
)
MAX_POSE_POSITION = 1_000_000


def _invalid(message: str) -> ContentDocumentError:
    return ContentDocumentError("invalid_pose_payload", message)


def _tuple(value: Any, *, size: int, bound: float) -> list[int | float]:
    if not isinstance(value, list) or len(value) != size:
        raise _invalid(f"Pose transform requires a {size}-number array")
    if any(type(entry) not in (int, float) or abs(entry) > bound or not math.isfinite(entry) for entry in value):
        raise _invalid("Pose transform values must be finite numbers within the supported bounds")
    return list(value)


def validate_resolved_pose(value: Any, *, content_id: str | None, name: str) -> dict[str, Any]:
    """Validate and copy a parent-free static state with matching descriptor identity."""
    if not isinstance(value, dict) or value.get("schema") != "animaPose/1.0":
        raise _invalid("Pose payload requires schema animaPose/1.0")
    if set(value) - {"schema", "id", "name", "humanoid", "expressions"}:
        raise _invalid("Resolved Pose payload supports only schema, id, name, humanoid and expressions")
    if not content_id or value.get("id") != content_id or value.get("name") != name:
        raise _invalid("Pose id and name must match the descriptor content_id and name")
    result: dict[str, Any] = {"schema": "animaPose/1.0", "id": content_id, "name": name}
    if "humanoid" in value:
        humanoid = value["humanoid"]
        if not isinstance(humanoid, dict) or set(humanoid) - HUMAN_BONE_NAMES:
            raise _invalid("Pose humanoid must contain only known VRM bone names")
        transforms: dict[str, Any] = {}
        for bone, transform in humanoid.items():
            if not isinstance(transform, dict) or set(transform) - {"position", "rotation"}:
                raise _invalid("Pose bone transforms support only position and quaternion rotation")
            copied: dict[str, Any] = {}
            if "position" in transform:
                copied["position"] = _tuple(transform["position"], size=3, bound=MAX_POSE_POSITION)
            if "rotation" in transform:
                rotation = _tuple(transform["rotation"], size=4, bound=1.000001)
                if not math.isclose(math.hypot(*rotation), 1, rel_tol=0, abs_tol=0.000001):
                    raise _invalid("Pose quaternion rotation must have unit length")
                copied["rotation"] = rotation
            transforms[bone] = copied
        result["humanoid"] = transforms
    if "expressions" in value:
        expressions = value["expressions"]
        if not isinstance(expressions, dict) or len(expressions) > 256:
            raise _invalid("Pose expressions must be an object with at most 256 weights")
        for expression, weight in expressions.items():
            if not isinstance(expression, str) or not expression.strip() or len(expression) > 128:
                raise _invalid("Pose expression names must be nonempty and at most 128 characters")
            if type(weight) not in (int, float) or not 0 <= weight <= 1 or not math.isfinite(weight):
                raise _invalid("Pose expression weights must be finite numbers between zero and one")
        result["expressions"] = dict(expressions)
    return result
