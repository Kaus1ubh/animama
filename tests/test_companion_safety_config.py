"""Operator/owner safety configuration resolution (spec R8)."""

from __future__ import annotations

from datetime import timedelta

import pytest

from animama.app.safety.config import (
    OperatorSafetyConfig,
    SafetyPreferences,
    resolve_companion_safety,
    safety_override_warnings,
)
from animama.server.config import Settings


def test_defaults_enable_notice_and_detection() -> None:
    effective = resolve_companion_safety(OperatorSafetyConfig(), SafetyPreferences())
    assert effective.ai_notice_enabled
    assert effective.crisis_detection_enabled
    assert effective.reminder_interval == timedelta(hours=3)
    assert safety_override_warnings(OperatorSafetyConfig()) == []


def test_global_switch_turns_everything_off() -> None:
    effective = resolve_companion_safety(OperatorSafetyConfig(enabled=False), SafetyPreferences(reminder_hours=1))
    assert not effective.ai_notice_enabled
    assert not effective.crisis_detection_enabled


def test_owner_can_shorten_but_not_lengthen_the_reminder_interval() -> None:
    operator = OperatorSafetyConfig()
    assert resolve_companion_safety(operator, SafetyPreferences(reminder_hours=1)).reminder_interval == timedelta(
        hours=1
    )
    assert resolve_companion_safety(operator, SafetyPreferences(reminder_hours=8)).reminder_interval == timedelta(
        hours=3
    )


def test_operator_may_relax_the_interval_and_is_warned() -> None:
    operator = OperatorSafetyConfig(reminder_interval=timedelta(hours=6))
    assert resolve_companion_safety(operator, SafetyPreferences()).reminder_interval == timedelta(hours=6)
    assert any("REMINDER_HOURS=6" in warning for warning in safety_override_warnings(operator))


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        (None, SafetyPreferences()),
        ({"safety": "nope"}, SafetyPreferences()),
        (
            {"safety": {"crisis_resource_region": " gb ", "reminder_hours": 2}},
            SafetyPreferences(crisis_resource_region="GB", reminder_hours=2.0),
        ),
        (
            {"safety": {"reminder_hours": -1, "crisis_resource_region": ""}},
            SafetyPreferences(),
        ),
        ({"safety": {"reminder_hours": True}}, SafetyPreferences()),
        ({"safety": {"reminder_hours": 1e20}}, SafetyPreferences()),
        ({"safety": {"reminder_hours": float("inf")}}, SafetyPreferences()),
        ({"safety": {"reminder_hours": 10**400}}, SafetyPreferences()),
        ({"safety": {"reminder_hours": 5e-324}}, SafetyPreferences()),
    ],
)
def test_preferences_are_read_tolerantly(raw: object, expected: SafetyPreferences) -> None:
    assert SafetyPreferences.from_preferences(raw) == expected  # type: ignore[arg-type]


def test_each_weakened_default_is_named_in_a_warning() -> None:
    warnings = safety_override_warnings(
        OperatorSafetyConfig(enabled=False, ai_notice_enabled=False, crisis_detection_enabled=False)
    )
    joined = "\n".join(warnings)
    for name in ("ANIMAMA_COMPANION_SAFETY_ENABLED", "ANIMAMA_AI_NOTICE_ENABLED", "ANIMAMA_CRISIS_DETECTION_ENABLED"):
        assert name in joined


@pytest.mark.parametrize("hours", [0, -1, 1e20, float("inf"), float("nan")])
def test_settings_reject_unusable_reminder_hours(hours: float) -> None:
    with pytest.raises(ValueError, match="ANIMAMA_AI_NOTICE_REMINDER_HOURS"):
        Settings(ai_notice_reminder_hours=hours)


def test_settings_expose_operator_config(monkeypatch: pytest.MonkeyPatch) -> None:
    configured = Settings(companion_safety_enabled=False, ai_notice_reminder_hours=1.5)
    assert configured.companion_safety == OperatorSafetyConfig(enabled=False, reminder_interval=timedelta(hours=1.5))


def test_huge_owner_interval_never_breaks_resolution() -> None:
    preferences = SafetyPreferences.from_preferences({"safety": {"reminder_hours": 1e20}})
    assert resolve_companion_safety(OperatorSafetyConfig(), preferences).reminder_interval == timedelta(hours=3)


def test_notice_disabled_by_operator_is_warned() -> None:
    effective = resolve_companion_safety(OperatorSafetyConfig(ai_notice_enabled=False), SafetyPreferences())
    assert not effective.ai_notice_enabled
    assert effective.crisis_detection_enabled
