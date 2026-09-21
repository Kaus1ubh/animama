# Anima Web

Vite + React browser frontend for Anima.

See the [frontend architecture guide](../../../docs/frontend/architecture/overview.md)
for source ownership, routes and runtime flows.

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

Vite verifies the pinned browser speech inventory before serving or building.
Production builds include those files and need no developer cache. Check source
inputs with `pnpm verify:tts-assets` from `src/frontend`; check built output with
`pnpm verify:tts-assets -- --built-root web/dist`.
See [Content and workers](../../../docs/frontend/architecture/content-and-workers.md)
for asset ownership, optional voice catalogs and dependency versions.

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
