"""AI-notice cadence (spec R2).

A *start* notice is due on the first turn of each local calendar day. A
*continuing interaction* is a run of turns that each start less than 30 minutes
after the previous one; a *reminder* is due once the reminder interval (3 hours
by default) has passed since the later of the interaction's start and the last
notice. Notice state is kept per installation, across all Animas.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Literal

AiNoticeKind = Literal["start", "reminder"]

CONTINUING_INTERACTION_GAP = timedelta(minutes=30)
DEFAULT_REMINDER_INTERVAL = timedelta(hours=3)


@dataclass(frozen=True, slots=True)
class AiNoticeState:
    last_notice_at: datetime | None = None
    last_notice_local_date: date | None = None
    interaction_started_at: datetime | None = None
    last_turn_started_at: datetime | None = None


def decide_ai_notice(
    state: AiNoticeState,
    *,
    now: datetime,
    local_date: date,
    reminder_interval: timedelta = DEFAULT_REMINDER_INTERVAL,
) -> tuple[AiNoticeKind | None, AiNoticeState]:
    """Return the notice due for a turn starting at ``now`` and the next state."""

    continuing = (
        state.last_turn_started_at is not None
        and state.interaction_started_at is not None
        and timedelta(0) <= now - state.last_turn_started_at < CONTINUING_INTERACTION_GAP
    )
    interaction_started_at = state.interaction_started_at if continuing else now
    assert interaction_started_at is not None

    kind: AiNoticeKind | None = None
    if state.last_notice_local_date != local_date:
        kind = "start"
    else:
        reference = max(interaction_started_at, state.last_notice_at or interaction_started_at)
        if now - reference >= reminder_interval:
            kind = "reminder"

    return kind, AiNoticeState(
        last_notice_at=now if kind else state.last_notice_at,
        last_notice_local_date=local_date if kind else state.last_notice_local_date,
        interaction_started_at=interaction_started_at,
        last_turn_started_at=now,
    )


__all__ = [
    "CONTINUING_INTERACTION_GAP",
    "DEFAULT_REMINDER_INTERVAL",
    "AiNoticeKind",
    "AiNoticeState",
    "decide_ai_notice",
]
