# Repository cleanup analysis tools

`measure.py` records tracked working-tree inputs for the repeatable
[repository cleanup audit](../../docs/architecture/repository-cleanup.md). It does not
detect dead code or change application files. Python 3.10+, Git, and scc 4.0.0
are required; Python uses only the standard library.

## Tool pin and execution

Download the appropriate binary from the official
[scc v4.0.0 release](https://github.com/boyter/scc/releases/tag/v4.0.0) and verify
the archive against that release's `checksums.txt` before extracting it.
`measurement-rules.json` records the verified Darwin arm64 URL and SHA-256 used
for the initial baseline. Other platforms must verify their own release asset;
the Darwin archive hash does not apply to them. The wrapper rejects a different
scc version and records the actual executable's SHA-256.

From the repository root, set `SCC_BIN` to that verified executable and choose a
private output directory outside the checkout:

```bash
export SCC_BIN=/absolute/path/to/verified/scc
ANIMAMA_CLEANUP_REPORTS=$(mktemp -d /private/tmp/animama-cleanup.XXXXXX)
uv run python scripts/repository-cleanup/measure.py \
  --label before --output-dir "$ANIMAMA_CLEANUP_REPORTS"
```

`--scc /absolute/path/to/scc` overrides `SCC_BIN`. An existing repository virtual
environment can run `.venv/bin/python` directly when uv's cache is inaccessible;
record the actual command and environment. A future after measurement uses the
same rules, pinned binary and output directory with `--label after`. Do not
recreate the output-directory variable between those runs.

Each label is an exclusive directory. A failed or successful run is never
overwritten. Correct an input problem and use a new label, identifying which
baseline it supersedes. Preserve the private evidence in durable storage;
`/private/tmp` is a working location, not an archival guarantee.

## Scope and classification

The inventory comes from `git ls-files --stage -z`, not filesystem traversal.
Tracked files matching ignore rules remain included. The initial baseline
included the legacy `cloud/` tree, subsequently removed under approved R04-5;
the inventory policy is unchanged. Untracked files and ignored local data are not part of LOC; Git status
records visible untracked paths. During initial tool development this excludes
the new measurement scripts themselves. Every run separately preserves the
exact wrapper and rules, their hashes, HEAD, index entries, and working/index
patches. Files are measured from their current working-tree bytes, not assumed
to match HEAD. Per-file SHA-256 values identify the actual measured input.

`measurement-rules.json` defines ordered first-match categories and exclusion
rules. The six categories are authored source/tooling, tests/fixtures,
generated code, vendored code, documentation/configuration, and runtime assets.
Generated client/router files and the explicitly vendored PocketTTS internals
are separated; local Pocket integration wrappers and customized public TTS
workers remain authored. Catalog JSON, animation JSON and model files are
assets. Executable tool configuration is separate from authored application
code. These are measurement classifications, not provenance or licensing
decisions.

Do not exclude every directory named `build`: Electron's `desktop/build`
contains packaging inputs. The configured exclusions target dependency/cache
directories, specific generated output roots, and local data; guide files under
`content/local` and `data` remain included. Every tracked exclusion is recorded.

scc runs against explicit file lists with external/project configuration and
ignore discovery disabled. Pinned mappings handle root extensionless metadata
and Python-based PyInstaller `.spec` files. Unknown text formats are counted as
plain text under scc's `Unknown` language; check `by_language_category` before
interpreting such counts. No size cutoff, generated/minified filter, or
duplicate-file removal is enabled.

Assets and binary files receive file/byte counts without LOC. scc's built-in
lockfile exclusions are listed in the rules; those files likewise retain byte
counts with an explicit reason. In the initial baseline, `pnpm-lock.yaml` is the
only such file. LFS pointer text is detected and reported as incomplete coverage
with its declared payload size; it is never counted as hydrated model code.
Missing/unreadable tracked files, unsupported symlink/submodule entries, scanner
omissions, and source/HEAD/index changes during the scan fail the measurement
while preserving available evidence. Excluded local data is not opened.

## Outputs and interpretation

Each measurement contains `files.json`, `summary.json`, `summary.md`,
`metadata.json`, `tracked-index.z`, source patches, the exact wrapper/rules,
and raw `scc-*.json`/stderr batches. Raw records can expose private paths or
source; keep them out of future-public Git history and release artifacts.

`summary.json` provides category, language/category, subsystem/category, and
directory rollups. Subsystem groups are disjoint. Directory rollups include
descendants, so adding parent and child rows double-counts files. `code` means
scc nonblank/noncomment lines; docs/config text is not authored application
code, and bytes are materialized working-tree file bytes, not Git/LFS storage
usage. Use the authored category for the headline code count and report tests,
generated material, vendored material, and assets separately.

## Verification

```bash
SCC_BIN=/absolute/path/to/verified/scc .venv/bin/python -m unittest discover \
  -s scripts/repository-cleanup -p test_measure.py -v
.venv/bin/ruff check scripts/repository-cleanup
```

The integration tests create disposable Git repositories and exercise tracked
ignored files, untracked exclusions, category boundaries, empty files and
spaces, PyInstaller language mapping, byte-only assets/lockfiles, repeatable
totals, output overwrite/path protections, missing files, and unhydrated LFS
pointers. Tests skip if scc is absent; skipped tests do not establish validation.

See `docs/architecture/repository-cleanup.md` for the measured results,
validation baseline, and step 0.2 triage.

## Usage analysis (step 0.2)

Knip **6.34.0** is an exact frontend development dependency, and Vulture **2.16**
is an exact Python development dependency. Existing dependency versions and
frontend importer/snapshot resolutions were preserved when adding their locks.
Neither tool is a runtime dependency. These commands report findings and do not
remove code.

From `src/frontend`, after installing the locked workspace dependencies:

```bash
pnpm exec knip --reporter json
```

Capture stdout, stderr and exit status in a new private run directory. Exit 1
can mean findings; inspect diagnostics before calling the scan valid. The
initial valid scan has 969 findings and zero unresolved-import findings, but
debug output still identifies computed directory and asset references that
Knip cannot follow. Keep those coverage gaps with the report. `--debug` can
provide the workspace project/entry lists and these diagnostics for a separate
evidence run. Never use `--fix` as part of this analysis command.

`src/frontend/knip.json` defines the root tooling workspace plus web, server,
and desktop. Entry patterns are based on package commands, CI, runtime source,
and documented developer tools. Routes, workers/worklets, Vite aliases,
native/Compose FastAPI entrypoints, Electron main/preload and custom packaging
hooks are included. The Playwright plugin is disabled because its configuration
requires an intentional test environment; its config, setup, specs and helper
tests are rooted statically instead. This does not execute or validate the
quarantined browser journeys.

Generated client/router and precisely identified vendored files have selected
`ignoreIssues` report exemptions. They remain in dependency analysis; unresolved
imports and dependency diagnostics are not broadly suppressed. Default Knip
entry-export behavior remains in effect; an entrypoint's exported API is not
automatically a candidate. Project patterns do not establish liveness for
native C/C++, shell, Python, or asset payloads. String-built paths and external
consumers still need source/contract review.

From the repository root, with the locked Python development dependencies:

```bash
uv run --locked python scripts/repository-cleanup/scan-python.py \
  --output-dir /absolute/private/new-scan-directory
```

The initial audit used an isolated pinned tool environment to preserve the
existing application virtual environment:

```bash
uv run --no-project --with vulture==2.16 python \
  scripts/repository-cleanup/scan-python.py \
  --output-dir /absolute/private/new-scan-directory
```

The helper inventories tracked `.py` and Python-based `.spec` files, including
ignored Cloud paths, migrations, tests and scripts. It records exact hashes,
validates syntax, and checks HEAD/index/content stability. Untracked source is
excluded; the new helper and whitelist are explicitly preserved as analysis
configuration. It creates a new private directory and refuses to overwrite a
run. It parses source without importing application code. Exit **3** means
findings; exit **1** means input/stability errors. Read `summary.json` rather
than interpreting any nonzero exit as an analyzer failure.

Each Python run contains `scope.json`, raw and whitelisted JSON/text reports,
diagnostics, exact helper/whitelist copies, index evidence, timing and versions.
Both passes retain Vulture's built-in library whitelists. The custom
`vulture-whitelist.py` lists only seven source-verified runtime-context route
callbacks and Pydantic chat validators. Vulture uses names globally, so even a
qualified attribute reference can suppress another same-named symbol. Review
the raw-to-filtered difference and name collisions whenever changing this file.
The initial seven suppressions have no same-named raw-finding collisions.

The private candidate ledger retains every raw finding, including suppressed
callbacks, plus reviewed dynamic-use items. `candidate` means a source-reviewed
lead with additional consumer checks and validation prescribed for step 0.3;
`keep` records positive usage/compatibility evidence; `defer` records either an
unreviewed finding or an explicit scope/coverage question. No status is a blanket
permission to delete a file, public API, migration, test, or asset. Preserve
raw reports and review records privately; publish only the reviewed summary.
