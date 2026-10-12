"""Gemini voice samples: generated on first play, cached per installation, billed once.

The Gemini service is driven through the scripted fake SDK client, so no key or
network is used.
"""

from __future__ import annotations

import asyncio
import io
import wave
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any

import pytest
from fastapi import FastAPI, HTTPException
from httpx import ASGITransport, AsyncClient

from animama.app.model_clients.credential_store import GEMINI_CREDENTIAL_ENV
from animama.domain.request_principal import RequestPrincipal
from animama.server import gemini_voice_samples
from animama.server.config import Settings
from animama.server.deps import get_current_principal
from animama.server.gemini_voice_samples import (
    SAMPLE_STYLE,
    SAMPLE_TEXT,
    LocalGeminiVoiceSamples,
)
from animama.server.local_runtime import initialize_local_runtime
from animama.server.routers import gemini as gemini_router
from animama.server.runtime_credentials import runtime_credentials
from tests.gemini_support import FakeInteractions, audio_event, completed_event, install_client

KEY = "gemini-key-for-tests"
OWNER = RequestPrincipal(id="owner")
PCM = b"\x01\x00\x02\x00" * 3000


@pytest.fixture
def gemini_key(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(runtime_credentials, "current", lambda: {GEMINI_CREDENTIAL_ENV: KEY})


def _no_key(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(runtime_credentials, "current", lambda: {})


def _speaking(pcm: bytes = PCM) -> FakeInteractions:
    return FakeInteractions([audio_event(pcm[: len(pcm) // 2]), audio_event(pcm[len(pcm) // 2 :]), completed_event()])


def _pcm(sample: bytes) -> bytes:
    with wave.open(io.BytesIO(sample)) as wav:
        assert (wav.getnchannels(), wav.getsampwidth(), wav.getframerate()) == (1, 2, 24000)
        return bytes(wav.readframes(wav.getnframes()))


async def _open(samples: LocalGeminiVoiceSamples, voice: str = "Puck", model_id: str = "gemini-3.8-flash-tts") -> bytes:
    file = await samples.open_sample(OWNER, voice=voice, model_id=model_id)  # type: ignore[arg-type]
    assert file.media_type == "audio/wav"
    data = file.handle.read()
    assert len(data) == file.size_bytes
    return data


def _files(root: Path) -> list[str]:
    return sorted(str(path.relative_to(root)) for path in root.rglob("*") if path.is_file())


@pytest.mark.asyncio
async def test_first_play_speaks_the_sample_once_and_later_plays_reuse_it(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, gemini_key: None
) -> None:
    interactions = _speaking()
    install_client(monkeypatch, interactions)

    first = await _open(LocalGeminiVoiceSamples(tmp_path))
    again = await _open(LocalGeminiVoiceSamples(tmp_path))  # as after a restart

    assert _pcm(first) == PCM
    assert again == first
    [call] = interactions.calls
    assert call["model"] == "gemini-3.8-flash-tts"
    assert call["generation_config"] == {"speech_config": [{"voice": "Puck"}]}
    assert call["store"] is False
    [content] = call["input"][0]["content"]
    assert content["text"] == SAMPLE_TEXT
    assert content["annotations"] == [{"type": "speech_metadata", "style": SAMPLE_STYLE}]
    assert SAMPLE_STYLE == "Speak in a friendly tone."


@pytest.mark.asyncio
async def test_each_model_and_voice_has_its_own_sample(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, gemini_key: None
) -> None:
    interactions = _speaking()
    install_client(monkeypatch, interactions)
    samples = LocalGeminiVoiceSamples(tmp_path)

    await _open(samples, "Puck", "gemini-3.8-flash-tts")
    await _open(samples, "Kore", "gemini-3.8-flash-tts")
    await _open(samples, "Puck", "gemini-3.8-flash-lite-tts")

    assert [(call["model"], call["generation_config"]["speech_config"][0]["voice"]) for call in interactions.calls] == [
        ("gemini-3.8-flash-tts", "Puck"),
        ("gemini-3.8-flash-tts", "Kore"),
        ("gemini-3.8-flash-lite-tts", "Puck"),
    ]
    assert len(_files(tmp_path)) == 3


class _HeldInteractions(FakeInteractions):
    """Streams only after ``release`` is set, so requests can overlap."""

    def __init__(self) -> None:
        super().__init__([audio_event(PCM), completed_event()])
        self.started = asyncio.Event()
        self.release = asyncio.Event()

    async def create(self, **params: Any) -> AsyncIterator[Any]:
        stream = await super().create(**params)
        self.started.set()
        await self.release.wait()
        return stream


@pytest.mark.asyncio
async def test_plays_at_the_same_time_bill_once(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, gemini_key: None
) -> None:
    interactions = _HeldInteractions()
    install_client(monkeypatch, interactions)
    samples = LocalGeminiVoiceSamples(tmp_path)

    plays = [asyncio.create_task(_open(samples)) for _ in range(2)]
    await interactions.started.wait()
    interactions.release.set()
    first, second = await asyncio.gather(*plays)

    assert first == second
    assert len(interactions.calls) == 1


@pytest.mark.asyncio
async def test_a_stopped_play_still_keeps_the_billed_sample(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, gemini_key: None
) -> None:
    interactions = _HeldInteractions()
    install_client(monkeypatch, interactions)
    samples = LocalGeminiVoiceSamples(tmp_path)

    play = asyncio.create_task(_open(samples))
    await interactions.started.wait()
    play.cancel()
    with pytest.raises(asyncio.CancelledError):
        await play
    interactions.release.set()

    assert _pcm(await _open(samples)) == PCM
    assert len(interactions.calls) == 1


@pytest.mark.asyncio
async def test_without_a_key_a_new_sample_asks_for_one_but_a_kept_sample_still_plays(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, gemini_key: None
) -> None:
    install_client(monkeypatch, _speaking())
    samples = LocalGeminiVoiceSamples(tmp_path)
    kept = await _open(samples, "Puck")
    _no_key(monkeypatch)

    assert await _open(samples, "Puck") == kept
    with pytest.raises(HTTPException) as refused:
        await _open(samples, "Kore")

    assert refused.value.status_code == 503
    detail: object = refused.value.detail
    assert detail == {
        "code": "gemini_tts_missing_credential",
        "message": "Gemini text-to-speech needs a Gemini API key.",
    }


class _ProviderError(Exception):
    def __init__(self) -> None:
        super().__init__(f"429 quota exceeded for key {KEY}: {SAMPLE_TEXT}")
        self.status_code = 429


@pytest.mark.asyncio
async def test_a_provider_failure_names_only_its_status_and_keeps_nothing(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, gemini_key: None, caplog: pytest.LogCaptureFixture
) -> None:
    failing = FakeInteractions(error=_ProviderError())
    install_client(monkeypatch, failing)
    samples = LocalGeminiVoiceSamples(tmp_path)

    with pytest.raises(HTTPException) as failed:
        await _open(samples)

    assert failed.value.status_code == 502
    detail: object = failed.value.detail
    assert detail == {
        "code": "gemini_tts_sample_failed",
        "message": "Gemini's rate limit or daily quota was reached (HTTP 429). "
        "Try again later, or raise your Gemini API tier.",
    }
    assert KEY not in caplog.text
    assert _files(tmp_path) == []

    install_client(monkeypatch, retry := _speaking())
    assert _pcm(await _open(samples)) == PCM
    assert len(retry.calls) == 1


@pytest.mark.parametrize(
    ("events", "message"),
    [
        ([audio_event(PCM), completed_event("failed")], "Gemini text-to-speech ended before completing."),
        ([completed_event()], "Gemini text-to-speech returned no audio."),
    ],
)
@pytest.mark.asyncio
async def test_an_unfinished_or_silent_sample_fails_without_leaving_files(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, gemini_key: None, events: list[Any], message: str
) -> None:
    install_client(monkeypatch, FakeInteractions(events))

    with pytest.raises(HTTPException) as failed:
        await _open(LocalGeminiVoiceSamples(tmp_path))

    assert failed.value.status_code == 502
    detail: object = failed.value.detail
    assert detail == {"code": "gemini_tts_sample_failed", "message": message}
    assert _files(tmp_path) == []


@pytest.mark.asyncio
async def test_a_long_sample_is_cut_at_ten_seconds(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, gemini_key: None
) -> None:
    second = b"\x01\x00" * 24000
    install_client(monkeypatch, FakeInteractions([audio_event(second * 4)] * 3 + [completed_event()]))

    pcm = _pcm(await _open(LocalGeminiVoiceSamples(tmp_path)))

    assert pcm == (second * 12)[: 10 * len(second)]


@pytest.mark.asyncio
async def test_a_damaged_sample_is_spoken_again(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, gemini_key: None
) -> None:
    interactions = _speaking()
    install_client(monkeypatch, interactions)
    samples = LocalGeminiVoiceSamples(tmp_path)
    await _open(samples)
    [kept] = list(tmp_path.rglob("*.wav"))
    kept.write_bytes(b"not a wav file")

    assert _pcm(await _open(samples)) == PCM
    assert len(interactions.calls) == 2


@pytest.mark.asyncio
async def test_a_new_sample_line_replaces_the_old_recording(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, gemini_key: None
) -> None:
    interactions = _speaking()
    install_client(monkeypatch, interactions)
    samples = LocalGeminiVoiceSamples(tmp_path)
    await _open(samples)
    [old] = list(tmp_path.rglob("*.wav"))
    monkeypatch.setattr(gemini_voice_samples, "SAMPLE_TEXT", "A different line.")

    await _open(samples)

    [current] = list(tmp_path.rglob("*.wav"))
    assert current != old
    assert interactions.calls[1]["input"][0]["content"][0]["text"] == "A different line."


@pytest.mark.asyncio
async def test_a_sample_that_cannot_be_kept_still_plays_and_leaves_no_partial_file(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, gemini_key: None
) -> None:
    interactions = _speaking()
    install_client(monkeypatch, interactions)
    samples = LocalGeminiVoiceSamples(tmp_path)

    def _disk_full(source: Path, destination: Path) -> None:
        raise OSError("No space left on device")

    monkeypatch.setattr(gemini_voice_samples, "replace", _disk_full)

    assert _pcm(await _open(samples)) == PCM
    assert _files(tmp_path) == []

    # Nothing was kept, so the next play speaks again.
    await _open(samples)
    assert len(interactions.calls) == 2


# --- The route ---------------------------------------------------------------


def _app(tmp_path: Path) -> FastAPI:
    app = FastAPI()
    app.include_router(gemini_router.router)
    app.dependency_overrides[get_current_principal] = lambda: OWNER
    app.state.local_runtime_paths = initialize_local_runtime(
        Settings(animama_content_root=tmp_path / "content", animama_data_root=tmp_path / "data")
    )
    return app


def _client(app: FastAPI) -> AsyncClient:
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


@pytest.mark.asyncio
async def test_the_route_serves_a_wav_kept_under_the_data_root_and_revalidates_it(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, gemini_key: None
) -> None:
    interactions = _speaking()
    install_client(monkeypatch, interactions)
    app = _app(tmp_path)

    async with _client(app) as client:
        played = await client.get("/v1/gemini/voices/Puck/sample")
        revalidated = await client.get(
            "/v1/gemini/voices/Puck/sample", headers={"If-None-Match": played.headers["etag"]}
        )

    assert played.status_code == 200
    assert played.headers["content-type"] == "audio/wav"
    assert played.headers["cache-control"] == "private, no-cache"
    assert _pcm(played.content) == PCM
    assert revalidated.status_code == 304
    # Without model_id the default model speaks; the file stays private to the installation.
    assert [call["model"] for call in interactions.calls] == ["gemini-3.8-flash-lite-tts"]
    derivatives = app.state.local_runtime_paths.derivatives_root
    assert _files(derivatives) and all(name.startswith("gemini-voice-samples/") for name in _files(derivatives))


@pytest.mark.parametrize(
    "path",
    ["/v1/gemini/voices/Nobody/sample", "/v1/gemini/voices/Puck/sample?model_id=gemini-2.0-tts"],
)
@pytest.mark.asyncio
async def test_the_route_refuses_unknown_voices_and_models_without_a_request(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, gemini_key: None, path: str
) -> None:
    interactions = _speaking()
    install_client(monkeypatch, interactions)

    async with _client(_app(tmp_path)) as client:
        response = await client.get(path)

    assert response.status_code == 422
    assert interactions.calls == []


@pytest.mark.asyncio
async def test_the_route_reports_a_missing_key_with_its_message(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _no_key(monkeypatch)

    async with _client(_app(tmp_path)) as client:
        response = await client.get("/v1/gemini/voices/Puck/sample")

    assert response.status_code == 503
    assert response.json() == {
        "detail": {
            "code": "gemini_tts_missing_credential",
            "message": "Gemini text-to-speech needs a Gemini API key.",
        }
    }


@pytest.mark.asyncio
async def test_first_plays_at_the_same_time_after_a_restart_bill_once(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, gemini_key: None
) -> None:
    interactions = _HeldInteractions()
    install_client(monkeypatch, interactions)
    app = _app(tmp_path)

    async with _client(app) as client:
        plays = [asyncio.create_task(client.get("/v1/gemini/voices/Puck/sample")) for _ in range(2)]
        await interactions.started.wait()
        interactions.release.set()
        responses = await asyncio.gather(*plays)

    assert [response.status_code for response in responses] == [200, 200]
    assert len(interactions.calls) == 1
