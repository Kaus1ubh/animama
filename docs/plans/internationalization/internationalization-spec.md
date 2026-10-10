# Internationalize Animama and Animama Cloud with multiple locales

Status: Agreed
Owner decision: 2026-10-10. The owner agreed the scope decisions during intent
discovery, accepted this text by requesting the ExecPlan, and decided P1–P4.
Authoritative source: https://github.com/raymond-van/animama/issues/385,
published and read back 2026-10-10T05:27:55Z. This file is a snapshot of that
publication.

## Problem and intended users

Animama and Animama Cloud are English-only:

- About half of the 328 non-test web `.tsx` files contain inline English, and
  `index.html` hard-codes `<html lang="en">`. There is no i18n library.
- App settings store `locale` (default `en-US`) and expose it through
  `/v1/users/me/settings`, but nothing reads it. The default cannot tell "chose
  English" from "never chose".
- Dates and numbers are formatted in a few places only, some with a hard-coded
  `en-US`. Only DM Sans (Latin subsets) is bundled.
- The backend sends English prose that the UI shows verbatim: Anima creation and
  Loadout diagnostics, API error details and a "Runtime error" chat event. Chat
  failure categories are already worded by the frontend; that is the pattern to
  extend.
- The Electron shell has its own English startup recovery page, window titles
  and macOS microphone prompt, and uses Electron's default macOS menu.
- Creators derive identifiers and file names from names by stripping everything
  outside `a-z0-9`. A Gesture named "おじぎ" gets the key `new_gesture` and the file
  `untitled.json`, so a second non-Latin name can conflict.
- Cloud's landing, docs, account and hosted-app surfaces and its two account
  emails are English-only, with no language detection or SEO language metadata.

Users:

- Owners of the desktop and self-host app who prefer Japanese, Korean or Chinese.
- Animama Cloud visitors and account holders, whose language should be detected
  and changeable.
- Contributors and agents adding UI, who should stop adding English-only text.

There is no deadline. This builds the foundation, converts the owner-facing UI
and ships the first locales as beta.

## Goals, scope and non-goals

In scope:

- Locale resolution, persistence and a language picker in both products.
- English plus four beta locales: Japanese (`ja`), Korean (`ko`), Simplified
  Chinese (`zh-Hans`) and Traditional Chinese (`zh-Hant`).
- Converting all owner-facing UI in both products, the desktop shell surfaces in
  R8 and user-visible backend diagnostics.
- Unicode-safe identifiers for user-named content.
- Guards that keep new UI translatable.
- The locale and URL policy for Cloud's landing and docs sites (applied when
  those sites are rebuilt for launch).

Non-goals:

- **Conversation language** (model reply language, text-to-speech,
  speech-to-text, lip-sync, memory language, the `PROFILE.md` template and the
  starter Anima identities). Linked follow-up issue; whether it is global or per
  Anima is decided there.
- Localized display names for Included content (Gestures, Reactions, Avatar,
  Particle and Scene Effects, voices). Linked follow-up issue; it needs a
  manifest schema change, and the model keeps the authored name and description.
- Crisis resources for Japan, Korea, Taiwan, Hong Kong and mainland China.
  Separate safety-data issue.
- Further locales (`es`, `fr`, `pt`, `id`, `de`, `hi`, `vi`). Later wave on the
  same foundation.
- Right-to-left locales, beyond not blocking them (R4).
- Translating user-authored content, chat history, developer/debug tools, the
  Windows installer, or the landing and docs placeholder copy.
- Native-speaker review. Beta locales ship with machine translations only.
- Cloud-internal implementation. Cloud work is planned in its own repository
  against R12–R15.

## Terms

These become `GLOSSARY.md` entries, and an ADR records the separation:

- **Locale** (UI locale): the language and regional conventions Animama uses for
  its own interface text and for formatting dates, numbers and plurals. It never
  changes what an Anima says, hears or remembers.
- **Conversation language**: the language an Anima speaks, understands and
  remembers in. Defined now; implemented by the follow-up.

The crisis region is neither. It comes from the owner's region preference or the
browser's region. Code that names the browser locale `locale` (for example
`ChatClientContext.locale`) is not the UI Locale; it is not renamed by this work.

## Required behavior

### Locales and resolution

- **R1 — Supported locales.** English is the source locale. `ja`, `ko`, `zh-Hans`
  and `zh-Hant` ship as beta and are marked "Beta" in the picker. The picker
  names every locale in its own script (English, 日本語, 한국어, 简体中文,
  繁體中文), so a user who cannot read the active locale can still find English.
  A development-only pseudo-locale exists (R17) and is never offered to users.
- **R2 — Local resolution.** The app setting is unset by default, shown as
  "System default". When it is unset, the app uses the first supported match in
  the OS (desktop) or browser (self-host) preferred-language list, in order, and
  otherwise English. Matching uses the language subtag (`ja-JP` → `ja`,
  `en-GB` → `en`). For Chinese, `zh-Hans`, `zh-CN`, `zh-SG` and bare `zh` map to
  `zh-Hans`; `zh-Hant`, `zh-TW`, `zh-HK` and `zh-MO` map to `zh-Hant`.
- **R3 — Local persistence and switching.** A choice is saved in App settings,
  survives restart and applies to every browser that opens the same self-host
  installation. Choosing "System default" clears it. Switching applies at once
  without a reload that loses state: unsent composer text, open creator edits,
  the current chat and playing audio survive.
- **R4 — Consistent application.** The active locale governs all converted text,
  accessible names, document titles, `<html lang>` (`ja`, `ko`, `zh-Hans`,
  `zh-Hant` or `en`, so browsers choose correct Han glyphs), `<html dir>` (always
  `ltr` for current locales), date, time, relative-time, number, list and plural
  formatting, and user-visible sorting. When the OS or browser locale has the
  same language as the active locale, formatting uses its region (English text
  with British dates on an `en-GB` system); otherwise the locale's default.
- **R5 — Missing translations.** A string missing from a beta catalog shows its
  English text, never a raw key or a broken layout.
- **R6 — Independence.** Changing the locale never changes provider instructions,
  Anima replies, voices, speech-recognition language, memory, the crisis region,
  authentication, ownership or security behavior.

### Converted surfaces

- **R7 — Owner-facing UI.** Every owner-facing screen in both products follows
  the locale: setup, chat, transcript and composer, Animas and Loadouts, Library,
  the Gesture, Pose and Effect creators, Settings (including its search), safety
  notices, errors, toasts, empty and loading states, and emotion labels.
  Developer and debug tools stay English and are listed as explicit exemptions.
  Included content names stay as authored.
- **R8 — Desktop shell.** The startup recovery page, window titles, the macOS
  application menu and the macOS microphone permission prompt follow the locale. The shell uses the last locale
  the app applied on that machine, otherwise the OS locale, so the recovery page
  is localized even when the backend is unavailable. The Windows installer stays
  English.
- **R9 — Safety surfaces.** The AI notice and the crisis card's labels are
  translated. Crisis service names, descriptions and contact values are shown as
  their verified data. The Companion guardrail remains an English provider
  instruction (ADR 0008). Safety strings are first in line when a reviewer becomes
  available.
- **R10 — Backend messages.** Diagnostics the UI shows to the user (Anima
  creation, Loadout, content save and import validation, chat runtime errors)
  carry stable codes and parameters, and the frontend words them. Other API
  error details are developer text: in a non-English locale the UI shows a
  translated message and keeps the detail only as secondary technical
  information.
- **R11 — Names in any script.** Every creator that derives an identifier or file
  name from a user-entered name produces a valid identifier for a name in any
  script. Different names do not collide, the Gesture can be equipped and
  selected in chat, and the same rules apply to export and import. Existing
  identifiers and files are unchanged.

### Animama Cloud

- **R12 — Cloud resolution.** Cloud uses, in order: the signed-in account's
  saved preference; the visitor's explicit picker choice, which persists across
  Cloud sites in the same browser; the browser language under R2's matching; then
  English. An account without a saved preference follows the rest of the order.
- **R13 — Cloud picker and persistence.** The picker is available on signed-out
  account pages and in the hosted app's settings. A choice made while signed in
  saves to the account and applies on every device. On the first sign-in, an
  account without a preference adopts the visitor's explicit choice, if any.
- **R14 — Cloud emails.** Verification and password-reset emails use the
  account's preference, otherwise the locale active when the visitor requested
  them.
- **R15 — Cloud URLs.** Hosted-app and account URLs carry no locale. When the
  landing and docs sites are rebuilt, each locale gets a path prefix (for example
  `/ja/`) with `hreflang` alternates and English as `x-default`; the bare root
  detects the language on a first visit, stays crawlable and honors R12. The
  operator admin console is not owner UI and stays English.

### Catalogs and guards

- **R16 — Catalogs.** Catalogs are committed with the source, work offline in the
  desktop app and load only the active locale plus the English fallback. Shared
  UI catalogs ship in the shared packages and the hosted application archive, so
  both products use the same wording.
- **R17 — Guards.** CI rejects new raw user-visible strings in non-exempt UI, keys
  missing from the English source, and unused keys. Keys missing from a beta
  catalog are reported without failing CI; R5 covers them at runtime. A pseudo-locale lengthens and marks every translated string so
  untranslated text and overflow are visible during development and in a smoke
  check.
- **R18 — Adding locales.** Adding another left-to-right locale needs only its
  catalogs, its registration and a visual and font check.

## Constraints

- **Repository boundaries.** Locale resolution, formatting helpers and shared
  catalogs live in `@animama/product-ui` and `@animama/runtime-contracts`; the
  supported-locale list is a public contract. Package source must not import
  `web`, `desktop` or Cloud. Cloud's account UI, emails and sites keep their own
  catalogs in Cloud and consume the shared contract through the gated package-set
  repin.
- **Persistence.** `user_settings.locale` becomes optional with an unset default.
  During development the ORM and `0001_baseline.sql` change directly, without an
  Alembic revision; existing development databases may be reset. The generated
  client is regenerated offline. Cloud's hosted baseline inherits the column from
  the published wheel and needs a matching change in Cloud.
- **Validation.** Saved locale values are restricted to supported locales.
  Locale never enters authentication or ownership decisions, and URLs carry only
  the locale prefix.
- **Fonts.** No CJK font is bundled; text uses system fonts, which depends on
  correct `lang` tags (R4). Hindi (Devanagari) and Vietnamese (DM Sans lacks
  most tone-marked vowels, U+1EA0–U+1EF1) need font work before their wave.
- **Layout.** Translated layouts stay readable and accessible at desktop sizes
  first, then narrower layouts, for both short CJK text and the pseudo-locale's
  long text.
- **Tests.** Browser journeys keep English accessible-name selectors and run in
  English. Unit tests may assert English text under the English locale.
- **Bundle size.** Inactive locales are never loaded.

## Acceptance criteria

- [ ] **AC1 (R1–R3).** On desktop and self-host, choosing 日本語 switches the UI
  at once while an unsent composer draft and an open creator edit survive; the
  choice persists after restart; "System default" follows the OS or browser.
  Evidence: unit tests for resolution, a browser check and a desktop manual check.
- [ ] **AC2 (R2, R12).** A resolution table test covers saved, unset, ordered
  preferred-language lists, every Chinese mapping and the English fallback.
- [ ] **AC3 (R4, R7).** With the pseudo-locale, a walkthrough of every non-exempt
  screen shows no unmarked English. Evidence: the smoke check plus an owner
  walkthrough.
- [ ] **AC4 (R16, R17).** CI fails on a fixture with a raw string, a missing
  English key and an unused key, passes on the converted source, and reports
  (without failing) a key missing from a beta catalog. At completion the report
  shows no missing beta keys.
- [ ] **AC5 (R4).** Dates, times, numbers and plurals render correctly in each
  supported locale (unit tests); `<html lang>` and `dir` match the locale.
- [ ] **AC6 (R1, R4, R5).** For each beta locale, an owner visual pass at desktop
  size and one narrower size finds no clipped or overlapping text on setup, chat,
  Library, a creator and Settings, and CJK glyphs render with the system font.
- [ ] **AC7 (R6).** Exact-prompt tests show identical provider instructions under
  every locale; speech-recognition language and crisis region are unchanged.
- [ ] **AC8 (R8).** With the backend stopped, the desktop recovery page appears in
  the last applied locale; on first launch it follows the OS locale; a macOS build
  shows the localized application menu and microphone prompt.
- [ ] **AC9 (R10).** Every user-visible diagnostic code has wording in every
  catalog; under `ja`, the creation and Loadout error paths show no English
  backend prose as their primary message.
- [ ] **AC10 (R11).** Gestures named "おじぎ" and "お辞儀" save as distinct items,
  survive reload, can be equipped and are selectable in chat; existing content
  keeps its identifiers.
- [ ] **AC11 (R9).** Under each beta locale, the AI notice and crisis card show
  translated labels with unchanged verified service data.
- [ ] **AC12 (R12–R14).** In Cloud, a first visit with a Japanese browser shows
  Japanese; a picker change persists across the hosted app and account pages;
  first sign-in adopts it; another device shows the saved preference; both
  emails arrive in it. Evidence: the Cloud plan's tests and journeys.

## Open questions and decisions

Agreed by the owner in intent discovery, 2026-10-10:

- Foundation without a deadline; machine-only translations labeled beta (R1).
- First wave `ja`, `ko`, `zh-Hans`, `zh-Hant`, with separate Chinese catalogs.
- Conversation language, Included content display names and CJK crisis
  resources are linked follow-ups; right-to-left is a non-goal that must not be
  blocked.
- "System default" as the unset local preference (R2, R3).
- Completion means all owner-facing UI, with debug tools exempt (R7).
- Desktop shell follows the app; installer stays English (R8).
- Safety: translate labels, keep verified data, guardrail stays English (R9).
- Backend: codes for user-visible diagnostics (R10).
- Unicode-safe names are fixed inside this issue (R11).
- One Cloud preference across sites; locale prefixes on public sites only;
  landing and docs content waits for the launch rework (R12–R15).
- Journeys stay English with a pseudo-locale smoke check (R17); this replaces the
  proposal's "no English text selectors" constraint.

Decided by the owner on 2026-10-10 after drafting:

- **P1 — Missing beta keys.** Reported, not failing CI; the English fallback
  covers them at runtime (R5, R17).
- **P2 — Product terms.** "Animama" and "Anima" stay in Latin script; other
  domain terms (Avatar, Gesture, Library, Loadout) are translated through one
  term list per locale that every machine translation uses.
- **P3 — Formatting region.** The system region applies when its language
  matches the active locale (R4).
- **P4 — macOS application menu.** Localized as part of R8.

Open, not blocking:

- How a beta locale leaves beta, and who reviews it.
- Where Cloud stores the account preference; decided in the Cloud plan.
- Whether the landing root redirects or suggests a language; decided at the
  rework, within R15.
- Order of the later locale wave.

## Spec

https://github.com/raymond-van/animama/issues/385.

## ExecPlan

[internationalization-execplan.md](internationalization-execplan.md). Animama Cloud
keeps its own linked plan for R12–R15.

## Delivery links

Phase issues: #418 (p1), #419 (p2), #420 (p3), #421 (p4), #422 (p5), #423 (p6),
#424 (p7), #425 (p8), #426 (p9). Follow-up issues to create: conversation
language, Included content display names, CJK crisis resources, the later locale
wave, and the linked Animama Cloud issue for R12–R15.
