"""Text and audio framing shared by the finalized speech providers (ElevenLabs and Gemini).

Both speak an English segment's gruut-normalized text, so lip-sync phonemes match
the words heard, and other languages as written. Both push 24 kHz 16-bit
little-endian PCM to the browser in frames of at least 0.2 s.
"""

from __future__ import annotations

from dataclasses import dataclass

from animama.app.gruut_text import build_gruut_sse_text, gruut_prepares_text
from animama.product_http.chat.sse_events import TTS_TEXT_BASIS_GRUUT_TEXT_WITH_WS

FINALIZED_TTS_PCM_FRAME_BYTES = 9600
"""0.2 s of 24 kHz 16-bit mono PCM; smaller provider chunks are coalesced to this size."""
FINALIZED_TTS_OUTPUT_FORMAT = "pcm_24000"


@dataclass(frozen=True, slots=True)
class FinalizedTtsText:
    """The text a finalized provider speaks.

    ``gruut_prepared`` is true when gruut already verbalized its numbers and
    symbols (English); text sent as written leaves that to the provider.
    """

    text: str
    gruut_prepared: bool


def finalized_tts_text(text: str, *, text_basis: str) -> FinalizedTtsText:
    """The text to speak: prepared gruut text as is; English normalized through gruut; other text as written."""

    if text_basis == TTS_TEXT_BASIS_GRUUT_TEXT_WITH_WS:
        return FinalizedTtsText(text=text, gruut_prepared=True)
    if gruut_prepares_text(text):
        gruut_payload = build_gruut_sse_text(text, lang="en_US", tokenized_text_source="text_with_ws")
        gruut_text = gruut_payload.get("tokenized_text") if gruut_payload else None
        if isinstance(gruut_text, str) and gruut_text.strip():
            return FinalizedTtsText(text=gruut_text.strip(), gruut_prepared=True)
    return FinalizedTtsText(text=text, gruut_prepared=False)


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
    "FinalizedTtsText",
    "finalized_tts_text",
    "pop_pcm_audio_frame",
]
