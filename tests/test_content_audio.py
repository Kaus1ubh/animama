from __future__ import annotations

import base64
import io
import struct
import zlib

import pytest

from animama.app.services.content_audio import validate_audio_stream
from animama.app.services.content_file_validation import ContentFileInvalidError as ContentFileInvalidError

# A complete 250ms stereo Vorbis stream generated from silence, not third-party
# recordings. Generated once with soundfile.write(path, numpy.zeros((12000, 2)),
# 48000, format="OGG", subtype="VORBIS"); compressed here to keep tests independent
# of system encoders, optional Python audio packages, and private content files.
_VORBIS_SILENCE_ZLIB_BASE64 = (
    "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"
)


def _wav(*, codec: int = 1, bits: int = 16, channels: int = 1) -> bytes:
    sample_rate = 8_000
    block_align = channels * bits // 8
    data = b"\0" * (sample_rate * block_align // 10)
    format_chunk = struct.pack(
        "<HHIIHH",
        codec,
        channels,
        sample_rate,
        sample_rate * block_align,
        block_align,
        bits,
    )
    body = b"fmt " + struct.pack("<I", len(format_chunk)) + format_chunk + b"data" + struct.pack("<I", len(data)) + data
    return b"RIFF" + struct.pack("<I", len(body) + 4) + b"WAVE" + body


def _mp3_frame() -> bytes:
    header = (0x7FF << 21) | (3 << 19) | (1 << 17) | (1 << 16) | (9 << 12)
    frame_size = 144 * 128_000 // 44_100
    return header.to_bytes(4, "big") + b"\0" * (frame_size - 4)


@pytest.mark.parametrize(
    ("payload", "extension", "container", "codec"),
    [
        (_wav(), "wav", "wav", "pcm_s16le"),
        (_wav(codec=3, bits=32), "wav", "wav", "pcm_f32le"),
        (_mp3_frame() * 3, "mp3", "mp3", "mpeg-layer-iii"),
    ],
)
def test_audio_parser_records_complete_trusted_metadata(
    payload: bytes,
    extension: str,
    container: str,
    codec: str,
) -> None:
    result = validate_audio_stream(
        extension=extension,
        content=io.BytesIO(payload),
        size_bytes=len(payload),
    )

    assert result.metadata["container"] == container
    assert result.metadata["codec"] == codec
    assert result.metadata["duration_seconds"] > 0
    assert result.metadata["stream_count"] == 1


def test_audio_parser_accepts_complete_generated_vorbis_ogg() -> None:
    payload = zlib.decompress(base64.b64decode(_VORBIS_SILENCE_ZLIB_BASE64))

    result = validate_audio_stream(
        extension="ogg",
        content=io.BytesIO(payload),
        size_bytes=len(payload),
    )

    assert result.metadata == {
        "container": "ogg",
        "codec": "vorbis",
        "duration_seconds": pytest.approx(0.25),
        "channels": 2,
        "sample_rate_hz": 48_000,
        "stream_count": 1,
    }


@pytest.mark.parametrize(
    ("payload", "extension", "reason"),
    [
        (_wav(codec=6), "wav", "audio_unsupported_codec"),
        (_wav()[:-1], "wav", "audio_invalid_stream"),
        (_mp3_frame()[:-1], "mp3", "audio_invalid_stream"),
        (b"OggS" + b"\0" * 40, "ogg", "audio_invalid_stream"),
    ],
)
def test_audio_parser_rejects_unsupported_or_incomplete_streams(
    payload: bytes,
    extension: str,
    reason: str,
) -> None:
    with pytest.raises(ContentFileInvalidError) as caught:
        validate_audio_stream(
            extension=extension,
            content=io.BytesIO(payload),
            size_bytes=len(payload),
        )

    assert caught.value.reason == reason
