# Converted VRChat Avatars with native ARKit faces

Source agreement: raymond-van/animama#687 (published 2026-10-24 from the agreed
draft; snapshot in [vrchat-arkit-avatars-spec.md](vrchat-arkit-avatars-spec.md)).
The issue is the spec; owner decisions are in the Decision Log.
Authorized scope: Phases 1, 4 and 6 (owner, 2026-10-24). Phases 2, 3 and 5 wait
for the owner's Unity setup and a separate go-ahead.
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
- [ ] Phase 2: Convert Lapwing. Blocked on owner: Unity install and files.
- [ ] Phase 3: Authored lilToon rendering. Needs Phase 2 output; owner look gate.
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
- 2026-10-24, agent (within the approved outcome): ARKit mixes are registered
  as expressions rather than translated at each call site; see Phase 4.
- 2026-10-24, owner (confirming an agent proposal): on an Avatar with sufficient
  ARKit coverage, runtime ARKit emotion compositions take precedence over its
  VRM presets; baked presets serve other VRM apps. "Sufficient" means every shape
  the composition table uses resolves.

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
scripts/vrm-bake-expressions.test.mjs` 7 passed; `vrm:inspect` on
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

Review tier: light. Documentation plus local, untracked conversion work.

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
5. `pnpm -s vrm:inspect` the result: ARKit and MMD names present, where names
   are stored, size against the 100 MB limit, extensions. If oversized, run
   `pnpm -s vrm:optimize` and re-inspect that `MOCHIYA_materials_liltoon` and its
   textures survived.
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

#### Code Review #1 Findings

Light phase; covered by the final integration review.

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
5. Review tooling: `effects:render` and `animation:render` gain an explicit
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

#### Code Review #1 Findings

Not run.

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
  passed, 1 skipped; `pnpm -s web:lint` and `pnpm -s check` pass, on the Phase
  4 commit's tree recorded below. One repair round remains unused.

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

## Final integration review

Covers combined acceptance R1–R9, Phase 2 (light), the licence boundary across
the whole diff and Git history (no third-party Avatar data, renders or names of
private paths), and documentation accuracy. Then the full pre-push suite once on
the final candidate; results go in the PR.

## Validation and acceptance

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

Not started.

Follow-up candidates (separate issues when chosen): a face-tracking add-on for
Lapwing once licensed (inventory its shapes, extend the alias table, apply the
purchased patch rather than recreating its shapes); content keyed to an ARKit
vocabulary; AI-composed faces; backend audio-to-face producing `arkit_52` frames.
