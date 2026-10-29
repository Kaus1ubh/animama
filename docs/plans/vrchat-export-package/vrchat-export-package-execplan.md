# Export a VRChat Avatar for Animama without the Animama source

Source agreement: https://github.com/raymond-van/animama/issues/795, published
2026-10-29T16:48:47Z with the owner's decisions on Q1–Q8 of the same day, and
updated 2026-10-29T17:06:25Z for macOS and Windows together (snapshot:
[vrchat-export-package-spec.md](vrchat-export-package-spec.md)).
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
2022.3, VCC, Git and Node 22 or later, and the private test material copied to
a private folder there, before Phase 1's Windows checks. The Windows runs
include a prefab path with spaces and non-ASCII characters, an exporter
checkout path with spaces (the `file:C:\…` Unity entry), `pnpm dlx` starting
the exporter through its `.cmd` shim, and the lock probe against an open
editor. Without it, the
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

- [ ] Phase 1: package skeleton and export core — done on macOS (checks pass;
  review passed after one repair round; package commit `26601ed`); Windows
  checks open until GW
- [ ] Phase 2: editor window, checks, installer, licence notice — done on macOS
  (checks pass; review passed after one repair round); owner GUI walkthrough GM
  and Windows checks open
- [ ] Phase 3: standalone command — done on macOS (checks pass; review passed
  after one repair round); Windows checks open (GW)
- [ ] Phase 4: listing, release and package CI — local checks pass; review
  passed after one repair round; owner gates G1–G3 (and the live release checks)
  open
- [ ] Phase 5: developer command and docs — done against a local exporter
  checkout (checks pass; high-risk review passed after two repair rounds);
  needs the v0.1.0 release (G3), the `EXPORTER_RELEASE` SHA pin, and G4
- [ ] Final integration review — not started

## Surprises & Discoveries

- 2026-10-29: Neither Mochiya Avatar Tools nor UniVRM publishes a VPM listing,
  so VCC cannot resolve them as dependencies (basis for Q2 and R6).
- 2026-10-29: Mochiya 0.1.6 (`0826f6e3`) differs from the pinned 0.1.4
  (`d98e9091`) only in upload code, upload tests and docs.
- 2026-10-29: The converted test Avatar's export is 21.9 MiB raw and 8.2 MiB
  optimized (basis for deferring Q3).
- 2026-10-29 (Phase 1): Mochiya creates its working objects with
  `new GameObject` and `Object.Instantiate` in the active scene, so a preview
  scene would leak them into the user's scene. The export instead opens a fresh
  scene and restores the user's saved scene setup afterwards, refusing while a
  scene has unsaved changes. A new additive scene is not an option either:
  Unity refuses one while an untitled scene is open, as batch mode always
  starts. Exporting a scene root (not a prefab asset) cannot carry the object
  across that switch; Phase 2 decides how the window offers it.
- 2026-10-29 (Phase 1 review): Phase 2 inputs. Unsaved Prefab Mode changes are
  not covered by the open-scene check. An export written inside `Assets/` is
  imported after the move (the package calls `AssetDatabase.Refresh`, as
  Mochiya does for its own output).
- 2026-10-29 (Phase 1): the package's export of the converted test Avatar is
  byte-identical to the copied script's, for the main prefab and its
  `EditorOnly` outfit variant.
- 2026-10-29 (Phase 1): in a fresh worktree `vrm:convert-vrchat` writes the VRM
  but its `vrm:inspect` step fails until the workspace packages are built
  (`pnpm --dir src/frontend packages:build`); the `vrm:*` scripts do not build
  them. Phase 5's developer doc should say so.

## Decision Log

- 2026-10-29, owner: accept the spec's answers to Q1–Q8 (issue #795).
- 2026-10-29, owner: test macOS first; Windows is a later phase. Superseded
  the same day: support and verify macOS and Windows together, in every phase
  (issue #795 updated 2026-10-29T17:06:25Z).
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
- 2026-10-29, agent (within scope, Phase 1): the export refuses to start while an
  open scene has unsaved changes rather than saving or discarding them; the
  Phase 2 window offers to save first. Batch mode is unaffected (it starts in a
  clean untitled scene).
- 2026-10-29, agent (within scope, Phase 1): intended differences from the copied
  script. Only `.vrm` output is accepted (the script let Mochiya write `.glb`);
  the output-exists and extension checks run before validation, so an existing
  output exits 1 even for a prefab Mochiya cannot convert; the "Wrote" line
  prints the absolute path; the T-pose errors name "the keep-pose option"
  (`-animamaKeepPose`, `--keep-pose`, the window's checkbox) instead of the
  batch flag alone.
- 2026-10-29, agent (within scope, Phase 2): an Avatar picked in the open scene
  is exported through its prefab when it is an unchanged prefab instance (its
  root's position and rotation are ignored); otherwise the window asks for a
  prefab. Mochiya is "met" only at the tested commit (or version 0.1.6 for a
  downloaded copy); other versions are reported unsupported and the installer
  offers the tested one. A project without lilToon passes, since only Avatars
  that use it need it.
- 2026-10-29, agent (within scope, Phase 2): the agent cannot operate the Unity
  editor's interface, so the window walkthrough becomes owner check GM; the
  logic behind it is covered by EditMode tests and the batch checks.
- 2026-10-29, agent (within scope, Phase 5): the developer command runs the
  exporter with `pnpm dlx` (the repository's package manager, started from
  `npm_execpath` through Node) instead of `npx`; the parity renderer's asmdef
  references `UniGLTF.Editor`, where `InternalTPose` lives, instead of VRM10.
- 2026-10-29, agent (within scope, Phase 3): the command requires Node 22 or
  later, not the spec's Node 20: Node 20 reached end of life in April 2026, and
  the test runner's glob patterns need 22. Reported to the owner.
- 2026-10-29, agent (within scope, Phase 3): batch exit code 3 means a
  requirement is not met (from `BatchRequirements.Check` and `BatchExport`);
  the command reports it as exit 1 with an explanation, keeping its documented
  0/2/1. The command prints a one-line licence reminder on every run.
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
   - work in a fresh empty scene and reopen the user's saved scenes afterwards,
     refusing while an open scene has unsaved changes, so the user's scenes and
     the source prefab are untouched (Detect needs a valid, non-persistent scene
     object; see Discoveries for why not a preview or additive scene);
   - strip `EditorOnly` and apply the T-pose exactly as today;
   - write to a dot-prefixed `.<name>.<random>.partial.vrm` beside the target
     (Mochiya requires the `.vrm` extension) and move it into place only
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

Check record (macOS 26 on Apple Silicon, Unity 2022.3.62f3, Mochiya
`0826f6e3`, UniVRM 0.131.2; private copy of the converted test Avatar's
project; scripts and logs kept privately):

| Check | Result | Source |
| --- | --- | --- |
| Baseline: copied-script export, `vrm:convert-vrchat --no-optimize`, main prefab and `EditorOnly` variant | both VRMs written (Unity 23 s and 9 s); the command's own `vrm:inspect` step failed on unbuilt workspace packages (see Discoveries) | Animama `f2e92396` |
| Package EditMode tests, `-runTests -testPlatform EditMode -assemblyNames Animama.AvatarExport.Editor.Tests` | first run 8/10: two failures from a test bug (a `Scene` handle read after reopening); rerun 10/10, no compile errors or Animama warnings | package tree `45620e2d` |
| Package batch export (`-executeMethod Animama.AvatarExport.BatchExport.Export`), both prefabs | exit 0 (7 s, 8 s); both files byte-identical to the baseline; `vrm:inspect` reports identical apart from a one-time Vite warning | package implementation as in `45620e2d` (only the test file changed afterwards) |
| Variant strips its `EditorOnly` objects | 8 topmost tagged objects stripped, as the baseline did | same run |
| Source prefabs unchanged | SHA-256 of the prefab folder equal before and after | same run |
| No partial files left | none | same run |
| No network or upload code: `grep -rn -E 'UnityWebRequest\|HttpClient\|WebClient\|System\.Net\|Mochiya[A-Za-z]*Upload' Packages/` | no matches | `45620e2d` |
| After Review #1 repairs: EditMode tests | 13/14 first (one new test's expectation was wrong, see Revisions); final 16/16, no compile errors or Animama warnings | package tree `c3bac262` |
| After repairs: batch export of both prefabs | exit 0; both files byte-identical to the baseline | repaired implementation (only tests changed afterwards) |
| After repairs: batch Validate exit codes | attachment prefab with keep-pose exits 2 (Mochiya: not a valid Avatar); missing prefab exits 1 with `FileNotFoundException` | same |
| After repairs: prefabs unchanged, no partial files, no network or upload code | pass | `c3bac262` |
| After Review #2's trivial repair: EditMode tests; main prefab batch export | 16/16; exit 0, byte-identical to the baseline | package commit `26601ed` (tree `0b8c35b2`) |
| Windows checks | not run (gate GW) | — |
| Behavior with dependencies missing (assembly not compiled) | not run; covered by Phase 2's walkthrough | — |

Commits: package repository `26601ed` `feat(export)[p1]: export a VRChat
Avatar prefab to VRM through Mochiya` (local; no remote until G1).

#### Code Review #1 Findings

Reviewed the package tree `45620e2d` against the copied script at Animama
`f2e92396`, standard tier, initial round; reused the check record and reran the
source search plus a `.meta` coverage and GUID-uniqueness check.

- **P1-F1 (blocking):** scene restore could mark an unloaded saved scene active;
  Unity rejects that setup, leaving the user in the temporary scene with the
  posed copy, and the thrown error could turn a written export into `Failed`.
- P1-F2: a failed restore replaced the run's own error or outcome.
- P1-F3: an unguarded partial-file delete could escape `Run` on Windows.
- P1-F4: batch lines were logged only at the end, so a crash mid-export lost
  them.
- P1-F5: messages dropped the keep-pose hint; prefab-not-found changed
  exception type.
- P1-F6: intended behavior differences to record (`.vrm` only, checks before
  validation, absolute path in "Wrote").
- P1-F7: an export inside `Assets/` was no longer imported in the same run.
- P1-F8: the partial-name comment said "hidden" (not on Windows); long name.
- P1-F9: the Mochiya adapter shared the interface's file.
- P1-F10: missing tests for multi-scene and untitled restore, early-return
  restore and the extension check; exit codes 2 and 1 unobserved.
- P1-F11: plan step 3 and the Decision Log out of date.
- P1-F12: package README named UniVRM ambiguously.

Confirmed without findings: `.meta` coverage, no private references, no
network or upload code, assembly conditions, batch arguments and exit codes,
Mochiya's file handling, no-overwrite, partial cleanup on converter failure.

#### Code Review #1 Revisions

All findings accepted; P1-F6 recorded rather than changed. Repaired tree
`c3bac262`.

- P1-F1: `SceneSetupScope.ScenesToReopen` keeps saved scenes, marks a loaded
  one active, and reopens none when none is loaded. Testing showed Unity's
  `GetSceneManagerSetup` already reports a lone unloaded saved scene as loaded
  and active, so that scene comes back loaded; the first test's expectation
  (an empty scene) was corrected and two tests on synthetic setups added.
- P1-F2, P1-F3: restore and partial-file failures are logged without changing
  the outcome.
- P1-F4: a progress sink delivers each line as it happens; batch mode logs live.
- P1-F5: messages name "the keep-pose option"; `FileNotFoundException`
  restored.
- P1-F6: Decision Log entry.
- P1-F7: the package refreshes the asset database after moving an export into
  `Assets/`, as Mochiya does.
- P1-F8: comment corrected; random part shortened to 8 characters; Windows path
  length stays a GW check.
- P1-F9: `MochiyaConverter.cs`.
- P1-F10: six tests added (16 in all); batch exit codes 2 and 1 observed.
- P1-F11: plan updated. P1-F12: README updated.

Verification: the "After Review #1 repairs" rows above. Repair budget: round 1
of 2 used.

#### Code Review #2 Findings

Targeted recheck of tree `c3bac262` (repair round 1), reusing the record and
rerunning the source search and `.meta` checks: every Review #1 finding fixed
or recorded as described; no blocking finding or regression.

- P1-R2-F1 (non-blocking): a step after the move (asset refresh, reading the
  file size, a caller's progress sink) could still report `Failed` with the VRM
  in place, contrary to the status's "nothing was written".

#### Code Review #2 Revisions

- P1-R2-F1 accepted as a trivial repair: `OutputPath` is set as soon as the
  VRM is in place, and the `Failed` and `OutputPath` docs say a failed run wrote
  nothing unless `OutputPath` is set. Verified by the last check-record row; no
  reviewer recheck needed. Phase 2's window sink must not throw.

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

Completion: checks pass, the review has no supported blocking finding, and the
owner's GUI walkthrough (below) is recorded.

Implementation notes (2026-10-29):

- The bootstrap assembly (`Animama.AvatarExport.Bootstrap`) has no
  references: `Requirements`, `DependencyInstaller`, `SetupWindow`,
  `RequirementsView`, the `Animama` menu and `BatchRequirements.Check` (a batch
  entry point that logs one `[Animama] Requirement` line per component and
  exits 3 when any is unmet, for the Phase 3 command). The export assembly
  registers its window with the menu when it compiles; until then the menu
  opens the setup window, which also opens once per editor session.
- The window lives in the export assembly; its decisions are in
  `AvatarSource`, `ModularAvatar`, `LicenceNotice`, `ReportExplanations` and
  `ExportBlockers` so tests cover them without drawing.

Check record (macOS, Unity 2022.3.62f3):

| Check | Result | Source |
| --- | --- | --- |
| All package EditMode tests (`-assemblyNames "Animama.AvatarExport.Editor.Tests;Animama.AvatarExport.Bootstrap.Tests"`) in the project with dependencies | first run 38/40: two test-design faults (an editor-assembly component cannot be added to an object; a moved root is a default override Unity ignores); fixed; 40/40, no compile errors or Animama warnings | package tree `767e4557` |
| Fresh VRChat Avatars project (VCC template, `vpm resolve project`) with only the package added | compiles with no errors; `BatchRequirements.Check` exits 3 and reports UniGLTF, UniVRM 1.0 and Mochiya missing, Unity and lilToon met | `767e4557` |
| No network or upload code (search over `Packages/`) | no matches (the installer runs `git --version` only, to detect Git) | `767e4557` |
| GUI walkthrough (installer prompt, licence notice, window export, open scene untouched) | not run: the agent cannot drive the Unity editor's interface; owner check **GM** | — |
| Windows | not run (GW) | — |
| After Review #1 repairs (and Phase 3's batch fixes): all EditMode tests | 44/44, no compile errors; then 44/44 again after adding the gravity-falloff explanation | package tree `3b2c9493` |
| Installer without the GUI: a private harness in the fresh project calls `DependencyInstaller.Install` with `Requirements.UrlsToInstall` | one request installed UniGLTF, UniVRM 1.0 and Mochiya at the pinned URLs; after the reload every requirement was met, the export assembly compiled and the menu registered its window (the first attempt was cut short by the VRChat SDK switching build target, a one-time reload) | `3b2c9493` |
| An untested Mochiya (0.1.5 at `ad47df79`) | the export assembly does not compile (`[0.1.6]` version define); `BatchRequirements.Check` exits 3 naming found and required versions | `3b2c9493` |

Commits: package repository `33d790b` `feat(export)[p2]: add the Export for
Animama window, requirement checks and installer` (local; includes Phase 3's
`BatchExport` fixes, which live in the package).

#### Code Review #1 Findings

Reviewed tree `767e4557` against Phase 1's `26601ed`, standard tier, initial
round; reran the source search, `.meta` coverage, GUID uniqueness and a
private-path search.

- **P2-F1 (blocking):** an Avatar picked in the scene became Missing after
  Validate or Export, because reopening the scenes destroys it.
- **P2-F2 (blocking):** collider, gravity-falloff and lip-sync warnings come
  only from Mochiya's export, but the window explained only the validation
  report; two match keys ("visemes", "collider") would mislabel export lines.
- P2-F3: matching anywhere in a line (object names included) mislabelled lines;
  the "collision" entry was unreachable.
- P2-F4: "carry over" for visemes was unconditional; Mochiya says "where
  configured".
- P2-F5: the package README still said Mochiya 0.1.4 or later; CHANGELOG
  incomplete.
- P2-F6: file panel and installer dialogs opened without ending the GUI pass.
- P2-F7: scene-instance messages were wrong or unhelpful for VRChat-uploaded
  instances (blueprint overrides), Prefab Mode objects and nested instances.
- P2-F8: the Mochiya version define was open-ended.
- P2-F9: no Play Mode blocker.
- P2-F10: the pick was resolved several times per GUI event.
- P2-F11: a failure after the VRM was saved did not say the file exists.
- P2-F12: the install dialog said "add" when replacing versions; an installed
  UniVRM 0.x would be left mismatched.
- P2-F13: wording (window intro, licence notice, lilToon fix text, the
  absent-lilToon row).
- P2-F14: Mochiya's errors for a non-Avatar prefab pointed at Mochiya's tools.
- Check gap: the installer path had not run.

#### Code Review #1 Revisions

All accepted. Repaired tree `3b2c9493` (shared with Phase 3's repairs).

- P2-F1: `Run` keeps the resolved prefab as the pick before exporting.
- P2-F2, P2-F3, P2-F4: `ExportResult.ExportReport` keeps Mochiya's export
  report; the window explains it after an export (the validation report
  otherwise). `ReportExplanations` matches Mochiya 0.1.6's exact phrases,
  separates plane and inside colliders, adds jaw-bone lip sync and gravity
  falloff, and qualifies visemes. Tests rebuilt from the lines each stage
  emits.
- P2-F5: package README and CHANGELOG updated.
- P2-F6: `ExitGUI` after the file panel and the installer.
- P2-F7: messages name the Project window route, including for Prefab Mode
  objects and nested instances.
- P2-F8: Mochiya version define `[0.1.6]`.
- P2-F9: "Exit Play Mode first" blocker.
- P2-F10: the pick is resolved on change, focus, hierarchy and project changes.
- P2-F11: the failure message says where the VRM was saved.
- P2-F12: the dialog lists "install" or "replace … with …" per package, and an
  installed `com.vrmc.univrm` is checked and updated with UniGLTF.
- P2-F13: wording corrected; the licence notice says the export writes only the
  chosen file and uploads nothing.
- P2-F14: plain explanations for the humanoid and attachment errors.
- Check gap: covered by the installer harness row above.

Verification: the rows after "After Review #1 repairs". Repair budget: round 1
of 2 used.

#### Code Review #2 Findings

Targeted recheck of `Packages/` at tree `3b2c9493` (identical in `7463a88b`),
rerunning the source search, `.meta`, GUID and private-path checks: every
Review #1 finding fixed; no blocking finding or regression, including Phase 3's
changes to `BatchExport`.

- P2-R2-F1 (non-blocking): Mochiya 0.1.6 emits "Only blendshape visemes are
  converted" when an Avatar's viseme list is short, not for jaw-bone lip sync
  (which gets no warning), so the explanation gave the wrong cause.
- P2-R2-F2 (non-blocking): "has no valid VRM humanoid" also covers an Avatar
  whose own rig fails Mochiya's humanoid check.
- Minor: no tests for the Prefab Mode and nested-instance messages.

#### Code Review #2 Revisions

- P2-R2-F1, P2-R2-F2: trivial wording repairs ("Some of this Avatar's mouth
  shapes are not converted…"; "…or its humanoid rig is incomplete…"); the
  end-user guide now says jaw-bone or parameter lip sync is not converted and
  not reported. EditMode tests 44/44 afterwards (tree `c5b4761c`). Possible
  upstream note for Mochiya, subject to the owner's approval to post.
- Minor test gap: left; the messages are covered by review and GM.

### Phase 3: standalone command

Review tier: standard. A new command-line tool that edits a user's project
manifest.

Requirements: R7; Q8.

Steps, at the package repository root:

1. `package.json` (`name: animama-avatar-export`, `bin`, `engines.node >= 22`,
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
   `--validate`), 2 when Mochiya cannot convert or the Avatar needs Modular
   Avatar, 1 otherwise (including an unmet requirement). Never overwrite.
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

Review tier note: the phase also adds the npm packaging that `npx` installs
(root `package.json`: `bin`, `files`, `engines`). That packaging is reviewed
again under Phase 4's high-risk release review, which runs the full checks.

Check record (macOS, Node 24.15, Unity 2022.3.62f3):

| Check | Result | Source |
| --- | --- | --- |
| `npm test` (`node --test "cli/*.test.mjs"`) | 22/22 first; after Review #1 repairs 36/36 (with the scripts' tests) | package working tree, then tree `3b2c9493` |
| Command on a private project copy with the package and its dependencies removed, `--package file:<clone>/Packages/com.animama.avatar-export` | added all four manifest entries; main prefab exit 0, byte-identical to the baseline (24 s with package resolution); `EditorOnly` variant exit 0, byte-identical | before repairs |
| `--validate --keep-pose` on an attachment prefab | exit 2 | before repairs |
| Existing `--out` | exit 1 before Unity runs | before repairs |
| While a batch Unity held the project | refused, exit 1, nothing written | before repairs |
| `npm exec --yes --package=<clone> -- animama-avatar-export --help` | exit 0 (bin link) | before repairs |
| Unity's wording when the export code is absent | "executeMethod class 'BatchExport' could not be found." | fresh project |
| After repairs: command export of the main prefab | exit 0, byte-identical; ends with the plain-language `[Animama] Note:` lines | `3b2c9493` |
| Windows | not run (GW) | — |
| npx from GitHub | not run (no remote until G1) | — |

Commits: package repository `6b01937` `feat(export)[p3]: add the
animama-avatar-export command line` (local).

#### Code Review #1 Findings

Reviewed the Phase 3 working tree (root `package.json`, `cli/`) against the
developer command and the package's batch entry points, standard tier, initial
round; reran `node --test`, `npm pack --dry-run` and probes in temporary
folders.

- **P3-F1 (blocking):** the batch path skipped the window's requirement checks
  and Modular Avatar refusal, so the command could export what the window
  refuses.
- **P3-F2 (blocking):** the command printed Mochiya's raw report, not the
  window's plain-language one (R7).
- **P3-F3 (blocking):** the phase adds npm packaging, which the tier table
  calls high risk.
- P3-F4: when the package itself never loaded, the message blamed the
  dependencies and gave no next step.
- P3-F5: embedded (VCC) packages were not detected; a non-Git Mochiya got a
  misleading "pins other versions" message.
- P3-F6: `engines` was raised to Node 22 without a record.
- P3-F7: a missing `--unity` editor or output folder was found only after the
  manifest changed.
- P3-F8: an invalid manifest or one with a byte-order mark raised an unnamed
  `SyntaxError`.
- P3-F9: no test ran a real executable (spawn, spaces), the Windows lock probe,
  LF preservation, `readSecondaryInstallPath` or the log's open-project branch.
- P3-F10: the Windows probe treated `EPERM` (read-only) as an open project.
- P3-F11: the command showed no licence notice (product note).

#### Code Review #1 Revisions

All accepted. Repaired tree `3b2c9493`.

- P3-F1: `BatchExport` refuses unmet requirements (exit 3, one `[Animama]
  Requirement not met` line each) and Modular Avatar (exit 2); the command maps
  exit 3 to a clear message. Verified by the check-record rows here and in
  Phase 2 (an untested Mochiya stops at the compile constraint and the
  requirement check reports it).
- P3-F2: `BatchExport` ends with the window's explained report as
  `[Animama] Note:`/`Error:` lines; Mochiya's raw report stays above them.
- P3-F3: tier note above; Phase 4's high-risk review covers the packaging.
- P3-F4: "The Animama package did not load in this project. Check the network,
  Git and --package" when the requirement check prints nothing.
- P3-F5: embedded packages count as present; conflicts read "the export needs";
  an installed `com.vrmc.univrm` at another version is reported.
- P3-F6: Decision Log entry; GW now says Node 22.
- P3-F7: the editor path and the output folder are checked before the
  manifest; the validation log folder is created.
- P3-F8: parse errors name `Packages/manifest.json`; a byte-order mark is kept.
- P3-F9: tests added for each case, including a POSIX fake Unity run through
  real `spawn` in a folder with spaces.
- P3-F10: only `EBUSY` counts as held; to verify under GW.
- P3-F11: every run prints a one-line licence reminder (no acknowledgement;
  R4's notice stays a window requirement).

Repair budget: round 1 of 2 used.

#### Code Review #2 Findings

Targeted recheck of tree `3b2c9493` (identical to `7463a88b` for `cli/`,
`package.json` and `Packages/`), rerunning `node --test "cli/*.test.mjs"`
(33/33): every finding fixed or resolved as recorded; no blocking finding or
regression. Non-blocking: the command's header comment and this plan's steps 1
and 3 still described Node 20 and exit 2 as Mochiya-only; `--validate` without
`--out` creates `<project>/Logs` before the open-project check (harmless).

#### Code Review #2 Revisions

The header comment and steps 1 and 3 were corrected (trivial; Prettier check
clean). The `Logs` folder order is left as is.

### Phase 4: listing, release and package CI

Review tier: high risk. Packaging, release and a public distribution channel.

Requirements: R6 and the acceptance criterion for installing from the listing;
Q5.

Owner gates:

- **G1:** create the public repository `raymond-van/animama-avatar-export` and
  push `main`.
- **G2:** enable GitHub Actions (public repository; standard runners); set
  GitHub Pages' source to **GitHub Actions**; let the `github-pages`
  environment deploy from tags matching `v*` (optionally with a required
  reviewer, which then enforces G3 for every release); add a tag ruleset that
  blocks updating and deleting `v*` tags.
- **G3:** approve the first release tag (`v0.1.0`) and the listing going live.

Steps:

1. A release workflow, triggered by a version tag on `main`, in resumable jobs:
   the CI workflow (reused), a build that checks the tag and zips
   `Packages/com.animama.avatar-export/`, a release that creates the GitHub
   release with the zip unless it exists, and a Pages job that downloads every
   release's zip and rebuilds the VPM listing (`index.json` with name, id, URL,
   author and every released version's `url` and `zipSHA256`) from them. Each
   job has only the permissions it needs; every action is pinned by commit
   SHA.
2. A CI workflow on pull requests and `main`: `node --test` on Ubuntu and
   Windows runners, the no-network and
   no-upload source search over `Packages/` and `cli/`, JSON validation of both
   `package.json` files and the listing, and a check that the two versions and
   the tag agree. Unity editor tests stay local (they need a Unity licence and a
   GPU); the check record carries their results.
3. Root README: install routes (listing URL, Git URL with `?path=`, release
   zip) and the command's `npx` line.

Checks:

- CI passes on the release candidate, including its release build (zip and
  listing) without publishing. After G3, the downloaded release zip's SHA-256
  matches the deployed listing's.
- After G3, in a fresh VRChat Avatars project on each platform (macOS: `vpm
  add repo <listing URL>` or ALCOM's Add Repository; Windows: VCC's Add
  Repository), adding the package from the listing, then the Phase 2
  installer, give the menu with no compile errors.
- `npx github:raymond-van/animama-avatar-export#v0.1.0 --help` runs.

Recovery: a failed job is re-run on its own (an existing release is kept, and
the listing is rebuilt from the published zips). A bad release is superseded by
a new patch tag; the listing keeps every older version so installed projects
still resolve. Do not move or delete published tags.

Completion: checks pass, the high-risk review (analysis plus independent
checks) has no supported blocking finding, and G1–G3 are recorded.

Implementation notes (2026-10-29, as repaired after Review #1):
`scripts/pack.mjs` (zip with `package.json` at its root via `zip -r -X -D`,
dotfiles excluded, replacing an existing zip), `scripts/build-listing.mjs` and
`scripts/listing.mjs` (the listing rebuilt from release zips, versions in
order, each with its download URL and SHA-256), `scripts/check.mjs` (versions,
tag, README install lines and CHANGELOG at release time, every dependency pin,
no network or upload code in the package or the command, `.meta` coverage,
VPM fields). Workflows pin `checkout`, `setup-node`, `upload-artifact` and
`download-artifact` to the Animama repository's SHAs and the Pages actions to
`upload-pages-artifact` v5.0.0 and `deploy-pages` v5.0.1. CI builds the
release zip and listing on every change without publishing. The root README is
the end-user guide (Phase 5's step 3, written here) with a maintainers'
"Releasing" section.

Check record before Review #1 (macOS, Node 24.15; package tree `7463a88b`):

| Check | Result |
| --- | --- |
| `npm test` (command and scripts) | 36/36 |
| `node scripts/check.mjs` | OK: version 0.1.0, 76 package files and folders, 31 sources |
| `node scripts/build-release.mjs --repository raymond-van/animama-avatar-export --out <temp>` | zip of 69 files with `package.json` at its root; listing with version 0.1.0, its release URL and a 64-character SHA-256 |
| `npm pack --dry-run` | LICENSE, README.md, `cli/{args,main,project,unity}.mjs`, package.json; no tests |
| Workflow YAML parses (PyYAML) | both parse; jobs `test`, `check`; `release` |
| Package EditMode tests (reused; Phase 4 does not touch `Packages/`) | 44/44 on `3b2c9493` |
| actionlint | not available locally; not run |
| Live CI, release workflow, Pages | not run until G1–G3 |
| Install from the listing (macOS `vpm`/ALCOM; Windows VCC) | not run until G3 (and GW) |

Independent checks (high-risk checks role) on `7463a88b` and `b7fc767b`:
`npm test` 36/36 (and 36/36 on Node 22 in a Linux container once `lsof` was
installed); `check.mjs` OK, `--tag v0.1.0` OK, `--tag v0.1.1` refused;
mutations caught (version drift, Mochiya and UniVRM pins in `Requirements.cs`,
network code in C# and JavaScript, a missing or orphan `.meta`); release build
and listing merge as designed; zip identical to the package files with
`package.json` at its root; `npm pack` packs 7 files; workflows parse and all
four action pins match their tags; actionlint not run.

After Review #1 repairs (package working tree; Node 24.15):

| Check | Result |
| --- | --- |
| `npm test` | 37/37 |
| `node scripts/check.mjs` | OK; `--tag` alone and `--tag v0.1.0` both fail until the CHANGELOG heading is released |
| `node scripts/pack.mjs --out <temp>` twice into the same folder | the second zip replaces the first (69 files, no stale entries) |
| `node scripts/build-listing.mjs … --require 0.1.0` / `--require 0.1.1` | listing 0.1.0 / refused |
| Artifact action pins (`git ls-remote`) | `upload-artifact` v5.0.0 and `download-artifact` v6.0.0 match (the Animama repository's pins) |

Commits: package repository `7b5a6f4` `ci(release)[p4]: release the package
zip and its VPM listing from version tags` (local).

#### Code Review #1 Findings

Analysis (high risk, initial round) of `7463a88b` against `26601ed`, with a
separate checks agent (above).

- **P4-F1 / P4-C2 (blocking):** any failure to fetch or parse the published
  listing (5xx, timeout, HTML, a stale cached copy) was treated as a first
  release, dropping every earlier version from the deployed listing.
- **P4-F2 (blocking):** once the GitHub release existed, a failed Pages
  upload or deploy could not be resumed; the listing could silently replace a
  version's hash.
- **P4-F3 (blocking):** G2 did not specify the Pages source or the
  environment's tag rule, so the first tag run would fail, possibly after
  publishing the release.
- **P4-F4 (blocking):** the plan's "dry run on a pre-release tag" would publish
  for real.
- P4-F5: one job held every write permission; checkout kept the token.
- P4-F6: the JavaScript network search missed bare `"https"`, `require`,
  `http2` and `tls`.
- P4-F7 / P4-C5: the pin check covered 2 of about 8 pin sites.
- P4-F8: README and CHANGELOG versions were unchecked.
- P4-F9: README gaps (zip route, PhysBone limits and gravity, "Save as"
  wording, the validation log location).
- P4-F10: tag immutability was only a comment. P4-F11: the release did not
  reuse CI or require `main`. P4-F12: concurrent tags. P4-F13 / P4-C3: `zip`
  kept stale entries. P4-F14: CI's listing check proved nothing; `--tag`
  without a value passed. P4-C1: without `lsof` the open-project check failed
  open. P4-C4: local zips included dotfiles. P4-C7: release setup
  undocumented. P4-C8: action versions (informational). P4-C9: a stray test
  line.

#### Code Review #1 Revisions

All accepted (P4-C8 informational).

- P4-F1, P4-F2: the listing is rebuilt on every release from the zips attached
  to the GitHub releases (`scripts/build-listing.mjs`), never from the
  published listing, with `--require` failing a build that lacks the new
  version; the release job keeps an existing release; build, release and
  Pages are separate jobs, so each can be re-run. `mergeListing` is gone.
- P4-F3, P4-F10: G2 now names the Pages source, the environment's `v*` rule,
  an optional required reviewer and a tag ruleset; the README's "Releasing"
  section says the same.
- P4-F4: the dry run is CI's release build plus a hash comparison after G3;
  tags with a pre-release suffix are published as pre-releases.
- P4-F5: per-job permissions (top level none); `persist-credentials: false`.
- P4-F6, P4-F7, P4-F8, P4-F14: `check.mjs` matches quoted module names with
  or without `node:`, checks every pin site (Requirements.cs versions and
  URLs, both asmdefs' version defines, the command's manifest entries), and
  with `--tag` (which now needs a value) the README install lines and a
  released CHANGELOG heading; CI's release build verifies the zip and listing.
- P4-F9, P4-C7: README updated.
- P4-F11, P4-F12: the release calls `ci.yml` and requires the tag to be on
  `main`; "push one tag at a time" is documented.
- P4-F13, P4-C3, P4-C4: `pack.mjs` replaces the zip and excludes dotfiles.
- P4-C1: `projectIsOpen` returns null when `lsof` is missing and the command
  says it could not check.
- P4-C9: the test no longer prints.

Repair budget: round 1 of 2 used.

#### Code Review #2 Findings

Analysis recheck of tree `e2f92638` (high risk, repair round 1), rerunning
`npm test` (37/37), `check.mjs` with and without tags, six `check.mjs`
mutations, packing twice, the listing cases, the workflow structure (PyYAML)
and the artifact pins: every Review #1 finding fixed; no blocking finding or
regression. Non-blocking: a draft release counts as existing and drafts are
not filtered when downloading (every case fails safely); the "could not check"
path has no `main` test; pre-release identifiers sort as strings in the
listing (VCC sorts versions itself); a pre-release tag would force the README
pin; "tested on macOS" needs Windows before G3.

Independent checks recheck of `e2f92638`: `npm test` 37/37 on macOS and in a
Node 22 Linux container without `lsof`; `check.mjs` with every tag case and 31
mutations (each pin site, network code in C# and JavaScript including bare
`"https"`, `require("tls")` and `node:http2`, `.meta` cases) caught; packing
twice over a stale zip and dotfiles gives the same 69 files and hash; the
listing build orders versions, matches each file's SHA-256, honours
`--require` and refuses mismatched, foreign, nested or empty inputs; `npm pack`
packs 7 files; every `run:` block passes `bash -n`; all six action pins match
their tags. Non-blocking: the Mochiya repository URL was not cross-checked; a
pattern scan cannot see uploads through a child process; pre-release ordering;
drafts in `gh release list`.

#### Code Review #2 Revisions

Applied as small hardening, covered by the final integration review: the
listing download passes `--exclude-drafts`, and `check.mjs` compares
`Requirements.cs`'s `MochiyaUrl` with the command's entry (a changed
repository is caught). `npm test` 37/37, `check.mjs` OK, the release workflow
parses. Left as accepted limits: child-process uploads (the command runs only
Unity, `lsof` and `git`; review covers it), pre-release key order in the
listing, the README pin for a pre-release tag, and a test for the "could not
check" log line.

### Phase 5: developer command and documentation

Review tier: high risk (raised from standard by Review #1, P5-F4): the
developer command fetches and runs the exporter release at run time, outside
the lockfile, which the tier table counts as a dependency change.

Requirements: R8, R9.

Dependencies: the `v0.1.0` release from Phase 4 (G3); the developer command
pins that tag, which must include the exporter's `--log` option (added in this
phase's Review #2); an exporter without it rejects the developer command's
arguments.

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

Implementation notes (2026-10-29, as repaired after Review #1):
`vrm-convert-vrchat.mjs` runs the exporter through `pnpm --reporter=default dlx
--package=<spec> animama-avatar-export`, starting pnpm from `npm_execpath` with
Node so no shell is needed on Windows; the pinned spec is `EXPORTER_RELEASE`,
and `ANIMAMA_AVATAR_EXPORT` selects a local checkout (with its own Unity package
as a `file:` entry). It passes `--log <Avatar>.export.log` (an exporter option
added in Review #2), so Unity's log lands at the documented name on every path. `Animama.ReferenceRender` references `UniGLTF` and
`UniGLTF.Editor` (where `InternalTPose` lives).

Check record (macOS; Animama worktree, uncommitted Phase 5 changes):

| Check | Result |
| --- | --- |
| `node --test scripts/vrm-convert-vrchat.test.mjs` (in `src/frontend/web`) | 4/4 |
| Prettier `--check` and ESLint on the two changed scripts | clean |
| `vrm:convert-vrchat` with `ANIMAMA_AVATAR_EXPORT=<local clone>`, main prefab, optimized | exit 0 (16 s); 21.87 MB raw, byte-identical to the baseline; 8.44 MB optimized; log beside the raw export |
| Same, `EditorOnly` variant, `--no-optimize` | exit 0; byte-identical to the baseline |
| `--validate --keep-pose` on an attachment prefab | exit 2 |
| Existing `--out` | exit 1 |
| Parity renderer with its new asmdef in a project with the package | first compile failed (`InternalTPose` is in `UniGLTF.Editor`); after adding that reference, 0 errors |
| The pinned release `github:raymond-van/animama-avatar-export#v0.1.0` | not run until G3 |
| G4 (owner upload check) | open |

Commits: —

#### Code Review #1 Findings

Reviewed the uncommitted Phase 5 changes on HEAD `965f5e4d` (index-copy tree
`1ac9ede6`), standard tier, initial round; reran the tests and ESLint, and
probed pnpm 10.33.0's `dlx`.

- **P5-F1 (blocking):** `pnpm -s` passes a silent reporter to the child `pnpm
  dlx`, so a failure to fetch or start the exporter (unreleased tag, offline,
  wrong override) exited 1 with no message.
- **P5-F2 (blocking):** a package-spec override (for example a GitHub branch)
  still installed the released Unity package, and pnpm caches `dlx` specs for
  a day, so it did not test what it claimed.
- **P5-F3 (blocking):** the default run wrote `<Avatar>.raw.export.log`, not
  the documented `<Avatar>.export.log` (R8).
- **P5-F4 (blocking):** fetching the exporter at run time is a dependency, a
  high-risk trigger the standard tier did not account for.
- P5-F5: `outputPaths().log` was unused. P5-F6: no tests for the pnpm command
  line or exit-code mapping. P5-F7: a drive-letter path looked like a spec.
  P5-F8: a relative override resolves against `src/frontend/web`. P5-F9:
  switching sources leaves a conflicting manifest entry. P5-F10: projects set up
  for the old script keep `Assets/AnimamaExport/`. P5-F11: the
  `packages:build` directory. P5-F12: a repeated sentence. P5-F13: plan record
  gaps (decisions, tree, step 3 status). P5-F14: the new asmdef was untracked.
  P5-F15: Windows cases for GW.

#### Code Review #1 Revisions

- P5-F1: the child runs `pnpm --reporter=default dlx …`; an exit above 2 adds
  "The exporter <spec> did not run … check the network, Git and
  ANIMAMA_AVATAR_EXPORT."
- P5-F2, P5-F7: the override accepts only a local checkout (pnpm links it, so
  edits apply at once); the package-spec form is gone.
- P5-F3, P5-F5: after the exporter runs, its log is renamed to the documented
  `<Avatar>.export.log`.
- P5-F4: tier raised to high risk; the full frontend pre-push suite runs for
  this phase and every repair is rechecked. When G3 publishes v0.1.0, pin
  `EXPORTER_RELEASE` to that tag's commit SHA rather than the tag.
- P5-F6: `exporterCommand` and `conversionExitCode` are exported and tested.
- P5-F8 to P5-F12: the guide says "absolute path", how to switch sources, to
  delete `Assets/AnimamaExport/` in old projects, where to run
  `packages:build`, and drops the repeated sentence.
- P5-F13: Decision Log entries below; step 3's guide is the package
  repository's README (no `Documentation~` folder), and the PhysBone gravity
  limit is added there with Phase 4's repairs.
- P5-F14: the asmdef is staged.
- P5-F15: added to GW's checklist.

Verification (index tree `d075afb2`, the Phase 5 changes staged): `node --test
scripts/vrm-convert-vrchat.test.mjs` 6/6 and ESLint clean; with a local
exporter checkout, the optimized export exits 0 in 19 s with its raw file
byte-identical to the baseline and the log at `<Avatar>.export.log`; an empty
folder as `ANIMAMA_AVATAR_EXPORT` exits 1 with the "did not run" message; the
full frontend pre-push suite `pnpm verify` (through the heavy-job slots) exits
0: 6201 Vitest tests passed (2 skipped) in 650 files, the Node script suites
and the build. The first `pnpm verify` failed on six `public/` files that were
Git LFS pointers in this worktree; `git lfs pull` fixed it. Repair budget:
round 1 of 2 used.

#### Code Review #2 Findings

Analysis recheck of `d075afb2` (high risk, repair round 1) and independent
checks on the same tree (tests, Prettier, ESLint, stale references, package
scripts, and the converter driven through pnpm with a fake exporter and a fake
Unity for exits 0, 1 and 2, `--validate`, `--no-optimize`,
`ANIMAMA_UNITY_EDITOR` pass-through and an existing output). Every Review #1
finding fixed except:

- **P5-R2-F1 / P5-C1 (blocking):** the log was renamed to
  `<Avatar>.export.log` only after a successful export; when Mochiya refused
  the prefab or Unity failed it stayed `<Avatar>.raw.export.log`, and the
  printed path went stale after a rename (P5-C2).
- Non-blocking: the implementation notes were out of date (P5-R2-F2); the
  Prettier record predated the repairs (P5-R2-F3); pinning a commit SHA after
  G3 also needs the test's tag pattern and the "its tag also selects the Unity
  package" comment updated (P5-R2-F4); a missing "and" in the header and
  pnpm's progress lines (P5-R2-F5); a start failure exiting 1 gets no hint
  (P5-C3, an artefact of a symlinked cache); "Wrote" printed twice with
  `--no-optimize` (P5-C4); ESLint applies no rules to `.mjs` files here, so
  "ESLint clean" means "parses" (P5-C5).

#### Code Review #2 Revisions

- P5-R2-F1, P5-C1, P5-C2: the exporter command gained `--log <file>` (package
  repository, `cli/args.mjs` and `cli/main.mjs`, with a test and a README row),
  and the developer command passes `--log <Avatar>.export.log`, so the log is
  written there on every path and every message names it; the rename is gone.
- P5-R2-F2: notes corrected. P5-R2-F3: Prettier check rerun (below).
  P5-R2-F4: recorded for the G3 pin. P5-R2-F5: header fixed. P5-C3, P5-C4:
  left. P5-C5: recorded; the check records' ESLint lines are syntax checks.

Verification (Animama index tree `08c4fdc4`, package tree `146ac47c`):
`node --test scripts/vrm-convert-vrchat.test.mjs` 6/6; exporter `npm test`
38/38 and `check.mjs` OK; with the local checkout, the main prefab exports
(exit 0, raw byte-identical) with the log at `<Avatar>.export.log`, and an
attachment prefab's `--validate --keep-pose` exits 2 with its log at
`<Avatar>.export.log`, the printed path matching. Repair budget: round 2 of 2
used.

#### Code Review #3 Findings

Analysis recheck (Animama tree `08c4fdc4`, exporter tree `146ac47c`) with a
cross-repository probe, and independent checks: tests 6/6 and 38/38,
Prettier, `check.mjs`, and the fake-Unity matrix (exits 0, 1, 2, `--validate`
0 and 2, `--no-optimize`) — in every case the log is `<Avatar>.export.log`,
Unity's `-logFile` and the printed path name it, and no `.raw.export.log`
exists; the empty-checkout message and the outside-pnpm error hold. No
blocking finding. Non-blocking: the notes still described the rename
(P5-R3-F1); the v0.1.0 tag must include `--log` (P5-R3-F2); a `--log` value not
ending in `.log` gives an odd requirements-log name (P5-R3-F3); "whenever Unity
runs" is more exact than "whether or not the export succeeds".

#### Code Review #3 Revisions

P5-R3-F1 and P5-R3-F2 recorded (notes and Dependencies); the guide says
"Whenever Unity runs" (wording only). P5-R3-F3 left: the developer command
always passes `.export.log`. The final integration review covers these.

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
