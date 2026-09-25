"""AI-notice cadence decisions with a controlled clock (spec R2)."""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta

from animama.app.safety.ai_notice import AiNoticeState, decide_ai_notice

THREE_HOURS = timedelta(hours=3)
T0 = datetime(2026, 9, 25, 9, 0, tzinfo=UTC)
DAY = date(2026, 9, 25)


def _turn(state: AiNoticeState, minutes: float, *, local_date: date = DAY, interval: timedelta = THREE_HOURS):
    return decide_ai_notice(
        state, now=T0 + timedelta(minutes=minutes), local_date=local_date, reminder_interval=interval
    )


def test_first_turn_of_the_day_gets_a_start_notice() -> None:
    kind, state = _turn(AiNoticeState(), 0)
    assert kind == "start"
    assert state.last_notice_at == T0
    assert state.last_notice_local_date == DAY
    assert state.interaction_started_at == T0
    assert state.last_turn_started_at == T0


def test_repeat_turns_the_same_day_get_no_notice() -> None:
    _, state = _turn(AiNoticeState(), 0)
    for minutes in (5, 20, 45, 70):
        kind, state = _turn(state, minutes)
        assert kind is None


def test_reminder_after_three_hours_of_continuing_interaction() -> None:
    _, state = _turn(AiNoticeState(), 0)
    for minutes in range(20, 180, 20):  # turns every 20 minutes up to 2h40
        kind, state = _turn(state, minutes)
        assert kind is None
    kind, state = _turn(state, 180)
    assert kind == "reminder"
    # The reminder resets the clock.
    kind, _ = _turn(state, 200)
    assert kind is None


def test_gap_of_thirty_minutes_starts_a_new_interaction_without_a_start_notice() -> None:
    _, state = _turn(AiNoticeState(), 0)
    _, state = _turn(state, 10)
    kind, state = _turn(state, 40)  # 30-minute gap
    assert kind is None
    assert state.interaction_started_at == T0 + timedelta(minutes=40)
    # The new interaction's 3-hour clock starts at its first turn, not the old notice.
    minutes = 40
    while minutes < 40 + 170:
        minutes += 25
        kind, state = _turn(state, minutes)
        assert kind is None
    kind, _ = _turn(state, 40 + 185)
    assert kind == "reminder"


def test_gap_just_under_thirty_minutes_continues_the_interaction() -> None:
    _, state = _turn(AiNoticeState(), 0)
    kind, state = _turn(state, 29.9)
    assert kind is None
    assert state.interaction_started_at == T0


def test_midnight_starts_a_new_day() -> None:
    _, state = _turn(AiNoticeState(), 0)
    kind, _ = _turn(state, 10, local_date=date(2026, 9, 26))
    assert kind == "start"


def test_shorter_interval_reminds_sooner() -> None:
    _, state = _turn(AiNoticeState(), 0)
    kind, state = _turn(state, 25, interval=timedelta(hours=1))
    assert kind is None
    kind, state = _turn(state, 50, interval=timedelta(hours=1))
    assert kind is None
    kind, _ = _turn(state, 65, interval=timedelta(hours=1))
    assert kind == "reminder"


def test_state_is_shared_across_animas() -> None:
    # Notice state is per installation; the Anima does not enter the decision.
    _, state = _turn(AiNoticeState(), 0)
    kind, _ = _turn(state, 5)
    assert kind is None


def test_clock_moving_backwards_does_not_suppress_the_start_notice() -> None:
    _, state = _turn(AiNoticeState(), 60)
    kind, _ = _turn(state, 0, local_date=date(2026, 9, 26))
    assert kind == "start"
