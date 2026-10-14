"""The language an Anima speaks in a chat turn: the owner's applied UI Locale (ADR 0024).

The browser reports the locale it applied (``client_context.ui_locale``), because
"System default" resolves on the client. A non-English locale adds a reply
language instruction to the prompt and a language code to the turn's speech.
English, unset and unknown locales add nothing, so the Anima keeps its default
behavior. Companion safety never reads this (internationalization spec R6).
"""

from __future__ import annotations

from dataclasses import dataclass, replace
from typing import Final

from animama.domain.settings import UiLocale

from .options import DirectChatOptions


@dataclass(frozen=True, slots=True)
class ConversationLanguage:
    """A non-English conversation language for one chat turn."""

    locale: UiLocale
    name: str
    """English name used in the model's reply language instruction."""
    speech_code: str
    """ISO 639-1 code sent to ElevenLabs and Gemini text-to-speech."""


_LANGUAGES: Final[dict[str, ConversationLanguage]] = {
    language.locale: language
    for language in (
        ConversationLanguage(locale="ja", name="Japanese", speech_code="ja"),
        ConversationLanguage(locale="ko", name="Korean", speech_code="ko"),
        # Both Chinese locales are written Mandarin; they differ only in script.
        ConversationLanguage(locale="zh-Hans", name="Simplified Chinese", speech_code="zh"),
        ConversationLanguage(locale="zh-Hant", name="Traditional Chinese", speech_code="zh"),
    )
}


def conversation_language(ui_locale: str | None) -> ConversationLanguage | None:
    """Return the turn's conversation language, or ``None`` to keep the default (English) behavior."""

    return _LANGUAGES.get(ui_locale) if ui_locale else None


def reply_language_instruction(language: ConversationLanguage) -> str:
    """Prompt section asking the model to reply, and speak, in ``language``."""

    return (
        "# Conversation Language\n\n"
        f"The user has chosen {language.name} for Animama. Write every reply in {language.name}, "
        "including the words you speak aloud, even when your Anima Identity, memories or earlier "
        "messages are in another language. Use a different language only when the user asks for it."
    )


def with_speech_language(options: DirectChatOptions, language: ConversationLanguage | None) -> DirectChatOptions:
    """Give the turn's text-to-speech the language's code, unless the request already chose one."""

    tts = options.tts
    if language is None or tts is None or tts.language_code is not None:
        return options
    return replace(options, tts=replace(tts, language_code=language.speech_code))
