"""Distributions and per-turn summaries shared by the evaluation reports."""

from __future__ import annotations

import math
import statistics
from collections.abc import Iterable, Mapping, Sequence
from typing import Any

__all__ = [
    "TOKEN_STAT_KEYS",
    "distinct_gestures",
    "distribution",
    "latency_summary",
    "longest_run",
    "p90",
    "rate",
    "token_summary",
]


def rate(count: int, total: int) -> float | None:
    return count / total if total else None


def p90(values: Sequence[float]) -> float:
    """Nearest-rank 90th percentile: the smallest value at or above 90% of the sorted values."""

    ordered = sorted(values)
    return ordered[math.ceil(0.9 * len(ordered)) - 1]


def distribution(values: Sequence[float], digits: int = 4) -> dict[str, float | None]:
    if not values:
        return {"median": None, "p90": None, "mean": None}
    return {
        "median": round(statistics.median(values), digits),
        "p90": round(p90(values), digits),
        "mean": round(statistics.fmean(values), digits),
    }


TOKEN_STAT_KEYS = ("input_tokens", "cached_input_tokens", "cache_write_tokens", "output_tokens", "reasoning_tokens")


def token_summary(turns: Sequence[Mapping[str, Any]]) -> dict[str, Any]:
    """Per-turn token and estimated-cost statistics over successful turns whose every call reported usage.

    A turn's tokens sum all of its calls, a structured repair included.
    """

    reported = [turn for turn in turns if not turn["usage"]["unreported_calls"]]
    summary: dict[str, Any] = {"turns": len(reported), "unreported_turns": len(turns) - len(reported)}
    for key in TOKEN_STAT_KEYS:
        values = [turn["usage"][key] for turn in reported]
        summary[key] = {"total": sum(values), **distribution(values, digits=1)}
    costs = [turn["estimated_cost_usd"] for turn in reported if turn.get("estimated_cost_usd") is not None]
    summary["estimated_cost_usd"] = {"total": round(sum(costs), 8), **distribution(costs, digits=8)} if costs else None
    return summary


def latency_summary(turns: Sequence[Mapping[str, Any]]) -> dict[str, Any]:
    """Latency, first-token and first-speech statistics, in seconds, over successful turns."""

    first_tokens = [
        turn["call_latencies"][0]["first_text_seconds"]
        for turn in turns
        if turn["call_latencies"] and turn["call_latencies"][0]["first_text_seconds"] is not None
    ]
    first_outputs = [turn["first_output_seconds"] for turn in turns if turn["first_output_seconds"] is not None]
    return {
        "turns": len(turns),
        "latency_seconds": distribution([turn["latency_seconds"] for turn in turns]),
        "first_token_seconds": {"turns": len(first_tokens), **distribution(first_tokens)},
        "first_output_seconds": {"turns": len(first_outputs), **distribution(first_outputs)},
    }


def longest_run(gestures: Sequence[str | None]) -> tuple[int, str | None]:
    """Return the longest run of one Gesture on consecutive turns, and that Gesture (the first such run).

    A turn without a Gesture ends a run.
    """

    best, best_gesture, run, previous = 0, None, 0, None
    for gesture in gestures:
        if gesture is None:
            run, previous = 0, None
            continue
        run = run + 1 if gesture == previous else 1
        previous = gesture
        if run > best:
            best, best_gesture = run, gesture
    return best, best_gesture


def distinct_gestures(gestures: Iterable[str | None]) -> int:
    return len({gesture for gesture in gestures if gesture is not None})
