# Ship the landing site in the package set (format 3)

Source agreement: raymond-van/animama#668 (the issue is the spec) and the
owner's task instruction of 2026-10-22.
Authorized scope: Phases 1–2 and the PR. Merge, hosted validation, publishing a
set and the Cloud adoption (raymond-van/animama-cloud#182) keep their separate
approvals.

## Purpose and context

Animama Cloud consumes Animama only through the pinned, checksummed package set
(`scripts/package-sets/`). The landing page's production build
(`pnpm -s landing:build` in `src/frontend/web`, merged in #661) writes a local
folder only, so Cloud has nothing to pin. Format 3 adds the built site as one
verified payload beside the hosted application.

Starting source: `main` at `1f3d6934` (the #661 merge), branch
`build/landing-package-set`. The task was first stacked on `feat/landing-stage`;
#661 merged before any work was committed, so the branch starts from `main` and
the PR targets `main`.

Relevant code:

- `package_set.py` `verify` accepts formats 1 and 2 and closes the manifest,
  `SHA256SUMS` and the directory inventory; `compare` enforces version policy.
- `application.py` holds the bounded, closed regular-file tar reader
  (`closed_tar`, `inspect_archive`) and size limits, hard-wired to the
  `animama-hosted-web/` root.
- `build.py` snapshots exact tracked bytes, builds in the snapshot with frozen
  installs and `SOURCE_DATE_EPOCH`, packs a deterministic gzip/PAX tar and
  fingerprints its own recipe files.
- `scripts/repository-boundary/check-packed-artifacts.py` accepts only a
  format-2 `--previous-app-set`.
- Cloud mirrors the verifier in its own repository (out of scope here); the
  README and `contracts/hosted-web.md` are the public statement of the format.

## Progress

- [x] Phase 1: format-3 verifier, producer, `compare` and tests (`build(package-sets)[p1]`).
- [x] Phase 2: documentation (`build(package-sets)[p2]`).
- [x] Code Review #1 and repair (`build(package-sets)[p1]: address review #1`).
- [x] Code Review #2 (repair recheck): pass.
- [ ] Full pre-push suite, PR.

## Surprises & Discoveries

- 2026-10-22: #661 merged while the task was being set up; the branch was moved
  to `main` before any commit.
- 2026-10-22: a real build of the landing page has 289 files (26 MB): `.js`,
  `.webp`, `.png`, `.json` (including `.clip.json`), `.css`, `.woff2`, `.woff`,
  `.txt`, `.vrm`, `.ico`, `.html`, `.jpg`, `.xml` and `_headers`. Every file
  under `assets/` has a content-hashed name or sits in a content-hashed folder.
  None of its text files contains a local path marker or stage-server route.
- A module named `site.py` would shadow Python's `site` module, so the verifier
  lives in `landing_site.py`.

## Decision Log

- 2026-10-22, agent (within the issue's approach): format 3 is format 2 plus a
  required `sites` list of exactly one `animama-landing` record; a set with a
  site also carries the application. Identity `sets/v3/…`.
- 2026-10-22, agent: `site-manifest.json` version 1 is closed and canonical:
  `schema_version`, `site`, `site_version`, `source_commit`, `source_tree`,
  `entry_document` (`index.html`), `headers_sha256` and `files`
  (`path`, `sha256`, `size`, `mime_type`, `cache`). It does not list itself.
- 2026-10-22, agent: the cache class is `immutable` exactly for paths under
  `assets/` and `revalidate` otherwise, matching the site's own `_headers`.
- 2026-10-22, agent: MIME types reuse the application table plus `.xml`
  (`application/xml`), `.vrm` (`model/gltf-binary`) and `_headers`
  (`text/plain; charset=utf-8`); any other type is rejected.
- 2026-10-22, agent: local paths are detected by one fixed pattern
  (`landing_site.LOCAL_PATH`, quoted verbatim in `contracts/hosted-web.md` and
  tested against it) because the verifier cannot know the producer's paths: a
  `file:` URL, Unix root folders and Windows user folders, with plain or
  JSON-escaped separators. Revised after review R1-F1/F3. The producer's own
  check still rejects its exact checkout and home paths.
- 2026-10-22, agent (review R1-F4): the verifier requires the site record's
  `file` to be `animama-landing-<version>.tar.gz`. It does not require the site
  version to equal the application version: the producer reads both from
  `src/frontend/desktop/package.json`, and an independent site version keeps
  `compare`'s site-rollback rule meaningful.
- 2026-10-22, agent: `validate` and its receipt are unchanged. The site's CSP
  and journeys are outside `validate` (issue exclusion); `verify` already runs
  the site verifier during `validate`'s first step.
- 2026-10-22, owner instruction: one review scope (initial review plus at most
  two repair rounds) over both phases, and one full pre-push run on the final
  candidate.

## Phased implementation

### Phase 1: Format-3 verifier and producer

Review tier: high risk (release package format, cross-repository contract).

- Parameterize `application.py`'s tar reader by archive root, manifest name and
  text predicate; the application keeps its behavior.
- Add `landing_site.py` with `verify_site(path, source, version, source_tree=)`
  that reuses `inspect_archive` and the application size limits, requires
  `index.html`, `_headers`, `notices.txt` and `robots.txt`, and rejects `.map`
  files, links/special files, local paths and stage-server routes
  (`/__preview/media/`, `/__stage/`, `/@fs/`) in text files, MIME/cache/source/
  version mismatches and inventory differences.
- `package_set.verify` accepts format 3; `compare` rejects a format downgrade
  that drops the site and a site version rollback.
- `build.py`: for sources with `src/frontend/web/scripts/landing-build.mjs`
  (and the application), run `pnpm -s landing:build --out <temp>/landing` in
  the snapshot after the packages and hosted app are built (the output sits
  outside the snapshot), pack it through the shared deterministic writer
  (`write_archive`, also used by the application), verify it and emit format 3.
  `landing_site.py` joins the recipe fingerprint.
- `check-packed-artifacts.py`: `--previous-app-set` accepts any clean format ≥ 2.
- Tests (`test_landing_site.py`): valid format-3 set and `SHA256SUMS` entry;
  set-record mutations; tampered, added and missing file; each required file;
  source map, local paths, stage routes; link, hard link, FIFO, directory and
  parent-path members; closed manifest, MIME, cache, source and version;
  unreviewed type; per-file and total size limits; format-2 verification and
  compare 2→3 / 3→2; site rollback; deterministic pack round trip with a PAX
  long path; producer rejection of links, source maps and a missing `_headers`;
  site-source detection.

### Phase 2: Documentation

Review tier: high risk (documents the cross-repository contract).

- `scripts/package-sets/README.md`, `contracts/hosted-web.md`,
  `scripts/repository-boundary/README.md` and `docs/frontend/landing-page.md`
  where they describe payloads, formats or the previous-set rule.

Recovery: the change is additive; reverting the branch restores the format-2
producer. Format-2 sets keep verifying throughout.

## Validation

Phase 1 commit `dbf76b48` (tree `5b0f7532`), repository root unless noted:

- `uv run --no-sync python -m unittest discover -s scripts/package-sets -p 'test_*.py'`:
  43 tests OK.
- `uv run --no-sync python -m unittest discover -s scripts/repository-boundary -p 'test_*.py'`:
  14 tests OK.
- `uv run --no-sync ruff check` and `ruff format --check scripts/package-sets scripts/repository-boundary`: pass.
- Real output, `src/frontend`: `pnpm -s packages:build`, then from `web`
  `pnpm -s landing:build --out <scratch>/landing` (289 files). `build.pack_site`
  on that output (version 0.1.1) wrote an 18.1 MB archive in 0.5 s that
  `verify_site` accepted: 201 `immutable` and 88 `revalidate` files, 13 MIME types.
  `landing:build` needs the workspace packages built first; the producer's
  `packages:pack` step does that before it runs.

Phase 2 (documentation only): `pnpm exec prettier --check` from `src/frontend/web`
on the changed Markdown under `docs/` and `contracts/` passes.
`scripts/package-sets/README.md` was not Prettier-clean before this change and is
outside the Prettier gate, so it was left unformatted.

Full build, repository root, commit `dd73be7b` (clean):
`python3 scripts/heavy-slot.py -- uv run --no-sync python scripts/package-sets/build.py build --source . --commit dd73be7b… --output <scratch>/set`
exited 0 and printed `sets/v3/dd73be7b…/8dcea3f4…`. The set holds the wheel,
three npm tarballs, both contracts, `animama-hosted-web-0.1.1.tar.gz` (196 MB)
and `animama-landing-0.1.1.tar.gz` (18.1 MB), with the site in `sites`,
`SHA256SUMS` and the recipe fingerprint (`landing_site.py`); `verify` on the
output passes. `build.py validate` (the isolated consumers and browser
fixtures) was not run.

Repair (working tree after the review, before its commit):

- Package-set unit tests: 45 OK. Repository-boundary unit tests: 14 OK.
  `uv run --no-sync ruff check`: pass.
- `build.pack_site` on the same real 289-file build still passes `verify_site`
  with the revised pattern.
- `pnpm exec prettier --check` (from `src/frontend/web`) on the changed Markdown
  in `contracts/` and `docs/`: pass.

## Code Review #1 Findings

Reviewer: `sdlc-reviewer`, high-risk tier, initial full review of
`1f3d6934..dd73be7b` (both phases). It reran both unit suites (43 and 14 OK) and
`ruff check`, and probed with scratch scripts: the refactored `pack_application`
writes bytes identical to the old one for a fixture with a PAX long path and a
seed; every rejection test fails for its intended reason; PAX records are bound
to the archive root.

- R1-F1 (blocking): the contract described the local-path rule loosely ("not
  preceded by a host or path character", only `X:\Users\`) and omitted the
  case-insensitive suffix rule, so a mirror built from it could disagree.
- R1-F2: `landing-page.md` claimed the verifier checks the same things as the
  build; it is broader (fixed markers, more text types).
- R1-F3: pattern misses (`\n/home/…`, `c:\users\`, `\/Users\/`, `/opt/`,
  `/Volumes/`, `/mnt/`) and false positives on root-relative routes such as
  `/home/`.
- R1-F4: the contract named the site filename and version source as rules the
  verifier did not enforce.
- R1-F5: the repository boundary table and `contracts/README.md` omitted the
  site archive.
- R1-F6: shared-intake errors say "application" for a site archive.
- R1-F7: no unit test packs the application through `write_archive`.
- R1-F8: no test for format 4 or a format-3 set without `applications`.
- R1-F9 (sequencing): once merged, `main` and CI build format-3 sets, which
  Cloud's current format-2 mirror rejects until raymond-van/animama-cloud#182.

## Code Review #1 Revisions

- R1-F1, R1-F3 accepted: `LOCAL_PATH` now covers escaped separators, escaped
  newline/return/tab prefixes, `/Volumes/`, `/mnt/`, `/opt/` and any-case
  Windows user folders, and still ignores URL paths. The contract quotes the
  exact pattern, explains it, states the case-insensitive suffix rule and that a
  root-relative `/home/` route fails; `test_the_hosted_contract_states_the_exact_local_path_pattern`
  keeps the contract and code identical. New positive/negative pattern tests and
  verifier cases (`.MAP`, `\n/home/…`, `\/Users\/`, `c:\users\`).
- R1-F2 accepted: `landing-page.md` now says the verifier is stricter and how to
  check a build with `build.pack_site`.
- R1-F4 accepted in part: the filename is enforced (new set-record test); the
  version source is documented as producer behaviour (see Decision Log).
- R1-F5 accepted: both documents list the landing site archive.
- R1-F6 accepted: `verify_site` prefixes intake errors with "Invalid landing
  site archive".
- R1-F7 not changed: the reviewer's byte-identity probe and the full clean build
  exercise it; the site packer tests cover `write_archive` itself.
- R1-F8 accepted: set-record tests reject format 4 and a format-3 set without
  `applications`.
- R1-F9 recorded for the PR and owner: merge order with the Cloud adoption.

Repair rounds used: 1 of 2. A recheck of the repair follows.

## Code Review #2 Findings

Reviewer: the same `sdlc-reviewer`, repair round 1, `dd73be7b..d3672230`
(tree `e1024ea6`). It reran both unit suites (45 and 14 OK) and `ruff check`,
and probed the pattern and error wrapping. Result: pass, no blocking findings.

- R2-F1 (non-blocking): two summary phrases under the quoted pattern were looser
  than it (`file:` needs two following slashes in any case; a Windows drive
  letter must not follow a letter, digit or `_`).

## Code Review #2 Revisions

- R2-F1 accepted: the contract prose now states both conditions. Wording only;
  the pattern block and its test are unchanged (trivial repair, verified by the
  contract-pattern test and Prettier).
