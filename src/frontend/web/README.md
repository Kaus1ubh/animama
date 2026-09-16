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

During local Vite dev and local Vite preview, the Parakeet STT assets can live
at the repo root in `parakeet-tdt-0.6b-v2`. If that directory exists when Vite
loads its config, `vite.config.ts` points the client Parakeet model URLs at
`/__client-parakeet-models` and serves that route from the local model
directory. The route is implemented by
`vite-plugins/local-parakeet-models.ts` and exists to keep the large model files
out of `public` and out of `dist` while preserving same-origin browser fetches
for `parakeet.js` and ONNX Runtime.

For a static production deploy, either put the model under
`public/onnx/models/parakeet-tdt-0.6b-v2` so Vite copies it into `dist`, or set
`VITE_CLIENT_PARAKEET_MODEL_BASE_URL` at build time to an external static asset
URL. The local production-like `vite preview` flow can use the repo-root model
directory because `vite.config.ts` also installs the model route for preview.

This should not materially slow normal Vite dev transforms: the model files are
not imported into the app bundle and are fetched only when Parakeet dictation is
used. The main costs are:

- `pnpm build` copies `public` into `dist`, including large ONNX files.
- Container builds need a writable `dist` that is not owned by root or
  `nobody`.

If the model directory is somewhere else, set
`VITE_CLIENT_PARAKEET_MODEL_DIR=/absolute/path/to/parakeet-tdt-0.6b-v2` before
starting `pnpm dev`, `pnpm build`, or `vite preview`.

The repo-root Docker Compose `web` service mounts
`./parakeet-tdt-0.6b-v2` read-only at `/app/parakeet-tdt-0.6b-v2` and sets
`VITE_CLIENT_PARAKEET_MODEL_DIR` to that container path, so both the dev command
and the commented production-preview command use the same mounted files. Without
that mount, requests for Parakeet files can fall through to the app HTML, which
shows up as tokenizer lines like `<!doctype html>` or ONNX protobuf parse
errors.

Do not exclude `onnxruntime-web` globally from Vite dependency handling: MicVAD
depends on `onnxruntime-web/wasm` through a CommonJS `require(...)`, and
Vite/Rolldown must bundle that dependency for the browser.

If build size or time becomes a problem, prefer serving large ONNX models from a
separate static asset host, mounted volume, or CDN and configuring the client
model URLs to point there. That keeps the Vite app bundle/build output focused
on app code while preserving local Parakeet runtime loading.

### Docker build ownership notes

The `animama-web` service in the repo-root `docker-compose.yml` runs as the
host UID/GID:

```yaml
user: "${HOST_UID:-1000}:${HOST_GID:-1000}"
```

`reset.sh` exports `HOST_UID="$(id -u)"` and `HOST_GID="$(id -g)"` before
calling `docker compose up -d` so files created by the web container match the
host user.

The web service also uses UID/GID-owned `tmpfs` mounts for:

- `/app/node_modules`
- `/app/web/node_modules`
- `/app/web/dist`
- Corepack/pnpm cache and shim directories under `/tmp`

This avoids two common local build failures:

- `corepack enable` trying to create a global `pnpm` shim in `/usr/local/bin`
  when the container is no longer running as root.
- Vite failing to remove `dist/assets` after previous containerized builds left
  host files owned as `root` or `nobody`.

For this reason the compose command creates the pnpm shim in `/tmp/corepack-bin`
and prepends that directory to `PATH` before running `pnpm`. The production-like
preview command commented in `docker-compose.yml` uses the same pattern.
