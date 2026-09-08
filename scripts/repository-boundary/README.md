# Repository boundary tools

These tools implement the inventory and executable package boundaries in the
[repository boundary contract](../../docs/architecture/repository-boundaries.md).
The inventory tools classify the current Git index and verify per-file
provenance against the materialized working tree. The exporter separately reads
immutable committed inputs into new local candidate directories. These tools do
not administer remotes, move the source checkout or approve publication. Python
3.11+ and Git are required. The inventory checker needs no third-party Python
packages or Git LFS executable; artifact checks use the build and browser
dependencies described below.

Run from the repository root with an appropriate Python environment:

```bash
uv run --no-sync python scripts/repository-boundary/audit-classification.py --check
git ls-files -z | uv run --no-sync python scripts/repository-boundary/audit-classification.py --stdin --check
uv run --no-sync python scripts/repository-boundary/build-provenance.py --check
uv run --no-sync python -m unittest discover -s scripts/repository-boundary -p 'test_*.py' -v
```

`--root PATH` supports a separate checkout. `--manifest PATH` selects another
manifest relative to that checkout. Both audit forms perform identical checks;
the piped list must equal the complete index. NUL delimiting preserves spaces,
tabs and newlines. Tracked files that match ignore rules are always included.
`--check` is explicit documentation of read-only behavior and is also the
default. No audit mode modifies the index or files.

## Classification manifest

Root `repository-boundary.toml` uses schema version 1:

```toml
schema_version = 1
source_commit = "<full reviewed baseline commit object ID>"
provenance_manifest = "docs/architecture/repository-provenance.json"

[[groups]]
id = "local-build-inputs"
owner = "public"
rationale = "Local product build inputs, maintained in animama."
paths = ["src/frontend/package.json"]
```

Every tracked path must occur exactly once. `owner` is one of `public`, `cloud`,
`archive`, or `excluded-generated`. Paths are exact file names, with no glob
expansion or default group. Group names and rationales help humans review the
decisions; they never infer ownership. A newly tracked path fails until its
disposition is explicitly recorded. Duplicate paths, missing paths, stale
records after removal, invalid paths, and unmerged index stages fail.

All full ExecPlans under a `plans/` directory and root `PLANS.md` must be
`cloud`-owned. The checker enforces this independently of group names, including
plans describing local functionality. Durable architecture, public contracts and
operational references remain in `animama`; they must not require private plan
files after export.

`public` means the intended `animama` destination. Publication rights are an
independent decision. Both destination repositories remain private while those
rights or the source license are undecided. `source_commit` identifies the
reviewed starting point, not a promise that the working tree equals that
commit. The current index is the complete set being audited, so reviewed new
artifacts can be validated before their commit exists.

## Per-file provenance

`repository-provenance.json` has `schema_version`, matching `source_commit`,
an `evidence` array, and a `files` array. Each file record contains:

- `path`, `git_blob_oid`, and materialized `sha256`.
- `lfs_oid` and `lfs_size` exactly when its index blob is an LFS pointer.
- Nonempty `evidence_ids` pointing to evidence groups.
- `publication_status`: `review-pending`, `blocked`, or `approved`.

Each evidence group has an `id`, `source`, `revision`, `license`,
`unresolved_decision`, `required_notices`, and `path_sha256`. The last field maps
tracked evidence input paths to their SHA-256 hashes. Unknown facts are recorded
explicitly rather than guessed. Notes and descriptive extra metadata may be
added without changing the checker schema. A required notice description is a
review obligation; it is not proof that the notice has already been supplied.

Coverage is selected independently of those records by
`required_provenance_paths` in the checker. It includes all `content/`, browser
public assets, Parakeet model files, vendored agent skills, backend examples,
observability configurations, known vendored Pocket TTS code, common media,
font/model/archive extensions anywhere, and **every LFS pointer path**. Cached
LFS attributes are also checked so an LFS-marked file with a missing pointer
cannot silently fall outside coverage. Add new vendor trees to this selector
when introduced. Additional explicit file records are permitted for tracked
inputs needing review beyond the selector.

The checker validates evidence hashes, Git blob identities, payload SHA-256,
and LFS OID/size against actual bytes. An unhydrated pointer, missing file, or
modified payload fails. Non-LFS asset bytes must match the index blob exactly;
use a checkout with consistent Git line-ending normalization. Symlink or
submodule provenance inputs need a deliberate supported audit representation
before they can pass; the checker does not follow them as ordinary assets.
Asset and supporting-evidence index blobs must also match `source_commit`;
replacing their bytes requires an explicitly reviewed baseline refresh.

Run `build-provenance.py --check` to verify that the checked-in inventory agrees
with its documented source groups and current payloads. Regenerate using the
builder only after reviewing changes to those inputs; generation is not a
rights approval. Review its resulting diff, any new `UNKNOWN` evidence, and
the ownership classification independently. The builder keeps the existing
baseline pin unless explicitly changed.

## Updating an inventory under review

1. Review added, modified and removed paths and update the exact ownership
   lists. Do not auto-classify newly discovered files into a broad catchall.
2. Review provenance sources and notices, hydrate required LFS payloads, and
   regenerate the per-file inventory. Keep unresolved rights explicit.
3. Run the audit against the intended index, review the diff, then run tests
   and `git diff --check`.

For new artifacts that have not been staged, a strict audit against the real
index correctly reports their manifest entries as stale. During agent review,
use a disposable Git index via `GIT_INDEX_FILE`: initialize it from the reviewed
commit with `git read-tree`, add only the explicitly reviewed artifact paths
to that disposable index, and run the builder and audit with that same
environment. Keep the user's real index untouched. Remove the disposable index
afterward. This workflow validates intended additions without introducing a
permissive `--include-untracked` audit mode. After the user stages the reviewed
change, the normal commands above validate the real index directly.

A passing audit proves classification and recorded-input consistency. It does
not substitute for the Phase 1 ownership review, Phase 3 secret/license scans,
or later publication approval.


## Candidate scanner pins

[scanner-pins.json](scanner-pins.json) records the official Gitleaks and
ScanCode release versions, exact archive digests, supported runner choice,
command shapes and the limited Phase 1 verification performed. Verify the
selected download digest and executable version before use. Require a synthetic
secret-detection canary and a known-license fixture before accepting empty
candidate reports. Scanner output and any remediation evidence belong in private
storage outside the source tree. Do not interpret a pin or a passing inventory
check as a completed candidate scan or a license grant.

## Shared import and artifact checks

`check-python-imports.py` statically follows every domain/application module,
including relative imports, package initializers and transitive helpers. A
dependency on local installation state, server construction, migrations,
gateway verification or private service modules fails. Local compositions may
depend on shared APIs; the reverse direction is forbidden.

`check-packed-artifacts.py` requires one built Python wheel and the three packed
npm packages (`runtime-contracts`, `product-ui`, `discover-client`). It validates
emitted exports and rejects workspace/source dependencies, then copies consumer
fixtures into a new directory outside the checkout. The frontend installs only
tarballs and declared registry dependencies, checks declarations, builds with
Vite and mounts two fake owners in Chromium. It exercises real Anima selection,
chat/session/SSE code, cancellation, stale event fencing, failed-POST retry
policy, emitted CSS and transport-supplied thumbnails. The backend installs the
wheel into a new virtual environment and exercises real bootstrap, Anima and
chat services with fake ports/model clients. Local-composition imports are
actively blocked and loaded modules must not resolve into the source checkout.

From the repository root:

```bash
uv run --no-sync python scripts/repository-boundary/check-python-imports.py
uv build --wheel --out-dir /private/tmp/animama-package-audit
pnpm --dir src/frontend packages:pack --destination /private/tmp/animama-package-audit
uv run --no-sync python scripts/repository-boundary/check-packed-artifacts.py /private/tmp/animama-package-audit
```

The artifact checker needs Node/pnpm, uv and Playwright's Chromium browser.
The frontend's normal `pnpm e2e:install` command installs that browser. Optional
`--offline` requires a populated dependency cache; `--pnpm-store PATH` selects a
content-addressed store whose package bytes are copied into the consumer, never
linked back to application source. `--work-dir PATH` chooses a new empty output
directory outside the checkout. The checker prints the evidence directory and
retains logs, the browser screenshot, installed dependency locks and a summary.
It never reads the maintainer's application `.env` or calls a model/service.

Build the wheel twice from unchanged inputs and compare SHA-256 digests to
verify reproducibility. These checks prove package composition and fixture
behavior; local setup/restart, voice/avatar and native desktop acceptance remain
separate checks of the actual product.

## Committed candidate export

`export.py` reads the selected commit's tree, classification, provenance and
templates. It never copies working-tree bytes. `--source-commit` requires a full
commit object ID; omitting it uses HEAD only when Git reports no tracked or
untracked changes. An explicit commit permits a dirty checkout without including
those changes. Source reads support an explicitly configured private
`GIT_OBJECT_DIRECTORY` and `GIT_ALTERNATE_OBJECT_DIRECTORIES` for an immutable
review commit; they ignore index/worktree redirection. Candidate Git checks clear
all those source overrides.
When the selected source includes these tools, their executing bytes must match
that commit too; a dirty exporter cannot claim outputs generated by an older
implementation.

Extend the existing ownership manifest, keeping its exact groups:

```toml
[export]
project_inventory = true
allowed_paths = [".env.example", "data/README.md", "content/local/README.md"]

[[export.mappings]]
source = "scripts/repository-boundary/templates/cloud/package.json"
target = "package.json"

[[export.mappings]]
source = "scripts/repository-boundary/templates/public/README.md"
target = "README.md"
replaces = "README.md"
```

Each mapped source inherits its reviewed owner. Unmapped active files retain
their relative path. A replacement must name a distinct source with the same
owner, suppresses that source's original output, and records both source blobs.
It cannot suppress a full private plan. Only mappings actually committed and
classified in the selected tree take effect. The optional exact `allowed_paths`
list admits reviewed documentation or authored build resources in otherwise
excluded locations; actual environment files, private-key files, databases and
logs cannot be exempted. The real manifest also lists the three retained desktop
`build/` resources individually. There is no general build-directory exception.

```bash
uv run --no-sync python scripts/repository-boundary/export.py \
  --source-commit <full-reviewed-commit> \
  --public-out /private/tmp/animama-split/animama-candidate \
  --cloud-out /private/tmp/animama-split/animama-cloud-candidate
uv run --no-sync python scripts/repository-boundary/verify-export.py \
  --manifest /private/tmp/animama-split/export-manifest.json \
  --public /private/tmp/animama-split/animama-candidate \
  --cloud /private/tmp/animama-split/animama-cloud-candidate
```

Outputs must be absent or empty, outside the source checkout and disjoint from
each other. Nonempty retries fail; choose fresh directories. The external
`export-manifest.json` and its `.sha256` sidecar bind every source disposition,
committed blob, output byte hash/mode, projection input and LFS object. Keep them
private: they include archived/private source paths. Each candidate receives a
small `SPLIT_PROVENANCE.md` with source and mapping hashes and no remote URL.
There are no timestamps or absolute host paths in generated export metadata.

Source symlinks/submodules, traversal, nonportable Windows names, case/Unicode
collisions, runtime state paths and synthetic secret/private-key canaries fail
before candidate materialization. Every LFS pointer needs the matching local
object-store payload, including pointers outside current LFS attributes; dirty
hydrated working-tree bytes are never a fallback. The exporter does not fetch
objects or substitute for the pinned Gitleaks/ScanCode and manual review gates.

## Standalone projected inventory

`project_inventory = true` replaces the public candidate's inventory and
provenance with deterministic public-only projections. They share explicit
`mode = "exported-snapshot"`, `snapshot_id`, `source_manifest_sha256` and the
informational source commit. Public paths and evidence are remapped; private
records disappear. An exported asset cannot lose all its public evidence.
Projected LFS targets must remain covered by committed Git LFS attributes;
unmarked or renamed-to-uncovered pointers require a reviewed source fix. This
keeps subsequent candidate indexing consistent with recorded pointer identities.

After initializing and adding the candidate's files to its new Git index, the
ordinary classification audit works without access to the original monorepo
commit. It still verifies the complete current index, blob identities, evidence
hashes, materialized SHA-256 values and LFS pointers/objects. Only the lookup of
the original commit is replaced by the explicit paired snapshot metadata.
`build-provenance.py --check` validates this projection; regeneration must happen
through reviewed source inputs and a new export.

## Separately generated artifact layer

The private candidate's upstream pinning helper generates its lock/artifacts
only after the public candidate revision and packed artifact hashes are known.
Its external layer manifest uses `kind = "generated-export-layer"`, an owner,
and `base_tree_sha256` from the base export. Every added/replaced file records
`path`, `sha256`, `size`, Git `mode`, and `operation`; replacements also require
the exact original `base_sha256`. Deletion and overlapping layers are rejected.

```bash
uv run --no-sync python scripts/repository-boundary/verify-export.py \
  --manifest /private/tmp/animama-split/export-manifest.json \
  --public /private/tmp/animama-split/animama-candidate \
  --cloud /private/tmp/animama-split/animama-cloud-candidate \
  --generated-layer /private/tmp/animama-split/cloud-generated-manifest.json
```

Verification requires the exact declared file set, bytes and executable modes.
Only genuine independent root `.git` metadata is permitted outside that set;
source history, Git alternates, symlinks and undeclared files/directories fail.
Verify before installing dependencies or building. Keep separate untouched
exports for repeated digest checks and scanner runs; test environments will
create `.venv`, `node_modules`, `dist`, logs and local state that deliberately
fail exact-tree verification. Bind test evidence to the candidate commit and
check its tracked diff/status after tests. There is no ignored-file bypass.

Exporter regressions use disposable real Git repositories:

```bash
uv run --no-sync python -m unittest discover -s scripts/repository-boundary -p 'test_export.py' -v
```
