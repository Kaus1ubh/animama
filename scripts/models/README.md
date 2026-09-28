# Verified Parakeet setup

Run from the Animama checkout with Python 3.11+ on macOS, Linux or native Windows.
On Windows, use `py -3` where these examples use `python3`. Setup uses only
Python's standard library and the public pinned Hugging Face files; no account,
API key or Hugging Face SDK is required.

```sh
python3 scripts/models/parakeet.py acquire
python3 scripts/models/parakeet.py verify
python3 scripts/models/parakeet.py path
```

`acquire` is the only operation that can download. `verify` and `path` always
verify the complete local inventory without network access. Each successful
command prints only the verified absolute model directory. Exit 2 means a store
or selected version has not been acquired; exit 1 means invalid configuration,
corrupt data or another setup failure. Desktop core-only tooling may distinguish
an absent default cache from invalid explicitly selected input.

The default store is `~/Library/Caches/Animama/models` on macOS and
`${XDG_CACHE_HOME:-$HOME/.cache}/animama/models` on Linux (including WSL), and
`%LOCALAPPDATA%\Animama\models` on native Windows. An absolute
`ANIMAMA_MODEL_ROOT` selects another store; `--root /absolute/store` overrides it.
Use persistent storage writable by your setup user for self-host installations:

```sh
python3 scripts/models/parakeet.py acquire --root /var/lib/animama/models
python3 scripts/models/parakeet.py path --root /var/lib/animama/models --offline
```

The resolved directory is `<store>/parakeet-tdt-0.6b-v2/<manifest-digest>`, where
the digest is SHA-256 of the exact checked-in manifest bytes. Seven required
files are size/hash verified, including Animama's preserved README and
attribution. Changes create separate version directories; worktrees sharing
this manifest reuse the same bytes. `--manifest PATH` selects a local reviewed
manifest or small build/test fixture; it never accepts arbitrary upstream URLs,
repositories, moving revisions or inventory paths.

To adopt an existing model copy without downloading:

```sh
python3 scripts/models/parakeet.py acquire --offline \
  --import-from /absolute/existing/parakeet-tdt-0.6b-v2
```

Import copies and verifies each required file; it leaves the original intact.
Only remove an old copy after its consumers use the verified store. Import and
fresh acquisition need enough free space for one complete new model set. A
successful fresh acquisition retains one set plus a small empty lock file; it
does not create an additional SDK download cache.

A per-version process lock serializes acquisition. Downloads stream with strict
size bounds into a private staging directory and are promoted together only
after every SHA-256 matches. An interrupted command safely restarts, without
publishing partial data. Normal exceptions remove its staging directory; a
killed process can leave a hidden `.partial-*` directory. Explicitly remove such
leftovers only after confirming no acquisition process still owns them.

Existing corrupt versions are reported and never overwritten automatically.
Stop stacks/applications using that version, quarantine or remove that exact
version directory, then run `acquire` again. Do not delete other versions or an
entire cache as a repair ritual. Store cleanup is explicit: inspect active
stack records and processes before removing unused versions. Files are made
read-only to discourage accidental edits, but the owning user can still alter
them; consumers verify before use.

Requests and redirects use HTTPS and a fixed reviewed Hugging Face host list.
The downloader sends no credentials and does not inherit environment proxies.
HTTP errors, including throttling, fail with instructions to retry later; no
automatic retries hide repeated failures. Interrupted/failed transfers restart
rather than attempting unvalidated byte-range resume. Serving and ordinary
startup never download or choose a different model version.

The installed desktop application continues using its own verified feature-pack
storage and distribution workflow. The developer store is a build/setup input,
not an installed application's persistent pack directory.

Native Windows model-store tests can be run with
`uv run --no-project --with pytest==8.4.2 python -m pytest --noconftest -o addopts= tests/test_model_store.py -q`.
This tests model tooling without installing the backend dependency graph.
The single hosted Validation job runs on Linux; native Windows execution is a
separate validation step and is not established by that job. Native Windows
application/packaging support remains separately gated.

## Optional WebGPU encoder

`python3 scripts/models/parakeet_webgpu.py acquire|verify|path` manages the
optional FP16 encoder used by the experimental WebGPU speech setting. It uses the
same store, options and exit codes as `parakeet.py`. It downloads about 1.24 GB
from the pinned `ysdede/parakeet-tdt-0.6b-v2-onnx` revision and verifies a
three-file inventory (encoder, README and attribution) under
`<store>/parakeet-tdt-0.6b-v2-webgpu/<manifest-digest>`. The base Parakeet set
remains required.
