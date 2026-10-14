"""ASCII path names derived from display names in any script.

Display names are stored unchanged; only file and folder names fold to ASCII.
Accents fold away. When folding would drop a letter or digit (Japanese, Korean,
Chinese and other scripts), a short stable hash of the name keeps different
names apart. The web app derives Gesture semantic keys and Local logical keys
with the same hash (``src/frontend/web/src/lib/content/nameIdentifiers.ts``);
``src/frontend/web/src/lib/content/fixtures/name-identifiers.json`` pins both.
"""

from __future__ import annotations

import re
import unicodedata

_FNV_OFFSET = 0x811C9DC5
_FNV_PRIME = 0x01000193
_BASE36 = "0123456789abcdefghijklmnopqrstuvwxyz"


def name_hash(value: str) -> str:
    """FNV-1a (32-bit) of the trimmed NFC UTF-8 bytes as 7 base-36 characters."""

    digest = _FNV_OFFSET
    for byte in unicodedata.normalize("NFC", value.strip()).encode():
        digest = ((digest ^ byte) * _FNV_PRIME) & 0xFFFFFFFF
    encoded = ""
    while digest:
        digest, remainder = divmod(digest, 36)
        encoded = _BASE36[remainder] + encoded
    return encoded.rjust(7, "0")


def without_marks(value: str) -> str:
    """NFKD with combining marks removed, so accented letters fold to ASCII."""

    return "".join(ch for ch in unicodedata.normalize("NFKD", value) if not unicodedata.category(ch).startswith("M"))


def folding_drops_characters(value: str) -> bool:
    """True when ASCII folding would drop a letter or digit (any non-Latin script)."""

    return any(not ch.isascii() and unicodedata.category(ch)[0] in "LN" for ch in without_marks(value))


def portable_name(value: str, *, separator: str, stem: str, limit: int) -> str:
    """Fold ``value`` to ASCII words, adding its hash when letters were dropped.

    Characters outside ``[A-Za-z0-9._ -]`` become spaces and the result is trimmed
    to start and end with a letter or digit; callers normalize case and spacing.
    """

    folded = re.sub(r"[^A-Za-z0-9._ -]+", " ", without_marks(value))
    folded = re.sub(r"^[^A-Za-z0-9]+|[^A-Za-z0-9]+$", "", folded)
    if not folding_drops_characters(value):
        return folded
    suffix = f"{separator}{name_hash(value)}"
    return f"{(folded or stem)[: limit - len(suffix)]}{suffix}"


__all__ = ["folding_drops_characters", "name_hash", "portable_name", "without_marks"]
