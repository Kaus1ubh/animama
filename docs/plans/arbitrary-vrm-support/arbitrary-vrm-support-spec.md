# Arbitrary user-uploaded VRM Avatars

Status: Agreed
Snapshot of https://github.com/raymond-van/animama/issues/691 (published
2026-10-25T02:59:47Z, captured 2026-10-27T04:27:43Z after the owner's answers, the ADR
renumbering, the per-Avatar Materials setting, where settings are stored and the
Library and Create Anima entry points); the issue is authoritative.
Owner decision: The owner asked for this spec and its parent issue on
2026-10-24, answered its open questions on 2026-10-25 and accepted the
proposed defaults for the rest.

## Problem and intended users

Users can upload their own VRM file as a Local Avatar. The Avatar runtime was
built and tested on two Included Avatars, both VRoid exports, and much of it
still assumes VRoid conventions:

- material and mesh names;
- a dedicated face texture and a VRoid iris texture;
- separate eyelash and eye-line meshes;
- VRoid `Fcl_*` expression parts;
- a T-pose rest with VRoid hands;
- spring tuning made for VRoid hair.

Models from other tools break these assumptions. Those tools include VRChat
Avatars converted to VRM, UniVRM exports from Unity or Blender, and models
bought on BOOTH. On such models:

- Painted and floating face effects land on the wrong part of the texture, or
  leave artefacts. An eye effect such as **Eye Confused Swirl** closes the eyes but
  leaves lash lines visible under the spirals. Whole-face art (`face_red`,
  `petrified_cracks`, `texture_*`) tints every part that shares the face
  texture.
- Gestures and Reactions that key VRoid `Fcl_*` parts lose those shapes
  without warning on models that have only the VRM presets.
- Hand poses come out wrong: in **Double Thumbs Up** the thumbs tilt inward and
  the fists stay loose.
- Springs follow VRoid-tuned wind and updraft, and there is no setting to turn
  wind off for a model whose physics suffer from it.
- When detection fails, the user sees nothing. The only diagnostics are
  development-only debug panels and console logs.

Users who bring their own Avatars benefit. Their Avatar should emote, wear
effects and move as well as an Included Avatar, and when something can't work,
they should be able to see why.

Related work: PR #688 (issue #687) already handles part of this for VRChat
conversions:

- ARKit face shapes as a native capability, with `Fcl_*` mood parts translated
  to ARKit mixes;
- lilToon materials;
- no ambient spring forces for Mochiya conversions;
- painted face decals located by the face's UV island and the eyes' geometry,
  and iris art drawn around each iris.

This spec builds on that work and does not re-specify it.

## Goals, scope and non-goals

In scope, by requirement:

- **R1 Face parts without VRoid structure.** Face skin, eyes, eyelashes, eye
  lines and highlights are found from model data on models that keep several
  parts in one mesh or primitive, skin the face partly to the neck or jaw, or
  lack eye bones.
- **R2 Texture layouts.** Whole-face art and decals stay on the face's own
  texture region, whatever the texture layout.
- **R3 Eye effects.** Eye effects that hide the eyes (Eye Confused Swirl and
  similar) achieve the same look on any model.
- **R4 Expression content.** Gesture and Reaction content keyed to VRoid
  names plays on models with only the VRM presets, without silent loss.
- **R5 Wind and spring setting.** An explicit per-Avatar option controls wind
  and ambient spring forces.
- **R6 Hands.** Thumb and finger poses in Gestures look right on rigs whose
  hand rest pose differs from VRoid's.
- **R7 Avatar diagnostics.** A diagnostics modal opened from the Anima
  settings, the Library's Avatar cards and Create Anima's upload preview,
  available in production builds.
- **R8 Visible failures.** Detection and effect failures reach the user, not
  only logs.
- **R9 Rest pose and proportions.** Detect a non-T-pose rest, and scale body
  effects and hand-to-face contacts to the model.
- **R10 Enhanced rendering.** The enhanced look applies to non-VRoid MToon
  models, or it is switched off for them consistently.
- **R11 lilToon frame cost.** Find where authored lilToon materials spend
  their GPU time and reduce it, and let users choose lilToon or simple
  materials per Avatar.
- **R12 MMD face shapes.** On models with standard MMD morphs, common on
  Japanese VRChat models, moods use those morphs per face region before ARKit
  mixes.
- **R13 Package sharing.** Content packages accept Avatars whose files use
  the extensions converted and optimized models carry.

Non-goals:

- Changing the Avatar container: VRM stays (ADR 0032).
- Importing VRChat Unity packages directly.
- Converting lilToon materials to MToon in the converter. R11 may measure it
  as one option, but this issue does not implement it.
- ARKit lip-sync shaping (Phase 5 of the plan for #687).
- Hosted Animama Cloud changes.

## Required behavior

R1 Face parts:

- Detection must not require a face primitive that is mostly skinned to the
  head, eyelash or eye-line primitives separate from the face skin, or eye
  bones.
- When eyelashes or eye lines share a primitive with the face skin or the eyes,
  the runtime identifies their regions: UV islands or vertex sets that blink
  moves almost entirely. Effects can then hide or cover those regions.
- Landmarks and anchors use every primitive the face skin part lists, not only
  the first.
- Face bounds come from the face, not from a primitive that also holds the neck
  or body.
- Included Avatars detect exactly the same parts as before.

R2 Texture layouts:

- `full` painted art covers only the face skin's own texture region (its UV
  island or islands), not every part that shares the texture.
- Placement honours texture transforms (`KHR_texture_transform`, VRM 0
  tiling) and UVs outside 0–1.
- Iris art handles eyes whose UVs are mirrored per eye.

R3 Eye effects:

- While an eye effect with `forceBlink`, `hideEyeDetails` or `faceCleanup` is
  active, no lash line, eye line, highlight, eye-layer edge or open-eye detail
  shows around its art. This holds on models whose lashes, eye lines and eye
  layers sit in shared meshes or are painted into the face texture.
- Blink stays suppressed or held shut, as the effect specifies.
- Where the runtime cannot hide a detail, the effect still plays. A diagnostic
  names the detail it could not hide (R8).

R4 Expression content:

- Every `Fcl_*` name that Included content uses resolves to the closest
  available expression, or to an ARKit mix where one applies. That includes
  mouth parts (`Fcl_MTH_*`), eye parts (`Fcl_EYE_Close*`, `Fcl_EYE_Spread`,
  `Fcl_EYE_Iris_Hide`) and the mood parts.
- A name that resolves to nothing is reported once per Avatar (R8), not dropped
  silently.
- Positive emotions use a mouth smile where the model has one, rather than
  falling back to `relaxed`.
- The eyelid-closure correction measures each model's expressions instead of
  using VRoid's constants.

R12 MMD face shapes:

- Each face region (brow, eye, mouth) of a VRoid mood part or mood preset
  resolves in this order: the model's own VRoid part; its standard MMD morph;
  the ARKit mix; the VRM preset fallback (R4).
- The mapping uses standard MMD names only: brows にこり (Joy, Fun), 困る
  (Sorrow), 怒り (Angry), 上 (Surprised); eyes 笑い (Joy), なごみ (Fun),
  びっくり (Surprised), じと目 (Angry); mouths にっこり (Joy, Fun), お
  (Surprised). Regions without a standard morph (sad eyes and mouth, angry
  mouth) use the ARKit mix or the preset. Author-specific names are not
  guessed.
- MMD eye morphs that close the lids (笑い, なごみ) get the eyelid-closure
  correction, so a blink cannot close the eyes past shut.
- Content keeps its VRoid names. Diagnostics (R7) show which source each
  region uses.
- Why: on a converted test Avatar, MMD 笑い gives the closed, arched happy eyes
  of VRoid's Joy, which no ARKit mix reaches; its brow and mouth morphs move
  about as far as VRoid's parts.

R5 Wind and spring setting:

- Each Avatar has a "Wind and ambient forces" setting with three values:
  - **Automatic** (the default): as today, including no ambient forces for
    detected conversions;
  - **On**;
  - **Off**.
- A fourth value, **Springs off**, stops spring simulation entirely; springs
  hold their rest pose.
- The setting is edited from the Anima settings for the Anima's Avatar, or
  from the Avatar's card in the Library, and applies live without reloading
  the Avatar.
- It persists per owner and Avatar item, for Local and Included Avatars
  alike, outside the Avatar's file and sidecar, so saving neither creates a
  new Avatar revision nor reloads the Avatar. A Local Avatar file that is
  moved, renamed or re-added becomes a new item and starts from Automatic.
- Packages carry it with the Avatar: export writes the exporter's value into
  the Avatar's package entry, and import stores it for the importer.
- Unlike corrections, it is not bound to the VRM file's digest or the Avatar's
  revision, so an Avatar update keeps it.

R6 Hands:

- On rigs whose finger and thumb rest orientation differs from VRoid's, Gesture
  hand poses match the Included Avatars' intent: thumbs-up points up, fists
  close, pointing fingers point.
- The hand rest is normalized at load to VRoid's orientation, so existing
  poses apply unchanged. Per-rig retargeting is a fallback only if
  normalizing proves unworkable, decided with the owner.
- The fix leaves the Included Avatars' poses unchanged.

R7 Avatar diagnostics:

- The Anima settings gain a **Diagnostics** button. It opens a read-only
  modal about the Anima's current Avatar, modelled on the development VRM
  debug modal but available in production. It shows:
  - **File facts:** VRM version, glTF extensions, file size, mesh, primitive
    and material counts, material types (MToon, lilToon, PBR), texture sizes.
  - **Face:** detected parts with source (signals, names, corrected, missing)
    and confidence; landmark and anchor status.
  - **Expressions:** presets and visemes found, ARKit coverage, whether faces
    play through ARKit mixes, and expression names content uses but the model
    lacks.
  - **Motion:** rest-pose check, humanoid bones present, spring count and the
    effective wind mode.
  - **Materials:** for an Avatar with lilToon materials, the effective
    Materials mode (R11) and why.
  - **Warnings:** everything R8 collects.
- The same modal opens from an Avatar's card in the Library, for Included
  and Local Avatars, and from Create Anima's upload preview for the chosen
  file before it is saved. Effect warnings appear only when it opens from
  an Anima, since they depend on that Anima's Gestures and Reactions. A
  report for an unsaved upload names no file.
- Create Anima's upload preview shows a one-line status (checking, no
  problems found, or the number of problems) with a link to the modal. A
  file that fails to load still shows its file facts and the error there.
- A Library Avatar card also offers the Avatar's settings, "Wind and
  ambient forces" (R5) and Materials (R11), beside Diagnostics. Create
  Anima offers no settings: an unsaved upload has no Avatar item to store
  them on.
- A **Copy report** action copies a text summary for support.
- A **Raw JSON** view shows the same report as JSON, with its own copy action.
- The modal ships in local builds. Hosted builds include it only if that
  needs no hosted-specific work; it is not required there.
- The modal shows no local file paths, credentials or user content beyond the
  Avatar's own file facts. Its text is localized. It is keyboard accessible.
- The development-only debug panels stay as they are.

R8 Visible failures:

- Missing or uncertain face parts, effects skipped or degraded on this Avatar,
  unresolved expression names and a non-T-pose rest are collected per loaded
  Avatar.
- They appear in the diagnostics modal and, where the user is working on that
  Avatar, as a short notice in the Avatar Effect creator.

R9 Rest pose and proportions:

- A rest pose that is not a T-pose is detected at load and reported.
  Normalizing it at load is preferred if the plan finds it safe.
- Body effects and hand-to-face contacts scale with the measured model size,
  not fixed metres.

R11 lilToon frame cost:

- Baseline (2026-10-24; Apple M5; chat canvas 800×600 at DPR 2, so
  1600×1200 pixels; idle Gesture; no effects; `effects:bench`). GPU time per
  frame:
  - converted test Avatar with lilToon: 30.8 ms;
  - the same Avatar with its fallback materials: 0.8 ms;
  - Andrew: 1.2 ms; Annie: 1.3 ms.
  - At DPR 1 (a quarter of the pixels) the lilToon Avatar takes 6.2 ms, so
    the cost is mostly per pixel.
- Investigation: measure where the time goes. Break it down by material, by
  lilToon feature (outline, rim, matcap, shadow, emission, transparency
  passes), and by mesh layer and overdraw (stacked eye layers, eyeball domes,
  shadow meshes). Include draw calls and how the cost scales with resolution.
  Record the results as counts and timings, never shape data.
- Then reduce the cost. Levers to evaluate, none decided:
  - a lower or adaptive pixel ratio for lilToon Avatars;
  - a frame-rate cap while the Avatar is idle;
  - disabling costly features or layers;
  - lilToon on chosen materials only;
  - a low-cost mode using the fallback materials;
  - choosing automatically from measured GPU time (the Materials setting's
    Automatic value below).
- Each Avatar whose file has authored lilToon materials has a **Materials**
  setting:
  - **Automatic** (the default): lilToon, unless the machine's measured GPU
    time says it is too slow for it, then Simple;
  - **lilToon:** always the authored look;
  - **Simple:** the fallback materials.
- The Materials setting is edited beside "Wind and ambient forces", in the
  Anima settings and on the Avatar's Library card, and persists per Avatar
  the same way as that setting (R5).
  It applies when the Avatar reloads, not live, because materials are built at
  load. Avatars without lilToon materials do not show it.
- An app-wide quality setting is added only if the per-Avatar setting does not
  cover the need.
- Fallback materials from converted exports keep glTF's default metallic 1,
  which renders them dark. Wherever lilToon is not used, including Simple, the
  fallback materials render with their base colours.
- Included Avatars are unaffected.

R10 Enhanced rendering:

- The enhanced look's MToon retune applies to non-VRoid MToon materials by
  face-part role, not VRoid material suffixes.
- Otherwise, models it cannot retune get the classic look consistently, never
  a mix.

R13 Package sharing:

- Package validation accepts `MOCHIYA_avatar_composition`,
  `MOCHIYA_materials_liltoon`, `EXT_meshopt_compression` and
  `KHR_draco_mesh_compression` in an Avatar file, alongside today's list.
- An Avatar whose extensions the runtime cannot load is reported on import and
  in diagnostics (R8), not rejected silently or loaded half-rendered.
- Packages with these Avatars stay compatible with the Constraints'
  persistence rule: older installs that reject them fail with a clear error.

## Constraints

- **Included Avatars unchanged:** the same detected parts, landmark and anchor
  snapshots, and 0 differing pixels in review renders of the affected effects
  and Gestures, unless the owner accepts a specific change.
- **Licences:** tests use synthetic fixtures or Included Avatars with synthetic
  additions. No third-party Avatar data, renders or shape data enter the
  repository, issues or PRs. Owner review of licensed models uses private
  renders.
- **Load time:** detection stays within a few milliseconds per primitive. Avatar
  load time on the Included Avatars must not regress measurably.
- **Persistence:** new sidecar keys must be added to the content kind registry.
  Older installs reject unknown keys, so packages that carry the new setting
  need a compatibility decision. Included overrides follow the existing
  owner-override pattern.
- **Production modal:** localized text from the catalogs, no inline English, no
  private paths. It is safe for the hosted composition, or explicitly
  local-only.
- **Performance:** no per-frame cost for models that need none of these
  corrections.

## Acceptance criteria

- [ ] R1: unit tests on Included Avatars with synthetic additions (lashes and
  eye lines inside the face primitive; a face skinned partly to the neck; no
  eye bones) detect the parts. Included detection and snapshots are unchanged.
- [ ] R2: whole-face art on a synthetic shared-atlas face covers only the face
  region. A texture-transform fixture places decals correctly.
- [ ] R3: Eye Confused Swirl and the other eye-hiding effects show no lash, line or
  highlight artefacts on a converted test Avatar (owner review of private
  renders), with Included renders unchanged.
- [ ] R4: every `Fcl_*` name in Included content resolves on a preset-only
  synthetic model, or is reported. Positive-emotion mouths are checked by
  render.
- [ ] R5: the setting round-trips for a Local and an Included Avatar from the
  Anima settings and the Library, applies live, and Automatic matches
  today's behaviour.
- [ ] R6: Double Thumbs Up and other hand Gestures look right on a converted
  test Avatar (owner review), with Included renders unchanged.
- [ ] R7: in a production build, the modal opens from the Anima settings and a
  Library Avatar card for an Included and a Local Avatar, and from Create
  Anima's upload preview for an unsaved file, including one that fails to
  load. It shows every section, copies a report, and passes keyboard and
  localization checks.
- [ ] R8: each failure kind appears in the modal, and the creator notice
  appears for a skipped effect.
- [ ] R9: an A-pose test model is reported, or normalized. Body effects and
  contacts scale on a scaled synthetic model.
- [ ] R10: a non-VRoid MToon model never shows a mixed look (render check).
- [ ] R11: a measurement report breaks down lilToon's GPU time (bench JSON
  plus the method). The chosen reductions meet the agreed target on the
  reference machine. The owner reviews the look in private renders. Fallback
  materials render with their base colours. The Materials setting round-trips
  for a Local and an Included Avatar from the Anima settings and the Library,
  appears only for lilToon Avatars,
  Automatic follows the GPU check, and switching reloads the Avatar with the
  chosen materials. Included renders are unchanged.
- [ ] R12: on a synthetic model with MMD morphs, each mapped region plays its
  MMD morph and the others play the ARKit mix or preset; blink stays within
  shut under 笑い; Included renders are unchanged; the owner reviews private
  renders on a converted test Avatar.
- [ ] R13: a package with a synthetic Avatar using each listed extension
  exports and imports; an unloadable extension is reported.
- [ ] Docs: the avatar VFX, animation and emotion runtime docs and the user
  guide describe the behaviour.

## Open questions and decisions

Answered by the owner on 2026-10-25 (6 to 8 take the proposed defaults):

1. The wind setting lives on the Avatar and follows the model file (R5).
   Updated 2026-10-26 (owner): it is stored per owner and Avatar item rather
   than in the file's sidecar, so it applies live; a moved or re-added Local
   file starts from Automatic.
2. "Springs off" is offered as a fourth value of the setting (R5).
3. The modal is labelled **Diagnostics** and has a raw JSON view; hosted
   builds include it only if convenient (R7).
4. Hands: the rest pose is normalized at load (R6).
5. Packages may carry Avatars using the extensions converted and optimized
   models use (R13).
6. Phasing: R7 and R8 → R3 and R1 → R5 → R4 and R12 → R6 → R2 → R9 and R10,
   then R13. R11 runs alongside once PR #688 has merged.
7. lilToon target: a lilToon Avatar adds at most about as much GPU time as an
   Included Avatar at the chat canvas on the reference machine. If that is not
   reached, the cheap path is the default on slow GPUs. Updated 2026-10-26
   (owner): users choose per Avatar with a Materials setting (Automatic,
   lilToon, Simple; R11), whose Automatic value is that default; an app-wide
   quality setting is added only if still needed.
8. A model with no VRoid parts, MMD morphs, ARKit shapes or mood presets keeps
   a neutral face; moods show through motion and effects, and diagnostics say
   so. Lids are not lowered and mouth visemes are not used for moods.
9. Added 2026-10-27 (owner): Diagnostics and the Avatar settings are also
   offered on the Library's Avatar cards, and Diagnostics on Create Anima's
   upload preview (R5, R7, R11). They are delivered in the second PR.

## Spec

https://github.com/raymond-van/animama/issues/691 ("This issue" in the issue).

## ExecPlan

Required: substantial, cross-cutting work. It will be written under
`docs/plans/arbitrary-vrm-support/` after the spec is agreed, together with this
spec's snapshot.

## Delivery links

- Builds on PR #688 (issue #687); implementation starts after it merges.
