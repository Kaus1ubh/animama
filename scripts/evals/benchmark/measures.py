"""Deterministic measures of benchmark turns (spec R4): recovery, distributions and per-configuration summaries.

Judged measures come later from the judge; everything here is computed from
the recorded turns alone, so a report can be rebuilt without model calls.
"""

from __future__ import annotations

from collections import Counter
from collections.abc import Hashable, Iterable, Mapping, Sequence
from typing import Any

from animama.app.main_structured_response import parse_main_structured_response

from ..core.pricing import sum_usage_json
from ..core.stats import latency_summary, longest_run, rate, token_summary
from ..core.turns import TurnOutcome

__all__ = [
    "RECOVERY_PATHS",
    "STYLE_VIOLATIONS",
    "recovery_path",
    "summarize_configuration",
    "value_distribution",
]

RECOVERY_PATHS = ("strict", "lenient", "repaired", "salvaged", "plain_text")
STYLE_VIOLATIONS = ("url", "email", "path", "code", "markdown", "list", "table", "emoji")
_TOP = 3


def recovery_path(outcome: TurnOutcome) -> str | None:
    """Which of chat's recovery paths produced the reply, or ``None`` for a failed turn.

    Chat records ``repaired``, ``salvaged`` and ``plain_text``; a reply it took
    as it came is ``strict`` when the final text parses strictly and
    ``lenient`` when only chat's local recovery accepted it.
    """

    if outcome.error is not None or outcome.reply is None:
        return None
    if outcome.recovery is not None:
        return outcome.recovery
    finals = [call.final_text for call in outcome.calls if call.final_text is not None]
    try:
        parse_main_structured_response(finals[-1], outcome.prepared.output_type)
    except ValueError:
        return "lenient"
    return "strict"


def value_distribution(values: Sequence[Hashable | None]) -> dict[str, Any]:
    """How often each value occurs: the null rate, distinct values and the share of the top three."""

    counts = Counter(values)
    total = len(values)
    present = [(value, count) for value, count in counts.most_common() if value is not None]
    return {
        "n": total,
        "null_rate": rate(counts[None], total),
        "distinct": len(present),
        "top": [[value, count] for value, count in present[:_TOP]],
        "top_share": rate(sum(count for _, count in present[:_TOP]), total),
        "counts": {str(value): count for value, count in sorted(present, key=lambda pair: str(pair[0]))},
    }


def _chat_runs(turns: Sequence[Mapping[str, Any]]) -> list[dict[str, Any]]:
    """Per scripted chat: distinct values and the longest run of one value on consecutive turns."""

    chats: dict[tuple[str, int], list[Mapping[str, Any]]] = {}
    for turn in turns:
        if turn["kind"] == "chat":
            chats.setdefault((turn["unit_id"], turn["repeat"]), []).append(turn)
    rows: list[dict[str, Any]] = []
    for (chat_id, repeat), chat_turns in sorted(chats.items()):
        ordered = sorted(chat_turns, key=lambda turn: turn["turn"])
        row: dict[str, Any] = {"chat": chat_id, "repeat": repeat, "turns": len(ordered)}
        for key in ("gesture", "emotional_tone", "emotional_intensity"):
            # A failed turn has no value, so it also ends a run.
            values = [None if turn["error"] is not None or turn[key] is None else str(turn[key]) for turn in ordered]
            run_length, run_value = longest_run(values)
            row[key] = {"distinct": len({value for value in values if value is not None}), "longest_run": run_length}
            row[key]["longest_run_value"] = run_value
        rows.append(row)
    return rows


def _speech_summary(turns: Sequence[Mapping[str, Any]]) -> dict[str, Any]:
    checks = [turn["speech_check"] for turn in turns if turn["speech_check"] is not None]
    replies = len(checks)
    with_tags = sum(1 for check in checks if check["tags"])
    styles = Counter(name for check in checks for name in check["style_violations"])
    return {
        "replies": replies,
        "with_tags": with_tags,
        "with_tags_rate": rate(with_tags, replies),
        "tags": sum(len(check["tags"]) for check in checks),
        "sounds": sum(check["sounds"] for check in checks),
        "over_sound_cap": sum(1 for check in checks if check["over_sound_cap"]),
        "angle_or_non_english_tags": sum(check["angle_or_non_english_tags"] for check in checks),
        "display_tags": sum(check["display_tags"] for check in checks),
        "tags_only_speech": sum(1 for check in checks if check["tags_only_speech"]),
        "accent_requests": sum(check["accent_requests"] for check in checks),
        "tag_kinds": dict(sorted(Counter(tag.lower() for check in checks for tag in check["tags"]).items())),
        "style_violations": {name: styles.get(name, 0) for name in STYLE_VIOLATIONS},
    }


def summarize_configuration(turns: Iterable[Mapping[str, Any]]) -> dict[str, Any]:
    """Deterministic measures over one configuration's recorded turns, warm-ups excluded."""

    measured = [turn for turn in turns if turn["kind"] != "warmup"]
    ok = [turn for turn in measured if turn["error"] is None]
    single = [turn for turn in ok if turn["kind"] == "single"]
    chats = [turn for turn in ok if turn["kind"] == "chat"]
    fits = sum(1 for turn in single if turn["fit"])
    recovery = Counter(turn["recovery"] for turn in ok)
    return {
        "turns": len(measured),
        "errors": len(measured) - len(ok),
        "error_codes": dict(sorted(Counter(turn["error"] for turn in measured if turn["error"]).items())),
        "single_turn": {
            "scored": len(single),
            "fits": fits,
            "fit_rate": rate(fits, len(single)),
            "null_rate": rate(sum(1 for turn in single if turn["gesture"] is None), len(single)),
        },
        "distributions": {
            "gesture": value_distribution([turn["gesture"] for turn in ok]),
            "emotional_tone": value_distribution([turn["emotional_tone"] for turn in ok]),
            "emotional_intensity": value_distribution([turn["emotional_intensity"] for turn in ok]),
        },
        "chats": _chat_runs(measured),
        "speech": _speech_summary(ok),
        "recovery": {path: recovery.get(path, 0) for path in RECOVERY_PATHS},
        "dropped_gestures": sum(1 for turn in ok if turn["gesture_mismatch"]),
        "latency": {"single_turn": latency_summary(single), "chat": latency_summary(chats)},
        "tokens": {"single_turn": token_summary(single), "chat": token_summary(chats)},
        "calls": sum(turn["calls"] for turn in measured),
        "usage": sum_usage_json(turn["usage"] for turn in measured),
        "estimated_cost_usd": round(sum(turn["estimated_cost_usd"] or 0.0 for turn in measured), 8),
    }
