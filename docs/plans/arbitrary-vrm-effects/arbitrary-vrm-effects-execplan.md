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
- [x] Phase 3: blink and mouth signals beyond VRM presets (2026-10-28; review passed after one repair round; owner live check pending).
- [x] Phase 4: eyes without separate eye geometry (2026-10-28; review passed after one repair round).
- [x] Phase 5: the face inside a whole-body mesh (2026-10-28; review passed after two repair rounds).
- [x] Phase 6: painted art that shows (2026-10-28; review passed after two repair rounds).
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
- 2026-10-28 (agent): the baseline render of `finger-heart-pose` holds one
  pixel (channel delta 38) that a fresh render of the same source `b8fed9a5`,
  in a temporary worktree, does not reproduce; Phase 3's render matches that
  fresh render at 0 px. `idea_bulb` showed the same kind of one-pixel run-to-run
  variation in Phase 1. Comparisons now pass at 0 px against either the
  baseline or `evidence/baseline-alt/`.
- 2026-10-28 (agent): `count-on-fingers` also renders in two variants one pixel
  apart (channel delta 50) on unchanged source: a fresh render of `main`
  matched the baseline while Phase 5's commit gave the other variant, and the
  Phase 6 working tree gave each variant on different runs. The second variant
  is kept in `evidence/baseline-alt/`.
- 2026-10-28 (agent): `main` moved past the survey revision `9a97029a`. MMD
  まばたき already filled an empty `blink` (commit `4af907b2`), so HAOLAN's face
  is found before Phase 3, and Red Face on Carol North stays on her head. The
  Phase 3 owner gate on HAOLAN therefore exercises the MMD path, not the new
  VRChat or ARKit ones; the synthetic layout tests cover those.
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
- 2026-10-28, agent (Phase 3 review): signal order differs from the plan text.
  Blinks: file preset, the file's own `blinkLeft` + `blinkRight`, MMD, ARKit,
  VRChat; MMD before ARKit keeps the order `4af907b2` and the mood regions use.
  Visemes: preset, MMD, VRChat, then ARKit, because ARKit vowel mixes only
  approximate speech shapes. An Avatar with bound winks, an empty `blink` and a
  まばたき morph now blinks through its winks.
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

Starting source: `33265528`.

Implementation (2026-10-28): new `faceSignals.ts` (`registerFaceSignals`) fills
each of `blink`, `blinkLeft`, `blinkRight`, `aa`, `ih`, `ou`, `ee` and `oh` that
the file leaves missing or empty. A preset is empty when it has no binds, or
when its morph binds all have weight 0 or name a shape the mesh lacks; material
and texture binds count as playing. A playing preset is never replaced, and a
second call keeps the same expression instances, which the eyelid correction is
attached to. Order: `blink` from the file preset, the file's own
`blinkLeft` + `blinkRight`, MMD まばたき (else both winks), ARKit
`eyeBlinkLeft` + `eyeBlinkRight`, then VRChat `vrc.blink` (else
`vrc.blink_left` + `vrc.blink_right`); one-eye blinks from preset, MMD, ARKit,
then VRChat; visemes from preset, MMD あいうえお, VRChat `vrc.v_*`, then the
ARKit vowel mix when every shape in it resolves. It runs first in
`prepareLoadedVrm`, before MMD and ARKit registration, the eyelid correction and
face detection, and again in the `ExpressionController` constructor; the blink
filling that `registerMmdFace` and `registerArkitFace` did moved into it.
Diagnostics label the new sources (VRChat, left and right blinks) and list a
preset that plays nothing as missing (`neutral` exempt); `vrm:inspect` runs the
app's full preparation and face detection and prints each signal's source.
Docs: `avatar-emotion.md`, `avatar-lipsync.md`, `avatar-animation.md`,
`avatar-vfx.md` (face skin row), `vrchat-avatar-conversion.md` and
`features/anima-management.md`.

Check record (tree `2dc49474`; `pnpm check`, the browser suite and the render
set ran on `2cdde871`, which differs only by a renamed local in
`arkitFaceExpressions.ts`; the affected tests, the full Vitest run, `tsc` and
eslint reran after it):

| Command | Directory | Result |
| --- | --- | --- |
| `timeout 900 npx vitest run src/lib/avatar src/ui tests/avatar` | `src/frontend/web` | 3493 passed, 2 skipped; `testing/baselines` unchanged |
| `npx tsc -b`; `npx tsc -p tsconfig.scripts.json --noEmit`; eslint and prettier `--check` on touched files | `src/frontend/web` | clean |
| `node --test scripts/vrm-inspect.test.mjs scripts/vrm-bake-expressions.test.mjs` | `src/frontend/web` | 11/11 |
| `timeout 900 python3 ../../scripts/heavy-slot.py -- pnpm check` | `src/frontend` | exit 0 |
| `timeout 900 python3 ../../scripts/heavy-slot.py -- pnpm web:test:browser` | `src/frontend` | 132/132 |
| `evidence/render-set.sh` on the Included Avatars, `--diff` against the baselines | `src/frontend/web` | 31 rendered, 0 failed; 30 at 0 px; `finger-heart-pose` 1 px against the baseline and 0 px against a fresh render of `b8fed9a5` (see below) |
| Private HAOLAN (counts only) | `src/frontend/web` | face skin, eyes and hair found; 11 of 16 survey effects pass, the other 5 fail "draws nothing" (Phase 6) |

#### Code Review #1 Findings

Reviewed tree `2dc49474` (standard tier, initial full review). The reviewer
parsed the Included Avatars' expressions (every preset has one weight-1 bind,
so Diagnostics, `_playsSomething`, the ARKit own-preset test and the new
registration behave as before on them) and reran
`src/lib/runtime-content/runtimeAvatarFaceParts.test.ts` (3/3).

- **P3-R1-F1 (required):** `avatar-emotion.md` and `avatar-lipsync.md` say only
  ARKit lip-sync shaping stacks on the mood's `jawOpen`; ARKit-filled visemes now
  do too.
- **P3-R1-F2:** the order deviation from the plan is not in the Decision Log, and
  the file's own `blinkLeft` + `blinkRight` now come before まばたき, a change from
  `4af907b2` for Avatars with bound winks and an empty `blink`.
- **P3-R1-F3:** `left_right` adds both sides' binds as they are; one shared
  blink morph would be driven twice, and material binds add up.
- **P3-R1-F4:** the eyelid correction's comments omit the face-signal
  expressions it now measures.
- **P3-R1-F5:** no `jawOpen`-only `aa` for Avatars with partial ARKit shapes.
- **P3-R1-F6:** `vrm:inspect` swallows the face-detection error.
- **P3-R1-F7:** `collectMorphBinds` still counts weight-0 binds (pre-existing).
- **P3-R1-F8:** no tests for material binds counting as playing or for a
  weight-0 preset reported unresolved.

Result: blocked on F1 (a documentation fix needing no recheck); F2–F8 optional.

#### Code Review #1 Revisions

- F1 accepted: one clause in each document.
- F2 accepted: recorded in the Decision Log below.
- F3 accepted: combine only morph binds, deduplicated with the larger weight.
- F4 accepted: comments updated, no behaviour change (mouth shapes have about
  no lid share).
- F5 rejected: only complete ARKit mixes fill visemes; Avatars with partial
  ARKit sets normally carry VRChat visemes, which come first.
- F6 accepted: `vrm:inspect` prints the detection error.
- F7 rejected: pre-existing and harmless; the signal still marks the face.
- F8 accepted: both tests added.

Repair round 1 (tree `51cb2241`): the two documentation clauses;
`combinedMorphBinds` joins only morph binds, once per primitive and shape at the
larger weight, falling through when none remain (test: both sides bound to one
shared blink morph, which failed at weight 2 before the fix); eyelid-correction
comments; `vrm:inspect` prints "face parts: detection failed (…)"; tests for
material and texture binds counting as playing and for a weight-0 `happy` preset
reported unresolved. HAOLAN's `blink` still comes from MMD (its file has no
one-eye presets), so the Surprises note stands. The coordinator verified the
repair from the diff and the check record; no reviewer recheck was needed for
the documentation blocker (repair budget: one round used).

| Command | Directory | Result |
| --- | --- | --- |
| `timeout 900 npx vitest run src/lib/avatar src/ui tests/avatar src/lib/runtime-content/runtimeAvatarFaceParts.test.ts` | `src/frontend/web` | 3500 passed, 2 skipped; baselines unchanged |
| `node --test scripts/vrm-inspect.test.mjs scripts/vrm-bake-expressions.test.mjs` | `src/frontend/web` | 12/12 |
| `npx tsc -b`; `npx tsc -p tsconfig.scripts.json --noEmit`; eslint and prettier `--check` on touched files | `src/frontend/web` | clean |

Phase 3 complete (agent-ready). Owner gate pending: an Avatar without a
playing `blink` preset blinks idly and moves its mouth in the app; a VRChat-only
or ARKit-only Avatar exercises the new paths best.

### Phase 4: Eyes without separate eye geometry (R2)

Review tier: standard.

Intended changes:

1. `faceParts.ts`: when the eyes share the face primitive, take each eye's
   region from the vertices the resolved blink shapes move, split into left and
   right clusters, as `detectEyesFromBlink` already does for blink islands.
2. `AvatarFaceLandmarks.ts`: when an eye has no iris geometry, build its
   landmark from that blink region, else from the eye bone projected onto the
   face surface, sized from the face width. Mark the
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

Starting source: `8357ad3a`.

Implementation (2026-10-28): when detection, names and corrections still leave
an eye missing and the face skin is known, `detectAvatarFaceParts` marks it
`estimated`, with `estimate` naming the signal: `blink` (where `blink` moves the
face skin on that side) or `eye_bone` (a `look_at` estimate was removed in
review, P4-R1-F1). An eye a correction marks absent stays absent. `AvatarFaceLandmarks` builds the
landmark from the same signal; the snapshot field appears only on estimated
eyes, so Included snapshots are unchanged. The blink region keeps vertices that
move at least half as far as the farthest one on that side, then the largest
connected piece and any piece overlapping it, which drops a brow that blinking
also lowers. Its centre is the movement-weighted midpoint between open and
closed positions, it is sized like an iris (55% of the region's width, 67% of
its height, measured on the Included Avatars), and its `textureRect` comes from
the region's UVs. Bone and look-at estimates project along the face's front axis
onto the face, at 14% of the face width, without a texture rect. Anchors needed no change. In the controller,
estimated eyes count for eye planes, which the face-skin binding holds; iris-
surface art still needs an iris mesh. Diagnostics, the creator's face-parts
panel, the text report and `vrm:inspect` say what placed each estimated eye (all
locales). New `vfx/estimatedEyes.test.ts` and `testing/removeEyeBones.ts`; docs
in `avatar-vfx.md` ("Eyes without geometry") and `features/anima-management.md`.

Check record (tree `53e11f60`):

| Command | Directory | Result |
| --- | --- | --- |
| `timeout 900 npx vitest run src/lib/avatar src/ui tests/avatar src/lib/runtime-content` | `src/frontend/web` | 3678 passed, 2 skipped; baselines unchanged |
| `node --test scripts/vrm-inspect.test.mjs scripts/vrm-bake-expressions.test.mjs` | `src/frontend/web` | 13/13 |
| `npx tsc -b`; `npx tsc -p tsconfig.scripts.json --noEmit`; eslint and prettier `--check` on touched files | `src/frontend/web` | clean |
| `timeout 900 python3 ../../scripts/heavy-slot.py -- pnpm check` | `src/frontend` | exit 0 |
| `timeout 900 python3 ../../scripts/heavy-slot.py -- pnpm web:test:browser` | `src/frontend` | 132/132 |
| `evidence/render-set.sh`, `--diff` against the baselines | `src/frontend/web` | 31 rendered, 0 failed; 29 at 0 px, `finger-heart-pose` 0 px against the alternate, `anger-2` 5 isolated px then 0 px on one re-render |

Private calibration (counts only; Phase 1's check plus a look at the sheets),
effects of 16 and Reactions of 6, before and after:

| Avatar | Effects | Reactions | Remaining |
| --- | --- | --- | --- |
| ふぁふぁ (own VRM) | 3 → 16 | 1 → 6 | none |
| ふぁふぁ (converted) | 3 → 16 | 1 → 6 | none |
| Maromage | 3 → 12 | 0 → 5 | blush, under-eye and kiss land under its large eye dots; horns and the joy sparkle hidden (Phases 6–7) |
| Carol North | 3 → 13 | 0 → 5 | X and dot eyes under the visibility floor at the fixed 6 cm eye plane; horns and the joy sparkle hidden (Phase 7) |

#### Code Review #1 Findings

Reviewed tree `53e11f60` (standard tier, initial full review); no checks rerun.

- **P4-R1-F1 (required):** the `look_at` estimate is ungated in practice:
  three-vrm fills a default `offsetFromHeadBone` of (0, 0.06, 0) when a file
  omits it, and the repository's VRMs store exactly that default, so a
  painted-eye Avatar without blink or eye bones that used to skip now gets eyes
  6 cm above the head bone with no warning, and Phase 1's head box cannot see
  the misplacement.
- **P4-R1-F2:** bone estimates have no sanity check (coincident or swapped eye
  bones).
- **P4-R1-F3:** projection onto the face accepts back-of-head triangles that
  cover an eye hole.
- **P4-R1-F4:** an estimated eye's face-texture `textureRect` reaches the iris
  layout on mixed Avatars.
- **P4-R1-F5:** detection and landmarks can use different face entries, and a
  blink estimate without a landmark does not fall back to the bone.
- **P4-R1-F6:** blink deltas ignore bind weights, including weight-0 binds.
- **P4-R1-F7:** welding and region measurement run twice on fallback Avatars.
- **P4-R1-F8:** no VRM 0 or one-sided blink tests.
- **P4-R1-F9:** the docs' face-parts statuses omit "Position estimated".
- **P4-R1-F10:** JSDoc, a stale skip message for iris art on estimated eyes, and
  small nits.

Result: blocked on F1.

#### Code Review #1 Revisions

- F1 accepted: the `look_at` estimate is removed (detection, landmarks,
  Diagnostics, locales, docs, tests).
- F2–F10 accepted, as fixed in repair round 1 below (F7 if contained).

Repair round 1 (tree `38b963c4`): the `look_at` estimate is gone everywhere;
the docs explain why three-vrm's default look-at offset cannot place eyes.
Detection now measures each estimated eye once, stores it on the part map as
`eyeEstimates` (runtime only), picks the face entry the landmarks use, and falls
back to the bone when a side has no blink region; blink pieces weld only core
vertices (F5, F7). A bone counts only at least 10% of the face width out on its
own side, inside the face in front view and above its lowest quarter (F2).
Projection uses front-facing triangles in the front half of the face (F3). The
iris layout ignores estimated eyes' rects (F4). Blink deltas skip weight-0 binds
and scale by weight (F6). New tests: VRM 0 blink and bone estimates, one eye
from blink and the other from its bone, head-centre bones (red without F2), a
back-facing triangle behind an eye hole (red without F3), the iris layout and
the iris-mesh message (F8, F10). Docs list "Position estimated" (F9).

| Command | Directory | Result |
| --- | --- | --- |
| `timeout 900 npx vitest run src/lib/avatar src/ui tests/avatar src/lib/runtime-content` | `src/frontend/web` | 3684 passed, 2 skipped; baselines unchanged |
| `node --test scripts/vrm-inspect.test.mjs scripts/vrm-bake-expressions.test.mjs` | `src/frontend/web` | 13/13 |
| `npx tsc -b`; `npx tsc -p tsconfig.scripts.json --noEmit`; eslint and prettier `--check` on touched files | `src/frontend/web` | clean |
| `timeout 900 python3 ../../scripts/heavy-slot.py -- pnpm check` | `src/frontend` | exit 0 |
| `heart_eyes` and `--with-clip library:reaction/fear-2`, `--diff` against the baselines | `src/frontend/web` | 0 px |
| Private calibration (counts only) | `src/frontend/web` | unchanged: ふぁふぁ 16/6, Maromage 12/5, Carol North 13/5 |

#### Code Review #2 Findings

Reviewed tree `38b963c4` (targeted recheck). All accepted fixes verified,
including VRoid's own eye bones failing safe to a named skip under F2 and
unchanged lid-box math under F6. Optional:

- **P4-R2-F1:** the Diagnostics dialog still renders iris art skipped on an
  estimated eye through `effect_face_part_missing` ("no detected left eye"),
  while its Face table says the eye was estimated; only the English controller
  warning changed.

Result: pass.

#### Code Review #2 Revisions

- P4-R2-F1 deferred to Phase 6, which reworks the skip and warning paths for
  painted art: give iris art on an estimated eye its own issue code and text.

Phase 4 complete (agent-ready; no owner gate).

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

Starting source: `4990aa83`.

Implementation (2026-10-28): when no head-skinned or partly-head face skin is
found, the candidates are primitives that both `blink` and `aa` morph with under
half their skin weight on the head. The head region is the triangles whose three
corners are mainly head-skinned (`createBoneClassifier`), that wind forward and
whose centre lies in the front half of the head's depth; `blink` or `aa` must
move one of its vertices, and the candidate covering the most eye-window area
wins. The region then narrows to the face's own UV island plus the islands inside
its outline (painted eyes and mouth), because a hood rim in front of a face
otherwise became its front. It is stored as `parts.face_skin.regions`, and
landmark bounds, eye-bone estimates, texture anchors and the face clip read it
(`findFaceSkinRegion`). Whole-face art is painted into the texture, so the clip
keeps it to that island; on whole-body faces decals and the eye and mouth
cleanup are clipped too. A whole-body candidate without such a region reports
`face_parts_whole_body_head_missing` (all locales), and a correction naming it as
face skin keeps to its head region. The anchors' island rule moved to new
`vfx/faceIsland.ts`. New `testing/wholeBodyVrm.ts` and `vfx/wholeBodyFace.test.ts`;
docs in `avatar-vfx.md` ("Faces inside a whole-body mesh") and
`features/anima-management.md`. Detection takes about 5 ms on the largest
survey mesh, at load only.

Check record (tree `2fa30ac1`):

| Command | Directory | Result |
| --- | --- | --- |
| `timeout 900 npx vitest run src/lib/avatar src/ui tests/avatar src/lib/runtime-content` | `src/frontend/web` | 3693 passed, 2 skipped; baselines unchanged |
| `npx tsc -b`; `npx tsc -p tsconfig.scripts.json --noEmit`; eslint and prettier `--check` on touched files | `src/frontend/web` | clean |
| `timeout 900 python3 ../../scripts/heavy-slot.py -- pnpm check` | `src/frontend` | exit 0 |
| `timeout 900 python3 ../../scripts/heavy-slot.py -- pnpm web:test:browser` | `src/frontend` | 132/132 |
| `evidence/render-set.sh`, `--diff` against the baselines | `src/frontend/web` | 31 rendered, 0 failed; all at 0 px (`finger-heart-pose` against the alternate) |

Private calibration (counts only; effects of 16, Reactions of 6):

| Avatar | Before | After | Remaining |
| --- | --- | --- | --- |
| Olivia | 1, 1 | 14, 5 | tear and under-eye too small (sized from thin painted eyes) |
| Polybot | 1, 0 | 10, 3 | blush, kiss, tear and under-eye draw nothing even unclipped (Phase 6); X and dot eyes small (Phase 7) |
| Carol North, Maromage, ふぁふぁ | unchanged | unchanged | renders 0 px against before |

By eye: Red Face and stone stay on Olivia's and Polybot's faces with hood, shell,
clothes and body untouched. Carol North, just over half head-weighted, keeps the
older partly-head path, so whole-face art also tints her hair and ears.

#### Code Review #1 Findings

Reviewed tree `2fa30ac1` (standard tier, initial full review); the reviewer
reran `node --test scripts/vrm-inspect.test.mjs` (6/6) after the island-rule
move and confirmed by reading that the refactors leave other faces unchanged.

- **P5-R1-F1 (required):** `hideParts: ["face_skin"]` on a whole-body face hides
  the whole body primitive, because the binding now carries the face-skin role
  and auto-disable hides whole bindings.
- **P5-R1-F2:** the under-50%-head trigger leaves single-mesh Avatars with a
  detailed head (Carol North at 52%) on the partly-head path, which tints hair,
  ears and any head-skinned hat; a "holds body weight below the neck" trigger
  matches R3 better.
- **P5-R1-F3:** a small head-skinned primitive of the same mesh can take the
  face from a whole-body mesh (pre-existing).
- **P5-R1-F4:** the whole-body clip fails open (whole-body tint) when the UVs
  are interleaved.
- **P5-R1-F5:** the name fallback can assign a whole-body primitive as face skin
  without a region.
- **P5-R1-F6:** no eye-bone, VRM 0, Carol-boundary or hide tests.
- **P5-R1-F7:** `vrm:inspect` does not mark a head-region face skin.
- Carry-over: Polybot's blush, kiss, tear and under-eye now apply and draw
  nothing, a false success until Phase 6's apply-time check.

Result: blocked on F1.

#### Code Review #1 Revisions

- F1 accepted: hide only the region's triangles through the region hider.
- F2 accepted as an implementation choice within R3: route face primitives
  that hold substantial weight below the neck to the head-region path, with a
  boundary test and a fresh private calibration; if no threshold separates the
  survey Avatars cleanly, report instead of forcing it.
- F3 deferred: documented as a limitation; no survey Avatar has it.
- F4, F5, F6, F7 accepted.
- Carry-over recorded under Phase 6.

Repair round 1 (tree `7bf48113`): a binding whose face skin is a head region no
longer counts the face-skin role as a whole binding, and hiding face skin hides
only the region's triangles (F1, test fails before the fix). Whole-face art on
a head-region face is not placed, with a warning, when its clip cannot be built
(F4). Face skin found by name or correction keeps to the head region when one
can be measured; otherwise a corrected primitive stays whole and a name match is
dropped (F5). Tests run on a synthetic VRM 0 as well, and cover the eye-bone
branch (F6). `vrm:inspect` marks head-region face skin (F7). Docs updated,
including the F3 limitation.

F2 was tried and held back. A below-neck skin share of 0.35 separates the survey
Avatars (Carol North 0.46; Maromage 0.26; ふぁふぁ, HAOLAN and the Included
Avatars about 0; Olivia 0.77, Polybot 0.69) and stops Carol's hair and ear tint,
but it cost her three eye effects: estimated-eye planes sit 35% of the way
toward the face front, and the narrowed face front puts them behind the surface
over her eyes. Decision (agent, 2026-10-28): reverted, and moved to Phase 7
together with placing estimated-eye planes in front of the measured surface;
Carol's hair and ear tint stays a documented limitation until then.

| Command | Directory | Result |
| --- | --- | --- |
| `timeout 900 npx vitest run src/lib/avatar src/ui tests/avatar src/lib/runtime-content` | `src/frontend/web` | 3701 passed, 2 skipped; baselines unchanged |
| `npx tsc -b`; `npx tsc -p tsconfig.scripts.json --noEmit`; eslint and prettier `--check` on touched files | `src/frontend/web` | clean |
| `node --test scripts/vrm-inspect.test.mjs` | `src/frontend/web` | 7/7 |
| `timeout 900 python3 ../../scripts/heavy-slot.py -- pnpm check` | `src/frontend` | exit 0 |
| `timeout 900 python3 ../../scripts/heavy-slot.py -- pnpm web:test:browser` | `src/frontend` | 132/132 |
| `face_red`, `petrified_cracks`, `heart_eyes`, `eye_confused_swirl`, `--diff` against the baselines | `src/frontend/web` | 0 px (the changes act only on head-region faces, which Included Avatars lack) |
| Private calibration (counts only) | `src/frontend/web` | unchanged: Olivia 14/5, Polybot 10/3, Carol North 13/5, Maromage 12/5, ふぁふぁ 16/6, HAOLAN 11/4 |

#### Code Review #2 Findings

Reviewed tree `7bf48113` (targeted recheck). A scratch Vitest experiment on the
`wholeBodyFace.test.ts` harness confirmed the implementer's open note:

- **P5-R2-F1 (required):** the face clip is cached per binding and first built
  while a `hideParts: ["face_skin"]` effect has collapsed the region, so an
  empty clip is cached; afterwards Red Face applies with no warning and draws
  nothing (control without the hide: 200 triangles).
- **P5-R2-F2 (required):** region hiding ignores the source binding, so Red Face
  with "Hide face skin" hides its own region, and eye art bound to the
  whole-body face hides the whole face.
- **P5-R2-F3:** the head-missing warning can be wrong when a head region exists
  that blink and aa do not move, since the name rule then keeps it.
- **P5-R2-F4:** the deferred limitation should name ears and head-skinned hats
  or hoods, not only hair; the deferral needs owner acceptance.

Result: blocked on F1 and F2. Repair round 2 is the last.

#### Code Review #2 Revisions

- F1, F2 accepted: build the clip from the original triangles and treat an
  empty clip as unreadable; keep the source binding's own face region visible;
  tests for both sequences.
- F3 accepted: drop the name match in that case too.
- F4 accepted: docs name ears and head-skinned hats or hoods. The F2 deferral is
  listed for owner acceptance in Phase 9.

Repair round 2 (tree `78ce77b8`): the face clip is measured with hidden regions
shown again (`withRegionsShown` in `vfx/primitiveRegionHiding.ts`), and a clip
with no triangles left is unreadable, so a head-region face skips whole-face art
with a warning (F1). Region hiding skips the face region the effect's own art is
on (F2). A whole-body primitive matched by name needs a head region that blink or
the mouth moves, shared with detection as `faceExpressionsMove` (F3). Docs per
F4. Each guard fails its test when removed.

| Command | Directory | Result |
| --- | --- | --- |
| `timeout 900 npx vitest run src/lib/avatar src/ui tests/avatar src/lib/runtime-content` | `src/frontend/web` | 3707 passed, 2 skipped; baselines unchanged |
| `npx tsc -b`; `npx tsc -p tsconfig.scripts.json --noEmit`; eslint and prettier `--check` on touched files | `src/frontend/web` | clean |
| `node --test scripts/vrm-inspect.test.mjs` | `src/frontend/web` | 7/7 |
| `timeout 900 python3 ../../scripts/heavy-slot.py -- pnpm check` | `src/frontend` | exit 0 |
| `timeout 900 python3 ../../scripts/heavy-slot.py -- pnpm web:test:browser` | `src/frontend` | 132/132 |
| `face_red`, `petrified_cracks`, `heart_eyes`, `eye_confused_swirl`, `--diff` against the baselines | `src/frontend/web` | 0 px |
| Private Olivia and Polybot (counts only) | `src/frontend/web` | 14/5 and 10/3, renders 0 px against round 1 |

#### Code Review #3 Findings

Reviewed tree `78ce77b8` (final targeted recheck). F1–F4 resolved; the
reviewer's scratch reproduction now builds a 200-triangle clip while the face is
hidden and Red Face afterwards covers the face with no warnings; Red Face with
"Hide face skin" hides none of its own face. Optional P5-R3-F1: a non-whole-body
face whose clip triangles all vanish (fully degenerate UVs) now gets whole-face
art unclipped instead of none; not a practical case. Result: pass.

#### Code Review #3 Revisions

P5-R3-F1: no change (degenerate-UV faces only; Included Avatars have real clip
triangles). Repair budget used up.

Phase 5 complete (agent-ready; no owner gate in this phase; the Carol North
limitation goes to Phase 7, then owner acceptance in Phase 9 if it remains).

### Phase 6: Painted art that shows (R4)

Review tier: standard. This phase starts with a bounded investigation.

Investigation (record findings in Surprises & Discoveries): on the private
RadDollV3 file, log the face island `selectFaceIsland` picks, the anchors' UVs
and which triangles they hit, and which texture and material slot the face
displays. Hypotheses, in order: the anchors are projected into the wrong UV
island (overlapping or mirrored islands); the painted texture is not the one the
face material displays; the paint lands under a primitive that hides it. Also
check why `petrified_cracks` on ふぁふぁ draws its tone but not its crack lines.

Carried from Phase 5: Polybot's blush, kiss, tear and under-eye now apply and
draw nothing; the apply-time check must turn them into named skips or fix them.

Carried from Phase 4 (P4-R2-F1): iris art skipped on an estimated eye gets its
own Diagnostics issue code and text instead of "no detected left eye".

Intended changes: fix the cause found. Add an apply-time check: a painted
anchor whose UV falls outside the selected face island's visible triangles, or a
paint target that is not the displayed texture, skips the effect with a
Diagnostics warning instead of reporting success.

Tests: a synthetic face with mirrored or overlapping UV islands reproduces the
cause and passes after the fix; the apply-time check warns on an unseen anchor.

Checks: as Phase 3, plus private RadDollV3 and ふぁふぁ renders.

Recovery: if the cause needs a change to how art is painted for all Avatars,
stop and ask the owner before changing Included output.

Starting source: `ec311656`.

Investigation (2026-10-28): neither overlapping or mirrored UV islands nor a
wrong texture slot caused the failures (RadDollV3's face is VRM 0 MToon with the
same image in its main and shade slots, identity transforms and one UV set).
Two causes:

- **Eyes from the wrong part.** `detectEyesFromBlink` accepted any head-skinned
  part whose bounding box overlapped a lid box, and blink lid boxes can span the
  whole head. RadDollV3's real eye mesh, skinned 56% to the head and 44% to the
  eye bones, qualified for neither path, so a tiny transparent part 3–4 cm inside
  the head became both eyes; the face island then fell back to every face
  triangle, anchors projected onto the inner eye socket 9 mm behind the face, and
  the mouth reference smeared across the cheek. HAOLAN's ear mesh became its eyes.
- **Anchors under modelled eye shapes.** Under-eye and cheek anchors seeded from
  an iris-sized estimate landed under eye geometry modelled 0.3–6.6 mm in front
  of the skin (Polybot's eye capsules, Maromage's eye dots).

Also found: whole-face art is laid out over the whole texture image (VRoid's
dedicated face texture) and clipped to the face island, so on ふぁふぁ, whose face
island covers about 12% of the image, the crack strokes fall outside the face.
Mapping VRoid-layout art onto other face layouts is an owner question (Phase 9).

Implementation: an eye part must now have vertices inside a lid's outline and
no deeper than 15% of the lids' width behind the lid front, and eye-bone weight
counts as head weight. New `vfx/faceCover.ts` lists the triangles that can hide
skin art (the face primitive outside its island, and eye mesh parts; not hair);
covered under-eye and cheek anchors slide down until uncovered, within half the
eye spacing, and the mouth counts as covered only when both sides of it are.
Apply-time skips: decals on a still-covered anchor (`effect_anchor_covered`),
painted face art when the face material has no UV-0 `map` an overlay can paint
(`effect_face_texture_hidden`), and iris art on an estimated eye
(`effect_iris_mesh_missing`, carried P4-R2-F1); all localized. New
`vfx/paintedFaceArt.test.ts` (VRM 1 and 0) and detection tests, red before the
fix; docs in `avatar-vfx.md`.

Check record (tree `67d325bd`):

| Command | Directory | Result |
| --- | --- | --- |
| `timeout 900 npx vitest run src/lib/avatar src/ui tests/avatar src/lib/runtime-content` | `src/frontend/web` | 3717 passed, 2 skipped; baselines unchanged |
| `npx tsc -b`; `npx tsc -p tsconfig.scripts.json --noEmit`; eslint and prettier `--check` on touched files | `src/frontend/web` | clean |
| `python3 ../../scripts/heavy-slot.py -- pnpm check` | `src/frontend` | exit 0 |
| `python3 ../../scripts/heavy-slot.py -- pnpm web:test:browser` | `src/frontend` | 132/132 |
| `evidence/render-set.sh`, `--diff` against the baselines | `src/frontend/web` | 31/31 at 0 px after re-rendering `joy-2` (slot timeout) and `cover-face-and-peek` (1 px once) |

Private calibration (counts only; effects of 16, Reactions of 6):

| Avatar | Effects | Reactions | Remaining |
| --- | --- | --- | --- |
| RadDollV3 | 7 → 16 | 2 → 6 | none; by eye, every piece of art in place |
| HAOLAN | 11 → 15 | 4 → 6 | dot eyes too small |
| Polybot | 10 → 12 | 3 → 4 | X and dot eyes, tear and under-eye too small or invisible on its dark screen; joy sparkle |
| Maromage | 12 → 15 | 5 → 5 | horns and joy sparkle hidden |
| ふぁふぁ, Alicia, Olivia, Carol North | unchanged | unchanged | ふぁふぁ crack lines (owner question); Olivia small tear and under-eye; Carol per Phase 7 |

#### Code Review #1 Findings

Reviewed tree `67d325bd` (standard tier, initial full review); no checks
rerun. The reviewer measured the anchor-lowering loop in isolation: 13 ms,
87 ms and 441 ms for 200 projections over 2k, 10k and 30k island triangles.

- **P6-R1-F1 (required):** Polybot's under-eye and tear art still applies and
  draws nothing with no warning; the Included `shiver_undereye` uses a multiply
  blend, which cannot show on a near-black surface.
- **P6-R1-N1:** the eye-part rule needs a vertex inside the lid box, which
  rejects a low-poly eye card larger than the lid opening.
- **P6-R1-N2:** alpha-cutout eyeline and eyelash parts count as cover, pushing
  art that used to show between the strands lower.
- **P6-R1-N3:** the lowering loop costs steps × island triangles, unmeasured
  against the load-time constraint.
- **P6-R1-N4–N6:** docs on the clearance bound and merged hair; the covered
  warning's standalone wording; a temporary field used as a hidden argument.

Result: blocked on F1.

#### Code Review #1 Revisions

- F1 accepted: an apply-time check skips darkening-blend art over a surface too
  dark to change visibly, with a named localized issue. Art that is merely too
  small to clear the visibility floor (Polybot's X and dot eyes and tear,
  HAOLAN's dot eyes, Olivia's tear and under-eye) goes to Phase 7's sizing and
  is listed in the docs' limitations meanwhile.
- N1–N6 accepted, including per-Avatar counts of lowered and covered anchors
  and load-time numbers for the lowering search.

Repair round 1 (tree `803a8376`): multiply decals get an estimated visible
change from the face's original `map` under each placement and skip with
`effect_surface_too_dark` below 8/255 (F1; all locales). An eye part now needs a
triangle whose outline meets a lid within the depth limit, so a four-vertex eye
card larger than the lid opening is found (N1, VRM 1 and 0 tests). Separate
eyeline and lash parts no longer count as cover; eyeline and lash regions inside
the face primitive count unless the face material is see-through, because on
Polybot, Maromage and Olivia the covering eye shapes are such regions (N2). The
lowering search projects onto the island triangles near the anchor's path (N3).
Docs, standalone warnings and an explicit coverage argument (N4–N6).

| Command | Directory | Result |
| --- | --- | --- |
| `timeout 900 npx vitest run src/lib/avatar src/ui tests/avatar src/lib/runtime-content` | `src/frontend/web` | 3722 passed, 2 skipped; baselines unchanged |
| `npx tsc -b`; `npx tsc -p tsconfig.scripts.json --noEmit`; eslint and prettier `--check` on touched files | `src/frontend/web` | clean |
| `python3 ../../scripts/heavy-slot.py -- pnpm check` | `src/frontend` | exit 0 |
| `python3 ../../scripts/heavy-slot.py -- pnpm web:test:browser` | `src/frontend` | 132/132 |
| `evidence/render-set.sh` | `src/frontend/web` | 31 at 0 px against the baseline or the alternate (`count-on-fingers` variant attributed to render variation; see Surprises) |

Anchors lowered after the round (none left covered on any survey Avatar):
under-eye on Olivia and HAOLAN; under-eye and blush on Polybot and Maromage;
none on Alicia, Carol North, RadDollV3 or ふぁふぁ. Anchor build on the largest
survey face (HAOLAN, island 2,044 of 11,422 triangles) 36.9 ms before the N3
change and 38.4 ms after; a synthetic worst case fell from 34.3 ms to 21.9 ms.
Private calibration unchanged except Polybot's under-eye art, now a named skip.

#### Code Review #2 Findings

Reviewed tree `803a8376` (targeted recheck).

- **P6-R2-F1 (required):** the multiply check multiplies luminances against a
  per-channel threshold, so it skips visible art on dark skin: the icy-blue
  under-eye art on dark-brown skin changes the red channel by about 15/255 but
  is estimated at 6/255 and skipped.
- **P6-R2-N1:** no tests for the see-through rule or the lash-part exclusion;
  lilToon cut-out may not set `alphaTest`; confirm what moved HAOLAN's and
  Olivia's under-eye anchors.
- **P6-R2-N2:** the lowering comment's "exactly" overstates one fallback case.
- **P6-R2-N3:** the plan lacks a pre-Phase 6 anchor-build time for the largest
  face (recorded in repair round 2).

Result: blocked on F1; one repair round left.

#### Code Review #2 Revisions

- F1 accepted: estimate per channel and compare the largest change; tests with
  coloured art on a dark coloured face; docs wording.
- N1, N2, N3 accepted.

Repair round 2 (tree `aabe700e`): the multiply check now estimates
`opacity × max over channels of S̄ × (1 − Ā·T)` from alpha-weighted mean colours
of the face under the placement and of the tinted art, and skips below 8/255
(F1). With the under-eye art: Polybot's grey screen 7.1–7.6/255 (skipped),
Carol North's skin 25.4/255, Included skins 33.8–35.2/255 (drawn); tests with
coloured art cover dark-brown skin (drawn, red under the luminance estimate),
near-black (skipped) and a normal blend (drawn). three-liltoon materials in any
non-opaque render mode count as see-through for the cover rule, with tests for
opaque, alpha-test, lilToon cut-out and blended faces and for eyeline parts
staying out of the cover (N1). Probes: HAOLAN's under-eye anchor moves out from
under the eye islands inside its face mesh; Olivia's, Polybot's and Maromage's
from under opaque eyeline or lash regions. The lowering search tests points
outside its path against the whole cover (N2).

| Command | Directory | Result |
| --- | --- | --- |
| `timeout 590 npx vitest run src/lib/avatar src/ui tests/avatar src/lib/runtime-content` | `src/frontend/web` | 3728 passed, 2 skipped |
| `npx tsc -b`; `npx tsc -p tsconfig.scripts.json --noEmit`; eslint and prettier `--check` on touched files | `src/frontend/web` | clean |
| `python3 ../../scripts/heavy-slot.py -- pnpm check` | `src/frontend` | exit 0 |
| The browser suite's own steps in two halves through heavy-slot (`pnpm web:test:browser` exceeds the foreground limit) | `src/frontend/web` | 32/32 and 100/100 |
| `shiver_undereye`, `blush`, `single_tear`, `kiss_mark`, `--with-clip library:reaction/fear-2`, `--diff` against the baselines | `src/frontend/web` | 0 px, no warnings |
| Private calibration (counts only) | `src/frontend/web` | unchanged from round 1 |

Load cost (N3): HAOLAN, the largest survey face, builds anchors in 20.9–22.8 ms
on `ec311656` and 27.9–30.5 ms after Phase 6, and rebuilds its face in
46.9–49.2 ms and 61.7–64.4 ms (shared, noisy machine; on `ec311656` its ears
were taken as eyes). The reviewer measured the Included Avatars' anchor build at
19.7–28.1 ms, of which the new cover build is 1.5–2.3 ms, once per load.

#### Code Review #3 Findings

Reviewed tree `aabe700e` (final targeted recheck). F1's formula matches how the
decal is drawn (art × tint, multiply blend, compared per channel); the lilToon
`renderMode` check reads the right fields; the lowering search is exact. Load
cost acceptable: about 2 ms once per load on Included Avatars, and +15 ms once
for a fallback Avatar. Optional: an unused `blinks` parameter in a test helper
(P6-R3-N1); per-triangle allocations in two fallback loops (P6-R3-N2). Result:
pass.

#### Code Review #3 Revisions

P6-R3-N1 and N2: no change (dead test parameter is harmless; the fallback cost
is acceptable). Repair budget used up.

Phase 6 complete (agent-ready). Owner question for Phase 9: how VRoid-layout
whole-face art should map onto other face layouts (ふぁふぁ's crack lines).

### Phase 7: Size-aware placement and framing (R7)

Review tier: standard.

Intended changes:

0. Carried from Phase 6 (P6-R1-F1): size decals and eye overlays so that tears,
   under-eye marks and X and dot eyes on Polybot, HAOLAN and Olivia clear the
   visibility floor.
1. Measure, once at load, head size (face skin bounds, else the head bone to
   the top of the head mesh), eye size (Phase 4 landmarks) and body height.
2. Hover planes and box placements (`AvatarVFXController.ts`) size from eye and
   head size, and box hovers sit outside the head bounds, so head art and
   Reaction sparkles clear big heads and hoods.
3. Head contacts in `poses/anatomy/arms.ts` scale by measured head size when it
   differs from the body-height estimate; Particle Effects scale by body height
   relative to the Included Avatars.
4. Carried from Phase 5 (P5-R1-F2): place estimated-eye planes in front of the
   measured surface over each eye, then route face primitives that hold more
   than about a third of their skin weight below the neck (not the neck) to the
   head-region path, so whole-face art stops tinting Carol North's hair and ears
   without losing her eye effects.
5. The chat camera presets (`sceneCameraPresets.ts`) frame Portrait and close
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
3. Owner decision carried from Phase 6: how whole-face art laid out for VRoid's
   dedicated face texture maps onto faces whose island covers a small part of a
   shared texture (on ふぁふぁ the crack strokes fall outside the face).
4. Owner gates: the live blink and lip-sync check (Phase 3), review of the
   private survey sheets, and acceptance of any limitation left open (for
   example whole-face art tinting the hair, ears or a head-skinned hat on a
   single mesh that is mostly head, if Phase 7 does not resolve it).

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
