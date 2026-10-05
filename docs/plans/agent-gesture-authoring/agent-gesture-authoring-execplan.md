# Deliver agent-authored Gesture motion

Source agreement: [Agent-authored Gesture motion specification](agent-gesture-authoring-spec.md).
The owner accepted it as the planning basis on 2026-10-03 by requesting this
ExecPlan after resolving mute storage, headless Hands presets, the skill name and
expression precedence.
Authorized scope: all phases, authorized by the owner on 2026-10-03 through
`implement`, with the R6b addition (preserve unknown clip fields in the creator).
Starting revision: `401ac3b8a5affe07cacb82466304c8b0d7d42c16` (`origin/main`, fast-forwarded from planning base `4612eebf` before implementation).
Branch: the task worktree's generated `claude/vrm-models-creator-routes-5ed6fd`
branch was renamed to `feat/agent-gesture-authoring`. One branch and one PR for
this plan. Parent #260; phases #261 (P1), #262 (P2), #263 (P3), #264 (P4),
#265 (P5).

## Purpose and context

Give coding agents a reusable way to turn a text prompt into a natural Gesture:

- a per-bone motion description;
- a generator that bakes the description into `animaPoseClip/1.0`;
- automated motion checks on both Included Avatars;
- repeatable review renders;
- per-Gesture live-layer muting and expression precedence in chat;
- the `animama-animation` skill tying these together.

An owner-scored evaluation then decides whether a track-based clip format is
worth building. The spec owns behavior and acceptance (R1–R8, R6a); this plan
owns delivery.

Commands run from the repository root unless a working directory is stated.
Planning needs no stack. Phases 3 and 5 need a task stack for browser and chat
evidence. No backend API, Cloud or generated-client change is expected.

### Implementation orientation

Paths are relative to `src/frontend/web/src/` unless stated:

| Area | Current entry point and significance |
| --- | --- |
| Clip schema | `lib/avatar/poses/animaPoseClip/schema.ts`. The sanitizer whitelists and rebuilds clips, so unknown top-level fields are dropped on parse (`parseAnimaPoseClip`, ~283–372). |
| Sampling | `animaPoseClip/sampling.ts`, `interpolation.ts`. These provide whole-pose segments, one easing per segment, and base fallback for omitted bones. Generated output must play correctly under these semantics. |
| Version basis | `lib/avatar/poses/poseRetargeting.ts`. Canonical (VRM 1-style) values are converted for VRM 0 at playback. Generated values stay canonical. |
| Hands presets | `ui/pose-creator/poseCreatorHandAuthoring.ts`: `HAND_PRESETS`, `handPresetQuaternion`, `resolveHandBones` and private `fitThumbPreset`. These read only `avatar.vrm` (normalized nodes, meta version, world transforms) and already run in Node tests with fake Avatars. Transitive imports through `poseCreatorAuthoring.ts` reach the `@/lib/avatar` barrel and a zustand store. |
| Avatar load | `lib/avatar/Avatar.ts` (~2890–2897). This is a shared `GLTFLoader` with `VRMLoaderPlugin` and `VRMAnimationLoaderPlugin`. Textured `.vrm` loading fails in Node: there is no `createImageBitmap` or DOM `ImageLoader`, and Blob URLs are needed for embedded images. Existing Node tests use texture-free GLBs and stub `fetch`, `ProgressEvent` and `self`. |
| Frame order | `Avatar.update` (~663–722): pose clip, then procedural offsets, then reaction overlays, then `ExpressionController.update`, then `vrm.update`. |
| Clip expressions | `PoseController.ts` (~928–944) writes `expressionManager.setValue` directly. `ExpressionController.update` (~1032–1099) then overwrites emotion keys, blink (always AutoBlink) and lip-sync mouths. A clip's same-key values lose today; different keys mix. |
| Procedural layers | `ProceduralAnimationController.ts` (activation fade 0.28 s ~74, 267–300, 420–441; `setLayerWeight` immediate ~302; manual calls drop planner ownership ~390). Layers: `lib/avatar/proc-animation/`. There is no non-owning temporary mute. |
| Gesture lifecycle | Avatar `_playAnimaPoseClip` → `_beginPoseClipPlayback` (~1053–1093, 2535); natural end ~676–685; `stopClip` → `_stopCoordinatedPoseClip` (~2545–2583); `_completePoseClipPlayback` (~2607); planner pose actions (~1717–1806). Idle Style playback uses `source: "idle"` with `preserveProceduralOffsets`. Planner `manifestGestureActive` suppresses talkingHands (`planner/AvatarPlanner.ts` ~956, 2808). |
| Creator clip draft | `PoseCreatorClipDraft` (`ui/pose-creator/poseCreatorClipAuthoring.ts` ~85–111). Build and hydrate are at ~273–379. The fallback serializer is `ui/action-editor/actionPersistence.ts` (17–75), with empty-sequence hydration in `ActionTimelineEditor.tsx` (~188–207) and `updateClipDraft` in `stores/pose-creator-store.ts` (~1652). Clip settings UI is the "Clip settings" section of `PoseCreatorClipWorkspaceInspector` (~131–235). |
| Creator import | The Import dialog (`ui/action-editor/ActionEditorHeader.tsx` ~940–1004) accepts a file or pasted `animaPoseClip/1.0`. `parseActionImport` is in `actionProject.ts` (~141–174). Export is in `ActionJsonDialog`. |
| Backend | No top-level allow-list for `animaPoseClip/1.0` (`content_kind_registry.py` ~773–856; `content_package_capabilities.py` `_clip`; `idle_clip_validation.py` rejects only `playback` for idle). The shared fixture `lib/avatar/poses/fixtures/content-compatibility-valid.json` is exercised by `tests/test_pose_content.py`. |
| Node tooling | There is no tsx or vite-node. Precedent: `web/scripts/*.browser.test.mjs` start Vite `createServer` (with the `@` alias) and headless Playwright Chromium. `pnpm web:test` runs `packages:build`, Node tests, `vitest run`, then those browser scripts. |
| Skills | `.agents/skills/<name>/` holds `SKILL.md` (frontmatter `name`, `description`), `agents/openai.yaml` (`interface.display_name`, `short_description`, optional `default_prompt`) and optional `references/`. `.claude/skills` is a symlink. There is no validator. |

## Progress

- [x] Discovery, spec and owner decisions recorded (2026-10-03).
- [x] Repository facts inspected; phased plan drafted.
- [x] Owner authorized all phases (2026-10-03); spec published as #260 and read
      back; phase issues #261–#265 created; branch renamed and fast-forwarded to
      `origin/main` `401ac3b8`.
- [x] Phase 1: Motion description, anatomy and baking. Review #3 passed.
- [x] Phase 2: Automated motion checks. Review #2 passed.
- [x] Phase 3: Gesture layer mutes and expression precedence. Review #2
      passed; F7 (fade-scaled mutes) awaits owner confirmation.
- [x] Phase 4: Review renders and the `animama-animation` skill. Review #2
      passed; owner review of the skill guidance (R1) is pending.
- [ ] Phase 5: Evaluation on #243 prompts 1–6. Gestures authored, checked,
      imported and saved through the creator, and played on the mounted chat
      Avatar by script; owner scoring gate pending.
- [ ] Owner decisions requested:
  1. **Fade-scaled mutes:** layers fade with the Gesture rather than staying
     fully muted through fades (R6 wording).
  2. **Renderer pieces:** renders use the app's loader and sampler instead of
     the full `Avatar` class (R5 wording).
  3. **Idle Style playback:** mutes and expression precedence also apply when
     a Gesture plays through an Idle Style (the default applied).
  4. **Description location:** descriptions live in the owner's location, or
     by default in `motion-authoring/examples/`.
- [ ] Owner checks:
  - a real-dispatch chat check of an equipped Gesture (planner path);
  - creator play and reopen for each evaluation Gesture on both Avatars;
  - skill guidance review (R1);
  - R8 scoring.
- [x] Final integration review passed (review #2).
- [ ] PR and owner acceptance.

## Surprises & Discoveries

- The Gesture creator draft omits `playback` and `role`, so a Gesture clip
  imported with `playback` loses it on Save. This predates this work and is now
  in scope as R6b.
- The e2e helper `setReactionPlayhead` targets a "Clip timeline playhead time"
  input that no longer appears in current source. Treat existing creator e2e
  helpers as possibly stale.
- Normalized three-vrm bones have identity rest rotations in a shared VRM 1-style
  basis. Named anatomical motions can therefore be a static axis table in the
  canonical basis, verified by forward kinematics on both Avatars, rather than a
  per-Avatar measurement.
- Hands-preset thumb fitting depends only on the thumb metacarpal's rotation
  relative to the hand, which generated clips keep at base. Fitting once on the
  reference Avatar posed at `relaxedRest` is therefore equivalent to fitting per
  sample.
- Textured `.vrm` files load in Node (about 15 ms each) once a GLTFLoader plugin
  resolves textures to placeholders, so no browser fallback is needed for
  generation or checks.
- Owner testing found that four of the six saved evaluation Gestures would not
  reopen in the creator, and that the editor flooded the backend with preview
  requests. The editor capped clip files at 512 KB, below the runtime's 2 MiB,
  and a failed load retried in a loop. The creator also saved clips indented,
  with 17-digit renormalized quaternions: the saved laugh was 2.33 MB, over even
  the runtime limit. Fixed in `1dcdda35`:
  - one shared `MAX_ANIMA_POSE_CLIP_BYTES` limit;
  - no automatic retry after a failed load;
  - compact saves at five decimals for transforms, four for times and three
    for expression weights;
  - a generator refusal for clips over the limit.

  The six items were re-saved in place; the laugh is now 0.82 MB.

## Decision Log

- 2026-10-03, owner (discovery): coding agents only; Local output, with promotion
  separate; full body with planted feet; one-shot and held/looping; body plus
  expressions; per-layer mutes with a simple creator control and no creator
  live-layer preview; existing Gestures unchanged; agent self-review before owner
  review; tracked frontend tool; separate issue reusing #243 prompts 1–6 and rubric.
- 2026-10-03, owner: mute settings live in the clip JSON; Hands presets are used
  outside the browser; skill name `animama-animation`; Gesture expressions take
  precedence over emotion expressions.
- 2026-10-03, owner: authorize all phases; add R6b so the creator stops
  dropping unknown clip fields.
- 2026-10-03, owner: prompt set and rubric are not final; proceed as-is.
- 2026-10-03, planning (spec refinement, owner review requested):
  - R2: thumb fitting uses one reference Avatar, as in the creator.
  - R5: review renders use the production Avatar runtime, plus a creator playback
    confirmation, instead of capturing every frame through the creator UI.
  - R6a: blink and lip-sync behavior is spelled out.
- 2026-10-03, planning (implementation choices, revisable within scope):
  - **Interpolation:** interpolate named anatomical angles with C1 cubic Hermite
    curves, converting to quaternions per sample, rather than splining quaternions.
  - **Baking:** use linear segments between baked samples, with sample spacing
    chosen against a tolerance (target ≤ 1/30 s).
  - **Reference Avatar:** default `AvatarSample_A_1_New`, overridable.
  - **Mute field:** `mutedProceduralLayers: ProceduralAnimationLayerId[]`.
  - **Muting mechanism:** a non-owning suppression multiplier in the procedural
    controller.
  - **R8 descriptions:** committed as generator examples.
- 2026-10-03, implementation (Phase 1 review): `auto` tangents are clamped
  (Fritsch–Butland), with no unclamped option; overshoot is authored as keys.
  Hand-shape keys always settle (ease in-out) with no tangent option. The
  reference Avatar is fixed to the VRM 1 sample because the leg solver needs a
  VRM 1 rig, so the plan's `--fit-avatar` option was dropped. Finger and thumb
  segments are keyable joints whose axes match the Hands tool.
- 2026-10-03, implementation (Phase 4, owner acceptance requested): review
  renders use the app's VRM loader steps, `sampleAnimaPoseClip` and canonical
  posing (the same sampler and VRM 0 conversion as playback) in headless
  Chromium, not the full `Avatar` class, which needs a prepared runtime
  catalog. Creator playback and a chat check remain the confirmation that the
  real runtime matches. Descriptions are kept in the owner's chosen location,
  or by default in `motion-authoring/examples/` on the task branch.
- 2026-10-03, implementation (Phase 2 review):
  - **Not checked:** jerk. Vector acceleration spikes, pops and stall warnings
    cover the visible failure modes.
  - **Intersection volumes:** rest-calibrated capsules (torso to the upper
    chest, neck, skull, forearms, hands) with height-scaled radii. Upper-arm
    capsules are omitted because the arm meets the torso at the shoulder.
  - **Thresholds:** they assume 60 Hz sampling.
  - **Wave example:** its anticipation dip was removed after it grazed the hip.
  - **Range limits:** thumb abduction, knee, shoulder depression, wrist
    deviation and arm rotation ranges were widened to accept solver output and
    shipped hand-authored content.

## Preparation once implementation is authorized

1. Recheck the root and frontend `AGENTS.md`, HEAD, branch and dirty state.
   Preserve the spec and plan.
2. Follow `workspace-setup`: publish and read back the spec as the parent issue,
   create one issue per authorized phase, and record the issue URLs and snapshot
   time here and in the spec.
3. Rename the branch to `feat/agent-gesture-authoring`.
4. From `src/frontend`, run `pnpm install --frozen-lockfile` and
   `pnpm packages:build`. Confirm the Playwright Chromium install used by
   `web/scripts/*.browser.test.mjs`.
5. For Phases 3 and 5, start a named task stack with `animama-local-stacks`
   (`./reset.sh --name <name> --base-port <port>`) and record its URL. Use test
   Animas and content only.
6. Use behavior-focused red/green tests (`tdd`). Run focused tests with
   `pnpm exec vitest run <paths>` from `src/frontend/web`.

## Phased implementation

Each phase starts after its predecessor's required checks and bounded review
pass, within the authorized range. Phase 3 depends only on preparation and may
run before or alongside Phases 1–2 on the same branch. Record the starting SHA,
issue, commits (`feat(animation)[p#]: …` or a better-fitting scope),
commands/results and remaining gates per phase. Plan one full independent review
(`sdlc-reviewer`) per phase and at most two repair rounds.

### Phase 1 — Motion description, anatomy and baking

Requirements: R2, R3. Dependency: preparation.

Proposed home: `lib/avatar/motion-authoring/` for pure, tested modules, plus a
CLI under `web/scripts/animation/`. Phase 1 confirms this, or moves to a
`web/tools/` location if bundling or tsconfig boundaries argue against it.

1. **Headless VRM loader (spike first).** Load `content/included/avatars/*.vrm`
   in Node with the app's loader configuration. Register a GLTFLoader plugin that
   resolves every texture to a placeholder `Texture`, because textures are
   irrelevant to kinematics. Apply `rotateVRM0` as `Avatar` does.
   - Verify that both Avatars expose all 54 humanoid bones and correct meta
     versions.
   - If Node loading proves brittle, run generation and checks inside the
     Vite + Playwright Chromium harness used by browser tests instead. Record the
     decision.
2. **Description schema and validation.** Define a versioned JSON description
   with clip metadata:
   - name, kind (one-shot or held/loop), duration, loop, fades, base pose and
     `mutedProceduralLayers`;
   - per-joint tracks of named anatomical motions in degrees;
   - a hips position track;
   - expression tracks;
   - hand-preset keys (preset id, Curl, Spread, side);
   - optional declared contacts (for Phase 2).

   Each key carries time, value and tangent mode (`auto`, `flat`, `linear`,
   `step`). Validation reports track, key and reason, and writes nothing on
   failure. Design the semantics so a future track-based clip format can adopt
   them directly (spec R2).
3. **Anatomical joint model.** For each humanoid joint and side, define its
   named motions (for example shoulder flexion/abduction/rotation, elbow flexion,
   forearm pronation, wrist flexion/deviation, spine/chest/neck/head
   flexion/lateral flexion/rotation, hip, knee and ankle). Each motion has a
   canonical-basis axis, a sign convention and a composition order: axial twist
   in bone-local space, then swing.
   - Record a range-of-motion table with cited public sources and Animama's
     chosen soft and hard limits.
   - Prove each motion with FK tests on both Avatars, for example "elbow flexion
     moves the wrist toward the shoulder" and "left/right abduction is mirrored".
     These include VRM 0/1 parity through `poseRetargeting`.
4. **Hands presets headless.** Make the preset logic callable without the
   `@/lib/avatar` barrel or the zustand store. If imports block Node use, extract
   the pure preset/fit math into a dependency-light module that the creator
   keeps using unchanged.
   - Add a regression test proving that the creator's preset output is
     unchanged.
   - The generator fits thumbs on the reference Avatar with the baked arm/hand
     pose at each preset key.
5. **Curves and baking.** Evaluate each scalar track with cubic Hermite tangents
   (auto = Catmull-Rom style, clamped to avoid overshoot unless requested). Hold
   untracked channels at the base value. Convert angles to canonical quaternions
   per sample.
   - Bake to `animaPoseClip/1.0` inline poses and keyframes with linear easing,
     choosing sample times so the maximum angular deviation from the curve stays
     below a stated tolerance.
   - Expressions bake to keyed weights. Loops wrap tangents across the seam.
   - Apply the Action naming invariant (`name`, kebab-case `id`), `basePose`,
     fades and `mutedProceduralLayers`.
   - Output is deterministic: stable ordering and fixed numeric precision.
6. **CLI.** `generate <description.json> [--out <clip.json>] [--fit-avatar <id>]`
   writes a clip that the creator Import dialog accepts. It exits nonzero with
   readable errors.

Checks: unit tests for validation errors, determinism, C1 continuity through
authored keys, hold semantics, tangent modes, loop seams, naming, preset reuse
and the FK axis table on both Avatars. Run `pnpm web:lint` and `pnpm check` from
`src/frontend`.

Completion: a hand-written sample description, for example a right-hand wave,
generates a valid clip. Parsing it with `parseAnimaPoseClip` and sampling it
reproduces the curves within tolerance on both Avatars.

#### Phase 1 evidence

- Issue #261. Starting source `93cd6a99`.
- Delivered in `src/frontend/web/src/lib/avatar/motion-authoring/`:
  - headless VRM loader;
  - anatomical joint model with a cited range-of-motion table, including finger
    and thumb segments;
  - description schema and validation;
  - clamped cubic Hermite tracks with loop wrap;
  - planted-leg two-bone solver;
  - Hands-tool preset reuse;
  - baker with tolerance-driven densification (1° / 5 mm) and exact steps;
  - `pnpm animation joints|base|generate` through Vite SSR
    (`web/scripts/animation.mjs`);
  - wave example.
- Hand authoring types were narrowed to `Pick<Avatar, "vrm">`. This is a
  type-only change.
- Checks from `src/frontend/web`:
  - `pnpm exec vitest run src/lib/avatar/motion-authoring src/ui/pose-creator`:
    pass (43 motion tests; the pose-creator suites still pass).
  - `pnpm check:source`: pass.
  - eslint: pass.
  - prettier `--check`: pass.
  - `pnpm -s animation generate …/wave-hello.motion.json`: 99 keyframes,
    0.385° / 0.00003 m.
- Not established: rendered appearance (Phase 4).

#### Code Review #1 Findings

Independent `sdlc-reviewer`, working tree on `93cd6a99`. Checks: vitest, tsc,
eslint, prettier and CLI all passed, plus edge-case probes.

- **P1-R1-F1 (required):** no stated bake tolerance, and over-tolerance output
  was written (a 10 Hz fast elbow gave 15.6°).
- **P1-R1-F2 (required):** loop hand-shape tracks did not wrap and were not
  validated, so the seam snapped.
- **P1-R1-F3 (required):** R2 unpreset finger tracks were impossible because
  there were no finger joints.
- **P1-R1-F4 (required):** the Phase 1 completion criterion was not tested
  (playback versus the curves on both Avatars).
- **P1-R1-F5 (optional):** steps were baked as ramps.
- **P1-R1-F6 (optional):** hand keys always stop; this was undocumented.
- **P1-R1-F7 (optional):** the clamped-tangent deviation was not recorded.
- **P1-R1-F8 (optional):** `--fit-avatar` was missing and unknown flags were
  ignored.
- **P1-R1-F9 (optional):** the bake error ignored hips position.
- **P1-R1-F10 (optional):** the plan's thumb-fit claim was wrong, and the
  reference re-posing side effect was undocumented.

#### Code Review #1 Revisions

All findings were verified and accepted.

- **F1:** added `BAKE_TOLERANCE_DEGREES`/`_METRES` (1° / 5 mm). Segments are
  subdivided down to 1/120 s, the report carries `withinTolerance`, and the CLI
  refuses to write when it is false.
- **F2:** hand shapes wrap across the loop seam, and validation rejects
  mismatched hand shapes at 0 and the duration.
- **F3:** added `finger` (curl, splay) and `thumb` (curl) joints for the
  proximal, intermediate and distal segments. Axes are proven equal to the
  Hands tool, and keyed finger joints override hand shapes.
- **F4:** a test samples the parsed clip at off-grid times against the
  evaluator (≤ 1.05°) and compares fingertip positions on both Avatars
  (< 12 mm).
- **F5:** steps hold until 1 ms before the next key, with a test.
- **F6, F7:** documented on `HandShapeKey`/`ScalarTrack` and in the Decision Log.
- **F8:** dropped `--fit-avatar` (see the Decision Log); unknown or valueless
  options exit 2.
- **F9:** added hips-position error to refinement and to the report.
- **F10:** corrected the Surprises entry and documented the re-posing side
  effect.

Verification: vitest motion-authoring 43/43, `check:source`, eslint and
prettier pass. Repair budget: one round remaining after recheck #2.

#### Code Review #2 Findings

Targeted recheck: F1–F10 are resolved, and the probes were reproduced.

- **P1-R2-F1 (required):** the one-component thumb joint discarded about 8° of
  `relaxedRest` thumb rotation, so `"base"`/untracked thumbs did not hold base.
- **Optional:** no unit test covered the loop hand-shape rejection. Segments
  under 2 ms are skipped in error measurement (accepted as step-lead handling).

#### Code Review #2 Revisions

- **P1-R2-F1, accepted:** the thumb joint gained `palmarAbduction` (z) and
  `twist` (x) components. `relaxedRest` thumbs decompose exactly (0° residual),
  and a test proves keyed thumbs start and end at base.
- Writing that test exposed that `Quaternion.angleTo` is ill-conditioned near
  zero for 6-decimal rounded quaternions (0.1° false error).
  `angularDistanceDegrees` now normalizes and uses the relative rotation's
  vector part.
- **Optional, accepted:** added a loop hand-shape rejection unit test. The
  2 ms skip is retained.

Verification: vitest motion-authoring + pose-creator 208/208, `check:source`
and eslint pass. Wave example unchanged (0.385°).

#### Code Review #3 Findings and Revisions

Final targeted recheck: P1-R2-F1 is resolved and the revisions caused no
regression. The wave output is byte-identical to round 2. Result: **pass**.

One optional note was accepted: the thumb curl axis matches the Hands tool
only when abduction and twist are zero. This is documented on the thumb joint
definition. The repair budget is exhausted for Phase 1.

### Phase 2 — Automated motion checks

Requirements: R4. Dependency: Phase 1 loader, joint model and baking.

1. Sample the baked clip through the production `sampleAnimaPoseClip` and
   `poseRetargeting`, using `relaxedRest` as the base. Apply each sample to each
   loaded Avatar's normalized rig, then update it the way `vrm.update` would
   transfer to raw bones.
2. Implement check categories, reporting Avatar, time range, bones and values:
   - **Range of motion:** each named motion against the soft and hard limits.
   - **Smoothness:** angular velocity, acceleration and jerk spikes; unintended
     stops; seam discontinuity.
   - **Intersection proxies:** bone-segment capsules for hands, forearms, upper
     arms, torso, neck and head, sized from each Avatar's bone lengths with a
     stated margin.
   - **Contacts:** declared contact targets within tolerance.
   - **Planted feet:** foot and toe world positions drifting, lifting or going
     below the ground plane beyond tolerance.
   - **VRM 0/1 parity:** the same anatomical direction for key end-effectors,
     normalized by limb length.
3. CLI: `check <clip.json> [--description <file>] [--json]` prints a readable
   summary and exits nonzero on failures. Thresholds live in one documented
   config.
4. Add tests with deliberately faulty descriptions, one per category, asserting
   the reported Avatar, bone and time. Add a clean sample that passes.

Checks: focused vitest suites, `pnpm web:lint`, `pnpm check`.

Completion: every category detects its seeded fault on both Avatars, and the
Phase 1 sample passes or has recorded, justified findings.

#### Phase 2 evidence

- Issue #262. Starting source `e0509b51`.
- `motion-authoring/checks.ts` plays clips through `sampleAnimaPoseClip` with
  catalog pose resolution, `poseRetargeting` and both Avatars. Checks:
  - unresolved pose references;
  - range of motion (soft = warn, hard = fail);
  - smoothness: pops, speed, vector acceleration, and mid-motion stalls
    (warn);
  - intersection: rest-calibrated torso/neck/head/forearm/hand capsules;
  - declared contacts;
  - planted feet;
  - loop seam (gap and velocity);
  - VRM 0/1 parity of each bone's world rotation from rest.
- Thresholds live in `MOTION_CHECK_THRESHOLDS`.
- `pnpm animation check <motion|clip> [--description] [--json]` exits 1 on
  failure.
- Checks from `src/frontend/web`:
  - vitest motion-authoring + pose-creator: 223 pass;
  - `check:source`, eslint and prettier: pass.
- The wave example passes on both Avatars in about 0.5 s.
- Shipped hand-authored Gestures are not a gate. Several report intersections
  where they touch the body without declared contacts, and a few exceed range
  limits (for example `meme-dab` head lateral flexion).

#### Code Review #1 Findings

Independent `sdlc-reviewer` on `e0509b51` plus the working tree. Checks pass,
shipped clips were probed.

- **P2-R1-F1 (required):** the torso capsule covered the chin, and a face
  contact didn't clear it (`thinking-hand-on-chin-hold`).
- **P2-R1-F2 (required):** non-`relaxedRest` pose references were dropped
  silently, giving false passes and false failures.
- **P2-R1-F3 (required):** acceleration came from speed magnitude, so
  reversals were missed.
- **P2-R1-F4 (required):** unintended stops were not checked; jerk was absent.
- **P2-R1-F5 (required):** parity used limb directions only, missing
  head/wrist/twist errors.
- **P2-R1-F6 (required):** tests did not assert bone, time and Avatar per
  category; there were no regressions for F1–F5.
- **Optional:**
  - contact offsets were scaled though documented as metres;
  - the head capsule did not rotate;
  - `--description` was ignored silently;
  - `avatarScale` was duplicated;
  - canonical findings were labelled ambiguously;
  - the loop seam compared speed magnitude only;
  - plan evidence and decisions were missing;
  - shipped chin pose shoulder depression exceeded the hard limit.

#### Code Review #1 Revisions

All findings were verified and accepted, except jerk (see the Decision Log).

- **F1:**
  - the torso capsule now ends at `upperChest`;
  - added a neck capsule and an eye-oriented skull capsule;
  - face contacts clear both head and neck;
  - regression test with the shipped chin hold.
- **F2:**
  - catalog resolution as in playback;
  - missing references are a `pose` failure;
  - tests cover a missing reference and `right-face-palm` (no false pops).
- **F3:** acceleration uses rotation-vector velocity differences; reversal
  test added.
- **F4:** a stall warning with a look-around window; test added.
- **F5:** parity compares per-bone world rotation from T-pose across Avatars
  (spine, neck, head, arms, hands, legs, index and thumb); synthetic test added.
- **F6:** category tests now assert subject, Avatar and time. CLI tests cover
  exit codes 0/1/2 and `--json`.
- **Optional, applied:**
  - contact offsets are unscaled metres;
  - rotating skull capsule;
  - `--description` warning;
  - removed `avatarScale`;
  - findings are labelled `[canonical]`;
  - velocity-vector seam check;
  - shoulder depression hard limit −15°;
  - wrist deviation and arm rotation limits widened to −40..25° and
    −95..105°. This covers most shipped content, but `left-ok-sign` (wrist
    30.7°) and `right-face-palm` (arm rotation 127.8°) still exceed them.

Verification: 223 tests, `check:source`, eslint and prettier pass.

#### Code Review #2 Findings and Revisions

Targeted recheck: F1–F6 and the optional items are resolved with no
regressions. Result: **pass**.

Optional notes, all applied:
- the plan wording on widened limits is corrected (above);
- a loop-seam failure now reports its own limit, with the finger factor;
- the skull capsule falls back when an Avatar has no eye bones;
- CLI tests remove their temporary directories.

Shipped touch Gestures fail intersection unless contacts are declared. Treat
them accordingly when they serve as R8 baselines.

### Phase 3 — Gesture layer mutes and expression precedence

Requirements: R6, R6a, R6b. Dependency: preparation. A task stack is needed for the
browser and chat evidence.

1. **Schema.** Add optional
   `mutedProceduralLayers?: ProceduralAnimationLayerId[]` to `AnimaPoseClip`.
   - The sanitizer accepts the listed mutable ids (`breathing`, `sway`, `bounce`,
     `headNod`, `headSideTilt`, `cursorLookAt`, `emotionPosture`) and ignores
     unknown ids with a diagnostic rather than rejecting the clip.
   - `talkingHands` is not mutable through this field.
   - Add the field to the shared compatibility fixture so
     `uv run pytest tests/test_pose_content.py` confirms backend acceptance.
2. **Creator round-trip.** First implement R6b. Retain the parsed clip's
   top-level fields that the draft doesn't own, including `playback`, `role` and
   unknown fields, as an opaque passthrough. Merge them back on build and
   export, with draft-owned fields taking precedence. This requires the parser to
   keep unknown top-level fields on the parsed object instead of whitelisting
   them away, while still validating known fields. Then carry the mute field
   through:
   - `PoseCreatorClipDraft` build and hydrate,
   - the `actionPersistence` fallback serializer,
   - empty-sequence hydration and `updateClipDraft`,
   - import (`parseActionImport`), Save/reopen, clip and typed-project export,
     and Undo/Redo where clip settings participate.

   Add simple per-layer checkboxes to the "Clip settings" section of
   `PoseCreatorClipWorkspaceInspector`, with the mobile path through the same
   inspector. Gesture creator only: Reaction settings are unchanged. The creator
   preview still runs no live layers.
3. **Muting runtime.** Add a non-owning per-layer suppression factor to
   `ProceduralAnimationController`, multiplied into activation and faded over the
   existing activation fade duration. It never changes planner ownership, user
   settings or `setLayerWeight` state.
   - Avatar applies the clip's mutes when a Gesture pose clip begins and releases
     them on natural completion, stop or fade-out, interruption, replacement and
     dispose. Muted layers therefore never stay muted.
   - Gestures without the field change nothing.
   - Idle Style playback follows the open decision; default apply, because the
     setting belongs to the Gesture.
4. **Expression precedence.** Stop the clip writing expressions directly before
   `ExpressionController.update` overwrites them. Instead pass the Gesture's
   sampled expression weights and blend weight (from fades) to
   `ExpressionController` as a precedence overlay:
   - When the Gesture keys any emotion preset, the emotion contribution is
     scaled by `1 − blend` and Gesture weights are applied at `blend`.
   - A Gesture-keyed `blink` replaces AutoBlink while active.
   - Lip-sync mouths still win while speech is active.
   - Reaction overlays and manual overrides keep their current order after the
     Gesture overlay, unless tests show they need adjusting.
   - Gestures without expression keys behave identically.
5. **Docs.** Update `docs/frontend/runtime/avatar-animation.md` (clip artifacts,
   Gesture playback, layering) and `avatar-emotion.md` with the field, mute
   lifecycle and expression precedence.

Checks:
- Unit tests for the sanitizer, creator round-trips (import → Save → reopen →
  export equality), suppression fade in and out, release on every termination
  path, and unchanged behavior without the field.
- Expression precedence tests: same-key, different-key, blink and lip-sync cases,
  and no-expression clips.
- `pnpm check`, `pnpm web:lint`, `pnpm web:test` and `pnpm build` from
  `src/frontend`; the backend fixture pytest.
- Browser: creator checkboxes persist through Save/reopen.
- Chat on the task stack: a test Anima with an equipped test Gesture shows
  cursor look-at and sway stopping and resuming, and a smiling Gesture over a
  non-happy emotion.

Completion: tests pass and browser and chat evidence are recorded. Gate: the
owner's idle-lane decision is applied. If it is unanswered by phase completion,
the default is applied and recorded.

#### Phase 3 evidence

- Issue #263. Starting source `fe613455`.
- **Schema** (`schema.ts`):
  - optional `mutedProceduralLayers`, canonicalized; unknown ids ignored;
    non-array rejected;
  - unknown top-level fields preserved.
- **Creator draft:** `mutedProceduralLayers` plus an `extraFields`
  passthrough, carried through build, hydrate, fallback serializer and
  empty-sequence hydration. Clip settings gained "Mute while playing"
  switches (Gesture only).
- **Runtime:**
  - `PoseController.getClipPresence()`;
  - `ProceduralAnimationController.setClipLayerMutes()`: non-owning
    suppression eased over 0.28 s;
  - `ExpressionController.setClipExpressionPrecedence()`;
  - all wired in `Avatar.update` from the playing clip's presence, so
    Idle Style playback is included (default decision applied).
- **Docs:** `avatar-animation.md`, `avatar-emotion.md`.
- **Local checks**, from `src/frontend`:
  - `pnpm check` exit 0;
  - `pnpm web:lint` exit 0;
  - `pnpm web:test` exit 0 (375 files, 2,530 tests);
  - `pnpm build` exit 0;
  - web `prettier:check` clean. The workspace `prettier:check` fails on
    `desktop/tests/feature-packs.test.ts`, which is unchanged here and already
    unformatted on `main`.
- **Backend:** `uv run pytest -q tests/test_content_mutation_workflows.py -k layer_mutes`
  passed. Saving a Gesture stores the clip byte-for-byte, including the
  mutes and an unknown field. The planned pose fixture is a Pose, not a clip,
  so this test replaces that step.
- **Browser** (task stack `animama-gesture-authoring`,
  http://animama-gesture-authoring.localhost:8260, development mode, no
  profiles; only the web service is published):
  - a generated clip pasted into Gesture Import showed its imported mutes in
    Clip settings;
  - Breathing was toggled on and the clip saved as Local;
  - the stored file contained the four mutes and the unknown `generator`
    field;
  - reopening restored all switch states.
- **Chat runtime** (mounted chat Avatar, `Avatar.update` driven at 60 Hz by
  script because the hidden pane throttles animation frames):
  - with sway and cursor look-at muted, both layers' activation weight went
    1 → 0.67 (0.1 s) → 0 (0.3 s) while breathing stayed 1;
  - they recovered 0.25 → 0.75 → 1 through the fade-out and after the end;
  - under the `gloom` emotion, a `happy` clip moved sad 0.7 → 0.35 → 0 and
    happy 0 → 0.45 → 0.9, and sad returned to 0.7 afterwards.
- **Not done:** the planner/equip dispatch path was not exercised in a chat;
  the clip started via `avatar.playAnimaPoseClip`, the same playback code.
  Save & Equip is disabled without unsaved changes.

#### Code Review #1 Findings

Independent `sdlc-reviewer` on `fe613455` plus the working tree. Ran 785
tests, `check:source`, eslint, prettier and the backend workflow tests.

- **P3-R1-F1 (required):** no package export/import round-trip test.
- **P3-R1-F2 (required):** no lip-sync precedence test; blink was checked only
  at weight 1.
- **P3-R1-F3 (optional):** the shared creator now preserves fields for
  Reactions too. Gesture-only mutes would be stored on Reactions with no
  control.
- **P3-R1-F4 (optional):** unknown mute ids are dropped without the planned
  diagnostic.
- **P3-R1-F5 (optional):** the clip still writes expressions directly and
  `ExpressionController` overrides them later in the frame; this deviates from
  plan step 4.
- **P3-R1-F6 (optional):** an index signature on `AnimaPoseClip` disabled
  excess-property checks.
- **P3-R1-F7 (optional, owner):** mutes scale with the clip's fade weight, so
  layers are only partly muted during fades.
- **P3-R1-F8 (optional):** duplicated layer filtering, and small per-frame
  allocations.

#### Code Review #1 Revisions

- **F1, accepted:** the backend test now exports and imports the saved
  Gesture as a package. Both copies keep `mutedProceduralLayers` and the
  unknown field; the package re-serializes the JSON, so content is compared
  rather than bytes.
- **F2, accepted:** tests now cover a keyed `aa` losing to an active vowel
  lip-sync frame, and keyed blink at weight 0.5 staying ≥ 0.5.
- **F3, accepted:** `sanitizeReactionSequence` drops `mutedProceduralLayers`.
  A test proves a Reaction keeps `playback` and unknown fields but not mutes.
  Reactions keeping `role`/`playback` through edits is an intended R6b effect.
- **F4, deviation recorded:** the schema module has no logger, and ignoring is
  documented on `sanitizeAnimaPoseClipLayerMutes`.
- **F5, deviation recorded:** the direct clip write is kept so creator
  previews, which run no `ExpressionController`, still show expressions. In
  chat, `ExpressionController` applies precedence afterwards in the same frame.
- **F6, accepted:** removed the index signature; unknown fields are read
  through `Record<string, unknown>`.
- **F7, recorded for owner confirmation:** mutes follow the fade weight (and
  ease over 0.28 s) so layers hand over without pops. Fully muted while
  playing, partially during fades.
- **F8:** layer filtering is shared through `sanitizeAnimaPoseClipLayerMutes`.
  The per-frame allocations (a few small objects) are retained as negligible.

Verification:
- vitest `src/lib/avatar src/ui/action-editor src/ui/pose-creator tests/avatar`:
  96 files, 788 tests pass;
- `tsc -p tsconfig.app.json` passes;
- `uv run pytest -q tests/test_content_mutation_workflows.py`: 18 pass;
- ruff check and format pass.

#### Code Review #2 Findings and Revisions

Targeted recheck: F1–F8 are resolved or acceptably recorded, with no
regressions. Result: **pass**. One optional note: the blink test asserts only
the 0.5 floor. Accepted as sufficient; an automatic blink peak is
nondeterministic.

### Phase 4 — Review renders and the `animama-animation` skill

Requirements: R1, R5, R7. Dependencies: Phases 1–3.

1. **Review renderer.** Add a script following the `*.browser.test.mjs`
   precedent: Vite `createServer` with the `@` alias plus headless Playwright
   Chromium (real WebGL).
   - It loads both Avatars through the production `Avatar` path, applies the clip
     through `PoseController` sampling with no live layers, and renders front,
     three-quarter and side views.
   - Frames come at keyed beats plus a regular cadence, assembled into labelled
     contact sheets (PNG) per Avatar.
   - Output goes to a caller-chosen directory: the agent's scratch area, never a
     tracked evidence directory.
   - A short test confirms the script renders a non-empty sheet.
2. **Creator confirmation procedure.** Document, and where practical script,
   these steps:
   1. Import the clip JSON through the Import dialog.
   2. Play it on each Avatar.
   3. Save as Local content (Save, not Save & Equip, unless the owner asks).
   4. Reopen and confirm unchanged playback.

   Fix or replace the stale e2e playhead helper only if the procedure uses it.
3. **Skill.** Create `.agents/skills/animama-animation/` following repository
   conventions:
   - **`SKILL.md`:** context, decision rules, the workflow from R1 and evidence
     rules. It links to `animama-vrm` instead of duplicating VRM facts.
   - **`references/`:**
     - motion principles for natural performance (timing, staggered overlap,
       anticipation, follow-through, arcs, alive holds, weight and
       counterbalance, asymmetry, easing choices);
     - human movement and the anatomical description format, including the
       range-of-motion table and coupled motions;
     - hands (presets, Curl and Spread, when to use the Hands tool);
     - expressions and layer mutes, including precedence;
     - generation and check commands, with how to read and fix findings;
     - review and hand-off (renders, creator confirmation, chat check, Local
       save, description retention, what checks cannot prove);
     - one compact worked example.
   - **`agents/openai.yaml`:** `display_name` and `short_description`.

   Add a pointer from `animama-vrm` to the new skill.
4. **Dry run.** A fresh agent context follows the skill on one sample prompt
   (not one of #243's six) without undocumented steps. Record any skill gaps and
   fix them.

Checks: renderer test; `pnpm web:test`; skill files reviewed against the R1
checklist; dry-run notes.

Completion: renders and the skill workflow work end to end on the sample, and
the owner is asked to review the skill guidance (R1).

#### Phase 4 evidence

- Issue #264. Starting source `e6253091`.
- **Review renderer** (`web/scripts/animation-render.mjs`, harness under
  `web/scripts/animation-render/`):
  - Vite plus headless Chromium (SwiftShader WebGL) loads both textured
    Included Avatars;
  - plays the clip through `sampleAnimaPoseClip` and canonical posing;
  - draws rows of front, ¾ and side views (from the Avatar's `--side`)
    plus a face close-up;
  - about 6 s per sheet.
  - Deviation: it uses the app's loader plugins and sampler, not the full
    `Avatar` class, which would need runtime catalog preparation; live layers
    are excluded as in the creator.
  - `scripts/animation-render.browser.test.mjs` passes.
- **Skill** `.agents/skills/animama-animation/`:
  - `SKILL.md`, `agents/openai.yaml`;
  - references: motion principles, description format, human movement,
    hands and face, checks and review.
  - `animama-vrm` links to it; `docs/frontend/runtime/avatar-animation.md`
    lists the commands.
- **Creator confirmation:** the procedure is documented in the skill and was
  exercised in Phase 3 (import, mutes, Save, reopen).
- **Wave example:** revised from its renders. The elbow stays bent while the
  arm lowers, and external rotation unwinds before the return, so the
  forearm no longer swings out sideways.
- **Dry run:** a fresh agent with only the skill authored "point to the right
  and look, curious". Checks passed after three iterations and the renders
  read clearly. Its nine guidance gaps were fixed:
  - mood blend table;
  - gaze and look-preset guidance;
  - side and face views, plus the `--side` option and help text;
  - front-view mirroring note;
  - lateral pointing values;
  - intersection fix advice;
  - one-arm counterbalance directions;
  - setup clarity;
  - consistent `pnpm -s` usage.
- **Owner gate:** review of the skill guidance (R1) is requested at hand-off.

#### Code Review #1 Findings

Independent `sdlc-reviewer` on `e6253091` plus the working tree. It verified
the skill's claims against the code, and the renderer test, eslint,
prettier, example check and a render all pass.

- **P4-R1-F1 (required):** the skill said tracks hold outside their keys, but
  loops wrap.
- **P4-R1-F2 (required):** no lasting location for descriptions (R7).
- **P4-R1-F3 (required):** the renderer's departure from "production Avatar
  runtime" was not in the Decision Log.
- **Optional:**
  - renderer arguments were lax (missing `--out` exited 0; NaN times);
  - a browser launch failure leaked the Vite server; harness errors
    surfaced only as a 60 s timeout;
  - missing pose references rendered silently;
  - toes were wrongly documented as unkeyable with planted feet;
  - at 2.30 s the wave forearm still angles out slightly.

#### Code Review #1 Revisions

- **F1, accepted:** the loop wrap rule is now in `description-format.md` and
  `motion-principles.md`.
- **F2, accepted:** descriptions go to the owner's location, or by default
  `motion-authoring/examples/` on the task branch (SKILL.md steps 2 and 8,
  hand-off list); clips and renders may stay in scratch.
- **F3, accepted:** added a Decision Log entry; flagged for owner acceptance.
- **Optional, applied:**
  - strict renderer options (unknown, valueless or invalid exit 2; `--help`);
  - launch and listen moved inside cleanup;
  - fail-fast harness errors;
  - missing pose references reported as a warning;
  - `--tile` option, documented;
  - toe documentation corrected.
- **Wave forearm, retained:** the residual outward angle at 2.30 s is the
  forearm passing through its natural carry angle while lowering. Recorded as
  a limitation.
- **Also folded in from Phase 5 authoring agents:**
  - the finger splay natural range is widened to ±22°, so the Hands tool's
    Open · spread preset no longer warns;
  - the skill gained a palms-up recipe and blink/eye-narrowing guidance.

#### Code Review #2 Findings and Revisions

Targeted recheck: F1–F3 and the applied optional items are resolved, with no
regressions. Result: **pass**.

Optional notes, all applied:
- the Node side now races the ready wait against `pageerror`, so harness
  import failures surface immediately;
- `--tile` dimensions must be 10–9999 px;
- the header comment lists `--tile`;
- the palms-up recipe names wrist `flexion` −10 to −20;
- sheet labels drop the `AvatarSample_` prefix.

Renderer test passes and eslint is clean.

### Phase 5 — Evaluation (R8)

Requirements: R5, R7, R8. Dependencies: Phases 1–4 and the task stack.
Owner gates: confirm or revise the prompt set, rubric and pass threshold before
scoring, and score the results.

1. For each of #243 prompts 1–6, follow the skill:
   1. Write the description.
   2. Generate the clip and run the checks until clean or justified.
   3. Render and self-review the contact sheets.
   4. Run the creator confirmation, then Save as Local on the task stack.
   5. Do the chat check on a test Anima.
2. Commit the six descriptions as generator examples beside the tool, with an
   example test that regenerates and checks each one. These double as
   regression fixtures and skill examples.
3. Hand off per Gesture (R7): saved item, description path, check summary,
   representative contact sheets, the chat check and known limitations. Post the
   materials on the parent issue for owner scoring. Include comparable Included
   Gestures, such as `thinking-hand-on-chin-hold` for prompt 5, as baselines.
4. Record the owner's scores and the decision.
   - **Pass:** open follow-up issues for a track-based clip format with v1
     conversion, then creator timeline editing.
   - **Fail:** record findings and stop.

   Limit skill fixes discovered here to guidance and checks within this scope.

Completion: the owner's rubric table, captures and decision are posted (R8).

#### Phase 5 evidence (agent work; owner scoring pending)

- Issue #265. Starting source `35324958`.
- **Authoring:**
  - five fresh agents each followed only the skill for one #243 prompt
    (1, 3, 4, 5, 6); prompt 2 uses the wave example authored and
    render-revised in Phase 4;
  - each agent iterated 3–9 times on checks and renders;
  - descriptions are committed in `motion-authoring/examples/`, and
    `examples.test.ts` regenerates and checks every example on both
    Avatars.

  | # | Prompt | Gesture | Kind / length | Checks | Agent self-score (naturalness / fidelity) |
  | --- | --- | --- | --- | --- | --- |
  | 1 | Nod yes twice, gently | `gentle-double-nod` | one-shot 1.7 s | pass | 3.5 / 4 |
  | 2 | Wave hello with the right hand | `wave-hello` | one-shot 2.6 s | pass | — |
  | 3 | Shrug with both palms turned up | `palms-up-shrug` | one-shot 2.0 s | pass | 3.5 / 4.5 |
  | 4 | Clap excitedly three times | `excited-triple-clap` | one-shot 2.8 s | pass, 2 WARN (upper-arm acceleration at the first clap rebound, kept as a sharp stop) | 3.5 / 4 |
  | 5 | Rest a hand on the chin and look up, thinking | `thinking-chin-rest` | loop 3.6 s | pass (2 contacts) | 3.5 / 4 |
  | 6 | Laugh hard, shoulders bouncing, leaning back | `hearty-laugh` | one-shot 3.4 s | pass | 3 / 4 |

  Agent self-scores come from still frames only and are not the rubric.
- **Creator:** each generated clip was imported through the Gesture creator
  (Clip → Import) and saved as Local content on the task stack. Stored files
  match the generated clips; differences are only quaternion normalization
  (< 1e-6) and an omitted `loop: false`.
- **Saved Local items** (task stack):
  - `wave-hello` 8b00b8a3-547f-4c81-9b1c-61557274056d
  - `gentle-double-nod` e67ca116-1d38-411f-9fd3-0f90b63cd801
  - `palms-up-shrug` 2af034a8-e8ed-4db5-894e-71663f8f94aa
  - `thinking-chin-rest` bd1e63c4-59a3-4351-b2d6-8547584dd6c9
  - `hearty-laugh` d05bc265-e980-414d-a33a-004608ee35dd
  - `excited-triple-clap` 81429d93-2c4b-4ab0-af32-12f2d650f188

  Not done by the agent: playing each one in the creator on both Avatars and
  reopening it; this is left as an owner check.
- **Chat runtime:** each saved clip played on the mounted chat Avatar
  (60 Hz `Avatar.update` driven by script, the same playback code as
  dispatch). Not exercised: the planner/equip dispatch path in a real chat,
  and cursor look-at per Gesture (shown for one clip in Phase 3). Both are
  owner checks. Sway was fully muted while
  playing and restored after; keyed `happy` peaked as authored; one-shots
  completed, and the loop held until stopped.
- **Skill and check improvements from authoring:**
  - contact failures report the bone's actual offset;
  - contact target names and offset frames are documented;
  - recipes for palms-up, hand-under-chin and hands-meeting poses;
  - guidance on longer fade-ins for held reaches, blink and eye narrowing,
    and proportion differences between the Avatars.
- **Known limits (owner review):**
  - A_1's chin fist sits nearer the jaw;
  - the nod looks slightly sleepy on A_1 at its lowest point;
  - the laugh's left arm is passive;
  - the clap's palms meet a few centimetres apart on Y_0;
  - fades are linear blends that only the creator or chat shows;
  - none was watched in real-time playback by the agents.
- **Owner gates (pending):**
  - confirm or revise the prompt set, rubric and threshold;
  - score the six on both Avatars at
    http://animama-gesture-authoring.localhost:8260 (Library → Gestures, or
    `/gestures/<id>/edit` → Clip → Play);
  - decide on follow-up format work.

## Final integration review

After Phase 5, run one full integration review of the combined branch against
R1–R8 and R6a, reusing still-valid phase evidence, with at most two repair
rounds.

#### Final Integration Review #1 Findings

Independent `sdlc-reviewer` on `d862576c`.
- **Checks:** `pnpm check`, `pnpm web:lint` and `pnpm web:test` pass (376
  files, 2,539 tests, browser scripts); the backend pytest passes (25); ruff
  and `git diff --check` are clean.
- **Code:** no defects found.
- **FI-R1-F1 (required):** the plan overstated chat and creator evidence.
  Playback was script-driven, without the planner dispatch, creator
  play/reopen or item ids.
- **FI-R1-F2 (required):** spec deviations and defaulted open questions had
  not been put to the owner.
- **Optional:**
  - the `actualOffset` claim was not round-trip tested;
  - `pnpm build` was not rerun after Phase 3;
  - the retrospective was empty.

#### Final Integration Review #1 Revisions

- **F1, accepted:** Progress and the Phase 5 evidence now say exactly what was
  done and record the saved item ids. The planner/equip real-chat check and
  per-Gesture creator play/reopen are listed as owner checks.
- **F2, accepted:** Progress lists four owner decisions (fade-scaled mutes,
  renderer pieces, Idle Style lane, description location). The spec's open
  questions record the defaults as implemented pending owner confirmation.
- **Optional, applied:**
  - a test feeds a reported `actualOffset` back and satisfies the contact
    within 5 mm;
  - `pnpm build` rerun (exit 0);
  - Outcomes & Retrospective filled.

#### Final Integration Review #2 Findings and Revisions

Targeted recheck: F1 and F2 are resolved, with no regressions. Result:
**pass**. One cosmetic note was applied: the procedural PR sentence is moved
back out of the revision list.

Then open the PR with the default template, separating local, browser,
chat and hosted evidence. Merge needs owner approval of the exact candidate.

## Validation and acceptance

- **Frontend**, from `src/frontend`: `pnpm check`, `pnpm web:lint`,
  `pnpm web:test`, `pnpm build`.
- **Backend fixture**, from the repo root: `uv run pytest -q tests/test_pose_content.py`.
  Use `uv sync --python 3.12.13` if the worktree venv selects another Python.
- **Generator and checks:** `generate` and `check` on each example description,
  both Avatars, clean or with justified findings.
- **Browser and chat** (task stack): creator mute checkboxes round-trip;
  imported clips play and survive Save/reopen; chat mutes and expression
  precedence behave as R6/R6a describe.
- **Owner:** R1 skill guidance review, R8 scoring and decision, and visual
  acceptance. Automated checks do not establish natural-looking motion.

Record exact commands and results per phase, and state any unperformed check.

## Idempotence and recovery

- The generator and checks are pure and deterministic, so rerunning them is
  safe. Renders write only to the chosen output directory.
- The schema addition is optional and additive. Removing the field restores
  current behavior, and older readers drop it.
- If headless Node loading fails, use the Chromium harness fallback (Phase 1,
  step 1). If extracting the preset module changes creator output, revert to the
  original module and wrap it instead.
- Evaluation content lives only on the task stack and as committed descriptions.
  Content can be regenerated from the descriptions, and no Included content
  changes.
- Do not stop other stacks or purge shared data. Clean up the task stack through
  the documented worktree cleanup after acceptance.

## Outcomes & Retrospective

- **Delivered:**
  - per-bone motion descriptions with anatomical joints (including fingers),
    planted-leg solving, Hands-tool presets and tolerance-driven baking into
    `animaPoseClip/1.0`;
  - motion checks on both Included Avatars;
  - review renders;
  - per-Gesture live-layer muting with a creator control;
  - Gesture expression precedence;
  - creator preservation of unknown clip fields;
  - the `animama-animation` skill;
  - six evaluation Gestures, written by fresh agents following only the skill
    (the wave by the implementing agent), all checked, saved through the
    creator and played on the chat runtime.
- **Lessons:**
  - Rendered review caught problems the checks could not. Forearms swung out
    on returns, arms swept through a T-pose, and the arm's rotation decided
    where a bent forearm pointed. Agents needed 3–9 iterations per Gesture,
    mostly driven by renders.
  - Contact authoring improved once the checks reported actual offsets, and
    Avatar proportion differences limit exact touches.
- **Remaining:** the owner decisions and checks above, then the R8
  follow-up decision (track-based clip format, creator timeline).
