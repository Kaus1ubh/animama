# Shared Parakeet model setup

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
python3 scripts/models/parakeet.py verify
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
docker compose -f docker-compose.yml config --quiet
docker compose -f docker-compose.yml -f docker-compose.development.yml config --quiet
```

Both modes use read-only bind mounts that refuse to create a missing host path.
Development Vite and built FastAPI preserve `/__client-parakeet-models` and local
inference; the browser never downloads from Hugging Face. Keep the application
loopback/private-service boundaries unchanged. Acquiring bytes does not repair
unrelated missing starter animation assets.

Direct host Vite resolves the same store offline at startup. Build-only frontend
checks do not require model weights: models are supplied at runtime, outside the
web build. Desktop pack production verifies the set separately; installed desktop
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
removing unused versions. Cleanup is explicit: no automatic eviction, cache pruning
or seven-day deletion. OS cache eviction may require reacquisition for development;
self-host operators needing durable availability should choose persistent storage.
Installed desktop packs remain separately owned under Application Support.
