from __future__ import annotations

from dataclasses import dataclass

import numpy as np


def resample_pcm16(
    data: bytes,
    src_rate: int,
    dst_rate: int,
) -> bytes:
    """Resample PCM16 audio data from src_rate to dst_rate.

    Uses linear interpolation for simplicity. For downsampling (e.g., 48kHz→16kHz),
    this provides acceptable quality for voice applications.

    Args:
        data: PCM16 audio bytes (little-endian int16)
        src_rate: Source sample rate (e.g., 48000)
        dst_rate: Destination sample rate (e.g., 16000)

    Returns:
        Resampled PCM16 audio bytes
    """
    if src_rate == dst_rate:
        return data

    # Convert bytes to int16 array
    samples = np.frombuffer(data, dtype=np.int16)

    # Calculate new length
    duration = len(samples) / src_rate
    new_length = int(duration * dst_rate)

    if new_length == 0:
        return b""

    # Create interpolation indices
    src_indices = np.linspace(0, len(samples) - 1, new_length)

    # Linear interpolation
    resampled = np.interp(src_indices, np.arange(len(samples)), samples.astype(np.float32))

    # Convert back to int16
    return resampled.astype(np.int16).tobytes()


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
