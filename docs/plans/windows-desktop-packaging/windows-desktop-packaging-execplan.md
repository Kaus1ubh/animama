# Native Windows 11 x64 desktop packaging

Status: Plan approved 2026-10-02. Phases 1–5 authorized; implementation not started.
Source agreement: [raymond-van/animama#245](https://github.com/raymond-van/animama/issues/245)
as published on 2026-10-01 (created and last updated 2026-10-01T20:53:18Z), plus
the owner decisions of 2026-10-01 and 2026-10-02 recorded in the
[Decision Log](#decision-log).
Authorized scope: Phases 1–5, approved by the owner on 2026-10-02. Phases 6–8
and the final integration review need separate authorization. Nothing in this
plan authorizes publishing a release, uploading to a distribution or changing
repository visibility.

## Purpose and context

Animama's self-contained desktop app ships only for macOS 15+ on Apple silicon.
On Windows, Animama runs only as a Docker Compose stack. The Electron package has
`pack:win`, `run:win` and `dist:win` scripts, but they produce only the Electron
shell. Every embedded-runtime command refuses Windows with "gated on desktop
Phase 5".

After this work, on a native Windows 11 x64 host:

- `pnpm desktop:runtime:stage -- --platform win32 --arch x64` and the matching
  `desktop:runtime:audit` produce an `animama-desktop-runtime/2` stage from
  source. It contains PostgreSQL 16.15 and pgvector 0.8.6 built with MSVC v143,
  the frozen FastAPI backend, the embedded web build with the browser speech
  engines, and the native input addon. The audit records every PE import and
  rejects any DLL that resolves outside the stage or the reviewed Windows
  system set.
- The packaged app runs PostgreSQL, FastAPI and its cleanup worker under a
  signed `animama-process-guard.exe`. The guard holds each process in a
  kill-on-close Job Object, so force-closing Animama leaves no owned process.
- Mutable state lives under `%LOCALAPPDATA%\Animama`, and credentials are
  protected with DPAPI through Electron `safeStorage`. Paths with spaces,
  non-ASCII characters and long names work without weakening containment.
- A per-user NSIS installer for Windows build 22000 or later installs, upgrades
  and uninstalls the app. It keeps user data unless the user explicitly removes
  the data directory shown in the prompt.
- Every shipped PE file is Authenticode-signed through Azure Artifact Signing.
  `pnpm desktop:dist:windows` and `pnpm desktop:smoke:windows` enforce the
  macOS release gates. Installed apps update from `latest.yml` in the shared R2
  distribution, with separate consent for download and restart.

Only platform-specific build, storage, process, signing, installer and update
behavior changes. Product services, the runtime manifest contract, the
application-port and principal contracts, pack security, capabilities and
update semantics stay shared with macOS.

This plan resumes Phase 5 of a private desktop runtime plan, which maintainers
retain and which was deferred on 2026-09-02. It is updated for the current
architecture: Hono is gone and FastAPI serves the application directly, so the
guard supervises only Animama's own sidecars (see
[Surprises](#surprises--discoveries) item 2). The issue owns the requirements
(R1–R8 and the documentation acceptance). This plan records how they are
implemented and verified.

### Orientation

Paths are repository-relative. `D/` abbreviates `src/frontend/desktop/`.

| Area                    | Files                                                                                                                                                                                                                                                         |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Target and build gates  | `D/scripts/runtime/common.mjs` (`parseTarget`, `PYTHON_INSTALL_DIR`, `pythonEnvironment`, `buildPython`, `run`), `D/scripts/runtime/release-gate.mjs`, `D/scripts/before-build.mjs`                                                                           |
| Native components       | `D/runtime/native-components.lock.json`, `D/scripts/runtime/native.mjs` (`buildPostgres`, `stagePostgres`), `D/scripts/runtime/native-build.mjs`, `D/scripts/runtime/macos-platform.mjs` (the Mach-O audit to mirror)                                       |
| Stage and audit         | `D/scripts/runtime/stage.mjs`, `audit.mjs`, `inventory.mjs`, `licenses.mjs`, `measure.mjs`, `size.mjs`, `schema-fingerprint.ts`, `review-packet.mjs`; `src/backend/packaging/desktop/{animama-runtime.spec,probe_postgres.py,validate_manifests.py}`             |
| Runtime contract        | `D/runtime/desktop-runtime.schema.json` (already allows `win32`/`x64`), `D/src/main-process/runtime/manifest.ts` (`verifyRuntime`, `supportsRuntimePlatform`)                                                                                                |
| Supervision             | `D/src/main-process/runtime/{processes.ts,postgres.ts,supervisor.ts,ports.ts,recovery.ts}`, `D/src/main.ts`                                                                                                                                                   |
| Storage and vault       | `D/src/main-process/runtime/{paths.ts,atomic-file.ts,vault.ts,migrations.ts}`, `D/src/main-process/feature-packs/{manager.ts,files.ts,extract.ts,catalog.ts}`                                                                                                 |
| Backend file safety     | `src/backend/animama/local/http/assets.py` (`_open_regular`), `adapters/model_assets/filesystem_store.py`, `adapters/content_store/{filesystem_store.py,mutations.py}`, `workers/{avatar_upload_cleanup.py,user_file_processing.py}`, `runtime/cli.py`         |
| Native input addon      | `D/native/global-input-hook/` (`binding.gyp`, `src/hook_windows.cc`), `D/scripts/native/{build-global-input-hook.mjs,test-global-input-hook.mjs}`, `D/src/main-process/shortcuts/global-input-hook.ts`                                                       |
| Packaging and installer | `D/electron-builder.yml` (no `nsis` section yet), `D/package.json` (`pack:win`, `run:win`, `dist:win`), `D/scripts/run-windows-app.mjs`, `D/scripts/runtime/package-development.mjs`, `D/scripts/runtime/icon.mjs`                                            |
| Signing and release     | `D/scripts/runtime/{sign-macos.mjs,macos-signing.mjs,release-macos.mjs,release-artifacts.mjs,release-policy.mjs}` (the macOS sequence to mirror), `D/runtime/{release-policy.json,feature-pack-releases.json,macos-acceptance.example.json}`                 |
| Updates                 | `D/src/main-process/updates/{policy.ts,electron-adapter.ts,controller.ts}`                                                                                                                                                                                    |
| Smoke, scan and publish | `D/scripts/runtime/{smoke-macos.mjs,smoke-policy.mjs,scan-release-candidate.mjs,release-scan.mjs,publish-macos.mjs,publish-r2.mjs,publish-github.mjs}`                                                                                                        |
| Tests                   | `D/tests/{runtime-packaging.test.mjs,runtime-state.test.ts,runtime-supervisor.test.ts,runtime-migrations.test.ts,desktop-updates.test.ts,desktop-updater-adapter.test.ts,feature-packs.test.ts,publish-r2.test.mjs}`, backend `tests/`                       |
| Docs                    | `docs/frontend/desktop/{installation,troubleshooting,runtime-staging,release-process,releases,platforms,overview,redistribution-review,size-decisions}.md`, `docs/backend/operations/model-assets.md`, `src/frontend/AGENTS.md`, `README.md`                 |

### Working environments

- **Task branch.** One branch, `build/windows-desktop-packaging`, carries this
  plan and the implementation in one PR. It starts from `main` at `94ee03c5`
  (the plan was drafted against `98bceca2`; the intervening commits do not touch
  the desktop runtime). All edits, commits and Linux checks happen in its WSL
  worktree.
- **Native execution.** Native steps run in a separate clone, `<windows-clone>`,
  on a Windows 11 x64 host.
  - Before each native run, fetch the task branch, check out the exact commit
    and confirm that `git rev-parse HEAD` matches. Uncommitted WSL edits never
    reach a receipt.
  - The clone uses `core.autocrlf=false` and `core.longpaths=true`, with LFS
    fully pulled.
  - It keeps its own dependencies: run `pnpm install --frozen-lockfile` and
    `uv sync` natively.
- **Running Windows commands from WSL.** `cmd.exe` refuses UNC working
  directories. Run Windows commands from a `/mnt/c/...` working directory, or
  through a `.bat` file that uses absolute paths. `uv` is a per-user install,
  so open a new shell after a tool installation changes `PATH`.
- **Host toolchain, verified 2026-10-01.**
  - Windows 11 x64, build 26200.
  - Visual Studio Community 2022 17.14 with MSVC v143 14.44.35207. A C++17 Job
    Object test compiled.
  - Windows SDK 10.0.26100, including signtool.
  - Node 24.15.0, pnpm 10.33.0, uv 0.12.21, Python 3.12.13 through uv,
    git-lfs 3.8.0 and gh 2.92.0 (Windows login unchecked).
  - Not yet installed: PostgreSQL build tools, signing credentials and a clean
    Windows 11 VM. The host has `LongPathsEnabled=1`, which is not the Windows
    default.
- **Windows receipts.** Each native step records:
  - the full commit and the Windows build number;
  - the toolchain versions;
  - the exact command and its exit status;
  - the key generated report.

  Raw receipts and artifacts stay in owner-local storage outside the checkout,
  and this plan keeps a public-safe summary. Hosted CI is disabled
  ([validation policy](../../backend/operations/development.md#local-first-hosted-validation)),
  so owner-reviewed local receipts are the only evidence. They are not
  independent CI.

### Boundaries

- Non-goals, from the issue:
  - Windows 10 and Windows on ARM.
  - Cross-building.
  - MSIX or the Microsoft Store.
  - Local LLM inference.
  - Public distribution.
  - The deferred document-processing and expanded-content packs.
  - The document-worker WinVerifyTrust mode.
- Packaged builds keep rejecting development overrides. No runtime feed,
  catalog or path override is added.
- Secrets travel only through the inherited environment. They never appear on a
  command line, in logs or in the repository. Signing credentials stay in the
  maintainer's Azure sign-in, and the repository records only non-secret
  account, profile and identity names.
- Build checkouts never convert LF to CRLF.
- No hosted Windows workflow is added. A manual workflow is a possible
  follow-up if hosted CI returns.
- macOS behavior stays unchanged, and every phase keeps the macOS-targeted
  tests green on Linux. macOS signed acceptance is tracked separately; the owner
  waived it as a prerequisite for this work.
- The per-user install directory is user-writable. Authenticode covers PE
  files. Other runtime files are covered by the runtime manifest hash check,
  which detects corruption but is not a boundary against code already running
  as the same user. User data has the same trust level.

## Progress

- [x] Plan review: draft written 2026-10-01; approved by the owner on 2026-10-02
      with Phases 1–5 authorized (G0).
- [x] Phase 1: Windows build foundation and native PostgreSQL. Complete on
      2026-10-02 at `d26cf5f2` ([#252](https://github.com/raymond-van/animama/issues/252));
      Windows receipt passed; review passed after one repair round.
- [ ] Phase 2: Complete Windows stage and audit. Not started.
- [ ] Phase 3: Storage, secrets and file containment. Not started.
- [ ] Phase 4: Process guard and supervised Windows runtime. Not started.
- [ ] Phase 5: Unsigned package, installer and native input. Not started.
- [ ] Phase 6: Authenticode signing and the release candidate. Not started; needs G1 and G2.
- [ ] Phase 7: Updates, smoke and publication tooling. Not started; the real upgrade needs G4.
- [ ] Phase 8: Platform audit, clean-machine journey and documentation. Not started; needs G3.
- [ ] Final integration review. Not started.

## Surprises & Discoveries

These planning findings come from inspecting the source at `98bceca2` on
2026-10-01.

1. **No pack is active.** `D/runtime/feature-pack-releases.json` marks expanded
   content and document processing as `deferred`. Parakeet is a backend model
   asset ([ADR 0012](../../adr/0012-backend-parakeet-model-assets.md)), not a
   pack, so the issue's "Parakeet is the only active pack" is out of date.
   - A Windows candidate embeds an empty pack catalog.
   - Pack transitions are exercised with the unpackaged fixture catalog
     (`ANIMAMA_DESKTOP_DEV_PACK_CATALOG_PATH`).
   - The user-visible download is the Parakeet model-asset install.
2. **There is a third long-running child.** `supervisor.ts` also launches
   `worker avatar-cleanup`. R2's acceptance (no owned process after a force
   close) therefore needs it under the guard too. Bounded commands (`initdb`,
   `pg_ctl`, `pg_dump`, `database provision`) can also outlive a crashed Electron
   (proposal P-c).
3. **Backend file safety is POSIX-only in places.**
   - `local/http/assets.py#_open_regular` serves the web root and model files
     using `os.O_DIRECTORY`, `os.O_NOFOLLOW` and `dir_fd`, none of which exist on
     Windows. FastAPI cannot serve the app on Windows until this changes.
   - The model-asset store's `_fsync_directory` uses `os.O_DIRECTORY`.
   - Content stores use `os.O_NOFOLLOW` unguarded.
   - The cleanup and user-file workers call `loop.add_signal_handler`, which
     Windows event loops do not support.
   - Some modules already branch for Windows (`mutations.py`,
     `content_package_staging.py`). `scripts/models/parakeet.py` has a
     standard-library opener that is safe against Windows reparse points, and
     its approach can be reused.
4. **The main process and scripts assume POSIX.**
   - Exact `stat.mode` checks: vault `0600`, migration snapshots, manifest and
     pack file modes, inventories.
   - Directory `fsync`.
   - Executable names without `.exe`.
   - `postmaster.pid` DataDir equality. PostgreSQL may write forward slashes
     on Windows; to verify.
   - A Unix-only `PATH` in `baseChildEnvironment`.
   - `SIGTERM`/`SIGKILL`. On Windows, `kill` is an immediate
     `TerminateProcess`.
   - Build paths `/Users/Shared` and `/private/tmp`, plus `process.getuid()` and
     `bin/python`.
   - `.cmd` shims, which Node cannot spawn without a shell.
   - `Electron.app` paths in the audit.
   - Apple-only `team_id` and `latest-mac.yml` in the update and pack policies.
   - `minimum_os "15.0"` and the Darwin kernel check in `manifest.ts`.
5. **electron-builder's Azure signing installs unpinned tooling.** In
   electron-builder 26.8.1, `win.azureSignOptions` installs the `TrustedSigning`
   PowerShell module from PSGallery at signing time, constrained only by
   `-MinimumVersion 0.5.0` (`app-builder-lib/out/codeSign/windowsSignAzureManager.js`).
   That conflicts with the pinned-input constraint (proposal P-a).
6. **No global line-ending rule exists.** The root `.gitattributes` has no
   global `eol` rule, so hashed inputs such as lock files, release JSON and
   notices rely on checkout settings.
7. **The Windows shell scripts are stale.** `D/scripts/run-windows-app.mjs`
   expects `release/win-unpacked/Anima.exe`, an old product name.
   `electron-builder.yml` has no `nsis`, icon, signing or publish settings for
   Windows, and `before-build.mjs` hard-codes `darwin-arm64`.
8. **The developer model store overlaps the app's data directory.** The default
   Windows store is `%LOCALAPPDATA%\Animama\models`, inside the installed app's
   data root.
   - On a developer machine, fresh-profile checks and explicit data removal see
     that directory.
   - Smoke and clean-machine journeys use separate Windows accounts.
   - The uninstall prompt names the exact directory it removes.
9. **Risks to verify early.** None of these has been observed yet.
   - PostgreSQL's Windows file access uses the active ANSI code page. A profile
     path containing characters outside that code page may fail. Phase 1 probes
     this. The candidate fix is a UTF-8 `activeCodePage` manifest on the
     PostgreSQL executables.
   - `postgres.exe` refuses an elevated administrator token unless it starts
     under a restricted token, which is what `pg_ctl` does. Phase 4 checks an
     elevated launch.
   - The development host has `LongPathsEnabled=1`, which hides `MAX_PATH`
     failures. Path tests and the clean machine use the default of `0`.
   - PyInstaller bootloaders are a known source of Defender false positives.
     The R8 audit records any detection.
   - On Windows 11, Smart App Control blocks unsigned executables and DLLs where
     it is on (proposal P-b).
   - Artifact Signing Basic includes 5,000 signatures a month, and each unsigned
     PE file in a candidate uses one. Phase 2 records the PE count.

10. **PostgreSQL 16's meson build needs more than the plan listed (Phase 1).**
    - Perl, Python, flex, bison, `sed`, `tar` and `gzip` are all required, even
      from the release tarball. Windows has no `sed` or `gzip`; a pinned
      busybox-w64 provides both (its digest matches the publisher's list).
    - Meson refuses the tarball's prebuilt parser and header files and names
      them; the build removes exactly those files and configures again.
    - Meson names the backend import library `postgres.exe.lib`; pgvector's
      `Makefile.win` links `postgres.lib`, so the build copies it.
    - PostgreSQL compiles its meson link arguments into `pg_config`, which
      rejected `/PDBALTPATH:%_PDB%` there. link.exe reads it from `LINK`.
11. **MSVC embeds absolute source paths (Phase 1).** `__FILE__` and the
    flex/bison `#line` names put the work-tree path into `postgres.exe`. The new
    embedded-path guard caught it, so PostgreSQL now compiles below
    `C:\animama-build\native-build`, a fixed neutral path, like macOS's
    `/opt/animama` prefix.
12. **The ANSI code-page risk was real (Phase 1).** Without a manifest, `initdb`
    failed on a data directory named `cluster データ` ("could not create
    directory …cluster ???"). With a UTF-8 `activeCodePage` manifest embedded by
    `mt.exe`, the same probe passes.
13. **`pg_ctl start` on Windows hands its handles to the postmaster (Phase 1).**
    A caller that captures pipes waits for EOF forever. The probe now sends
    `pg_ctl` output to a file. The supervisor starts `postgres.exe` directly and
    only calls `pg_ctl stop`, which returns normally.
14. **Toolchain identity differs from folder names (Phase 1).** The 14.44.35207
    toolset's `cl.exe` reports 19.44.35222; the lock pins the compiler banner.
15. **Inputs for later phases, found while exploring on Windows (2026-10-02).**
    - PostgreSQL's Windows bind error is localized OS text ("Only one usage of
      each socket address…"). The supervisor's collision regex must match
      PostgreSQL's own English hint ("Is another postmaster already running on
      port"), since NLS is disabled.
    - The frozen backend builds and passes `audit-resources` on Windows, but
      keeps `direct_url.json` (the spec filters on a `/` separator) and ships 41
      UCRT forwarder DLLs that Windows 11 already provides. It has 140 PE files.
    - Electron delay-loads `bthprops.cpl`; the addon delay-loads `node.exe`
      through node-gyp's host hook. node-gyp downloads Node headers and
      `node.lib` on Windows instead of using installed headers.
    - The native Windows desktop suite at Phase 1 had 104 failures: directory
      `fsync` (`EPERM`), POSIX mode checks, `symlinkSync` without Developer Mode,
      and macOS-only tooling tests (profile reset, release scan stubs).
    - Run through WSL interop without a console, pnpm's default reporter can
      crash (`0xC0000409`); `--reporter=append-only` works.
16. **Linux validation environment (2026-10-02).** WSL's default Node 22.14
    lacks `zlib` zstd, which 55 pack and release tests need; the suites run under
    Node 24.15.0, the CI pin. Docker is unavailable in this WSL session, so
    testcontainer and Compose backend tests error (`DockerException`) regardless
    of source. `desktop/tests/feature-packs.test.ts` is not Prettier-clean on
    `main`; this work does not touch it.

## Decision Log

- **2026-10-01, owner (issue):** waived the macOS user-verification
  prerequisite for this Windows work. macOS signed acceptance remains open and
  is tracked separately.
- **2026-10-01, owner, D1 (accepted agent recommendation):** sign with **Azure
  Artifact Signing**, formerly Trusted Signing.
  - It needs no hardware token and uses short-lived certificates under a stable,
    validated publisher identity, so SmartScreen reputation survives certificate
    rotation.
  - Microsoft documents that EV certificates no longer bypass SmartScreen.
  - If identity validation is unavailable, the owner revisits D1, with an OV
    certificate as the fallback, before Phase 6.
- **2026-10-01, owner, D2 (accepted agent recommendation):** **build PostgreSQL
  16.15 and pgvector 0.8.6 from source** with MSVC v143, using the same pinned
  source digests as macOS. This keeps the minimal macOS feature set and the
  existing audit model, and it avoids reviewing third-party binary bundles.
- **2026-10-01, owner, D3 (accepted agent recommendation):** use a **shared
  distribution with per-platform files**.
  - Windows uses electron-updater's standard `latest.yml` beside
    `latest-mac.yml`, under the same R2 `desktop/` base and `v<version>/`
    folders.
  - The pack catalog stays embedded per build with its existing
    `platform`/`architecture` fields. Model objects stay shared.
  - Each platform publishes and promotes independently.
  - On the GitHub alternate, a release that has only macOS assets makes Windows
    update checks fail until the Windows assets are added.
- **2026-10-01, owner, D4 (accepted agent recommendation):** the installer is
  **per-user only**. It installs under `%LOCALAPPDATA%\Programs\Animama` with
  no UAC prompt and updates without elevation. Each Windows account has its own
  installation owner and data.
- **2026-10-02, owner:** approved this plan, including proposals P-a to P-g, and
  authorized Phases 1–5 (G0).
- **2026-10-02, agent (Phase 1, within P-d and P-f):**
  - Pin busybox-w64 FRP-6075 for `sed` and `gzip`; remove only the prebuilt
    files meson names; build with `--buildtype=debugoptimized` (PostgreSQL's
    default) so PDBs exist, keeping them in `symbols/`, outside the runtime.
  - Compile PostgreSQL below `C:\animama-build\native-build` (item 11), and
    embed a UTF-8 active code page in the PostgreSQL executables (item 12).
  - Keep the build venv at `desktop/.desktop-runtime/build-venv/win32-x64`, as
    on macOS; only the interpreter install and caches move under the build root.
  - Pin the compiler by its banner, `cl 19.44.35222` (item 14).
  - A build root that fails the ACL check is deleted and recreated, not
    repaired in place: it holds only rebuildable inputs.
- **2026-10-02, agent (phase boundaries):** the Windows desktop suite turns
  green in steps. Phase 2 fixes or explicitly skips staging, packaging and
  macOS-only tooling tests; Phase 3 fixes the storage and vault tests; Phase 4
  the supervisor tests. The full native suite must pass by the end of Phase 4.
- **Agent proposals.** Approving this plan approves these; the owner can amend
  any of them.
  - **P-a:** sign through a repository hook. The hook calls the pinned Windows
    SDK `signtool` with a pinned Artifact Signing client library, authenticated
    through the maintainer's Azure sign-in. It does not use electron-builder's
    `azureSignOptions` (item 5).
  - **P-b:** sign every shipped PE file that lacks a valid signature, including
    third-party files. Keep valid vendor signatures, such as Microsoft's and the
    Python Software Foundation's, and report the signature of every PE file. R6
    names owned code; covering third-party files is needed for Smart App
    Control.
  - **P-c:** route every owned Windows process launch through the guard. That
    covers PostgreSQL, FastAPI, the cleanup worker and the bounded runtime
    commands.
  - **P-d:** build PostgreSQL with PG16's meson/ninja build, which replaced the
    MSVC script build removed in PG17.
    - Link the dynamic CRT (`b_vscrt=md`), with app-local VC++ runtime DLLs
      taken from the pinned MSVC redist.
    - The guard links the static CRT, so it has no runtime dependency.
  - **P-e:** use a one-click per-user NSIS installer (`oneClick: true`,
    `perMachine: false`, no elevation). The data-removal prompt appears only in
    the interactive uninstaller.
  - **P-f:** use the neutral build root `C:\animama-build`, the Windows
    counterpart of `/Users/Shared/animama-build`, with a private ACL. By
    default, Windows lets Authenticated Users modify new folders under `C:\`,
    so staging checks the ACL.
  - **P-g:** in a shared version folder, Windows evidence files whose names
    would collide with macOS files take a `-win32-x64` suffix (for example
    `release-artifacts-win32-x64.json`). macOS names stay unchanged.

## Gates

| Gate          | Needed before                                     | Owner action                                                                                                                                                                                                                                      |
| ------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G0            | Phase 1                                           | Approve this plan and authorize a phase range.                                                                                                                                                                                                    |
| G1            | Phase 6 signed evidence                           | Create the Artifact Signing account, pass identity validation, and create a public-trust certificate profile with the signer role. Sign in to Azure on the Windows host. Credentials stay outside the repository and logs.                         |
| G2            | `release:windows` passing (Phase 6)               | Review the Windows redistribution inventory: PostgreSQL, pgvector, the Python runtime, the VC++ runtime, the guard and Electron for Windows. Also review the measured size report, and approve any exception through the existing size records.   |
| G3            | Phase 8                                           | Provide a clean Windows 11 x64 VM: default `LongPathsEnabled`, Smart App Control state recorded, a standard (non-administrator) user and a second account with a non-ASCII name.                                                                   |
| G4            | The real signed forward upgrade (Phases 7 and 8)  | Separately authorize a feed that serves two signed candidates, such as a preview publication. Publication approval stays separate.                                                                                                                |
| Manual checks | Phases 4, 5, 6 and 8                              | Task Manager after a force close (Phase 4); Press-to-talk hold (Phase 5); installer upgrade, uninstall and reinstall, unsigned then signed (Phases 5 and 6); the clean-machine journey (Phase 8).                                                 |

A Windows 10 machine for checking the installer's rejection of builds below
22000 is optional. Without one, that installer check is reviewed and recorded as
unexercised. Unit tests cover the startup check.

## Phased implementation

Every phase does the following:

- Uses TDD for testable behavior.
- Updates the docs it makes incomplete or misleading.
- Runs the Linux checks that apply:
  - from `src/frontend`: `pnpm check`, `pnpm desktop:check`, `pnpm desktop:test`
    and `pnpm desktop:build`;
  - from the repository root, when backend files change: `uv run pytest -q`,
    `uv run ruff check`, `make format-check` and `make check-test`.
- Records a Windows receipt for each native step.
- Gets one bounded independent review.
- Uses commit subjects of the form `<type>(<scope>)[p#]: <summary>`, with
  scopes such as `desktop`, `runtime`, `backend` or `release`.

Run desktop commands from `src/frontend` unless a step says otherwise.

### Phase 1: Windows build foundation and native PostgreSQL

**Requirements:** R1 (PostgreSQL and pgvector, DLL audit) and the
pinned-input and line-ending constraints.
**Issue:** [#252](https://github.com/raymond-van/animama/issues/252).
**Starting source:** `00617e51` (plan commit on `94ee03c5`).
**Dependencies:** G0.

Changes:

1. **Target gate.** `parseTarget` accepts `win32-x64` on a native Windows x64
   host for the native component builder
   (`node desktop/scripts/runtime/native-build.mjs --platform win32 --arch x64`).
   The full `stage` and `audit` keep refusing Windows until Phase 2 completes
   them: move the gate rather than delete it.
2. **Build root (P-f).**
   - Windows counterparts of the interpreter, uv cache and build-venv paths
     live under `C:\animama-build`.
   - Staging refuses a root or child that grants write access to anyone other
     than the current user, SYSTEM and Administrators.
   - The staging guide gives the `icacls` command that creates the root with
     a protected ACL.
3. **Checkout integrity.**
   - Staging fails closed when `core.autocrlf` is enabled, or when
     `git ls-files --eol` reports CRLF working-tree content for a tracked text
     input.
   - Add `text eol=lf` rules for the hashed runtime inputs: `D/runtime/*.json`
     and the dependency lock files. Confirm that no tracked file is renormalized.
4. **Lock.** Add a `win32-x64` lock alongside the `darwin-arm64` one (as a
   target map or a sibling lock file; implementation chooses). It holds:
   - the same PostgreSQL and pgvector sources and digests;
   - the required MSVC toolset and Windows SDK versions;
   - pinned build tools with URLs and SHA-256 digests: portable Strawberry Perl,
     meson, ninja, and `win_flex_bison` if PG16's meson build needs it for a
     release tarball (confirm before pinning);
   - the meson options;
   - the reviewed system-DLL allowlist.
5. **Build (P-d)**, in `native.mjs`'s Windows path.
   1. Enter the pinned `vcvars64` environment and verify that `cl.exe` reports
      19.44.35207.
   2. Set up a release meson build with `b_vscrt=md`. Disable every optional
      feature that macOS disables or never enables: ICU, zlib, OpenSSL, NLS,
      readline, GSSAPI, LDAP, LZ4, zstd, libxml/libxslt and the PL languages.
   3. Link with `/PDBALTPATH:%_PDB%`, so binaries embed only PDB file names
      and no build paths.
   4. Install with `ninja install`. Build pgvector with `nmake /F Makefile.win`
      against that install, and include `pg_trgm` from contrib.
   5. Stage the locked executables (`.exe`), `libpq.dll`, the extension and
      encoding-conversion DLLs and the pruned `share/` tree. Keep the relative
      `bin/`, `lib/` and `share/` layout, which PostgreSQL uses to relocate.
   6. Write PDBs to `symbols/`; they are not shipped. Copy the VC++ runtime
      DLLs app-local from the pinned redist and record their versions and
      hashes.
   7. `native-build.json` records the toolchain and tool versions.
6. **PE dependency audit.** Add a `windows-platform.mjs` counterpart to
   `macos-platform.mjs`. It parses `dumpbin /dependents` output (imports and
   delay-load imports) from the pinned toolset. A dependency is allowed only if
   it is:
   - an API-set name (`api-ms-win-*`, `ext-ms-win-*`);
   - a name on the lock's system-DLL allowlist that exists in
     `%SystemRoot%\System32`; or
   - a staged file in the importing binary's directory.

   VC++ runtime DLLs must resolve inside the stage even when `System32` has a
   copy. Unknown names fail closed. The audit writes the DLL dependency report.
   Parser and resolution unit tests use captured `dumpbin` output and run on
   Linux, like the existing `otool` tests.
7. **Path probe.** Run a temporary cluster whose data directory contains spaces
   and characters outside the host's ANSI code page. If the cluster fails, add
   and verify a UTF-8 `activeCodePage` manifest on the PostgreSQL executables,
   and record the outcome in this plan. If neither works, stop and ask the owner
   for a decision: R3 requires non-ASCII paths.
8. **Probe.** `probe_postgres.py` handles `.exe` names and Windows paths. The
   component probe runs `initdb` with SCRAM, starts the server on loopback,
   checks pgvector and `pg_trgm`, and does a custom-format dump and restore.

Checks:

- **Linux:** standard checks, plus the new parser and lock tests.
- **Windows receipt:**
  - the native component build;
  - a DLL report with no rejection;
  - a passing component probe;
  - the code-page probe result;
  - a clean `git status` after the build.

Completion: a reproducible Windows PostgreSQL build whose dependency report
contains only system and staged DLLs. Recovery: build outputs under
`D/.desktop-runtime/win32-x64` and the build root's work directory are
disposable. Delete them and rerun.

Results (2026-10-02, issue [#252](https://github.com/raymond-van/animama/issues/252),
commit `d26cf5f2`):

- **Windows receipt** at `d26cf5f2` (detached checkout, clean `git status`
  before and after), Windows 11 build 26200, Node 24.15.0, pnpm 10.33.0, uv
  0.12.21:
  - `node desktop/scripts/runtime/native-build.mjs --platform win32 --arch x64`
    exited 0. `native-build.json`: MSVC 19.44.35222, SDK 10.0.26100.0, redist
    14.44.35112, app-local `vcruntime140.dll`, lock SHA-256 `9d3751a3…`
    (matches the committed lock).
  - DLL report: 36 PE files; 113 imports resolve to API sets, 68 to staged files
    and 51 to the reviewed system set (`advapi32`, `kernel32`, `secur32`,
    `shell32`, `ws2_32`). No rejection; no embedded checkout or home path.
  - `probe_postgres.py --postgres-only` exited 0 with a cluster at a path
    containing a space and Japanese characters: pgvector 0.8.6, vector distance
    0, custom dump and restore verified.
  - The staged `runtime/postgres` tree is 17 MB.
- **Linux** (Node 24.15.0): `pnpm check`, `pnpm desktop:check` and
  `pnpm desktop:build` exit 0; `pnpm desktop:test` 385 passed, 11 skipped;
  Prettier clean on changed files; `ruff check` and `ruff format --check` pass;
  `make check-test` passed typed-content audit, format, lint and mypy, but its
  pytest step errors on Docker-dependent tests (item 16). The probe has no
  backend test.
- Not run: any macOS step. The macOS paths changed only by sharing
  `downloadVerified` and adding the LF checkout check; review found no
  regression.

#### Code Review #1 Findings

Independent reviewer, working tree on `cca91414`, full initial review. Checks:
`pnpm desktop:check`, `pnpm desktop:test`, Prettier, `ruff`, `git ls-files
--eol`, and download of all seven pinned inputs (every SHA-256 matched the
lock).

- **P1-R1-01 (blocking):** the ACL refusal printed an `icacls` command using
  `%USERNAME%`, which PowerShell does not expand, and `/grant:r` cannot fix a
  foreign owner; the guide did not give the command.
- **P1-R1-02:** removing the `win32` refusal from `parseTarget` also opened
  `document-worker.mjs` and the `feature-packs.mjs` command line.
- **P1-R1-03:** the meson-conflict containment check split only on `/`; a
  backslash name could escape the source tree on Windows.
- **P1-R1-04:** unrecognized (for example localized) `dumpbin` output parsed as
  "no imports", failing open.
- **P1-R1-05:** `set` output was decoded as UTF-8 although cmd writes the OEM
  code page; `vswhere -latest` could pick a Visual Studio without the pinned
  toolset.
- **P1-R1-06:** extracted tool directories were keyed by version only, so a
  changed digest could reuse old files.
- **P1-R1-07:** the ACL check did not reject a junction at the build root and
  skipped `uv-cache` and `native-build`.
- **P1-R1-08:** sending `pg_ctl start` output to `DEVNULL` lost diagnostics.
- **P1-R1-09:** the plan did not record the build-venv location, compiler
  banner or build type.
- **P1-R1-10:** a `common.mjs`/`windows-build.mjs` import cycle, a narrow
  `systemTool` comment and a stale probe README.
- Evidence gaps: native evidence predated the final source, and some Linux
  checks were unreported.

#### Code Review #1 Revisions

All findings accepted and fixed in `d26cf5f2`:

- P1-R1-01: the refusal now says the folder holds only rebuildable inputs and
  to delete it and rerun; the staging guide says the same.
- P1-R1-02: `document-worker.mjs` refuses non-macOS hosts; the pack command
  line refuses `win32` until Phase 2.
- P1-R1-03: names containing `\` are rejected; test added.
- P1-R1-04: the parser requires the English `Dump of file` and `Summary` lines
  and the MSVC environment sets `VSLANG=1033`; tests cover localized output, a
  DLL without imports and `.cpl` names.
- P1-R1-05: `cmd /u` with UTF-16 decoding; vswhere `-all -utf8` selects the
  first installation that has the pinned toolset.
- P1-R1-06: tool directories include the first 12 digest characters.
- P1-R1-07: links and junctions are rejected; the uv cache and `native-build`
  are checked too.
- P1-R1-08: `pg_ctl start` writes to `pg_ctl.log`; failures include it and the
  server log.
- P1-R1-09: recorded in the Decision Log and Surprises above.
- P1-R1-10: ACL code moved to `windows-acl.mjs` (no cycle); comment and README
  updated.
- Evidence: the Windows receipt and Linux checks above ran at `d26cf5f2`.

#### Code Review #2 Findings

Targeted recheck of `d26cf5f2` (repair round 1 of 2): every Review #1 finding
resolved; no blocking finding; macOS paths unchanged.

- **P1-R2-01 (non-blocking):** `windows-acl.mjs`'s `capture` helper drops the
  tool's stderr, so an ACL read or `icacls` failure reports only a status.

#### Code Review #2 Revisions

- P1-R2-01: accepted; the Phase 2 commit adds the stderr tail to the error. It
  does not affect a passing build, so the Phase 1 receipt stands.
- Result: Phase 1 passed with one repair round used.

### Phase 2: Complete Windows stage and audit

**Requirements:** R1 (full stage and audit, inventories, notices, size report,
schema digest, backup-restore probe) and R4 (the addon builds and loads).
**Issue:** [#253](https://github.com/raymond-van/animama/issues/253).
**Dependencies:** Phase 1.

Changes:

1. **Staging pipeline.** The Windows branches in `stage.mjs` and `common.mjs`:
   - use `Scripts\python.exe`;
   - invoke pnpm and uv without a shell, resolving their executable or
     JavaScript entry point (never `shell: true`);
   - give children the minimum Windows environment (`SystemRoot`,
     `TEMP`/`TMP`);
   - copy the win32 Electron distribution;
   - build the addon with node-gyp and MSVC.

   The audit loads the addon through `electron.exe` with `ELECTRON_RUN_AS_NODE`
   and checks its five exports and the bundled zstd API.
2. **Frozen backend.**
   - Run PyInstaller 6.22.2 on Windows with the existing spec, which already
     sets `upx=False`.
   - On win32, `cli.py` reports the deferred document worker as unavailable
     instead of exec-ing a macOS path.
   - The workers stop gracefully on Windows without `add_signal_handler`, by
     handling `SIGBREAK` and `SIGINT`.
   - `audit-resources`, `database provision|bootstrap|inspect` and
     `content audit` run on Windows.
3. **Runtime contract.**
   - win32 manifests use `minimum_os: "10.0.22000"`, and `manifest.ts`
     validates the minimum for each platform.
   - Required executables are named with `.exe` on win32.
   - `supportsRuntimePlatform` admits win32/x64 when the build number in
     `os.release()` is 22000 or higher. This is the startup half of R5 and
     shows a clear "Windows 11 required" error. The darwin rules are
     unchanged.
   - Windows has no POSIX mode bits. win32 inventories record normalized modes
     (`0755` for PE files, `0644` for everything else), and runtime verification
     on Windows checks size and hash, not `stat.mode`.
4. **PostgreSQL in the main process.** `PrivatePostgres` uses `.exe` names and
   compares the `postmaster.pid` DataDir after normalizing the path. The schema
   digest and the audit's backup-restore probe run with Windows paths.
5. **Licenses and review.** The license inventory, notices and redistribution
   packet cover the Windows inputs:
   - PostgreSQL and pgvector built with MSVC;
   - the Python runtime that uv installs (record its distribution and license);
   - the VC++ runtime, under Microsoft's distributable-code terms;
   - Electron's Windows notices;
   - a first-party entry for the guard, filled in by Phase 4.
6. **Size.** Measure the Windows core against the 750 MiB and 1.5 GiB caps.
   Baselines stay keyed by target. Record the number of PE files to budget for
   signing.
7. **Gate.** Lift the win32-x64 gate for `stage` and `audit`. The audit runs the
   Windows dependency audit across `runtime/`, `app/` and `electron/`.
8. **Native tests.** `pnpm desktop:test` passes on the Windows host. POSIX-only
   cases are skipped explicitly, and Windows counterparts are added where
   behavior differs.

Checks:

- **Linux:** standard checks.
- **Windows receipt:**
  - `pnpm desktop:runtime:stage -- --platform win32 --arch x64` and
    `pnpm desktop:runtime:audit -- --platform win32 --arch x64` succeed;
  - the DLL report, `size-report.json`, notices and inventory;
  - `database_schema_sha256`;
  - `backup_restore_verified: true`;
  - the PE count;
  - `pnpm desktop:test` passes on Windows.

Completion: R1 is met on a Windows 11 x64 host and the addon loads in the staged
Electron. Recovery: a stage failure writes `stage-failure.json`. Correct the
input and restage; staging starts from an empty target.

Results: pending.

#### Code Review #1 Findings

Pending.

#### Code Review #1 Revisions

Pending.

### Phase 3: Storage, secrets and file containment

**Requirements:** R3.
**Issue:** [#254](https://github.com/raymond-van/animama/issues/254).
**Dependencies:** Phase 2, for the stage these tests run against. Phase 4 needs
this phase because FastAPI cannot serve the app on Windows before item 3.

Changes:

1. **Main-process file safety.**
   - `atomicWrite`, migration snapshots and pack transitions retry atomic
     replacement with a bounded backoff when Windows reports `EPERM`, `EACCES`
     or `EBUSY` (sharing violations from antivirus or indexer scans). They
     never fall back to a non-atomic copy.
   - Directory `fsync` is skipped where Windows rejects it.
   - `privateDirectory` and the other path checks reject reparse points
     (symlinks and junctions).
   - Mode assertions become platform-aware: on Windows, privacy comes from the
     per-user `%LOCALAPPDATA%` ACL. The regular-file and single-link checks
     remain.
2. **Vault.** DPAPI-backed `safeStorage` still fails closed. Windows-specific
   recovery advice replaces the macOS keychain wording.
3. **Backend containment on Windows.**
   - `_open_regular` gains a Windows branch. It rejects reparse points along the
     path and at the leaf, and verifies that the opened handle's identity
     matches the checked path, reusing the approach from
     `scripts/models/parakeet.py`.
   - The model-asset and content stores use guarded `O_NOFOLLOW`/directory
     operations.
   - `os.replace` for model-asset installs retries on sharing violations.
   - The POSIX branches stay unchanged.
4. **Path budget.** Define the maximum data-root length that keeps the deepest
   runtime path (PostgreSQL, model assets, packs) under `MAX_PATH` with
   `LongPathsEnabled=0`. Startup fails with a clear error for a longer root.
5. **Tests.**
   - Main process:
     - Vault round-trip through the real `safeStorage`, in a Windows Electron
       harness.
     - Failure when encryption is unavailable.
     - Data roots containing spaces, non-ASCII characters outside the active
       code page, and names at the path budget, including PostgreSQL
       initialization and start under such a root.
     - Locked-file retry, simulated by holding a handle without
       `FILE_SHARE_DELETE`: success after release, and a clear failure after the
       retry window.
     - A missing or altered runtime DLL fails `verifyRuntime` before launch with
       a recovery error.
     - A process exit of `STATUS_DLL_NOT_FOUND` or
       `STATUS_INVALID_IMAGE_FORMAT` maps to a clear error.
   - Backend:
     - Windows tests for the new branches run on the Windows host as targeted
       `uv run pytest` selections.
     - The full suite runs on Linux.

Checks:

- **Linux:** standard checks plus the backend suite.
- **Windows receipt:**
  - the targeted backend tests;
  - `pnpm desktop:test`;
  - the Electron vault harness;
  - the path tests, run against a data root at the budget so they hold under
    the default `LongPathsEnabled=0`.

Completion: every R3 acceptance test passes on Windows. Recovery: tests use
disposable data roots and never touch `%LOCALAPPDATA%\Animama`.

Results: pending.

#### Code Review #1 Findings

Pending.

#### Code Review #1 Revisions

Pending.

### Phase 4: Process guard and supervised Windows runtime

**Requirements:** R2, and the end-to-end part of R3's missing-DLL test.
**Issue:** [#255](https://github.com/raymond-van/animama/issues/255).
**Dependencies:** Phase 3.

Changes:

1. **Guard.** C++17 source under `D/native/process-guard/`, built during Windows
   staging with the pinned MSVC v143 toolset, the static CRT and hardening
   flags (`/guard:cf`, `/DYNAMICBASE`, `/HIGHENTROPYVA`, `/CETCOMPAT`). It lands
   in `runtime/bin/animama-process-guard.exe`. The proposed protocol (the
   implementation may refine it within R2):
   - **Command line:** `animama-process-guard.exe -- <absolute executable> <args...>`.
     The child inherits the guard's environment, so secrets never appear on any
     command line.
   - **Startup:**
     1. Create a Job Object with `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` and no
        breakaway.
     2. Start the child with `CREATE_SUSPENDED | CREATE_NEW_PROCESS_GROUP`,
        inheriting only stdout and stderr.
     3. Assign the child to the job.
     4. Write one handshake line with the child's PID, then resume the child.
   - **Lifeline:** the guard's stdin is a pipe held by Electron. End-of-file,
     whether from an Electron exit, a crash or an explicit close, starts a
     graceful stop: send `CTRL_BREAK_EVENT` to the child's process group, then
     `TerminateJobObject` after a bounded timeout. Killing the guard closes the
     job, which kills everything in it.
   - **Exit:** the guard exits with the child's exit code once the job has no
     active process.
   - **Launch:** Electron starts the guard with `windowsHide`
     (`CREATE_NO_WINDOW`).
2. **Integration (P-c).**
   - On win32, `processes.ts` launches every owned process through the guard.
     It holds the guard's stdin, parses the handshake, and records both the
     guard and service PIDs in `processes.json`.
   - `terminate` closes stdin, waits 15 s, then kills the guard.
   - `runCommand` also uses the guard.
   - The health check and the `postmaster.pid` match compare the service PID.
   - FastAPI and the workers handle Ctrl+Break gracefully. Verify that uvicorn
     0.38.0 handles `SIGBREAK`, and add handling where it does not.
3. **Elevated launch.** Check PostgreSQL under an elevated token. Either start
   it with a restricted token, as `pg_ctl` does, or reject an elevated launch
   with a clear message. Record the choice.
4. **Inventory.** The stage, inventory and notices list the guard as
   first-party.
5. **Tests.**
   - **Guard tests** (Windows-only vitest, skipped elsewhere):
     - killing the guard ends the child and its grandchildren;
     - closing stdin gives a graceful exit with the exit code forwarded;
     - a child that ignores Ctrl+Break is terminated after the timeout;
     - the handshake precedes any child output;
     - the child's command line, read through CIM, contains no secret.
   - **Startup-stage harness**
     (`D/scripts/native/test-runtime-termination-windows.mjs`):
     1. Launch unpackaged Electron with `ANIMAMA_DESKTOP_DEV_RUNTIME_ROOT` and a
        disposable `ANIMAMA_DESKTOP_DEV_USER_DATA`.
     2. For each `RuntimeStage` (validating, vault, application, database,
        migrations, backend, ready), force-kill Electron when the runtime log
        reports that stage.
     3. Assert that, within 30 s, no process remains whose executable is under
        the runtime root.
     4. Assert that the next launch succeeds without `previous_runtime_running`
        and that PostgreSQL recovers.
   - **Supervised launch:** an unpackaged supervised launch reaches ready and
     serves the app. Quit stops everything. A restart keeps the origin and
     principal.
   - **Missing DLL:** the end-to-end missing-DLL check from Phase 3.

Checks:

- **Linux:** standard checks, including mocked supervisor tests for the win32
  paths.
- **Windows receipt:** guard tests, the stage-termination harness, the
  supervised launch, and a restage and audit that include the guard.
- **Manual (owner):** after force-closing Animama with Task Manager's End task,
  Task Manager shows no owned PostgreSQL, FastAPI, worker or guard process.

Completion: R2's automated acceptance passes and the owner's manual check is
recorded. Recovery: a crashed run leaves at most a stale `processes.json`. The
next launch refuses while any recorded PID is alive and never kills it, which
preserves the existing behavior.

Results: pending.

#### Code Review #1 Findings

Pending.

#### Code Review #1 Revisions

Pending.

### Phase 5: Unsigned package, installer and native input

**Requirements:** R4 (manual Press-to-talk) and R5.
**Issue:** [#256](https://github.com/raymond-van/animama/issues/256).
**Dependencies:** Phase 4.

Changes:

1. **Packaging gate and config.**
   - `before-build.mjs` accepts win32-x64 when its exact audited stage is
     present.
   - `electron-builder.yml` takes `extraResources` from the target's stage.
   - `win` settings: an `.ico` generated by `icon.mjs`, artifact names, version
     resources and `asInvoker`.
   - `nsis` settings (P-e): one-click, `perMachine: false`, no elevation, Start
     menu entry, and an `include` script.
2. **NSIS include** (`D/build/installer.nsh`).
   - `customInit` rejects builds below 22000 with a clear message, or an exit
     code when silent.
   - The interactive uninstaller asks whether to remove data, defaulting to No,
     and shows the exact `%LOCALAPPDATA%\Animama` path. Silent and
     `--updated` runs never ask and never remove data.
   - A yes removes only that directory.
3. **Development packaging.**
   - `package-development.mjs` gains a Windows unsigned `dir` build. It
     reverifies the runtime against the audited inventory and writes
     `development-package-report.json`.
   - Fix `pack:win`/`run:win`: the staged runtime and `Animama.exe`.
   - Add a documented command that builds an unsigned NSIS installer for local
     installer testing. It is never a release.
4. **App identity.** `main.ts` calls `app.setAppUserModelId("com.animama.desktop")`.
5. **Addon test.** `test-global-input-hook.mjs` gains a Windows mode. It loads
   the addon from the packaged `app.asar.unpacked` and exercises `start` and
   `stop`.

Checks:

- **Linux:** standard checks.
- **Windows receipt:**
  - the unsigned package and its verification report;
  - the native addon test;
  - an unsigned installer build.
- **Manual (owner):**
  - Press-to-talk hold with a keyboard key and a mouse button in the packaged
    app.
  - The installer journey:
    1. Install version N and run it.
    2. Upgrade to N+1 and confirm data is kept.
    3. Uninstall and confirm `%LOCALAPPDATA%\Animama` remains.
    4. Reinstall and confirm the chats return.
    5. Explicit removal deletes exactly the directory shown.

Completion: R4 and R5 pass with unsigned artifacts. Phase 6 repeats the
installer journey signed. Recovery: installer tests use a test account or a
disposable profile, and the uninstall prompt defaults to keeping data.

Results: pending.

#### Code Review #1 Findings

Pending.

#### Code Review #1 Revisions

Pending.

### Phase 6: Authenticode signing and the release candidate

**Requirements:** R6, and R7's candidate gates (exact hash, size, license
inventory).
**Issue:** created at workspace setup.
**Dependencies:** Phase 5. Signed evidence needs G1, and a passing release gate
needs G2. Implementation and unit tests may proceed before both.

Changes:

1. **Release inputs.**
   - Add a `windows` publisher entry beside `macos`, with non-secret values
     only: the Artifact Signing endpoint, account and certificate-profile names,
     the expected certificate subject, and the identity-validation EKU.
   - Record a redistribution review receipt for each target.
   - `validateReleasePolicy` validates each platform without weakening macOS.
2. **Signing tools (P-a).**
   - Pin the Windows SDK `signtool` to 10.0.26100 and record its file hash.
   - Pin the Artifact Signing client library by version and SHA-256.
   - Sign with SHA-256 file and timestamp digests, timestamped by Microsoft's
     Artifact Signing timestamp service.
3. **`sign-windows.mjs`** (P-b).
   1. Sign the unsigned PE files under `resources/runtime` and
      `resources/app.asar.unpacked`, deepest first: the guard, PostgreSQL, the
      backend, Python extensions and the addon. Valid vendor signatures stay.
   2. Re-inventory `runtime/manifest.json`, which yields a new build ID, before
      the main executable, uninstaller and installer are signed.
   3. Verify every PE file with `Get-AuthenticodeSignature`: `Valid`, the
      expected subject, and a timestamp.
   4. Write `signing-report.json` (`animama-windows-signing/1`).
4. **`release-windows.mjs`** (through `release-gate.mjs windows`).
   - It requires:
     - a fresh stage and audit;
     - enough free space;
     - matching review receipts;
     - the sealed distribution.
   - It builds the signed installer and enforces the 750 MiB installer cap, the
     1.5 GiB installed cap and the five-percent rule.
   - It writes `desktop/release/publish` with:
     - the installer and `latest.yml`;
     - the runtime manifest and pack catalog;
     - the notices, inventory and SBOM;
     - the signing and size reports;
     - the model candidates;
     - the Windows artifact index and checksums (P-g).

Checks:

- **Linux:** standard checks, plus unit tests for policy validation, signing
  order and report validation.
- **Windows receipt:**
  - `pnpm desktop:dist:windows` succeeds on the exact candidate;
  - `signing-report.json` lists every PE file as `Valid`;
  - the measured installer and installed sizes;
  - the number of signatures used.
- **Manual (owner):** repeat the Phase 5 installer journey with the signed
  candidate, and record SmartScreen's behavior on download.

Completion: a signed candidate passes every candidate gate. Recovery: a
signature or input change creates a new candidate that needs fresh review;
receipts never carry over. Signing failures leave unsigned outputs, which the
release gate refuses.

Results: pending.

#### Code Review #1 Findings

Pending.

#### Code Review #1 Revisions

Pending.

### Phase 7: Updates, smoke and publication tooling

**Requirements:** R7.
**Issue:** created at workspace setup.
**Dependencies:** Phase 6. The real forward upgrade needs G4.

Changes:

1. **Update policy (D3).**
   - Each platform has its own publisher: an Apple Team ID, or an Authenticode
     subject plus EKU.
   - Windows candidates must be `Animama-<version>-x64.exe` with
     `minimumSystemVersion` `10.0.22000`, `platform: win32` and
     `architecture: x64`.
   - `allowedUpdateUrl` admits `<base>/latest.yml` for Windows builds only. The
     GitHub rules are unchanged.
2. **Adapter.**
   - Windows uses electron-updater 6.8.9's `NsisUpdater` with the macOS
     restrictions: no automatic download, no install on quit, no differential
     or web installer, and exact size and SHA-512 checks.
   - Before installing, the adapter verifies the downloaded installer's
     publisher (Authenticode subject and EKU).
   - `install()` runs after `stopForUpdate`. A failure before quitting calls
     `recoverFailedUpdate`.
   - `initializeUpdates` is enabled for packaged win32-x64 builds.
3. **Feed and publishers.**
   - The feed producer writes the Windows `latest.yml`. The R2 and GitHub
     publishers upload Windows files to the shared version folder or release.
   - Stable promotion writes `latest.yml` last, and preview omits it.
   - The R2 precheck reads the Windows feed.
   - Add `windows-acceptance.example.json` and `ANIMAMA_WINDOWS_ACCEPTANCE`.
   - Generalize the macOS publisher or add a Windows one, whichever change is
     smaller.
4. **`smoke:windows`** (`smoke-windows.mjs`). In a separate Windows test
   account that has no `%LOCALAPPDATA%\Animama`, it:
   1. silently installs the exact installer for that user;
   2. drives the app with Playwright `_electron`;
   3. rejects a blank name and completes the named setup;
   4. checks that removing a temporary provider key persists across restart;
   5. quits and confirms that no owned process remains.

   It writes `smoke-name` reports bound to the installer's SHA-256 and the
   runtime build ID. It refuses an existing profile and never resets data.
5. **Release scan.**
   - Expand the NSIS installer and its 7z payload with the pinned `7zip-bin`,
     then the ASAR and PyInstaller archives.
   - The home-directory search covers Windows profile paths in UTF-8 and
     UTF-16LE, with both separators.

Checks:

- **Linux and Windows:** unit tests for the policy, adapter, feed, publisher and
  smoke policy.
- **Windows receipt:** `desktop:dist:windows`, `desktop:smoke:windows` and
  `desktop:release:scan` pass on the exact candidate.
- **Real forward upgrade, after G4:**
  1. Build signed candidates N and N+1, and publish them to the authorized
     preview feed.
  2. Install N, then accept the download and restart prompts.
  3. Confirm that N+1 runs with state preserved, and that a pre-migration
     snapshot exists when the migration head changes.

  Without G4, record this as pending.

Completion: R7 passes except the G4-gated upgrade, which stays open until it is
authorized and run. Recovery:

- A failed update before quit restores the services.
- An installer failure after quit leaves the previous data and pre-migration
  snapshot intact. The user reruns the installer.
- Publishing resumes byte-identical uploads only, as it does for macOS.

Results: pending.

#### Code Review #1 Findings

Pending.

#### Code Review #1 Revisions

Pending.

### Phase 8: Platform audit, clean-machine journey and documentation

**Requirements:** R8, the clean-machine acceptance and the documentation
acceptance.
**Issue:** created at workspace setup.
**Dependencies:** Phase 7 and G3.

Steps:

1. **R8 audit.** Record each item as working or as explicitly documented
   unsupported:
   - **Defender:** scan latency on first launch, and any detection.
   - **SmartScreen and Smart App Control:** behavior on a browser download that
     carries the Mark of the Web.
   - **Firewall:** no prompts.
   - **Loopback binding:** owned listeners bind only to `127.0.0.1`, checked with
     `Get-NetTCPConnection`.
   - **Microphone:** behavior with the Windows privacy settings on and off; a
     denial shows a clear error.
   - **WebSockets:** upgrades work.
   - **PostgreSQL crash recovery:** after killing `postgres.exe`, and after
     killing the whole tree.
   - **Pack replacement while antivirus scans:** the fixture catalog with a
     held-handle test, plus Parakeet install and removal with real-time
     protection on.
   - **Windows integration:** PiP click-through, quick chat and global
     shortcuts.
   - **Accounts and paths:** an elevated launch, a non-ASCII account name, and
     the default `MAX_PATH` setting.
2. **Clean-machine journey**, on the G3 VM:
   1. Credential-free first run.
   2. The required name.
   3. A provider key.
   4. Chat with both starter Animas.
   5. PocketTTS.
   6. Optional Parakeet with offline dictation.
   7. Restart.
   8. Crash recovery.
   9. A prompted update, once G4 allows it.
3. **Documentation.**
   - Add Windows sections to installation, troubleshooting, runtime staging and
     the release process.
   - Update platforms, releases, overview, redistribution review, the
     model-store note, `src/frontend/AGENTS.md` and `README.md`.
   - Remove the "Windows deferred" statements, while keeping acceptance and
     publication gates honest.
4. **ADR.** If the [ADR guide](../../adr/README.md) criteria hold, record ADR
   0013 for the Windows packaging decisions: the signing identity, per-user
   scope, shared distribution layout and guard ownership.

Checks: the docs follow the reader-value standard. The Windows receipts and
manual results are recorded here with the tested Windows build and app version.

Completion: every R8 item is resolved and the clean-machine journey is
recorded. Any item that still depends on G4 is listed as open.

Results: pending.

#### Code Review #1 Findings

Pending.

#### Code Review #1 Revisions

Pending.

## Final integration review

The final integration review covers the combined acceptance below. It reuses
still-valid phase evidence, and every native receipt must name the final
candidate commit or an unchanged input. It confirms that:

- macOS-targeted tests still pass on Linux;
- no development override is reachable in packaged builds;
- secrets stay out of command lines, logs and reports.

The repair-round limits are the same as for phases. Findings: pending.

## Validation and acceptance

| Issue acceptance            | Evidence                                                                                                                           | Phase |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ----- |
| R1                          | Windows stage and audit receipt with the DLL dependency report and size report                                                     | 1–2   |
| R2                          | Guard and startup-stage termination tests; the owner's Task Manager check                                                          | 4     |
| R3                          | Vault round-trip and failure, path, locked-file retry and missing or corrupt DLL tests                                             | 3–4   |
| R4                          | The addon builds and loads; the owner's Press-to-talk hold check                                                                   | 2, 5  |
| R5–R6                       | Installer upgrade, uninstall-keeps-data and reinstall journey; a signature report covering every PE file                           | 5–6   |
| R7                          | `release:windows` and `smoke:windows` on the exact candidate; a real signed forward upgrade after G4                               | 6–7   |
| R8 and clean-machine        | The audit table and journey on the G3 VM                                                                                           | 8     |
| Docs                        | Windows sections, with the deferred statements removed                                                                             | 8     |

Every unperformed check stays listed as pending. Unsigned, mocked or
development-host results never stand in for the signed, clean-machine or
real-upgrade evidence.

## Idempotence and recovery

- **Disposable outputs.** Stages, build roots, packages and candidates are
  disposable. Rerunning starts from an empty target. Candidates under
  acceptance are preserved outside disposable outputs before a rebuild.
- **User data.** No step resets or deletes `%LOCALAPPDATA%\Animama` on a real
  profile. Tests use disposable data roots or separate Windows accounts. Data
  removal happens only through the explicit uninstall choice.
- **Process records.** The runtime never kills a process it did not start in
  the current session. A stale record blocks startup with recovery advice.
- **Signing.** Signing consumes Artifact Signing quota, so re-sign only
  intentional candidates. A signed candidate is invalidated by any input change.
- **Publication.** Publication stays create-only and resumable, as for macOS.
  Stable feed promotion happens last.

## Outcomes & Retrospective

Pending.
