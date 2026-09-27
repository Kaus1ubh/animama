from __future__ import annotations

import json
from types import SimpleNamespace

import pytest

from animama.domain.emotions import EmotionValue
from animama.domain.events import EventType, MemoryUpdatedPayload
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


def test_memory_updated_frame_carries_the_turn_memory_cue() -> None:
    memory_cue = {
        "episode": {"text": "Mira shared her lake twin nickname."},
        "memories": {"entry_id": "mem-memories", "version": 5, "excerpt": "Mira calls me her lake twin."},
    }
    event = SimpleNamespace(
        type=EventType.MEMORY_UPDATED,
        payload=MemoryUpdatedPayload(run_id="run-1", message_id=42, memory_cue=memory_cue),
    )

    frame = sse_events.format_memory_updated_event(event, run_id="run-1")

    assert frame is not None
    lines = frame.strip().splitlines()
    assert lines[:2] == ["id: memory-updated-run-1", "event: memory.updated"]
    assert json.loads(lines[2].removeprefix("data: ")) == {
        "type": "memory.updated",
        "run_id": "run-1",
        "message_id": 42,
        "memory_cue": memory_cue,
    }
    assert sse_events.format_memory_updated_event(event, run_id="run-2") is None
