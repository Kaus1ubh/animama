from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Final, Literal, cast, get_args
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

# The zone used when an owner has no valid time zone preference.
DEFAULT_TIME_ZONE_NAME = "UTC"

# The UI Locale: the language and formatting of interface text. It never selects
# the Conversation language an Anima speaks or the crisis-resource region. ``None``
# means "System default", resolved by the client from the OS or browser.
UiLocale = Literal["en", "ja", "ko", "zh-Hans", "zh-Hant"]
UI_LOCALES: Final[frozenset[str]] = frozenset(get_args(UiLocale))


@dataclass(slots=True)
class UserSettings:
    user_id: str
    theme: str = "anima"
    locale: UiLocale | None = None
    last_active_anima_id: str | None = None
    preferences: dict[str, Any] = field(default_factory=dict)
    created_at: datetime | None = None
    updated_at: datetime | None = None


@dataclass(slots=True)
class AnimaSettings:
    user_id: str
    anima_id: str
    theme: dict[str, Any] | None = None
    background: str | None = None
    favorited: bool = False
    preferences: dict[str, Any] = field(default_factory=dict)
    created_at: datetime | None = None
    updated_at: datetime | None = None


def ui_locale_or_none(value: object) -> UiLocale | None:
    """Return a supported UI Locale tag, or ``None`` for unset or unsupported values.

    Stored rows from before the UI Locale contract may hold tags such as
    ``en-US``; reading them as "System default" keeps old settings loadable.
    """

    return cast(UiLocale, value) if isinstance(value, str) and value in UI_LOCALES else None


def time_zone_or_utc(name: object) -> tuple[ZoneInfo, str]:
    """Resolve an IANA time zone name, or UTC when it is blank, unknown or malformed.

    Returns the zone with its trimmed name, so callers can convert times and
    record the zone they used.
    """

    if isinstance(name, str) and (clean := name.strip()):
        try:
            return ZoneInfo(clean), clean
        except (ZoneInfoNotFoundError, ValueError):
            # ValueError covers malformed keys such as absolute or ``..`` paths.
            pass
    return ZoneInfo(DEFAULT_TIME_ZONE_NAME), DEFAULT_TIME_ZONE_NAME


def preferred_time_zone(preferences: object) -> tuple[ZoneInfo, str]:
    """Resolve the owner's ``UserSettings.preferences["timezone"]`` like ``time_zone_or_utc``."""

    return time_zone_or_utc(preferences.get("timezone") if isinstance(preferences, Mapping) else None)


__all__ = [
    "DEFAULT_TIME_ZONE_NAME",
    "UI_LOCALES",
    "AnimaSettings",
    "UiLocale",
    "UserSettings",
    "preferred_time_zone",
    "time_zone_or_utc",
    "ui_locale_or_none",
]
