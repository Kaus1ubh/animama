from __future__ import annotations

import pytest

from animama.server.pocket_voice_catalog import (
    parse_pocket_voice_catalog_bytes,
    validate_pocket_voice_catalog_bytes,
)


def _build_catalog_bytes(*, voices: tuple[tuple[str, int, int], ...]) -> bytes:
    payload = bytearray()
    payload.extend(len(voices).to_bytes(4, byteorder="little", signed=False))
    for name, num_frames, embedding_dim in voices:
        name_bytes = name.encode("utf-8")
        payload.extend(name_bytes)
        payload.extend(b"\x00" * (32 - len(name_bytes)))
        payload.extend(num_frames.to_bytes(4, byteorder="little", signed=False))
        payload.extend(embedding_dim.to_bytes(4, byteorder="little", signed=False))
        payload.extend(b"\x00" * (num_frames * embedding_dim * 4))
    return bytes(payload)


def test_parse_pocket_voice_catalog_bytes_returns_entries() -> None:
    payload = _build_catalog_bytes(
        voices=(
            ("neutral", 1, 1024),
            ("joy_1", 2, 1024),
        )
    )

    parsed = parse_pocket_voice_catalog_bytes(payload)

    assert set(parsed) == {"neutral", "joy_1"}
    assert parsed["neutral"].num_frames == 1
    assert parsed["joy_1"].num_frames == 2


def test_validate_pocket_voice_catalog_requires_neutral() -> None:
    payload = _build_catalog_bytes(voices=(("joy_1", 1, 1024),))

    with pytest.raises(ValueError, match="must include neutral"):
        validate_pocket_voice_catalog_bytes(payload)


def test_parse_pocket_voice_catalog_rejects_wrong_embedding_dim() -> None:
    payload = _build_catalog_bytes(voices=(("neutral", 1, 512),))

    with pytest.raises(ValueError, match="expected 1024"):
        parse_pocket_voice_catalog_bytes(payload)
