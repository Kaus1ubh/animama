"""Retrying the units of a run that failed on connection errors.

A dropped connection says nothing about a model, so the owner can run those
units again rather than count them as failed turns. A retry is a new run
(``run --retry-from``): it copies the earlier run's records except every record
of a retried unit, runs those units again under what is left of the same
caps, and records what it replaced in its manifest. The earlier run is never
changed.

A unit is what has to run again as a whole, because its turns depend on each
other: one single-turn item for one persona and repeat, a whole scripted chat,
a memory chat in one arm with its capture and recall chat, or one Memory
Manager run. Any other error is the configuration's own failure and stays
counted.
"""

from __future__ import annotations

import re
from collections import Counter
from collections.abc import Callable, Iterable, Mapping
from dataclasses import dataclass
from typing import Any

__all__ = [
    "CONNECTION_ERROR",
    "COUNTED_TURNS",
    "RetryPlan",
    "Selection",
    "core_key",
    "manager_key",
    "memory_key",
    "plan_retry",
    "record_unit",
]

CONNECTION_ERROR = re.compile(r"(?:_connection_error|ConnectionError)$")
"""Chat's provider error codes (``openai_connection_error``) and, for Memory Manager runs, the SDK's exception name."""

COUNTED_TURNS = frozenset({"warmup", "single", "chat", "memory", "recall"})
"""The record kinds a manifest's ``turns_recorded`` counts: chat turns, not captures or Memory Manager runs."""

Selection = Callable[[str, str], bool]
"""Whether to run a unit: called with the configuration as the unit's records name it, and the unit's key."""


def core_key(kind: str, unit_id: str, persona: str, repeat: int) -> str:
    """A single-turn item for one persona and repeat, or a whole scripted chat."""

    return f"{kind}/{unit_id}/{persona}/r{repeat}"


def memory_key(arm: str, chat_id: str) -> str:
    """A memory chat in one arm, with its capture and recall chat."""

    return f"memory/{arm}/{chat_id}"


def manager_key(run_id: str) -> str:
    """One Memory Manager run; its records name the catalog row, not a configuration."""

    return f"memory_manager/{run_id}"


def record_unit(record: Mapping[str, Any]) -> tuple[str, str]:
    """The configuration and unit key a recorded turn belongs to."""

    kind = record["kind"]
    if kind in {"memory", "recall", "capture"}:
        key = memory_key(record["arm"], record["unit_id"])
    elif kind == "memory_manager":
        key = manager_key(record["unit_id"])
    else:
        key = core_key(kind, record["unit_id"], record["persona"], record["repeat"])
    return record["configuration"], key


@dataclass(frozen=True, slots=True)
class RetryPlan:
    """The units to run again, and the earlier run's records to copy unchanged."""

    units: frozenset[tuple[str, str]]
    kept: list[dict[str, Any]]
    replaced: int
    """Records of the retried units, all left out of the copy."""
    error_codes: dict[str, int]
    """The connection errors that selected the units, by code."""

    def selects(self, configuration: str, key: str) -> bool:
        return (configuration, key) in self.units


def plan_retry(records: Iterable[Mapping[str, Any]]) -> RetryPlan:
    """Select every unit with a connection error; warm-ups are discarded anyway, so they are never retried."""

    copies = [dict(record) for record in records]
    failed = [
        record
        for record in copies
        if record["kind"] != "warmup" and record.get("error") and CONNECTION_ERROR.search(str(record["error"]))
    ]
    units = frozenset(record_unit(record) for record in failed)
    kept = [record for record in copies if record_unit(record) not in units]
    return RetryPlan(
        units=units,
        kept=kept,
        replaced=len(copies) - len(kept),
        error_codes=dict(sorted(Counter(str(record["error"]) for record in failed).items())),
    )
