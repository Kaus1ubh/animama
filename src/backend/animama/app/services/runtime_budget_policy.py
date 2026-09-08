"""Whole-Anima runtime budget policy shared by planning and issuance."""

from __future__ import annotations

from dataclasses import dataclass

MAX_RUNTIME_ENTRIES = 500
MAX_RUNTIME_BYTES = 512 * 1024 * 1024
MAX_RUNTIME_AUDIO_SECONDS = 300.0
MAX_RUNTIME_CONFIG_BYTES = 512 * 1024


@dataclass(frozen=True, slots=True)
class RuntimeBudgetUsage:
    """Deduplicated resource totals for one complete candidate snapshot."""

    entries: int
    bytes: int
    audio_seconds: float
    config_bytes: int


def runtime_budget_violation(usage: RuntimeBudgetUsage) -> str | None:
    """Return the first stable domain diagnostic for an oversized snapshot."""

    if usage.entries > MAX_RUNTIME_ENTRIES:
        return "runtime_entry_budget"
    if usage.bytes > MAX_RUNTIME_BYTES:
        return "runtime_byte_budget"
    if usage.audio_seconds > MAX_RUNTIME_AUDIO_SECONDS:
        return "runtime_audio_budget"
    if usage.config_bytes > MAX_RUNTIME_CONFIG_BYTES:
        return "runtime_config_budget"
    return None


__all__ = [
    "MAX_RUNTIME_AUDIO_SECONDS",
    "MAX_RUNTIME_BYTES",
    "MAX_RUNTIME_CONFIG_BYTES",
    "MAX_RUNTIME_ENTRIES",
    "RuntimeBudgetUsage",
    "runtime_budget_violation",
]
