# Immutable public package sets

Build from a full exact commit and a clean, hydrated checkout. The producer
copies only tracked bytes into a temporary source directory, verifies them
against Git blobs/LFS hashes, and installs frozen build dependencies there.
Ignored installation state, `.env`, dependency directories and private sibling
source are excluded. Tracked links are rejected, except in-checkout links under
`.claude/` (contributor agent configuration): their committed targets are bound
into the snapshot hash but not materialized. The public producer has no R2
client or Cloud credentials.

From the Animama root, using the Python environment installed by `uv sync`:

    uv run --no-sync python scripts/package-sets/build.py build \
      --source /path/to/animama --commit <full-40-character-commit> \
      --output /tmp/package-set
    uv run --no-sync python scripts/package-sets/build.py validate \
      /tmp/package-set --work-dir /tmp/independent-consumers
    uv run --no-sync python scripts/package-sets/build.py compare \
      /tmp/previous-package-set /tmp/package-set

`--output` and consumer directories must be new paths outside the checkout.
Format 2 emits one Python wheel, three npm tarballs, an offline local OpenAPI
schema, the neutral RuntimeOwner JSON Schema and a complete hosted application
archive with its non-static Included seed. Contract versions come from
`contracts/versions.json` in the exact source snapshot.

The canonical `manifest.json` records the full source commit/tree, copied source
hash, source timestamp, frozen dependency-lock hashes, tool versions, producer
recipe hashes, package identities, contract versions and each file's SHA-256.
`SOURCE_DATE_EPOCH` fixes timestamp inputs. The build-backend transitive versions
are constrained in `build-constraints.txt`. The producer recipe is fingerprinted
separately when current reviewed tooling packages an older commit. Content
identity deliberately distinguishes different build bytes from the same commit;
no universal cross-platform byte-reproducibility claim is made.

The identity is `sets/v2/<commit>/<manifest-sha256>/`. Strict format 1 remains
supported for older sources and contains only its original six payloads; current
tooling never patches those sources into a whole application. `SHA256SUMS`
inventories every payload. The validation command installs packages in empty independent
Python/npm environments, runs real shared services with fake ports, mounts the
Anima/chat UI, then opens the actual emitted app in Chromium with an independent
cookie/CSRF HTTP authority. It resolves both real Included starters through the
installed wheel, opens creator/deep links and a real VRM, initializes the retained
Pocket engine, observes nonzero PCM and worklet playback, and verifies logout
cleanup. The browser cannot request source modules or Vite. The consumer records
cold/warm shell/avatar/voice timings, transfer, page heap and browser process RSS.
It emits `validation.json` bound to this manifest and the detailed consumer summary.
The receipt is test evidence, not a signature or an automatic publication grant.

The closed app archive, versioned URLs, MIME/cache/range policy, worker CSP and
non-static seed layout are specified in [the hosted contract](../../contracts/hosted-web.md#static-application-format-a5-producer--consumer-contract).
The verified baseline speech runtime is a required offline build input; set
`ANIMAMA_BROWSER_MODEL_DIR` to the existing directory returned by
`scripts/models/browser_speech.py path`. The producer never downloads runtime
models or substitutes missing files. Optional manifests/notices are shipped;
optional weights stay in separately provisioned exact catalogs and remain lazy.

Pass `validate --previous-app-set /tmp/previous-whole-app` to run actual
upgrade/rollback against a verified compatible clean format-2 predecessor.
Both sets must have distinct resource bytes/prefixes. Without that argument,
validation uses a labelled worker-comment byte-change fixture to exercise old-tab
late worker creation, new selection and rollback. Its receipt explicitly leaves
the two-exact-source revision gate unperformed. Format-1 compatibility, that
controlled fixture, local production comparison and physical heard-audio
acceptance are separate evidence; none is inferred from a version bump.

`validate --offline --pnpm-store /path/to/store` reuses cached dependency bytes
in copied isolated installs. It does not change the fresh-resolution consumer
semantics below.

Source builds use the committed frozen locks. Independent consumers intentionally
resolve fresh dependencies from package metadata; even `--offline` uses cached
available versions rather than the source locks. Consumer `summary.json` labels
this `fresh-resolution` and hashes the retained pnpm lock, full npm dependency
graph and Python name/version inventory under `logs/`. These files survive CI's
environment cleanup and are uploaded with test evidence, including on later test
failure. Python names/versions identify the tested installation; they do not
prove reproducible transitive wheel bytes or constitute a frozen consumer gate.

Full validation retains unpublished package outputs in GitHub Actions. Ordinary
successful logs and package archives expire after 3 days; explicit full requests,
including manual and reusable release validation, retain them for 14 days.
Failure diagnostics and compact validation receipts retain 14 days. Reduced
profiles do not produce package sets. No bucket, Cloud checkout, R2 credential
or desktop release is needed. A separate private maintainer workflow may select an exact successful
main-branch set for private durable storage after its own approval. Desktop
binaries and feature packs continue to use `animama-releases`.

To identify a CI output, record the successful run ID, artifact ID, full source
commit and SHA-256 of the canonical `manifest.json` inside
`animama-set-<commit>-<attempt>`. The Actions ZIP digest checks the downloaded
transport archive; the manifest digest identifies the package set inside it.
Retain both when recording a selection. The separate
`validation-evidence-<commit>-<attempt>` artifact contains detailed check and
consumer logs plus browser screenshots; it is not an installable package set.
`validation-receipt-<commit>-<attempt>` retains compact selection, aggregate and
check receipts for 14 days. Match the run and attempt across these artifacts;
local assertions and independently executed hosted checks remain distinct.

## Compatibility policy

Full validation compares package sets against the exact PR base, pre-push
commit, or dispatched commit parent selected by the workflow. The baseline is
built independently; an unavailable required baseline fails validation.
Contract versions must never decrease. Documentation-only JSON Schema/OpenAPI changes are compatible;
all structural changes conservatively require a new major contract version,
including additions not yet covered by a more precise compatibility rule.
Changing emitted TypeScript declarations requires a package version bump.
Existing package/type tests and isolated consumer fixtures remain required;
version bumps do not imply semantic compatibility on their own.

The consumer owns explicit supported schema bounds and must update its reviewed
support policy when admitting a new major. A shared change lands here first,
then an immutable package set is selected, then the private consumer updates
its lock and compatibility implementation. Never copy private source into this
repository or add `file:../animama-cloud`, symlinks, private imports or a sibling
package workspace. `scripts/check-repository-dependencies.py`, transitive Python
checks and package boundary/consumer tests enforce complementary parts of this
contract. They do not claim a complete static proof for arbitrary computed
imports or shell commands; independent CI is the runtime boundary.

## Local development override

`build --allow-dirty` snapshots tracked working bytes with a prominent warning,
records the dirty snapshot hash and uses a `dev/` identity. Untracked and ignored
files are never copied. The override is rejected in CI or when
`ANIMAMA_RELEASE_BUILD` is set. Dirty sets cannot be promoted or used by ordinary
Cloud CI. Build from a clean exact commit before an actual dependency update.

Run focused producer tests and source boundaries with:

    uv run --no-sync python -m unittest discover -s scripts/package-sets -p 'test_*.py'
    uv run --no-sync python scripts/check-repository-dependencies.py
    uv run --no-sync python scripts/repository-boundary/check-python-imports.py
