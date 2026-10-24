# Converted VRChat Avatars with native ARKit faces

Status: Proposal
Owner decision: Container, conversion route, material route and preset approach
chosen 2026-10-24 (see Open questions and decisions). The draft as a whole awaits
owner review.

## Problem and intended users

Many high-quality anime avatars are sold for VRChat (Avatar 3.0 Unity prefabs)
rather than as VRM files. They usually carry ARKit-named face shapes (`jawOpen`,
`mouthSmileLeft`, `browInnerUp` …) and MMD shapes, but no VRM expression presets
and no VRoid `Fcl_*` parts. The motivating example is Lapwing by kuji (BOOTH
4993931), which an individual owner has licensed and wants to use as their Anima's
Avatar.

Today such an Avatar can only reach Animama after a VRM conversion, and even then:

- Emotions and Reaction/Gesture faces key VRoid `Fcl_*` parts and VRM presets, so
  an Avatar with neither barely emotes. Missing mouth parts are dropped.
- The converter (Mochiya Avatar Tools) exports lilToon materials as flat glTF PBR
  plus a `MOCHIYA_materials_liltoon` extension the app ignores, so the Avatar
  renders flat.
- Lip sync uses the five vowel presets only; ARKit mouth shapes go unused.

Users who bring their own licensed VRChat Avatars benefit: their Avatar looks as
authored and gets full facial expression without hand-authoring VRM presets.

## Goals, scope and non-goals

In scope:

- A documented, repeatable conversion of a licensed VRChat Avatar to VRM 1.0 with
  Mochiya Avatar Tools, verified first on Lapwing.
- VRM 1.0 stays the Avatar container. ARKit-52 becomes a native face capability
  detected from an Avatar's morph-target names.
- Rendering of authored lilToon materials from the Mochiya extension, subject to
  an owner look decision.
- Emotions, Reaction/Gesture face tracks and lip sync that use ARKit shapes on
  Avatars that have them.
- A tool that bakes VRM expression presets from ARKit shapes into a user's own
  `.vrm`, so the file also emotes in other VRM apps.

Non-goals and deferred work:

- Loading non-VRM Avatar formats (FBX, plain glTF, Unity prefabs) directly. The
  app's humanoid motion, VRMA, spring bones, look-at, expressions and the backend
  upload validator are all built on VRM; a second container would duplicate that.
- Face-tracking add-ons for a specific Avatar (extended shapes beyond ARKit):
  a follow-up once the owner has chosen and licensed one.
- Changing the content vocabulary of Gestures and Reactions to ARKit, AI-composed
  faces and audio-to-face models streaming `arkit_52` frames: later work.
- Converting lilToon to MToon, VRChat animator/Modular Avatar features, and
  sharing converted Avatars through content packages, Cloud or any upload.

## Required behavior

- **R1 Converted Avatars load.** A VRM 1.0 exported by Mochiya Avatar Tools from
  a VRChat Avatar registers as a Local Avatar and works on every Avatar surface
  (chat canvas, creators, previews, portraits): humanoid motion, spring bones,
  blink, vowel visemes and look-at. Unknown Mochiya extensions are ignored
  without errors.
- **R2 Face-shape names survive.** Every morph-target name the export carries is
  addressable at runtime by name, whether the exporter stored names per mesh or
  per primitive.
- **R3 Authored lilToon materials.** Materials carrying `MOCHIYA_materials_liltoon`
  render with lilToon shading. Materials without it, including every Included
  Avatar, render exactly as before in both classic and enhanced rendering. The
  lilToon runtime is not downloaded or initialized for Avatars that do not use
  it. If the owner judges the look worse than the fallback, this requirement is
  withdrawn rather than shipped.
- **R4 ARKit face capability.** On load, the app maps the 52 ARKit shape names to
  the Avatar's morph targets, tolerating case, `_L`/`_R`/`Left`/`Right` side
  forms and common face-tracking naming. The resolved coverage is available to
  the runtime and to an inspection command. ARKit shapes are then driven by their
  canonical ARKit names.
- **R5 Runtime emotions.** Each emotion group and intensity has an ARKit
  composition. An Avatar with sufficient ARKit coverage and no `Fcl_*` parts
  shows those compositions instead of the relaxed fallback or plain presets.
  Avatars without ARKit coverage behave as today.
- **R6 Reaction and Gesture faces.** Existing content is unchanged. When an Avatar
  lacks a keyed `Fcl_*` part but has ARKit coverage, the part (brow, eye or mouth)
  drives an equivalent ARKit mix; otherwise today's preset fallback applies.
  Mouths stay mostly closed under lip sync as they do on VRoid Avatars.
- **R7 ARKit lip sync.** Vowel lip sync keeps working on converted Avatars through
  their viseme presets. On Avatars with ARKit mouth coverage, vowel frames can
  shape the mouth from ARKit shapes; the owner decides after review which is the
  default.
- **R8 Baked presets.** A command writes the happy, angry, sad, relaxed, surprised
  and neutral VRM 1.0 presets, built from the same ARKit compositions as R5, into
  a copy of a user's `.vrm`. The source file is never modified and all other
  extensions, including Mochiya's, are preserved.
- **R9 Conversion guide.** Documentation covers tool versions, the lilToon
  upgrade, export, expected warnings, size limits, verification and the licence
  obligations of the user's Avatar.

## Constraints

- **Licensing.** Third-party Avatar data (source packages, FBX, textures and
  converted `.vrm`) is never committed, added to fixtures, content packages,
  Cloud, artifacts or review records, and is never uploaded through a converter's
  upload feature. Lapwing's VN3 licence forbids redistributing the data or edits.
  Tests use synthetic fixtures; evidence records describe results, not content.
- **Compatibility.** Included Avatars and existing Gestures, Reactions and
  emotions must look and behave the same on VRoid and other existing Avatars.
- **Dependencies.** `@mochiya/three-liltoon` is alpha (MIT). Its peer range
  (`three` 0.180–0.189, `@pixiv/three-vrm` 3.4–3.x) must cover the app's
  versions. Its exporter, runtime and extension versions must match its
  compatibility table.
- **Performance.** lilToon was previously dropped partly for frame cost. The
  enhanced rendering budget (well under 1 ms per frame added on the development
  GPU) applies to Avatars without lilToon; a lilToon Avatar's cost is measured
  and reported for the owner's decision.
- **Limits.** Uploads stay within the existing 100 MB VRM limit. Converted
  Avatars that exceed it are reduced before import, without dropping extensions.
- **Packages.** The content-package glTF extension allowlist is unchanged, so a
  converted Avatar carrying Mochiya extensions cannot be exported in a package.

## Acceptance criteria

- [ ] R1/R2: a converted Lapwing registers through the ordinary Avatar upload on a
  local stack and passes owner-observed checks of motion, springs, blink,
  visemes and look-at; the inspection command lists its ARKit and MMD shapes by
  name. Unit tests cover both name-storage forms with synthetic glTF.
- [ ] R3: owner go/no-go on the lilToon look from review renders and live view;
  Included Avatar review renders are pixel-identical to `main` in classic and
  enhanced rendering; a production build loads no lilToon code for a VRM without
  the extension; measured frame cost is recorded.
- [ ] R4: unit tests resolve ARKit coverage for canonical, case-variant, side-variant
  and face-tracking names, and report missing shapes.
- [ ] R5/R6: unit tests show the resolution order on ARKit, VRoid and preset-only
  Avatars; review renders of the six emotions and a sample of Reactions and
  Gestures on Lapwing pass owner review; Included Avatar renders are unchanged.
- [ ] R7: owner review of lip sync on Lapwing with viseme and ARKit shaping, and
  the chosen default recorded.
- [ ] R8: tests on a synthetic VRM show the presets written, other extensions
  preserved and the source untouched; the baked Lapwing file loads with its
  presets.
- [ ] R9: the guide lets a reader repeat the conversion; the licence constraint
  holds (no third-party Avatar data in Git history or review records).

## Open questions and decisions

Decided by the owner, 2026-10-24:

- VRM 1.0 remains the container; ARKit is added as a native face capability.
- Convert with Unity and Mochiya Avatar Tools; the owner installs Unity and signs
  in, and supplies the Avatar files outside the repository.
- Retry `@mochiya/three-liltoon` for materials exported with authored lilToon
  settings (an earlier trial in #581/#587 converted MToon settings to lilToon by
  approximation and did not look good on VRoid Avatars).
- Provide both baked presets and runtime ARKit compositions.

Open (agent proposals in the ExecPlan Decision Log):

- Whether runtime ARKit compositions take precedence over an Avatar's own
  authored presets.
- The default lip-sync shaping on ARKit Avatars (decided at the R7 review).
- Where the owner keeps third-party Avatar files and converted `.vrm` outside
  the repository.

## Spec

This document (draft; the owning issue becomes authoritative on publication).

## ExecPlan

[vrchat-arkit-avatars-execplan.md](vrchat-arkit-avatars-execplan.md)

## Delivery links

None yet.
