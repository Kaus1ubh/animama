"""Speech proxy limits apply before forwarding bytes and retain unknown billing."""

import pytest

from animama.app.ports.voice import SpeechCall, SpeechLimits
from animama.app.services.bounded_speech import BoundedSpeechService
from animama.domain.audio import AudioChunk, SynthesisChunk, TranscriptSegment


class Boundary:
    def __init__(self):
        self.admitted = []
        self.finished = []

    async def admit(self, call, *, kind):
        self.admitted.append((call, kind))

    async def finish(self, call, outcome):
        self.finished.append((call, outcome))


class Tts:
    def __init__(self):
        self.texts = []
        self.closed = False

    async def aclose(self):
        pass

    async def synthesize_full(self, text, **kwargs):
        return SynthesisChunk(data=b"1234")

    async def synthesize(self, text, **kwargs):
        self.texts.append(text)
        try:
            yield SynthesisChunk(data=b"1234")
            yield SynthesisChunk(data=b"5678")
        finally:
            self.closed = True


def call():
    return SpeechCall(
        owner_id="owner",
        operation_id="root",
        call_id="child",
        limits=SpeechLimits(
            max_input_bytes=4, max_input_audio_seconds=1, max_input_characters=5, max_output_bytes=5, timeout_seconds=1
        ),
    )


@pytest.mark.asyncio
async def test_tts_stops_forwarding_at_bound_and_keeps_unknown_billable_usage():
    boundary, tts = Boundary(), Tts()
    output = []
    with pytest.raises(ValueError, match="output"):
        async for chunk in BoundedSpeechService(boundary=boundary, tts=tts).synthesize(call(), "hello"):
            output.append(chunk.data)
    assert output == [b"1234"] and tts.closed
    outcome = boundary.finished[0][1]
    assert outcome.status == "failed" and outcome.provider_usage is None
    assert outcome.input_characters == 5 and outcome.output_bytes == 8


@pytest.mark.asyncio
async def test_oversize_text_never_dispatches():
    boundary, tts = Boundary(), Tts()
    with pytest.raises(ValueError, match="text"):
        _ = [chunk async for chunk in BoundedSpeechService(boundary=boundary, tts=tts).synthesize(call(), "too long")]
    assert not tts.texts and not boundary.admitted


@pytest.mark.asyncio
async def test_stt_bounds_audio_before_provider_consumes_it():
    seen = []

    class Stt:
        async def aclose(self):
            pass

        async def stream(self, chunks):
            async for chunk in chunks:
                seen.append(chunk.data)
                yield TranscriptSegment(text="heard")

    async def chunks():
        yield AudioChunk(data=b"1234")
        yield AudioChunk(data=b"56")

    boundary = Boundary()
    with pytest.raises(ValueError, match="input"):
        _ = [value async for value in BoundedSpeechService(boundary=boundary, stt=Stt()).transcribe(call(), chunks())]
    assert seen == [b"1234"]
    assert boundary.finished[0][1].input_audio_seconds == 4 / (16000 * 2)
    assert boundary.finished[0][1].provider_usage is None


@pytest.mark.asyncio
async def test_client_disconnect_closes_speech_and_reports_cancellation():
    boundary, tts = Boundary(), Tts()
    stream = BoundedSpeechService(boundary=boundary, tts=tts).synthesize(call(), "hello")
    await anext(stream)
    await stream.aclose()
    assert tts.closed and boundary.finished[0][1].status == "cancelled"
