"""Deterministic checks of a reply's ``speech`` and ``display`` against chat's ElevenLabs and Speech rules.

The rules come from ``app/chat/speech_tags.py``: the ElevenLabs section allows
English square-bracket tags at clause boundaries and other bracketed
directions, at most ``SPEECH_SOUND_CAP`` sounds per reply, no accents and no
tags in ``display``; the Speech section keeps links, URLs, paths, code,
markdown, lists, tables and emoji out of ``speech``. Tags are found with the
app's own grammar (``animama.domain.audio_tags``), so a reply is read exactly
as the speech path reads it. A change to those rules is a reviewed change to
these checks.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

import regex

from animama.domain.audio_tags import (
    AUDIO_TAG_ACCENT_PREFIX,
    NEUTRAL_AUDIO_TAGS,
    SPEECH_SOUND_CAP,
    AudioTag,
    classify_audio_tag,
    find_audio_tags,
    strip_audio_tags,
)

__all__ = ["SpeechCheck", "check_speech"]

_NEUTRAL_SOUND = {alias: tag.sound for tag in NEUTRAL_AUDIO_TAGS for alias in tag.aliases}
_ENGLISH_TAG = re.compile(r"[A-Za-z][A-Za-z ,.!?'’-]*")
_NOT_LETTER = regex.compile(r"[^\p{L}]+")
_URL = re.compile(r"https?://|www\.\S", re.IGNORECASE)
_EMAIL = re.compile(r"\b[\w.+-]+@[\w-]+\.[\w.]+\b")
_PATH = re.compile(r"(?:^|\s)(?:~|\.{1,2})?/[\w.-]+/[\w./-]*|\b[A-Za-z]:\\")
_CODE = re.compile(r"`")
_MARKDOWN = re.compile(
    r"\*\*|__|^#{1,6}\s|\[[^\]]*\]\([^)]*\)"
    # Single-asterisk or underscore emphasis, such as *smiles* or _really_, but not a lone * or snake_case.
    r"|(?<![\w*])\*(?=\S)[^*\n]+(?<=\S)\*(?![\w*])|(?<![\w_])_(?=\w)[^_\n]+(?<=\w)_(?![\w_])",
    re.MULTILINE,
)
_LIST = re.compile(r"^\s*(?:[-*•]|\d+[.)])\s+", re.MULTILINE)
_TABLE = re.compile(r"^\s*\|.*\|\s*$", re.MULTILINE)
# As the app's speech text strips them (product_http/chat/sse_events.py): pictographs and flag letters.
_EMOJI = regex.compile(r"\p{Extended_Pictographic}|\p{Regional_Indicator}")
_WORD = regex.compile(r"[\p{L}\p{N}]")


@dataclass(frozen=True, slots=True)
class SpeechCheck:
    """One reply's tag use and spoken-style violations."""

    tags: tuple[str, ...]
    """Every tag in ``speech``, as written."""
    sounds: int
    """Tags that count toward the sound cap: non-verbal sounds, sound effects and pauses."""
    over_sound_cap: bool
    angle_or_non_english_tags: int
    """Tags not written as English words in square brackets (``<sigh>`` or ``[笑う]``)."""
    display_tags: int
    tags_only_speech: bool
    """``speech`` has tags but no words."""
    accent_requests: int
    style_violations: tuple[str, ...]
    """Spoken-style rules ``speech`` breaks: ``url``, ``email``, ``path``, ``code``, ``markdown``, ``list``,
    ``table`` or ``emoji``."""


def _is_sound(tag: AudioTag) -> bool:
    key = " ".join(tag.content.lower().split()).strip(" .,!?")
    if key in _NEUTRAL_SOUND:
        return _NEUTRAL_SOUND[key]
    return any(classify_audio_tag(part) != "delivery" for part in tag.content.split(",") if part.strip())


def _asks_for_accent(tag: AudioTag) -> bool:
    return any(word.startswith(AUDIO_TAG_ACCENT_PREFIX) for word in _NOT_LETTER.split(tag.content.lower()))


def check_speech(speech: str, display: str | None) -> SpeechCheck:
    tags = find_audio_tags(speech)
    sounds = sum(1 for tag in tags if _is_sound(tag))
    style = [
        name
        for name, pattern in (
            ("url", _URL),
            ("email", _EMAIL),
            ("path", _PATH),
            ("code", _CODE),
            ("markdown", _MARKDOWN),
            ("list", _LIST),
            ("table", _TABLE),
            ("emoji", _EMOJI),
        )
        if pattern.search(speech)
    ]
    return SpeechCheck(
        tags=tuple(tag.label for tag in tags),
        sounds=sounds,
        over_sound_cap=sounds > SPEECH_SOUND_CAP,
        angle_or_non_english_tags=sum(
            1 for tag in tags if not tag.label.startswith("[") or not _ENGLISH_TAG.fullmatch(tag.content)
        ),
        display_tags=len(find_audio_tags(display or "")),
        tags_only_speech=bool(tags) and not _WORD.search(strip_audio_tags(speech)),
        accent_requests=sum(1 for tag in tags if _asks_for_accent(tag)),
        style_violations=tuple(style),
    )
