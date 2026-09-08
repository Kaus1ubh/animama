from __future__ import annotations

from collections.abc import AsyncIterator

from animama.app.ports.voice import SpeechToTextProvider, TextToSpeechProvider
from animama.domain.audio import AudioChunk, SynthesisChunk, TranscriptSegment


class EchoSpeechToTextProvider(SpeechToTextProvider):
    """Stub STT provider that returns a synthetic transcript summarizing received bytes."""

    def __init__(self, sample_rate: int = 16000, channels: int = 1) -> None:
        self.sample_rate = sample_rate
        self.channels = channels

    async def stream(self, chunks: AsyncIterator[AudioChunk]) -> AsyncIterator[TranscriptSegment]:
        total = 0
        seq = 0
        async for chunk in chunks:
            total += len(chunk.data)
            seq += 1
            # Emit a minimal partial to exercise the pipeline
            yield TranscriptSegment(
                text=f"[stub-partial bytes={total}]",
                is_final=False,
                start_ms=None,
                end_ms=None,
                seq=seq,
            )
        yield TranscriptSegment(
            text=f"[stub-final bytes={total}]",
            is_final=True,
            start_ms=None,
            end_ms=None,
            seq=seq + 1,
        )

    async def aclose(self) -> None:
        return None


class EchoTextToSpeechProvider(TextToSpeechProvider):
    """Stub TTS provider that returns UTF-8 bytes of the text (not real audio)."""

    def __init__(self, sample_rate: int = 16000, channels: int = 1) -> None:
        self.sample_rate = sample_rate
        self.channels = channels

    async def synthesize(
        self, text: str, *, voice_id: str | None = None, lang: str | None = None, speed: float | None = None
    ) -> AsyncIterator[SynthesisChunk]:
        data = text.encode("utf-8")
        yield SynthesisChunk(
            data=data,
            sample_rate=self.sample_rate,
            channels=self.channels,
            format="text/utf-8",
            seq=0,
        )

    async def synthesize_full(
        self, text: str, *, voice_id: str | None = None, lang: str | None = None, speed: float | None = None
    ) -> SynthesisChunk:
        """Non-streaming variant that returns a single chunk."""
        data = text.encode("utf-8")
        return SynthesisChunk(
            data=data,
            sample_rate=self.sample_rate,
            channels=self.channels,
            format="text/utf-8",
            seq=0,
        )

    async def aclose(self) -> None:
        return None
