# Consistent FX creator presentation

Source agreement: UI proposal accepted for implementation on 2026-09-22.
Spec authority: https://github.com/raymond-van/animama/issues/52.
Authorized scope: entire plan; implementation and PR handoff, no merge.

## Purpose and context

Particle, Avatar and Scene FX retain their authoring models while adopting the
Action creator header, panel density, collapse behavior and narrow tool tabs.
Shared presentation lives in `src/frontend/web/src/ui/content-creator`; each
route retains its specialized state and controls. Action editor components are
the visual reference, not a replacement domain model.

## Progress

- [x] Inspect rendered reference and all FX routes; record accepted proposal.
- [x] Verify assigned worktree, create task branch and publish issue #52.
- [x] Phase 1: implement shared presentation and integrate all FX routes.
- [x] Validate local stack, focused behavior, static checks and build.
- [x] Independent review and final integration review.
- [x] Implementation ready for PR handoff; publication is tracked in issue #52.
  Exact-candidate merge approval remains pending.

## Surprises & Discoveries

- FX names disappear below the medium breakpoint; narrow stacked forms can be
  covered by the absolute preview bar.
- Particle inspector minimum height exceeds available space on short desktops.
- Existing FX Library actions differ by route and navigate away from the editor.

## Decision Log

- 2026-09-22: Owner authorized the inspected proposal and a local development
  Compose stack. Reuse the supplied checkout at `0657c51`, branch
  `feat/fx-creator-polish`; use task stack `fx-polish`, base port 8420.
- Reuse shared presentation primitives without Action workspace state. Keep
  Particle's richer timeline and Avatar/Scene's compact transport.

## Phased implementation

### Phase 1: Unified FX workspace

Issue: #52. Starting source: `0657c51e211efa8bd16d1efca8dbefd878aacc74`.

1. Prepare pinned shared model inputs and isolated development Compose stack.
2. Align toolbar with Action groups, editable name/status, accessible icon labels
   and an in-editor typed Load picker. Preserve unsaved-change handling.
3. Add shared collapsible panel chrome and compact controls; align desktop edges.
4. Introduce narrow tool tabs with visible header/canvas and one editor area;
   preserve draft state and keep canvas settings and playback available.
5. Integrate route labels, panel headings, form spacing and Particle sizing.
6. Run behavior tests where interaction changes warrant them; use rendered
   browser checks for visual sizing/spacing instead of class-name assertions.
7. Run frontend types, lint, affected tests, formatting and build before push.
8. Independently review the phase and final integration. Commit, push and open PR.

Completion requires reachable controls, correct typed loading and retained
authoring/preview behavior on all three routes. Owner visual acceptance and
exact-candidate merge approval remain separate from agent verification.

#### Code Review #1 Findings

Reviewed the working-tree diff against `0657c51`, including new files.
FX-R1 (P2): Particle save/recovery notices and Avatar/Scene hydration notices
retained fixed offsets that intersected the new narrow two-row header.
Independent analysis found no other actionable issue. Checks reviewer passed
formatting/lint on all 16 changed/new TypeScript files, web types and 50 focused
creator/Action-header tests.

#### Code Review #1 Revisions

Accepted FX-R1: notices now follow the measured header height. Browser inspection
also reproduced Particle canvas children intercepting inspector clicks; restored
canvas stacking isolation and explicit panel stacking. The regression was observed
before the fix and desktop collapse clicks passed afterward. Final Particle
spacing puts Template in the shared header and keeps Remove compact.

Review #2 targeted these repairs and resulting regressions: no additional
findings; phase and final integration source review pass. One repair round used,
one remains. A failed-save/recovery browser check at 390px confirms the banner
clears the header and the name remains clickable.

## Final integration review

Completed with phase review for this single-phase scope. Shared presentation,
route integration, retained domain behavior and responsive access were reviewed.
No supported blockers remain. Native acceptance and owner visual approval are
separate; existing Save eligibility semantics are preserved.

## Validation and acceptance

From `src/frontend`: `pnpm check`, `pnpm web:lint`, `pnpm web:test`, `pnpm build`,
plus read-only formatting checks for changed files. Inspect live routes at desktop
1440/1280 widths and narrow 768/390 widths, including collapse/reopen, tool tabs,
load, rename, preview and disabled Save. Check shorter desktop height for clipping.
Use the task stack at `http://animama-fx-polish.localhost:8420`.

### Recorded results (2026-09-22)

- `pnpm --dir src/frontend check`: pass (web and desktop types).
- `pnpm --dir src/frontend web:lint`: pass; affected ESLint rerun after repairs passes.
- `pnpm --dir src/frontend web:test`: 238 files / 1314 tests passed; 17 cases in
  three server-listener suites were blocked by sandbox loopback restrictions.
  Rerunning `vitest run tests/browserRuntimeAssets.test.ts tests/local-api-proxy.test.ts
  tests/localParakeetModels.test.ts` with loopback access passed all 36 cases,
  covering every initially blocked case (1331 total unique cases covered).
- After repairs, `pnpm --dir src/frontend/web exec vitest run src/ui/content-creator
  src/ui/particle-vfx-creator src/ui/avatar-effect-creator src/ui/scene-effect-creator`:
  12 files / 42 tests pass. One intermediate run raced a package rebuild and had
  missing-package import failures; the sequential rerun passed.
- `pnpm --dir src/frontend build`: pass, including a post-repair build. Existing
  chunk-size warnings remain. Read-only Prettier check and `git diff --check`: pass.
- Rendered browser matrix: all three FX routes at 1440x900, 1280x720, 768x900 and
  390x844; editable name preserved, no document overflow, inspector and preview
  collapse/reopen, narrow tabs and Load search accessible. Headless Chromium used
  the existing SwiftShader launch settings; final run had no page errors.
- Manual Scene Save and typed Load round trip passed on the isolated stack.
- A deliberately failed browser-only Particle save request, followed by reload,
  verified recovery notice placement and clickable name at 390x844. Avatar/Scene
  hydration-notice placement is source-reviewed; a missing-item deep link did not
  reach their editor header and provides no rendered evidence for that notice.
- Visual sizing is validated in-browser rather than with CSS-class mirror tests.
  New unit tests cover typed load eligibility/navigation and toolbar accessibility.
- Stack `animama-fx-polish` is retained in development mode at
  `http://animama-fx-polish.localhost:8420`. Only web publishes a loopback port;
  backend and PostgreSQL remain private. Optional profiles are disabled. Shared
  pinned models and tracked LFS assets were verified/hydrated for starter readiness.
- No paid-provider, microphone/audio, native or release checks were run. Hosted CI
  evidence is recorded separately in the PR after push.

## Idempotence and recovery

Reuse the branch, issue and generated stack record. Do not recreate or purge
services or copy another task's Local content. Preserve unrelated work. If a
layout change regresses domain behavior, revert the scoped presentation change
and recheck. No backend schema, native or provider changes are planned.

## Outcomes & Retrospective

Delivered shared FX toolbar/name/load controls, collapsible panels and preview,
compact route forms, and a tabbed narrow layout that retains mounted authoring
state. Reused neutral panel chrome without adopting Action editor domain state.
No runtime schema or API contract changed, so additional operational documentation
was not needed. Keep the task worktree and live stack for owner review.
