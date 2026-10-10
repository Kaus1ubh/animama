# Desktop Platform Builds

The embedded runtime targets macOS 15+ on Apple silicon. It includes the local
service lifecycle, optional pack controls, signing tools and guarded updates.
A fresh build, complete starter inputs, minimum-OS testing and signed/native
acceptance are required before release. See [Runtime staging](runtime-staging.md),
[Desktop overview](overview.md) and [Releases](releases.md) before building.
For installation use [Installation](installation.md); these are developer
commands. Publication follows the [manual release process](release-process.md).

## External-Stack Development

Run these commands from `src/frontend`:

```sh
pnpm desktop:dev
pnpm desktop:dev_inspect
```

Without a runtime-root override, unpackaged Electron loads
`ANIMAMA_DESKTOP_WEB_URL` or `http://localhost:8000`. The normal local stack must
already be running. Development publishes Vite with a same-origin API proxy;
built self-host publishes FastAPI with compiled React assets. PostgreSQL stays
private on the Compose network.

For an existing named worktree stack, source its environment before
`desktop:dev`:

```sh
source ../../.animama-stack.env
pnpm desktop:dev
```

Do not source that web-URL override for a packaged launch. Packaged builds
reject it; they always start their own local services. An external-stack launch
is useful for window, PiP, shortcut, and React development but does not verify
the self-contained runtime. It exposes no embedded provider-key or pack controls.

External-stack development remains available on macOS, Windows, and Linux.
Linux's explicit `ANIMAMA_DESKTOP_DISABLE_CHROMIUM_SANDBOX=1` diagnostic switch
is accepted only in unpackaged development. Never disable the sandbox in a
packaged build.

## Embedded macOS Build

Run on an Apple-silicon Mac with the build dependencies in
[Runtime staging](runtime-staging.md):

```sh
pnpm desktop:mac:build
```

Run from `src/frontend`. The convenience commands are:

| Command                        | Behavior                                                                           |
| ------------------------------ | ---------------------------------------------------------------------------------- |
| `pnpm desktop:mac:build`       | Build/stage, audit, then package the unsigned app; do not launch.                  |
| `pnpm desktop:mac:build:run`   | Complete the same build, then launch only if every step succeeds.                  |
| `pnpm desktop:mac:launch`      | Open the existing app; never stage, audit or package. Fails if the app is missing. |
| `pnpm desktop:mac`             | Package an already staged/audited runtime; do not launch.                          |
| `pnpm desktop:mac:package:run` | Package an already staged/audited runtime, then launch.                            |

Quit the app before replacing its bundle. For everyday launches, use
`desktop:mac:launch`; rebuild when you want source changes included. Launching
does not incorporate new source changes or reset application data. These commands do not sign or publish a release.

The full build reuses these individual commands in order, stopping at any failure:

```sh
pnpm desktop:runtime:stage -- --platform darwin --arch arm64
pnpm desktop:runtime:audit -- --platform darwin --arch arm64
pnpm desktop:mac
```

A complete fresh stage and successful audit are mandatory. The build fails on
missing or stale evidence, unresolved input files, unsupported targets, or a
stage-failure marker. It does not silently produce an external-web wrapper.
The stage requires every required starter dependency to be tracked. Starter
content does not depend on Mixamo animations. Optional Local motions are
excluded from staging and cannot satisfy the distribution-input gate. The
non-portable [Mixamo-motion pack](../../backend/operations/mixamo-motion-pack.md)
is staged as `runtime/content/mixamo-motion` only from its verified build input.
Do not copy private assets into a stage to bypass a missing dependency.

The unsigned development bundle is written to
`desktop/release/mac/Animama.app`. Its `Contents/Resources/runtime` directory
contains the frozen backend, native PostgreSQL/pgvector, immutable core content,
and production web files outside ASAR. FastAPI serves the web files; Electron
main owns native supervision and independent recovery.
The development packager explicitly disables both certificate and ad-hoc
signing, then verifies the copied runtime against the audited file inventory.
`CSC_IDENTITY_AUTO_DISCOVERY=false` alone is insufficient: electron-builder's
Apple-silicon fallback can change native hashes through ad-hoc signing.
`desktop/release/development-package-report.json` records the result and actual
installed size. This local bundle is not a notarized distribution artifact.
`pnpm desktop:pack` aliases this same macOS development producer;
`pnpm desktop:mac:run` is a deprecated compatibility alias for
`desktop:mac:package:run`: it still packages and opens without staging/auditing.
Use the explicit names above for new workflows. The existing
`desktop:mac:dmg` alias and `desktop:dist:mac` require the signed-release
inputs and build a signed candidate; they do not publish it. Follow
[Releases](releases.md) for the separate native smoke and publication gates.

### Reset desktop data for fresh setup

Quit Animama completely, then run from `src/frontend`:

```sh
pnpm desktop:mac:reset
```

This archives `~/Library/Application Support/Animama` to a unique timestamped
sibling `Animama.backup-...` directory and opens the existing packaged app. The
app creates a fresh profile: repeat onboarding and enter provider keys again.
The archive retains chats, Local content, settings, credentials, optional packs,
and migration snapshots. It is private data; keep it protected. Nothing is deleted,
and macOS permissions and the Compose stack are unchanged.

To rebuild successfully before archiving and launching:

```sh
pnpm desktop:mac:reset:build
```

A failed build leaves the profile in place. Both commands require a stopped app
and services; they refuse active process records, unsafe paths, a missing bundle,
or an unresolved legacy `Anima` profile. They never kill processes. Do not launch
another copy while resetting. The helper prints the backup path before launch;
if launch fails, it retains the backup and does not restore automatically.
These commands reset the standard packaged macOS profile only, not a custom
`ANIMAMA_DESKTOP_DEV_USER_DATA` directory. They are explicit fresh-setup tools,
not a migration repair or a full-profile restore procedure.

### Unsigned Windows package

On a Windows 11 x64 host, after a fresh stage and audit
(see [runtime staging](runtime-staging.md#native-windows-build)), run from
`src/frontend`:

```powershell
pnpm desktop:win
pnpm desktop:win:run
pnpm desktop:win:installer
```

`desktop:win` builds the unsigned app in `desktop/release/win-unpacked`, checks
the packaged runtime against the audited inventory and writes
`desktop/release/development-package-report.json`; `desktop:win:run` launches
it. `desktop:win:installer` also builds
`desktop/release/Animama-<version>-x64-setup.exe`, an unsigned one-click
per-user installer for local installer testing. Windows may warn about an
unsigned installer; none of these artifacts is a release. The development
package signs nothing, so the staged runtime keeps its audited hashes, and the
build host needs no Developer Mode.

The installer puts Animama in `%LOCALAPPDATA%\Programs\Animama` without a UAC
prompt and adds Start menu and Desktop shortcuts; it refuses Windows builds
below 22000. The data lives separately in `%LOCALAPPDATA%\Animama` and
survives uninstall, updates and reinstall. Only an uninstall that a person
starts offers to delete it: after the uninstall confirmation it shows that exact
path and defaults to keeping it; removal deletes links inside it without
following them. Uninstalls run with `/S`, including those an installer runs
during an upgrade, never ask and never delete data.

To test an upgrade, build two installers. An upgrade is the newer installer
run over the installed app. A signed release build updates itself through the
same installer; see [Releases](releases.md#what-people-see).

1. Build version N with `pnpm desktop:win:installer`, and copy
   `Animama-<N>-x64-setup.exe` out of `desktop/release`.
2. Set a higher `version` in `desktop/package.json` locally, for example
   `0.1.2`. Do not commit it.
3. Stage, audit and build again. The runtime manifest records the app version,
   and the app refuses a runtime staged for another version.
4. Install N, run it, then run the N+1 installer: it replaces N in place and
   keeps `%LOCALAPPDATA%\Animama`.
5. Restore `desktop/package.json`, then stage and audit again before the next
   package: the stage still records version N+1.

Only one version is installed at a time; to repeat the journey from N,
uninstall (keeping the data) and install N again. Test explicit data removal in
a separate Windows account, or back up `%LOCALAPPDATA%\Animama` first: it also
holds the default developer model store unless `ANIMAMA_MODEL_ROOT` points
elsewhere.

With the app packaged, `pnpm desktop:test:native-input` checks the input hook
on Windows: it loads the addon from the packaged `app.asar.unpacked` inside
`Animama.exe` and requires an injected F24 key press to arrive as one down and
one up. Press-to-talk with a real key and mouse button remains a manual check.

### Supervised development

For supervised development without repackaging, use a complete stage with an
explicit separate data directory:

```sh
ANIMAMA_DESKTOP_DEV_RUNTIME_ROOT="$PWD/desktop/.desktop-runtime/darwin-arm64/runtime" \
ANIMAMA_DESKTOP_DEV_USER_DATA="$PWD/desktop/.desktop-runtime/dev" \
pnpm desktop:dev
```

The application treats that data directory as durable, not as build output.
The staging command clears only its target directory, not `dev`.
Never put user data inside `darwin-arm64/runtime`. Both overrides are
development-only and rejected in packaged mode.

## Platform And Release Gates

| Target                             | Current status                                                                                  |
| ---------------------------------- | ----------------------------------------------------------------------------------------------- |
| macOS 15+, arm64                   | Development packaging implemented; fresh-source native, minimum-OS and signed acceptance remain |
| Windows 11, x64                    | Development package, installer and signed release tooling implemented; clean-machine acceptance and a real signed upgrade remain |
| Linux                              | External-stack development only; packaging deferred beyond the current supported release        |
| Intel/universal macOS, Windows ARM | Not supported                                                                                   |

The Linux builder target remains in configuration, but the prebuild gate
rejects it because Linux has no embedded runtime.
Do not advertise their former shell artifacts as current self-contained builds.
Core signing, notarization, update feeds, and clean-machine smoke are implemented
as gated tooling for both macOS and Windows; an actual accepted release remains
outstanding. The deferred document worker requires signing, notarization and
publisher verification before execution; see the
[pack producer](runtime-staging.md#optional-pack-producer). Windows feature
packs are not built yet, so a Windows release refuses any active pack.

## Validation

Run from `src/frontend`:

```sh
pnpm check
pnpm web:test
pnpm desktop:test
pnpm desktop:build
pnpm build
```

On Windows, after staging the runtime and running `pnpm desktop:build`,
`pnpm desktop:test:termination` force-kills unpackaged Electron at every
startup stage, requires that no process from the staged runtime survives within
30 seconds, and requires the next launch on the same data to reach ready with
the same origin and serve the app. It then quits normally twice, closing the
windows as a user would, and requires every service to stop on Ctrl+Break
without the guard's 15 second job termination. It uses a disposable data
folder.

`pnpm desktop:test:vault` checks the credential vault against the host's real
protected storage (DPAPI on Windows, Keychain on macOS) inside Electron, using a
disposable profile folder that it removes afterwards. On macOS, Electron still
adds an "Electron Safe Storage" Keychain item.

Verify the actual packaged app with development servers stopped:

1. Open the app without Docker, Node, Python, or PostgreSQL already running.
2. Confirm blank names cannot continue, then enter a private display name.
   Provider keys and feature packs are still optional; Continue opens Annie.
3. Add a provider key, chat with both starter Animas, and test cancellation,
   PocketTTS, avatar animation, fullscreen, PiP, quick chat, and shortcuts.
4. Quit and reopen; confirm the same origin, principal, content, chat history,
   and launch into the last visited owned Anima.
5. Confirm all owned children exit on Quit and no credential appears in logs or
   renderer storage.
6. Occupy the saved application port and confirm recovery rather than an origin
   change. Test Retry after releasing the port.
7. Confirm bad runtime files, unavailable encryption, missing vault, and an
   unsupported database major preserve data and show recovery.

Native acceptance must cover the required-name fresh-profile journey, physical
input, minimum supported OS and forward upgrade. Keep exact build receipts with
each review; component or unsigned tests do not satisfy signed acceptance.
Test microphone permission by opening the `.app` normally (Finder or `open`):
launching its executable directly through an automation harness can produce a
different macOS privacy context. No application permission bypass is supported.

Offline speech verification requires skipping optional speech, then real
download, cancellation, interrupted resume, installation, removal and offline
dictation from Voice settings, with no backend restart or window reload.
Expanded content and document processing are deferred from the first release; retain their lifecycle and
in-use/removal regression coverage without advertising their downloads.
Those real artifact/native tests remain gated, not passed. A
successful type check, mocked supervisor test, native database component probe,
or unsigned core journey does not replace native optional-download acceptance.

Signed-release verification requires valid nested/outer signatures, notarization,
stapling, measured DMG/ZIP size gates, the required-name installed-app smoke, manual
native checks, and a real forward update from an older signed app with state
preserved. Its smoke harness refuses existing profiles and never resets data.
Use a separate macOS test account and verify that app/profile data is absent
before the exact signed DMG smoke. Keep the predecessor-upgrade profile separate from the newer candidate's
profile. These are native OS accounts, not additional Compose stacks. Local
candidates may be built with the repository private; installed pack/update
transport acceptance remains gated. See [Releases](releases.md).
