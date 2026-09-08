from __future__ import annotations

import json
from collections import defaultdict
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any

from animama.resources.catalogs import catalog_resource

from .emotions import TRACKED_EMOTIONS, normalize_emotion_name, normalize_emotional_state

AVATAR_VFX_REGIONS: tuple[str, ...] = (
    "eyes",
    "undereye",
    "blush",
    "mouth",
    "emote",
    "full_face",
)
STACKABLE_AVATAR_VFX_REGIONS: frozenset[str] = frozenset(("emote", "full_face"))


@dataclass(frozen=True, slots=True)
class AvatarVFXEmotionRule:
    emotion: str
    value: int


@dataclass(frozen=True, slots=True)
class AvatarVFXLifetime:
    kind: str
    run_end_buffer_sec: int | None = None
    turns: int | None = None


@dataclass(frozen=True, slots=True)
class AvatarVFXCatalogEntry:
    id: str
    label: str
    description: str
    region: str
    emotions: tuple[AvatarVFXEmotionRule, ...] = ()
    lifetime: AvatarVFXLifetime | None = None

    @property
    def is_selectable(self) -> bool:
        return bool(self.emotions)


@dataclass(frozen=True, slots=True)
class AvatarVFXDropReason:
    effect_id: str
    reason: str
    region: str | None = None


@dataclass(frozen=True, slots=True)
class AvatarVFXSelectionResult:
    accepted_ids: tuple[str, ...]
    threshold_miss_ids: tuple[str, ...]
    dropped: tuple[AvatarVFXDropReason, ...]


def _catalog_path() -> Path:
    return catalog_resource("vfx-catalog.json")


def _read_required_string(entry: Mapping[str, Any], *, field_name: str, context: str) -> str:
    value = entry.get(field_name)
    if not isinstance(value, str):
        raise ValueError(f"{context}: {field_name!r} must be a string")
    normalized = value.strip()
    if not normalized:
        raise ValueError(f"{context}: {field_name!r} must not be empty")
    return normalized


def _coerce_int(value: Any, *, default: int = 0) -> int:
    if isinstance(value, bool):
        return int(value)
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return int(value)
    try:
        return int(str(value).strip())
    except Exception:
        return default


def _parse_lifetime(raw: Any, *, context: str) -> AvatarVFXLifetime | None:
    if raw is None:
        return None
    if not isinstance(raw, Mapping):
        raise ValueError(f"{context}: 'lifetime' must be an object")
    kind = _read_required_string(raw, field_name="kind", context=f"{context}.lifetime").lower()
    if kind == "duration":
        return AvatarVFXLifetime(
            kind="duration",
            run_end_buffer_sec=_coerce_int(raw.get("runEndBufferSec"), default=0),
        )
    if kind == "turns":
        return AvatarVFXLifetime(
            kind="turns",
            turns=max(0, _coerce_int(raw.get("turns"), default=0)),
        )
    raise ValueError(f"{context}: unsupported lifetime kind {kind!r}")


def _parse_emotions(raw: Any, *, context: str) -> tuple[AvatarVFXEmotionRule, ...]:
    if raw is None:
        return ()
    if not isinstance(raw, Sequence) or isinstance(raw, str | bytes):
        raise ValueError(f"{context}: 'emotions' must be a list")

    rules: list[AvatarVFXEmotionRule] = []
    for index, item in enumerate(raw):
        if not isinstance(item, Mapping):
            raise ValueError(f"{context}: emotions[{index}] must be an object")
        emotion = normalize_emotion_name(item.get("emotion"))
        if emotion is None:
            raise ValueError(f"{context}: emotions[{index}].emotion is invalid")
        rules.append(
            AvatarVFXEmotionRule(
                emotion=emotion,
                value=max(0, _coerce_int(item.get("value"), default=0)),
            )
        )
    return tuple(rules)


def _parse_catalog_entry(raw: Mapping[str, Any], *, index: int) -> AvatarVFXCatalogEntry:
    context = f"avatar_vfx_catalog[{index}]"
    effect_id = _read_required_string(raw, field_name="id", context=context)
    label = _read_required_string(raw, field_name="label", context=context)
    region = _read_required_string(raw, field_name="region", context=context).lower()
    if region not in AVATAR_VFX_REGIONS:
        raise ValueError(f"{context}: unsupported region {region!r}")
    return AvatarVFXCatalogEntry(
        id=effect_id,
        label=label,
        description=_read_required_string(raw, field_name="description", context=context),
        region=region,
        emotions=_parse_emotions(raw.get("emotions"), context=context),
        lifetime=_parse_lifetime(raw.get("lifetime"), context=context),
    )


@lru_cache(maxsize=1)
def load_avatar_vfx_catalog() -> tuple[AvatarVFXCatalogEntry, ...]:
    path = _catalog_path()
    if not path.exists():
        raise FileNotFoundError(f"Avatar VFX catalog not found: {path}")

    with path.open() as handle:
        raw = json.load(handle)

    if not isinstance(raw, list):
        raise ValueError("Avatar VFX catalog root must be a list")

    entries: list[AvatarVFXCatalogEntry] = []
    for index, entry in enumerate(raw):
        if not isinstance(entry, Mapping):
            raise ValueError(f"avatar_vfx_catalog[{index}] must be an object")
        entries.append(_parse_catalog_entry(entry, index=index))
    return tuple(entries)


@lru_cache(maxsize=1)
def avatar_vfx_catalog_by_id() -> dict[str, AvatarVFXCatalogEntry]:
    return {entry.id: entry for entry in load_avatar_vfx_catalog()}


@lru_cache(maxsize=1)
def selectable_avatar_vfx_catalog() -> tuple[AvatarVFXCatalogEntry, ...]:
    return tuple(entry for entry in load_avatar_vfx_catalog() if entry.is_selectable)


@lru_cache(maxsize=1)
def selectable_avatar_vfx_by_emotion() -> dict[str, tuple[tuple[AvatarVFXCatalogEntry, AvatarVFXEmotionRule], ...]]:
    grouped: dict[str, list[tuple[AvatarVFXCatalogEntry, AvatarVFXEmotionRule]]] = defaultdict(list)
    for entry in selectable_avatar_vfx_catalog():
        for rule in entry.emotions:
            grouped[rule.emotion].append((entry, rule))
    return {emotion: tuple(grouped.get(emotion, ())) for emotion in TRACKED_EMOTIONS if grouped.get(emotion)}


def is_avatar_vfx_region_stackable(region: str | None) -> bool:
    if not isinstance(region, str):
        return False
    return region.strip().lower() in STACKABLE_AVATAR_VFX_REGIONS


def avatar_vfx_threshold_matches(entry: AvatarVFXCatalogEntry, state: Mapping[str, Any] | None) -> bool:
    if not entry.emotions:
        return False
    normalized = normalize_emotional_state(state or {})
    return any(normalized.get(rule.emotion, 0) >= rule.value for rule in entry.emotions)


def normalize_avatar_vfx_ids(
    raw_ids: Any,
    *,
    emotional_state: Mapping[str, Any] | None = None,
) -> AvatarVFXSelectionResult:
    if not isinstance(raw_ids, Sequence) or isinstance(raw_ids, str | bytes):
        return AvatarVFXSelectionResult(accepted_ids=(), threshold_miss_ids=(), dropped=())

    catalog = avatar_vfx_catalog_by_id()
    accepted_ids: list[str] = []
    threshold_miss_ids: list[str] = []
    dropped: list[AvatarVFXDropReason] = []
    seen_ids: set[str] = set()
    occupied_regions: set[str] = set()
    normalized_state = normalize_emotional_state(emotional_state or {})

    for raw_id in raw_ids:
        if not isinstance(raw_id, str):
            continue
        effect_id = raw_id.strip()
        if not effect_id:
            continue
        if effect_id in seen_ids:
            dropped.append(AvatarVFXDropReason(effect_id=effect_id, reason="duplicate"))
            continue
        seen_ids.add(effect_id)

        entry = catalog.get(effect_id)
        if entry is None:
            dropped.append(AvatarVFXDropReason(effect_id=effect_id, reason="unknown"))
            continue
        if not entry.is_selectable:
            dropped.append(AvatarVFXDropReason(effect_id=effect_id, reason="manual_only", region=entry.region))
            continue
        if not is_avatar_vfx_region_stackable(entry.region) and entry.region in occupied_regions:
            dropped.append(AvatarVFXDropReason(effect_id=effect_id, reason="region_conflict", region=entry.region))
            continue

        accepted_ids.append(effect_id)
        if not is_avatar_vfx_region_stackable(entry.region):
            occupied_regions.add(entry.region)
        if not avatar_vfx_threshold_matches(entry, normalized_state):
            threshold_miss_ids.append(effect_id)

    return AvatarVFXSelectionResult(
        accepted_ids=tuple(accepted_ids),
        threshold_miss_ids=tuple(threshold_miss_ids),
        dropped=tuple(dropped),
    )


__all__ = [
    "AVATAR_VFX_REGIONS",
    "STACKABLE_AVATAR_VFX_REGIONS",
    "AvatarVFXCatalogEntry",
    "AvatarVFXDropReason",
    "AvatarVFXEmotionRule",
    "AvatarVFXLifetime",
    "AvatarVFXSelectionResult",
    "avatar_vfx_catalog_by_id",
    "avatar_vfx_threshold_matches",
    "is_avatar_vfx_region_stackable",
    "load_avatar_vfx_catalog",
    "normalize_avatar_vfx_ids",
    "selectable_avatar_vfx_by_emotion",
    "selectable_avatar_vfx_catalog",
]
