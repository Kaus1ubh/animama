# Native Windows 11 x64 desktop packaging

Status: Plan approved 2026-10-02. Phases 1–6 merged; Phases 7–8 agent work
complete, with owner gates open (smoke and account checks, manual checks, G3, G4).
Source agreement: [raymond-van/animama#245](https://github.com/raymond-van/animama/issues/245)
as published on 2026-10-01 (created and last updated 2026-10-01T20:53:18Z), plus
the owner decisions of 2026-10-01 and 2026-10-02 recorded in the
[Decision Log](#decision-log).
Authorized scope: Phases 1–5, approved by the owner on 2026-10-02 and merged
in [#258](https://github.com/raymond-van/animama/pull/258); Phase 6, approved on
2026-10-03 and merged in [#266](https://github.com/raymond-van/animama/pull/266);
Phases 7–8, approved on 2026-10-03. Nothing in this plan
authorizes publishing a release, uploading to a distribution or changing
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
- [x] Phase 2: Complete Windows stage and audit. Complete on 2026-10-02 at
      `f422046a` ([#253](https://github.com/raymond-van/animama/issues/253));
      Windows stage and audit receipts passed; review passed after two repair
      rounds.
- [x] Phase 3: Storage, secrets and file containment. Complete on 2026-10-02
      at `555f8a45` ([#254](https://github.com/raymond-van/animama/issues/254));
      Windows receipts passed; review passed after two repair rounds. The
      DB-backed backend suite passed later at `e3de5f49`.
- [x] Phase 4: Process guard and supervised Windows runtime. Complete on
      2026-10-02 at `5cba6a6a`
      ([#255](https://github.com/raymond-van/animama/issues/255)); Windows
      receipts passed; review passed after two repair rounds; the owner's Task
      Manager and Run-as-administrator checks passed.
- [x] Phase 5: Unsigned package, installer and native input. Complete on
      2026-10-03 at `127b09c2`
      ([#256](https://github.com/raymond-van/animama/issues/256)); Windows
      receipts, uninstall tests and the installer journey passed; review passed
      after two repair rounds. The owner's keyboard Press-to-talk check
      passed; the owner waived the mouse-button check and accepted the
      agent-run installer journey on 2026-10-03.
- [x] Phase 6: Authenticode signing and the release candidate. Complete on
      2026-10-03 ([#259](https://github.com/raymond-van/animama/issues/259)),
      on branch `build/windows-desktop-signing` from `main` at `401ac3b8`.
      Review passed after two repair rounds. G2 approved by the owner. The
      signed candidate built at `4ac1d21b`. The signed installer journey,
      which the owner asked the agent to run, passed. SmartScreen warned about
      an unrecognized app, as expected for a new signing identity.
- [ ] Phase 7: Updates, smoke and publication tooling
      ([#268](https://github.com/raymond-van/animama/issues/268)). Agent work
      complete at `fa2574c3` on branch `build/windows-desktop-updates` from
      `main` at `733d2315`; review passed after two repair rounds; final
      candidate built and scanned. Open: the Windows smoke in a fresh account
      (owner to create it) and the G4 upgrade (owner chose to keep it pending).
- [ ] Phase 8: Platform audit, clean-machine journey and documentation
      ([#269](https://github.com/raymond-van/animama/issues/269)). Agent work
      complete at `fa2574c3`; review passed after one repair round; automated
      R8 items passed. Open: the owner's manual checks, the non-ASCII account,
      the clean-machine journey and default `MAX_PATH` (G3), and G4.
- [x] Final integration review. Phases 1–5: review #1 blocked on FI-01, which
      is resolved; review #2 blocked on FI2-01; review #3 passed (below).
      Phases 6–8: review #1 passed at `9bef2a4e`, with three optional items
      applied.

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
    `main` (line 904); this work edits other lines of it, not that one.

17. **Windows staging needed workspace fixes outside the desktop scripts
    (Phase 2).** `packages:build` used single-quoted pnpm filters, which
    `cmd.exe` passes literally, so on Windows it built nothing and `web:check`
    failed; the filters now use escaped double quotes. The `prettier` scripts
    keep POSIX quoting and remain POSIX-only.
18. **The Windows stage fits the size caps (Phase 2).** Core download
    409 MB of 750 MiB; installed 979 MB of 1.5 GiB. The stage has 145 PE files,
    so a signed candidate stays far inside Artifact Signing's monthly quota.
19. **Windows imports 56 system DLLs (Phase 2).** All are Windows 11
    components in System32. Electron delay-loads Media Foundation, which
    Windows "N" editions omit; Phase 8 checks those editions' behavior if
    tested.
20. **The Windows data-root budget is 70 characters (Phase 3).** A
    single-file model asset stages as
    `data\staging\model-assets\<id>\<sha256>\<sha256>`, 188 characters below
    the data root, so the first estimate of 100 characters allowed 289-character
    paths. `%LOCALAPPDATA%\Animama` fits profile folder names of up to 39
    characters. A unit test derives the budget from `model-assets.v1.json`.
    Feature-pack paths are not bounded by their schema; when packs ship on
    Windows, the pack producer must check them against the same budget.
21. **Windows junctions read as directories (Phase 3).** CPython reports only
    true symbolic links as links; a junction, which any user can create, looks
    like an ordinary directory to `S_ISDIR`, `is_dir()` and `os.walk`. Every
    backend link or directory guard goes through `animama/utils/files.py`.
22. **Electron's Windows encryption key reaches disk about 10 seconds after
    startup (Phase 4).** `safeStorage` on Windows encrypts with a key that
    Chromium generates at startup and keeps, DPAPI-protected, in
    `<userData>\Local State`. Chromium writes that file about 10.1 seconds
    later, whether or not anything was encrypted (measured on the development
    host). The termination harness killed the first launch inside that window
    and left a `vault.bin` whose key was never saved: a permanent
    `vault_unreadable`. Backups must also keep `Local State` with the vault.
23. **Closing the main window did not quit Animama on Windows (Phase 4).** The
    startup and recovery window is hidden, not closed, once the app loads.
    Closing the main window therefore left a hidden window, `window-all-closed`
    never fired, and PostgreSQL and FastAPI kept running with no window. The
    normal-quit harness found it; macOS hides the same behavior behind its Dock.
24. **FastAPI's normal Windows stop code is 3 (Phase 4).** uvicorn handles
    Ctrl+Break, completes its graceful shutdown, then re-raises the signal; the
    MSVC runtime's default handler exits with 3. The harness therefore requires
    "Application shutdown complete" rather than exit 0 from FastAPI.
25. **MSVC builds of the input addon were not reproducible (Phase 5).** Each
    build embedded a new timestamp and PDB GUID, so the packaging gate rejected
    a rebuilt `dist` as changed after staging. The Windows build now passes
    `/Brepro` to the compiler and linker and `/PDBALTPATH:%_PDB%`.
26. **electron-builder's Windows executable editing needs Developer Mode
    (Phase 5, owner-reported).** On a Windows host, electron-builder 26.8.1
    runs rcedit through its Go `app-builder`, which downloads
    `winCodeSign-2.6.0.7z`. That archive holds macOS symlinks that 7-Zip cannot
    create without Developer Mode, and the `toolsets` setting does not change
    this path. It also passes the staged runtime's `.exe` files to signing,
    which would change their audited hashes if a certificate were present. The
    development package therefore disables electron-builder's editing and
    signing, and brands `Animama.exe` with `resedit`.
27. **The one-click uninstaller runs its section in silent mode (Phase 5).**
    After its own confirmation, electron-builder's `un.onInit` calls
    `SetSilent silent`, so the data-removal prompt checks for `/S` on the
    command line instead. Silent mode does not hide a `MessageBox` that has no
    `/SD` answer, so the question still appears (item 29).
28. **A one-click per-user install folder takes the package name (Phase 5).**
    electron-builder uses the package `name` (`animama-desktop`), not the
    product name, for that folder. The Windows build sets the packaged name to
    `Animama` to match D4.
29. **An agent-run installer journey deleted the owner's data folder
    (Phase 5).** The first agent-run journey used the owner's development
    profile, against this plan's recovery rule. The agent's UI Automation
    script could not see the uninstall dialogs' buttons, so it never answered
    them. The owner, seeing the data question on screen, chose Yes, and the
    uninstaller deleted `%LOCALAPPDATA%\Animama` as designed. A backup taken
    before the journey restored it with the same cluster, vault and state
    identity. The agent first misread its trace as NSIS answering Yes by itself
    in silent mode. It rewrote the prompt on that basis, but screenshots
    showed the question on screen, so the change was dropped before push.
    Since then, journeys that can delete data run on a disposable data folder,
    with the owner's folder moved aside and restored. Dialogs are found and
    answered through Win32 window enumeration, which sees MessageBox buttons
    where UI Automation did not. The owner is told beforehand not to answer
    them.
30. **NSIS `RMDir /r` follows directory junctions (Phase 5).** The dummy-data
    removal test put a junction inside the data folder; explicit removal
    deleted the file it pointed to outside `%LOCALAPPDATA%\Animama`. The
    uninstaller now removes the folder with `rd /s /q`, which a probe showed
    deletes junctions and directory symlinks, inside the folder or as the
    folder itself, without entering them.
31. **`Get-AuthenticodeSignature` reports catalog trust first (Phase 6).** For
    Electron's `d3dcompiler_47.dll` and `dxil.dll` it reports `SignatureType`
    `Catalog`, because their hashes are in a Windows catalog on the build host,
    although both also carry embedded Microsoft signatures. Its
    `-Content` form reports `NotSigned` for every file in Windows PowerShell 5.1.
    Whether a file has its own signature is therefore read from its PE
    certificate table, and kept vendor signatures are confirmed with
    `signtool verify /pa`, which reads no catalog.
32. **A release failure could exit 0 after electron-builder ran (Phase 6).**
    The gate set `process.exitCode = 1`, but the process still exited 0 after a
    post-build failure. electron-builder's own CLI re-asserts the code in an
    `exit` listener, and the gate now does the same.

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
- **2026-10-02, agent (Phase 4):** refuse an elevated Windows launch rather
  than start PostgreSQL with a restricted token. The supervisor reads the
  token's integrity level from `whoami /groups` (the High and System SIDs, which
  are not localized) at the start of validation, before any data exists, so an
  elevated run cannot leave files a normal launch cannot use. Running Animama
  as administrator has no legitimate purpose for a per-user app. PostgreSQL's
  own refusal maps to the same `administrator_launch_unsupported` code.
- **2026-10-02, agent (Phase 4):** refinements to the guard protocol within R2.
  - The guard waits on the service itself, not on an empty job. When the
    service exits, the guard ends anything it left in the job, waits up to 5
    seconds for the job to empty, and exits with the service's code. A stray
    descendant therefore never keeps a stopped service's guard alive.
  - The lifeline grace is 15 seconds, uvicorn's graceful-shutdown limit and
    Electron's terminate deadline.
  - `processes.json` records both the guard and service PIDs, as planned. The
    record is evidence only; PID reuse can cause a spurious
    `previous_runtime_running`, whose advice is to wait and Retry.
- **2026-10-02, agent (Phase 4):** on Windows a new vault waits until
  Chromium has saved its encryption key to `Local State` (item 22), adding up to
  about 10 seconds to the first launch only.
- **2026-10-02, agent (Phase 4):** outside macOS, closing the main window
  quits Animama (item 23). macOS keeps its Dock behavior.
- **2026-10-02, agent (Phase 5):** the Windows development package signs
  nothing and brands `Animama.exe` itself with `resedit` (item 26), so build
  hosts need no Developer Mode. Phase 6 keeps that split. Its signing hook
  signs deliberately chosen files with the pinned Windows SDK `signtool`,
  because electron-builder's own Windows signing path would fetch the legacy
  `winCodeSign` archive again. The release build reuses the branding and the
  `Animama` package name (item 28).
- **2026-10-03, agent (final integration review, Phases 1–5):**
  - Explicit data removal uses `rd /s /q`, not NSIS `RMDir /r` (item 30).
  - Agent-run installer journeys move the owner's data folder aside and work
    on a disposable one (item 29).
  - The Windows recovery advice (FI-04) and PID reuse after a crash (FI-05)
    belong to Phase 8's documentation and crash-recovery work; both fail
    closed today.
- **2026-10-03, owner:** waived Phase 5's mouse-button Press-to-talk hold (the
  keyboard hold passed in the packaged app) and accepted the agent-run
  installer journey as Phase 5's manual journey. Phase 6 repeats it signed.
- **2026-10-03, owner (G1):** reported the Artifact Signing account set up
  and Azure CLI signed in on the Windows host. Non-secret values: endpoint
  `https://eus.codesigning.azure.net/`, account `animama-signing`, certificate
  profile `animama-public`. The agent confirmed Azure CLI 2.90.0 is signed in
  as a user and that Windows SDK `signtool` 10.0.26100 is installed. Identity
  validation and the signer role are first proven by Phase 6's first signature.
- **2026-10-03, agent (Phase 6, within P-a, P-b and P-g):**
  - `release-policy.json` moves to `animama-release-policy/3` with one receipt
    per target under `redistribution_reviews`; the macOS receipt moves under
    `darwin-arm64` unchanged. A Windows release also requires the `windows`
    publisher; staging still needs no receipt.
  - The signing tools are pinned in `runtime/windows-signing.lock.json`, not the
    native component lock, so changing them does not change the staged
    inventory under review.
  - The client authenticates only through the Azure CLI; every other
    DefaultAzureCredential source is excluded in its metadata.
  - `--signing-rehearsal` proves signing before G2 without producing anything
    the release gate or a publisher can accept.
  - Feature packs stay macOS-only; a Windows release refuses any active pack.
  - Model sets keep their shared names, provided the bytes match for both
    targets; Phase 7 checks that before publishing (P6-R1-03).
- **2026-10-03, owner (G2):** reviewed and approved the Windows redistribution
  packet for stage build `23a1a213…` (744 records, sizes within the caps). The
  agent recorded the `win32-x64` receipt for inventory SHA-256 `fb1508b3…`, as
  the owner asked. The candidate is built from that exact stage, made at
  `127b09c2`. Later commits change release tooling, docs and the two release
  input files. The stage reads those two files, but its outputs from them, the
  update policy and pack catalog, are unchanged, and the release compares both
  against the stage.

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

Results (2026-10-02, issue [#253](https://github.com/raymond-van/animama/issues/253),
commits `359e3bf6` and `f422046a`):

- **Windows receipt** at `359e3bf6` (detached checkout, clean `git status`
  before and after; `ANIMAMA_MODEL_ROOT` outside the app data and build root):
  - `pnpm desktop:runtime:stage -- --platform win32 --arch x64` exited 0:
    4,979 runtime files, schema digest, licenses (744 records pending review),
    empty pack catalog.
  - `pnpm desktop:runtime:audit -- --platform win32 --arch x64` exited 0:
    "runtime audit: OK". 145 PE files audited (runtime 135, addon 1,
    Electron 9) with no unresolved import; the addon loaded through
    `electron.exe` with its five exports; Electron 39.8.9 (Node 22.22.1) has
    zstd; the PostgreSQL probe ran backend bootstrap twice and a real backup
    restore in a path with a space and Japanese characters.
  - Sizes: core download 409,062,881 / 786,432,000 bytes; installed
    979,310,186 / 1,610,612,736 bytes (Electron 343 MB, browser runtimes
    319 MB, frozen backend 234 MB, starter content 38 MB, licenses 19 MB,
    PostgreSQL 16 MB, web JavaScript 9 MB).
  - `pnpm desktop:test`: 330 passed, 53 skipped, 25 failed. Every failure is in
    a suite later phases own: feature-pack extraction, download and build (10),
    pre-migration snapshots (3), vault (3) and supervisor pack/credential
    transitions (9). The runtime-manifest custody suite, including the new
    Windows executable-name case, passed on Windows.
  - At `f422046a` (audit script change only; the stage is unchanged): audit
    "runtime audit: OK"; `windows-native` and `runtime-state` tests 57 passed,
    3 failed (the Phase 3 vault tests).
- **Linux** (Node 24.15.0): `pnpm check` exit 0, `pnpm desktop:check` clean,
  `pnpm desktop:test` 396 passed / 13 skipped, `pnpm desktop:build` exit 0,
  Prettier clean on changed files, `ruff check`, `make format-check`,
  `make mypy` and `tests/test_worker_shutdown.py` pass. Docker-dependent
  backend tests were not run (item 16).
- `runtime/cli.py` needed no change: without document-worker variables it
  reports `feature_unavailable`, and with them it refuses any non-macOS host.
- Not run: any macOS step. macOS-facing changes (shared helpers, the PostgreSQL
  port-collision hint, the manifest custody fixture) were reviewed and keep the
  macOS behavior.

#### Code Review #1 Findings

Independent reviewer, working tree on `feef9e16`, full initial review. Checks:
`pnpm check`, `pnpm desktop:test`, Prettier, `ruff`, `make format-check`,
`make mypy`, worker tests, and a probe of `resolveDependency`.

- **P2-R1-01 (blocking):** runtime DLL search folders were pooled across
  processes, so backend imports could resolve to PostgreSQL's VC++ runtime or
  `libpq.dll`, and vice versa. A missing backend runtime DLL would have passed
  the audit and failed on a clean machine.
- **P2-R1-02 (blocking):** no test executed the Windows branch of
  `verifyRuntime` (custody suite ran only on macOS).
- **P2-R1-03 (blocking):** the documented model root under `C:\animama-build`
  would be created with inherited permissions and then refused by the build
  root check, whose remedy deletes the models.
- Non-blocking: a Prettier break and stale sentences in the staging guide; the
  `msvc-runtime` version and delvewheel-renamed runtime copies; no tests for
  the postmaster DataDir and port-collision checks; over-broad test skips;
  `shutdown.py` docstring and a late signal after the loop closes; a misleading
  manifest comment; the addon build's header download; repeated lock reads;
  phase-scope notes (async `syncDirectory`, supervisor collision text, a
  per-component system list, `cli.py`).

#### Code Review #1 Revisions

In `359e3bf6`:

- P2-R1-01: accepted. `stageSearchDirs` keys search folders by the importing
  process (PostgreSQL: `postgres/bin`; backend: its folder, `_internal`,
  `pywin32_system32` and wheel `*.libs`). A Linux test covers cross-process
  rejection, `.libs` resolution and the addon's host import.
- P2-R1-02: accepted. The custody suite runs on every supported host from
  `runtimePlatform()`, with a Windows executable-name case; it passed on the
  Windows host.
- P2-R1-03: accepted. The guide puts the model root outside both the app data
  and the build root.
- Non-blocking accepted: doc fixes; `VC_RUNTIME_DLL` matches hash-suffixed
  copies and the license record version is the 14.x family; exported
  `postmasterRecordMatches` and `reportsPortCollision` with tests; narrower
  skips; `shutdown.py` ignores a late signal; comment and docstring fixes; one
  lock read.
- Rejected or deferred with reasons: the release-scan suite stays skipped on
  Windows (stub POSIX tools; the Windows scan is Phase 7); the async
  `syncDirectory` and the supervisor's collision text belong to Phases 3 and 4;
  one reviewed system DLL list per target is kept.

#### Code Review #2 Findings

Targeted recheck of `359e3bf6` (repair round 1): all three blocking findings
resolved; result pass.

- **P2-R2-01 (non-blocking):** the audit read the lock before deleting the old
  success receipt, outside its `try`.
- Nits: the host-import rejection test did not exercise the `.node` guard; the
  doc example used `%USERPROFILE%`, which PowerShell does not expand.

#### Code Review #2 Revisions

In `f422046a` (repair round 2): P2-R2-01 fixed (read inside the `try`, after
the receipt is removed); the test now rejects `node.exe` from a non-addon PE in
`app`; the example uses `$env:USERPROFILE`. The Windows audit passed again.

#### Code Review #3 Findings

Targeted recheck of `f422046a` (repair round 2): all three fixes resolved
(mutation check confirmed the new test exercises the addon guard); no
regression; result pass.

#### Code Review #3 Revisions

None needed. Phase 2 passed with both repair rounds used.

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

Results (2026-10-02, issue [#254](https://github.com/raymond-van/animama/issues/254),
commits `9fd782bc` and `555f8a45`):

- **Windows receipts** (detached checkout, clean `git status` after;
  `LongPathsEnabled=1` on this host):
  - At `ac7b7056`, whose tree is identical to `9fd782bc`:
    - `pnpm desktop:test`: 367 passed, 53 skipped, 0 failed. The Windows
      storage suite passed 5 of 5: junction refusal, a replace after a
      scanner-style lock is released, a clear failure when the lock outlasts the
      retries, a missing runtime DLL reported as `runtime_file_invalid`, and
      PostgreSQL running below a data root at the full 70-character budget with
      spaces and Japanese text.
    - `pnpm desktop:test:vault`: "vault encryption: OK" (real DPAPI through
      Electron `safeStorage`, in a disposable profile).
  - At `2ba66bf7`, whose tree is identical to `555f8a45` (desktop sources
    unchanged): targeted backend tests (file safety, local HTTP assets, model
    assets and sets, content mutations, Local content store, package staging,
    watcher, worker shutdown) 258 passed, 6 skipped. Every skip is a
    symbolic-link test that needs a privilege this account lacks; the junction
    variants of the same containment cases ran, as did the 8.3 short-name and
    final-path tests.
- **Linux** (Node 24.15.0): `make format-check`, `uv run ruff check`,
  `make mypy`, the repository import-boundary check (0 forbidden edges),
  11 targeted backend test files (267 passed, 3 skipped), `pnpm desktop:check`
  and `pnpm desktop:test` (402 passed, 19 skipped) pass. `prettier:check` fails
  only on the pre-existing `tests/feature-packs.test.ts` line (item 16).
- **DB-backed backend suite:** Docker was unavailable to WSL during the phase
  (item 16). After the owner enabled Docker Desktop's WSL integration,
  `make check-test` passed at `e3de5f49`, which contains every Phase 3 change:
  typed-content audit, format, lint and mypy clean; 3,103 passed, 10 skipped.
- **Not run:** any macOS step.
  The path tests ran on a host with `LongPathsEnabled=1`; the catalog-derived
  budget test does not depend on that setting, and Phase 8's clean VM runs with
  the default.
- The runtime backend has no `S_ISLNK`/`is_symlink()` guard left outside
  `animama/utils/files.py`. Build tooling for feature packs
  (`packaging/desktop/archive_payload.py`, `archive_feature_pack.py`, which uses
  `os.O_NOFOLLOW`) is outside the runtime scope and stays POSIX-only while packs
  are deferred.

#### Code Review #1 Findings

Independent reviewer, working tree on `24eb7d33`, full initial review. Checks:
`make check`, the import-boundary check, targeted backend tests,
`pnpm desktop:check`, `pnpm desktop:test`, Prettier and `git diff --check`.

- **P3-R1-01 (blocking):** Windows junctions passed the backend's link guards
  (`S_ISLNK`, `Path.is_symlink()`, `os.walk(followlinks=False)`), which report
  only true symbolic links. Model-asset pruning and private tree removal could
  delete outside the data root, and the Local content scan could read outside
  its root. The symbolic-link tests were skipped on an unprivileged account.
- **P3-R1-02 (evidence gap):** the DB-backed backend suite had not run.
- Non-blocking:
  - P3-R1-03: `fingerprint` no longer caught a hard link added between its
    path check and its open.
  - P3-R1-04: a folder swapped for a junction after its check was not caught
    on Windows, and an `O_CREAT` open could create through a swapped link.
  - P3-R1-05: on Windows a DPAPI failure surfaced as a generic error, not
    `secure_storage_unavailable`.
  - P3-R1-06: the vault harness had no timeout, used the default Electron
    profile and had no script.
  - P3-R1-07: the lock-timeout test could exceed Vitest's 5 s default.
  - P3-R1-08: the path budget was checked only by arithmetic.
  - P3-R1-09: `publish_new` renamed without the sharing-violation retry.
  - P3-R1-10: the `data_path_too_long` advice said "retry", which cannot work.
  - P3-R1-11: an 8.3 alias could reach a hidden folder inside the web root.
  - P3-R1-12: advice interpolation, a duplicated test helper, synchronous
    directory syncs in pack extraction.
  - P3-R1-13: the "Prettier clean" evidence needed qualifying.

#### Code Review #1 Revisions

In `9fd782bc`:

- P3-R1-01: accepted. `files.is_link` and `files.path_is_link` treat every
  reparse point as a link and replace each former guard in the content,
  model-asset, staging, archive, starter-content and runtime-configuration
  code. The watcher's priming walk prunes link directories. The shared test
  helper `link_directory` makes a junction on Windows, which needs no
  privilege, so the scan, descriptor-save, mutation, recovery-parent,
  model-asset prune, watcher and asset tests run there.
- P3-R1-02: resolved after the phase; see the DB-backed suite above.
- P3-R1-03: accepted. `fingerprint` also requires a single link on the open
  handle; a test adds a hard link between the check and the open.
- P3-R1-04: accepted. The Windows open uses `FILE_FLAG_OPEN_REPARSE_POINT` and
  refuses a reparse-point or directory handle, so it never follows or creates
  through a link. Served assets must resolve, through the open handle, to
  exactly the requested path.
- P3-R1-05: accepted. An `encryptString` failure maps to
  `secure_storage_unavailable`. Whether a restored vault also needs
  `<userData>\Local State` (Chromium's protected key) is deferred to Phase 8's
  documentation.
- P3-R1-06: accepted. The runner owns a disposable folder for the vault and
  Electron's profile, has a 120 s timeout, and runs as
  `pnpm desktop:test:vault`; `platforms.md` documents it.
- P3-R1-07: accepted. The lock is held 2500 ms, longer than the 1575 ms retry
  window, with 20 s test timeouts.
- P3-R1-08: accepted, and it found a defect: a single-file model asset stages
  as `data\staging\model-assets\<id>\<sha256>\<sha256>`, 188 characters, so the
  100-character budget allowed 289-character paths. The budget is now 70,
  derived by a unit test from `model-assets.v1.json` (item 20).
- P3-R1-09: accepted. `publish_new` retries on Windows, and the backend's
  retry schedule now matches the desktop's (25–800 ms). Deletions are not
  retried; Phase 8's antivirus acceptance covers them.
- P3-R1-10: accepted. The advice says "reopen Animama" and Retry is hidden.
- P3-R1-11: accepted, resolved by P3-R1-04's resolved-path check, with a
  Windows test that requests `VITE~1/manifest.json`.
- P3-R1-12: accepted: `JSON.stringify` interpolation and one
  `require_symlinks`. The synchronous directory sync is kept: it is a no-op on
  Windows and a cheap `fsync` elsewhere.
- P3-R1-13: accepted; the evidence above qualifies Prettier.

#### Code Review #2 Findings

Targeted recheck of `9fd782bc` (repair round 1). Every Review #1 fix verified
except as below.

- **P3-R2-01 (blocking):** `MutationJournal.remove_temporary` treated
  `S_ISDIR(lstat)` as a real directory. Windows reports a junction as a
  directory, so cleanup of a junction planted at a recorded temporary path
  would delete the junction target's files. A scratch emulation confirmed the
  deletion; POSIX refuses.
- P3-R2-02: the same implicit check in package-tree inspection, owned-directory
  cleanup and model-asset `is_installed`.
- P3-R2-03: three asset tests that only need directory links were still
  privilege-gated.
- P3-R2-04: the record must not claim that build tooling is converted.
- Nit: the retry comment's budget.

#### Code Review #2 Revisions

In `555f8a45` (repair round 2): all accepted. `files.is_directory` (a
directory that is not a reparse point) replaces every implicit and paired
directory check. New tests refuse a junction at a temporary path, inside a
package tree and as an installed version folder; the directory cases of the
asset tests use `link_directory`. The record above scopes build tooling out.

#### Code Review #3 Findings

Final targeted recheck of `555f8a45` (repair round 2): every Review #2 finding
resolved, no regression; result pass. The reviewer confirmed the repair on Linux
by emulating Windows junction metadata.

- P3-R3-01 (non-blocking): the split navigation test still keeps its link-free
  fallback and method checks behind `require_symlinks`.
- P3-R3-02 (non-blocking): on Linux the new junction tests also pass without
  the fix; only the Windows receipt proves it.

#### Code Review #3 Revisions

No change. P3-R3-01 is deferred: it is not a regression, and the repair budget
is spent. P3-R3-02 is reflected in the results above, which credit the Windows
receipt.

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

Results (2026-10-02, issue [#255](https://github.com/raymond-van/animama/issues/255),
commits `e3de5f49`, `83aaf44f` and `5cba6a6a`):

- **Windows receipts** (detached checkout, clean `git status` after):
  - At `bac8a7ef` (the final guard and every stage input of `5cba6a6a`):
    `pnpm desktop:runtime:stage` and `desktop:runtime:audit` exited 0,
    "runtime audit: OK". The stage compiles the guard, which imports only
    `KERNEL32.dll`, and the manifest requires it.
  - At `6740c548`, whose tree is identical to `5cba6a6a`:
    - `pnpm desktop:test`: 386 passed, 55 skipped, 0 failed. The process guard
      suite passed 6 of 6: the handshake precedes service output; closing the
      lifeline stops a service through Ctrl+Break and forwards its exit code; a
      service that ignores Ctrl+Break is ended after the 15 second grace;
      killing the guard ends the service and its grandchild; a secret passed
      in the environment appears on no command line (read through CIM); and
      owned services and commands run through the guard.
    - `pnpm desktop:test:termination`: "runtime termination: OK". Electron was
      force-killed at each startup stage (validating, vault, application,
      database, migrations, backend, ready) on one profile. Each time, no
      process under the runtime root remained within 30 seconds, and the next
      launch reached ready with PostgreSQL recovering. Two normal quits then
      closed the windows: FastAPI logged "Application shutdown complete" and
      stopped in 211 and 241 ms, the cleanup worker exited 0 in 106 and 119 ms,
      PostgreSQL logged "database system is shut down", and no service reached
      the guard's job termination. Every launch kept the same origin. The
      principal is unchanged by construction: readiness compares the
      installation principal read from the same database.
  - The end-to-end missing-DLL check is the Windows storage test that runs a
    lone `pg_isready.exe` through the guard: the loader's exit code is
    forwarded and reported as `runtime_file_invalid`. A long-running service
    started with `launch` reports such a failure as `postgres_start_failed` or
    `backend_start_failed`; `verifyRuntime` hashes every runtime DLL first, so
    only a missing Windows DLL reaches that path.
- **Linux** (Node 24.15.0): `pnpm desktop:check` clean; `pnpm desktop:test`
  416 passed, 26 skipped; `pnpm desktop:build` exit 0; Prettier clean except the
  pre-existing `tests/feature-packs.test.ts` (item 16). `make check-test` passed
  at `e3de5f49` (3,103 passed, 10 skipped); Phase 4 changes no backend file.
- uvicorn 0.38.0 handles `SIGBREAK` (Ctrl+Break) and, after its graceful
  shutdown, re-raises it; the MSVC runtime's default handler then exits with 3,
  which is FastAPI's normal Windows stop code. The workers' handlers exit 0.
- **Owner checks (passed, reported by the owner on 2026-10-02):**
  - Task Manager's End task on Animama leaves no PostgreSQL, FastAPI, worker
    or guard process.
  - Run as administrator shows `administrator_launch_unsupported` with Retry
    hidden, and a normal relaunch of the same profile reaches ready. The agent
    cannot elevate without a UAC prompt.
- **Not run:** any macOS step. macOS-facing changes (status logging moved to
  main, `closed` output drain, `beforeNewVault`, quit-on-close skipped on
  macOS) were reviewed and keep the macOS behavior.

#### Code Review #1 Findings

Independent reviewer, `e3de5f49` against `5d89b8bd`, full initial review. No
blocking code defect.

- **P4-R1-01 (blocking, evidence):** no receipt showed a supervised launch
  quitting normally, so a service that ignored Ctrl+Break would pass every
  check behind the guard's job termination.
- **P4-R1-02 (blocking, evidence):** the elevated launch had never been
  checked; only the refusal text was tested.
- Non-blocking:
  - P4-R1-03: the guard exited right after `TerminateJobObject`, which is
    asynchronous, so descendants could briefly outlive it.
  - P4-R1-04: the Results must name the end-to-end missing-DLL check.
  - P4-R1-05: every status change was logged twice, and errors set in
    `main.ts` never produced the harness's line.
  - P4-R1-06: checking both PIDs adds PID-reuse refusals without safety.
  - P4-R1-07: the guard's 10 second grace was shorter than uvicorn's 15.
  - P4-R1-08: the guard's license attribution was implicit.
  - P4-R1-09: no Linux tests for `beforeNewVault`, the win32 lifeline stop or
    the persisted service PID.
  - P4-R1-10: the troubleshooting advice for `previous_runtime_running` was
    macOS-only.
  - P4-R1-11: decisions and receipts to record.

#### Code Review #1 Revisions

In `83aaf44f` (repair round 1):

- P4-R1-01: accepted. The harness quits normally twice and requires clean
  stops (Results above). Building it exposed a real defect: closing the
  Windows main window left the hidden startup window, so `window-all-closed`
  never fired and Animama kept its services running with no window. Outside
  macOS, closing the main window now quits; runtime transitions destroy
  windows, which emits no `close`. `terminate` logs each stop's duration and
  exit code.
- P4-R1-02: accepted with a design change. The supervisor reads the token's
  integrity level from `whoami /groups` (High or System SID, not localized) and
  refuses an elevated launch at the start of validation, before any data
  exists, so an elevated run cannot leave files a normal launch cannot use.
  PostgreSQL's own refusal remains a backstop; the start loop drains a dead
  process's output before matching it, which a POSIX test proves with a real
  child process. The actual elevated launch is an owner gate.
- P4-R1-03: accepted. The guard waits up to 5 seconds for the job to empty.
- P4-R1-04: accepted; see Results.
- P4-R1-05: accepted. `main.ts` alone logs `Runtime <state>[: <detail>]`, now
  with the ready origin; the harness reads it and fails fast on any error.
- P4-R1-06: rejected. The plan asked for both PIDs; the record stays
  conservative evidence and never authorizes a kill. PID reuse can cause a
  spurious `previous_runtime_running`, whose advice is to wait and Retry.
- P4-R1-07: accepted. The grace is 15 seconds, matching uvicorn and Electron.
- P4-R1-08: accepted. The guard maps to `animama` and `msvc-runtime`.
- P4-R1-09: accepted; the three behaviors have Linux tests.
- P4-R1-10: accepted.
- P4-R1-11: accepted in the Decision Log and Results. Two minors are left: a
  durable-key timeout shows the general protected-storage advice although
  Retry would succeed, and the guard compile prints to the stage console
  rather than a step log.

#### Code Review #2 Findings

Targeted recheck of `83aaf44f` (repair round 1): every Review #1 finding
resolved, including the quit-on-close fix; result pass. Non-blocking:

- P4-R2-01: no test drove the early elevated refusal.
- P4-R2-02: the elevation check ran `whoami` synchronously on Electron's main
  thread, which can stall up to 10 seconds on an offline domain member.
- P4-R2-03: some harness failures did not print Electron's log, a runtime
  error during a quit was masked by a check message, and stdout and stderr
  shared one partial-line buffer.
- P4-R2-04: the in-app `previous_runtime_running` advice did not mention
  waiting.

#### Code Review #2 Revisions

In `5cba6a6a` (repair round 2): all accepted. The check runs asynchronously; a
mocked Windows test proves an elevated launch stops before verification, the
vault or PostgreSQL; the harness reports every quit failure, including a
logged runtime error, with Electron's log, and reads each stream separately;
the advice suggests waiting a few seconds before Retry.

#### Code Review #3 Findings

Final targeted recheck of `5cba6a6a` (repair round 2): all four Review #2
findings resolved, no regression; result pass. Non-blocking: P4-R3-01 notes
that the reset supervisor mock resolves `false`, not `undefined` (both mean
"not elevated"); P4-R3-02 repeats the pre-existing Prettier failure.

#### Code Review #3 Revisions

No change needed.

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

Results (2026-10-02, issue [#256](https://github.com/raymond-van/animama/issues/256),
commits `7bff9848`, `3587a882` and `db32bb1e`):

- **Windows receipts** (Developer Mode off; detached checkout, clean
  `git status` after):
  - Stage and audit at `ff61b560` ("runtime audit: OK"). Later commits change
    no stage input: only packaging, scripts, tests and docs.
  - At `3d873e55` (tree of `7bff9848`), with electron-builder's `winCodeSign`
    cache deleted first: `pnpm install --frozen-lockfile` passed;
    `pnpm desktop:win` built `win-unpacked` and reported "runtime inventory:
    OK"; `Animama.exe` reads "Animama | Animama | Animama | 0.1.1.0"
    (description, product, company, version); the installer built; nothing
    was downloaded into the `winCodeSign` cache (the folder is created empty).
  - At `f2f0b699` (tree of `3587a882`):
    - `pnpm desktop:win` exit 0; `pnpm desktop:mac` on Windows refused with
      "cross-building is unsupported".
    - `pnpm desktop:win:installer` built `Animama-0.1.1-x64-setup.exe`;
      makensis ran with `-WX` (warnings are errors) and
      `-DAPP_FILENAME=Animama`, so the per-user install folder is
      `%LOCALAPPDATA%\Programs\Animama`.
    - `pnpm desktop:test:native-input`: "native input (Windows): OK". Inside
      the packaged `Animama.exe`, the addon from `app.asar.unpacked` reported
      an injected F24 press as one down and one up.
    - `pnpm desktop:test`: 389 passed, 55 skipped, 0 failed.
  - At `db32bb1e`: `pnpm desktop:win` and `pnpm desktop:win:installer` exit 0
    with "runtime inventory: OK"; `pnpm desktop:test` 389 passed, 55 skipped,
    0 failed.
  - The input-hook addon now builds byte-identically twice in a row, with no
    checkout path in the binary.
- **Linux** (Node 24.15.0): `pnpm desktop:check` clean; `pnpm desktop:test`
  419 passed, 26 skipped; `pnpm install --frozen-lockfile --offline` accepts
  the lockfile; Prettier clean except the pre-existing
  `tests/feature-packs.test.ts` (item 16), so the desktop `prettier:check` as a
  whole still fails.
- **Owner gates:**
  - Press-to-talk with a keyboard key and a mouse button in the packaged app.
  - The installer journey: install N and run it; upgrade to N+1 and confirm
    data is kept; uninstall and confirm `%LOCALAPPDATA%\Animama` remains;
    reinstall and confirm the chats return; explicit removal deletes exactly
    the directory shown. `platforms.md` describes building the two versions.
- **Not run:** any macOS step. macOS packaging keeps its own `mac:`
  resources and target; the configs deep-merge, so its overrides keep them.
- Left for Phase 8: `overview.md` and `installation.md` still describe Windows
  packaging as unavailable. (`overview.md` was later corrected in `c69969c2`
  for FI-03; `installation.md` remains Phase 8's.)

Final results (2026-10-03, after the final integration review; commits
`6c2dd5f2`, `c69969c2` and `127b09c2`):

- **Windows receipt at `127b09c2`** (clean `git status` before and after;
  Developer Mode off):
  - `pnpm install --frozen-lockfile` passed.
  - N+1 for the journey: with `desktop/package.json` set locally to `0.1.2`,
    stage, audit and `desktop:win:installer` passed; the file was then
    restored.
  - At `0.1.1`: `desktop:runtime:stage` (4,980 files, none missing or
    unexpected) and `desktop:runtime:audit` ("runtime audit: OK");
    `desktop:win:installer` ("runtime inventory: OK");
    `desktop:test:native-input` ("native input (Windows): OK");
    `desktop:test` 390 passed, 55 skipped, 0 failed.
- **Uninstall tests** with the owner's folder moved aside and a dummy data
  folder, run against the `127b09c2` installer; dialogs answered by the
  script:
  - A person-started uninstall showed the confirmation, then the data question
    with the exact path; No kept the folder and removed the app.
  - Yes removed exactly `%LOCALAPPDATA%\Animama`; a file behind a junction
    inside it survived (item 30).
  - A silent uninstall and an install over an installed copy showed no dialog
    and kept the data.
- **Installer journey** (FI-07), same conditions:
  1. Installed 0.1.1 from no data; the installed app reached ready.
  2. Installed 0.1.2 over it: no uninstall dialog; ready on the same origin,
     with the same cluster, vault and state.
  3. A person-started uninstall, answered No: app and shortcuts removed, data
     identity unchanged.
  4. Reinstalled 0.1.1: ready with the same data.
  5. With the owner's folder restored, the installed 0.1.1 reached ready on
     its recorded origin, and its identity was unchanged.
- **Linux** at `c69969c2` (`127b09c2` changes only the NSIS include and a doc):
  `pnpm desktop:check` clean; `pnpm desktop:test` 420 passed, 26 skipped.
- **Owner:** Press-to-talk with a keyboard key passed in the packaged app; the
  owner waived the mouse-button hold on 2026-10-03. The owner asked the agent
  to run the installer journey (2026-10-02); the journey above is the agent's
  run, which the owner accepted as the manual gate on 2026-10-03.

#### Code Review #1 Findings

Independent reviewer, `7bff9848` against `606df41c`, full initial review.

- **P5-R1-01 (blocking):** the data-removal prompt could never appear. The
  one-click uninstaller switches to silent mode after its own confirmation,
  so the `${Silent}` check always skipped the prompt and no explicit removal
  path existed.
- **P5-R1-02 (blocking):** the per-user installer used
  `%LOCALAPPDATA%\Programs\animama-desktop`, not the `...\Animama` of D4: a
  one-click per-user folder takes the package `name`.
- Non-blocking: P5-R1-03 the packaging target followed the host, not the
  invoked script; P5-R1-04 `toolsets.winCodeSign` had no effect on Windows
  hosts; P5-R1-05 a misaligned docs table row; P5-R1-06 stale statements in
  `src/frontend/AGENTS.md`, `overview.md` and `installation.md`; P5-R1-07 the
  docs omitted the Desktop shortcut and the restage after an upgrade test;
  P5-R1-08 the installer report did not check that the file exists; minor
  command-name wording and a missing positive gate test.

#### Code Review #1 Revisions

In `3587a882` (repair round 1): P5-R1-01 accepted: the prompt appears only
when `/S` is absent from the command line, never for an update; the Windows
receipt compiled it with makensis `-WX`. P5-R1-02 accepted: the Windows build
sets the packaged name to `Animama` (makensis `-DAPP_FILENAME=Animama`).
P5-R1-03, -04, -05, -07, -08 and the minors accepted. P5-R1-06 accepted for
`src/frontend/AGENTS.md`; `overview.md` and `installation.md` are Phase 8's.

#### Code Review #2 Findings

Targeted recheck of `3587a882`: every Review #1 finding resolved; result
pass. Non-blocking: P5-R2-01 a leftover short line in `platforms.md`;
P5-R2-02 the positive gate test ran the whole gate, including inventory
hashing, on a host with a stage; P5-R2-03 removing `toolsets` dropped the
Developer Mode rationale that Phase 6's signing will meet again; P5-R2-04 the
pre-existing Prettier failure must not be reported as a clean check.

#### Code Review #2 Revisions

In `db32bb1e` (repair round 2): P5-R2-01 and P5-R2-02 accepted (the target
check is `packagedTarget`, tested directly). P5-R2-03 is recorded in item 26
and the Decision Log; P5-R2-04 in the Linux results above.

#### Code Review #3 Findings

Final targeted recheck of `db32bb1e` (repair round 2): both accepted Review #2
findings resolved, no regression; the reviewer also confirmed that
electron-builder still resolves the gate's default export. Result pass.
Non-blocking: P5-R3-01 repeats the pre-existing Prettier failure; P5-R3-02
notes that delegated desktop tests need Node 24 on `PATH` (item 16).

#### Code Review #3 Revisions

No change needed.

### Phase 6: Authenticode signing and the release candidate

**Requirements:** R6, and R7's candidate gates (exact hash, size, license
inventory).
**Issue:** [#259](https://github.com/raymond-van/animama/issues/259).
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
5. **Uninstaller hardening (FI2-05).** The data-removal command runs `cmd`
   with `/v:off`, and a failed removal tells the person which folder remains.

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

Results (2026-10-03, issue [#259](https://github.com/raymond-van/animama/issues/259),
commits `349dde45`, `c128a0ea`, `4ab78811`, `be315669`, `6c1b46d6`, `482c90da`
and the Review #3 follow-up):

- **G1 proven.** One probe signature of a throwaway copy of the guard returned
  `Valid` with a Microsoft timestamp. It gave the certificate subject and the
  identity-validation EKU now pinned in the `windows` publisher entry.
- **Design.** electron-builder's Windows signing and executable editing stay off
  (items 5 and 26). Its `afterPack` hook brands `Animama.exe` and signs the
  packaged app in place. Its `signtoolOptions.sign` hook, which electron-builder
  26.8.1 still calls for the uninstaller and installer when
  `signAndEditExecutable` is off, signs those two. A rehearsal mode
  (`--signing-rehearsal`) signs and measures without a redistribution receipt
  and writes no publish folder, so signing could be proven before G2.
- **Windows receipts** (Developer Mode off; clean `git status` before and
  after):
  - Signing rehearsal at `4ab78811` on the `127b09c2` stage: 141 files signed (139
    PE files in the app plus the uninstaller and installer); all 146 PE files
    `Valid`; seven Microsoft files kept with their own signatures; every file
    Animama signed timestamped. Installer 336,730,304 bytes (cap 786,432,000);
    installed 981,569,126 bytes (cap 1,610,612,736).
  - Two earlier attempts failed and are not evidence: a transient timestamp
    failure (now retried for unsigned files only, `c128a0ea`), then a wrong
    uninstaller lookup that also exited 0 (`4ab78811`).
  - About 350 signatures were used in total, including the probe and both
    failed attempts.
  - Installed silently from the rehearsal installer, the signed app reached
    ready on fresh data and on the owner's data, with the owner's folder moved
    aside and restored as in item 29. The signed rehearsal build stays
    installed on the development host.
  - `pnpm desktop:test` at `be315669`: 401 passed, 55 skipped, 0 failed.
    `smoke:windows` still refuses (Phase 7).
  - Read-only check at `482c90da` against the rehearsal output: all 146 PE files
    carry valid embedded signatures, and `signtool verify /pa` passes for all
    of them, including Electron's Microsoft-signed `d3dcompiler_47.dll` and
    `dxil.dll` (item 31).
  - Read-only check at `6c1b46d6`: the model preflight fails on this host
    because the Parakeet sets were never acquired there, so the real candidate
    needs the release model inputs first.
- **Linux** (Node 24.15.0) at `be315669`: `pnpm desktop:check` clean;
  `pnpm desktop:test` 431 passed, 26 skipped. At `519f8026`: `desktop:check`
  clean; `pnpm desktop:test` 432 passed, 26 skipped.
- **Release candidate** at `4ac1d21b`, after G2 (Decision Log), with the release
  model sets (both Parakeet sets, the Pocket voices and cloning encoder, and
  browser speech) acquired from the published objects and verified on the
  host:
  - `pnpm desktop:dist:windows` passed against the reviewed stage, inventory
    SHA-256 `fb1508b3…`. 141 files signed; all 146 PE files valid, including
    seven kept Microsoft signatures (`d3dcompiler_47.dll`, `dxil.dll` and five
    VC++ runtime DLLs). The report says `release_ready: true` and carries the
    embedded receipt.
  - Installer `Animama-0.1.1-x64-setup.exe`, SHA-256 `4b56558d…`, 336,730,448
    bytes; installed 981,569,333 bytes; no size failures.
  - The publish folder holds the installer, `latest.yml` (`v0.1.1/…`,
    `minimumSystemVersion` `10.0.22000`, platform `win32`), the model
    candidates and the `-win32-x64` evidence files. It is preserved outside the
    release directory.
  - A fresh stage at `4ac1d21b`, made after the candidate, reproduced the
    same inventory SHA-256, so the receipt binds the final source.
  - About 640 signatures used in total; the account's usage page is exact.
- **Signed installer journey**, run by the agent at the owner's request (the
  owner's folder moved aside and restored, as in item 29; dialogs answered by
  the script):
  1. Installed the candidate (0.1.1) from no data; `Animama.exe` signature
     `Valid`; reached ready.
  2. Ran a signed 0.1.2 rehearsal installer over it: no uninstall dialog; ready
     on the same origin with the same cluster, vault and state.
  3. A person-started uninstall showed the confirmation and the data question
     with the exact path; No removed the app and shortcuts and kept the data.
  4. Reinstalled the candidate: ready with the same data.
  5. With the owner's folder restored, the installed candidate reached ready
     on its recorded origin; identity unchanged.
- **SmartScreen.** A copy of the candidate installer carried the Mark of the
  Web a browser adds (Zone 3). Opening it showed "Windows protected your PC:
  Microsoft Defender SmartScreen prevented an unrecognized app from starting",
  and the installer did not run. A new Artifact Signing identity has no
  download reputation yet, so this is expected until reputation builds. Users
  can choose More info, then Run anyway. Phase 8's clean-machine audit
  records it again (R8).

#### Code Review #1 Findings

Independent reviewer, `be315669` against `27e4acf3`, full initial review. Result:
pass, no blocking findings. The reviewer read electron-builder 26.8.1 to confirm
when the signing hook runs, the uninstaller's name, and that nothing changes
`Animama.exe` after `afterPack`.

- **P6-R1-01:** a retry dropped a file that was signed but not timestamped.
- **P6-R1-02:** model candidates were resolved only after signing; a missing set
  or `python3` would waste a candidate's signatures. The docs did not list them.
- **P6-R1-03:** `backend-model-assets.json` keeps its shared name; its source
  has no `eol=lf` rule, so a CRLF Windows checkout could publish different
  bytes under the macOS name.
- **P6-R1-04:** a catalog signature, valid only where the catalog is installed,
  was accepted as a vendor signature.
- **P6-R1-05:** the receipt and notices code duplicated `sign-macos.mjs`.
- **P6-R1-06:** cleanup left `RELEASE-NEXT-STEPS.txt` and the rehearsal size
  report.
- **P6-R1-07:** `signed_files` does not count retried or failed requests.
- **P6-R1-08:** a rehearsal leaves a signed, installable installer marked only by
  `release_ready: false`; publication allowlists still expect macOS names.

#### Code Review #1 Revisions

In `6c1b46d6` (repair round 1):

- P6-R1-01 accepted: a retry keeps any file without an embedded, timestamped
  signature.
- P6-R1-02 accepted: before any signing, the release stages the model candidates
  from the staged runtime into a scratch folder. The docs now list `python3` and
  the model sets. The Windows check above proved the gap was real.
- P6-R1-04 accepted: only a signature embedded in the file counts. The first
  repair read this from `SignatureType`, which was wrong (P6-R2-01).
- P6-R1-05 accepted: `embedRedistributionReview` is shared by both signers.
- P6-R1-06 accepted.
- P6-R1-07 accepted as documentation: the report's count is a lower bound; the
  account's usage is exact.
- P6-R1-03 and P6-R1-08 deferred to Phase 7, which owns publication (its
  change 3).

#### Code Review #2 Findings

Targeted recheck of `b6853ea5` (repair round 1). Result: blocked on one
finding; the other repairs passed without regression.

- **P6-R2-01 (blocking):** `SignatureType` reports catalog trust first, so the
  P6-R1-04 repair would have replaced the embedded Microsoft signatures of
  `d3dcompiler_47.dll` and `dxil.dll`, against P-b. The reviewer read both
  files' certificate tables. The plan record repeated the misreading.
- Non-blocking: P6-R2-02 the model preflight copies every set once more than
  needed; P6-R2-03 the Decision Log states the shared model names as fact
  while P6-R1-03 is open.

#### Code Review #2 Revisions

In `482c90da` and this record (repair round 2):

- P6-R2-01 accepted. An embedded signature is read from the PE certificate
  table, and kept vendor signatures must also pass `signtool verify /pa`. The
  Windows check above confirms all 146 files. Item 31, the Results bullet and
  the P6-R1-04 revision are corrected.
- P6-R2-02 deferred: the copy costs disk time, not signatures, and it fails
  before any signing as required. A no-copy check can come with Phase 7's
  publication changes.
- P6-R2-03 accepted in the Decision Log.

#### Code Review #3 Findings

Final targeted recheck of `519f8026` (repair round 2): P6-R2-01 resolved,
with the same certificate-table reading the reviewer used on the installed
files; the plan text corrected; no regression. Result: pass. Non-blocking:
P6-R3-01 the certificate-table check read whole files, up to the 337 MB
installer, for four header fields; P6-R3-02 the Results commit list and Linux
line were not current; P6-R3-03 the P6-R2-02 deferral was missing from Phase 7.

#### Code Review #3 Revisions

All three accepted in a follow-up commit: the check reads only the PE header,
the Results are current, and Phase 7 change 3 carries P6-R2-02. The Windows
release suite passes (12 tests); the reading itself is unchanged.

### Phase 7: Updates, smoke and publication tooling

**Requirements:** R7.
**Issue:** [#268](https://github.com/raymond-van/animama/issues/268).
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
   - From Phase 6: publication and scans refuse a candidate whose signing report
     is not `release_ready: true` (a rehearsal), and use the `-win32-x64`
     evidence names (P6-R1-08). Pin LF for `model-assets.v1.json`, or check that
     the shared `backend-model-assets.json` bytes match, before uploading it
     under the shared name (P6-R1-03). Phase 6 builds
     `Animama-<version>-x64-setup.exe` (Phase 5's artifact name); the update
     policy takes that name. The release's model preflight copies every set
     once more than needed; a check that resolves and verifies without copying
     would save that time (P6-R2-02).
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

Results (in progress):

- Implemented at `ab98694e` and `4bfbddc4`, as planned, with these choices:
  - The update policy keeps schema `animama-update-policy/2` and names either
    `team_id` (macOS) or `windows_publisher` (Windows); each build accepts only
    its own platform's shape, feed name and file.
  - The Windows adapter starts the installer itself (`--updated --force-run`)
    rather than through electron-updater's `quitAndInstall`, so a failure to
    start it is reported before Animama quits.
  - The publisher is shared (`publish-release.mjs`), with `publish-macos.mjs`
    and `publish-windows.mjs` as entry points; the smoke journey is shared
    (`smoke-journey.mjs`) by `smoke-macos.mjs` and `smoke-windows.mjs`.
  - Carry-forwards: P6-R1-08 (rehearsal refused, suffixed names) and
    P6-R2-02 (`verifyReleaseModels` checks without copying) are done.
    P6-R1-03: the shared `backend-model-assets.json` must match byte for byte;
    the R2 publisher checks it before any upload and GitHub before any upload.
- Linux (Node 24.15.0) at `4bfbddc4`: `tsc` clean; `vitest` 454 passed,
  26 skipped.
- Windows 11 x64 (build 26200) at `4bfbddc4`:
  - A fresh stage and audit passed and reproduced inventory `fb1508b3…`, so
    the owner's G2 receipt still covers it (the update-policy change alters the
    runtime build ID, not the reviewed inventory).
  - `pnpm desktop:dist:windows` built a signed candidate (141 files signed).
    It is an intermediate candidate: review #1 changed the app afterwards.
  - `pnpm desktop:test`: 424 passed, 55 skipped, 0 failed.
  - The app's Authenticode check, run with no `PSModulePath` and a system-only
    PATH against that installer, read the exact subject and the
    identity-validation EKU.
- Final candidate at `fa2574c3` on Windows 11 x64 (build 26200), preserved in
  `C:\animama-build\candidate-final` on the build host:
  - A fresh stage and audit reproduced inventory `fb1508b3…`.
  - `pnpm desktop:dist:windows`: 141 files signed, `release_ready: true`.
  - `pnpm desktop:test`: 426 passed, 55 skipped, 0 failed.
  - `pnpm desktop:release:scan` with the pinned Gitleaks 8.30.1 Windows build
    (its archive matched the pin): the app candidate and all four model
    candidates passed with no findings; the canary was detected; 6 archives
    expanded, including the installer's app payload; about 13,000 files
    scanned; the Windows home-directory needles were all searched.
- Pending owner gates: `desktop:smoke:windows` in a fresh standard account
  (the owner has not yet created the account or its smoke key), and the G4
  upgrade (the owner chose on 2026-10-03 to keep it pending).

#### Code Review #1 Findings

Independent reviewer, full review of `4bfbddc4` against `733d2315`. Checks:
`tsc` clean; `vitest` 454 passed; Prettier clean on changed files. Result:
blocked on P7-R1-01.

- **P7-R1-01 (blocking):** on GitHub, a stable promotion of one target could
  publish the other target's draft or preview as stable and Latest, rewriting
  its description; adding to an older published release would move Latest back
  to it, hiding newer macOS updates.
- **P7-R1-02:** at install, only the publisher was rechecked, not the approved
  size and SHA-512.
- **P7-R1-03:** Windows PowerShell 5.1 writes redirected output in the OEM
  code page, so a non-ASCII subject would never match (fail-closed).
- **P7-R1-04:** the shared-name byte check ran only for Windows; macOS
  publishing second would spend immutable objects before failing.
- **P7-R1-05:** nothing proved that 7-Zip expanded the installer's app payload.
- **P7-R1-06:** the Windows smoke docs omitted that the smoke writes reports in
  the checkout and that they return to the build account.
- **P7-R1-07:** a 5xx during the shared-name check was reported as different
  bytes.

#### Code Review #1 Revisions

All accepted.

- P7-R1-01: a run never makes another target's draft or preview public or
  stable; two previews may share a prerelease, keeping the first description.
  Adding to a published release changes nothing but its files (no `PATCH`).
  Tests cover both.
- P7-R1-02: install rechecks size and SHA-512, then the publisher; tested with
  swapped bytes.
- P7-R1-03: the check sets UTF-8 output. The native probe above ran the
  same script with that line; the final candidate's smoke repeats it in the app.
- P7-R1-04: both targets check `SHARED_RELEASE_NAMES` before uploading.
- P7-R1-05: the scan fails unless the installer expands to `resources/app.asar`.
- P7-R1-06 and P7-R1-07: docs and message corrected.
- Linux after the repair: `vitest` 455 passed, 26 skipped; `tsc` clean.

#### Code Review #2 Findings

Targeted recheck of `a82bb302` (repair round 1): P7-R1-02 to -07 fixed; P7-R1-01
fixed for stable runs. Result: blocked on P7-R2-01.

- **P7-R2-01 (blocking):** a preview may join only a published prerelease, but
  the check let it join a draft prerelease, so an interrupted macOS preview
  would become public through a Windows preview.
- Non-blocking: the installer's 7-Zip expansion to `resources/app.asar` awaits
  the native scan; the shared-name 5xx path and an unexpected own file in a
  shared release lack direct tests; the P7-R1-03 record overstated the probe.

#### Code Review #2 Revisions

- P7-R2-01 accepted: a preview joins only a published, non-draft prerelease;
  tested.
- The native scan of the final candidate covers the 7-Zip assertion. The
  untested branches are small and fail closed; not added. The P7-R1-03 record is
  corrected above.

#### Code Review #3 Findings

Final targeted recheck of `fa2574c3` (repair round 2): P7-R2-01 resolved, with a
test for an interrupted draft preview; no regressions. Result: pass. Both
repair rounds were used.

#### Code Review #3 Revisions

None needed.

### Phase 8: Platform audit, clean-machine journey and documentation

**Requirements:** R8, the clean-machine acceptance and the documentation
acceptance.
**Issue:** [#269](https://github.com/raymond-van/animama/issues/269).
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
     killing the whole tree. Include a delayed relaunch after a crash, when
     Windows may have reused a recorded PID: a reuse by another user's or an
     elevated process gives `process_ownership_record_invalid`, which needs
     advice, and recording each process's creation time would tell reuse
     apart (FI-05).
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
   - Windows recovery advice (FI-04): `database_schema_mismatch` and
     `content_startup_failed` point Windows developers at
     `pnpm desktop:mac:reset`, which refuses non-macOS hosts; the
     troubleshooting rows for `secure_storage_unavailable` and vault restore
     (which also needs `<userData>\Local State`) are macOS-only; and
     `data_path_too_long` has no row.
4. **ADR.** If the [ADR guide](../../adr/README.md) criteria hold, record ADR
   0013 for the Windows packaging decisions: the signing identity, per-user
   scope, shared distribution layout and guard ownership.

Checks: the docs follow the reader-value standard. The Windows receipts and
manual results are recorded here with the tested Windows build and app version.

Completion: every R8 item is resolved and the clean-machine journey is
recorded. Any item that still depends on G4 is listed as open.

Results (in progress):

- FI-05 at `98b12b1a`: on Windows, a recorded PID that is alive, or that this
  account cannot read, blocks startup only while it still runs the recorded
  image: the guard (now recorded with each PID) or the recorded service. An
  unreadable image was never Animama's, which never runs elevated; a failed
  lookup still blocks. This compares image paths rather than creation times,
  which needs no extra query at launch. The R8 audit below exercised it
  natively.
- FI-04 at `98b12b1a`: the recovery page tells Windows developers to rename
  `%LOCALAPPDATA%\Animama` instead of running `pnpm desktop:mac:reset`;
  troubleshooting covers Windows storage, vault restore with `Local State`,
  `data_path_too_long`, logs, microphone, backups and support.
- Docs at `e15a37d6`: installation, troubleshooting, platforms, overview,
  runtime staging, the release docs, `src/frontend/AGENTS.md`, `README.md` and
  the model-store note describe Windows; no "Windows deferred" statement remains
  outside plans.
- ADR [0013](../../adr/0013-native-windows-desktop-packaging.md) records D1–D4
  and guard ownership: the signing identity, per-user scope, shared
  distribution and process guard meet the ADR criteria.
- Windows `pnpm desktop:test` at `e15a37d6`: 425 passed, 1 failed. The failing
  test recorded a fake executable for a live PID, which FI-05 now correctly
  treats as reused; the test records the real image on Windows.
- R8 audit of the final candidate (`fa2574c3`), installed per-user on the
  development host (Windows 11 build 26200, Defender real-time protection on,
  Smart App Control off, `LongPathsEnabled=1`), on disposable data with the
  owner's data folder moved aside and restored. Automated by an agent script:

  | Item | Result |
  | --- | --- |
  | Defender | First launch on fresh data reached ready in 39.6 s, the second in 9.8 s; no detection during the audit. |
  | SmartScreen | A browser-downloaded signed installer shows "Windows protected your PC… unrecognized app" (Phase 6), expected for a new identity; documented. |
  | Smart App Control | Off on this host; untested. Needs the G3 VM. |
  | Firewall | No prompt; no firewall rule exists for the app. |
  | Loopback binding | The two owned listeners bind only to `127.0.0.1`. |
  | WebSockets | An upgrade to the local `/v1/logs` endpoint opened. |
  | PostgreSQL killed | The app shows `postgres_exited` and stops; after Quit no installed process remains, and a relaunch reached ready in 11.2 s. |
  | Whole tree killed | No installed process remained; with the stale record, a relaunch reached ready in 10.6 s. |
  | PID reuse (FI-05) | A record naming a live unrelated process of this user was ignored (ready); the same PID recorded with its real image blocked with `previous_runtime_running`. |
  | Pack replacement under antivirus | Parakeet installed in 40 s and was removed with real-time protection on; the fixture held-handle tests pass natively. |
  | PiP, quick chat, shortcuts | Keyboard Press-to-talk passed in Phase 5 (owner). PiP click-through and quick chat need the owner's manual check. |
  | Microphone privacy | Needs the owner's manual check with the setting on and off. |
  | Elevated launch | Refused with `administrator_launch_unsupported` (Phase 4 owner check, same code); unit-tested. |
  | Non-ASCII account | Pending: the owner has not yet created the account. |
  | Default `MAX_PATH` | Pending: this host enables long paths; needs the G3 VM or the setting turned off. The 70-character data-root rule is unit-tested. |

- Pending: the owner's manual checks and test accounts above, the clean-machine
  journey (G3) and the prompted update (G4).

#### Code Review #1 Findings

Independent reviewer, full review of `e15a37d6` against `a82bb302`. Checks:
`tsc` clean; `vitest` 456 passed. Result: blocked on P8-R1-01 and P8-R1-02.

- **P8-R1-01 (blocking):** the model-store note said the packaged app downloads
  into the developer store; it uses `<userData>\data`.
- **P8-R1-02 (blocking):** troubleshooting's intro, logs, microphone, backups
  and support sections were still macOS-only.
- Non-blocking: the guard's expected image came from the current launch, not
  the record; the PowerShell lookup is synchronous on the main process (only
  when a recorded PID is live); the FI-05 approach should be recorded; the
  constructor's Windows branch needs the native audit; SmartScreen wording,
  the microphone settings label and uninstall prompt timing need native
  confirmation; "Windows 11 x64 host" overstated what the build checks;
  Prettier width warnings in docs.

#### Code Review #1 Revisions

- P8-R1-01 and P8-R1-02 accepted and corrected.
- The guard path is now recorded with each PID. The FI-05 approach is
  recorded above. The SmartScreen text names **Run anyway** and no longer
  hard-codes the publisher; the native audit confirms the rest. The staging
  line says "Windows x64 host".
- Not changed: the synchronous lookup runs only after an unclean exit with a
  live recorded PID, and is bounded at 15 seconds. The changed docs pass
  Prettier.
- Linux after the repair: `vitest` 456 passed; `tsc` clean.

#### Code Review #2 Findings

Targeted recheck of `fa2574c3` (repair round 1): P8-R1-01 and P8-R1-02
resolved and checked against the code; the recorded guard path, SmartScreen
wording, staging line and Windows-aware test verified; macOS records
unchanged. Result: pass. Non-blocking: P8-R2-01, `item.guard` is not
type-checked explicitly, though a non-string fails closed.

#### Code Review #2 Revisions

P8-R2-01 not changed: a bad value already fails closed, and the record lives in
the private data folder.

## Final integration review

The final integration review covers the combined acceptance below. It reuses
still-valid phase evidence, and every native receipt must name the final
candidate commit or an unchanged input. It confirms that:

- macOS-targeted tests still pass on Linux;
- no development override is reachable in packaged builds;
- secrets stay out of command lines, logs and reports.

The repair-round limits are the same as for phases.

Phases 1–5 (the authorized subset) had their final integration review on
2026-10-02 and 2026-10-03. Phases 6–8 will need their own.

#### Final Integration Review #1 Findings

Independent reviewer, `917fa58c` against `94ee03c5`, full review of the
combined Phases 1–5 change. Result: blocked on FI-01; otherwise the change
passes, subject to the Phase 5 owner gates.

- **FI-01 (blocking):** the stage and audit receipt at `ff61b560` predates
  `7bff9848`, which added `resedit` to `pnpm-lock.yaml`. The stage hashes that
  lock into the license inventory, so "later commits change no stage input"
  was false.
- **FI-02:** the plan's status line and item 16's wording were stale.
- **FI-03:** `overview.md`, `releases.md`, `release-process.md` and
  `src/frontend/AGENTS.md` still called Windows packaging deferred.
- **FI-04:** Windows recovery advice and troubleshooting rows are incomplete.
- **FI-05:** after a crash, Windows PID reuse can make a delayed relaunch fail
  with `process_ownership_record_invalid`. It fails closed.
- **FI-06:** explicit removal also deletes the default developer model store;
  the docs and the question did not say so. Optional: check that removal does
  not follow a junction.
- **FI-07:** no agent receipt launched the installed app to ready.
- **FI-08 (nit):** the guard path was defined three times.

#### Final Integration Review #1 Revisions

- FI-01: a clean-tree Windows stage and audit at the final commit (Phase 5
  results).
- FI-02: corrected here.
- FI-03 and FI-08: `c69969c2`.
- FI-04 and FI-05: carried to Phase 8 (steps 1 and 3).
- FI-06: `6c2dd5f2` names speech models in the question and tells testers to
  use a separate account or a backup. The optional junction check found a
  real defect (item 30), fixed in `127b09c2`.
- FI-07: the installer journey launched the installed build to ready four
  times (Phase 5 results).

#### Final Integration Review #2 Findings

Targeted recheck of `a7ccb22f` (repair round 1): every FI finding is resolved
or carried as recorded, and the `rd /s /q` removal is gated, quoted and
stack-balanced. Result: blocked on a record issue.

- **FI2-01 (blocking):** Phase 5 was checked complete while its mouse-button
  Press-to-talk gate was still open, and the agent-run journey was not
  recorded as distinct from the owner's manual gate.
- Non-blocking: FI2-02 `docs/backend/operations/desktop-runtime.md` still
  called Windows packaging deferred; FI2-03 the Phase 5 note about
  `overview.md` was stale; FI2-04 the progress line pointed at an unrecorded
  recheck; FI2-05 hardening for the removal command: `cmd` expands `%NAME%`
  in its command line (and `!NAME!` when delayed expansion is enabled in the
  registry), and a partial removal is not reported; FI2-06 pre-existing
  Prettier table-width drift in `releases.md` and this plan.

#### Final Integration Review #2 Revisions

In repair round 2 (record and docs only): FI2-01, -02, -03 and -04 accepted
and corrected. FI2-05 is carried to Phase 6, whose signed installer is
rebuilt anyway: add `/v:off` and report a failed removal. The `%NAME%`
expansion has no simple fix inside `cmd /c`; its risk is accepted, because
the target still ends in `\Animama` under the user's own profile. FI2-06 is
pre-existing and unchanged.

#### Final Integration Review #3 Findings

Final targeted recheck of `2b13540f` (repair round 2): every Review #2
finding resolved or carried as recorded; no new blocking issue. Result: pass.
The two Phase 5 owner gates remain open. Non-blocking: FI3-01 the progress
line misdescribed review #2's result; FI3-02 the FI2-05 record omitted the
`%NAME%` part.

#### Final Integration Review #3 Revisions

FI3-01 and FI3-02 corrected in the record.

#### Final Integration Review #1 Findings (Phases 6–8)

Independent reviewer, `9bef2a4e` against `733d2315`, the Phase 7–8 change with
its Phase 6 integration. Checks: `tsc` clean; `vitest` 456 passed; `pnpm check`
clean. It confirmed that macOS behavior is preserved (the smoke split is a pure
extraction, and every target-aware helper defaults to macOS), that no packaged
override was added, that secrets stay out of command lines, logs and reports,
that the open gates are stated honestly, and that commits after `fa2574c3`
change only docs, the plan and the ADR. Result: pass. Non-blocking:

- **FI-P78-01:** `releases.md` said only the Windows publisher checks shared
  names.
- **FI-P78-02:** the FI-05 note still called the native audit pending.
- **FI-P78-03:** the smoke's silent installer and process query inherited the
  full environment, including the smoke key; nothing logged it.

#### Final Integration Review #1 Revisions (Phases 6–8)

All three accepted and corrected. The smoke's helpers now run with the minimal
launch environment; this changes release tooling only, not the candidate.
`vitest` 456 passed afterwards.

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
