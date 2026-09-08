"""Stable, owner-edited Anima definition rules, independent of content templates."""

from __future__ import annotations

import unicodedata

ANIMA_IDENTITY_PATH = "identity.md"
ANIMA_IDENTITY_KIND = "anima_identity"
ANIMA_IDENTITY_MAX_BYTES = 32 * 1024
ANIMA_DISPLAY_NAME_MAX_CHARACTERS = 40
DEFAULT_ANIMA_VOICE_ID = "gJx1vCzNCD1EQHT212Ls"


class AnimaDefinitionError(ValueError):
    """An owned definition is missing, invalid, or changed since it was read."""

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

    content = value.replace("\r\n", "\n").replace("\r", "\n")
    if not content.strip() or "\x00" in content:
        raise AnimaDefinitionError("anima_identity_invalid")
    try:
        size = len(content.encode("utf-8"))
    except UnicodeEncodeError as exc:
        raise AnimaDefinitionError("anima_identity_invalid") from exc
    if size > min(ANIMA_IDENTITY_MAX_BYTES, max_bytes):
        raise AnimaDefinitionError("anima_identity_too_large")
    return content
