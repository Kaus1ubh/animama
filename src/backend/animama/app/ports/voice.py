from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Protocol

from animama.domain.audio import AudioChunk, SynthesisChunk, TranscriptSegment


class SpeechToTextProvider(Protocol):
    """Streaming speech-to-text provider."""

    async def stream(
        self, chunks: AsyncIterator[AudioChunk]
    ) -> AsyncIterator[TranscriptSegment]:  # pragma: no cover - protocol
        ...

    async def aclose(self) -> None:  # pragma: no cover - protocol
        ...


class TextToSpeechProvider(Protocol):
    """Streaming text-to-speech provider."""

    async def synthesize(
        self, text: str, *, voice_id: str | None = None, lang: str | None = None, speed: float | None = None
    ) -> AsyncIterator[SynthesisChunk]:  # pragma: no cover - protocol
        ...

    async def synthesize_full(
        self, text: str, *, voice_id: str | None = None, lang: str | None = None, speed: float | None = None
    ) -> SynthesisChunk:  # pragma: no cover - protocol
        ...

    async def aclose(self) -> None:  # pragma: no cover - protocol
        ...
