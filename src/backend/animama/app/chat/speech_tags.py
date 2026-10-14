"""The prompt's rule for audio tags in ``speech``, chosen by the voice that will speak it.

Gemini and ElevenLabs perform audio tags; every other turn (speech off, Pocket TTS,
browser speech) must not get them. The rule is a stable instruction section, so each
voice keeps a byte-identical prompt prefix, and changing the voice changes it once.
Whatever the prompt says, the speech paths prepare the text each voice receives
(``animama.domain.audio_tags``).
"""

from __future__ import annotations

from animama.app.chat.options import DirectChatTtsOptions
from animama.domain.audio_tags import SpeechTagProvider

_HEADING = "# Audio Tags in Speech\n\n"

_NEUTRAL_RULES = """\
- Write tags in square brackets and in English, in every language: [laughs], [chuckles], [giggles], [sighs], \
[gasps], [breathes], [short pause], [long pause] and [whispers].
- Place a tag at a sentence or clause boundary, where the sound happens. A pause or a sigh works best at the start \
of a sentence.
- [whispers] goes at the start of a sentence, only when your mood really shifts, and whispers that sentence.
- `speech` always needs words; a tag never replaces them. Never put tags in `display`."""

_GEMINI = f"""\
{_HEADING}The selected voice performs audio tags in `speech`. Use them sparingly, only where a real sound belongs:

{_NEUTRAL_RULES}
- This voice performs no other tags.
- Use at most two sounds (laughs, chuckles, giggles, sighs, gasps, breaths and pauses) in a reply; most replies \
need none."""

_ELEVENLABS = f"""\
{_HEADING}The selected voice performs audio tags in `speech`. Use them sparingly, only where a real sound belongs:

{_NEUTRAL_RULES}
- This voice also follows other short directions in square brackets, in English:
  - an emotion or delivery change, such as [excited], [softly] or [whispering, playful], before the words it \
affects and only when your mood really shifts. Your `emotional_tone` already sets how the reply begins;
  - other non-verbal sounds, such as [coughs] or [yawns];
  - sound effects, such as [applause] or [door knocks].
- Never ask for an accent.
- Use at most two sounds (laughs, sighs, gasps and other non-verbal sounds, sound effects and pauses) in a reply; \
most replies need none.
- A direction lasts until the next one, so after a whispered sentence, return to your reply's tone with a direction \
for it."""

_NO_TAGS = f"""\
{_HEADING}The selected voice cannot perform audio tags. Never write bracketed directions such as [laughs] or \
<sigh> in `speech`, even if earlier replies in this chat contain them; put the feeling into your words instead."""


def speech_tag_provider(tts: DirectChatTtsOptions | None) -> SpeechTagProvider | None:
    """The tag-capable voice this turn speaks with, or ``None`` when tags must not be written."""

    if tts is None or tts.enabled is not True:
        return None
    if tts.provider == "gemini":
        return "gemini"
    # Eleven v4 Turbo is the only ElevenLabs model: the chat options keep no other
    # ElevenLabs id (merge_chat_request_options), and it performs tags.
    if tts.provider == "elevenlabs":
        return "elevenlabs"
    return None


def speech_tags_instruction(tts: DirectChatTtsOptions | None) -> str:
    """The stable instruction section for audio tags, for the turn's speech options."""

    provider = speech_tag_provider(tts)
    if provider == "gemini":
        return _GEMINI
    if provider == "elevenlabs":
        return _ELEVENLABS
    return _NO_TAGS


__all__ = ["speech_tag_provider", "speech_tags_instruction"]
