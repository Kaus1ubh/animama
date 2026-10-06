# Deliver track-based Anima Pose Clips, the motion preview tool and the first generated animation set

Source agreement: [track-based-pose-clips-spec.md](track-based-pose-clips-spec.md)
(agreed draft). The owner's dated task instruction of 2026-10-06 asked for the
spec, this plan and implementation to proceed, deferring the open questions to
the agent's prototype-confirmed recommendations.
Authorized scope: all phases (1–7), authorized by the owner on 2026-10-06.
Starting revision: `10216cd36251b8e011557250f3c4951e8bd39a69` (`origin/main`,
which contains #267's merge `b9a1e588`).
Branch: the task worktree's generated branch was renamed to
`feat/track-based-pose-clips`. One branch and one PR for this plan. Parent #282.
Phase issues are recorded under [Progress](#progress) once created.

## Purpose and context

Replace baked `animaPoseClip/1.0` Gestures with a compact, beat-organised
`animaPoseClip/2.0` that agents author directly and humans edit by beats. The
plan delivers:

- a live preview tool with review notes (first);
- the format, its runtime and backend acceptance;
- authoring tools and the skill;
- creator editing;
- three batches of new content.

The spec owns behavior and acceptance (R1–R11); this plan owns delivery.

Commands run from the repository root unless a working directory is stated.
Frontend commands run from `src/frontend` or `src/frontend/web` as noted. No
Cloud checkout is needed.

### Implementation orientation

Paths are relative to `src/frontend/web/src/` unless stated. Line numbers are
from the starting revision and drift as work proceeds.

| Area | Current entry point and significance |
| --- | --- |
| 1.0 schema | `lib/avatar/poses/animaPoseClip/schema.ts`. `ANIMA_POSE_CLIP_SCHEMA` (:19), `MAX_ANIMA_POSE_CLIP_BYTES` (:25), `ANIMA_POSE_CLIP_DECIMALS`, `serializeAnimaPoseClipFile` (:64), `KNOWN_CLIP_FIELDS` with unknown-field preservation, and `sanitizeAnimaPoseClip`, which rejects any other schema (:416). |
| 1.0 sampling | `sampling.ts` and `interpolation.ts`: whole-pose segments; the destination keyframe's easing; slerp; a missing bone on one side is held. `sampleAnimaPoseClip` re-parses the clip on each call, and `PoseController.update` reaches about 5–7 full parses per frame. |
| Playback | `lib/avatar/poses/PoseController.ts`: `playAnimaPoseClip` (:354), `update` (:440), `_applyClipSampleAtTime` (:778), fades (:819–890), events (:547–664) and `getClipExpressionNames` (:1311). The sample is canonical, converted for VRM 0 (`poseRetargeting.ts:70–116`), then written with `setNormalizedPose`. |
| Avatar frame | `lib/avatar/Avatar.ts` `update` (:664–732): the clip, then mutes and expression precedence (:690), then procedural layers, then the Reaction player, expressions, spring bones and `vrm.update`. Sway (hips x, rotation), bounce (hips y, feet) and emotion posture (hips pitch) move the hips after the clip. |
| Standalone Avatar | `new Avatar(camera, viewport?, {motionCatalog?})` defaults to `BUILT_IN_AVATAR_MOTION_CATALOG` and needs no runtime catalog (precedent: `ui/create/CreateAnimaAvatarPreviewScene.tsx:105–163`). It needs Vite (`import.meta.glob`), the `@`/`@web` aliases and the `__ANIMAMA_*` defines. |
| Runtime loading | `lib/runtime-content/AnimaRuntimeCatalog.ts`: `addPoseClip` (:820), `fetchClip` (:977, a bounded read then `parseAnimaPoseClip`) and `normalizeLoadedClip` (:1022). Built-in clips come from `lib/avatar/poses/catalog.ts` (eager glob of `json/clips/**`, byte-identical to `content/included`). Reactions: `lib/avatar/reaction/ReactionClipPlayer.ts`. Planner Gesture duration: `planner/AvatarPlanner.ts:1895–1931`. |
| Authoring | `lib/avatar/motion-authoring/`: `anatomy.ts` (joint model; several joints have only 2 or 1 components), `curves.ts` (`ScalarTrack`, Fritsch–Butland, leaving-key interpolation), `legs.ts` (VRM 1 only), `hands.ts`, `description.ts` (`animamaMotion/1`), `bake.ts`, `checks.ts`, `cli.ts` and `examples/`. CLI wrappers: `web/scripts/animation.mjs` (Vite SSR) and `web/scripts/animation-render.mjs` (Vite plus headless Playwright; the page `scripts/animation-render/render.ts` uses the loader and sampler, not `Avatar`). |
| Hands tool | `ui/pose-creator/poseCreatorHandAuthoring.ts`: `HAND_PRESETS`, `resolveHandBones`, `adjustHandQuaternion`, `handPresetQuaternion` and the private `fitThumbPreset`. It imports `getPoseCreatorNormalizedBoneNode` from `poseCreatorAuthoring.ts`, which pulls in the `@/lib/avatar` barrel and the zustand store, so `lib/` cannot import it without inverting layers. |
| Creator draft | `ui/pose-creator/poseCreatorClipAuthoring.ts`: `PoseCreatorClipDraft` (:86), hydrate (:375), build (:285), `extraFields` (R6b) and validation (:515). The source of truth is `ActionDocument.sequence` (`ui/action-editor/ActionEditorPage.tsx`, synced by `ActionTimelineDocumentSync` in `ActionTimelineEditor.tsx:91–270`). Keyframe ids are regenerated on hydrate and never saved. |
| Creator store | `stores/pose-creator-store.ts`: `moveClipKeyframe` (:2472, re-sorts so keyframes may pass), `deleteSelectedClipKeyframe` (:2546), `updateSelectedClipKeyframe` (:2410), `insertClipPoseAtTime` (:963), `captureClipPoseAtPlayhead` (:2307), `commitClipInlinePoseEdit` (:2239), `addPoseToClip` (:2324), `setClipBaseEndpoint` (:2822) and `setClipExpressionsAtTime` (:1010, Reactions). |
| Creator UI | `ui/pose-creator/PoseCreatorClipTimeline.tsx` (`KeyframeMarker` :750, `formatTimelinePoseLabel` :971, geometry in `ui/content-creator/creatorTimelineGeometry.ts`); `PoseCreatorClipWorkspaceInspector.tsx` (`KeyframeInspector` :457 with Time, Pose and Easing; Clip settings :145); the Pose tab in `ui/action-editor/ActionEditorWorkspace.tsx:344–423`. The creator preview samples with `sampleAnimaPoseClip` and `avatar.applyAnimaPose` (`poseCreatorClipPreview.ts`), not `PoseController`. |
| Save and import | Save size gate: `query/mutations/useActionEditorActions.ts:174–182`. Import: `ActionEditorHeader.tsx:887–1099` through `parseActionImport` (`actionProject.ts:141`). Reaction sanitising: `actionDocument.ts:165–226`. Hard-coded 1.0 literals: `actionPersistence.ts:35`, `actionDocument.ts:91`, `pose-creator-store.ts:2353`, `lib/content-preview/posePreviewTarget.ts:37` and `ActionEditorHeader.tsx:945,993,1143`. Selector ID (`semanticKey`) is editable and carried by the project envelope. |
| Backend | `src/backend/animama/app/services/`: `idle_clip_validation.py` (mirrors the TS timeline rules), `idle_playback.py:82` (requires 1.0; Idle Styles and `GET /v1/gestures/{id}/idle-playback`), `content_package_capabilities.py` (`SUPPORTED_CAPABILITIES` :50, `_clip` :512), and `content_kind_registry.py:773–860` (the retired `POSE_CLIP` kind; leave it at 1.0). Local Save stores clip bytes without validation. Tests: `tests/test_content_package_capabilities.py` (:42–45 asserts 2.0 is unavailable), `tests/test_idle_playback.py` with the shared `tests/fixtures/idle-playback-cases.json`. |
| Content | `content/included/gestures/<id>/<id>.json` (22 Gestures, all 1.0, mostly `{ref}` poses resolved from `lib/avatar/poses/json/internal-poses/`) and `content/included/reactions/` (72 Reactions, each one expression-only `peak` keyframe with `role` and `playback`). Licence rules: `content/included/licenses/inventory.json`. |
| Stacks | `./reset.sh --name <n> --base-port <p>` writes `.animama-stack.env`. Local content for a named stack is `.animama-stacks/<project>/content/local`. Development mode serves Vite on the app port. The main checkout's stack runs `main` on :3000 and cannot load 2.0 until merge. |

### Prototype (2026-10-06, planning)

Throwaway prototype code (not committed) annotated the six #260 descriptions
with named beats and measured:

- **Round trip and size:**
  - all six round-trip to identical absolute keys;
  - 2.0 sizes are 1.1–7.8% of the 1.0 bakes (wave 2.8/152.3 KB, nod
    2.8/35.9 KB, laugh 12.3/718.6 KB, clap 12.0/318.8 KB, shrug
    5.7/251.7 KB, chin rest 3.3/305.1 KB).
- **Retime:**
  - rigid beat blocks with elastic neighbours keep every track ordered and the
    moved beat's internal timing intact (the moved beat's motion drifts
    2.1–23.7° in total, mostly from the stretched approach);
  - a proportional warp drifted 2.2–33.1°;
  - a beat with wide detail clamps early, for example the laugh's burst
    stopped at 0.49 s when asked for 0.45 s.
- **Converting the 22 Included Gestures to anatomical tracks:**
  - keyframe residuals of up to 138° with the current 2- and 1-component
    joints, and 0° with full 3-axis decomposition;
  - component interpolation still deviates up to 22° from slerp (soldier
    salute, face palm).

  Hence rotation tracks for converted and hand-made content.
- **Legs:** a solver whose rig offsets are converted to the canonical basis
  held feet at 0.0 mm on Y_0, against up to 3.9 mm when solved on the VRM 1
  reference.

The spec's decision section records the conclusions. Recreate the
measurements from the committed tests in Phases 2 and 4, not from the
prototype.

## Progress

- [x] Owner requests recorded on #282 (2026-10-06,
      [comment](https://github.com/raymond-van/animama/issues/282#issuecomment-6021714609)).
- [x] Repository surveyed; beat-model prototype run; spec and plan drafted.
- [ ] Workspace: spec published to #282 and read back; phase issues created;
      task stack started.
- [ ] Phase 1: Interactive motion preview tool (1.0).
- [ ] Phase 2: `animaPoseClip/2.0` format, sampler and 1.0 conversion.
- [ ] Phase 3: Runtime and backend acceptance of 2.0.
- [ ] Phase 4: Authoring tools, migrated examples and skill. Gate G1.
- [ ] Phase 5: Creator editing of 2.0. Gate G2.
- [ ] Phase 6: Wave 1 content. Gates G3 and G4.
- [ ] Phase 7: Replacements and wave 2. Gate G3.
- [ ] Final integration review and PR.

## Surprises & Discoveries

- The `animama-animation` skill says no package build is needed, but
  `pnpm -s animation base` fails in a fresh worktree until
  `pnpm packages:build` runs: `catalog.ts` imports `lib/emotion`, which imports
  `@animama/product-ui`. Fix the skill text in Phase 4.
- A #267 plan note says `Avatar` needs a prepared runtime catalog. It does not:
  the built-in motion catalog is the default.
- Hand-made 1.0 poses bend joints about non-anatomical axes (for example the
  lower arm about its own z axis), so the anatomical model cannot carry them
  without auxiliary components and slerp. See the prototype.
- `tests/test_content_package_capabilities.py:42–45` asserts that
  `animaPoseClip/2.0` is unavailable, and must change.
- The creator's Pose-alias select re-points a keyframe to a shared pose. 2.0
  beats own their poses, so this control needs a 2.0 meaning (Phase 5).

## Decision Log

- 2026-10-05, owner (#282): beats on the existing Pose lane; generated detail
  owned by beats; one format for new saves; Included 1.0 untouched; ~20 s
  support; natural-timing stagger deferred.
- 2026-10-06, owner: preview tool first; replacements and the generated set in
  scope; promotion separate; static signs lower priority; open questions
  deferred to the agent's recommendations.
- 2026-10-06, planning (agent, under deferral, prototype evidence): explicit
  named beats with `dt` offsets and absolute values; rigid-block retime; rotation
  tracks for converted and hand-made content; auxiliary components; runtime hand
  presets and per-Avatar legs; arriving-key `ease`; `animamaMotion/1` retired;
  preview through the real `Avatar` reading Library items from disk.
- 2026-10-06, planning (implementation choices, revisable within scope):
  - **Code layout:** the shared runtime modules (anatomy, curves, leg solver,
    hand presets, the 2.0 schema and sampler) live under
    `lib/avatar/poses/animaPoseClip/` or `lib/avatar/poses/anatomy/`.
    `motion-authoring/` keeps the tooling (validation CLI, checks, preview
    sources and review notes).
  - **Preview seek:** add a small `PoseController` seek, exposed through
    `Avatar`, rather than replaying from 0 on every scrub. If seeking cannot
    reproduce fade and mute state faithfully, fall back to fixed-step replay and
    record the reason.
  - **Authored sources:** authored 2.0 sources are tracked under
    `motion-authoring/examples/` (the #267 default). Before merge, Local saves
    go to the task stack, because the main stack cannot load 2.0. Importing
    them into the owner's main Local library after merge is an owner step.
  - **Before screenshots:** captured at the start of Phase 5 from the Phase 4
    head, which does not yet change the creator UI.

## Preparation (workspace setup)

1. Recheck the root and frontend `AGENTS.md`, branch
   `feat/track-based-pose-clips`, HEAD and dirty state. Preserve the spec and
   plan. Keep the throwaway prototype out of commits; delete it before the first
   phase commit.
2. `workspace-setup`:
   - publish the spec to #282, keeping its existing discussion, and read it
     back;
   - record the snapshot time in the spec;
   - create one issue per phase (1–7), linked to #282;
   - record their numbers here.
3. From `src/frontend`, run `pnpm install --frozen-lockfile` and
   `pnpm packages:build`. Run `git lfs pull` (for the Included Avatars). Confirm
   the Playwright Chromium install that `scripts/*.browser.test.mjs` uses.
4. Start a named task stack when Phase 1 needs Local Library items, and again
   for Phases 5–7:
   `./reset.sh --name track-clips --base-port 8240` (check the port is free
   first). Record the URL. Use test Animas and content only.
5. Use behavior-focused red/green tests (`tdd`). Run focused tests from
   `src/frontend/web` with `pnpm exec vitest run <paths>`.

## Phased implementation

Each phase starts after its predecessor's checks and bounded review pass,
except where noted. Record per phase:

- the starting SHA and issue;
- commits (`feat(animation)[p#]: …` or another fitting scope);
- commands and results;
- review records (`Code Review #N Findings/Revisions`, using `sdlc-reviewer`;
  one full review and at most two repair rounds);
- remaining gates.

### Phase 1 — Interactive motion preview tool (R1)

Requirement: R1, on 1.0 clips and `animamaMotion/1` descriptions; 2.0 support
arrives in Phase 3. Dependency: preparation.

1. **Seek.** Add `PoseController.seekClip(timeSec)` and an `Avatar`
   passthrough. Seeking sets the elapsed time and phase (fade-in complete after
   its duration), applies the sample, dispatches no events, and leaves mutes and
   expression precedence consistent on the next `Avatar.update(0)`. Unit-test
   the fade, loop and mute presence at sought times.
2. **Sources** (`lib/avatar/motion-authoring/preview/sources.ts`, Node-side):
   - Resolve a path or `library:<name|selector|id>` to `{kind, label, clip,
     markers, watchPaths}`.
   - Clip files: parsed with the 1.0 parser (2.0 later).
   - Descriptions: validated and generated in memory with today's generator.
   - Library items: found by folder, `semantic_key` or `name` in
     `content/included/{gestures,reactions}` and in the Local content directory
     from `--local-content <dir>` or the sourced `.animama-stack.env`
     (`ANIMAMA_LOCAL_CONTENT_HOST_PATH`). Library items are read-only.
   - Errors name the source and the reason.
3. **Review notes** (`preview/reviewNotes.ts`):
   - Sidecar `animamaReview/1`:
     `{schema, source, notes[], versions[]}`.
   - Note fields: `{id, createdAt, time, beat?, region?, text, version,
     status, resolution?, resolvedVersion?}`.
   - Retained versions go in a sibling `<name>.review/<versionId>.json`; the
     version id is a content hash.
   - Writes are atomic (temp file then rename) and validated. A malformed
     sidecar is reported, never overwritten.
   - Test: add, resolve, version retention, Library-item sidecar placement and
     malformed input.
4. **Server** (`web/scripts/animation-preview.mjs`):
   - A programmatic Vite server bound to `127.0.0.1` (pattern of
     `animation-render.mjs`).
   - `fs.allow` limited to the web root, the Included Avatars and the source
     directories.
   - A small middleware API: state (`GET`), notes (`POST`), and a reload event
     stream (SSE).
   - `fs.watch` on sources and the sidecar. It opens the system browser
     (`open`, `xdg-open` or `start`) unless `--no-open`.
   - Usage: `pnpm -s animation:preview <source> [--compare <source>]
     [--notes <file>] [--local-content <dir>] [--port <n>] [--no-open]`.
   - Add the `animation:preview` script to `web/package.json`.
5. **Page** (`web/scripts/animation-preview/`: `index.html`, `preview.ts`,
   `preview.css`; vanilla TypeScript, no app providers):
   - one view per Avatar per source row, each with a real `Avatar`
     (`avatar.load`, `playAnimaPoseClip`, `update(dt × speed)`);
   - transport, speed 0.25–1×, loop, scrubber with markers and labels, and
     frame stepping;
   - camera presets from bone positions;
   - live-layer toggle;
   - notes panel (add at playhead or beat, region, list, seek on select,
     resolved state);
   - "compare with previous version";
   - visible validation errors.

   Keep the page usable at desktop size first.
6. **Tests:**
   - vitest for sources, review notes and seek;
   - a browser smoke test `scripts/animation-preview.browser.test.mjs` (headless
     Chromium): the page reaches ready with two Avatars; a note posted through
     the API lands in the sidecar; a source edit triggers reload.
7. **Docs:** add the preview workflow to the skill's
   `references/checks-and-review.md` and its usage to the skill.

Checks:

- `pnpm exec vitest run` for the new tests;
- `node --test scripts/animation-preview.browser.test.mjs`;
- from `src/frontend`: `pnpm check`, `pnpm web:lint` and
  `pnpm prettier:check`.

Manual: run the tool on the hearty-laugh description, an Included Gesture
(`library:cat-monster-rawr`) and compare mode, in the system browser. Capture
screenshots.

Completion: all R1 behaviors work on 1.0 sources; review passes.

### Phase 2 — `animaPoseClip/2.0` format, sampler and conversion (R2, R7, R11 ADR and glossary)

Dependency: Phase 1 (for review tooling only; the code is independent).

1. **Shared modules out of the authoring and UI layers:**
   - move `anatomy.ts`, `curves.ts` and the leg solver into the poses layer;
   - extract Hands preset resolution (`HAND_PRESETS`, `handPresetQuaternion`,
     `fitThumbPreset`, `adjustHandQuaternion`, `resolveHandBones`) into a
     dependency-light `lib` module taking `{ vrm }`;
   - the creator's Hands tool, `motion-authoring` and tests import it;
   - move `actionClipId` (or an equivalent naming helper) into `lib`;
   - add a regression test that the Hands tool's output is unchanged on both
     Avatars.
2. **Joint model:**
   - add auxiliary components (flagged as such) so every joint has three
     rotation axes;
   - `decomposeJointRotation` gains an unwrapping variant that picks the Euler
     branch nearest to given values;
   - test exact round trips of arbitrary rotations away from singularities;
   - anatomical ranges for auxiliary components are tight soft and hard limits
     used only by the checks.
3. **Leg solver:** generalise to VRM 0 by converting normalized rig offsets to
   the canonical basis. Test ankles and feet within the check tolerances on
   both Avatars for hip lean, shift and crouch.
4. **Schema** (`animaPoseClip/2.0` types, `sanitize`/`parse`, serializer):
   - fields as in R2; bounded counts (start with ≤ 1,000 beats, ≤ 400 tracks
     and ≤ 50,000 keys; revise with evidence);
   - JSON-path issues;
   - unknown top-level fields preserved;
   - compact serialization rounding (`q` and transforms at 5 decimals, `dt`
     and `time` at 4, weights at 3);
   - `MAX_ANIMA_POSE_CLIP_BYTES` shared.

   Tests cover each structural rejection named in R2.
5. **Compile and sample:**
   - `prepareAnimaPoseClipV2(clip, vrm)` builds absolute-time tracks once:
     resolves `"base"` from the base pose, hand presets on this Avatar, and
     plants legs on this Avatar;
   - `sample(t)` returns a canonical `AnimaPoseClipSample`;
   - arriving-key `ease` semantics: `smooth` Hermite (Fritsch–Butland slopes,
     `flat` tangents), `linear`, `hold`, the 1.0 easings, and slerp with easing
     for rotation tracks;
   - loops wrap;
   - finger tracks override hand shapes;
   - time lookup by binary search, with no per-frame allocation of track
     structures.

   Tests: interpolation per ease, hold, loops, beat offsets, base resolution,
   override order and VRM 0/1 parity. Add a micro-benchmark script recording
   per-frame cost against the 1.0 bake of the same motion (evidence, not a CI
   assertion).
6. **Conversion** (`convertAnimaPoseClipV1ToV2(clip, resolvePose)`), per R7:
   - beat ids and labels from pose names (unique);
   - rotation tracks keyed at every beat for every bone in the resolved poses;
   - expressions with explicit zeros, hips position;
   - easing and interpolation (`nlerp` → slerp, `step` → `hold`);
   - fades, mutes, events, playback, role and unknown fields kept.

   Test every Included Gesture and Reaction against 1.0 sampling at 120 Hz
   within 0.01° and 0.1 mm.
7. **Docs:** ADR `docs/adr/0014-track-based-anima-pose-clips.md` (and its index
   entry); glossary entries for Gesture, Beat and generated detail.

Checks: the focused vitest suites, `pnpm check`, `pnpm web:lint` and
`pnpm prettier:check`.

Completion: the library can parse, validate, play (sample) and convert 2.0 on
both Avatars headlessly; review passes.

### Phase 3 — Runtime and backend acceptance (R3, R6)

Dependency: Phase 2.

1. **Clip programs:**
   - introduce a prepared-clip abstraction used by `PoseController` and
     `ReactionClipPlayer`: sample, timeline duration, loop, fades, events,
     expression names and playback lifetime;
   - 1.0 clips wrap the existing sampler, parsed once at play instead of per
     frame, with behavior unchanged and tests kept green;
   - 2.0 clips use Phase 2's preparation per Avatar;
   - the prepared program is cached per Avatar and clip.
2. **Accepting 2.0** wherever runtime clips are parsed or loaded:
   - `AnimaRuntimeCatalog` (`fetchClip`, `normalizeLoadedClip`);
   - the built-in catalog types;
   - the planner Gesture duration;
   - Idle Style clip playback;
   - content preview;
   - debug panels and `lib/avatar/index.ts` exports.

   An invalid 2.0 clip is skipped with a diagnostic.
3. **Behavior tests on 2.0:** fade in and out, interruption and restore, mutes
   (including idle-lane playback), expression precedence, blink and lip-sync
   rules, events and loops, Reactions with events, and Idle Style finite
   playback.
4. **Backend:**
   - a 2.0 timeline validator mirroring the frontend structure (beats, key
     ownership and windows, ordering, joint, component and bone names, value
     types, bounds);
   - `idle_playback.py` accepts 2.0;
   - `content_package_capabilities.py` adds the `animaPoseClip/2.0` capability,
     `_clip` validation and requirements (the base pose built-in ref only);
   - the retired `POSE_CLIP` kind stays 1.0;
   - a shared fixture `animaPoseClip/fixtures/compatibility-valid-v2.json`
     used by the frontend and backend tests;
   - add v2 cases to `tests/fixtures/idle-playback-cases.json`;
   - update `test_content_package_capabilities.py`;
   - a package export/import round trip of a 2.0 Gesture.

   No API schema change is expected; if one occurs, regenerate the client
   offline.
5. **Tooling:**
   - `animation:render` and the preview tool accept 2.0 clips, with beat
     markers and labels;
   - the review notes' beat references use beat ids.
6. **Docs:** `docs/frontend/runtime/avatar-animation.md` (format, playback,
   limits, 1.0 compatibility) and the backend content docs where they name the
   clip schema.

Checks:

- from `src/frontend`: `pnpm check`, `pnpm web:lint`, `pnpm web:test` and
  `pnpm build`;
- from the repository root: `uv run pytest -q` on the affected tests
  (`tests/test_content_package_capabilities.py`, `tests/test_idle_playback.py`,
  package and transition tests), then the full suite if time allows;
- `uv run ruff check`.

Manual: a 2.0 Gesture plays in a chat on the task stack (load through import
and Save once Phase 5 lands; until then, a Local item placed by the creator's
1.0 path cannot carry 2.0, so use the preview tool and tests).

### Phase 4 — Authoring tools, migrated examples and skill (R4)

Dependency: Phase 3.

1. **CLI:**
   - `pnpm -s animation validate <clip> [--out <compact.json>]` validates 2.0,
     including anatomical hard limits, beat windows, contacts and the saved
     size; it writes nothing on failure;
   - `check` accepts 2.0 and 1.0 clips, with contacts and `plantFeet` read from
     the clip and beat-relative contact windows;
   - `joints` lists auxiliary components separately;
   - `base` is unchanged;
   - remove `generate`, `description.ts` and `bake.ts` after migration.
2. **Migrate the six examples:**
   - convert them to `examples/<name>.clip.json` using the beats chosen in the
     prototype;
   - a one-off migration test (removed with the old modules) proves identical
     curves;
   - before deleting the bake, generate 1.0 bakes of the six into scratch for
     comparison.
3. **Checks on both Avatars for all six:** fix or explain any regressions. The
   per-Avatar legs should remove Y_0 foot drift.
4. **Size table:** 2.0 compact size against the 1.0 bake, for each example.
5. **Skill:**
   - update `SKILL.md`, `references/description-format.md` (renamed for the
     clip format), `checks-and-review.md`, `motion-principles.md` (beats) and
     `hands-and-face.md`;
   - fix the package-build note;
   - add tiers and semantic keys;
   - add the creator import and Save steps with the Selector ID.
6. **Gate G1 (owner):**
   - the owner previews each migrated example next to its 1.0 bake
     (`--compare`) and confirms they look the same;
   - record the outcome;
   - Phases 5–7 may proceed while the gate is pending.

Checks: `pnpm exec vitest run src/lib/avatar/motion-authoring`; the CLI on all
examples; `pnpm check`, `pnpm web:lint` and `pnpm web:test`.

### Phase 5 — Creator editing of 2.0 (R5)

Dependency: Phase 3 (runtime); Phase 4 for generated test content.

1. **Before screenshots** from the Phase 4 head on the task stack:
   - Pose tab and Clip tab of a 1.0 Gesture (an Included copy), a generated
     Gesture (hearty laugh, imported as 1.0), and a Reaction;
   - at 1440×900 and at a narrow width (390×844);
   - stored outside the repository; summarised in this plan.
2. **Beat editing operations** (pure, tested), over a 2.0 draft:
   - `retimeBeat`: rigid block with elastic neighbours, clamped where detail
     meets a neighbour; beats without detail may pass beats without detail;
   - `deleteBeat`;
   - `setBeatEase` and `setBeatLabel`;
   - `beatKeyPose`: anchors, with sampled values for components the beat does
     not key;
   - `setBeatPose`, which per changed bone does one of:
     - shift the beat's anatomical keys by the unwrapped component delta,
       adding anchors where the beat has none;
     - set the beat's rotation key;
     - create a rotation track keyed at every beat;
   - `insertBeat` (captured or Library pose; no detail);
   - `flattenHandToFingerTracks`;
   - Reaction expression beats.
3. **Draft and store:**
   - the creator draft holds the 2.0 clip as its source;
   - keyframes and poses become a derived view: keyframe id = beat id;
     label; `hasDetail`; detail summary;
   - re-point the existing store actions (move, delete, update,
     insert-at-time, capture, commit inline edit, add pose, base endpoints,
     Reaction expressions) to the operations;
   - hydrate converts 1.0 (R7) and preserves unknown fields;
   - build emits 2.0, through the `actionPersistence`, `actionDocument`, store
     and preview-target literal sites;
   - the creator preview samples 2.0 with the creator Avatar.
4. **UI**, within the existing layout:
   - timeline labels from beat labels;
   - a subtle detail marker on the diamond;
   - an inspector read-only detail note;
   - the inspector's Pose-alias select becomes the beat label field, in the
     same row and style;
   - keep geometry, sizes and styling.
5. **Import, export and Save:** Import accepts 1.0 and 2.0 clips and
   envelopes; Export and Save write 2.0; the 2 MiB gate is unchanged; Reactions
   are sanitised for 2.0.
6. **Tests:**
   - pure operation tests (ordering, rigid detail, clamp, pass-through,
     re-target, hand flattening, delete, easing, key pose);
   - updated store, ActionTimelineEditor and Inspector tests;
   - the R6b field tests on 2.0;
   - a Playwright journey `creator-generated-gesture-round-trip.spec.ts`
     (import 2.0, retime and edit a beat, save, reopen, detail intact, 1.0
     open-then-save, Reaction save and reopen).
7. **After screenshots** matching step 1, compared side by side and
   summarised. **Gate G2:** the owner reviews the pairs.
8. **Docs:** creator documentation (Gesture and Reaction creator pages under
   `docs/frontend/`) for beats and detail.

Checks: the focused vitest suites; `pnpm check`, `pnpm web:lint`,
`pnpm web:test` and `pnpm build`; the Playwright journey against the task
stack.

### Phase 6 — Wave 1 content (R8)

Dependency: Phases 4–5.

1. Author `laugh_mild`, `laugh_medium` (the hearty laugh re-authored with an
   active left arm) and `laugh_hysterical` (5–6 s: burst, double over with a
   hand on the stomach, two or three thigh slaps with contacts, rise, wipe a
   tear, recover, settle).
2. Author the 20 s storytelling sequence: thinking, "idea!" with a finger up,
   explaining with both hands, a shrug, then a laugh, with named beats per
   movement.
3. Revisit the #267 weaknesses where they apply (chin fist on A_1, nod energy
   on A_1, clap contact on Y_0), as small revisions of the migrated examples.
4. For each item:
   1. `validate` and `check` on both Avatars;
   2. self-review in the preview tool;
   3. hand over to the owner;
   4. apply and resolve notes;
   5. import and Save as Local content in the task stack, with its Selector
      ID;
   6. reopen it.
5. **Chat check:** play the 20 s sequence and the laughs on a test Anima in a
   chat on the task stack with mutes active. Record it.
6. **Gates:** G3 (owner review in the preview tool, notes resolved) for each
   item; G4 (the chat check, agent-run, owner may confirm).

### Phase 7 — Replacements and wave 2 (R9, R10)

Dependency: Phase 6's process. Runs item by item.

1. Replacements for right-face-palm, thinking-head-scratch, arms-crossed,
   cheeky-finger-guns, hands-on-hips and cat-monster-rawr. Each is previewed
   with `--compare library:<original>` and keeps the original's kind (loops stay
   loops).
2. Wave 2: surprise gasp, gentle head-shake "no", enthusiastic yes, shy giggle,
   deflated sigh, pout or huff, celebration, blow a kiss, small shy wave, polite
   bow and attentive listening lean-in.
3. The same per-item loop and gate G3 as Phase 6. No change to
   `content/included/`. Promotion is recorded as a follow-up issue with its
   licence inventory step.

## Final integration review

After Phase 7 (or the last completed phase), run one full `sdlc-reviewer` pass
over the combined diff against R1–R11 (with at most two repair rounds). Reuse
still-valid phase evidence. Then run the full frontend and affected backend
checks, open the PR using the template, and record the outstanding owner gates.

## Validation and acceptance

- Per-phase checks as listed. Before pushing a CI-triggering candidate, run the
  [local checks before pushing](../../backend/operations/development.md#local-validation-before-pushing).
- Evidence to record:
  - the size table (Phase 4);
  - the conversion tolerance results (Phase 2);
  - the sampling benchmark (Phase 2);
  - check summaries per content item (Phases 4, 6 and 7);
  - before and after screenshots (Phase 5);
  - preview walkthrough screenshots (Phase 1);
  - the chat check (Phase 6).
- Owner gates:
  - **G1:** migrated six look the same.
  - **G2:** UI screenshot pairs.
  - **G3:** per-item content review in the preview tool.
  - **G4:** chat check.
  - **Merge approval** is separate. Promotion to Included is separate.
- Cleanup awaiting owner agreement: the four leftover
  `animama-gesture-authoring_*` Docker volumes from #267.

## Idempotence and recovery

- **Code:** phases commit separately, and each can be reverted on the branch.
  The 1.0 path stays intact throughout, so playback of existing content never
  depends on 2.0 code.
- **Content:** authored sources are tracked files; Local saves go to the task
  stack's content directory and can be deleted or re-saved. Included content is
  never modified.
- **Preview tool:** sidecars and retained versions are plain files beside the
  sources or in the working directory. A malformed sidecar is reported, never
  overwritten.
- **Stack:** the task stack is isolated (`animama-track-clips`). Stop only it,
  through project-scoped Compose commands. Keep its data until the owner has
  imported anything they want.

## Outcomes & Retrospective

To be completed at the end of the work.
