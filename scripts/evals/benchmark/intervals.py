"""The benchmark's statistics (spec R16, plan D9), in pure Python with a fixed seed.

Bootstrap intervals resample whole groups: a single-turn item with its
repeats and personas, or one conversation with all its turns, since values
inside a group are not independent. Two results are "not distinguishable"
when their 95% intervals overlap, or when either rests on fewer than
``MIN_GROUPS`` groups, and a report never ranks them. Judge-to-owner
agreement is quadratic-weighted kappa on the 1-5 scale, with exact and
within-one agreement.
"""

from __future__ import annotations

import random
import statistics
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any

__all__ = [
    "MIN_GROUPS",
    "RESAMPLES",
    "SEED",
    "Agreement",
    "Interval",
    "agreement",
    "agreement_table",
    "bootstrap_mean",
    "bootstrap_paired",
    "comparable",
    "distinguishable",
]

RESAMPLES = 2000
SEED = 470
MIN_GROUPS = 5
"""Fewer resampled groups than this give no verdict: a percentile interval over two or three groups is just
their range, which would rank results on almost no evidence."""
_LEVEL = 0.95


@dataclass(frozen=True, slots=True)
class Interval:
    """A mean with its 95% bootstrap interval over ``n`` values in ``groups`` resampled units."""

    mean: float
    low: float
    high: float
    n: int
    groups: int


def _percentile(ordered: Sequence[float], share: float) -> float:
    """Nearest-rank percentile of already sorted values."""

    index = min(len(ordered) - 1, max(0, round(share * (len(ordered) - 1))))
    return ordered[index]


def _interval(values: Sequence[float], resampled: list[float], groups: int) -> Interval:
    resampled.sort()
    tail = (1 - _LEVEL) / 2
    return Interval(
        mean=statistics.fmean(values),
        low=_percentile(resampled, tail),
        high=_percentile(resampled, 1 - tail),
        n=len(values),
        groups=groups,
    )


def bootstrap_mean(
    groups: Sequence[Sequence[float]], *, seed: int = SEED, resamples: int = RESAMPLES
) -> Interval | None:
    """The mean of every value, with a 95% interval from resampling whole groups; ``None`` without values.

    A group holds related values (one item's repeats and personas, or one conversation's turns), so they move
    together.
    """

    kept = [list(group) for group in groups if group]
    if not kept:
        return None
    rng = random.Random(seed)
    resampled = []
    for _ in range(resamples):
        drawn = [value for _ in kept for value in kept[rng.randrange(len(kept))]]
        resampled.append(statistics.fmean(drawn))
    return _interval([value for group in kept for value in group], resampled, len(kept))


def bootstrap_paired(
    pairs: Sequence[tuple[float, float]], *, seed: int = SEED, resamples: int = RESAMPLES
) -> Interval | None:
    """The mean difference ``second - first`` over pairs, with a 95% interval from resampling pairs."""

    differences = [second - first for first, second in pairs]
    if not differences:
        return None
    rng = random.Random(seed)
    resampled = [
        statistics.fmean(differences[rng.randrange(len(differences))] for _ in differences) for _ in range(resamples)
    ]
    return _interval(differences, resampled, len(differences))


def comparable(interval: Interval | None) -> bool:
    """Whether an interval rests on enough groups for a verdict."""

    return interval is not None and interval.groups >= MIN_GROUPS


def distinguishable(first: Interval | None, second: Interval | None) -> bool:
    """Whether two intervals are apart; overlapping, missing or too-small intervals are not distinguishable."""

    if first is None or second is None or not comparable(first) or not comparable(second):
        return False
    return first.high < second.low or second.high < first.low


@dataclass(frozen=True, slots=True)
class Agreement:
    """How a judge's 1-5 scores agree with the owner's on the same items."""

    n: int
    kappa: float | None
    """Quadratic-weighted kappa; ``None`` when the owner's and judge's scores give no expected disagreement."""
    exact: float
    within_one: float


def agreement(pairs: Sequence[tuple[int, int]], *, categories: int = 5) -> Agreement | None:
    """Quadratic-weighted kappa, exact and within-one agreement of ``(owner, judge)`` scores on 1..``categories``."""

    if not pairs:
        return None
    n = len(pairs)
    observed = [[0.0] * categories for _ in range(categories)]
    for owner, judge in pairs:
        observed[owner - 1][judge - 1] += 1
    owner_totals = [sum(row) for row in observed]
    judge_totals = [sum(observed[i][j] for i in range(categories)) for j in range(categories)]
    disagreement = expected = 0.0
    for i in range(categories):
        for j in range(categories):
            weight = (i - j) ** 2 / (categories - 1) ** 2
            disagreement += weight * observed[i][j]
            expected += weight * owner_totals[i] * judge_totals[j] / n
    kappa = 1 - disagreement / expected if expected else None
    return Agreement(
        n=n,
        kappa=kappa,
        exact=sum(1 for owner, judge in pairs if owner == judge) / n,
        within_one=sum(1 for owner, judge in pairs if abs(owner - judge) <= 1) / n,
    )


def agreement_table(pairs: Mapping[str, Sequence[tuple[int, int]]]) -> dict[str, dict[str, Any]]:
    """Agreement per measure from ``(owner, judge)`` score pairs, as calibration records it."""

    table: dict[str, dict[str, Any]] = {}
    for measure, values in sorted(pairs.items()):
        result = agreement(values)
        if result is not None:
            table[measure] = {
                "n": result.n,
                "kappa": result.kappa,
                "exact": result.exact,
                "within_one": result.within_one,
            }
    return table
