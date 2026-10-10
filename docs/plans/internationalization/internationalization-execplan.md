# Deliver UI locales for Animama

Source agreement: [spec](internationalization-spec.md) for issue #385, agreed by
the owner on 2026-10-10 (intent discovery decisions, P1–P4, and acceptance of the
spec text by requesting this plan).
Authorized scope: the whole plan (owner instruction to implement it,
2026-10-10). Owner gates G1–G3 below stay with the owner and the PR.
Branch: `feat/internationalization` (renamed from the generated
`claude/i18n-intent-discovery-42bc7e`) in its existing worktree; pushed for the
PR after the final integration review.
Starting revision: `main` at `5993bbee` (branch fast-forwarded 2026-10-10).
Delivery: #385 holds the published spec (2026-10-10T05:27:55Z); phase sub-issues
#418–#426 with blocked-by links; the PR lists `Closes #385` and one `Closes #N`
line per phase issue.
Animama Cloud: R12–R15 and AC12 are delivered by a linked Cloud issue and plan
in the Cloud repository, consuming the shared contract this plan publishes.

## Purpose and context

Give the desktop and self-host app a UI Locale: English plus beta `ja`, `ko`,
`zh-Hans` and `zh-Hant` (machine translations), resolved from App settings, then
the OS or browser, then English; a language picker; locale-aware formatting;
converted owner-facing UI, desktop shell and backend diagnostics; Unicode-safe
name-derived identifiers; and guards that keep new UI translatable. The shared
locale contract, runtime and catalogs ship in the public packages and the hosted
application archive so Cloud can adopt them.

Paths are relative to `src/frontend/web/src/` unless they start with `src/`,
`docs/`, `tests/`, `alembic/` or `scripts/`.

| Area | Entry points |
| --- | --- |
| Setting | `src/backend/animama/orm/settings.py:18`, `domain/settings.py:17`, `app/contracts/settings.py:13,22`, `adapters/mappers/settings_map.py`, `app/services/settings_service.py` (`_UNSET`), `server/routers/settings.py`, `alembic/versions/0001_baseline.sql:908`, `docs/backend/architecture/http-api.md:1194` |
| SDK | `pnpm openapi-ts` (`src/frontend/scripts/generate-openapi-client.mjs`) → `src/frontend/packages/runtime-contracts/src/generated/` |
| Shared packages | `src/frontend/packages/runtime-contracts`, `src/frontend/packages/product-ui` (built by `src/frontend/scripts/build-typescript-package.mjs`; JSON default loader; exports must live under `dist/`) |
| App wiring | `main.local.tsx`, `main.hosted.tsx`, `app/AppProviders.tsx`, `app/router.tsx` (admission, reconnect banner), `index.html`, `index.hosted.html` |
| Settings | `ui/settings/SettingsProvider.tsx:257-300` (theme echo pattern), `query/hooks/useUserSettings.ts`, `query/mutations/useUpdateUserSettings.ts`, `ui/settings/AppearanceSettings.tsx`, `ui/settings/settings-search.ts`, `ApplicationSettingsModal.tsx` (section names double as IDs) |
| Tooling | `src/frontend/web/eslint.config.js`, `src/frontend/web/vitest.config.ts` (no `setupFiles`), `src/frontend/scripts/ci-source.mjs`, `src/frontend/playwright.config.ts:77-102` |
| Desktop | `src/frontend/desktop/src/runtime/recovery.ts`, `main.ts`, `window/create-window.ts:62`, `pip-window-manager.ts:477`, `quick-chat-window-manager.ts:438`, `preload.cts`, `runtime-preload.cts`, `runtime/ipc.ts`, `paths.ts`, `electron-builder.yml:32-33` |
| Diagnostics | `domain/anima_creation_error.py`, `server/schemas/anima_creation.py`, `app/services/anima_loadout_service.py:172-244`, `domain/content_documents.py:237`, `server/routers/content.py:156-180`, `app/contracts/content.py:42`, `server/sse_events.py:478-495`; frontend `lib/content/contentSaveErrors.ts`, `ui/library/ContentHealth.tsx:77`, `product-ui/src/chat/chat-failure.ts`, `product-ui/src/lib/runtime-errors.ts`, `memory-manager/errors.ts`, `memory-entries/errors.ts` |
| Names | `ui/action-editor/actionDocument.ts:78`, `query/mutations/useActionEditorActions.ts:59,199`, `lib/content/catalogApi.ts:109`, `useCreatorSave.ts:199`, `IdleStyleEditorPage.tsx:334`, `useAppearanceContentActions.ts:66`; backend `content_save_service.py:40` (`_ENTRY_NAME`), `content_kind_registry.py:56-57,797`, `routers/anima.py:271` |
| Safety | `product-ui/src/lib/chat/companion-safety.ts:67-84` (`preferredClientLocale`, crisis region only), `lib/safety/aiNotice.ts:51-59`, `ui/safety/CompanionSafetyView.tsx:24-90` |

Boundaries:

- Shared package source must not import `web`, `desktop` or Cloud.
- Generated SDK and TanStack Router output are regenerated, never hand-edited.
- No Alembic revision: the ORM and `0001_baseline.sql` change directly.
- Provider instructions, speech recognition language, crisis region and memory do
  not read the UI Locale (R6). Do not override Chromium's language in Electron:
  `navigator.languages` must keep reporting the OS list because the crisis region
  reads it.
- Stored data is never translated: persisted beat labels such as `Base` and
  `Expression`, settings IDs and content identifiers stay as they are; only their
  display is localized.
- Developer and debug tools stay English (explicit exemption list, Phase 1).

## Progress

- [x] 2026-10-10 Intent discovery, spec and P1–P4 agreed by the owner.
- [x] 2026-10-10 Code, contract and tooling map (backend, frontend, desktop, Cloud).
- [x] 2026-10-10 Workspace setup: spec published to #385, phase issues #418–#426,
      branch renamed to `feat/internationalization`, fast-forwarded to `5993bbee`.
- [ ] Phase 1: foundation (R1–R6, R16–R18).
- [ ] Phase 2: names in any script (R11).
- [ ] Phase 3: backend diagnostics and shared error wording (R10).
- [ ] Phase 4: app shell, chat and safety (R7, R9).
- [ ] Phase 5: Animas, Library and memory (R7).
- [ ] Phase 6: Settings, profile and sound (R7).
- [ ] Phase 7: creators (R7).
- [ ] Phase 8: desktop shell (R8).
- [ ] Phase 9: completion, guards at full strength and pseudo-locale smoke (R7, R17).
- [ ] Final integration review.
- [ ] PR; owner gates G1–G3; owner merge approval.

## Surprises & Discoveries

- Most backend diagnostics already carry a `code` next to `message` (Anima
  creation issues and errors, Loadout diagnostics, content save errors, scan
  diagnostics, runtime content diagnostics). R10 needs parameters for about 20
  formatted content-save messages and 3 Loadout messages, plus frontend wording;
  no new code vocabulary.
- The backend rejects non-ASCII entry names (`_ENTRY_NAME`
  `^[A-Za-z0-9][A-Za-z0-9._ -]{0,119}$`), and the frontend sends the raw display
  name as `entryName`; even "Café" fails today. Display names already accept
  Unicode, and package import already folds and numbers file names.
- `chat-failure.ts` stores resolved English strings in message state
  (`useProductChatSession.ts:792-800`), so failures would not re-translate on a
  locale switch without storing code and parameters instead.
- Settings section and group names double as IDs and labels.
- The local FastAPI serves raw `.json` with `no-cache`; catalogs should be JS
  chunks produced by `import()`, which get immutable caching.
- About 403 of 974 non-test web files contain user-visible strings by heuristic;
  `ui/debug/**` alone is about 943 lines and is exempt.
- No Electron menu is defined, so the default (English) menu shows; the main
  process has no locale cache; `runtime/state.json` is strictly versioned and
  stays separate.
- `user_settings.locale` defaults to `en-US`, which is not a supported tag under
  this plan and cannot mean "unset".

## Decision Log

- 2026-10-10, owner: scope decisions from intent discovery and P1–P4 (see spec).
- 2026-10-10, owner: implement the whole plan once ready.
- Proposed, agent: `i18next` + `react-i18next` (the issue's proposed direction),
  with `i18next-cli` for extraction, typed keys, status and the raw-string lint
  where it is sufficient; ESLint `eslint-plugin-i18next` only if the CLI lint
  cannot cover attributes and `toast()` literals. Versions at least two weeks old.
- Proposed, agent: canonical stored tags are `en`, `ja`, `ko`, `zh-Hans`,
  `zh-Hant`; `null` means "System default". The supported list, beta flags,
  native names and the pure resolver live in `@animama/runtime-contracts`; the
  i18n runtime, provider, formatters and language picker live in
  `@animama/product-ui`.
- Proposed, agent: name-derived identifiers stay ASCII so they remain valid for
  every model and file system. A name is folded (NFKD, combining marks removed);
  if folding drops any letter or digit, a short stable hash of the NFC name is
  appended. Pure-ASCII names keep exactly today's identifiers. Backend patterns
  do not change.
- Proposed, agent: the desktop shell caches the last applied locale in a new
  versioned `userData` file written through a new `animama:locale:*` IPC
  channel; the shell resolves its first-launch locale from
  `app.getPreferredSystemLanguages()` with the shared resolver.
- Proposed, agent: #385 closes with this PR; AC12 evidence belongs to the linked
  Cloud issue, which #385 links. To confirm with the owner at PR time.

## Owner gates

- **G1 — Beta visual pass (AC6).** For each beta locale, the owner reviews setup,
  chat, Library, one creator and Settings at desktop size and one narrower size.
- **G2 — Native desktop (AC8).** A macOS build shows the localized application
  menu and microphone prompt; the recovery page check runs on the owner's machine.
- **G3 — Pseudo-locale walkthrough (AC3).** The owner walks the converted screens
  under the pseudo-locale after the automated smoke passes.

Gates do not block phase progression; they are recorded in the PR.

## Phased implementation

Every phase: tests first where behavior is observable; phase checks; English keys
extracted; machine translations for all four beta locales added using the term
list (P2); `i18n:status` reports no missing beta keys for the phase's area (CI
only reports, per P1); bounded independent review (`sdlc-reviewer`: one full
review, at most two repair rounds) recorded below; commit
`<type>(i18n)[p#]: <summary>`.

Machine translation: the implementing agent translates each new or changed
English string into `ja`, `ko`, `zh-Hans` and `zh-Hant` with the term list and
the key's context (screen, control type, placeholders). Interpolation
placeholders, plural suffixes and markup are preserved exactly. Catalogs are
reviewed for placeholder parity by `i18n:check`.

### Phase 1 — Foundation (R1–R6, R16–R18)

Issue: #418. Dependencies: workspace setup.

1. **Backend setting.** `locale` becomes `Literal["en","ja","ko","zh-Hans","zh-Hant"] | None`
   in the domain, ORM (`nullable=True`, no default), contracts and baseline
   (`locale character varying`, nullable). `PATCH`/`POST` accept `null` to clear
   (the service's `_UNSET` sentinel already separates absent from `null`);
   invalid tags return 422. Tests: an HTTP settings test for set, clear, reject
   and default `null`; update `tests/test_settings_service.py`. Regenerate the
   SDK (`pnpm openapi-ts`, then `pnpm openapi-ts:check`). Update
   `docs/backend/architecture/http-api.md`.
2. **Locale contract** (`runtime-contracts`, new module exported from the root
   or a `./locale` subpath): `SUPPORTED_LOCALES`, `SOURCE_LOCALE`, `isBetaLocale`,
   native names, `matchLocale(tag)` (R2 mapping incl. Chinese), and
   `resolveLocale({ saved, preferred })`. Table tests (AC2).
3. **Runtime** (`product-ui`, new `./i18n` subpath): i18next instance factory with
   lazy per-locale loading (`import()` loaders supplied by the app so Vite
   chunks them), English fallback (R5), `I18nProvider`, `useLocale`, and
   formatters (`formatDate`, `formatTime`, `formatRelative`, `formatNumber`,
   `formatList`, `formatFileSize`, collator) applying the P3 region rule. Plural
   handling through i18next's `Intl.PluralRules`. Unit tests for formatting in
   every locale (AC5) and the fallback.
4. **Catalog layout.** Web: `web/src/locales/<tag>/<namespace>.json`.
   product-ui: `product-ui/src/locales/<tag>.json`, exported as per-locale
   subpaths so the app loads one locale at a time. Typed keys generated from the
   English catalogs. A term list per locale at `src/frontend/i18n/terms.json`
   (P2: `Animama` and `Anima` untranslated).
5. **App wiring.** Both entrypoints install the provider before admission (the
   admission screen and reconnect banner are translatable). Before settings load,
   the locale resolves from the OS/browser list; once App settings load, the saved
   value wins; changes apply through `changeLanguage` without remounting routes
   (R3). `<html lang>`/`dir` follow the active locale (R4); both `index*.html`
   lose the hard-coded `lang="en"` in favor of runtime assignment with `en` as the
   static default.
6. **Picker.** A Language row in Appearance: "System default" plus native names,
   beta marker; persists through the settings mutation, `null` for System
   default. Settings search finds it by translated and English terms ("Language").
   Separate settings section and group IDs from their display labels.
7. **Tooling.** `i18next.config.ts` (web + product-ui inputs), scripts
   `i18n:extract`, `i18n:types`, `i18n:check` (fails on keys used but missing
   from English, unused keys, placeholder mismatch, raw strings in non-exempt
   paths) and `i18n:status` (reports beta gaps without failing). Add `i18n:check`
   to `pnpm check`/`ci:source`. A transitional ignore list of unconverted paths,
   which each phase shrinks, plus the permanent debug exemption list. Vitest
   `setupFiles` initializes English synchronously so existing English assertions
   keep working. A dev-only pseudo-locale (accented, lengthened, bracketed) that
   is never in the picker, selectable in development through a query parameter.
   AC4 fixture tests prove the check fails on a raw string, a missing English
   key and an unused key.
8. **Records.** ADR 0021 (UI Locale separate from Conversation language; codes
   from the backend, words in the frontend; resolution order; beta policy).
   `GLOSSARY.md` entries "Locale" and "Conversation language".
   `docs/frontend/architecture/i18n.md`: adding strings, namespaces, the
   translation workflow, exemptions, pseudo-locale and adding a locale (R18).
9. **Pilot.** Appearance and the picker are fully converted and translated.

Checks: `uv run pytest -q tests/test_settings_service.py` plus the new settings
HTTP test, `uv run ruff check`, `make format-check`, `pnpm openapi-ts:check`,
`pnpm check`, `pnpm web:lint`, `pnpm web:test`, `pnpm build`.
Completion: switching the language in Appearance changes the converted UI
without losing a composer draft; restart keeps it; System default follows the
browser; AC2, AC4 and AC5 tests pass.

#### Code Review #1 Findings

Pending.

#### Code Review #1 Revisions

Pending.

### Phase 2 — Names in any script (R11)

Issue: #419. Dependencies: none beyond Phase 1 tooling.

- One shared helper module (`lib/content/nameIdentifiers.ts`) for semantic keys,
  logical-key slugs, entry names and companion file names, implementing the
  Decision Log rule; all six call sites use it, and avatar upload file names are
  sanitized the same way before upload.
- Tests: "おじぎ" and "お辞儀" produce distinct valid keys and entry names; "Café"
  saves; pure-ASCII names produce unchanged identifiers (regression table from
  today's outputs). A backend test asserts that the helper's outputs pass the
  existing patterns (shared fixture).
- Browser check: save two Japanese-named Gestures, reload, equip both in a
  Loadout without `gesture_semantic_key_conflict`, and select one in chat (AC10).

Checks: `pnpm web:test`, backend tests for content save and Loadout, `pnpm check`.

#### Code Review #1 Findings

Pending.

#### Code Review #1 Revisions

Pending.

### Phase 3 — Backend diagnostics and shared error wording (R10)

Issue: #420.

- Backend: add `params` to Loadout diagnostics (slot key, Gesture name, semantic
  key) and to the formatted content-save errors; the HTTP shapes gain an optional
  `params` object. English `message` stays for logs and API clients. Tests
  assert codes and params.
- Frontend: one shared lookup (`product-ui` `describeApiError` alongside
  `runtime-errors.ts`) maps `code` (+`params`) to catalog keys, with a translated
  generic fallback and the English detail as secondary technical text. Creation,
  Loadout, content save, ContentHealth, runtime content, memory and model
  configuration errors use it. Every user-visible code has wording (AC9 test that
  enumerates backend codes from a fixture against the catalog).
- Regenerate the SDK; update HTTP docs.

#### Code Review #1 Findings

Pending.

#### Code Review #1 Revisions

Pending.

### Phase 4 — App shell, chat and safety (R7, R9)

Issue: #421. Areas: `app/`, `routes/` (non-debug), `ui/sidebar`, `ui/main`,
`ui/components`, `ui/safety`, `hooks/`, `lib/emotion/presentation.ts`, product-ui
(`chat-failure.ts`, `run-status.ts`, `anima-profile.ts`, components).

- Chat failures store code and parameters and are worded at render, so a switch
  re-translates them; remove hard-coded `en-US` formatting.
- AI notice and crisis-card labels translated; crisis service data unchanged
  (AC11); crisis region still from `preferredClientLocale()` (AC7 test with a
  Japanese UI and an `en-US` browser).
- Exact-prompt test: provider instructions identical under every locale (AC7).

#### Code Review #1 Findings

Pending.

#### Code Review #1 Revisions

Pending.

### Phase 5 — Animas, Library and memory (R7)

Issue: #422. Areas: `ui/animas`, `ui/create-anima`, `ui/create`, `ui/library`,
`ui/memory*`, content sharing and import UI, `lib/content` messages.

#### Code Review #1 Findings

Pending.

#### Code Review #1 Revisions

Pending.

### Phase 6 — Settings, profile and sound (R7)

Issue: #423. Areas: `ui/settings/**` (all panels including models, voices, web
search, safety, desktop updates and feature packs), profile, `ui/sound*`,
`lib/speech` labels, `lib/theme`.

#### Code Review #1 Findings

Pending.

#### Code Review #1 Revisions

Pending.

### Phase 7 — Creators (R7)

Issue: #424. Areas: `ui/pose-creator`, `ui/action-editor`,
`ui/avatar-effect-creator`, `ui/particle-vfx-creator`, `ui/scene-effect-creator`,
`ui/content-creator`, `ui/creator`, user-facing labels in `lib/avatar`
(`anatomy.ts` joint names, `particle-vfx/catalog.ts`, `editor/*`),
`lib/effects/effectTemplates`. Persisted labels stay in English data; their
display is mapped.

#### Code Review #1 Findings

Pending.

#### Code Review #1 Revisions

Pending.

### Phase 8 — Desktop shell (R8)

Issue: #425.

- Desktop catalogs (`desktop/src/locales/<tag>.json`) for the recovery page,
  window titles and application menu; the shared resolver chooses the shell
  locale from the cache, then `app.getPreferredSystemLanguages()`.
- `window.animamaDesktop.locale.setApplied(tag)` (preload) → `animama:locale:set`
  (main role only) writes the versioned cache and rebuilds the menu and window
  titles.
- Recovery page takes a string table and `lang`; tested with the backend stopped.
- Application menu with the existing default roles and localized labels on every
  platform where a menu bar shows.
- macOS microphone prompt: per-locale `InfoPlist.strings` packaged as
  `<lang>.lproj` resources; verify the packaged bundle layout.

Checks: `pnpm desktop:check`, desktop unit tests; G2 on macOS.

#### Code Review #1 Findings

Pending.

#### Code Review #1 Revisions

Pending.

### Phase 9 — Completion (R7, R17)

Issue: #426.

- Convert remaining non-exempt strings; remove the transitional ignore list so
  only the debug exemptions remain; dedupe `formatFileSize` and inline plurals.
- `i18n:status` shows zero missing keys in every beta locale.
- Playwright `pseudo` project and smoke spec: sets the pseudo-locale, visits
  setup, chat, Library, a creator and Settings, and fails on visible text nodes
  without pseudo markers (excluding user content). Journeys stay English.
- Docs: frontend architecture, testing notes, desktop docs touched by the shell.

Checks: full local validation (below) and `pnpm e2e:test` against a disposable
built stack, since Animas, Loadouts and content flows change.

#### Code Review #1 Findings

Pending.

#### Code Review #1 Revisions

Pending.

## Final integration review

Covers R1–R11 and R16–R18 with AC1–AC11 across phases, reusing valid phase
evidence. Pending.

## Validation and acceptance

Local, before push (exact commands and results recorded per phase):

```bash
uv run pytest -q
uv run ruff check
make format-check
make check-test
```

From `src/frontend`:

```bash
pnpm check
pnpm web:lint
pnpm web:test
pnpm build
pnpm desktop:check
pnpm e2e:test
```

Hosted `Validation` stays disabled except an owner-approved run; record the
actual hosted scope separately. Owner gates G1–G3 are listed in the PR.

## Idempotence and recovery

- Development databases created before Phase 1 keep a non-null `en-US` locale;
  the baseline change makes the column nullable for new databases. Existing
  development stacks are reset at the owner's discretion, or the value is cleared
  through the settings API. `en-US` is rejected by the new contract only on write;
  reads map unsupported stored values to `null` so old rows load.
- Catalog extraction and type generation are deterministic and safe to rerun.
- Identifier changes affect only names that today produce invalid or colliding
  identifiers; existing saved content is not renamed.
- The desktop locale cache is optional; a missing or invalid file falls back to
  the OS locale.

## Outcomes & Retrospective

Pending.
