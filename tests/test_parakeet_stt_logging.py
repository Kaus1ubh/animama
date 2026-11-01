"""The optional Parakeet adapter logs stream progress, never transcripts or its token."""

from __future__ import annotations

import json
import logging

import pytest
import websockets

from animama.adapters.voice.parakeet_http import ParakeetSTTProvider
from animama.domain.audio import AudioChunk

_TRANSCRIPT = "please remember my secret plan"
_TOKEN = "parakeet-shared-token"


class _FakeSocket:
    async def send(self, data: bytes) -> None:
        return None

    async def close(self) -> None:
        return None

    async def __aiter__(self):
        yield json.dumps({"text": _TRANSCRIPT})


async def _audio():
    yield AudioChunk(data=b"\x00\x00")
    yield None


@pytest.mark.asyncio
async def test_stream_logs_neither_transcript_nor_token(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    async def connect(url: str, **_: object) -> _FakeSocket:
        return _FakeSocket()

    monkeypatch.setattr(websockets, "connect", connect)
    caplog.set_level(logging.DEBUG, logger="anima")
    provider = ParakeetSTTProvider(base_url="http://parakeet:8001", token=_TOKEN)

    segments = [segment async for segment in provider.stream(_audio())]

    assert [segment.text for segment in segments] == [_TRANSCRIPT]
    logged = "\n".join(f"{record.getMessage()} {record.__dict__}" for record in caplog.records)
    assert "Transcript received" in logged
    assert _TRANSCRIPT not in logged
    assert _TOKEN not in logged
