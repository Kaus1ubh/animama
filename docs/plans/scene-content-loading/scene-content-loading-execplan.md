# Draw a starter Anima with its idle sooner and write its starter loadout in bounded statements

Source agreement: raymond-van/animama#630, filed 2026-10-20 with the owner's
go-ahead. The issue is the spec; this plan does not restate it.
Authorized scope: Phases 1–5 (owner approval of this plan, 2026-10-21). Merge,
release and publication keep their separate approvals.

## Purpose and context

A new user's starter Anima should be drawn with its idle animation playing within a
few seconds of opening the Anima route over a network, while the rest of its loadout
loads in the background, and creating a starter loadout should cost a bounded number
of SQL statements.

Measured on `e8c3233a` (a new account's first visit over loopback HTTP, software
WebGL): a starter's issued descriptor names 1,199 members (63 MB); the JSON bundle
carries 170, and 540 more arrive one request each with four workers; the model is
drawn about 2 s after the runtime read, the last optional member about 30 s after it.
`AnimaLoadoutService.create_starter_loadout` issues 993 statements per starter.

Relevant code (paths from the repository root):

- Frontend runtime preparation: `src/frontend/web/src/lib/runtime-content/`
  - `RuntimeMountPreparer.ts`: essential stage (avatar closure and voice), first
    frame, then one optional stage with `concurrency ?? 4` workers (clamped to 8);
    the JSON bundle is used only in the optional stage and placed first in its queue.
  - `RuntimeJsonBundleLoader.ts`: one bundle, at most 256 JSON members of at most
    256 KiB and 2 MiB in total; only transport unavailability (network error, 404,
    5xx) falls back to per-member requests.
  - `VerifiedByteLoader.ts`: per-member fetches with `cache: "no-cache"`, size and
    SHA-256 verification, in-flight deduplication.
  - `runtimePreparationTimings.ts` already records per-mount marks
    `animama:runtime-N:{manifest-ready|essential-bytes-ready|first-posed-frame|optional-settled}`
    from `ui/app/AnimaRouteProviders.tsx`; the hosted-app package verifier
    (`scripts/repository-boundary/consumers/hosted-app/verify.mjs`) waits for
    `:first-posed-frame`.
- Idle roots: each `runtime.idle.gestures[i].runtime_root_id` is its own descriptor
  root, whose `member_refs` is its whole dependency closure
  (`app/services/typed_runtime_projection.py`, `app/services/runtime_content_closure.py`).
- Backend bundle path: `domain/runtime_json_bundle.py` (selection),
  `app/services/runtime_json_bundle_service.py`, `product_http/routes/anima_runtime.py`
  (`/json-bundle` and the per-file route), `app/services/anima_runtime_service.py`
  (issuance, `authorize_files` in one statement), `app/contracts/runtime_content.py`
  (`PyRuntimeJsonBundle`), `product_http/inventory.py` (shared, stage 3, `bytes`).
- Caching: `product_http/ports.py` `file_response(..., revalidate)`;
  local `server/product_ports.py` sends `private, no-cache` or `private, no-store`.
  Documented local guidance keeps the immutable policy away from private content
  (`docs/frontend/architecture/local-content-runtime.md`,
  `docs/backend/architecture/local-content-storage.md`).
- Starter loadout writes: `app/services/anima_loadout_service.py`
  `create_starter_loadout` → `_create_root` (Idle) and `_starter_reactions` +
  `_upsert` (Reactions). Each pool member costs five statements: a
  `SELECT … FOR UPDATE` of the catalog item, two entry loads, an existence `SELECT`
  and the `INSERT`; 197 members × 5 + 8 = 993.

Boundaries: shared routes and the generated client change, so the local-http
contract takes a major version and `@animama/runtime-contracts` a minor version
(`scripts/package-sets/README.md`). A hosted composition consumes the public
artifacts by reviewed repin and keeps its own caching policy.

## Progress

- [x] Plan review (owner): approved 2026-10-21 with the decisions below.
- [x] Baseline measurement (no commit): recorded with Phase 5's after-measurement.
- [x] Phase 1: bounded starter loadout writes (16 statements for a real starter, from 993;
  three reviews, 2 of 2 repair rounds).
- [x] Phase 2: Idle first, eight workers, milestones (three reviews, 2 of 2 repair
  rounds).
- [x] Phase 3: plural bundles: contract and backend (one high-risk review, passed).
- [x] Phase 4: binary bundles in the client (one high-risk review, passed).
- [x] Phase 5: cacheable revision members and the after-measurement (one high-risk
  review, passed).
- [ ] Final integration review and full pre-push suite.

## Surprises & Discoveries

- One JSON bundle cannot reach "a few dozen requests": its 256-member and 2 MiB caps
  leave about 190 JSON members per starter as single requests, so JSON bundles must
  become plural too.
- Performance marks already exist under per-mount names that a packaging verifier
  depends on (see Purpose).
- Requirement 4 (cacheable revision members) reverses documented local guidance on
  private content and needs an owner decision; the file route's drift detection
  (`mark_scan_required`) would not run on cache hits.
- Cloud keeps shared Included rows unlocked only through `Session.get` (its
  `DeferredSession`), an implicit contract a batched `SELECT … FOR UPDATE` bypasses
  (review R1-1, decision P-9).
- The per-file route hashes a file and then streams it from the start; a write in
  between could stream bytes that differ from the hash. With a reusable cache, a
  client must retry once with `cache: "reload"` after a verification failure so a bad
  cached copy cannot stick.

## Decision Log

Proposed by the plan author and decided by the owner on 2026-10-21: P-1, P-2 and
P-7 as proposed (each asked explicitly), and P-3 to P-6 and P-8 as proposed with the
plan's approval.

- P-1 Milestone names: add `animama:runtime-first-frame`, `animama:runtime-idle-ready`
  and `animama:runtime-settled` beside the existing per-mount marks, recorded where
  the existing marks are recorded (`AnimaRouteProviders`, which alone knows the first
  frame). Renaming the existing marks would change the packaging verifier, a
  release-gated surface. Alternative: rename them.
- P-2 Contract shape: replace `json_bundle` and `/json-bundle` with an ordered
  `bundles` list (`format: "json" | "binary"`, Idle bundles first) served at
  `/runtime/revisions/{revision}/bundles/{bundle_id}`, where `bundle_id` is a digest of
  the bundle's format and member set. local-http 9.0.0 → 10.0.0,
  `@animama/runtime-contracts` 0.9.0 → 0.10.0. An old tab falls back to per-member
  requests. Alternative: keep one `json_bundle` and add binary bundles beside it,
  which leaves about 190 JSON requests.
- P-3 Binary format: a length-prefixed frame (`AMB1`, a 4-byte header length, a JSON
  header naming each member's size or error, then the raw bytes in header order),
  rather than base64 in JSON (33% larger, and PNGs do not compress).
- P-4 Binary limits: image and texture members (`image/png`, `image/jpeg`,
  `image/webp`) of at most 512 KiB, at most 64 members and 4 MiB per bundle, at most
  32 bundles per revision. 512 KiB covers about 97% of the tracked Included PNGs.
- P-5 Idle scheduling: two sequential optional stages (Idle, then the rest), the
  literal reading of "never delay the idle". Alternative: one priority queue.
- P-6 Budget order: unchanged, as the issue requires.
- P-7 Caching: runtime file and successful binary-bundle responses may be reused
  from the browser cache for one year (`private, max-age=31536000, immutable`) in the
  local composition; the client fetches with `cache: "default"` and retries once with
  `cache: "reload"` after a verification failure. Record the change in an ADR. A
  hosted composition chooses its own policy and may stay stricter.
- P-8 Creation path: leave `initialize()`'s Reaction loop as is (creation scope);
  `_create_root` batching already covers its Idle pool.
- P-10 Hosted adoption of the byte policy (implementer, 2026-10-21, from Phase 5's
  review): `ProductPorts.file_response` now takes `immutable`; a hosted composition
  must accept it (else every runtime member and complete binary bundle request
  fails) and chooses its own policy for it.
- P-9 Shared-row locks (implementer, 2026-10-21, from review R1-1): a composition
  whose shared catalog rows never change at runtime sets
  `SHARED_CATALOG_ROWS_IMMUTABLE` in the session's `info`, and catalog reads then
  lock only owner rows. Hosted Cloud must set it on its owner sessions (and extend
  its Included-lock test to the batched reads) when it adopts this build; until then
  its starter adoption would lock shared rows. Alternatives: let a composition
  supply its own catalog repository, or have Cloud rewrite batched lock statements.

## Phased implementation

### Baseline (no commit)

On a built named stack (`ANIMAMA_LLM_SKIP=1 ANIMAMA_WEB_BUILD_MODE=production
./reset.sh --name <name> --base-port <port>`), record for a new installation's first
starter mount: runtime requests, time to first frame, approximate Idle readiness (the
last Idle member's response end) and the last member, over loopback and with Chrome
DevTools Protocol network emulation (for example 40 ms latency). Use CDP network
events for counts (the resource-timing buffer holds 250 entries by default).

### Phase 1: Bounded starter loadout writes

Review tier: high risk (persistence and row locks).

- Add `ContentCatalogRepository.get_visible_items(item_ids, user_id, for_update)`:
  one `SELECT … WHERE id IN (…) ORDER BY id [FOR UPDATE]` with `populate_existing`
  and one entry load, locking the same rows in the same mode in sorted order.
- In `AnimaLoadoutService`, extract `_typed_target` from `_target` and add `_targets`
  over the batch read. `_create_root` validates the distinct Idle items in one call,
  raises the first error in member order as today, and writes all Idle bindings in
  one multi-row `INSERT` (a new root has no bindings, so the existence check goes).
  `_starter_reactions` resolves keys from the visible catalog, locks all targets in
  one call, keeps the same unavailable-Reaction warnings in key order, and
  `create_starter_loadout` writes all Reaction bindings in one `INSERT` in policy
  order. `_dependency_counts` is unchanged. `restore_starter` benefits through the
  same helpers.
- Tests: a statement bound (about 16) for a real starter in
  `tests/test_anima_starters.py`, equal counts for a small and the full pool
  (`tests/test_anima_reaction_pools.py`), identical binding rows
  `(slot_key, catalog_item_id, kind, config)` to the policy, row locks held until
  commit (the `lock_timeout` pattern in `tests/test_anima_runtime_item_admission.py`),
  Idle error precedence and the unavailable-Reaction warning; existing tests unchanged.
- Validation: `uv run pytest -q tests/test_anima_starters.py tests/test_anima_reaction_pools.py tests/test_anima_loadouts.py tests/test_anima_creation.py`,
  `uv run ruff check`, then the full pre-push suite before review.

Check record (before review), on tree `75cd14c` over baseline `99aede24`:

- `uv run pytest -q tests/test_anima_starters.py tests/test_anima_reaction_pools.py tests/test_anima_loadouts.py tests/test_anima_creation.py`
  (root): passed. A real tracked starter sends 16 statements, down from 993.
- `uv run ruff check`, `uv run mypy` on the touched modules (root): passed.
- `python3 scripts/heavy-slot.py -- make check-test` (root, full pre-push suite;
  no frontend change): 4718 passed, 29 skipped.
- Independent checks reviewer: the affected suites (123 tests) and the statement
  counts (16 for the full starter, 12 for the small pool) reproduced.

#### Code Review #1 Findings

High-risk analysis review of tree `75cd14c`, which also read Cloud's hosted consumer.
It reran the loadout suites (93 passed) and compared the baseline and new services
side by side: identical binding rows (197: 29 Idle, 168 Reaction), roots and read
models; the same 12 Idle and 168 Reaction rows locked (197 single-row locks before,
2 batched locks now); the same Idle error in all 240 orderings tried.

- R1-1 (blocking): in the hosted composition the batched lock bypasses Cloud's rule
  against row-locking shared Included rows. Cloud's `DeferredSession` exempts them
  only in `Session.get`; `get_visible_items` locks with a `SELECT … FOR UPDATE`, so
  each account's starter adoption would hold about 180 shared rows until its commit
  and queue other accounts' runtime issuance and binding inserts.
- R1-2 (advisory): the planned binding-row, Idle error-precedence and equal-count
  tests were missing; the small-pool bound's comment claimed more than it checked.
- R1-3 (advisory): the lock test caught any `DBAPIError`, had no positive control
  and locked one Reaction only.
- R1-4 (advisory): `_starter_reactions`' docstring still said "one cell's".

#### Code Review #1 Revisions

- R1-1 accepted. A composition declares immutable shared rows with
  `SHARED_CATALOG_ROWS_IMMUTABLE` in the session's `info` (decision P-9); both catalog
  reads then lock only owner rows (`get_visible_items` with one extra owner-row lock
  statement). Local behaviour is unchanged. Documented in
  `docs/backend/features/custom-animas-and-content.md`.
- R1-2 accepted. `tests/test_starter_loadout_batching.py` adds equal statement counts
  for one- and four-member pools and the first-failing-Idle-member precedence (stale
  before missing and the reverse); the tracked starter test asserts its bindings
  equal the policy's `(slot_key, catalog_item_id, kind, config)`. The small-pool
  bound was removed.
- R1-3 accepted. The new lock test locks an owner Idle Gesture and an Included
  Reaction, requires SQLSTATE `55P03` and checks both edits succeed after rollback;
  a second test proves the declaration leaves shared rows unlocked and owner rows
  locked, for the batch and the single-row read.
- R1-4 accepted: docstring corrected.
- Checks on tree `fe505f8`: the batching, Reaction pool, starter, loadout, creation,
  Idle pool and content catalog suites (104 passed); `uv run ruff check`, `ruff format
  --check` and `mypy` on the two touched source modules passed. `make mypy` was not
  run, and it failed on the new test (Code Review #2, R2-1).

#### Code Review #2 Findings

Targeted recheck (repair round 1) of tree `2387f28`: R1-1 to R1-4 resolved. Its
side-by-side comparison found 16 statements and identical binding rows without the
declaration, 18 statements and identical rows with it, and no shared row locked with
it (a `FOR NO KEY UPDATE NOWAIT` probe on shared rows succeeds). Hosted RLS limits the
owner-row lock to the current owner's rows.

- R2-1 (blocking): `tests/test_anima_starters.py` failed `make mypy`
  (`var-annotated` on the expected binding rows), so the full pre-push suite would fail.
- R2-2 (advisory): the comment and doc said catalog reads in general lock only owner
  rows; only the two loadout reads honour the declaration, and `lock_items` still
  locks shared rows.
- R2-3 (advisory): the Cloud follow-up was recorded only here.

#### Code Review #2 Revisions

- R2-1 accepted: the expected rows are annotated; `make mypy` passes (854 files).
- R2-2 accepted: the comment and doc name `get_visible_item` and `get_visible_items`
  and state that `lock_items` and reconciliation lock as before.
- R2-3 accepted: Cloud's hosted-first-run ExecPlan (Phase 3, the repin that adopts
  this build) now requires setting the declaration on owner sessions and extending
  `IncludedLockTests` to the batched reads.
- Repair rounds used: 2 of 2.
- Checks on tree `6e08bdb`: `make mypy` (854 files) passed; the affected suites above
  (104 passed); `python3 scripts/heavy-slot.py -- make check-test` (root, full
  pre-push suite): 4721 passed, 29 skipped.

#### Code Review #3 Findings

Final targeted recheck (repair round 2) of tree `6e08bdb`: pass. R2-1 to R2-3
resolved; no executable source changed since round 2, so its behaviour checks hold
(16 statements without the declaration, 18 with it, identical rows, no shared row
locked). It reran `make mypy`, ruff and the starter and batching suites (28 passed).

- R3-1 (advisory): the hosted requirement lives in Cloud's plan only for its Phase 3
  repin; state it in this plan's PR too, so any Cloud adoption of the build sees it.
- R3-2 (advisory): record the checks run on tree `6e08bdb`.

#### Code Review #3 Revisions

- R3-1 accepted: the PR's risks section will carry the hosted requirement (P-9).
- R3-2 accepted: recorded above.

### Phase 2: Idle first, eight workers, milestones

Review tier: standard (high risk if P-1 renames the existing marks).

- `RuntimeMountPreparer.start`: compute Idle refs from the Idle roots' members not
  already essential; split the optional members into an Idle stage and the rest;
  run them in order, resolving a new `idleReady` promise after the Idle stage
  (rejected on abort or failure; resolved at once for an empty pool). Readiness
  publishing is unchanged. Until Phase 3, the JSON bundle joins the Idle stage when
  it holds Idle members.
- Default concurrency `?? 8`.
- Record the three milestones from `AnimaRouteProviders` (first posed frame,
  `idleReady`, `settled`), with `performance.mark(name, { detail: { mount } })`,
  cleared on unmount.
- Docs: `docs/frontend/architecture/local-content-runtime.md` (preparation order and
  marks).
- Tests (`RuntimeMountPreparer.test.ts`, new `runtimePreparationTimings.test.ts`): no
  non-Idle request starts before `idleReady`; Idle roots are ready while others are
  pending; eight held members in flight by default and not a ninth; budget and abort
  tests still pass; mark names and details.
- Validation: `pnpm --dir src/frontend/web exec vitest run src/lib/runtime-content`,
  `pnpm verify`, `pnpm prettier:check`.

Check record (before review), on tree `92ff416` over `92ecfe4d`:

- `npx vitest run src/lib/runtime-content src/ui/app` (`src/frontend/web`): 140
  passed; the four new preparer tests and two timing tests failed first.
- `npx tsc -b` and eslint on the touched files passed.
- `python3 ../../scripts/heavy-slot.py -- pnpm verify` (`src/frontend`): 541 files,
  5319 passed, 1 skipped; `pnpm prettier:check` passed.

#### Code Review #1 Findings

Standard-tier review of tree `92ff416`. It reran the runtime-content and route tests
(140 passed) and probed the preparer against the baseline in a scratch harness.

- R1-1 (blocking): a bundle fallback in the Idle stage ran on one worker. The other
  Idle workers had exited by the time the fallback jobs were queued, so up to about
  170 JSON members would load one at a time before `idleReady` (probe: 1 in flight
  against 4 or 8 on the baseline).
- R1-2 (advisory): the bundle joined the Idle stage before the budget pass, so a
  fallback or an over-budget member loaded non-Idle JSON members before
  `idleReady`; the doc overstated the guarantee and still listed four milestones.
- R1-3 (advisory): no test covers how the route records the milestones.

#### Code Review #1 Revisions

- R1-1 accepted. Each stage's worker pool tops itself up to its bound whenever jobs
  wait, including fallback jobs queued late. Test: a failed Idle-stage bundle loads
  both Idle members at once.
- R1-2 accepted. The bundle joins the Idle stage only after the budget pass, when
  every member is optional, reserved and bundleable; on a fallback there, its
  non-Idle members wait for the later stage. Tests: the fallback test above (the
  other members start only after `idleReady`) and an unusable bundle kept out of the
  Idle stage. The doc qualifies the guarantee and lists five milestones.
- R1-3 not adopted: no route-provider test harness exists, and Phase 5's measurement
  reads these marks on a built stack, so missing marks fail it visibly.
- Checks on tree `bc86022`: `npx vitest run src/lib/runtime-content src/ui/app` (142
  passed; the two new tests failed first), `npx tsc -b`, eslint and prettier passed.

#### Code Review #2 Findings

Targeted recheck (repair round 1) of tree `97cf55c`: R1-1 and R1-2 resolved (probe:
8 in flight during a fallback, no non-Idle request before `idleReady`).

- R2-1 (blocking): the pool's worker promises had no handler until the await loop
  reached them in order, so a cancellation while the first worker was busy with
  signal-ignoring work left the others' `AbortError` rejections unhandled (probe: 7
  on the new tree, 0 on the baseline); a browser journey would likely fail on such
  page errors.
- R2-2 (advisory): `active` dropped in a `.finally` microtask, so a fallback's top-up
  could start one worker fewer.

#### Code Review #2 Revisions

- R2-1 accepted: each worker's failure is observed when it starts and the first is
  rethrown after all settle. Test: cancelling while one worker is busy leaves no
  unhandled rejection (it failed before the fix).
- R2-2 accepted: a worker decrements `active` in its own `finally`, before its
  promise settles.
- Checks on tree `20ee5be`: `npx vitest run src/lib/runtime-content src/ui/app` (143
  passed), `npx tsc -b`, eslint and prettier passed. Repair rounds used: 2 of 2.

#### Code Review #3 Findings

Final targeted recheck (repair round 2) of tree `20ee5be`: pass. R2-1 and R2-2
resolved (its abort probe: no unhandled rejection; fallback probe: 8 in flight, no
non-Idle request before `idleReady`, all files admitted). Two advisory wording points
in this record (R3-1: say "would likely fail"; R3-2: name the checked tree), both
applied.

### Phase 3: Plural bundles: contract and backend

Review tier: high risk (shared API, contract and generated client).

- Rename `domain/runtime_json_bundle.py` to `runtime_bundles.py` with
  `select_runtime_bundles(catalog)`: a pure function used at issuance and when
  serving; excludes the avatar and voice closures; partitions Idle JSON, Idle binary,
  other JSON and other binary; sorts by `file_ref`; packs next-fit within P-4's
  limits; drops single-member bundles; at most 32.
- `PyRuntimeBundle` and `PyAnimaRuntime.bundles` replace `PyRuntimeJsonBundle` and
  `json_bundle`; the `/bundles/{bundle_id}` route replaces `/json-bundle` on
  `ReadContent` with the per-file route's checks (snapshot owner and revision 404,
  expired lease 409, unknown bundle 404, one `authorize_files`, descriptor fact
  checks, per-member verified reads, drift recorded in a separate write session).
  JSON bundles keep their envelope; binary bundles use P-3's frame through
  `ports.file_response`.
- Inventory, `server/schemas/runtime_content.py`, `pnpm openapi-ts`, local-http
  10.0.0, `@animama/runtime-contracts` 0.10.0. The client reads JSON bundles from
  `bundles` and ignores binary ones until Phase 4.
- Docs: `docs/backend/architecture/http-api.md` and `docs/backend/architecture/local-content-storage.md`.
- Tests: `tests/test_anima_runtime_bundles.py` (selection order, limits, determinism,
  bundle-id stability; route checks, per-member errors, 304 only after every check,
  the binary frame's layout and length), the owner-scope tests and the inventory
  tests.
- Validation: targeted pytest, `make check-test`, `pnpm openapi-ts:check`,
  `pnpm packages:build && pnpm packages:check && pnpm packages:test`, `pnpm verify`.

Implementation notes (Phase 3): a bundle ID is the full SHA-256 hex of
`animama-runtime-bundle/1`, the format and the sorted refs; the binary frame is
served as `application/octet-stream` through `ports.file_response` (revalidatable
only when every member was read), so a composition's byte policy applies; selection
also leaves out the voice's closure, as the client's essential stage loads it; the
client ignores a binary bundle (its members load individually), takes each JSON
bundle whose members are optional, reserved and in no earlier bundle, and still
lets the loader reject a malformed advertisement (duplicate refs fail its members
without fallback).

Check record (before review), on tree `40ab07c` over `f5f75c8b`:

- `uv run pytest -q tests/test_anima_runtime_bundles.py tests/test_product_http_anima_runtime.py tests/test_product_http_inventory.py tests/test_openapi*.py`:
  35 passed; `uv run ruff check`, `ruff format --check` and `make mypy` passed.
- `pnpm openapi-ts:check` (generated SDK current), `pnpm packages:build`,
  `pnpm packages:check` and `pnpm packages:test` passed (`src/frontend`).
- `npx vitest run src/lib/runtime-content` (138 passed) and `npx tsc -b`
  (`src/frontend/web`).
- Full pre-push suite through `scripts/heavy-slot.py`: `make check-test` 4725 passed,
  29 skipped; `pnpm verify` 541 files, 5326 passed, 1 skipped; `pnpm web:test:browser`
  and `pnpm prettier:check` passed.

#### Code Review #1 Findings

High-risk review of tree `d324942` (one analysis reviewer, one checks reviewer); both
passed with advisories only. The checks reviewer reran the touched and wider issuance
suites (35, 68 and 201 passed), ruff, `make mypy`, `openapi-ts:check`, the package
checks and tests, vitest (138), `tsc -b` and eslint, rebuilt runtime-contracts
byte-identically, and showed in scratch copies that the binary-frame and plural-bundle
tests fail on the baseline and on three frame mutations. The analysis reviewer
confirmed selection agrees with the client's essential and Idle derivations, the
route's authority order, the frame layout, the version policy and old-tab fallback
(an old tab's `/json-bundle` request gets 404 and loads members individually).

- R1-1 / R1-C1 (advisory): `docs/backend/architecture/http-api.md` still named
  local-http 9.0.0 for the capability schema and "JSON bundles" in the router list;
  the plan named a nonexistent `docs/backend/api/http-api.md`.
- R1-2 (advisory): `licenses/source-review.json` still listed the three old paths.
- R1-3 (advisory): `ProductPorts.file_response`'s docstring did not mention the
  in-memory bundle frame it now also delivers.
- R1-4 (advisory): no test fetches an issued bundle URL through a real stored
  snapshot.
- R1-5 (advisory): Cloud follow-ups at its repin (tests reading `json_bundle`, tenant
  inventory paths, `openapi.json`, admitting local-http 10).
- R1-C2 (advisory): the loader test's `id` case was rejected by the URL check, not
  the new ID check.

#### Code Review #1 Revisions

- R1-1, R1-C1, R1-2, R1-3, R1-C2 accepted and applied: the doc sentences and the plan
  path corrected; the three license records renamed (and kept sorted); the docstring
  notes the frame; the `id` case now has a matching URL, and fails with the ID check
  removed.
- R1-4 not adopted: the fake-runtime tests cover owner, revision, expiry and unknown
  bundles, Cloud tests the issued URL against stored snapshots, and Phase 5's
  measurement fetches real bundles on a built stack, where a silent fallback would
  show as per-member requests.
- R1-5: for Cloud's repin; noted in Cloud's hosted-first-run plan (Phase 3).
- No repair round was needed (no blocking finding); the advisories were applied after
  the review, with the affected checks rerun.

### Phase 4: Binary bundles in the client

Review tier: high risk (integrity boundary).

- Generalize `RuntimeJsonBundleLoader` into a bundle loader: advertisement checks per
  format; status mapping unchanged (network error, 404 and 5xx fall back once; 401,
  403, 409 and other 4xx fail without fallback); the binary frame is validated whole
  (magic, header, exact member set and sizes, total length) before any member is
  verified; each member is verified against its descriptor hash before admission.
- Preparer planning: a bundle is used only when all its members are optional,
  reserved and not failed; Idle bundles join the Idle stage; bundled members are
  never requested individually.
- Tests: success without individual requests; a corrupt member isolated; a malformed
  frame admits nothing and does not fall back; fallback once on 404/503/network;
  403/409 fail; Idle bundles before `idleReady`; budget skip; abort admits nothing.
- Validation: `vitest` for `runtime-content`, `pnpm verify`.

Implementation notes (Phase 4): `RuntimeJsonBundleLoader` became `RuntimeBundleLoader`
(`RuntimeBundleUnavailable`; the preparer option is `bundleLoader`), with per-format
advertisement limits; a frame header is at most 64 KiB and the frame is read with a
bound of its advertised bytes plus 8 and the header limit. `readBoundedResponseBytes`
backs both the JSON and the frame reads.

Check record (before review), on tree `371da78` over `3a6b5ea8`:

- `npx vitest run src/lib/runtime-content` (155 passed), `npx tsc -b` and eslint
  (`src/frontend/web`).
- Full pre-push suite through `scripts/heavy-slot.py`: `make check-test` 4725 passed,
  29 skipped; `pnpm verify` 541 files, 5343 passed, 1 skipped; `pnpm web:test:browser`
  and `pnpm prettier:check` passed.

#### Code Review #1 Findings

High-risk review of tree `49879f4` (one analysis reviewer, one checks reviewer); both
passed with advisories only. The reviewers reran vitest (155), `tsc -b`, eslint and a
wider 643-test scratch run; fed frames built by the server's `binary_bundle_frame`
(including 64 UUID refs, non-ASCII text and real PNGs, whole and in 7-byte chunks) to
the TS loader; and ran the new tests on the baseline (15 of 16 binary tests fail
there) and against mutations of the frame validator and the preparer.

- R1 (advisory): a transport failure while reading the body (after the headers) did
  not fall back, contrary to the doc.
- R2 / R1-C2 / R1-C3 / R1-C4 (advisory): no test pinned the binary advertisement
  limits, the 64 KiB header bound, the frame read bound, a duplicate binary header
  entry or the preparer's binary media-type filter (those mutations survived).
- R3 / R1-C1 (advisory): `licenses/source-review.json` still listed
  `RuntimeJsonBundleLoader.ts`.
- R4 (advisory): the binary media types were defined twice.
- R1-C5 (advisory): `LIMITS[bundle.format]` also matched inherited properties.

#### Code Review #1 Revisions

- R1 accepted: a `TypeError` while reading the body becomes `RuntimeBundleUnavailable`
  (the loader's own validation errors are plain errors and never fall back). Test: a
  frame stream that errors mid-read falls back once; it fails with the mapping
  removed.
- R2, R1-C2, R1-C3, R1-C4 accepted: tests for each binary limit (member size, total,
  65 members, a non-image type), a header over 64 KiB within the read bound, a body
  over the read bound, a header naming one member twice, and a binary bundle with a
  non-image member (loaded one by one; fails with the filter removed). The header
  bound is defence in depth: the size and length checks also reject such a frame.
- R3, R1-C1 accepted: the license record renamed, kept sorted.
- R4 accepted: the preparer imports `BINARY_BUNDLE_MEDIA_TYPES` from the loader.
- R1-C5 accepted: `Object.hasOwn(LIMITS, bundle.format)`.
- Checks after the revisions: `npx vitest run src/lib/runtime-content` (164 passed),
  `npx tsc -b`, eslint and prettier passed. No repair round was needed.

### Phase 5: Cacheable revision members and the after-measurement

Review tier: high risk (privacy and caching, ports contract).

- `ProductPorts.file_response(..., immutable=False)`: the local composition sends
  `private, max-age=31536000, immutable` when set; the runtime file route and
  successful binary bundles pass it. `VerifiedByteLoader` and the bundle loader fetch
  with `cache: "default"` and retry once with `cache: "reload"` after a verification
  failure. ADR and docs per P-7.
- Repeat the baseline measurement and record before and after in the PR.
- Tests: the port's headers; the route and a successful bundle are immutable and a
  bundle with errors is not; the loader's cache mode and its single reload retry.
- Validation: the full pre-push suite and the full browser journeys
  (`pnpm e2e:test`, required for loadout and Anima changes) on a built named stack.

Measurement (a new installation's first starter mount, Chromium with CDP network
events, first-run setup completed through the UI; one run per row; script kept
outside the repository). First frame, Idle ready (after Phase 2) and Settled are
User Timing marks measured from the `manifest-ready` mark; the before rows' Idle
column and Last response are CDP network times from the start of the runtime
request, about 0.3–0.4 s earlier, so those columns do not compare with the marks.

| Build | Latency | Runtime byte requests | First frame | Idle ready | Settled | Last response |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `e8c3233a` (before) | 0 ms | 539 + 1 JSON bundle | 518 ms | ~2,600 ms (last Idle member, network) | 2,280 ms | 2,699 ms |
| `e8c3233a` (before) | 40 ms | 539 + 1 JSON bundle | 524 ms | ~7,350 ms (last Idle member, network) | 7,311 ms | 7,753 ms |
| this branch | 0 ms | 4 + 14 bundles | 538 ms | 608 ms | 1,126 ms | 1,449 ms |
| this branch | 40 ms | 4 + 14 bundles | 497 ms | 571 ms | 1,037 ms | 1,404 ms |

The descriptor names 1,199 members in both. A warm remount of the same revision in
a persistent browser profile (disk cache), on this branch: the same 18 requests, 14
answered by the browser cache without a request (the 4 files and 10 binary
bundles) and the 4 JSON bundles revalidated with 304 (CDP reports a revalidated
response as 200 from the network; the wire status was 304). Playwright's default
in-memory context cache evicts the larger binary bundles, so it understates reuse.

Check record (before review), on tree `389dbe9` over `aa3593e0`:

- `make check-test` 4725 passed, 29 skipped; `pnpm web:test:browser` and
  `pnpm prettier:check` passed (heavy slot).
- `pnpm verify`: 1 failure, `poseContent.test.ts` reused one mocked `Response` for
  the new reload retry ("ReadableStream is locked"); fixed to a fresh response per
  read. On tree `bf13c66`: `npx vitest run src/lib/runtime-content src/ui src/lib/content`
  (1,993 passed), and the checks reviewer's `pnpm verify` (541 files, 5,355 passed,
  1 skipped, `bundle:source` built).
- `pnpm e2e:test` on the built `m630after` stack: 38 passed, 2 failed.
  `avatar-effect-direct-manipulation` timed out in `page.unroute` during the full
  run and passes alone (9.8 s). The `@complete-anima` imported-playback journey's
  pose-clip playback proof fails alone too, and fails the same way on a clean
  `e8c3233a` stack (`m630base` from a detached `e8c3233a` worktree): "Playback proof
  for anima_pose_clip/… did not pass within 5000ms (25 samples)" at
  `accountless-imported-playback.spec.ts:1227`. It predates this plan.

#### Code Review #1 Findings

High-risk review of tree `bf13c66` (one analysis reviewer, one checks reviewer); both
passed with advisories only. The analysis reviewer checked every `file_response`
caller (only the runtime file route and complete binary bundles become immutable),
that a revision URL always names the same bytes, the retry paths and the privacy
consequences for the accountless local composition (ADR 0002). The checks reviewer
reran 184 backend and 1,993 frontend tests, `make mypy`, `tsc -b`, eslint and the full
`pnpm verify`, mutation-tested both loaders and the backend flags, matched the
measurement JSON to the table and confirmed the journey claims from the logs and a
trace.

- R1-1 (advisory): a reload that failed in transport after a malformed first read
  fell back to individual requests, contrary to requirement 3.
- R1-2 / R1-C3 (advisory): tests did not pin a size-mismatch reload, that a
  server-reported member error is not reloaded, or an abort between reads.
- R1-3, R1-4, R1-5 (advisory): the ADR implied reuse across revisions, overstated
  the drift consequence (issuance hashes every member, and the watcher reports
  changes), spoke of signing out for an accountless app, lacked an Evidence section;
  `http-api.md` did not state the file route's policy.
- R1-6 (advisory): `immutable` overrode "never store".
- R1-7 / R1-C5 (advisory): hosted must accept the new `immutable` keyword before it
  adopts this build; name it with P-9 as an adoption follow-up.
- R1-8 / R1-C1 / R1-C2 (advisory): the before rows counted the JSON bundle twice; the
  caption mixed start points; runs per row unstated; no warm-remount evidence.
- R1-9 / R1-C6 (advisory): the rerun after the `poseContent` fix named no tree;
  Progress still listed the baseline measurement as open.
- R1-C4 (advisory): nothing pinned the content routes' local cache policy.
- R1-C7 (advisory): the direct-manipulation failure was dismissed by an isolated
  pass only; the final full journeys should confirm it.

#### Code Review #1 Revisions

- R1-1 accepted: when the reload fails, the loader returns the first read's results
  (members already verified) or rethrows its error, never a fallback. Test: a
  malformed first read whose reload gets 503 admits nothing and does not fall back
  (fails with the old behaviour).
- R1-2, R1-C3 accepted: tests for a truncated cached file and a truncated JSON bundle
  member (both reloaded once), the bundle fetch counts in the isolation test
  (digest: default then reload; server error: one read), and an abort before the
  reload (no second read).
- R1-3, R1-4, R1-5 accepted: ADR 0028 corrected (same revision only; drift found at
  every issuance, only a change within one mount goes unnoticed on a cache hit, and
  the bundle route's check is named; remote self-hosting instead of signing out; an
  Evidence section), and its index row aligned; `http-api.md` states the file route's
  policy and that cache hits skip its checks.
- R1-6 accepted: `local_file_response` lets no-store win; test added.
- R1-7, R1-C5 accepted: listed with P-9 as a hosted adoption requirement (here and in
  the PR); Cloud's plan already records it.
- R1-8, R1-C1, R1-C2 accepted: table corrected (539 + 1), start points named, one run
  per row stated, warm-remount evidence added.
- R1-9, R1-C6 accepted: trees named; Progress updated.
- R1-C4 accepted: `test_local_content_delivery` asserts `private, no-cache` exactly.
- R1-C7: the final integration run of the full journeys will confirm it.
- Checks after the revisions: backend `pytest` on the ports, delivery, bundle and
  local content tests (45 passed) and ruff; `npx vitest run src/lib/runtime-content src/lib/content`
  (495 passed), `npx tsc -b`, eslint and prettier. No repair round was needed.

## Final integration review

Combined acceptance against #630, including cross-phase behaviour (an Idle bundle
under the budget, fallback during the Idle stage, cached members after a remount).
Then the full pre-push suite once on the final candidate; its results go in the PR.

## Validation and acceptance

The issue's acceptance: the preparer tests (Idle first, concurrency, binary bundle
success, corruption, fallback, authorization failure, budget), the backend tests
(bundle route checks, limits, per-member errors, bounded starter-loadout
statements with identical results) and the before-and-after measurement from the
milestones. Commands are in each phase.

## Idempotence and recovery

Each phase is additive on the branch and can be rerun. Generated clients and
contract versions are regenerated, never hand-edited. The bundle route is a delivery
hint: a client that cannot use it falls back to per-member requests, so a rollback
of the server keeps old and new clients working (new clients fall back on 404).
Starter loadout batching changes no stored shape; a failed batch rolls back the
transaction as today.

## Outcomes & Retrospective

Not started.
