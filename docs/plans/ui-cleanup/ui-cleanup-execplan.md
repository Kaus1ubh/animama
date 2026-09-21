# UI cleanup follow-up

Source agreement: owner request on 2026-09-20; issue #31 and PR #32.
Authorized scope: all four requested follow-ups on existing chore/ui-copy-cleanup,
starting at b49bf601c79cab80191f1194e309cb9843954496. Retain the task stack.

## Purpose and context

Replace camera cycling with preset selection. Hide healthy content status and
show actionable diagnostics with Retry scan only when attention is needed.
Propagate detected catalog changes to cached Library/Appearance rows. Remove
obsolete built-in Avatar seeds and safely reconcile unreferenced obsolete rows;
preserve valid models and existing Anima references. Show Avatar-owned generated
portraits and consistent primary creation actions.

## Phase 1: integrated follow-up

1. Inspect catalog watcher/query boundaries, model seeds and all Avatar references.
2. Update camera and Library presentation using existing selectors and protected
   portrait delivery. Preserve unique descriptions and functional controls.
3. Make content health an attention-only popover; refresh owner-scoped derived
   queries on semantic catalog changes, ignoring scan timestamps.
4. Remove known obsolete seeds; apply narrowly scoped reference-safe reconciliation
   through existing startup/bootstrap paths. Never purge or mutate the main stack.
5. Run focused behavior tests for query refresh, health recovery and Avatar
   retention/deletion, plus web type/lint/build checks and backend checks relevant
   to changed persistence. Verify the current isolated stack in a browser.
6. Independent code review plus delegated checks, at most two repair rounds.
   Commit, push and update PR #32; owner browser acceptance/merge remain separate.

## Validation and recovery

Use synthetic test fixtures and the task-owned stack. Verify healthy silence,
affected-item details, retry error/recovery, and automatic visible row updates.
Check referenced obsolete avatars survive, valid/custom avatars survive, obsolete
unreferenced rows disappear, and fresh seeds omit removed models. No schema change
or migration revision is intended. Restore test-only content after watcher probes.
If reconciliation is unsafe, preserve the row and report why rather than cascade.
Revert the task commit for code recovery; keep stack data and services for review.

## Progress

- [x] Verified clean task branch at the prior PR candidate; inspected query gap.
- [x] Implementation and focused validation.
- [x] Independent review passed; commit and PR update prepared.
- [ ] Owner browser acceptance (separate from agent completion).

## Surprises & discoveries

Health polls every 15 seconds but typed Library queries do not refresh with it.

## Decision log

- Keep this work on the existing PR and stack, per owner request.
- Compare catalog content, not scan timestamps, to avoid background refetch churn.
- Never delete referenced stale Avatar records merely to hide obsolete Library rows.

## Code Review #1 Findings

FR1-1: initial portrait lookup covered only Included portraits and could associate
a Local model by a matching basename. Accepted: generated Local portraits now
carry exact presentation.avatar_item_id metadata; catalog lookup uses owner-visible
valid exact associations, with basename fallback restricted to Included models.
No other actionable findings in the follow-up scope.

## Code Review #1 Revisions

FR1-1 fixed and targeted independent recheck passed. One repair round used;
no unresolved findings. Tests cover Local associations, basename collisions,
private/invalid portraits and persisted generated metadata.

## Outcomes & retrospective

Local evidence:

- `pnpm web:check`, `pnpm web:lint`, changed-file Prettier checks: passed.
- Focused Vitest health/camera/invalidation/library/setup suites: 40 tests passed
  in 7 files. Invalidation tests first reproduced stale rows, then passed.
- `source ../../.animama-stack.env && pnpm build`: passed; existing chunk-size
  warning only. No API schema changes or SDK regeneration.
- Backend focused Avatar/bootstrap/portrait replay suites: 21 tests passed;
  affected Ruff lint and format checks passed.
- `git diff --check`: passed.
- Named development stack: animama-ui-cleanup-7d93, loopback application port
  8200, private backend/Postgres, no optional profiles. Before seed cleanup:
  7 obsolete rows, 0 Anima references, 0 upload references. After: 2 valid Avatar
  rows, 0 obsolete rows. Only this task stack was changed.
- Browser: Avatar portraits and Create Anima verified; camera switched directly
  Full body -> Portrait -> Full body. Profile and Background modals show no
  healthy scan control. Synthetic Scene FX appeared automatically after a host
  edit; invalidating its schema removed its row and exposed diagnostic details.
  Retry scan after correction restored the row and hid the indicator. Synthetic
  files and their three catalog records were removed after verification.

Independent source review and delegated checks passed. Owner browser acceptance
and exact-candidate merge approval remain pending. No full backend suite, native
Electron/audio acceptance or main-stack data mutation. Hosted results are reported
separately on PR #32. Existing pre-association Local portraits fall back to the
icon until regenerated; ambiguous basename matching is intentionally avoided.

## Subsequent visual polish

Owner requested camera-chevron inset spacing, text-only reaction overflow menu
items, and further Voice/Memory/Advanced settings copy cleanup. These changes
preserve the existing actions and controls. A generated Library group-card
proposal was briefly applied, then fully reverted at the owner's request before
commit; the original group layout remains.

Validation: web TypeScript, scoped ESLint and Prettier checks passed; existing
camera and reaction loadout suites passed (4 tests). Independent three-file source
review found no actionable issues. Browser verification of this polish was not
completed because the in-app testing tabs became unavailable. No new tests were
added for copy/icon/spacing-only changes. Prior behavioral evidence remains valid.

## Camera controls relocation

Removed Camera from App Settings and moved its controls into Canvas settings.
The preset dropdown remains visible; Fine-tune camera starts collapsed and
reveals Reset, position, field of view, orbit target and bone bindings. Existing
main-scene/non-PiP availability guards and camera handlers remain. Removed the
obsolete app-wide camera panel provider. Bone selectors use native selects so
they do not depend on a portal outside the fullscreen element.

Validation: web TypeScript and scoped ESLint passed; focused camera tests passed
(3 tests). Independent source review found no actionable issues. Browser checks
confirmed collapsed-by-default disclosure, FOV edits selecting Custom, Reset
restoring Full body, Head binding selecting Custom and disabling manual camera Y,
and no Camera section in App Settings from Library. Fullscreen entry succeeded,
but interacting through the testing browser returned to normal view, so detailed
fullscreen interaction remains unverified. Library group layout remains unchanged.


## Dialog geometry and branding follow-up

Reset now shares the Camera Y Source label row, removing its empty toolbar row.
Identity editing and memory Versions opt into shared sidebar-aware dialog geometry
using the existing app-shell width resolver. Their width is capped to the remaining
viewport and they center beside the expanded or compact desktop sidebar. Other
dialogs retain their placement. Creator hub copy is removed, the subtitle reads
“Create characters, actions, and effects for your Animas.”, and the sidebar brand
reads Animama. Three generated logo concepts remain proposals; no new mark is installed.

Validation: TypeScript, scoped ESLint/Prettier and 31 focused tests across sidebar
geometry, camera, memory version/layout and creator entry-point suites passed.
Independent six-file review found no actionable issues. Browser screenshots at
1280px confirmed identity and Versions dialogs clear the expanded sidebar; the
identity dialog's left edge is 260px against the 242px sidebar. A narrow-viewport
Canvas screenshot confirmed Reset shares the Camera Y Source label row. No memory edits or
version reverts were performed. Production build and native acceptance were not
repeated for this focused layout/copy follow-up.


## Selected branding and preview follow-up

Owner selected the companion speech-bubble mark and rounded Animama wordmark
(option 1). Transparent generated assets now live in public/brand, with generation
prompts recorded in the frontend brand guide. The wordmark follows sidebar text
color through an alpha mask; the mark is reused in the compact sidebar and browser
favicon. Static and routed document titles both read Animama. Brand hover
backgrounds are removed; Search and Collapse are smaller and right-aligned to
avoid wordmark overlap.

Preview headers omit the revision/Anima/status subtitle. Expanded previews inset
only the panel beside the sidebar, preserving the retained Canvas and original
full-screen backdrop extent. Review BP1-1 identified a first-pass backdrop extent
regression; one repair restored it and targeted independent recheck passed. This
does not change pre-existing sidebar/backdrop stacking or claim stronger modality.

Validation: web TypeScript, scoped ESLint/Prettier and PNG decode/alpha inspection
passed. Browser checks verified light-theme expanded and compact branding, loaded
mark bytes, title and favicon reference. A final browser screenshot verified the
expanded Angry preview clears the expanded sidebar, has a title-only header,
and shows smaller non-overlapping sidebar actions. No new tests were added for branding or
copy-only changes. No packaged desktop icon change, production build or native
acceptance was performed.


## Compact brand and transition follow-up

Reduced the collapsed logo from size-8 to size-7, removed its separate backing
inside the circular control, and applied a one-pixel right/up optical correction.
The abrupt header change came from a 200ms delayed state swap while sidebar width
animated over 150ms. Removed that timer and the wordmark mount fade. Both header
layouts now remain mounted with state-driven 150ms opacity transitions; inactive
controls are inert and aria-hidden, and reduced-motion skips fading.

Web TypeScript, scoped ESLint/Prettier and independent review passed. Browser
checks confirmed compact appearance and expansion; a live transition observation
reported opacity 0.029 with a 0.15s transition before the expanded header settled.
No new tests or production build were added for this visual follow-up. SVG format
was assessed, but original approved PNGs are preserved pending faithful vector
tracing rather than embedding raster bytes in a nominal SVG file.
