from __future__ import annotations

from dataclasses import dataclass


@dataclass(slots=True)
class AudioChunk:
    """Raw audio chunk (typically PCM16) streamed from the client."""

    data: bytes
    sample_rate: int = 16000
    channels: int = 1
    seq: int | None = None


@dataclass(slots=True)
class TranscriptSegment:
    """Speech-to-text segment produced by the STT provider."""

    text: str
    is_final: bool = False
    start_ms: int | None = None
    end_ms: int | None = None
    seq: int | None = None


@dataclass(slots=True)
class SynthesisChunk:
    """Text-to-speech audio chunk produced by the TTS provider."""

    data: bytes
    sample_rate: int = 24000
    channels: int = 1
    format: str = "audio/pcm16"
    seq: int | None = None
