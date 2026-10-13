"""Shared ElevenLabs utility routes reach the composition's speech port per owner (ADR 0021)."""

from __future__ import annotations

from pathlib import Path

from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from animama.product_http.ports import ProductRefusal
from animama.product_http.routes import elevenlabs
from tests.product_http_support import DeferredCommitPorts, FakeSpeech, TwoOwnerComposition, product_app


async def test_each_owner_reaches_the_speech_port_as_itself_without_a_session(
    async_session_factory: async_sessionmaker[AsyncSession], tmp_path: Path
) -> None:
    ports = DeferredCommitPorts(async_session_factory, speech=FakeSpeech(audio_upload_max_bytes=8))
    composition = TwoOwnerComposition(product_app(elevenlabs.router, ports=ports), tmp_path)
    owner_a, owner_b = composition.owners

    async with composition.client(owner_a) as a:
        cloned = await a.post(
            "/v1/elevenlabs/voices/clone",
            data={"name": "  Wren ", "description": " ", "remove_background_noise": "true"},
            files=[("files", ("sample.wav", b"riff", "audio/wav"))],
        )
    async with composition.client(owner_b) as b:
        spoken = await b.post("/v1/elevenlabs/text-to-speech", json={"voice_id": "voice-b", "text": "Hello"})
        effect = await b.post("/v1/elevenlabs/sound-effects", json={"text": "A door creaks"})

    assert cloned.status_code == 201
    assert cloned.json()["voice_id"] == f"voice-{owner_a}"
    assert (spoken.status_code, effect.status_code) == (200, 200)
    clone, speech, sound = ports.speech.calls
    # The route trims the name, drops a blank description and passes each sample.
    assert clone == ("clone", owner_a, ("Wren", [("sample.wav", b"riff", "audio/wav")], None, True))
    assert (speech[:2], sound[:2]) == (("text_to_speech", owner_b), ("sound_effect", owner_b))
    # These utilities open no session the composition would have to settle.
    assert ports.owners == []


async def test_uploads_are_bounded_by_the_ports_limit(
    async_session_factory: async_sessionmaker[AsyncSession], tmp_path: Path
) -> None:
    ports = DeferredCommitPorts(async_session_factory, speech=FakeSpeech(audio_upload_max_bytes=4))
    composition = TwoOwnerComposition(product_app(elevenlabs.router, ports=ports), tmp_path)

    async with composition.client(composition.owners[0]) as client:
        empty = await client.post(
            "/v1/elevenlabs/voices/clone", data={"name": "Wren"}, files=[("files", ("a.wav", b"", "audio/wav"))]
        )
        oversized = await client.post(
            "/v1/elevenlabs/voices/clone", data={"name": "Wren"}, files=[("files", ("a.wav", b"12345", "audio/wav"))]
        )

    assert (empty.status_code, empty.json()) == (400, {"detail": "Uploaded audio file is empty"})
    assert (oversized.status_code, oversized.json()) == (400, {"detail": "Uploaded audio exceeds the 4 byte limit"})
    assert ports.speech.calls == []


class _NoSpeech(FakeSpeech):
    """A composition without ElevenLabs refuses each operation."""

    async def clone_voice(self, principal, **_values):  # noqa: ANN001, ANN003, ANN201
        raise ProductRefusal(503, "speech_unavailable")

    async def synthesize_text(self, principal, request):  # noqa: ANN001, ANN201
        raise ProductRefusal(503, "speech_unavailable")

    async def generate_sound_effect(self, principal, request):  # noqa: ANN001, ANN201
        raise HTTPException(status_code=503, detail={"code": "speech_unavailable", "provider": "none"})


async def test_a_composition_without_speech_refuses_through_its_port(
    async_session_factory: async_sessionmaker[AsyncSession], tmp_path: Path
) -> None:
    ports = DeferredCommitPorts(async_session_factory, speech=_NoSpeech())
    composition = TwoOwnerComposition(product_app(elevenlabs.router, ports=ports), tmp_path)

    async with composition.client(composition.owners[0]) as client:
        cloned = await client.post(
            "/v1/elevenlabs/voices/clone", data={"name": "Wren"}, files=[("files", ("a.wav", b"riff", "audio/wav"))]
        )
        spoken = await client.post("/v1/elevenlabs/text-to-speech", json={"voice_id": "voice-a", "text": "Hello"})
        effect = await client.post("/v1/elevenlabs/sound-effects", json={"text": "A door creaks"})

    # A ProductRefusal keeps its status and code; an HTTPException keeps its own body.
    for response in (cloned, spoken):
        assert (response.status_code, response.json()) == (503, {"detail": {"code": "speech_unavailable"}})
    assert (effect.status_code, effect.json()) == (503, {"detail": {"code": "speech_unavailable", "provider": "none"}})
