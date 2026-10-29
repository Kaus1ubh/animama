# Export a VRChat Avatar for Animama without the Animama source

Source agreement: https://github.com/raymond-van/animama/issues/795, published
2026-10-29T16:48:47Z with the owner's decisions on Q1–Q8 of the same day
(snapshot: [vrchat-export-package-spec.md](vrchat-export-package-spec.md),
commit `64e32595`).
Authorized scope: none yet; proposed Phases 1–5, each verified on macOS and
Windows. Owner gates below apply inside any authorized phase.

## Purpose and context

Today a VRChat Avatar reaches Animama only through the developer command
`pnpm -s vrm:convert-vrchat` (PR #786), which needs an Animama checkout, Node and
a hand-copied `AnimamaBatchExport.cs` in the Unity project. This plan delivers
two end-user routes that need neither, and moves the developer command onto
them:

- a Unity editor package, `com.animama.avatar-export`, with an `Animama > Export
  for Animama…` window (R1–R6), installable from a VPM listing;
- a standalone Node command in the same public repository, run with
  `npx github:raymond-van/animama-avatar-export#<tag>` (R7);
- `vrm:convert-vrchat` running that command, then optimizing and inspecting as
  today (R8);
- an end-user guide and updated developer docs (R9).

Uploads keep the exported bytes; optimizing them in the app is deferred (Q3).
Modular Avatar Avatars are detected and refused (Q6). Both routes support
macOS and Windows from the first release.

### Platforms

The Unity package, the listing and almost all of the command are platform
independent. The platform-sensitive parts are written for both platforms from
Phase 1 and unit-tested for both on any machine: Unity editor lookup (Unity
Hub's folder on each), detecting a project open in Unity (Unity's lockfile
behaves differently), `manifest.json` line endings (LF or CRLF, preserved),
paths with spaces, and moving the finished export into place while Windows
briefly holds a new file. Manual and Unity checks run on both:

- macOS (Apple Silicon, Metal), with VRChat's `vpm` tool or ALCOM;
- Windows 10 or 11 (x64, Direct3D 11), with VRChat Creator Companion.

**GW (owner):** access to a Windows machine with a GPU, Unity Hub and Unity
2022.3, VCC, Git and Node 20 or later, and the private test material copied to
a private folder there, before Phase 1's Windows checks. Without it, the
Windows checks of every phase stay open and block the release (G3).

### Repositories and working directories

| Repository | Checkout | Branch | Contents |
| --- | --- | --- | --- |
| `raymond-van/animama` | the task worktree for this plan | `feat/vrchat-export-package` | this plan, the developer command, docs |
| `raymond-van/animama-avatar-export` (new, public, MIT) | a local clone beside the Animama checkouts | `main` until the repository exists, then a task branch per change | Unity package, Node command, listing |

This plan records the package repository's steps and evidence too: that
repository has no planning setup, and its work exists only to serve this issue.
Its commits are cited by SHA here, and its README, not this plan, is its user
documentation. Nothing in the package repository refers to this plan or any
private path.

Private test material lives under the owner's private Avatar folder outside
every repository (written `<private>` below): the Unity project for the
converted test Avatar, its exports, logs and renders. Evidence from it is counts,
timings and pass/fail only; the Avatar and its author are never named.

### Current code

- `scripts/avatars/unity/AnimamaBatchExport.cs` (123 lines) and
  `Animama.BatchExport.asmdef`: batch `Validate`/`Export` entry points. They
  instantiate the prefab in a new empty scene, strip `EditorOnly` objects
  (unpacking the prefab instance first), apply UniGLTF's internal T-pose unless
  `-animamaKeepPose`, then call `MochiyaAvatarWorkflow.Detect`, `Validate` and
  `Export`. Exit codes: 0 success, 2 Mochiya cannot convert, 1 failure.
- `scripts/avatars/unity/AnimamaReferenceRender.cs`: the lilToon parity
  renderer. It is copied beside the batch script and compiles in its assembly;
  it repeats the T-pose call. It stays in this repository as a developer tool.
- `src/frontend/web/scripts/vrm-convert-vrchat.mjs` (299 lines) and its
  `node --test` file, run by `test:source:unit`: argument parsing, output paths,
  Unity editor lookup from `ProjectSettings/ProjectVersion.txt`, the batch
  command line (never `-nographics`), the copy-and-compare script check, the
  log summary (`exportLines`), then `vrm-optimize.mjs` and `vrm-inspect.mjs`.
- `docs/frontend/runtime/vrchat-avatar-conversion.md`: the developer guide.

Mochiya facts that shape the design (read from its 0.1.4 source):
`MochiyaAvatarWorkflow.Detect` rejects a root that is a persistent asset or not
in a valid scene; `Export` converts in that scene. `MochiyaTargetKind` is
`Invalid`, `Avatar` or `Attachment`. It has optional Modular Avatar readers.

## Progress

- [ ] Phase 1: package skeleton and export core — not started; needs GW for
  its Windows checks
- [ ] Phase 2: editor window, checks, installer, licence notice — not started
- [ ] Phase 3: standalone command — not started
- [ ] Phase 4: listing, release and package CI — not started; owner gates G1–G3
- [ ] Phase 5: developer command and docs — not started; owner gate G4
- [ ] Final integration review — not started

## Surprises & Discoveries

- 2026-10-29: Neither Mochiya Avatar Tools nor UniVRM publishes a VPM listing,
  so VCC cannot resolve them as dependencies (basis for Q2 and R6).
- 2026-10-29: Mochiya 0.1.6 (`0826f6e3`) differs from the pinned 0.1.4
  (`d98e9091`) only in upload code, upload tests and docs.
- 2026-10-29: The converted test Avatar's export is 21.9 MiB raw and 8.2 MiB
  optimized (basis for deferring Q3).

## Decision Log

- 2026-10-29, owner: accept the spec's answers to Q1–Q8 (issue #795).
- 2026-10-29, owner: test macOS first; Windows is a later phase. Superseded
  the same day: support and verify macOS and Windows together, in every phase
  (plan and spec snapshot updated; the issue update awaits the owner's word).
- 2026-10-29, agent (within scope): one public repository holds both
  deliverables. `npx github:` needs the Node `package.json` at the repository
  root and Unity needs its own `package.json` at the package root, so the Unity
  package lives in `Packages/com.animama.avatar-export/` (installed with a Git
  URL `?path=`, as UniVRM does) and the command at the root.
- 2026-10-29, agent (within scope): the Node command has no npm dependencies, so
  `npx` installs nothing beyond the repository and there is no build step.
- 2026-10-29, agent (within scope): the installer uses Unity's
  `PackageManager.Client.AddAndRemove` with all three Git URLs in one request,
  so UniGLTF and UniVRM resolve before Mochiya's registry-style dependency on
  them, instead of editing `manifest.json` text.
- 2026-10-29, agent (within scope): the export assembly compiles only when its
  dependencies exist (`versionDefines` plus `defineConstraints`); the installer
  lives in a separate assembly with no dependencies, so a project without them
  shows the installer instead of compile errors.

## Phased implementation

Starting revision for every phase in `raymond-van/animama`:
`64e32595` on `feat/vrchat-export-package` (based on `origin/main`
`c036612e`). Phases 1–4 change only the package repository; Phase 5 changes
this repository.

Unity runs use Unity 2022.3 LTS with graphics on both platforms. On the Mac
they go through the heavy-job slots and a timeout, for example
`timeout 1800 python3 scripts/heavy-slot.py -- <Unity> -batchmode …`. Package
editor tests run in a private test project with the package added as a local
`file:` dependency and listed under `testables`:
`<Unity> -batchmode -projectPath <test-project> -runTests -testPlatform EditMode -testResults <private>/results.xml`
(no `-quit`, no `-nographics`). Multi-step gate runs are bash scripts that
record each step's exit status.

### Phase 1: package skeleton and export core

Review tier: standard. New code that ports existing behavior; no release yet.

Requirements: R2, R3 (blocking errors, no partial file), constraints on no
network and no upload.

Steps, in a new local repository (no remote until gate G1):

1. Create the layout: root `README.md` (short; the guide comes in Phase 5),
   `LICENSE` (MIT), `.gitignore`, and
   `Packages/com.animama.avatar-export/` with `package.json` (name, version
   `0.1.0`, `unity: 2022.3`, display name, MIT, no `dependencies` or
   `vpmDependencies`), `LICENSE`, `README.md`, `CHANGELOG.md`, and `Editor/`,
   `Tests/Editor/`.
2. `Editor/Export/` assembly `Animama.AvatarExport.Editor` referencing
   `Mochiya.AvatarTools.Editor`, `Mochiya.AvatarComposition`, `UniGLTF`,
   `UniGLTF.Editor`, `VRM10`, `VRM10.Editor` and `VrmLib`, with
   `versionDefines` for `org.mochiya.avatar-tools` and `com.vrmc.vrm` and
   matching `defineConstraints`.
3. Port `AnimamaBatchExport` into an export core (for example
   `AvatarExporter.Run(prefabOrRoot, options) → ExportResult`) plus thin batch
   entry points with the same `-animama*` arguments and exit codes:
   - work in a temporary additive scene that is made active and closed without
     saving afterwards, so the user's open scenes and the source prefab are
     untouched (Detect needs a valid, non-persistent scene object);
   - strip `EditorOnly` and apply the T-pose exactly as today;
   - write to `<out>.partial` beside the target and move it into place only
     after `Export` succeeds, retrying briefly if Windows reports the file in
     use; delete the partial file on any failure; never overwrite an existing
     target.
   Keep the code free of network APIs and Mochiya upload types.
4. Editor tests on synthetic objects built in the test (no third-party data):
   nested `EditorOnly` stripping removes only the topmost tagged objects; a root
   without a humanoid Animator fails with the keep-pose hint; an existing target
   is refused; a failing export leaves neither target nor partial file (inject
   the failure through a seam in the core); the user's active scene and its
   object count are unchanged after a run.
5. Pin Mochiya to `0826f6e3` (0.1.6) in the private project for this phase's
   checks.

Checks and expected observations:

- Package editor tests pass in the private test project on macOS and Windows.
- On each platform, in the private Unity project for the converted test Avatar, with the package
  added as a `file:` dependency and the copied script removed, the batch
  `Export` writes a file whose `pnpm -s vrm:inspect` report (from this
  repository's `src/frontend/web`) matches a fresh `vrm:convert-vrchat
  --no-optimize` export from the old script at the same Mochiya pin: same mesh,
  morph, expression, spring and texture counts and findings, and no flat-colour
  textures (the GPU readback works on Direct3D as on Metal). Record counts and
  timings only.
- A source search of `Packages/` finds no `UnityWebRequest`, `HttpClient`,
  `WebClient`, `Mochiya*Upload*` or `MochiyaUploadClient`.

Recovery: the package is additive; removing the `file:` entry restores the
project. Keep the old copied script until Phase 5 removes it.

Completion: checks pass and the review has no supported blocking finding.

Check record: —

Commits: —

#### Code Review #1 Findings

—

#### Code Review #1 Revisions

—

### Phase 2: editor window, checks, installer and licence notice

Review tier: standard. Editor UI and project-settings writes behind explicit
consent.

Requirements: R1, R3, R4, R5, R6; Q6 detection.

Steps:

1. `Editor/Bootstrap/` assembly `Animama.AvatarExport.Bootstrap` with no
   references beyond Unity: on domain load and from the menu, read installed
   packages (`PackageManager.Client.List`), report missing or out-of-range
   UniGLTF/UniVRM (exactly 0.131.2) and Mochiya (the pinned commit), and offer
   to install them. On consent, call `Client.AddAndRemove` with the pinned Git
   URLs; if Git is missing, say so and link Git's download page. Never change
   the manifest without consent.
2. Version checks (R5) for the editor (2022.3), the packages above and lilToon
   (2.3.4 or later within 2.x, read by reflection whether it is a package or an
   `Assets` copy). Each failure names the component, found and required
   versions and the fix, and disables Export.
3. `Animama > Export for Animama…` window in the export assembly: Avatar picker
   (prefab or scene root), output file, metadata (name defaults to the prefab
   name; version `1.0`; author; copyright), keep-pose option, Validate and
   Export. Show errors and the expected warnings (animator state machines,
   visemes and blink, PhysBones, colliders) in plain language with what each
   means in Animama; keep Mochiya's full report behind a disclosure.
4. Modular Avatar detection: if the Avatar holds a component from the
   `nadena.dev.modular_avatar` namespace (found by reflection), explain that
   such Avatars are not supported yet and disable Export.
5. Licence notice (R4) before the first export in a project, acknowledged once
   and stored in `UserSettings/AnimamaAvatarExport.json` (per user and project,
   not version-controlled). The wording follows the spec: own licensed Avatar
   only, written only to this computer, no redistribution unless the licence
   allows it; it never mentions uploading to Mochiya.
6. Editor tests: version-range decisions, the warning-to-text mapping,
   acknowledgement persistence, Modular Avatar detection on a synthetic
   object, and that Export stays disabled while a check fails.

Checks:

- Package editor tests pass.
- Manual walkthrough on macOS (project created with VRChat's `vpm` tool or
  ALCOM) and on Windows (project created in VCC), each a fresh VRChat Avatars
  project holding the converted test Avatar, package added from the local
  clone: the installer prompts, installs the dependencies, the
  menu appears with no compile errors, the licence notice shows once, and the
  export's `vrm:inspect` report matches Phase 1's. The source prefab and open
  scene are unchanged (no dirty scene; `git status` clean in a project that was
  committed before the run).
- A prefab that fails Mochiya validation shows its error and writes no file.

Completion: checks pass and the review has no supported blocking finding.

Check record: —

Commits: —

#### Code Review #1 Findings

—

#### Code Review #1 Revisions

—

### Phase 3: standalone command

Review tier: standard. A new command-line tool that edits a user's project
manifest.

Requirements: R7; Q8.

Steps, at the package repository root:

1. `package.json` (`name: animama-avatar-export`, `bin`, `engines.node >= 20`,
   no dependencies) and `cli/` modules ported from `vrm-convert-vrchat.mjs`:
   argument parsing (without `--no-optimize`), Unity editor lookup on macOS and
   Windows, the batch command line (spawned without a shell, so paths with
   spaces pass intact), the log summary and exit-code mapping. Pure functions
   take the platform as a parameter and stay exported for tests.
2. Project preparation: refuse while the project is open (Unity holds
   `Temp/UnityLockfile`; detect it the way each platform's lock allows);
   otherwise add any missing entries to
   `Packages/manifest.json` — the three pinned dependency URLs and this
   package's URL at the command's own tag — preserving every other entry and
   the file's formatting and line endings, and report what was added.
3. Run `Validate` or `Export` through the Phase 1 batch entry points; write the
   Unity log beside the output; print the `[Animama]` lines and the validation
   report. Exit 0 only when a file was written (or validation passed with
   `--validate`), 2 when Mochiya cannot convert, 1 otherwise. Never overwrite.
4. `node --test` tests: argument errors, editor lookup for both platforms,
   command line (never `-nographics`), manifest editing on temporary fixtures
   (missing, present, conflicting entries; LF and CRLF kept), lockfile refusal,
   and exit codes against a fake Unity executable that writes a scripted log.

Checks:

- `node --test` passes on macOS and Windows; the command runs with no
  `node_modules`.
- On macOS and on Windows, in a copy of the private project without the package, the command
  (run from the local clone) adds the entries, exports the converted test
  Avatar, and the result's `vrm:inspect` report matches Phase 2's export; a run
  while the project is open in Unity is refused; a validation failure exits
  non-zero with no file.

Completion: checks pass and the review has no supported blocking finding.

Check record: —

Commits: —

#### Code Review #1 Findings

—

#### Code Review #1 Revisions

—

### Phase 4: listing, release and package CI

Review tier: high risk. Packaging, release and a public distribution channel.

Requirements: R6 and the acceptance criterion for installing from the listing;
Q5.

Owner gates:

- **G1:** create the public repository `raymond-van/animama-avatar-export` and
  push `main`.
- **G2:** enable GitHub Actions (public repository; standard runners) and
  GitHub Pages for the listing.
- **G3:** approve the first release tag (`v0.1.0`) and the listing going live.

Steps:

1. A release workflow, triggered by a version tag, that zips
   `Packages/com.animama.avatar-export/`, attaches it to a GitHub release and
   regenerates the VPM listing (`index.json` with name, id, URL, author and every
   released version's `url` and `zipSHA256`) on GitHub Pages. Pin every action
   by commit SHA.
2. A CI workflow on pull requests and `main`: `node --test` on Ubuntu and
   Windows runners, the no-network and
   no-upload source search over `Packages/` and `cli/`, JSON validation of both
   `package.json` files and the listing, and a check that the two versions and
   the tag agree. Unity editor tests stay local (they need a Unity licence and a
   GPU); the check record carries their results.
3. Root README: install routes (listing URL, Git URL with `?path=`, release
   zip) and the command's `npx` line.

Checks:

- CI passes on the release candidate; a dry run of the release workflow on a
  pre-release tag produces a zip and a listing whose hashes match.
- After G3, in a fresh VRChat Avatars project on each platform (macOS: `vpm
  add repo <listing URL>` or ALCOM's Add Repository; Windows: VCC's Add
  Repository), adding the package from the listing, then the Phase 2
  installer, give the menu with no compile errors.
- `npx github:raymond-van/animama-avatar-export#v0.1.0 --help` runs.

Recovery: a bad release is superseded by a new patch tag; the listing keeps
older versions so installed projects still resolve. Do not delete published
tags.

Completion: checks pass, the high-risk review (analysis plus independent
checks) has no supported blocking finding, and G1–G3 are recorded.

Check record: —

Commits: —

#### Code Review #1 Findings

—

#### Code Review #1 Revisions

—

### Phase 5: developer command and documentation

Review tier: standard. Developer tool behavior and docs in this repository.

Requirements: R8, R9.

Dependencies: the `v0.1.0` release from Phase 4 (G3); the developer command
pins that tag.

Steps in `raymond-van/animama`:

1. `vrm-convert-vrchat.mjs` runs `npx --yes
   github:raymond-van/animama-avatar-export#<pinned tag>` with the user's
   options (forcing a raw export path), then `vrm-optimize.mjs` and
   `vrm-inspect.mjs` as today. Remove `checkProjectScript`, `sameScript`, the
   editor lookup and the Unity command line, which now live in the package
   command. Keep the documented flags and outputs (`--no-optimize`,
   `--validate`, `--keep-pose`, `--unity`, `ANIMAMA_UNITY_EDITOR`,
   `<Avatar>.raw.vrm`, `<Avatar>.export.log`). Update its tests.
2. Delete `scripts/avatars/unity/AnimamaBatchExport.cs` and
   `Animama.BatchExport.asmdef`; give `AnimamaReferenceRender.cs` its own
   assembly definition (UniGLTF and VRM10 references) so it no longer relies on
   the batch script's.
3. Package repository README and `Documentation~` end-user guide: install from
   the listing, the installer prompt, Export for Animama, the licence notice,
   expected warnings, the known export limits (vertex colours, authored
   blendshape weights, PhysBone gravity), the command line, and uploading the
   file in Animama (Create Anima > Upload VRM). Released with a patch tag under
   G3's process.
4. Rewrite `docs/frontend/runtime/vrchat-avatar-conversion.md` for developers:
   point setup at the package and link the end-user guide; keep the checks,
   known limits, parity and sharing sections that still apply.

Checks:

- From `src/frontend/web`: `node --test scripts/vrm-convert-vrchat.test.mjs`;
  Prettier check of changed TS/JS files (never Markdown); `pnpm web:lint`.
- `vrm:convert-vrchat` converts the converted test Avatar through the pinned
  tag, with and without `--no-optimize`, on macOS (the developer command's
  primary platform) and once on Windows; counts and timings only.
- **G4 (owner, manual):** on a task stack (`./reset.sh --name <n> --base-port
  <p>`, browser pane visible), upload the window's export through Create Anima
  and confirm motion, springs, blink, visemes and look-at match the developer
  command's export. Tear the stack down afterwards.

Completion: checks pass, the review has no supported blocking finding, and G4
is recorded (or explicitly deferred by the owner in the PR).

Check record: —

Commits: —

#### Code Review #1 Findings

—

#### Code Review #1 Revisions

—

## Final integration review

Covers combined acceptance for #795 across both repositories at their final
revisions, including any light-tier parts, reusing still-valid phase evidence.
Then run the full pre-push suite once on this repository's candidate through
the heavy-job slots (`pnpm verify` and the affected `pnpm web:test:browser`
items if any apply; backend unchanged) and put the results in the PR.

## Validation and acceptance

The spec's acceptance criteria, mapped to evidence. Every manual or Unity
check runs on macOS and Windows unless the row says otherwise:

| Criterion | Evidence | Phase |
| --- | --- | --- |
| Install from the listing in a fresh project; menu, no compile errors | walkthrough on macOS and Windows after G3 | 4 |
| Window export matches the developer export; prefab and scene unchanged | `vrm:inspect` counts; clean project status | 1–2 |
| `EditorOnly` garment stripped | editor test plus the converted test Avatar's variant | 1 |
| Unsupported lilToon or missing dependency blocks export | editor tests plus one manual check | 2 |
| Validation error blocks export, no file | editor test plus manual | 1–2 |
| Licence notice once per project | editor test plus walkthrough | 2 |
| No network or upload code | CI source search plus review | 1, 4 |
| Standalone command converts in a project without the package; refuses while open; non-zero on failure | runs on macOS and Windows | 3 |
| Upload behaves like the developer export | G4 owner check | 5 |
| Developer command works through the package | command runs | 5 |
| Docs describe shipped behavior | review | 5 |

Hosted validation for this repository's PR follows the owner's standing policy:
check `gh workflow list --all --repo raymond-van/animama` before any push.
Nothing is pushed, released or posted without the owner's word.

## Idempotence and recovery

- The installer and the command only add missing manifest entries; rerunning
  them changes nothing. Removing the entries restores a project.
- Exports never overwrite and leave no partial file, so a failed run can be
  repeated with the same output path.
- Released versions are immutable; fixes ship as new patch tags.
- Until Phase 5 lands, the old copied-script flow keeps working, so the
  developer command is never without a working path.

Upstream contributions (each needs the owner's approval before posting): VPM
listing requests to Mochiya and the VRM Consortium; the `EditorOnly` and T-pose
behavior to Mochiya; the missing vertex colours to UniVRM.

## Outcomes & Retrospective

Not started.
