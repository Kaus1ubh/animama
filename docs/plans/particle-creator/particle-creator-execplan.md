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
