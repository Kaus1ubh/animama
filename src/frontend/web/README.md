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
- Runtime assets are served from `public`.
- Auth and telemetry server concerns live in the sibling `../server` package.

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

Vite serves assets directly from `src/frontend/web/public`. These files are Git
LFS-managed. On a fresh device, install and pull LFS before running the web app:

```sh
git lfs install
git lfs pull --include="src/frontend/web/public/**"
```

If these files are still pointers, avatar animations, VFX, speech models,
sounds, and images will fail at runtime. Hydrate the required LFS inputs before
building. The repository classification/provenance audit checks tracked asset
payloads; desktop staging separately verifies its exact runtime inventory. See
[repository boundary checks](../../../scripts/repository-boundary/README.md) and
[runtime staging](../../../docs/frontend/desktop/runtime-staging.md).

### Parakeet ONNX assets and build cost

From the repository root, run `python3 scripts/models/parakeet.py acquire` once.
Vite development/preview resolves the verified shared store offline and serves
`/__client-parakeet-models`. Set `ANIMAMA_MODEL_ROOT` to select another absolute
store root. Missing/corrupt inputs fail at server startup with setup guidance;
Vite does not acquire models or silently select another model source.

Build-only commands do not need weights. Parakeet stays outside `public`, `dist`
and Git worktrees; built self-host Compose supplies the same-origin directory
as a read-only mount. There is no browser-to-Hugging-Face download path. Other
browser assets, including ONNX Runtime and PocketTTS, remain unchanged and still
need their existing Git LFS hydration.

Compose supplies its verified mount through `VITE_CLIENT_PARAKEET_MODEL_DIR`;
this is a container path, not the host's model-store setting. See
[shared model setup](../../../docs/backend/operations/model-assets.md) for import,
verification, offline restart and deliberate cleanup, and
[runtime staging](../../../docs/frontend/desktop/runtime-staging.md) for desktop
pack production. Installed desktop keeps its app-owned model pack lifecycle.
