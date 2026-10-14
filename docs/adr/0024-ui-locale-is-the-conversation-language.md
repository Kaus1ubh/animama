# 0024: The UI Locale is the conversation language

- Status: accepted (owner, 2026-10-13)
- Recorded: 2026-10-10; revised 2026-10-13 before release
- Retrospective: no
- Original decision date: 2026-10-10 (owner decisions during intent discovery
  for [issue #385](https://github.com/raymond-van/animama/issues/385)); on
  2026-10-13 the owner replaced the two separate settings with one language
- Decision basis: [issue #385](https://github.com/raymond-van/animama/issues/385)
  and its [specification snapshot](../plans/internationalization/internationalization-spec.md)

## Context

Animama was English-only. Speech recognition, text-to-speech, lip-sync and
memory each have different language support, and the local speech models
available today (Parakeet v2, Pocket TTS) are English-only, while ElevenLabs
and Gemini speak many languages. The crisis-resource region depends on where
the user is, not on any language. The backend already returned codes for most
failures, and some screens worded them in the frontend, while other screens
showed backend English verbatim.

## Decision

1. **One language for the whole app.** The **UI Locale** chooses interface
   text, date, number and plural formatting, and the **conversation
   language**: the language an Anima replies, speaks and listens in. The
   browser reports the locale it applied with each chat turn
   (`client_context.ui_locale`), because "System default" resolves on the
   client. A non-English locale adds a reply-language instruction to the
   prompt and an ISO 639-1 language code to ElevenLabs and Gemini speech, and
   the browser's own speech engines use it. English, unset and unknown locales
   add nothing, so English behavior is unchanged. Engines that work only in
   English (Parakeet, Pocket TTS) stay available with a warning that names the
   alternatives. The crisis region and companion safety never read it.
2. **Resolution order.** A saved preference (canonical tags `en`, `ja`, `ko`,
   `zh-Hans`, `zh-Hant`; unset means "System default"), then the first
   supported OS or browser language, then English. Chinese matches by script,
   then region (TW, HK and MO are Traditional). Formatting takes the system's
   region when its language matches the active locale.
3. **Codes from the backend, words in the frontend.** The backend sends stable
   codes and parameters; frontend catalogs word them. Backend English stays
   for logs and API clients and is shown only as secondary technical detail.
4. **Beta locales.** Non-English locales ship machine-translated and are marked
   Beta. A missing translation shows English. CI fails on catalog errors
   (stale keys, placeholder changes, keys missing from English, raw strings in
   converted UI) but only reports untranslated keys.
5. **Shared runtime.** The locale contract lives in
   `@animama/runtime-contracts/locale` and the i18next runtime, provider and
   formatters in `@animama/product-ui/i18n`, so hosted consumers resolve and
   format the same way. Catalogs ship with the source and load one locale at a
   time, without network access on desktop.

## Alternatives

- **Two settings: UI Locale and conversation language** (the 2026-10-10
  decision). Lets someone read translated menus while talking in another
  language, but adds a second picker and leaves a Japanese interface with an
  Anima that answers in English by default. Rejected for one language.
- **A conversation language per Anima.** More flexible, but the speech engines
  and their warnings would differ per Anima, and nothing asks for it yet.
- **Translate backend messages server-side.** Needs the UI Locale on every
  request and duplicates catalogs across Python and TypeScript.
- **Fail CI on any untranslated key.** Keeps catalogs complete, but every string
  change would need four translations in the same commit.

## Consequences

- Each UI string change edits the English catalog and, ideally, the beta
  catalogs; `pnpm i18n:status` lists what is still English.
- Stored identifiers and data (settings section IDs, beat labels, content
  identifiers) are never translated; only their display is.
- Under a non-English locale with Parakeet, the owner speaks English while the
  Anima replies in the locale until multilingual speech recognition lands
  ([#509](https://github.com/raymond-van/animama/issues/509)). Lip-sync is
  estimated from English phonemes, so the mouth does not move for Japanese,
  Korean or Chinese replies until audio-driven lip-sync lands
  ([#468](https://github.com/raymond-van/animama/issues/468)).
- The model's instruction text, the Companion Guardrails, memory guidance and
  starter Anima identities stay English; only the reply language changes. Text
  the Anima writes for itself (episodic notes, `MEMORIES.md` edits) may follow
  the conversation; memory behavior does not change.
- Browser journeys keep English accessible-name selectors and run in English;
  a pseudo-locale check covers untranslated text and overflow. The
  pseudo-locale is not a conversation language.
- Right-to-left locales are not supported yet; the runtime sets `<html dir>`
  so adding one does not need a new mechanism.

## Evidence

- [`runtime-contracts/src/locale.ts`](../../src/frontend/packages/runtime-contracts/src/locale.ts):
  supported locales, matching and resolution.
- [`product-ui/src/i18n/`](../../src/frontend/packages/product-ui/src/i18n/):
  runtime, provider, formatters and pseudo-locale.
- [`app/chat/conversation_language.py`](../../src/backend/animama/app/chat/conversation_language.py):
  the reply instruction and speech language code.
- [`docs/frontend/architecture/i18n.md`](../frontend/architecture/i18n.md):
  catalogs, workflow and checks.
