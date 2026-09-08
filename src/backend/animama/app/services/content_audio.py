"""Bounded structural validation for browser-supported audio content."""

from __future__ import annotations

import math
import struct
from dataclasses import dataclass
from typing import BinaryIO

from .content_file_validation import ContentFileInvalidError, ContentFileValidation

MAX_AUDIO_DURATION_SECONDS = 60 * 60
MIN_AUDIO_SAMPLE_RATE = 8_000
MAX_AUDIO_SAMPLE_RATE = 96_000
MAX_AUDIO_CHANNELS = 2
_MPEG_BITRATES = {
    1: {
        1: (32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320),
        2: (32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256),
    },
    2: {
        1: (8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160),
        2: (8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160),
    },
}
_MPEG_SAMPLE_RATES = {
    1: (44_100, 48_000, 32_000),
    2: (22_050, 24_000, 16_000),
    25: (11_025, 12_000, 8_000),
}


@dataclass(frozen=True, slots=True)
class _AudioFacts:
    container: str
    codec: str
    duration_seconds: float
    channels: int
    sample_rate_hz: int
    stream_count: int = 1

    def validation(self, media_type: str) -> ContentFileValidation:
        return ContentFileValidation(
            media_type,
            {
                "container": self.container,
                "codec": self.codec,
                "duration_seconds": round(self.duration_seconds, 6),
                "channels": self.channels,
                "sample_rate_hz": self.sample_rate_hz,
                "stream_count": self.stream_count,
            },
        )


def validate_audio_stream(
    *,
    extension: str,
    content: BinaryIO,
    size_bytes: int,
) -> ContentFileValidation:
    """Parse a complete WAV, MP3, or Ogg stream and return trusted metadata."""

    if size_bytes < 1:
        raise ContentFileInvalidError(field="file", reason="audio_invalid_stream")
    content.seek(0)
    payload = content.read(size_bytes + 1)
    if len(payload) != size_bytes:
        raise ContentFileInvalidError(field="size_bytes", reason="mismatch")
    normalized = extension.lower().lstrip(".")
    if normalized == "wav":
        return _validate_wav(payload).validation("audio/wav")
    if normalized == "mp3":
        return _validate_mp3(payload).validation("audio/mpeg")
    if normalized == "ogg":
        return _validate_ogg(payload).validation("audio/ogg")
    raise ContentFileInvalidError(field="file", reason="audio_unsupported_container")


def _validate_wav(payload: bytes) -> _AudioFacts:
    if len(payload) < 44 or payload[:4] != b"RIFF" or payload[8:12] != b"WAVE":
        raise ContentFileInvalidError(field="file", reason="audio_invalid_stream")
    if struct.unpack_from("<I", payload, 4)[0] + 8 != len(payload):
        raise ContentFileInvalidError(field="file", reason="audio_invalid_stream")

    offset = 12
    format_chunk: bytes | None = None
    data_bytes = 0
    while offset < len(payload):
        if offset + 8 > len(payload):
            raise ContentFileInvalidError(field="file", reason="audio_invalid_stream")
        chunk_id = payload[offset : offset + 4]
        chunk_size = struct.unpack_from("<I", payload, offset + 4)[0]
        offset += 8
        end = offset + chunk_size
        if end > len(payload):
            raise ContentFileInvalidError(field="file", reason="audio_invalid_stream")
        if chunk_id == b"fmt ":
            if format_chunk is not None:
                raise ContentFileInvalidError(field="file", reason="audio_invalid_stream")
            format_chunk = payload[offset:end]
        elif chunk_id == b"data":
            data_bytes += chunk_size
        offset = end + (chunk_size & 1)
    if offset != len(payload) or format_chunk is None or data_bytes < 1 or len(format_chunk) < 16:
        raise ContentFileInvalidError(field="file", reason="audio_invalid_stream")

    codec_id, channels, sample_rate, byte_rate, block_align, bits = struct.unpack_from("<HHIIHH", format_chunk, 0)
    if codec_id == 1 and bits in {8, 16, 24, 32}:
        codec = f"pcm_s{bits}le" if bits > 8 else "pcm_u8"
    elif codec_id == 3 and bits == 32:
        codec = "pcm_f32le"
    else:
        raise ContentFileInvalidError(field="file", reason="audio_unsupported_codec")
    expected_align = channels * bits // 8
    if (
        expected_align < 1
        or block_align != expected_align
        or byte_rate != sample_rate * block_align
        or data_bytes % block_align
    ):
        raise ContentFileInvalidError(field="file", reason="audio_invalid_stream")
    duration = data_bytes / byte_rate
    _validate_audio_limits(duration, channels, sample_rate)
    return _AudioFacts("wav", codec, duration, channels, sample_rate)


def _validate_mp3(payload: bytes) -> _AudioFacts:
    offset = _skip_id3v2(payload)
    end = len(payload) - 128 if payload[-128:-125] == b"TAG" else len(payload)
    frames = 0
    duration = 0.0
    sample_rate: int | None = None
    channels: int | None = None
    mpeg_version: int | None = None
    while offset < end:
        if offset + 4 > end:
            raise ContentFileInvalidError(field="file", reason="audio_invalid_stream")
        header = int.from_bytes(payload[offset : offset + 4], "big")
        facts = _mp3_frame_facts(header)
        if facts is None:
            raise ContentFileInvalidError(field="file", reason="audio_unsupported_codec")
        version, rate, frame_channels, samples, frame_size = facts
        if offset + frame_size > end:
            raise ContentFileInvalidError(field="file", reason="audio_invalid_stream")
        if sample_rate is None:
            sample_rate, channels, mpeg_version = rate, frame_channels, version
        elif (sample_rate, channels, mpeg_version) != (rate, frame_channels, version):
            raise ContentFileInvalidError(field="file", reason="audio_multiple_streams")
        duration += samples / rate
        frames += 1
        offset += frame_size
    if frames == 0 or offset != end or sample_rate is None or channels is None:
        raise ContentFileInvalidError(field="file", reason="audio_invalid_stream")
    _validate_audio_limits(duration, channels, sample_rate)
    return _AudioFacts("mp3", "mpeg-layer-iii", duration, channels, sample_rate)


def _skip_id3v2(payload: bytes) -> int:
    if not payload.startswith(b"ID3"):
        return 0
    if len(payload) < 10 or any(byte & 0x80 for byte in payload[6:10]):
        raise ContentFileInvalidError(field="file", reason="audio_invalid_stream")
    tag_size = 0
    for byte in payload[6:10]:
        tag_size = (tag_size << 7) | byte
    size = 10 + tag_size
    # Footer-present ID3v2.4 tags consume ten additional bytes.
    if payload[5] & 0x10:
        size += 10
    if size > len(payload):
        raise ContentFileInvalidError(field="file", reason="audio_invalid_stream")
    return size


def _mp3_frame_facts(header: int) -> tuple[int, int, int, int, int] | None:
    if header >> 21 != 0x7FF:
        return None
    version_bits = (header >> 19) & 0x3
    layer_bits = (header >> 17) & 0x3
    bitrate_index = (header >> 12) & 0xF
    sample_index = (header >> 10) & 0x3
    padding = (header >> 9) & 1
    if version_bits == 1 or layer_bits != 1 or bitrate_index in {0, 15} or sample_index == 3:
        return None
    version = {3: 1, 2: 2, 0: 25}[version_bits]
    bitrate_group = 1 if version == 1 else 2
    bitrate = _MPEG_BITRATES[bitrate_group][1 if version == 1 else 2][bitrate_index - 1] * 1000
    sample_rate = _MPEG_SAMPLE_RATES[version][sample_index]
    samples = 1152 if version == 1 else 576
    coefficient = 144 if version == 1 else 72
    frame_size = coefficient * bitrate // sample_rate + padding
    channel_mode = (header >> 6) & 0x3
    return version, sample_rate, 1 if channel_mode == 3 else 2, samples, frame_size


def _validate_ogg(payload: bytes) -> _AudioFacts:
    offset = 0
    serial: int | None = None
    expected_sequence = 0
    packet = bytearray()
    leading_packets: list[bytes] = []
    packet_count = 0
    final_granule: int | None = None
    saw_bos = False
    saw_eos = False
    while offset < len(payload):
        if saw_eos:
            raise ContentFileInvalidError(field="file", reason="audio_invalid_stream")
        if offset + 27 > len(payload) or payload[offset : offset + 4] != b"OggS":
            raise ContentFileInvalidError(field="file", reason="audio_invalid_stream")
        version = payload[offset + 4]
        header_type = payload[offset + 5]
        granule, page_serial, sequence, _checksum = struct.unpack_from("<QIII", payload, offset + 6)
        segment_count = payload[offset + 26]
        header_end = offset + 27 + segment_count
        if version != 0 or header_end > len(payload):
            raise ContentFileInvalidError(field="file", reason="audio_invalid_stream")
        lacing = payload[offset + 27 : header_end]
        body_length = sum(lacing)
        page_end = header_end + body_length
        if page_end > len(payload) or not _valid_ogg_crc(payload[offset:page_end]):
            raise ContentFileInvalidError(field="file", reason="audio_invalid_stream")
        if serial is None:
            serial = page_serial
        if page_serial != serial:
            raise ContentFileInvalidError(field="file", reason="audio_multiple_streams")
        if sequence != expected_sequence:
            raise ContentFileInvalidError(field="file", reason="audio_invalid_stream")
        if bool(header_type & 0x01) != bool(packet):
            raise ContentFileInvalidError(field="file", reason="audio_invalid_stream")
        if expected_sequence == 0 and not header_type & 0x02:
            raise ContentFileInvalidError(field="file", reason="audio_invalid_stream")
        if header_type & 0x02:
            if saw_bos:
                raise ContentFileInvalidError(field="file", reason="audio_multiple_streams")
            saw_bos = True
        if header_type & 0x04:
            saw_eos = True
            final_granule = granule

        body_offset = header_end
        for length in lacing:
            packet.extend(payload[body_offset : body_offset + length])
            body_offset += length
            if length < 255:
                packet_count += 1
                if len(leading_packets) < 3:
                    leading_packets.append(bytes(packet))
                packet.clear()
        offset = page_end
        expected_sequence += 1
    if (
        offset != len(payload)
        or packet
        or not saw_bos
        or not saw_eos
        or final_granule in {None, 0xFFFFFFFFFFFFFFFF}
        or len(leading_packets) < 3
    ):
        raise ContentFileInvalidError(field="file", reason="audio_invalid_stream")

    first_packet = leading_packets[0]
    if first_packet.startswith(b"OpusHead") and len(first_packet) >= 19:
        if not leading_packets[1].startswith(b"OpusTags") or packet_count < 3:
            raise ContentFileInvalidError(field="file", reason="audio_invalid_stream")
        channels = first_packet[9]
        sample_rate = 48_000
        pre_skip = struct.unpack_from("<H", first_packet, 10)[0]
        if first_packet[8] != 1:
            raise ContentFileInvalidError(field="file", reason="audio_unsupported_codec")
        duration = max(0, (int(final_granule or 0) - pre_skip)) / sample_rate
        codec = "opus"
    elif first_packet.startswith(b"\x01vorbis") and len(first_packet) >= 30:
        if (
            struct.unpack_from("<I", first_packet, 7)[0] != 0
            or not first_packet[29] & 1
            or not leading_packets[1].startswith(b"\x03vorbis")
            or not leading_packets[2].startswith(b"\x05vorbis")
            or packet_count < 4
        ):
            raise ContentFileInvalidError(field="file", reason="audio_invalid_stream")
        channels = first_packet[11]
        sample_rate = struct.unpack_from("<I", first_packet, 12)[0]
        duration = int(final_granule or 0) / sample_rate if sample_rate else math.inf
        codec = "vorbis"
    else:
        raise ContentFileInvalidError(field="file", reason="audio_unsupported_codec")
    _validate_audio_limits(duration, channels, sample_rate)
    return _AudioFacts("ogg", codec, duration, channels, sample_rate)


def _valid_ogg_crc(page: bytes) -> bool:
    expected = struct.unpack_from("<I", page, 22)[0]
    mutable = bytearray(page)
    mutable[22:26] = b"\x00\x00\x00\x00"
    crc = 0
    for byte in mutable:
        crc ^= byte << 24
        for _ in range(8):
            crc = ((crc << 1) ^ 0x04C11DB7) & 0xFFFFFFFF if crc & 0x80000000 else (crc << 1) & 0xFFFFFFFF
    return crc == expected


def _validate_audio_limits(duration: float, channels: int, sample_rate: int) -> None:
    if channels < 1 or channels > MAX_AUDIO_CHANNELS:
        raise ContentFileInvalidError(field="file", reason="audio_channel_limit")
    if sample_rate < MIN_AUDIO_SAMPLE_RATE or sample_rate > MAX_AUDIO_SAMPLE_RATE:
        raise ContentFileInvalidError(field="file", reason="audio_sample_rate_limit")
    if not math.isfinite(duration) or duration <= 0:
        raise ContentFileInvalidError(field="file", reason="audio_invalid_stream")
    if duration > MAX_AUDIO_DURATION_SECONDS:
        raise ContentFileInvalidError(field="file", reason="audio_duration_limit")


__all__ = [
    "MAX_AUDIO_CHANNELS",
    "MAX_AUDIO_DURATION_SECONDS",
    "MAX_AUDIO_SAMPLE_RATE",
    "MIN_AUDIO_SAMPLE_RATE",
    "validate_audio_stream",
]
