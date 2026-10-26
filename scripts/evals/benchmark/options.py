"""The chat options and request fields of a benchmark turn (spec R2).

Every turn carries an enabled ElevenLabs voice, so the prompt has chat's
ElevenLabs Audio-tag rules; the executor never calls text-to-speech itself,
so no speech is synthesized. A Japanese turn gets the UI Locale ``ja`` the way
``chat:sse`` turn setup applies it: the reply-language instruction and the
voice's Japanese language code. No native tools are requested, so no turn
offers web search. Provider moderation follows the production default
(companion crisis detection on); chat requests it only on OpenAI Responses.
"""

from __future__ import annotations

from dataclasses import dataclass

from animama.app.chat.conversation_language import ConversationLanguage, conversation_language, with_speech_language
from animama.app.chat.options import DirectChatOptions, DirectChatTtsOptions

from ..core.chat import incognito_turn_options

__all__ = ["ELEVENLABS_VOICE", "PROVIDER_MODERATION", "TurnLanguage", "core_turn_options"]

ELEVENLABS_VOICE = DirectChatTtsOptions(enabled=True, provider="elevenlabs")
PROVIDER_MODERATION = True
"""Production's ``TurnSafety.provider_moderation`` with companion safety's crisis detection at its default (on)."""


@dataclass(frozen=True, slots=True)
class TurnLanguage:
    """A turn's options and conversation language for one prompt-set language."""

    options: DirectChatOptions
    conversation_language: ConversationLanguage | None


def core_turn_options(language: str, reasoning_effort: str | None) -> TurnLanguage:
    """Options for an incognito turn in ``language`` (``en`` or ``ja``) with the ElevenLabs voice.

    English sends UI Locale ``en``, which adds nothing to the prompt (ADR 0024).
    """

    resolved = conversation_language(language)
    options = with_speech_language(incognito_turn_options(reasoning_effort, tts=ELEVENLABS_VOICE), resolved)
    return TurnLanguage(options=options, conversation_language=resolved)
