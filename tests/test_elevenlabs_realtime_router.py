from __future__ import annotations

import asyncio
from types import SimpleNamespace
from typing import Any

import pytest

from animama.app.contracts.elevenlabs import PyElevenLabsVoice
from animama.app.voice_emotional_tone import (
    elevenlabs_v3_text_with_emotional_prefix,
    normalize_elevenlabs_emotional_tone,
)
from animama.server.app import app
from animama.server.elevenlabs_service import (
    ElevenLabsFinalizedTtsStream,
    prepare_finalized_tts_stream_from_text,
    resolve_realtime_tts_session,
    stream_finalized_tts_chunks,
)


async def _primary_voice() -> PyElevenLabsVoice:
    """The Anima's voice, as the chat route's resolver reads it from the owner's settings."""

    return PyElevenLabsVoice(voice_id="voice-primary")


def test_removed_elevenlabs_tts_proxy_routes_are_not_registered() -> None:
    paths = {getattr(route, "path", None) for route in app.routes}

    assert "/v1/animas/{anima_id}/tts/elevenlabs:stream" not in paths
    assert "/v1/elevenlabs/realtime-tts/session" not in paths
    assert "/v1/elevenlabs/realtime-tts/ws" not in paths


def test_elevenlabs_tone_helper_maps_canonical_emotion_to_tone_key() -> None:
    tone = normalize_elevenlabs_emotional_tone("joy")

    assert tone is not None
    assert tone.canonical_emotion == "joy"
    assert tone.tone_key == "happy"


def test_elevenlabs_tone_helper_maps_tone_key_to_canonical_emotion() -> None:
    tone = normalize_elevenlabs_emotional_tone("scared")

    assert tone is not None
    assert tone.canonical_emotion == "fear"
    assert tone.tone_key == "scared"


@pytest.mark.parametrize("emotional_tone", ["neutral", "", None, "not-a-tone"])
def test_elevenlabs_tone_prefix_defaults_to_friendly_for_neutral_empty_or_invalid(
    emotional_tone: object,
) -> None:
    result = elevenlabs_v3_text_with_emotional_prefix(
        text="Speak this.",
        emotional_tone=emotional_tone,
        emotional_state={"joy": 30},
    )

    assert result.text == "[friendly] Speak this."
    assert result.tone_key == "friendly"
    assert result.intensity_level is None
    assert result.prefix == "[friendly]"
    assert result.applied is True


def test_elevenlabs_tone_prefix_fails_open_without_state() -> None:
    result = elevenlabs_v3_text_with_emotional_prefix(
        text="Speak this.",
        emotional_tone="happy",
        emotional_state=None,
    )

    assert result.text == "Speak this."
    assert result.prefix is None
    assert result.applied is False


@pytest.mark.parametrize(
    ("emotion_value", "expected_level", "expected_prefix"),
    [
        (0, 0, "[slightly happy]"),
        (5, 1, "[happy]"),
        (16, 2, "[very happy]"),
        (26, 3, "[very happy]"),
    ],
)
def test_elevenlabs_tone_prefix_uses_anima_intensity_level(
    emotion_value: int,
    expected_level: int,
    expected_prefix: str | None,
) -> None:
    result = elevenlabs_v3_text_with_emotional_prefix(
        text="Speak this.",
        emotional_tone="joy",
        emotional_state={"joy": emotion_value},
    )

    assert result.prefix == expected_prefix
    assert result.intensity_level == expected_level
    if expected_prefix is None:
        assert result.text == "Speak this."
        assert result.applied is False
    else:
        assert result.text == f"{expected_prefix} Speak this."
        assert result.applied is True


@pytest.mark.asyncio
async def test_realtime_tts_session_is_direct_only(
    monkeypatch: pytest.MonkeyPatch, set_runtime_credentials: Any
) -> None:
    set_runtime_credentials(ELEVENLABS_API_KEY="test-elevenlabs-key")
    voice_access_checks: list[str] = []

    async def _fake_ensure_voice_accessible(*, voice_id: str) -> None:
        voice_access_checks.append(voice_id)

    async def _fake_mint_token() -> str:
        return "sutkn-direct"

    monkeypatch.setattr(
        "animama.server.elevenlabs_service.ensure_elevenlabs_voice_accessible",
        _fake_ensure_voice_accessible,
    )
    monkeypatch.setattr(
        "animama.server.elevenlabs_service.mint_dialogue_websocket_single_use_token",
        _fake_mint_token,
    )

    payload = await resolve_realtime_tts_session(
        voice=_primary_voice,
        language_code="en",
        model_id="eleven_v4_turbo",
    )

    assert payload.voice_id == "voice-primary"
    assert payload.model_id == "eleven_v4_turbo"
    assert payload.output_format == "pcm_24000"
    # Character timing is always requested with the audio.
    assert payload.sync_alignment is True
    assert payload.language_code == "en"
    assert payload.token == "sutkn-direct"
    assert payload.websocket_base_url == "wss://api.elevenlabs.io"
    assert not hasattr(payload, "use_backend_intermediary")
    assert not hasattr(payload, "proxy_ws_path")
    assert voice_access_checks == ["voice-primary"]


@pytest.mark.asyncio
async def test_internal_finalized_tts_stream_uses_prepared_text(
    monkeypatch: pytest.MonkeyPatch,
    set_runtime_credentials: Any,
) -> None:
    set_runtime_credentials(ELEVENLABS_API_KEY="test-elevenlabs-key")

    async def _fake_ensure_voice_accessible(*, voice_id: str) -> None:
        assert voice_id == "voice-primary"

    def _unexpected_gruut(*_args: Any, **_kwargs: Any) -> dict[str, Any]:
        raise AssertionError("prepared gruut text should not be reprocessed")

    monkeypatch.setattr(
        "animama.server.elevenlabs_service.ensure_elevenlabs_voice_accessible",
        _fake_ensure_voice_accessible,
    )
    monkeypatch.setattr("animama.server.finalized_speech.build_gruut_sse_text", _unexpected_gruut)

    prepared = await prepare_finalized_tts_stream_from_text(
        voice=_primary_voice,
        anima_id="anima-1",
        run_id="run-1",
        text="Call one hundred.",
        model_id="eleven_v3",
        language_code=None,
        text_basis="gruut_text_with_ws",
    )

    assert prepared.run_id == "run-1"
    assert prepared.voice_id == "voice-primary"
    assert prepared.text == "[friendly] Call one hundred."
    assert prepared.model_id == "eleven_v3"
    assert prepared.output_format == "pcm_24000"
    assert prepared.previous_text is None


@pytest.mark.asyncio
async def test_internal_finalized_tts_stream_omits_previous_text_for_eleven_v3(
    monkeypatch: pytest.MonkeyPatch,
    set_runtime_credentials: Any,
) -> None:
    set_runtime_credentials(ELEVENLABS_API_KEY="test-elevenlabs-key")

    async def _fake_ensure_voice_accessible(*, voice_id: str) -> None:
        assert voice_id == "voice-primary"

    monkeypatch.setattr(
        "animama.server.elevenlabs_service.ensure_elevenlabs_voice_accessible",
        _fake_ensure_voice_accessible,
    )

    prepared = await prepare_finalized_tts_stream_from_text(
        voice=_primary_voice,
        anima_id="anima-1",
        run_id="run-1",
        text="Second segment.",
        model_id="eleven_v3",
        language_code=None,
        text_basis="gruut_text_with_ws",
        previous_text="  First\n\nsegment.  ",
        apply_emotional_prefix=False,
    )

    assert prepared.text == "Second segment."
    assert prepared.previous_text is None


@pytest.mark.asyncio
async def test_internal_finalized_tts_stream_prefixes_eleven_v3_provider_text(
    monkeypatch: pytest.MonkeyPatch,
    set_runtime_credentials: Any,
) -> None:
    set_runtime_credentials(ELEVENLABS_API_KEY="test-elevenlabs-key")

    async def _fake_ensure_voice_accessible(*, voice_id: str) -> None:
        assert voice_id == "voice-primary"

    monkeypatch.setattr(
        "animama.server.elevenlabs_service.ensure_elevenlabs_voice_accessible",
        _fake_ensure_voice_accessible,
    )

    prepared = await prepare_finalized_tts_stream_from_text(
        voice=_primary_voice,
        anima_id="anima-1",
        run_id="run-1",
        text="Call one hundred.",
        model_id="eleven_v3",
        language_code=None,
        text_basis="gruut_text_with_ws",
        emotional_tone="joy",
        emotional_state={"joy": 16},
    )

    assert prepared.text == "[very happy] Call one hundred."


@pytest.mark.asyncio
async def test_internal_finalized_tts_stream_can_skip_eleven_v3_emotional_prefix(
    monkeypatch: pytest.MonkeyPatch,
    set_runtime_credentials: Any,
) -> None:
    set_runtime_credentials(ELEVENLABS_API_KEY="test-elevenlabs-key")

    async def _fake_ensure_voice_accessible(*, voice_id: str) -> None:
        assert voice_id == "voice-primary"

    monkeypatch.setattr(
        "animama.server.elevenlabs_service.ensure_elevenlabs_voice_accessible",
        _fake_ensure_voice_accessible,
    )

    prepared = await prepare_finalized_tts_stream_from_text(
        voice=_primary_voice,
        anima_id="anima-1",
        run_id="run-1",
        text="Call one hundred.",
        model_id="eleven_v3",
        language_code=None,
        text_basis="gruut_text_with_ws",
        emotional_tone="joy",
        emotional_state={"joy": 16},
        apply_emotional_prefix=False,
    )

    assert prepared.text == "Call one hundred."


@pytest.mark.asyncio
async def test_internal_finalized_tts_stream_uses_resolved_voice_id_without_validation(
    monkeypatch: pytest.MonkeyPatch,
    set_runtime_credentials: Any,
) -> None:
    set_runtime_credentials(ELEVENLABS_API_KEY="test-elevenlabs-key")

    async def _unexpected_ensure_voice_accessible(*, voice_id: str) -> None:
        raise AssertionError(f"voice should already be resolved, got {voice_id}")

    def _unexpected_gruut(*_args: Any, **_kwargs: Any) -> dict[str, Any]:
        raise AssertionError("prepared gruut text should not be reprocessed")

    monkeypatch.setattr(
        "animama.server.elevenlabs_service.ensure_elevenlabs_voice_accessible",
        _unexpected_ensure_voice_accessible,
    )
    monkeypatch.setattr("animama.server.finalized_speech.build_gruut_sse_text", _unexpected_gruut)

    prepared = await prepare_finalized_tts_stream_from_text(
        anima_id="anima-1",
        run_id="run-1",
        text="Call one hundred.",
        model_id="eleven_v3",
        language_code=None,
        text_basis="gruut_text_with_ws",
        voice_id="voice-primary",
    )

    assert prepared.voice_id == "voice-primary"
    assert prepared.text == "[friendly] Call one hundred."


@pytest.mark.asyncio
async def test_finalized_tts_stream_omits_previous_text_for_eleven_v3(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[dict[str, Any]] = []

    class _FakeTextToSpeech:
        def stream(self, voice_id: str, **kwargs: Any):
            calls.append({"voice_id": voice_id, **kwargs})
            return iter([b"\x00\x01"])

    monkeypatch.setattr(
        "animama.server.elevenlabs_service.get_elevenlabs_client",
        lambda: SimpleNamespace(text_to_speech=_FakeTextToSpeech()),
    )
    monkeypatch.setattr(
        "animama.server.elevenlabs_service.get_elevenlabs_semaphore",
        lambda: asyncio.Semaphore(1),
    )

    prepared = ElevenLabsFinalizedTtsStream(
        run_id="run-1",
        voice_id="voice-primary",
        text="Second segment.",
        previous_text="First segment.",
        model_id="eleven_v3",
        output_format="pcm_24000",
        language_code="en",
    )

    chunks = [chunk async for chunk in stream_finalized_tts_chunks(prepared)]

    assert calls == [
        {
            "voice_id": "voice-primary",
            "text": "Second segment.",
            "model_id": "eleven_v3",
            "output_format": "pcm_24000",
            "language_code": "en",
            "previous_text": ...,
            "apply_text_normalization": "off",
        }
    ]
    assert chunks == [
        {
            "type": "audio",
            "run_id": "run-1",
            "model_id": "eleven_v3",
            "output_format": "pcm_24000",
            "audio_base64": "AAE=",
        },
        {
            "type": "done",
            "run_id": "run-1",
            "model_id": "eleven_v3",
            "output_format": "pcm_24000",
        },
    ]


@pytest.mark.asyncio
async def test_finalized_tts_stream_coalesces_pcm_audio_frames(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class _FakeTextToSpeech:
        def stream(self, _voice_id: str, **_kwargs: Any):
            return iter([b"\x00", b"\x01\x02\x03", b"\x04\x05"])

    monkeypatch.setattr(
        "animama.server.elevenlabs_service.get_elevenlabs_client",
        lambda: SimpleNamespace(text_to_speech=_FakeTextToSpeech()),
    )
    monkeypatch.setattr(
        "animama.server.elevenlabs_service.get_elevenlabs_semaphore",
        lambda: asyncio.Semaphore(1),
    )
    monkeypatch.setattr(
        "animama.server.finalized_speech.FINALIZED_TTS_PCM_FRAME_BYTES",
        4,
    )

    prepared = ElevenLabsFinalizedTtsStream(
        run_id="run-1",
        voice_id="voice-primary",
        text="Speak this.",
        previous_text=None,
        model_id="eleven_v3",
        output_format="pcm_24000",
        language_code=None,
    )

    chunks = [chunk async for chunk in stream_finalized_tts_chunks(prepared)]

    assert [chunk.get("audio_base64") for chunk in chunks if chunk.get("type") == "audio"] == ["AAECAw==", "BAU="]
    assert chunks[-1]["type"] == "done"
