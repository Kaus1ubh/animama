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
- [x] Phase 1: foundation (R1–R6, R16–R18); review #2 passed 2026-10-10; commits
      `1766cc8f`, `4ef6786a` (browser fixtures render with the i18n provider).
- [x] Phase 2: names in any script (R11); review #3 passed 2026-10-10.
- [x] Phase 3: backend diagnostics and shared error wording (R10); review #2
      passed 2026-10-10.
- [x] Phase 4: app shell, chat and safety (R7, R9); review #2 passed 2026-10-10.
- [x] Phase 5: Animas, Library and memory (R7); review #3 passed 2026-10-10.
- [x] Phase 6: Settings, profile and sound (R7); review #2 passed 2026-10-10.
- [x] Phase 7: creators (R7); review #2 passed 2026-10-10.
- [x] Phase 8: desktop shell (R8); review #3 passed 2026-10-10; G2 pending.
- [x] Phase 9: completion, guards at full strength and pseudo-locale smoke (R7, R17); review #2 passed 2026-10-13.
- [ ] Final integration review.
- [ ] PR; owner gates G1–G3; owner merge approval.

## Handoff

Paused by the owner during Phase 7 and resumed the same day (2026-10-10).
Paused again on 2026-10-10 during Phase 9, after Code Review #1.
- Phases 1–8 are committed (`a65ec81c` is Phase 8).
- Phase 9 and the Phase 7 stylesheet fix are uncommitted in the worktree; see
  Phase 9's Code Review #1 Revisions for the next steps.
- The full journey suite passed 38 of 38 on this tree, and the pseudo smoke
  passed 3 of 3.
- The task stacks are stopped.

- Worktree `worktrees/animama/i18n-intent-discovery-42bc7e`, branch
  `feat/internationalization`, based on `5993bbee`. Each phase is committed
  after its review passes; nothing is pushed until the final PR.
- Task stack `animama-i18n` (base port 8300, development build) at
  `http://animama-i18n.localhost:8300`. Restart it with
  `./reset.sh --name i18n --base-port 8300` from this worktree and stop it with
  `docker compose -p animama-i18n stop`. After product-ui changes, rebuild the
  packages inside the `web` service.
- `tests/local-api-proxy.test.ts` fails while another task's server holds port
  5173. That failure is environmental.

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
- Phase 7 load-order change, problem 1: wording during module load blanked the
  app before i18n existed, and Vitest could not show it because its setup
  initializes i18n first.
- Phase 7 load-order change, problem 2: moving the application imports behind
  `createWebI18n` changed stylesheet order in production builds only.
  - `RuntimeOwnerContext` imports `@animama/product-ui/styles.css`, which then
    became a later chunk, so its `.hidden` overrode the app's `lg:` utilities.
  - The creator toolbars collapsed to the narrow layout at 1440 px.
  - The Vite development server, Vitest and the pseudo smoke did not show it.
  - The full journey suite on a built stack did: 19 failures.
  - The entry files now import that stylesheet before `index.css`, and
    `entrypoints.test.ts` checks the order.

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
- 2026-10-10, agent (Phase 1, within the agreed outcome): product-ui loads each
  locale's catalog through internal `import()` chunks emitted by its build
  rather than per-locale export subpaths, so consumers get one-locale loading
  without wiring; `i18n:types` is part of `i18n:extract`. Dependency versions
  `i18next` 26.4.2, `react-i18next` 17.0.15 and `i18next-cli` 1.74.1 were each
  published more than two weeks earlier (npm registry, 2026-10-10).
- 2026-10-10, agent: the wheel now stores `locale` as NULL for "System default";
  Cloud's hosted baseline (`NOT NULL DEFAULT 'en-US'`) must allow NULL before it
  repins this package set. Recorded for the linked Cloud issue.
- 2026-10-10, agent (Phase 3, within R10): word the codes a user can trigger
  through normal UI actions — Anima creation, Loadout, model configuration and
  web search, and the content save, sharing, upload and profile codes the UI
  already mapped. Schema-internal content validation, scan, runtime and memory
  messages are developer text: a translated generic message with the English as
  secondary detail outside English (R10's second sentence). Only Loadout
  warnings needed new backend `params`; content-save messages should keep their
  English explanation as secondary detail (today it is inside the sentence;
  P3-R1-04, Phase 5). The lookup lives in `web/src/lib/errors` because its
  areas are web screens; product-ui chat failures have their own catalog keys.
- Proposed, agent: #385 closes with this PR; AC12 evidence belongs to the linked
  Cloud issue, which #385 links. To confirm with the owner at PR time.
- Proposed, agent (Phase 8; deviates from R8; owner confirms at G2): the
  macOS microphone prompt follows the language macOS uses for the app (the
  system language, or the app's language in System Settings), not the in-app
  UI Locale. macOS picks `InfoPlist.strings` by that language. The startup page,
  window titles and application menu follow the in-app locale as R8 requires.
  - Alternative: the app could write its own per-app `AppleLanguages` default
    (`systemPreferences.setUserDefault`), which would likely apply at the next
    launch.
  - Not chosen because:
    - it would also change Chromium's locale and
      `app.getPreferredSystemLanguages()`, which the shell and the "System
      default" setting rely on;
    - it changes an OS-level preference the owner manages in System Settings;
    - it would lag one launch behind the in-app choice.

## Owner gates

- **G1 — Beta visual pass (AC6).** For each beta locale, the owner reviews setup,
  chat, Library, one creator and Settings at desktop size and one narrower size.
- **G2 — Native desktop (AC8).** A macOS build shows the localized application
  menu and microphone prompt; the recovery page check runs on the owner's machine.
  Also confirm that Start Dictation and Emoji & Symbols still appear under the
  localized Edit menu when the in-app locale differs from the macOS language,
  and that the microphone prompt follows the macOS language (see the Phase 8
  decision).
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
8. **Records.** ADR 0024 (UI Locale separate from Conversation language; codes
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

#### Phase 1 results (2026-10-10)

Source: `7550f192` plus the Phase 1 working tree. Local evidence:

- `pnpm check` (web and desktop type checks plus `pnpm i18n:check`): pass.
- `pnpm web:lint`, `pnpm packages:check`: pass. `pnpm packages:test`:
  runtime-contracts 9, product-ui 36, discover-client 1 passed.
- `pnpm web:test`: 3744 passed, 1 skipped; 4 failed in
  `tests/local-api-proxy.test.ts` with "Port 5173 is already in use" because
  another task's animation-preview server holds host port 5173 (environmental;
  not stopped). The browser script tests after vitest were run separately.
- Backend: `uv run pytest -q` 3544 passed, 10 skipped; `uv run ruff check` and
  `make format-check` pass; `pnpm openapi-ts:check` current.
- Browser (task stack `animama-i18n`, `http://animama-i18n.localhost:8300`,
  development mode, desktop 1280×800): Appearance shows "System default
  (English)" and each locale in its own script with Beta; switching to 日本語,
  한국어, 简体中文 and 繁體中文 updates the open settings live, sets
  `<html lang>`/`dir`, and keeps an unsent composer draft; the choice persists
  across reload; System default follows the browser; searching "language"
  under 한국어 finds 언어.
- Discovery: in the first dev session after a stack start, the first switch to
  a locale whose catalog was not yet loaded left mounted text in the previous
  language. Both i18n packages showed separate Vite dependency-optimization
  batches; pre-bundling and deduping `i18next` and `react-i18next` in
  `vite.config.ts` fixed it on a restarted dev server (same sequence verified).
  `web/src/i18n/LocaleSync.test.tsx` covers the saved-locale switch with a
  memoized consumer.

#### Code Review #1 Findings

Reviewer: `sdlc-reviewer`, full initial review of `7550f192` plus the working
tree (2026-10-10).

- **P1-R1-01 (required).** `web/i18next.lint.config.ts` set `acceptedAttributes`
  without `acceptedTags`, so the lint checked only plain HTML tags and missed
  text and `label`/`description` on components such as `SettingsRow` and
  `SelectItem` (R17). Evidence: a fixture and `AboutSettings.tsx` found 2 of 7
  raw strings.
- **P1-R1-02 (required).** AC4 fixtures for the CLI steps were missing: no test
  showed `i18n:check` failing on a raw string, a key missing from English or an
  unused English key.
- **P1-R1-03 (required before PR).** Structural OpenAPI change and changed
  package declarations without version bumps (`scripts/package-sets/README.md`
  compatibility policy).
- **P1-R1-04 (required).** AC5 coverage incomplete: no time formatting, numbers
  only for `en-US`, dates skipped `zh-Hant`, plurals only `en`/`ja`, and no test
  that `<html lang>`/`dir` follow the locale.
- **P1-R1-05 (optional).** Settings group names still double as grouping keys;
  Appearance entries now group by translated text.
- **P1-R1-06 (optional).** `token.key as …` cast meant a new colour token without
  a catalog key would render the raw key.
- Other notes: plan deviations to record; a failed catalog load shows English
  under the requested `lang` (acceptable under R5); the pseudo-locale also marks
  interpolated values; "主色颜色"-style doubled wording in Chinese; boundary docs
  did not list `/i18n` and `/locale`; Cloud's `NOT NULL` locale column will
  reject the NULL the wheel now writes until Cloud's schema changes.

#### Code Review #1 Revisions

- **P1-R1-01 accepted.** `acceptedTags: "all"` plus `description`; converted
  files still lint clean. The i18n guide describes the coverage.
- **P1-R1-02 accepted.** `scripts/i18n-check.test.mjs` runs the CLI on temporary
  fixtures: clean source passes without writing; raw text in a component's
  children or `label` fails the lint; a missing and an unused English key each
  fail `extract --ci --dry-run`. Added to `i18n:check` (4 tests pass).
- **P1-R1-03 accepted.** `local-http` 3.0.0 → 4.0.0, `@animama/runtime-contracts`
  0.3.1 → 0.4.0, `@animama/product-ui` 0.7.0 → 0.8.0; `contracts/hosted-web.md`
  and `http-api.md` updated. Consumer bounds derive from `versions.json`.
- **P1-R1-04 accepted.** Table-driven formatting test (date, time, number,
  relative time, list) for `en-US`, `en-GB`, `ja`, `ko`, `zh-Hans`, `zh-Hant`;
  plurals for every beta locale; `applyDocumentLocale` sets `lang`/`dir`; the
  LocaleSync test asserts `dir`.
- **P1-R1-05 deferred to Phase 6**, which converts every Settings group and
  separates group IDs from labels; Appearance renders without group headings.
- **P1-R1-06 accepted.** `AppearanceColorToken.key` is typed
  (`AppearanceColorTokenKey`) and `colorTokenLabel` maps each key with a literal
  catalog call.
- Chinese token names no longer end in 色 ("主要颜色", "强调颜色"). Boundary docs
  list `/i18n` and `/locale`; "Adding a locale" names `loadProductCatalog` and
  the version bump. The pseudo-locale marking interpolated values is noted for
  the Phase 9 smoke. The Cloud `NOT NULL` column is recorded for the Cloud issue.
- Checks after revisions: `pnpm i18n:check`, `pnpm packages:check`,
  `pnpm packages:test`, web `tsc`, targeted vitest and ESLint pass.

Repair budget: one of two repair rounds used.

#### Code Review #2 Findings

Targeted recheck of the accepted findings and regressions (2026-10-10): pass.
All accepted findings fixed; the Vite pre-bundle change keeps one react-i18next
copy. Optional: **P1-R2-01** the colour-label switch was not exhaustive (a new
named key would render "Chart NaN"); **P1-R2-02** the CLI fixture test copied
the lint settings instead of reading them; **P1-R2-03** formatter expectations
depend on Node's ICU data (CI pins the same Node 24.15.0).

#### Code Review #2 Revisions

- **P1-R2-01 accepted.** Chart keys are handled by a type guard first, and the
  switch over named keys ends in a `never` check.
- **P1-R2-02 accepted.** Lint settings live in `web/i18n-scope.json`; the lint
  config and `scripts/i18n-check.test.mjs` both read them.
- **P1-R2-03 noted.** A Node/ICU upgrade may need updated expected strings.
- Checks: `pnpm i18n:check` (9 tests, extract, types, lint, catalogs) and web
  `tsc` pass. Phase 1 complete; review passed in round #2.

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

#### Phase 2 results (2026-10-10)

Source: `4ef6786a` plus the Phase 2 working tree.

- Web: `lib/content/nameIdentifiers.ts` (`nameHash`, `withNameHash`,
  `contentSlug`, `contentEntryName`) used by Gesture semantic keys, action and
  Local logical-key slugs, appearance image logical keys and the Create Anima
  avatar collision check. Backend: `app/services/content_names.py` shared by
  `readable_entry_name` (Save and voice-catalog uploads) and package import
  path names. The shared fixture `lib/content/fixtures/name-identifiers.json`
  pins hash, semantic key, slug and entry name on both sides.
- Checks: web vitest (content, create-anima, mutations, action-editor) 104
  files / 746 tests pass; web `tsc` pass; backend name, save, package import
  and HTTP tests 72 pass; `test_name_identifiers.py` 19 pass; ruff, format and
  mypy pass.
- Browser (task stack): a Pose named お辞儀 saved as `poses/item-0f2f10u`;
  Gestures おじぎ and お辞儀 saved with semantic keys `gesture_04tkfzn` and
  `gesture_0f2f10u`, logical keys `local:gesture:untitled-<hash>`, and both
  equipped on Annie without `gesture_semantic_key_conflict` ("Loadout updated").
  Limitation: the model selecting them in chat was not exercised (needs a paid
  provider turn); the model receives each Gesture's name, description and
  selector.

#### Code Review #1 Findings

Reviewer: `sdlc-reviewer`, full review of `4ef6786a` plus the working tree.

- **P2-R1-01 (required).** `CreateAnimaAvatarStep.avatarCollisionTarget` copied
  the old entry-name rule, so a second `ミク.vrm` upload got `content_path_exists`
  without the offered replacement.
- **P2-R1-02 (required).** `useAppearanceContentActions.logicalName` gave every
  image name in another script the same logical key (`local:appearance:image`),
  which made dependency resolution ambiguous.
- **P2-R1-03 (required).** Package import `_path_name` folded every name in
  another script to `content` and renamed a differently named second item.
- **P2-R1-04 (optional).** Hashing the untrimmed name changed keys for names
  with trailing (including ideographic) spaces.
- **P2-R1-05 (optional).** A Python test compared a string with itself.
- **P2-R1-06 (optional).** Redundant entry-name condition; marks removed twice.
- **P2-R1-07 (optional).** Docs overclaimed that different names never share
  an entry.
- Noted, outside the rule: emoji-only names still fall back; JSON download
  names for other scripts stay generic; `toLocaleLowerCase` on a Turkish host
  and Windows device names on Save are pre-existing; Python (Unicode 15) and
  Node (Unicode 17) classify a few thousand newly assigned characters
  differently. Verified: hash parity for every code point and 20,000 random
  strings; unchanged identifiers for names that fold losslessly.

#### Code Review #1 Revisions

- **P2-R1-01 accepted.** `contentEntryName` mirrors `readable_entry_name`
  (tested against the fixture's `entryName` column); the collision check uses it.
- **P2-R1-02 accepted.** `logicalName` keeps its ASCII output and adds the name
  hash when folding drops characters.
- **P2-R1-03 accepted.** Name helpers moved to `app/services/content_names.py`;
  `_path_name` appends the hash (`content-<hash>`), tested.
- **P2-R1-04 accepted.** Both hashes trim first; tested with U+3000.
- **P2-R1-05/06 accepted.** NFD test; `readable_entry_name` folds only non-ASCII
  names through `portable_name`.
- **P2-R1-07 accepted.** Storage docs state the `Café`/`Cafe` case and the
  package import paths.
- Out-of-rule notes are recorded here; emoji-only names and download file names
  keep their current fallbacks.

Repair budget: one of two repair rounds used.

#### Code Review #2 Findings

Targeted recheck: P2-R1-01..07 fixed. **P2-R2-01 (required)** the new
`contentEntryName` ASCII test `/^[\x00-\x7f]*$/` failed ESLint
`no-control-regex` (`pnpm web:lint`). **P2-R2-02 (optional)** JavaScript `trim()`
and Python `strip()` differ for U+001C–U+001F, U+0085 and U+FEFF at the ends of
a name, so such names hash differently on each side.

#### Code Review #2 Revisions

- **P2-R2-01 accepted.** `/^\p{ASCII}*$/u`; `pnpm lint` (web) passes; content and
  create-anima tests 107 pass.
- **P2-R2-02 deferred.** Real names rarely start or end with those control or
  BOM characters; the mismatch only weakens the avatar collision hint.

Repair budget: two of two repair rounds used.

#### Code Review #3 Findings

Final targeted recheck of P2-R2-01: fixed; ESLint on the Phase 2 web files
passes; `contentEntryName` returns the same result as before the fix for
249,475 generated names. Result: pass.

### Phase 3 — Backend diagnostics and shared error wording (R10)

Issue: #420.

- Backend: Loadout warnings gain `params` (`slot`, `name`, `semanticKey`); the
  English `message` stays for logs and API clients. Tests assert the contract.
- Frontend: `web/src/lib/errors/apiError.ts` (`readApiError`, `errorWording`,
  `apiErrorText`, `apiErrorLine`) words `errors:<area>.<code>`; unworded codes
  show the backend English in English and a translated generic message with the
  English as secondary detail elsewhere. `creationErrors.ts` and
  `loadoutErrors.ts` wrap creation issues/failures and Loadout failures/warnings.
  Content save, sharing, upload, profile, model-configuration and web-search
  modules read their copy from the `errors` catalog.
  `web/src/lib/errors/userVisibleCodes.json` lists 194 worded codes; its test
  requires each in all five catalogs (AC9).
- Deferred to the phases that convert their screens: ContentHealth (scan
  diagnostics), runtime content and memory use the same lookup or fall back to
  generic + detail; product-ui chat failures get their own catalog keys (Phase 4).
- Regenerate the SDK; document Loadout warning `params` in `http-api.md`.

#### Code Review #1 Findings

Reviewer: `sdlc-reviewer`, full review of `7ea5826b` plus the uncommitted Phase 3
paths (2026-10-10). Evidence at review: `pnpm i18n:check` pass, web `tsc` and
ESLint pass, targeted vitest 25 files / 250 passed, backend loadout tests pass.

- **P3-R1-01 (required, record and docs only).** This section still describes
  the shared lookup in product-ui and content-save `params`; the implementation
  puts it in `web/src/lib/errors` (`apiError.ts`, `creationErrors.ts`,
  `loadoutErrors.ts`), adds params only to Loadout warnings, and defers the
  ContentHealth, runtime and memory renderers. The scope decision is missing from
  the Decision Log, and no backend doc mentions Loadout warning `params`.
- **P3-R1-02 (optional).** Missing `params` would leave `{{name}}` in the text;
  add a service-level assertion; unworded Loadout warnings return English in
  every locale.
- **P3-R1-03 (optional).** Worded `anima_creation_defaults_unavailable` drops its
  four distinct backend causes.
- **P3-R1-04 (optional).** Some backend/Error English is interpolated into the
  primary translated sentence (`contentSaveErrors.ts:96`,
  `useCreateAnimaController.ts:289`).
- **P3-R1-05 (optional).** `join(", ")` lists in sharing and upload messages.
- **P3-R1-06 (optional).** DRY: `readApiError` vs `parseContentApiErrorDetail`,
  unused `status`/`field`, long `case` arms where `errorWording` would do.

#### Code Review #1 Revisions

- **P3-R1-01 accepted.** This section describes the delivered helpers and the
  deferred renderers; the Decision Log records the scope decision; `http-api.md`
  documents Loadout warning `params`.
- **P3-R1-02 accepted.** The Idle Style Loadout service test asserts the `slot`
  param; unworded Loadout warnings use the shared fallback (generic + English
  detail outside English).
- **P3-R1-03 deferred.** A cause-specific `reason` for
  `anima_creation_defaults_unavailable` needs backend reason codes; English
  previously showed the cause, so record for Phase 5 (Animas and creation).
- **P3-R1-04 deferred to Phase 5** with the creation and content renderers,
  which will show the English explanation as secondary detail.
- **P3-R1-05 deferred to Phase 5** (sharing/upload lists via `{{items, list}}`).
- **P3-R1-06 deferred.** DRY clean-ups of `parseContentApiErrorDetail` and the
  upload `case` arms land with Phase 5's content screens; no behavior impact.
- Checks: backend loadout tests 6 pass; web `src/lib/errors` and `src/ui/animas`
  67 pass; `tsc` pass.

Repair budget: one of two repair rounds used.

#### Code Review #2 Findings

Targeted recheck of P3-R1-01 and P3-R1-02: both resolved, no regressions.
Optional wording nits in this plan (chat-failure deferral, content-save detail
target state) were applied before commit. Result: pass.

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

#### Phase 4 results (2026-10-10)

Source: `5920f506` plus the Phase 4 working tree.

- Product UI: `useProductTranslation` (application instance, else an English
  fallback for hosts without a provider); chat failures store catalog
  references (`copy`) and are worded at render, keeping English `title` and
  `guidance` for hosts and logs; notice, composer, transcript, conversation,
  run status and chat-session placeholder/toasts translated; web-search
  unavailability carries a `code`; catalogs moved to
  `locales/<tag>/product.json`; `formatAnimaTimestamp` (unused, fixed `en-US`)
  removed; product-ui raw-string lint and a no-literal-toast guard in
  `i18n:check`.
- Web (namespaces `app` 127, `setup` 95, `sidebar` 53, `chat` 162,
  `emotion` 110, `safety` 13, `components` 13 keys): app shell, admission,
  first-run setup, routes, sidebar (except App Settings, Phase 6), hooks, main
  chat screen, canvas, header (except Anima Settings, Phase 6), web components,
  Toaster labels, safety views, emotion labels, AI notice, crisis-card labels.
  Dates, numbers and sizes use `useFormatters()` (for example `12 kB`).
- Safety (R9): crisis services, numbers and descriptions render as backend data
  (test); the protocol has machine translations
  `docs/safety/crisis-protocol.<locale>.md` loaded per locale by
  `useCrisisProtocol` (test), English authoritative.
- R6: `currentChatClientContext()` keeps the browser locale under a Japanese UI
  (test); emotion labels and the AI notice are display-only; prompt suggestions
  translate labels but send English prompts (owner question below).
- Checks: `pnpm check` (incl. `i18n:check`), `pnpm web:lint`, `tsc` pass;
  `pnpm packages:test` (product-ui 37) pass; web vitest 3775 passed, 1 skipped,
  4 failed only in `tests/local-api-proxy.test.ts` (host port 5173 held by
  another task's preview server).
- Browser (task stack, saved locale `ja`): main chat screen, sidebar, header,
  composer placeholder and toast region in Japanese; `/safety` protocol shows
  the Japanese translation. Note: the development container builds its own copy
  of the shared packages at start; after product-ui changes run
  `pnpm packages:build` inside the `web` service or restart it.
- Open owner question: should prompt suggestions send their prompt in the UI
  Locale (it changes what the Anima is asked) or stay English until the
  conversation-language follow-up? Current behavior: English.

#### Code Review #1 Findings

Reviewer: `sdlc-reviewer`, full review of `5920f506` plus the Phase 4 working
tree (2026-10-10).

- **P4-R1-01 (required).** The AC7 exact-prompt evidence was missing (only the
  crisis-region client test existed).
- **P4-R1-02 (required).** Docs still described `locales/<tag>.json` for
  product-ui and did not tell product-ui code to use `useProductTranslation()`.
- **P4-R1-03 (required).** Setup was recorded as converted while it still shows
  English from shared settings modules (provider purposes, connection status,
  model detection, location tabs inside a translated label, connection form,
  desktop credentials, Pocket option reasons, offline speech downloads).
- Optional: a host's own i18next instance without the product namespace would
  show raw keys; no drift guard for translated crisis lines; orphaned JSDoc in
  `chat-input.tsx`; product-ui Prettier drift; attachment details without a
  size began with " · "; `hostedExclusionReasons` getter object; product-ui
  lint config imports web's scope file; `__root` meta description updates only
  on navigation.

#### Code Review #1 Revisions

- **P4-R1-01 accepted.** `tests/test_ui_locale_independence.py`: for UI
  Locales `ja`, `zh-Hant` and unset, turn chat options, effective companion
  safety and the crisis region are identical (two client locales), and the
  prompt assembler takes no locale or language input (3 tests pass). Speech
  recognition keeps its existing language choice (`recognition.lang`, default
  `en-US`) and never reads the UI Locale (code inspection; conversation
  language is the follow-up).
- **P4-R1-02 accepted.** `i18n.md` and `src/frontend/AGENTS.md` name
  `locales/<tag>/product.json` and `useProductTranslation()`.
- **P4-R1-03 accepted as a recorded dependency.** Setup's English from shared
  settings modules (`model-configuration-state.ts` purposes/status/detection,
  `MODEL_LOCATION_TABS`, `ModelConnectionForm`, `DesktopCredentialsPanel`,
  Pocket option reasons, `OfflineSpeechDownloads`) converts in Phase 6, which
  owns those modules; Phase 9's pseudo-locale smoke covers setup.
- Optional accepted: `useProductTranslation` uses an instance only when it was
  set up with the product namespace; `crisisProtocolTranslations.test.ts`
  compares every link and number with English (5 pass); JSDoc fixed; product-ui
  files formatted; attachment details without a size use
  `fileDetailsNoSize`. Deferred (no behavior impact): the getter object,
  product-ui lint config coupling, `__root` meta description refresh.
- Checks: product-ui tests 37 pass; web `tsc` pass; web vitest (chat, components,
  safety, main) 184 pass; `pnpm i18n:check` pass; ruff pass.

Repair budget: one of two repair rounds used.

#### Code Review #2 Findings

Targeted recheck: P4-R1-01..03 resolved; optional fixes caused no regressions.
The speech-recognition wording in this record was corrected. Result: pass.

### Phase 5 — Animas, Library and memory (R7)

Issue: #422. Areas: `ui/animas`, `ui/create-anima`, `ui/create`, `ui/library`,
`ui/memory*`, content sharing and import UI, `lib/content` messages.

Results (2026-10-10, three parallel agents on disjoint areas, integrated by the
coordinator):

- New namespaces `animas`, `contentHealth`, `create`, `library` and `memory`,
  translated into all four beta locales. Converted and linted: `ui/animas`,
  `ui/action-manage`, `ui/content-health`, `ui/create-anima`, the Create hub
  and pickers, `ui/library`, `ui/memory`, `lib/memory-entries`,
  `lib/memory-manager`, `lib/content-sharing`, the Library upload and content
  message modules, and `useLibrarySharingFlow`. The two Create preview files used
  only by the avatar-portrait debug route are exempt.
- Phase 3 deferrals resolved:
  - P3-R1-03: the multi-cause `anima_creation_defaults_unavailable` keeps the
    backend cause as detail in every locale.
  - P3-R1-04: backend English moves from the translated sentence to detail.
  - P3-R1-05: item lists use `{{items, list}}`; codec lists use the disjunction
    style.
  - P3-R1-06: `parseContentApiErrorDetail` reuses `readApiError`, and the upload
    arms collapse into `errorWording`.
- `apiErrorText` accepts a `null` area for services that send no codes. The new
  `uncodedErrorText` words stored English (Memory Manager `run.error`, upload
  `last_error`, preview and clone failures) by the same rule.
- Intentional English changes:
  - sizes come from the shared formatter ("37.9 MB", "2 kB", "MB" not "MiB");
  - the codec list reads "MP3, WAV, or Ogg";
  - "1 file verified" is singular;
  - an upload filter uses the row labels.
- Term list: added Action, Identity, Starter Pack and My Content. The Chinese
  renderings are aligned across namespaces (行为/行為, 身份设定/身分設定).
- The i18n guide covers `getFixedT` outside React (the extractor does not see
  `getI18n().t("ns:key")`), `{{items, list}}`, multi-cause codes and
  `uncodedErrorText`. The lint config limits converted directories to
  `ts`/`tsx`, because `ui/memory` holds a stylesheet.
- Left for later phases:
  - Phase 6: `lib/speech/pocket` text (accents, sample player, clone
    validation, encoder failure text) and `OPERATOR_MANAGED_MODELS_NOTE`.
  - Phase 7: `NON_PORTABLE_REASON` in the action editor, creator recovery and
    readiness text, `lib/content-preview` messages and version labels, and
    `lib/effects` template labels that are no longer displayed.
  - Included content names, per the spec.
- Checks:
  - `pnpm i18n:check`, `pnpm --filter animama-web check` and `pnpm web:lint`
    pass; Prettier is clean on the changed web files.
  - Web vitest: 3792 pass. 4 fail in `tests/local-api-proxy.test.ts` because
    another task holds port 5173.
  - Browser under `ja` on the task stack: Anima detail and Loadout, Library,
    Memory, the Create hub and Anima creation step 1 show Japanese chrome. Stored
    profile text and Included content names stay as authored.

#### Code Review #1 Findings

Reviewer: `sdlc-reviewer`, full review of the Phase 5 working tree on
`4d050f70` (2026-10-10). It confirmed P3-R1-03 to P3-R1-06 are resolved, the
refactors keep their behavior, placeholder parity holds and stored data is not
translated.

- **P5-R1-01 (required).** `VoiceCloneLibrary` `cloneError` returned any
  `Error.message`, so clone and network English became the primary text outside
  English; its docstring said otherwise.
- **P5-R1-02 (required).** Library upload rows always used `processingFailed`
  as the generic message, so a usable keyword-only upload read "Processing
  failed" outside English.
- Optional:
  - **P5-R1-03:** `contentDiagnosticText` duplicated the English-first rule.
  - **P5-R1-04:** the tracked-emotion check was duplicated (also in
    `SharingPackageDetails`).
  - **P5-R1-05:** preview runtime `Error.message` was primary in every locale.
  - **P5-R1-06:** the Chinese "Identity" was only partly aligned.
  - **P5-R1-07:** `lib/effects` template labels are unused copies.
  - Minor: a raw `{{role}}` ID inside the content-source sentences; the Memory
    "Animas" folder label; three sentence fragments.

#### Code Review #1 Revisions

- **P5-R1-01 accepted.** `cloneError` keeps a worded `ContentSaveApiError`.
  Everything else goes through `apiErrorText(readApiError(error), null,
  fallback)`, and the docstring now matches.
- **P5-R1-02 accepted.** `storedUploadErrorLine` in `upload-card-status.ts`
  picks the generic message by status and serves both the upload card and the
  Library row. A new `ja` test covers keyword-only and failed uploads.
- **P5-R1-03 accepted.** `contentDiagnosticText` uses `uncodedErrorText`; its
  tests switch the locale instead of passing a language.
- **P5-R1-04 accepted.** `storedEmotionLabel` in `lib/emotion/presentation.ts`
  replaces the three copies.
- **P5-R1-05 accepted.** `AnimaAvatarStage` preview failures use
  `uncodedErrorText`.
- **P5-R1-06 accepted.** All Chinese Identity strings use 身份设定/身分設定.
- **P5-R1-07 deferred** to Phase 7, which owns `lib/effects` and the creators.
- Minor items deferred:
  - The `{{role}}` sentences come from `loadCreatorPreviewFile`, which creators
    use and which the Library sound dialog also uses for its `audio` role. They
    appear only when a file is missing. Wording the roles belongs to Phase 7.
  - The "Animas" folder label is a path segment.
  - The fragments read as labels.
- Checks after repair:
  - `tsc` and eslint pass.
  - Vitest in content-health, animas, emotion, content, library, uploads,
    user-files and errors: 76 files, 522 pass.
  - `pnpm i18n:check` passes.

Repair budget: one of two repair rounds used.

#### Code Review #2 Findings

Targeted recheck. P5-R1-02 to P5-R1-05 are resolved without regressions, and
the P5-R1-07 deferral is reasonable.

- **P5-R2-01 (required).** P5-R1-01 was only partly fixed.
  - `cloneError` read the code through `parseContentApiErrorDetail`, which
    returns `null` for a `ContentSaveApiError`.
  - Deleting an in-use clone therefore showed the English from
    `toVoiceCloneError` in every locale.
  - No test covered delete rejection.
- Optional:
  - The Chinese `memory.json` still used the short Identity term in seven
    strings.
  - The `{{role}}` deferral reason was incomplete.
  - `storedEmotionLabel` had no direct test.

#### Code Review #2 Revisions

- **P5-R2-01 accepted.** `cloneError` reads `code` from a
  `ContentSaveApiError` first. A new `ja` test deletes an in-use clone and
  expects the voice wording; it fails without the fix and passes with it.
- Optional accepted:
  - the seven `memory.json` strings use 身份设定/身分設定;
  - the `{{role}}` deferral above is corrected;
  - `presentation.test.ts` covers `storedEmotionLabel`.
- Checks:
  - vitest in emotion, animas and memory: 14 files, 127 pass;
  - `tsc`, eslint and `pnpm i18n:check` pass.

Repair budget: two of two repair rounds used.

#### Code Review #3 Findings

Final targeted review. P5-R2-01 is resolved: the delete-in-use path shows the
voice wording. The optional revisions caused no regressions. Result: pass.

### Phase 6 — Settings, profile and sound (R7)

Issue: #423. Areas: `ui/settings/**` (all panels including models, voices, web
search, safety, desktop updates and feature packs), profile, `ui/sound*`,
`lib/speech` labels, `lib/theme`.

Results (2026-10-10, three parallel agents, integrated by the coordinator;
Phase 5 committed as `d9b0a5d2`):

- New namespaces `models`, `voice` and `sound`; `settings` is extended.
  - Converted and linted: all of `ui/settings`, `ui/sidebar` and `ui/main`
    (including the App and Anima settings windows), `ui/profile`, `ui/theme`,
    `lib/theme`, `lib/user-profile`, `lib/settings/desktop-shortcuts.ts`,
    `lib/speech` (top level, `pocket`, `client-parakeet`) and `ui/sound*`.
  - Also converted: the model download coordination, `useModelAssetActions`
    and `use-pocket-voice-downloads`.
- **P1-R1-05 resolved.** Settings groups have stable IDs mapped to labels.
  App Settings search matches the translated title, description, group and
  section, and still matches the English keywords.
- **P4-R1-03 resolved.** The model location, provider and connection text,
  credentials, Pocket option reasons and offline speech downloads that setup
  shows are now translated.
- Shortcut validation returns reason codes. Key names stay as the OS shows
  them; the mouse button is worded.
- `WordedError` (`lib/errors/apiError.ts`) marks a message already worded in
  the UI Locale, and `apiErrorText` shows it as it is. Its subclasses:
  - `PocketVoiceCloningError`;
  - `DownloadGuardError`, for refusals while a download or a feature pack
    change is running. Their reasons are stable codes, worded through
    `downloadGuardText` instead of English sentinel strings.
- `OPERATOR_MANAGED_MODELS_NOTE` became `operatorManagedModelsNote()`.
- Term list additions: Provider, Speech-to-Text, Text-to-Speech, Voice Mode,
  Press to talk, Quick Chat and Voice clone. Provider is aligned in every
  catalog (제공자, 提供商, 供應商), and Japanese uses 音声クローン.
- Intentional English changes:
  - sizes use the shared formatter ("630.7 MB", "37.9 MB");
  - "Re-embedding 1 item";
  - three or more names use the locale list style ("A, B, and C");
  - numbers use the active locale;
  - the in-use voice clone message matches the Animas wording.
- Left as data: backend probe notes (no code), shortcut key names, provider and
  model names, region labels, pack versions and error codes.
- Checks:
  - `pnpm i18n:check`, `pnpm --filter animama-web check` and `pnpm web:lint`
    pass; Prettier is clean on the changed web files.
  - Web vitest: 3796 pass, with only the 4 port-5173 failures.
  - Browser under `ja`: every App Settings section is in Japanese; search finds
    "マイク", "記憶" and the English keyword "theme".

#### Code Review #1 Findings

Reviewer: `sdlc-reviewer`, full review of the Phase 6 working tree on
`d9b0a5d2`. It found the following sound:

- the error wording, including `WordedError`;
- the group-ID refactor, with order, merging, search reveal and highlight kept;
- the shortcut and TTS reason refactors;
- stored data handling;
- the deferred P1-R1-05, P4-R1-03 and Phase 5 hand-offs.

Findings:

- **P6-R1-01 (required).** Four Chinese settings strings named Voice clone
  声音克隆/聲音複製 instead of the term list's 语音克隆/語音複製.
- Optional:
  - **P6-R1-02:** `MAX_CONNECTION_KEYS` duplicated the shared
    `maxConnectionCredentials`.
  - **P6-R1-03:** the ElevenLabs option lists kept English descriptions and
    labels that the UI no longer shows.
  - **P6-R1-04:** worded-error types overlapped. The sound preview had a
    private error class, and `DownloadGuardError.reason` was never read.
  - **P6-R1-05:** two English `Error` texts remained in `useModelAssetActions`.
  - **P6-R1-06:** Provider still had other renderings in product-ui
    (ko, zh-Hans) and in web `ko/components.json`.
  - **P6-R1-07:** no unit test covered the shortcut reason codes.
  - Minor: the provider options are rebuilt on every render.

#### Code Review #1 Revisions

- **P6-R1-01 accepted.** The four strings use the term.
- **P6-R1-02 accepted.** The message uses `maxConnectionCredentials`.
- **P6-R1-03 accepted.** The unused descriptions and chunking labels are
  removed. The model `label` stays as the vendor's model name.
- **P6-R1-04 accepted.**
  - The sound preview throws `WordedError` and words other failures through
    `apiErrorText(readApiError(error), null, fallback)`.
  - `modelChangeErrorText` words a guard by `downloadGuardText(error.reason)`,
    so it follows the UI Locale.
  - `PocketVoiceCloningError` stays as the named cloning subclass.
- **P6-R1-05 accepted.** Both are `WordedError`s from
  `voice:downloads.errors`.
- **P6-R1-06 accepted.** All three now use 제공자/服务提供商.
- **P6-R1-07 accepted.** `desktop-shortcuts.test.ts` covers each reason code
  and the in-use action.
- Minor not changed: rebuilding the options is harmless, as the reviewer noted.
- Checks after repair:
  - `tsc` and eslint pass;
  - vitest in settings, sidebar, sound, errors, animas, hooks and setup:
    42 files, 317 pass;
  - `pnpm i18n:check` passes;
  - product-ui tests: 37 pass.

Repair budget: one of two repair rounds used.

#### Code Review #2 Findings

Targeted recheck. P6-R1-01 to P6-R1-07 are resolved without regressions.
Result: pass.

Optional suggestions, both applied:
- The Korean retry hint now reads 제공자가.
- The guard test now creates the error before switching to `ja`, so it proves
  the wording follows the locale. The test passes, and the product-ui tests
  still pass (37).

### Phase 7 — Creators (R7)

Issue: #424. Areas: `ui/pose-creator`, `ui/action-editor`,
`ui/avatar-effect-creator`, `ui/particle-vfx-creator`, `ui/scene-effect-creator`,
`ui/content-creator`, `ui/creator`, user-facing labels in `lib/avatar`
(`anatomy.ts` joint names, `particle-vfx/catalog.ts`, `editor/*`),
`lib/effects/effectTemplates`. Persisted labels stay in English data; their
display is mapped.

Results (2026-10-10, four parallel agents, integrated by the coordinator;
Phase 6 committed as `9ffa159e`):

- New namespaces `pose`, `actionEditor`, `effects`, `creator` (the shared
  creator chrome) and `particles`.
- Converted and linted:
  - creator UI: `ui/pose-creator`, `ui/pose-editor`, `ui/action-editor`,
    `ui/gesture-editor`, `ui/reaction-editor`, `ui/creator-history`,
    `ui/creator`, `ui/content-preview`, `ui/content-creator`,
    `ui/avatar-effect-creator`, `ui/scene-effect-creator`,
    `ui/particle-vfx-creator` and `ui/avatar-preview`;
  - libraries: `lib/content-preview`, `lib/effects`, `lib/avatar/poses`,
    `lib/avatar/particle-vfx`, `lib/avatar/vfx/editor` and
    `lib/scene-vfx/editor`.
- Stored labels and defaults stay English data. Beat labels are mapped to
  translated labels for display. Emitter names show as stored, because Auto Fit
  refers to emitters by name. "New Clip" and other stored names are not
  displayed through a mapping.
- Phase 5 deferrals resolved:
  - `NON_PORTABLE_REASON` is removed.
  - The `{{role}}` sentences use translated role names.
  - `lib/content-preview` messages are converted.
  - The unused English template labels in `lib/effects` are removed.
- New default names for unnamed Poses and for Avatar, Scene and Particle
  Effects use the UI Locale. These are new owner content, not stored data being
  translated.
- Creator errors the frontend words are `WordedError`s, which now accept a
  `cause`. Other failures follow `apiErrorText(readApiError(e), null, fallback)`.
- Load order found by the browser check: the Pose creator store words
  validation while its module loads. With the router imported statically, that
  ran before i18n existed and blanked the whole app.
  - Both entry files now import the application only after `createWebI18n`
    resolves.
  - The browser fixtures load through `tests/fixtures/with-i18n.ts`.
  - Two fixtures that never set up i18n now do.
  - `i18n.md` documents the rule.
- Term list additions: Clip, Keyframe, Timeline, Expression, Bone, Sound
  Effect, Emitter, Focus Lines and Marquee.
- Intentional English changes:
  - reaction intensity "Medium" reads "Moderate", matching Animas;
  - singular counts for one item;
  - locale number and list formatting;
  - readable dropdown labels instead of raw IDs ("Left hand", "Additive");
  - notices name behaviors by their control names ("Orbit over life");
  - catalog emoji labels lose the trailing emoji ("✨ Sparkles").
- Checks:
  - `pnpm i18n:check`, `pnpm --filter animama-web check`, `pnpm web:lint` and
    `vite build` pass.
  - Web vitest: 3805 pass. 4 fail in `tests/local-api-proxy.test.ts`, the port
    5173 conflict.
  - Browser under `ja`: the particle, avatar and scene effect creators, the
    Effect picker, and the Gesture (Pose) and Reaction editors render Japanese
    chrome. Included content names stay as authored, and there are no console
    errors.

#### Code Review #1 Findings

Reviewer: `sdlc-reviewer`, full review of the Phase 7 working tree on
`9ffa159e`. It found the following sound:

- the hosted fetch-authority ordering and the entry-point load order;
- the CLIs and harnesses, which never call translating functions;
- stored data, including marquee items, which keep English labels and are
  worded by emoji.

Findings:

- **P7-R1-01 (required, R3).** A locale switch re-ran effects through callbacks
  that depend on `t`:
  - the Avatar and Scene `onRestore`, through the `useCreatorSave` recovery
    effect: undo history was cleared, recent edits were lost and image bytes
    could be dropped;
  - `ContentPreviewHost.handleStatusChange`: playback stuck at "Preparing".
- Optional:
  - **P7-R1-02:** Pose clip validation issues stored in the zustand store did
    not follow a switch.
  - **P7-R1-03:** five copies of the failure-line helper and a copy of
    `useFormatters`. Some sentences are duplicated across namespaces, with
    diverging translations (ja ブラウザ/ブラウザー, zh 放弃/丢弃, zh root
    根/根节点).
  - **P7-R1-04:** a misplaced JSDoc in `managementPreview.ts`.
  - **P7-R1-05:** English left without comment: the emitter "Copy" suffix and
    the Avatar Effect definition errors.
  - **P7-R1-06:** the Results text was inaccurate.
  - **P7-R1-07:** no test guards the entry-point import order.

#### Code Review #1 Revisions

- **P7-R1-01 accepted.** A delegated audit checked every hook whose
  dependencies include `t`, formatters or a callback built from them.
  - Fixed:
    - `useCreatorSave` reads `onRestore` through `useEffectEvent`.
    - The Avatar and Scene `onRestore` and saved-item load effects word text
      with `getFixedT` and no longer depend on `t`.
    - `ContentPreviewHost.handleStatusChange` has empty deps.
    - The Action editor recovery toast, the Memory identities-error toast,
      `useCreateAnimaController` `persist` and `MicrophoneLevelMeter` read their
      text from a ref or `getFixedT`.
  - Kept, as harmless: event-handler callbacks, display memos, effects that
    only re-bind listeners, and guarded effects.
  - New tests, each failing without its fix, in `useCreatorSave.hook`,
    `AvatarEffectCreatorPage`, `SceneEffectCreatorPage`, `ContentPreviewHost`
    and `pose-creator-store`.
- **P7-R1-02 accepted.** The Pose creator store re-validates its clip draft on
  `languageChanged`, without marking it dirty or touching history.
- **P7-R1-03 accepted in part.**
  - `failureLine` in `apiError.ts` replaces the five copies, and the preview
    and effect helper files are removed.
  - product-ui exports `formattersForLanguage`, which `useFormatters` uses.
  - `ContentSaveApiError` extends `WordedError`, so it is never worded twice.
  - Translations aligned: ja ブラウザー, zh-Hans 丢弃 for "discard", zh root
    根节点/根節點.
  - Deferred to Phase 9: removing the duplicated sentences across namespaces
    (`effects`/`creator` recovered draft, `pose`/`creator` Avatar Model errors)
    and moving the shared preview and history keys out of `actionEditor`.
    Namespaces load per use, so this only affects organization.
- **P7-R1-04 accepted.** The JSDoc is moved.
- **P7-R1-05 accepted.** Comments explain the English emitter suffix (a stored
  identifier) and the definition errors (`pnpm effects save` runs without
  i18n). The unreachable store `loadError` is left as it is.
- **P7-R1-06 accepted.** The Results text above is corrected.
- **P7-R1-07 accepted.** `entrypoints.test.ts` allows only i18n, React, fonts
  and CSS as static imports, and requires the dynamic router import.
- Checks after repair:
  - the fix agent's runs: `tsc` and eslint pass; vitest in the 14 affected
    directories: 135 files, 988 pass; no extraction drift;
  - coordinator: `tsc` passes after the helper changes; `entrypoints.test.ts`
    passes (2 tests); `pnpm packages:build` passes.
  - Not yet rerun: the full `pnpm i18n:check`, web check, lint and full vitest
    on the combined tree; browser re-check of a locale switch inside a creator.

Repair budget: one of two repair rounds used.

Checks on the combined tree after resuming (2026-10-10):
- `pnpm i18n:check`, `pnpm --filter animama-web check` and `pnpm web:lint` pass;
  Prettier is clean.
- Web vitest: 461 files, 3815 pass and none fail; the port conflict is gone.
- Product-ui tests: 37 pass.
- Browser: on `/scene-effects/new` with a typed name, switching the UI Locale
  from `ja` to `ko` in App Settings kept the name, showed no recovered-draft
  notice and re-rendered the creator in Korean.

#### Code Review #2 Findings

Targeted recheck. P7-R1-01 to P7-R1-07 are resolved without regressions.
Verified: React 19.2's stable `useEffectEvent`; the recovery effect still
re-runs for its real inputs; the "harmless" sites are safe;
`ContentSaveApiError` consumers are consistent. Result: pass.

Optional suggestions, all applied:
- **P7-R2-01:** `useFormatters` had lost its JSDoc to `formattersForLanguage`.
  The doc is restored.
- Duplicate `apiError` imports in three files are merged.
- Seven remaining inline copies of the failure line (Action editor, Idle Style
  editor, leave guard, template start, creator Avatar, voice clone) use
  `failureLine`.
- Checks after these edits:
  - `tsc` and `pnpm web:lint` pass;
  - vitest in the touched directories: 72 files, 504 pass;
  - `pnpm i18n:check` and `pnpm packages:build` pass.

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

Results (2026-10-10, one agent; Phase 7 committed as `6739ca09`):

- **Desktop catalogs:** `desktop/src/locales/<tag>.json` cover the startup and
  recovery page, the application menu, and the PiP and Quick Chat titles.
  English text is unchanged. A small typed lookup does `{{name}}`
  interpolation and falls back to English; main has no i18next.
- **Shell locale:** `main-process/locale/shell-locale.ts` uses the shared
  `resolveLocale` and picks, in order:
  1. the cached locale: `ui-locale.json` `{version: 1, locale}` in userData,
     written atomically and read without following links, capped at 1 KB;
     invalid content is ignored and replaced;
  2. `app.getPreferredSystemLanguages()`;
  3. English.
- **Bridge:** `window.animamaDesktop.locale.setApplied` calls
  `animama:locale:set`.
  - It goes through the existing `handle()` caller check, so only the main role
    can call it. A non-canonical tag returns `locale_invalid`.
  - The bridge stays at version 2: the change is additive and
    feature-detected.
  - `LocaleSync` reports from the desktop main window only and never sends the
    pseudo-locale.
- **Recovery page:**
  - It takes the string table and sets `<html lang dir>`.
  - It escapes HTML and inline-script text.
  - The hidden recovery window reloads after a locale change.
- **Application menu:** `ui/application-menu.ts` spells out Electron 39's
  default menu with catalog labels; roles and accelerators are unchanged. It is
  installed at ready and rebuilt on change. Unpackaged runs lose Electron's
  documentation Help links; packaged builds already had an empty Help menu.
- **macOS microphone prompt:** `desktop/build/locales/{ja,ko,zh_CN,zh_TW}.lproj/InfoPlist.strings`
  ship through mac `extraResources`. Electron already ships these lproj
  folders, so no `CFBundleLocalizations` change is needed. An unsigned `--dir`
  build placed the files at `Contents/Resources/<lproj>/InfoPlist.strings`.
- **Other changes:**
  - `localeDirection` moved into `@animama/runtime-contracts/locale`;
    product-ui re-exports it.
  - Desktop now depends on `@animama/runtime-contracts`.
  - The catalog check covers the desktop catalogs: stale keys and placeholder
    changes are errors, and missing keys are reported.
- **Docs:** a "Desktop shell" section in `i18n.md`, plus one line each in the
  desktop overview and the frontend `AGENTS.md`.
- **Checks:**
  - `pnpm desktop:check` passes.
  - Desktop tests: 508 pass, 14 skipped.
  - `pnpm i18n:check`, web `tsc` and web `vitest src/i18n` pass; eslint is
    clean.
  - Package tests (runtime-contracts, product-ui i18n) pass.
  - New tests: `shell-locale.test.ts`, `macos-localizations.test.mjs`
    (including `plutil -lint`), `runtime-ipc` locale cases, and web
    `LocaleSync` and `locale-preference` tests.
- **Left for G2:**
  - the real menu bar under each locale;
  - the microphone prompt, which follows the macOS language (or the app's
    language in System Settings), not the in-app choice;
  - the recovery page with the backend stopped after a switch;
  - first launch following the OS language.

#### Code Review #1 Findings

Reviewer: `sdlc-reviewer`, full review of the Phase 8 change set on
`6739ca09`. Phase 9 files were excluded. It found these sound:
- IPC: the main role only, top frame and exact origin, with the tag checked by
  `isUiLocale`;
- the cache file: no symlink following, a size cap, atomic `0600` writes in
  userData;
- resolution order, and the web bridge, which never sends the pseudo-locale and
  cannot loop;
- menu fidelity against Electron 39.8.9's default menu, including platform
  differences;
- recovery page escaping and the reload path;
- the lproj files, which `plutil -lint` accepts.

Findings:
- **P8-R1-01 (required).** The desktop `check`, `build` and `test` scripts now
  import `@animama/runtime-contracts/locale` but never build it, so they fail on
  a clean checkout and can bundle a stale contract.
- Optional:
  - The microphone prompt follows the macOS language. That partly meets R8 and
    should be recorded as a deviation.
  - Desktop docs missed the `locale` bridge group and `ui-locale.json`.
  - The recovery page replaced only the literal `{{path}}`.
  - A startup-race corner case that cannot happen, because only the main window
    reports.

#### Code Review #1 Revisions

- **P8-R1-01 accepted.**
  - Desktop gets `contracts:build`. `check` and `test` run it first; `build`,
    `dev` and the package scripts reach it through `check`.
  - The root `desktop:test` builds the contract first too.
  - Verified from a clean state: with `packages/runtime-contracts/dist` deleted,
    `pnpm desktop:check` rebuilt it and passed.
- **Microphone prompt accepted as a proposed deviation for the owner to
  confirm at G2.** See the Decision Log entry, which names the per-app language
  alternative and why it was not chosen. G2 also covers the system-added Edit
  menu items.
- **Docs accepted.** `desktop/overview.md` lists the `locale` methods and
  `ui-locale.json`; `backend/operations/desktop-runtime.md` lists the cache.
- **Placeholder accepted.** Main normalizes `{{ path }}` to `{{path}}` before
  the page uses it.
- **Startup race not changed.** Only the main window reports a locale, after
  startup.
- Checks after repair:
  - `pnpm desktop:check` passes from a clean contract build.
  - `pnpm desktop:test`: 508 pass, 14 skipped.
  - `pnpm i18n:check` passes; desktop `prettier:check` is clean.

Repair budget: one of two repair rounds used.

#### Code Review #2 Findings

Targeted recheck. P8-R1-01 is resolved: every desktop entry point that
compiles or bundles code now builds the contract first, or reaches a script that
does, without recursion. The placeholder normalization and the docs are
correct.

- **P8-R2-01 (required).** The Decision Log entry contradicted itself. It
  claimed no in-app control could change the prompt, although the app could
  write its per-app `AppleLanguages`. It also had no actor or status.
- Optional:
  - the contract is rebuilt about 3 s more than needed after
    `packages:build`;
  - no test covers the spaced placeholder.

#### Code Review #2 Revisions

- **P8-R2-01 accepted.** The entry is now marked as proposed by the agent, a
  deviation from R8 that the owner confirms at G2. It names the per-app `AppleLanguages` alternative and
  why it was not chosen: Chromium's locale and the System default setting
  depend on the OS languages, the preference belongs to the owner, and it would
  lag one launch.
- Optional, not changed:
  - The extra rebuild is about 3 s.
  - No catalog uses a spaced placeholder today; the normalization is a guard.

Repair budget: two of two repair rounds used.

#### Code Review #3 Findings

Final targeted review. P8-R2-01 is resolved, and the entry agrees with G2, the
spec and the "Desktop shell" docs. The macOS-added menu items follow the macOS
language, as `i18n.md` says and G2 checks. Result: pass.

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

Results (2026-10-10; Phase 8 committed as `a65ec81c`):

- **Guards at full strength.**
  - `web/i18n-scope.json` keeps only `exempt` (debug tools, the two
    debug-route Create previews and the motion-authoring CLI) and the lint
    settings. The transitional `converted` list is gone.
  - The raw-string lint and the toast ESLint rule now cover all of `web/src`
    except tests and the exemptions. Both pass.
- **Plain-code audit** (one agent, about 400 English literals checked):
  - Converted:
    - Action editor save errors;
    - 13 modules that threw already-worded text now throw `WordedError`;
    - display paths that put plain English first (content save, sharing,
      uploads, Idle Style preview) now use `failureLine`;
    - ElevenLabs runtime failures show English as detail;
    - Uppy restriction messages;
    - creator Avatar loading status and version labels;
    - default names for new Reactions, customized Starters and Anima images;
    - the 18 built-in VRM expression presets (ja and ko show their vowels for
      visemes);
    - the runtime Avatar placeholder name.
  - Left, with reasons recorded by the agent: logger, telemetry, worker and
    protocol invariants that render only as detail; validator text shared with
    CLIs; stored data; product, OS and key names; the diagnostics summary, kept
    English for support.
  - Cleanups: the remaining local size formatters use `useFormatters`; inline
    English plurals remain only in the exempt debug panel; unused English
    helpers are removed.
  - Term list adds Starter.
- **Pseudo-locale smoke.**
  - A Playwright `pseudo` suite runs through `pnpm e2e:test:pseudo` and
    requires a development stack.
  - It covers setup (Welcome, AI, Voice), chat, all nine App Settings sections,
    Library, `/gestures/new` and `/particle-effects/new`.
  - It fails on visible text without pseudo markers, excluding API data, VRM
    expression names, file names, identifiers and a short documented
    allowlist.
  - The first run found 15 English strings (VRM expression labels and the
    runtime Avatar name). After the fixes it passes: 3 of 3 tests.
- **Full journeys.** The first `pnpm e2e:test` on a built stack found the
  stylesheet-order regression above (19 failures). After the fix, the rerun on
  a rebuilt built stack (`animama-i18n-e2e`, port 8600) passed 38 of 38 in
  13.2 minutes.
- **Docs.** `i18n.md` Checks covers whole-app linting and the pseudo smoke;
  `browser-journeys.md` has a "Pseudo-locale smoke" section.

#### Code Review #1 Findings

Reviewer: `sdlc-reviewer`, full review of the Phase 9 working tree on
`a65ec81c`, plus the stylesheet-order fix. It found these sound:
- whole-app guard coverage and justified exemptions;
- the default `pnpm e2e:test` behavior and the development-build guard;
- the stylesheet fix, which restores the order from before Phase 7;
- the Uppy keys;
- locale-independent Starter identifiers;
- the Starter term.

Findings:
- **P9-R1-01 (required).** `ParticleVFXContentPackageError`
  (`lib/content/particleVFXContentPackage.ts`) carries catalog-worded messages
  but extends `Error`. `toContentSaveApiError` now sends it through
  `failureLine`, so in `ja` an oversized-texture Save shows the generic "check
  the backend logs" message with the reason as detail. Fix: extend
  `WordedError`.
- **P9-R1-02 (required).** `entrypoints.test.ts` compares `indexOf` results,
  and a missing product-ui stylesheet import gives −1, which still passes.
  Fix: assert the import is present (index ≥ 0) or compare the exact CSS
  import order.
- Optional:
  - redundant `WordedError` branches in `contentSaveErrors.ts` and
    `content-sharing/errors.ts`;
  - `useActionEditorActions` reuses `loader.starterUnavailable`, which reads
    wrong for VRMA Gestures and Reactions; use a neutral key;
  - `getUserFileErrorMessage`'s English default is used only by debug callers;
  - dead `sourceLabel` values (pre-existing);
  - documented pseudo-smoke limits;
  - a stray untracked `.animama-stack.e2e.env`, which must not be committed.

#### Code Review #1 Revisions

Resumed 2026-10-13.

- **P9-R1-01 accepted.** `ParticleVFXContentPackageError` extends
  `WordedError`, so its catalog-worded reasons show as they are in every locale.
- **P9-R1-02 accepted.** `entrypoints.test.ts` compares the exact list of
  static CSS imports (`@animama/product-ui/styles.css`, then `./index.css`), so
  a missing import fails.
- Optional accepted:
  - `toContentSaveApiError` and `sharingErrorMessage` drop the redundant
    `WordedError` branches; `failureLine` handles them.
  - The Action editor's missing-source error uses the neutral
    `errors:creation.source_unavailable` ("The selected content is
    unavailable."), so the English is unchanged and it fits VRMA Gestures and
    Reactions.
- Optional not changed:
  - `getUserFileErrorMessage`'s default is used only by exempt debug callers.
  - The dead `sourceLabel` values predate this plan.
  - The pseudo-smoke limits are documented.
  - The stray `.animama-stack.e2e.env` is removed.
- Checks:
  - web `tsc` and `eslint src` pass;
  - vitest in app, content, sharing, query, particle creator, action editor
    and errors: 118 files, 844 pass;
  - `pnpm i18n:check` passes.

Repair budget: one of two repair rounds used.

#### Code Review #2 Findings

Targeted recheck. P9-R1-01 and P9-R1-02 are resolved. The particle Save path
was traced end to end, and the CSS-order assertion fails when the import is
removed or swapped. The optional revisions do not change behavior. Result: pass.

Optional, not changed:
- The English particle texture-fetch text matches the network-failure pattern,
  so English shows the network message. This already happens on `main`.
- No `ja` test covers a particle package error through `toContentSaveApiError`.

### Integration with `main` (2026-10-13)

The owner asked to bring the branch up to date before the final review. `main`
had moved 259 commits past the branch point, across about 1,680 files. The
changes include the Anthropic provider, Gemini TTS, ElevenLabs v4, particle and
scene effects content, gesture starters, shared product routes (ADR 0021) and
the age confirmation flow.
- **The merge.** The app's sync tool refused because `.claude/settings.json` is
  protected, so the owner ran `git merge origin/main` (`7a25aa34`) in the
  worktree. The branch never changed that file.
- **Conflicts.** 48 files conflicted.
  - The coordinator resolved contracts, versions, docs, backend, product-ui and
    the Playwright config.
  - Two agents resolved the web content and settings/voice areas.
  - Rule: keep all of main's behavior and re-apply the branch's catalogs, error
    semantics and locale-switch fixes. Main's new and changed English gets keys
    in all five locales.
- **Versions:**
  - `local-http` becomes 7.0.0 and `runtime-contracts` 0.7.0, on top of main's
    6.0.0 and 0.6.0;
  - `product-ui` becomes 0.11.0, on top of 0.10.0.
  - The hosted handoff and the HTTP docs name the new versions.
- **ADR.** Main took ADR 0021–0023, so this plan's ADR is now 0024. GLOSSARY,
  `i18n.md` and the ADR index are updated.
- **Backend.**
  - The merged baseline keeps both schema changes (nullable `locale`;
    Anthropic and `early_compaction`), and the fingerprint is updated.
  - The locale tests use main's shared settings route and helpers.
  - Main's settings tests use supported tags (unset by default; `"fr-FR"` is
    rejected).
  - The full backend suite passes: 4194 passed, 29 skipped.
- **Generated client.** Regenerated through `pnpm openapi-ts`; it matched the
  merged text exactly.
- **New main UI text.** It was converted where the agents met it: new provider
  and voice settings, age confirmation, chat model popover, scene layers and
  stickers, particle texture files, sharing and save codes. Main's new files
  that the whole-app lint flagged are converted too.
- **Post-merge fixes.**
  - Main's removed-effects toast in the Action editor is worded.
  - Main's Gemini voice descriptors are worded; search still matches Google's
    English words. Sample failures without a backend message use the player's
    worded failure.
  - Main's PiP test fake gains `setTitle`, and the test passes a `ShellLocale`.
  - A mypy annotation in the names test is fixed.
- **Checks on the merged tree:**
  - `make check` passes;
  - `pnpm check` passes, including the whole-app `i18n:check`;
  - `pnpm web:lint` passes; web and desktop Prettier are clean;
  - web vitest: 497 files, 4411 pass;
  - desktop tests: 533 pass, 14 skipped;
  - product-ui: 40 pass; e2e helper tests: 25 pass;
  - backend `pytest`: 4194 passed, 29 skipped.
- **Follow-up candidates:** `early_compaction_unavailable` has no wording yet
  (main's test expects the backend message).

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
