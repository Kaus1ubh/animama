"""Per-turn companion safety for `chat:sse` (spec R2–R5).

Setup resolves the owner's effective safety configuration and crisis resources
before the prompt is built. The stream emits the AI notice before provider
output; a crisis card follows only when provider moderation flags self-harm,
as a `CRISIS_SUPPORT` domain event. No message text is logged or stored.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, date, datetime
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy.ext.asyncio import AsyncSession

from animama.adapters.repositories.sqlalchemy.companion_safety_repo import (
    SQLAlchemyCompanionSafetyRepository,
    ai_notice_state,
    apply_ai_notice_state,
)
from animama.app.safety.ai_notice import AiNoticeKind, decide_ai_notice
from animama.app.safety.config import EffectiveCompanionSafety, SafetyPreferences, resolve_companion_safety
from animama.app.safety.crisis_resources import CrisisResourceRegion, resolve_crisis_region
from animama.logging_config import get_logger
from animama.server.companion_safety import load_safety_preferences, runtime_crisis_resources
from animama.server.config import Settings
from animama.server.schemas.chat import PyChatClientContext
from animama.server.sse_events import SseTextState, format_ai_notice_event

from .session_services import with_short_lived_session

_log = get_logger("server.routers.chat.safety")


@dataclass(frozen=True, slots=True)
class TurnSafety:
    """Route-owned safety state for one turn; carries no message text."""

    effective: EffectiveCompanionSafety
    crisis_region: CrisisResourceRegion
    time_zone: ZoneInfo | None

    @property
    def provider_moderation(self) -> bool:
        return self.effective.crisis_detection_enabled

    def local_date(self, now: datetime) -> date:
        return now.astimezone(self.time_zone or UTC).date()


def _time_zone(client_context: PyChatClientContext | None) -> ZoneInfo | None:
    name = client_context.time_zone if client_context is not None else None
    if not name:
        return None
    try:
        return ZoneInfo(name)
    except (ZoneInfoNotFoundError, ValueError):
        return None


async def prepare_turn_safety(
    *,
    session: AsyncSession,
    user_id: str,
    client_context: PyChatClientContext | None,
    runtime_settings: Settings,
) -> TurnSafety:
    """Resolve safety configuration and crisis resources before prompt assembly."""

    try:
        preferences = await load_safety_preferences(session, user_id)
    except Exception as exc:
        # Owner preferences only choose resources or shorten reminders; defaults are safe.
        _log.warning("Safety preferences unavailable; using defaults", error_type=type(exc).__name__)
        preferences = SafetyPreferences()
    effective = resolve_companion_safety(runtime_settings.companion_safety, preferences)
    region = resolve_crisis_region(
        runtime_crisis_resources(runtime_settings),
        preferred_region=preferences.crisis_resource_region,
        locale=client_context.locale if client_context is not None else None,
    )
    return TurnSafety(effective=effective, crisis_region=region, time_zone=_time_zone(client_context))


def attach_crisis_resources(safety: TurnSafety, state: SseTextState) -> None:
    """Let crisis frames for this turn carry its resolved resources."""

    if safety.effective.crisis_detection_enabled:
        state.crisis_resources = safety.crisis_region.model_dump(mode="json")


async def ai_notice_frame(
    safety: TurnSafety,
    *,
    session_factory: Any,
    user_id: str,
    run_id: str,
    anima_name: str | None,
) -> str | None:
    """Decide and record the AI notice for this turn; show it when state is unavailable."""

    if not safety.effective.ai_notice_enabled:
        return None

    async def _decide(session: Any) -> AiNoticeKind | None:
        row = await SQLAlchemyCompanionSafetyRepository(session).lock(user_id)
        # Take the time after the lock so concurrent turns order consistently.
        now = datetime.now(UTC)
        kind, next_state = decide_ai_notice(
            ai_notice_state(row),
            now=now,
            local_date=safety.local_date(now),
            reminder_interval=safety.effective.reminder_interval,
        )
        apply_ai_notice_state(row, next_state)
        await session.commit()
        return kind

    kind: AiNoticeKind | None
    try:
        kind = await with_short_lived_session(session_factory, _decide)
    except Exception as exc:
        # Better shown too often than missed (spec R2).
        _log.warning("AI notice state unavailable; showing notice", run_id=run_id, error_type=type(exc).__name__)
        kind = "start"
    if kind is None:
        return None
    return format_ai_notice_event(run_id=run_id, kind=kind, anima_name=anima_name)


__all__ = ["TurnSafety", "ai_notice_frame", "attach_crisis_resources", "prepare_turn_safety"]
