# Anima Web

Vite + React browser frontend for Anima.

This package contains the web app runtime, TanStack Router route tree,
TanStack Query data layer, UI, browser hooks, Zustand stores, generated Anima
API client, workers, styles, and runtime assets.

## Current Shape

- Vite serves and builds the browser app.
- TanStack Router file routes live under `src/routes`.
- App startup and providers live under `src/app`.
- Runtime code is colocated under `src/{ui,lib,hooks,stores,query,client,workers}`.
- Small runtime assets are served from `public`; verified speech inputs keep the
  same URLs through the shared asset resolver.
- Local request admission and telemetry server concerns belong to FastAPI.

## Commands

From `src/frontend/web`:

- `pnpm dev`
- `pnpm build`
- `pnpm check`
- `pnpm lint`

From the workspace root, `src/frontend`:

- `pnpm verify:tts-assets`
- `pnpm web:dev`
- `pnpm web:build`
- `pnpm web:check`
- `pnpm web:lint`
- `pnpm check`

## Runtime Assets

Small browser resources remain under `src/frontend/web/public`. Hydrate tracked
LFS inputs before running or building the application:

```sh
git lfs install
git lfs pull
```

Speech engine payloads are acquired separately. From the repository root:

```sh
python3 scripts/models/parakeet.py acquire
python3 scripts/models/browser_speech.py acquire
```

`models/browser-runtime/manifest.json` binds all 19 reviewed browser assets.
Eight Pocket TTS/Smart Turn files live in a shared immutable model store; nine
ORT 1.24.2 files come from the exact `onnxruntime-web-assets` dependency alias,
and two VAD 0.0.30 files come from its pinned dependency. Existing bundled ORT
imports retain their own locked versions. `pnpm install --frozen-lockfile` supplies
these dependency assets; do not copy a different ORT release into their place.

Vite development verifies and serves these inputs at their existing `/onnx/`
URLs. Production and embedded-desktop builds require the verified browser model
set and copy all 19 files into their output. Preview verifies that self-contained
output, so it does not need the browser model cache. The browser does not fetch
executable inputs from upstream hosts. `pnpm verify:tts-assets` checks source
inputs; `pnpm verify:tts-assets -- --built-root web/dist` checks built output
when run from `src/frontend`.

Legacy operator-supplied catalogs at
`/onnx/models/pocket-tts/animas/<safe-id>_voices.bin` remain separate optional
inputs under `web/public`, using letters, digits, `_` or `-` for the ID. Vite
serves only existing regular files at those paths and preserves their build
copies; missing catalogs return 404. They are not hash-approved engine assets
or members of the 19-file manifest. Normal uploaded catalog URLs are unaffected.

### Parakeet and shared storage

Parakeet stays outside `public`, `dist` and Git worktrees. Its Vite development
and preview path resolves the shared store offline and serves
`/__client-parakeet-models`; built self-host Compose mounts those bytes read-only.
A web build requires the browser speech set above but does not require Parakeet
weights. Installed desktop uses its separate app-owned Parakeet pack lifecycle.

Use `ANIMAMA_MODEL_ROOT` to select an absolute host store root. Native Windows
defaults to `%LOCALAPPDATA%\Animama\models`; WSL uses the Linux default. See
[shared model setup](../../../docs/backend/operations/model-assets.md) for all
platform defaults, Windows commands, import, verification and deliberate cleanup.
Compose's derived `ANIMAMA_BROWSER_MODEL_DIR` and
`VITE_CLIENT_PARAKEET_MODEL_DIR` describe container inputs, not another user
storage setting. Startup and builds fail on missing/corrupt inputs and never
acquire models implicitly.

Built self-host images and desktop resources retain independent distribution
copies, with the existing notices and license conditions. See
[runtime staging](../../../docs/frontend/desktop/runtime-staging.md) and
[repository boundary checks](../../../scripts/repository-boundary/README.md).
