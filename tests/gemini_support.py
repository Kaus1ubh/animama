"""A duck-typed Gemini SDK client for tests: scripted Interactions events, no key or network."""

from __future__ import annotations

import base64
from collections.abc import AsyncIterator
from types import SimpleNamespace
from typing import Any

import pytest

from animama.server import gemini_tts_service


class FakeInteractions:
    """Records each create call and replays scripted events, or raises ``error``."""

    def __init__(self, events: list[Any] | None = None, error: BaseException | None = None) -> None:
        self.calls: list[dict[str, Any]] = []
        self._events = events or []
        self._error = error

    async def create(self, **params: Any) -> AsyncIterator[Any]:
        self.calls.append(params)
        if self._error is not None:
            raise self._error

        async def _stream() -> AsyncIterator[Any]:
            for event in self._events:
                yield event

        return _stream()


def install_client(monkeypatch: pytest.MonkeyPatch, interactions: FakeInteractions) -> list[str]:
    """Route the Gemini service's client to ``interactions``; returns the keys it was built with."""

    keys: list[str] = []

    def _client(api_key: str) -> Any:
        keys.append(api_key)
        return SimpleNamespace(aio=SimpleNamespace(interactions=interactions))

    monkeypatch.setattr(gemini_tts_service, "_client", _client)
    return keys


def audio_event(raw: bytes) -> Any:
    return SimpleNamespace(
        event_type="step.delta", delta=SimpleNamespace(type="audio", data=base64.b64encode(raw).decode())
    )


def completed_event(status: str = "completed") -> Any:
    return SimpleNamespace(event_type="interaction.completed", interaction=SimpleNamespace(status=status))
