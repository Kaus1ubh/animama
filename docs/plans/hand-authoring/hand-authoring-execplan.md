# Deliver the Gesture hand authoring helper

Source agreement: [Hand authoring specification](hand-authoring-spec.md), accepted
as the planning basis by the owner's 2026-09-23 request for an ExecPlan.
Authorized scope: All three phases and local development stack, authorized by
the owner on 2026-09-23 through implement. Parent spec: https://github.com/raymond-van/animama/issues/76.
Starting revision: `98220eae162651207960ffa9657aa54581a80265`.
Branch: retain `docs/hand-authoring-spec` in the assigned task worktree; one branch
and one PR for this plan. Parent #76; phases #77, #78 and #79. Phase 1 commit `f8906e7`; Phase 2 commit `343ce0f`; PR pending.

## Purpose and context

Enable Gesture authors to shape hands using presets and selected-bone relative
adjustments. The spec owns behavior and acceptance; this plan owns delivery.
Scope is the Gesture Pose tab, including a clip keyframe edited in that tab.
Do not add the helper to standalone Pose editing, Reactions or Clip playback.

Repository planning root is tracked `docs/plans/hand-authoring/`; no private
planning dependency or Cloud checkout is required. Commands below run from the
repository root unless a working directory is stated. Reuse the assigned checkout
and its current revision; do not reset it to a newer main or create another worktree.
Record its resolved path and stack URL in the implementation handoff, not public
machine-specific paths in this plan.

### Implementation orientation

Paths below are relative to `src/frontend/web/src/`:

| Area | Current entry point and significance |
| --- | --- |
| Gesture composition | `ui/gesture-editor/GestureEditorPage.tsx` delegates to the typed Action editor. |
| Layout and session | `ui/action-editor/ActionEditorWorkspace.tsx` owns desktop/mobile tools and enters inline-pose editing in Pose mode; returning to Clip commits that keyframe. |
| Typed primitives | `ui/action-editor/ActionEditorPrimitives.ts` re-exports shared pose controls. Preserve this boundary. |
| Bones UI | `ui/pose-creator/PoseCreatorBoneSection.tsx` owns the search/helper row, tree and single-bone inspector; it is shared with standalone Pose editing. |
| Bone math | `ui/pose-creator/poseCreatorAuthoring.ts` reads normalized bones, creates drafts, preserves inherited base quaternions/positions and serializes poses. |
| Existing edits | `ui/pose-creator/usePoseCreatorBoneRotation.ts` edits the selected bone and copies absolute rotations for its mirror option. Do not route helper target selection through it. |
| History | `stores/pose-creator-store.ts`, `ui/pose-creator/poseCreatorUndo.ts` and `usePoseCreatorUndoGrouping.ts` distinguish ordinary pose and inline-pose history. |
| Version boundary | `lib/avatar/poses/poseRetargeting.ts` converts canonical authored rotations for VRM 0 at runtime. Avoid double conversion. |

## Progress

- [x] Inspect spec, lifecycle guides, current authoring/history/layout interfaces and scripts.
- [x] Prepare phased plan and link accepted spec.
- [x] Owner authorized all phases; spec published/read back as #76 and phase issues created.
- [x] Phase 1: Atomic hand transformations and undo behavior; review #2 passed.
- [x] Phase 2: Compact accessible panel integrated; targeted review #2 passed.
- [ ] Phase 3: Calibrated Avatar behavior, persistence and final acceptance evidence.
- [x] Bounded final integration code review; two repair rounds completed.
- [ ] PR hosted checks and owner visual acceptance.

## Surprises & Discoveries

- Both bundled Avatar samples are VRM 1.x. An official pixiv VRM 0 sample was
  located, but browser upload permission was denied; no alternate import was
  attempted. VRM 0.x rendered calibration remains pending owner-authorized input.
- Single-bone mirror copies absolute rotations. Helper Both must instead adjust
  each hand from its own baseline and ignore that toggle.
- The store currently mutates one bone draft at a time. Multi-bone operations need
  a validated batch boundary to avoid partial state and repeated history work.
- `createBoneDraft` preserves the original inherited quaternion and position.
  The drag's starting rotation is a separate snapshot; conflating them breaks Inherit.
- Desktop layout starts at 1024 CSS pixels, but three adjacent tool panels may
  not fit there, especially with the app sidebar expanded. Use available width
  for Hands placement rather than assuming every desktop layout has room.
- Vitest uses a Node environment. Existing static render tests do not establish
  real pointer capture, focus, slider interaction or canvas appearance.

## Decision Log

- 2026-09-23, owner: accept mockup direction with reduced vertical space; individual
  segment selection, no selection shortcuts. Request spec, then execution plan.
- 2026-09-23, planning: preserve the existing branch/worktree and content schema;
  keep helper selection/visibility outside serialized pose and history snapshots.
- 2026-09-23, planning: use three phases below. Rotation calibration is evidence
  work, not permission to broaden into IK, wrist editing or an anatomy framework.

## Preparation once implementation is authorized

1. Recheck root/scoped agent guidance, HEAD, branch and dirty state. Preserve the
   spec/plan and any unrelated work. Follow workspace-setup to publish/read back
   the agreed spec and create a parent plus phase issues; record issue authority
   and snapshot revision in both artifacts. Do not rename the existing branch.
2. Inspect installed dependencies and existing stack source mounts. Use a stack
   only when rendered verification needs it; reuse one only if it serves this
   source and will not disrupt another task. If a task stack is needed, follow
   animama-local-stacks and model-input preparation, then record the actual URL.
3. Locate usable supported VRM 0.x and 1.x Avatar fixtures with hands. Verify
   availability/licensing before browser calibration. If a version lacks a real
   fixture, record the missing gate rather than replacing it with mock evidence.
4. Build local package prerequisites from `src/frontend` with `pnpm packages:build`.
   Use behavior-focused red/green tests for the changes below. No backend or
   generated-client changes are anticipated.

### Prepared environment — 2026-09-23

- Stack `animama-hand-authoring-6f31`, development/HMR, profiles none.
- Application: http://animama-hand-authoring-6f31.localhost:8280; only web exposes
  loopback port 8280, backend/PostgreSQL remain private.
- Both pinned model sets verified, LFS assets hydrated; 175 catalog items valid.
- Isolated onboarding completed as Hand authoring test; Gesture Pose page renders.
- Host `pnpm install --frozen-lockfile` and `pnpm packages:build` passed.
- Native, paid-model and anatomical visual acceptance not yet performed.

## Phased implementation

Each phase starts after its predecessor's required checks and bounded review pass,
within the owner's authorized phase range. Record actual starting SHA, issue,
commit, commands/results and remaining gates in that phase's evidence record.
Plan one full independent review per phase and at most two repair rounds; targeted
rechecks cover accepted fixes and regressions. Stop at supported blockers after
that limit. Review findings use stable IDs and record disposition, not just “fixed”.

### Phase 1 — Atomic hand transformations and history

Requirements: R2–R6 mechanics. Dependency: authorized preparation.
Scope: hand bone mapping, pure transform calculation, batch draft mutation and
interaction lifecycle. No new user-visible panel in this phase.

1. Add a focused hand-authoring module under `ui/pose-creator/` with typed side,
   digit/segment identities, availability resolution, preset definitions and
   relative curl/spread calculation. Enumerate the 15 segments per hand, including
   thumb metacarpal. Keep explicit per-digit eligibility and side mappings.
2. Calculate relative results from captured current quaternions, not repeated
   application to the preceding preview. Convert to the editor's canonical draft
   representation only at the mutation boundary. Preserve non-target transforms;
   do not blanket-clamp arbitrary loaded poses. Document rotation order, version
   basis and initial bounds as candidates for Phase 3 calibration.
3. Introduce a small batch draft update action in `pose-creator-store.ts` following
   existing dirty/history rules. Precompute and validate the entire eligible
   result before any preview/store mutation. Known unavailable bones are excluded
   with availability feedback; invalid results reject the operation unchanged.
   Commit one state transition and one Avatar update per batch, rather than looping
   through per-bone setters/updates. Preserve existing base quaternions, positions
   and no-op semantics, including position-bearing drafts at their base rotation.
4. Add a helper interaction controller/hook for start/update/end. Capture target
   and the existing poseSessionToken/clipSessionToken, Avatar identity and inline-edit
   identity; group all affected bones into one correct history
   entry, and invalidate snapshots on replacement, undo/redo and Avatar changes.
   Ignore stale updates and never close an unrelated replacement session's undo
   group. Closing/cancellation finalizes the latest valid preview;
   control recentering never writes a pose reset. Keep keyboard grouping bounded.
5. Test observable contracts: presets are idempotent; repeated identical drag
   samples do not drift; Both preserves asymmetry; mirror toggle cannot broaden
   targets; positions/expressions/wrists remain intact; missing/invalid bones cannot
   cause partial edits; history, dirty state, Inherit and stale-session behavior
   remain correct for ordinary and inline poses.

Validation from `src/frontend`: after `pnpm packages:build`, run
`pnpm --filter animama-web exec vitest run src/ui/pose-creator/poseCreatorHandAuthoring.test.ts src/stores/pose-creator-store.test.ts src/ui/pose-creator/poseCreatorAuthoring.test.ts src/ui/pose-creator/poseCreatorUndo.test.ts`.
The hand test file is new; add the actual interaction-controller test path to
this command when created. Run `pnpm web:check` after interface changes.

Completion: numerical/state contracts pass, no regression in inherited rotations
or inline history, and independent review passes. Numerical tests do not establish
anatomical visual correctness; that remains an explicit Phase 3 gate.

Evidence: Issue #77; starting SHA `98220ea`; commit `f8906e7`. Initial five-file
focused run: 74 tests passed (independently rerun). Implementer web TypeScript
and scoped ESLint passed. Pure transform and batch-store tests observed intended
red failures before implementation; controller tests include a return-to-zero
representation regression. Controller lifecycle repair completed below.

#### Code Review #1 Findings

HA-P1-01: Nested history cloned group identity and leaked the helper's owned depth.
HA-P1-02: Zero/return-to-zero removed explicit imported base-valued drafts.
Both accepted; initial independent focused checks passed 74 tests.

#### Code Review #1 Revisions

Repair 1: stable snapshot/kind ownership releases only the helper contribution;
history requests finish live edits before Undo/Redo. Original draft presence and
clean state survive zero/return-to-zero. Five regressions failed before fixes.
Final focused suite: 79 tests passed; web `tsc -b` and six-file scoped ESLint passed.
Targeted independent review #2 passed both findings without new regressions.
Repair rounds used: 1/2. Anatomy and UI remain later-phase gates.

### Phase 2 — Compact selectable hand panel

Requirements: R1–R5 UI and lifecycle. Dependency: Phase 1.
Scope: Gesture-only entry point, diagram, controls and adaptive layout.

1. Add a hand-toggle slot/optional prop to the shared Bones section, supplied
   only by the Gesture Pose workspace. The eye toggle remains independent.
   Own transient helper state at the workspace/session level so changing layout
   does not reset poses or leak controls into standalone Pose/Reaction routes.
2. Build a compact `PoseCreatorHandPanel` and plain SVG diagram. Use 15 distinct
   semantic bone targets with accessible names, keyboard toggling, visible focus
   and non-color selection cues. A side-neutral segment selection maps to left,
   right or both available bones. For partial Both availability, keep the segment
   operable for its available side and identify the missing counterpart.
3. Implement the accepted initial Left/empty selection, stable diagram, actual
   selected-bone count and per-side orientation. Add the three whole-hand preset
   buttons and relative Curl/Spread controls wired to Phase 1. Show eligibility,
   loading and error states; no shortcuts or Hands Apply.
4. Place Hands immediately after Bones when space permits; derive bounded sizing
   from the available stage, sidebar inset and right-side inspectors. Fall back
   to a single active tools panel when insufficient room remains, including
   intermediate desktop widths. Preserve one canvas and all draft state during
   resize. Closing returns focus to the toggle; collapsing Bones cannot strand Hands.
5. Test capability gating, independent toggles, per-segment labels/selection,
   disabled scope, no mutation on selection/visibility, preset scope and session
   reset. Use actual browser interaction for focus, pointer cancellation and
   recentering rather than relying only on server-rendered markup.

Validation from `src/frontend`: run new hand-panel/diagram tests plus
`pnpm --filter animama-web exec vitest run src/ui/pose-creator/PoseCreatorBoneSection.test.tsx src/ui/action-editor/ActionEditorWorkspace.test.tsx src/ui/action-editor/ActionEditorWorkspaceHistory.test.tsx src/ui/action-editor/ActionTimelineEditor.test.tsx`.
Run `pnpm web:check` and `pnpm web:lint` for the changed UI. Browser-check desktop
first at 1440×900, then 1280×800, 1024×768 and 390×844 CSS pixels. Include an
expanded/collapsed sidebar and Bones plus open single-bone/expression inspectors.
Record screenshots and observed focus/scroll behavior; the exact breakpoint may
change to meet these cases without redefining the accepted behavior.

Completion: complete panel workflow is usable and tested; independent review
passes. Capture a compactness comparison for Phase 3 owner review.

Evidence: Issue #78; starting SHA `f8906e7`; commit `343ce0f`. Independent six-file
focused suite passed 34 tests; web TypeScript and full web lint passed. Two panel
slot regressions and one layout regression were observed red before implementation.
After repair, panel/controller tests passed 18 tests and panel/workspace passed 15;
TypeScript and changed-file lint/format passed. Browser checks at 1440×900,
1280×800, 1024×768 and 390×844 covered adjacent/fallback placement, sidebar states,
individual click/keyboard selection, Both counts, no selection-only Undo entry,
keyboard adjustment/recentering, single-step Undo, close focus and responsive
selection preservation. Mobile scrolling reached both sliders and the live hint.
Pointer cancellation and anatomical acceptance remain Phase 3 checks.

#### Code Review #1 Findings

HA-P2-01: Mobile Hands lacked bounded scrolling, clipping controls.
HA-P2-02: Slider change could restart an interaction invalidated by Undo/session change.
Both accepted; independent read-only checks passed.

#### Code Review #1 Revisions

Repair 1: mobile Hands gets a bounded scroll wrapper; browser confirms reachable
controls at 390×844. Changes only update existing interactions; explicit pointer
or non-repeated key starts begin them. A real-handler/controller regression failed
before the fix and passed afterward for start/change → Undo → late change.
Targeted independent review #2 passed both fixes and their regression scope.
Repair rounds used: 1/2. Owner compactness acceptance remains pending.

### Phase 3 — Avatar calibration and durable pose acceptance

Requirements: all acceptance criteria, especially R3–R6. Dependency: Phase 2.
Scope: calibrate the implemented controls and prove editor/content integration.

1. On real supported VRM 0.x and 1.x Avatars, inspect all three presets for Left,
   Right and Both. Check curl/straighten on each segment class, thumb base movement,
   and spread on eligible bases. Verify no wrist movement, direction inversion,
   excessive thumb/finger intersection or discontinuous jumps. Record models by
   public-safe identity/version and observations; do not check private assets in.
2. Tune the explicit mapping, preset angles and delta bounds as needed; add
   regressions for discovered faults and rerun affected tests. Test arbitrary
   asymmetric non-preset rotations, mixed segment selections and repeated drags.
   Confirm the authoring/save/runtime version boundaries do not double-retarget.
3. Exercise a new pose and an existing loaded pose: open/close untouched; make a
   manual edit; adjust selected hand bones; undo/redo; save and reopen; export and
   import through existing content paths; insert into a Gesture and reopen/play.
   Verify untouched channels and identity/Included-copy behavior. Exercise an
   inline keyframe through Pose-to-Clip completion and existing cancellation.
4. Extend relevant existing persistence tests under `ui/action-editor/` and the
   store rather than building a second save path. Reuse
   `e2e/journeys/accountless-pose-content.spec.ts` and its helpers where useful;
   inspect runner/environment requirements before an automated journey. Manual
   browser evidence is still required for anatomy and compact layout.
5. Complete local pre-push checks from `src/frontend`: `pnpm check`,
   `pnpm web:lint`, `pnpm web:test`, `pnpm build`. Run root `make format-check`
   under the repository's normal prerequisites. Reuse unchanged passing checks;
   rerun affected checks after fixes. Do not run unrelated native packaging or
   backend suites unless the actual implementation crosses those boundaries.
6. Evaluate useful documentation updates under docs-sync; preserve current-state
   docs and put delivery evidence here. Publish the PR only after applicable local
   checks pass. Use the existing PR template and one compact source/baseline
   reference; record actual hosted Validation scope separately. An agent cannot
   approve a local receipt as the owner or treat reduced CI as full validation.

Completion: spec acceptance has evidence, independent phase/final review passes,
and the owner confirms compact layout and usable bone targets. Missing real-model
coverage or owner visual review remains pending; do not silently substitute tests
or generated mockups. Merge requires separate exact-candidate owner approval.

Evidence: Issue #79; starting SHA `343ce0f`; commit/PR pending. Three initial
persistence tests passed; browser save/reopen and pasted-JSON roundtrip preserved
all 20 authored channels exactly, with no helper keys. Opening/closing the saved
pose retained Saved status and empty Undo history. A Gesture copy exposed omitted
intentional identity rotations inheriting the clip base; two new regressions fail
before correction. Presets now retain explicit identity drafts. Static integration
analysis also found VRM 0 authoring using runtime-basis nodes directly while
playback retargets canonical rotations. Shared normalized read/write conversion
now keeps previews, Inherit and Undo consistent with canonical saved content.
Three VRM 0 regressions failed before correction; six version-basis tests pass. Initial complete local check: `pnpm check`
passed; `pnpm web:test` passed 279 files/1622 tests plus 7 script tests after
rerunning with loopback permissions (the sandbox run failed HTTP fixture binds).
Root `make format-check` passed 513 files. After the final repair, `pnpm check`,
`pnpm web:lint`, `pnpm web:test` (all tests) and `pnpm build` passed on the integrated
source. Build retains its existing large-chunk advisory. No native package, paid
model call or hosted CI result is implied by these local checks.

Documentation review: add one paragraph to the existing Avatar authoring guide
clarifying relative zero, preset scope, Both and ordinary persistence. No new
manual or architecture decision is needed.

#### Code Review #1 Findings

Initial combined Phase 3/integration review found HA-P3-01: relative straightening
still removed deliberate zero channels after the preset-only fix. Accepted.
After repair, the browser found HA-P3-02: existing inline editing retains store
mode `clip`, so the helper's pose-only editability check incorrectly disabled it.

#### Code Review #1 Revisions

Repair 1: actual relative edits retain explicit drafts; no-op/return-to-start keeps
original representation. Fist → selected −80° → export/insertion failed before
fix and passed afterward; 27 focused tests, TypeScript and scoped lint passed.
Targeted review #2 passed HA-P3-01.
Repair 2: hook and controller allow active inline editing while the store stays
in Clip mode; ordinary Clip playback remains excluded. The actual hydrated-clip
lifecycle and hook eligibility tests both failed before correction. Final focused
suite passed 22 tests; TypeScript, scoped ESLint and formatting passed. Independent
targeted review #3 passed. A fresh browser instance then verified Left Open ·
together in a reopened Gesture, Pose-to-Clip completion with explicit identity
finger rotations, one-step Undo restoring the previous fist, Redo and Save.
An older HMR session retained stale interaction closures; final verification used
a fresh page instance rather than treating that session as final-source evidence.
Repair rounds used: 2/2. Code analysis passes; anatomy/owner acceptance is pending.

## Final integration review

One independent combined review after Phase 3, at most two repair rounds. Review
spec coverage, atomic mutation/undo and stale-event handling, route isolation,
existing content paths, actual rendered evidence and outstanding acceptance gates.
Reuse still-valid phase results instead of repeating every check.

### Code Review #1 Findings

Combined with Phase 3 review to reuse phase evidence. HA-P3-01 and HA-P3-02 are
the supported integration defects; no other concrete issue was found. Acceptance
remains incomplete while real-model anatomy and owner visual gates are pending.

### Code Review #1 Revisions

Repair history is recorded above; combined repair budget 2/2. Final targeted
review #3 passes code analysis. Fresh-browser inline confirmation passes. Overall
acceptance remains incomplete until real-model anatomy and owner layout review.

## Validation and acceptance

Use spec requirement IDs in evidence records. Record the tested SHA, environment,
command/result, viewport or Avatar version where relevant, and limitations. The
spec remains the acceptance checklist; do not mark an unchecked outcome complete
based solely on a phase commit. No application tests, stack startup or visual
validation were performed during plan authoring.

Outstanding gates: comprehensive real VRM 0.x/1.x anatomical verification and
actual pointer-cancellation browser coverage; owner compact-layout acceptance;
actual hosted CI; exact-candidate merge approval. Bundled VRM 1.x rendering and
preset smoke checks are not full per-joint calibration. VRM 0 import was denied.
Applicable local checks and bounded independent code review have passed.
No unresolved product decision blocks the proposed phases. Calibration details
are bounded implementation work; inability to meet the spec must be surfaced.

## Idempotence and recovery

- Presets are absolute and repeatable; relative interactions derive each preview
  from a stable capture. Invalid batches leave store and Avatar unchanged.
- End history groups on close/cancel; reject events from old poses/sessions.
  Selection/recentering never resets authored rotations. Undo restores the full
  multi-bone operation, including positions/inherited behavior where applicable.
- Save failures preserve existing content and retryable drafts using current
  mutation handling. No schema migration, database reset or data purge is needed.
- To back out implementation, revert task-owned phase commits in reverse order
  while preserving unrelated work. Saved hand rotations remain ordinary poses.
  Do not tear down another task's stack or remove shared models/volumes.

## Outcomes & Retrospective

Phases 1 and 2 are implemented and reviewed. Phase 3 added durable explicit-zero
rotations and a shared canonical/runtime quaternion boundary; remaining final
verification and real-model/owner acceptance are recorded above. Tests caught
history/representation defects, and browser checks caught responsive scrolling,
clip insertion and inline-edit integration issues missed by static render tests.
The task stack and workspace remain available for owner acceptance; no merge or
cleanup has been authorized.
