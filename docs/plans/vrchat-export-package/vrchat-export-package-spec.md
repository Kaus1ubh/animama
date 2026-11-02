# Export a VRChat Avatar for Animama without the Animama source

Status: Agreed
Snapshot of https://github.com/raymond-van/animama/issues/795 (published
2026-10-29T16:48:47Z; updated 2026-10-29T17:06:25Z and 2026-11-02T19:12:40Z;
captured 2026-11-02T19:12:40Z); the issue is authoritative.
Owner decision: 2026-10-29: offer both a Unity editor window and a standalone
command line; accept the proposed answers to Q1–Q8. Later the same day:
support and verify macOS and Windows together, replacing "macOS first, Windows
later". 2026-11-01: rename the tool to `animama-avatar-converter` and publish
the command to npm, replacing Q5's names and Q8's `npx github:` form.
2026-11-02: release v0.1.0 before the Windows checks, which stay open.

## Problem and intended users

Many people who want a companion Avatar already own one sold for VRChat: a
Unity Avatar 3.0 prefab, usually with lilToon materials and PhysBones. Animama
loads VRM files, so such an Avatar needs a VRM 1.0 export first.

PR #786 added `pnpm -s vrm:convert-vrchat`, which converts one through
[Mochiya Avatar Tools](https://github.com/mochiya-labs/unity-avatar-tools)
(MIT) in Unity batch mode
([VRChat Avatar conversion](../../frontend/runtime/vrchat-avatar-conversion.md)).
It needs an Animama checkout, Node, pnpm and the command line, and the user must
copy `AnimamaBatchExport.cs` into the Unity project by hand. That suits
developers, not the Avatar owners who would use it.

The intended users are Animama users who own a VRChat Avatar licensed for their
own use. Most already work in Unity through VRChat Creator Companion (VCC) or a
compatible manager such as ALCOM, and should be able to export it for Animama
from inside Unity. Technical users should be able to convert from a terminal
instead. Either way, they then upload the file as a Local Avatar.

## Goals, scope and non-goals

Goals:

- An Animama Unity editor package, in a new small public repository, that
  exports a VRChat Avatar to a VRM 1.0 file Animama loads well, from a Unity
  menu.
- A standalone command line, published with the package and needing no Animama
  checkout, that runs the same export on a Unity project.
- Installation through VCC (a VPM listing), with clear guidance where VCC alone
  cannot install a dependency.
- `vrm:convert-vrchat` stays a developer tool and runs the same exporter code as
  the package.
- macOS and Windows from the first release, each verified before it.

Non-goals:

- Forking Mochiya Avatar Tools or UniVRM. Fixes go upstream; the package calls
  their public editor APIs.
- Uploading anything anywhere. The package makes no network requests, never
  calls Mochiya's upload workflow and never mentions it in its interface.
- Converting VRChat animator logic (gesture expressions, toggles), PhysBone
  grabbing and stretching, or contacts. Animama drives faces and springs itself.
- Upgrading an Avatar's lilToon automatically. The package detects an
  unsupported version and explains the fix.
- Optimizing end users' exports (Q3). Uploads keep the exported bytes; the
  developer command still optimizes.
- Avatars that need a Modular Avatar build (Q6). The window and command line
  detect them and say they are not supported yet.
- Hosted (Animama Cloud) Avatar settings, tracked in
  raymond-van/animama-cloud#229.

## Required behavior

- **R1 Export menu.** With the package installed, `Animama > Export for
  Animama…` opens a window. The user chooses an Avatar (a prefab, or an Avatar
  root in the open scene), an output file and the VRM metadata fields (name,
  version, author, copyright). Defaults come from the prefab name and leave
  UniVRM's restrictive permissions in place (only the author may use it; no
  redistribution or modification).
- **R2 Same export as the CLI.** The export does what `AnimamaBatchExport` does
  today: instantiates the prefab in a new scene without changing the source
  assets or the user's open scene, strips `EditorOnly` objects as a VRChat build
  does, poses the humanoid T-pose (with an option to keep the modelled pose),
  then runs Mochiya's Detect, Validate and Export. For the same project, prefab
  and options it writes a file equivalent to `vrm:convert-vrchat --no-optimize`
  (same `vrm:inspect` report).
- **R3 Readable validation.** Validation runs before export and errors block it.
  The window lists errors and the expected warnings (animator state machines,
  visemes and blink, PhysBones, colliders) in plain language, with what each
  means in Animama. A failed export leaves no partial output file.
- **R4 Licence notice.** Before the first export in a project, the window states
  that the user may convert only an Avatar whose licence allows conversion for
  their own use, that the file is written only to their computer, and that the
  Avatar and its export must not be redistributed unless its licence allows it.
  The user acknowledges it once per project.
- **R5 Version checks.** The package checks the Unity editor, UniVRM/UniGLTF,
  Mochiya Avatar Tools and lilToon versions against the supported range (Q4).
  Outside it, the window names the component, the found and required versions
  and the fix, and disables export rather than producing a degraded file.
- **R6 Dependency installer.** When UniVRM/UniGLTF or Mochiya Avatar Tools is
  missing, the package still compiles, says what is missing and, after the user
  agrees, adds the pinned Git URLs to `Packages/manifest.json`. If Git is not
  installed, it says so and links Git's download page. It never changes the
  manifest without asking.
- **R7 Standalone command line.** A command published with the package converts
  a prefab in an existing Unity project without opening the editor UI: it
  locates the project's Unity editor (or takes one as an option), adds the
  package and its dependencies to the project if missing, refuses while the
  project is open in Unity, runs the R2
  export and validation in batch mode with graphics, writes the Unity log beside
  the output and prints the same validation report as the window. It accepts
  the same metadata and keep-pose options and never overwrites a file. Exit
  status is zero only when a file was written.
- **R8 Developer command.** `vrm:convert-vrchat` runs the standalone command at
  the pinned package revision, replacing the copy-and-compare of
  `AnimamaBatchExport.cs`, then optimizes and inspects the result as today. Its
  flags and outputs stay as documented.
- **R9 Documentation.** An end-user guide covers installation, export from the
  window and the command line, the licence notice, expected warnings, known
  export limits and uploading. The developer conversion doc points at the
  package instead of the copied script.

## Constraints

- **Licences.** Mochiya Avatar Tools is MIT (checked 2026-10-29, version 0.1.6),
  as is UniVRM. The package is MIT and carries its dependencies' notices for
  anything it redistributes (Q2).
- **Third-party Avatars.** No VRChat Avatar data, export, render or shape data
  enters the package repository, this repository, tests or public evidence, and
  issues and PRs never name the test Avatars or their authors. Evidence is
  counts, timings and pass/fail. Package tests use a synthetic humanoid built in
  the test or a CC0 model.
- **No network.** The package contains no network code; review confirms it.
- **Graphics required.** Export reads compressed textures back through the GPU,
  so batch use keeps graphics enabled (never `-nographics`).
- **Repository boundary.** The package repository depends on nothing in this
  repository at build or run time. This repository's developer command may
  fetch the published package by revision.
- **Publication.** Creating the public repository, publishing the VPM listing
  or the npm package and contacting upstream projects each need the owner's
  approval.

## Acceptance criteria

- [ ] In a fresh VRChat Avatars project on the supported Unity version, adding
      the listing and following the guide installs the package and, through R6,
      its dependencies without command-line steps; the `Animama` menu appears
      with no compile errors. Evidence: a recorded walkthrough on macOS and on
      Windows (VCC).
- [ ] Exporting the converted test Avatar from the window produces a file whose
      `vrm:inspect` report matches `vrm:convert-vrchat --no-optimize` for the
      same prefab, and the source prefab and open scene are unchanged. Evidence:
      report comparison (counts only) and a clean `git status` of the project's
      assets.
- [ ] A prefab with an `EditorOnly` garment exports without it.
- [ ] An Avatar with an unsupported lilToon version, or a project missing a
      dependency, shows the named version problem and cannot export. Evidence:
      package editor tests plus one manual check.
- [ ] A validation error blocks export and leaves no output file. Evidence:
      package editor test.
- [ ] The licence notice appears before the first export in a project and not
      again after acknowledgement.
- [ ] The package source contains no network calls and no reference to Mochiya
      upload APIs. Evidence: review and a source search in CI.
- [ ] The standalone command converts the converted test Avatar in a project
      that does not yet have the package, producing a file with the same
      `vrm:inspect` report as the window's export; it refuses while the project
      is open in Unity and exits non-zero on a validation error. Evidence:
      command runs on macOS and Windows, counts only.
- [ ] Uploading the window's export through Create Anima loads, animates and
      shows motion, springs, blink, visemes and look-at as the CLI export does.
      Evidence: owner manual check on the converted test Avatar.
- [ ] `vrm:convert-vrchat` converts the converted test Avatar through the
      standalone command with its documented flags. Evidence: command run,
      counts only.
- [ ] The end-user guide and developer doc describe the shipped behavior.

## Open questions and decisions

- **Q1 Package or upstream only?** Mochiya's own Avatar Tools window already
  exports VRM locally. If Mochiya stripped `EditorOnly` objects and offered a
  T-pose option, users could follow an Animama guide without any Animama
  package. Decided 2026-10-29: ship the thin package anyway, because it gives
  one menu with no upload path in sight, version checks and Animama-specific
  guidance. Offer the `EditorOnly` and T-pose behavior upstream after the owner
  approves posting.
- **Q2 How VCC installs the dependencies.** VPM packages declare dependencies
  only on packages from added listings. As of 2026-10-29, neither Mochiya
  (installed by Git URL; repository untagged) nor UniVRM publishes a VPM
  listing. Options:
  (a) the Animama listing republishes unmodified UniGLTF/VRM10 0.131.2 and
  Mochiya builds under their own package names with their licences — VCC
  installs everything, but Animama then maintains mirrors and can clash with a
  user's existing UniVRM;
  (b) the Animama package declares no VPM dependencies, and on first open adds
  the pinned Git URLs to `Packages/manifest.json` after asking (needs Git,
  which Mochiya already requires);
  (c) ask Mochiya and the VRM Consortium to publish VPM listings, then depend
  on them.
  Decided 2026-10-29: (b) now (R6), and (c) as an upstream request after the
  owner approves posting.
- **Q3 Optimizing end users' exports.** Optimization saves storage and
  transfer, not runtime cost: the converted test Avatar's export went from 21.9
  MiB to 8.2 MiB, but three.js expands textures and morph targets to full size
  at load, so GPU memory and frame cost are unchanged, and a local upload's
  transfer time is negligible. It matters for Library sharing, a future hosted
  upload and an export over the 100 MiB source limit (unlikely; the test export
  is 22 MiB). Decided 2026-10-29: defer to its own issue (drafted, not yet filed); if taken up, Electron
  main would reuse `vrm-optimize.mjs` rather than a second implementation in
  the backend.
- **Q4 Supported range.** Decided 2026-10-29: Unity 2022.3 LTS (VRChat's
  current editor); UniVRM/UniGLTF 0.131.2 exactly; lilToon 2.3.4 or later within
  2.x; Mochiya pinned to a commit, moving from `d98e9091` (0.1.4) to `0826f6e3`
  (0.1.6), whose changes since 0.1.4 touch only its upload code and docs.
  macOS and Windows are supported and verified together (owner, later on
  2026-10-29, replacing "macOS first").
- **Q5 Names and hosting.** Decided 2026-10-29: repository
  `raymond-van/animama-avatar-export`, package `com.animama.avatar-export`,
  listing served from that repository's GitHub Pages (or the R2 release
  bucket). Renamed 2026-11-01 (owner): repository
  `raymond-van/animama-avatar-converter`, Unity package
  `com.animama.avatar-converter` ("Animama Avatar Converter"), listing on that
  repository's GitHub Pages.
- **Q6 Modular Avatar.** Decided 2026-10-29: out of scope for the first
  release; detected and explained, and documented as unsupported.
- **Q7 Vertex colours.** The missing vertex colours that lilToon's hair outline
  reads come from UniVRM 0.131.2's VRM 1.0 mesh writer, not from Mochiya
  itself. Decided 2026-10-29: report it to UniVRM (with Mochiya informed), after
  the owner approves posting. Not a blocker.
- **Q8 Form of the standalone command (R7).** It needs a runtime that edits
  `manifest.json` safely and runs on macOS and Windows. Options:
  (a) a Node script in the package repository, run with
  `npx github:raymond-van/animama-avatar-export` (Node 20 or later; no npm
  publication), which also becomes the core of `vrm:convert-vrchat`, so the
  conversion logic lives in one place; (b) a shell script for macOS and a
  PowerShell script for Windows: no runtime to install, but two
  implementations and hand-rolled JSON editing. Decided 2026-10-29: (a).
  Amended: Node 22 or later (Node 20 reached end of life); 2026-11-01 (owner):
  published to npm as `animama-avatar-converter` and run in the project's
  folder as `npx animama-avatar-converter [<prefab>]`, replacing
  `npx github:` and "no npm publication".
  Creating a new
  project from the Avatar's `.unitypackage` files needs VRChat's `vpm` tool and
  per-Avatar choices, so the command starts from an existing project; project
  creation can follow later.

## Spec

https://github.com/raymond-van/animama/issues/795

## ExecPlan

Required: the work spans a new repository, a distribution channel, two user
interfaces, the developer command and verification on two platforms.
[`docs/plans/vrchat-export-package/vrchat-export-package-execplan.md`](vrchat-export-package-execplan.md)
on `feat/vrchat-export-package`.

## Delivery links

- Converter repository: https://github.com/raymond-van/animama-avatar-converter
  (release [v0.1.0](https://github.com/raymond-van/animama-avatar-converter/releases/tag/v0.1.0),
  2026-11-02)
- VPM listing: https://raymond-van.github.io/animama-avatar-converter/index.json
- npm: https://www.npmjs.com/package/animama-avatar-converter
- Animama: https://github.com/raymond-van/animama/pull/813 (developer command, docs and records)
