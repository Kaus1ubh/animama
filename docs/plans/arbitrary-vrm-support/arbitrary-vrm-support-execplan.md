# Arbitrary user-uploaded VRM Avatars

Source agreement: raymond-van/animama#691 (published 2026-10-25, Agreed after
the owner's answers on 2026-10-25; snapshot in
[arbitrary-vrm-support-spec.md](arbitrary-vrm-support-spec.md)). The issue is
the spec; owner decisions are in the Decision Log.
Authorized scope: planning only (owner, 2026-10-26: "Write it in this
session"). Implementation of any phase waits for the owner's go-ahead on this
plan and on the open decisions that phase depends on.
Merge, release and any use of third-party Avatar data beyond local testing keep
their separate approvals.

## Purpose and context

A user who uploads their own VRM (a VRChat conversion, a UniVRM export from
Unity or Blender, a BOOTH model) gets an Avatar that emotes, wears effects and
moves about as well as an Included Avatar. When something cannot work, the user
can see what and why in a Diagnostics view, and can turn wind or spring physics
off for a model that suffers from them. The Included Avatars, both VRoid
exports, behave exactly as before.

Starting source: `main` at `a94f8369` (PR #688 merged). Plan branch:
`docs/arbitrary-vrm-support-plan`. Implementation uses one task branch and PR
for the whole plan unless the owner agrees a split (D1).

### What #688 already provides (do not re-specify)

Paths from `src/frontend/web/src/lib/avatar/` unless noted.

- ARKit face capability: `arkitFaceCapability.ts` (per-mesh detection under
  common spellings), `arkitFaceCompositions.ts`/`.json` (mood regions brow, eye
  and mouth; `parts`; `vowels`), `arkitFaceExpressions.ts` `registerArkitFace`
  (registered at `Avatar.ts` load before `applyEyelidClosureCorrection`, and
  again, idempotently, in `ExpressionController._registerArkitExpressions`).
  Today the rule is per Avatar: an Avatar with its own VRoid mood parts plays
  no ARKit mixes, and mixes need every table shape ("sufficient coverage").
- VRoid mood vocabulary: `vroidMoodParts.ts`.
- Painted effects on shared atlases: `vfx/AvatarFaceTextureAnchors.ts`
  `selectFaceIslandTriangles` (face UV island for decal projection, private),
  `vfx/AvatarFaceLandmarks.ts` (eye islands wider than the eye-bone spacing
  skipped), `vfx/profiles.ts` `resolveIrisEyeLayout` (1.9× iris cells).
- On-demand lilToon (`liltoon/lilToon.ts`) and Mochiya spring handling
  (`spring-bone/SpringBonePhysicsController.ts` `springsTunedWithoutAmbientForces`).
- Tools: `vrm:inspect`, `vrm:bake-expressions`, and `--avatar-file` on
  `effects:render`, `effects:bench` and `animation:render`
  (`src/frontend/web/scripts/avatar-file.mjs`).
- Decision history: `docs/plans/vrchat-arkit-avatars/vrchat-arkit-avatars-execplan.md`
  and ADR 0032 (VRM stays the container).

### Code map by requirement (read-only survey at `a94f8369`)

Frontend paths from `src/frontend/web/src/`; backend from
`src/backend/animama/`. Line numbers drift; search by symbol.

- R1 face parts: `lib/avatar/vfx/faceParts.ts` `detectAvatarFaceParts` runs
  signal detection (`detectFromSignals`), then name fallback
  (`detectFromNames`, confidence 0.5), then `applyCorrections` (schema and
  `vrm_sha256` must match). Face skin is one primitive morphed by `blink` and
  `aa` with head share ≥ `HEAD_SKINNED_MIN_SHARE` (0.9); only one binding is
  ever chosen. Eyelines and lashes are other face-mesh primitives that blink
  moves almost entirely (≥80% of vertices, ≤0.25× face area, inside the eye
  window). Irises come from look-at texture transforms, else eye-bone weights;
  without eye bones only the look-at path works, and `resolveEyeWindow` falls
  back to the iris extent or nothing. `resolveAvatarFacePartEntries` returns
  only the first `face_skin` binding; `lib/avatar/vfx/AvatarFaceLandmarks.ts`
  face bounds are that primitive's whole box
  (`computePrimitiveBoundsInAnchorSpace`). `Avatar.setFacePartCorrections`
  re-runs detection live. Detection, landmark, anchor and spring warnings are
  English sentences today. Four saved-Avatar surfaces load without the saved
  correction: `ui/content-preview/ContentPreviewScene.tsx`,
  `ui/animas/AnimaAvatarStage.tsx`, `ui/pose-creator/PoseCreatorAvatarActor.tsx`,
  `ui/create-anima/CreateAnimaStage.tsx` (the chat canvas and content creators
  pass it through `lib/runtime-content/runtimeAvatarFaceParts.ts`;
  `ui/create/CreateAnimaAvatarPreviewScene.tsx` loads an unsaved file, which has
  none).
- R2 texture layouts: `lib/avatar/vfx/profiles.ts` default `faceLayout.rect` is
  the whole texture; `lib/avatar/vfx/AvatarVFXController.ts`
  `resolveTextureEffectPlacements` gives every `full_face` effect one
  whole-texture placement; `drawCompositedLayerCanvas` clips only to a
  `PixelRect`. Placement and `lib/avatar/vfx/meshUvLocator.ts` use raw UVs;
  `KHR_texture_transform` and VRM 0 tiling are ignored. `resolveIrisEyeLayout`
  keeps VRoid's `mirrorRight` or turns it off when both iris rectangles
  overlap; per-eye mirrored UVs are not detected.
- R3 eye effects (`lib/avatar/vfx/AvatarVFXController.ts`, mapping in
  `lib/avatar/vfx/definition.ts`): `forceBlink` holds the `blink` expression;
  `hideEyeDetails`/`hideParts` hide whole meshes (`binding.object.visible =
  false`, ref-counted, never a mesh that is also face skin or iris);
  `faceCleanup` paints feathered skin-colour ellipses into the face texture.
  Details inside a shared primitive or painted into the face texture cannot be
  hidden today.
- R4 and R12 expressions: `lib/avatar/emotionExpressionPresets.ts` (positive
  moods key `Fcl_MTH_Fun` plus `Fcl_MTH_Large`/`Fcl_MTH_Joy`, fallback
  `relaxed` 0.2/0.4/0.6), `lib/avatar/ExpressionController.ts`
  `_resolveEmotionTargets` and `lib/avatar/partExpressionFallback.ts`
  (missing `Fcl_ALL/BRW/EYE_<Mood>` → preset; mouth and other parts dropped),
  `lib/avatar/eyelidClosure.ts` (verified profile for Annie only; default
  happy 1 / relaxed 0.2). No MMD code exists. Included content keys 18 distinct
  `Fcl_*` names: the 15 mood parts in Reactions (168 files), plus
  `Fcl_ALL_Sorrow`, `Fcl_ALL_Surprised` and `Fcl_EYE_Iris_Hide` in one Gesture
  and three Poses.
- R5 springs: `lib/avatar/spring-bone/SpringBonePhysicsController.ts` takes
  `ambientForces` in the constructor only; `enabled: false` only restores
  authored joint settings. three-vrm 3.5.2's `VRM.update` calls
  `springBoneManager.update(delta)` itself, so springs keep simulating.
  `Avatar.update` runs the controller and then `vrm.update`; the content
  creators (`ui/content-creator/useContentCreatorAvatar.ts`) and the Pose
  creator (`ui/pose-creator/poseCreatorAvatarFrame.ts`) call `vrm.update`
  directly, bypassing the controller. Persistence precedent: face-part
  corrections (contract `app/contracts/avatar_face_parts.py`, strict and
  `extra="forbid"`; sidecar key whitelist `_KIND_FIELDS` in
  `app/services/content_kind_registry.py`, unknown keys fail
  `unexpected_document_fields`; Included overrides in table
  `avatar_face_part_overrides` with ORM, baseline SQL and `_BASELINE_TABLES`;
  `AvatarFacePartsService`; routes `GET/PUT /v1/avatar-content/{item_id}/face-parts`
  registered shared in `product_http/inventory.py`; runtime
  `PyRuntimeAvatar.face_parts`, read by `app/services/anima_runtime_service.py`
  before the effective-revision hash). The runtime `effective_revision` is part
  of the Avatar file URL and of the chat canvas load key
  (`lib/runtime-content/animaRuntimeSnapshot.ts` `runtimeContentEntryLoadKey`),
  and a new revision also builds a new `AnimaRuntimeCatalog`, so any change in
  the runtime body remounts the Avatar; saving a Local sidecar also mints a new
  Avatar revision.
- R6 hands: `lib/avatar/poses/anatomy/handPresets.ts` `handShapeRotations`
  (rotations in the VRM 1 normalized T-pose basis), applied in
  `lib/avatar/poses/animaPoseClip/prepareV2.ts`; other writers of finger
  rotations: every built-in pose in `lib/avatar/poses/pose_catalog.generated.json`
  (including the idle `relaxedRest`), `lib/avatar/proc-animation/TalkingHandsProceduralAnimationLayer.ts`,
  VRMA playback, Pose creator authoring
  (`ui/pose-creator/poseCreatorHandInteraction.ts`,
  `lib/avatar/poses/anatomy/handOffsets.ts`). `lib/avatar/poses/poseRetargeting.ts`
  only converts the VRM 0 basis.
- R7 and R8 diagnostics: the development VRM debug modal is
  `ui/debug/VRMEditorDebugModal.tsx` (no face-part panel), gated by
  `DEBUG_ENABLED` (`platform/env.ts`). The Anima settings panel is
  `ui/main/header/AnimaSettingsModal.tsx` (an inline panel, mounted in
  `ui/main/header/AnimaInfoModal.tsx` and `ui/animas/AnimaDetailsPage.tsx`);
  `ui/animas/AnimaAppearanceDialog.tsx` is the dialog precedent. Failures that
  only log: `avatar_face_parts_detection_failed` (`Avatar._detectFaceParts`),
  `avatar_face_parts_invalid`, `avatar_effect_face_part_unavailable` (also a VFX
  snapshot warning). The Avatar Effect creator surfaces messages through
  `CreatorToolbar` `validationMessages`. Strings live in
  `locales/<tag>/<namespace>.json` for en, ja, ko, zh-Hans and zh-Hant.
- R9 rest pose and proportions: no rest-pose detection exists;
  `lib/avatar/poses/anatomy/arms.ts` assumes three-vrm normalized bones with
  identity rest. Contacts already scale by `avatarScale` (head-to-foot ÷
  1.25 m); body-plane effects in `lib/avatar/vfx/AvatarAttachmentEffects.ts`
  use absolute metres, stickers use measured height.
- R10 enhanced rendering: `lib/avatar/enhanced-rendering/vroidPalette.ts`
  `vroidLookFor` matches VRoid material suffixes; `mtoonPatch.ts` rewrites raw
  `VRMC_materials_mtoon` JSON in `beforeRoot`, before meshes, materials or the
  face-part map exist.
- R11 lilToon cost: `src/frontend/web/scripts/effect-bench.mjs`
  (`--avatar-file`, `--json`).
- R13 packages: `app/services/content_package_capabilities.py`
  `_GLTF_EXTENSIONS` is a strict allowlist (no `MOCHIYA_*`, meshopt or Draco;
  `tests/test_content_package_capabilities.py` asserts Draco is refused); an
  older install rejects an unlisted extension with a generic
  `package_definition_invalid` that does not name it. Upload validation
  (`app/services/content_gltf.py` `validate_vrm_stream`) has no extension list.
  No web loader registers a meshopt or Draco decoder (`Avatar._createGLTFLoader`,
  `lib/avatar/motion-authoring/headlessVrm.ts`,
  `src/frontend/web/scripts/animation-render/render.ts`,
  `src/frontend/web/scripts/vrm-optimize/compare/page.ts`). three 0.182 ships
  both decoders under `examples/jsm/libs/` (meshopt as JS with embedded base64
  WebAssembly; Draco as a separate `.wasm` plus wrapper).

### Licence boundary

Third-party Avatar data never enters this repository, issues or PRs: source
packages, converted or baked `.vrm` files, textures, review renders of them,
shape data, or author-specific morph names. Keep it in an owner-chosen
directory outside every repository (`<private-avatars>` here). Tests use
synthetic fixtures or Included Avatars with synthetic additions
(`lib/avatar/testing/appendTriangle.ts`, `lib/avatar/testing/syntheticFaceVrm.ts`,
`src/frontend/web/scripts/testing/faceFixtureVrm.mjs`). Plan and PR evidence
states counts, timings and pass/fail. Standard MMD morph names (R12) and ARKit
names are generic vocabulary, not author data.

### Cross-repository impact

Animama Cloud consumes reviewed Animama artifacts and keeps its own plans. It
builds the shared `ProductContent` itself, wires its own
`AvatarFacePartsService`, and keeps a hosted migration, lifecycle entry and
tenant-inventory row for `avatar_face_part_overrides`. So:

- Phase 3 is designed repin-safe: any new `ProductContent` member has a
  default, its route is registered for the local composition only, and the
  runtime service does not read the new table (D7). The hosted follow-up, if
  Cloud adopts the setting, is a Cloud migration, lifecycle entry, wiring and
  tenant-inventory row, recorded as a Cloud issue when Phase 3 merges.
- Phase 8's allowlist and capability changes alter package validation that
  Cloud consumes; record the repin note with Phase 8.
- The Diagnostics modal is local-only unless it needs no hosted-specific work
  (owner decision 3).

## Progress

- [ ] Phase 1: Diagnostics and visible failures (R7, R8). Not started.
- [ ] Phase 2: Face parts and eye effects on shared meshes (R1, R3). Not started.
- [ ] Phase 3: Wind and spring setting (R5). Not started; needs D2, D3 and D7.
- [ ] Phase 4: Expression content and MMD face shapes (R4, R12). Not started.
- [ ] Phase 5: Hands (R6). Not started.
- [ ] Phase 6: Texture layouts (R2). Not started.
- [ ] Phase 7: Rest pose, proportions and enhanced rendering (R9, R10). Not started.
- [ ] Phase 8: Package sharing (R13). Not started; needs D4 and D8.
- [ ] Phase 9 (alongside): lilToon frame cost (R11). Not started.
- [ ] Final integration review and full pre-push suite.

## Surprises & Discoveries

- 2026-10-26 (planning survey): springs keep simulating with the controller
  disabled, because three-vrm's `VRM.update` calls `springBoneManager.update`;
  and two creators call `vrm.update` directly, so per-Avatar spring behaviour
  needs one frame-update path on `Avatar`.
- 2026-10-26: four saved-Avatar surfaces load without the saved face-part
  correction, so a user's correction shows in chat and the content creators but
  not in Library previews, Anima stages, the Pose creator or Create Anima.
- 2026-10-26: uploads accept any glTF extension while package export accepts
  only an allowlist, so a converted Avatar can be used locally but not shared.
- 2026-10-26 (plan review): anything in the runtime snapshot body changes the
  effective revision and remounts the Avatar, and a Local sidecar save mints a
  new Avatar revision; a setting that must apply live cannot travel that way.
- 2026-10-26: an older install rejects a package whose Avatar sidecar has an
  unknown key with the generic `package_entry_invalid`; a package capability
  in `SUPPORTED_CAPABILITIES` makes it fail with `package_capability_unsupported`.

## Decision Log

- 2026-10-24, owner: generalize Avatar support to arbitrary non-VRoid VRMs,
  including an explicit per-Avatar wind and spring option (#691).
- 2026-10-24, owner (#688 Decision Log): runtime ARKit mixes take precedence
  over a file's own mood presets on Avatars with sufficient ARKit coverage. R12
  (2026-10-25, owner, in the spec) sets the per-region order own VRoid part →
  standard MMD morph → ARKit mix → VRM preset, which makes the #688 rules per
  region: Phase 4 records how.
- 2026-10-25, owner (issue #691 "Open questions and decisions"): the wind
  setting lives on the Avatar; "Springs off" is a fourth value; the modal is
  "Diagnostics" with a raw JSON view, hosted builds only if convenient; the hand
  rest is normalized at load; packages may carry `MOCHIYA_*`, meshopt and Draco
  Avatars; phasing R7 and R8 → R3 and R1 → R5 → R4 and R12 → R6 → R2 → R9 and R10
  → R13 with R11 alongside; the lilToon target is about an Included Avatar's
  GPU time, else a visible quality setting defaulting to the cheap path on slow
  GPUs; a model with no face shapes keeps a neutral face and diagnostics say so,
  without lowered lids or mouth visemes.
- 2026-10-26, owner: write this plan in the current session; no push or PR
  until the owner says so.
- 2026-10-26, agent (planning survey, within R1's "detect the same parts on
  every surface" intent): load the saved face-part correction on the four
  saved-Avatar surfaces that skip it (Phase 2). Recorded as an agent finding
  beyond the spec's wording.

## Open decisions

Agent proposals awaiting the owner. Phases name the decisions they need.

- D1 PR split. Proposed: four PRs in order, each with its own reviews and
  suite: A Phases 1 and 2; B Phase 3; C Phases 4 to 7; D Phases 8 and 9.
  Without a decision: one branch and PR for the whole plan.
- D2 package compatibility for the R5 setting. Proposed: an Avatar at
  Automatic carries no key in a package, so most packages stay readable by
  older installs; another value is carried with a new package capability
  (`avatar_spring_mode/1`), so older installs refuse it with
  `package_capability_unsupported`.
- D3 Included-Avatar binding for R5. Proposed: the stored value is keyed by
  owner and Avatar item only, not by revision or file digest, so an Avatar
  update keeps the user's choice.
- D4 Draco (R13). Proposed: accept Draco Avatars in packages and report them
  as not loadable (`avatar_extension_unsupported`) until the decoder is served.
  three 0.182 already ships it (`examples/jsm/libs/draco/`), so the cost is
  serving its `.wasm` as a runtime asset for Vite, hosted and Electron plus its
  Apache-2.0 notice, not a new dependency. Meshopt decoding ships (its decoder
  embeds its WebAssembly, so no separate asset).
- D5 user guide (spec acceptance "the user guide"). Proposed: describe the
  Diagnostics view and the wind setting in
  `docs/frontend/features/anima-management.md` and the Avatar-facing notes in
  `docs/frontend/runtime/vrchat-avatar-conversion.md`; no new guide.
- D7 where the R5 value lives (a deviation from the spec's "in a Local
  Avatar's sidecar"). Proposed: store it per owner and Avatar item in one table
  for Local and Included Avatars alike (not in the sidecar), read it through a
  settings query and apply it to the loaded Avatar, and keep it out of the
  runtime snapshot. Saving then neither mints an Avatar revision nor changes
  the effective revision, so it applies live (R5) and is repin-safe for Cloud.
  Packages still carry it: export writes the exporter's value into the Avatar's
  package sidecar (D2), and import moves it into the importer's table. This
  also changes owner decision 1 ("follows the model file"): a Local Avatar
  file that is moved, renamed or re-added in the Local folder becomes a new
  item (fresh id) and loses its setting, where a sidecar value would travel
  with the file. The alternative that keeps the sidecar keeps decision 1 and
  accepts one remount after each Local save.
- D8 older installs and new glTF extensions (R13). Proposed: derive a package
  capability when an Avatar uses one of the four new extensions, so older
  installs refuse with `package_capability_unsupported` instead of the generic
  invalid-definition error; or accept the generic error.

D6 is retired (it re-asked the spec's settled R12 order); the numbers of the
others are kept for traceability.

Notice (not a decision): the spec's R12 order puts a model's standard MMD
morphs, then ARKit mixes, before its own VRM mood presets, so a model with both
plays the MMD/ARKit face; Diagnostics shows the source per region.

## Phased implementation

Each phase starts from the previous phase's commit on the task branch. Every
phase keeps the constraints:

- Included Avatars unchanged: the same detected parts and landmark and anchor
  snapshots (the tracked test Phase 1 adds), and 0 differing pixels in review
  renders of affected effects and Gestures against the phase's start
  (`effects:render --diff`, `animation:render`).
- The licence boundary.
- Load time within a few milliseconds per primitive: phases that add load-time
  work (2, 4, 5, 7) report the load-timing measurement Phase 1 adds (Included
  Avatars, before and after, same machine) in their check record.
- No per-frame cost for models that need no correction.

Owner reviews of the converted test Avatar use private renders
(`--avatar-file`). High-risk phases run the full pre-push suite through
`scripts/heavy-slot.py` (`make check-test`, `pnpm verify`,
`pnpm web:test:browser`, `pnpm prettier:check`, `pnpm desktop:test`) before
their review, and the checks subagent reruns the affected checks.

### Phase 1: Diagnostics and visible failures

Review tier: standard. New production UI and a client-side diagnostic
collection; no persistence, API or contract change. Review focus: nothing
private leaves the modal, and the dev debug panels are unchanged.

Requirements: R7, R8 (today's failure kinds; later phases add theirs). Depends
on nothing.

Changes:

1. Codes beside the existing strings: face-part `diagnostics`, landmark and
   anchor `warnings`, spring snapshot `warnings` and VFX warnings gain a stable
   code and parameters next to today's English text (`faceParts.ts`,
   `AvatarFaceLandmarks.ts`, `AvatarFaceTextureAnchors.ts`,
   `SpringBonePhysicsController.ts`, `AvatarVFXController.ts`); the text stays
   for logs and the dev panels, which are otherwise unchanged.
2. `lib/avatar/diagnostics/` (new) `AvatarDiagnostics`, in two stages:
   - file facts from the GLB, before any loader runs: from the JSON chunk the
     VRM version, `extensionsUsed`/`extensionsRequired`, mesh, primitive and
     material counts and material types; texture byte sizes from `bufferViews`
     and pixel sizes from the embedded image headers (PNG, JPEG, WebP); the
     file size. A load failure (for example an undecodable extension) is
     recorded with its code, so an unloadable Avatar is still diagnosable;
   - live facts from the loaded `Avatar`: face (`facePartMap` parts, source
     signals/names/corrected/missing, confidence, codes; landmark and anchor
     status), expressions (presets, visemes, ARKit coverage and whether faces
     play through mixes, names content used but the model lacks, through a sink
     `ExpressionController` reports to; Phase 4 completes it), motion (humanoid
     bones present, spring count, wind mode: Automatic until Phase 3; rest-pose
     check placeholder until Phase 7), warnings (R8): face-part detection
     failure, invalid saved correction, effects skipped or degraded on this
     Avatar, attachment limit, landmark, anchor and spring codes; deduplicated
     per loaded Avatar.
   `Avatar.getDiagnostics()` returns a snapshot; `subscribeDiagnostics`
   notifies. Codes and parameters only; the UI renders catalog text.
3. Reports: a text report and a JSON report from the same snapshot, holding
   file facts only, no file paths, URLs, credentials or user-entered names (the
   Avatar is identified by kind and content item id).
4. UI, designed with the `animama-ui` skill: a Diagnostics section with a button
   in `AnimaSettingsModal.tsx` opens `AvatarDiagnosticsDialog` (as
   `AnimaAppearanceDialog`): File, Face, Expressions, Motion, Warnings; Copy
   report; a Raw JSON view with its own copy. It reads the Anima's live Avatar
   when that Anima is on the chat canvas, else loads the Anima's Avatar off
   screen from its runtime snapshot (with its face-part correction) and disposes
   it on close; a file that does not load still shows file facts and the error.
   Keyboard accessible; strings in the 5 locales.
5. Hosted: render the section only in the local composition unless the panel
   and loader work in `main.hosted.tsx`'s composition without new hosted work;
   record which.
6. R8 creator notice: the Avatar Effect creator's `validationMessages` gain the
   diagnostic for an effect skipped or degraded on the preview Avatar.
7. Tracked baselines (new tests): an Included snapshot test that loads both
   Included Avatars headlessly and compares their face-part map, landmark and
   texture-anchor snapshots with committed JSON fixtures (Included Avatars are
   this repository's own content); and a load-timing measurement that reports
   the time of the whole load-time correction path (face-part detection,
   expression registration, eyelid measurement and, as later phases add them,
   hand and rest-pose measurement) on both Included Avatars, per primitive
   where it applies. It is a reported measurement compared by hand between a
   phase's start and end on the same machine, not a CI threshold.
8. One shared load-time step: `lib/avatar/prepareLoadedVrm.ts` (new)
   `prepareLoadedVrm(vrm, { vrmSha256 })` runs today's load-time installs
   (`registerArkitFace`, then `applyEyelidClosureCorrection`) and is called by
   `Avatar.load`, `scripts/animation-render/render.ts` `loadVrm` (which repeats
   them by hand today) and the headless test loaders
   (`motion-authoring/headlessVrm.ts`, `lib/avatar/testing/loadedTestAvatar.ts`).
   Later phases add their installs here (Phase 4 `registerMmdFace`, Phase 5 the
   hand wrapper, Phase 7 the arm offset), so `animation:render` and the tests
   exercise exactly what the app runs. A refactor with no behaviour change.
9. Docs: `docs/frontend/runtime/avatar-vfx.md` (diagnostic codes), the user
   guide per D5.

Checks: unit tests for the collector on Included Avatars (no warnings) and
synthetic models (each existing failure kind appears once; an undecodable
synthetic GLB gives file facts and a load error); report tests asserting no
file path or URL patterns and no Avatar name; dialog tests (opens from the
panel, every section, both copy actions, keyboard navigation);
`pnpm i18n:check`; `npx vitest run src/lib/avatar src/ui` (`src/frontend/web`);
`pnpm -s web:lint` and `pnpm -s check` (`src/frontend`); a production-build
stack (`ANIMAMA_WEB_BUILD_MODE=production ./reset.sh --name … --base-port …`)
showing the modal for an Included and a Local Avatar; Included
`animation:render` and `effects:render` sheets at 0 differing pixels after the
shared load step.

Owner gate: UI review of the Diagnostics view on the live stack.

Completion: R7 acceptance (production build, both Avatar kinds, copy,
keyboard, localization); R8 acceptance for today's failure kinds; baselines
committed.

Recovery: read-only collection; reverting removes the section and dialog
without data changes.

Check record: (to fill) · Commits: (to fill)

#### Code Review #1 Findings

Not run.

#### Code Review #1 Revisions

Not run.

### Phase 2: Face parts and eye effects on shared meshes

Review tier: standard. Behaviour inside face detection and the VFX runtime with
regression risk for every Avatar, covered by the Included baselines and renders.
No contract change: detail regions are detection-only; letting a user's
correction name regions would change the strict `animama/avatar-face-parts/1`
contract (persistence, packages, generated client) and is out of scope here.

Requirements: R1, R3. Depends on Phase 1.

Changes:

1. Face skin without head-only skinning (`faceParts.ts`): rank blink- and
   `aa`-morphed primitives by head-weighted triangle area instead of requiring
   ≥90% head share; keep the 0.9 rule's result wherever it already finds a
   face, so the Included Avatars are unchanged. Allow several `face_skin`
   bindings, and make `resolveAvatarFacePartEntries`, landmarks and anchors use
   all of them.
2. Face bounds from the face: landmarks compute bounds from head-weighted
   vertices of the face bindings, excluding neck or body vertices in a shared
   primitive.
3. Detail regions inside shared primitives: within a face or eye primitive,
   find UV islands (or vertex sets) that blink moves almost entirely and record
   them as `eyelash`/`eyeline` regions on that binding (a part entry gains an
   optional region list in the runtime map only).
4. No eye bones and no look-at transforms: find each eye from blink-moved vertex
   clusters on the face, assigning sides by the humanoid's left/right axis
   (VRM 0 and 1); choose iris, white and highlight primitives among the
   primitives in front of each cluster with `classifyEyePrimitives`'s existing
   area and depth rules.
5. Load the saved face-part correction on `ContentPreviewScene.tsx`,
   `AnimaAvatarStage.tsx`, `PoseCreatorAvatarActor.tsx` and `CreateAnimaStage.tsx`
   (agent finding, see Decision Log).
6. Eye effects (`AvatarVFXController.ts`): hide detail regions by drawing the
   shared primitive without their triangles while the effect is active (a
   filtered index swapped in and out, ref-counted like whole-mesh hiding, with
   `geometry.groups` rebuilt because MToon outlines reuse them); extend
   `faceCleanup` to cover detail painted into the face texture around the eye
   (measured from blink motion); keep `forceBlink`. Where a detail cannot be
   hidden, the effect still plays and a diagnostic names it
   (`eye_detail_not_hidden`).
7. Docs: `avatar-vfx.md` face parts and eye effects.

Checks: unit tests on Included Avatars with synthetic additions (lashes and eye
lines inside the face primitive; a face skinned partly to the neck; no eye
bones) detect the parts; the Included snapshot test unchanged; Included renders
of the eye effects (Eye Confused Swirl, the `eye` family, `star3`, effects that
hide parts) and the painted set at 0 differing pixels in both looks; the
load-timing measurement within a few milliseconds per primitive; vitest, lint and
check as Phase 1.

Owner gate: private renders of Eye Confused Swirl and the other eye-hiding
effects on the converted test Avatar show no lash, line or highlight artefacts
(R3 acceptance).

Completion: R1 and R3 acceptance; owner gate passed.

Recovery: load-time detection only; reverting restores today's detection with
no data change.

Check record: (to fill) · Commits: (to fill)

#### Code Review #1 Findings

Not run.

#### Code Review #1 Revisions

Not run.

### Phase 3: Wind and spring setting

Review tier: high risk. A new table, API route and generated-client change,
package export and import, and the per-frame spring update path.

Requirements: R5. Depends on Phase 1 (Diagnostics shows the effective mode),
D2, D3 and D7. The steps below assume D7's proposal; if the owner keeps the
sidecar, steps 1 and 4 move the Local value into the sidecar and accept one
remount after a Local save.

Backend:

1. Contract and table: a spring mode enum `automatic | on | off | springs_off`
   (`app/contracts/avatar_settings.py`, new); table `avatar_setting_overrides`
   (owner, Avatar item, `spring_mode`, `updated_at`; PK owner and item; FK to
   `content_catalog_items` with cascade; CHECK on the enum) for Local and
   Included Avatars, ORM, `alembic/versions/0001_baseline.sql` and
   `_BASELINE_TABLES` (no Alembic revision; development databases are reset per
   `docs/backend/operations/development.md`), port, repository and a service
   modelled on `AvatarFacePartsService` without digest or revision binding (D3).
2. API: `GET/PUT /v1/avatar-content/{item_id}/settings` returning the
   effective value and its source (stored, default), registered for the local
   composition only (`_local(...)` in `product_http/inventory.py`); the store is
   an optional, defaulted `ProductContent` member so the hosted composition
   still builds at repin; not projected into `PyRuntimeAvatar`. Regenerate the
   client from `src/frontend` with `pnpm openapi-ts` (never hand-edit
   `generated/`); `pnpm openapi-ts:check`.
3. Packages, with three rules because `_KIND_FIELDS` is one whitelist for Local
   sidecars, Local saves and package entries: export pops any document
   `spring_mode` and writes the exporter's stored non-Automatic value (the
   face-parts pattern in `content_package_export.py`), includes it in the
   export review digest, and derives the capability `avatar_spring_mode/1`
   (D2, added to `SUPPORTED_CAPABILITIES`); a Local save strips the key; import
   writes the value into the importer's table inside the import mutation
   (beside `resolve_catalog_avatar`) and its regenerated sidecar omits it. A
   composition without the store (Cloud after a repin) drops the value on
   import and exports none. It tells the user in the import review, before
   they confirm: `ReviewedImportPlan` gains an optional, defaulted per-item
   notice list (`avatar_setting_not_stored`; additive, client regenerated),
   and the replayed `PackageImportResult` receipt is unchanged.
4. Docs: `docs/backend/features/custom-animas-and-content.md`,
   `docs/backend/architecture/http-api.md`, `data-model.md`,
   `local-content-storage.md`.

Frontend:

5. One frame path: `Avatar` gains the update entry every surface uses
   (`useContentCreatorAvatar.ts` and `poseCreatorAvatarFrame.ts` stop calling
   `vrm.update` directly), so the spring controller and mode apply everywhere.
6. Modes in `SpringBonePhysicsController`: `setAmbientForces(enabled)`;
   Automatic is today's `!springsTunedWithoutAmbientForces`; On; Off. Springs
   off stops simulation through three-vrm's public API (for example
   `springBoneManager.reset()` on entry, then holding springs at rest each
   frame); a test pins the behaviour against the installed three-vrm so an
   upgrade that changes `VRM.update` fails loudly.
7. Delivery: a settings query (`useAvatarSettings`/`useSaveAvatarSettings`,
   following the face-part hooks) read by every surface that loads a saved
   Avatar (chat canvas, `AnimaAvatarStage`, `ContentPreviewScene`, the content
   creators, the Pose creator, `CreateAnimaStage` when it loads a saved
   Avatar); `Avatar.setSpringMode(mode)` at load and on change, so a save
   applies live without a remount. The query and the settings row are gated to
   the local runtime (`useRuntimeCapabilities`, `runtime_kind`), so the hosted
   web app never calls the local-only route; a missing or failed query means
   Automatic and never blocks a load. Unsaved files (the Create Anima file
   preview) use Automatic.
8. UI: in the Anima settings panel, an Avatar section with "Wind and ambient
   forces" (Automatic, On, Off, Springs off), noting that it applies to this
   Avatar wherever it is used; 5 locales. Diagnostics shows the effective mode
   and its source.

Checks: backend tests (save and read per owner, Local and Included, 404s and
ownership, package export with and without a value, the capability refused by
an install without it, import moving the value into the table,
`tests/test_alembic_fresh_install.py`, `tests/test_product_http_inventory.py`,
a composition without the store drops an imported value with its notice);
`pnpm openapi-ts:check`; the hosted web build (`pnpm web:build:hosted`) and a
unit test that the settings query and row stay off under a hosted runtime
capability; frontend tests
(mode resolution, live switch without remount on the chat canvas, Springs off
holds rest and resumes, each listed surface applies the mode, the three-vrm pin
test); spring snapshot tests show Automatic identical to today on Included
Avatars and a Mochiya-extension fixture; the full pre-push suite; the full
`pnpm e2e:test` on a built stack (package import and export).

Owner gate: live check of the four modes on the converted test Avatar and an
Included Avatar, on the chat canvas and the Anima page.

Completion: R5 acceptance; owner gate passed; a Cloud follow-up issue recorded
for the hosted migration, lifecycle, wiring and inventory, plus a backend
composition check at repin.

Recovery: the table and route are additive. A revert leaves stored values
unused; packages exported with `spring_mode` need an install that understands
the capability (older ones refuse them clearly, D2).

Check record: (to fill) · Commits: (to fill)

#### Code Review #1 Findings

Not run.

#### Code Review #1 Revisions

Not run.

### Phase 4: Expression content and MMD face shapes

Review tier: standard. Expression runtime for every non-VRoid model; Included
Avatars keep their own VRoid parts, which come first.

Requirements: R4, R12. Depends on Phase 1 and Phase 2 (iris hiding).

Changes:

1. Per-region order for a VRoid mood part or mood preset: the model's own
   VRoid part; its standard MMD morph; the ARKit mix; the VRM preset fallback.
   `lib/avatar/mmdFaceExpressions.ts` (new) `registerMmdFace(vrm)` registers
   region expressions from the spec's standard names (brows にこり, 困る, 怒り,
   上; eyes 笑い, なごみ, びっくり, じと目; mouths にっこり, お), installed in
   Phase 1's shared load step before `registerArkitFace` and repeated
   idempotently in `ExpressionController`. The #688 rules
   become per region: a region the model or MMD fills is not replaced by a mix,
   and a mix fills a region only when the shapes that region uses resolve (the
   "sufficient coverage" check per region instead of per Avatar). Record this in
   `avatar-emotion.md` and the Decision Log when it lands.
2. Non-mood parts on models without them, never using mouth visemes for moods
   (owner decision 8): `Fcl_EYE_Close`/`_L`/`_R` → `blink`/`blinkLeft`/
   `blinkRight`; `Fcl_EYE_Spread` → the surprised eye region; `Fcl_EYE_Iris_Hide`
   → hiding the iris face part (Phase 2's hiding); `Fcl_MTH_Large` and
   `Fcl_MTH_A` → ARKit `jawOpen` where the model has it, else unresolved and
   reported (MMD お is not used here: it maps only to the Surprised mouth in
   R12, and an MMD model's `oh` viseme may bind the same morph). With the
   default viseme lip sync a mood-held `jawOpen` adds to separate viseme
   morphs; only under #688's opt-in ARKit lip-sync shaping does it stack on the
   same `jawOpen` morph, which the Phase 4 owner gate reviews together with
   #688's open stacking item.
3. Positive emotions: `Fcl_MTH_Fun` resolves through the same order (MMD
   にっこり, ARKit smile) before today's `relaxed` fallback.
4. Unresolved names are reported once per Avatar to the Phase 1 sink.
5. Eyelid closure measures each model's lid-closing expressions (mood presets,
   MMD eye morphs such as 笑い and なごみ, ARKit mixes) by their share of
   blink's motion instead of VRoid constants; the Included Avatars keep today's
   values (Annie's verified profile; Andrew pinned to the current default by
   digest).
6. A model with no VRoid parts, MMD morphs, ARKit shapes or mood presets keeps a
   neutral face and a diagnostic says so.
7. Docs: `avatar-emotion.md` (order, MMD table, measured eyelid correction).

Checks: unit tests on synthetic preset-only, MMD-only, MMD-plus-ARKit,
ARKit-only and VRoid models for the order; a test that every `Fcl_*` name in
`content/included` resolves on a preset-only synthetic model or is reported;
blink stays within shut under 笑い; the decision-8 model shows no mouth motion
for moods; lip-sync visemes are untouched by the new resolution; Included renders of the six emotion groups and sampled
Reactions/Gestures at 0 differing pixels; the load-timing measurement; vitest, lint and
check.

Owner gate: private renders of moods on the converted test Avatar (R12) and of
positive-emotion mouths on a preset-only model (R4); a live check of a
mood-held `jawOpen` under lip sync, with visemes and with ARKit lip-sync
shaping.

Completion: R4 and R12 acceptance; owner gate passed.

Recovery: load-time registration only.

Check record: (to fill) · Commits: (to fill)

#### Code Review #1 Findings

Not run.

#### Code Review #1 Revisions

Not run.

### Phase 5: Hands

Review tier: standard. Shared pose pipeline; Included poses must stay
identical.

Requirements: R6 (owner decision 4: normalize the hand rest at load). Depends
on nothing beyond Phase 1.

Changes:

1. Measure each finger and thumb chain's rest frame at load from the normalized
   humanoid (chain direction and curl axis) and compare it with the VRoid
   reference frame the hand poses assume.
2. Normalize at rig level, in one place every finger rotation passes through,
   so built-in poses (including `relaxedRest`), hand presets, Gesture clip hand
   tracks, talking hands, VRMA playback and Pose creator authoring all get it.
   three-vrm's transfer is `raw = P⁻¹·N·P·B` and its rest data is
   `protected`, so: at load, wrap the loaded instance's public
   `vrm.humanoid.update` once (the per-instance patching precedent of
   `eyelidClosure.ts`), applying a constant per-bone correction to the finger
   bones after the transfer. Every `vrm.update`, including the many
   `vrm.update(0)` calls in the Pose creator and stages, then applies it. The
   wrapper is installed in Phase 1's shared load step, so `animation:render`
   and the tests run it too. Give the same correction to every reader of
   finger geometry in normalized space: the thumb and pinch fits in
   `handPresets.ts`, the `tip` contact points in `poses/anatomy/arms.ts` and
   `contactPoints.ts` (29 Included content files use fingertip contacts), and
   the motion checks in `motion-authoring/checks.ts`. Skip it below a small
   deviation tolerance, so the Included Avatars take exactly today's path.
3. If normalization cannot make thumbs-up, fists and pointing right on the
   converted test Avatar, stop and decide per-rig retargeting with the owner.
4. Docs: `avatar-animation.md` hands.

Checks: unit tests on a synthetic rig with rotated finger rest frames (thumbs up
points up, fist closes, index points) through presets, a catalog pose and
talking hands, and a fingertip contact landing on its target; a test that
`animation:render`'s loader installs the wrapper; Included `animation:render` of Double Thumbs Up and other hand
Gestures (body and hands views) at 0 differing pixels; the load-timing measurement;
vitest, lint and check.

Owner gate: private renders of Double Thumbs Up and other hand Gestures on the
converted test Avatar (R6 acceptance).

Completion: R6 acceptance; owner gate passed.

Recovery: load-time correction only.

Check record: (to fill) · Commits: (to fill)

#### Code Review #1 Findings

Not run.

#### Code Review #1 Revisions

Not run.

### Phase 6: Texture layouts

Review tier: standard. Painted-effect placement for every Avatar.

Requirements: R2. Depends on Phase 2 (face bindings).

Changes:

1. Export the face skin's UV islands from `AvatarFaceTextureAnchors`
   (`selectFaceIslandTriangles`) and clip `full` painted art to them (a Path2D
   clip in `drawCompositedLayerCanvas` instead of the whole texture), so
   whole-face art no longer tints neck, inner mouth or body on an atlas.
2. Honour texture transforms in placement and `meshUvLocator.ts`:
   `KHR_texture_transform` on the face material's base texture, VRM 0 MToon
   tiling, and UVs outside 0–1 (wrapped).
3. Detect per-eye mirrored iris UVs (each iris island's UV orientation against
   its geometry) and mirror per eye in `resolveIrisEyeLayout`.
4. Docs: `avatar-vfx.md` limitations.

Checks: unit tests with a synthetic shared-atlas face (whole-face art covers
only the face island) and a texture-transform fixture (decals land correctly);
Included renders of the painted set and iris effects at 0 differing pixels;
vitest, lint and check.

Owner gate: none (private renders optional).

Completion: R2 acceptance.

Recovery: placement only; no data change.

Check record: (to fill) · Commits: (to fill)

#### Code Review #1 Findings

Not run.

#### Code Review #1 Revisions

Not run.

### Phase 7: Rest pose, proportions and enhanced rendering

Review tier: standard.

Requirements: R9, R10. Depends on Phase 1 (rest-pose diagnostic), Phase 2
(face-part roles) and Phase 5 (the humanoid wrapper).

Changes:

1. Detect a rest pose that is not a T-pose at load (upper-arm and forearm
   directions from the humanoid rest against horizontal, beyond a stated
   tolerance) and report it. Try normalizing it at load (an arm-rest offset
   through the same `vrm.humanoid.update` wrapper as Phase 5, installed in the
   shared load step, and the same offset given to the normalized-space contact
   and arm solvers); keep
   normalization only if Gestures on
   an A-pose synthetic model match a T-pose one, else report only and record
   why.
2. Scale body-plane effects by measured height; hand-to-face contacts already
   scale by `avatarScale` and also take measured arm and head size. Proposal:
   models within the Included Avatars' height range keep a factor of exactly 1,
   with the band and its edges reviewed at this phase (it departs from R9's
   "scale with measured size" inside the band).
3. Enhanced rendering by role: VRoid-named materials keep today's `beforeRoot`
   retune; for other MToon models, retune the built MToon materials after load
   (including outline settings) by face-part role (face skin, other skin, hair,
   cloth) from the face-part map and spring/hair detection. three-vrm only
   generates an outline material at load for materials that already have an
   outline width, so the retune either generates the outline material and its
   geometry groups for every retuned material that needs one, or leaves every
   material's outline as authored; never some of each. A model whose MToon
   materials cannot all be assigned gets the classic look for that Avatar,
   consistently.
4. Docs: `avatar-animation.md` (rest pose, contacts, enhanced rendering).

Checks: unit tests (A-pose synthetic model reported or normalized; contacts and
body effects scale on a scaled synthetic model; the Included factor 1); a render
check that a non-VRoid MToon synthetic model never shows a mixed look; Included
renders in both looks at 0 differing pixels; the load-timing measurement; vitest, lint
and check.

Owner gate: the scaling band proposal and, if normalization lands, Gesture
renders on the converted test Avatar.

Completion: R9 and R10 acceptance; owner gate passed.

Recovery: load-time only.

Check record: (to fill) · Commits: (to fill)

#### Code Review #1 Findings

Not run.

#### Code Review #1 Revisions

Not run.

### Phase 8: Package sharing

Review tier: high risk. Package format contract and the model loaders.

Requirements: R13. Depends on Phase 1 (pre-load diagnostics), D4 and D8.

Changes:

1. Backend: add `MOCHIYA_avatar_composition`, `MOCHIYA_materials_liltoon`,
   `EXT_meshopt_compression` and `KHR_draco_mesh_compression` to
   `_GLTF_EXTENSIONS`; per D8, derive a package capability for Avatars that use
   them; update the test that asserts Draco refusal.
2. Loaders: register three's meshopt decoder in `Avatar._createGLTFLoader`,
   `motion-authoring/headlessVrm.ts`, `scripts/animation-render/render.ts` and
   `scripts/vrm-optimize/compare/page.ts`; Draco per D4.
3. Reporting: an Avatar whose required extensions the runtime cannot load is
   reported on import (a shared list of loadable extensions) and in Diagnostics
   through Phase 1's pre-load stage, never as a silent or half-rendered load.
4. Docs: `docs/backend/features/custom-animas-and-content.md` packages,
   `docs/frontend/runtime/vrchat-avatar-conversion.md` sharing; the Cloud
   repin note.

Checks: backend tests export and import a synthetic Avatar with each listed
extension, and an install without the capability refuses it; a meshopt-
compressed synthetic GLB loads in a vitest loader test; the Draco path test; the
full pre-push suite; the full `pnpm e2e:test`.

Owner gate: none beyond merge.

Completion: R13 acceptance.

Recovery: the allowlist change is additive; packages with these Avatars need an
install that understands them (older ones refuse them per D8).

Check record: (to fill) · Commits: (to fill)

#### Code Review #1 Findings

Not run.

#### Code Review #1 Revisions

Not run.

### Phase 9 (alongside): lilToon frame cost

Review tier: standard for measurement and rendering changes; high risk for a
step that adds a user preference (settings contract).

Requirements: R11. Depends on nothing; may run in parallel with any phase.

Changes:

1. Measurement: extend `effects:bench` with per-material isolation,
   per-feature toggles (outline, rim, matcap, shadow, emission, transparency
   passes), per-layer hiding (stacked eye layers, eyeball domes, shadow meshes),
   draw calls from `renderer.info`, and resolution scaling. Record a summary
   table (counts and timings, the method and the machine) in this phase's
   section; bench JSON and renders stay outside the repository.
2. Reduce toward the agreed target (a lilToon Avatar adds at most about an
   Included Avatar's GPU time at the chat canvas on the reference machine):
   evaluate a lower or adaptive pixel ratio for lilToon Avatars, an idle
   frame-rate cap, cutting costly features or layers, lilToon on chosen
   materials only, and a low-cost mode on the fallback materials.
3. If the target is not reached, a quality setting visible in Settings defaults
   to the cheap path on slow GPUs, chosen from measured GPU time (a new
   `presentation.*` preference beside `enhanced_rendering`; high-risk step).
4. Fallback materials render with their base colours wherever lilToon is not
   used (converted exports keep glTF's default metallic 1; set it to 0 for
   materials that carry `MOCHIYA_materials_liltoon` data but render as
   fallback).
5. Docs: `avatar-animation.md` authored lilToon materials (frame cost).

Checks: bench before and after on the reference machine; Included renders and
bench unchanged; vitest, lint and check; settings tests and the full pre-push
suite if step 3 lands.

Owner gate: the look in private renders and the measured result against the
target.

Completion: R11 acceptance; owner gate passed.

Recovery: rendering changes are runtime only; a preference added in step 3 is
optional with a default.

Check record: (to fill) · Commits: (to fill)

#### Code Review #1 Findings

Not run.

#### Code Review #1 Revisions

Not run.

## Final integration review

Covers combined acceptance R1–R13, every failure kind from later phases
appearing in Diagnostics (R8), the licence boundary across the whole diff and
history, documentation accuracy and any phase without its own review. Then the
full pre-push suite once on the final candidate; its results go in the PR.

## Validation and acceptance

Spec acceptance criteria, with these checks (from `src/frontend` unless noted):

- `pnpm verify`; `pnpm web:test:browser` where review-render or stage code
  changes; `make check-test` from the repository root for Phases 3 and 8;
  `pnpm openapi-ts:check` after Phase 3.
- Included render diffs against each phase's start and, before the PR, against
  the plan's starting commit (`a94f8369`), in both looks; the Included snapshot
  test and the load-timing measurement.
- `pnpm e2e:test:fast` on a disposable built stack for user-facing phases; the
  full `pnpm e2e:test` for Phases 3 and 8 (package import and export). Known
  flake: #709 (Library particle preview race).
- Owner-only checks: Diagnostics (Phase 1); eye effects (Phase 2); spring modes
  (Phase 3); moods (Phase 4); hands (Phase 5); scaling band (Phase 7); the
  lilToon look and cost (Phase 9).

## Idempotence and recovery

- Detection, registration and normalization are load-time only; reloading an
  Avatar recomputes them.
- Phase 3 adds a table and a route; see its recovery note.
- No face-part contract change is planned; existing corrections stay valid.
- Test stacks hold only test data and are torn down after their last use.

## Outcomes & Retrospective

Not started.

## Plan review

### Code Review #1 Findings

Reviewed the uncommitted plan and spec snapshot (tree `b590d98b`) against
`main` `a94f8369`, by an independent sdlc-reviewer agent reading the source
(including three-vrm 3.5.2, three 0.182 and the Cloud repository). It confirmed
the code claims listed in the code map and found these:

- PLAN-F1 (required): R5's live apply could not work through the runtime
  snapshot or a Local sidecar save, which both remount the Avatar.
- PLAN-F2 (required): two creators call `vrm.update` directly, and only the
  chat canvas received the mode.
- PLAN-F3 (required): letting corrections name regions changes the strict
  face-part contract, so Phase 2 was high risk and its recovery claim wrong.
- PLAN-F4 (required): Phase 5 corrected rotations at their sources (retargeting,
  not normalization) and missed catalog poses and talking hands.
- PLAN-F5 (required): the enhanced retune runs in `beforeRoot`, before the
  face-part map exists; Phase 7 also depends on Phase 2.
- PLAN-F6 (required): Diagnostics drew on English warning sentences while
  promising codes.
- PLAN-F7 (required): Cloud builds `ProductContent` and wires the face-part
  service itself; Phase 3 as written would break the hosted composition at
  repin.
- PLAN-F8 (required): mapping `Fcl_MTH_Large` to `aa` contradicted owner
  decision 8.
- PLAN-F9 (required): an Avatar that fails to load could not be diagnosed.
- PLAN-F10 (required): high-risk phases omitted suite steps and the full
  `pnpm e2e:test` for package changes.
- PLAN-F11 to F20 (optional): D4's rationale (three ships the Draco decoder;
  meshopt embeds WebAssembly) and two missed loaders; the older-install error
  for new extensions is generic; missing phase dependencies; no load-timing
  method; the final sections assumed D1; template slots; per-region #688 rules
  and a misdated decision; the corrections step as extra scope and the unsaved
  Create Anima preview; report privacy; the scaling band; code-map path
  prefixes; three-vrm coupling; outline groups; iris choice without eye bones;
  where R11 evidence lives; D6 re-asked a settled order.

### Code Review #1 Revisions

- PLAN-F1: D7 (one table for Local and Included values, a settings query, no
  runtime projection, `Avatar.setSpringMode` at load and on change); Phase 3
  rewritten around it, with the sidecar alternative stated.
- PLAN-F2: Phase 3 step 5 gives `Avatar` the single frame path, and step 7 lists
  every saved-Avatar surface.
- PLAN-F3: detail regions are detection-only; Phase 2 stays standard with no
  contract change, and the recovery note says so.
- PLAN-F4: Phase 5 normalizes at rig level in one place all writers pass
  through, listing them; retargeting stays the owner fallback.
- PLAN-F5: Phase 7 retunes built MToon materials after load for non-VRoid
  models and depends on Phase 2.
- PLAN-F6: Phase 1 step 1 adds codes beside the existing strings.
- PLAN-F7: Cross-repository impact rewritten; Phase 3 is repin-safe (defaulted
  members, local-only route, no runtime read of the table) with the full hosted
  follow-up recorded.
- PLAN-F8: Phase 4 step 2 never maps moods to visemes; mouth openings come from
  MMD or ARKit shapes or are reported.
- PLAN-F9: Phase 1's collector has a pre-load stage from the GLB JSON; Phase 8
  depends on Phase 1.
- PLAN-F10: high-risk phases run the full suite through `scripts/heavy-slot.py`
  before review; Phases 3 and 8 run the full `pnpm e2e:test`.
- PLAN-F11 to F20: D4 corrected and the two loaders added; D8 added; dependencies
  added (4 on 2, 7 on 2, 8 on 1, 5 on 3); Phase 1 adds a load-timing test used
  by Phases 2, 4, 5 and 7; the final sections assume one PR; every phase has
  Revisions, Completion, Recovery and Owner gate lines; Phase 4 states the
  per-region rules and the decision is dated 2026-10-24; the corrections step is
  an agent finding and excludes the unsaved preview; reports carry no names;
  the scaling band is a proposal reviewed at Phase 7; code-map paths carry their
  prefixes; Springs off uses public API with a pin test; outline groups and iris
  choice are specified; R11's summary lives in its phase section; D6 became a
  notice.

One repair round used.

### Code Review #2 Findings

Targeted recheck of tree `18a0411d` by the same reviewer. It confirmed D7's
package mechanics are workable (export rebuilds Avatar entries and merges owner
values as for face parts; import regenerates sidecars and installs Avatars as
new items) and that a defaulted `ProductContent` member keeps Cloud's backend
building. Earlier findings resolved except as below.

- PLAN-R2-F1 (required): wrapping corrections into `Avatar`'s frame path misses
  the many direct `vrm.update(0)` calls and the normalized-space hand fitting;
  three-vrm's rig rest data is `protected`, so the preferred route was not
  available.
- PLAN-R2-F2 (required): the hosted web app would call the local-only settings
  route on every Avatar load; a composition without the store had undefined
  import behaviour; "hosted composition still builds" could not run here.
- PLAN-R2-F3 (required): D7 also changes owner decision 1 ("follows the model
  file"); a moved or re-added Local file loses its setting.
- PLAN-R2-F4 to F8 (optional): `_KIND_FIELDS` has no package-only scope (three
  rules and the export digest needed); post-build retunes cannot add outlines
  three-vrm did not generate; お for `Fcl_MTH_Large`/`Fcl_MTH_A` goes beyond
  R12 and may stack with the `oh` viseme; the GLB JSON has no texture pixel
  sizes, and timing only detection misses later phases' load work;
  `CreateAnimaStage` also loads saved Avatars.

### Code Review #2 Revisions

- PLAN-R2-F1: Phase 5 wraps the instance's `vrm.humanoid.update` at load and
  gives the same correction to the normalized-space fitting; it no longer
  depends on Phase 3; Phase 7's arm offset uses the same wrapper and depends on
  Phase 5.
- PLAN-R2-F2: the settings query and row are gated to the local runtime, a
  missing or failed query means Automatic, a composition without the store
  drops an imported value with a named notice, and the check is the hosted web
  build plus a Cloud backend check at repin.
- PLAN-R2-F3: D7 names decision 1 and the moved-file consequence.
- PLAN-R2-F4 to F8: Phase 3 step 3 states the three rules and the digest; Phase 7
  generates outlines for all retuned materials or none; Phase 4 uses only
  `jawOpen` and adds a viseme check and owner-gate item; Phase 1 reads pixel
  sizes from image headers and measures the whole load-time correction path as a
  reported figure; `CreateAnimaStage` is listed.

Two repair rounds used; the recheck after this round is the last review of the
plan.

### Code Review #3 Findings (final recheck)

Recheck of tree `88d2c44b` by the same reviewer: PLAN-R2-F1 to F8 resolved
(a per-instance `vrm.humanoid.update` wrapper sees every `vrm.update`, since
three-vrm 3.5.2's `VRMCore.update` calls it through the instance, and a constant
post-transfer correction cannot accumulate), with two gaps that remain open at
the review limit and three optional points:

- PLAN-R3-F1 (required, open): Phase 5 gives the finger correction only to the
  `handPresets.ts` fitting; the arm-contact solver (`poses/anatomy/arms.ts`,
  `contactPoints.ts` `tip` points, used by 29 Included content files) and the
  motion checks also read finger geometry in normalized space, so a corrected
  rig's fingertip would miss its contact target.
- PLAN-R3-F2 (required, open): `scripts/animation-render/render.ts` builds its
  own VRM without `Avatar.load`, so a wrapper installed in `Avatar` is never
  installed there; Phase 5's `animation:render` checks and the R6 owner-gate
  renders would not exercise the change (likewise Phase 4's `registerMmdFace`
  and Phase 7's arm offset if rendered with it). Fix: one shared load-time step
  called by `Avatar.load`, `render.ts` `loadVrm` and the headless test loader.
- PLAN-R3-F3 (optional): the hosted build is `pnpm web:build:hosted`, and the
  gate needs a unit test under a hosted runtime capability.
- PLAN-R3-F4 (optional): `PackageImportResult` has no notices field and is a
  replayed receipt (`schema_version` 1); the notice needs an additive optional
  field or the import review.
- PLAN-R3-F5 (optional): Phase 4's Owner gate line omits the `jawOpen` and
  lip-sync item, and "the same morph" holds only under #688's opt-in ARKit
  lip-sync shaping.

Disposition: the review limit is reached, so the owner decides whether to accept
the stated fixes without another review or to waive them; no further review
round.

### Code Review #3 Revisions

The owner (2026-10-26) asked to apply PLAN-R3-F1 and F2 and the optional F3 to
F5 without another review round:

- PLAN-R3-F1: Phase 5 gives the finger correction to every normalized-space
  reader of finger geometry (`handPresets.ts` fits, `arms.ts`/`contactPoints.ts`
  `tip` points, `motion-authoring/checks.ts`) and adds a fingertip-contact test.
- PLAN-R3-F2: Phase 1 adds one shared load-time step (`prepareLoadedVrm`) used by
  `Avatar.load`, `animation:render` and the headless test loaders; Phases 4, 5
  and 7 install their load-time work there, and Phase 5 tests that
  `animation:render` runs the wrapper.
- PLAN-R3-F3: the hosted check is `pnpm web:build:hosted` plus a unit test of the
  gate under a hosted runtime capability.
- PLAN-R3-F4: the notice goes in the import review (`ReviewedImportPlan` gains an
  optional per-item notice list); the import receipt is unchanged.
- PLAN-R3-F5: Phase 4 states that stacking on one morph happens only under
  #688's opt-in ARKit lip-sync shaping, and its Owner gate lists the live check.

These fixes were not re-reviewed (owner waiver of a further round); the phases'
own reviews cover them when implemented.
