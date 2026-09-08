from __future__ import annotations

from types import SimpleNamespace

import pytest

from animama.domain.emotions import EmotionValue
from animama.domain.events import EventType
from animama.server import sse_events


@pytest.mark.asyncio
async def test_sse_side_effect_persists_current_run_emotion(monkeypatch) -> None:
    calls: list[tuple[object, str, object]] = []

    async def _fake_persist_emotional_state_update(session_factory, anima_id, payload):
        calls.append((session_factory, anima_id, payload))
        return True

    monkeypatch.setattr(sse_events, "persist_emotional_state_update", _fake_persist_emotional_state_update)
    session_factory = object()
    payload = SimpleNamespace(run_id="run-1", emotions=[EmotionValue(emotion="joy", value=12)])

    persisted = await sse_events.persist_sse_side_effect(
        SimpleNamespace(type=EventType.EMOTION_UPDATE, payload=payload),
        run_id="run-1",
        anima_id="anima-1",
        session_factory=session_factory,
    )
    skipped = await sse_events.persist_sse_side_effect(
        SimpleNamespace(type=EventType.EMOTION_UPDATE, payload=SimpleNamespace(run_id="run-2", emotions=[])),
        run_id="run-1",
        anima_id="anima-1",
        session_factory=session_factory,
    )

    assert persisted is True
    assert skipped is False
    assert calls == [(session_factory, "anima-1", payload)]
