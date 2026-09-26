# Shared speech model setup

Development, Compose self-hosting and desktop pack production use the exact
Parakeet INT8 inputs recorded in
[`models/parakeet-tdt-0.6b-v2/manifest.json`](../../../models/parakeet-tdt-0.6b-v2/manifest.json).
The five upstream files are pinned to full Hugging Face commits, sizes and
SHA-256 digests. Animama's README and attribution complete the seven-file set.
No Cloud checkout, Hugging Face account or API credential is needed.

## Acquire once, verify offline

From the repository root, with Python 3.11 or newer:

```bash
python3 scripts/models/parakeet.py acquire
python3 scripts/models/browser_speech.py acquire
python3 scripts/models/parakeet.py verify
python3 scripts/models/browser_speech.py verify
python3 scripts/models/parakeet.py path
./reset.sh
```

`acquire` downloads only the pinned files over HTTPS. It bounds each download,
checks its size and hash, and promotes the complete set atomically. Concurrent
acquisitions of the same version coordinate through a lock. Failed or interrupted
attempts leave no active partial set; retries safely restart incomplete work.
There is no second Hugging Face download cache maintained by this command.

`verify` and `path` never use the network. `path` prints the absolute verified
directory or exits with an actionable error. A cache hit is still hash-verified;
normal application startup and serving never fetch models or change versions.
For an explicitly offline acquisition/reuse check:

```bash
python3 scripts/models/parakeet.py acquire --offline
```

## Storage and existing copies

The default store root is `~/Library/Caches/Animama/models` on macOS and
`${XDG_CACHE_HOME:-$HOME/.cache}/animama/models` on Linux, including WSL. Native
Windows uses `%LOCALAPPDATA%\Animama\models`, giving a complete version path of
`%LOCALAPPDATA%\Animama\models\parakeet-tdt-0.6b-v2\<manifest-digest>`. Override it with
`ANIMAMA_MODEL_ROOT` or the CLI's `--root` option, using an absolute directory
writable by the setup user. Do not run a privileged downloader.

On native Windows, use `py -3` in place of `python3`. The acquisition CLI has
Windows locking and file-safety handling; this does not add Windows Electron
packaging or make the Bash/Compose workflow a native PowerShell workflow.

Each immutable set lives at
`<root>/parakeet-tdt-0.6b-v2/<sha256-of-manifest-bytes>/`. Different manifest
versions coexist. Worktrees using identical manifests resolve the same bytes;
there are no repository symlinks or per-worktree model copies. Python virtual
environments, node modules, databases and content remain independently owned.

To adopt the model directory retained from an older checkout:

```bash
python3 scripts/models/parakeet.py acquire --offline \
  --import-from /absolute/path/to/old/parakeet-tdt-0.6b-v2
python3 scripts/models/parakeet.py verify
```

Import verifies every payload against the same manifest. Keep the old copy until
the new store verifies and its consumers have been switched. This operation does
not remove old files, rewrite Git history or prune old LFS objects. The retained
source notices remain under `models/parakeet-tdt-0.6b-v2/`; their bytes are included
in the assembled model set and desktop pack.

## Persistent self-hosting and named stacks

Choose persistent storage owned by the setup user, for example an appropriately
provisioned `/var/lib/animama/models`, then run:

```bash
export ANIMAMA_MODEL_ROOT=/var/lib/animama/models
python3 scripts/models/parakeet.py acquire
python3 scripts/models/browser_speech.py acquire
ANIMAMA_WEB_BUILD_MODE=production ./reset.sh --name home --base-port 8200
source .animama-stack.env
docker compose -p "$COMPOSE_PROJECT_NAME" restart animama-server
```

Acquisition is the networked setup step. The subsequent verification, startup and
restart reuse local bytes offline. Docker images/dependencies must also already
be available for a fully offline rebuild; model reuse alone does not cache those.
Container replacement preserves the external model directory and database volume.

`reset.sh` checks the model set before changing the selected stack and writes
`ANIMAMA_MODEL_ROOT` plus derived `ANIMAMA_PARAKEET_MODEL_DIR` into the stack record.
Source that record before project-scoped Compose commands. For a direct Compose
configuration check without a stack record, derive the path first:

```bash
export ANIMAMA_PARAKEET_MODEL_DIR="$(python3 scripts/models/parakeet.py path)"
export ANIMAMA_BROWSER_MODEL_DIR="$(python3 scripts/models/browser_speech.py path)"
docker compose -f docker-compose.yml config --quiet
docker compose -f docker-compose.yml -f docker-compose.development.yml config --quiet
```

Both modes use read-only bind mounts that refuse to create a missing host path.
Development Vite and built FastAPI preserve `/__client-parakeet-models` and local
inference; the browser never downloads from Hugging Face. Keep the application
loopback/private-service boundaries unchanged. Acquiring bytes does not repair
unrelated missing starter animation assets.

Direct host Vite resolves the same store offline at startup. Production frontend builds verify and copy the browser speech assets into `dist`;
Parakeet remains a separate runtime/pack input. Unit checks that do not build or
start an application need no model acquisition. Desktop pack production verifies the set separately; installed desktop
uses its existing app-owned pack downloader and does not depend on this cache.
See [desktop runtime staging](../../frontend/desktop/runtime-staging.md).

## Recovery and deliberate cleanup

For a network error or throttling, retry explicit acquisition when access returns.
For insufficient space, free space you own or choose another store root. Do not
disable integrity checks, substitute a moving branch or change model versions
to make setup pass. Offline mode fails clearly if complete verified bytes are absent.

A corrupt existing version is not overwritten under running consumers. Identify
and stop consumers of that exact directory, preserve any evidence you need, and
move that version aside before reacquiring. Other valid versions stay intact.
Never edit a verified set in place. Re-run verification before restarting consumers.

Inspect model paths in active stack records/mounts and desktop producer jobs before
removing unused versions. Cleanup is explicit; the application does not evict model versions. OS cache eviction may require reacquisition for development;
self-host operators needing durable availability should choose persistent storage.
Installed desktop packs remain separately owned under Application Support.

## Downloaded model assets

The backend's shared downloader installs individual pinned files on demand
through [`/v1/model-assets`](../architecture/http-api.md#model-assets). It is
the same FastAPI code on desktop and self-host, and it needs no restart.

- Only files in the release's packaged catalog
  (`src/backend/animama/resources/model-assets.v1.json`) are fetched, over
  HTTPS from `downloads.animama.ai` on the default port, without following
  redirects or accepting compressed transfer encodings.
- Each file is streamed to `<data_root>/staging/model-assets/`, checked for its
  exact size and SHA-256, then renamed into
  `<data_root>/internal/model-assets/<asset_id>/<sha256>`. A failed or
  cancelled download leaves nothing installed; staging is cleared at startup.
- `<data_root>` is `ANIMAMA_DATA_ROOT`: `<userData>/data` on desktop and
  `/var/lib/animama/data` in Compose (the `ANIMAMA_DATA_HOST_PATH` bind
  mount), so installs persist with that data. There is no quota; an install
  starts only with its size plus 64 MiB free on that filesystem.
- `scripts/backup-local.sh` and restore rollbacks omit installed and staged
  model assets. After a restore they report not installed; download them again
  in the app.

Each catalog URL names an object published once under
`https://downloads.animama.ai/models/<model-id>/<file-sha256>/<file-name>`,
with the entry's `size` and `sha256` copied from the model's tracked manifest.
Tests bind the entry to that manifest, and the
[model publish command](../../frontend/desktop/releases.md#model-objects)
refuses to publish a set whose objects do not match the catalog. Publish the
object before a release ships its catalog entry; until then an install fails
as `asset_download_failed`.

Use the downloader for restart-free data files the running app can pick up,
such as optional voices. Large bundles that need a service switch, such as the
desktop Parakeet feature packs, stay in Electron's pack manager.

To force a reinstall, delete `<data_root>/internal/model-assets/<asset_id>/`
and install again. Never edit an installed file in place.

## Optional Parakeet WebGPU encoder

The experimental "GPU-accelerated offline speech (WebGPU)" setting uses an
optional FP16 encoder set (about 1.24 GB), stored under
`parakeet-tdt-0.6b-v2-webgpu/<manifest-digest>/` in the same root.

- It pairs with the base Parakeet decoder, preprocessor and vocabulary, which
  are still required.
- Desktop delivers it as the separate `parakeet-stt-webgpu` pack, not in the
  `parakeet-stt` pack inventory, so release staging needs this set too.

Acquire it only when you want to test WebGPU speech:

```bash
python3 scripts/models/parakeet_webgpu.py acquire
python3 scripts/models/parakeet_webgpu.py path
```

A change to the tracked `ATTRIBUTION.md` or `README.md` changes the manifest
digest, so an older store directory no longer resolves. Reuse its encoder
without downloading again by copying the current notices and the old
`encoder-model.fp16.onnx` into one directory, then running
`python3 scripts/models/parakeet_webgpu.py acquire --offline --import-from DIRECTORY`.

`reset.sh` resolves it offline and records `ANIMAMA_PARAKEET_WEBGPU_MODEL_DIR`
when it exists. Missing the set never fails startup:

- Compose mounts the tracked notices directory instead, which contains no
  encoder;
- the setting then reports the GPU model as not installed;
- speech keeps using WASM.

Vite development stacks (including `desktop:dev`) and built self-host stacks
serve the operator-provided set at `/__client-parakeet-webgpu-models/`; the
built stack mounts it read-only into FastAPI's web root. Self-host never
downloads it: acquire it on the host and rerun `reset.sh` for a running stack.
Packaged desktop serves it only from the active `parakeet-stt-webgpu` pack at
`/onnx/models/parakeet-tdt-0.6b-v2-webgpu/`, and only beside an active
`parakeet-stt` pack. The browser probes the encoder with `HEAD`; a 404 means
not installed.

## Browser speech assets and dependency inputs

The thirteen reviewed Pocket TTS and Smart Turn files share the same model root,
under `browser-speech/<manifest-digest>/`. The Pocket files are:

- the `english_2026-04` ONNX bundle (INT8 flow LM; FP32 flow head, Mimi decoder,
  Mimi encoder and text conditioner), with its tokenizer, `bundle.json` and
  `bos_before_voice.npy`;
- four precomputed voice states: `eve` (default), `azelma`, `mary` and `jane`.

Their manifest preserves the exact upstream commits, hashes and per-file
licenses. All Pocket files are CC-BY-4.0 (the voices derive from VCTK
recordings), which permits commercial use with attribution; Kyutai's model-card
prohibited-use terms still apply. Acquisition grants no new usage rights.
Acquire them explicitly with `python3 scripts/models/browser_speech.py acquire`;
`verify` and `path` are offline. To reuse an older checkout:

```bash
python3 scripts/models/browser_speech.py acquire --offline \
  --import-from /absolute/old-checkout/src/frontend/web/public/onnx
```

`models/browser-runtime/manifest.json` binds all 24 browser assets, including nine
ORT 1.24.2 files from the exact `onnxruntime-web-assets` dependency alias and two
VAD 0.0.30 files from the existing pinned dependency. Existing ORT imports retain
their separately locked versions. Do not replace a public runtime variant merely
because one browser does not load it. Package managers supply dependency assets;
the browser only requests the existing same-origin paths.

Reset verifies both model sets offline before mutations. Development mounts the
browser store read-only and resolves dependency files inside its own Node
installation. Built self-host uses the verified directory as the `browser_models`
BuildKit additional context, mounted read-only during the web build. Built outputs
contain all 24 verified assets and work without that developer store at runtime.
Installed desktop likewise retains its own required distribution copies. No host
pnpm or uv installation is needed for a Compose-only journey; Python setup and
Docker perform that journey. Direct `docker build` of the built application must
pass `--build-context browser_models="$(python3 scripts/models/browser_speech.py path)"`.

The derived `ANIMAMA_BROWSER_MODEL_DIR` is recorded for Compose follow-up commands;
use `ANIMAMA_MODEL_ROOT` to select host storage. Builds and serving never acquire
models implicitly. Different manifest revisions occupy distinct directories and
are resolved once for each serving process; keep old versions while consumers
still use them.

Legacy stack records can still render Compose for `ps`, `down`, backup and restore
without the new browser cache. Without a recorded browser path, Compose's inert
fallback points at the tracked manifest directory; it is sufficient for management
only. Starting/building the new frontend against that directory fails verification.
Use `reset.sh` after explicit acquisition to record the verified model directory
before starting the updated stack. No empty model directory is created implicitly.
