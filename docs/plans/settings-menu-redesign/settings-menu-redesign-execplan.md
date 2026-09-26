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
- [x] Phase 3 (#117): R4 Microphone implemented and reviewed (#1, #2 pass). **Owner hardware acceptance pending.**
- [x] Phase 4 (#118): R5 General defaults. Reviewed (#1, #2 pass).
- [x] Phase 5 (#119): R6–R8 inheritance, Markdown persistence, reset. Reviewed (#1, #2 pass).
- [x] Phase 6 (#120): R9 About & diagnostics. Reviewed (#1–#3, pass). Unpackaged desktop check passed; packaged-only parts remain with owner release acceptance.
- [x] Phase 8 (#143): expanded colour customization (owner follow-up, R3 revision 2). Reviewed (#1 pass).
- [x] Phase 9: API Keys with batched saves (R10). Reviewed (#1, #2 pass); packaged-app run with real keys pending (release acceptance).
- [x] Phase 7 (#121): documentation, glossary and final integration review (pass after revisions). PR handoff.

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
- **2026-09-25, agent (merge of main).** Main added an "Experimental" section
  with the WebGPU offline-speech toggle. It is kept as a searchable
  "Experimental" section between Advanced and About, in the flat row style.

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

Results:

- **Delivered:**
  - `lib/voice/microphone-preferences.ts`:
    - the device choice is stored per machine in local storage, with change
      notifications;
    - a remembered device is requested as `ideal`, so a missing device falls
      back to the system default;
    - Low/Normal/High sensitivity maps to VAD thresholds. Normal keeps the
      previous 0.3 / 0.25 / 180 ms.
  - Parakeet dictation and Voice Mode (visualizer and VAD via vad-web
    `getStream`) use the selected device.
  - **Discovery:** Browser speech recognition cannot target a device, so the
    browser path deliberately keeps its visualizer and VAD on the system
    default, matching the recognizer. The settings row says so.
  - Sensitivity is read at VAD start.
  - Voice → Microphone group:
    - device picker with a permission request and a not-connected note;
    - sensitivity select;
    - opt-in level meter that releases the microphone on stop, device change
      or unmount.
  - **Constraint change:** the visualizers now also request `channelCount: 1`,
    matching vad-web's defaults.
  - **Low/High values** (0.5/0.35/250 ms and 0.2/0.15/120 ms) are initial
    values; tuning is part of the hardware gate.
- **Local checks (`src/frontend`):**
  - `pnpm check` pass;
  - `pnpm web:lint` pass;
  - `pnpm web:test` 298 files / 1,786 tests pass;
  - after repairs: `tsc -b`, scoped eslint, and voice and hooks tests (26)
    pass.
- **Browser:**
  - the group renders first in Voice;
  - High sensitivity persists to preferences;
  - the browser pane blocks capture (NotAllowedError), so the
    permission-request state shows.
- **Owner follow-up (2026-09-25):** the test meter is now a left-to-right
  segmented dBFS bar (−60 to 0 dB; green, yellow from −18 dB, red from −6 dB)
  with a peak decay (`lib/voice/level-meter.ts`, `MicrophoneLevelMeter.tsx`).
  Verified in the browser with a synthetic tone at −18 dB and at clipping.
- **Owner hardware gate: pending.** Needs a non-default microphone for Parakeet
  dictation and Voice Mode; the meter responding; the indicator turning off
  after close; unplug fallback; and Low/High tuning.

#### Code Review #1 Findings

- **P3-1 (blocking).** With browser recognition and a remembered device, VAD
  and the visualizer would capture from a different microphone than the
  recognizer.
- **P3-2.** A "not connected" note flashes before enumeration finishes.
- **P3-3.** Device names were not refreshed after the test granted
  permission.
- **P3-4.** `channelCount` constraint change.
- **P3-5.** Meter accessible name.
- **P3-6.** Sensitivity timing copy.

#### Code Review #1 Revisions

- **P3-1: accepted.** The browser path uses default constraints and no
  `getStream`.
- **P3-2: accepted.** A `loaded` flag.
- **P3-3: accepted.** The meter emits an access event and the row
  re-enumerates.
- **P3-4: accepted and documented.**
- **P3-5: accepted.** `role="img"` wrapper.
- **P3-6: accepted.** Copy updated.

#### Code Review #2 Findings (repair round 1)

Pass.

- **Optional:** redundant `aria-pressed` alongside the changing label.

#### Code Review #2 Revisions

- **`aria-pressed`: removed.** The label alone conveys state.
- One repair round remains.

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

Results:

- **Delivered:**
  - **Backend:** `AnimaCreationService` uses the owner's
    `preferences.chat.default_model_provider_id` when the model exists, is
    active and is supported by direct chat. Otherwise it falls back to the
    configured default. The materializer accepts a per-call model. The router
    wires in `preferred_default_model_reader`. Installation bootstrap keeps the
    configured default. Idempotent replay is unchanged, because the spec hash
    excludes the model and the stored result is replayed.
  - **Web:**
    - `resolveStartupAnimaId` opens the pinned Anima when it is still owned,
      otherwise the last active one, otherwise the first; `/a` uses it.
    - General "Defaults" group: Default Anima ("Last opened" plus owned
      Animas, with a note when the pinned Anima was deleted) and Default chat
      model (System default plus chat-capable catalog rows, with a note when
      the saved model is unavailable).
  - **Docs:** the backend model catalog and frontend data-layer docs are
    updated.
- **Local checks:**
  - `pnpm check` pass;
  - `pnpm web:lint` pass;
  - `pnpm web:test` 298 files / 1,789 tests pass;
  - `uv run ruff check` pass;
  - ruff format pass;
  - `uv run pytest -q tests/test_anima_creation.py` 39 pass, including
    preferred, inactive, non-chat, unknown and unset models;
  - after repairs: `tsc -b`, eslint, and vitest settings and animas tests (34)
    pass;
  - import-boundary check reports 0 forbidden edges (reviewer).
- **Browser:** pinning Caitlyn persisted `startup.default_anima_id`, and `/a`
  opened Caitlyn although Annie was last active.
- **Not performed:**
  - a rendered deleted-pin check (covered by unit tests);
  - rendered creation of a new Anima with the default model (covered by the
    backend test).

#### Code Review #1 Findings

- **P4-1 (blocking).** The model list and backend accepted models that direct
  chat rejects.
- **P4-2 (blocking).** Two docs described the old behaviour.
- **P4-3 to P4-8 and P4-11.** Replay, starter path, locking, session reads,
  tests, route and complexity were verified; no change needed.
- **P4-9.** The model select showed its placeholder while the catalog loaded.
- **P4-10.** Trim inconsistency.

#### Code Review #1 Revisions

- **P4-1: accepted.**
  - The backend requires `chat_api_standard_for_provider`.
  - The frontend filters with `chatModelSendGate`.
  - A `no_chat` test case was added.
- **P4-2: accepted.** Both docs updated.
- **P4-9: accepted.** The select is disabled until the catalog loads.
- **P4-10: accepted.**
- **Others:** acknowledged.

#### Code Review #2 Findings (repair round 1)

Pass.

- **Optional:** JSON re-indent churn in the docs.

#### Code Review #2 Revisions

- **JSON re-indent: reverted.**
- One repair round remains.

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

Results:

- **Delivered:**
  - **Inheritance:** `default_anima_preferences()` no longer writes
    memory/emotion flags, so new Animas inherit.
  - **Resolution** (`merge_chat_request_options`): request, then Anima, then
    owner, then enabled. Memory updates are forced off whenever memory
    influence resolves off, including across levels.
  - **Web helpers:** `lib/settings/behavior-defaults.ts` provides tri-state
    overrides and a patch that removes the key for "App default";
    `updateAnimaPreferences` no longer copies default preferences into Anima
    rows.
  - **Anima settings:** "App default (On/Off) / On / Off" selects.
  - **App Settings → Memory & Emotion:** a "Defaults for Animas" group.
  - **Markdown:** stored in `presentation.render_markdown` (default on).
  - **Data → Reset app settings:** a shared-dialog confirmation PATCHes
    `{preferences: {}, theme: "light"}`, clears the per-machine microphone
    device and closes App Settings so controls reload. The last opened Anima,
    locale, display name, Anima settings, chats and memories are kept.
- **Local checks:**
  - `pnpm check` pass;
  - `pnpm web:lint` pass;
  - `pnpm web:test` 299 files / 1,793 tests pass;
  - ruff check and format pass;
  - backend inheritance, settings, materializer and structured-response tests
    76 pass;
  - chat SSE and executor regression 152 pass (reviewer);
  - after repairs: `tsc -b` and eslint pass.
- **Browser:**
  - App memory-updates Off made an inheriting Anima show "App default (Off)";
  - choosing On stored only `memory.disable_updates:false`;
  - reset Cancel is a no-op;
  - reset clears preferences, sets the light theme, keeps the last opened
    Anima and keeps the Anima override, and closes both dialogs;
  - the Markdown toggle persisted.

#### Code Review #1 Findings

- **P5-1 (blocking).** The influence-off → updates-off rule was lost across
  inheritance levels.
- **P5-2 (blocking).** App Settings showed stale local values after a reset.
- **P5-3.** Hand-built dialog.
- **P5-4.** Duplicated labels.
- **P5-5.** Explicit updates Off survives when memory returns to "App
  default".
- **P5-6.** Docs pending.

#### Code Review #1 Revisions

- **P5-1: accepted.** Enforced in backend resolution, with a test; the UI
  note explains it.
- **P5-2: accepted.** App Settings closes after a successful reset.
- **P5-3 and P5-4: accepted.**
- **P5-5: acknowledged.** Harmless after the P5-1 fix.
- **P5-6: phase 7.**

#### Code Review #2 Findings (repair round 1)

Pass.

- **Optional:** a disabled explicit "On" is still displayed while memory is
  off; the description clarifies it.

#### Code Review #2 Revisions

- No change.
- One repair round remains.

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

Results:

- **Version approach taken:** a build-time `__ANIMAMA_APP_VERSION__` from
  `VITE_APP_VERSION` if set, otherwise the web `package.json` version.
  - No bridge field was added. `app-version.test.ts` enforces that the web and
    desktop package versions match, because electron-builder takes the app
    version from `desktop/package.json`.
  - The dev stack shows "local" because `docker-compose.development.yml` sets
    `VITE_APP_VERSION=local`.
  - The production build embeds `0.1.0` (verified in the bundle).
- **Delivered:**
  - About → "Animama" group: Version and platform, plus the existing Desktop
    updates panel.
  - About → "Diagnostics" group:
    - Open logs folder, using the existing `runtime.openLogs`, desktop only;
    - Copy diagnostics summary: an allow-listed builder
      (`lib/diagnostics/summary.ts`) with sanitised tokens covering version,
      platform, runtime state/code, installed pack versions and whether each
      provider is configured.
  - `copyText` falls back from the Clipboard API to selecting a textarea kept
    inside the dialog, verifies the selection, and restores focus. This covers
    the desktop permission handler, which allows only media.
- **Local checks:**
  - `pnpm check` pass;
  - `pnpm web:lint` pass;
  - `pnpm web:test` 301 files / 1,797 tests pass;
  - `pnpm build` pass;
  - after repairs: diagnostics tests (7) pass, `tsc -b` and eslint pass;
  - production-delivery tests pass (reviewer).
- **Browser (web):**
  - About shows "local" and "Web browser";
  - the copied summary contains only version and platform;
  - the fallback toast path was exercised. The pane cannot deliver a trusted
    click for a real fallback copy.
- **Desktop shell check (agent, 2026-09-25, owner-authorized):** ran the
  unpackaged app with an isolated profile against the `animama-settings`
  stack and drove it over the DevTools protocol with trusted input events.
  - The bridge reported `darwin`, role main.
  - The nav included Shortcuts (desktop only).
  - About showed "Desktop (macOS)" and "local".
  - Copy summary put "Animama diagnostics / App version: local / Platform:
    desktop-darwin / Runtime: external" on the macOS clipboard, read back
    with `pbpaste`.
  - Open logs folder resolved without an error toast. The Finder window was
    not confirmed programmatically.
  - Not covered (packaged-only): the updates panel, and credentials and
    feature packs in the summary, since external mode reports
    `embedded_runtime_unavailable`.

#### Code Review #1 Findings

- **P6-1 (blocking).** The desktop permission handler may deny
  `navigator.clipboard.writeText`.
- **P6-2.** Record the version approach.
- **P6-3.** The pack version shown was the offered version.
- **P6-4.** Empty-env handling.
- **P6-5.** Stale `ImportMetaEnv` key.
- **P6-6.** Extra pack subscription.

#### Code Review #1 Revisions

- **P6-1: accepted.** A clipboard fallback was added without widening
  `guards.ts`.
- **P6-2 to P6-5: accepted.**
- **P6-6: acknowledged.**

#### Code Review #2 Findings (repair round 1)

- **P6-7 (blocking).** The fallback textarea was appended to `document.body`,
  where the dialog focus trap steals focus, and `execCommand` could report a
  false success. This was reviewed before the in-dialog container fix landed.

#### Code Review #2 Revisions

- **P6-7: accepted.**
  - The textarea is appended inside the focused element's dialog.
  - The selection is verified before `execCommand`.
  - Focus is restored.
  - The docstring now states the reliance on transient activation.
  - Three unit tests cover the Clipboard API, the fallback inside the dialog
    and failure cleanup.
- The final targeted recheck (round 2) follows.

#### Code Review #3 Findings (repair round 2)

Pass.

- **P6-7:** resolved.
- **Optional:** the fake-DOM tests do not exercise the real focus trap, which
  is covered by the owner desktop check.

#### Code Review #3 Revisions

- No change.
- The repair budget for this phase is exhausted.

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

### Phase 8: Expanded colour customization

Requirement: R3 (revision 2, owner 2026-09-25). Depends on phase 2. Added
after the PR opened, at the owner's request.

**Scope:**

- **Visual style:** Primary, Secondary, Accent, Background and Foreground.
  The previous "Accent" row actually set `--primary`, so it is relabelled
  Primary. No stored-value migration is needed, because that key existed only
  on this unmerged branch (agent decision, 2026-09-25).
  Matching `*-foreground` text colours are derived automatically.
- **Advanced** (collapsed, per mode), grouped:
  - Surfaces: card, popover, muted;
  - Lines: border, input, focus ring;
  - Destructive;
  - Sidebar: sidebar background, foreground, primary, accent, border;
  - Charts: chart 1–5.
- Advanced values win over derived ones.
- Reset per colour and "Reset all" for the mode.

**Steps:**

1. Extend `appearance-overrides.ts` with a token registry: key, CSS variables
   and derived-foreground rule. Keep the parse, validate and CSS-generation
   tests.
2. (Dropped: no migration needed.)
3. In the Appearance UI, render the basic rows and a collapsible Advanced
   group from the registry; search entries cover each colour.
4. Browser check in Light and Dark with sample basic and advanced overrides.
5. Update docs.

Checks: web check, lint, test and build; independent review.

Issue #143.

Results:

- **Delivered:**
  - The token registry drives parsing, CSS and the rows.
  - Visual style has Primary, Secondary, Accent, Background and Foreground,
    plus "Reset all" for the mode.
  - "Advanced colours" (Show/Hide, `aria-expanded`) reveals Surfaces, Lines,
    Status, Sidebar and Charts groups.
  - Collapsed entries stay searchable, and selecting one expands the section
    and reveals it.
  - Advanced values win over derived and basic values; Focus ring also sets
    the sidebar ring.
- **Local checks:**
  - `pnpm check` 0;
  - `pnpm web:lint` 0;
  - `pnpm web:test` 305 files / 1,826 pass;
  - `pnpm build` 0;
  - prettier on changed files pass;
  - after review tweaks: `tsc -b`, eslint, and theme and voice tests pass.
- **Browser:**
  - search "border" opens Appearance, expands Advanced and focuses the Border
    hex input;
  - `#ff0000` is stored as `light.border` and applied;
  - Reset all clears the mode.

#### Code Review #1 Findings

Pass, with no blocking findings.

- **P8-1.** The sidebar ring kept the Primary colour when a Focus ring colour
  was set.
- **P8-2.** Key type widened to string.
- **P8-3.** A custom background leaves Secondary and Accent unmixed (existing
  behaviour).
- **P8-4.** No automated tests for search-expand or reset.
- **P8-5.** The "Default -" prefix parse only handles English.
- **P8-6.** The meter has no `aria-valuetext`.

The follow-up commits for the meter and the default-mic label were checked:
no issues.

#### Code Review #1 Revisions

- **P8-1: accepted.** `ring` also sets `sidebar-ring`.
- **P8-6: accepted.** `aria-valuetext` added.
- **P8-2 to P8-5: acknowledged.** They are optional, and browser evidence
  covers P8-4.

### Phase 9: API Keys with batched saves

Requirement: R10 (owner 2026-09-25). This touches high-risk desktop code
(supervisor, runtime IPC, preload) with minimal diffs that follow the existing
patterns.

Results:

- **Desktop:**
  - `validateCredentialChanges` accepts 1 to 5 changes, one per provider, each
    `{provider, value?}` with no other fields.
  - `RuntimeSupervisor.changeCredentials` quiesces once, writes the whole batch
    and restarts consumers once. On failure it records the same failure for
    every changed provider, and saved keys remain for Retry.
  - `changeCredential` delegates to it.
  - The new `credentials:apply` channel is main-window only (not recovery) and
    validated in IPC. The preload exposes `credentials.apply`.
- **Web:**
  - `credentialChangesFromDrafts` and `applyCredentialChanges` (single-call
    batch with per-provider confirmation, falling back to sequential saves).
  - `DesktopCredentialsPanel` is now a per-provider form: status, masked
    write-only field, Remove/Undo, one Save ("Save N changes") and Discard.
  - It is used by setup and by the new API Keys section, which is hidden unless
    the embedded runtime is available (`useDesktopCredentialsAvailable`,
    external/dev mode excluded).
- **Checks:**
  - `pnpm desktop:check` pass;
  - `pnpm desktop:test` 15 files / 305 pass, including new IPC batch validation
    and authority tests and a supervisor test showing one FastAPI relaunch with
    both keys set and one removed;
  - web credential tests 10 pass; `tsc -b` and eslint pass.
- **Browser:** tested in a separate Chrome with a simulated desktop bridge
  injected before load.
  - The API Keys section lists the providers.
  - Two new keys plus one removal produced a single `apply` call with three
    changes, "Restarting local services…", then "3 changes saved"; statuses
    updated and typed keys were cleared.
- **Not performed:** a packaged-app run with real keys (owner/release
  acceptance).

#### Code Review #1 Findings

- **P9-1 (blocking).** Formatting failures in two desktop files.
- **P9-2 (blocking).** A batch was written one provider at a time, so a
  failure partway through mislabelled saved keys.
- **P9-3.** Misleading docstring.
- **P9-4.** Stale failure lines shown during a save.
- **P9-5.** Setup Continue discarded unsaved key edits.
- **P9-6.** Remove/Undo buttons were not named per provider.
- **P9-7.** Dead sequential fallback.
- **P9-8.** Spec wording and setup copy.

#### Code Review #1 Revisions

- **All accepted and fixed.**
  - `CredentialVault.apply` makes one encrypted write per batch (`delete`
    delegates to it). A supervisor test checks that a failed batch records the
    failure for every provider in it and leaves the vault unchanged.
  - `CredentialsBridge.apply` is required.
  - Setup blocks Continue while key edits are pending.
  - Accessible names and status descriptions added.
- **Checks:**
  - desktop tests 306 pass;
  - `desktop:check` pass;
  - `tsc -b` and eslint pass;
  - settings and routes tests 44 pass.

#### Code Review #2 Findings (repair round 1)

Pass.

- **Optional:** the Undo accessible name did not contain "Undo" (WCAG
  2.5.3).

#### Code Review #2 Revisions

- **Accepted.** The name is now "Undo removing <provider> key".
- One repair round remains.

## Final integration review

Source: `de7d4b8` plus the phase 7 docs; baseline `d987d24`.

Full validation on this source:

- `pnpm check` 0;
- `pnpm web:lint` 0;
- `pnpm web:test` 302 files / 1,800 tests pass;
- `pnpm build` 0;
- `pnpm desktop:check` 0;
- `uv run ruff check` 0;
- `make format-check` 0;
- `uv run pytest -q` 1,790 passed, 7 skipped.

#### Code Review #1 Findings (final integration)

- **F-1 (blocking).** `user-profiles.md` and `routing.md` still described
  last-opened-only launch.
- **F-2 (blocking).** The acceptance record needed R3 override coverage and
  the R5 rendered checks recorded, with R4 and R9 marked owner-pending.
- **F-3.** The memory docs omitted the forced updates-off rule.
- **F-4.** The glossary label did not match the UI ("App default").
- **F-5.** Concurrent preference saves can lose an update, because each PATCH
  replaces the whole object.
- **F-6.** Reset relied on the stored-theme sync; a leaked echo count could
  swallow it.
- **F-7.** Reset cleared `has_sent_chat_message`.

#### Code Review #1 Revisions

- **F-1: accepted.** Both docs are updated, and the browser journey is
  qualified.
- **F-2: accepted.**
  - Dark plus sample-override screenshots were added for the Anima page,
    Memory and the Gesture creator. Chat, Library and App Settings were
    already captured. The only remaining caveat is the known built-in
    accent/secondary colours.
  - The R5 deleted-pin fallback and new-Anima default model are recorded as
    covered by unit and backend tests, and not rendered.
  - R4 and R9 are recorded as owner-pending.
- **F-3: accepted.** One sentence added to `docs/backend/features/memory.md`.
- **F-4: accepted.** The glossary now uses "App default".
- **F-5: deferred.** It needs two saves in flight within one round trip on
  loopback; this is the existing full-object preference pattern, and the
  setting can be re-selected. Candidate follow-up: serialise or optimistically
  merge preference writes in `SettingsProvider`.
- **F-6: accepted.** Reset also calls `setTheme("light")` locally.
- **F-7: accepted.** Reset preserves `has_sent_chat_message`.

After the fixes, `tsc -b` and eslint pass. The remaining full-suite results
are unchanged by these edits, which touch only docs and one reset handler.

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

Delivered R1–R9 in seven phases on one branch:

- searchable, flat App Settings with section icons;
- Appearance modes and per-mode colour overrides;
- microphone device, sensitivity and meter;
- default Anima and default chat model;
- memory/emotion App defaults with Anima inheritance;
- persisted Markdown setting;
- settings reset;
- About and diagnostics.

**Owner-pending acceptance:**

- **R4 hardware microphone:** a non-default microphone used by Parakeet
  dictation and Voice Mode; meter; release on close; unplug fallback; Low/High
  tuning.
- **R9 packaged desktop:** the updates panel, and the credentials and feature
  packs rows of the summary. The unpackaged shell check passed.

**Known limitations:**

- Browser speech recognition always uses the system default microphone.
- `--accent`, `--secondary` and `--sidebar-accent` are not derived from
  overrides.
- Concurrent preference saves can lose an update (F-5).
- A theme echo count can leak after rapid re-clicks (R2-1).
- Credentials and feature-pack entries stay searchable when they render
  nothing, in unpackaged or external desktop only.

**Lessons:**

- A portalled Popover inside a Radix modal Dialog breaks typing; render in
  place.
- TanStack Query notifies after mutation promises settle, so echo tracking
  must count submissions rather than rely on timing.
- The desktop permission handler allows only media, which affects the async
  Clipboard API.
