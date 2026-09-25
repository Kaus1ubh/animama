# App Settings redesign

Status: Agreed (snapshot)
Authority: https://github.com/raymond-van/animama/issues/114, published 2026-09-25 from this file; the issue is authoritative.
Owner decision: 2026-09-25 owner accepted the discovery answers and confirmed this spec,
including the formerly proposed items below.

## Problem and intended users

The installation owner configures Animama through two surfaces: App Settings
(opened from the sidebar user menu) and per-Anima settings. App Settings covers
only part of what the owner can reasonably configure, and some stored settings
are unreachable or ineffective:

- Theme selection is disabled by a feature flag that forces the light theme,
  although Light/Dark/Custom themes and their persistence still exist.
- There is no microphone device selection, no sensitivity control and no way to
  test input; dictation and voice detection always use the system default device
  with fixed detection thresholds.
- There is no app-wide default chat model for new Animas and no way to choose
  which Anima opens on startup (the last-opened Anima is always used).
- Memory and emotion toggles exist only per Anima. App-level values exist in the
  preference schema but are not exposed, and new Anima settings store explicit
  values, so an app-level value could never take effect.
- "Render assistant Markdown" resets on reload.
- There is no settings reset, and no About or diagnostics surface for bug reports.

## Goals, scope and non-goals

In scope:

- The already-built modal refresh: search across all sections, section icons, a
  dedicated Shortcuts section and flat, non-card styling (R1).
- Copy and layout polish (R2), Appearance (R3), Microphone (R4), startup and model
  defaults (R5), app-level memory/emotion defaults with Anima inheritance (R6),
  persisted Markdown rendering (R7), settings reset (R8), About & diagnostics (R9).

Non-goals and deferrals:

- Desktop shell behaviour: launch at login, menu-bar/tray icon, start hidden,
  picture-in-picture always-on-top toggle and quick-chat positioning. Deferred to a
  focused desktop discussion.
- Bulk deletion of chats or memories, and data export/backup/restore.
- An "Open backups folder" action and a telemetry opt-out (web telemetry currently
  exports nothing, so a switch would be misleading).
- Changing which Anima-only settings exist (voice overrides, background, chat model
  per Anima) beyond the inheritance in R6.
- Migrating existing development data; the development database may be reset.

## Required behavior

- **R1 — Modal structure and search.**
  - Each section has an icon in the navigation.
  - A search field at the top of the navigation matches settings across all
    sections by label, description, group and hidden keywords, case-insensitively
    and in any word order.
  - Matches appear in a dropdown under the field, grouped under their section,
    with the typed text highlighted.
  - Arrow keys and Enter, or the mouse, select a result. Selecting a setting
    opens its section, scrolls it into view, focuses its control when enabled,
    and briefly highlights it. Selecting a section header opens that section.
  - Esc clears an active query without closing the modal; Esc with an empty
    query closes it.
  - Unavailable settings (for example desktop-only panels in a browser, or
    sub-options of a disabled provider) are neither shown nor searchable.
  - Desktop shortcuts live in their own Shortcuts section.
  - Settings render as grouped rows (label and description left, control right)
    without card borders or backgrounds. Shared panels reused elsewhere, such as
    setup, notices and contextual feature-pack prompts, keep their existing styling
    there.
- **R2 — Copy and dividers.** The search placeholder reads "Search". User-facing
  settings copy uses "Speech-to-Text" and "Text-to-Speech". Sub-sections within
  a section are separated by faint dividers.
- **R3 — Appearance.** (Revised by the owner on 2026-09-25: colour overrides
  replace the separate Custom theme.)
  - **Mode:** System, Light or Dark, chosen from preview tiles. System follows the
    operating system and updates when it changes.
  - **Colour overrides:** Accent, Background and Foreground, each shown with its
    hex value. Light and Dark keep separate overrides; the controls edit the mode
    currently in effect. Each override can be reset to the mode default, and an
    unset override uses the built-in colours.
  - **Validation:** invalid colour input is rejected without changing the saved
    value.
  - **Persistence:** mode and overrides persist across reloads and apply on web
    and desktop.
  - **Removals:** the theme feature flag and the separate Custom theme and its
    editor are removed. A previously stored "custom" theme falls back to Light.
  - **Legibility:** Dark, and a representative set of overrides, render legibly
    on the core surfaces listed in the acceptance criteria.
- **R4 — Voice → Microphone** (first sub-section of Voice).
  - **Input device picker.** Lists available audio inputs plus "System default".
    The choice is remembered per machine/browser, not synced through app
    preferences.
  - **Missing device.** If the remembered device is unavailable, input falls back
    to the system default and the picker says so, without failing dictation or
    Voice Mode.
  - **Sensitivity.** Low / Normal / High, where Normal preserves today's
    detection behaviour. Stored in app preferences and applied to voice
    detection.
  - **Level meter.** A live level meter lets the owner test the selected
    microphone while the modal is open, and releases the microphone when the
    section or modal closes.
  - **Scope of device choice.** Dictation, Voice Mode and press-to-talk all use
    the selected device.
  - **Permissions.** Before permission is granted, device names may be
    unavailable; the section explains how to grant access instead of showing an
    empty or broken list.
- **R5 — General defaults.**
  - **Default Anima:** "Last opened" (today's behaviour and the default) or a
    specific owned Anima. Opening the app route opens that Anima. If the pinned
    Anima no longer exists, the app falls back to last-opened behaviour and the
    setting shows the fallback.
  - **Default chat model:** chosen from the available model catalog, or the
    system default. Newly created Animas start with it. Existing Animas keep
    their own model. An unavailable stored model is shown as unavailable and new
    Animas use the system default.
- **R6 — Memory and emotion defaults with inheritance.**
  - App Settings exposes app-wide defaults for memory influence, memory updates
    and emotion updates.
  - Each corresponding Anima setting offers "Use app default" (the default for
    new Animas) or an explicit on/off, and indicates the inherited value.
  - Chat behaviour uses the explicit Anima value when set, otherwise the app
    default, otherwise the system default. A per-request override still takes
    precedence.
  - The existing rule that turning memory influence off also stops memory updates
    is preserved at both levels.
  - The existing Memory Manager model setting remains.
- **R7 — Markdown persistence.** "Render assistant Markdown" is saved in app
  preferences and survives reloads.
- **R8 — Data: reset app settings.**
  - After confirmation, app preferences return to their defaults (including theme,
    microphone sensitivity, shortcuts and defaults above).
  - Anima settings, chats, memories, content, provider keys and the display name
    are unaffected.
  - Failure leaves settings unchanged and reports an error.
- **R9 — About & diagnostics.**
  - Shows the app version and platform in both browser and desktop.
  - Desktop only: "Open logs folder" using the existing runtime bridge.
  - "Copy diagnostics summary" copies a plain-text summary for bug reports:
    version, platform, runtime state, feature-pack states and which providers are
    configured. It never includes keys, tokens, file contents, chat or memory
    content, or personal identifiers.

## Constraints

- **Accountless model.** Settings remain owned by the installation owner through
  the existing request boundary. No new local accounts or browser credentials.
- **Persistence.** App preferences are free-form JSON and every save replaces the
  whole object. New keys must merge safely with existing ones and tolerate
  missing or unknown values. Schema changes update the baseline SQL rather than
  adding Alembic revisions. Development data may be reset (owner decision,
  2026-09-25).
- **Desktop bridge.** Any desktop bridge change must stay narrow, typed and
  limited to the main window, per the desktop overview. No arbitrary paths or
  commands over IPC.
- **High-risk files.** Microphone changes touch high-risk dictation and
  voice-detection code. Keep changes minimal and preserve run-id and cleanup
  behaviour.
- **Accessibility.** Search is keyboard-operable with combobox/listbox semantics.
  Controls keep accessible names. Highlights respect reduced-motion preferences.
- **Layout.** Desktop viewport sizes are primary; narrower layouts must not
  regress.
- **Generated code.** The generated API client is regenerated, never hand-edited,
  if backend contracts change.

## Acceptance criteria

- [ ] **Search (R1).** Automated tests cover matching, grouping and highlighting.
      A rendered desktop journey shows cross-section results, keyboard selection
      revealing and focusing a setting, and Esc clearing before closing.
- [ ] **Copy and dividers (R2).** Visible in the rendered modal; search finds
      "speech-to-text" and "text-to-speech" settings.
- [ ] **Appearance (R3).** Each mode and override can be set, reset and
      persists after reload. Invalid colours are rejected. System follows an
      emulated OS scheme change. Screenshots in Dark and with sample overrides
      show legible chat, sidebar, App and Anima settings,
      Anima pages, Library, Memory, and creator main panels; issues found are
      fixed.
- [ ] **Microphone (R4).** Automated tests cover device fallback and the
      sensitivity-to-threshold mapping, with Normal equal to today's values.
      Owner manual check on real hardware confirms: selecting a non-default mic
      is used by dictation and Voice Mode, the meter responds, and the mic is
      released on close.
- [ ] **General defaults (R5).** Tests and a rendered check show the pinned
      Anima opening at the app route, fallback when the pinned Anima is deleted,
      and a newly created Anima using the default chat model while an existing
      Anima keeps its model.
- [ ] **Inheritance (R6).** Backend tests cover the request → Anima → app →
      system resolution order and the influence-off-disables-updates rule.
      A rendered check shows an Anima indicating and following an inherited
      app value.
- [ ] **Markdown (R7).** The Markdown setting survives reload.
- [ ] **Reset (R8).** After confirmation, app preferences return to defaults
      while Anima settings, chats and memories remain; cancel changes nothing.
- [ ] **About (R9).** Version and platform display in the browser and desktop
      shell. Open logs works on desktop and is absent in the browser. The copied
      summary is reviewed and contains no secrets or content.
- [ ] **Validation.** Frontend and backend checks pass (type-check, lint, tests,
      build, formatting of changed files), with unperformed checks stated.

## Open questions and decisions

Agreed 2026-09-25:

- Theme modes are Light/Dark/System. Revised the same day: Accent/Background/Foreground
  overrides per mode replace the Custom theme, following the owner's reference
  screenshot. Theme presets and import/export are not included.
- Desktop behaviour deferred.
- App defaults with Anima "Use app default" inheritance.
- Data scope limited to reset.
- Microphone: device (per machine), Low/Normal/High sensitivity, meter.
- Default chat model applies to new Animas only.
- Default Anima is last-opened or pinned.
- About: version/platform, open logs, diagnostics summary.
- Markdown setting persisted.
- Visual QA on core surfaces.
- One plan, one PR, phased, with the existing redesign as the first phase.

Confirmed by the owner on 2026-09-25, having first been proposed in the spec draft:

- Section order: General, Appearance, Voice, Shortcuts, Memory & Emotion, Data,
  Advanced, About.
- Emotion defaults sit in the Memory section, renamed "Memory & Emotion".
- Desktop updates move from General into About; feature packs stay in General.
- Add glossary entries **App settings** (installation-wide defaults) and
  **Anima settings** (per-Anima values that may inherit from App settings).

Bounded research during implementation:

- Exact Low/High voice-detection thresholds. Normal equals current values.

## Spec

[#114](https://github.com/raymond-van/animama/issues/114).

## ExecPlan

[settings-menu-redesign-execplan.md](settings-menu-redesign-execplan.md).

## Delivery links

Phase issues #115–#121. Branch `feat/settings-menu-redesign`; PR pending.
