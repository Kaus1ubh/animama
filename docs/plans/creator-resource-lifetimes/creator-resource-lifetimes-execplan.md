# Release creator resources and unmounted Fast Refresh roots

Source agreement: issue [#41](https://github.com/raymond-van/animama/issues/41), read back at 2026-09-22T00:09:03Z.
Authorized scope: the complete bounded repair, local verification, independent review, and a separate PR. Merge approval remains separate.

2026-09-22 follow-up: the owner authorized the confirmed development Fast Refresh root retention repair, tracked by [#45](https://github.com/raymond-van/animama/issues/45), as Phase 2 in the same branch and PR. Issue #45 was read back at 2026-09-22T14:34:01Z. The prior phase's browser gates remain required.

## Purpose and context

Repeated creator navigation retains model Blob URLs. TransformControls also registers document listeners during render and never disposes them, leaving controls and sometimes renderer resources reachable after unmount. Correct both lifetimes without changing loading, authoring, interaction, or persisted formats.

The starting source is `de29b1810617aef34a8c33ffc0e60d2b657a3528`, the merge of PR #40. Primary main has been fast-forwarded to that revision. Branch `fix/creator-resource-lifetimes` uses an isolated worktree so pending UI edits remain untouched. The issue owns scope and acceptance; this plan records execution.

Relevant boundaries are the four real TransformControls consumers and `web/src/lib/runtime-content/runtimeContentDelivery.ts` and its callers. The installed Drei wrapper constructs connected controls in `useMemo` and only detaches on cleanup. Runtime download URL creation returns an ambiguous bare string.

## Progress

- [x] Confirm merged baseline, fast-forward primary main, preserve occupied checkout, and publish issue #41.
- [x] Implement both lifetime repairs, add regression coverage, and pass affected tests, typechecks, lint, formatting, and build.
- [x] Phase 1: repair lifetimes with regression coverage and desktop browser evidence.
- [x] Complete independent source review, commit the repair, and open draft [PR #44](https://github.com/raymond-van/animama/pull/44).
- [x] Complete desktop browser acceptance and final integration sign-off before marking the PR ready.
- [x] Phase 2: release already-unmounted Fast Refresh roots, preserve refresh/error recovery, and verify installed dependencies and browser resource counts.

## Surprises & Discoveries

- Investigation reproduced controls increasing 0 → 2 → 4 → 6 and one unreleased model Blob URL per creator entry. It did not reproduce every component of the long-lived tab's multi-GB footprint.
- `ParticleVFXCreatorPage` contains an unrelated HTML form named TransformControls; the actual Drei wrapper has four consumers.
- Removing a control mid-drag must restore the previous OrbitControls enabled state. The regression also covers an already-disabled orbit control.
- Initial browser acceptance was blocked by an unresponsive Docker engine. It subsequently recovered; the isolated development stack now serves changed source at http://localhost:8340. No shared engine restart was needed.

## Decision Log

- 2026-09-22: Start from merged main with a separate issue/PR, preserving the prior checkout and stack.
- 2026-09-22: Limit scope to gizmo lifecycle and temporary URL ownership. React timing, bitmap disposal, and other caches remain outside scope.
- 2026-09-22: Keep construction free of DOM listeners and pair connection with cleanup. Use explicit owned/borrowed URL semantics rather than URL-prefix heuristics.
- 2026-09-22: Declare the existing locked `three-stdlib` 2.36.1 as a direct dependency to reuse its exact control implementation without copying it or upgrading packages. The resolved package graph gains no new package/version.

## Phase 1: Make resource ownership explicit

Issue: #41. Starting revision: `de29b1810617aef34a8c33ffc0e60d2b657a3528`. No outstanding product decision blocks implementation.

1. Reproduce control listener retention in a focused test. Implement a shared wrapper using the installed implementation, effect-managed connection/disposal, and existing attachment/callback/ref behavior. Migrate four consumers.
2. Reproduce temporary URL retention and cancellation races. Introduce an explicit URL release contract and migrate all runtime-download consumers according to their useful lifetime. Borrowed URLs must not be revoked.
3. Run affected tests, frontend/desktop typechecks, web lint, formatting checks, and a web build. Add no package upgrades or backend changes. Independent Blob work proceeds alongside the gizmo repair; coordinate shared-file import changes.
4. In desktop Chrome on the changed source, measure creator navigation and helpers on/off. Confirm controls/listeners and model URLs return to baseline and gizmo manipulation still updates the pose. Preserve the original diagnostic tab and user data. Start an isolated stack only if required to serve the changed source.
5. Complete bounded independent review and supported repairs, then commit and open the separate PR with local evidence and actual hosted CI reported separately.

Completion requires issue acceptance, no supported blocking findings, and disclosure of environment limits. No claim is made that these repairs eliminate all native memory growth.

### Code Review #1 Findings

Independent source review of the combined working-tree diff against the starting revision found no actionable source findings. It covered the new control wrapper and tests, all four consumers, the lease helper and tests, all six download consumers, and catalog/VRMA release paths. Construction, cleanup, callbacks, refs, OrbitControls restoration, borrowed ownership, idempotence, and cancellation were checked. Independent read-only validation confirmed build/format/diff checks and reused the passing tests/typecheck/lint evidence below.

The initially outstanding desktop browser gate is now covered by the Phase 2 validation below. This is not a claim that the original multi-GB footprint is fully resolved.

### Code Review #1 Revisions

No source repairs requested. Repair rounds used: 0 of 2. The browser gate was preserved and completed after the stack recovered.

## Final integration review

Both phases reuse the passing Phase 1 application tests and independent source review. The browser gate is complete: helper off/on, creator navigation, gizmo editing with Undo, and temporary URL/listener cleanup were exercised on changed source. Final independent integration review passed with no remaining scoped blockers, reusing prior source reviews and checks plus the completed browser evidence. Repair rounds used: 0 of 2. Owner merge approval remains separate.

## Phase 2: Release development Fast Refresh roots

Issue: #45. Starting revision: `1634e58491f762299aad5758b87a873d92b4acb5`. The existing named development stack is now healthy. Reuse the task checkout and stack; preserve the user's diagnostic tab.

The installed Vite React plugin adds every committed root to its helper Map. React Three Fiber emits a second empty commit after unmount; the runtime re-adds that root without deleting it. Post-GC snapshots retain one renderer and 26 decoded avatar bitmaps per ordinary navigation cycle. A test-tab guard stops the repeated accumulation. This is development instrumentation; no production-runtime change is intended.

1. Add a deterministic test against the installed refresh runtime reproducing the duplicate empty commit. Cover active-root refresh, retryable failed roots, and forwarding every decorated DevTools callback.
2. Apply a version-specific pnpm patch to the runtime's empty-root bookkeeping. Keep failed-root recovery and normal hot reload; do not suppress the global hook. Include patch files in frozen installs and Docker build inputs.
3. Run the regression red/green, frozen install, relevant test suites, frontend/desktop typechecks, lint, changed-file formatting, and production build. Verify development serves the patch and production assets exclude Fast Refresh.
4. In a fresh desktop browser tab on changed source, repeat sidebar/avatar and creator navigation, collect post-GC snapshots, verify no per-cycle renderer/bitmap growth, exercise hot refresh, and complete remaining Phase 1 gizmo/URL acceptance.
5. Run bounded independent Phase 2 source/checks review (one initial review, at most two repair rounds), then final integration review using still-valid Phase 1 evidence. Commit and update PR #44 with separate local/browser/hosted results.

### Phase 2 review and revisions

Independent source review found no actionable findings in the installed-runtime patch, error recovery, callback forwarding, frozen lockfile, Docker inputs, regression tests, and documentation. Independent checks passed. Repair rounds used: 0 of 2.

### Phase 2 validation

- Installed-runtime regression: original runtime failed the duplicate-empty-commit test (3 passed, 1 failed); patched runtime passes all 4 tests, including active refresh, failed-root retry, and DevTools forwarding. Command: `node --experimental-vm-modules --test web/scripts/fast-refresh-lifecycle.test.mjs` from `src/frontend`.
- `pnpm check`, `pnpm web:lint`, explicit changed-file Prettier checks, and `git diff --check`: passed. The earlier 189 application regressions remain valid because Phase 2 changes development dependency bookkeeping only.
- `pnpm --store-dir /Users/ray/Library/pnpm/store install --frozen-lockfile --offline`: passed. `ANIMAMA_MODEL_ROOT=/Users/ray/Library/Caches/Animama/models pnpm build`: passed with the existing chunk-size advisory. Production assets contain neither `helpersByRoot` nor `registerBeforePerformReactRefresh`.
- Docker `web-builder` target with verified browser model build context: passed, including frozen Linux dependency installation with the patch. Validation image digest: `sha256:daa1c3dc124249d19ca69f202c750d0745612ce87b459068d6f350947adf338f`.
- Desktop Chrome, real avatar, development stack at http://localhost:8340: the served refresh runtime contains the patch. Post-GC snapshots after 1 and 7 New Chat → Library cycles both contain 1 WebGLRenderer, 20 MToonMaterial objects, and 26 native ImageBitmaps. Unpatched evidence grew from 1 to 4 renderers and 26 to 104 bitmaps across 4 cycles.
- After visiting Gesture and Reaction creators, snapshots before and after four additional creator visits both contain 2 renderers and 52 native bitmaps. These bounded retained resources are not claimed as eliminated. All 378 traced temporary URLs were revoked; no document pointer listeners remained on the Create page.
- Three helper off/on cycles produced document pointer-listener counts 0, 1, 0, 1, 0, 1; creator unmount returned to 0. A synthetic browser pointer drag through the real canvas gizmo changed the selected arm's Z rotation from -73.4 to -44.4 degrees; Undo restored -73.4. The gizmo was also visually confirmed.
- A temporary Library heading edit appeared via HMR and restored without changing `performance.timeOrigin` or losing the observation probe. The temporary source edit was fully restored.

React timing accumulation, FX image caching, bitmap ownership, and full process-memory attribution remain separate from this follow-up. No claim is made about the total Chrome process footprint or packaged desktop acceptance.

## Validation and acceptance

Run from `src/frontend`: focused web tests, `pnpm check`, `pnpm web:lint`, formatting checks, and `pnpm build`. Browser evidence uses changed source and real avatar loading; listener/URL instrumentation stores metadata only. Record exact commands/results here.

Implementation revision `d3e688a5f256fa5fb8f97b1c914268b960e56788` against the starting revision:

- Gizmo regression: four tests failed with the original Drei wrapper (render-time listener registration, mount/effect-replay retention, and orbit restoration), then all four passed with the owned wrapper. The harness exercises real three-stdlib controls and DOM event targets while controlling React effect setup/cleanup; it is not a substitute for browser acceptance.
- Blob regression: successful real VRMA decoding failed to revoke its owned URL, and cancellation during body decoding still created a late URL. Both are fixed. The focused three-file suite passes 35 tests, including decoder failure and catalog disposal.
- `pnpm exec vitest run src/ui/avatar-preview src/lib/runtime-content src/lib/avatar/AvatarVrmaCompatibility.test.ts src/ui/pose-creator src/ui/content-preview src/ui/content-creator src/ui/animas src/ui/main/canvas` from `src/frontend/web`: 189 tests in 41 files passed. An initial run overlapped package generation and failed to resolve regenerated chunks; the serialized rerun passed.
- `pnpm check`: passed web and desktop TypeScript checks, including dependent package builds.
- `pnpm web:lint`: passed.
- `pnpm build` with the verified model store: passed package builds, route generation, TypeScript, and the production Vite build. Existing large-chunk advisory only.
- Explicit Prettier checks passed every changed/new source file, `web/package.json`, and this plan. The generated pnpm lockfile has an existing formatting exception, reproduced on the unchanged baseline; the change adds only its three-line dependency declaration.
- `git diff --check`: passed.
- Desktop browser memory/interaction checks: completed in Phase 2 above. Hosted CI is reported separately in the PR; local checks are not a hosted pass.

Local verification, hosted CI, and native acceptance are separate. Native installer, audio, full production-memory attribution, and unrequested leak fixes are outside this repair.

## Idempotence and recovery

Temporary URL release must be idempotent. Abort during download/body decoding must not publish an unowned late URL. Control cleanup must tolerate repeated effect setup/cleanup and restore surrounding camera controls. On failure, stop only task-owned services and retain evidence; do not reset the occupied checkout or purge shared data. Revert a scoped change rather than disabling lifecycle checks.

## Outcomes & Retrospective

The gizmo and URL ownership repairs and development Fast Refresh follow-up are implemented, independently source-reviewed, and browser-validated. Repeated navigation no longer accumulates one renderer and avatar bitmap set per cycle in the measured scenario. The task-owned development stack remains available at http://localhost:8340. This repair does not establish that every contributor to the original multi-GB footprint is resolved; merge still requires owner approval.
