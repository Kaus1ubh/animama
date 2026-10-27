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
- [x] Phase 2: opaque lilToon surfaces and outlines without blending (review
  passed; owner accepted the pre-pass edge-sample difference, D6).
- [x] Phase 3: morph-weight textures without per-frame reallocation (high
  risk; review and checks passed).
- [x] Phase 4: vertex-colour outlines (runtime fallback; export held
  upstream, owner-accepted D7).
- [x] Phase 5: Unity parity report and fixes (high risk; SH-direction guard,
  parity renders; review and checks passed).
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
- 2026-10-27, owner: accepted D6 (the depth pre-pass's edge-sample
  difference, about one edge pixel per frame on the converted test Avatar,
  for its saving) and D7 (R3's export half moves to the upstream drafts;
  Animama keeps the runtime fallback), closing Phase 2's gate and Phase 4.
- 2026-10-27, owner: approved this plan with D1–D5 as proposed below and
  asked for implementation from Phase 1; no push or pull request until asked.
- 2026-10-27, agent: merged `feat/arbitrary-vrm-support-pr-b` at `d5818800`
  (#744's Automatic keeps lilToon with a frame-rate cap) into this branch
  before Phase 1; it touches none of this plan's files.
- 2026-10-27, agent (Phase 5): raised to high risk because its fix extends
  the dependency patch.
- 2026-10-27, agent (Phase 3): morph weights stay in a texture, now per
  mesh; a uniform-array path is left to upstream (rationale in Phase 3).
- 2026-10-27, agent: Phase 4 before Phase 3 (its work was ready and touches
  no patch file). Its export change moved upstream: UniVRM's VRM 1.0 writer
  drops vertex colours regardless of settings.
- 2026-10-27, agent (Phase 2 review): Phases 2 and 3 raised to high risk
  because they patch a runtime dependency (P2-R1-F1).
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

Owner decisions raised during implementation (both accepted 2026-10-27):

- D6 (Phase 2 gate): accept the depth pre-pass's edge-sample difference
  (about one edge pixel per frame on the converted test Avatar, channel delta
  up to 21) for its saving, or keep the pre-pass off for lilToon primitives.
- D7 (Phase 4 gate, changes R3): the export cannot keep vertex colours today
  (UniVRM's VRM 1.0 writer drops them), so R3's export half moves to the
  upstream drafts and Animama ships the runtime fallback (no dark patches;
  tips slightly heavier than Unity's) until an exporter keeps them.

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

Review tier: high risk (a patch of a runtime dependency changes which
dependency code resolves; raised from standard by Code Review #1, P2-R1-F1).

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

Starting source: `07a2e70b` (Phase 1).

Implemented: `src/frontend/patches/@mochiya__three-liltoon@0.1.9.patch`
(registered in `src/frontend/package.json` and `pnpm-lock.yaml`, described in
`patches/README.md`): `applyLilToonPassState` sets `NoBlending` for the
`forward` and `outline` passes of opaque render mode when colour blends Add
One/Zero and alpha blends Add One with Zero or One-minus-source-alpha. It is
reapplied wherever three-liltoon reapplies render state (construction, shader
variant and render-state property changes, outline synchronisation).
`web/src/lib/avatar/liltoon/threeLilToonPatch.test.ts` runs the installed
package. The breakdown gains `feature:authored-blending` (lilToon's own
blending back on opaque surfaces; outlines stay unblended) so the patch's
effect is measurable within one run, and `blendingOff` became `setBlending`.
avatar-animation.md documents the unblended passes, the pre-pass's new
coverage and its edge-sample difference, and the measured cost.

D2 measured: with the opaque passes unblended, the depth pre-pass covers 9 of
the converted test Avatar's 11 primitives and does most of the saving, so it
stays. Exact comparisons separated the two changes:

- Blending off alone (same frame, SwiftShader, DPR 2, pre-pass disabled):
  0 differing RGB or alpha bytes over 380,619 covered pixels.
- With the pre-pass covering the unblended primitives: one pixel per frame
  differs, a multisample edge sample (RGB delta 4, alpha 255 against 191 in
  the probe; delta up to 21 in `animation:render` sheets). The pre-pass skins
  with three.js, which differs slightly from lilToon's skinning, so at a
  silhouette it can cover a sample the surface does not.
- `animation:render` of the shy-finger-poke loop at 0, 0.5 and 1 s, patched
  against unpatched, `effects:render --diff --threshold 0`: 3 of 3,864,832
  pixels (the same face-tile pixel in each row), max channel delta 21; the
  same with the hair outline's vertex-colour mode off: 3 pixels, so the hair
  outline defect is not involved.

Measured (saturated, `--frames 400 --rounds 4 --breakdown features`, DPR 2,
alternating, under other sessions' load): patched with the pre-pass 5.54 ms
per frame (passes 5.44, 4.84, 5.41, 6.48); lilToon's own blending on opaque
surfaces 12.79 ms (+7.25); unblended without the pre-pass 11.93 ms (+6.39).
At DPR 1 the run was CPU-bound (CPU 1.71 ms against 2.29 ms frames) and showed
no difference. Paced at 60 fps (`--frames 1200 --rounds 4`): 9.56 ms against
11.14 ms with lilToon's own blending and 10.64 ms without the pre-pass. An
earlier run with only the surfaces unblended (`--apply opaque-blending`,
outlines still blended) found the pre-pass neutral; the difference is
unexplained but the later run's four rounds agree.

Check record (2026-10-27, macOS arm64, Apple M5, working tree `e1be3c2ad3ce1741e002f81e0c86eed61e039874`):

- `npx vitest run src/lib/avatar/liltoon/threeLilToonPatch.test.ts`
  (`src/frontend/web`): 4 passed; against the unpatched package (a temporary
  copy importing its `dist/index.js`): 3 failed, as expected.
- `npx vitest run src/lib/avatar`: 98 files, 1485 tests passed (2 skipped).
- `node --test scripts/effect-bench/breakdownPlan.test.ts`: 3 passed.
- `npx tsc --noEmit -p tsconfig.app.json` and `-p tsconfig.scripts.json`:
  passed; `npx eslint scripts/effect-bench/breakdown.ts
  src/lib/avatar/liltoon/threeLilToonPatch.test.ts`: passed.
- Benches and exact comparisons as above (private renders).
- Included Avatars: not rerun; three-liltoon is imported only for files that
  declare its extension, so neither the patch nor the breakdown scenario
  reaches them. The final candidate's renders cover them.

Owner gate (pending): accept the pre-pass's edge-sample difference (about one
pixel per frame on the converted test Avatar) for the measured saving, or
keep the pre-pass off for lilToon primitives.

#### Code Review #1 Findings

Independent reviewer (assigned standard tier, initial review) of the working
tree against `07a2e70b`; reused the record's checks (Phase 2 files unchanged
since tree `e1be3c2a`), ran a read-only probe. Result: blocked.

- P2-R1-F1 (required): a patch of a runtime dependency, its lockfile and
  `patchedDependencies` are "dependencies, build" changes, high risk under
  SDLC review tiers (the CI validation policy also selects every suite for
  them); Phase 3 extends the same patch.
- P2-R1-F2 (required): an opaque lilToon surface hidden with lilToon's
  `_Invisible` toggle (the shader collapses its vertices; `visible` stays
  true) was blocked from the pre-pass only by its alpha blend; unblended, it
  would take the pre-pass and leave invisible occluders (holes).
- P2-R1-F3 (required): `depthPrepass.ts` comments still said three-liltoon
  blends every material, that most converted Avatars take no pre-pass and
  that the pre-pass never changes a pixel.
- P2-R1-F4 (required): `pnpm verify` and the plan's exact comparison on an
  Included Avatar with synthetic lilToon materials were missing.
- Optional: a stale JSDoc above `setBlending`; `blendsLikeOpaque`'s doc and
  label described the unpatched state; the test's type widening was
  unnecessary (`pass` is declared, marked internal); untested branches of the
  rule (alpha factor, equation, outline overrides, cutout outline); the
  frame-cost paragraph's absolute figures could read as a slowdown;
  `patches/README.md` read as covering one patch; record entries lacked
  working directories.

#### Code Review #1 Revisions

- P2-R1-F1 accepted: Phases 2 and 3 are high risk; Phase 2 adds the full
  pre-push suite and a checks subagent before its recheck.
- P2-R1-F2 accepted: `depthPrepassBlocker` returns `hidden` for a lilToon
  surface whose `lilToonProperties._Invisible` is non-zero
  (`LilToonSurfaceFacts` gains `lilToonProperties`); a test builds the
  installed package's material with and without `_Invisible` (red before
  the fix, green after).
- P2-R1-F3 accepted: the file comment now describes unblended opaque
  surfaces taking the pre-pass and the measured edge-sample difference.
- P2-R1-F4 accepted: the Included Avatar Andrew with synthetic lilToon
  materials (its 12 alpha-tested materials as opaque `Hidden/lilToonOutline`,
  its 5 blended ones as `Hidden/lilToonTransparent`; built in scratch space
  from the Included file) rendered patched against unpatched with
  `animation:render` at 0, 0.5 and 1 s: 0 differing pixels (`effects:render
  --diff --threshold 0`). `pnpm verify` runs within the full pre-push suite
  below.
- Optional findings: all accepted (comments and label updated, test typing
  simplified, four branch tests added, frame-cost paragraph leads with the
  in-run comparison, README says "Each patch", working directories recorded
  below).

Repair check record (2026-10-27, macOS arm64, Apple M5; Phase 4 and 5 drafts
set aside, so the working tree held Phase 2 only):

- Full pre-push suite on tree `c35ca085` through
  `python3 scripts/heavy-slot.py`: `make check-test` (root) passed (328 s);
  `pnpm web:test:browser` (`src/frontend`) passed (583 s); `pnpm
  prettier:check` (`src/frontend`) passed; `pnpm verify` (`src/frontend`)
  failed in `tsc -b` on the new branch test's array of differently shaped
  property objects.
- Fix: the test's cases are typed `Record<string, number>[]` (test file
  only). `npx tsc --noEmit -p tsconfig.app.json` (`src/frontend/web`) passed;
  `pnpm verify` (`src/frontend`, heavy slot) passed on tree `1de985b0`
  (check, lint, unit tests, build; the patched three-liltoon builds into its
  own lazy chunk). The other three suite steps stay valid: the fix touches
  one unit test file they do not run or format differently.
- `npx vitest run src/lib/avatar/liltoon` (`src/frontend/web`): 55 passed
  before the typing fix; the patch tests 6 passed after it.
- The Andrew synthetic-fixture comparison ran on the patch as recorded at
  tree `e1be3c2a` (unchanged since); the `_Invisible` fix cannot affect it.

#### Code Review #2 Findings

Targeted recheck (repair round 1, high-risk tier) on tree `f51c70d2` (Phase 2
only): P2-R1-F1 to F4 and the optional items resolved, no regressions.
Non-blocking: the module comment's "opaque surfaces" was broader than the
rule; the doc's pre-pass conditions omitted the Invisible toggle; the Andrew
comparison lacked a tree; formatting of the retyped test was covered only by
the earlier `prettier:check`. Result: pass.

Independent checks (checks subagent, same tree `f51c70d2`, all from the
directories named): `pnpm install --frozen-lockfile --offline`
(`src/frontend`) passed and the patch's sha256 matches the lockfile's
`patch_hash`; `web/node_modules/@mochiya/three-liltoon` resolves to the
patched copy; `npx vitest run src/lib/avatar/liltoon
src/lib/avatar/vfx/silhouetteOverlay.test.ts
src/lib/avatar/releaseModelScene.test.ts` (`src/frontend/web`) 59 passed;
`node --test scripts/effect-bench/breakdownPlan.test.ts
scripts/effect-bench.test.mjs` 7 passed; both `tsc -p` configurations and
`npx eslint src/lib/avatar/liltoon scripts/effect-bench` passed; the patch
tests against the unpatched package failed 4 of 6 as expected (the 2 passing
guard behaviour the patch leaves alone).

#### Code Review #2 Revisions

Non-blocking notes applied by the coordinator: the module comment now says
"opaque surfaces whose blend replaces the target"; avatar-animation.md lists
the Invisible toggle among the pre-pass conditions; the Andrew tree is
recorded above; `npx prettier --check` on the five changed TypeScript files
(`src/frontend/web`) passed and `npx vitest run
src/lib/avatar/liltoon/depthPrepass.test.ts` passed on tree `6311d20a600a066e1a15afec6a01bd1fa597a9f8`.
Repair budget used: one of two rounds. Phase 2 is complete for the agent; the
owner gate (the pre-pass's edge-sample difference) remains.

### Phase 3: Morph-weight textures without per-frame reallocation

Review tier: high risk (extends the dependency patch; see P2-R1-F1).

Requirements: R2. Changes (patch): weight textures keyed by mesh (or sized to
the largest target count among a material's meshes) so a shared material
uploads changed weights only. Evaluate reading weights from a uniform array
when the count fits the vertex uniform budget, keeping the texture otherwise.

Checks: the WebGL call probe shows no texture creation per frame; morph
expressions render as before (exact comparison with an expression held);
bench before and after.

Starting source: `1f1b33c2` (Phase 4).

Implemented: the patch's `MorphWeights` keeps a weight texture per mesh
(`WeakMap`, with a set for disposal) and points the material's uniform at the
drawn mesh's texture, so alternating meshes reuse their own textures and only
changed weights upload. Reading weights from a uniform array when the count
fits was not pursued: this plan's full-clock breakdown put that prototype
(surface pass only) at −6% of the traced frame (vertex 1.42 → 0.85 ms), but
it needs a second shader path with its own uniform budget per material and
device, which belongs in three-liltoon rather than a local patch; it goes
into the upstream drafts instead (Decision Log).
`threeLilToonPatch.test.ts` drives `updateDeformationUniforms` with two meshes
of 155 and 36 targets sharing a material (red before: a new texture on every
alternation); `patches/README.md` describes the change.

Check record (2026-10-27, macOS arm64, Apple M5; Phase 5 drafts set aside;
working tree `7bdfa297fd0526d661d17c4c172047d53deaadb0`):

- `npx vitest run src/lib/avatar/liltoon src/lib/avatar/vfx/silhouetteOverlay.test.ts
  src/lib/avatar/releaseModelScene.test.ts` (`src/frontend/web`): 63 passed;
  `npx tsc --noEmit -p tsconfig.app.json` and `npx eslint src/lib/avatar/liltoon`
  passed.
- Exact comparison, Phase 3 patch against the Phase 2 patch (`animation:render`
  of the shy-finger-poke loop, which animates face shapes, at 0, 0.5 and 1 s on
  the converted test Avatar; `--diff --threshold 0`): 0 differing pixels.
- WebGL call probe of a timed frame: no `createTexture`, `deleteTexture` or
  `texStorage2D` (6 each before); `texSubImage2D` 8, the bone textures (14
  before).
- Saturated bench A/B/A (Phase 3, Phase 2, Phase 3; `--frames 600 --rounds
  3`, DPR 2): 5.83 ms (passes 7.32, 5.29, 4.88), 4.83 ms, 4.62 ms per frame.
  No measurable frame-time change under the machine's load; the change
  removes per-frame allocations and uploads rather than GPU work.
- Red before: the new test failed against the Phase 2 patch (a new texture
  on the second draw of the same mesh) and passes with this one.
- Commands: the call probe is a scratch Playwright script that wraps every
  `WebGL2RenderingContext` method in the bench page and logs the calls
  between the bench's `beginQuery` and `endQuery`; the render comparison and
  the bench ran from `src/frontend/web` (`pnpm -s animation:render …
  --avatar-file …`, `pnpm -s effects:bench --avatar-file … --materials
  liltoon --saturate 10 --fps 60 --frames 600 --warmup 60 --rounds 3`), the
  Phase 2 patch selected by pointing `web/node_modules/@mochiya/three-liltoon`
  at its store copy and back.
- R6: three-liltoon is imported only for files that declare its extension,
  so Included Avatars cannot reach the patch.
- Full pre-push suite on tree `7bdfa297` (heavy slot): `make check-test`
  (root) passed (272 s); `pnpm verify` (`src/frontend`) passed (169 s);
  `pnpm prettier:check` passed; `pnpm web:test:browser` 130 of 131 passed,
  the failure being `initial-navigation-diagnostics.browser.test.mjs` ("a
  real hanging subresource still fails the original 10s load wait"), a
  timing test unrelated to lilToon that passed in Phase 2's suite and passed
  2 of 2 when rerun alone (`node --test --test-concurrency=1
  scripts/initial-navigation-diagnostics.browser.test.mjs`, heavy slot):
  a flake under load.

#### Code Review #1 Findings

Independent reviewer (high-risk tier, initial review) of tree `6f67e019`
against `1f1b33c2`: no blocking findings. Verified per-draw texture binding
(three re-reads the uniform's value on each upload), outline and auxiliary
pass ownership, disposal through `VRMUtils.deepDispose`, resizing, context
loss, and that the Phase 2 hunks are unchanged. Optional: P3-R1-F1 no test
asserts that disposing the material releases every mesh's texture (a rebase
restoring upstream's `dispose` would leak); P3-R1-F2 the uniform-array
rationale cited #691's paced figures instead of this plan's full-clock one
and did not answer the "when it fits" fallback; P3-R1-F3 record details
(probe command, red-before run, working directories, R6 reasoning);
P3-R1-F4 the README's upgrade advice named only the blending change.
Observation: a shared material alternating between meshes of different
target counts still flips `MORPHTARGETS_COUNT` per draw, re-selecting the
program (CPU work); noted for the upstream drafts.

#### Code Review #1 Revisions

All four accepted: tests assert that disposing the material fires `dispose`
on both meshes' textures and that a mesh's texture is replaced (and the old
one disposed) when its target count changes; the rationale above; the record
details above; the README's upgrade advice.

Revision check record (tree `28f092f7`): `pnpm verify` and `pnpm
prettier:check` (`src/frontend`, heavy slot) passed. Independent checks
subagent on the same tree: `pnpm install --frozen-lockfile --offline` passed
and the patch's sha256 (`000df545…`) matches the lockfile's `patch_hash`;
`npx vitest run src/lib/avatar/liltoon src/lib/avatar/vfx/silhouetteOverlay.test.ts
src/lib/avatar/releaseModelScene.test.ts` (`src/frontend/web`) 6 files, 64
tests passed; `tsc -p tsconfig.app.json` and eslint passed; the patch tests
against the Phase-2-only package failed the shared-material test (the resize
test passes there, since upstream already reallocates on resize, so it only
guards the per-mesh path) and against the unpatched package failed 5 of 8.
The suite's `make check-test` and `web:test:browser` runs on `7bdfa297` stay
valid: the revisions changed only this unit-test file, the README and the
plan, which they do not run.

#### Code Review #2 Findings

Targeted recheck (repair round 1, high-risk tier) on tree `28f092f7`: all
four repairs verified, no regressions (the patch and lockfile unchanged since
review #1). Non-blocking: this revision check record was missing; the
uniform-array rationale argued that the saving had been outweighed, when
Phase 2 made vertex work a larger share. Result: pass.

#### Code Review #2 Revisions

Both applied above (record and wording). Repair budget used: one of two
rounds. Phase 3 complete.

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

Starting source: `aabbff5c` (Phase 2). Done before Phase 3 because its
Animama-side work was ready and touches no patch file (Decision Log).

Implemented:

1. Runtime fallback in Animama, not the patch:
   `fallBackFromMissingOutlineColours` (`liltoon/lilToon.ts`) sets
   `_OutlineVertexR2Width` from 2 to 0 on lilToon materials none of whose
   meshes has vertex colours; `withOnDemandLilToon` wraps the VRM plugin's
   `afterRoot` to apply it and logs one warning naming the materials. Mode 1
   (width from red) is left alone: with no colours it reads full width, as
   Unity does.
2. Export: not possible in Animama's batch export. UniVRM 0.131.2's VRM 1.0
   writer (`MeshWriter.ExportMeshDivided`) writes positions, normals, the
   first UV set and skinning only, and `VRM10ExportSettings.MeshExportSettings`
   returns new settings without `ExportVertexColor`; a private test export
   with Mochiya changed to set it still had no `COLOR_0`. The fix moves to the
   upstream drafts (Phase 6); vrchat-avatar-conversion.md lists the limit.
3. `LilToonFallbackMaterialsPlugin.afterRoot` clears `vertexColors` on glTF
   fallbacks built from lilToon materials, so files that do carry `COLOR_0`
   draw Simple untinted; other materials keep glTF's multiply.
4. Verification on private copies: the converted test Avatar as exported now
   loads with the fallback, and the bang-tip dark band is gone; a copy with
   the author's colours injected from the Unity meshes (UniVRM keeps each
   submesh's vertices in source order, so the mapping is exact) draws thin,
   tapered tips like Unity.

Check record (2026-10-27, macOS arm64, Phase 5 drafts set aside, working tree
`8a3f9b8b5b5d70b6fcb9e7b168ffc46d5a3ca98d`):

- New tests in `lilToon.test.ts` with a synthetic triangle glTF (optional
  `COLOR_0`): the fallback to mode 0 without colours and the colour-free
  Simple fallback failed before the change and pass after it; mode 2 kept
  with colours passes.
- `npx vitest run src/lib/avatar/liltoon src/lib/avatar/Avatar`
  (`src/frontend/web`): 12 files, 107 passed (1 skipped).
- `npx tsc --noEmit -p tsconfig.app.json`, `npx eslint` and `npx prettier
  --check` on `lilToon.ts` and `lilToon.test.ts` (`src/frontend/web`):
  passed.
- Private renders (`animation:render`, SwiftShader): bang crops as exported,
  with the fallback, and with injected colours.

#### Code Review #1 Findings

Independent reviewer (standard tier, initial review) of tree `a94fdcdb`
against `aabbff5c`; reused the record and reran the loader, Included-baseline
and material-mode tests (73 passed). Result: blocked.

- P4-R1-F1 (required): no test asserted the load warning R3 requires.
- P4-R1-F2 (required): moving R3's export half upstream changes an agreed
  requirement; it needs the owner's acceptance at this phase's gate.
- P4-R1-F3 (required): the planned check "Simple renders unchanged with
  `COLOR_0` present" had no render evidence.
- Optional: the fallback is decided per material copy (GLTFLoader clones
  materials per mesh flag set, so coloured and uncoloured meshes never share
  one), not per glTF material as written, and the warning could repeat a
  name; the function needlessly exported; no `featureSet.outline` check, so a
  non-outline material with a stale mode 2 would be changed and named; the
  decision not to warn for mode 1 unrecorded; mode 0 uses the outline vector
  texture when present; the fallback plugin traversed every file; stale
  JSDoc; "UVs" for "the first UV set"; the Progress line.

#### Code Review #1 Revisions

- P4-R1-F1 accepted: both colour tests spy on `console.warn` (the logger's
  sink): one warning with `{ materials: ["Skin"] }` without colours, none
  with them.
- P4-R1-F2 accepted: the owner's decision is pending (see Decisions); the
  phase stays open until it is recorded.
- P4-R1-F3 accepted: `effects:render library:blush --times 0.5 --views
  front,face --materials simple` on the converted test Avatar as exported and
  on the copy with `COLOR_0` injected, `--diff --threshold 0`: the only
  differing pixels are the sheet's file-name labels (rows 8–21); the render
  tiles below the 28 px header are identical.
- Optional findings accepted: the docs and comment say "on meshes without
  vertex colours" and explain the material copies; names are de-duplicated;
  the function is module-private; `isVertexColourOutline` requires
  `featureSet.outline`; mode 1 is documented as needing no fallback; mode 0
  mentions the outline vector texture; `LilToonFallbackMaterialsPlugin.afterRoot`
  returns early for files without the extension; JSDoc updated; the
  conversion guide says "the first UV set".

Repair check record (same environment, tree `517dd0bd92a5b398b3694876ab19be5f2646c1d1`): `npx vitest run
src/lib/avatar/liltoon src/lib/avatar/Avatar
src/lib/avatar/configureAvatarGltfLoader src/lib/avatar/includedAvatarBaselines
src/lib/avatar/avatarMaterialMode` (`src/frontend/web`) passed; `npx tsc
--noEmit -p tsconfig.app.json`, eslint and `prettier --check` on `lilToon.ts`
and `lilToon.test.ts` passed.

#### Code Review #2 Findings

Targeted recheck (repair round 1) on tree `851f1ebf`: P4-R1-F1 and F3 fixed,
F2 correctly recorded as pending owner decision D7, optional items applied
without regressions. Non-blocking: mode 1's "as in Unity" holds only for
meshes without colours in Unity; on exports that drop them its tips are
heavier too. Result: pass; the phase closes when the owner records D7.

#### Code Review #2 Revisions

The mode 1 wording in avatar-animation.md and the function's JSDoc now says
so (comment and doc text only; `npx prettier --check` and eslint on
`lilToon.ts` passed). Repair budget used: one of two rounds.

### Phase 5: Unity parity report and fixes

Review tier: high risk (raised: the fix extends the dependency patch).

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

Starting source: `856db32d` (Phase 3).

Implemented:

- Tooling: `pnpm -s avatar:parity-render` (`scripts/liltoon-parity.mjs`,
  `scripts/liltoon-parity/`; argument tests in `liltoon-parity.test.mjs`)
  renders the rest pose (body, face, face from its right) with one white key
  light (intensity 1 from (1, 2, 2)) and white ambient light (0.35, plus
  three-liltoon's own 0.05), no tone mapping, sRGB, on SwiftShader, and writes
  `views.json`. `scripts/avatars/unity/AnimamaReferenceRender.cs` renders the
  same views in Unity (prefab T-posed as for export; X mirrored between the
  two coordinate systems; colours converted for Unity's linear project).
  The conversion guide's new "Compare with Unity" section documents both.
- Fix (patch): the 12 generated vertex shaders that normalize the SH
  direction for OpenLit's indirect light now use no direction when it is
  zero (`dot(S, S) < 1e-12 ? vec3(0.0) : normalize(S)`), giving the constant
  term as indirect light. Test: every SH-direction `normalize` in the
  `lilToon`, cutout and transparent vertex shaders is guarded (red before).

Verifying the reference (Unity, private project copy, batch mode with
graphics): Unity's lighting state matched the request (linear colour space,
forward path, key light 1.0, ambient probe 0.4). With a perfectly flat
ambient, Unity's lilToon output did not depend on the light direction at all
(mirrored and back-lit renders identical; a sphere with the hair material
showed no shading even with a black shadow colour, while a new lilToon
material shaded normally). A per-property bisect traced this to
`_ShadowEnvStrength` with the MatCap; the cause is OpenLit's
`normalize(SHA.rgb)` on a zero vector. With a barely directional trilight
(sky 1% brighter than ground) Unity's result is defined and tends to the
constant term, so the reference uses it.

Differences (R4), converted test Avatar, matched views at 640×800; share of
pixels differing from Unity by more than 8 (and 24) of 255:

| View | Before the guard | With the guard | With colours restored |
|---|---|---|---|
| face | 2.9% (1.5%) | 2.8% (1.8%) | 2.5% (1.5%) |
| face from its right | 10.8% (1.8%) | 3.4% (2.1%) | 3.0% (1.8%) |
| body | 1.6% (1.0%) | 1.1% (0.8%) | 1.1% (0.8%) |

("Before the guard" compares the colour-restored copy with Unity's trilight
render, from a first version of the parity page that applied Animama's rest
normalization; the other columns come from the repaired page and Unity script
(see the Code Review #1 revisions), which changed only the body view's arms
and hands. Restoring the second UV set as well changed no pixel.)

| Difference | Cause | Status |
|---|---|---|
| Lit areas | none: identical to within 1 of 255 at every sampled point | matches |
| Dark patches at hair bang tips | outline vertex colours dropped by UniVRM's VRM 1.0 writer | runtime fallback (Phase 4); export upstream (D7) |
| Shadowed hair, sleeves and face side darker | OpenLit's indirect light undefined for the web ABI's directionless ambient | fixed (this phase) |
| Bag strap and overalls under the jacket | authored blendshape weights (a shape key at 100) not exported | export upstream; not fixable in Animama without the data |
| Soft highlight band on the hair (+3 to +10 of 255) | the hair's MatCap contributes nothing in Animama, with or without the second UV set or its blend mask; cause not identified | open (Phase 6 asks upstream) |
| Outline and silhouette edges (about 1–2% of pixels) | sub-pixel rasterization and outline width differences | not pursued |
| The app's look (tone mapping, enhanced lights) | excluded from parity renders by design (D4) | owner's call |

Check record (2026-10-27, macOS arm64, Apple M5):

- Red before: the SH-guard test failed against the Phase 3 patch (one
  unguarded use, none guarded) and passes with this one.
- Full pre-push suite on tree `50b6c9fa` (heavy slot): `make check-test`
  (root) passed (218 s); `pnpm verify` (`src/frontend`, including
  `test:source:unit` with `liltoon-parity.test.mjs`, `tsc -b` covering
  `scripts/liltoon-parity/parity.ts`, lint and the build) passed (109 s);
  `pnpm web:test:browser` passed 131 of 131 (525 s); `pnpm prettier:check`
  passed.
- Renders (`src/frontend/web`): `pnpm -s avatar:parity-render
  --avatar-file <file> --out <private-dir>` for the converted test Avatar as
  exported, with colours injected, and with colours and the second UV set
  injected; Unity: `AnimamaReferenceRender.Render` on a private copy of the
  Unity project (batch mode with graphics) from the same `views.json`;
  differences counted per channel above 8 and 24 of 255 (scratch script
  equivalent to `effects:render --diff`).
- R6: three-liltoon is imported only for files that declare its extension,
  so the guard cannot reach the Included Avatars; the parity tooling is a
  review tool.

#### Code Review #1 Findings

Independent reviewer (high-risk tier, initial review) of tree `376d58bf`
against `856db32d`. Verified: all 12 SH-direction `normalize` sites in the
installed package are guarded and that is the patch's only change; the
guarded value is the limit of OpenLit's `shMin` as the SH direction
vanishes; the Unity coordinate, light and colour conversions; no private
data in tracked files. Result: blocked.

- P5-R1-F1 (required): editing the plan removed the Phase 6 heading and
  duplicated Phase 5's tier line.
- P5-R1-F2 (required): no Phase 5 check record.
- P5-R1-F3 (required): the parity page called `prepareLoadedVrm`, whose rest
  normalization re-poses arms and hands toward VRoid's rest, while Unity
  renders the exported rest.
- Optional: P5-R1-F4 the CLI resolved relative paths from the package, not
  the caller (`INIT_CWD`), and printed a stack for a missing file; P5-R1-F5
  the guard test covered 3 of 12 shaders and matched only `: normalize`;
  P5-R1-F6 doc wording (the comparison section omitted the open differences;
  delivery evidence in a runtime doc; a repeated "second UV set"); P5-R1-F7
  Unity script robustness (assert Linear, force a pixel light, no reflection
  probe, read back RGB); P5-R1-F8 the light-direction `normalize` can also
  see zero with no directional light and a zero override (upstream
  behaviour, for Phase 6); the tier raise lacked a Decision Log entry.

#### Code Review #1 Revisions

All accepted: Phase 6's heading restored and its list extended (F1, F8);
this record (F2); `parity.ts` no longer calls `prepareLoadedVrm` (re-render:
only the body view changed, 1.3% to 1.1% of pixels over 8 against Unity;
face views identical) (F3); the CLI resolves from `INIT_CWD` and prints a
missing file's message with exit 2 (F4); the guard test covers the eight
surface families' vertex shaders and asserts the whole guarded expression
(F5); docs reworded (F6); the Unity script requires the Linear colour space,
forces a per-pixel key light, sets no reflection probe and reads back RGB, and
the re-rendered Unity views gave the same face-view figures (F7); Decision Log
entry added.

Repair check record (tree `04476235`): `pnpm verify` (`src/frontend`, heavy
slot) passed, including the parity argument tests, `tsc -b` and lint, and
`npx vitest run src/lib/avatar/liltoon/threeLilToonPatch.test.ts` passed 9 of
9; `pnpm prettier:check` passed. The suite's `make check-test` and
`web:test:browser` runs on `50b6c9fa` stay valid: the repairs touched the
parity tool, a unit test, the Unity script and docs, none of which they run.

#### Code Review #2 Findings

Targeted recheck (repair round 1, high-risk tier) on tree `220265a3` (the
repair tree plus this plan's records): P5-R1-F1 to F8 and the tier-log entry
fixed, no regressions; the RGB24 readback works with `effects:render --diff`,
which reads both images with an alpha channel. Non-blocking: one doc bullet
wrapped wider than the file; three blank lines in this section; a render
failure inside the parity tool still exits with a stack trace where the
sibling tools print the message and exit 1. Result: pass.

Independent checks (high-risk tier, same tree, `src/frontend` and
`src/frontend/web`): `pnpm install --frozen-lockfile --offline` up to date
and the patch's SHA-256 matches the lockfile; the installed chunk has 12
guarded SH-direction `normalize` sites and none unguarded; `npx vitest run
src/lib/avatar/liltoon src/lib/avatar/vfx/silhouetteOverlay.test.ts
src/lib/avatar/releaseModelScene.test.ts` 65 of 65; `node --test
scripts/liltoon-parity.test.mjs scripts/effect-bench.test.mjs` 6 of 6; `tsc
--noEmit` for `tsconfig.app.json` and `tsconfig.scripts.json`, and eslint on
the touched files, clean; the guard test run against the Phase 3 package
fails only the SH-direction test (red without the guard); the parity CLI's
`--help` exits 0 and a missing file exits 2 with one message line.

#### Code Review #2 Revisions

The doc bullet and blank lines are fixed (text only). The parity tool's
render-failure message is deferred to Phase 7, whose integration review
covers it. Repair budget used: one of two rounds. Phase 5 complete.

### Phase 6: Upstream texts

Review tier: light.

Requirements: R5. Draft issues or pull requests: three-liltoon (opaque
blending, morph-weight reallocation and the per-draw morph-count define flip,
absent vertex colour, the SH-direction guard, the hair MatCap contribution
found missing in Phase 5, and the light-direction `normalize` that can still
see zero when no directional light exists and an authored override is zero);
Mochiya Avatar Tools (exporting the vertex colours and second UV set lilToon
reads, and authored blendshape weights). Nothing is posted without the
owner's approval of the exact text.

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
