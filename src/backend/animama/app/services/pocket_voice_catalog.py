from __future__ import annotations

import math
import struct
from dataclasses import dataclass
from typing import Final

MAX_POCKET_VOICE_CATALOG_BYTES: Final[int] = 25 * 1024 * 1024
MAX_POCKET_VOICES: Final[int] = 256
MAX_POCKET_VOICE_FRAMES: Final[int] = 4096
VOICE_NAME_BYTES: Final[int] = 32
VOICE_EMBEDDING_DIM: Final[int] = 1024
REQUIRED_BASE_VOICE_KEY: Final[str] = "neutral"


@dataclass(frozen=True)
class ParsedPocketVoiceCatalogEntry:
    name: str
    num_frames: int
    embedding_dim: int


def parse_pocket_voice_catalog_bytes(
    payload: bytes,
) -> dict[str, ParsedPocketVoiceCatalogEntry]:
    if len(payload) > MAX_POCKET_VOICE_CATALOG_BYTES:
        raise ValueError("Voice catalog exceeds the supported byte limit")
    if len(payload) < 4:
        raise ValueError("Voice catalog is truncated")

    voice_count = int.from_bytes(payload[0:4], byteorder="little", signed=False)
    if not 1 <= voice_count <= MAX_POCKET_VOICES:
        raise ValueError("Voice catalog has an unsupported voice count")
    offset = 4
    parsed: dict[str, ParsedPocketVoiceCatalogEntry] = {}

    for _ in range(voice_count):
        if offset + VOICE_NAME_BYTES + 8 > len(payload):
            raise ValueError("Voice catalog entry header is truncated")

        name_bytes = payload[offset : offset + VOICE_NAME_BYTES]
        offset += VOICE_NAME_BYTES

        name = name_bytes.split(b"\x00", 1)[0].decode("utf-8", errors="strict").strip()
        if not name:
            raise ValueError("Voice catalog contains an empty voice name")
        if name in parsed:
            raise ValueError(f"Voice catalog contains a duplicate voice name: {name}")

        num_frames = int.from_bytes(payload[offset : offset + 4], byteorder="little", signed=False)
        offset += 4
        embedding_dim = int.from_bytes(payload[offset : offset + 4], byteorder="little", signed=False)
        offset += 4

        if num_frames <= 0:
            raise ValueError(f"Voice catalog entry {name} has no embedding frames")
        if num_frames > MAX_POCKET_VOICE_FRAMES:
            raise ValueError(f"Voice catalog entry {name} exceeds the supported frame limit")
        if embedding_dim != VOICE_EMBEDDING_DIM:
            raise ValueError(
                f"Voice catalog entry {name} uses embedding dim {embedding_dim}, expected {VOICE_EMBEDDING_DIM}"
            )

        embedding_size_bytes = num_frames * embedding_dim * 4
        if offset + embedding_size_bytes > len(payload):
            raise ValueError(f"Voice catalog entry {name} payload is truncated")
        values = memoryview(payload)[offset : offset + embedding_size_bytes]
        if any(not math.isfinite(value) for (value,) in struct.iter_unpack("<f", values)):
            raise ValueError(f"Voice catalog entry {name} contains non-finite values")
        offset += embedding_size_bytes

        parsed[name] = ParsedPocketVoiceCatalogEntry(
            name=name,
            num_frames=num_frames,
            embedding_dim=embedding_dim,
        )

    if offset != len(payload):
        raise ValueError("Voice catalog contains trailing bytes")

    return parsed


def validate_pocket_voice_catalog_bytes(
    payload: bytes,
) -> dict[str, ParsedPocketVoiceCatalogEntry]:
    parsed = parse_pocket_voice_catalog_bytes(payload)
    if REQUIRED_BASE_VOICE_KEY not in parsed:
        raise ValueError(f"Voice catalog must include {REQUIRED_BASE_VOICE_KEY}")
    return parsed


__all__ = [
    "MAX_POCKET_VOICE_CATALOG_BYTES",
    "ParsedPocketVoiceCatalogEntry",
    "REQUIRED_BASE_VOICE_KEY",
    "VOICE_EMBEDDING_DIM",
    "VOICE_NAME_BYTES",
    "parse_pocket_voice_catalog_bytes",
    "validate_pocket_voice_catalog_bytes",
]
