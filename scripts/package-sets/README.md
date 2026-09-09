# Immutable public package sets

Build from a full exact commit and a clean, hydrated checkout. The producer
copies only tracked bytes into a temporary source directory, verifies them
against Git blobs/LFS hashes, and installs frozen build dependencies there.
Ignored installation state, `.env`, dependency directories and private sibling
source are excluded. The public producer has no R2 client or Cloud credentials.

From the Animama root, using the Python environment installed by `uv sync`:

    uv run --no-sync python scripts/package-sets/build.py build \
      --source /path/to/animama --commit <full-40-character-commit> \
      --output /tmp/package-set
    uv run --no-sync python scripts/package-sets/build.py validate \
      /tmp/package-set --work-dir /tmp/independent-consumers
    uv run --no-sync python scripts/package-sets/build.py compare \
      /tmp/previous-package-set /tmp/package-set

`--output` and consumer directories must be new paths outside the checkout.
The build emits one Python wheel, three npm tarballs, an offline local OpenAPI
schema and the neutral RuntimeOwner JSON Schema. Contract versions come from
`contracts/versions.json` in the exact source snapshot. Schema descriptions are
documentation; they confer no authentication or hosted implementation.

The canonical `manifest.json` records the full source commit/tree, copied source
hash, source timestamp, frozen dependency-lock hashes, tool versions, producer
recipe hashes, package identities, contract versions and each file's SHA-256.
`SOURCE_DATE_EPOCH` fixes timestamp inputs. The build-backend transitive versions
are constrained in `build-constraints.txt`. The producer recipe is fingerprinted
separately when current reviewed tooling packages an older commit. Content
identity deliberately distinguishes different build bytes from the same commit;
no universal cross-platform byte-reproducibility claim is made.

The identity is `sets/v1/<commit>/<manifest-sha256>/`. `SHA256SUMS` inventories
all six payloads. The validation command installs packages in empty independent
Python/npm environments, runs real shared services with fake ports, mounts the
Anima/chat UI in Chromium, and emits `validation.json` bound to this manifest.
The receipt is test evidence, not a signature or an automatic publication grant.

PR/main CI retains these unpublished outputs and focused evidence in GitHub
Actions for 14 days. No bucket, Cloud checkout, R2 credential or desktop release
is needed. A separate private maintainer workflow may select an exact successful
main-branch set for private durable storage after its own approval. Desktop
binaries and feature packs continue to use `animama-releases`.

To identify a CI output, record the successful run ID, artifact ID, full source
commit and manifest SHA-256 from the artifact name. The Actions ZIP digest
checks the downloaded transport archive; the manifest digest identifies the
package set inside it. Retain both when recording a selection. The separate
`portable-evidence-<commit>-<attempt>` artifact contains consumer logs and browser
screenshots and is not an installable package set.

## Compatibility policy

The workflow compares package sets against the PR base, pre-push commit, or
dispatched commit parent. A base that
predates this policy is the initial adoption baseline. Contract versions must
never decrease. Documentation-only JSON Schema/OpenAPI changes are compatible;
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
Private maintainers have an artifact-based sibling rehearsal helper; it never
creates editable public installs or source links. Public-only contributors need
none of that private tooling. Keep Git mutations scoped to this root.

Run focused producer tests and source boundaries with:

    uv run --no-sync python -m unittest discover -s scripts/package-sets -p 'test_*.py'
    uv run --no-sync python scripts/check-repository-dependencies.py
    uv run --no-sync python scripts/repository-boundary/check-python-imports.py
