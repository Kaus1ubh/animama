"""Stable, owner-edited Anima definition rules and the Anima's protected memory files."""

from __future__ import annotations

import unicodedata

ANIMA_IDENTITY_PATH = "IDENTITY.md"
ANIMA_IDENTITY_KIND = "anima_identity"
ANIMA_IDENTITY_MAX_BYTES = 32 * 1024
# Relationship memory kept by one Anima beside its identity. It is not part of
# the definition: edits never advance the aggregate revision.
ANIMA_MEMORIES_PATH = "MEMORIES.md"
ANIMA_MEMORIES_KIND = "anima_memories"
ANIMA_MEMORIES_MAX_BYTES = 16 * 1024
_ANIMA_MEMORIES_ERROR_PREFIX = "anima_memories"
# Error code for a MEMORIES.md write over its size limit.
ANIMA_MEMORIES_TOO_LARGE = f"{_ANIMA_MEMORIES_ERROR_PREFIX}_too_large"
ANIMA_MEMORIES_TEMPLATE = """# Memories

## Our story
How we met, milestones and memorable moments, with dates.

## How we are together
Nicknames, in-jokes, shared references, rituals and the tone we've settled into.

## What works between us
What helps, what lands and what to avoid in how I am with them.

## Open threads
Things to follow up on: plans, promises and upcoming events, with dates.
"""
# The MEMORIES.md size the guidance aims for. The limit is in bytes and Japanese, Chinese and Korean
# characters take three bytes in UTF-8, but each carries more than an English letter: 3,000 of them,
# about 9,000 bytes, hold about as much as 6,000 English characters and stay well under 16 KiB.
ANIMA_MEMORIES_SIZE_TARGET = "well under about 6,000 characters, or about 3,000 in Japanese, Chinese or Korean"
ANIMA_DISPLAY_NAME_MAX_CHARACTERS = 40
DEFAULT_ANIMA_VOICE_ID = "gJx1vCzNCD1EQHT212Ls"


def anima_identity_description(display_name: str) -> str:
    """Describe a new IDENTITY.md by its Anima's name at creation."""

    return f"{display_name}'s identity"


def anima_memories_description(display_name: str) -> str:
    """Describe a new or repaired MEMORIES.md by its Anima's name."""

    return f"{display_name}'s memories"


class AnimaDefinitionError(ValueError):
    """An owned definition or protected Anima file is missing, invalid, or changed since it was read."""

    def __init__(self, code: str, *, current_revision: int | None = None) -> None:
        super().__init__(code)
        self.code = code
        self.current_revision = current_revision


def normalize_display_name(value: str) -> str:
    """Trim edges only; keep the owner's case and meaningful internal spacing."""

    name = value.strip()
    if not 1 <= len(name) <= ANIMA_DISPLAY_NAME_MAX_CHARACTERS or any(
        unicodedata.category(char) == "Cc" for char in value
    ):
        raise AnimaDefinitionError("anima_display_name_invalid")
    try:
        name.encode("utf-8")
    except UnicodeEncodeError as exc:
        raise AnimaDefinitionError("anima_display_name_invalid") from exc
    return name


def normalize_identity(value: str, *, max_bytes: int = ANIMA_IDENTITY_MAX_BYTES) -> str:
    """Normalize line endings without stripping Markdown whitespace."""

    return _normalize_anima_file(
        value,
        code="anima_identity",
        max_bytes=min(ANIMA_IDENTITY_MAX_BYTES, max_bytes),
        allow_blank=False,
    )


def normalize_anima_memories(value: str, *, max_bytes: int = ANIMA_MEMORIES_MAX_BYTES) -> str:
    """Apply identity's Markdown rules, but allow a blank file: no shared history yet."""

    return _normalize_anima_file(
        value,
        code=_ANIMA_MEMORIES_ERROR_PREFIX,
        max_bytes=min(ANIMA_MEMORIES_MAX_BYTES, max_bytes),
        allow_blank=True,
    )


def _normalize_anima_file(value: str, *, code: str, max_bytes: int, allow_blank: bool) -> str:
    content = value.replace("\r\n", "\n").replace("\r", "\n")
    if (not allow_blank and not content.strip()) or "\x00" in content:
        raise AnimaDefinitionError(f"{code}_invalid")
    try:
        size = len(content.encode("utf-8"))
    except UnicodeEncodeError as exc:
        raise AnimaDefinitionError(f"{code}_invalid") from exc
    if size > max_bytes:
        raise AnimaDefinitionError(f"{code}_too_large")
    return content
