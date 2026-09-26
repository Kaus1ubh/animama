"""Effective companion-safety configuration (spec R8).

Operators configure safety through environment settings; the global switch
``ANIMAMA_COMPANION_SAFETY_ENABLED`` turns the AI notice, crisis detection
(including provider moderation) and the crisis card off together. Owners may
only choose resources and shorten the reminder interval. Nothing here affects the
Companion Guardrails, which are always present.
"""

from __future__ import annotations

import math
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import timedelta
from pathlib import Path
from typing import Any

from .ai_notice import DEFAULT_REMINDER_INTERVAL

SAFETY_PREFERENCES_KEY = "safety"
MIN_REMINDER_HOURS = 0.25
MAX_REMINDER_HOURS = 168.0
"""Bounds for any configured reminder interval (15 minutes to one week)."""


def valid_reminder_hours(value: object) -> float | None:
    """Return ``value`` as hours when it is a number within the reminder bounds."""

    if isinstance(value, bool) or not isinstance(value, int | float):
        return None
    try:
        hours = float(value)
    except OverflowError:
        return None
    return hours if math.isfinite(hours) and MIN_REMINDER_HOURS <= hours <= MAX_REMINDER_HOURS else None


@dataclass(frozen=True, slots=True)
class OperatorSafetyConfig:
    """Operator (environment) configuration; defaults are the safe values."""

    enabled: bool = True
    ai_notice_enabled: bool = True
    reminder_interval: timedelta = DEFAULT_REMINDER_INTERVAL
    crisis_detection_enabled: bool = True
    crisis_resources_path: Path | None = None

    @property
    def effective_ai_notice_enabled(self) -> bool:
        return self.enabled and self.ai_notice_enabled

    @property
    def effective_crisis_detection_enabled(self) -> bool:
        return self.enabled and self.crisis_detection_enabled


@dataclass(frozen=True, slots=True)
class SafetyPreferences:
    """Owner choices stored under ``user_settings.preferences.safety``."""

    crisis_resource_region: str | None = None
    reminder_hours: float | None = None

    @classmethod
    def from_preferences(cls, preferences: Mapping[str, Any] | None) -> SafetyPreferences:
        """Read tolerantly: malformed values fall back to defaults."""

        raw = preferences.get(SAFETY_PREFERENCES_KEY) if isinstance(preferences, Mapping) else None
        if not isinstance(raw, Mapping):
            return cls()
        region = raw.get("crisis_resource_region")
        hours = raw.get("reminder_hours")
        return cls(
            crisis_resource_region=region.strip().upper() if isinstance(region, str) and region.strip() else None,
            reminder_hours=valid_reminder_hours(hours),
        )


@dataclass(frozen=True, slots=True)
class EffectiveCompanionSafety:
    ai_notice_enabled: bool
    reminder_interval: timedelta
    crisis_detection_enabled: bool
    crisis_resource_region: str | None


def resolve_companion_safety(
    operator: OperatorSafetyConfig, preferences: SafetyPreferences
) -> EffectiveCompanionSafety:
    """Combine operator configuration with owner preferences.

    Owner preferences can only add protection: a reminder interval longer than
    the operator's is ignored.
    """

    reminder_interval = operator.reminder_interval
    if preferences.reminder_hours is not None:
        reminder_interval = min(reminder_interval, timedelta(hours=preferences.reminder_hours))
    return EffectiveCompanionSafety(
        ai_notice_enabled=operator.effective_ai_notice_enabled,
        reminder_interval=reminder_interval,
        crisis_detection_enabled=operator.effective_crisis_detection_enabled,
        crisis_resource_region=preferences.crisis_resource_region,
    )


def safety_override_warnings(operator: OperatorSafetyConfig) -> list[str]:
    """Describe each operator setting that weakens a default (no secrets)."""

    warnings: list[str] = []
    if not operator.enabled:
        warnings.append("ANIMAMA_COMPANION_SAFETY_ENABLED=false: AI notice and crisis detection are off")
    if not operator.ai_notice_enabled:
        warnings.append("ANIMAMA_AI_NOTICE_ENABLED=false: the AI notice is off")
    if operator.reminder_interval > DEFAULT_REMINDER_INTERVAL:
        hours = operator.reminder_interval.total_seconds() / 3600
        warnings.append(
            f"ANIMAMA_AI_NOTICE_REMINDER_HOURS={hours:g}: AI reminders are less frequent than every 3 hours"
        )
    if not operator.crisis_detection_enabled:
        warnings.append("ANIMAMA_CRISIS_DETECTION_ENABLED=false: moderation and the crisis card are off")
    if operator.crisis_resources_path is not None:
        warnings.append("ANIMAMA_CRISIS_RESOURCES_PATH is set: using an operator-supplied crisis resource table")
    return warnings


__all__ = [
    "SAFETY_PREFERENCES_KEY",
    "EffectiveCompanionSafety",
    "OperatorSafetyConfig",
    "SafetyPreferences",
    "resolve_companion_safety",
    "safety_override_warnings",
]
