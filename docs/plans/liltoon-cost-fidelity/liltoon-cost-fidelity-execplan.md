# Authored lilToon materials: frame cost and Unity fidelity

Source agreement: raymond-van/animama#752 (published 2026-10-27; snapshot in
[liltoon-cost-fidelity-spec.md](liltoon-cost-fidelity-spec.md)). The issue is
the spec.
Authorized scope: the whole plan (owner, 2026-10-27: "Approve the plan with
D1–D5 as proposed and start implementing from Phase 1"). Owner gates in each
phase still apply; no push or pull request until the owner asks.
Upstream posts (three-liltoon, Mochiya Avatar Tools), Unity runs on private
projects, merge and release keep their separate approvals.

## Purpose and context

Converted VRChat Avatars render their authored lilToon materials through
`@mochiya/three-liltoon` 0.1.9 (`src/frontend/package.json`). This plan makes
those materials cheaper per frame and closer to Unity's lilToon, and lists
every remaining difference with its cause (#752 R1–R6).

Code and contracts:

- Animama's integration: `src/frontend/web/src/lib/avatar/liltoon/`
  (`lilToon.ts` loads the package on demand and installs its passes,
  `depthPrepass.ts` draws opaque lilToon primitives' depth first,
  `lilToonGpuCheck.ts` times lilToon frames for Automatic) and
  `avatarGltfLoader.ts`; documented in
  [avatar-animation.md](../../frontend/runtime/avatar-animation.md#authored-liltoon-materials).
- Measurement: `effects:bench` (`src/frontend/web/scripts/effect-bench.mjs`,
  `scripts/effect-bench/bench.ts`, `breakdown.ts`, `breakdownPlan.ts`).
- Conversion: `scripts/avatars/unity/AnimamaBatchExport.cs` drives Mochiya
  Avatar Tools 0.1.4, which exports through UniVRM/UniGLTF; documented in
  [vrchat-avatar-conversion.md](../../frontend/runtime/vrchat-avatar-conversion.md).
- three-liltoon (MIT): runtime GLSL translated from pinned lilToon 2.3.4 HLSL
  through DXC and SPIRV-Cross, specialized per material as a
  `RawShaderMaterial`; package-owned outline proxies; a material-owned R32F
  morph-weight texture read inside three.js's morph loop.

Base: branch `perf/liltoon-cost-fidelity`, cut from
`feat/arbitrary-vrm-support-pr-b` at `22cd2c31` (PR #744, not merged). Merge
`origin/main` into this branch once #744 merges. Files #744 owns (the Materials
setting, Automatic and its GPU check, frame-rate caps) are not edited here
before it merges.

Licence boundary: the test Avatars are third-party. Their files, textures,
renders, captures and shape data stay outside the repository and are never
named in tracked files, issues, pull requests or upstream posts. This plan
calls the main one "the converted test Avatar" and its materials by role.
Evidence here is counts, timings and pass/fail. Tests use synthetic fixtures
or Included Avatars with synthetic additions.

## Progress

- [x] Investigation (2026-10-27): GPU trace, full-clock breakdown, hair
  outline diagnosis; recorded below.
- [x] Phase 1: full-clock measurement in `effects:bench` (review passed).
- [ ] Phase 2: opaque lilToon surfaces and outlines without blending.
- [ ] Phase 3: morph-weight textures without per-frame reallocation.
- [ ] Phase 4: vertex-colour outlines (runtime fallback and export).
- [ ] Phase 5: Unity parity report and fixes.
- [ ] Phase 6: upstream texts.
- [ ] Phase 7: documentation and final integration review.

## Surprises & Discoveries

All on an Apple M5, headless Chromium with ANGLE Metal, the chat canvas
(800×600), the converted test Avatar with lilToon (7 materials, 11
primitives, 67,698 triangles; 19 draws and 131,137 triangles with outlines),
2026-10-27, with other sessions' jobs running.

1. **Paced GPU timer readings follow the GPU's clock state.** A Metal System
   Trace of the paced 60 fps bench showed the GPU in its Medium performance
   state for about 70% of the trace and Maximum for about 25%. The bench's
   `EXT_disjoint_timer_query_webgl2` reading measures time at whatever clock
   the GPU chose, so a lighter frame runs at a lower clock and takes about as
   long. This explains most of #691 Phase 9's "resolution-independent floor"
   and why its feature cuts appeared to save little. The same applies to the
   Automatic GPU check's stored median (#744).
2. **One render pass, mostly fragment work.** Each frame is one Metal render
   pass (plus a clear and a small upload blit); no pass breaks. Vertex work is
   about 15% of the frame, fragment work the rest.
3. **Full-clock cost.** With frames rendered back to back and a 1-pixel
   readback as the sync point (an experimental `--saturate` bench mode; wall
   time per frame, CPU and GPU overlapped):

   | Avatar | DPR 1 | DPR 2 |
   |---|---|---|
   | converted test Avatar, lilToon | 2.2–4.4 ms | 2.7–2.8 ms |
   | same Avatar, Simple | 0.8–1.3 ms | 0.9–1.3 ms |
   | Andrew (CPU-bound in this mode) | 0.95 ms | 0.95–0.99 ms |

   The first block of each run was consistently slow (clock ramp-up); later
   blocks agree. `gl.finish()` does not block in Chromium, so the readback is
   needed.
4. **Breakdown at full clock** (Metal System Trace of a saturated
   `--breakdown features,materials` run at DPR 2, 200 frames per scenario in
   two alternating rounds; GPU-only medians per frame). Tracing inflates the
   absolute GPU times about 3.5 times (the untraced baseline is at most
   2.75 ms per frame), so read these as proportions:

   | Scenario | Vertex | Fragment | Total vs baseline |
   |---|---|---|---|
   | baseline | 1.42 | 8.38 | — |
   | blending off on the 6 opaque materials (the depth pre-pass then covers 9 primitives) | 1.43 | 3.90 | −46% |
   | every lilToon feature off but transparency | 0.53 | 4.85 | −45% |
   | clothing material hidden (82.5% of the Avatar's pixels) | 1.27 | 4.22 | −44% |
   | skin and face material hidden | 0.56 | 7.55 | −17% |
   | toon shadow off | 1.21 | 6.98 | −16% |
   | reflection off | 1.34 | 6.92 | −16% |
   | morph targets dropped | 0.39 | 8.28 | −12% |
   | hair material hidden | 1.25 | 7.80 | −8% |
   | morph weights from uniforms (surface pass only) | 0.85 | 8.35 | −6% |
   | outline pass off | 1.17 | 12.05 | +35% |

   The clothing material drawn alone costs about 60% of the baseline's
   fragment time. The cost is fragment overdraw on large layered surfaces.
   lilToon's opaque blend state (colour One/Zero, alpha
   One/One-minus-source-alpha) keeps blending enabled, which stops a
   tile-based GPU from removing hidden surfaces and kept Animama's depth
   pre-pass off every primitive. Outlines drawn before their surfaces act as
   occluders, which is why removing them costs more.
5. **Blending off on opaque materials is exact.** lilToon's forward pass sets
   `fd.col.a = 1.0` for opaque render mode, and three-liltoon 0.1.9 keeps it:
   rendering the same frame (SwiftShader, DPR 2, 380,619 covered pixels) with
   lilToon's blend state and with `NoBlending` on the six opaque materials
   differed in no RGB byte beyond the frame-to-frame noise floor and in one
   alpha byte. That one pixel is a multisample edge where the depth
   pre-pass's depth test rejected one sample. #691 Phase 9's review assumed
   opaque output alpha was texture alpha times `_Color.a`; that does not hold
   for opaque render mode.
6. **Morph-weight textures are reallocated every frame.** three-liltoon keeps
   one weight texture per material and resizes it to the drawn mesh's target
   count. Two of the test Avatar's materials are shared by meshes with
   different counts (155 and 36; 155 and 20), so each frame deletes and
   creates six textures and uploads them mid-pass.
7. **Dark patches in the hair bangs** (the owner's report). The hair
   material sets lilToon's `_OutlineVertexR2Width` = 2: the outline direction
   is the vertex colour's RGB in tangent space and its width is scaled by the
   vertex alpha. The source meshes carry those colours (including a dedicated
   outline-normal bake), but the export has no `COLOR_0` on any primitive.
   three-liltoon compiles an absent colour as `vec4(1.0)`, so the outline is
   pushed along tangent + bitangent + normal at about 1.7 times its width and
   shows through the thin bang tips. A private copy with the mode set to 0
   loses the dark band; thin lines remain where Unity tapers the outline with
   the vertex alpha. UniGLTF exports `COLOR_0` only when
   `GltfExportSettings.ExportVertexColor` is set or the material is UniUnlit
   with vertex-colour multiply, and Mochiya's profile
   (`MochiyaExportProfile.MeshExportSettings`) leaves it off. lilToon reads
   vertex colour only for outline width and direction and for fur.

## Decision Log

- 2026-10-27, owner: asked for this work, reported the hair bang difference
  with a side-by-side Unity screenshot, and approved publishing the spec as
  #752 as drafted.
- 2026-10-27, owner: approved this plan with D1–D5 as proposed below and
  asked for implementation from Phase 1; no push or pull request until asked.
- 2026-10-27, agent: merged `feat/arbitrary-vrm-support-pr-b` at `d5818800`
  (#744's Automatic keeps lilToon with a frame-rate cap) into this branch
  before Phase 1; it touches none of this plan's files.
- 2026-10-27, agent (Phase 1, within the plan): the R2 target compares
  saturated wall time per frame, not a traced GPU-only figure, because
  Instruments' attach mode hung and saved no trace; the Included Avatars are
  CPU-bound in that mode, so their figure (about 1–1.3 ms) bounds their GPU
  share from above.

## Decisions (approved 2026-10-27)

- D1 How three-liltoon changes ship. Proposed: a `pnpm patch` of
  `@mochiya/three-liltoon` (as for `@vitejs/plugin-react`), each change also
  drafted upstream (Phase 6); drop the patch when a release includes it.
  Alternative: a vendored fork, which costs a full copy of 2 MB of generated
  code.
- D2 Depth pre-pass once opaque materials stop blending. On a tile-based GPU
  hidden-surface removal may make the pre-pass redundant (it adds vertex
  work); on other GPUs it saves overdraw. Proposed: Phase 2 measures both on
  the reference machine and keeps the pre-pass unless it costs there.
- D3 Unity runs. Proposed: the agent may run Unity in batch mode (with
  graphics, never `-nographics`) on the private projects to render references
  and to re-export the converted test Avatar with vertex colours; outputs
  stay private.
- D4 Parity conditions. Proposed: compare with Animama's tone mapping and
  chat filter off and lights matched to Unity's, so differences reflect the
  translation and mapping; then show both looks and let the owner decide
  whether the app's tone mapping and filter should keep applying to authored
  lilToon materials.
- D5 Automatic (#744). After Phase 2 lowers lilToon's cost, raise
  `lilToonGpuCheck.ts`'s `METHOD` so viewers measure again, and reconsider
  timing at a known clock state. Proposed: a follow-up after #744 merges, in
  this branch, with the owner's approval of the threshold.

## Phased implementation

Each phase starts from the previous phase's commit on this branch.

### Phase 1: Full-clock measurement

Review tier: standard (measurement tooling; no runtime change).

Requirements: R1, R2 (method). Changes: `effects:bench --saturate <n>`
renders `n` frames back to back per sample and waits on a 1-pixel readback,
reporting wall time per frame and submission time per frame, with short idle
gaps around each pass so a GPU trace can be cut into passes. Document the
method and its limits in the bench's usage text and in avatar-animation.md
(paced readings follow the clock state; compare only within one run).
Record the investigation's breakdown table above as R1 evidence, and add a
traced full-clock baseline for Andrew so the R2 target has a comparable
figure.

Checks: `parseBenchArgs` tests for `--saturate`; vitest for the bench helpers;
`pnpm verify`; one saturated run each for the Included Avatars and the
converted test Avatar.

Completion: the bench reports saturated timings; R1 recorded.

Starting source: `b3eb81b3` (this branch after merging #744's `d5818800`).

Implemented: `--saturate <n>` (1–100) in `effect-bench.mjs` (parsing, usage,
reports labelled "frame (saturated)" with "samples of n back-to-back frames")
and `measureSaturated` in `effect-bench/bench.ts`: batches of n frames with a
`gl.flush()` after each and a 1-pixel `readPixels` as the sync point; CPU
samples hold submission time per frame; 400 ms and 150 ms idle gaps before a
pass's warm-up and measured frames; and about 2 s of back-to-back frames
before each stage's first saturated pass, because that pass otherwise ran 3–5
times slower than later ones (12.5 ms against 3.1 ms for the same lilToon
frame). avatar-animation.md "Frame cost" now explains that paced timings read
light frames slow and so understate savings, and gives full-clock figures;
avatar-vfx.md documents the option and the conversion guide uses it.

R1: the investigation's breakdown (Surprises 2–4) stands as the accounting;
Phase 1's runs below agree with it. A GPU-only traced figure for Andrew was
not obtained: Instruments' attach mode hung after Chromium exited and saved
nothing, so the R2 target uses saturated wall time (Andrew is CPU-bound there,
so its GPU share is at most that figure). Traces taken alongside should use
`--all-processes` with a time limit that ends before the run.

Check record (2026-10-27, macOS arm64, Apple M5, worktree on
`perf/liltoon-cost-fidelity`, working tree `182e1f4bc0593958a6e2cddf187b1ef53f8e32fb`; heavy-job slots
shared with another session's e2e run and a backend suite):

- `node --test scripts/effect-bench.test.mjs` (`src/frontend/web`): 4 passed,
  including `--saturate` parsing and its refusals (0, 1.5, 101, `x`, with
  `--reaction`).
- `npx tsc --noEmit -p tsconfig.scripts.json` and `npx eslint
  scripts/effect-bench.mjs scripts/effect-bench/bench.ts
  scripts/effect-bench.test.mjs` (`src/frontend/web`): passed.
- `python3 ../../../scripts/heavy-slot.py -- pnpm -s effects:bench --saturate 10
  --fps 60 --frames 300 --warmup 60 --rounds 2` (`src/frontend/web`): Andrew
  1.04 ms per frame without effects (CPU 0.66 ms), 1.64 ms with the heavy
  effects; AvatarSample_A_1_New 1.18 and 1.60 ms.
- The same with `--avatar-file <the converted test Avatar> --materials liltoon
  --breakdown features`: baseline 10.19 ms per frame under that load; blending
  off on the six opaque materials 5.18 ms (−49%); toon shadow off −1.68 ms;
  every feature off but transparency −3.87 ms; outline pass off +7.95 ms.
- Earlier, before the ramp, an interleaved scratch comparison in one page
  (second round): lilToon 3.10 ms, Simple 1.70 ms, Andrew 1.26 ms per frame.

Limitations: absolute saturated times move with other jobs on the machine as
much as paced ones; only same-run comparisons are evidence. Light Avatars are
CPU-bound in saturated mode (wall time close to CPU time), so their GPU share
is hidden. Targeted checks replaced `pnpm verify` for this phase; it runs on
the final candidate.

#### Code Review #1 Findings

Independent reviewer (standard tier, initial review) of the working tree
`182e1f4b` against `b3eb81b3`; reused the record's checks after confirming the
covered files were unchanged; reran none. Result: blocked.

- P1-R1-F1 (required): avatar-animation.md said paced timings understate a
  frame's work, contradicting its own figures (paced readings are higher) and
  avatar-vfx.md.
- P1-R1-F2 (required): the bench reference in avatar-vfx.md did not list
  `--saturate` and still told readers to compare paced runs only;
  vrchat-avatar-conversion.md recommended a paced `--breakdown`.
- P1-R1-F3 (required): the clock ramp ran once per page, but each stage
  (Avatar × pixel ratio) loads an Avatar first, so later stages' first passes
  could still be slow.
- P1-R1-F4 (optional): measured batches waited for a display frame, leaving a
  light GPU idle between batches; `gl.flush()` lacked a reason.
- P1-R1-F5 (optional): `sampleCount` displaced `signed`'s doc comment.
- P1-R1-F6 (optional): stale `passes` and `frameRate` comments, "GPU samples
  voided" printed for saturated runs, and the saturated early return placed
  after paced-only setup.
- P1-R1-F7 (optional): the frame-cost figures mixed DPR 1 and DPR 2, repeated
  "frame", and one line was unwrapped.
- P1-R1-F8 (optional): the record did not say targeted checks replaced
  `pnpm verify`; replacing the traced Andrew baseline had no Decision Log
  entry.

#### Code Review #1 Revisions

- P1-R1-F1 accepted: the sentence now says a light paced frame reads slower
  than it is, which narrows differences and understates savings.
- P1-R1-F2 accepted: avatar-vfx.md lists `--saturate` with its method,
  labels, ramp, gaps and CPU-bound caveat; the conversion guide's breakdown
  recipe uses `--saturate 10` and links there.
- P1-R1-F3 accepted: the ramp flag is per stage (`withBenchStage`). A
  three-round run of both Included Avatars then gave no slow first pass in
  the second stage (AvatarSample_A_1_New's passes 0.99, 1.19, 1.34 ms).
- P1-R1-F4 accepted: batches yield with a zero-delay timeout instead of a
  display frame; the flush has a comment.
- P1-R1-F5, P1-R1-F6 and P1-R1-F7 accepted as described (saturated JSON
  keeps `frameRate` 0, now documented on the type).
- P1-R1-F8 accepted: the limitation above and a Decision Log entry.

Recheck evidence (same environment): `node --test scripts/effect-bench.test.mjs`
4 passed; `npx tsc --noEmit -p tsconfig.scripts.json` and eslint on the three
script files passed; `effects:bench --saturate 10 --fps 60 --frames 300
--warmup 60 --rounds 3` on the Included Avatars completed with the new labels
(Andrew 1.50/1.13 ms without and with effects, AvatarSample_A_1_New 1.17/1.28
ms; both CPU-bound, so the "added" figures are noise).

#### Code Review #2 Findings

Targeted recheck (repair round 1) by the same reviewer: P1-R1-F1, F2 and F3
resolved; F4, F5, F7 and F8 resolved; F6 partly (two `passes` comments still
said "empty without a GPU timer" / "Mean GPU time"). Leftovers: `ramped` sat
between `measureSaturated`'s doc comment and its declaration; avatar-vfx.md
said the trace's time limit "ends before the run"; this section's
"Implemented" paragraph still described the page-wide ramp; the recheck
evidence lacked a Git tree. The reviewer reran `node --test
scripts/effect-bench.test.mjs` (4 passed), eslint and `tsc -p
tsconfig.scripts.json` (passed) on the working tree. Result: pass.

#### Code Review #2 Revisions

All leftovers fixed by the coordinator (trivial wording and comment moves,
verified by rereading and rerunning the bench unit tests, eslint and
`tsc -p tsconfig.scripts.json`, all passing on tree `41d6531440a48bf9c76a3c4a527f70c421f9abbf`): both `passes`
comments now cover saturated runs; `ramped` has its own comment above
`measureSaturated`'s; avatar-vfx.md says to trace with `--all-processes` and a
time limit that ends before the bench exits; the "Implemented" paragraph
describes the per-stage ramp and the doc changes. Repair budget used: one of
two rounds. Phase 1 complete.

### Phase 2: Opaque lilToon surfaces and outlines without blending

Review tier: standard (rendering change verified by exact comparisons).

Requirements: R2, R6. Changes (three-liltoon patch, D1): a material whose
render mode is opaque (its shader writes alpha 1) and whose colour blend is
One/Zero draws with `NoBlending`; its automatic outline does the same.
`depthPrepass.ts` then admits those primitives through its existing rules;
its documentation drops the alpha caveat for opaque materials. Cutout and
transparent materials are unchanged.

Checks: unit tests that an opaque lilToon material loads with blending off
and transparent and cutout ones keep theirs (synthetic material); exact
render comparison (SwiftShader, `effects:render`/`animation:render` with
`--materials liltoon`, `--diff --threshold 0`, RGB and alpha) on the
converted test Avatar (private) and an Included Avatar with a synthetic
lilToon material; saturated and paced bench before and after in one run,
with the pre-pass on and off (D2); Included Avatars' renders 0 px and bench
unchanged; `pnpm verify`.

Owner gate: the measured result.

Recovery: the patch is one file; reverting it restores 0.1.9's behaviour.

### Phase 3: Morph-weight textures without per-frame reallocation

Review tier: light.

Requirements: R2. Changes (patch): weight textures keyed by mesh (or sized to
the largest target count among a material's meshes) so a shared material
uploads changed weights only. Evaluate reading weights from a uniform array
when the count fits the vertex uniform budget, keeping the texture otherwise.

Checks: the WebGL call probe shows no texture creation per frame; morph
expressions render as before (exact comparison with an expression held);
bench before and after.

### Phase 4: Vertex-colour outlines

Review tier: standard (runtime, export and fallback materials).

Requirements: R3, R6. Changes:

1. Runtime (patch): when a lilToon outline reads vertex colour
   (`_OutlineVertexR2Width` 1 or 2) and the geometry has no `color`
   attribute, the outline uses the mesh normal at full width and the loader
   warns once per material.
2. Export: `AnimamaBatchExport.cs` sets `ExportVertexColor` on the export
   profile's mesh settings, so meshes keep `COLOR_0`.
3. Fallback materials: `LilToonFallbackMaterialsPlugin` keeps glTF fallbacks
   of lilToon materials free of vertex colour, so Simple does not change
   colour when `COLOR_0` is present.
4. Re-export the converted test Avatar (D3) and compare its bangs with Unity.

Checks: synthetic fixture tests for the fallback and its warning, and for
fallback materials ignoring `COLOR_0`; the batch export compiles in the
private Unity project; private renders: no dark band, outline taper as in
Unity; Simple renders unchanged with `COLOR_0` present.

Owner gate: the look in private renders.

### Phase 5: Unity parity report and fixes

Review tier: standard.

Requirements: R4. Changes: a Unity editor script beside the batch export that
renders a prefab from a given camera with one directional light and flat
ambient light to PNG; an Animama review option that renders with the same
camera and lights and without tone mapping and chat filter (D4). The report
lists each difference, its cause (translation, lighting or material mapping,
export, or the app's look) and whether it is fixed. Fixes land in the
three-liltoon patch, Animama's mapping or the export as the cause dictates.

Checks: matched renders of the face and full body; each fix verified by the
same comparison; Included Avatars unchanged.

Owner gate: the report and the look.

### Phase 6: Upstream texts

Review tier: light.

Requirements: R5. Draft issues or pull requests: three-liltoon (opaque
blending, morph-weight reallocation, absent vertex colour, and any Phase 5
translation fixes); Mochiya Avatar Tools (exporting vertex colours that lilToon
outlines read). Nothing is posted without the owner's approval of the exact
text.

### Phase 7: Documentation and final integration review

Review tier: standard. Update avatar-animation.md (frame cost, depth pre-pass,
measurement method) and vrchat-avatar-conversion.md (vertex colours), run the
final integration review and the full pre-push suite on the final candidate.

## Final integration review

Not started.

## Validation and acceptance

Per #752: R1 recorded (Phase 1); R2 before and after in one run with exact
render comparisons (Phases 2–3); R3 private renders and fixture tests (Phase
4); R4 report (Phase 5); R5 drafts (Phase 6); R6 Included renders 0 px, bench
unchanged and the pre-push suite (Phase 7). Owner gates as listed per phase.

## Idempotence and recovery

Runtime changes live in the three-liltoon patch and Animama's integration and
revert cleanly. Export changes affect only new exports; existing files keep
working through the runtime fallback. Measurements and renders are repeatable
and stay outside the repository.

## Outcomes & Retrospective

Not started.
