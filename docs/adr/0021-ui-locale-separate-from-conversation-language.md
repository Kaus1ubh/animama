# 0021: UI Locale separate from conversation language

- Status: accepted (owner, 2026-10-10)
- Recorded: 2026-10-10
- Retrospective: no
- Original decision date: 2026-10-10 (owner decisions during intent discovery
  for [issue #385](https://github.com/raymond-van/animama/issues/385))
- Decision basis: [issue #385](https://github.com/raymond-van/animama/issues/385)
  and its [specification snapshot](../plans/internationalization/internationalization-spec.md)

## Context

Animama was English-only. A user who wants the interface in Japanese may still
talk to an Anima in English, and the reverse; the crisis-resource region
depends on where the user is, not on either language. Speech recognition,
text-to-speech, lip-sync and memory each have different language support, and
the local speech models available today cover few languages. The backend
already returned codes for most failures, and some screens worded them in the
frontend, while other screens showed backend English verbatim.

## Decision

1. **Two settings, never coupled.** The **UI Locale** chooses interface text
   and date, number and plural formatting. The **conversation language**
   chooses what an Anima speaks, hears and remembers and is delivered
   separately. Changing the UI Locale never changes provider instructions,
   replies, voices, speech recognition, memory or the crisis region.
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

- **One language setting for UI and conversation.** Simple, but forces a
  speech stack change on anyone who only wants translated menus, and makes UI
  wording depend on speech-model coverage.
- **Translate backend messages server-side.** Needs the UI Locale on every
  request and duplicates catalogs across Python and TypeScript.
- **Fail CI on any untranslated key.** Keeps catalogs complete, but every string
  change would need four translations in the same commit.

## Consequences

- Each UI string change edits the English catalog and, ideally, the beta
  catalogs; `pnpm i18n:status` lists what is still English.
- Stored identifiers and data (settings section IDs, beat labels, content
  identifiers) are never translated; only their display is.
- Browser journeys keep English accessible-name selectors and run in English;
  a pseudo-locale check covers untranslated text and overflow.
- Right-to-left locales are not supported yet; the runtime sets `<html dir>`
  so adding one does not need a new mechanism.

## Evidence

- [`runtime-contracts/src/locale.ts`](../../src/frontend/packages/runtime-contracts/src/locale.ts):
  supported locales, matching and resolution.
- [`product-ui/src/i18n/`](../../src/frontend/packages/product-ui/src/i18n/):
  runtime, provider, formatters and pseudo-locale.
- [`docs/frontend/architecture/i18n.md`](../frontend/architecture/i18n.md):
  catalogs, workflow and checks.
