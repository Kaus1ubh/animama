# App Settings redesign

Source agreement: [spec](settings-menu-redesign-spec.md), agreed by the owner on
2026-09-25 (discovery answers plus confirmation of the proposed items).
Authorized scope: phases 1–7. The owner invoked implement on 2026-09-25.
Starting revision: `d987d24` (`main`), with phase-1 work uncommitted in the task
worktree.
Parent issue: [#114](https://github.com/raymond-van/animama/issues/114) (authoritative spec).
Phase issues: #115 (p1), #116 (p2), #117 (p3), #118 (p4), #119 (p5), #120 (p6), #121 (p7).
Branch: `feat/settings-menu-redesign` in the task worktree.
Test stack: `animama-settings` (`./reset.sh --name settings --base-port 8300`),
application at `http://animama-settings.localhost:8300`.

## Purpose and context

The goal is to make App Settings the complete place for installation-wide
preferences, as required by the spec (R1–R9). The owner can find any setting
through search. They can choose a theme, microphone and sensitivity, startup Anima
and a default model for new Animas, and app-wide memory/emotion defaults that
Animas inherit. They can also reset app settings and copy a safe diagnostics
summary.

Orientation (paths from the repository root):

- **Modal:** `src/frontend/web/src/ui/sidebar/ApplicationSettingsModal.tsx`
  builds a list of searchable `SettingEntry` records (section, group, label,
  keywords, `hidden`, `render`).
  - Layout primitives: `ui/settings/SettingsLayout.tsx`.
  - Search: `ui/settings/SettingsSearch.tsx` and `ui/settings/settings-search.ts`.
  - Frame: `ui/components/sectioned-modal-frame.tsx`, which has sidebar-header,
    section-icon and Esc hooks.
- **App preferences:** stored as free JSON in `user_settings.preferences`.
  - The web app merges locally (`lib/settings/preferences.ts` `mergePreferences`)
    and PATCHes the whole object (`ui/settings/SettingsProvider.tsx`).
  - The server replaces the whole column (`app/services/settings_service.py`).
  - New keys therefore need defaults, merge support and tolerant parsing.
- **Anima settings:** stored in `anima_settings.preferences`.
  - `default_anima_preferences()` in `settings_service.py` returns explicit
    `False` memory/emotion flags.
  - `SettingsProvider.updateAnimaPreferences` falls back to
    `DEFAULT_ANIMAMA_PREFERENCES` as its base.
  - Chat resolution already chooses request, then Anima, then user, using the
    first boolean it finds (`src/backend/animama/server/chat_options.py`).
    Inheritance therefore means *omitting* Anima keys, not new server logic.
- **Theme:** `lib/feature-flags.ts` sets `themeSelection=false`, which
  `ui/theme/theme-provider.tsx` uses to force light.
  - The provider (`app/providers/AppProviders.tsx`) uses next-themes with
    `light|dark|custom` and no system option.
  - Sync with the server lives in `SettingsProvider.tsx`; the custom editor in
    `ui/theme/custom-theme-modal.tsx`; dark tokens in
    `packages/product-ui/src/theme.css`, which has two `.dark` blocks.
- **Microphone:**
  - `hooks/use-dictation.ts` calls `getUserMedia` for the visualiser without a
    `deviceId`, and holds VAD thresholds at lines ~134–144.
  - `hooks/voice/mic-vad-runtime.ts` calls `MicVAD.new`, which opens its own
    stream. vad-web 0.0.30 accepts `getStream`.
  - `ui/components/live-waveform.tsx` supports `deviceId`.
  - Electron allows audio-only media (`desktop/src/main-process/security/guards.ts`).
- **Default Anima:** `routes/a/index.tsx` uses `resolveSelectedAnimaId`
  (`lib/animas/anima-management-search.ts`) with
  `user_settings.last_active_anima_id`.
- **Default model:**
  - `AnimaCreationService` resolves `settings.anima_default_model_provider_id`
    (`src/backend/animama/app/services/anima_creation_service.py:38`).
  - The installation bootstrap uses the same value.
  - The catalog comes from `GET /v1/model-providers`.
- **About:**
  - `platform/env.ts` `appVersion` is unset.
  - The desktop bridge exposes `runtime.openLogs()` and `runtime.status()`, plus
    `featurePacks` and status-only `credentials.list()`.
  - `DesktopUpdatesPanel` moves into About.

Boundaries:

- Keep the frontend's high-risk files (`use-dictation.ts`, voice and speech libs,
  `desktop/src/**`) to minimal diffs.
- Do not hand-edit the generated SDK; run `pnpm openapi-ts` only if a backend
  contract changes. The planned backend changes keep request and response shapes
  unchanged.
- No Alembic revisions. The development database may be reset (owner,
  2026-09-25).
- Deferred desktop shell behaviour must not be started here.

## Progress

- [x] Phase 1 (#115): R1–R2 plus section scaffolding. Reviewed (#1, #2 pass);
      committed as `feat(settings)[p1]`.
- [x] Phase 2 (#116): R3 Appearance. Visual QA gate evidence recorded; reviews #1–#3 (pass).
- [ ] Phase 3: R4 Microphone. Owner hardware gate.
- [ ] Phase 4: R5 General defaults.
- [ ] Phase 5: R6–R8 inheritance, Markdown persistence, reset.
- [ ] Phase 6: R9 About & diagnostics.
- [ ] Phase 7: documentation, glossary, final integration review, PR handoff.

## Surprises & Discoveries

- **No duplicate dark tokens.** The second `.dark` block in
  `packages/product-ui/src/theme.css` sits inside a commented-out legacy
  "CLAUDE THEME" block. There is no live duplicate, so phase-2 step 6 needs no
  token consolidation.

- **Popover dismissal.** A portalled Radix Popover inside the modal Radix Dialog
  dismissed the dialog or popover as soon as the first character was typed. The
  search dropdown is therefore rendered in place (absolute, no portal) within the
  dialog's focus scope. The sidebar header sits outside the scrolling nav so the
  dropdown is not clipped.
- **Esc handling.** Radix's Dialog Esc listener runs in the document capture
  phase, so input-level `stopPropagation` cannot stop it. Esc-clears-query uses
  the Dialog `onEscapeKeyDown` hook instead.
- **Pre-existing format failures.** `pnpm prettier:check` fails on `main` for
  unrelated files (for example `ui/create-anima/*`, `eslint.config.js`).
  Formatting is verified per changed file rather than repo-wide.
- **Sidebar overlay.** The expanded app sidebar draws above the settings modal
  overlay. This was observed in phase-1 browser checks and was not investigated;
  it is not in scope unless it is caused by this work.

## Decision Log

- **2026-09-25, owner.** Spec agreed. Themes: Light/Dark/System/Custom. Desktop
  behaviour deferred. App defaults with Anima "Use app default" inheritance. Data
  limited to reset. Microphone device is per machine, with Low/Normal/High
  sensitivity and a meter. Default model applies to new Animas only. Default
  Anima is last opened or pinned. About covers version/platform, open logs and a
  diagnostics summary. Markdown setting persisted. Visual QA on core surfaces.
  One plan, one PR, phased. Section order and the "Memory & Emotion" rename
  confirmed. Updates move into About. Glossary entries added.
- **2026-09-25, owner.** Phase 2 revised: replace the Custom theme with
  light/dark mode overrides following the reference screenshot (Mode tiles plus
  Accent/Background/Foreground). Agent interpretation: overrides are stored
  separately per mode and edit the mode in effect; theme presets and
  import/export controls in the reference are not included.
- **2026-09-25, agent (planning).** The microphone device ID is stored in browser
  local storage under an app-owned key, not in server preferences, as the spec
  requires. It is read by one small module used by both dictation and VAD.
- **2026-09-25, agent (planning).** The default chat model is resolved by the
  server when an Anima is created. It reads the owner's
  `preferences.chat.default_model_provider_id` and falls back to the configured
  default when that value is missing or unavailable. This keeps the creation API
  unchanged and covers every creation path.
- **2026-09-25, agent (planning).** Inheritance is implemented by no longer
  writing memory/emotion keys into new Anima preferences, and by letting the
  Anima UI remove a key for "Use app default". The existing resolution order
  already honours absence.

## Phased implementation

Commit subjects use `<type>(settings)[p#]: <summary>`. Each phase ends with its
checks, one independent review (`sdlc-reviewer`) and at most two repair rounds,
recorded below.

### Phase 1: Searchable, flat modal with final section structure

Requirements: R1, R2, and structure for R3/R6/R9. Issue #115.
Starting source: `d987d24` plus the uncommitted work.

Steps (`src/frontend/web`):

1. Keep the built search, icons, Shortcuts section and flat styling.
2. Placeholder: "Search" (the accessible name stays "Search settings"). Copy: "Speech-to-Text" and
   "Text-to-Speech" in group titles, labels and keywords.
3. Add faint dividers between groups within a section. For example, give
   `SettingsGroup` a top border on every group after the first, using
   `border-border/40`.
4. Set the final section list and icons: General, Appearance, Voice, Shortcuts,
   Memory & Emotion, Data, Advanced, About. Empty future sections stay out of the
   list until their phase adds entries, so no blank pages ship.
5. Move `DesktopUpdatesPanel` into About.
6. Extend `settings-search.test.ts` as copy changes.

Checks:

- `pnpm check`, `pnpm web:lint`, `pnpm web:test` (from `src/frontend`).
- Prettier `--check` on changed files.
- Rendered desktop journey: search "speech", keyboard select, Esc behaviour,
  dividers visible.

Completion: checks pass, review recorded, commit `feat(settings)[p1]: ...`.

Results:

- **Delivered:**
  - Dropdown search across sections, with highlighting, keyboard selection,
    reveal-and-focus, and Esc to clear.
  - Section icons and a dedicated Shortcuts section.
  - Flat grouped rows with faint top-border dividers between groups.
  - "Search" placeholder (accessible name "Search settings").
  - Speech-to-Text/Text-to-Speech copy.
  - Final section order. Sections without available entries are hidden.
  - Desktop updates moved to About.
  - Shortcuts shown only when the desktop shortcut bridge exists.
- **Local checks (`src/frontend`):**
  - `pnpm check` pass;
  - `pnpm web:lint` pass;
  - `pnpm web:test` 296 files / 1,768 tests pass;
  - `prettier --check` on changed files pass;
  - after repairs: `tsc -b`, scoped eslint and settings tests (24) pass.
- **Browser (stack `animama-settings`, 1280×800):**
  - nav shows General / Voice / Memory & Emotion / Advanced in a browser;
  - "Search" placeholder;
  - Speech-to-Text/Text-to-Speech groups with a divider;
  - keyboard selection reveals and highlights "Stream chunked TTS";
  - Esc clears the query and keeps the dialog open.
- **Not performed:**
  - desktop shell rendering (About/updates, Shortcuts);
  - narrow-layout check.

#### Code Review #1 Findings

Independent `sdlc-reviewer`, uncommitted tree on `d987d24`:

- **P1-1 (blocking).** About could render blank, and "Desktop updates" was
  searchable while the updates panel renders nothing (status `unavailable`).
  Empty panels also added dividers.
- **P1-2 (blocking).** Shortcuts were shown and searchable in a plain browser,
  where they have no effect.
- **P1-3.** "TTS" abbreviations remained in labels.
- **P1-4.** `aria-controls` pointed to a missing listbox when there were no
  results. The accessible name also differed from the plan.
- **P1-5.** Results have no per-section `role="group"`.
- **P1-6.** No test for the hidden-entry filter.

#### Code Review #1 Revisions

- **P1-1: accepted.**
  - The updates entry is hidden while `useDesktopUpdates()` reports
    `unavailable`.
  - Entry wrappers use `empty:hidden`.
  - Known limitation: credentials and feature-pack entries remain searchable
    when they render nothing. This happens only in unpackaged or external-stack
    desktop.
- **P1-2: accepted.** Entries are hidden unless
  `platform.isDesktop && desktopBridge.shortcuts`. Verified in the browser.
- **P1-3: accepted.** Labels are spelled out.
- **P1-4: accepted.**
  - `aria-controls` is set only when options exist.
  - The no-results text has `role="status"`.
  - The plan now records the "Search settings" accessible name.
- **P1-5: deferred** (optional; labels are self-describing).
- **P1-6: rejected.** It is a one-line filter with low test value.

#### Code Review #2 Findings (repair round 1)

Pass, with no blocking findings.

- **P1-7 (optional).** A trailing hidden panel keeps a stray divider.
- **P1-8 (optional).** The live region is inserted already populated.

#### Code Review #2 Revisions

- **P1-7: accepted.** Dividers are now top borders on non-first children, so
  trailing hidden panels add nothing. Browser re-check done; eslint and `tsc -b`
  pass.
- **P1-8: deferred** (optional).
- One repair round remains for this phase.

### Phase 2: Appearance and theme re-enablement

Requirement: R3. Issue #116. Depends on phase 1.

Steps:

1. Remove `featureFlags.themeSelection` and its gates:
   - `theme-provider.tsx` (and update its test);
   - `SidebarUserMenu.tsx`, where the theme UI moves to Appearance and the
     user-menu copy is removed;
   - `SettingsProvider.tsx` sync;
   - `theme.tsx`.
2. **Modes.** Provider `themes` becomes light and dark, with `enableSystem`.
   - Persist `system|light|dark`.
   - A stored `custom`/`anima` value normalizes to light.
   - Check that the backend `user_settings.theme` accepts `system`.
3. **Retire the Custom theme.** Remove the `custom` class and the
   `CustomThemeModal`/`custom-theme.ts` usage. Delete the modules if they become
   unused.
4. **Overrides.**
   - Add `appearance.{light,dark}.{accent,background,foreground}` to app
     preferences (`#rrggbb` strings, validated on read).
   - A small applier injects a `<style>` rule overriding the matching CSS tokens
     for `:root` (light) and `.dark` (dark). It maps accent to `--primary`/`--ring`
     and background/foreground to `--background`/`--foreground`, with
     readable-contrast derivation limited to what the tokens need.
   - Unit-test parsing and CSS generation.
5. **Appearance UI.**
   - Mode preview tiles (System/Light/Dark), in a `radiogroup`.
   - A "Visual style" group with Accent, Background and Foreground colour rows,
     each with a swatch, hex text input and native colour picker, plus reset.
   - The controls edit the resolved current mode.
6. Consolidate the duplicate `.dark` blocks in `packages/product-ui/src/theme.css`
   (the later block wins today, so keep its values), then rebuild packages.
7. **Visual audit** in Dark and with sample overrides of: chat, sidebar, App
   Settings, Anima settings/info, Anima pages, Library, Memory, and the main
   panels of the creator tools. Fix illegible or hard-coded light colours found.

Checks:

- Theme-provider, preferences and override unit tests.
- `pnpm check`, `pnpm web:lint`, `pnpm web:test`, `pnpm build`.

**Gate:** browser screenshots of each listed surface in Dark and with overrides,
plus a System check using an emulated colour scheme, are recorded here. Remaining
rough edges are listed explicitly rather than claimed fixed.

Results:

- **Delivered:**
  - Appearance section: System/Light/Dark mode tiles (radio group) and a
    "Visual style" group with Accent/Background/Foreground overrides per mode.
    Each override has a hex input (invalid input shows an alert and is not
    saved), a debounced native picker that is flushed on unmount, and a reset.
  - Overrides are stored in `preferences.appearance.{light,dark}` and applied as
    a stylesheet scoped to `:root:not(.dark)` / `:root.dark`. Card, sidebar,
    muted and border colours are derived from background/foreground with
    `color-mix`.
  - Theme sync with `user_settings.theme` (`system|light|dark`; `custom`/`anima`
    read as light), guarded against the server's echo of this client's own
    saves.
  - Removed: `featureFlags`, the Custom theme, its modal, `tokens.ts`,
    `color-picker.tsx` and the `color` dependency, plus the user-menu theme UI.
  - `MemoryCodeEditor` now follows theme tokens (it was white in Dark).
  - Frontend overview docs updated.
- **Local checks (`src/frontend`):**
  - `pnpm check` pass;
  - `pnpm web:lint` pass;
  - `pnpm web:test` 296 files / 1,776 tests pass (before repairs);
  - `pnpm build` pass;
  - after repairs: `tsc -b`, scoped eslint, and theme/settings/preferences/sonner
    tests (41) pass;
  - `pnpm install --frozen-lockfile` consistent;
  - prettier on changed files pass.
- **Gate evidence** (browser, stack `animama-settings`, 1280×800 emulated):
  - **Dark screenshots:** chat/main, sidebar, App Settings, Anima page,
    Library, Memory, Create hub and Gesture creator. Only the Memory editor
    needed a fix.
  - **Override screenshots** (dark accent `#ff6600`, background `#000000`,
    foreground `#ededed`): chat and Library legible. The avatar renders; an
    apparent missing avatar was a screenshot-capture artefact of the emulated
    viewport, disproved by toggling the stylesheet live.
  - **System mode:** follows an emulated OS scheme change live and on reload.
    Dark overrides do not apply in light mode.
  - **Persistence:** mode and overrides persist after reload.
  - **Rapid switching:** Dark then Light within 20 ms stays Light, with
    "light" stored.
- **Not performed:** desktop shell rendering; an exhaustive route sweep beyond
  the core surfaces.
- **Remaining legibility caveat:** `--accent`, `--secondary` and
  `--sidebar-accent` keep built-in colours under extreme background overrides.

#### Code Review #1 Findings

- **P2-1 (blocking).** Stale forced-theme docs.
- **P2-2 (blocking).** Orphaned `color-picker.tsx` and `color` dependency.
- **P2-3 (blocking).** Invisible keyboard focus on the colour input, which is
  also the search-reveal target.
- **P2-4.** Theme echo can revert rapid changes.
- **P2-5.** The debounced save used stale values and was dropped on unmount.
- **P2-6.** Light-mode default probe inherits the override.
- **P2-7.** Radio group has no arrow-key navigation.
- **P2-8.** Unused `useId`.
- **P2-9.** Some surfaces are not derived from overrides.
- **P2-10.** Overrides apply only under `SettingsProvider`.
- **P2-11.** Unrelated prettier changes.
- **P2-12.** Plan notes needed.

#### Code Review #1 Revisions

- **Accepted and fixed:** P2-1, P2-2, P2-3 (focus-within ring; reveal skips
  `type=color`), P2-4, P2-5 (latest-save ref; unmount flush), P2-8, P2-11
  (reverted) and P2-12.
- **Rejected:** P2-6. The default is only shown when that key has no override.
- **Deferred:** P2-7, P2-9 and P2-10 (acceptable in scope).

#### Code Review #2 Findings (repair round 1)

**R1-1 (blocking).** The in-flight guard was cleared before the settings
notification (TanStack notifies as a macrotask), so a stale echo could still
revert the last choice.

#### Code Review #2 Revisions

**R1-1: accepted.** `createThemeEchoTracker` counts submitted themes and
consumes matching stored values independently of timing. Failed saves are
released. There are four unit tests, and the browser scenario passes.

#### Code Review #3 Findings (repair round 2)

Pass.

- **R2-1 (optional).** The count can leak after rapid re-clicks of the same
  value, which could make one later external change look like an echo.

#### Code Review #3 Revisions

- **R2-1: deferred.** It is low impact: single owner, same-origin windows sync
  through next-themes storage events.
- The repair budget for this phase is exhausted.

### Phase 3: Microphone

Requirement: R4. Issue #117. Depends on phase 1. This phase touches high-risk voice files.

Steps:

1. New `lib/voice/microphone-preferences.ts` (or a similarly named module):
   - read and write the selected device ID in local storage, wrapped in
     try/catch;
   - `resolveAudioConstraints(deviceId)` returns `{deviceId: {ideal}}` for a
     remembered device, so the browser falls back to the default when it is
     missing;
   - map sensitivity to VAD thresholds, where Normal equals the current constants
     (positive 0.3, negative 0.25, min speech 180 ms).
2. Preferences: add `speech.mic_sensitivity: "low"|"normal"|"high"` with default
   `normal`, update `mergePreferences`, and add a parse test.
3. `use-dictation.ts`:
   - pass the resolved constraints to both `getUserMedia` calls;
   - read thresholds from the sensitivity mapping instead of constants.
   This is a minimal diff. Keep run-id and cleanup behaviour unchanged.
4. `mic-vad-runtime.ts`: accept an optional `getStream` and pass it to
   `MicVAD.new` with the same constraints, so VAD uses the selected device.
5. Microphone settings entries:
   - device `Select` from `enumerateDevices()` (audio inputs plus "System
     default"), refreshed on `devicechange`;
   - a permission hint when labels are empty;
   - a "not connected, using system default" note when the stored device is
     absent;
   - a sensitivity select;
   - a level meter using `LiveWaveform` with the selected `deviceId`, active only
     while the Microphone group is visible and stopped on close.
6. Bounded research: choose Low/High thresholds by testing on real input. Record
   the values and rationale in this plan.

Checks:

- Unit tests for the constraint fallback and the sensitivity mapping (Normal
  equals current values).
- Full web suite, check and lint.

**Gate (owner, hardware):** with a non-default microphone selected, dictation and
Voice Mode use it; the meter responds; the microphone indicator turns off after
the modal closes; unplugging the device falls back to the system default. Until
the owner confirms, the phase is recorded as "implemented, hardware acceptance
pending", and later phases may proceed.

#### Code Review #1 Findings

Pending.

#### Code Review #1 Revisions

Pending.

### Phase 4: General defaults

Requirement: R5. Issue #118. Depends on phase 1.

Steps:

1. **Default Anima.**
   - Add `startup.default_anima_id` (null means "Last opened") to preferences.
   - `resolveSelectedAnimaId` prefers the pinned ID when it is still owned,
     otherwise uses the last-active ID, otherwise the first Anima.
   - Add a General select showing "Last opened" and the owned Animas; a deleted
     pin shows as a fallback note.
   - Unit-test the resolver.
2. **Default chat model** (backend, `src/backend`).
   - `AnimaCreationService` gains the owner's preferred model ID: read user
     settings at creation, then validate that it exists and is usable through
     `uow.model_providers.get`, otherwise use the configured default.
   - Keep the installation bootstrap on the configured default, because no user
     preferences exist yet.
   - Add backend tests for preferred, missing and unknown values.
3. General select for the default chat model, listing the catalog from
   `useModelProviders` plus "System default". An unavailable stored value is
   labelled as unavailable.

Checks:

- `uv run pytest -q` for the affected creation and settings tests, plus
  `uv run ruff check` (from the repository root).
- Web check, lint and test.
- Rendered check: a pinned Anima opens at `/a`; delete the pin target and the
  fallback works; create a new Anima and it uses the default model while an
  existing Anima keeps its model.

#### Code Review #1 Findings

Pending.

#### Code Review #1 Revisions

Pending.

### Phase 5: Inheritance, Markdown persistence and reset

Requirements: R6, R7, R8. Issue #119. Depends on phase 1.

Steps:

1. **Backend:**
   - `default_anima_preferences()` stops emitting memory/emotion flags, while
     keeping the presentation keys.
   - Confirm that `merge_chat_request_options` resolves request, then Anima, then
     user, then system default (none).
   - Add tests, including that influence-off implies updates-off wherever that
     rule is enforced today (find where, then test and preserve it).
   - Update the baseline SQL only if it seeds these values.
2. **Web preferences:**
   - `updateAnimaPreferences` bases its patch on the stored Anima preferences
     (or `{}`), not `DEFAULT_ANIMAMA_PREFERENCES`, so speech defaults are no
     longer copied into Anima rows.
   - Support removing a key, so "Use app default" deletes it.
3. **App Settings, Memory & Emotion section:** switches for memory influence,
   memory updates and emotion updates, plus the existing Manager model. Keep the
   rule that turning memory influence off also turns memory updates off.
4. **Anima settings** (`ui/main/header/AnimaSettingsModal.tsx`): each of the
   three controls becomes Use app default / On / Off, and shows the inherited
   value.
5. **Markdown:** `presentation.render_markdown` preference replaces the
   React-only state in `SettingsProvider`. Default on, matching current
   behaviour; check the current default.
6. **Data section:** "Reset app settings" with a confirmation dialog.
   - Call the existing `DELETE /v1/users/me/settings`. First confirm that it
     preserves `last_active_anima_id`, `locale` and the display name; if it
     clears more than app preferences, PATCH `preferences: {}` plus `theme`
     instead.
   - Invalidate the settings queries, clear the local microphone device key and
     reset the next-themes value.

Checks:

- `uv run pytest -q tests/test_settings_service.py` plus the chat-options tests.
- Web check, lint and test.
- Rendered check: an Anima follows a changed app default until it is overridden;
  Markdown survives reload; reset restores defaults and leaves an Anima override,
  chats and memories intact; cancel makes no change.

#### Code Review #1 Findings

Pending.

#### Code Review #1 Revisions

Pending.

### Phase 6: About & diagnostics

Requirement: R9. Issue #120. Depends on phase 1 (About section).

Steps:

1. **Version.** Define `VITE_APP_VERSION` at build time from the web
   `package.json` in `web/vite.config.ts` and use `env.appVersion`.
   - If the packaged desktop version can differ from the web build version, add
     a read-only `appVersion` to the desktop bridge (`app.getVersion()` in main,
     exposed in preload, typed in `shared/desktop-runtime.ts`) and prefer it on
     desktop.
   - Record which approach was taken and why.
2. **Platform.** Desktop uses `platform.desktopBridge.platform`; the browser
   shows a generic browser label.
3. **About entries:**
   - version and platform rows;
   - Desktop updates, moved here in phase 1;
   - "Open logs folder" (desktop main window only, `runtime.openLogs()`), which
     reports errors through a toast.
4. **Diagnostics summary.** `lib/diagnostics/summary.ts` builds a pure function
   over explicit inputs: version, platform, runtime state, feature-pack
   IDs/states and which provider credentials are configured (true/false only).
   A button copies the result with `navigator.clipboard.writeText` and shows a
   success or failure toast. Unit tests assert an allow-list of fields and that
   no key values, paths or content can appear.

Checks: web check, lint, test and build; `pnpm desktop:check` if the bridge
changes.
Rendered checks: About in the browser; desktop via `desktop:dev` against the
stack if available. Otherwise record the desktop check as not performed.

#### Code Review #1 Findings

Pending.

#### Code Review #1 Revisions

Pending.

### Phase 7: Documentation, glossary and integration

Requirements: all. Issue #121. Depends on phases 1–6.

Steps:

1. Update current guidance:
   - `docs/frontend/architecture/overview.md` (remove the forced-theme
     paragraph);
   - `docs/frontend/runtime/voice.md` (microphone device, sensitivity);
   - `docs/frontend/runtime/chat.md` and `docs/backend/features/memory.md`
     (inheritance and resolution order), where they describe preferences;
   - `docs/frontend/testing/browser-journeys.md` if its settings journey changed.
2. Add the **App settings** and **Anima settings** entries to `GLOSSARY.md`.
3. Run the full applicable validation (below), the final integration review, the
   PR using the template, and record hosted CI.

## Final integration review

Pending. Covers combined acceptance across R1–R9 and reuses still-valid phase
evidence.

## Validation and acceptance

Run from `src/frontend`:

- `pnpm check`
- `pnpm web:lint`
- `pnpm web:test`
- `pnpm build`
- `pnpm desktop:check` (only if the desktop bridge changed)
- `pnpm exec prettier --check` on changed files

Run from the repository root: `uv run pytest -q` (at least the settings, chat
options and Anima creation tests) and `uv run ruff check`.

Manual evidence:

- rendered desktop journeys per phase;
- Dark and override screenshots (phase 2 gate);
- owner hardware microphone check (phase 3 gate);
- desktop shell About check if feasible.

The spec's acceptance criteria are the checklist; record each as passed, failed
or not performed.

## Idempotence and recovery

- Every phase is a separate commit on one branch. A failed phase can be reverted
  without affecting earlier ones.
- New preference keys are optional with defaults, so stale or absent values fall
  back safely. Older rows need no migration; the development database can be
  reset.
- The microphone device key lives only in local storage, and a missing device
  degrades to the system default.
- Settings reset is recoverable by re-selecting values. It never touches Anima
  settings, chats, memories, content or credentials.
- If phase 3 hardware acceptance fails, revert that phase's
  `use-dictation`/`mic-vad-runtime` changes and keep the Microphone UI behind
  the default device, then record the result.

## Outcomes & Retrospective

Pending.
