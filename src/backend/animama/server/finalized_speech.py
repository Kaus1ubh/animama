"""Audio framing for finalized speech (Gemini).

Gemini speaks each segment's text as written and reads numbers and symbols
itself. This module pushes its 24 kHz 16-bit little-endian PCM to the browser in
frames of at least 0.2 s.
"""

from __future__ import annotations

FINALIZED_TTS_PCM_FRAME_BYTES = 9600
"""0.2 s of 24 kHz 16-bit mono PCM; smaller provider chunks are coalesced to this size."""
FINALIZED_TTS_OUTPUT_FORMAT = "pcm_24000"


def pop_pcm_audio_frame(audio_buffer: bytearray, *, force: bool = False) -> bytes | None:
    """Take whole samples from ``audio_buffer`` once a frame's worth is buffered, or all when ``force``."""

    if not force and len(audio_buffer) < FINALIZED_TTS_PCM_FRAME_BYTES:
        return None
    flushable_length = len(audio_buffer) - (len(audio_buffer) % 2)
    if flushable_length <= 0:
        return None
    frame = bytes(audio_buffer[:flushable_length])
    del audio_buffer[:flushable_length]
    return frame


__all__ = [
    "FINALIZED_TTS_OUTPUT_FORMAT",
    "FINALIZED_TTS_PCM_FRAME_BYTES",
    "pop_pcm_audio_frame",
]
