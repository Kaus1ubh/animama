# 0031: The offline speech engine is the owner's choice

- Status: accepted (owner, 2026-10-25)
- Recorded: 2026-10-25
- Retrospective: no
- Original decision date: 2026-10-25 (owner direction that the app language
  must not restrict which Speech-to-Text engine can be used)
- Decision basis: Explicit owner decision
- Amends: [ADR 0029](0029-sensevoice-offline-speech-recognition.md) decisions
  1 and 2

## Context

ADR 0029 routed offline speech recognition by the UI Locale: Parakeet for
English, SenseVoice-Small for Japanese, Korean and Chinese. Setup and App
Settings already showed SenseVoice and Parakeet as separate tabs, but both
saved the same `stt_provider: "parakeet"`, so the locale still decided which
model ran. Choosing SenseVoice under English ran Parakeet, and the other tab
said Animama used it only under another app language. The owner decided that
the app language must not restrict which engine the owner can use.

## Decision

1. **The owner chooses the engine.** An optional stored
   `speech.stt_offline_engine` (`"parakeet"` or `"sensevoice"`) runs that
   engine under any UI Locale. Absent, the engine follows the UI Locale as in
   ADR 0029, so existing installations are unchanged. Selecting an offline
   choice in Setup or App Settings saves its engine; an untouched Setup default
   and the browser choices do not.
2. **Stored values keep their meaning.** `stt_provider: "parakeet"` still means
   offline recognition with either engine and `stt_parakeet_webgpu` is the GPU
   preference for both. The engine is read when a session starts.
3. **Language prompts follow the engine.** SenseVoice under `ja`, `ko`,
   `zh-Hans` and `zh-Hant` keeps ADR 0029's prompts. SenseVoice under English
   (or an unset or unsupported locale) is prompted with `lang_auto`, so it
   detects English, Japanese, Korean, Mandarin and Cantonese, and its text is
   not converted. Parakeet recognizes English under every locale.
4. **No cloud fallback for a choice that cannot run.** A saved offline choice
   whose engine's set is missing stops with "not installed" instead of using a
   browser recognizer, except Parakeet under English, which keeps its browser
   fallback.

## Rationale and consequences

- Owners who speak a language other than the app's, or want SenseVoice's
  automatic detection in an English app, can use it; the UI Locale stays the
  default and the recommended engine.
- Choices describe what each engine recognizes instead of which app language
  uses it. `SpeechLanguageNotice` warns that Parakeet recognizes English only
  when it runs under another locale, and asks for SenseVoice's download when a
  chosen SenseVoice is missing under English.
- Dictation, Voice Mode, the composer's engine tooltip and install hint,
  Settings and Setup read the same route, so they agree on the engine that
  runs.
- English through SenseVoice is less accurate than through Parakeet (ADR 0029's
  comparison: WER 7.9% against 4.1%); that is the owner's trade-off to make.

## Evidence

- [`lib/speech/offline-stt/routing.ts`](../../src/frontend/web/src/lib/speech/offline-stt/routing.ts):
  `routeOfflineSpeech(locale, engine)` and the fallback rule.
- [`lib/settings/preferences.ts`](../../src/frontend/web/src/lib/settings/preferences.ts):
  `offlineSttEnginePreference`.
- [`lib/speech/stt-choices.ts`](../../src/frontend/web/src/lib/speech/stt-choices.ts):
  `sttChoicePatch`.
- [Voice runtime](../frontend/runtime/voice.md#offline-engine-choice):
  current behavior.
