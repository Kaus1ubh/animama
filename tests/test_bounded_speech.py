"""Speech proxy limits apply before forwarding bytes and retain unknown billing."""

import asyncio
from dataclasses import replace

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


@pytest.mark.asyncio
@pytest.mark.parametrize("kind", ["tts", "stt"])
@pytest.mark.parametrize("resume", ["pull", "close"])
async def test_provider_deadline_never_cancels_slow_speech_consumers(kind, resume):
    closed = []

    class Provider(Tts):
        async def synthesize(self, text, **kwargs):
            try:
                yield SynthesisChunk(data=b"1234")
                yield SynthesisChunk(data=b"5678")
            finally:
                closed.append("provider")

        async def stream(self, chunks):
            try:
                async for _chunk in chunks:
                    yield TranscriptSegment(text="ok")
            finally:
                closed.append("provider")

    async def chunks():
        try:
            yield AudioChunk(data=b"12")
            yield AudioChunk(data=b"34")
        finally:
            closed.append("input")

    boundary = Boundary()
    bounded_call = replace(call(), limits=replace(call().limits, timeout_seconds=0.02, max_output_bytes=20))
    service = BoundedSpeechService(boundary=boundary, tts=Provider(), stt=Provider())
    stream = service.synthesize(bounded_call, "hello") if kind == "tts" else service.transcribe(bounded_call, chunks())
    task = asyncio.current_task()
    assert task is not None
    cancellations_before = task.cancelling()
    try:
        await anext(stream)
        try:
            await asyncio.sleep(0.05)
        except asyncio.CancelledError:
            pytest.fail("The provider deadline cancelled unrelated consumer work")
        if resume == "pull":
            with pytest.raises(TimeoutError):
                await anext(stream)
        else:
            await stream.aclose()
    finally:
        await stream.aclose()
    assert task.cancelling() == cancellations_before
    assert closed == (["provider"] if kind == "tts" else ["provider", "input"])
    assert len(boundary.finished) == 1
    outcome = boundary.finished[0][1]
    assert outcome.status == ("failed" if resume == "pull" else "cancelled")
    assert outcome.provider_usage is None
    assert outcome.output_bytes == (4 if kind == "tts" else 2)


@pytest.mark.asyncio
@pytest.mark.parametrize("kind", ["tts", "stt"])
async def test_speech_provider_pull_timeout_closes_once_and_retains_unknown_usage(kind):
    closed = []

    class Provider(Tts):
        async def synthesize(self, text, **kwargs):
            try:
                await asyncio.Event().wait()
                yield SynthesisChunk(data=b"unreachable")
            finally:
                closed.append("provider")

        async def stream(self, chunks):
            try:
                async for _chunk in chunks:
                    await asyncio.Event().wait()
                    yield TranscriptSegment(text="unreachable")
            finally:
                closed.append("provider")

    async def chunks():
        try:
            yield AudioChunk(data=b"12")
        finally:
            closed.append("input")

    boundary = Boundary()
    bounded_call = replace(call(), limits=replace(call().limits, timeout_seconds=0.02))
    service = BoundedSpeechService(boundary=boundary, tts=Provider(), stt=Provider())
    stream = service.synthesize(bounded_call, "hello") if kind == "tts" else service.transcribe(bounded_call, chunks())
    with pytest.raises(TimeoutError):
        _ = [chunk async for chunk in stream]
    assert closed == (["provider"] if kind == "tts" else ["provider", "input"])
    assert len(boundary.finished) == 1
    assert boundary.finished[0][1].status == "failed" and boundary.finished[0][1].provider_usage is None
