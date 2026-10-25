# Converted VRChat Avatars with native ARKit faces

Source agreement: raymond-van/animama#687 (published 2026-10-24 from the agreed
draft; snapshot in [vrchat-arkit-avatars-spec.md](vrchat-arkit-avatars-spec.md)).
The issue is the spec; owner decisions are in the Decision Log.
Authorized scope: Phases 1, 4 and 6 (owner, 2026-10-24); Phase 2 from step 4
(owner, 2026-10-24, after setting up the Unity project); Phase 3 (owner,
2026-10-24). Phase 5 waits for a separate go-ahead.
Merge, release and any use of third-party Avatar data beyond local testing keep
their separate approvals.

## Purpose and context

A user who has licensed a VRChat Avatar converts it to VRM 1.0 with Mochiya
Avatar Tools and imports it as a Local Avatar. The app then renders its authored
lilToon materials, detects its ARKit face shapes and uses them for emotions,
Reaction/Gesture faces and lip sync. A command can also bake VRM presets into the
user's copy so the file emotes in other VRM apps. The first Avatar is Lapwing by
kuji (BOOTH 4993931, VN3 licence), supplied by the owner.

Starting source: `main` at `f9b0d8f1`, branch `feat/vrchat-avatar-arkit`.

### Why VRM stays the container

All Avatar subsystems sit on three-vrm. At `f9b0d8f1`, 28 non-test frontend files
use the VRM humanoid (Gestures, poses, VRMA retargeting, procedural motion, VFX
anchors, portraits), 9 use its expression manager and 3 its spring bones. The
backend upload validator (`src/backend/animama/app/services/content_gltf.py`,
`_validate_vrm_humanoid`) rejects files without a VRM humanoid. An FBX carries
none of the Unity humanoid mapping, PhysBones or lilToon settings, so loading it
natively would mean rebuilding the converter inside the app. Morph-target names
survive inside a VRM, so ARKit support does not depend on the container.

### Relevant code (paths from `src/frontend/web/src/lib/avatar/` unless noted)

- `Avatar.ts` `_createGLTFLoader`: registers `withEnhancedMToonPatch(new
  VRMLoaderPlugin(parser))` and the VRMA plugin; `_loadVrm` post-processes.
- `morphTargetExpressions.ts` `registerMorphTargetExpressions`: registers every
  morph-target name as an expression (case-sensitive), called from
  `ExpressionController.ts` and `eyelidClosure.ts`.
- three.js `GLTFLoader` (r182) reads morph names only from mesh-level
  `extras.targetNames`; per-primitive names are ignored.
- `ExpressionController.ts`: emotion resolution (`EMOTION_INTENSITY_MAP`, then
  `EMOTION_INTENSITY_FALLBACK_MAP`), `resolvePartExpressionFallbacks` for content
  keys, lip-sync frames (`vowel5` produced; `arkit_52` accepted, eyes skipped),
  `_arkitToVrmMap` crude fallback.
- `emotionExpressionPresets.ts`: groups keyed to `Fcl_MTH_*` and VRM presets,
  relaxed fallback for affection/esteem/delight.
- `partExpressionFallback.ts`: missing `Fcl_*` brow/eye parts fall back to presets;
  mouth parts are dropped.
- `eyelidClosure.ts`: corrects blink against happy/relaxed eyelid motion.
- `arkit.ts`: canonical `ARKIT_BLENDSHAPES` order.
- `enhanced-rendering/mtoonPatch.ts`: tuned MToon patch; must leave lilToon
  materials alone.
- Renderer owners that would need lilToon passes: `ui/main/canvas/Scene.tsx` and
  `AvatarSceneHost.tsx`, `ui/avatar-preview/AvatarPreviewSurface.tsx`,
  `ui/create/CreateAnimaAvatarPreviewScene.tsx`, and the review harness stages
  under `src/frontend/web/scripts/` (`effect-render`, `animation-render`).
- Review renders read Avatars only from `content/included/avatars`
  (`scripts/effect-render.mjs`); a local third-party Avatar needs an explicit
  file option.
- `scripts/vrm-optimize/` edits GLB JSON directly (`glb.mjs`), so it keeps
  unknown extensions; `docs/frontend/runtime/vrm-optimization.md` documents it.
- Backend limits: 100 MB VRM source and binary (`content_gltf.py`). The package
  extension allowlist (`content_package_capabilities.py` `_GLTF_EXTENSIONS`) has
  no Mochiya extensions and stays that way.

### Previous lilToon trial

#581/#587 (October 2026) added `@mochiya/three-liltoon` 0.1.5 behind a debug
switch and converted MToon parameters to lilToon by approximation. It looked
worse than tuned MToon on VRoid Avatars and was costly on AvatarSample_Y_0, so
#586 removed it. Useful fixes from that work are in commits `f04f4918` and
`18c987fe`: silhouette overlays needed an eight-unit depth bias on lilToon
materials, and tone-mapping uniforms had to be non-enumerable so a lilToon
program switch did not crash the next draw. This plan differs: only materials
with authored `MOCHIYA_materials_liltoon` data are replaced, which is what the
runtime does by default.

Current compatible versions (three-liltoon README, 0.1.9, 2026-10-17): runtime
0.1.9, extension spec 1.3, Mochiya Avatar Tools 0.1.4. Peers `three`
>=0.180 <0.190 (app: ^0.182) and `@pixiv/three-vrm` >=3.4 <4 (app: ^3.4.4).
One directional light plus ambient/hemisphere light is supported; enhanced
rendering's three-point lighting needs checking.

### Licence boundary

Never commit, attach or upload third-party Avatar data: source packages, FBX,
textures, converted or baked `.vrm`, review renders of it, or files derived from
it. Keep it in an owner-chosen directory outside every repository, referred to
here as `<private-avatars>`. Do not use the converter's "Upload to Mochiya".
Tests use synthetic fixtures. Plan and PR evidence states results (counts,
warnings, timings, pass/fail), never shape data or images. Renders for owner
review stay in `<private-avatars>` or the session scratchpad.

## Progress

- [x] Phase 1: ARKit face capability and Avatar inspection. Done; reviewed (pass after one repair round).
- [ ] Phase 2: Convert Lapwing. Steps 1–7 done; the step 6 follow-up fixed the
  A-pose arms (T-pose export) and the floating springs (no ambient forces for
  Mochiya conversions); the painted-effect follow-up places face decals and
  iris art on Lapwing. Owner R1 re-check remains.
- [ ] Phase 3: Authored lilToon rendering. Implemented with on-demand loading
  and reviewed; the owner's go/no-go on the look at its current frame cost
  (about 30 ms of GPU time per frame on an M5 at the chat canvas) remains.
  Reducing the cost is #691 R11.
- [x] Phase 4: ARKit emotions and face-track translation. Done; reviewed (pass
  after one repair round). Owner visual gate on Lapwing still open (needs
  Phase 2).
- [ ] Phase 5: ARKit lip-sync shaping. Owner review gate.
- [x] Phase 6: Bake VRM presets. Done; reviewed (pass after two repair rounds
  and a final recheck). Baking Lapwing waits for Phase 2.

Phases 4–6 may run before Phases 2–3 if the owner's Unity setup is pending; their
owner gates then wait for the converted Avatar.

## Surprises & Discoveries

- 2026-10-24: three.js r182 ignores per-primitive `extras.targetNames`. Whether
  UniVRM 0.131.2 writes names at mesh level is unconfirmed until Phase 2.
- 2026-10-24: Mochiya's lilToon exporter requires lilToon 2.3.4+; Lapwing ships
  1.4.0, so the upgrade may change the authored look before export.
- 2026-10-24 (Phase 2): `ARKIT_BLENDSHAPES` in `arkit.ts` has 51 names; it omits
  `tongueOut`, which Lapwing has. `vrm:inspect` therefore printed "51 of 52".
  Fix with the deferred INT-F6 to F8 follow-ups (append `tongueOut`, report the
  list's own length).
- 2026-10-24 (Phase 2): on macOS, `vpm new` refuses to run without Unity
  2022.3.22f1; copying the Creator Companion Avatar template and running
  `vpm resolve project` works with 2022.3.62f3.
- 2026-10-24 (Phase 4): content reaches expressions through several paths
  besides `ExpressionController`: the creator clip preview filters by
  `getAvailableExpressions()`, portraits pass `happy` to
  `runWithTemporaryValues`, and `animation:render` drives the manager directly.
  Rewriting names inside the controller would miss them, so the ARKit mixes are
  registered as real expressions instead.

## Decision Log

- 2026-10-24, owner: VRM 1.0 remains the container; ARKit becomes a native face
  capability rather than a reason to load non-VRM formats.
- 2026-10-24, owner: convert with Unity and Mochiya Avatar Tools.
- 2026-10-24, owner: retry `@mochiya/three-liltoon` on authored lilToon materials,
  because the earlier trial used approximated settings on VRoid Avatars.
- 2026-10-24, owner: provide both baked presets and runtime ARKit compositions.
- 2026-10-24, owner (confirming an agent proposal): keep Gesture and Reaction content
  keyed to `Fcl_*` parts and VRM presets, and translate missing parts to ARKit
  per Avatar. Migrating content to an ARKit vocabulary is later work.
- 2026-10-24, agent (Phase 2 step 6, owner asked to fix arms and springs):
  the batch export poses the Avatar from its Unity humanoid T-pose before
  exporting (`-animamaKeepPose` opts out), because VRM 1.0 requires a T-pose
  rest and an A-pose export plays every Gesture with the arms about 48° low.
- 2026-10-24, agent (Phase 2 step 6): Avatars converted by Mochiya Avatar
  Tools (`MOCHIYA_avatar_composition`) get no ambient spring forces (wind,
  updraft, zero-gravity baseline). A headless simulation showed no per-joint
  stiffness cap could both keep Included Avatars unchanged and hold Lapwing's
  ponytail down. Effective spring drag is capped at 1 for every Avatar,
  including existing user Avatars that author drag above 0.5 on hair (or about
  0.67 on other springs), which previously got a negative inertia; Included
  Avatars are unchanged at the defaults. Owner to confirm at the R1 re-check.
- 2026-10-24, agent (within the approved outcome): ARKit mixes are registered
  as expressions rather than translated at each call site; see Phase 4.
- 2026-10-24, agent (applying R5's "no `Fcl_*` parts", P4-F1): an Avatar with
  VRoid mood parts of its own (`Fcl_ALL|BRW|EYE|MTH_<Mood>`, as morph targets or
  expressions) keeps its authored face and does not play ARKit mixes. Other
  raw VRoid parts (`Fcl_EYE_Close`, `Fcl_MTH_A` …) do not disqualify; they keep
  their own expression while the rest plays as mixes (P4-R2-F1).
- 2026-10-24, owner (confirming an agent proposal): on an Avatar with sufficient
  ARKit coverage, runtime ARKit emotion compositions take precedence over its
  VRM presets; baked presets serve other VRM apps. "Sufficient" means every shape
  the composition table uses resolves.
- 2026-10-25, owner: the investigation and reduction of lilToon's GPU time per
  frame belongs to issue #691 (R11, arbitrary user-uploaded VRMs), not this
  plan. Re-measured the same day under equal load (Apple M5, 1600×1200): 30.8 ms
  with lilToon, 0.8 ms with the fallback materials, 1.2 ms for Andrew, and
  6.2 ms with lilToon at DPR 1, so the cost is mostly per pixel. The Phase 3 gate
  stays: keep lilToon in this PR as is, or not.

## Phased implementation

### Phase 1: ARKit face capability and Avatar inspection

Review tier: standard. New frontend behavior inside the Avatar runtime, no API,
schema or dependency change.

Requirements: R2, R4. Starting source: `f9b0d8f1`.

Changes:

1. `lib/avatar/arkitFaceCapability.ts` (beside `arkit.ts`): resolve each canonical
   ARKit name to an Avatar morph-target name. Match case-insensitively; accept
   `Left`/`Right`, `_L`/`_R` and `.L`/`.R` side forms; include a documented alias
   table for common face-tracking names (for example Unified Expressions /
   VRCFaceTracking forms such as `EyeClosedLeft` for `eyeBlinkLeft`). Return the
   resolved map and the missing names. Ambiguous matches are reported, not
   guessed.
2. `morphTargetExpressions.ts`: register resolved ARKit shapes under their
   canonical names (binding the Avatar's actual morph targets), so callers use
   one vocabulary. Existing names keep their expressions.
3. `Avatar.ts` / `ExpressionController.ts`: compute the capability once at load
   and expose it read-only (coverage counts and resolved names) for later phases
   and debug logging.
4. Morph-name fallback: when a mesh lacks mesh-level `targetNames` but its
   primitives carry them, apply those names in `_loadVrm` post-processing. Do this
   only if Phase 2 or a known UniVRM export shows the case; otherwise record that
   it was unnecessary.
5. `pnpm -s vrm:inspect <file.vrm>` (`scripts/vrm-inspect.mjs`, reusing
   `vrm-optimize/glb.mjs`): print VRM spec version, extensions used, mesh,
   material and texture counts with byte sizes, morph names per mesh with where
   they are stored, ARKit coverage and missing shapes, and expression presets
   present. It reads only; output goes to stdout.
6. Docs: a short "ARKit face shapes" section in
   `docs/frontend/runtime/avatar-animation.md`; a glossary entry if "ARKit face
   capability" becomes a shared term; an ADR recording "VRM stays the container;
   ARKit is a face capability".

Checks (from `src/frontend`): unit tests for the resolver with synthetic morph
dictionaries (canonical, case, side and alias forms; ambiguity; missing), for
registration, and for `vrm:inspect` on a synthetic GLB built in the test;
`pnpm web:lint`, `pnpm check` for touched packages.

Completion: tests pass; Included Avatars report no ARKit coverage and behave
unchanged (existing expression tests pass).

Starting source: `8b263532`. Step 4 (per-primitive name fallback) is not
implemented: no export has shown the case yet, and `vrm:inspect` reports it
("primitives only — three.js ignores these names") so Phase 2 can decide.
No glossary entry: "ARKit face shapes" is described in the runtime guide and
ADR 0031.

Check record (working tree `e47039b5`, uncommitted on `8b263532`):

| Command | Directory | Result |
| --- | --- | --- |
| `pnpm -s check` | `src/frontend` | pass |
| `pnpm -s web:lint` | `src/frontend` | pass |
| `npx vitest run src/lib/avatar` | `src/frontend/web` | 68 files, 1250 passed, 1 skipped |
| `node --test scripts/vrm-inspect.test.mjs` | `src/frontend/web` | 3 passed |
| `pnpm -s vrm:inspect ../../../content/included/avatars/Andrew.vrm` | `src/frontend/web` | VRM 1.0, 57 mesh-level morph names, 0 of 52 ARKit shapes |

Commits: `0b845881` `feat(avatars)[p1]: detect ARKit face shapes and add
vrm:inspect` (tree `d7f2c7d4`).

#### Code Review #1 Findings

Reviewed working tree `e47039b5` against `8b263532`, standard tier, by an
independent sdlc-reviewer agent. It reused the check record and also ran
`vrm:inspect` on AvatarSample_A_1_New (0 of 52) and a resolver probe on edge
names (no false positives on `Fcl_*`, `vrc.*`, MMD Japanese names or `Blink_L`).
It verified that Included Avatars behave unchanged.

- P1-F1 (required): `vrm:inspect` printed no morph-target names and no mesh
  byte sizes, so Phase 2 could not confirm which shapes survived conversion.
- P1-F2 (optional): the alias comment claimed full SRanipal coverage; SRanipal
  eye-look, `Mouth_*_Inside` and Unified Expressions `LipSuck*` were unresolved.
- P1-F3 (optional): the side-token comment did not match the code
  (`L_EyeBlink` resolves).
- P1-F4 (optional): an Avatar with only ambiguous candidates logged nothing,
  though the docs say ambiguous shapes are logged.
- P1-F5 (observation): short keys `mouth|side`, `jaw|side` match generic names
  such as `Mouth_L`.
- P1-F6 (optional): `vrm-inspect.mjs` and `registerMorphTargetExpressions`
  repeated the morph-name listing.
- P1-F7 (observation): `getAvailableExpressions()` lists both a shape's own
  name and its canonical name on ARKit Avatars.
- P1-F8 (observation): `vrm:inspect` ignored ARKit-named expressions the file
  authors, which the runtime keeps.
- P1-F9 (implementer): shapes were resolved once across all meshes, so a mesh
  spelling a shape differently from the chosen spelling lost it.

#### Code Review #1 Revisions

- P1-F1 accepted: the report lists each mesh's `targetNames` (from primitives
  when only they hold names) and its geometry, index and morph bytes; the text
  output prints the names under each mesh. Test and doc updated.
- P1-F2 accepted: added `LipSuckUpper/Lower` and SRanipal `Mouth_*_Inside`
  aliases (to `mouthRoll*`); the comment now says eye-look names with two side
  words are not matched. Tests extended.
- P1-F3 accepted: comment corrected.
- P1-F4 accepted: the controller also logs when only ambiguous shapes exist.
- P1-F5 accepted as is: correct for SRanipal `Jaw_Left`; `vrm:inspect` lists
  renamed matches for review.
- P1-F6 accepted in substance: `listMorphTargetNames` was removed; inspection
  and registration share `resolveArkitFacesPerMesh`, and the listing in
  `morphTargetExpressions.ts` is one helper.
- P1-F7 deferred to Phase 4, where expression lists for ARKit Avatars are
  reconsidered with the face translation.
- P1-F8 accepted: the report lists `authored` canonical expressions and leaves
  them out of `renamed`.
- P1-F9 accepted: `resolveArkitFacesPerMesh` resolves each mesh and merges the
  summary; `registerArkitExpressions(vrm)` binds each mesh's own spelling and
  now runs before raw morph registration, so an exactly spelled morph joins the
  canonical expression. Tests: per-mesh resolver and a two-mesh controller test.

Revision checks (working tree on `8b263532`, Phase 1 files): `pnpm -s check`
pass; `pnpm -s web:lint` pass; `npx vitest run src/lib/avatar` 69 files, 1258
passed, 1 skipped; `node --test scripts/vrm-inspect.test.mjs
scripts/vrm-bake-expressions.test.mjs` 7 passed (the working tree also held
the Phase 6 draft, which is why the second file appears); `vrm:inspect` on
AvatarSample_A_1_New lists its 57 `Fcl_*` names. Repair budget: one round used.

#### Code Review #2 Findings

Targeted recheck by the same reviewer: every accepted fix verified; the
ARKit-before-raw registration order changes nothing for Included Avatars or
file-authored expressions. No blocking findings.

- P1-R2-F1 (optional): a mesh's ambiguity was dropped when another mesh
  resolved the shape, so nothing reported its unbound morphs.
- P1-R2-F2 (optional): the fixture's JSDoc described the `vrm` option under
  `json`.
- Noted: the record lacked a tree hash; a few lines exceeded Prettier width.

#### Code Review #2 Revisions

- P1-R2-F1 accepted: the summary's `ambiguous` now includes shapes any mesh
  found ambiguous, even when another mesh resolves them; doc and a test added.
- P1-R2-F2 accepted: JSDoc fixed.
- Formatting applied with Prettier.
- Both fixes are trivial and verified by the implementer (allowed below the
  high-risk tier): `npx vitest run src/lib/avatar/arkit` 19 passed,
  `node --test scripts/vrm-inspect.test.mjs` 3 passed, `pnpm -s web:lint` and
  `pnpm -s check` pass. The tree is the Phase 1 commit's tree, recorded below.
  One repair round remains unused.

### Phase 2: Convert Lapwing

Review tier: light for the conversion and guide; standard for the step 6
follow-up, which changes runtime spring physics and review tooling.

Requirements: R1, R2, R9. Depends on Phase 1 (`vrm:inspect`).

Owner gate before starting: install Unity Hub and Unity 2022.3 LTS with the free
Personal licence (agents cannot sign in), install VRChat Creator Companion, and
place the Lapwing download (`Lapwing.unitypackage`, `lilToon_1.4.0.unitypackage`,
`LapwingData.zip`) in `<private-avatars>`. The owner tells the agent that path.

Steps (Unity project inside `<private-avatars>`, never in a repository):

1. Create a VCC Avatar project following kuji's setup guide. Import lilToon,
   then Lapwing; open its prefab and record a reference screenshot for the owner.
2. Upgrade lilToon to the version the Mochiya exporter requires (2.3.4+), and
   compare against the reference. Record visible differences for the owner.
3. Install UniGLTF, UniVRM 0.131.2, then Mochiya Avatar Tools 0.1.4, from their
   git URLs in that order.
4. Run `MochiyaAvatarWorkflow.Validate`, then `Export` to VRM 1.0, preferably with
   `Unity -batchmode -projectPath … -executeMethod …` so it is repeatable. Never
   use "Upload to Mochiya". Record every warning (unsupported lilToon variants
   fail the export and must be switched to supported variants).
5. `pnpm -s vrm:inspect` the result. If any face mesh reports "primitives only",
   implement Phase 1 step 4 (apply per-primitive names in `_loadVrm`) with a
   test, as its own standard-tier change, before continuing; R2 is not accepted
   until then. Then check ARKit and MMD names present, where names
   are stored, size against the 100 MB limit, extensions. If oversized, reduce
   textures in Unity and export again (`vrm:optimize` refuses Mochiya's
   extensions).
6. Register it as a Local Avatar on a task stack (`./reset.sh --name vrcarkit
   --base-port 8800` from the worktree after `git lfs pull`) and check rig,
   springs, blink, visemes, look-at and Face parts detection (correct in the Face
   parts panel if needed). Flat PBR materials are expected at this phase.
7. Write `docs/frontend/runtime/vrchat-avatar-conversion.md`: versions, order,
   lilToon upgrade, export command, expected warnings, inspection, optimization
   and the licence reminder. Link it from `docs/frontend/README.md`.

Recovery: the source download and Unity project are untouched by export; rerun
from step 4. Delete only converted outputs the agent created.

Completion: a converted `.vrm` in `<private-avatars>` loads on the stack, owner
confirms the R1 checks, and the guide is reviewed. Evidence in this plan: tool
versions, warnings, counts and sizes only.

Progress (2026-10-24, owner steps 1–3; agent steps 4, 5 and 7):

- Steps 1–3 (owner): Unity 2022.3.62f3 on Apple Silicon. The project was made
  from a copy of the Creator Companion Avatar template plus
  `vpm resolve project` (macOS `vpm new` requires 2022.3.22f1). lilToon 1.4.0
  and Lapwing 1.0.10 were imported in batch mode with `-importPackage`, and
  reference screenshots (front, face) taken privately. Then `Assets/lilToon` was
  deleted and `jp.lilxyzw.liltoon@2.3.4` installed from the lilToon VPM
  repository. UniGLTF and VRM10 `v0.131.2` and Mochiya Avatar Tools `d98e9091`
  (0.1.4) were added to `Packages/manifest.json`. kuji's guide needs no Modular
  Avatar or other community packages. A before/after comparison of the
  lilToon upgrade is still owed by the owner.
- Step 4 (agent): `scripts/avatars/unity/AnimamaBatchExport.cs` with its
  assembly definition (copied into the project's `Assets/AnimamaExport/Editor/`)
  runs Detect, Validate and Export in batch mode for `Lapwing.prefab`, with
  metadata name Lapwing, version 1.0.10, author kuji, copyright "©kuji" and
  UniVRM's restrictive default permissions. Detect: Avatar with its own
  humanoid. Validate: no errors; 1 unsupported item (VRChat animator state
  machines) and 16 warnings (visemes/eyelids/eye ranges translated; 15
  PhysBones approximated as springs). Export: no errors and 28 warnings (the
  same ones, plus 2 plane colliders omitted, 2 inside-bounds colliders
  approximated and 5 gravity falloffs baked). Output: 20.48 MB, outside the
  repository. "Upload to Mochiya" was not used.
- Step 5 (agent): `vrm:inspect` shows VRM 1.0 with `VRMC_vrm`,
  `VRMC_springBone`, `MOCHIYA_materials_liltoon`, `MOCHIYA_avatar_composition`
  and `KHR_texture_transform`. 7 materials, all lilToon. 26 images (3.48 MB).
  8 meshes, all storing names at mesh level, so R2 needs no loader change
  (Phase 1 step 4 stays unneeded). The face mesh has 155 targets: VRChat
  visemes, all 52 ARKit shapes including `tongueOut`, 34 expression shapes, the
  MMD set and adjustment shapes. All ARKit shapes resolve under their exact
  names. Authored presets: `aa`, `ih`, `ou`, `ee`, `oh`, `blink`. No VRoid mood
  parts, so Animama plays its ARKit mixes. Under the size limit; no
  optimization needed.
- Step 7 (agent): `docs/frontend/runtime/vrchat-avatar-conversion.md`, linked
  from `docs/frontend/README.md`, records the macOS route, versions, commands,
  expected warnings, checks and licence rules.
- Step 6 (agent part, 2026-10-24): task stack `animama-vrcarkit` at
  `http://animama-vrcarkit.localhost:8800` (development mode, from this
  worktree at `d2ddaab1`; only `web` published on loopback). First-run setup
  was finished with a test name, AI and voice skipped, and the 18+ gate
  confirmed. The export was uploaded with
  `PUT /v1/avatar-content/Lapwing` (200, Local Avatar content, revision
  `4567d394`). A test Anima, "Lapwing Test" (Pocket TTS Eve, starter actions),
  was created through Create Anima. Lapwing loads in the creator preview and the
  chat canvas. The runtime log reports `playsFacesWithArkit: true` with every
  listed ARKit shape resolved, all five vowel presets, and face parts and
  landmarks resolved automatically.
  - Finding: every fallback glTF material keeps the default `metallicFactor` 1
    (roughness 1, no metallic texture), so with no environment map Lapwing
    renders much darker than in Unity (light lavender hair and a white shirt
    look dark grey and black). Phase 3's lilToon rendering replaces these
    materials. Until then the fallback could treat metallic as 0 for materials
    that carry `MOCHIYA_materials_liltoon`. It is also worth reporting
    upstream.
  - Finding: the springs float. Animama's controller adds an updraft (0.95,
    scaled by semantic intensity) and only substitutes a 0.5 zero-gravity
    baseline when authored gravity is exactly 0. Lapwing's ponytail
    (stiffness 0.165, gravity 0.0064) reaches a net upward force of 5.3 times
    its stiffness; Included Avatars peak at 0.94. A headless simulation put
    the ponytail at 180° from hanging with the controller and 2° without it.
  - Finding (owner screenshot): the arms are wrong in every Gesture. The
    export kept Lapwing's A-pose (upper arms 48° below horizontal), but
    three-vrm treats the VRM 1.0 rest as a T-pose.
- Step 6 follow-up (2026-10-24, owner: "Fix the springs, arms"):
  - `AnimamaBatchExport.cs` applies `UniGLTF.InternalTPose.TryMakePoseValid`
    before Detect; the re-export (`Lapwing-tpose.vrm`, 20.48 MB) measures upper
    arms 2.6° below horizontal. It replaced the uploaded revision
    (`19c9dec6`) on the stack.
  - `SpringBonePhysicsController` gains `ambientForces`, which `Avatar.load`
    turns off for Mochiya conversions (`springsTunedWithoutAmbientForces`); the
    debug panel shows it. The simulation then matches plain three-vrm for
    Lapwing (ponytail 2°, bag 4°, sleeves follow the arms) and leaves Included
    Avatars unchanged. Effective drag is capped at 1, because converted drag up
    to 0.863 × 2 made three-vrm's inertia negative.
  - `effects:render --avatar-file <a.vrm>` (delivering Phase 3 step 5 early)
    renders review sheets on a private file. Private renders on Lapwing show
    Big Arm Heart, Apology Bow and Blow a Kiss playing correctly. Plane effects
    (heart eyes, `> <` eyes, gloom lines, despair shade, stickers) also land
    correctly.
  - Open finding: effects painted onto the face texture misplace. Blush becomes
    a large smear over the mouth and star3's iris overlay an orange blob. The
    live anchor snapshot shows sensible local positions but texture-space sizes
    up to 0.46 of the texture width: `_projectReferenceSizeUv` projects each
    sample to its nearest triangle, and on Lapwing's combined face/body mesh
    those land on other UV islands. Proposed next: measure size from the anchor
    triangle's own UV mapping when samples disagree, keeping Included anchors
    unchanged.
  - Painted-effect fix (2026-10-24, owner: "try out the proposed fix …
    ideally automatically detectable and applied"; starting source
    `76393eee`; review tier standard: behaviour change in the shared effect
    runtime, covered by Included renders). Probes found three causes, none of
    them the size measurement alone, so each fix detects its case from
    geometry and UVs, not names:
    - Lapwing's face skin primitive holds face, neck, inner mouth and more in
      78 UV islands over one atlas. `AvatarFaceTextureAnchors` now projects
      only onto the face's island: the one nearest the point between the eyes
      among islands whose extent spans both eye centres, within half the eye
      spacing of that point (shared vertices and vertices with equal position
      and UV join); with none, every triangle is kept, as before.
    - Its eye primitive has a dome around each eyeball, centred on the eye
      bone and wider than the eye spacing, so it was picked as the eye; the
      too-large eye bounds put the under-eye and blush anchors at mouth
      height. With both eye bones, eye landmarks skip islands wider than
      their spacing (all islands are kept if that leaves none).
    - Iris art assumed VRoid's one-iris-per-half texture; Lapwing's irises sit
      elsewhere in its atlas, and each eye has stacked layers. Eye landmarks
      carry a `textureRect` (a layer over the whole eye with the largest
      texture area), and `resolveIrisEyeLayout`, when an iris does not sit in
      its half as VRoid's do, draws each eye's art in a cell 1.9 times its
      iris rectangle, clipped to it.
    - Result on Lapwing (private renders): blush on the cheeks, tears under
      the eyes, kiss mark on the cheek, face-red over the face, star3
      filling the irises as on Annie. mouth_w sits slightly below the mouth
      line (its anchor is expression-based and the jaw moves with the mouth
      shapes); recorded as a limitation. Included Avatars and the VRM 0
      fixture: identical landmark and anchor snapshots (compared before and
      after on the same machine), and review renders of blush, star3,
      single_tear, mouth_w, kiss_mark, face_red, streaming_tears and
      petrified_cracks (front and face, 0.5 and 1 s) differ by 0 pixels from
      `76393eee`.
    - The owner also asked for solutions that generalize to arbitrary
      non-VRoid VRMs (material names, texture layouts, a per-Avatar
      wind/spring option). An inventory of the remaining VRoid assumptions
      was taken for a separate spec; it is outside this plan.
- Materials investigation (2026-10-24, owner asked why Lapwing looks unlike
  Unity):
  - Every fallback material is a `MeshStandardMaterial` with metalness 1,
    roughness 1 and no environment map, so diffuse colour is lost under any
    rendering. Classic versus enhanced changes only lights and tone mapping for
    such materials; the MToon retune does not apply.
  - The earlier exports used `-nographics`, which left 19 of 26 textures as
    flat grey placeholders. The hair colour texture, for one, was a uniform 205
    grey instead of lavender. A GPU export (`Lapwing-tpose-gpu.vrm`, 22.93 MB,
    0 flat textures) replaced the stack's revision (`431a99b8`). Guide and
    script now say not to use `-nographics`.
  - The jacket comes from exporting `Lapwing.prefab`; the owner's Unity
    reference matches the `LapwingWithoutBorello Variant`.
  - A Phase 3 spike (uncommitted) adds `@mochiya/three-liltoon` 0.1.9 and wraps
    the VRM plugin with `enableLilToonVRM`, plus `enableLilToon` in
    `AvatarSceneLighting` and the review stage. Private renders closely match
    the Unity reference in both classic and enhanced rendering. Included
    Avatar review renders are pixel-identical to before in both modes (0
    differing pixels). Pending: owner go/no-go, frame cost, lazy loading,
    review.
- Remaining: the owner's live re-check of R1 (motion, springs, blink, visemes,
  look-at) and the Phase 4 face review, now with painted effects.

#### Code Review #1 Findings

The conversion and guide are light and covered by the final integration
review. The step 6 follow-up had its own standard review:

- Code Review #1 (reviewed tree `4f534dde` on `da791c5e`): no code defects.
  Included Avatars are unchanged and the controller has a single construction
  site. The option plumbing and the `InternalTPose` call were verified against
  the pinned package. Findings:
  - S6-F1 (required): plan records out of date.
  - S6-F2: the extension marks "converted by Mochiya", not "from VRChat".
  - S6-F3: the debug panel did not show `ambientForces`.
  - S6-F4: the test's gravity-direction assertion was dead, and drag was not
    asserted.
  - S6-F5: converted drag × multiplier exceeded 1, making three-vrm's inertia
    negative (measured jitter +35%).
  - S6-F6: the zero-gravity baseline returns with a debug gravity multiplier.
  - S6-F7: the fs allow list could name the file only; the label kept `.VRM`;
    the option had no test.
  - S6-F8: `-animamaKeepPose` was not logged, and the error was unclear
    without an Animator.
  - Also: the guide told users to run `vrm:optimize`, which refuses Mochiya
    extensions.
- Code Review #1 Revisions:
  - S6-F1: these records.
  - S6-F2: constant renamed to `MOCHIYA_CONVERSION_EXTENSION`; docs say
    "converted by Mochiya" and that re-export must keep the extension.
  - S6-F3: an "Ambient forces" row in the Spring Bones section.
  - S6-F4: the test now uses Annie's authored gravity and asserts drag.
  - S6-F5: effective drag capped at 1 for every Avatar (Included reach exactly
    1 at the default multiplier), with a test.
  - S6-F6: doc qualified.
  - S6-F7: only the file is allowed, the label strips `.vrm` in any case, and a
    browser test renders a copied `.VRM`.
  - S6-F8: opt-out logged, humanoid Animator checked first.
  - The `vrm:optimize` advice was replaced.
  - Revision checks on tree `c12e013d` (working tree on `da791c5e`):
    `npx vitest run src/lib/avatar src/ui` (`src/frontend/web`) 2831 passed,
    1 skipped; `pnpm -s web:lint`, `pnpm -s check` and
    `pnpm -s prettier:check` (`src/frontend`) pass;
    `node --test scripts/effect-render.browser.test.mjs` (`src/frontend/web`)
    5 passed. The updated C# compiled and ran a Validate in the private Unity
    project, logging "Applied the humanoid T-pose" and a clean Detect.
- Code Review #2 (targeted recheck, same reviewer, tree `c12e013d`): every fix
  verified, no regressions. It confirmed that Andrew and Annie author drag of at
  most exactly 0.5 and the VRM 0 fixture 0.4, so the drag cap leaves Included
  Avatars unchanged at the defaults. Findings: S6-R2-F1 (required) asked for
  this check record; S6-R2-F2 noted that only `effects:render` gained
  `--avatar-file`; S6-R2-F3 noted that the drag cap reaches existing user
  Avatars; and nits.
- Code Review #2 Revisions: the check record above; Phase 3 step 5 now says
  `animation:render` is still pending; the Decision Log notes the drag cap's
  reach; the nits are fixed. All are record or wording changes, verified by the
  implementer. One repair round remains unused.

The painted-effect fix had its own standard review:

- Code Review #1 (tree `ac148283` on `76393eee`): the three rules are no-ops on
  Annie, Andrew and the VRM 0 fixture (measured from their glTF data). Findings:
  - PF-F1 (required): the face island had no plausibility check; a small
    island at the seed, or a face unwrapped in two halves, would pull every
    anchor onto it.
  - PF-F9 (required): two statements were wrong (the mouth anchor uses all
    five mouth shapes; `textureRect` may be a layer's), plus nuances.
  - PF-F2: the VRoid check accepted irises inside their halves but
    off-centre.
  - PF-F3: art drawn into the iris rectangle is about half VRoid's size
    relative to the iris.
  - PF-F4: shared iris rectangles drew a mirrored copy over a normal one;
    per-eye mirrored UVs are not detected.
  - PF-F5: the width rule had no fallback if it removed every island.
  - PF-F6: "largest texture area" let a small stretched patch win.
  - PF-F7: recursive union-find `find` could overflow on large primitives.
  - PF-F8: check whether the mouth anchor is the fallback on Lapwing.
  - PF-F10: tests (VRM 0 evidence, a shared loader, quantized attributes in
    the helper, no controller wiring test).
  - PF-F11: record the tier; keep test values synthetic.
- Code Review #1 Revisions:
  - PF-F1 accepted: the face island must span both eye centres, else every
    triangle is kept. Test: a small island at the seed leaves the snapshot
    unchanged.
  - PF-F9 accepted: wording fixed, with the nuances (eye bones required,
    shared rectangles, `full` art on atlases) in the docs and conversion
    guide.
  - PF-F2 accepted: VRoid's layout needs the iris inside, roughly centred in
    and covering at least 40% of its half. Test added.
  - PF-F3 accepted: cells are 1.9 times the iris rectangle (VRoid's half is
    1.8–2.0 times its iris on both Included Avatars), clipped to the iris
    rectangle so art cannot reach the other eye. Lapwing's star3 now fills the
    iris as on Annie (private render).
  - PF-F4 partly accepted: shared rectangles draw unmirrored; per-eye
    mirrored UVs are recorded as a limitation.
  - PF-F5 accepted: all islands are kept if the rule leaves none.
  - PF-F6 accepted: a layer must be at least half the eye's width and
    height. Test: a small stretched patch is not taken.
  - PF-F7 accepted: iterative `find` with path compression.
  - PF-F8 checked: Lapwing's mouth anchor is expression-based, so the jaw
    explanation stands.
  - PF-F10 accepted: VRM 0 and Included snapshots compared before and after
    (identical); `loadedTestAvatar` shared by three tests; the helper refuses
    non-float positions and UVs. The controller wiring test is deferred: the
    0-pixel Included renders and the Lapwing renders cover the three call
    sites.
  - PF-F11 accepted: tier recorded; test rectangles are synthetic values.
  - Revision checks (tree `d6dc5e7b`): `pnpm -s check` and `pnpm -s web:lint`
    (`src/frontend`) pass; `npx vitest run src/lib/avatar src/ui`
    (`src/frontend/web`) 284 files, 2852 passed, 1 skipped; `prettier
    --check` on the changed TypeScript passes. Each new rule's test fails
    with the rule disabled (span, width, layer and footprint rules). Landmark
    and anchor snapshots of Annie, Andrew and the VRM 0 fixture are identical
    between `76393eee`'s source and this tree, and Included renders of the
    eight painted effects differ by 0 pixels.
- Code Review #2 (targeted recheck, same reviewer, tree `d6dc5e7b`): every
  repair verified; Included Avatars unchanged (`fitsVroidHalf` passes with
  margin on both and on the VRM 0 fixture; the iterative `find` handles
  200k-vertex chains). Findings:
  - PF-R2-F1 (required): the avatar-vfx.md sentence still gave the old
    island rule.
  - PF-R2-F2 (required): the revision check record was missing.
  - PF-R2-F3: with no face island spanning the eyes, a scalp island that does
    could be chosen far from the seed.
  - PF-R2-F4: art spanning both eyes (`double_eye`, `full_face`) drew without
    a clip.
  - PF-R2-F5: creator handles use the 1.9× cell's corners, which can snap to
    another island on an atlas (unverified).
- Code Review #2 Revisions:
  - PF-R2-F1 and F2 accepted: sentence and record above, verified by the
    coordinator.
  - PF-R2-F3 accepted: the face island must also come within half the eye
    spacing of the seed, else every triangle is kept.
  - PF-R2-F4 accepted: spanning art is clipped to both iris rectangles'
    bounds.
  - PF-R2-F5 deferred to the owner's creator check on Lapwing.
  - Checks after these repairs: `tsc --noEmit -p tsconfig.app.json` pass;
    `npx vitest run src/lib/avatar/vfx src/lib/avatar/AvatarFaceParts.test.ts`
    193 passed; Included and VRM 0 snapshots still identical to
    `76393eee`'s, and Lapwing's anchors unchanged by the reach guard. The full
    pre-push suite runs on the commit before the push. Review complete: one
    repair round used and a coordinator-verified wording/record repair.

### Phase 3: Authored lilToon rendering

Review tier: high risk. Adds a dependency and changes the shared rendering and
loading pipeline.

Requirements: R3. Depends on Phase 2's export.

Changes:

1. Add `@mochiya/three-liltoon` (exact version per its compatibility table, 0.1.9
   at planning time) as a runtime dependency.
2. Loading: read the GLB JSON chunk before parsing (or inspect it during fetch)
   and, only when `extensionsUsed` contains `MOCHIYA_materials_liltoon`, use a
   loader whose VRM plugin is wrapped by `enableLilToonVRM` (dynamically imported,
   so its code is a separate chunk). Keep the shared loader for all other files.
   Ensure `withEnhancedMToonPatch` skips lilToon materials.
3. Rendering: install `enableLilToon(renderer)` on each renderer owner that may
   show such an Avatar and release it on disposal. Do it lazily when a lilToon
   Avatar mounts, so other sessions never initialize it.
4. Integrations to verify and fix: silhouette overlay depth bias, tone-mapping
   uniform handling, enhanced three-point lighting versus the single directional
   light lilToon supports, face-painted Avatar Effects and face texture anchors,
   portrait capture, disposal (`releaseModelScene`), and review-render stages.
5. Review tooling (delivered early in the Phase 2 step 6 follow-up, so a no-go
   revert of the lilToon work keeps it; `effects:render` has it, while
   `animation:render` and `effects:bench` still need it if wanted):
   `effects:render` and `animation:render` gain an explicit
   `--avatar-file <path>` for a local Avatar outside the repository; outputs go
   to the given `--out` directory. Do not add third-party files to any allowlist
   in the repository.
6. Docs: material support in `docs/frontend/runtime/avatar-animation.md` and the
   conversion guide.

Checks: unit tests for loader selection and patch skipping; Included Avatar review
renders in classic and enhanced rendering diffed against `main` (expect 0 pixels
differing); `pnpm build` with a check that the entry chunks contain no lilToon
code; frame-cost measurement on Lapwing and an Included Avatar with
`effects:bench` (extended to accept `--avatar-file` if needed); full pre-push
suite before review (high-risk tier).

Owner gate: live view and review renders of Lapwing, lilToon versus PBR fallback,
plus the measured frame cost. On no-go, revert this phase's commits, record the
reason here, and keep the PBR fallback (or plan a Unity MToon re-export as a
separate decision).

Implemented (2026-10-24, owner: "turn the three-liltoon spike into Phase 3";
starting source `fd8be333`), revising change 2 above:

- `@mochiya/three-liltoon` 0.1.9 (MIT) is a runtime dependency.
- `src/lib/avatar/liltoon/lilToon.ts` `withOnDemandLilToon` wraps the shared
  VRM plugin instead of selecting a second loader. In `beforeRoot` it imports the
  package only when `extensionsUsed` lists `MOCHIYA_materials_liltoon`, then
  applies the package's own `enableLilToonVRM` to the plugin (GLTFLoader reads
  `loadMaterial` and `afterRoot` when it calls them). Without the extension it
  changes nothing. In development and the review tools a failed import logs,
  keeps the fallback materials and lets a later load retry; in a built app a
  failed chunk download shows the app's reload screen (`PageLoadError`), the
  policy for every lazily loaded chunk. `withEnhancedMToonPatch` only touches
  MToon extensions, so it needs no change.
- Rendering: `installLilToonRenderingWhenLoaded(renderer)` installs
  `enableLilToon` once the package has loaded, from `AvatarSceneLighting` (chat,
  preview and Create Anima canvases) and the review stage (`createStage`'s
  `disposeRenderer` releases it). The landing stage and `animation:preview`
  load only the Included Avatars, so they never load the package.
- Licence notices: the package's MIT notices for the lilToon code it bundles
  are in `dist/THIRD_PARTY_NOTICES.md`; the desktop licence inventory and the
  landing site's `notices.txt` now pick up `NOTICES` files.
- Integrations found and fixed: silhouette overlays bias lilToon materials −8
  depth units (they flickered across the whole body; the earlier trial's fix);
  `releaseModelScene` disposes `lilToonTextures`, which leaked otherwise.
  Verified on Lapwing in private renders: plane effects, stickers, the
  silhouette, tone mapping in both looks. Painted face effects still misplace
  (the Phase 2 finding, independent of lilToon). Portrait capture uses the chat
  renderer, so it gets the passes, but it was not rendered.
- `effects:bench --avatar-file` added (step 5 is now done for `effects:render`
  and `effects:bench`).

Evidence (Apple M5):

- Private renders of the GPU export closely match the owner's Unity reference
  in enhanced and classic rendering; the on-demand path renders pixel-identically
  to the spike.
- Included Avatar review renders (`library:blush`, front and face) are
  identical before and after in both looks (0 differing pixels).
- `pnpm build`: three-liltoon is in its own chunks (1.88 MB shader code plus a
  181 KB entry and a 2 KB VRM entry; 341 KB gzip in all), reached only through
  a dynamic `import()` from the avatar chunk and not preloaded by `index.html`.
  The landing site build also emits them, unused, because its stage shares
  `Avatar`; its `notices.txt` lists the package.
- `effects:bench --avatar-file`, 1600×1200, DPR 2, idle Gesture, no effects,
  4 rounds of 1200 frames. GPU time per frame:

  | Avatar | GPU ms/frame |
  | --- | --- |
  | Lapwing, lilToon (twice) | 20.61 and 20.73 |
  | Lapwing, fallback materials | 1.53 |
  | Lapwing, lilToon without outline variants | 29.86 |
  | Andrew | 6.67 |
  | Annie | 4.73 |

  lilToon roughly adds 19 ms of GPU time per frame on this GPU, so weaker GPUs
  will drop below 60 fps. That is an owner decision; possible mitigations are a
  lower pixel ratio for lilToon Avatars, or finding the costly lilToon features.

Check record (source of tree `cac27032`; later trees changed only docs and
these records):

- Coordinator: `pnpm -s check` pass; `npx vitest run src/lib/avatar/liltoon
  src/lib/avatar/releaseModelScene.test.ts src/lib/avatar/vfx/silhouetteOverlay.test.ts`
  14 passed; `pnpm -s landing:build` pass (three-liltoon in `notices.txt`);
  chunk check on `pnpm build` output (three-liltoon only in its own chunks,
  none named by `index.html`).
- Independent checks agent: `npx vitest run src/lib/avatar src/ui` 2842
  passed, 1 skipped; `pnpm -s web:lint` and uncached `npx eslint .` pass;
  desktop `tests/runtime-packaging.test.mjs` 71 passed; `tsc --noEmit` for
  `tsconfig.app.json` and `tsconfig.scripts.json` pass; through heavy-slot,
  `node --test` of the effect-render, effect-check, animation-reel and
  content-tune browser tests 18 passed. `effects:bench` itself has no test.
- The full pre-push suite runs once on the final candidate before the push.

Owner gate still open: the go/no-go on look and frame cost.

#### Code Review #1 Findings

High-risk tier; analysis on working tree `6c8067f2` over `fd8be333`.

- P3-F1 (blocking): in a built app a failed chunk download is cancelled by
  `PageLoadError` (`vite:preloadError`), so `import()` resolves to undefined.
  The app shows its reload screen instead of the fallback the docs describe,
  and the first renderer listener's TypeError left the shared import rejected
  for good.
- P3-F2 (blocking): the desktop licence inventory only reads files named like
  `LICENSE`, so it would drop the lilToon notices that the package keeps in
  `dist/THIRD_PARTY_NOTICES.md`.
- P3-F3: `createStage` discarded the release, so every review stage of a run
  that never loads lilToon kept its disposed renderer in the listener set.
- P3-F4: once loaded, the passes stay on every Avatar canvas until it unmounts
  (one visible and three full traversals per render); output for other
  materials is unchanged; the cost is not measured.
- P3-F5: doc imprecision. lilToon reads only the first directional light;
  `animation:render` and the `vrm:optimize` compare page always draw the
  fallback; the landing stage and `animation:preview` never install the passes;
  the bench options list lacks `--avatar-file`.
- P3-F6 (optional): reuse the package's `enableLilToonVRM` inside `beforeRoot`;
  `afterRoot` read the module-level runtime; the `Map` branch in
  `releaseModelScene` is speculative; a re-declared extension type.
- P3-F7: no test of the real loader chain or of a VRM through the real
  runtime; the failure test cannot represent the built app.
- P3-F8 (record): the renderer is alpha, 0.1.x, single vendor, pinned exactly.
  Peer ranges are met (three 0.182.0, three-vrm 3.5.2), but upstream tested
  three 0.180 and 0.185.1 with three-vrm 3.5.5. The web app's `^3.4.4` range
  for `@pixiv/three-vrm` would break the peer range at 4.x. The VRM entry and
  the avatar chunk share one three-vrm module, so `instanceof` checks hold.

#### Code Review #1 Revisions

- P3-F1 accepted (documented policy plus hardening): the built app keeps the
  app-wide stale-file policy (reload screen); the module comment, docs and this
  plan say so. `importLilToonRuntime` throws when either module lacks its entry
  point, the failure resets the shared import so a later load retries, and each
  renderer listener runs isolated. Tests: failure then retry; one failing
  renderer does not stop another.
- P3-F2 accepted: `NOTICE_NAME` also matches `NOTICES` in file names (it
  matched `NOTICE`); the packaging test fixture adds
  `dist/THIRD_PARTY_NOTICES.md`. Only
  three-liltoon's notice joined the inventory.
- P3-F3 accepted: `createStage` returns `disposeRenderer`, which releases the
  passes and disposes the renderer; all six callers use it.
- P3-F4 accepted as documented: the docs say the passes stay until the canvas
  unmounts and what each render then does. Not measured; Included Avatars on a
  canvas that never loaded lilToon are unaffected.
- P3-F5 accepted for the docs (lights, fallback-only tools, bench option).
  Installing passes in the landing stage and `animation:preview` is rejected:
  both load only the Included Avatars, which never load the package.
- P3-F6 accepted: `beforeRoot` applies `enableLilToonVRM` to the plugin, which
  removes the hand-written delegation, the module-level `afterRoot` read and
  the extension type; the `Map` branch was removed.
- P3-F7 accepted for the loader: a test runs Andrew through
  `withEnhancedMToonPatch(withOnDemandLilToon(...))` with one material given
  the extension and gets both a lilToon and an MToon material. A VRM through
  the real runtime's expression bindings stays covered by the private Lapwing
  renders only (no licensed lilToon VRM can be a fixture). The built-app
  failure path is the documented reload screen, not a unit-tested fallback.
- P3-F8 recorded above; no change.

Repair budget: one round used.

#### Code Review #2 Findings

Targeted recheck of the repairs on tree `cac27032`: every code repair and the
rejection pass. One blocking finding:

- P3-R2-1: the repair round ran Prettier over four Markdown files, which the
  repository does not format (root `.prettierignore` is `*`), reflowing
  unrelated sections of `avatar-animation.md`, `avatar-vfx.md`, the conversion
  guide and this plan.

#### Code Review #2 Revisions

- P3-R2-1 accepted: the whitespace-only changes were reverted from `HEAD` (the
  patch of `git diff -w` reapplied), along with padded table rules, a stray
  blockquote and mangled `_`/`*` in earlier phase records. Each file's diff
  now equals its `git diff -w`. Verified by the coordinator (a formatting-only
  repair). Repair budget: two rounds used.

### Phase 4: ARKit emotions and face-track translation

Review tier: standard. Behavior change inside the expression runtime with
regression risk for every Avatar, covered by renders.

Requirements: R5, R6. Depends on Phase 1.

Changes:

1. `lib/avatar/arkitFaceCompositions.json` with a typed TypeScript wrapper: one
   table, shared with Phase 6, holding
   - ARKit compositions per emotion group and intensity (starting mixes: happy
     `mouthSmile` L/R .8, `cheekSquint` L/R .5, `eyeSquint` L/R .3; sad
     `browInnerUp` .7, `mouthFrown` L/R .5, `mouthShrugLower` .2; angry
     `browDown` L/R .8, `noseSneer` L/R .3, `mouthPress` L/R .4; surprised
     `browInnerUp` .8, `browOuterUp` L/R .8, `eyeWide` L/R .6, `jawOpen` .3;
     relaxed `mouthSmile` L/R .3, `eyeBlink` L/R .2), mapped onto the existing
     emotion groups;
   - an ARKit mix per VRoid part (`Fcl_BRW_*`, `Fcl_EYE_*`, `Fcl_MTH_*`,
     `Fcl_ALL_*`) and per mood preset (happy, angry, sad, relaxed, surprised).
2. `ExpressionController.ts`: resolution order per key — the Avatar's own shape;
   then the ARKit mix when the Avatar has sufficient coverage; then today's preset
   fallback. Emotions on an ARKit Avatar use the ARKit compositions (Decision Log
   proposal). Keep the overlay cap so Reaction parts only fill the room the mood
   leaves, now in ARKit terms. Retire `_arkitToVrmMap` if nothing needs it.
3. `eyelidClosure.ts`: treat ARKit eyelid motion (`eyeBlink*` used in relaxed,
   `eyeSquint*`, `cheekSquint*`) like VRoid eye parts so blink cannot drive lids
   past shut.
4. Docs: `docs/frontend/runtime/avatar-emotion.md` (resolution order, ARKit
   table, authoring guidance unchanged for content).

Checks: unit tests for the resolution order on synthetic ARKit, VRoid and
preset-only Avatars and for the eyelid correction; Included Avatar renders of
emotions and a sample of Reactions/Gestures unchanged against `main`; Lapwing
renders through `--avatar-file` for the owner (Reactions via
`effects:render --with-clip`, since the debug panel cannot play talking-scoped
Reactions).

Owner gate: visual review of the six emotions at three intensities and the
sampled Reactions/Gestures on Lapwing; table values are tuned from that review.

Implemented approach (starting source `0b845881`), revising change 2 above
after the discovery recorded in Surprises & Discoveries:

- `arkitFaceCompositions.json` and `arkitFaceCompositions.ts`: the table,
  `ARKIT_MOOD_MIXES`, `ARKIT_PART_MIXES` (the 20 mood parts plus
  `Fcl_MTH_Large`, `Fcl_MTH_A`, `Fcl_EYE_Spread`, `Fcl_EYE_Close[_L|_R]`) and
  `playsFacesWithArkit` (every table shape resolves).
- `arkitFaceExpressions.ts` `registerArkitFace(vrm)`: registers canonical ARKit
  shapes and, on qualifying Avatars, each mood preset (replacing authored ones)
  and each table part the file lacks, as expressions whose binds are the ARKit
  shapes' morph binds scaled by the mix. Idempotent. Called by `Avatar.load`
  before the eyelid correction, by `ExpressionController` and by
  `animation:render`.
- `eyelidClosure.ts`: each ARKit mix that closes the lids reduces blink by its
  measured share of blink's motion; profile corrections skip mixes.
- `ExpressionController.getAvailableExpressions()` lists ARKit shapes under the
  canonical name only (P1-F7).
- The emotion map, overlay cap and clip precedence are unchanged: on an ARKit
  Avatar they find real `happy` and `Fcl_*` expressions. `_arkitToVrmMap` is left
  as it was (its `_applyExpression` fallback never runs; outside this scope).
- Docs: `avatar-emotion.md` "ARKit Avatars"; `avatar-animation.md` points to it.

Check record (working tree on `0b845881`, tree `4b6e6be3`):

| Command | Directory | Result |
| --- | --- | --- |
| `npx vitest run src/lib/avatar src/ui/pose-creator` | `src/frontend/web` | 1438 passed, 1 skipped |
| `pnpm -s web:lint` | `src/frontend` | pass |
| `pnpm -s check` | `src/frontend` | pass |

Owner gate still open: visual review of the six emotions at three intensities
and sampled Reactions/Gestures on Lapwing (needs Phase 2 and `--avatar-file`
from Phase 3).

#### Code Review #1 Findings

Reviewed tree `4b6e6be3` against `0b845881`, standard tier, by an independent
sdlc-reviewer agent; it reused the check record and ran an esbuild probe of the
real modules on synthetic faces. It judged the change of approach sound.

- P4-F1 (required): a VRoid Avatar that also has every ARKit shape (VRoid
  "Perfect Sync") had its raw `Fcl_*` morph parts and presets replaced by mixes,
  because raw parts become expressions only after `registerArkitFace` runs.
  Breaks R6 and the docs; no hybrid test.
- P4-F2 (optional): one-sided mixes (`Fcl_EYE_Close_L/R`) got a 0.5 global blink
  reduction: the winking eye closed to 1.5 under blink and the open eye only
  half-blinked.
- P4-F3 (optional): the default eyelid profile still evaluated the ARKit mixes,
  so the load log reported a profile that was not applied; JSDoc out of date.
- P4-F4 (optional): measuring every mix over all vertices is costly on a large
  converted body mesh; per-shape shares weighted by the mix give the same result.
- P4-F5 (observation): replaced presets keep their scene objects, so a VRMA
  expression track would bind a stale expression; no Animama content uses them.
- P4-F6 (observation): raw ARKit spellings stay registered though hidden from
  `getAvailableExpressions()`; harmless while nothing sets them.
- Not in the record: Included Avatar render diffs against `main` (low risk: both
  resolve 0 of 52 shapes, so nothing registers); the tree hash was missing.

#### Code Review #1 Revisions

- P4-F1 accepted (option b, which matches R5's "no `Fcl_*` parts"): an Avatar
  with VRoid mood parts of its own, as morph targets or expressions, does not
  play faces with ARKit and keeps its authored face. Test: a hybrid Avatar keeps
  its `sad` and plays its raw `Fcl_MTH_Fun`. Docs updated.
- P4-F2 accepted: one-sided mixes are not corrected, so the open eye blinks
  fully during a wink (as on VRoid today, the winking eye is uncorrected).
  Test added; documented.
- P4-F3 accepted: the default profile ignores mixes; JSDoc names
  `registerArkitFace`.
- P4-F4 accepted: each ARKit shape's share is measured once and mixes sum the
  weighted shares.
- P4-F5, P4-F6: no change; recorded here.
- Render diffs: not run, for the reason above; the final pre-push suite and the
  owner's Lapwing review remain.

Revision checks on tree `01a06906` (working tree on `0b845881`, excluding the
Phase 6 files and `package.json`): `npx vitest run src/lib/avatar
src/ui/pose-creator` 1440 passed, 1 skipped; `pnpm -s web:lint` pass;
`pnpm -s check` pass. Repair budget: one round used.

#### Code Review #2 Findings

Targeted recheck by the same reviewer, with its probe: P4-F1 to P4-F4 verified
(hybrid Avatars keep their face; open eye blinks during a wink; logged profile
accurate; per-shape shares give the same override amounts). No blocking
findings.

- P4-R2-F1 (optional): an ARKit Avatar with a raw non-mood part
  (`Fcl_EYE_Close`, `Fcl_MTH_A` …) but no mood parts still had that part
  replaced by a mix.

#### Code Review #2 Revisions

- P4-R2-F1 accepted: a table part the file has as a raw morph is not registered
  as a mix, so it becomes its own expression. Test added. Trivial fix verified
  by the implementer: `npx vitest run src/lib/avatar src/ui/pose-creator` 1441
  passed, 1 skipped; `pnpm -s web:lint` and `pnpm -s check` pass, on the Phase 4 commit's tree. One repair round remains unused.

Commits: `eac8f4f9` `feat(avatars)[p4]: play emotions and VRoid face parts as
ARKit mixes` (tree `2b1dbfbd`).

### Phase 5: ARKit lip-sync shaping

Review tier: standard.

Requirements: R7. Depends on Phases 1 and 4.

Changes: when an Avatar has ARKit mouth coverage, translate `vowel5` frames into
ARKit mouth mixes (`jawOpen`, `mouthFunnel`, `mouthPucker`, `mouthStretch`,
`mouthSmile`, `mouthClose` and similar) through the existing `arkit_52` frame
path, selectable against viseme presets for comparison. Keep viseme presets as
the behavior for every other Avatar. Interaction with emotion mouths follows the
existing lip-sync layering.

Checks: unit tests for the vowel-to-ARKit translation and selection; a local
chat on the task stack with a TTS voice.

Owner gate: listen-and-watch comparison on Lapwing; record the chosen default.
If visemes win, keep the translation only if the owner wants the option,
otherwise revert the phase.

#### Code Review #1 Findings

Not run.

### Phase 6: Bake VRM presets

Review tier: standard. A new local file-writing command.

Requirements: R8. Depends on Phase 4's table.

Changes: `pnpm -s vrm:bake-expressions <source.vrm> --out <baked.vrm>
[--replace]` (`scripts/vrm-bake-expressions.mjs`, reusing `vrm-optimize/glb.mjs`)
writes `VRMC_vrm.expressions.preset` entries for happy, angry, sad, relaxed,
surprised and neutral as morph-target binds from the shared table. It refuses to
overwrite the source or an existing output, keeps existing presets unless
`--replace`, preserves the binary chunk byte for byte and all other JSON and
extensions unchanged in value, and reports shapes it could not resolve. Document it beside
`vrm:optimize`.

Checks: unit tests on a synthetic VRM (presets written, extensions preserved,
source unchanged, refusal cases); `vrm:inspect` on baked Lapwing; the baked
file loads with presets on the stack.

Implemented (starting source `eac8f4f9`): `scripts/vrm-bake-expressions.mjs`
loads `resolveArkitFacesPerMesh` and `ARKIT_MOOD_MIXES` through the Vite SSR
loader (as `vrm:inspect` does), so it resolves shapes per mesh exactly as the
app does and uses the Phase 4 table. Binds reference the nodes whose meshes
carry mesh-level `extras.targetNames`. Shared fixture
`scripts/testing/faceFixtureVrm.mjs` (from Phase 1). Usage documented in
`avatar-emotion.md` "ARKit Avatars", beside the table it bakes, rather than in
the shipping-focused `vrm-optimization.md`.

Check record (working tree on `eac8f4f9`, tree `c26246a3`):
`node --test scripts/vrm-bake-expressions.test.mjs scripts/vrm-inspect.test.mjs`
(`src/frontend/web`) 7 passed; `pnpm -s web:lint` (`src/frontend`) pass.
`pnpm check` does not type-check `.mjs` scripts.

#### Code Review #1 Findings

Reviewed tree `c26246a3` against `eac8f4f9`, standard tier, by an independent
sdlc-reviewer agent with a read-only probe (shared-mesh nodes, per-primitive
names, JSON re-serialisation). VRM 1.0 bind fields, neutral, overrides,
per-mesh spelling, source protection and argument parsing verified.

- P6-F1 (required): the header said Animama's runtime mixes take precedence
  "either way"; on an Avatar missing table shapes Animama plays the baked
  presets, and the doc did not say so.
- P6-F2 (required): the test fixture carried no extension payloads, so it could
  not show other extensions (Mochiya's included) preserved.
- P6-F3 (optional): ambiguous shapes were reported as not found, and shapes of
  kept presets were listed.
- P6-F4 (optional): meshes naming targets only per primitive gave no hint.
- P6-F5 (optional): a failed write could leave a partial output that blocks
  the next run.
- P6-F6 (optional): the plan said "byte-for-byte" for JSON, which is
  re-serialised (values unchanged; the binary chunk is byte-identical).
- P6-F7 (optional): `--replace` emptied an authored neutral.

#### Code Review #1 Revisions

- P6-F1 accepted: header and `avatar-emotion.md` say Animama plays baked
  presets on Avatars missing table shapes; the CLI prints that note when shapes
  are missing or ambiguous.
- P6-F2 accepted: the fixture gains a material with a synthetic
  `MOCHIYA_materials_liltoon` payload and `extras`, and a top-level
  `VRMC_springBone`; `faceFixtureVrm` now merges extra `extensions` beside
  `VRMC_vrm` (the whole-JSON comparison covers them).
- P6-F3 accepted: `ambiguousShapes` reported separately; only shapes of written
  presets are listed. Test asserts both.
- P6-F4 accepted: `primitiveOnlyMeshes` counted and printed with a pointer to
  `vrm:inspect`. Duplicate names in `targetNames` left as an edge case.
- P6-F5 accepted: written to `<out>.partial-<pid>`, then hard-linked to the
  output (fails if it exists) and the partial removed in all cases.
- P6-F6 accepted: wording fixed in this plan and the header.
- P6-F7 accepted: an authored neutral is always kept; test added.

Revision checks (working tree on `eac8f4f9`): `node --test
scripts/vrm-bake-expressions.test.mjs scripts/vrm-inspect.test.mjs` 7 passed;
`pnpm -s web:lint` pass. Repair budget: one round used.

#### Code Review #2 Findings

Targeted recheck by the same reviewer: P6-F1 to P6-F7 verified; fixture change
has no regression for `vrm-inspect.test.mjs`.

- P6-R2-F1 (required, regression from the P6-F5 fix): `link` needs hard links,
  which exFAT/FAT drives and some network shares lack, so the command would
  fail there; a race also surfaced a raw `EEXIST`.
- P6-R2-F2 (optional): the "Animama plays these baked presets" note ignored kept
  presets' shapes and VRoid mood parts, which the runtime also considers.
- P6-R2-F3 (optional): `primitiveOnlyMeshes` counted nodes, not meshes.
- P6-R2-F4 (optional): no tests for the ambiguous and per-primitive paths, the
  CLI lines, or a leftover partial file.

#### Code Review #2 Revisions

- P6-R2-F1 accepted: back to a direct `wx` write; on failure the output this
  process created is removed, and `EEXIST` gives the friendly message.
- P6-R2-F2 accepted: `animamaPlaysBakedPresets` mirrors the runtime (every mood
  shape resolves and no VRoid mood parts); the CLI always says which faces
  Animama plays. Doc and header updated.
- P6-R2-F3 accepted: counted by mesh index.
- P6-R2-F4 accepted: tests for ambiguous shapes, a per-primitive mesh shared by
  two nodes, the CLI lines and no leftover files.

Revision checks (working tree on `eac8f4f9`): `node --test
scripts/vrm-bake-expressions.test.mjs scripts/vrm-inspect.test.mjs` 8 passed;
`pnpm -s web:lint` pass. Repair budget: both rounds used; Code Review #3 is the
final targeted recheck.

#### Code Review #3 Findings

Final targeted recheck: P6-R2-F1 to F4 verified, no regressions. Result: pass.

- P6-R3-F1 (optional): the CLI derived the table shapes from the mood mixes and
  copied the VRoid mood-part pattern instead of using the app's definitions.
- P6-R3-F2 (optional): authored custom expressions named like VRoid mood parts,
  which the runtime counts, were not counted.
- P6-R3-F3 (optional): no test for the "plays its own mixes" branch or the
  VRoid-part branch.

#### Code Review #3 Revisions

All three accepted as trivial follow-ups, verified by the implementer (no
review rounds remain): `isVroidMoodPart` moves to `arkitFaceCompositions.ts`
and is shared by `registerArkitFace` and the CLI, which also takes
`ARKIT_COMPOSITION_SHAPES` and counts custom expression names; a test covers
all three outcomes. Checks: `node --test scripts/vrm-bake-expressions.test.mjs
scripts/vrm-inspect.test.mjs` 9 passed; `npx vitest run src/lib/avatar/arkit`
25 passed; `pnpm -s web:lint` and `pnpm -s check` pass, on the Phase 6
commit's tree.

Commits: `51082213` `feat(avatars)[p6]: add vrm:bake-expressions for ARKit
mood presets` (tree `ad27498a`).

## Final integration review

Covers combined acceptance R1–R9, Phase 2 (light), the licence boundary across
the whole diff and Git history (no third-party Avatar data, renders or names of
private paths), and documentation accuracy. Then the full pre-push suite once on
the final candidate; results go in the PR.

### Code Review #1 Findings (Phases 1, 4 and 6)

Reviewed `f9b0d8f1..51082213` (tree `ad27498a`) by an independent sdlc-reviewer
agent, reusing phase evidence and running no checks. Result: pass on code,
cross-phase integration (per-mesh resolution → mixes and eyelid correction →
bake decision), the licence boundary (no binary or third-party data; synthetic
fixtures) and conventions. Included Avatars are unaffected: every new branch is
gated on resolved ARKit shapes, and both resolve none.

- INT-F1 (required): Phase 4 and 6 commits and trees were not recorded.
- INT-F2 (optional): Phase 1's revision check listed a Phase 6 test file.
- INT-F3 (optional): R2 is only partly met (per-primitive names deferred), and
  Phase 2 did not carry the decision forward.
- INT-F4 (optional): Phase 3's no-go revert would also remove `--avatar-file`,
  which the Phase 4 gate needs.
- INT-F5 (optional): the VRoid-mood-part qualification lived only in review
  revisions.
- INT-F6 (optional): `PRESET_BY_MOOD` and the mood-part pattern are defined in
  both `partExpressionFallback.ts` and `arkitFaceCompositions.ts`.
- INT-F7 (optional): `vrm:inspect` does not say whether Animama plays ARKit
  faces for the file.
- INT-F8 (optional): for a file authoring an expression under a canonical ARKit
  name, the bake binds the raw morph while the runtime scales the authored
  expression's binds; the decision still matches.
- INT-F9 (optional): Outcomes & Retrospective was empty.
- INT-F10 (optional): ADR index row width.

### Code Review #1 Revisions

- INT-F1, INT-F2, INT-F5, INT-F9 accepted: plan records updated (Phase 4 and 6
  `Commits:` lines, Phase 1 note, Decision Log entry, Outcomes).
- INT-F3 accepted: Phase 2 step 5 now requires Phase 1 step 4 when names are
  primitive-only; R2 is not claimed accepted.
- INT-F4 accepted: Phase 3 step 5 is committed separately and first.
- INT-F10 accepted: row padded.
- INT-F6, INT-F7, INT-F8 deferred to the next code change in this plan (Phase
  2 or 3), so the pre-push suite already running on `ad27498a` stays valid for
  the PR: share one VRoid mood vocabulary module; add the "Animama plays ARKit
  faces" line to `vrm:inspect` (Phase 2 step 5 uses it); note or align the bake
  edge case.

## Validation and acceptance

Full pre-push suite for Phases 1, 4 and 6, through `scripts/heavy-slot.py` on
`51082213` (tree `ad27498a`), 2026-10-24:

| Step | Command | Result |
| --- | --- | --- |
| Backend | `make check-test` (root) | 4798 passed, 29 skipped, 1 failed: `tests/test_generate_synthetic_docs.py::test_presets_are_nested_balanced_and_exclude_plans` (xxsmall 46854 bytes vs small/4 ≈ 53306 ± 12%). Pre-existing on `main`: none of its inputs (curated `docs/backend` and `docs/frontend` paths, the generator, the test) differ in `f9b0d8f1..51082213`. |
| Frontend | `pnpm verify` (`src/frontend`) | pass |
| Browser | `pnpm web:test:browser` (`src/frontend`) | pass |
| Format | `pnpm prettier:check` (`src/frontend`) | failed on 5 new script/TS files |

Repair: Prettier applied with the web package's ignore path in `5785de27`
`chore(avatars): format the ARKit inspection and bake scripts`. It only rewraps lines, so the
affected checks were rerun instead of the whole suite: `pnpm prettier:check`
(`src/frontend` and `src/frontend/web`) pass; `node --test
scripts/vrm-bake-expressions.test.mjs scripts/vrm-inspect.test.mjs` 9 passed;
`npx vitest run src/lib/avatar` 1265 passed, 1 skipped; `pnpm -s web:lint` pass.

Not run: Included Avatar render diffs against `main` and `pnpm e2e:test:fast`
(new branches are gated on resolved ARKit shapes, which Included Avatars lack;
see the final integration review).

Spec acceptance criteria, with these commands (from `src/frontend` unless noted):

- `pnpm verify`; `pnpm web:test:browser` for the review-render and stage changes.
- Backend unchanged unless Phase 2 finds an upload rejection; then `uv run pytest
  -q` for the touched validator from the repo root.
- Included Avatar render diffs against `main` (classic and enhanced).
- `pnpm e2e:test:fast` against a disposable built stack, since Avatar loading
  and rendering are user-facing.

Owner-only checks: R1 live checks, lilToon go/no-go, emotion and face review, lip
sync choice.

## Idempotence and recovery

- Conversion reruns from the untouched Unity project; outputs are disposable.
- `vrm:inspect` only reads; `vrm:bake-expressions` never writes its source.
- lilToon support is opt-in per file; reverting Phase 3 restores the PBR
  fallback without touching stored Avatars.
- The task stack (`animama-vrcarkit`) holds only test data and is torn down after
  its last use; the converted Avatar remains in `<private-avatars>`.

## Outcomes & Retrospective

Delivered on `feat/vrchat-avatar-arkit` (2026-10-24), Phases 1, 4 and 6:

- ARKit-52 shapes are detected per mesh under common spellings and registered
  under canonical names; `pnpm -s vrm:inspect` reports a file's names, storage,
  sizes and ARKit coverage.
- Avatars with every table shape and no VRoid mood parts play emotions,
  Reactions, Gestures, creator previews and portraits through ARKit mixes; the
  eyelid correction measures each mix.
- `pnpm -s vrm:bake-expressions` writes the mood presets into a copy of a file.

Open: Phases 2, 3 and 5 (owner Unity setup and Lapwing files first); owner
visual gates for Phase 4 on Lapwing; R1, R2 (per-primitive names), R3, R7, R9;
INT-F6 to F8 follow-ups.

Lesson: content reaches expressions through several paths (controller, creator
preview, portraits, render harness), so face vocabulary belongs in registered
expressions rather than in one consumer.

Follow-up candidates (separate issues when chosen): a face-tracking add-on for
Lapwing once licensed (inventory its shapes, extend the alias table, apply the
purchased patch rather than recreating its shapes); content keyed to an ARKit
vocabulary; AI-composed faces; backend audio-to-face producing `arkit_52` frames.
