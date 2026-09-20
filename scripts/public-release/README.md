# Prepare a clean source review candidate

The working repository remains proprietary. These tools prepare a separate,
unpublished copy with the proposed AGPL-3.0-only license for project-owned code.
They preserve third-party terms and never publish, create a remote, initialize
Git history, upload an LFS object, or change the working source license.
Using this review tool does not select the final repository or Git-history
publication approach; that decision belongs to final source review.

Use Python 3.11 or newer from the repository root. First review the tracked paths
reported by `git ls-files`, hydrate required LFS files, and update
`licenses/source-review.json`. The source review must cover every tracked input;
its prepared dispositions are not publication approval. Missing assets, stale
hashes or unexplained source changes must be resolved rather than bypassed.

Choose new paths outside the checkout for each run:

```bash
python3 scripts/public-release/prepare_source.py inventory \
  --source "$PWD" --out /private/tmp/animama-source-inputs.json
python3 scripts/public-release/prepare_source.py prepare \
  --source "$PWD" --inventory /private/tmp/animama-source-inputs.json \
  --out /private/tmp/animama-source-candidate \
  --receipt /private/tmp/animama-source-receipt.json
python3 scripts/public-release/prepare_source.py verify \
  --candidate /private/tmp/animama-source-candidate \
  --receipt /private/tmp/animama-source-receipt.json
```

Inspect the frozen input manifest before preparing. The manifest binds current
tracked working bytes, executable modes and the base Git revision; it can
represent reviewed uncommitted work. Stage new files intended for the candidate
before freezing the inventory. Adding or removing tracked paths, or changing
their working bytes, invalidates the frozen inventory. It does not include untracked
files, ignored animation/skill copies, dependencies, personal state or private
planning. Reviewed repository-owned specs and ExecPlans are included when
tracked and covered by the per-file source review; their directory
name does not establish privacy or publication approval. Historical private plans
are not migrated by this tool. Tracked private state is rejected by the path
checks; tracking a file does not establish that its contents are safe to publish.
Missing, duplicate or stale license-review entries block candidate preparation.
Changed source requires a new inventory. Destination and receipt paths
must be absent, disjoint and outside the source checkout. Retrying never replaces
an existing candidate or receipt.

Candidate-only transformations replace the root license with the complete SPDX
AGPL-3.0-only text, update original package/license metadata and add contribution
and readiness documents. Existing third-party licenses remain intact. The
per-file source review records exceptions including PocketTTS noncommercial
assets; the project code license does not turn those assets into unrestricted
open-source content. The external receipt records
every output hash/mode and the transformed paths. Verification rejects extra or
changed files and any Git metadata; run independent builds in a separate copy.

The canonical AGPL text template was retrieved from
[SPDX license-list-data](https://github.com/spdx/license-list-data/blob/main/text/AGPL-3.0-only.txt).
It is a license document, not a license change to the working repository.

## Remaining release gates

The result is explicitly `preparation-only-not-release-approved`. Further
codebase refinement, owner review of terms and the exact final source, Mixamo
conversion/setup, a monitored private security-reporting route, independent
builds, secret/license scans and native acceptance remain required. A fresh
candidate currently lacks user-supplied animations; see
[manual acquisition](../../docs/frontend/runtime/mixamo-acquisition.md).
A source change invalidates an existing candidate for release purposes. Final
review must bind verification to the exact selected source and, if retained
publicly, its Git history and LFS objects. Publication and signed binary distribution require
separate approval.

Tool tests use disposable fixtures without starting Animama or acquiring assets:

```bash
python3 -m unittest discover -s scripts/public-release -p 'test_*.py'
```
