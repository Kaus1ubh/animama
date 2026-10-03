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
- [ ] Phase 1: Motion description, anatomy and baking.
- [ ] Phase 2: Automated motion checks.
- [ ] Phase 3: Gesture layer mutes and expression precedence.
- [ ] Phase 4: Review renders and the `animama-animation` skill.
- [ ] Phase 5: Evaluation on #243 prompts 1–6 (owner scoring gate).
- [ ] Final integration review; PR; owner acceptance.

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
- Hands-preset thumb fitting depends on the live normalized pose of the
  metacarpal's parent chain. The generator must fit with the arm/hand context it
  bakes, on a fixed reference Avatar.

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

## Final integration review

After Phase 5, run one full integration review of the combined branch against
R1–R8 and R6a, reusing still-valid phase evidence, with at most two repair
rounds. Then open the PR with the default template, separating local, browser,
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

Not started.
