# Avatar Effects and Reactions on common third-party VRM layouts

Source agreement: raymond-van/animama#760 (published 2026-10-27, Agreed the
same day; snapshot in [arbitrary-vrm-effects-spec.md](arbitrary-vrm-effects-spec.md)).
The issue is the spec.
Authorized scope: the whole plan, as one PR from this branch (owner,
2026-10-27). Owner gates in each phase still apply. Merge approval and any use
of third-party Avatar data beyond local testing stay separate.

## Purpose and context

An Avatar a user uploads from VRChat, BOOTH or a low-poly pack wears the same
Avatar Effects and Reactions as an Included Avatar. When a face part cannot be
found, Diagnostics names it and the effect is skipped; no effect reports
success while drawing nothing or landing off the face. The Included Avatars
behave exactly as before.

Starting source: `main` at `b8fed9a5` (PR #744 merged). Task branch
`feat/arbitrary-vrm-effects`, in its own worktree; frontend dependencies are
installed with `pnpm install` and `pnpm -s packages:build` in `src/frontend`.
No Compose stack is needed until the owner's live check.

### What #691 already provides (do not re-specify)

Paths are relative to `src/frontend/web/src/lib/avatar/` unless noted.

- Face parts from model data: `vfx/faceParts.ts` `detectAvatarFaceParts`.
  `detectFromSignals` needs the VRM `blink` and `aa` presets bound on the same
  mesh, `detectEyesFromBlink` finds eyes from blink islands, and
  `detectFromNames` plus `vfx/profiles.ts` are the name fallback.
- Landmarks and anchors: `vfx/AvatarFaceLandmarks.ts` builds eye landmarks from
  iris geometry (`createEyeLandmarkFromIsland`); `vfx/AvatarFaceTextureAnchors.ts`
  derives blush, under-eye and mouth anchors from eye landmarks and viseme binds,
  and `selectFaceIsland` picks the face's UV island for whole-face art.
- Apply-time warnings: `vfx/AvatarVFXController.ts` warns when a part is missing
  (`Skipped "…": this avatar has no detected …`), anchors are missing, or hover
  placements do not resolve. Hover planes have fixed heights
  (`EYE_HOVER_PLANE_HEIGHT` 0.06 m, `BOX_HOVER_PLANE_HEIGHT` 0.08 m).
- Expressions: `ExpressionController.ts` drives auto-blink through `blink` and
  lip-sync through viseme names; `mmdFaceExpressions.ts` (`registerMmdFace`,
  `MMD_BLINK_MORPHS`) and `arkitFaceExpressions.ts` (`registerArkitFace`) register
  mood expressions from MMD and ARKit shapes.
- Diagnostics: `diagnostics/avatarDiagnostics.ts` and the Avatar Diagnostics
  dialog; empty VRM 0 preset clips currently count as present.
- Contacts and size: `poses/anatomy/arms.ts` scales head contacts by
  `avatarScale` (head-bone height over `CONTACT_REFERENCE_HEIGHT` 1.25 m); the
  chat's camera presets (`src/ui/main/canvas/sceneCameraPresets.ts`) place
  cameras at fixed offsets from the head bone.
- Review renders: `scripts/effect-render.mjs` and `scripts/effect-render/`
  (`stage.ts` takes the face view from the chat's Portrait preset) and
  `scripts/animation-render.mjs`. A render fails only on a controller warning or
  no active effect.
- Test helpers: `testing/syntheticFaceVrm.ts`, `testing/appendTriangle.ts`,
  `testing/blinkStrand.ts`, `testing/loadedTestAvatar.ts` and the snapshot
  baselines under `testing/baselines/`.

### The survey this plan answers

On 2026-10-27 the owner's private set of nine third-party VRMs ran through 31
review renders each on `9a97029a` and was checked frame by frame; #760 lists the
layouts and counts. Private files, renders and notes stay outside the repository.
Evidence in this plan and the PR is counts and pass/fail only.

## Progress

- [x] Spec and plan agreed by the owner; Q1–Q3 answered (2026-10-27).
- [x] Phase 1: review renders catch wrong art (2026-10-28; review passed after two repair rounds).
- [x] Phase 2: per-primitive shape names (2026-10-28; review passed).
- [ ] Phase 3: blink and mouth signals beyond VRM presets.
- [ ] Phase 4: eyes without separate eye geometry.
- [ ] Phase 5: the face inside a whole-body mesh.
- [ ] Phase 6: painted art that shows.
- [ ] Phase 7: size-aware placement and framing.
- [ ] Phase 8: rig and material fallbacks (deferrable, Q3).
- [ ] Phase 9: acceptance, documentation and owner gates.
- [ ] Final integration review, full pre-push suite, PR.

## Surprises & Discoveries

- 2026-10-27 (agent, survey): exit codes overstated success. On RadDollV3,
  10 of 16 effects applied without warnings but drew nothing or landed on the
  cheek; on Carol North and Polybot, head art landed inside the head and Red
  Face tinted the whole body. Only a frame-by-frame look found them; Phase 1
  automates that check.
- 2026-10-27 (agent): the review renders' face view is the chat's Portrait
  camera preset. It frames the chin or chest on chibi and robot Avatars, so the
  chat itself misframes them, not only the tooling (Phase 7).
- 2026-10-27 (agent): the joy Reaction's sparkle was reported applied but was
  not visible on four Avatars (big heads and a hood), consistent with fixed
  hover offsets from the head bone (Phase 7).

## Decision Log

- 2026-10-27, owner: open a new issue and ExecPlan for the survey's gap fixes,
  delivered as its own PR after PR #744 merges. #744 merged the same day; this
  branch starts from `main` at `b8fed9a5`.
- 2026-10-27, owner: accepted the proposed answers (Q1 no manual face marking;
  Q2 synthetic fixtures only, no CC0 Avatar in the repository; Q3 Phase 8
  included but deferrable) and the plan; push the branch and implement the
  whole plan.
- 2026-10-27, agent: Phase 3 synthesizes missing `blink`, `blinkLeft`,
  `blinkRight` and viseme expressions at load, bound to the shapes found, as
  `registerMmdFace` and `registerArkitFace` do for moods. Face detection,
  auto-blink, Gesture blinks and lip-sync then read one source instead of each
  learning every naming scheme.

## Phased implementation

Every phase runs from `src/frontend/web` unless noted. Baseline renders for the
Included Avatars are taken once on `b8fed9a5` before Phase 1 and kept in
`docs/plans/arbitrary-vrm-effects/evidence/` (ignored by Git):

```bash
pnpm -s effects:render library:<stem> --out ../../../docs/plans/arbitrary-vrm-effects/evidence/baseline/effects/<stem>.png
pnpm -s effects:render --with-clip library:reaction/<stem> --out …/baseline/reactions/<stem>.png
pnpm -s animation:render ../../../content/included/gestures/<g>/<g>.json --out …/baseline/gestures
```

for the 16 survey effects (`eye_confused_swirl heart_eyes knockout-x-eyes
blank-dot-eyes money-eyes shadowed_glare blush face_red single_tear
shiver_undereye mouth_w kiss_mark angry little-devil-horns petrified_cracks
idea_bulb`), the 6 Reactions (`joy-2 sadness-2 anger-2 embarrassment-2 fear-2
love-2`) and the 8 Gestures plus the hands view (`double-thumbs-up
count-on-fingers heart-hands-build kyaa-hands-on-cheeks cover-face-and-peek
apology-bow chefs-kiss finger-heart-pose`). Each phase that can change rendering
compares against them with `pnpm -s effects:render --diff <baseline> <new>` and
expects 0 differing pixels. Renders run through
`python3 ../../../scripts/heavy-slot.py -- …` with `timeout 600`.

### Phase 1: Review renders catch wrong art (R9)

Review tier: standard (development tooling that later phases rely on as
evidence).

Intended changes:

1. `effect-render`: render each tile once without the effect (same pose and
   time) and compare. A face-anchored effect fails when it changes fewer than a
   threshold of pixels inside the projected face region, or when most of its
   changed pixels fall outside the head region; body and scene effects compare
   within the Avatar's silhouette. The threshold and regions come from the
   Avatar's detected face skin and head bone, projected with the tile camera.
   The failure names the effect, the tile and the measured share.
2. Keep the existing failure on controller warnings and on no active effect.
3. Leave the face-view framing to Phase 7, which fixes the chat preset the view
   reuses; until then, survey runs read the front view on chibi and robot
   Avatars.

Tests: `scripts/effect-render.browser.test.mjs` gains a synthetic Avatar
(`testing/syntheticFaceVrm.ts`, `testing/appendTriangle.ts`) whose painted
anchor maps to an unseen UV region (applies, draws nothing → fails) and one
whose art lands off the face (fails), plus an Included Avatar effect that
passes.

Checks: `npx vitest run scripts/effect-render-sources.test.mjs`;
`pnpm web:test:browser` (from `src/frontend`, which runs the effect-render
browser tests); all 16 survey effects and 6 Reactions on both Included Avatars
still pass. Completion: the new failures fire on the synthetic cases, nothing
changes for passing renders, and the private RadDollV3 renders fail on the 10
effects the survey found by eye (count recorded, no images).

Starting source: `414ac263`; Included baselines rendered on tree `d9456bf9`
(source identical to `b8fed9a5`): 31 renders, 0 failed.

Implementation (2026-10-27): after each sheet, the Avatars that have not
already failed are captured again with the same pose, time and camera. Face
art (`face_surface`, `face_landmark`) is re-applied with transparent stand-in
images, the baseline `effects check` already uses, so face options such as
closed eyes appear in both captures. Body, sticker and silhouette art is left
out. Reactions replay their clip with the art swapped the same way. The head
region is the box around vertices skinned mainly to the head and eye bones,
measured before effects apply and projected per tile. "Draws nothing" means
under 0.1% of a tile (`VISIBLE_SHARE`) changes inside the region in every
tile. "Mostly outside" means under 50% of the changed pixels in the front and
3/4 views fall inside it. Particle and Scene Effects stay out of both captures:
confetti and Scene layers vary between identical captures. Files:
`scripts/effect-render.mjs`, new `scripts/effect-render/headRegion.ts`,
`scripts/effect-render/render.ts`, `scripts/effect-check.mjs` (shared
stand-in and pixel delta), `vfx/faceParts.ts` (exports `createBoneClassifier`),
tests `scripts/effect-render.test.mjs` (new) and
`scripts/effect-render.browser.test.mjs`, and docs
`docs/frontend/runtime/avatar-vfx.md` and
`.agents/skills/animama-avatar-vfx/references/how.md`.

Check record (tree `41e19f25`, working tree before review):

| Command | Directory | Result |
| --- | --- | --- |
| `timeout 900 python3 ../../scripts/heavy-slot.py -- pnpm web:test:browser` | `src/frontend` | 132/132 |
| `timeout 900 python3 ../../scripts/heavy-slot.py -- pnpm check` | `src/frontend` | exit 0 |
| `node --test scripts/effect-render.test.mjs scripts/effect-render-sources.test.mjs scripts/effects.test.mjs` | `src/frontend/web` | 53/53 |
| `npx vitest run src/lib/avatar/vfx` | `src/frontend/web` | 241/241 |
| `npx tsc -p tsconfig.scripts.json --noEmit`; eslint and prettier `--check` on touched files | `src/frontend/web` | clean |
| 16 survey effects and 6 Reactions on the Included Avatars, `--diff` against the baselines | `src/frontend/web` | 22 pass, 0 differing pixels |
| Private calibration on RadDollV3 (counts only) | `src/frontend/web` | 13 of 13 expected failures caught, 8 of 8 expected passes, `mouth_w` not caught (lands inside the head) |

Discovery: on this revision Red Face on Carol North stays on the head; the
whole-body tint the survey saw on `9a97029a` does not reproduce (PR #744's
later commits), so the Carol calibration case no longer applies.

#### Code Review #1 Findings

Reviewed tree `41e19f25` (standard tier, initial full review). The reviewer
reused the check record and rendered 34 more Included face and hover effects
and one Reaction.

- **P1-R1-F1 (required):** mouth-landmark art got the bare head rect, so
  Included `puff`, which sits beside the mouth by design, failed "mostly outside
  the head" (34.2% inside), as did the Reaction `disappointment-2` (38.0%);
  `effects:render --all-included` would exit 1. 33 of the 34 other effects
  passed.
- **P1-R1-F2 (required):** a sheet's Avatar Effects were judged together (one
  widest region, summed pixels). In a Reaction such as `love-3` (blush and an
  arrow sticker) an invisible blush passes, and whole-face tints mixed with body
  art are never judged for "outside the head". 35 Included Reactions play two
  or more Avatar Effects.
- Non-blocking: the unused `peakAt` (the message names no tile); with no head
  box the message still says "on the head"; "mostly outside" is skipped for a
  `--views face` run and tiny eye art on small front-only tiles can fall under
  the floor, undocumented; clip events that override an effect's attachment are
  judged by the base definition (no Included content does this); a small
  duplication in `effect-check.mjs`.

Result: blocked on F1 and F2.

#### Code Review #1 Revisions

- P1-R1-F1 accepted: art floating beside a face feature uses the grown hover
  region; only surface-painted art uses the bare head rect. Calibration widened
  to `--all-included`.
- P1-R1-F2 accepted: each Avatar Effect is measured against its own baseline,
  in which only that effect is stood in.
- Non-blocking: the message names the peak tile; the no-head-box wording names
  the region used; the docs note the view and tile-size limits; the
  `effect-check.mjs` duplication is removed. Deferred: attachment overrides in
  clips (no content uses them).
- Found by the wider calibration and fixed in the same round, since both failed
  correct Included content: body and sticker art is judged only when the centre
  of its art plane falls inside a tile (hand-held art hangs out of frame in the
  rest pose; `idea_bulb_fingertip` with `--with-clip library:have-an-idea`
  passes in frame), and a clip-played effect is judged only where it was active
  in a rendered frame (`puff` starts after 2 s in `bored-wait` and
  `stretch-break`). `headRegion.ts` became `scripts/effect-render/tileLayout.ts`;
  `vfx/AvatarAttachmentEffects.ts` exports `ATTACHMENT_PLANE_NAME_PREFIX`.

Repair check record (tree `2a6e1ca0`):

| Command | Directory | Result |
| --- | --- | --- |
| `node --test scripts/effect-render.test.mjs scripts/effect-render-sources.test.mjs scripts/effects.test.mjs` | `src/frontend/web` | 53/53 |
| `npx vitest run src/lib/avatar/vfx` | `src/frontend/web` | 241/241 |
| `npx tsc -p tsconfig.scripts.json --noEmit`; eslint and prettier `--check` on touched files | `src/frontend/web` | clean |
| `timeout 900 python3 ../../scripts/heavy-slot.py -- pnpm web:test:browser` | `src/frontend` | 132/132 |
| `timeout 900 python3 ../../scripts/heavy-slot.py -- pnpm check` | `src/frontend` | exit 0 |
| 16 survey effects and 6 Reactions, `--diff` against the baselines | `src/frontend/web` | 22 pass; 21 at 0 differing pixels, `idea_bulb` 1 px in one tile, 0 px on two re-renders (render flake) |
| `pnpm -s effects:render --all-included` | `src/frontend/web` | 109/109 |
| 35 Included Reactions with two or more Avatar Effects, `annoyance-2`, `disappointment-2` | `src/frontend/web` | 37/37 |
| The 6 Gestures that play `puff`, `--with-clip` | `src/frontend/web` | 6/6 |
| Private RadDollV3 (counts only) | `src/frontend/web` | 9 of 9 and 4 of 4 expected failures caught, 8 of 8 expected passes; `love-3` fails naming only the blush |

#### Code Review #2 Findings

Reviewed tree `2a6e1ca0` (targeted recheck). P1-R1-F1 and F2 resolved: every
landmark kind maps to the grown region while a disc pushed below the chin still
fails, and each effect gets its own baseline with aligned indices. The two new
exemptions show no false pass: a probe of 6 Included body and sticker effects
judged the on-screen ones (`kira_star`, `tehe_star`, `soul_wisp`,
`gloomy_cloud`, `question_mark`) and skipped only the hand-held `rose`; an
effect that fails to apply already fails through its warning. Optional:

- **P1-R2-F1:** unjudged effects print nothing, so a survey cannot tell "passed"
  from "not judged".
- **P1-R2-F2:** no test asserts that on-screen body and sticker art is judged
  (`artSeen`), which depends on a plane-name lookup across the runtime and
  script boundary.
- **P1-R2-F3:** a stale `HEAD_HOVER_MARGIN` comment and a broken docstring wrap.

Result: pass.

#### Code Review #2 Revisions

All three accepted as small fixes in repair round 2: a non-failing `Note:` line
per unjudged Avatar and effect (`artNote`, unit-tested; one docs sentence), an
`artSeen` assertion in the body, sticker and silhouette browser test, and the
comment fixes. The coordinator verified them by reading the change and the
check record below; no further reviewer round (repair budget: one round left,
unused).

Repair round 2 check record (tree `a4eb079f`):

| Command | Directory | Result |
| --- | --- | --- |
| `node --test scripts/effect-render.test.mjs scripts/effect-render-sources.test.mjs scripts/effects.test.mjs` | `src/frontend/web` | 54/54 |
| `npx tsc -p tsconfig.scripts.json --noEmit`; eslint and prettier `--check` on touched files | `src/frontend/web` | clean |
| `timeout 900 python3 ../../scripts/heavy-slot.py -- pnpm web:test:browser` | `src/frontend` | 132/132 |
| `heart_eyes` and `--with-clip library:reaction/joy-2`, `--diff` against the baselines | `src/frontend/web` | 0 differing pixels |

Phase 1 complete (agent-ready; no owner gate in this phase). Known limit carried
to later phases: art inside the head but in the wrong place (RadDollV3's w
mouth, head art on Carol North and Polybot) is not caught by this check.

### Phase 2: Per-primitive shape names (R6)

Review tier: standard (the loader runs for every Avatar).

three.js reads morph target names only from `mesh.extras.targetNames`. Some
exporters write them per primitive (`mesh.primitives[i].extras.targetNames`),
so the shapes load unnamed and MMD or ARKit content cannot find them.

Intended changes: a small `GLTFLoader` plugin registered in `Avatar.ts`
(`_createGLTFLoader`) that, when a mesh lacks `extras.targetNames` and every
primitive with targets carries the same per-primitive names, applies them to
the loaded meshes' `morphTargetDictionary`. Mismatched per-primitive lists are
left alone and reported in Diagnostics.

Tests: a synthetic glTF (`testing/glb.ts`) with names only on primitives loads
with those names; a file with mesh-level names is unchanged; mismatched lists
warn. Checks: `npx vitest run src/lib/avatar tests/avatar`; Included baselines
at 0 differing pixels for one effect and one Gesture (loader change only).

Starting source: `69bd1e3f`.

Implementation (2026-10-28): new `primitiveTargetNames.ts`. A pure
`resolveMeshTargetNames` rule: mesh-level names always win; per-primitive lists
apply only when all are strings, identical and as long as every primitive's
target list. `PrimitiveTargetNamesPlugin`, a `GLTFLoader` `afterRoot` hook, maps
loaded meshes to glTF meshes through `parser.associations` and sets
`morphTargetDictionary`. three-vrm binds expressions by index, and Animama's own
lookups read the dictionary, so no other place needs the names. The plugin is
registered once in `configureAvatarGltfLoader.ts`, which the runtime loader
(lilToon and Simple), the headless loader behind `vrm:inspect`, `vrm:optimize`
and the motion CLI, `animation-render` and the `vrm-optimize` compare page
already share; `Avatar.ts` needed no change. Mismatched lists leave names alone
and add the file issue `morph_target_names_mismatched` (from
`diagnostics/avatarFileFacts.ts`, in every locale). `vrm:inspect` and
`vrm-bake-expressions` use the same rule (the latter's report field
`primitiveOnlyMeshes` became `mismatchedNameMeshes`). Docs:
`docs/frontend/runtime/avatar-animation.md` and
`docs/frontend/runtime/vrchat-avatar-conversion.md`.

Check record (tree `75964557`):

| Command | Directory | Result |
| --- | --- | --- |
| `timeout 900 npx vitest run src/lib/avatar src/ui tests/avatar` | `src/frontend/web` | 3471 passed, 2 skipped |
| `node --test scripts/vrm-inspect.test.mjs scripts/vrm-bake-expressions.test.mjs scripts/vrm-optimize.test.mjs` | `src/frontend/web` | 18/18 |
| `npx tsc -p tsconfig.scripts.json --noEmit`; eslint and prettier `--check` on touched files | `src/frontend/web` | clean |
| `timeout 900 python3 ../../scripts/heavy-slot.py -- pnpm check` | `src/frontend` | exit 0 |
| `timeout 900 python3 ../../scripts/heavy-slot.py -- pnpm web:test:browser` | `src/frontend` | 132/132 |
| `heart_eyes` and the `double-thumbs-up` Gesture, `--diff` against the baselines | `src/frontend/web` | 0 differing pixels |
| Private Maromage (counts only) | `src/frontend/web` | 87 of 87 shapes named (all numeric before); 13 MMD standard names found; surprised now plays from MMD morphs |

#### Code Review #1 Findings

Reviewed tree `75964557` (standard tier, initial full review). The reviewer
checked the name rule against glTF's equal-target-count rule, three r182's
associations for multi-primitive, skinned and cloned meshes, plugin ordering at
all four loader call sites (no other `GLTFLoader` exists), and the Included
Avatars' GLB JSON (mesh-level names, so the plugin returns before traversing).
No blocking findings. Optional:

- **P2-R1-F1:** the mismatched-names text says mesh parts "name them
  differently", but the rule also covers one part whose list does not fit its
  shapes.
- **P2-R1-F2:** a third local copy of `asRecord`/`asArray`.
- **P2-R1-F3:** for mesh-level names the rule returns the raw array under a
  `string[]` type (unchanged behaviour).
- **P2-R1-F4:** no skinned-mesh fixture.

Result: pass.

#### Code Review #1 Revisions

- P2-R1-F1 accepted, fixed by the coordinator: the Diagnostics text in all five
  locales, the `vrm:inspect` note and the `avatarFileFacts.ts` comment now say
  the stored names disagree with each other or with the shapes. Verified:
  `npx vitest run src/ui/animas src/lib/avatar/diagnostics` 137/137 and
  `node --test scripts/vrm-inspect.test.mjs` pass (`src/frontend/web`);
  `pnpm i18n:check` exit 0 (`src/frontend`); tree `addf4a77` before this record.
- P2-R1-F2 rejected: the per-module helpers follow the existing pattern;
  consolidating three tiny functions is not worth a cross-module edit here.
- P2-R1-F3 rejected: unchanged from the previous behaviour and harmless where it
  is read.
- P2-R1-F4 deferred: three builds skinned meshes on the same association path;
  Phase 3's synthetic Avatars will load skinned fixtures through this plugin.

Phase 2 complete (agent-ready; no owner gate).

### Phase 3: Blink and mouth signals beyond VRM presets (R1, R5)

Review tier: standard. The change touches expression registration for every
Avatar; the Included Avatars must be unaffected because they have the presets.

Intended changes:

1. New `faceSignals.ts`: resolve, per Avatar, the shapes that close each eye
   and open the mouth for each vowel, in order: VRM preset with at least one
   non-empty bind; `blinkLeft` plus `blinkRight`; ARKit `eyeBlinkLeft`/`Right`
   and `jawOpen`/vowel mixes (reusing `arkitFaceCompositions`); MMD まばたき,
   ウィンク and あいうえお (reusing `mmdFaceExpressions` tables); VRChat
   `vrc.blink_left`/`right`, `vrc.blink` and `vrc.v_aa`… visemes. Matching is
   case-insensitive with the separators the existing ARKit detection accepts.
2. At load, before face detection and `applyEyelidClosureCorrection`, register
   synthesized `blink`, `blinkLeft`, `blinkRight`, `aa`, `ih`, `ou`, `ee`, `oh`
   expressions bound to the resolved shapes when the preset is missing or
   empty. Existing non-empty presets are never replaced.
3. Diagnostics records each signal's source and treats empty VRM 0 presets as
   missing; new strings in all locales.

Tests: `syntheticFaceVrm` cases for each scheme (left/right only, ARKit only,
MMD only, VRChat only, empty VRM 0 presets) assert the synthesized
expressions, `detectAvatarFaceParts` finding face skin, auto-blink driving the
shapes and lip-sync moving the mouth; an Avatar with full presets registers
nothing new.

Checks: `npx vitest run src/lib/avatar src/ui tests/avatar`; `pnpm i18n:check`
(from `src/frontend`); Included detected parts and anchors unchanged
(`testing/baselines`); Included baselines at 0 differing pixels.

Owner gate: in the app, HAOLAN (or another Avatar with only left and right
blink shapes) blinks idly and moves its mouth while speaking.

### Phase 4: Eyes without separate eye geometry (R2)

Review tier: standard.

Intended changes:

1. `faceParts.ts`: when the eyes share the face primitive, take each eye's
   region from the vertices the resolved blink shapes move, split into left and
   right clusters, as `detectEyesFromBlink` already does for blink islands.
2. `AvatarFaceLandmarks.ts`: when an eye has no iris geometry, build its
   landmark from that blink region, else from the eye bone or look-at origin
   projected onto the face surface, sized from the face width. Mark the
   landmark's source so Diagnostics can say "estimated".
3. `AvatarFaceTextureAnchors.ts`: blush, under-eye and forehead anchors and
   eye texture rects read the new landmarks; the eye texture rect comes from the
   blink region's UVs.

Tests: synthetic face primitives with eyes inside the face (blink moving an
eye-shaped vertex group), painted eyes with eye bones only, and painted eyes
with neither (warning names the eyes); eye effects, blush and under-eye anchors
resolve on the first two.

Checks: as Phase 3, plus private survey renders of ふぁふぁ (both), Maromage and
Carol North counted with Phase 1's check.

### Phase 5: The face inside a whole-body mesh (R3)

Review tier: standard.

Intended changes: when face skin would be a primitive that also skins the body
(most of its vertices weighted to bones below the neck), take the face as the
head region: triangles whose vertices are weighted mainly to the head bone and
face forward of the head, plus their UV island within the shared texture. Whole-
face art and tints clip to that region; decals project inside it. Body and hair
regions keep their colours.

Tests: a synthetic whole-body primitive (head, neck and body vertex groups on
one material) where Red Face changes only head-region pixels and decals land
inside it; single-mesh Avatars without a head-weighted front face fall back to
a warning.

Checks: as Phase 3, plus private survey renders of Olivia, Polybot and Carol
North.

### Phase 6: Painted art that shows (R4)

Review tier: standard. This phase starts with a bounded investigation.

Investigation (record findings in Surprises & Discoveries): on the private
RadDollV3 file, log the face island `selectFaceIsland` picks, the anchors' UVs
and which triangles they hit, and which texture and material slot the face
displays. Hypotheses, in order: the anchors are projected into the wrong UV
island (overlapping or mirrored islands); the painted texture is not the one the
face material displays; the paint lands under a primitive that hides it. Also
check why `petrified_cracks` on ふぁふぁ draws its tone but not its crack lines.

Intended changes: fix the cause found. Add an apply-time check: a painted
anchor whose UV falls outside the selected face island's visible triangles, or a
paint target that is not the displayed texture, skips the effect with a
Diagnostics warning instead of reporting success.

Tests: a synthetic face with mirrored or overlapping UV islands reproduces the
cause and passes after the fix; the apply-time check warns on an unseen anchor.

Checks: as Phase 3, plus private RadDollV3 and ふぁふぁ renders.

Recovery: if the cause needs a change to how art is painted for all Avatars,
stop and ask the owner before changing Included output.

### Phase 7: Size-aware placement and framing (R7)

Review tier: standard.

Intended changes:

1. Measure, once at load, head size (face skin bounds, else the head bone to
   the top of the head mesh), eye size (Phase 4 landmarks) and body height.
2. Hover planes and box placements (`AvatarVFXController.ts`) size from eye and
   head size, and box hovers sit outside the head bounds, so head art and
   Reaction sparkles clear big heads and hoods.
3. Head contacts in `poses/anatomy/arms.ts` scale by measured head size when it
   differs from the body-height estimate; Particle Effects scale by body height
   relative to the Included Avatars.
4. The chat camera presets (`sceneCameraPresets.ts`) frame Portrait and close
   presets from the measured head and face bounds instead of fixed offsets, and
   the review renders inherit that framing.

Tests: synthetic chibi proportions (head twice the adult share) keep box hovers
outside the head, hands reach the face in `kyaa-hands-on-cheeks`, and the
Portrait preset frames the face; Included Avatars unchanged.

Checks: as Phase 3; `animation:render` of the 9 Gesture renders on both
Included Avatars at 0 differing pixels; private Carol North, Polybot, Maromage
and Olivia renders.

### Phase 8: Rig and material fallbacks (R8, deferrable)

Review tier: standard.

Intended changes: contacts and motion on `upperChest` fall back to `chest`
(reusing the fallback in `humanoidAnchors.ts`), distal finger contacts to the
intermediate bone; Diagnostics lists missing optional bones. Plain glTF
`MeshStandardMaterial`s with metalness and no environment map render with
metalness 0, as lilToon fallbacks already do. Silhouette effects respect the
lilToon `_Cutoff` alpha. If the earlier phases run long, the owner may move this
phase to its own issue (Q3).

Tests: synthetic rigs without `upperChest` and distal bones keep hand-on-heart
contacts; a metallic plain material renders within the expected brightness;
a cutout lilToon material is excluded from silhouettes where transparent.

### Phase 9: Acceptance, documentation and owner gates

Review tier: light (records and documentation), covered by the final
integration review.

1. Re-run the 31-render survey on the owner's private set; count per Avatar
   with Phase 1's check and by eye; record counts against #760's targets.
2. Update `docs/frontend/runtime/avatar-vfx.md` (face signals, eyes without
   geometry, whole-body faces, size-aware placement) and
   `docs/frontend/runtime/vrchat-avatar-conversion.md` (what converted Avatars
   need), describing current behavior only.
3. Owner gates: the live blink and lip-sync check (Phase 3) and review of the
   private survey sheets.

## Final integration review

Covers combined acceptance against #760, the light Phase 9 and cross-phase
interactions (Phase 3 signals feeding Phases 4–6; Phase 7 sizes reading Phase 4
landmarks). Then the full pre-push suite once on the final candidate through
the heavy-job slots: root `make check-test`; from `src/frontend`, `pnpm verify`,
`pnpm web:test:browser` and `pnpm prettier:check`. Results go in the PR.

## Validation and acceptance

- Synthetic-fixture tests for each layout listed in #760's acceptance.
- Included Avatars: `testing/baselines` snapshots unchanged and 0 differing
  pixels for the 16 effects, 6 Reactions and 9 Gesture renders against the
  `b8fed9a5` baselines.
- Survey counts (private set, counts only) meet #760's targets.
- Owner gates recorded in the PR: live blink and lip-sync, survey sheet review.

## Idempotence and recovery

Detection and registration run at load and keep no persisted state, so a revert
restores the previous behavior on the next load. Synthesized expressions are
registered only when a preset is missing or empty, and registering twice is a
no-op. Baseline renders are regenerated from `b8fed9a5` if lost. Private survey
files never enter the repository; if any appear in `git status`, remove them
before committing.

## Outcomes & Retrospective

Not started.
