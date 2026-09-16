from __future__ import annotations

from collections import OrderedDict
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any

EMOTION_MIN_VALUE = 0
EMOTION_MAX_VALUE = 30
EMOTION_PROMOTION_BUDGET = 5
EMOTION_DEMOTION_BUDGET = 3
EMOTION_PROMOTION_LIMIT = 3
EMOTION_DEMOTION_LIMIT = 2
NEUTRAL_EMOTION = "neutral"

EMOTION_GROUPS: tuple[str, ...] = (
    "affection",
    "esteem",
    "delight",
    "drive",
    "alarm",
    "rejection",
    "revulsion",
    "gloom",
)

EMOTION_GROUP_MEMBERS: dict[str, tuple[str, ...]] = {
    "affection": ("admiration", "caring", "love"),
    "esteem": ("respect", "confidence", "gratitude"),
    "delight": ("amusement", "excitement", "joy"),
    "drive": ("desire", "curiosity", "optimism"),
    "alarm": ("fear", "nervousness", "confusion"),
    "rejection": ("anger", "annoyance", "disapproval"),
    "revulsion": ("disgust", "embarrassment", "remorse"),
    "gloom": ("disappointment", "grief", "sadness"),
}

TRACKED_EMOTIONS: tuple[str, ...] = tuple(
    emotion for group in EMOTION_GROUPS for emotion in EMOTION_GROUP_MEMBERS[group]
)

TRACKED_EMOTION_SET = frozenset(TRACKED_EMOTIONS)
SELECTABLE_EMOTION_SET = frozenset((*TRACKED_EMOTIONS, NEUTRAL_EMOTION))
EMOTION_ORDER_INDEX = {emotion: index for index, emotion in enumerate(TRACKED_EMOTIONS)}
EMOTION_GROUP_ORDER_INDEX = {group: index for index, group in enumerate(EMOTION_GROUPS)}
EMOTION_GROUP_BY_EMOTION = {emotion: group for group, members in EMOTION_GROUP_MEMBERS.items() for emotion in members}
OPPOSING_EMOTION_GROUPS: dict[str, str] = {
    "affection": "rejection",
    "rejection": "affection",
    "delight": "gloom",
    "gloom": "delight",
    "drive": "alarm",
    "alarm": "drive",
    "esteem": "revulsion",
    "revulsion": "esteem",
}

# Existing animation assets still use the older high-level manifest lanes.
MANIFEST_LANES_BY_EMOTION_GROUP: dict[str, tuple[str, ...]] = {
    "affection": ("neutral",),
    "esteem": ("neutral",),
    "delight": ("joy",),
    "drive": ("joy", "neutral"),
    "alarm": ("fear",),
    "rejection": ("angry",),
    "revulsion": ("disgust",),
    "gloom": ("sad",),
}


@dataclass(slots=True)
class EmotionValue:
    emotion: str
    value: int


@dataclass(slots=True)
class EmotionDelta:
    emotion: str
    delta: int


@dataclass(slots=True)
class EmotionGroupSummary:
    group: str
    average: float
    peak: EmotionValue | None
    members: tuple[EmotionValue, ...]


def _as_mapping(value: Any) -> Mapping[str, Any] | None:
    if isinstance(value, EmotionValue):
        return {"emotion": value.emotion, "value": value.value}
    if isinstance(value, EmotionDelta):
        return {"emotion": value.emotion, "delta": value.delta}
    if isinstance(value, Mapping):
        return value
    model_dump = getattr(value, "model_dump", None)
    if callable(model_dump):
        dumped = model_dump(mode="python")
        if isinstance(dumped, Mapping):
            return dumped
    return None


def _coerce_int(value: Any, default: int = 0) -> int:
    if value is None:
        return default
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


def clamp_emotion_value(value: Any, lo: int = EMOTION_MIN_VALUE, hi: int = EMOTION_MAX_VALUE) -> int:
    return max(lo, min(hi, _coerce_int(value, default=0)))


def default_emotional_state() -> dict[str, int]:
    return {emotion: EMOTION_MIN_VALUE for emotion in TRACKED_EMOTIONS}


def normalize_emotion_name(value: Any, *, allow_neutral: bool = False) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = value.strip().lower()
    if normalized in TRACKED_EMOTION_SET:
        return normalized
    if allow_neutral and normalized == NEUTRAL_EMOTION:
        return normalized
    return None


def normalize_emotion_group_name(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = value.strip().lower()
    if normalized in EMOTION_GROUP_ORDER_INDEX:
        return normalized
    return None


def format_emotion_group_label(group: str | None) -> str:
    normalized = normalize_emotion_group_name(group)
    if normalized is None:
        return "Neutral"
    return normalized.replace("_", " ").title()


def normalize_emotional_state(raw: Any) -> dict[str, int]:
    src = _as_mapping(raw) or {}
    out = default_emotional_state()
    for emotion in TRACKED_EMOTIONS:
        if emotion in src:
            out[emotion] = clamp_emotion_value(src.get(emotion))
    return out


def emotion_value_level(value: Any) -> int:
    current = clamp_emotion_value(value)
    if current >= 26:
        return 3
    if current >= 16:
        return 2
    if current >= 5:
        return 1
    return 0


def ordered_emotion_values(state: Any) -> list[EmotionValue]:
    normalized = normalize_emotional_state(state)
    return [EmotionValue(emotion=emotion, value=normalized[emotion]) for emotion in TRACKED_EMOTIONS]


def emotion_values_payload(values: Sequence[EmotionValue] | Sequence[Mapping[str, Any]]) -> list[dict[str, int | str]]:
    payload: list[dict[str, int | str]] = []
    emotion: str | None
    for item in values:
        if isinstance(item, EmotionValue):
            emotion = item.emotion
            value = item.value
        elif isinstance(item, Mapping):
            emotion = normalize_emotion_name(item.get("emotion"))
            if emotion is None:
                continue
            value = clamp_emotion_value(item.get("value"))
        else:
            continue
        payload.append({"emotion": emotion, "value": clamp_emotion_value(value)})
    return payload


def emotional_state_from_values(values: Sequence[EmotionValue] | Sequence[Mapping[str, Any]] | None) -> dict[str, int]:
    state = default_emotional_state()
    value: object
    if not values:
        return state
    for item in values:
        if isinstance(item, EmotionValue):
            emotion = normalize_emotion_name(item.emotion)
            value = item.value
        elif isinstance(item, Mapping):
            emotion = normalize_emotion_name(item.get("emotion"))
            value = item.get("value")
        else:
            continue
        if emotion is None:
            continue
        state[emotion] = clamp_emotion_value(value)
    return state


def sort_emotions(items: Sequence[EmotionValue], *, descending: bool = True) -> list[EmotionValue]:
    return sorted(
        items,
        key=lambda item: (
            -item.value if descending else item.value,
            EMOTION_ORDER_INDEX.get(item.emotion, len(TRACKED_EMOTIONS)),
        ),
    )


def top_emotions(state: Any, *, limit: int = 3, include_zero: bool = False) -> list[EmotionValue]:
    ranked = sort_emotions(ordered_emotion_values(state))
    if not include_zero:
        ranked = [item for item in ranked if item.value > 0]
    if limit < 0:
        return ranked
    return ranked[:limit]


def emotion_group_for_emotion(emotion: str | None) -> str | None:
    normalized = normalize_emotion_name(emotion)
    if normalized is None:
        return None
    return EMOTION_GROUP_BY_EMOTION.get(normalized)


def emotion_group_members(group: str) -> tuple[str, ...]:
    normalized = normalize_emotion_group_name(group)
    if normalized is None:
        return ()
    return EMOTION_GROUP_MEMBERS.get(normalized, ())


def ordered_emotion_group_summaries(state: Any, *, include_zero: bool = False) -> list[EmotionGroupSummary]:
    normalized = normalize_emotional_state(state)
    summaries: list[EmotionGroupSummary] = []
    for group in EMOTION_GROUPS:
        members = tuple(
            EmotionValue(emotion=emotion, value=normalized[emotion]) for emotion in EMOTION_GROUP_MEMBERS[group]
        )
        average = sum(member.value for member in members) / len(members)
        peak = sort_emotions(members)[0] if members else None
        summaries.append(
            EmotionGroupSummary(
                group=group,
                average=average,
                peak=peak,
                members=members,
            )
        )
    summaries.sort(
        key=lambda item: (
            -item.average,
            EMOTION_GROUP_ORDER_INDEX.get(item.group, len(EMOTION_GROUPS)),
        )
    )
    if not include_zero:
        summaries = [item for item in summaries if item.average > 0]
    return summaries


def top_emotion_groups(state: Any, *, limit: int = 3, include_zero: bool = False) -> list[EmotionGroupSummary]:
    ranked = ordered_emotion_group_summaries(state, include_zero=include_zero)
    if limit < 0:
        return ranked
    return ranked[:limit]


def manifest_lanes_for_emotion_group(group: str | None) -> tuple[str, ...]:
    normalized = normalize_emotion_group_name(group)
    if normalized is None:
        return ("neutral",)
    return MANIFEST_LANES_BY_EMOTION_GROUP.get(normalized, ("neutral",))


def primary_manifest_lane_for_emotion_group(group: str | None) -> str:
    return manifest_lanes_for_emotion_group(group)[0]


def primary_manifest_lane_for_emotion(emotion: str | None) -> str:
    return primary_manifest_lane_for_emotion_group(emotion_group_for_emotion(emotion))


def summarize_emotional_state(state: Any, *, limit: int = 8) -> str:
    ranked = top_emotions(state, limit=limit)
    if not ranked:
        return f"- {NEUTRAL_EMOTION}: no active tracked emotions"
    lines = []
    for item in ranked:
        level = emotion_value_level(item.value)
        group = format_emotion_group_label(emotion_group_for_emotion(item.emotion))
        lines.append(f"- {item.emotion}: {item.value}/30 (level {level}, {group})")
    return "\n".join(lines)


def summarize_emotion_groups(state: Any, *, limit: int = 4) -> str:
    ranked = top_emotion_groups(state, limit=limit)
    if not ranked:
        return f"- {NEUTRAL_EMOTION}: no active emotion groups"
    lines = []
    for item in ranked:
        peak = item.peak.emotion if item.peak is not None else NEUTRAL_EMOTION
        peak_value = item.peak.value if item.peak is not None else 0
        lines.append(
            f"- {format_emotion_group_label(item.group)}: avg {item.average:.1f}/30 (peak {peak}={peak_value})"
        )
    return "\n".join(lines)


def format_full_emotional_state(state: Any) -> str:
    normalized = normalize_emotional_state(state)
    lines = []
    for group in EMOTION_GROUPS:
        members = ", ".join(f"{emotion}={normalized[emotion]}" for emotion in EMOTION_GROUP_MEMBERS[group])
        lines.append(f"{format_emotion_group_label(group)}: {members}")
    return "\n".join(lines)


def _normalize_raw_updates(raw_updates: Any) -> list[EmotionDelta]:
    if not isinstance(raw_updates, Sequence) or isinstance(raw_updates, str | bytes):
        return []

    combined: OrderedDict[str, int] = OrderedDict()
    for item in raw_updates:
        mapping = _as_mapping(item)
        if mapping is None:
            continue
        emotion = normalize_emotion_name(mapping.get("emotion"), allow_neutral=True)
        if emotion is None or emotion == NEUTRAL_EMOTION:
            continue
        delta = _coerce_int(mapping.get("delta"), default=0)
        if delta == 0:
            continue
        if emotion not in combined:
            combined[emotion] = 0
        combined[emotion] += delta
    return [EmotionDelta(emotion=emotion, delta=delta) for emotion, delta in combined.items() if delta != 0]


def normalize_sparse_updates(current_state: Any, raw_updates: Any) -> list[EmotionDelta]:
    state = normalize_emotional_state(current_state)
    normalized_updates = _normalize_raw_updates(raw_updates)

    positive_budget = EMOTION_PROMOTION_BUDGET
    negative_budget = EMOTION_DEMOTION_BUDGET
    positive_count = 0
    negative_count = 0
    output: list[EmotionDelta] = []

    for item in normalized_updates:
        if item.delta > 0:
            if positive_count >= EMOTION_PROMOTION_LIMIT or positive_budget <= 0:
                continue
            applied = min(item.delta, positive_budget)
            if applied <= 0:
                continue
            output.append(EmotionDelta(emotion=item.emotion, delta=applied))
            positive_budget -= applied
            positive_count += 1
            continue

        if negative_count >= EMOTION_DEMOTION_LIMIT or negative_budget <= 0:
            continue
        current_value = state.get(item.emotion, 0)
        if current_value <= 0:
            continue
        max_drop = min(abs(item.delta), negative_budget, current_value)
        if max_drop <= 0:
            continue
        output.append(EmotionDelta(emotion=item.emotion, delta=-max_drop))
        negative_budget -= max_drop
        negative_count += 1

    return output


def apply_sparse_updates(current_state: Any, raw_updates: Any) -> dict[str, int]:
    state = normalize_emotional_state(current_state)
    for item in normalize_sparse_updates(state, raw_updates):
        state[item.emotion] = clamp_emotion_value(state.get(item.emotion, 0) + item.delta)
    return state


__all__ = [
    "EMOTION_DEMOTION_BUDGET",
    "EMOTION_DEMOTION_LIMIT",
    "EMOTION_GROUPS",
    "EMOTION_GROUP_MEMBERS",
    "EMOTION_GROUP_BY_EMOTION",
    "EMOTION_GROUP_ORDER_INDEX",
    "EMOTION_MAX_VALUE",
    "EMOTION_MIN_VALUE",
    "EMOTION_ORDER_INDEX",
    "EMOTION_PROMOTION_BUDGET",
    "EMOTION_PROMOTION_LIMIT",
    "EmotionDelta",
    "EmotionGroupSummary",
    "EmotionValue",
    "MANIFEST_LANES_BY_EMOTION_GROUP",
    "NEUTRAL_EMOTION",
    "OPPOSING_EMOTION_GROUPS",
    "SELECTABLE_EMOTION_SET",
    "TRACKED_EMOTIONS",
    "TRACKED_EMOTION_SET",
    "apply_sparse_updates",
    "clamp_emotion_value",
    "default_emotional_state",
    "emotion_group_for_emotion",
    "emotion_group_members",
    "emotion_value_level",
    "emotion_values_payload",
    "emotional_state_from_values",
    "format_emotion_group_label",
    "format_full_emotional_state",
    "manifest_lanes_for_emotion_group",
    "normalize_emotion_group_name",
    "normalize_emotion_name",
    "normalize_emotional_state",
    "normalize_sparse_updates",
    "ordered_emotion_group_summaries",
    "ordered_emotion_values",
    "primary_manifest_lane_for_emotion",
    "primary_manifest_lane_for_emotion_group",
    "sort_emotions",
    "summarize_emotion_groups",
    "summarize_emotional_state",
    "top_emotion_groups",
    "top_emotions",
]
