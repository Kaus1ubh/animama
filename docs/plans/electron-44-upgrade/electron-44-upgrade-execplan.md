# Electron 44 and electron-builder 26.18 desktop upgrade

Source agreement: [raymond-van/animama#724](https://github.com/raymond-van/animama/issues/724)
as published on 2026-10-26, plus the owner decisions dated 2026-10-26 in the
[Decision Log](#decision-log).
Authorized scope: the whole plan (dated task instruction, 2026-10-26). Nothing in
this plan authorizes notarizing a release candidate, publishing or merging.

## Purpose and context

The desktop shell runs Electron 39.8.9, which is out of upstream support and
carries 16 audit advisories (7 high), plus 2 high advisories in its
`extract-zip` dependency. electron-builder 26.8.1 carries high advisories in
`app-builder-lib` and `builder-util-runtime`, fixed in 26.15+. Phase 1 of the
pre-launch dependency work (#717, PR #719) deferred both because they need
packaging, signing and native verification.

After this work the desktop app runs Electron 44.9.3 (Node 24.22.0, Chromium
152) and is packaged with electron-builder 26.18.0. `electron-updater` stays
6.8.11; its `builder-util-runtime` 9.7.0 is already patched.

Commands run from `src/frontend` unless stated. Working checkout: a task worktree
on branch `build/electron-supported-major`, based on `main` `1dba3985` (#719's
merge). No Compose stack is needed.

### Orientation

| Area                  | Files                                                                                                                         |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Versions              | `desktop/package.json`, `pnpm-lock.yaml`, `desktop/runtime/source-manifest.json`                                              |
| Electron binary users | `desktop/scripts/runtime/stage.mjs`, `licenses.mjs`, `desktop/tests/macos-localizations.test.mjs`, `desktop/scripts/native/*` |
| Release scanner       | `desktop/scripts/runtime/release-scan.mjs` (`sevenZip`)                                                                       |
| Windows packaging     | `desktop/scripts/runtime/release-windows.mjs`, `sign-windows.mjs`, `windows-signing.mjs`, `windows-resources.mjs`, `package-development.mjs` |
| macOS packaging       | `desktop/scripts/runtime/release-macos.mjs`, `sign-macos.mjs`, `macos-signing.mjs`, `release-gate.mjs`                        |
| Tests                 | `desktop/tests/windows-release.test.mjs`, `windows-native.test.mjs`, `runtime-packaging.test.mjs`, `release-scan.test.mjs`    |
| Docs                  | `docs/frontend/desktop/releases.md`, `release-process.md`, `runtime-staging.md`, `platforms.md`                               |

### Breaking changes reviewed (Electron 40–44)

Read from Electron's `docs/breaking-changes.md` at v45.0.0 and checked against
`desktop/src`:

- 40/44: renderer `clipboard` removed. Not used.
- 41: PDFs render in the same WebContents. Not used.
- 42: macOS notifications need a signed app; OSR default scale 1.0; the `electron`
  package no longer downloads its binary at install. Notifications and OSR are
  not used. The lazy download affects staging, licences and one test (Phase 1).
- 43: dialogs default to Downloads. No dialog calls.
- 44: macOS 12 dropped (the app requires macOS 15); ANGLE linked statically
  (`libEGL`/`libGLESv2` no longer shipped; no script names them);
  `select-client-certificate` may pass a null `webContents` (not handled);
  `net.request` frame destinations need navigate mode (not used); login-item
  `openAsHidden` removed (not used); 32-bit Windows dropped (x64 only).
- Backported 45 changes in 44.3: workers in subframes and DevTools extension
  frames. Not used.

The preloads are sandboxed and use only `contextBridge` and `ipcRenderer`; the
permission handlers allow audio-only `media` from the app origin; the vault uses
synchronous `safeStorage`, which Electron 45 deprecates (a reason to stay on 44).

## Progress

- [x] Research and owner decisions (2026-10-26).
- [ ] Phase 1: dependency upgrade, lazy Electron binary, release scanner and
      Windows signing through electron-builder's executable editing. Code and
      local checks done; review pending.
- [ ] Phase 2: macOS signing rehearsal mode (code and unit checks done; review
      pending) and the native stage, package and rehearsal (blocked: 5 GB free
      disk).
- [ ] Final integration review, full pre-push suite and PR.
- [ ] Owner gates (see [Validation and acceptance](#validation-and-acceptance)).

## Surprises & Discoveries

- electron-builder ≥26.15 throws `InvalidConfigurationError` for
  `forceCodeSigning: true` with `signAndEditExecutable: false` or
  `signExecutable: false` (`winPackager.js` `signApp`). 26.15.7, 26.16.1, 26.17.0
  and 26.18.0 all contain the check, so no patched release avoids the decision.
- electron-builder 26.18 edits Windows executable resources with the `resedit`
  library instead of rcedit from the `winCodeSign-2.6.0` archive. The Developer
  Mode problem behind Windows packaging plan item 26 no longer applies to
  executable editing. A `.ico` icon of at least 256 pixels is used directly.
- With `signAndEditExecutable` on, electron-builder edits `Animama.exe` after
  `afterPack`, then signs it. It also offers every `.exe` it copies from
  `extraResources` (the runtime) to the signing hook during the copy, before
  `afterPack` can check the audited inventory.
- electron-builder 26.18 no longer depends on `7zip-bin`. It downloads a
  SHA-256-pinned 7-Zip (`7zip@1.0.0` from `electron-userland/electron-builder-binaries`)
  on first use. `release-scan.mjs` resolved `7zip-bin` through `builder-util`.
- Electron 44's npm package has no install script; `require("electron")` or the
  `electron` CLI downloads and checksum-verifies the binary on first use. The
  downloaded macOS app keeps its framework symlinks.
- The macOS `sign` path in 26.18 (`MacTargetHelper`) still calls the custom hook
  with the same options. The arm64 ad-hoc fallback without an identity was
  removed; `identity: null` still skips signing, and without it electron-builder
  would sign with any identity it discovers.
- `pnpm desktop:test:vault` had only ever run on Windows. On macOS it failed
  with `private_state_path_invalid` on Electron 39 and 44 alike: `os.tmpdir()`
  is under the `/var` symlink, which the vault's no-symlink path walk rejects.
  The harness now uses the temporary folder's real path.
- 7-Zip from electron-builder 26.18 is 24.09 (arm64); `7zip-bin` shipped 16.02.

## Decision Log

- 2026-10-26, owner: target Electron 44.9.3 rather than 45.0.x. 44 is two months
  mature, clears every Electron advisory and is supported until Electron 47
  ships; 45 was five days old and deprecates the vault's synchronous
  `safeStorage` calls.
- 2026-10-26, owner: let electron-builder edit and sign `Animama.exe`
  (`signAndEditExecutable` on, `forceCodeSigning` kept), rather than dropping
  `forceCodeSigning` or holding electron-builder 26.8.1.
- 2026-10-26, owner: add a macOS `--signing-rehearsal` mode, run locally by the
  agent; the notarized candidate stays an owner gate.
- 2026-10-26, agent: electron-builder 26.18.0 (published 2026-10-20) rather than
  26.18.1 (published the same day as this work). `electron-updater` stays 6.8.11
  for the same reason; 6.8.12 was also published that day.
- 2026-10-26, agent: the signing hook defers every file under
  `win-unpacked/resources/` to `afterPack`, which checks the audited inventory
  before signing nested code deepest first and re-inventories with the review
  receipt. Signing those files during the copy would break that order.
- 2026-10-26, agent: the development Windows package also uses electron-builder's
  editing (signing nothing), so both packages brand `Animama.exe` the same way and
  the repository's `resedit` branding is removed. electron-builder writes an empty
  `OriginalFilename`; nothing reads it.
- 2026-10-26, agent: two phases instead of three. The Windows signing change
  rides with the upgrade that forces it; the macOS rehearsal is separate because
  it needs native disk and keychain resources.
- 2026-10-26, agent: `sideEffectsCache: false` and Electron's
  `onlyBuiltDependencies` entry are removed with Electron's install script; both
  existed only for it (`b2152d75`).
- 2026-10-26, agent: the macOS hook is passed as a function
  (`signMacApp(options.app, { rehearsal })`) instead of a module path, so one
  hook serves candidates and rehearsals. Every macOS signing report now records
  `release_ready`, and `candidateDistribution` refuses any report that is not
  `release_ready: true` on both targets.

## Phased implementation

### Phase 1: Electron 44, electron-builder 26.18 and Windows signing

Review tier: high risk (dependencies, build, packaging and release signing).

Requirements R1, R2 and R4. Starting source `1dba3985`.

Changes:

1. `desktop/package.json`: `electron` 44.9.3, `electron-builder` 26.18.0;
   `pnpm install`; `desktop/runtime/source-manifest.json` `electron` 44.9.3.
2. `electronDist()` in `desktop/scripts/runtime/common.mjs` resolves the
   `electron` package (downloading and verifying the binary on first use) and
   returns its `dist` directory. `stage.mjs`, `licenses.mjs` and the
   localization test use it.
3. `release-scan.mjs` opens 7-Zip archives with electron-builder's own pinned
   7-Zip (`app-builder-lib/out/toolsets/7zip.js` `getPath7za`).
4. `pnpm-workspace.yaml` and `onlyBuiltDependencies` drop their Electron-only
   settings.
5. Windows release: `windowsBuilderOptions` drops `signAndEditExecutable: false`
   and keeps `forceCodeSigning`. electron-builder edits `Animama.exe`'s icon and
   version resources after `afterPack` and the hook signs it, the uninstaller and
   the installer. `builderSigningHook` leaves every file under
   `win-unpacked/resources/` to `signWindowsApp`, which signs every PE file
   except `Animama.exe`: nested code first, then the receipt and re-inventory,
   then the outer DLLs. After the build `releaseWindows` requires the hook's
   `Animama.exe` entry and checks every PE file against the signatures recorded
   when each was signed.
6. The development Windows package keeps `signExts: ["!.exe"]` with executable
   editing on; `brandPackagedApp` and `brandWindowsExecutable` are removed.
7. `windows-release.test.mjs` runs electron-builder's real Windows packaging
   (`dir` target, a generated PE as `electron.exe`) with the release options and
   hooks. It fails if electron-builder rejects the options, offers runtime files
   after `afterPack`, or changes `Animama.exe` after signing it. Restoring
   `signAndEditExecutable: false` makes it fail with electron-builder's error.
8. The vault harness uses the temporary folder's real path (see Discoveries).
9. Docs: development caches, platform builds and the Windows signing order.

Native Windows signing cannot run on the macOS host; it is an owner gate.

Check record (macOS arm64, Node 24.15, `src/frontend`). Commands ran on the
working tree before the phase commits; the final tree is recorded at the
full pre-push suite.

| Command | Result |
| --- | --- |
| `pnpm desktop:check` | pass |
| `pnpm desktop:test` | 540 passed, 14 skipped (31 files) |
| `pnpm desktop:test:vault` | `vault encryption: OK` (real Keychain, Electron 44.9.3) |
| `pnpm desktop:test:native-input` | 1046 assertions pass |
| `pnpm desktop:build` | pass |
| `pnpm prettier:check` | pass |
| `pnpm audit` | no `electron`, `extract-zip`, `app-builder-lib` or `builder-util-runtime` advisory (recorded at the final tree) |

Electron 44.9.3 reports Node 24.22.0, Chromium 152.0.7977.167, N-API 10 and a
zstd API. Mutation check: with `signAndEditExecutable: false` restored, the new
packaging test fails.

### Phase 2: macOS signing rehearsal

Review tier: high risk (release signing).

Requirement R3. `pnpm desktop:dist:mac -- --signing-rehearsal`:

- needs no redistribution receipt or notarization profile;
- signs nested code and seals the app with the Developer ID identity and the
  release entitlements, without embedding a receipt;
- verifies every native leaf and the outer seal with `codesign --strict`, signs
  and verifies the DMG, and skips notarization, stapling and Gatekeeper;
- writes `release/signing-report.json` with `release_ready: false` and
  `release/size-report.json`, but no publish folder.

Then: fresh darwin-arm64 stage and audit, `pnpm desktop:mac` (unsigned package),
an isolated supervised `desktop:dev` launch against the stage, and the rehearsal.

Blocked 2026-10-26: the build disk had 5 GB free; staging, packaging and the
release builder's own check need more than 8 GB.

## Final integration review

Pending.

## Validation and acceptance

Agent evidence (macOS arm64): recorded per phase.

Owner gates, outstanding until performed:

- Windows 11 x64 host: fresh stage and audit, `pnpm desktop:test`,
  `pnpm desktop:test:vault`, `pnpm desktop:test:native-input`,
  `pnpm desktop:test:termination`, `pnpm desktop:win:installer`, then
  `pnpm desktop:dist:windows -- --signing-rehearsal`; check `Animama.exe`'s icon
  and version details and the signing report.
- macOS notarized candidate: record a redistribution receipt for the new
  inventory, then `pnpm desktop:dist:mac` with the notary profile (submits to
  Apple).
- Native acceptance on both platforms with Electron 44: microphone permission
  and dictation, voice mode audio, PiP, quick chat, global Press-to-talk,
  credential vault, runtime recovery, and an update check.

## Idempotence and recovery

Version bumps revert with the lockfile. Staging and packaging write only ignored
derived directories (`desktop/.desktop-runtime/`, `desktop/release/`). The
signing rehearsal signs local copies only; nothing is notarized or uploaded.

## Outcomes & Retrospective

Pending.
