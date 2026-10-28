# Runtime issuance and bundle reads with less work per request

Source agreement: raymond-van/animama#699 (body and comments read 2026-10-28). The
issue is the spec: its proposed changes 1–4 are R1–R4 below, and its comment on
Idle playback is R5.
Authorized scope: the whole plan (task instruction, 2026-10-28: implement #699
following this repository's workflow, split into phases if the plan calls for
it, open one or more PRs and do not merge). Merge approval of the exact head
stays with the owner.

## Purpose and context

Opening an Anima calls `GET /v1/animas/{anima_id}/runtime`, then reads the issued
revision's bundles. Issuance recompiles and reprojects an unchanged loadout on
every call, holds the loadout row lock and its transaction through that work, and
each bundle read loads the snapshot's whole catalog (about 2 MB) to find its own
members. This plan keeps every issued result and refusal and does less work:

- R1: verify a compile's members in one worker-thread call instead of one await
  per member.
- R2: reissue an unexpired snapshot whose inputs are unchanged without
  recompiling or reprojecting it, still rechecking admission and renewing its
  lease.
- R3: compile and project before taking row locks, then recheck the pins, lock
  and write in a short final transaction, so a composition that serializes an
  account's writes holds that lock only for the write.
- R4: a bundle read loads only that bundle's member list, stored with the
  snapshot when it is issued.
- R5: reuse Idle playback facts for unchanged motion bytes and Idle settings
  in a bounded in-process cache, as `content_thumbnails.py` does for thumbnails.

Acceptance (from the issue): each change keeps today's issuance and bundle
results (effective revision, members, diagnostics, lease, bundle bodies) for
the same catalog and loadout, and the same refusals for changed, missing or
foreign content; a repeated measurement shows each change's effect on issuance
and bundle time, statements and row-lock duration.

Code and contracts:

- Issuance: `src/backend/animama/app/services/anima_runtime_service.py`
  (`AnimaRuntimeService.issue`, `_recheck_admission`, `_runtime_response`).
- Closure compile: `app/services/runtime_content_closure.py`.
- Idle playback: `app/services/idle_playback.py`; shared by Idle Save, preview,
  starter policy and mount.
- Bundles: `domain/runtime_bundles.py` (`select_runtime_bundles`),
  `app/services/runtime_bundle_service.py`.
- Shared routes: `product_http/routes/anima_runtime.py`; sessions come from the
  composition's `ProductPorts` (`read_session`, `write_session`, `content`).
- Snapshot table: `orm/anima_loadout.py::ORMAnimaRuntimeSnapshot` and
  `alembic/versions/0001_baseline.sql`.
- Docs: `docs/backend/architecture/local-content-storage.md`,
  `docs/backend/architecture/data-model.md`, ADR 0028 (cacheable runtime members).

Coordination: sibling tasks #761 (catalog listing) and #763 (digest-keyed
Included URLs) run in parallel. This plan owns the files above and does not edit
the catalog repository's `list_visible`, `product_http/routes/content.py` or
`product_http/delivery.py`. Issuance calls `list_visible`, so a faster listing
from #761 speeds issuance too.

Measurement: `scripts/perf/runtime_issuance.py` starts a disposable PostgreSQL
(`pgvector/pgvector:pg16`) container, scans this checkout's Included content
(Git LFS pulled), creates both supplied starter Animas and serves the shared
runtime routes in process. It reports wall and process CPU time (worker threads
included) per issue and per bundle read, SQL statements and loadout-lock hold
time; `--rtt-ms 2` adds a 2 ms round trip through a local proxy; `--profile`
writes a cProfile of the reissues.

## Progress

- [x] Investigation and baseline (2026-10-28), recorded below.
- [x] Phase 1: one verification call per compile and cached Idle playback facts
  (standard review passed after one trivial repair).
- [x] Phase 2: bundle reads load only their own members (high-risk review round 1
  repaired; recheck pending).
- [x] Phase 3: compile outside the write transaction (reviewed with Phase 4).
- [x] Phase 4: reissue an unchanged snapshot without recompiling (round 1 repaired;
  recheck and full suite pending).
- [ ] Final integration review, full pre-push suite and PR.

## Surprises & Discoveries

- Baseline at `62fd8394` on an Apple M5 (other sessions sharing the machine, so
  medians vary by about ±15%): each starter issues 1,199 members (49–50 MB), 14
  bundles and a 1.91 MB JSON response with no diagnostics.

  | Condition | First issue | Reissue (median) | Reissue CPU | Statements | Loadout lock held | Bundle read (median) |
  | --- | --- | --- | --- | --- | --- | --- |
  | 0 ms round trip | 457–490 ms | 517–563 ms | 469–472 ms | 11 | 432–500 ms | 34–35 ms, 2 statements |
  | 2 ms round trip | 455–722 ms | 545–619 ms | 397–447 ms | 11 | 482–561 ms | 71 ms, 2 statements |

- A cProfile of reissues (inflated by profiling, shares only): the per-member
  `open_verified_file` calls dominate, mostly in `FilesystemContentStore._safe_path`
  (path resolution, pure Python, so it holds the interpreter lock in its worker
  thread), then the typed projection, the response overlay and bundle selection,
  `list_visible`, Idle playback parsing (`derive_idle_playback`), response gzip,
  and the canonical hash. Hashing itself is a small share.
- A reissue sends the whole 2 MB catalog in an `INSERT … ON CONFLICT DO NOTHING`,
  then reloads the existing row's 2 MB catalog and compares it as a dict.
- Chat turn setup (`product_http/chat/turn_setup.py`) also loads a snapshot's whole
  catalog for each turn. It is outside #699 and left for a follow-up.

## Decision Log

- 2026-10-28 (agent, within the agreed outcome): the issue is the spec; no
  separate spec file.
- 2026-10-28 (agent): the issuance route prepares on the composition's read
  session and commits on a separate, short write session. A composition's
  `write_session` may take an account-wide lock when it opens, so a single
  session cannot shorten that lock. `AnimaRuntimeService.issue` keeps the
  prepare-then-commit sequence on one session for single-session callers.
- 2026-10-28 (agent): the commit locks the loadout row and rechecks its revision.
  If the loadout changed since preparation, issuance prepares again, at most three
  times in all, then refuses with the existing `snapshot_conflict` (409).
- 2026-10-28 (agent): reuse is keyed by an inputs digest over everything a compile
  and projection read: the projection version, loadout revision, root selections
  with their contexts, every catalog entry the closures visit (all fields except
  `scanned_at`, so a rescan that changes nothing keeps reuse) or its absence, and
  the owner's Included Avatar face-part override. A reused snapshot is not
  reopened and hashed at issuance, as R2 proposes; every bundle and file read
  still verifies size and SHA-256 and marks changed files for Rescan, after which
  the catalog differs and the next issue recompiles. A compile that finds changed
  files stores no inputs digest.
- 2026-10-28 (agent): Idle playback facts are keyed by the motion file's SHA-256,
  the implementation kind and the Gesture's canonical `config`, the only
  document inputs `derive_idle_playback` reads. This is exact for unsaved
  documents (Save, preview) as well as revisions. Issuance uses a cached value
  without reopening the motion file only after its compile verified that file;
  other callers still open and verify the file and skip only the parse.
- 2026-10-28 (agent): the snapshot table gains `bundles` (each issued bundle's
  format and members by bundle ID) and a nullable `inputs_digest` (a row without
  one is never reused). A reuse rebuilds the fenced file union from the current
  catalog entries of its pins, which the matching digest proves unchanged, so no
  stored member digest is needed. The baseline SQL changes, so existing
  development databases must be reset, as for earlier baseline edits.
- 2026-10-28 (agent): the inputs digest includes an identity of the running
  backend code (a hash of the package's Python sources, or the executable of a
  frozen build). `RUNTIME_PROJECTION_VERSION` has not changed since the repository
  split while the projection has, so without it a reissue after an upgrade could
  renew a body the new code would project differently, indefinitely.

## Phased implementation

Working directory: the repository root of the task worktree; branch
`perf/runtime-issuance` from `origin/main` at `62fd8394`.

### Phase 1: One verification call per compile and cached Idle playback facts

Review tier: standard (behavior-preserving change inside the compiler and Idle
playback, covered by existing closure, Idle and admission tests).

Requirements: R1, R5.

Changes:

- `RuntimeContentClosureCompiler.compile` resolves every candidate root's
  closure first, then verifies the union of their files in one
  `asyncio.to_thread` call that loops over `ContentStore.open_verified_file`.
  The per-root pass consults those results in the old order, so the same first
  changed file yields the same `runtime_source_changed` diagnostic and the same
  paths are marked for Rescan. Files of roots that never reach verification are
  not opened.
- `idle_playback.py` gains a bounded, thread-safe LRU of `IdlePlaybackFacts`
  (key per the Decision Log). `read_gesture_idle_playback` consults it after it
  opens and verifies the file; with `verified=True` (the compile's case) it uses
  a cached value without reopening the file.

Tests (TDD): a compile of N members performs one worker-thread call and the same
descriptor and diagnostics as before (including a changed file and a root whose
first file changed); a second Idle read of unchanged bytes and settings does not
parse again; a changed `config` or motion digest misses the cache; a verified
compile hit opens no file while an unverified caller still opens and verifies it;
the cache stays within its bound.

Checks: the new and touched tests, `tests/test_anima_runtime_*`,
`tests/test_idle_playback.py`, `tests/test_anima_idle_pool.py`, ruff and mypy on
touched files; benchmark at 0 ms.

Check record (repository root; tree `8636bd47` is the reviewed working tree):

- `uv run --no-sync pytest -q -p no:randomly -n 4 tests/test_anima_runtime_closure.py
  tests/test_idle_playback.py tests/test_anima_idle_pool.py
  tests/test_anima_runtime_item_admission.py tests/test_anima_runtime_bundles.py
  tests/test_anima_runtime_delivery.py tests/test_product_http_anima_runtime.py
  tests/test_anima_creation.py tests/test_anima_reaction_pools.py
  tests/test_runtime_entry_policy.py tests/test_avatar_face_parts.py
  tests/test_pocket_voice_content.py tests/test_anima_starters.py
  tests/test_anima_loadouts.py tests/test_typed_content_apis.py`: 255 passed
  (`8636bd47`).
- `uv run --no-sync ruff check src/backend/animama tests scripts/perf`, `ruff format
  --check src/backend/animama tests`: pass. `uv run --no-sync mypy src/backend/animama
  tests --exclude web-ui --exclude deprecated --exclude templates`: pass after the
  test typing fix.
- Benchmark, 0 ms: reissue median 319–380 ms (baseline 517–563), loadout lock
  216–273 ms (baseline 432–500), first issue 318–373 ms; same 1,199 members, no
  diagnostics, 14 bundles. Bundle reads unchanged (27 ms).

Repair checks (after Code Review #1): the closure, Idle playback, Idle pool,
creation, starter and typed-content test files, 179 passed; ruff and mypy on the
four phase files pass.

Note: when content has changed, the single verification call now also hashes a
changed root's files after its first changed one, which the old loop skipped.
Results, diagnostics and Rescan marking are unchanged; the extra reads are
accepted.

#### Code Review #1 Findings

Reviewed the working tree `8636bd47` against `62fd8394` (standard tier). The
reviewer reused the test, ruff and format records, reran mypy on the four phase
files (pass), and ran a read-only differential check of the old and new compilers
over 3,000 random catalogs (missing, invalid and cyclic dependencies, changed
files, Idle roots): no difference in any descriptor, diagnostic order or Rescan
marking.

- P1-F1 (blocking): the Idle facts cache key held the Gesture's whole canonical
  `config`, which an imported package may make large, so 4,096 entries bounded
  entry count but not memory.
- P1-N1: a changed root's later files are now hashed too (see the note above).
- P1-N2: `asyncio.to_thread` cannot be cancelled, so a cancelled request finishes
  hashing the batch; acceptable at the measured sizes.
- P1-N3: no test pinned that cached Idle facts never admit motion that failed
  verification.
- P1-N4: an existing closure test served bytes whose fake digest did not match,
  which a process-wide cache could leak into another test.

#### Code Review #1 Revisions

- P1-F1: fixed; the key holds the SHA-256 of the canonical config. Trivial
  repair, verified by the Idle playback tests.
- P1-N3: added `test_cached_idle_facts_never_admit_motion_that_failed_verification`.
- P1-N4: the existing test now uses the clip's real digest.
- P1-N1, P1-N2: accepted as recorded. Repair rounds used: 0 of 2 (no recheck
  needed for a trivial repair).

### Phase 2: Bundle reads load only their own members

Review tier: high risk (snapshot schema and a byte-delivery authorization path).

Requirements: R4.

Changes:

- `anima_runtime_snapshots.bundles jsonb NOT NULL DEFAULT '{}'` (an object check):
  each bundle `select_runtime_bundles` chose at issuance, `{format, members}` by
  bundle ID.
  Issuance computes the selection once and uses it for both the response and the
  column.
- `RuntimeBundleService.read` selects the lease expiry and only the requested
  bundle's element of that column (one statement), then authorizes its members
  with `authorize_files` as today. Unknown bundles, expired leases and foreign
  owners keep their current refusals.
- ORM, baseline SQL and the data-model and storage docs.

Tests (TDD): a bundle read sends no statement that loads `catalog`; its body is
byte-identical to today's for JSON and binary bundles; unknown, expired, foreign
and changed-member cases keep their codes; the issued response lists the same
bundles as the stored column.

Checks: phase tests, `tests/test_anima_runtime_bundles.py`,
`tests/test_anima_runtime_item_admission.py`, ruff, mypy, the full pre-push suite
(high risk) before review; benchmark at 0 and 2 ms.

Check record (repository root; working tree `fb377ef1` before the phase commit):

- `uv run --no-sync pytest -q -p no:randomly -n 4 tests/test_anima_runtime_issuance.py
  tests/test_anima_runtime_bundles.py tests/test_anima_runtime_item_admission.py
  tests/test_alembic_fresh_install.py tests/test_anima_runtime_delivery.py
  tests/test_product_http_anima_runtime.py tests/test_avatar_face_parts.py
  tests/test_pocket_voice_content.py tests/test_content_package_voice_export.py
  tests/test_anima_runtime_closure.py tests/test_runtime_catalog_owner_contract.py`:
  88 passed (`fb377ef1`).
- `uv run --no-sync ruff check src/backend/animama tests`; `uv run --no-sync mypy
  src/backend/animama tests --exclude web-ui --exclude deprecated --exclude
  templates`: pass (`fb377ef1`).
- The baseline's reviewed fingerprint in `tests/test_alembic_fresh_install.py`
  changes with the new column.
- Full pre-push suite on `4d0ba00d` (tree `1a122f56`), in a detached validation
  checkout through `scripts/heavy-slot.py -- make check-test`: typed-content audit,
  format check, ruff and mypy pass; pytest 4930 passed, 29 skipped.
- Benchmark (machine shared with other suites, so issue times are inflated): bundle
  read median 28–33 ms at 0 ms round trip (baseline 34–35 ms) and 34–36 ms at
  2 ms (baseline 71 ms); bundle CPU 16–18 ms (baseline 20–23 ms). Issuance's
  statements are unchanged; its insert now also carries the bundle lists.

#### Code Review #1 Findings

Analysis of `git diff 8d3b4b76 0c261861` and an independent checks rerun on
`4d0ba00d` (tree `1a122f56`), high-risk tier. The checks reviewer reran the phase
tests (46 passed), ruff and mypy, compared the baseline SQL's and the ORM's
`anima_runtime_snapshots` in throwaway PostgreSQL schemas (identical apart from
column order), and showed the new bundle test fails against the pre-Phase-2 read.

- P2-F1 (blocking): `domain/runtime_bundles.py`'s docstring still said serving
  reselects bundles from the stored catalog.
- P2-F2: the conflict path advertised freshly selected bundles while renewing a
  row whose stored lists were not compared, so a later selection change or a
  composition that added the column to live rows could advertise unstored IDs.
- P2-F3: the real bundle lookup's unknown, expired and other-revision refusals had
  no database-backed test; the route test's fake reimplemented them.
- P2-F4: the development guide omitted that chat turns also fail without the column.
- P2-F5: `get_snapshot` (chat turn setup) now also loads the bundle lists.
- P2-F6: this plan's bullet described an ordered list and lacked the benchmark.
- P2-F7: a bundle ID with a NUL byte now reaches SQL (likely a 500 instead of 404).
- Checks: the new test's catalog check also matched `catalog_digest`.

#### Code Review #1 Revisions

- P2-F1: the docstring says serving reads the stored lists, which outlive later
  selection changes.
- P2-F2: renewing an identical snapshot also rewrites its stored bundle lists.
- P2-F3: `test_a_bundle_read_keeps_its_refusals` covers an unknown, a malformed and
  an other-revision bundle and an expired lease against the database.
- P2-F4: the guide names chat turns.
- P2-F5: `get_snapshot` defers the bundle lists (`raiseload`).
- P2-F6: bullet and benchmark recorded above.
- P2-F7: `get_bundle` refuses anything but a 64-character lowercase hex ID before
  querying, as `runtime_file_not_found`.
- Checks finding: the test matches `anima_runtime_snapshots.catalog` on a word
  boundary.
- Verification: the issuance, bundle and owner-contract test files, 46 passed;
  ruff and format pass. Repair rounds used: 1 of 2; the high-risk recheck is
  recorded as Code Review #2.

### Phase 3: Compile outside the write transaction

Review tier: high risk (concurrency, persistence and a shared route).

Requirements: R3.

Changes:

- `AnimaRuntimeService.prepare` reads the loadout (owner-checked, no lock), the
  visible catalog, the selections, compiles without writing (changed paths are
  returned instead of marked) and projects. It takes no row locks and writes
  nothing.
- `AnimaRuntimeService.commit` locks the loadout row (`FOR SHARE`, owner-checked),
  returns `None` if its revision changed, marks changed paths for Rescan, rechecks
  admission, inserts or renews the snapshot, runs the bounded cleanup and commits.
  The conflict path compares digests and pins without loading the stored catalog.
- The route prepares in `ports.read_session` and commits in `ports.write_session`,
  each with its own `ports.content`, retrying per the Decision Log.

Tests (TDD): the loadout lock is taken only in the final transaction, after all
compile and projection work (statement order); a loadout change between prepare
and commit reissues against the new revision; repeated changes end in
`snapshot_conflict`; changed files found by prepare are marked in the commit;
pins, foreign content and missing loadouts keep their refusals; the route reads
on the read session and writes on the write session.

Checks: phase tests, runtime/route tests, ruff, mypy, full pre-push suite before
review; benchmark at 0 and 2 ms (lock-hold time).

Route inventory: the issuance route no longer holds a write session for the whole
request, so its `access` is now `staged` (prepared on a read session, written on a
short write session the handler opens); the inventory test asserts such a route
never depends on the write-session dependency. Other `access` values are unchanged.

Check record (repository root; working tree `25c8f424` before the phase commit):

- `uv run --no-sync pytest -q -p no:randomly -n 4` over the issuance, delivery,
  shared-route owner isolation, item admission, bundle, closure, creation, face-part,
  Pocket voice, voice export, inventory, consumer, Idle pool, Reaction pool,
  owner-contract, creation batching and starter test files: 195 passed (`25c8f424`).
- `ruff check`, `ruff format --check` (backend and tests) and the full `mypy` run:
  pass (`25c8f424`).
- `uv run --no-sync python scripts/repository-boundary/consumers/product_http.py`:
  205 inventory routes, 144 shared mounted, no local imports.

### Phase 4: Reissue an unchanged snapshot without recompiling

Review tier: high risk (persistence and the issuance security recheck).

Requirements: R2.

Changes:

- `prepare` computes the inputs digest after the selections and looks for an
  unexpired snapshot of the same owner, Anima and digest. If one exists it loads
  that snapshot's catalog and skips verification, compile, Idle
  playback, projection, face parts and the identity hash.
- `commit` of a reuse locks and checks the loadout revision, rechecks admission
  with the stored pins and their current entries' files, renews the lease (only while it is
  still unexpired) and commits; if the row expired or vanished meanwhile, issuance
  prepares again and compiles.
- A fresh compile stores its inputs digest (none after changed files); the
  conflict path updates the existing row's digests.

Tests (TDD): a reissue of an unchanged loadout sends no compile, projection or
byte reads and returns the same effective revision, members, diagnostics and
bundles with a renewed lease; each input change (binding, item revision or
status, dependency, a missing item appearing, Avatar change, face-part override,
projection version) recompiles; a pinned item that changed or became foreign is
refused exactly as today; a snapshot that expires between prepare and commit
recompiles; the inputs digest is stable across two catalog loads.

Checks: phase tests, runtime tests, ruff, mypy, full pre-push suite before
review; benchmark at 0 and 2 ms.

Check record (repository root; working tree `13bb462a` before the phase commit):

- `uv run --no-sync pytest -q -p no:randomly -n 4` over the issuance, delivery,
  shared-route owner isolation, item admission, bundle, closure, creation,
  face-part, Pocket voice, voice export, inventory, consumer, Idle pool, Reaction
  pool, owner-contract, creation batching, starter, baseline and Idle playback
  test files: 308 passed.
- `ruff check`, `ruff format --check` and the full `mypy` run: pass.
- Benchmark, 0 ms (machine shared with other suites): reissue median 203–235 ms,
  CPU 169–201 ms, loadout lock 15.6–17.9 ms; first issue 460–471 ms. A profile of
  the reissues leaves the visible-catalog listing, the 2 MB response (overlay,
  validation, gzip), bundle selection, the stored catalog's decode and the inputs
  digest.

### Phases 3 and 4: Code Review #1

Phase 4 rewrites Phase 3's `prepare` and `commit`, so one high-risk review covered
`git diff 0c261861 752c37b6` (tree `0843e144`). The full pre-push suite for these
phases runs once on `752c37b6`, which contains Phase 3, rather than once per phase;
its result is recorded below when it completes.

#### Code Review #1 Findings

The analysis reused the Phase 4 check record (tree `13bb462a`, which differs from
`752c37b6` only in this plan) and confirmed: every write to bindings or
`anima.avatar_id` locks the loadout row and increments its revision in the same
transaction, so an unchanged revision under `FOR SHARE` proves the prepared
bindings; the inputs digest covers everything compile, Idle playback, projection
and face-part application read; every new query is owner-scoped and a reuse always
passes the recheck; a lagging read session yields refusals, never wrong pins; the
`staged` access value is compatible with known consumers.

- P34-F1 (blocking): in the frozen desktop build the package directory holds the
  packaged Alembic `.py` scripts but no module sources, so `_backend_build` hashed
  only those and never reached the executable fallback; the identity did not change
  across upgrades. A `.pyc`-only install would have fallen back to the interpreter.
- P34-N1: after Phase 4 the final-transaction test exercised only the reuse commit.
- P34-N2: no test gave the route distinct read and write sessions.
- P34-N3: no test for an Avatar or projection-version change, or for a pinned item
  becoming foreign between `prepare` and a reuse commit.
- P34-N4: the reuse renewal updated by snapshot ID only.
- P34-N5: the HTTP API doc omitted that an expired reuse also retries.
- P34-N6: the retry loop appears in `issue()` and the route (accepted; `issue()`
  serves single-session callers).

#### Code Review #1 Revisions

- P34-F1: a frozen build is identified by its executable first; otherwise the
  package's `.py` modules, or its `.pyc` modules when it ships none. Tests cover a
  frozen layout with packaged Alembic scripts and source and compiled packages.
- P34-N1: the test runs both the compile commit (stored digest cleared) and the
  reuse commit.
- P34-N2: `test_issuance_prepares_on_the_read_session_and_commits_on_the_write_session`
  records each session's open, use and close.
- P34-N3: digest tests add Avatar selection and projection-version changes; the
  reuse fence test also covers a pinned item that became another owner's.
- P34-N4: the renewal also filters owner and Anima.
- P34-N5: wording fixed.
- Verification (working tree `5d496fab`): the runtime test set, 320 passed; ruff,
  format check and full mypy pass. Repair rounds used: 1 of 2; the recheck is
  Code Review #2.

## Final integration review

Covers R1–R5 together against the issue's acceptance, then the full pre-push
suite once on the final candidate; its results go in the PR.

## Validation and acceptance

- Automated: the phase tests above and the full backend suite (`make check-test`).
- Measurement: the benchmark table above, repeated after each phase and on the
  final candidate, at 0 and 2 ms round trips.
- Not covered locally: a hosted composition with an account-wide write lock (the
  route's session split is tested with the local ports) and a production-size
  multi-user load.

## Idempotence and recovery

Snapshots are disposable leases. Development databases created from the old
baseline must be reset (`./reset.sh --purge`, or the database-only reset in the
development guide) to gain the new columns; nothing else needs migration. The
Idle playback cache is per process and rebuilt on demand. Reverting the branch
restores the previous behavior after another reset.

## Outcomes & Retrospective

Pending.
