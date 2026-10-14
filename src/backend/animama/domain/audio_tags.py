"""Audio tags in the chat model's speech: their grammar, classes and provider text.

The chat model may write short bracketed directions in ``speech``, such as
``[laughs]`` or ``<long pause>``. Gemini performs a small set of them in angle
brackets, ElevenLabs performs free-form directions in square brackets, and every
other reader needs them removed. This module is the backend half of one grammar;
product-ui's ``lib/chat/audio-tags.ts`` is the browser half. Both run
``tests/fixtures/audio-tag-cases.json``, so they agree on every case.

Supported callers include the backend's finalized Gemini speech, Reflection and
search snippets, and a hosted composition's server-side ElevenLabs speech, which
must prepare the text it speaks the same way the browser prepares its copy.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Literal, get_args

import regex

AudioTagClass = Literal["sound_effect", "nonverbal", "pacing", "delivery"]
SpeechTagProvider = Literal["gemini", "elevenlabs"]

# At most this many sounds (non-verbal sounds, sound effects and pauses) reach a
# voice per reply; emotion and delivery directions are not capped.
SPEECH_SOUND_CAP = 2
# A direction with a word starting with this asks for an accent, which no voice gets.
AUDIO_TAG_ACCENT_PREFIX = "accent"


@dataclass(frozen=True, slots=True)
class NeutralAudioTag:
    """A tag the model may write for any tag-capable voice, and each voice's spelling."""

    id: str
    aliases: tuple[str, ...]
    gemini: str
    elevenlabs: str
    sound: bool


NEUTRAL_AUDIO_TAGS: tuple[NeutralAudioTag, ...] = (
    NeutralAudioTag("laugh", ("laugh", "laughs", "laughing", "laughter"), "<laugh>", "[laughs]", True),
    NeutralAudioTag("chuckle", ("chuckle", "chuckles", "chuckling"), "<chuckle>", "[chuckles]", True),
    NeutralAudioTag("giggle", ("giggle", "giggles", "giggling"), "<giggle>", "[giggles]", True),
    NeutralAudioTag("sigh", ("sigh", "sighs", "sighing"), "<sigh>", "[sighs]", True),
    NeutralAudioTag("gasp", ("gasp", "gasps", "gasping"), "<gasp>", "[gasps]", True),
    NeutralAudioTag("breath", ("breath", "breathes", "breathing"), "<breath>", "[breathes]", True),
    NeutralAudioTag("short_pause", ("short pause", "pause"), "<short pause>", "[pause]", True),
    NeutralAudioTag("long_pause", ("long pause",), "<long pause>", "[long pause]", True),
    NeutralAudioTag("whisper", ("whisper", "whispers", "whispering"), "<whispers>", "[whispers]", False),
)

# Lowercase words that name each class; any other direction is delivery.
AUDIO_TAG_WORD_CLASSES: dict[str, frozenset[str]] = {
    "sound_effect": frozenset(
        {
            "applause",
            "beep",
            "beeps",
            "bell",
            "bells",
            "clapping",
            "claps",
            "crash",
            "ding",
            "door",
            "explosion",
            "footsteps",
            "gulp",
            "gulps",
            "gunshot",
            "gunshots",
            "knock",
            "knocking",
            "knocks",
            "phone",
            "rain",
            "ringing",
            "splash",
            "swallows",
            "thunder",
            "wind",
        }
    ),
    "nonverbal": frozenset(
        {
            "breath",
            "breathes",
            "breathing",
            "chuckle",
            "chuckles",
            "chuckling",
            "cough",
            "coughing",
            "coughs",
            "cries",
            "cry",
            "crying",
            "exhale",
            "exhales",
            "exhaling",
            "gasp",
            "gasping",
            "gasps",
            "giggle",
            "giggles",
            "giggling",
            "groan",
            "groaning",
            "groans",
            "grunt",
            "grunts",
            "hiccup",
            "hiccups",
            "hum",
            "humming",
            "hums",
            "inhale",
            "inhales",
            "inhaling",
            "laugh",
            "laughing",
            "laughs",
            "laughter",
            "scream",
            "screaming",
            "screams",
            "sigh",
            "sighing",
            "sighs",
            "sneeze",
            "sneezes",
            "sneezing",
            "sniff",
            "sniffle",
            "sniffles",
            "sniffs",
            "snicker",
            "snickers",
            "snort",
            "snorting",
            "snorts",
            "sob",
            "sobbing",
            "sobs",
            "throat",
            "wheeze",
            "wheezes",
            "wheezing",
            "whimper",
            "whimpers",
            "yawn",
            "yawning",
            "yawns",
        }
    ),
    "pacing": frozenset({"pause", "pauses", "silence"}),
}
_CLASS_STRENGTH: tuple[AudioTagClass, ...] = ("sound_effect", "nonverbal", "pacing")

# A tag is a short direction in words, starting with a letter: [laughs] or
# <long pause>, up to 64 characters. Digits or symbols ("x < 5 and y > 3") make it
# text, and a square span followed by "(" is a Markdown link label.
_TAG = regex.compile(r"<(\p{L}[\p{L} ,.!?'’-]{0,63})>|\[(\p{L}[\p{L} ,.!?'’-]{0,63})\](?!\()")
_NOT_LETTER = regex.compile(r"[^\p{L}]+")
# A tag still being written: its opening bracket, then the words so far, if any.
_OPEN_TAG_CONTENT = regex.compile(r"(?:\p{L}[\p{L} ,.!?'’-]{0,63})?")
_STRAY_BRACKET = re.compile(r"[\[\]<>]")
_SPACE_RUN = re.compile(r"[ \t]{2,}")
_SPACE_BEFORE_PUNCTUATION = re.compile(r" +([,.!?;:])")
# JavaScript's String.prototype.trim() set, so both halves trim the same characters.
_TRIMMED = "\t\n\v\f\r \u00a0\u1680" + "".join(map(chr, range(0x2000, 0x200B))) + "\u2028\u2029\u202f\u205f\u3000\ufeff"
_NEUTRAL_BY_ALIAS = {alias: tag for tag in NEUTRAL_AUDIO_TAGS for alias in tag.aliases}


@dataclass(frozen=True, slots=True)
class AudioTag:
    """One tag found in text: as written (``label``), its inner ``content`` and range."""

    label: str
    content: str
    start: int
    end: int


def find_audio_tags(text: str) -> list[AudioTag]:
    """Every audio tag in ``text``, in order."""

    return [
        AudioTag(match.group(0), match.group(1) or match.group(2), match.start(), match.end())
        for match in _TAG.finditer(text)
    ]


def ends_inside_audio_tag(text: str) -> bool:
    """Whether ``text`` ends inside a tag still being written, such as ``Well [sighs. long``.

    Sentence and chunk splitters must not end a piece there, or the tag's halves
    would be spoken as words.
    """

    opener = max(text.rfind("["), text.rfind("<"))
    return opener >= 0 and _OPEN_TAG_CONTENT.fullmatch(text[opener + 1 :]) is not None


def classify_audio_tag(direction: str) -> AudioTagClass:
    """The class of one direction, such as ``laughs softly`` or ``long pause``."""

    words = set(_NOT_LETTER.split(direction.lower()))
    for tag_class in _CLASS_STRENGTH:
        if words & AUDIO_TAG_WORD_CLASSES[tag_class]:
            return tag_class
    return "delivery"


def _tag_class(content: str) -> AudioTagClass:
    """The strongest class among a tag's comma-separated directions."""

    classes = {classify_audio_tag(direction) for direction in content.split(",") if direction.strip()}
    return next((tag_class for tag_class in _CLASS_STRENGTH if tag_class in classes), "delivery")


def _neutral(content: str) -> NeutralAudioTag | None:
    key = " ".join(content.lower().split()).strip(" .,!?")
    return _NEUTRAL_BY_ALIAS.get(key)


def _asks_for_accent(content: str) -> bool:
    return any(word.startswith(AUDIO_TAG_ACCENT_PREFIX) for word in _NOT_LETTER.split(content.lower()))


def _tidy(text: str) -> str:
    return _SPACE_BEFORE_PUNCTUATION.sub(r"\1", _SPACE_RUN.sub(" ", text)).strip(_TRIMMED)


def strip_audio_tags(text: str) -> str:
    """``text`` without its tags, for readers that show or speak it without them."""

    return _tidy(_TAG.sub(" ", text))


def opens_with_delivery_tag(text: str) -> bool:
    """Whether ``text`` starts with the model's own emotion or delivery direction.

    A leading tag counts when any of its directions is one, as in ``[sad, laughs]``.
    """

    leading = text.lstrip(_TRIMMED)
    tags = find_audio_tags(leading)
    if not tags or tags[0].start != 0 or _asks_for_accent(tags[0].content):
        return False
    return any(
        classify_audio_tag(direction) == "delivery" for direction in tags[0].content.split(",") if direction.strip()
    )


class ProviderSpeechText:
    """Prepares one reply's speech for a tag-capable voice, a segment or chunk at a time.

    Accepted tags are respelled for the provider, and everything else that reads as
    a tag is dropped, so no tag is spoken as words. Outside accepted tags no
    bracket character remains, so nothing else becomes a provider control. The
    sound cap counts across the whole reply, so use one instance per reply.
    """

    def __init__(self, provider: SpeechTagProvider) -> None:
        if provider not in get_args(SpeechTagProvider):
            raise ValueError(f"{provider!r} performs no audio tags")
        self.provider = provider
        self._sounds = 0

    def prepare(self, text: str) -> str:
        pieces: list[str] = []
        last = 0
        for tag in find_audio_tags(text):
            pieces.append(self._text_after(pieces, text[last : tag.start]))
            pieces.append(self._accepted(tag) or " ")
            last = tag.end
        pieces.append(self._text_after(pieces, text[last:]))
        return _tidy("".join(pieces))

    @staticmethod
    def _text_after(pieces: list[str], text: str) -> str:
        text = _STRAY_BRACKET.sub("", text)
        # "[sad](aside)" would read as a Markdown link label, not a tag.
        if text.startswith("(") and pieces and pieces[-1].startswith("["):
            return " " + text
        return text

    def _accepted(self, tag: AudioTag) -> str | None:
        neutral = _neutral(tag.content)
        if self.provider == "gemini":
            if neutral is None:
                return None
            label, sound = neutral.gemini, neutral.sound
        elif _asks_for_accent(tag.content):
            return None
        elif neutral is not None:
            label, sound = neutral.elevenlabs, neutral.sound
        else:
            label, sound = f"[{tag.content}]", _tag_class(tag.content) != "delivery"
        if sound:
            if self._sounds >= SPEECH_SOUND_CAP:
                return None
            self._sounds += 1
        return label


__all__ = [
    "AUDIO_TAG_ACCENT_PREFIX",
    "AUDIO_TAG_WORD_CLASSES",
    "NEUTRAL_AUDIO_TAGS",
    "SPEECH_SOUND_CAP",
    "AudioTag",
    "AudioTagClass",
    "NeutralAudioTag",
    "ProviderSpeechText",
    "SpeechTagProvider",
    "classify_audio_tag",
    "ends_inside_audio_tag",
    "find_audio_tags",
    "opens_with_delivery_tag",
    "strip_audio_tags",
]
