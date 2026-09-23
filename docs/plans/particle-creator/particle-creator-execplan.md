# Particle creator scope and independent anchors

Source agreement: owner implementation request dated 2026-09-23. Authorized scope: all work below; merge remains owner-gated. Authoritative issue: https://github.com/raymond-van/animama/issues/67 (read back 2026-09-23T17:19:20Z).

## Purpose and context

Extend the existing creator-polish branch and PR #66, preserving #65. Starting revision: e8804e5307ae91bc07d6fd02ba98546cae08a946; repository baseline a5a7ba05fc8b72f7821b8afb707df3a8852a8b6b. Reuse the task worktree and development stack at http://animama-vfx-bcbb.localhost:8260.

The particle creator currently mixes catalog metadata and emitter settings. The controller places one quarks object at one anchor, and avatar rectangle fitting moves that entire object to avatar bounds center. The new contract needs independent emitter placement through the same runtime used by pose and reaction event sinks.

## Progress

- [x] Integrated phase 1: implemented, independently reviewed, locally validated; owner merge approval remains pending.

## Surprises & Discoveries

- Rectangle fit currently replaces whole-effect anchor placement and disables follow for the entire instance.
- Particle package validation required descriptions; the save boundary now accepts blank descriptions and preserves existing text.
- Browser save/reopen exposed discarded whole-effect defaults and empty normalized maximum-size objects. A shared runtime-config parser and package regressions cover both repairs.
- A separate preexisting event-only clip bug permits no pose keyframes in the schema but samples keyframes[0].time. An ordinary pose keyframe allowed Gesture playback verification; that separate sampling defect remains unchanged.

## Decision Log

- 2026-09-23: Keep existing task branch and PR, as requested; no unrelated edits present at start.
- Store optional emitter anchoring in each serialized ParticleEmitter's userData.animamaParticleAnchor. Absence means inherit the resolved effect/event anchor. Validate supported values and preserve other userData.
- Fit emission width/height only; do not recenter roots or unrelated emitters. Default and overridden anchors continue following according to the existing follow/world-space contract.

## Phased implementation

### Phase 1: consistent authoring and playback

Issue: #67. Starting source: e8804e5. No implementation dependencies beyond the existing creator polish.

1. Add backward-compatible optional emitter anchor serialization and validation; preserve descriptions and permit omission for new effects. Test import/edit/export/package/reopen boundaries.
2. Resolve each override in shared runtime placement used by creator preview and live controller; preserve inherited hierarchy, transforms, bounds exclusions, budgets, world-space behavior and lifecycle cleanup. Fit only matching rectangle shapes.
3. Reorganize left settings, export/status, contextual fit selector, and Inspector groups/labels/conditional controls without removing authoring capabilities. Keep header naming and blue Save.
4. Run behavior-focused tests, web types/lint/build/format checks, desktop browser authoring/save/reopen and mixed-shape/multiple-anchor checks, then narrow layouts. Exercise Gesture/Reaction event playback and stop cleanup; distinguish automated integration from visible browser acceptance.
5. Delegate one full independent analysis and read-only validation review; at most two repair rounds, followed by final integration assessment reusing valid evidence. Commit verified phase changes and update PR #66.

Completion: accepted implementation requirements and applicable checks pass, review findings resolved, and remaining manual/native/provider limitations disclosed. No provider or native release gate is implied by this browser/runtime change.

#### Code Review #1 Findings

Independent analysis against e8804e5 found R67-1 (P2): the outline followed anchors while paused and ignored other world-space emitters, diverging from actual preview placement. No other concrete findings. Independent checks ran 163 tests in 15 files and checked formatting for all 20 changed/new frontend TypeScript files.

#### Code Review #1 Revisions

Accepted R67-1: the outline now uses the selected runtime emitter's matrix and fitted rectangle dimensions, including nested/wrapped roots. Targeted review #2 passed, also covering the browser-discovered hydration repair and shared runtime parser. One repair round used; no unresolved review findings.

Phase commit subject: `feat(particle-vfx)[p1]: refine authoring and add emitter anchors`. The exact candidate is recorded in PR #66.

## Final integration review

Independent final integration assessment passed for editor/serialization/preview/controller and Gesture/Reaction sinks after the targeted repair. Final local checks and browser evidence below passed; native/provider acceptance is not claimed.

## Validation and acceptance

All commands ran in the retained task web container from `src/frontend` (`/app`), using its installed pnpm:

- `pnpm --dir web check:source`, `pnpm web:lint`, `pnpm build`: passed. Build retains the existing large-chunk warning.
- `pnpm --dir web exec vitest run tests/avatar/particleVfx.test.ts tests/avatar/particleVfxEditor.test.ts tests/avatar/particleClipPlayback.test.ts tests/avatar/poseCreatorParticleVfx.test.ts tests/avatar/reactionClips.test.ts tests/avatar/clipVfxGate.test.ts src/lib/avatar/particle-vfx src/lib/content/particleVFXContentPackage.test.ts src/lib/runtime-content/AnimaRuntimeMediaCatalog.test.ts src/ui/particle-vfx-creator src/hooks/useContentEditorSaveSource.test.tsx`: 15 files, 163 tests passed.
- Read-only changed-source Prettier and `git diff --check`: passed.
- Serialization tests failed before the override/description changes and passed afterward. The browser-discovered unlimited-fit package test likewise failed before the normalization repair and passed afterward.
- Integration tests use actual Gesture/Reaction players, Avatar event sinks, controller and Quarks systems; skeletal fixtures move head/hand/chest independently. They verify stop disposal and no resurrection after pending load cancellation.
- Desktop browser (1280×720): blank-description mixed sphere/rectangle effect saved/reopened; head/leftHand overrides and fitting/duration preserved; export dialog and scoped panels inspected. Creator preview rendered anchored particles. A Gesture with a pose keyframe played the saved effect; DOM observation showed active particles and then an empty particle set on Stop.
- Narrow browser: 768×900 and 390×844 panels/Inspector/anchor menu inspected; responsive tabs, scrollable controls and header actions remained usable. Restored the default viewport.
- Not verified: rendered moving-VRM anchor tracking or Reaction playback in the browser, native Electron, audio/provider behavior, and hosted CI. Animated multi-anchor and both event lifecycle paths have automated integration evidence only. No backend source/schema changed, so backend suites were not run.

Local test effects and Gesture data remain in the task stack. The Gesture draft with its added pose is retained in the browser for continued investigation; the initially saved event-only fixture demonstrates the preexisting zero-keyframe defect.

## Idempotence and recovery

No data migration, schema revision, reset or purge. Existing missing anchor metadata inherits unchanged. Retain Local test entries and stack for continued development. Revert only this phase's edits if required; preserve earlier creator-polish commits. Keep limits and exact dependency source ownership intact.

## Outcomes & Retrospective

Delivered the requested panel cleanup, inherited/overridden emitter anchors through saved packages and live playback, dimensions-only rectangle fitting, and preserved whole-effect defaults on reopen. Existing creator-polish commits and task stack remain intact. Broader timeline consolidation and the separate zero-keyframe clip bug are outside this phase. Exact-candidate merge requires owner approval.

## Phase 2: event-only playback and compact creator status

Authorized follow-up: [issue #68](https://github.com/raymond-van/animama/issues/68), read back 2026-09-23T18:15:36Z. Starting revision: a690edd. Reuse the existing branch, PR #66 and development stack. Phase 1 remains complete; this phase now owns the previously deferred zero-keyframe bug.

1. Reproduce empty pose-track sampling and VFX lifecycle failures with focused regressions across particle, Avatar and Scene events. Repair shared sampling and pose ownership without changing normal pose-bearing clips or the creator's preview base.
2. Reuse a compact actionable validation indicator across Gesture/Reaction and FX headers. Remove particle Whole-effect wording and Ready to save section, and Avatar Checks tab/healthy rows. Keep blocking save validation and actionable preview diagnostics.
3. Make particle Appearance first/default, rename Emitter to Position, and move the selected emitter name into the Inspector header.
4. Verify focused runtime/component tests, web types/lint/build and changed-file formatting; inspect desktop then narrow browser layouts and event-only playback/cleanup. Record limitations separately from automated evidence.
5. Independent read-only checks and analysis, at most two repair rounds for this new scope, then final integration assessment reusing Phase 1 evidence. Commit as phase 2 and update the same PR. Merge remains owner-gated.

Progress: phase 2 implementation, browser verification, independent review and final checks complete. Owner merge approval remains pending. No schema migration, service reset or data purge required. UI-only label/reordering changes use browser checks; the shared validation interaction and runtime behavior receive regression tests.

### Phase 2 review

Code Review #1 Findings: R68-1 (P2) found that the public Avatar playback wrapper still replaced the pose base despite PoseController's event-only guard. R68-2 (P2) found that compact particle diagnostics lost their emitter targets and merged identical messages.

Code Review #1 Revisions: accepted both. Public Avatar playback now acquires body ownership only for pose-bearing clips, with public-boundary and actual Quarks regressions. Header diagnostics retain emitter names or field targets. Targeted review #2 cleared R68-2 and identified a remaining R68-1 return-to-rest transition branch; repair round 2 fixed that specific case, including finishing a return-to-rest transition without clearing the event clock. Final targeted review #3 passed; both findings are resolved. Two repair rounds used, no remaining findings. Combined integration review reuses completed Phase 1 evidence.

### Phase 2 browser evidence

- Desktop 1280×800: particle Appearance opens first, Position replaces Emitter, and the emitter name is editable in the Inspector header. Settings/Transform omit Whole-effect. Lowering the test particle budget exposed header issues; clicking opened actionable messages. Restored the original budget/name afterward.
- Avatar FX: Checks tab removed, missing-image validation available from the header with Save disabled, no healthy check rows. The warning popover and particle Inspector fit at 390×844.
- Removed the test Gesture's workaround pose keyframe. Particle, Avatar and Scene events all played with zero resolved bones and empty diagnostics. Natural completion and explicit Stop both yielded empty effect sets.
- Saved and reopened the three-event Gesture; it retained no pose keyframes and all events played. Library preview also fired all three events through public Avatar playback, then Stop cleared all three effect lanes without the previous sampler exception.
- Test fixture Anchor gesture test now contains the saved event-only three-FX clip. No Anima loadout changed. Native Electron, live chat/provider invocation and visual motion fidelity remain unverified; runtime regression tests cover pose/animation ownership and Reaction event lifecycle.

### Phase 2 verification and handoff

Regressions failed before the sampler, creator validator, pose ownership and public Avatar/rest-transition repairs, then passed. The shared toolbar regression also failed before header validation was added. Independent checks after the repairs passed 125 tests across 22 files, web lint, web source types and read-only Prettier for all 16 changed/new frontend files. The production build passed with the existing large-chunk warning. Git diff checks passed. The final candidate appears in PR #66.

Phase commit subject: `fix(vfx)[p2]: preview event-only gestures and simplify creator status`. Existing creator polish is preserved. No new infrastructure or backend changes. The development stack remains at http://animama-vfx-bcbb.localhost:8260 for continued work; ordinary merge requires owner approval of the final candidate.
