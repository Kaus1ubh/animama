from __future__ import annotations

import json
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any

from animama.logging import get_logger
from animama.resources.catalogs import catalog_resource

log = get_logger("prompts.avatar_animation_manifest")


@dataclass(frozen=True, slots=True)
class ManifestGestureEntry:
    """Normalized manifest gesture available to the emotional analyst."""

    id: str
    name: str
    description: str
    type: str
    file: str


def normalize_gesture_id(value: Any) -> str:
    if not isinstance(value, str):
        return ""
    trimmed = value.strip()
    if not trimmed:
        return ""
    without_leading_slash = trimmed[1:] if trimmed.startswith("/") else trimmed
    without_prefix = without_leading_slash.removeprefix("vrm/animations/")
    basename = without_prefix.rsplit("/", 1)[-1]
    if basename.endswith(".vrma"):
        basename = basename[: -len(".vrma")]
    normalized = basename.removeprefix("gesture_")
    return normalized.removesuffix("-clip")


def _manifest_candidates() -> tuple[Path, ...]:
    return (catalog_resource("animation-manifest.json"),)


@lru_cache(maxsize=1)
def load_animation_manifest() -> dict[str, Any]:
    manifest_candidates = _manifest_candidates()
    manifest_path = next(
        (candidate for candidate in manifest_candidates if candidate.exists()),
        manifest_candidates[0],
    )

    if not manifest_path.exists():
        log.warning("Animation manifest not found", path=str(manifest_path))
        return {}

    try:
        with manifest_path.open() as f:
            loaded = json.load(f)
    except Exception as exc:
        log.error("Failed to load animation manifest", path=str(manifest_path), exc=exc)
        return {}
    return loaded if isinstance(loaded, dict) else {}


def get_manifest_gesture_inventory(
    manifest: Mapping[str, Any] | None = None,
) -> tuple[ManifestGestureEntry, ...]:
    source = manifest if manifest is not None else load_animation_manifest()
    animations_root = source.get("Animations", {})
    raw_gestures = animations_root.get("gesture") if isinstance(animations_root, Mapping) else None
    if not isinstance(raw_gestures, list):
        return ()

    gestures: list[ManifestGestureEntry] = []
    seen_ids: set[str] = set()
    for item in raw_gestures:
        if not isinstance(item, Mapping) or item.get("disabled") is True:
            continue
        animation_type = item.get("animation_type")
        if isinstance(animation_type, str) and animation_type != "gesture":
            continue
        gesture_type = item.get("type")
        if gesture_type not in {"vrma", "animaPoseClip"}:
            continue
        file_value = item.get("file")
        file = file_value.strip() if isinstance(file_value, str) else ""
        gesture_id = normalize_gesture_id(item.get("id") if isinstance(item.get("id"), str) else file)
        if not gesture_id or gesture_id in seen_ids:
            continue
        name_value = item.get("name")
        name = name_value.strip() if isinstance(name_value, str) and name_value.strip() else gesture_id
        description_value = item.get("description")
        description = description_value.strip() if isinstance(description_value, str) else ""
        gestures.append(
            ManifestGestureEntry(
                id=gesture_id,
                name=name,
                description=description,
                type=gesture_type,
                file=file,
            )
        )
        seen_ids.add(gesture_id)

    return tuple(gestures)


def render_available_animations(
    gestures: Sequence[ManifestGestureEntry] | None = None,
    *,
    manifest: Mapping[str, Any] | None = None,
) -> str:
    candidates = tuple(gestures) if gestures is not None else get_manifest_gesture_inventory(manifest)
    if not candidates:
        return "No animations available."

    blocks = []
    for gesture in candidates:
        blocks.append(f"- ID: {gesture.id}\n  Name: {gesture.name}\n  Description: {gesture.description}")

    return "\n\n".join(blocks)
