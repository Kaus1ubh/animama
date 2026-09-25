# Desktop App Overview

Animama Desktop runs the React app and its local services under Electron. The
desktop package owns native windows, service supervision, protected credentials,
preload IPC, permissions, and packaging. React still owns the product UI,
runtime-owner context, data fetching, avatar runtime, and settings. No local
account or hosted Animama account is needed to open the app.

The runtime includes optional packs, guarded application updates, upgrade
snapshot retention and signing tools. Release acceptance remains pending for
fresh matching artifacts, complete starter inputs, minimum-OS and native tests,
and explicit publication approval. Pack and update downloads come only from the
public distribution selected at build time. Start with [Installation](installation.md),
[Feature packs](feature-packs.md) and [Troubleshooting](troubleshooting.md).
Maintainers use the [manual release process](release-process.md) and
[Runtime staging](runtime-staging.md).

## Runtime Shape

The desktop package lives in `src/frontend/desktop`.

The packaged-resource format is `animama-desktop-runtime/2`, with
`local_http_schema_version: 1`. The reader rejects unsupported or mixed runtime
artifacts before native execution. `runtime/state.json` stores
`{version: 1, gatewayPort}`: `gatewayPort` is the saved application port, including
when FastAPI owns the listener. The vault, installation owner and
`persist:animama` browser partition persist across launches. Acceptance requires
a matching stage, audit, package and isolated native test of the exact source.

Packaged builds always select embedded mode. At startup, `desktop/src/main.ts`:

1. Sets the Animama name and user-data directory, moving an existing
   `Anima` tree only into an absent destination, and acquires the single-instance
   lock before sessions, logs, vault access, or services.
2. Opens an Electron-owned startup/recovery page and validates the staged
   manifest, required resource hashes, platform, and versions. Reconciles saved
   pack pointers against the exact embedded catalog and verified file inventories.
3. Unlocks the encrypted vault and preflights the saved loopback application
   port, choosing and persisting one on first launch. Recovery remains in its
   independent Electron window while no application listener is available.
4. Initializes or starts owned PostgreSQL 16 with pgvector, verifies the exact
   PGDATA, backs up an existing schema before upgrading, and runs the frozen
   bootstrap CLI. Migrations own installation-principal generation.
5. Starts upload cleanup, the document worker if its pack passes inventory and
   OS-signature verification, and FastAPI on the saved application port. Private
   readiness must match the exact child PID/start token, runtime/build, local HTTP
   schema, Alembic head and owner after Included-source reconciliation succeeds.
6. Installs the fresh HttpOnly renderer capability and loads the packaged React
   app and same-origin product APIs directly from the verified FastAPI listener.

The browser-facing origin is a persisted `http://127.0.0.1:<port>`. PostgreSQL
uses a separate private loopback port. An occupied saved application port
shows recovery; it does not silently switch origins or create another owner.
Quitting drains requests and stops retained child handles. The app never kills
a process merely because it occupies a port or appears in an old PID record.

Unpackaged `pnpm desktop:dev` remains the external-stack workflow. It loads
`ANIMAMA_DESKTOP_WEB_URL` or `http://localhost:8000` and does not start services.
An explicit unpackaged `ANIMAMA_DESKTOP_DEV_RUNTIME_ROOT` selects embedded
testing against a complete staged runtime. Packaged builds reject web-URL,
development runtime/data, and sandbox overrides. See [Platform builds](platforms.md).

Electron uses the same owner-scoped catalog and byte APIs as browser web.
It does not enumerate the host content library or expose arbitrary filesystem
IPC. See [Local content runtime](../architecture/local-content-runtime.md) for
source scanning and mounted-content behavior, and
[Platform builds](platforms.md) for external-stack development.

The renderer starts through `main.local.tsx`. On a fresh database it shows the
required private display-name setup; after completion it opens Annie's chat.
Later launches use the last visited owned Anima, or the first remaining Anima.
There is no desktop-local signup, sign-in, session, bearer token, or logout.
Electron's HttpOnly renderer capability authenticates the renderer process to
the local FastAPI boundary and is separate from the stable, non-secret installation owner ID.

Once React opens an Anima, it shares the browser's progressive runtime: verify
the model, draw canonical relaxed-rest, then prepare optional animations/effects
in the background. No IPC byte path or second desktop loader is involved.
Service readiness and the first avatar frame are separate milestones; see
[Mounted runtime preparation](../architecture/local-content-runtime.md#mounted-runtime-preparation).

## Main Process

The Electron main process owns capabilities outside the browser boundary:

- the local runtime graph, readiness, owned shutdown, and recovery
- main window creation and stable-origin loading
- the encrypted credential vault and provider-consumer restart
- catalog-bound pack installation, cancellation, removal, and worker verification
- stable-channel update checks, explicit download/restart consent, and pack preflight
- navigation and permission guards
- native fullscreen
- native desktop PiP
- desktop voice keyboard shortcuts
- main-process logging
- packaging entrypoints

Important files:

```text
desktop/src/main.ts
desktop/src/main-process/config.ts
desktop/src/main-process/window/create-window.ts
desktop/src/main-process/security/guards.ts
desktop/src/main-process/security/renderer-capability.ts
desktop/src/main-process/runtime/supervisor.ts
desktop/src/main-process/runtime/paths.ts
desktop/src/main-process/runtime/vault.ts
desktop/src/main-process/runtime/ipc.ts
desktop/src/main-process/feature-packs/
desktop/src/main-process/updates/
desktop/src/main-process/runtime/product-windows.ts
src/backend/animama/local/http/assets.py
desktop/src/main-process/fullscreen/fullscreen-ipc.ts
desktop/src/main-process/pip/pip-window-manager.ts
desktop/src/main-process/shortcuts/shortcuts-ipc.ts
```

The main process validates the configured web URL and restricts renderer
navigation to the configured origin. External HTTP(S) links open through the OS shell.

## Preload Bridge

Renderer access to Electron goes through `window.animamaDesktop`, exposed by the
sandboxed preload at `desktop/src/preload.cts`.

API version 2 identifies the platform and window role and groups runtime,
credential, feature-pack, update, fullscreen, PiP, Quick Chat and shortcut methods.
See `desktop/src/preload.cts` for the complete surface.

The preload source uses `.cts` and is bundled to `dist/preload.cjs` after
TypeScript compilation. Keep new bridge APIs narrow, serializable, and explicit.
Do not expose Node or arbitrary Electron APIs directly to the renderer.

Shared serializable runtime contracts live in `shared/desktop-runtime.ts`.
Credential results contain only provider/configured/update/restart status and
bounded failure codes;
there is no read-key API. Main accepts these operations only from a registered,
live main window's top-level frame at the exact application origin. The
recovery window has access only to runtime actions. PiP, quick chat, unknown
windows, and subframes cannot access credentials or mutate packs. Pack requests
accept only the three fixed catalog IDs, never renderer-supplied URLs, paths,
versions, hashes, or commands. Progress subscriptions return cleanup functions;
destroyed windows stop receiving events. Update controls also require the main
window and accept zero arguments; recovery can open only the fixed backup folder.

## Provider Settings And Local State

Embedded setup and Settings show optional OpenAI, DeepSeek, Hugging Face,
Gemini, and ElevenLabs key controls. Keys are never read back or saved to
browser storage. Saving or removing one first drains local work, then encrypts
the vault through Electron `safeStorage` and restarts FastAPI and the installed
document worker with the new environment. PostgreSQL, the stable origin, and local ownership do
not change. Unavailable secure storage fails closed; it never falls back to
plaintext storage. Browser and external-stack development do not show these
desktop credential controls.

A busy or failed drain leaves the previous credential unchanged. Main retains
one bounded failure status per provider across product-window recreation, so
reopening Settings explains why the change did not finish. A new accepted attempt clears that provider's
previous failure. If the vault was already updated before a service restart
failed, the saved value remains; Retry starts services with that value and
clears the restart failure after verified readiness. These failure records stay
in main-process memory only and contain no credential values.

On macOS the user-data root is `~/Library/Application Support/Animama`:

| Relative path            | Purpose                                                                       |
| ------------------------ | ----------------------------------------------------------------------------- |
| `runtime/state.json`     | Saved application port (`gatewayPort` remains the version-1 serialized field) |
| `runtime/processes.json` | Child ownership evidence, not permission to kill stale PIDs                   |
| `runtime/logs/main.log`  | Redacted supervisor and child logs                                            |
| `secrets/vault.bin`      | Encrypted database password and optional provider keys                        |
| `postgres/16/data`       | Private PostgreSQL cluster                                                    |
| `content/local`          | Writable typed Local library                                                  |
| `data`                   | Private uploads and runtime staging                                           |
| `backups/pre-migration`  | Verified custom-format upgrade dumps and migration journal                    |
| `packs/<id>/versions`    | Immutable optional pack versions and retained prior bytes                     |
| `packs/active.json`      | Atomic active pointers, reverified before use                                 |
| `downloads`              | Bounded partial archives and strong-ETag resume metadata                      |

Packaged `resources/runtime/content/included-core` is immutable and separate
from that writable tree. The backend records `source-id@version` provenance
and resolves protected bytes beneath the exact mounted source. React receives
neither source paths nor arbitrary filesystem access. Only Local is watched.

## Optional Feature Packs

Parakeet is the only active initial pack; expanded Included content and document
processing are deferred. [Feature packs](feature-packs.md) describes availability,
setup and removal behavior.

The owner-protected `GET /v1/runtime-capabilities` is the renderer's capability
authority. Pack status is separate from document-worker liveness. An installed
worker may be `starting` or `stale` while new jobs remain safely queued; an absent
pack cannot enqueue. See backend [User files](../../backend/features/user-files.md).

Electron downloads only app-matched catalog archives, checks real free space,
size and SHA-256, strictly extracts regular USTAR members, and verifies the full
inventory before an atomic pointer switch. Interrupted extraction has no mount
authority. Failed installation retains the prior version; verified ETag/range
metadata permits download resume. See [Runtime staging](runtime-staging.md) for
producer, approval, and executable-signature gates.

Activation/removal preserves the saved origin. It checks private backend
removal blockers, remembers a validated main-app route, destroys all product
windows/workers and shows independent recovery. Private quiescence stops new
admission and waits up to 15 seconds for admitted work. The supervisor stops the
worker, repeats removal checks, stops FastAPI, then switches the pointer and
restarts. A busy quiesce preserves the old pointer/configuration and restarts
that configuration; no resume endpoint reopens admission.
Save unfinished edits first. Anima references, unexpired preview/runtime leases,
active import/reconciliation work, and running document jobs prevent removal;
affected labels appear in Settings. Expanded entries are never auto-equipped.
Queued document jobs survive removal and resume with the worker installed again.

Parakeet files use the protected same-origin
`/onnx/models/parakeet-tdt-0.6b-v2/` mount. Exact `?v=<asset-version>` requests
support immutable private caching, ETags, HEAD, and single byte ranges. Stale
versions and unlisted files return 404. No pack root or executable path enters React.

## Startup Recovery

The independent recovery page works even when the application listener cannot bind. It
shows a safe error code with Retry, Open Logs, Open Backups, and Quit. Retry does
not reset data; Open Backups appears only for a relevant snapshot. See
[Troubleshooting](troubleshooting.md) before changing files. A damaged runtime
requires a complete build to be reinstalled. A missing
vault beside a database requires recovery of the matching vault and data;
restoring a vault on another machine may also require its original OS keychain.
Missing installation ownership fails closed, rather than generating a new owner
over existing data.

Backups must preserve the database, vault, Local content and private data together
with the app closed. Premigration dumps are incomplete backups and never trigger
automatic restore or downgrade. See [Backup and recovery](troubleshooting.md#backups-and-recovery)
for retained snapshots, keychain requirements and stale-process recovery.

Pack state is reconstructed, not trusted from the UI. A corrupt version is
unmounted and can be reinstalled; a replacement is verified before damaged
bytes are moved aside. Incompatible old versions remain on disk and report
`update_available`, but are not mounted or executed. Application update preflight
blocks a candidate that would strand referenced expanded content; clear its
references or arrange a compatible pack before retrying. Do not manually replace
an app to bypass this check: source withdrawal deliberately fails closed. Never erase pack files
manually to bypass references or leases.

## Application Updates

A signed, configured macOS app checks its release feed after startup and
on demand in Settings → General. Checks never download. Download and confirmed
Restart are separate actions; normal Quit does not install. Offline checks do
not prevent startup. Unpackaged and unconfigured builds hide these controls.

Before downloading or stopping services, the supervisor verifies disk capacity,
pack compatibility and in-use references. Native replacement verification begins
only after every owned service stops. Explicit native failure can resume the old
app; a timeout keeps services stopped for safe recovery. A replacement verifies
its own runtime manifest before database work. No hosted account or GitHub token
is stored in the app. See [Releases](releases.md) for policy and acceptance gates.

## Runtime Platform Provider

The web app reads the preload bridge once through
`web/src/platform/RuntimePlatformProvider.tsx`.

This produces a stable runtime platform object:

- `kind: "web" | "desktop"`
- `isDesktop`
- `desktopBridgeVersion`
- `os`
- `capabilities.nativeFullscreen`
- `capabilities.nativePiP`
- `desktopBridge`, only in desktop mode

React code should depend on `useRuntimePlatform()` rather than probing
`window.animamaDesktop` directly. Product surfaces such as `MainShell` stay
platform-agnostic by calling hooks like `useFullscreen()` and
`usePictureInPicture()`.

## Native Fullscreen

Desktop fullscreen uses Electron `BrowserWindow` fullscreen APIs instead of DOM
element fullscreen.

Flow:

```text
Canvas control
  -> useFullscreen()
  -> useDesktopFullscreen()
  -> window.animamaDesktop.fullscreen
  -> ipcMain handler
  -> BrowserWindow.setFullScreen(...)
```

The main process emits fullscreen state changes on native
`enter-full-screen`/`leave-full-screen` events. Escape is handled in the main
process so the React button state stays aligned with the native window state.

Browser web still falls back to DOM fullscreen.

## Desktop Picture-In-Picture

Desktop PiP is a second frameless Electron `BrowserWindow`, not Chromium
Document Picture-in-Picture.

The main window owns audio and runtime state. The PiP window renders a
scene-only route and receives visual state over Electron IPC. On supported
platforms, the PiP body is click-through while close, resize, the hover drag
handle, and the size slider remain interactive. Browser web still uses Document
PiP when available.

See [Picture-in-picture](picture-in-picture.md) for implementation details.

## Desktop Keyboard Shortcuts

Desktop voice shortcuts are owned by the Electron main process. One-shot keys
use Electron, while global hold-to-talk uses Animama's first-party macOS/Windows
native addon and exposes only matched down/up transitions to JavaScript. The web
app stores and displays the application preferences, but shortcut capture only
applies inside the desktop app. The default shortcuts toggle Voice Mode, toggle
Voice Mode mute, and skip active TTS playback.

See [Keyboard shortcuts](keyboard-shortcuts.md) for implementation details.

## Security Model

Desktop windows use:

- `contextIsolation: true`
- `nodeIntegration: false`
- `sandbox: true`
- `webSecurity: true`
- a bundled preload bridge with explicit IPC surfaces
- the dedicated `persist:animama` session partition
- a fresh per-launch, host-only, HttpOnly renderer-capability cookie

The session permission guard currently allows only media permissions from the
configured web origin. Navigation guards block or externalize URLs outside the
configured origin.

IPC handlers resolve target windows from `event.sender`. Renderers do not choose
window ids, target webContents ids, or arbitrary URLs.

## Speech And Audio Behavior

Electron can expose browser Web Speech APIs while still failing recognition in
practice. Desktop mode hides browser STT/TTS options from the app UI.

Desktop speech behavior:

- STT uses client-side Parakeet only when runtime capabilities report it
  available. Embedded mode requires the verified optional pack; external-stack
  development retains its configured same-origin model source.
- TTS uses PocketTTS or ElevenLabs.
- Browser TTS/STT providers are not offered in desktop settings.
- Desktop PiP is visual-only; the main renderer remains the audio owner.

## Logging And Diagnostics

Main-process logs are written to:

```text
~/Library/Application Support/Animama/runtime/logs/main.log
```

Useful checks from `src/frontend`:

```sh
pnpm desktop:check
pnpm desktop:build
pnpm web:check
```

Renderer DevTools are available with `Ctrl+Shift+I`. Use
`pnpm desktop:dev_inspect` to debug the Electron main process on port `9229`.

## Packaging

See [Platform builds](platforms.md) for packaging commands.

The unsigned development package targets macOS 15+ arm64 and requires a fresh,
complete audited stage. Windows and Linux self-contained packaging is deferred;
external-stack `desktop:dev` is available on those platforms. Signed releases
require separate signing, notarization, minimum-OS and native acceptance.
Initial publication uses the manual process from reviewed `main` inputs. The
optional executable worker requires Developer ID signing, notarization and
pinned-publisher verification even with an unsigned core.
