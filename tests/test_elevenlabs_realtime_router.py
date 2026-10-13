from __future__ import annotations

import asyncio
import json
from typing import Any

import httpx
import pytest
from elevenlabs.client import ElevenLabs

from animama.app.contracts.elevenlabs import ELEVENLABS_DIALOGUE_MAX_REQUEST_CHARS, PyElevenLabsVoice
from animama.app.voice_emotional_tone import (
    elevenlabs_text_with_emotional_prefix,
    normalize_elevenlabs_emotional_tone,
)
from animama.server.app import app
from animama.server.elevenlabs_service import (
    ElevenLabsFinalizedTtsStream,
    dialogue_request_texts,
    prepare_finalized_tts_stream_from_text,
    resolve_finalized_tts_model_id,
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
    result = elevenlabs_text_with_emotional_prefix(
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
    result = elevenlabs_text_with_emotional_prefix(
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
    result = elevenlabs_text_with_emotional_prefix(
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


def test_finalized_tts_model_defaults_to_eleven_v4_and_maps_eleven_v3() -> None:
    assert resolve_finalized_tts_model_id(None) == "eleven_v4"
    assert resolve_finalized_tts_model_id("eleven_v4") == "eleven_v4"
    assert resolve_finalized_tts_model_id("eleven_v3") == "eleven_v4"


async def _allow_primary_voice(*, voice_id: str) -> None:
    assert voice_id == "voice-primary"


@pytest.mark.asyncio
async def test_internal_finalized_tts_stream_uses_prepared_text(
    monkeypatch: pytest.MonkeyPatch,
    set_runtime_credentials: Any,
) -> None:
    set_runtime_credentials(ELEVENLABS_API_KEY="test-elevenlabs-key")

    def _unexpected_gruut(*_args: Any, **_kwargs: Any) -> dict[str, Any]:
        raise AssertionError("prepared gruut text should not be reprocessed")

    monkeypatch.setattr("animama.server.elevenlabs_service.ensure_elevenlabs_voice_accessible", _allow_primary_voice)
    monkeypatch.setattr("animama.server.finalized_speech.build_gruut_sse_text", _unexpected_gruut)

    prepared = await prepare_finalized_tts_stream_from_text(
        voice=_primary_voice,
        anima_id="anima-1",
        run_id="run-1",
        text="Call one hundred.",
        model_id="eleven_v4",
        language_code=None,
        text_basis="gruut_text_with_ws",
    )

    assert prepared.run_id == "run-1"
    assert prepared.voice_id == "voice-primary"
    assert prepared.text == "[friendly] Call one hundred."
    assert prepared.model_id == "eleven_v4"
    assert prepared.output_format == "pcm_24000"
    assert prepared.previous_text is None
    assert prepared.previous_request_ids == ()
    assert prepared.apply_text_normalization == "off"


@pytest.mark.parametrize(
    ("text", "gruut_text", "spoken", "normalization"),
    [
        # English visible text is verbalized by gruut, so ElevenLabs reads it as is.
        ("Call 100.", "Call one hundred.", "Call one hundred.", "off"),
        # Without gruut's text, the provider normalizes the digits itself.
        ("Call 100.", None, "Call 100.", "auto"),
        # Other languages are spoken as written; gruut is not asked.
        ("今日は3時です。", "unused", "今日は3時です。", "auto"),
    ],
)
@pytest.mark.asyncio
async def test_internal_finalized_tts_stream_normalizes_only_text_gruut_did_not_prepare(
    monkeypatch: pytest.MonkeyPatch,
    set_runtime_credentials: Any,
    text: str,
    gruut_text: str | None,
    spoken: str,
    normalization: str,
) -> None:
    set_runtime_credentials(ELEVENLABS_API_KEY="test-elevenlabs-key")
    monkeypatch.setattr("animama.server.elevenlabs_service.ensure_elevenlabs_voice_accessible", _allow_primary_voice)
    gruut_inputs: list[str] = []

    def _fake_gruut(final_text: str, **_kwargs: Any) -> dict[str, Any] | None:
        gruut_inputs.append(final_text)
        return {"tokenized_text": gruut_text, "phonemized_text": []} if gruut_text else None

    monkeypatch.setattr("animama.server.finalized_speech.build_gruut_sse_text", _fake_gruut)

    prepared = await prepare_finalized_tts_stream_from_text(
        voice=_primary_voice,
        anima_id="anima-1",
        run_id="run-1",
        text=text,
        model_id="eleven_v4",
        language_code=None,
        text_basis="visible_text",
        apply_emotional_prefix=False,
    )

    assert prepared.text == spoken
    assert prepared.apply_text_normalization == normalization
    assert gruut_inputs == ([] if text.startswith("今日") else [text])


@pytest.mark.asyncio
async def test_internal_finalized_tts_stream_keeps_bounded_continuity(
    monkeypatch: pytest.MonkeyPatch,
    set_runtime_credentials: Any,
) -> None:
    """v4 continues from earlier requests; ``previous_text`` is capped at ElevenLabs' 100 characters."""

    set_runtime_credentials(ELEVENLABS_API_KEY="test-elevenlabs-key")
    monkeypatch.setattr("animama.server.elevenlabs_service.ensure_elevenlabs_voice_accessible", _allow_primary_voice)
    earlier = "word " * 40

    prepared = await prepare_finalized_tts_stream_from_text(
        voice=_primary_voice,
        anima_id="anima-1",
        run_id="run-1",
        text="Second segment.",
        model_id="eleven_v4",
        language_code=None,
        text_basis="gruut_text_with_ws",
        previous_text=f"  First\n\nsegment.  {earlier}",
        previous_request_ids=("req-1", "req-2"),
        apply_emotional_prefix=False,
    )

    assert prepared.text == "Second segment."
    assert prepared.previous_text is not None
    assert len(prepared.previous_text) == 100
    assert prepared.previous_text.endswith("word word")
    assert prepared.previous_request_ids == ("req-1", "req-2")


@pytest.mark.asyncio
async def test_internal_finalized_tts_stream_prefixes_eleven_v4_provider_text(
    monkeypatch: pytest.MonkeyPatch,
    set_runtime_credentials: Any,
) -> None:
    set_runtime_credentials(ELEVENLABS_API_KEY="test-elevenlabs-key")
    monkeypatch.setattr("animama.server.elevenlabs_service.ensure_elevenlabs_voice_accessible", _allow_primary_voice)

    prepared = await prepare_finalized_tts_stream_from_text(
        voice=_primary_voice,
        anima_id="anima-1",
        run_id="run-1",
        text="Call one hundred.",
        model_id="eleven_v4",
        language_code=None,
        text_basis="gruut_text_with_ws",
        emotional_tone="joy",
        emotional_state={"joy": 16},
    )

    assert prepared.text == "[very happy] Call one hundred."


@pytest.mark.asyncio
async def test_internal_finalized_tts_stream_can_skip_the_emotional_prefix(
    monkeypatch: pytest.MonkeyPatch,
    set_runtime_credentials: Any,
) -> None:
    set_runtime_credentials(ELEVENLABS_API_KEY="test-elevenlabs-key")
    monkeypatch.setattr("animama.server.elevenlabs_service.ensure_elevenlabs_voice_accessible", _allow_primary_voice)

    prepared = await prepare_finalized_tts_stream_from_text(
        voice=_primary_voice,
        anima_id="anima-1",
        run_id="run-1",
        text="Call one hundred.",
        model_id="eleven_v4",
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
        model_id="eleven_v4",
        language_code=None,
        text_basis="gruut_text_with_ws",
        voice_id="voice-primary",
    )

    assert prepared.voice_id == "voice-primary"
    assert prepared.text == "[friendly] Call one hundred."


def _dialogue_stream_client(
    monkeypatch: pytest.MonkeyPatch,
    handler: Any,
) -> None:
    """Route the SDK through ``handler`` so tests see the request ElevenLabs would receive."""

    client = ElevenLabs(
        api_key="test-elevenlabs-key", httpx_client=httpx.Client(transport=httpx.MockTransport(handler))
    )
    monkeypatch.setattr("animama.server.elevenlabs_service.get_elevenlabs_client", lambda: client)
    monkeypatch.setattr("animama.server.elevenlabs_service.get_elevenlabs_semaphore", lambda: asyncio.Semaphore(1))


def _ndjson(*chunks: dict[str, Any]) -> bytes:
    return "".join(json.dumps(chunk) + "\n" for chunk in chunks).encode()


def _prepared(**overrides: Any) -> ElevenLabsFinalizedTtsStream:
    values: dict[str, Any] = {
        "run_id": "run-1",
        "voice_id": "voice-primary",
        "text": "Second segment.",
        "previous_text": "First segment.",
        "model_id": "eleven_v4",
        "output_format": "pcm_24000",
        "language_code": "en",
        "apply_text_normalization": "off",
    }
    values.update(overrides)
    return ElevenLabsFinalizedTtsStream(**values)


@pytest.mark.asyncio
async def test_finalized_tts_stream_speaks_through_text_to_dialogue_with_stitching(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    requests: list[httpx.Request] = []

    def _handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        timing = {"characters": ["S"], "character_start_times_seconds": [0.0], "character_end_times_seconds": [0.1]}
        body = _ndjson(
            {"audio_base64": "AAE=", "alignment": timing, "normalized_alignment": timing, "voice_segments": []}
        )
        return httpx.Response(200, content=body, headers={"request-id": "req-3"})

    _dialogue_stream_client(monkeypatch, _handler)

    chunks = [chunk async for chunk in stream_finalized_tts_chunks(_prepared(previous_request_ids=("req-1", "req-2")))]

    [request] = requests
    assert request.url.path == "/v1/text-to-dialogue/stream/with-timestamps"
    assert request.url.params["output_format"] == "pcm_24000"
    # Request ids carry the delivery forward, so the text fallback is not sent with them.
    assert json.loads(request.content) == {
        "inputs": [{"text": "Second segment.", "voice_id": "voice-primary"}],
        "model_id": "eleven_v4",
        "language_code": "en",
        "apply_text_normalization": "off",
        "previous_request_ids": ["req-1", "req-2"],
    }
    assert chunks == [
        {
            "type": "audio",
            "run_id": "run-1",
            "model_id": "eleven_v4",
            "output_format": "pcm_24000",
            "audio_base64": "AAE=",
        },
        {
            "type": "done",
            "run_id": "run-1",
            "model_id": "eleven_v4",
            "output_format": "pcm_24000",
            "request_ids": ["req-3"],
        },
    ]


@pytest.mark.asyncio
async def test_finalized_tts_stream_continues_from_previous_text_without_request_ids(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    bodies: list[dict[str, Any]] = []

    def _handler(request: httpx.Request) -> httpx.Response:
        bodies.append(json.loads(request.content))
        return httpx.Response(200, content=_ndjson({"audio_base64": "AAE=", "alignment": None, "voice_segments": []}))

    _dialogue_stream_client(monkeypatch, _handler)

    chunks = [chunk async for chunk in stream_finalized_tts_chunks(_prepared(language_code=None))]

    assert bodies == [
        {
            "inputs": [{"text": "Second segment.", "voice_id": "voice-primary"}],
            "model_id": "eleven_v4",
            "apply_text_normalization": "off",
            "previous_text": "First segment.",
        }
    ]
    # Without a request id, the next segment has nothing to stitch to.
    assert chunks[-1] == {
        "type": "done",
        "run_id": "run-1",
        "model_id": "eleven_v4",
        "output_format": "pcm_24000",
    }


@pytest.mark.asyncio
async def test_finalized_tts_stream_lets_eleven_v4_normalize_text_sent_as_written(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """gruut normalizes only English; a Japanese time is left for ElevenLabs to read."""

    bodies: list[dict[str, Any]] = []

    def _handler(request: httpx.Request) -> httpx.Response:
        bodies.append(json.loads(request.content))
        return httpx.Response(200, content=_ndjson({"audio_base64": "AAE=", "voice_segments": []}))

    _dialogue_stream_client(monkeypatch, _handler)

    [
        _
        async for _ in stream_finalized_tts_chunks(
            _prepared(text="今日は3時です。", previous_text=None, language_code=None, apply_text_normalization="auto")
        )
    ]

    assert bodies[0]["inputs"] == [{"text": "今日は3時です。", "voice_id": "voice-primary"}]
    assert bodies[0]["apply_text_normalization"] == "auto"


@pytest.mark.asyncio
async def test_finalized_tts_stream_coalesces_pcm_audio_frames(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def _handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            content=_ndjson(
                {"audio_base64": "AA==", "voice_segments": []},
                {"audio_base64": "AQID", "voice_segments": []},
                {"audio_base64": "BAU=", "voice_segments": []},
            ),
        )

    _dialogue_stream_client(monkeypatch, _handler)
    monkeypatch.setattr("animama.server.finalized_speech.FINALIZED_TTS_PCM_FRAME_BYTES", 4)

    chunks = [chunk async for chunk in stream_finalized_tts_chunks(_prepared(previous_text=None))]

    assert [chunk.get("audio_base64") for chunk in chunks if chunk.get("type") == "audio"] == ["AAECAw==", "BAU="]
    assert chunks[-1]["type"] == "done"


@pytest.mark.asyncio
async def test_finalized_tts_stream_reports_a_provider_refusal_as_an_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def _handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(422, json={"detail": {"code": "invalid_voice", "message": "Voice not found"}})

    _dialogue_stream_client(monkeypatch, _handler)

    chunks = [chunk async for chunk in stream_finalized_tts_chunks(_prepared())]

    assert chunks == [
        {
            "type": "error",
            "run_id": "run-1",
            "model_id": "eleven_v4",
            "output_format": "pcm_24000",
            "error": "Voice not found",
            "code": "elevenlabs_stream_failed",
        }
    ]


def test_dialogue_request_texts_keep_short_text_whole() -> None:
    assert dialogue_request_texts("  Hello there.  ") == ["Hello there."]


@pytest.mark.parametrize(
    ("text", "ending"),
    [
        ("Hello there. " * 20, "there."),
        ("今日はいい天気ですね。" * 25, "ね。"),
        ("one, " * 60, "one,"),
        ("word " * 60, "word"),
    ],
)
def test_dialogue_request_texts_cut_long_text_at_the_last_break(text: str, ending: str) -> None:
    texts = dialogue_request_texts(text, limit=100)

    assert all(len(piece) <= 100 for piece in texts)
    assert texts[0].endswith(ending)
    # Nothing is lost: the pieces rejoin into the original text.
    assert "".join(texts).replace(" ", "") == text.replace(" ", "")


@pytest.mark.parametrize(
    "text",
    [
        "El café cuesta 3.5 euros, gracias, " * 6,
        "Vinieron unas 1,000 personas y luego otras 2,500 personas " * 4,
        "Nos vemos a las 3:30 hoy y a las 4:45 mañana " * 5,
    ],
)
def test_dialogue_request_texts_keep_numbers_whole(text: str) -> None:
    """A mark inside "3.5", "1,000" or "3:30" is not a break, so no cut splits a number."""

    texts = dialogue_request_texts(text, limit=100)

    assert all(len(piece) <= 100 for piece in texts)
    assert "".join(texts).replace(" ", "") == text.replace(" ", "")
    assert not any(piece[-1] in ".,:" and piece[-2].isdigit() for piece in texts)


def test_dialogue_request_texts_cut_text_without_breaks_at_the_limit() -> None:
    assert [len(piece) for piece in dialogue_request_texts("a" * 250, limit=100)] == [100, 100, 50]


@pytest.mark.asyncio
async def test_finalized_tts_stream_speaks_a_long_segment_as_stitched_requests(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Each request stays within Text to Dialogue's limit and continues from the one before it."""

    bodies: list[dict[str, Any]] = []

    def _handler(request: httpx.Request) -> httpx.Response:
        bodies.append(json.loads(request.content))
        request_id = f"req-{len(bodies) + 1}"
        return httpx.Response(
            200,
            content=_ndjson({"audio_base64": "AAE=", "voice_segments": []}),
            headers={"request-id": request_id},
        )

    _dialogue_stream_client(monkeypatch, _handler)
    monkeypatch.setattr("animama.server.finalized_speech.FINALIZED_TTS_PCM_FRAME_BYTES", 2)
    text = "This sentence is long enough. " * 100

    chunks = [
        chunk async for chunk in stream_finalized_tts_chunks(_prepared(text=text, previous_request_ids=("req-1",)))
    ]

    assert len(bodies) == 2
    assert all(len(body["inputs"][0]["text"]) <= ELEVENLABS_DIALOGUE_MAX_REQUEST_CHARS for body in bodies)
    assert "".join(body["inputs"][0]["text"] for body in bodies).replace(" ", "") == text.replace(" ", "")
    assert [body["previous_request_ids"] for body in bodies] == [["req-1"], ["req-1", "req-2"]]
    assert [chunk["type"] for chunk in chunks] == ["audio", "audio", "done"]
    # The reply's next segment continues from both requests.
    assert chunks[-1]["request_ids"] == ["req-2", "req-3"]
