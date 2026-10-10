"""Resolved per-turn safety context, independent of local HTTP/settings."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, date, datetime
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from .config import EffectiveCompanionSafety
from .crisis_resources import CrisisResourceRegion


@dataclass(frozen=True, slots=True)
class TurnSafety:
    """Content-free safety policy and resources selected before prompt assembly."""

    effective: EffectiveCompanionSafety
    crisis_region: CrisisResourceRegion
    time_zone: ZoneInfo | None

    @property
    def provider_moderation(self) -> bool:
        return self.effective.crisis_detection_enabled

    def local_date(self, now: datetime) -> date:
        return now.astimezone(self.time_zone or UTC).date()


def resolve_turn_time_zone(name: str | None) -> ZoneInfo | None:
    """Untrusted browser timezone hints cannot change the safety policy."""
    if not name:
        return None
    try:
        return ZoneInfo(name)
    except (ZoneInfoNotFoundError, ValueError):
        return None
