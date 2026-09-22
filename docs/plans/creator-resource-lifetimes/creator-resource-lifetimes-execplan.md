# Release creator gizmos and temporary runtime URLs

Source agreement: issue [#41](https://github.com/raymond-van/animama/issues/41), read back at 2026-09-22T00:09:03Z.
Authorized scope: the complete bounded repair, local verification, independent review, and a separate PR. Merge approval remains separate.

## Purpose and context

Repeated creator navigation retains model Blob URLs. TransformControls also registers document listeners during render and never disposes them, leaving controls and sometimes renderer resources reachable after unmount. Correct both lifetimes without changing loading, authoring, interaction, or persisted formats.

The starting source is `de29b1810617aef34a8c33ffc0e60d2b657a3528`, the merge of PR #40. Primary main has been fast-forwarded to that revision. Branch `fix/creator-resource-lifetimes` uses an isolated worktree so pending UI edits remain untouched. The issue owns scope and acceptance; this plan records execution.

Relevant boundaries are the four real TransformControls consumers and `web/src/lib/runtime-content/runtimeContentDelivery.ts` and its callers. The installed Drei wrapper constructs connected controls in `useMemo` and only detaches on cleanup. Runtime download URL creation returns an ambiguous bare string.

## Progress

- [x] Confirm merged baseline, fast-forward primary main, preserve occupied checkout, and publish issue #41.
- [ ] Phase 1: repair lifetimes with regression coverage and desktop browser evidence.
- [ ] Independent review, phase commit, final integration review, and PR.

## Surprises & Discoveries

- Investigation reproduced controls increasing 0 → 2 → 4 → 6 and one unreleased model Blob URL per creator entry. It did not reproduce every component of the long-lived tab's multi-GB footprint.
- `ParticleVFXCreatorPage` contains an unrelated HTML form named TransformControls; the actual Drei wrapper has four consumers.
- Removing a control mid-drag must restore the previous OrbitControls enabled state. The regression also covers an already-disabled orbit control.
- The isolated browser stack could not start while the local Docker engine was unresponsive. Existing application requests also timed out; no browser acceptance is claimed yet.

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

Overall acceptance remains incomplete because real desktop browser resource measurements and interactions are still required. This is not a claim that the original multi-GB footprint is fully resolved.

### Code Review #1 Revisions

No source repairs requested. Repair rounds used: 0 of 2. Browser acceptance is an outstanding gate, not a rejected finding or a waived check.

## Final integration review

The combined one-phase source review found no integration blockers and reuses the passing static/build/test evidence. Final acceptance still requires helper off/on, creator route cycles, gizmo editing with Undo, and URL/listener counts returning to baseline after cancellation/unmount on the changed source. Keep the PR draft until this gate is met; the issue remains open.

## Validation and acceptance

Run from `src/frontend`: focused web tests, `pnpm check`, `pnpm web:lint`, formatting checks, and `pnpm build`. Browser evidence uses changed source and real avatar loading; listener/URL instrumentation stores metadata only. Record exact commands/results here.

Current working-tree candidate against the starting revision:

- Gizmo regression: four tests failed with the original Drei wrapper (render-time listener registration, mount/effect-replay retention, and orbit restoration), then all four passed with the owned wrapper. The harness exercises real three-stdlib controls and DOM event targets while controlling React effect setup/cleanup; it is not a substitute for browser acceptance.
- Blob regression: successful real VRMA decoding failed to revoke its owned URL, and cancellation during body decoding still created a late URL. Both are fixed. The focused three-file suite passes 35 tests, including decoder failure and catalog disposal.
- `pnpm exec vitest run src/ui/avatar-preview src/lib/runtime-content src/lib/avatar/AvatarVrmaCompatibility.test.ts src/ui/pose-creator src/ui/content-preview src/ui/content-creator src/ui/animas src/ui/main/canvas` from `src/frontend/web`: 189 tests in 41 files passed. An initial run overlapped package generation and failed to resolve regenerated chunks; the serialized rerun passed.
- `pnpm check`: passed web and desktop TypeScript checks, including dependent package builds.
- `pnpm web:lint`: passed.
- `pnpm build` with the verified model store: passed package builds, route generation, TypeScript, and the production Vite build. Existing large-chunk advisory only.
- Explicit Prettier checks passed every changed/new source file, `web/package.json`, and this plan. The generated pnpm lockfile has an existing formatting exception, reproduced on the unchanged baseline; the change adds only its three-line dependency declaration.
- `git diff --check`: passed.
- Desktop browser memory/interaction checks: pending local environment recovery. Hosted CI: not run; no candidate pushed yet.

Local verification, hosted CI, and native acceptance are separate. Native installer, audio, full production-memory attribution, and unrequested leak fixes are outside this repair.

## Idempotence and recovery

Temporary URL release must be idempotent. Abort during download/body decoding must not publish an unowned late URL. Control cleanup must tolerate repeated effect setup/cleanup and restore surrounding camera controls. On failure, stop only task-owned services and retain evidence; do not reset the occupied checkout or purge shared data. Revert a scoped change rather than disabling lifecycle checks.

## Outcomes & Retrospective

Implementation and validation pending.
