# Contextual Avatar VFX guides and Scene guide removal

Source agreement: the 2026-09-24 task discussion and subsequent request for this
ExecPlan. The owner selected contextual Avatar VFX guides and removal of Scene
VFX guides; Particle VFX controls remain unchanged.

Authorization: the owner invoked `implement` on 2026-09-24, authorizing both
phases. The existing instruction to withhold a PR remains in
force; do not push or open a PR as an automatic plan-completion step.

Spec authority: https://github.com/raymond-van/animama/issues/88, read back at
2026-09-24T17:01:32Z. Phase 2 is tracked by issue #89. The earlier preview/catalog
bug issue #75 is a separate outcome.

## Purpose and context

Avatar Guides currently draws a viewport-centered crosshair unrelated to the
model or effect. Replace it with useful placement information derived from the
same landmarks and resolved placements used for playback. Authors should be able
to see where an effect starts, where their transforms put it, and which side or
material receives it. Remove the Scene Guides switch and its visuals while
preserving all Scene authoring settings and rendering.

Planning source: `c91069d14c762d6a1dbe759f5a8c532c1600c374` on the existing
`feat/vfx-creator-polish` branch. Reuse the assigned worktree. At inspection,
unrelated work was present in chat bindings, runtime/debug stores, PiP visual
state, debug UI and `AvatarCanvasActor`, plus
`docs/plans/vfx-action-timing/vfx-action-timing-execplan.md`. That separate effort
also changed the Avatar creator, its document helpers and runtime guide during
planning. Recheck source and dirty
state before implementation; preserve its edits and coordinate overlapping files.
This plan neither changes nor inherits that effort's execution gates.

Relevant source and guidance, relative to the repository root:

- `src/frontend/web/src/ui/avatar-effect-creator/AvatarEffectCreatorPage.tsx`:
  local Guides state, fixed `PreviewGuides`, preview Avatar/controller lifecycle.
- `src/frontend/web/src/ui/scene-effect-creator/SceneEffectCreatorPage.tsx`:
  Guides state, `ScenePreviewGuides`, manual focus-target rectangle.
- `src/frontend/web/src/ui/content-creator/CreatorCanvasControls.tsx`: shared
  toggle currently required by all callers. Particle relabels it to Avatar and
  separately offers Outline; preserve both behaviors.
- `src/frontend/web/src/lib/avatar/vfx/AvatarVFXController.ts`: resolved hover
  placement, texture/decal rectangles, static transforms and animation transforms.
- `AvatarFaceLandmarks.ts`, `AvatarFaceTextureAnchors.ts` and their types in that
  directory: face bounds, eye projections, decal anchors and flatten regions.
- `src/frontend/web/src/lib/avatar/vfx/AvatarFaceDebugBox.ts` and
  `src/frontend/web/src/ui/debug/vrm-editor/face-preview.tsx`: reusable concepts
  and visual reference; the complete debug modal is not a creator dependency.
- `src/frontend/web/src/ui/content-creator/useContentCreatorAvatar.ts`: exact
  model loading, cancellation and disposal.
- `src/frontend/e2e/journeys/accountless-vfx-layout.spec.ts`: active browser
  coverage, including Eye = remaining active across guide toggles.
- `src/frontend/AGENTS.md`, `docs/frontend/runtime/avatar-vfx.md`,
  `docs/frontend/runtime/scene-vfx.md` and
  `docs/frontend/testing/browser-journeys.md`: implementation and evidence rules.

## Intended behavior

Retain one Avatar **Guides** toggle, initially on as today. Show only information
relevant to the current effect configuration. Use faint reference geometry and
a stronger outline for actual artwork; small labels and shape differences must
make the distinction understandable without color alone. Left/right means the
avatar's left/right. Guides follow the model and camera, and never intercept
camera controls or edit the authored document.

| Effect | Live Avatar guide | Expandable UV preview |
| --- | --- | --- |
| Eye hover | Selected eye anchor(s), reference-to-placement offset, actual image-plane bounds | Relevant eye-flatten coverage and skin sample when available |
| Mouth hover | Mouth anchor, hover depth and image-plane bounds | Relevant mouth-flatten coverage and skin sample when available |
| Face box hover | Face box, selected forehead/top/edge point and image-plane bounds | Not shown |
| Face decal | Selected under-eye, blush or mouth point(s), with reference/pivot information | Selected reference area, pivot and transformed artwork footprint; mouth flatten when active |
| Texture | Identify the selected material target without unrelated face markers | Actual selected material texture and transformed artwork footprint |

Side, mirroring and Single/Span selection determine the visible instances.
Image bounds mean the image rectangle, including transparent padding, not an
alpha-contour trace. A decal reference box is a placement basis, not a clipping
boundary. UV-space footprints are authoritative for decals/textures; do not draw
a flat rectangle on the face that falsely implies exact surface coverage.

The UV view is collapsed initially, accessible beside the Guides control, and
only offered when relevant data exists. Turning Guides off hides both spatial
guides and UV content. Use the selected binding's live texture (`map` preferred,
otherwise the available supported slot); state the material/slot in the view and
allow selection when the effect applies to multiple bindings or distinct slots.
Reuse the current composite image so flattening and artwork match playback.
Only the selected anchors and active flatten regions are overlaid; a small
coverage control can reveal the relevant skin sample/flatten detail. Do not add
the full debug inventory, binding IDs or nine clickable pivot handles.

Reference markers may remain visible before an image is uploaded or while
playback is stopped. An unavailable image or inactive effect has no claimed live
artwork footprint. While playing, artwork outlines track static transforms and
pulse/spin/drift using the same current state as the rendered effect. Missing
landmarks or bindings produce a concise explanation instead of guessed guides;
use existing source metadata to distinguish a fallback estimate when applicable.

Scene removal includes both its generic crosshair and the manual focus-box
outline. Focus-target coordinates, camera/model selection, restart, previews,
Save and portable definitions retain their existing behavior.

Out of scope: Particle changes, draggable gizmos, anchor correction/calibration,
new effect kinds, VRM asset edits, material matching changes, effect placement
changes, content migrations, Action timing, backend/API changes and debug-modal
redesign. No new runtime or UI dependencies are expected.

## Progress

- [x] Inspect current controls, runtime placement and debug visualizations.
- [x] Record scope, ownership boundaries and validation strategy.
- [x] Owner authorized both phases; published/read back #88 and created #89.
- [x] Phase 1: contextual Avatar placement guides and UV preview (agent gates passed).
- [ ] Phase 2: Scene guide removal and shared-control regression verification.
- [ ] Final integration review and owner visual acceptance.

## Surprises & Discoveries

- Avatar's current overlay accepts no model or document inputs; it only draws
  fixed CSS lines and a circle.
- Particle's shared toggle is already Avatar visibility. Its emitter Outline
  includes actual shape and cone direction; neither is part of this removal.
- `Avatar.setFaceDebugBoxVisible` is gated by development/debug flags. Production
  creator guides must use runtime data through a production-safe interface.
- Debug UV rectangles are cached reference sizes, not transformed effect bounds.
  The controller's normal snapshot lacks resolved corners and texture surfaces.
- Texture anchors retain cached world positions. Attach spatial markers using
  local coordinates and the live anchor transform, rather than cached world data.
- Concurrent timing cleanup used a preview alias different from the supplied
  runtime entry ID. Applying/removing and querying guides now consistently uses
  `effect.id`, avoiding stale effects across cleanup and guide lookup.
- Creator model choices currently expose only the last-active Anima's equipped
  model. A second-model check requires selecting another Anima before reopening
  the creator; expanding the model picker is outside this change.
- The static-rotation fix at the planning source uses a separate hover static
  group and texture Z rotation. Guides must preserve those existing semantics,
  including the distinct UV offset/pivot/mirroring calculations.

## Decision Log

- 2026-09-24, owner: plan Avatar guide rework and Scene guide removal following
  the contextual-guide discussion; Particle is excluded.
- 2026-09-24, plan proposal: informational guides, default-on toggle and a
  collapsed contextual UV view; retain form controls as the editing surface.
- 2026-09-24, engineering proposal: expose a narrow read-only runtime projection
  for guides and share existing placement calculations. Do not enable debug
  flags, instantiate a VRM editor session or duplicate placement math in React.
- 2026-09-24, delivery: retain the current branch and local-only handoff. Future
  publication requires a change to the owner's existing no-PR instruction.

## Phased implementation

### Phase 1: Accurate contextual Avatar guides

Scope: all Avatar behavior above. Dependency: implementation authorization and a
fresh check of concurrent Avatar creator/controller changes. Issue: #88. Starting source: `c91069d`; concurrent timing work was preserved and then
committed separately as `1ae0214` before guide review. Guide changes are reviewed
against `1ae0214`.

1. Establish behavior tests for selected anchors, mirror/side/span placement,
   pivot, non-square artwork, authored rotation and animated transforms. Use
   independent numeric expectations and controller/rendered-placement comparison;
   a guide helper compared only against itself is insufficient.
2. Expose the smallest read-only guide projection from the controller: selected
   binding/slot, reference landmarks/rectangles, resolved image corners or their
   current transform, and a borrowed texture surface. Keep application and
   compositing behavior unchanged. Extract pure placement/transform helpers only
   where needed for shared runtime use and meaningful tests. Do not serialize
   image/Three objects into editor documents or ordinary diagnostics.
3. Replace `PreviewGuides` with creator-owned spatial components using that
   projection and existing landmark snapshots. Retain the accessible switch name
   `Show placement guides`. Attach local markers to the live face anchor and use
   the actual hover transform chain. Keep selected reference/offset/art bounds
   distinct. Display only relevant points for the selected kind and side.
4. Build the collapsible UV view using the selected live texture and shared
   placement projection. Correctly map texture orientation/UV coordinates,
   mirroring, rotation, pivot and aspect ratio. Include relevant flatten/sample
   overlays without changing flatten state. Borrow texture sources without
   disposing or modifying materials owned by the Avatar/controller.
5. Own guide geometry/materials, any preview bitmaps/URLs and subscriptions at
   the creator lifecycle. Cancel obsolete model/texture work. Free owned resources
   on model change/unmount; while hidden stop guide work. Read current animation
   transforms from the controller's applied animation state, without a separate
   animation clock or per-frame React state
   updates, texture downloads or image-to-data-URL serialization. Opening/toggling
   guides must not reapply the effect or reset animation/playback.
6. Cover unavailable anchors, stopped playback, late model/image readiness,
   model switches and route cleanup. Keep diagnostic text accessible and ensure
   UV controls are keyboard reachable at desktop and narrow widths.
7. Update the Avatar runtime guide with concise usage, reference-versus-footprint
   semantics and fallback limitations. Avoid a new ADR for this local UI change.
8. Run phase checks and browser matrix below, then independent bounded review.
   Once authorized and verified, commit with a subject such as
   `feat(vfx)[p1]: show contextual avatar placement guides`.

Completion: every Avatar mode has truthful contextual guides; UV placement agrees
with rendered effects; guide toggles leave playback and authoring state unchanged;
production-build verification confirms no debug dependency. Agent validation and
review gate Phase 2. Owner visual acceptance is retained for final acceptance.

Evidence record: phase issue #88; implementation commit pending. Host packages
build, web source typecheck, E2E source typecheck, full web lint, changed-file
Prettier and whitespace checks passed. Focused VFX/creator run passed 63 tests in
12 files before review; repair adds one mouth-depth test (64 total). Tests were observed
red then green for mesh/UV geometry, head/camera projection and UV cancellation.
Host production build passed before repair. The repaired production Compose
image built successfully and served real spatial guides and UV in the browser;
`__ANIMAMA_DEV_BUILD__` is false for that Vite build by configuration.

Development browser evidence: `run-0924131827` passed setup plus Eye = stable
playback (50 bounded temporal samples across initial, UV, guides off/on and
stop/replay). Catalog and mutation guard stayed clean. The earlier run timed out
because each sample required multiple protocol round trips under software WebGL;
batching read-only DOM sampling preserved assertions and passed within 90 seconds.

Manual development checks at 1600×1000 and 390×844 verified eye/mouth/box hover,
forehead and top-edge placement, under-eye/blush span and mirrored references,
mouth decal, top-left pivot with 35-degree rotation, face/iris texture footprints,
camera orbit, and keyboard UV open/escape. UV kept source texture aspect and
showed selected material/slot; narrow controls wrapped inside the viewport.
Caitlyn was selected through the Anima navigation, then the creator was reopened:
her distinct face/shade texture, mouth landmark and coverage replaced Annie's
without stale surfaces. Selected/mirrored eye bounds followed rotation, camera
orbit and zoom; Annie was restored afterward. These checks cover representative
combinations on both models, not every Cartesian combination of controls.

The task development stack remains `animama-vfx-e1d7` at
`http://animama-vfx-e1d7.localhost:8200`. A separate deterministic test installation
is `animama-guides-e1d7` at `http://animama-guides-e1d7.localhost:8620`, with record
`/tmp/e1d7-guides-test-stack.env`. It was switched from development to production
without purging its data. Only the selected application publishes on loopback;
PostgreSQL and supporting services remain private; no optional profiles.

#### Code Review #1 Findings

Independent analysis and check reviews inspected the phase-1 working delta on
`1ae0214`. Checks passed; two P2 acceptance gaps required repair:

- P1-G01: Texture mode had no live material-target identification while UV was
  collapsed.
- P1-G02: Mouth reference included the hover clearance, concealing the separation
  from the actual mouth anchor.

No transform-parity or borrowed-resource ownership defects were found. Required
browser/production evidence remained the coordinator's gate.

#### Code Review #1 Revisions

Accepted both findings. Texture projections now include selected material names;
mouth references use the original anchor while artwork keeps actual mesh corners.
New assertions failed before repair and passed afterward, including independent
mouth clearance/offset values and oblique-camera separation. Independent targeted
review #2 found both resolved without new findings. Repair rounds used: 1/2.
A test accumulator type error caught by the production build was fixed with an
explicit Vector3 reducer type; source typecheck, runtime tests and the subsequent
production image build pass. Unit execution alone was not treated as a build pass.

Production browser evidence: the unchanged Eye = lifecycle journey passed in
`run-0924132501` (39.7s). The authoring-invariance journey passed in
`run-0924132751` (21.8s): replacement 32×16 artwork, Pulse/Spin/Drift, moving guide
pixels, exact portable JSON and Unsaved state preserved across guide/UV controls,
one active effect, clean diagnostics, and unchanged Local catalog. Intermediate
new-test failures were test locator/readiness assumptions and an unavailable
observation-clock field; assertions were repaired to use visible guide pixels.
Final focused unit run: 12 files / 64 tests passed; E2E typecheck and formatting
passed. Owner visual acceptance remains pending; it does not gate Phase 2.

### Phase 2: Remove Scene guides and verify shared controls

Scope: Scene toggle and both overlays only, plus the minimal shared-control API
change. Dependency: Phase 1 checks/review passed. Issue: #89.
Starting source: record Phase 1 commit and current concurrent changes.

1. Make the shared Guides control genuinely optional, with its value/callback
   supplied together. Omitted controls render no switch or empty label. Keep
   Avatar's Guides behavior and Particle's Avatar label/visibility unchanged;
   avoid a general toolbar rewrite.
2. Delete Scene guide state, toggle props, overlay wiring and
   `ScenePreviewGuides`. Preserve manual focus-target settings and effect output.
3. Add a focused shared-control contract check for present versus omitted toggle
   and retained custom label behavior. Extend the active VFX browser journey to
   verify Scene has no Guides control, manual focus coordinates still affect the
   effect, and Model/View/Restart remain reachable. Check Particle Avatar and
   Outline still work. Do not replace behavior checks with source-text assertions.
4. Run affected checks and browser regression coverage; remove obsolete guide
   documentation only where it exists. Independently review and commit, once
   authorized, with `refactor(vfx)[p2]: remove scene preview guides`.

Completion: no Scene guide UI/geometry remains; Scene authoring/rendering and the
other creators' controls pass verification. Then perform final integration review.

Evidence record: phase issue pending; implementation commit pending; exact tested
source/commands/results pending; browser artifacts and limitations pending.

#### Code Review #1 Findings

Not performed. Record source, stable findings and evidence. One initial review
and at most two targeted repair rounds are available.

#### Code Review #1 Revisions

None yet. Record dispositions, fixes and affected checks. Repair rounds used: 0/2.

## Validation and acceptance

Commands below run from `src/frontend` after locked dependencies are available.
Use the worktree's existing environment or project-scoped Compose service; record
the actual command and source when executed. New guide tests belong beside the
new runtime/UI modules and must be included in the focused run.

```bash
pnpm packages:build
pnpm --filter animama-web exec vitest run src/lib/avatar/vfx src/ui/avatar-effect-creator src/ui/content-creator/CreatorPrimitives.test.tsx
pnpm --filter animama-web run check:source
pnpm web:lint
pnpm e2e:check:source
pnpm build
```

Run read-only Prettier checks on changed frontend files and `git diff --check`.
Do not repeatedly rerun passing unchanged suites; after repairs, rerun affected
checks and invalidate evidence whose source changed. Record unrelated failures
separately; do not silently treat an unsuccessful command as a pass.

Extend the selected `accountless-vfx-layout.spec.ts`, then confirm discovery:

```bash
pnpm e2e:list -- --project chromium --grep 'avatar effect|scene creator|vfx guides'
pnpm e2e:test -- --project chromium --grep 'avatar effect|scene creator|vfx guides'
```

Name new cases with `vfx guides`; the filter also retains existing Avatar and
Scene playback regressions. The runner
requires the disposable, deterministic fixture documented in the browser guide;
do not run its setup against the owner's active development installation. If a
second stack is needed, use a separate stack record and available base port per
the local-stack skill. Do not overwrite the current stack's record or purge data.
The existing task development origin is
`http://animama-vfx-e1d7.localhost:8200`; reverify it before manual testing. Planning
does not start/reset any stack. Automated-runner limitations must be explicit;
test discovery/typechecking alone is not browser execution.

Manual browser acceptance, desktop first (1600×1000), then narrow (390×844):

- On two available real Avatar models, verify eye left/right/both, mouth hover,
  face-box forehead/top-edge, blush/under-eye/mouth decals, mirrored/single/span
  placement, iris texture and face-skin texture. Confirm source dimensions and
  model-dependent placement, rather than expecting identical geometry on models.
- Change offset/scale/rotation with non-square art, then pulse/spin/drift. Orbit
  and zoom. Reference markers remain attached, and live artwork outlines/UV
  footprints track the same effect without lag or double-applied transforms.
- Expand/collapse UV, toggle Guides repeatedly, stop/play/restart, switch models,
  replace the image and leave/reopen the creator. Verify no flicker, duplicate
  effect, stale guide, console error, or growing owned resource count. Resource
  disposal tests support this; a broad heap benchmark is not required.
- Confirm guide interaction does not change document fingerprint, dirty state,
  exported definition or saved content. Missing/estimated anchors have honest
  states, and turning guides off provides an unobstructed preview.
- Exercise the same Avatar controls in a served production build with debug
  flags disabled. A successful build alone does not prove this requirement.
- Verify Scene Background/Static SVG/Focus Lines previews, including manual-box
  targeting, without the toggle or outlines. Check Particle Avatar/Outline,
  desktop/narrow toolbar reachability, keyboard access and reduced-motion behavior.

Keep screenshots/results as concise public-safe evidence summaries with exact
source and serving mode. Native packaging, provider/audio behavior and hosted CI
are separate and are not established by these checks. Hosted Validation remains
unperformed while publication is withheld. Owner visual acceptance of guide
clarity remains pending; exact-candidate merge approval is a separate later gate.

## Final integration review

Review the combined plan delta against its recorded implementation baseline,
separating concurrent work. Reuse still-valid phase evidence. Verify all Avatar
modes, production availability, Scene removal, Particle preservation and resource
ownership together. Perform one full independent initial review and at most two
repair rounds focused on accepted fixes and their regressions.

### Code Review #1 Findings

Not performed. Record exact source, acceptance evidence, stable finding IDs and
remaining owner gates.

### Code Review #1 Revisions

None yet. Repair rounds used: 0/2. No supported blocker may be marked complete.

## Idempotence and recovery

Re-read Git status and nearby source before each phase; the supplied branch is
shared with other authorized work. Stage only this plan's files/hunks, never an
unqualified whole-tree commit. Do not reset/stash/discard concurrent work. Issues
are created or reused during authorized workspace setup after searching for
existing records, not during this planning pass.

No schema, content, VRM or saved-setting migrations are expected. Guide and UV
state remain transient. Repeated toggle/mount/unmount must be safe, and borrowed
textures must survive guide cleanup. Recover a faulty phase with a focused fix
or revert of its owned commit after checking dependents; preserve Local content,
drafts, stack volumes and later user commits. Use only project-scoped Compose
commands if services need attention; no broad Docker cleanup.

## Outcomes & Retrospective

Phase 1 implements runtime-derived spatial guides and a borrowed live UV view.
Agent checks and bounded independent review passed; phase commit and Scene removal
are next. Final visual acceptance belongs to the owner. No PR or push is authorized;
all implementation and evidence will remain on the task branch until requested.

2026-09-24 plan validation: all 14 explicit repository paths resolve; required
sections, review records, privacy and whitespace checks pass. Independent
plan-readiness review found no supported blockers. This does not consume an
implementation code-review round or establish runtime acceptance.
