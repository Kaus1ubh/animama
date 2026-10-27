# Arbitrary user-uploaded VRM Avatars

Source agreement: raymond-van/animama#691 (published 2026-10-25, Agreed after
the owner's answers on 2026-10-25; snapshot in
[arbitrary-vrm-support-spec.md](arbitrary-vrm-support-spec.md)). The issue is
the spec; owner decisions are in the Decision Log.
Authorized scope: the whole plan (owner, 2026-10-26: decisions D3, D4, D5 and D7
"use recommendations", then `/implement`), in two PRs, PR A (Phases 1 to 3)
first; Phase 10 added to PR B by the owner on 2026-10-27. Owner gates in each
phase still apply.
Merge, release and any use of third-party Avatar data beyond local testing keep
their separate approvals.

## Purpose and context

A user who uploads their own VRM (a VRChat conversion, a UniVRM export from
Unity or Blender, a BOOTH model) gets an Avatar that emotes, wears effects and
moves about as well as an Included Avatar. When something cannot work, the user
can see what and why in a Diagnostics view, and can turn wind or spring physics
off for a model that suffers from them. The Included Avatars, both VRoid
exports, behave exactly as before.

Starting source: `main` at `a94f8369` (PR #688 merged). Task branch for PR A:
`feat/arbitrary-vrm-support` (the plan branch renamed; it holds the plan
commits), in the session's own worktree with backend (`uv sync --python
3.12.13`) and frontend dependencies installed; no stack yet. Implementation
uses two task branches and
PRs (owner, 2026-10-26): PR A for Phases 1 to 3, then PR B for Phases 4 to 10
on a branch cut from `main` after PR A merges.

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
- Phase 8's allowlist change alters package validation that
  Cloud consumes; record the repin note with Phase 8.
- The Diagnostics modal is local-only unless it needs no hosted-specific work
  (owner decision 3).

## Progress

- [ ] Phase 1: Diagnostics and visible failures (R7, R8). Implemented,
  checked and review passed 2026-10-26; the owner's UI review of the
  Diagnostics view is pending.
- [ ] Phase 2: Face parts and eye effects on shared meshes (R1, R3). Implemented,
  checked and review passed 2026-10-26; the owner gate (private renders of the
  eye-hiding effects) is pending.
- [ ] Phase 3: Avatar settings: wind and materials (R5, R11's Materials
  setting). Implemented, checked and review passed 2026-10-26; the owner
  accepted the Included Avatars' spring change on 2026-10-27; the rest of the
  owner gate (live wind modes, the Simple look) is pending.
- [ ] Phase 4: Expression content and MMD face shapes (R4, R12). Implemented,
  checked and review passed 2026-10-27; the owner gate (private mood renders,
  live lip-sync checks, two confirmations) is pending.
- [ ] Phase 5: Hands (R6). Implemented, checked and review passed
  2026-10-27; the owner gate (private hand Gesture renders) is pending.
- [ ] Phase 6: Texture layouts (R2). Implemented, checked and review passed
  2026-10-27 (merged into PR B); no owner gate.
- [ ] Phase 7: Rest pose, proportions and enhanced rendering (R9, R10).
  Implemented, checked and review passed 2026-10-27; the owner gate (scaling
  band, private Gesture renders on the T-pose and A-pose exports, the R10
  departure) is pending.
- [ ] Phase 8: Package sharing (R13). Implemented, checked and review passed
  2026-10-27 (merged into PR B); the full `pnpm e2e:test` runs on the final
  candidate, and the package-set bumps at PR time.
- [ ] Phase 9 (alongside): lilToon frame cost (R11). Not started.
- [ ] Phase 10: Diagnostics and Avatar settings in the Library and Create Anima
  (R5, R7 and R11 entry points; owner, 2026-10-27). Implemented, checked and
  review passed 2026-10-27 on `feat/arbitrary-vrm-support-pr-b`;
  `pnpm e2e:test:fast` waits for PR B's final candidate; the owner's UI review
  is pending.
- [ ] Final integration review and full pre-push suite. PR A: `main` at
  `d30a6ddc` merged in on 2026-10-27 (one conflict, in `AnimaAvatarStage.tsx`,
  both sides kept); `local-http` 17.0.0, `runtime-contracts` 0.17.0 and
  `product-ui` 0.18.0 for the new route and declarations (package-set
  compatibility check passed against `d30a6ddc`); final integration review
  #1 blocked on FI-1, fixed.

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
- 2026-10-26 (Phase 1): `motion-authoring/headlessVrm.ts` cannot run the shared
  load step: `vrm:inspect` and the motion checks load through it and must see
  the file's own expressions before Animama registers any.
- 2026-10-26 (Phase 2): the converted test Avatar keeps its upper lash strips
  and strands as separate islands inside the face primitive (about ten per
  eye, all fully moved by blink) and a few blink-moved islands inside its
  eye-layer primitive; the Included Avatars have none, so region detection
  runs everywhere without changing them.
- 2026-10-26 (Phase 3): Mochiya writes `metallicFactor` 1 explicitly on every
  fallback material of the converted test Avatar, so "no explicit
  `metallicFactor`" would not have fixed its dark Simple look; every fallback
  of a lilToon material now gets metalness 0.
- 2026-10-26 (Phase 3): the content and Pose creators never ran the spring
  controller, so their springs had authored settings only (no drag multiplier
  or updraft). Moving them onto `Avatar.updateModel` gives them the chat's
  spring behaviour.
- 2026-10-26 (Phase 3): the runtime Avatar entry already carries its catalog
  item (`config.avatar_catalog_item_id`); typed content previews did not, so
  `avatarPreviewTarget` now adds it and every preview surface reads the same key.
- 2026-10-26 (Phase 1): i18next-cli files the keys of a helper typed through a
  local alias (`type T = TFunction<"animas">`) under the default namespace and
  deletes them from the real one; the i18n guide now says so.
- 2026-10-27 (agent live check on the Phase 3 review stack): the converted test
  Avatar uploads through Create Anima's file input and works in chat, on the
  Anima page and in the Library; Diagnostics, Off, Springs off, Simple and an
  eye-hiding effect behave. Wind On lifts its ponytail and side hair straight
  up, because the updraft is far stronger than springs tuned without ambient
  forces; Automatic avoids it. Whether On should warn or scale its forces to
  the Avatar's springs is open with the owner.
- 2026-10-27 (merging `main` into PR A): main added scene frame pacing (an idle
  Avatar renders at 30 fps) and moved three-vrm from 3.5.2 to 3.5.5. Its `VRM`
  class and `VRMSpringBoneManager.reset()` are unchanged, so Springs off still
  works by resetting after each `vrm.update`.

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
- 2026-10-26, owner (answering D1, D2 and D8): two PRs, A for Phases 1 to 3
  and B for Phases 4 to 9. No backward compatibility is needed for older app
  versions or older packages, so packages carry the wind setting and the new
  glTF extensions without package capabilities or compatibility handling.
- 2026-10-26, owner (agreeing an agent proposal; #691 updated the same day):
  each Avatar with authored lilToon materials gets a per-Avatar Materials
  setting (Automatic, lilToon, Simple) beside the wind setting. Automatic is
  lilToon unless the measured GPU time says the machine is too slow; it applies
  on reload; an app-wide quality setting is added only if still needed.
- 2026-10-26, owner: D3, D4, D5 and D7 take the recommendations (see
  Decisions). D7 changes #691 R5 and answer 1, updated the same day: Avatar
  settings are stored per owner and Avatar item outside the file, so they apply
  live and a moved or re-added Local file starts from Automatic. Implementation
  authorized (`/implement`).
- 2026-10-26, agent (planning survey, within R1's "detect the same parts on
  every surface" intent): load the saved face-part correction on the four
  saved-Avatar surfaces that skip it (Phase 2). Recorded as an agent finding
  beyond the spec's wording.
- 2026-10-26, agent (Phase 1, within the plan): the shared load step runs in
  `Avatar.load`, `scripts/animation-render/render.ts` and
  `testing/loadedTestAvatar.ts`, not `headlessVrm.ts` (see Surprises).
  Diagnostics renders in hosted builds too: it uses only the runtime snapshot,
  loadout, content delivery and `Avatar`, with no hosted-only work. The copied
  text report is English with stable codes for support; the dialog itself is
  localized. The dialog reuses Application Settings' `SectionedModalFrame`, so
  no layout alternatives were put to the owner before the owner's UI review.
  The Avatar Effect creator's toolbar now words the preview Avatar's findings
  from their codes instead of showing the controllers' English text.
- 2026-10-26, agent (Phase 2, within the plan):
  - Detection still picks one face skin; several `face_skin` bindings come
    from corrections. Landmarks union every listed face binding, and texture
    anchors project onto the one nearest the eyes (a synthetic split face could
    not be built from the Included files to test detection of one).
  - Detail regions are also searched in the eye primitives. With an eye-line
    primitive every region is a lash; otherwise each eye's largest region is
    its line. Only blink-moved islands qualify, by the primitive rules.
  - Regions are hidden by rewriting their triangles in place as degenerate
    triangles, not by swapping a filtered index: no index buffer is replaced
    each toggle and MToon outline groups need no remapping.
  - Eye cleanup covers the eyelids only on a face with no line or lash
    geometry (taken as painted lashes), so the Included Avatars are unchanged.
  - The iris tie-break prefers the middle layer (a highlight in front and a
    white behind) in every eye group, eye bones and look-at included; it only
    decides groups with a white, which the Included eye-bone groups lack.
    Without eye bones, eye layers must also lie within the eyelids' region.
  - The partly-head face rule needs a primitive blink moves and none on
    spring joints, so hair merged into a face mesh never wins.
  - Create Anima, which loads a content preview rather than a runtime entry,
    passes the model's digest and applies the saved correction from the
    face-parts query. The digest also selects a verified eyelid-closure
    profile there, as in chat.
- 2026-10-26, agent (Phase 3, within the plan):
  - The wind setting travels in `AvatarLoadSpec.springMode` and changes live
    through `Avatar.setSpringMode`; Springs off calls
    `springBoneManager.reset()` after each `vrm.update`, since three-vrm has no
    switch for its springs.
  - `useAvatarLoadSettings` waits for the settings read before a surface
    loads (materials are built at load, so a Simple Avatar is not loaded
    twice); a failed or hosted read is Automatic at once and never blocks.
  - The settings panel learns that a file has lilToon materials from a
    session store `Avatar.load` fills by VRM sha256, so the Materials row
    appears once any surface has loaded the Avatar, or while a stored choice
    is not Automatic. Range reads of the file are not available locally, and a
    full download only to decide one row was rejected.
  - The backend notice for a composition without the store is a per-item
    `notices` list on `ReviewedImportItem`, worded in the import review.
- 2026-10-27, owner: accept the Included Avatars' spring change in the content
  and Pose creators and the review renders (Phase 3: hair and Annie's cardigan
  bow move under the chat's spring settings there, about 4% of a review
  sheet's pixels). Included render diffs against `main` are judged with that
  change accepted.
- 2026-10-27, owner: offer Diagnostics and the wind and Materials settings on
  Library Avatar cards, and a Diagnostics link on Create Anima's upload
  preview, in PR B (Phase 10). Create Anima gets no settings, since an unsaved
  upload has no Avatar item to store them on. Issue #691's spec lists them
  since 2026-10-27 (R5, R7, R11, their acceptance and decision 9).
- 2026-10-27, agent (Phase 10 step 4, within the plan): no backend field. The
  backend keeps no file facts (an item's catalog `metadata` is its sidecar
  projection, and `validate_vrm_stream`'s facts are discarded), so a field
  would need scan-time persistence of file facts, an API field, a regenerated
  client, package-set bumps and a Cloud repin for one row. The Library's
  Avatar settings dialog instead reads the item's file facts when this
  session does not yet know whether the file has lilToon materials
  (`useAvatarItemFileTraits`), once per file per session, into the same
  `useAvatarFileTraitsStore`, so the Anima settings then show the row too.
  This narrows Phase 3's rejection of "a full download only to decide one
  row" to the panels that are always shown: the Library dialog is opened
  deliberately. A file whose glTF cannot be read is remembered as without
  lilToon, so it is not read again. The phase stays at the standard tier.
- 2026-10-27, agent (Phase 10, within the plan): the preview dock publishes
  its loaded Avatar and item id (`stores/preview-dock-avatar-store.ts`) so
  Diagnostics for that item reads it; Create Anima's stage lifts its Avatar
  and load state (`onAvatarStateChange`) to the upload step. The Library
  dialog opens Diagnostics nested inside it, so Escape closes Diagnostics
  first.
- 2026-10-27, agent (Phase 4, within the plan; recorded in `avatar-emotion.md`):
  - #688's per-Avatar rules became per region. A region plays the model's own
    VRoid part, else its standard MMD morph, else the ARKit mix when every
    shape that region of the table uses resolves, else the preset fallback.
    So an Avatar missing a table shape now plays its other regions' mixes.
  - The whole-face names (the mood preset and `Fcl_ALL_<Mood>`) combine their
    regions' MMD morphs and ARKit mixes and replace an authored preset, as the
    mixes did. A mood with a region neither covers keeps the file's own preset
    whole: one preset cannot be split by region, and a partial face would be
    worse than today's. Without an own preset that region stays neutral.
    Content keying a single region still plays its MMD morph or mix.
  - `Fcl_EYE_Close`, `_L` and `_R` play ARKit's blink shapes as before, else
    the blink presets. `Fcl_EYE_Iris_Hide` is an expression whose bind tells
    `AvatarVFXController.setIrisHidden` when it is held (weight 0.5 or more),
    counted with effects that hide parts; `animation:render`, which has no
    effect controller, does not hide irises.
  - Emotion-map names the Avatar cannot play are reported (for example
    `Fcl_MTH_Large` without `jawOpen` beside a resolved smile), except when the
    whole positive-mood fallback (`relaxed`) replaces the map's names.
  - Eyelid closure measures every lid-closing expression's share of blink's
    motion on models without VRoid eye parts of their own. VRoid faces keep
    the default profile instead of a digest pin for Andrew: their smiling eyes
    are an arc that the share along blink's motion understates (about 0.62 for
    happy on VRoid samples, where Annie's verified profile needs 1), so
    measuring them would let blink collapse the lashes. Annie keeps her
    verified profile; Andrew, a VRoid face, keeps the default as before.
- 2026-10-27, agent (Phase 5, within the plan):
  - The correction is exact rather than a constant multiplier after the
    transfer: the wrapper sets each corrected bone's normalized rotation N to
    `W_parent⁻¹ · N · W_bone` for three-vrm's transfer and restores it after,
    which equals the constant post-transfer form only when N and W share an
    axis.
  - Instead of giving each normalized-space reader the correction, the
    normalized rig's hand and finger child offsets (and three-vrm's normalized
    rest pose, used by resets) are turned by their parent's `W` once at load.
    With the exact correction every bone's drawn frame is its normalized frame
    times `W`, so the normalized rig then matches the drawn hand and the
    thumb and pinch fits, contact points and motion checks need no change.
  - The hand bone itself is corrected with the fingers: the converted test
    Avatar's hand rests bent about 22° down and rolled about 20°, and
    straightening only the fingers would kink them against the palm.
  - The reference frames are Annie's (Andrew agrees within 0.2°) and the
    tolerance is 5°; the Included Avatars and the VRM 0 VRoid fixture measure
    under it, the converted test Avatar 38° over 32 bones.
- 2026-10-27, agent (Phase 7, within the plan except the last bullet):
  - `handRest.ts` became `restNormalization.ts` (`installRestNormalization`):
    arms join the hands in one wrapper and one offset pass. Each upper arm and
    forearm is measured against VRoid's horizontal T-pose with a 10° tolerance;
    normalized arms are exact like hands. Hands are measured against VRoid's
    as carried by their own forearm (review P7-R1-F5), so an arm's tilt never
    counts against its hand; a corrected forearm carries its hand, rigidly when
    the palm cannot be measured (P7-R1-F1), and adds the hand's own correction
    only when the hands are beyond their tolerance. Gestures on a 40° A-pose
    synthetic model match the T-pose one (directions within 1e-5 rad, joints
    within 1 µm), so normalization is kept rather than report-only. The
    Included Avatars and the VRM 0 fixture rest in an exact T-pose; the
    converted test Avatar's arms are within 5° of one and are not normalized,
    and its hand correction is now measured against its forearm.
  - Body effects scale by `avatarScale` (rest head height above the feet over
    1.25 m, the contacts' measure), not bounding height: the converted test
    Avatar's bounding height is inflated by hair and accessories, while its head
    height puts it just below Annie (1.012). The proposed band is 0.91–1.2 (the
    Included 1.012 and 1.094 widened by 10%), scaling by size over the nearer
    edge outside it, so the size is continuous at the edges. The scale is on
    the effect's root group, so offset and size scale together and the Avatar
    Effect creator's drags (in that group's frame) and resizes (ratios) stay
    consistent.
  - Contacts stay on `avatarScale`; the arm solver already uses the model's
    own arm lengths. Head size is not measured separately: on the converted
    test Avatar the face's depth in front of the head joint matches Annie's
    to within a millimetre.
  - Departure from step 3 (and PLAN-F5), for the owner: non-VRoid MToon models
    keep every material as authored (R10's "switched off consistently")
    instead of a role-based retune. There is no non-VRoid MToon reference
    model to tune or judge the shade and rim colours on, and the face-part map
    gives face skin but no reliable split between body skin and cloth, so the
    "cannot all be assigned" fallback would apply to nearly every model. The
    retune now requires VRoid's face skin material name, which also removes
    today's partial retune of models with VRoid-like suffixes (on renamed
    copies of the Included Avatars 14 and 18 materials would have been
    retuned beside authored ones). Such models keep the enhanced lights, tone
    mapping and chat filter on their authored materials: "classic" applies per
    material, not to the scene. A role-based retune remains a follow-up.

## Decisions

All settled by the owner on 2026-10-26 (D1, D2 and D8 answered directly; D3,
D4, D5 and D7 "use recommendations"); D6 is retired. The numbers are kept for
traceability.

- D1 PR split: two PRs (see Purpose and context).
- D2 and D8: no backward compatibility for older app versions or packages; no
  package capabilities.

- D3 Included-Avatar binding for R5. Decided: the stored value is keyed by
  owner and Avatar item only, not by revision or file digest, so an Avatar
  update keeps the user's choice.
- D4 Draco (R13). Decided: accept Draco Avatars in packages and report them
  as not loadable (`avatar_extension_unsupported`) until the decoder is served.
  three 0.182 already ships it (`examples/jsm/libs/draco/`), so the cost is
  serving its `.wasm` as a runtime asset for Vite, hosted and Electron plus its
  Apache-2.0 notice, not a new dependency. Meshopt decoding ships (its decoder
  embeds its WebAssembly, so no separate asset).
- D5 user guide (spec acceptance "the user guide"). Decided: describe the
  Diagnostics view and the wind setting in
  `docs/frontend/features/anima-management.md` and the Avatar-facing notes in
  `docs/frontend/runtime/vrchat-avatar-conversion.md`; no new guide.
- D7 where the Avatar settings live (wind for R5 and Materials for R11; a
  deviation from the spec's "in a Local Avatar's sidecar", now updated in
  #691 R5 and answer 1). Decided: store them
  per owner and Avatar item in one table
  for Local and Included Avatars alike (not in the sidecar), read it through a
  settings query and apply it to the loaded Avatar, and keep it out of the
  runtime snapshot. Saving then neither mints an Avatar revision nor changes
  the effective revision, so it applies live (R5) and is repin-safe for Cloud.
  Packages still carry it: export writes the exporter's value into the Avatar's
  package sidecar, and import moves it into the importer's table. This
  also changes owner decision 1 ("follows the model file"): a Local Avatar
  file that is moved, renamed or re-added in the Local folder becomes a new
  item (fresh id) and loses its setting, where a sidecar value would travel
  with the file. The alternative that keeps the sidecar keeps decision 1 and
  accepts one remount after each Local save.

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
   them by hand today) and the headless test helper
   (`lib/avatar/testing/loadedTestAvatar.ts`; not `motion-authoring/headlessVrm.ts`,
   see Surprises).
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

Check record (2026-10-26, macOS arm64, worktree on `feat/arbitrary-vrm-support`
from `30b71570`; tree recorded with the commit):

- `npx vitest run src/lib/avatar src/ui tests/avatar` (`src/frontend/web`):
  313 files, 3,248 passed, 2 skipped.
- `pnpm -s check`, `pnpm -s web:lint`, `pnpm -s prettier:check`,
  `pnpm -s i18n:check` (`src/frontend`): pass.
- Review renders, phase start (`30b71570` sources) against the end:
  `effects:render` of `heart_eyes`, `blush`, `sweat_drop`,
  `little-devil-horns`, `gray-silhouette`, `mouth_w` and `face_red`, and
  `animation:render` of `air-guitar` and `apology-bow`: 0 differing pixels
  (max channel delta 0) on all nine sheets.
- Included baselines committed (`includedAvatarBaselines.test.ts`, Andrew,
  Annie and the VRM 0 fixture); adding the `issues` fields changed them only
  by empty `issues` arrays.
- Load-time correction path (`ANIMAMA_AVATAR_LOAD_TIMING=1 npx vitest run
  src/lib/avatar/avatarLoadTiming.test.ts`, median of 5 after 1 warm-up): Andrew
  57.3 ms (17 primitives, 3.37 ms each), Annie 45.3 ms (15, 3.02 ms each). The
  baseline for later phases.
- Production-build stack (`ANIMAMA_WEB_BUILD_MODE=production ./reset.sh
  --name arbvrm --base-port 8900`, built from this tree), 1440x900 and 900x800,
  light and forced dark: the dialog opened from Anima settings for Annie
  (Included, on the chat stage), Andrew (Included, loaded off screen from the
  Animas page, with its loading state) and a Local Avatar created through
  Create Anima's upload from the repository's VRM 0 test fixture; every section
  rendered real data, no warnings on the three. The pane denies clipboard
  writes, so Copy showed its failure notice there; the copy paths are covered
  by the dialog test. The stack showed `lookUp`–`lookRight` as missing on
  Avatars that look with bones; fixed (they count only for expression look-at)
  and covered in the collector test.

Commits: `feat(avatars)[p1]: add Avatar diagnostics and coded warnings`.

#### Code Review #1 Findings

Independent reviewer, standard tier, initial review of the working tree
`59032356` against `30b71570`; affected checks rerun by a checks agent (vitest
165 passed, tsc, lint, Prettier: pass).

- P1-R1-F1 (blocking): reports carried `effectId`, a runtime id that for a
  Local Avatar Effect is a slug of its user-entered name (`localContentLogicalKey`
  → `_runtime_id`), contrary to R7 and the reports' own privacy statement.
- P1-R1-F2 (blocking): `setExpressionOverlay` listed VRoid brow, eye and
  whole-face parts as unplayable although their mood preset plays them, and
  the clip path missed a part whose preset is also missing; the two paths
  disagreed.
- P1-R1-F3 (blocking): no test or recorded check that the real effect-skip
  path records its code or that the creator shows the notice.
- Optional: per-frame cost of the new name checks; truncated GLBs lose their
  JSON facts and invalid buffer-view offsets read wrongly; the creator's
  English detail is replaced by catalog wording; load errors are swallowed;
  `runtimeAvatarFacePartIssues` parses the correction a second time; the
  Local file's blob is held until close; a live reload shows "failed"; the
  hosted statement in the guide reads as tested; no
  `acquireContentPreviewResource` slot; `avatarIssueText` is shared across
  two feature folders.

#### Code Review #1 Revisions

- F1 accepted: shareable reports replace `effectId` with `effect`, the
  effect's `source:item_id` from the runtime snapshot, or `unlisted`
  (`AvatarEffectReference` in `avatarDiagnosticsReport.ts`); the dialog keeps
  the raw findings to name effects on screen. Report and hook tests use a
  name-derived id and assert it is absent from the JSON and text; docs and the
  `issues.ts` comment updated.
- F2 accepted: one rule for emotions, clips and overlays, applied to the names
  as requested: a name plays if the model has it, its ARKit mapping, or its
  VRoid part's mood preset; found names are cached, so per-frame overlays only
  look up a set (also answers the per-frame note). New test: Joy parts on a
  preset-only model are not listed; an angry part without `angry` is.
- F3 accepted: the existing real-path tests now assert the recorded codes
  (`effect_face_part_missing` from `reportUnavailableFacePart`,
  `effect_attachment_limit` from the fifth attachment). Live check on the
  stack: an effect painted on Eyelashes previewed on Annie (no detected
  eyelashes) shows the localized skip notice on the stage and as the toolbar's
  validation issue; the creator does not apply a skipped effect, so
  controller-coded lines appear there only for degraded applies, worded by the
  dialog-tested `avatarIssueText`.
- Optional, accepted: a truncated GLB keeps its complete chunks' facts and
  invalid offsets read nothing (test added); load and file errors are logged
  with the error; the content lease is released once its bytes are read; a
  reloading chat Avatar shows the loading state; the guide states hosted
  support as a design property.
- Optional, not taken: the second correction parse (one small `safeParse`;
  keeps the `Avatar.load` spec unchanged); the preview resource slot (a
  development-only counter for preview canvases; the dialog's Avatar renders
  nothing); moving `avatarIssueText` (no cycle). The creator's lost English
  detail goes to the owner's UI review.
- Rechecks after the repairs: vitest `src/lib/avatar src/ui tests/avatar`
  313 files, 3,251 passed, 2 skipped; tsc, `pnpm -s web:lint` and
  `pnpm -s prettier:check` pass. Targeted recheck: Code Review #2.

#### Code Review #2 Findings

Targeted recheck of tree `f7eb959a`: P1-R1-F1, F2 and F3 resolved; no
required findings. Optional:

- P1-R2-F1: the sidebar's Warnings count used the report's merged findings
  while the section lists the on-screen ones, which can differ.
- P1-R2-F2: `avatar-vfx.md` still called issue parameters "content item ids".

#### Code Review #2 Revisions

- P1-R2-F1 accepted: the count uses the on-screen findings.
- P1-R2-F2 accepted: the guide says "runtime effect ids" and that reports
  name effects by source and item id.
- Trivial repairs verified by the coordinator: `npx vitest run src/ui/animas`
  and tsc pass; the doc change is wording. Review passed; Phase 1 ready for the
  owner's UI review.

Owner UI review, 2026-10-26 (in progress): the Raw JSON view should expand and
collapse. Revised: the view is a tree (`ui/animas/JsonTree.tsx`) whose objects
and arrays are `aria-expanded` buttons, two levels open at first, with Expand
all and Collapse all beside Copy JSON (copy is unchanged). Dialog test covers
the toggles; `pnpm -s web:lint`, `i18n:check` and the `src/ui/animas` tests
pass.

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

Check record (2026-10-26, macOS arm64, worktree on `feat/arbitrary-vrm-support`
from `b3c94de6`):

- New tests: `faceParts.sharedMeshes.test.ts` (lash and line regions inside
  Annie's face mesh, each eye's largest region as its line without a line
  mesh, Andrew's face skinned 20% to the neck with a neck triangle, Annie
  without eye bones, painted-lash eye cleanup), `primitiveRegionHiding.test.ts`
  and a controller test hiding a lash region while an eye effect plays;
  Included baselines unchanged.
- Review renders against `b3c94de6`, enhanced and classic: `eye_confused_swirl`,
  `eye`, `eye_0`, `eye_o`, `eye_vv`, `star3`, `heart_eyes`, `knockout-x-eyes`,
  `blank-dot-eyes`, `blush`, `face_red`, `mouth_w`, `single_tear`,
  `texture_black_1`, `petrified_cracks`, `shiver_undereye`: 32 sheets at 0
  differing pixels (max channel delta 0).
- Load-time corrections, A/B/A against `b3c94de6` on a machine at load
  average 20–30 (another session's gate), medians: Andrew 99 ms before,
  101–104 ms after (17 primitives); Annie 73 ms before, 89–98 ms after (15).
  Under 2 ms per primitive; absolute times are inflated by the load.
- Private renders of the eye-hiding effects on the converted test Avatar
  (`effects:render --avatar-file`, kept in the private renders folder): the
  closed-lash strips that showed under Eye Confused Swirl and Heart Eyes are
  gone on all eight eye planes; faint thin lines remain at the lid edge (the
  face texture's painted crease or the lid's outline, not lash geometry), for
  the owner to judge.
- `npx vitest run src/lib/avatar src/ui tests/avatar` (`src/frontend/web`):
  315 files, 3,261 passed, 2 skipped; `pnpm -s check`, `pnpm -s web:lint`,
  `pnpm -s prettier:check` (`src/frontend`): pass.

Commits: `feat(avatars)[p2]: find eye details inside shared meshes and hide them`.

#### Code Review #1 Findings

Independent reviewer, standard tier, initial review of tree `a7a481ec` against
`b3c94de6`; findings confirmed by the reviewer's probes on the Included files.

- P2-R1-F1 (blocking): `setFacePartCorrections` re-detected parts while an
  effect still had regions hidden as degenerate triangles, so the regions
  vanished from the new map and stayed visible.
- P2-R1-F2 (blocking): the partly-head face rule let hair merged into the face
  mesh (head share 0.54–0.73) replace the head-skinned face, departing from
  "keep the 0.9 rule's result".
- P2-R1-F3 (blocking): eye layers found without eye bones needed only to overlap
  an eyelid, so a primitive reaching across both eyes became the irises.
- P2-R1-F4 (blocking): `eye_detail_not_hidden` could never fire, because
  unindexed primitives yielded no regions; the docs said it would.
- Optional: the Face parts panel called region-only parts Missing and
  correcting one drops its regions; Diagnostics showed regions only without
  bindings, worded unclearly; the middle-layer tie-break also applies with eye
  bones; Create Anima's digest also selects the eyelid-closure profile; hook
  order in `CreateAnimaStage`; lid boxes take every moved vertex (brows); a
  sliding eyelid cover could count as a lash; a corrected face with no
  head-majority vertices loses its bounds; `MeshUvLocator` caches the index;
  `DETAIL_REGION_ROLES` named highlights; "neck or jaw" in the guide.

#### Code Review #1 Revisions

- F1 accepted: `Avatar.setFacePartCorrections` calls the controller's new
  `restoreHiddenRegions()` first; the refresh re-applies the hiding. Test: a
  hidden region is found again on rebuild.
- F2 accepted: the partly-head rule needs a primitive blink moves and none on
  spring joints. Test: hair bound into Andrew's and Annie's blink and aa never
  becomes the face (fails without the rule).
- F3 accepted: such eye layers must lie within the eyelids' region plus a 25%
  margin. Test: with Annie's eye layers removed, a mouth triangle across both
  eyes is not taken as an eye (fails without the rule).
- F4 accepted: islands are found in unindexed primitives (triangles in vertex
  order), so their regions exist and the hider reports them. Tests: regions in
  an unindexed face; the controller reports `eye_detail_not_hidden` and still
  plays. Docs now say lines painted beside lash geometry are not cleaned up.
- Optional, accepted: the panel shows "Found inside another mesh part" and the
  guide notes that correcting replaces regions; Diagnostics shows regions with
  or without bindings ("2 inside shared parts"); the decisions record the
  tie-break and the eyelid-closure profile; hook order; bounds fall back to
  every vertex; highlights left out of `DETAIL_REGION_ROLES`; guide wording.
- Optional, not taken: lid-box outlier rejection and sliding-cover handling
  (speculative without a model that shows them); the locator cache (created
  outside hidden windows in practice).
- Rechecks: vitest `src/lib/avatar src/ui tests/avatar` 3,266 passed, 2
  skipped; `pnpm -s check`, `web:lint`, `prettier:check` pass; spot re-renders
  against `b3c94de6` (`eye_confused_swirl`, `heart_eyes`, `blush`, enhanced):
  0 differing pixels.

#### Code Review #2 Findings

Targeted recheck of tree `9c378c5c`: P2-R1-F1, F2 and F4 resolved; F3 resolved
for its scenario but:

- P2-R2-F1 (blocking): the eye region came from blink-moved vertices at rest,
  so on a face whose blink moves only the upper lids it covered the lid skin
  above the opening; iris and white fell outside it and the highlight became
  both eyes (reviewer's probe on Annie with the lower half of blink zeroed).

#### Code Review #2 Revisions

- P2-R2-F1 accepted: `measureLidBoxes` (shared by the eye fallback and the
  painted-lash cleanup) spans each moved vertex open and closed (rest plus its
  blink delta in anchor space), so the box covers the opening the lid closes
  over. Test: "finds the eyes when blink moves only the upper lids" (fails
  without the change: highlight taken as the eyes). `npx vitest run
  src/lib/avatar` 1,342 passed, 2 skipped; tsc and `pnpm -s web:lint` pass.
  Targeted recheck: Code Review #3.

#### Code Review #3 Findings

Final targeted recheck of tree `19af0753`: P2-R2-F1 resolved (the reviewer's
upper-lid probe now finds iris, highlight and white); no regression (Andrew
without eye bones now also finds the right layers, where the reviewed tree took
the white as the iris; Included Avatars never reach the changed code). Optional:
"moved" sums deltas and ignores bind weights; the `measureEyelidBounds`
docstring.

#### Code Review #3 Revisions

- Docstring updated (coordinator-verified wording fix). Bind weights left as
  they are: both Included Avatars bind one blink target per mesh, and a heavier
  closed position only enlarges the region slightly.
- Review passed. Phase 2 is agent-ready; the owner gate (private renders of
  the eye-hiding effects) is pending.

### Phase 3: Avatar settings: wind and materials

Review tier: high risk. A new table, API route and generated-client change,
package export and import, the per-frame spring update path, and the model
loader's material choice.

Requirements: R5, and R11's Materials setting (its Automatic GPU check comes in
Phase 9; until then Automatic means lilToon, today's behaviour). Depends on
Phase 1 (Diagnostics shows the effective modes),
D3 and D7 (decided).

Backend:

1. Contract and table: a spring mode enum `automatic | on | off | springs_off`
   and a material mode enum `automatic | liltoon | simple`
   (`app/contracts/avatar_settings.py`, new); table `avatar_setting_overrides`
   (owner, Avatar item, `spring_mode`, `material_mode`, `updated_at`; PK owner
   and item; FK to `content_catalog_items` with cascade; CHECKs on the enums;
   a missing value means Automatic) for Local and
   Included Avatars, ORM, `alembic/versions/0001_baseline.sql` and
   `_BASELINE_TABLES` (no Alembic revision; development databases are reset per
   `docs/backend/operations/development.md`), port, repository and a service
   modelled on `AvatarFacePartsService` without digest or revision binding (D3).
2. API: `GET/PUT /v1/avatar-content/{item_id}/settings` returning the
   effective values and their sources (stored, default), registered for the local
   composition only (`_local(...)` in `product_http/inventory.py`); the store is
   an optional, defaulted `ProductContent` member so the hosted composition
   still builds at repin; not projected into `PyRuntimeAvatar`. Regenerate the
   client from `src/frontend` with `pnpm openapi-ts` (never hand-edit
   `generated/`); `pnpm openapi-ts:check`.
3. Packages, with three rules because `_KIND_FIELDS` is one whitelist for Local
   sidecars, Local saves and package entries: export pops any document
   `spring_mode` and `material_mode` and writes the exporter's stored
   non-Automatic values (the
   face-parts pattern in `content_package_export.py`) and includes it in the
   export review digest, with no package capability (no backward
   compatibility needed, owner 2026-10-26); a Local save strips the key; import
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
   applies live without a remount. The material mode is part of the load
   instead, because materials are built at load: `AvatarLoadSpec` gains it;
   lilToon and Automatic keep `withOnDemandLilToon` as today, Simple skips it
   and builds the fallback materials; changing it reloads the Avatar on the
   surfaces that show it (the only setting change that does). The query and the settings row are gated to
   the local runtime (`useRuntimeCapabilities`, `runtime_kind`), so the hosted
   web app never calls the local-only route; a missing or failed query means
   Automatic and never blocks a load. Unsaved files (the Create Anima file
   preview) use Automatic.
8. Fallback base colours (moved here from Phase 9 so Simple is usable when it
   ships): materials that carry `MOCHIYA_materials_liltoon` data but render as
   fallback get `metallicFactor` 0 instead of glTF's default 1, which renders
   them dark.
9. UI: in the Anima settings panel, an Avatar section with "Wind and ambient
   forces" (Automatic, On, Off, Springs off) and, only for an Avatar whose file
   has lilToon materials (`usesLilToonMaterials` on the file facts), "Materials"
   (Automatic, lilToon, Simple; switching reloads the Avatar), noting that both
   apply to this Avatar wherever it is used; 5 locales. Diagnostics shows each
   effective mode, its source and, for Materials, why.

Checks: backend tests (save and read per owner, Local and Included, 404s and
ownership, package export with and without a value, import moving the value
into the table,
`tests/test_alembic_fresh_install.py`, `tests/test_product_http_inventory.py`,
a composition without the store drops an imported value with its notice);
`pnpm openapi-ts:check`; the hosted web build (`pnpm web:build:hosted`) and a
unit test that the settings query and row stay off under a hosted runtime
capability; frontend tests
(mode resolution, live switch without remount on the chat canvas, Springs off
holds rest and resumes, each listed surface applies the mode, the three-vrm pin
test; Materials row shown only for lilToon Avatars, Simple builds fallback
materials with base colours and no lilToon import, switching reloads); spring
snapshot tests show Automatic identical to today on Included
Avatars and a Mochiya-extension fixture; the full pre-push suite; the full
`pnpm e2e:test` on a built stack (package import and export).

Owner gate: live check of the four wind modes on the converted test Avatar and
an Included Avatar, on the chat canvas and the Anima page; the converted test
Avatar's Simple look (private renders) and switching between lilToon and
Simple; and the owner's acceptance of the Included Avatars' spring change in
the creators and review renders (see Code Review #1 Revisions): their hair and
Annie's cardigan bow now move under the chat's spring settings there, about 4%
of a review sheet's pixels. If the owner does not accept it, those surfaces
settle Included Avatars as before Phase 3 before the phase completes. Accepted
by the owner on 2026-10-27 (Decision Log).

Completion: R5 acceptance and R11's Materials-setting acceptance except the
Automatic GPU check; owner gate passed; a Cloud follow-up issue recorded
for the hosted migration, lifecycle, wiring and inventory, plus a backend
composition check at repin.

Recovery: the table and route are additive. A revert leaves stored values
unused, and packages exported with either setting would no longer import on
the reverted code (no compatibility handling, by owner decision).

Check record (2026-10-26, macOS arm64, worktree on `feat/arbitrary-vrm-support`
from `44c6b78e`; full suite on tree `6f139492`):

- Backend (a delegated subagent built steps 1–4; its results were read back):
  `tests/test_avatar_settings.py` (7: per-owner save and read for Local and
  Included Avatars, 404s and ownership, partial updates, package export with
  and without a value, import moving the value into the table, a composition
  without the store dropping it with its notice, 503 without the store),
  `tests/test_alembic_fresh_install.py` (8, with the table's constraints and
  cascade), `tests/test_product_http_inventory.py` (15, local-only routes);
  `pnpm openapi-ts:check` current.
- Frontend: `avatarSpringMode.test.ts` (Automatic identical to the previous
  path on Andrew, Annie and a Mochiya-extension Andrew; live switching; Springs
  off holds rest and resumes, pinned against three-vrm 3.5.2; fails without
  the per-frame reset); `lilToon.test.ts` (Simple builds fallbacks without
  importing lilToon, metalness 0 for lilToon fallbacks only, MToon kept on a
  VRM; fails without the plugin); `useAvatarSettings.test.tsx` (waits for a
  local read, hosted never calls the route, failure means Automatic without
  retry); `AnimaSettingsModal.test.tsx` (rows, Automatic saved as null,
  Materials only for lilToon files or a stored choice, none where the runtime
  keeps none); `ContentPreviewScene.test.tsx` (waits for the material setting,
  wind applies live, a material change reloads); Diagnostics dialog and hook
  tests (wind effect, materials state, setting sources); import review notice.
- Full pre-push suite on `6f139492`: `make check-test` 4,878 passed, 29
  skipped; `pnpm web:test:browser` 131 passed; `pnpm prettier:check`,
  `pnpm openapi-ts:check` pass. `pnpm verify` failed one new test, a timing
  flake under load (`useAvatarSettings.test.tsx` waited one tick for the
  query; it now waits for the result); 5,744 others passed. The first hosted
  build timed out waiting for a heavy-job slot; both were rerun on the
  repaired tree (Code Review #1 and #2 Revisions).
- Full `pnpm e2e:test` (`src/frontend`, through the heavy-job slot) on the
  disposable built stack `animama-arbvrm-e2e` (`ANIMAMA_LLM_SKIP=1`):
  - First run, on the `6f139492` build at load average 20–30: 27 passed, 14
    failed. A gesture save (10 s limit) and the complete-Anima import commit
    (90 s limit) timed out; the commit finished later and left 516 items, so
    every later test's exact cleanup failed. No backend errors were logged.
  - Second run, stack rebuilt with `--purge` from `4be7121d` (all later changes
    are tests, the `--thumbnail` guard and docs): 39 passed, 2 failed. "local
    content sharing single and multiple content export" clicked Edit while the
    Library re-rendered its search results and never navigated; "imported
    playback covers every supported content kind" lost its page context to a
    navigation in the scene-effect step. Both complete-Anima package journeys
    passed.
  - Both failures rerun alone (`--grep`): 3 passed (with setup). Every journey
    has passed on the final build.
- Review stack `animama-arbvrm` rebuilt with `--purge` from `3fb9686d`
  (production build, http://animama-arbvrm.localhost:8900): setting Annie's
  wind to Springs off in Anima settings stored `springs_off`, and Diagnostics,
  reading the chat stage's Avatar, showed "Springs off · springs held at rest ·
  Saved for this Avatar" without a reload; Materials stayed hidden for Annie;
  reset to Automatic afterwards. Private renders of the converted test Avatar
  with lilToon and Simple materials are in the private renders folder
  (`p3-materials`): Simple shows correct base colours.

Commits: `feat(avatars)[p3]: add per-Avatar wind and material settings`.

#### Code Review #1 Findings

Independent reviewer, high-risk tier, initial review of tree `d00a167b`
against `44c6b78e`, with a separate checks agent rerunning the affected checks.

- P3-R1-F1 (blocking): the plan's checks "live switch without remount on the
  chat canvas" and "each listed surface applies the mode" had tests only for
  `ContentPreviewScene`; nothing covered `AvatarCanvasActor`,
  `AnimaAvatarStage`, `useContentCreatorAvatar`, `PoseCreatorAvatarActor` or
  `CreateAnimaStage`, so moving `springMode` into a load effect's dependencies
  would remount the Avatar on every wind change unnoticed.
- P3-R1-F2 (blocking for the owner gate): no tool could render the converted
  test Avatar's Simple look; `effects:render` loads with Automatic only.
- P3-R1-F3 (optional): `CreateAnimaStage`'s actor kept the disposed scene in
  state while a material change reloaded it in the same actor.
- P3-R1-F4 (optional): Automatic ↔ lilToon reloads although both draw lilToon
  today.
- P3-R1-F5 (optional): the avatar-animation guide said surfaces never call
  `vrm.update` directly; zero-delta refreshes remain.
- P3-R1-F6 (optional): Diagnostics waits for the settings read even with a
  live chat Avatar, and a material change re-downloads the file for its facts.
- P3-R1-F7 (optional): `Avatar._createGLTFLoader` is a one-line pass-through.
- Verified without findings: ownership and 404s, the local-only route and
  hosted 503, concurrent partial updates, schema constraints, package rules,
  the hosted frontend gate, Springs off against three-vrm 3.5.2, the Simple
  loader, locales, repository boundaries and doc anchors.

#### Code Review #1 Revisions

- P3-R1-F1 accepted. Surface tests through a shared stand-in Avatar
  (`lib/avatar/testing/fakeSettingsAvatar.ts`):
  `AvatarCanvasActor.settings.test.tsx`, `AnimaAvatarStage.settings.test.tsx`,
  `useContentCreatorAvatar.test.tsx` (the three content creators),
  `PoseCreatorAvatarActor.settings.test.tsx` and
  `CreateAnimaStage.settings.test.tsx`. Each waits for the material setting,
  loads with both settings, applies a wind change to the same Avatar without a
  new load, and reloads for a material change. The chat-canvas test fails when
  `springMode` is put into the load effect's dependencies.
- P3-R1-F2 accepted: `effects:render --materials automatic|liltoon|simple`
  passes the material setting to the review Avatar (`session.ts`); documented
  in the avatar-vfx guide. `animation:render` keeps its own loader (not needed
  for the gate).
- P3-R1-F3 accepted: the actor's cleanup clears its scene object.
- P3-R1-F4 rejected: Phase 9's GPU check makes Automatic and lilToon differ,
  and the reload refreshes Diagnostics' reason; the switch is rare.
- P3-R1-F5 accepted: the guide now says every per-frame update goes through
  `updateModel` and zero-delta refreshes never step the springs.
- P3-R1-F6 and P3-R1-F7 rejected: the wait is one local read, a material change
  reloads the chat Avatar too, and the pass-through keeps `Avatar`'s cached
  loaders in one place.
- Found while repairing: every review-render session settles (and, without
  clip events, steps) through `updatePoseCreatorAvatarFrame`, so
  `effects:render` sheets with or without clip events, thumbnails
  (`--thumbnail`, `effects:thumbnails`) and animation reels now run the spring
  controller as the chat does, as do `pnpm -s effects check` captures and the
  `content:tune` preview (neither is compared with an earlier baseline);
  `animation:render` has its own loader and resets the springs, so it is
  unaffected. Measured on sheets without clip
  events against `44c6b78e`: `eye_confused_swirl`, `heart_eyes`, `blush`,
  `star3`, `single_tear`, `mouth_w`, `petrified_cracks` and `face_red` differ
  in 4.2% of pixels (enhanced) and 3.2% (classic), all in spring-driven hair
  and Annie's cardigan bow (diff images checked); effect pixels are unchanged
  and renders stay deterministic. The committed picker thumbnails were not
  regenerated; regenerated ones would differ in hair, so regenerate the set
  together rather than a few. This departs from the spec's "0 differing
  pixels" constraint for Included Avatars and is in Phase 3's owner gate.

#### Code Review #2 Findings

Independent reviewer, high-risk tier, targeted recheck of tree `4be7121d`
against `d00a167b`. P3-R1-F1, F2, F3 and F5 resolved; the rejections of F4, F6
and F7 hold.

- P3-R2-F1 (required): the "Found while repairing" note limited the render
  change to sheets without clip events; every session settles through the
  Pose creator frame helper, so sheets with events, thumbnails and reels
  change too.
- P3-R2-F2 (required, owner decision): the measured change to Included
  Avatars' review renders departs from the spec's "0 differing pixels unless
  the owner accepts a specific change" constraint, and no owner acceptance was
  recorded.
- P3-R2-F3 (optional): the chat-canvas test defines its own stand-in Avatar,
  although the Revisions say the surface tests share one.
- P3-R2-F4 (optional): no test changes the wind while a load is pending, the
  case each surface's `scene`/`sceneObject` dependency exists for.
- P3-R2-F5 (optional): `fakeAvatarLoads`'s comment mentions wind changes it
  does not return.
- P3-R2-F6 (optional): `--materials` is silently ignored with `--thumbnail`.
- P3-R2-F7 (optional): the mocked `useAvatarLoadSettings` ignores the item id,
  so no test pins which Avatar item a surface reads.

#### Code Review #2 Revisions

- P3-R2-F1 accepted: the note now names every affected session and the
  unaffected `animation:render`, and that the committed thumbnails were not
  regenerated.
- P3-R2-F2 accepted: the change is in Phase 3's owner gate for explicit
  acceptance; without it, the earlier settle behaviour returns for Included
  Avatars before Phase 3 completes.
- P3-R2-F3 accepted: the chat-canvas test uses the shared stand-in.
- P3-R2-F4 accepted: the chat-canvas test changes the wind while the Avatar
  loads and expects it applied once ready; it fails without the live effect's
  `sceneObject` dependency.
- P3-R2-F5 accepted: comment corrected.
- P3-R2-F6 accepted: `--materials` with `--thumbnail` is an error, as
  `--avatar-file` is.
- P3-R2-F7 accepted: the stand-in hook records the item each surface reads,
  and every surface test asserts it (`avatar-1`, or Create Anima's saved item).
- Checks on the repaired tree `179daaa2` (`src/frontend/web`): the five
  surface tests (7 tests) pass; `tsc -p tsconfig.app.json` and `tsconfig.scripts.json`, eslint
  and prettier on the changed files pass; `effects:render --materials simple
  --thumbnail` exits 2 with the new message. The full frontend suite passed on
  `4be7121d` just before these test-only and option-guard changes:
  `pnpm verify` 5,751 passed, `pnpm web:test:browser` 131 passed,
  `pnpm prettier:check`, `pnpm web:build:hosted`.

#### Code Review #3 Findings

Independent reviewer, high-risk tier, final targeted recheck of tree
`179daaa2` against `4be7121d`: P3-R2-F1 to F7 resolved, no regressions, no
required findings; it reran the five surface tests (7 passed), eslint, both
tsc configurations and the `--materials`/`--thumbnail` guard. Optional:
P3-R3-F1 (the check record still said two reruns were pending, and the round 2
checks gave no tree), P3-R3-F2 (`effects check` and `content:tune` also settle
through the review session), P3-R3-F3 (say what a rejected spring change
means).

#### Code Review #3 Revisions

- P3-R3-F1, F2 and F3 accepted as record changes: the check record, the
  "Found while repairing" note and the owner gate now say so. Review passed;
  Phase 3 is ready for the owner gate once the full e2e run passes.


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
shaping, and of a surprised face while speaking on an MMD model (its お and
`oh` viseme may bind one morph); confirmation that a partly covered mood keeps
the file's own preset whole (Decision Log); acceptance of the one-pixel
`double-take` render difference (check record).

Completion: R4 and R12 acceptance; owner gate passed.

Recovery: load-time registration only.

Check record (2026-10-27, macOS arm64, worktree on
`feat/arbitrary-vrm-support-pr-b` from `06d381c9`):

- New tests: `mmdFaceExpressions.test.ts` (each mapped region plays its MMD
  morph; a mood MMD covers fully is composed and replaces the authored
  preset, one it covers partly keeps the preset while its MMD region still
  plays for a part; MMD plus ARKit fills sad's eyes and mouth from ARKit with
  ARKit's brows still; positive emotions smile with にっこり; `Fcl_MTH_Large`
  reported without `jawOpen`; blink stays within shut under 笑い; the `aa`
  viseme stays still for moods), `includedFaceNames.test.ts` (every one of the
  18 `Fcl_*` names in `content/included` plays on a preset-only model or is
  reported, and only mouth parts are reported; a model with only a blink and
  visemes stays neutral, shows no viseme motion for moods and gets
  `face_expressions_none`; `Fcl_EYE_Iris_Hide` reports its held state and a
  model's own shape wins) and a `facial-controls.test.ts` case (irises hidden
  while held, counted with an effect that hides them, re-hidden after the
  bindings rebuild). Updated: the ARKit per-region rules
  (`arkitFaceExpressions.test.ts`: a missing table shape now leaves only its
  region; a partly covered mood keeps the authored preset; the Perfect Sync
  fixture has all VRoid parts) and eyelid closure (`eyelidClosure.test.ts`:
  measured shares on a non-VRoid model; VRoid faces keep the default).
  Included baselines unchanged.
- `npx vitest run src/lib/avatar src/ui tests/avatar` (`src/frontend/web`):
  331 files, 3,320 passed, 2 skipped; `node --test scripts/vrm-inspect.test.mjs
  scripts/vrm-bake-expressions.test.mjs`: 10 passed; tsc (`tsconfig.app.json`,
  `tsconfig.scripts.json`), `pnpm -s web:lint`, `pnpm -s i18n:check`: pass;
  Prettier on the changed files: pass.
- Review renders, `06d381c9` against the phase end, enhanced and classic:
  `effects:render` with `--expression` happy, relaxed, sad, angry,
  surprised and `Fcl_MTH_Fun`, and `--with-clip` Reactions `joy-3`,
  `amusement-2`, `sadness-2`, `anger-2`, `fear-2`, `embarrassment-2` and the
  Gestures `shy-finger-poke-loop` and `double-take`: 27 of 28 sheets at 0
  differing pixels. `double-take` (enhanced) differs in one pixel (Andrew's
  face tile at 2 s, channel delta 19), reproducibly; the phase-start
  `AvatarVFXController.ts` gives 0, and so does no change, but an inert edit
  of that module (an unused constant) gives the same pixel, so it is render
  timing, not behaviour. (One sheet failed once when a source edit reloaded
  the review page mid-run; rerendered.)
- Load-time corrections (`avatarLoadTiming.test.ts`, median of 5): Andrew
  56.9 ms before, 56.5 ms after (17 primitives); Annie 45.4 ms before, 46.2 ms
  after (15).
- `vrm:inspect` on the converted test Avatar (private): every MMD standard
  morph and 52 of 52 ARKit shapes; happy, relaxed and surprised play MMD in
  all three regions, sad an MMD brow with ARKit eyes and mouth, angry MMD
  brows and eyes with an ARKit mouth.

Commits: `feat(avatars)[p4]: play moods from MMD morphs and ARKit mixes region by region`

#### Code Review #1 Findings

Independent reviewer, standard tier, initial review of working tree `cc5c3be2`
against `06d381c9`; it reran the full avatar and UI vitest set (3,320 passed),
the script tests, both tsc configurations and eslint on the changed files, and
probed empty presets out of tree.

- P4-R1-F1 (blocking): the measured eyelid share (an average along blink's
  motion) understates arc-shaped smiling eyes, which the Decision Log itself
  shows for VRoid (0.62 where 1 is needed); MMD 笑い is that shape, and a
  non-VRoid model's closing `happy` dropped from 1 to its share. The only test
  used a linear fixture.
- P4-R1-F2 (blocking): three-vrm registers every preset, so an empty preset
  counted as the file's own: a partly covered mood kept it whole and played
  nothing, nothing was reported, and a model with only empty presets got no
  `face_expressions_none`.
- P4-R1-F3 (blocking): `Fcl_EYE_Iris_Hide` always counted as resolved, but
  hiding nothing (no iris, or an iris in the face skin's primitive) was never
  reported.
- P4-R1-F4 (blocking, trivial): `avatar-animation.md` (two passages) and
  `vrm-bake-expressions.mjs` (header, JSDoc, comment and rule) still described
  the per-Avatar ARKit rule and VRoid constants for every model.
- Optional: お may share a morph with the `oh` viseme (add to the live
  check); a partly covered mood keeping the preset departs from the literal
  region order (owner confirmation); the one-pixel render difference needs
  owner acceptance; `coversArkitTable` and `MmdFace.parts` unused; MMD binding
  duplicated `registerMorphExpression`; `isAnimamaFaceExpression` left out the
  iris expression; delight's two smile parts bind にっこり twice (mirrors ARKit).

#### Code Review #1 Revisions

- F1 accepted. Measured: on Annie happy shares 0.62 of blink's motion on
  average and 0.69 at the lid's own vertices (90th percentile of per-vertex
  shares where blink moves at least a quarter of its furthest vertex); relaxed
  0.145; on Andrew 0.75 and 0.13; on the converted test Avatar (private) 笑い
  0.98 and なごみ 0.91 at the lid. Non-ARKit expressions now correct by that
  lid share divided by Annie's happy (0.69), which reproduces her verified
  relaxed (0.21 against 0.2164) and Andrew's default (0.19 against 0.2) and
  gives the converted Avatar's 笑い full suppression; ARKit mixes keep #688's
  share. New test: the calibration reproduces Annie's verified profile; the
  笑い fixture expects blink below the remaining 0.4. `avatar-emotion.md`
  reworded.
- F2 accepted: a preset that binds nothing counts as absent for region
  sources, keeping a preset whole and the neutral-face finding, and an
  expression that binds nothing (except `neutral`) counts as unresolved.
  Tests: empty presets on an MMD model (sad plays 困る), only empty presets
  (`face_expressions_none`, sad and `Fcl_EYE_Sorrow` reported); the controller
  test mock now returns bound expressions.
- F3 accepted: `setIrisHidden(true)` hiding nothing records
  `iris_hide_unavailable` (5 locales). Test: a controller without iris parts.
- F4 accepted: both passages and the bake script updated; the bake rule is now
  per mood (a mood whose shapes all resolve is composed by the app).
- Optional, accepted: the live-check and owner items added to the owner gate;
  `coversArkitTable` and its test removed; `registerMmdFace` returns nothing
  and binds through `morphTargetExpression` (`morphTargetExpressions.ts`);
  the iris expression counts as Animama's. Not taken: delight's double smile
  (the ARKit mixes do the same; the R4 render shows it).
- Rechecks on the repaired tree: `npx vitest run src/lib/avatar src/ui
  tests/avatar` 332 files, 3,321 passed, 2 skipped, with the two controller
  failures above fixed and their suite rerun (`tests/avatar` and the
  controller tests, 331 passed); script tests 10 passed; both tsc
  configurations, `web:lint` and `i18n:check` pass; `expr-happy`, `joy-3` and
  `shy-finger-poke-loop` (enhanced) rerendered at 0 differing pixels against
  `06d381c9`. Targeted recheck: Code Review #2.

#### Code Review #2 Findings

Targeted recheck of working tree `e8f2eb97`: P4-R1-F1 to F4 and the accepted
optional items resolved, no blocking regressions. The reviewer reran the full
avatar and UI vitest set (331 files, 3,323 passed, 2 skipped), the script
tests, both tsc configurations, eslint on the changed files and
`i18n:check`, and repeated the calibration and empty-preset probes. Optional:
a composite of MMD and ARKit regions is measured as a composite even when its
eye region is an ARKit `eyeBlink` mix (on the converted test Avatar `sad`
corrects 0.29 instead of 0.20, so blinks during sad stop at about 91% closed);
`ARKIT_COMPOSITION_SHAPES` and `measureEyelidClosure` are now test-only; an
empty authored preset is still listed as present (pre-existing).

#### Code Review #2 Revisions

- The composite's measurement is kept: it errs toward lids that never pass
  shut, and the owner's mood renders and live check cover the look. The other
  optional notes are left as they are.
- Review passed. Phase 4 is agent-ready; the owner gate is pending.

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

Check record (2026-10-27, macOS arm64, worktree on
`feat/arbitrary-vrm-support-pr-b` from `dc5dc5f2`):

- New `poses/anatomy/handRest.test.ts` on a synthetic VRM 1.0 humanoid whose
  hand rests bent 30° and rolled 20°: VRoid-like hands and both Included
  Avatars are left alone (no normalization, three-vrm's own `update`); the
  turned hand rests as VRoid's; a curl and a thumb raise bend as on VRoid
  while the authored rotations stay as written; thumbs-up, fist and point
  hand shapes (`handShapeRotations`, thumb fits included) match VRoid's; the
  contact solver's forward kinematics put the fingertip on the drawn one
  (within 0.1 mm), and
  a pose reset keeps the normalized hand's shape; `prepareLoadedVrm` installs
  it and `animation:render`'s `render.ts` loads through `prepareLoadedVrm`.
- `npx vitest run src/lib/avatar src/ui tests/avatar` (`src/frontend/web`):
  332 files, 3,331 passed, 2 skipped; tsc (`tsconfig.app.json`), eslint and
  Prettier on the changed files: pass.
- `animation:render` of Double Thumbs Up, Count on Fingers, Cheeky Finger
  Guns and Double Peace Pop, body and right-hand views, `dc5dc5f2` against the
  phase end: 8 sheets at 0 differing pixels.
- Load-time corrections (median of 5): Andrew 58.9 ms (Phase 4 end 56.5),
  Annie 47.3 ms (46.2), measured at load average 7 from other sessions; the
  added measurement is 32 frame comparisons.
- Private: the converted test Avatar is normalized (38° at most, 32 bones);
  its Double Thumbs Up, Count on Fingers, Cheeky Finger Guns and Double Peace
  Pop hand renders are in the private renders folder (`p5-hands`): thumbs up,
  fists and pointing read correctly, for the owner gate.

Commits: `feat(avatars)[p5]: normalize hands that rest unlike VRoid's`

#### Code Review #1 Findings

Independent reviewer, standard tier, initial review of working tree `cec89ecb`
against `dc5dc5f2`. It confirmed the design argument by probe (random raw rest
rotations, extra non-humanoid nodes, VRM 1 and VRM 0, both hands, random poses:
normalized and drawn joints within 1.1e-15 m) and the Included margins (Annie
0.04°, Andrew 0.16°, the VRM 0 fixture 0.19°).

- P5-R1-F1 (blocking): the chain assumed every finger bone exists. A digit
  with an unmapped intermediate bone, or a thumb without a metacarpal (three-vrm
  produces that for some VRM 0 files), was left uncorrected under a corrected
  hand, with its offsets turned by an absent parent: joints up to 50 mm from
  the drawn ones and curls 10–16° off.
- P5-R1-F2 (blocking): the Checks ask for a catalog pose and talking hands;
  neither had a case, and the fingertip case compares forward kinematics with
  the drawn tip rather than solving a contact.
- Optional: no VRM 0 or right-hand case; the guide listed the motion checks
  (which load without `prepareLoadedVrm`) among readers; `handRestNormalizationOf`
  only served the test; no load log line; `frameRotation` degenerates when a
  segment runs along the palm normal; the `render.ts` check is a source match.

#### Code Review #1 Revisions

- F1 accepted: each digit's present bones are measured from the nearest
  present one before it, as three-vrm parents them; a bone with nothing to
  measure follows its parent rigidly; offsets and the wrapper use those
  parents (`bones` map with `parent`). Tests: without an intermediate bone and
  without a metacarpal, normalized and drawn joints agree (under 1 µm) and the
  index and thumb bend as on VRoid (both fail on the reviewed tree, per the
  reviewer's probe).
- F2 accepted: a `relaxedRest` case through `applyCanonicalPose` (the motion
  checks' and playback's path) matches VRoid's bends; talking hands write the
  same normalized rotations and pass through the same wrapper, which the
  rig-level tests cover, so they get no case of their own. The record now
  calls the fingertip case a forward-kinematics check: the contact solver uses
  that FK.
- Optional, accepted: the VRM 0 fixture joins the left-alone case (both hands
  are measured on every model); guide wording; `handRestNormalizationOf`
  removed; `Avatar.load` logs a normalization; `frameRotation` returns
  identity without a frame. Not taken: a turned VRM 0 rig (the reviewer's
  probe found it within 1.42°) and a runtime check of `render.ts` (a browser
  script; the source check stays).
- Rechecks: `npx vitest run src/lib/avatar/poses src/lib/avatar/prepareLoadedVrm.test.ts
  src/lib/avatar/avatarLoadTiming.test.ts src/lib/avatar/includedAvatarBaselines.test.ts
  tests/avatar` 38 files, 788 passed; tsc and eslint on the changed files pass
  (working tree `e49ec26d`). Targeted recheck: Code Review #2.

#### Code Review #2 Findings

Targeted recheck of working tree `e49ec26d`: P5-R1-F1 and F2 resolved, no
regressions. The reviewer's probe covered seven combinations of unmapped
bones on both hands, VRM 1 and VRM 0 (normalized and drawn joints within
7.3e-16 m; bends within 1.2° of a VRoid-like rig missing the same bones), the
unchanged full chains and the degenerate-frame fallback. Optional: the module
comment still listed the motion checks; the check record named no trees.

#### Code Review #2 Revisions

- The module comment now names Pose creator markers instead (wording,
  verified by reading); the review rechecks name their tree. Review passed.
  Phase 5 is agent-ready; the owner gate is pending.

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

Delivered: `full` art on a `face_skin` binding is clipped (a cached `Path2D`
per binding and slot in `drawCompositedLayerCanvas`) to the face skin's own
triangles on that image: the face's UV island (`selectFaceIsland`, shared with
the anchors) plus islands outside its front-view outline (VRoid's ears), less
the part map's eye-line and lash `regions` and, in a face primitive under 90%
head-weighted, triangles not weighted to the head; the clip is made only when
the image is shared with another primitive or those rules drop triangles, so
VRoid faces on their own texture (the Included Avatars) draw as before. An
opaque clipped replacement hides the original only inside its clip.
`textureUvMapping.ts` maps UVs to image positions through `Texture.matrix`
(three-vrm fills it from `KHR_texture_transform` and VRM 0 `_MainTex_ST`) and
the wrap modes, for face anchors, `meshUvLocator.ts`, the clip and iris
rectangles; the creator's surface hits map through the transform. Mirrored
iris UVs are detected per eye and flipped per cell in `resolveIrisEyeLayout`
(compositor, guides and drag handles). Docs: `avatar-vfx.md`.

Check record (2026-10-27, macOS arm64, worktree `feat/arbitrary-vrm-support-p6`
from `1ae2f37e`, final tree `dc7a0c22`): `npx vitest run src/lib/avatar src/ui
tests/avatar` (`src/frontend/web`) 334 files passed, 1 skipped, 3,367 tests
passed; `npx tsc -p tsconfig.app.json --noEmit` and `pnpm -s web:lint` exit 0;
Prettier on the changed TS clean; Included renders of 12 painted and iris
effects (face_red, texture_black_1, petrified_cracks, pale_blue_shade,
texture_sick_1, blush, blush_band, mouth_w, single_tear, star3, heart_eyes,
eye_confused_swirl) in both looks, `1ae2f37e` against `dc7a0c22`: 24 sheets at
0 differing pixels. Merged into PR B (`90087fc7`): `tsc` and the same vitest
set (337 files, 3,391 passed). Private renders on a converted model: not made
(optional for this phase).

Commits: `feat(avatars)[p6]: keep painted face art on the face's own texture region`,
`fix(avatars)[p6]: clip whole-face art to the face island inside shared primitives`

#### Code Review #1 Findings

Independent reviewer, standard tier, on `76774ad9`. Verified correct: the UV
mapping against three's shader (matrix, then wrap, mirrored repeat and
negative tiles), `flipY`, the VRM 0 tiling port, the atlas test on shared
image sources, winding, iris mirroring, cache invalidation, the
`readPrimitiveVertexOrder` refactor and the licence boundary.

- P6-R1-F1 (blocking): the clip kept every head-weighted triangle of a face
  primitive, so an inner mouth, teeth, eyes or lash regions inside it still
  took whole-face art; a head-skinned face primitive with an inner mouth on its
  own texture got no clip; lash regions hidden by an eye effect made the cached
  clip depend on order.
- Optional: F2 the clip was retraced on every 30 Hz redraw; F3 a clipped
  static replacement in a later segment let the original show through its
  transparent pixels; F4/F5 docs precision (growth, mip seams, the VRoid
  claim); F6 records and departures; F7 an unused helper.

#### Code Review #1 Revisions

- F1 accepted, with one departure: the clip keeps the face's island plus
  islands outside its front-view outline, not the face island alone, because
  VRoid's ears are separate islands (the face island is 3,288 of 4,232
  triangles on the Included faces) and a face-island-only rule would clip the
  Included Avatars. Eye-line and lash regions are removed by triangle number
  before the island search, so hidden regions cannot change the clip. Tests:
  an inner-mouth island and lash strands inside Annie's face primitive, a
  hidden-lash equivalence, a region unit test and the VRoid face kept whole.
- F2, F3, F4, F5 and F7 accepted (a cached `Path2D`; segment 0 clears the
  original inside each opaque clipped replacement; docs; helper removed).
- F6 departures recorded here: `readPrimitiveVertexOrder` and an exported
  `selectFaceIsland` instead of exporting `selectFaceIslandTriangles` as is;
  iris rectangles map through the iris texture's own transform; the creator's
  surface hits map through the transform.

#### Code Review #2 Findings

Targeted recheck of `9dbf00c2`: every round-1 finding resolved; the outer-island
rule accepted as a sound reading of R2 ("its UV island or islands"; VRoid's
ears are face skin), orientation-safe on VRM 0. Mutation runs confirmed the
tests discriminate (face island only fails 7; no region removal, no island
selection, no head filter, `complete` forced and no base clear each fail at
least one), except that nothing tests the `baseClips` rebuild trigger.
Optional: that test; two doc precision notes (the main-files row; the head
filter applies under 90% head-weighted); an image whose UVs or positions are
interleaved stays unclipped; the island analysis runs per slot and could be
cached per binding.

#### Code Review #2 Revisions

- Both doc notes taken (verified by reading). Not taken, recorded as
  follow-ups: a `baseClips` trigger test (its path is exercised only when a
  clipped replacement's opacity crosses 1) and caching the selection per
  binding (a one-time cost per face slot). Interleaved attributes already keep
  the face pipeline off, as before.

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
renders on the converted test Avatar. Added at Phase 7 (review P7-R1-F3): the
R10 departure (non-VRoid MToon models keep authored materials under the
enhanced lights, instead of step 3's role-based retune; see the Decision Log).

Completion: R9 and R10 acceptance; owner gate passed.

Recovery: load-time only.

Delivered (see the Decision Log for the choices): arm rest normalization in
`poses/anatomy/restNormalization.ts` (renamed from `handRest.ts`), with the
measurement on `Avatar.restPose` and in Avatar Diagnostics (Motion, "Rest
pose"); body effects scaled by `avatarScale` outside the proposed 0.91–1.2
band (`AvatarAttachmentEffects.ts`); contacts unchanged; enhanced MToon retune
limited to VRoid exports (`mtoonPatch.ts`), every other model consistently
authored; docs in `avatar-animation.md`, `avatar-vfx.md` and
`anima-management.md`.

Check record (2026-10-27, macOS arm64, worktree on
`feat/arbitrary-vrm-support-pr-b` from `1ae2f37e`):

- Unit tests: a 40° A-pose synthetic model is normalized and plays a Gesture
  as the T-pose one does (`restNormalization.test.ts`); body effects keep
  factor 1 at the Included sizes and band edges and scale offset and size
  together on a 1.6× synthetic model (`AvatarAttachmentEffects.test.ts`); a
  1.5× copy of Annie's skeleton solves the same arm turn for a chin contact
  (`arms.test.ts`, "contact scale"); a non-VRoid MToon material set with
  VRoid-like suffixes keeps every material authored (`mtoonPatch.test.ts`).
- Mixed-look check on real data, standing in for the planned render check
  (it compares every built material's parameters, which a render cannot):
  the app's patched loader on copies of Annie and Andrew with VRoid's face
  marker renamed retunes 0 materials (the previous patch would have retuned
  14 and 18 beside authored ones); the originals still retune 18 and 20, as
  before.
- `npx vitest run src/lib/avatar src/ui/animas src/ui/avatar-effect-creator`
  (`src/frontend/web`): 118 files, 1,526 passed, 2 skipped; `tsc -p
  tsconfig.app.json`, eslint on the changed files and `pnpm i18n:check`
  (`src/frontend`): pass.
- Included renders, `1ae2f37e` against the phase end (source tree
  `b4026e1e`): six moods and four Reaction/Gesture clips in both looks,
  four body-plane effects (`rawr_lettering_chest`, `heart_pop`, `glowstick`,
  `cupid_arrow_stuck`) and four hand Gestures (body and right-hand views):
  32 sheets at 0 differing pixels. One (Shy Finger Poke, classic) first
  differed by 4 pixels; two reruns of the same source gave 4 and 0, so it is
  render timing.
- Load-time corrections (median of 5): Andrew 55.4 ms, Annie 46.1 ms (Phase 5
  end 58.9 and 47.3), at load average 5.
- Private: the converted test Avatar's T-pose export rests within 5° of a
  T-pose (arms not normalized; hands normalized against the forearm, 32
  bones) and its size is inside the band. An A-pose export of the same
  Avatar (`-animamaKeepPose`, private) measures 48° (arms normalized, hands
  41° against the forearm, 36 bones). Double Thumbs Up, Count on Fingers,
  Cheeky Finger Guns and Double Peace Pop on both exports, body and
  right-hand views, are in the private renders folder (`p7-arms`) for the
  owner gate: thumbs up, pointing and palms read the same on both; the
  sheets differ by 1.3–1.6% (body) and 21–24% (hand close-ups, framing and
  sleeve shifts), from the exports' different skin bindings.
- After Code Review #1 (tree `75abdbb5`): `restNormalization.test.ts`
  15 passed; the same vitest set 118 files, 1,529 passed, 2 skipped; tsc,
  eslint and Prettier on the changed files pass; the eight Included Gesture
  sheets again at 0 differing pixels against `1ae2f37e`.

Commits: `feat(avatars)[p7]: normalize A-posed arms and size body effects by the Avatar`

#### Code Review #1 Findings

Independent reviewer, standard tier, initial review of working tree `5063845c`
against `1ae2f37e`. Body-effect scaling was verified correct (VRM 0 yaw,
`facing: "bone"` and camera billboards, the creator's offset frame, drags,
resizes and live transform updates); the licence boundary holds.

- P7-R1-F1 (blocking): with the arms normalized, a hand that cannot be
  measured (no little finger, or no finger bones) stayed out of the
  correction under a corrected forearm: its normalized joints sat 0.137 m
  from the drawn ones on a 40° A-pose probe and wrist poses bent 11.9° off.
- P7-R1-F2 (blocking): `vrchat-avatar-conversion.md` still said an A-pose
  export plays Gestures with the arms too low, and that the Gesture renders
  show the rest pose.
- P7-R1-F3 (record): the R10 departure was not in the owner gate.
- P7-R1-F4 (owner gate): normalization landed, but no Gesture renders on a
  real A-pose export; the only evidence was a synthetic rig.
- Optional: F5 hands were measured absolutely, so an arm 5–10° off (within
  its tolerance) counted against the hand (an 8° wrist kink on a probe) and
  Diagnostics' hand figure included the arm angle; F6 the A-pose test's
  0.02 rad tolerance and missing hand rotation; F7 no Diagnostics or report
  test of the rest-pose text; F8 a non-positive head height would scale
  body effects to zero, and the scale guard repeats `prepareV2`'s; F9 the
  render check is a loader count (say so); the creator's "centimetres" hint
  is reference centimetres outside the band; locale key order.

#### Code Review #1 Revisions

- F1 accepted: hands are collected per side first; under a corrected forearm
  the hand and its present fingers take the forearm's correction (rigidly
  when the palm cannot be measured), parented as three-vrm parents them.
  Tests: A-posed rigs without a little finger and without finger bones keep
  normalized and drawn joints within 1 µm and bend the wrist as the T-pose
  rig does (within 1e-5 rad); both fail on the reviewed tree.
- F5 accepted with F1: each hand is measured against VRoid's carried by its
  own forearm's rest direction, and a corrected forearm adds the hand's own
  correction only when the hands exceed their tolerance (otherwise an A-posed
  VRoid-like hand would be straightened by its sub-tolerance residual).
  `handsNormalized` now means the hands themselves were corrected. Test: arms
  8° down with the hand along the forearm report the same hand angle as the
  level rig and install nothing. The converted test Avatar's hand correction
  is now 40.8° against its forearm (was 38° absolute; its forearm rests 4.5°
  up), so its private hand renders are redone for the gate.
- F6 accepted: the A-pose test now uses unit quaternions, a wrist rotation,
  the hand-to-finger direction and a 1e-5 rad tolerance.
- F2 accepted: the guide describes load-time normalization and points to
  Diagnostics' "Rest pose"; the Gesture renders no longer serve as the check.
  The rewritten sentence also drops the model's name.
- F3 accepted: the owner gate lists the R10 departure and its "authored
  materials under the enhanced lights" reading.
- F4 accepted: see the check record's private renders.
- F7 accepted: the dialog test shows an A-pose rest pose; the report test
  checks Andrew's measured T-pose and the normalized wording.
- F8 accepted in part: a non-finite or non-positive size keeps factor 1.
  Not taken: sharing the guard with `prepareV2`, which builds its own
  skeleton for the solvers anyway.
- F9 accepted: the check record calls the mixed-look check a loader count
  standing in for a render (stronger: it compares every material's
  parameters).
- Not taken: the creator hint (reference centimetres is what the creator
  edits on every model) and locale key order (style only).
- Licence: the Decision Log's figures for the converted test Avatar are now
  qualitative.

#### Code Review #2 Findings

Targeted recheck of tree `75abdbb5`: every round-1 finding resolved, no
blocking findings. A probe of 300 combinations (both sides, VRM 0 and 1, five
arm rests, three hand rests, five bone sets, a pose touching every chain) kept
normalized and drawn joints within 7.4e-16 m and posed directions with the
reference rig; the new tests fail on the round-1 code. Against `1ae2f37e`'s
hand normalization, a level forearm gives identical bones, parents and
rotations; a tilted one differs by exactly its tilt, as F5 intends. Optional:
N1 the `handDegrees`/`handsNormalized` doc comments; N2 an antecedent in the
guide; N3 the dialog's null rest-pose branch lost its assertion; N4 an
unmeasurable hand reports 0°; N5 the check record's angles for the converted
test Avatar (Phase 5's record set the precedent; the owner's call); N6 name
the check tree.

#### Code Review #2 Revisions

- N1, N2 and N6 taken (comments, wording and tree only; verified by the
  rest-normalization tests and `tsc`). N4 is now stated in the doc comment
  rather than changed. N3 taken in the report test (a rest pose not checked);
  the dialog's matching branch is one ternary over the same value. N5 left
  for the owner gate.

### Phase 8: Package sharing

Review tier: high risk. Package format contract and the model loaders.

Requirements: R13. Depends on Phase 1 (pre-load diagnostics) and D4.

Changes:

1. Backend: add `MOCHIYA_avatar_composition`, `MOCHIYA_materials_liltoon`,
   `EXT_meshopt_compression` and `KHR_draco_mesh_compression` to
   `_GLTF_EXTENSIONS`, with no package capability (owner, 2026-10-26); update
   the test that asserts Draco refusal.
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
extension; a meshopt-
compressed synthetic GLB loads in a vitest loader test; the Draco path test; the
full pre-push suite; the full `pnpm e2e:test`.

Owner gate: none beyond merge.

Completion: R13 acceptance.

Recovery: the allowlist change is additive; reverting it makes packages with
these Avatars fail to import again.

Delivered: package validation (`_GLTF_EXTENSIONS`) accepts the four
extensions and `VRMC_springBone_extended_collider` (which `vrm:optimize`
keeps); one shared `configureAvatarGltfLoader` gives every Avatar loader (app,
headless, `animation:render`, the `vrm:optimize` compare page) the meshopt
decoder, imported only for a file that uses or requires meshopt, and fails a
file whose required extensions the runtime cannot load, naming them; one web
list (`avatarGltfExtensions.ts`) drives that and Diagnostics' pre-load finding
`avatar_extension_unsupported`; the import review marks such an Avatar with
the notice `avatar_extension_unsupported` (a new `ImportItemNotice` value) before the user
confirms; a shared fixture pins the backend list to the web loaders' list plus
the undecoded one (Draco, accepted and reported per D4). Docs: backend
`custom-animas-and-content.md` and `http-api.md`, `vrchat-avatar-conversion.md`,
`vrm-optimization.md`.

Contract: the new notice value changes the local HTTP schema and the
generated client, so PR B needs local-http 18.0.0 and runtime-contracts 0.18.0
relative to `main` after PR A (checked with `package_set.py compare` at PR
time).

Cloud repin note: hosted content-only package import is live (Cloud runs the
shared `ContentPackageService` with Anima import disabled), so on repin the
allowlist and the import notice take effect there: a meshopt, Draco or
converter Avatar in a content package is accepted, and a Draco one shows the
notice. Until then Cloud's backend rejects such files with the generic
`package_definition_invalid`. The hosted web bundle loads the meshopt decoder
only for such a file, under a CSP that already allows `'wasm-unsafe-eval'`;
the landing site never decodes one. The repin should check that a meshopt
Avatar imports and loads under the hosted CSP and that a Draco Avatar shows
the notice, admit local-http 18 / runtime-contracts 0.18, and revisit Cloud's
tenant inventory, which still lists `content_package_import.py` as excluded.

Check record (2026-10-27, macOS arm64, worktree `feat/arbitrary-vrm-support-p8`
from `06d381c9`; integrated with the PR B branch at `00e070eb`, tree
`dce9dc4f`, each through `scripts/heavy-slot.py`): `make check-test`,
`pnpm verify`, `pnpm web:test:browser`, `pnpm prettier:check` and
`pnpm desktop:test` all exit 0. Code Review #1's checks reviewer reran the
affected checks on the same tree, all passing: backend pytest on the 64
affected files (1,103 passed) and the two named files (94 passed), ruff and
format on the changed Python, vitest on the changed tests (472 passed) and
every related test (2,044 passed), `pnpm check`, eslint, the
`animation:render` browser test (2/2), `vrm:inspect` tests (3/3) and smoke
runs of `vrm:optimize compare` and `verify`. After the repair (tree
`ceed698c`): backend pytest on the 65 affected files 1,127 passed; ruff and
format; eslint and related vitest on the changed files; `pnpm prettier:check`;
`pnpm check` (after regenerating the i18n types) all pass. The optional
round-2 changes (commit `b192d6b2`): the loader and import-review tests,
eslint, `tsc` and ruff format pass. Merged into PR B: `tsc`, `i18n:check` and
vitest on `src/lib/avatar src/ui/library src/ui/animas src/lib/content`
(168 files, 1,887 passed). The full `pnpm e2e:test` runs on the final
candidate.

Commits: `feat(packages)[p8]: share Avatars that use converter, meshopt and Draco extensions`,
`fix(packages)[p8]: name undecodable Avatars on import and load meshopt on demand`

#### Code Review #1 Findings

High-risk tier: an independent analysis reviewer and an independent checks
reviewer (all checks passed; see the check record) on `00e070eb`. Every Avatar
and VRMA loader goes through the shared configuration; a required unknown
extension fails before any parse; the Included Avatars are unaffected; fixtures
are synthetic.

- P8-R1-F1 (blocking): R13 says an Avatar the runtime cannot load is reported
  on import and in Diagnostics; only Diagnostics reported it.
- P8-R1-F2 (blocking): the meshopt module compiles its WebAssembly when
  evaluated, and its static import reached the landing site through `Avatar`,
  whose CSP refuses WebAssembly: a console error on every page load.
- P8-R1-F3 (record): the Cloud repin note was missing.
- Optional: N1 `VRMC_springBone_extended_collider` loadable but refused by
  packages, with no test pinning the two lists; N2 the Draco test passed
  for an unrelated reason; N3 meshoptimizer's MIT notice in the runtime
  notices; N4 name the extension in the backend's rejection; N5 meshopt in
  the debug VRM editor.

#### Code Review #1 Revisions

- F1 accepted: the review's per-item `notices` gain
  `avatar_extension_unsupported`, read from the Avatar model's glTF header
  (`undecoded_gltf_extensions`, sharing the bounded reader with validation);
  the import review lists such Avatars; SDK regenerated; locales in five
  languages. Tests: the parametrized import test asserts the notice for Draco
  only; a unit test of the reader; an import-review UI case.
- F2 accepted: the decoder is imported in the loader plugin's `beforeRoot`
  only for a meshopt file. A test counts zero module evaluations for a plain
  file.
- F3 accepted: the Cloud repin note above.
- N1 accepted: the extension is accepted, and the shared fixture pins the
  backend list to the web lists (tests on both sides). N2 accepted: the test
  uses a VRM-shaped file and asserts three's own refusal, which comes before
  any plugin. N3 deferred to the release licence review (runtime notices
  need `license-sources.json` groups and per-path source-review records). N4
  rejected: the archive inspector reports only the error code, so the
  message never reaches the user. N5 deferred (debug only).

#### Code Review #2 Findings

Targeted recheck (high risk, with reruns: ruff, backend pytest 153, the SDK
check, vitest 31 and related 2,001, eslint, `pnpm check`, `vrm:inspect`) of
tree `ceed698c`: F1, F2, N1 and N2 resolved. A Node probe decoded required
and used-only meshopt files; a Vite build put the decoder in its own chunk,
reached only by dynamic import; hostile inputs to the header reader stayed
bounded.

- P8-R2-F1 (blocking, record): the drafted repin note said hosted beta had no
  package import; Cloud runs content-only package import, so the change takes
  effect there on repin.
- Optional: F2 the notice read ran on the event loop; F3 a file listing
  meshopt only as required got no decoder; the decoder's retry comment
  overstated (a failed compile stayed cached).

#### Code Review #2 Revisions

- R2-F1 accepted: the repin note above says hosted import is live and what
  the repin should check, and flags Cloud's stale inventory row.
- Optional, all taken in `b192d6b2`: notices are computed with
  `asyncio.to_thread`; the decoder loads when meshopt is used or required; a
  failed import or compile is no longer cached. Verified by the loader and
  import-review tests, eslint, `tsc` and ruff. The note's text is checked in
  PR B's final integration review.

### Phase 9 (alongside): lilToon frame cost

Review tier: standard for measurement and rendering changes; high risk for a
step that adds a user preference (settings contract).

Requirements: R11. Steps 1, 2 and 4 depend on nothing and may run in parallel
with any phase; step 3 depends on Phase 3's Materials setting.

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
3. Automatic for the Materials setting (Phase 3): if the target is not reached,
   Automatic picks Simple on machines whose measured GPU time is too slow for
   lilToon, from a short measurement (for example the first frames of a
   lilToon Avatar, cached per machine), and Diagnostics says why. An app-wide
   quality setting (a new `presentation.*` preference beside
   `enhanced_rendering`; high-risk step) is added only if the per-Avatar
   setting does not cover the need, with the owner.
4. (Fallback base colours moved to Phase 3.)
5. Docs: `avatar-animation.md` authored lilToon materials (frame cost).

Checks: bench before and after on the reference machine; Included renders and
bench unchanged; Automatic picks Simple under a simulated slow GPU and lilToon
otherwise; vitest, lint and check; settings tests and the full pre-push suite if
an app-wide setting lands.

Owner gate: the look in private renders and the measured result against the
target.

Completion: R11 acceptance; owner gate passed.

Recovery: rendering changes are runtime only; an app-wide preference, if added,
is optional with a default.

Check record: (to fill) · Commits: (to fill)

#### Code Review #1 Findings

Not run.

#### Code Review #1 Revisions

Not run.

### Phase 10: Diagnostics and Avatar settings in the Library and Create Anima

Review tier: standard, or high risk if step 4 adds the backend field (API
contract and generated client). New entry points for Phase 1's Diagnostics and
Phase 3's settings; no new setting.

Requirements: R7 and the R5/R11 settings, offered where Avatars are managed
(owner, 2026-10-27; see the Decision Log). Depends on Phases 1 and 3 (on `main`
once PR A merges) and on none of Phases 4 to 9, so it may run first in PR B.

Changes:

1. Diagnostics sources (`ui/animas/useAvatarDiagnostics.ts`): take a source
   instead of an Anima id:
   - an Anima, as today (its live chat Avatar or an off-screen load, with its
     effect warnings);
   - an Avatar item, Included or Local, through `previewCatalogItem` and
     `avatarPreviewTarget`: the preview dock's Avatar when the dock shows that
     item, otherwise an off-screen load;
   - an unsaved upload: file facts from the chosen `File`, live facts from the
     Create Anima stage's Avatar once it loads.
   Effect warnings appear only for an Anima, since they depend on its Gestures
   and Reactions. The dialog's context line names the source; a report
   identifies an upload by kind only (no item id, no file name).
2. Shared settings rows: move `AvatarSettingsRows` and `AvatarSettingRow` out
   of `AnimaSettingsModal.tsx` into a component keyed by Avatar item id, beside
   `avatarSettingLabels.ts`, used by the Anima settings and the Library, with
   Phase 3's rules (local runtimes only, Automatic saved as null, a toast on a
   failed save).
3. Library (`ui/library/LibraryContentInventory.tsx`): each Avatar card with a
   catalog item gains an "Avatar settings" action in the grid and list layouts.
   It opens a dialog with Wind and ambient forces, Materials and "Open
   diagnostics"; where settings are unavailable (the hosted app) the dialog
   offers Diagnostics only. A wind change reaches the dock preview live.
4. The Materials row before any load: Phase 3 learns that a file has lilToon
   materials only from an Avatar loaded in this session, so a Library dialog
   for an Avatar not yet loaded could not show the row. Prefer a read-only
   field on the Avatar item listing the file's glTF material extensions
   (`content_gltf.py` already reads `extensionsUsed` when the file is saved);
   then the Anima settings show the row before a load too. It adds an API
   field, backend docs and a generated-client update. Otherwise the Library
   dialog reads file facts when it opens. Record the choice in the Decision Log.
5. Create Anima (`ui/create-anima/CreateAnimaAvatarStep.tsx`,
   `CreateAnimaStage.tsx`): under "Previewing …", a one-line status from the
   stage's Avatar (checking, no problems found, or the number of problems) with
   "View diagnostics", which opens the dialog for the unsaved upload. A file
   that fails to load still gets the status and a dialog with its file facts
   and the load error. No Avatar settings here: an unsaved upload has no Avatar
   item to store them on.
6. Strings in the 5 locales; designed with the `animama-ui` skill (1440×900,
   then about 900 px, light and dark).
7. Docs: `docs/frontend/features/library.md` (the Avatar card action) and
   `docs/frontend/features/anima-management.md` (the settings follow the Avatar
   and are also in the Library; Create Anima's upload status).
8. Saved face-part corrections in Avatar previews (PR A FI-1, deferred): the
   Library's Avatar-card preview and Included Avatars picked in the Scene
   Effect, Particle and Pose creators load without the saved correction,
   because typed Avatar previews drop the item's `face_parts`. PR A's fix
   (`typedMetadata` keeping `face_parts`, `avatarPreviewTarget` forwarding it as
   `config.face_parts`) made the imported-playback e2e journey's Library
   particle preview report `error` after Stop on every run, and the Gesture
   creator discard journey fail after earlier journeys; find why before
   landing it, and run both journeys repeatedly on a fresh stack. Step 1's
   Avatar-item source depends on it.

Checks: hook tests for the three sources (the Anima source unchanged; an Avatar
item off screen and from the dock; an upload with and without the stage's
Avatar; a failed load keeps file facts); Library tests (the action on Included
and Local cards in both layouts, settings rows hidden in the hosted runtime,
Diagnostics still offered, a wind change reaching the dock without a reload);
Create Anima step tests (the status after a file is chosen, the link opening
the upload's dialog, a failed load); a report test that an upload report holds
no file name; `pnpm i18n:check`; `pnpm verify`; with step 4's field, backend
tests, `make check-test` and `pnpm openapi-ts:check`; `pnpm e2e:test:fast` on a
disposable built stack.

Owner gate: UI review on the live stack of the Library action and dialog, and of
Create Anima's upload status with the converted test Avatar.

Completion: Diagnostics and both settings reachable from Included and Local
Avatar cards, and Diagnostics from Create Anima's upload preview; owner gate
passed.

Recovery: UI only, plus an additive read-only field if step 4 adds it; removing
the entry points leaves the Anima settings as Phase 3 left them.

Check record (2026-10-27, macOS arm64, worktree on
`feat/arbitrary-vrm-support-pr-b` from `cae68160`; working tree `f18131e3`):

- New tests: `useAvatarDiagnostics.test.tsx` (an Avatar item off screen and
  from the dock, an upload while the stage loads, with its Avatar and after a
  failed load; upload reports hold no file name or item id; the Anima source
  unchanged), `LibraryAvatarSettingsDialog.test.tsx` (real settings hooks over
  a mocked SDK: both rows once the file is known to have lilToon materials,
  no read for a known file, a wind change reaching the dock's load settings
  without a material change, Diagnostics for the item, Diagnostics only in the
  hosted runtime), `LibraryContentInventory.test.tsx` (the action on Included
  and Local cards in both layouts, none without a catalog item),
  `CreateAnimaUploadDiagnostics.test.tsx`, `CreateAnimaAvatarStep.test.tsx`,
  `CreateAnimaStage.settings.test.tsx` (loading, ready and failed states) and
  `ContentPreviewScene.test.tsx` (the dock publishes its Avatar only after a
  finished load).
- `npx vitest run src/lib/avatar src/ui src/stores src/lib/content
  tests/avatar` (`src/frontend/web`): 381 files, 3,733 passed, 2 skipped.
- `npx tsc -p tsconfig.app.json --noEmit` (`src/frontend/web`),
  `pnpm -s i18n:check`, `pnpm -s web:lint` (`src/frontend`): pass; Prettier
  on the changed files: pass.
- Production-build stack `animama-arbvrmb` (http://animama-arbvrmb.localhost:9000,
  built from this tree), 1440x900 and 900x800, light and dark: the action in
  the grid and list layouts; Annie's dialog (no Materials row, no lilToon);
  Diagnostics nested in it ("Included Avatar · loaded for this view", and
  "in the preview" after Preview); Escape closes Diagnostics only; Springs off
  saved in the dialog showed "Springs off · springs held at rest · Saved for
  this Avatar" in Diagnostics reading the dock's Avatar, without a reload
  (reset to Automatic afterwards); Create Anima with Included bytes as an
  upload showed "No problems found." and "Unsaved upload · on the preview
  stage"; a synthetic Draco-required VRM showed "Animama could not load this
  Avatar." and "Unsaved upload · not loaded" with the load error.
- Not run here: `pnpm verify` as one command (its parts above were run
  separately; the Vite bundle was built by the stack) and
  `pnpm e2e:test:fast`, deferred to PR B's final candidate with the other
  phases' user-facing changes, so Completion stays open until it passes; the
  converted test Avatar on the stack (the owner gate).

Commits: `feat(avatars)[p10]: offer Avatar settings and Diagnostics in the
Library and Create Anima`.

#### Code Review #1 Findings

Independent reviewer, standard tier, initial review of the working tree
(`f18131e3`, then `b36cadb6` with only plan records changed) against
`cae68160`; recorded checks reused.

- P10-R1-F1 (blocking): Library Diagnostics (and the dock) loaded an Avatar
  item without its saved face part correction: the preview entry carried no
  `face_parts`, although the `:preview` route returns the effective one.
- P10-R1-F2 (blocking): item and upload Diagnostics listed effect findings
  that the dock's or creator stage's own previews left on their Avatar,
  contrary to R7 ("effect warnings only from an Anima"); two new tests
  asserted that behaviour.
- Optional: P10-R1-F3, the dock store matched by item id only (an older
  revision could be described); P10-R1-F4, the upload status line and its
  dialog each read the file, plus two nits (`NO_UPLOAD`, the stage importing
  its type from the diagnostics component); P10-R1-F5, two doc gaps; P10-R1-F6,
  the step-4 entry should say it narrows Phase 3's rejection, and an
  unreadable file was read again on each open; P10-R1-F7, the record should
  mark `pnpm verify` and e2e as not run. Step 4's choice assessed as sound.

#### Code Review #1 Revisions

- F1 accepted: the Avatar typed metadata and `avatarPreviewEntry` carry the
  item's `face_parts`, the same two changes PR A's `5470e01d` makes (so the
  code merges cleanly); dock previews and Library Diagnostics then load and report
  the saved correction. Test: an item whose correction is invalid reports
  `face_parts_correction_invalid`; PR A's `avatarPreviewTarget.test.ts` covers
  the entry once merged.
- F2 accepted: for the item and upload sources the hook drops live findings
  that name an effect (`params.effectId`) from the screen and the report. The
  dock test now expects only the non-effect finding, and the upload status
  counts 2 of 3 findings; both fail without the filter.
- F3 accepted: the dock's Avatar is used only when its VRM sha256 matches the
  item's; test: an older revision in the dock loads off screen.
- F4 accepted: the dialog takes an optional `view`, so the upload status line
  and its dialog share one read; `NO_UPLOAD` removed; `CreationStageAvatar`
  lives in `CreateAnimaStage.tsx`.
- F5 accepted: `anima-management.md` names the preview route and the effect
  rule; `custom-anima-creation.md` points to the upload status.
- F6 accepted: Decision Log entry extended; unreadable files are remembered.
- F7 accepted: the check record says what was not run and why.
- Rechecks: `npx vitest run src/ui/animas src/ui/create-anima src/ui/library
  src/lib/content src/ui/content-preview` 100 files, 652 passed; tsc pass.
  Targeted recheck: Code Review #2.

#### Code Review #2 Findings

Targeted recheck of working tree `dc282576` against `b36cadb6`: P10-R1-F1 to
F7 resolved, no regressions. The reviewer reran the consumers of the changed
preview entry (`src/ui/content-creator`, `src/ui/avatar-effect-creator`,
`src/ui/pose-creator`, `src/lib/content-preview`: 66 files, 400 passed) and
an in-memory `git merge-tree` with `feat/arbitrary-vrm-support` (code merges
cleanly; this plan conflicts). Optional: P10-R2-F1, the F1 revision said the
merge is clean although the plan conflicts; P10-R2-F2, the Commits line names
a commit not yet made.

#### Code Review #2 Revisions

- P10-R2-F1 accepted: the revision now says the code merges cleanly.
- P10-R2-F2: the Commits line keeps the subject, as the other phases do.
- Review passed. Phase 10 is agent-ready except `pnpm e2e:test:fast`; the
  owner's UI review is pending.

## Final integration review

Run once per PR. PR A's covers Phases 1 to 3 (R5, R7, R8 and R1/R3) and PR B's
covers combined acceptance R1–R13, Phase 10's entry points, every failure kind
from later phases appearing in Diagnostics (R8), the licence boundary across
each PR's diff and history, documentation accuracy and any phase without its
own review. Then the full pre-push suite once on each PR's final candidate; its
results go in that PR.

### PR A Code Review #1 Findings

Final integration mode on `cae68160` (main `d30a6ddc` merged in) and the
version bump `f420eeb5`; diff `d30a6ddc...f420eeb5`, branch history from
`a94f8369`. Verdict: blocked.

- FI-1 (required): the Library's Avatar-card preview and Included Avatars
  chosen in the Scene Effect, Particle and Pose creators' model picker still
  load without the saved face-part correction (Phase 2 change 5). For Avatars,
  `typedMetadata` (`lib/content/catalogApi.ts`) keeps only `compatibility`, so
  `avatarPreviewTarget` builds a config without `face_parts`, although the typed
  preview's item carries it.
- FI-2 (required checks): Included render diffs against `d30a6ddc` in both looks
  with the accepted spring change, the load-timing measurement and
  `pnpm openapi-ts:check` on the merged tree (both sides of the merge edited the
  generated client).
- FI-3 (optional): Progress and Surprises do not record the merge, the version
  bump or three-vrm 3.5.2 → 3.5.5 (the `VRM` class and `reset()` bodies are
  unchanged, so Springs off still holds).

No findings on cross-phase behaviour, the merge's frame pacing, security, the
licence boundary (diff, history and commit messages), docs or attribution.

### PR A Code Review #1 Revisions

- FI-1 accepted, then deferred to Phase 10. The fix (`5470e01d`:
  `typedMetadata` kept an Avatar's `face_parts` and `avatarPreviewTarget`
  forwarded it as `config.face_parts`, with a test that failed before it) passed
  its unit checks and the targeted recheck, but the full `pnpm e2e:test` then
  showed "imported playback covers every supported content kind" failing at
  the Library particle preview (the dock reported `error` after Stop) on every
  run of that build: 3 of 3, including a fresh stack. The same journey passed
  on fresh stacks built from `main` (`d30a6ddc`), the merge (`cae68160`) and
  `f420eeb5` (twice). "Gesture creator discard existing draft before Library
  Edit" also failed after other journeys had run on the same stack and passed
  on a fresh one. The fix was backed out of PR A; Phase 10 step 8 carries it
  with that investigation.
- FI-2 accepted: `pnpm openapi-ts:check` passed on `f420eeb5` ("Generated SDK
  is current"); the render diffs, load timing and full suite are recorded under
  "PR A final candidate".
- FI-3 accepted: recorded in Progress and Surprises.

### PR A Code Review #2 (targeted recheck)

Passed on `5470e01d`: FI-1 closed for the Library dock and the creators'
Included model picker, with no regression found by reading (preview keys and
other kinds' metadata unchanged; a null, invalid or other-file correction loads
as before). One repair round used. The full e2e run then showed the regression
recorded under FI-1, so the fix was backed out and FI-1 deferred.

### PR A final candidate

Superseded: the run below is on `5470e01d`, whose FI-1 fix was backed out (see
FI-1); the record for the final candidate follows it.

`5470e01d` (tree `31b53f69`), baseline `main` at `d30a6ddc`, macOS arm64, heavy
jobs through `scripts/heavy-slot.py`:

- Full pre-push suite: `make check-test` 4,884 passed, 29 skipped; `pnpm verify`
  5,788 passed, 2 skipped; `pnpm web:test:browser` 131 passed (the setup
  journey's teardown logged React's "Invalid hook call" twice, as in an earlier
  Phase 3 run; no test failed); `pnpm prettier:check`, `pnpm openapi-ts:check`
  ("Generated SDK is current"), `pnpm web:build:hosted` and `pnpm desktop:test`
  (557 passed, 14 skipped) all exit 0.
- Package-set compatibility (`scripts/package-sets/build.py build` for
  `d30a6ddc` and `f420eeb5`, then `compare`): passed.
- Included review renders against `d30a6ddc` (`effects:render --diff` for Eye
  Confused Swirl, Heart Eyes, Blush, Star, Single Tear, Mouth W, Petrified
  Cracks and Face Red in both looks; `animation:render` `air-guitar` and
  `apology-bow`): the Gesture sheets 0 differing pixels; the effect sheets
  4.17–4.18% (enhanced) and 3.15–3.17% (classic), only in spring-driven hair and
  Annie's cardigan front, the owner-accepted change.
- Load-time correction path (median of 5, load average about 5): Andrew 62.3 ms
  (17 primitives, 3.66 ms each), Annie 49.0 ms (15, 3.27 ms each), against
  Phase 1's 57.3 and 45.3 ms: within a few milliseconds per primitive.
- Not rerun on this candidate: the full `pnpm e2e:test` (last run on Phase 3's
  pre-merge build); it runs again before merge.

Final candidate: `d1628f98` (tree `a1434799`): the FI-1 back-out `5c507671`
with `main` at `0cb206f0` (#741, #742: provider SDK majors, docs) merged in,
no conflicts and no contract or package change from `main`.

- Full pre-push suite, all exit 0: `make check-test` 4,885 passed, 29 skipped;
  `pnpm verify` 5,787 passed, 2 skipped; `pnpm web:test:browser` 131 passed;
  `pnpm prettier:check`; `pnpm openapi-ts:check`; `pnpm web:build:hosted`;
  `pnpm desktop:test` 557 passed, 14 skipped.
- Full `pnpm e2e:test` on a fresh disposable built stack (`ANIMAMA_LLM_SKIP=1`):
  40 passed, 1 failed. The failure, "accountless vfx guides preserve authored
  JSON with replacement artwork and animation" (one `avatar_vfx`
  `controller_warnings` diagnostic after the preceding "keep Eye = playing"
  journey), also fails on `main` `0cb206f0`: running that spec's journeys in
  order on fresh stacks failed it 2 of 2 times on both `main` and the
  candidate, so it predates this PR. The imported-playback and Gesture
  discard journeys passed.
- The package-set check, the Included render diffs and the load timing above
  still apply: the code differs from `f420eeb5`/`5470e01d` only by the backed-out
  preview change and `main`'s backend dependency update.

## Validation and acceptance

Spec acceptance criteria, with these checks (from `src/frontend` unless noted):

- `pnpm verify`; `pnpm web:test:browser` where review-render or stage code
  changes; `make check-test` from the repository root for Phases 3 and 8;
  `pnpm openapi-ts:check` after Phase 3.
- Included render diffs against each phase's start and, before each PR, against
  that PR's starting commit on `main` (`a94f8369` for PR A), in both looks; the Included snapshot
  test and the load-timing measurement.
- `pnpm e2e:test:fast` on a disposable built stack for user-facing phases; the
  full `pnpm e2e:test` for Phases 3 and 8 (package import and export). Known
  flake: #709 (Library particle preview race).
- Owner-only checks: Diagnostics (Phase 1); eye effects (Phase 2); wind modes
  and the Simple look (Phase 3); moods (Phase 4); hands (Phase 5); scaling band (Phase 7); the
  lilToon look and cost (Phase 9); the Library and Create Anima entry points
  (Phase 10).

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
