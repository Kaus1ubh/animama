"""Per-turn companion safety for `chat:sse` (spec R2–R5).

Setup resolves the owner's effective safety configuration and crisis resources
before the prompt is built. The stream emits the AI notice before provider
output; a crisis card follows only when provider moderation flags self-harm,
as a `CRISIS_SUPPORT` domain event. No message text is logged or stored.
"""

from __future__ import annotations

from datetime import UTC, datetime
from zoneinfo import ZoneInfo

from animama.app.contracts.chat import PyChatClientContext
from animama.app.safety.ai_notice import AiNoticeKind, decide_ai_notice
from animama.app.safety.config import (
    OperatorSafetyConfig,
    SafetyPreferences,
    load_safety_preferences,
    resolve_companion_safety,
)
from animama.app.safety.crisis_resources import CrisisResourceTable, resolve_crisis_region
from animama.app.safety.turn import TurnSafety, resolve_turn_time_zone
from animama.logging import get_logger
from animama.product_http.ports import ProductRepositories

from .setup_helpers import TurnSessions, with_short_lived_session
from .sse_events import SseTextState, format_ai_notice_event

_log = get_logger("product_http.chat.safety")


def _time_zone(client_context: PyChatClientContext | None) -> ZoneInfo | None:
    return resolve_turn_time_zone(client_context.time_zone if client_context is not None else None)


async def prepare_turn_safety(
    *,
    repositories: ProductRepositories,
    user_id: str,
    client_context: PyChatClientContext | None,
    operator: OperatorSafetyConfig,
    crisis_resources: CrisisResourceTable,
) -> TurnSafety:
    """Resolve safety configuration and crisis resources before prompt assembly."""

    try:
        preferences = await load_safety_preferences(repositories.user_settings, user_id)
    except Exception as exc:
        # Owner preferences only choose resources or shorten reminders; defaults are safe.
        _log.warning("Safety preferences unavailable; using defaults", error_type=type(exc).__name__)
        preferences = SafetyPreferences()
    effective = resolve_companion_safety(operator, preferences)
    region = resolve_crisis_region(
        crisis_resources,
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
    sessions: TurnSessions,
    user_id: str,
    run_id: str,
    anima_name: str | None,
) -> str | None:
    """Decide and record the AI notice for this turn; show it when state is unavailable."""

    if not safety.effective.ai_notice_enabled:
        return None

    async def _decide(repositories: ProductRepositories) -> AiNoticeKind | None:
        state = await repositories.companion_safety.lock_ai_notice_state(user_id)
        # Take the time after the lock so concurrent turns order consistently.
        now = datetime.now(UTC)
        kind, next_state = decide_ai_notice(
            state,
            now=now,
            local_date=safety.local_date(now),
            reminder_interval=safety.effective.reminder_interval,
        )
        await repositories.companion_safety.save_ai_notice_state(user_id, next_state)
        await repositories.unit_of_work.commit()
        return kind

    kind: AiNoticeKind | None
    try:
        kind = await with_short_lived_session(sessions, _decide)
    except Exception as exc:
        # Better shown too often than missed (spec R2).
        _log.warning("AI notice state unavailable; showing notice", run_id=run_id, error_type=type(exc).__name__)
        kind = "start"
    if kind is None:
        return None
    return format_ai_notice_event(run_id=run_id, kind=kind, anima_name=anima_name)


__all__ = ["TurnSafety", "ai_notice_frame", "attach_crisis_resources", "prepare_turn_safety"]
