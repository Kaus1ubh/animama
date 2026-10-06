# Deliver track-based Anima Pose Clips, the motion preview tool and the first generated animation set

Source agreement: [track-based-pose-clips-spec.md](track-based-pose-clips-spec.md)
(agreed draft). The owner's dated task instruction of 2026-10-06 asked for the
spec, this plan and implementation to proceed, deferring the open questions to
the agent's prototype-confirmed recommendations.
Authorized scope: all phases (1–7), authorized by the owner on 2026-10-06.
Starting revision: `10216cd36251b8e011557250f3c4951e8bd39a69` (`origin/main`,
which contains #267's merge `b9a1e588`).
Branch: the task worktree's generated branch was renamed to
`feat/track-based-pose-clips`. One branch and one PR for this plan. Parent #282;
phases #289 (P1), #292 (P2), #290 (P3), #293 (P4), #294 (P5), #295 (P6) and
#291 (P7).

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
- [x] Workspace: spec published to #282 and read back (2026-10-06T17:51:22Z);
      phase issues #289, #292, #290, #293, #294, #295 and #291 created as
      sub-issues with dependencies; branch pushed. Task stack: started when a
      phase first needs it.
- [x] Phase 1: Interactive motion preview tool (1.0). Review #2 passed;
      commit recorded in the Phase 1 record.
- [x] Phase 2: `animaPoseClip/2.0` format, sampler and 1.0 conversion.
      Review #2 passed.
- [x] Phase 3: Runtime and backend acceptance of 2.0. Review #3 passed
      (both repair rounds used).
- [x] Phase 4: Authoring tools, migrated examples and skill. Review #2
      passed. Gate G1 (owner) pending.
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
- The 1.0 sampler re-parses the whole clip on every call. Sampling the
  hearty laugh's 1.0 bake (247 keyframes) costs 12.7 ms per frame on the
  development machine; `PoseController` samples several times per frame. Its
  2.0 form costs 0.014 ms per frame after a 0.7 ms preparation (the clap: 5.9
  against 0.012 ms). Generated 1.0 Gestures are therefore expensive in chat
  today.
- Importing the 2.0 schema from the clip index created a cycle (hand presets →
  pose catalog → clip index → schema → hand presets). Preset ids now live in a
  dependency-free `handPresetIds.ts`, and the heavier 2.0 modules are imported
  by path rather than through the index.
- The Phase 1 commit is `04498690`.
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
- 2026-10-06, Phase 3 (agent): clips are prepared when they start playing,
  not once per Avatar when they load (spec R3). Preparation takes 0.5–0.7 ms
  and does not depend on the Avatar's current pose (the Phase 3 review
  measured no difference on either Avatar), so a per-load cache would add
  invalidation without benefit.
- 2026-10-06, Phase 3 (agent): 2.0 clips are limited to 3,600 s, so every
  time stays finite and the backend's decimal rounding cannot overflow. Value
  bounds and the limit are part of the shared vocabulary fixture.

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
   - Retained versions go in a sibling folder named after the sidecar without
     `.json`, one `<version>.txt` of source text each; the version id is a
     content hash.
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

#### Phase 1 record

Starting source: `15101453`. Issue #289.

#### Code Review #1 Findings

`sdlc-reviewer`, full review of the uncommitted Phase 1 working tree against
`15101453`. Its checks: focused vitest (97 tests), `check:source`, ESLint and
Prettier on the changed files, and the preview browser test, all passing.
Scratch probes reproduced P1-F1 and P1-F3.

- **P1-F1 (blocking):** review notes and resolutions could be lost.
  - Note edits and version retention wrote whole sidecars from in-memory state,
    with no re-read and no ordering against reloads.
  - An unwatchable notes folder (`--notes` into a missing directory) hid the
    agent's resolutions.
- **P1-F2 (blocking):** scrubbing clamped looping rows to their last frame,
  and an all-loop wrap did not re-align shorter loops with the playhead.
- **P1-F3 (blocking):** a `--notes` path without `.json` made the versions
  folder the sidecar path itself.
- **Non-blocking:**
  - P1-N1: Vite CORS allowed other local origins to read GET state.
  - P1-N2: "previous version" showed an intermediate agent save.
  - P1-N3: markers are dropped for baked clips of more than 40 keyframes.
  - P1-N4: docs named sidecars inaccurately.
  - P1-N5: concurrent page state updates could duplicate Avatars.
  - P1-N6: note ids could collide.
  - P1-N7: test gaps (mutes on seek, scrubbing).
  - P1-N8: Reactions preview through `PoseController`.
  - P1-N9: duplicated layer list.

#### Code Review #1 Revisions

- **P1-F1, accepted:**
  - `PreviewSession` serialises reloads and note edits through one queue.
  - Every note edit and version retention re-reads the sidecar from disk
    first.
  - Opening a session creates the notes folder so it can be watched.
  - Storage errors during retention now show as notes errors, not source
    errors.
  - Tests: notes written by another process survive a new note; a note added
    during a changed-source reload is kept, along with both versions; an
    explicit notes folder is created.
- **P1-F2, accepted:** looping rows seek through `seekClip`'s own wrap, and an
  all-loop wrap re-seeks every row to the playhead.
- **P1-F3, accepted:** the versions folder is the sidecar path without `.json`,
  or `<file>.versions`. A test was added.
- **P1-N1, accepted:** `server.cors: false`, one exact Host check, and any
  request carrying an `Origin` must match ours.
- **P1-N2, accepted:** the comparison row is the version the latest note was
  made against ("Reviewed version"), falling back to the one before the
  current version.
- **P1-N4, accepted:** the sidecar naming and Library placement are corrected
  in the skill, CLI usage and runtime guide. Retained versions are stored as
  `<version>.txt` (source text) in `<sidecar name>/`.
- **P1-N5, accepted:** page state updates are applied one at a time.
- **P1-N6, accepted:** note ids use `crypto.randomUUID()`.
- **P1-N7, accepted:** the seek test asserts mutes at a sought time, and the
  browser test scrubs and checks the paused playhead.
- **P1-N9, accepted:** live-layer toggling iterates the Avatar's own layers.
- **P1-N3, deferred to Phase 3:** 2.0 clips show their beats. Baked 1.0 bakes
  are retired in Phase 4.
- **P1-N8, accepted as a Phase 1 limit:** Reactions play through the Gesture
  path in the preview. This is revisited when Reactions move to 2.0 in
  Phase 3.

Verification after the revisions:

- focused vitest: preview modules and CLI, 31 tests; seek, 6 tests;
- `check:source`, ESLint and Prettier on the changed files: pass;
- the preview browser test: pass.

#### Code Review #2 Findings

`sdlc-reviewer`, repair round 1: a targeted recheck of the review #1
dispositions on the same working tree.

- **Result: pass.** P1-F1, P1-F2 and P1-F3 are fixed. Probes of the real
  server, the `animation resolve` CLI and raw HTTP confirmed:
  - interleaved notes and reloads kept every note and version;
  - an external resolve survives;
  - non-`.json` notes paths work;
  - the origin and Host checks behave as intended.
- **Optional findings:**
  - P1-R1: a version that fails to retain while the notes file is broken is
    not retained later.
  - P1-N5 residual: the "Previous version" toggle syncs cells outside the
    state queue, and an older SSE state can be applied last.
  - Cross-process races between the server and `animation resolve` lose an
    edit inside a few-millisecond window.
  - P1-R2: a hand-typed `localhost` URL gets 403.
  - Stale plan step text about retained versions.

Checks:

- vitest on motion authoring and seek: 101 tests;
- `check:source`, ESLint and Prettier: pass;
- the preview browser test: pass.

#### Code Review #2 Revisions

- **P1-R1 and P1-N5 residual:** deferred to Phase 3, which reworks the
  preview for 2.0 and runs its own review.
  - Retain whenever the current version is missing from the notes.
  - Route the toggle through the state queue and drop stale generations.
- **Cross-process race:** accepted. Human note rates make it negligible for a
  local tool.
- **P1-R2:** accepted. The tool prints and opens the `127.0.0.1` URL.
- **Plan text:** the step text is corrected.

Phase 1 passes its review (one repair round used).

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

#### Phase 2 record

Starting source: `04498690`. Issue #292.

Delivered in `src/frontend/web/src/lib/avatar/poses/` (moved files keep their
history):

- `anatomy/`:
  - `anatomy.ts`, `curves.ts` and `legs.ts`, moved from motion authoring;
  - `handPresets.ts`, moved from the creator's `poseCreatorHandAuthoring.ts`
    with its UI dependency removed;
  - `handPresetIds.ts`.
- **Joint model:** ten auxiliary components (eyes roll; shoulder, hand, foot
  and shin rotation; forearm, shin and toe deviation; toe rotation; finger
  twist). None has a measurable value in Relaxed Rest (all below 0.05°), so
  authored motion is unchanged. `decomposeJointRotation` takes optional
  `near` values to stay on one Euler branch.
- **Curves:** `ScalarTrack` keys carry an arrival `ease` (`smooth`, `linear`,
  `hold` or a 1.0 easing). The motion-description generator maps its leaving
  `interp` onto the following key.
- **Leg solver:** works on VRM 0 rigs by turning their offsets into the
  canonical basis.
- **Hand shapes:** `handShapeRotations(vrm, side, shape, metacarpal)` fits
  thumbs with the metacarpal at its base value and restores it afterwards.
- **`animaPoseClip/schemaV2.ts`:**
  - types, `validateAnimaPoseClipV2` with JSON-path issues, `sanitize` and
    `parse`;
  - limits of 1,000 beats, 400 tracks and 50,000 keys;
  - 1.0 fade, playback, role and event rules reused;
  - unknown top-level fields kept.
- **`animaPoseClip/prepareV2.ts`:** `prepareAnimaPoseClipV2(clip, { vrm,
  resolvePose })`, which samples canonical poses.
- **`animaPoseClip/convertV2.ts`:** `convertAnimaPoseClipToV2(clip,
  resolvePose)`.
- **Serialiser:** rounds `q` like transforms and `dt` like times.
- **Docs:** ADR 0014 and its index entry; glossary entries for Gesture, Beat
  and generated detail.
- **Dropped:** moving `actionClipId` out of the creator. Only the bake step
  uses it, and the bake is retired in Phase 4.

Evidence:

- **Tests:**
  - 2.0 validation: each structural rejection has its path.
  - Sampling:
    - eases and beat eases, offsets, base values, slerp, loops;
    - hand presets fitted on both Avatars, with finger-track overrides;
    - planted feet within 2 mm on both Avatars;
    - VRM 0/1 parity;
    - agreement with the motion-description generator within 1e-4°.
  - Conversion: all 22 Included Gestures and 72 Included Reactions match 1.0
    sampling at 120 Hz within 0.01°, 0.1 mm and 0.001 weight.
  - Joints: exact round trips for every joint, and branch-stable
    decomposition.
  - Legs: both Avatars hold within 1 mm while leaning, shifting and
    crouching.
  - Serialisation of 2.0 clips.
- **Checks:** from `src/frontend/web`,
  - `pnpm exec vitest run src/lib/avatar tests/avatar src/ui/pose-creator
    src/ui/action-editor`: 105 files, 947 tests;
  - `pnpm -s check:source`: pass;
  - ESLint and Prettier on the changed folders: pass.
- **Benchmark** (a one-off script, not committed), on the development
  machine: per-frame sampling of 0.014 ms (2.0) against 12.7 ms (1.0 bake) for
  the hearty laugh, and 0.012 against 5.9 ms for the clap; 2.0 preparation
  takes 0.5–0.7 ms.

#### Code Review #1 Findings (Phase 2)

`sdlc-reviewer`, full review of the uncommitted Phase 2 tree against
`04498690`. Its checks: the 947 tests, `check:source`, ESLint and Prettier,
all passing. Scratch vitest probes reproduced each blocking finding.

- **P2-F1 (blocking):** names from `Object.prototype` (`toString`,
  `constructor`, `__proto__`) passed as joints or components. Validation could
  throw, and preparation could crash on a "valid" clip.
- **P2-F2 (blocking):** scalar loop tracks dropped the key at the duration,
  losing its value and ease, unlike rotation and hand tracks.
- **P2-F3 (blocking):** 1.0 loop conversion was wrong.
  - The closing keyframe was sampled with wrap-around.
  - 2.0 wrapped smoothly where 1.0 holds the last keyframe and then snaps.
  - The Included loops all close on their first pose, so the tests missed it.
- **P2-F4 (blocking):** hips position ignored the base pose: `"base"` meant 0,
  untracked axes were zeroed, and the leg solver used the wrong offset.
- **P2-F5 (blocking):** the VRM skill reference still named the moved Hands
  module.
- **Non-blocking:**
  - P2-N1: rounding on save could invalidate a clip that validated in memory.
  - P2-N2: long 1.0 pose aliases became over-length labels.
  - P2-N3: thumbs were fitted to the base metacarpal even when it had a
    track.
  - P2-N4: contact bones were not checked, and contact windows could leave
    the clip.
  - P2-N5: the benchmark was not reproducible from the tree.
  - P2-N6: the ADR stated beat ordering as settled.
  - P2-N7: the joint parity test could not fail.

#### Code Review #1 Revisions (Phase 2)

- **P2-F1, accepted:** `resolveJoint` and the component check use
  `Object.hasOwn`, and `__proto__` is rejected as an expression name. Test:
  inherited names produce issues and never throw.
- **P2-F2, accepted:** `ScalarTrack` keeps a loop's closing key. When keys sit
  at both 0 and the duration, tangents span the seam and no wrap segment is
  needed. Test: the closing key's value and `hold` ease apply.
- **P2-F3, accepted:**
  - Keyframes are sampled without wrapping.
  - A 1.0 loop's first beat arrives with `hold`.
  - A "Loop start" beat is added when its first keyframe is after 0.
  - Tests: three non-Included loop shapes (a different closing pose, ending
    before the duration, starting after 0). Every conversion is now checked
    across two cycles for loops.
- **P2-F4, accepted:** hips axes hold, and `"base"` resolves to, the base
  pose's hips offset, and the leg solver uses the effective offset. Test
  added.
- **P2-F5, accepted:** the VRM skill reference names
  `lib/avatar/poses/anatomy/handPresets.ts` and its test.
- **P2-N1, accepted:**
  - Times are validated and kept in whole 0.1 ms ticks (the saved
    precision).
  - Beats, keys and neighbours must be at least 0.5 ms apart
    (`ANIMA_POSE_CLIP_V2_MIN_SPACING`).
  - Test: a clip at the minimum spacing stays valid after saving.
- **P2-N2, accepted:** converted labels are truncated to 80 characters, and
  length errors name the limit. Clip `id` and `name` are no longer capped
  (1.0 names are unbounded; the 2 MiB file limit bounds them).
- **P2-N3, accepted:** a hand key's thumb fit uses the metacarpal track's
  value at that time when the clip has one.
- **P2-N4, accepted:** contacts require humanoid bone names and must lie
  inside the clip.
- **P2-N5, accepted:** a committed test asserts that 2.0 sampling is at least
  10× cheaper than the 1.0 bake of the same motion. The measured gap is about
  900×.
- **P2-N6, accepted:** ADR decision 5 marks beat ordering as awaiting owner
  confirmation.
- **P2-N7, accepted:** the tautological parity test is replaced. VRM 0/1
  parity for hands and legs stays covered.

Verification after the revisions:

- from `src/frontend/web`, `pnpm exec vitest run src/lib/avatar tests/avatar
  src/ui/pose-creator src/ui/action-editor`: 105 files, 957 tests;
- `check:source`, ESLint and Prettier: pass.

#### Code Review #2 Findings (Phase 2)

`sdlc-reviewer`, repair round 1: a targeted recheck of the review #1
revisions.

- **Result: pass.** P2-F1 to P2-F5 are fixed, verified by scratch probes:
  - inherited names produce issues without throwing;
  - seam slopes are continuous;
  - 3,000 random description tracks match the previous `ScalarTrack`;
  - 1.0 loop shapes match exactly across three cycles;
  - planted feet hold with a base hips offset.

  Checks: 957 tests, `check:source`, ESLint and Prettier: pass.
- **Optional findings:**
  - P2-R1: conversion of 1.0 keyframes closer than 0.5 ms.
  - P2-R2: tick rounding differs from the serializer's `toFixed` at
    half-ticks, and `duration` is not kept in ticks.
  - A 1.0 loop whose first keyframe is within 0.5 ms after 0.
  - The closing key's tangent now governs arrival at the seam (intended).
  - The speed test's margin: about 55–80× measured, not the 900× stated.
  - Stale test counts in this record.

#### Code Review #2 Revisions (Phase 2)

- The optional items (P2-R1, P2-R2, the loop-start edge and the speed-test
  margin and comment) are deferred to the start of Phase 3. That way the
  Phase 3 review covers them, and this phase is committed as reviewed.
- The tangent behaviour is accepted as intended.
- The test counts are updated here: 957.

Phase 2 passes its review (one repair round used).

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

#### Phase 3 record

Starting source: `944f7d74`. Issue #290.

Phase 2's deferred items, applied first:

- tick validation rounds like the serializer, and `duration` is kept in
  ticks;
- conversion spreads 1.0 keyframes closer than 0.5 ms and snaps a loop's
  first keyframe within 0.5 ms of 0 onto 0;
- the speed test takes the best of three runs and states the measured margin;
- the preview keeps the current version when its sidecar lost it (P1-R1), and
  the previous-version toggle goes through the state queue (P1-N5).

Delivered:

- **Clip programs** (`animaPoseClip/program.ts`):
  `createAnimaPoseClipProgram(clip, { vrm, resolvePose })` returns `hasPose`,
  `expressionNames` and `sample(time, { atEnd })`. 1.0 clips are parsed once
  and wrap the existing sampler; 2.0 clips are prepared for the Avatar.
  `PoseController`, `ReactionClipPlayer` and `animation:render` sample through
  it.
- **Either schema** (`animaPoseClip/anyClip.ts`): `AnyAnimaPoseClip`,
  `isAnimaPoseClipV2`, `parseAnyAnimaPoseClip`, `sanitizeAnyAnimaPoseClip`
  and `animaPoseClipHasPose`. `parseAnyAnimaPoseClip` returns a clip it
  already produced unchanged, so per-frame timing and event helpers no longer
  re-validate clips.
- **Accepted wherever runtime clips load:** `AnimaRuntimeCatalog` (an invalid
  2.0 clip is skipped with an `invalid_motion_manifest` diagnostic naming the
  field), the built-in motion catalog, `Avatar`, the planner's Reaction
  lifetime, content preview, the debug panel and `lib/avatar/index.ts`.
  Timing, event and channel helpers accept both schemas.
- **2.0 rule tightened:** a clip needs at least one track key or event (it
  previously accepted beats alone, which play nothing), matching 1.0's rule.
- **Backend:** `validate_clip_v2_timeline` mirrors the frontend validator.
  Its vocabulary (eases, hand presets and limits, joints and components,
  limits) is checked against the shared `fixtures/v2-vocabulary.json`.
  `idle_playback.py` accepts 2.0. The package capability
  `animaPoseClip/2.0` is supported; a 2.0 clip requires it plus its base
  pose's built-in ref. The retired `POSE_CLIP` kind stays 1.0. No API schema
  changed.
- **Tooling:** the preview tool and `animation:render` play 2.0 clips. The
  preview shows beats as markers with their labels, and notes pin beat ids.
- **Docs:** the 2.0 format, playback and limits in
  `docs/frontend/runtime/avatar-animation.md`; both schemas in the backend
  content docs.
- **Not done as planned:** programs are not cached per Avatar and clip.
  Preparing one at each play costs 0.5–0.7 ms for 2.0 and one parse for 1.0,
  so a cache would add invalidation without a measurable gain.

Evidence:

- **Tests:**
  - `PoseController` with 2.0: tracks applied, fades and mutes, stop
    mid-clip (fades from the reached frame, then restores the rest pose and
    face), replacing a 1.0 clip, events with finite repetitions, an
    effect-only clip;
  - `ReactionClipPlayer` with a 2.0 expression track;
  - `AnimaRuntimeCatalog`: a valid 2.0 clip loads; an invalid one is skipped
    with its diagnostic;
  - programs: 1.0 and 2.0 sampling, `atEnd` on a loop, a missing base pose,
    and the parse cache;
  - 22 shared `clip2-*` Idle Style cases (frontend parser and backend
    validator agree), the shared valid fixture, package requirements and tick
    rounding;
  - a package export and import round trip of a 2.0 Gesture;
  - the preview tool with a 2.0 clip (Playwright), sources, sessions and
    `animation:render`.
- **Checks** (before review; the revisions below record the final run):
  - from `src/frontend`: `pnpm check` and `pnpm web:lint` pass;
    `pnpm web:test`: 386 files, 2,740 tests, plus 32 Node tests;
    `pnpm build` and the web `prettier:check` pass;
  - full `uv run pytest`: 3,136 passed, 10 skipped;
  - from the repository root: `uv run ruff check` and
    `ruff format --check` pass; `tests/test_idle_playback.py`,
    `tests/test_pose_clip_v2.py` and
    `tests/test_content_package_capabilities.py`: 126 passed.
- **Benchmark** (one-off script): a dense 1.0 clip of 247 keyframes samples in
  0.020 ms per frame through its program, against 3.75 ms when parsed per
  call.
- **Manual:** a 2.0 Gesture in a chat waits for Phase 5's import and Save
  (see the Phase 3 manual note); the preview tool plays 2.0 clips on both
  Avatars.

#### Code Review #1 Findings (Phase 3)

`sdlc-reviewer`, full initial review of the uncommitted Phase 3 tree against
`944f7d74`. Result: blocked by P3-F1 and P3-F2, both in the backend 2.0
validator.

- **P3-F1 (blocking):** hostile input crashes the backend validator instead of
  being rejected. A time of 1e24 or more raises `decimal.InvalidOperation` in
  `_v2_ticks`; a list or dict contact bone raises `TypeError` in the bone
  lookup. Idle eligibility answers 500 and package import fails unhandled.
  The frontend turns a duration of about 1.8e304 into `Infinity`.
- **P3-F2 (blocking):** the backend admits clips the frontend rejects:
  `"playback": null`; beat ids with surrounding spaces (the backend strips
  them, the frontend keeps them); contact `offset` and `tolerance` are not
  checked; and the contact window is checked in ticks on one side and in
  floats on the other.
- **Optional:**
  - P3-N1: conversion spreads close keyframes in floats, so half-tick inputs
    can still produce invalid clips (14 of 3,000 fuzzed cases);
  - P3-N2: smaller parity gaps (a beat at −0.00004 s, UTF-16 against code
    point lengths, events against the unrounded duration, value bounds not in
    the shared vocabulary);
  - P3-N3: a joint with no components counts as a pose;
  - P3-N4: leg-solver construction errors are swallowed;
  - P3-N5: the preview's previous-version toggle lacks the queue's `.catch`;
  - P3-N6: the speed test compares against per-call 1.0 parsing, not the
    program path (about 10× instead of 55–80×);
  - P3-N7: an unused export, a cast in the debug panel, a linear beat lookup
    in the backend;
  - P3-N8: docs overstate 2.0 support before Phase 5; the spec's "prepared
    once per Avatar" differs from preparing at play; no package capability
    doc names 2.0;
  - P3-N9: no 2.0 Reaction-with-events test.
- The parse cache's immutability assumption holds: no caller mutates a parsed
  clip.

#### Code Review #1 Revisions (Phase 3)

- **P3-F1 accepted, fixed.** `_v2_ticks` rejects magnitudes above 1e9 s
  before rounding, and contact bones are type-checked before the lookup. 2.0
  clips are limited to 3,600 s on both sides (the shared vocabulary carries the
  limit), so the frontend never produces an infinite duration. Pytest cases
  assert the exact rejected field for huge durations, beat times and contact
  windows and for list or object bones.
- **P3-F2 accepted, fixed.** The backend now rejects `playback` (including
  `null`), keeps beat ids unstripped as the frontend does, checks contact
  `offset` and `tolerance`, and both sides check the contact window in ticks
  (the serializer rounds `from` and `to`). Fifteen new shared `clip2-*` cases
  cover these and P3-N2/P3-N3; the frontend parser and backend validator agree
  on all of them.
- **P3-N1 accepted, fixed:** conversion spreads in ticks; a seeded test
  converts 300 random close-keyframe clips, all valid.
- **P3-N2 accepted, fixed:** beat times are rounded before the 0 check, lengths
  count UTF-16 units, events and the returned cycle use the tick-rounded
  duration, and the value bounds join the shared vocabulary. Validating
  `mutedProceduralLayers` on the backend is pre-existing 1.0 behavior and stays
  out of scope.
- **P3-N3 accepted, fixed:** a joint with no components is rejected on both
  sides, and `animaPoseClipHasPose` counts only tracks with keys.
- **P3-N4 accepted, fixed:** the solver is skipped only when leg bones are
  missing; other construction errors surface.
- **P3-N5 accepted, fixed:** the toggle's queue step catches and shows errors.
- **P3-N6 accepted, fixed:** the speed test compares with the 1.0 program path
  (about 10×; the test requires 2×).
- **P3-N7 accepted, fixed:** the unused export is removed, the debug panel
  narrows with `isAnimaPoseClipV2`, and the backend uses a beat-position map.
- **P3-N8 accepted, fixed:** the runtime doc names what accepts 2.0 today (the
  creator and the built-in App catalog still use 1.0); the decision log records
  preparing at play; the package doc names both clip capabilities.
- **P3-N9 accepted, fixed:** a 2.0 Reaction test times and clears an event.

Evidence: affected pytest files 165 passed (`test_pose_clip_v2`,
`test_idle_playback`, `test_content_package_capabilities`,
`test_content_mutation_workflows`); `ruff check` and `ruff format --check`
pass. From `src/frontend`: `pnpm check` and `pnpm web:lint` pass;
`pnpm web:test`: 387 files, 2,767 tests and 32 Node tests; web
`prettier:check` passes (the desktop package's `tests/feature-packs.test.ts`
warning predates this branch and is unchanged).

#### Code Review #2 Findings (Phase 3)

`sdlc-reviewer`, repair round 1: a targeted recheck of the review #1
revisions. P3-F1, P3-F2 and P3-N1 to P3-N9 are verified fixed: every earlier
hostile and parity probe is now rejected or accepted identically by both
sides, and a 3,000-case conversion fuzz gives no invalid clips (it gave 14).

- **P3-F3 (blocking, regression from the P3-N2 revision):** the new UTF-16
  length count raises `UnicodeEncodeError` on a lone surrogate, which JSON can
  carry, so idle eligibility and package import fail unhandled again. The
  frontend accepts such a label.

#### Code Review #2 Revisions (Phase 3)

- **P3-F3 accepted, fixed:** the count encodes with `surrogatepass`, so a lone
  surrogate counts as one unit as in JavaScript. A test checks 80 and 81 lone
  surrogates and 41 emoji against the 80-unit label limit. Affected pytest
  files: 166 passed; `ruff` passes.

#### Code Review #3 Findings (Phase 3)

`sdlc-reviewer`, repair round 2: a targeted recheck of P3-F3. **Result:
pass.** Lone surrogates in beat ids and labels are accepted or rejected
identically by the frontend and both backend paths (80/81 lone surrogates,
64/65 in ids, 40/41 emoji, mixed pairs), with no regressions. Both repair
rounds are used.

Phase 3 passes its review.

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

#### Phase 4 record

Starting source: `afeb618a` (Phase 3 commit). Issue #293. Task stack:
`animama-track-clips` at http://animama-track-clips.localhost:8240.

Delivered:

- `animation validate <clip> [--out]` (structure, anatomical hard limits,
  saved size; writes the compact file only when valid); `check` takes 1.0 and
  2.0 clips, with contacts and `plantFeet` read from the clip and each Avatar
  sampled through its own prepared program; `generate`, `bake.ts`,
  `description.ts`, `hands.ts` and the `.motion.json` examples removed; the
  preview and both tools explain that `animamaMotion/1` is retired, and the
  preview prints each source's file path.
- The six examples migrated to `examples/<name>.clip.json` with the prototype
  beats. A one-off migration test (kept outside Git in `.animama-stacks/g1-review/`) showed
  the 2.0 playback matches the described curves on both Avatars at 120 Hz:

  | Example | Beats | Max rotation | Max hips | Max weight | 2.0 saved | 1.0 bake | Ratio |
  | --- | --- | --- | --- | --- | --- | --- | --- |
  | wave-hello | 5 | 2.1e-14° | 0 m | 0 | 3.0 KB | 152 KB | 1.9% |
  | gentle-double-nod | 7 | 3.2e-15° | 0 m | 4.2e-16 | 2.9 KB | 36 KB | 8.2% |
  | hearty-laugh | 7 | 5.3e-14° | 1.7e-17 m | 1.1e-15 | 12.4 KB | 719 KB | 1.7% |
  | excited-triple-clap | 8 | 4.4e-13° | 6.1e-18 m | 0 | 12.5 KB | 319 KB | 3.9% |
  | palms-up-shrug | 6 | 5.2e-14° | 4.4e-18 m | 1.7e-16 | 5.8 KB | 252 KB | 2.3% |
  | thinking-chin-rest | 3 | 3.5e-15° | 0 m | 0 | 3.5 KB | 305 KB | 1.1% |

- All six pass the checks on both Avatars with no findings; the 1.0 bake of
  the clap had two smoothness warnings that 2.0 does not.
- Skill: `SKILL.md`, `references/clip-format.md` (renamed from
  `description-format.md`), `checks-and-review.md` (project-file import with
  Selector ID, beat-relative contacts, revising a saved Gesture),
  `motion-principles.md`, `hands-and-face.md`, `human-movement.md`, tiers and
  Selector IDs; runtime doc authoring section.
- Checks: `tsc -b`, ESLint, web `prettier:check` pass; `pnpm web:test`: 385
  files, 2,753 tests and 32 Node tests pass.
- Phase 5 "before" screenshots (Pose and Clip tabs, new and imported clips,
  1440 and 900 px) were captured from the stack with a scratch Playwright
  script; at 900 px the sidebar rail overlaps the creator header (existing).

Remaining: gate G1 (the owner compares each example with its 1.0 bake:
`pnpm -s animation:preview src/lib/avatar/motion-authoring/examples/<name>.clip.json --compare ../../../.animama-stacks/g1-review/<name>.v1.clip.json`
from `src/frontend/web`).

#### Code Review #1 Findings (Phase 4)

`sdlc-reviewer`, full initial review of the uncommitted Phase 4 tree against
`afeb618a`. The migration was verified key by key against the retired
descriptions; all six examples validate and pass the checks. Result: blocked
by P4-F1.

- **P4-F1 (blocking):** two unchanged skill decision rules still describe the
  description format's defaults ("`plantFeet` default", "default: all but
  breathing"). A 2.0 clip plants nothing and mutes nothing unless it says so,
  and the checks then skip the feet: a clip following the rule with a 6 cm hips
  shift passed with both feet sliding 6 cm.
- **Optional:** P4-N1 `validate` reports anatomical limits only after the
  structure is valid; P4-N2 range, smoothness and seam checks use only the first
  Avatar's preparation; P4-N3 the retired-format message is duplicated; P4-N4
  revising a 1.0 Library item fails at `validate` and `check` suggests
  `validate` for 1.0 clips; P4-N5 no 2.0 loop-seam test; P4-N6 two doc nits;
  P4-N7 the skill's Selector ID rule for replacements is unagreed policy.

#### Code Review #1 Revisions (Phase 4)

- **P4-F1 accepted, fixed:** the skill now says to set `"plantFeet": true` and
  list the mutes explicitly. As a safeguard, `check` also checks the feet of a
  2.0 clip that keys no leg bones, whatever `plantFeet` says; a test shows the
  sliding case fails and the planted one passes.
- **P4-N1 accepted, fixed:** anatomical limits are read from the raw clip and
  reported with structural issues in one run (test updated).
- **P4-N2 accepted as a recorded limitation:** canonical-value checks use the
  first Avatar; the reviewer's per-Avatar probe found no range breach on A_1
  that Y_0 lacked, and parity compares the Avatars at 10°.
- **P4-N3 accepted, fixed:** one exported constant and message in `sources.ts`.
- **P4-N4 accepted, fixed:** the skill says to open and save a 1.0 item in the
  creator first; `check` suggests `validate` only for 2.0 clips.
- **P4-N5 accepted, fixed:** a 2.0 loop-seam test.
- **P4-N6 accepted, fixed:** 1.1–8.2%; a plain-clip import needs only the AI
  description.
- **P4-N7 accepted:** the rule is replaced by "ask the owner"; the question is
  carried to Phase 7.

Evidence: `vitest run src/lib/avatar/motion-authoring`: 57 tests pass; `tsc -b`
and ESLint pass.

#### Code Review #2 Findings (Phase 4)

`sdlc-reviewer`, repair round 1. **Result: pass.** P4-F1 is fixed (the 6 cm
hips probe now fails with 8 feet findings, and passes when planted); P4-N1,
N3–N7 are resolved; no regressions (196 tests in the authoring and clip
folders; all six examples pass `check`). Two wording nits about the new feet
default (the `MotionCheckOptions.plantFeet` comment and `checks-and-review.md`)
were fixed before commit.

Phase 4 passes its review (one repair round used). Gate G1 (owner comparison)
remains open; Phases 5–7 proceed.

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
