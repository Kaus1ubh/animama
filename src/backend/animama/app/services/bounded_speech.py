"""Bounded server audio streaming over the existing provider ports."""

from __future__ import annotations

import asyncio
from collections.abc import AsyncGenerator, AsyncIterator
from typing import Literal

from animama.app.ports.voice import (
    SpeechCall,
    SpeechCallBoundary,
    SpeechCallOutcome,
    SpeechToTextProvider,
    TextToSpeechProvider,
)
from animama.domain.audio import AudioChunk, SynthesisChunk, TranscriptSegment


async def _close(stream: object) -> None:
    close = getattr(stream, "aclose", None)
    if close is not None:
        await close()


class BoundedSpeechService:
    """One admitted call, finite transport, cancellation, and one outcome.

    Providers must not internally retry paid calls: a retry needs a new call ID
    and admission. The composition owns provider selection/lifetime. Legacy
    providers expose no billing receipt, so these outcomes retain unknown
    provider usage even after a successful stream. No client token is returned.
    """

    def __init__(
        self,
        *,
        boundary: SpeechCallBoundary,
        stt: SpeechToTextProvider | None = None,
        tts: TextToSpeechProvider | None = None,
    ) -> None:
        self._boundary = boundary
        self._stt = stt
        self._tts = tts

    async def synthesize(self, call: SpeechCall, text: str) -> AsyncGenerator[SynthesisChunk, None]:
        if self._tts is None:
            raise ValueError("TTS provider is unavailable")
        if not text or len(text) > call.limits.max_input_characters:
            raise ValueError("Speech text exceeds the admitted limit")
        await self._boundary.admit(call, kind="tts")
        status: Literal["completed", "failed", "cancelled"] = "failed"
        output_bytes = 0
        stream = None
        try:
            stream = self._tts.synthesize(text, voice_id=call.voice_id, lang=call.language, speed=call.speed)
            async with asyncio.timeout(call.limits.timeout_seconds):
                async for chunk in stream:
                    output_bytes += len(chunk.data)
                    if output_bytes > call.limits.max_output_bytes:
                        raise ValueError("Speech output exceeds the admitted byte limit")
                    yield chunk
                status = "completed"
        except (asyncio.CancelledError, GeneratorExit):
            status = "cancelled"
            raise
        finally:
            try:
                async with asyncio.timeout(call.limits.cleanup_timeout_seconds):
                    await _close(stream)
            finally:
                async with asyncio.timeout(call.limits.cleanup_timeout_seconds):
                    await self._boundary.finish(
                        call, SpeechCallOutcome(status=status, input_characters=len(text), output_bytes=output_bytes)
                    )

    async def transcribe(
        self, call: SpeechCall, chunks: AsyncIterator[AudioChunk]
    ) -> AsyncGenerator[TranscriptSegment, None]:
        if self._stt is None:
            raise ValueError("STT provider is unavailable")
        await self._boundary.admit(call, kind="stt")
        status: Literal["completed", "failed", "cancelled"] = "failed"
        input_bytes = 0
        input_seconds = 0.0
        output_bytes = 0

        async def bounded_input() -> AsyncIterator[AudioChunk]:
            nonlocal input_bytes, input_seconds
            async for chunk in chunks:
                if chunk.sample_rate <= 0 or chunk.channels <= 0 or len(chunk.data) % (2 * chunk.channels):
                    raise ValueError("Speech input must contain complete PCM16 frames")
                size = len(chunk.data)
                duration = size / (chunk.sample_rate * chunk.channels * 2)
                if (
                    input_bytes + size > call.limits.max_input_bytes
                    or input_seconds + duration > call.limits.max_input_audio_seconds
                ):
                    raise ValueError("Speech input exceeds the admitted audio limit")
                input_bytes += size
                input_seconds += duration
                yield chunk

        source = bounded_input()
        stream = None
        try:
            stream = self._stt.stream(source)
            async with asyncio.timeout(call.limits.timeout_seconds):
                async for segment in stream:
                    output_bytes += len(segment.text.encode("utf-8"))
                    if output_bytes > call.limits.max_output_bytes:
                        raise ValueError("Speech output exceeds the admitted byte limit")
                    yield segment
                status = "completed"
        except (asyncio.CancelledError, GeneratorExit):
            status = "cancelled"
            raise
        finally:
            try:
                try:
                    async with asyncio.timeout(call.limits.cleanup_timeout_seconds):
                        await _close(stream)
                finally:
                    async with asyncio.timeout(call.limits.cleanup_timeout_seconds):
                        await _close(source)
                        await _close(chunks)
            finally:
                async with asyncio.timeout(call.limits.cleanup_timeout_seconds):
                    await self._boundary.finish(
                        call,
                        SpeechCallOutcome(status=status, input_audio_seconds=input_seconds, output_bytes=output_bytes),
                    )
