# Animama Desktop

Electron owns the embedded local runtime, native windows, encrypted provider
settings and guarded preload bridge. Packaged macOS starts its own PostgreSQL
and FastAPI; FastAPI serves the production React build at the saved loopback
origin. It does not
require Docker or development servers on the user's computer.

**No signed public release is available.** Fresh-source staging, complete starter
inputs and signed/native acceptance remain pending. Local signed candidates can
be built with a private release repository; private GitHub pack/update downloads
are unsupported. Windows and Linux self-contained packaging are deferred.
Intel/universal Mac and Windows ARM are unsupported.

## Documentation

- [Installation and availability](../../../docs/frontend/desktop/installation.md)
- [Optional packs](../../../docs/frontend/desktop/feature-packs.md)
- [Troubleshooting, logs and recovery](../../../docs/frontend/desktop/troubleshooting.md)
- [Runtime architecture and preload](../../../docs/frontend/desktop/overview.md)
- [Global voice shortcuts](../../../docs/frontend/desktop/keyboard-shortcuts.md)
- [Platform development builds](../../../docs/frontend/desktop/platforms.md)
- [Native staging and input review](../../../docs/frontend/desktop/runtime-staging.md)
- [Manual release process](../../../docs/frontend/desktop/release-process.md)
- [Signing and publisher reference](../../../docs/frontend/desktop/releases.md)

## External-stack development

From `src/frontend`, with the existing local application stack running:

```sh
pnpm desktop:dev
```

Only this unpackaged path uses `ANIMAMA_DESKTOP_WEB_URL`, defaulting to
`http://localhost:8000`. Development exposes Vite with a same-origin FastAPI
proxy; built self-host exposes FastAPI. PostgreSQL stays private. For an existing named stack, source `../../.animama-stack.env` before
launching. No new Compose stack is needed for routine desktop work.

`desktop:dev_inspect` exposes the development main-process inspector on
`127.0.0.1:9229`. Packaged builds reject external web URLs, development runtime/data
paths and sandbox-disable overrides. Never add a packaged fallback to Vite or
use an external-web AppImage/NSIS wrapper as self-contained runtime evidence.

## Embedded macOS development

Run on Apple silicon from `src/frontend`, after reading the staging prerequisites:

```sh
pnpm desktop:mac:build
```

This builds/stages, audits and packages the unsigned development
`desktop/release/mac/Animama.app` without launching it. To build and launch:

```sh
pnpm desktop:mac:build:run
```

To open an existing bundle without any build or packaging:

```sh
pnpm desktop:mac:launch
```

Quit Animama before rebuilding. All build steps must succeed before launch;
launch alone fails if the bundle is missing. The individual stage/audit commands
remain available. `desktop:mac` only packages a staged/audited runtime, and
`desktop:mac:package:run` packages it and launches. `desktop:mac:run`
remains a deprecated compatibility alias for package-and-launch, not a full build.
`desktop:dev` keeps its separate external-stack behavior.

This remains an unsigned development bundle, not a notarized installer.
Both certificate and ad-hoc signing are disabled for that
producer, and the copied resource inventory is checked. Explicit isolated
unpackaged runtime tests are documented in the platform guide; they must not
point at the normal desktop profile. Developer state and build output stay separate.

First run generates its installation owner and asks for a private display name;
provider keys remain optional. No local or hosted account is needed. Parakeet
recognition is optional; PocketTTS does not require it. Its CPU model and GPU
add-on install in place from Voice settings through the backend model-asset
service, without a restart. Browser Web Speech STT/TTS is not offered in
desktop settings. Only app-matched, verified packs can enable pack
capabilities; expanded content and document processing are deferred from the
first release. The future document worker requires a verified publisher
signature even when testing an unsigned core.

## Release and recovery boundaries

`desktop:dist:mac` (also `desktop:mac:dmg`) requires reviewed signing, content and
public-feed inputs and creates a signed candidate without publishing it. Initial
publication is a separate command run by `raymond-van` from reviewed `main`
inputs after preview/native acceptance gates. Do not run dormant CI deployment
jobs or fill approval receipts to work around pending inputs.

Data and logs live under `~/Library/Application Support/Animama`, not inside
`Animama.app`; the main log is `runtime/logs/main.log`. The old `Anima` tree is
moved only into an absent destination, never merged with another profile.
Use the recovery page and preserve the database/vault. No process-name killing,
PGDATA deletion, exposing services beyond loopback or a sandbox bypass is a recovery step.

## Checks and bridge

From `src/frontend`:

```sh
pnpm check
pnpm desktop:test
pnpm desktop:build
```

Main runs as bundled ESM; sandboxed preload entries use `.cts` and are emitted
as CommonJS `.cjs`. API version 2 is exposed only through
`window.animamaDesktop`, with registered-window/frame checks and no arbitrary
filesystem, command or credential-readback surface. Shared serializable contracts
live in `../shared/desktop-runtime.ts`. Automated component checks do not replace
signed installation, actual microphone/audio, pack or upgrade acceptance.
