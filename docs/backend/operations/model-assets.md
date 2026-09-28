# Shared speech model setup

Development, Compose self-hosting and desktop pack production use the exact
Parakeet INT8 inputs recorded in
[`models/parakeet-tdt-0.6b-v2/manifest.json`](../../../models/parakeet-tdt-0.6b-v2/manifest.json).
The five upstream files are pinned to full Hugging Face commits, sizes and
SHA-256 digests. Animama's README and attribution complete the seven-file set.
Normal acquisition downloads the verified raw files and notices from Animama's
shared content-addressed model origin. No Cloud checkout, Hugging Face account
or API credential is needed. Before those objects are published, release
maintainers can explicitly use `parakeet.py acquire --source upstream`; missing
ordinary objects never trigger an upstream fallback.

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

`reset.sh` checks each model set before changing the selected stack and writes
`ANIMAMA_MODEL_ROOT` plus the derived `ANIMAMA_PARAKEET_MODEL_DIR` and
`ANIMAMA_BROWSER_MODEL_DIR` into the stack record. Every set is optional. An
unacquired set is recorded as empty and warns: Compose then mounts its checked-in
notices directory, missing Parakeet sets `ANIMAMA_PARAKEET_STT_ENABLED=false` so
dictation reports offline speech as not installed, and a missing browser speech
set builds/serves only the pinned package files, leaving Pocket TTS and Smart Turn
unavailable. A present set that fails verification stops the reset before any
mutation. Source the record before project-scoped Compose commands. For a direct
Compose configuration check with acquired models, derive the paths first:

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

Current catalog entries are the experimental Parakeet WebGPU encoder, offered in
built self-host settings, the 36 downloadable Pocket TTS voices
(`pocket-voice-<id>`, set `models/pocket-tts-voices`). The voices install on
desktop and self-host when a user picks one, explicitly downloads it, or a saved
voice is first needed. The separate `pocket-tts-voice-cloning-encoder` asset is
downloaded on an explicit cloning/download action. Ordinary playback and saved
clones do not need that encoder. Setup and Voice settings also expose download,
cancel, retry and removal without changing the selected provider or voice.

Use the downloader for restart-free data files the running app can pick up,
such as optional voices. Large bundles that need a service switch, such as the
desktop Parakeet feature packs, stay in Electron's pack manager.

Use the app's Remove action before reinstalling. Backend downloads restart from
the beginning after cancellation or service interruption; they do not share the
desktop pack manager's byte-range resume. Never edit an installed file in place.

## Optional Parakeet WebGPU encoder

The **Parakeet (WebGPU · Experimental)** provider choice under App Settings →
**Voice** → **Speech-to-Text** uses an optional FP16 encoder set (about 1.24 GB),
stored under
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
when it exists; only the development Compose selection mounts it. Missing the
set never fails startup:

- development Compose mounts the tracked notices directory instead, which
  contains no encoder;
- the setting then reports the GPU model as not installed;
- speech keeps using WASM.

Where each build gets it:

- **Vite development stacks** (including `desktop:dev`) serve this
  operator-provided set at `/__client-parakeet-webgpu-models/`. Acquire it on
  the host and rerun `reset.sh` for a running stack.
- **Built self-host** downloads it in the app (App Settings → Voice →
  Speech-to-Text) as the model asset
  `parakeet-tdt-0.6b-v2-webgpu-encoder`, from its published object under `models/` on `downloads.animama.ai`, into the
  data root (see [Downloaded model assets](#downloaded-model-assets)). The
  host model store is not used, and a host that cannot reach
  `downloads.animama.ai` cannot enable WebGPU.
- **Packaged desktop** serves it only from the active `parakeet-stt-webgpu`
  pack at `/onnx/models/parakeet-tdt-0.6b-v2-webgpu/`, and only beside an
  active `parakeet-stt` pack.

Controls appear independently of the selected provider when a WebGPU adapter is
available; desktop also requires an approved catalog entry and CPU speech first.
Retained files remain removable on unsupported devices. Downloading never selects
a provider or automatically downloads CPU speech. The browser probes the encoder
with `HEAD`; a 404 means not installed.

## Browser speech assets and dependency inputs

The ten reviewed Pocket TTS and Smart Turn core files share the same model root,
under `browser-speech/<manifest-digest>/`. The Pocket files are:

- the `english_2026-04` ONNX bundle (INT8 flow LM; FP32 flow head, Mimi decoder
  and text conditioner), with its tokenizer, `bundle.json` and
  `bos_before_voice.npy`;
- two Kyutai precomputed voice states, Eve (the default) and Azelma, pinned on
  Hugging Face.

The other 36 voices are not in this store. The app installs them on demand
through `/v1/model-assets` (the `pocket-voice-<id>` catalog entries), as
described under Downloaded model assets.

Mimi voice conditioning is also separate. `pocket_cloning.py acquire` prepares
the optional 39,768,446-byte encoder and its two notices for authoring/release
work. Ordinary builds need neither it nor the optional voice set. In the app,
first-use cloning offers a download and retains the selected recording in memory
until the verified encoder is available. Saving a named clone still persists its
original recording and encoded catalog; removing the encoder preserves both.

Their manifest preserves the exact upstream commits, hashes and per-file
licenses. `browser_speech.py` allows the release host only for entries with a
`release` source, bound to the exact `<sha256>/<voice>.safetensors` URL.
All Pocket files are CC-BY-4.0, which permits commercial use with attribution;
`pocket-tts-attribution.txt` names each voice's source recording. Kyutai's
model-card prohibited-use terms still apply. Acquisition grants no new usage
rights.
Acquire them explicitly with `python3 scripts/models/browser_speech.py acquire`;
`verify` and `path` are offline. To reuse an older checkout:

```bash
python3 scripts/models/browser_speech.py acquire --offline \
  --import-from /absolute/old-checkout/src/frontend/web/public/onnx
```

`models/browser-runtime/manifest.json` binds all 21 browser assets, including nine
ORT 1.24.2 files from the exact `onnxruntime-web-assets` dependency alias and two
VAD 0.0.30 files from the existing pinned dependency. Existing ORT imports retain
their separately locked versions. Do not replace a public runtime variant merely
because one browser does not load it. Package managers supply dependency assets;
the browser only requests the existing same-origin paths.

Reset verifies both model sets offline before mutations. Development mounts the
browser store read-only and resolves dependency files inside its own Node
installation. Built self-host uses the verified directory as the `browser_models`
BuildKit additional context, mounted read-only during the web build. Built outputs
contain all 21 verified assets and work without that developer store at runtime.
Installed desktop likewise retains its own required distribution copies. No host
pnpm or uv installation is needed for a Compose-only journey; Python setup and
Docker perform that journey. Direct `docker build` of the built application must
pass `--build-context browser_models="$(python3 scripts/models/browser_speech.py path)"`.

The derived `ANIMAMA_BROWSER_MODEL_DIR` is recorded for Compose follow-up commands;
use `ANIMAMA_MODEL_ROOT` to select host storage. Builds and serving never acquire
models implicitly. Different manifest revisions occupy distinct directories and
are resolved once for each serving process; keep old versions while consumers
still use them.

Without a recorded browser path, Compose's fallback points at the tracked manifest
directory. Web development and production builds then serve only the pinned
package files; the embedded desktop build and `pnpm verify:tts-assets` still
require the full set. Rerun `reset.sh` after acquisition to record the verified
model directory and rebuild. No empty model directory is created implicitly.

### Changing the Pocket voice set

`scripts/voices/voices.py` curates, encodes and releases voices from pinned
sources. Prepare the verified browser core and optional cloning inputs first.
Run encoding with `uv run --locked --script scripts/voices/voices.py <command>`,
which uses its own locked environment. For reproducing the current release rather
than curating new voices, use the
[release bootstrap](../../../scripts/models/README.md#release-only-bootstrap).

1. `pin`, then `fetch`: record and download the pinned candidates.
2. `encode --check`: confirm the encoder still reproduces Kyutai's VCTK states.
3. `encode`, `screen`, `listen`: encode, score and review candidates.
4. Edit `scripts/voices/selection.json` with the chosen voices.
   Each voice is `core` (shipped) or `download` (installed on demand).
5. `release --model-inputs /absolute/verified/browser-core`: regenerate every derived file:
   - the browser speech manifest (core voices);
   - the hosted set `models/pocket-tts-voices/`: every downloadable state,
     `ATTRIBUTION.md` and `README.md`;
   - the `pocket-voice-*` entries in the packaged asset catalog;
   - the app's `voice-catalog.ts`, the attribution notice and the licence
     records;
   - offline import directories for both stores.

   Import both stores with the printed `acquire --offline --import-from`
   commands to test locally before publication.
6. Publish the hosted set with the model publication flow:
   - `pnpm --filter animama-desktop models:stage -- --model pocket-tts-voices`;
   - `release:scan`, then `models:publish --dry-run`, then
     `--confirm-publication`.

   Objects under `models/` are create-only and locked, so a changed state
   gets a new hash path; nothing is overwritten.

Publish before shipping a catalog that references new objects. The desktop
release publisher can publish missing model objects before app artifacts;
standalone model publication remains available. Until publication, ordinary
acquisition and app downloads fail. A changed encoded-state hash fails `encode`;
`--rehash` is a separate intentional review action, never a release bootstrap fix.
