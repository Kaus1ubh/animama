# Authored lilToon materials: frame cost and Unity fidelity

Status: Agreed
Snapshot of https://github.com/raymond-van/animama/issues/752 (published and
captured 2026-10-27T17:54:01Z); the issue is authoritative.
Owner decision: The owner asked for this work on 2026-10-27, reported the hair
bang difference the same day and approved publishing this spec as drafted.

## Problem and intended users

Converted VRChat Avatars carry their authored lilToon materials in Mochiya's
`MOCHIYA_materials_liltoon` glTF extension, and Animama renders them with
`@mochiya/three-liltoon` (0.1.9, MIT, labelled alpha). Users who upload such an
Avatar get its intended look, but at a cost, and the look is not yet Unity's:

- **Cost.** On the reference machine (Apple M5, chat canvas, 60 fps paced) the
  converted test Avatar takes about 5.6–5.8 ms of GPU time per frame with
  lilToon, against 1.0–1.6 ms with the Simple materials and 2.0–2.3 ms for the
  Included Avatars (#691, Phase 9 measurements). About 4–5 ms of it does not
  grow with resolution. Turning features off saves only 1–3 ms, and Animama's
  depth pre-pass covers none of the Avatar's primitives because three-liltoon
  blends alpha on every material. The owner prefers lilToon over Simple even
  at lower frame rates, so a cheaper lilToon helps every machine that runs it.
- **Measurement.** A first GPU trace shows one render pass per frame, about
  1 ms of vertex work and the rest fragment work, and the GPU in a reduced
  clock state most of the time. Paced timer readings therefore scale with the
  clock state and understate savings. With the GPU kept busy (full clock),
  the same lilToon frame takes about 2.2–2.8 ms against about 1 ms for the
  Simple materials and an Included Avatar, and still barely grows with pixels.
  This suggests a costly fragment shader run over many small triangles, with
  blending enabled on every material, which defeats the GPU's hidden-surface
  removal. three-liltoon also reallocates morph-weight textures every frame
  when one material is shared by meshes with different morph-target counts.
- **Fidelity.** Renders differ from Unity's lilToon. The owner saw dark patches
  in the hair bangs that Unity does not draw. First diagnosis: the hair material
  takes its outline direction and width from baked vertex colours (lilToon's
  `_OutlineVertexR2Width` = 2). The source meshes carry those colours, but the
  exported file has no vertex colours, so three-liltoon substitutes white. The
  outline is then pushed along tangent + bitangent + normal at about 1.7 times
  its width, through the thin bang tips. Other differences have not been
  compared under matched conditions yet.

## Goals, scope and non-goals

Goals: explain and reduce the frame cost of authored lilToon materials, and make
Animama's lilToon output match Unity's for the same model, pose, camera and
lights, listing every remaining difference with its cause.

In scope:

- a GPU frame capture and per-frame accounting of a lilToon Avatar;
- cost reductions in three-liltoon's shaders and passes as Animama uses them;
- Animama's lilToon integration (lighting, material and pass mapping);
- the conversion path: Mochiya Avatar Tools as driven by Animama's batch export;
- matched Unity and Animama reference renders of converted test Avatars;
- upstream issue or pull request texts for three-liltoon and Mochiya Avatar
  Tools.

Non-goals:

- the per-Avatar Materials setting, Automatic's GPU check and frame-rate caps
  (#744);
- Unity facilities three-liltoon documents as unsupported (additional lights,
  Unity shadows, light probes, AudioLink, fur shadows), unless a visible
  difference traces to one and closing it is cheap;
- the Included Avatars' MToon rendering.

## Required behavior

- R1 Frame accounting: a recorded breakdown of one lilToon frame of the
  converted test Avatar (draws, passes, vertex and fragment work, uniform and
  texture uploads) that accounts for the resolution-independent floor.
- R2 Lower cost: authored lilToon materials take measurably less GPU time per
  frame on the reference machine, measured at a known GPU clock state (for
  example with the GPU kept busy) as well as paced like the app. Target: about
  an Included Avatar's cost at the chat canvas; the plan sets the final figure
  once R1 explains the floor. A reduction changes no pixels unless it is an R4
  fix or the owner accepts a stated difference.
- R3 Vertex-colour outlines: a material whose outline reads vertex colours
  renders its outline as in Unity. The export keeps the colours lilToon reads
  without tinting the glTF fallback materials, and the runtime falls back to the
  mesh normal with a load warning when a material asks for colours the file
  lacks. The hair bangs show no dark patches.
- R4 Unity parity: matched Unity and Animama renders of the converted test
  Avatar(s); each difference is listed with its cause and marked fixed or not
  fixed with a reason. Differences traced to three-liltoon's translation,
  Animama's mapping or the export are fixed where practical.
- R5 Upstream: fixes that belong in three-liltoon or Mochiya Avatar Tools are
  drafted as issue or pull request texts. Nothing is posted upstream without the
  owner's approval of the exact text. Animama carries a local patch until an
  upstream release includes the fix.
- R6 No regressions: Included Avatars, Simple materials and files without the
  lilToon extension render and cost exactly as before.

## Constraints

- Test Avatars are third-party and private: their files, textures, renders,
  captures and shape data never enter the repository, issues, pull requests or
  upstream posts, and they are not named there. Evidence is counts, timings and
  pass/fail. Tests use synthetic fixtures or Included Avatars with synthetic
  additions.
- WebGL2 only (three-liltoon has no WebGPU path). Reference machine: Apple M5,
  Chromium with ANGLE Metal; Electron uses the same path.
- three-liltoon stays a lazily loaded chunk; its size should not grow
  noticeably.
- Unity exports and reference renders run with graphics (never `-nographics`).
- GPU timings are taken with each scenario interleaved with its baseline in one
  run, because other jobs share the machine.

## Acceptance criteria

- [ ] R1: the breakdown is recorded in the ExecPlan (counts and timings only).
- [ ] R2: before and after GPU time per frame from one interleaved bench run on
  the reference machine, with 0-pixel differences in private renders for every
  change that is not an R4 fix.
- [ ] R3: no dark patches in the converted test Avatar's bangs; hair outline
  width and direction match Unity's in matched renders; a synthetic fixture
  covers the absent-colour fallback and its warning.
- [ ] R4: a correctness report listing each difference, cause and status.
- [ ] R5: upstream texts drafted and either approved and posted, or held.
- [ ] R6: Included Avatars' renders (0 px) and bench unchanged; vitest, lint,
  check and the pre-push suite pass.
- [ ] Owner gate: the look in private renders and the measured cost.

## Open questions and decisions

- How fixes ship: a `pnpm patch` of three-liltoon (proposed, as with
  `@vitejs/plugin-react`), a vendored fork, or upstream first.
- How the export carries lilToon's vertex colours: glTF `COLOR_0` multiplies
  the fallback material's base colour, so an application-specific attribute may
  be needed, written by Mochiya Avatar Tools or by Animama's batch export.
- Whether Unity reference renders may come from a batch-mode editor script in
  the private Unity project (with graphics).
- If R2 lowers the cost, Automatic's threshold and frame-rate caps (#744) may
  deserve a second look.

## Spec

This issue.

## ExecPlan

`docs/plans/liltoon-cost-fidelity/liltoon-cost-fidelity-execplan.md` (to be
written after R1's capture).

## Delivery links

Parent: #691 (R11). Builds on #744.
