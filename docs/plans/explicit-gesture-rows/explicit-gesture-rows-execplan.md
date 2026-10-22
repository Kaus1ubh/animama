# Store Anima Gestures as explicit binding rows

Source agreement: [raymond-van/animama#648](https://github.com/raymond-van/animama/issues/648)
(the issue is the spec), read 2026-10-21 at its original revision.
Authorized scope: the whole plan, after owner review of this plan and its
open decisions.

## Purpose and context

An Anima's AI-callable Gestures currently come from two layers that every
reader merges:

- **Implicit starters.** `anima_loadouts.starter_catalog_version` selects
  `resources/starter-loadout.v1.json`; each of its 140 `gestures` counts as
  equipped unless `anima_loadouts.starter_exclusions` names it
  (`{"slot": "gesture", "runtime_id": <starter id>}`).
- **Explicit rows.** `anima_content_bindings` rows at `gesture:<semantic_key>`.

After this plan an Anima's Gestures are exactly its `gesture:` rows. The starter
policy's `gestures` list becomes a creation-time template, copied into rows by
local creation (`AnimaLoadoutService.initialize`, through the creation request)
and by the hosted starter step (`create_starter_loadout`). Removing a Gesture
removes it; nothing reappears. Reaction and Idle pools already work this way and
do not change; the policy version stays because Reaction `origin`, cell `state`
and the Reaction `restore_starter` read it.

Creation also writes rows in batches. Today `initialize` plans and writes each
Gesture separately (a locked read, a full visible-catalog scan for dependency
counts, the aggregate revision, a slot lookup and an insert) and each Reaction
separately. Measured before this work (see Surprises): about 2,705 statements
and 15.6–19.1 s per supplied starter inside `initialize`.

Merge points removed (file and current role):

| Area | File | Current implicit-starter handling |
| --- | --- | --- |
| Read model | `src/backend/animama/app/services/anima_loadout_service.py` `read_model` | Adds non-excluded starters as `origin="starter"` bindings; returns `disabled_starter_gestures`; stashes `starter_gesture_implementation_kinds` on the service |
| Plan/commit | same file, `_plan`, `_apply_planned`, `_set_exclusion`, `_starter_gesture_keys` | `disable_starter`/`restore_starter`; an add lifts a matching exclusion (creation kept them through a `keep_starter_exclusions` flag, removed in Phase 1) |
| Creation | same file, `initialize`, `_create_root`, `create_starter_loadout` | Excludes all 140 starters, then adds rows; the hosted path writes no Gesture rows |
| Runtime mount | `anima_runtime_service.py` `_selections` | Adds non-excluded starters as `origin: "starter"` roots |
| Export | `anima_package_source_service.py` `capture`/projection | Validates exclusions; exports non-excluded starters not shadowed by a row |
| Content transition | `adapters/repositories/sqlalchemy/content_transition_repo.py` `_content_selections` | Emits implicit starter selections (still keyed by starter id) and writes rows for them on replacement |
| Fences | `content_transition_repo.py`, `app/ports/content_transition.py`, `anima_package_source_repo.py`, `app/ports/anima_package_source.py` | Snapshot `starter_exclusions` |
| Presentation | `anima_presentation_repo.py`, `domain/anima_presentation.py`, `domain/anima_loadout.py` (`StarterEntryIdentity`) | Reads exclusions into a field nothing consumes |
| Policy helpers | `starter_loadout_policy.py` | `starter_gesture_id`, `starter_gesture_semantic_key` exist only for the readers above |
| Schema | `orm/anima_loadout.py`, `alembic/versions/0001_baseline.sql` | `starter_exclusions` column and its array CHECK |
| Contract | `app/contracts/anima_loadout.py`, `product_http/routes/loadouts.py` | `disabled_starter_gestures`, `starter_gesture_implementation_kinds`, Gesture `starter_id`, `disable_starter`/`restore_starter`, `PyGestureBinding.origin`, plan action `leave_empty` |
| Frontend | `web/src/lib/loadout/animaLoadoutPresentation.ts`, `ui/animas/GestureLoadoutSection.tsx`, `ui/animas/AnimaLoadout.tsx`, `ui/action-manage/ActionManageDialog.tsx`, `lib/content/catalogTypes.ts`, locales, `scripts/fixtures/hosted-workflows-http.mjs` | Starter badge, starter-only Equip/Equipped intents, synthetic disabled-starter rows, no overflow menu on starter rows |

The frontend Gesture list already lists every ready Local and Included Gesture
with Equip ([anima management](../../frontend/features/anima-management.md)),
so a removed starter Gesture stays visible as an unequipped Included row.

Boundaries: Cloud implementation is out of scope (it adopts at a repin; the PR
documents the requirements below). Which Gestures are starters, and the Reaction
and Idle pool models, do not change. No Alembic revision: the ORM and
`0001_baseline.sql` change together.

### Cloud adoption requirements (for the PR)

From a read-only survey of Animama Cloud `main` at `9affbe1f`:

- Starter step: `ensure_starter_loadouts` calls `create_starter_loadout`, which
  now writes the starter Gesture rows and returns its diagnostics; no call change
  is required, but Cloud discards the returned tuple today, so an unavailable
  starter (R5) is visible only if Cloud logs or records it.
- Schema: the hosted forward-only history keeps `anima_loadouts.starter_exclusions`
  and its CHECK (`009_hosted_content_runtime.sql`); the shared-ORM schema-drift
  test fails until a new hosted migration drops them (precedent:
  `016_hosted_idle_pool.sql`). Existing hosted loadouts lose their implicit
  starters unless Cloud's migration first writes rows for them or hosted staging
  is reset (D2).
- Tests that encode implicit starters change: starter loadouts with
  `origin == "starter"` Gestures, the `disable_starter` loops before export (the
  #555 exception, now unnecessary) and the `starter_gesture_implementation_kinds`
  projection test.
- Contract: `local-http` major bump (below); Cloud widens its compatibility
  bounds and reviewed-contract row, regenerates its OpenAPI export and re-lists
  the adapted shared modules in its tenant inventory.
- The `SHARED_CATALOG_ROWS_IMMUTABLE` lock rule from #636 still applies: the
  starter Gesture reads use `get_visible_items`, which honours it.

## Progress

- [x] Plan drafted (2026-10-21) on `refactor/explicit-gesture-rows` from
  `fc825a9b`.
- [x] Owner decisions D1 and D2 (2026-10-21); #648 R4 amended.
- [x] Owner approved the plan for all phases (2026-10-22).
- [x] Phase 1: batched creation writes (review passed after one repair round).
- [x] Phase 2: explicit Gesture rows end to end (review passed after one
  repair round; the voice-picker browser failure is pre-existing).
- [x] Final integration review passed (no repair round).
- [ ] Full pre-push suite on the final candidate, full `pnpm e2e:test`, PR.

## Surprises & Discoveries

- 2026-10-21, before any change (`fc825a9b`, Python 3.12.13, testcontainers
  PostgreSQL on the development Mac): `AnimaStarterService.ensure` creating both
  supplied starters from the tracked Included content took 26.7 s and 29.4 s in
  two runs, 5,571 statements. Instrumented, `initialize` took 19.1 s and 15.6 s
  with 2,705 statements per starter. A third run on 2026-10-22 (warmer host):
  19.5 s for both, `initialize` 9.0 s and 8.5 s, creation-source resolution
  (closure and byte checks, effects included) 0.3 s per call. Timings vary
  about 2x between runs; this plan reports before/after on the same harness
  in one session.
- Support content (Pose Clips, Avatar/Particle/Scene Effects, sounds) is never
  written at creation: it is reached through Gesture and Reaction closures. Its
  only creation cost is `_dependency_counts`, which today rereads the whole
  visible catalog once per Gesture; one walk over one read covers it after
  Phase 1, so no separate effect batching is needed (owner question,
  2026-10-22).
- `content_transition_repo._content_selections` still derives an implicit
  starter's slot from its id (`air-quotes`), not its declared key; #647 did not
  reach it. Removing implicit selections removes the defect.
- `initialize` also writes Reactions one at a time (a locked read and an upsert
  per member), so bounding creation's statement count needs both families
  batched.
- `create_starter_loadout` discards its unavailable-Reaction warnings; R5 asks
  for a diagnostic.
- Open PR #639 also bumps `local-http` to 11.0.0. The compatibility check
  compares against the PR base, so whichever lands second takes the next major.

## Decision Log

- 2026-10-21, owner (recorded in #648): store Gestures as explicit rows; #647
  merged as the interim fix.
- 2026-10-21, agent proposal: remove `PyGestureBinding.origin` (every binding
  would be `custom`) and the plan action `leave_empty` (only `disable_starter`
  produced it). Keep `starter_version` and the Reaction `restore_starter`/`revert`.
- 2026-10-21, agent proposal: `create_starter_loadout` returns its
  `LoadoutDiagnostic`s (`starter_gesture_unavailable`,
  `starter_reaction_unavailable`) instead of `None`, which satisfies R5 for the
  hosted path; local creation already reports `recommended_source_unavailable`
  in creation options.
- 2026-10-21, agent proposal: Phase 1 batches `initialize`'s Reactions as well
  as its Gestures, because the performance constraint pins creation's total
  statement count.
- D1, 2026-10-21, owner: drop the Gesture restore. No "Restore starter
  Gestures" action; re-adding a removed starter is one Equip in the existing
  list, and no Gesture state is starter-specific.
- D2, 2026-10-21, owner: follow the baseline-only policy; no conversion code.
  Every local loadout since the repository split comes from `initialize` (all
  starters excluded, every Gesture a row) or the hosted-only
  `create_starter_loadout`, so an unreset local database keeps its Gestures. It
  loses only starters that the per-Gesture Equip re-enabled implicitly, which
  the owner re-equips; the left-over column keeps its default and is ignored.
  Cloud converts or resets hosted staging at adoption, as
  `016_hosted_idle_pool.sql` did. R4 in #648 is amended to match.

- 2026-10-22, owner: approved this plan for implementation of all phases,
  including the agent proposals above.
- 2026-10-22, agent (Phase 2): the Gesture list's "Custom first" sort lists
  Local Gestures before Included ones, as the Library's sort of that name does,
  instead of ordering by the retired starter/custom kind.
- 2026-10-22, agent (Phase 2): remove what only served the implicit layer:
  `get_included_by_logical_keys` (#647), the `included_by_logical` argument of
  `content_consumers`, the `loadout` argument of the runtime `_selections`, and
  the frontend wording of `starter_gesture_unavailable` and
  `starter_id_required` (the former is now a hosted-only creation diagnostic;
  an unworded code falls back to its English message). Snapshot fences keep
  `starter_catalog_version`.
- 2026-10-22, agent (Phase 2): record the decision as ADR 0030 (open PR #639
  claims 0029) and bump `local-http` to 11.0.0 and `@animama/runtime-contracts`
  to 0.11.0; whichever of this PR and #639 merges second takes the next numbers.

## Phased implementation

### Phase 1: batched creation writes

Review tier: high risk (persistence write path for every new Anima).

Requirements: R2's bounded statement count; the performance constraint. No
behavior or contract change: the same rows, configs and errors as today,
including the creation exclusions, which Phase 2 removes.

Steps (`src/backend/animama/app/services/anima_loadout_service.py`):

1. Let `_insert_bindings` take each member's config, so Gesture rows keep their
   `config_overrides`.
2. In `initialize`, resolve every Gesture and Reaction source with one locked
   `_targets` read per family, keep the stale-revision check
   (`loadout_source_stale`) and the first failing member's error, reject a
   repeated semantic key with `gesture_semantic_key_conflict`, and insert each
   family with one statement. Run one `_dependency_counts` over both families
   (one visible-catalog read; it still refuses an unconverted Avatar Effect).
   Avatar, voice and appearances keep their per-intent `_plan` path (at most
   four intents).
3. Tests (TDD, `tests/test_anima_starters.py` and the creation tests): a starter
   creation's `initialize` statement count is bounded independently of its
   Gesture and Reaction counts (pinned constant in `tests/statement_counting.py`);
   the created rows (slots, catalog ids, configs) equal the per-intent result;
   a stale or repeated source fails as before.
4. Re-measure with the same harness and record before/after in Results.

Checks: the touched tests; `uv run ruff check`; then the full pre-push suite
(`python3 scripts/heavy-slot.py -- make check-test`; no frontend change) before
review.

Completion: checks pass, the statement bound is pinned, timings recorded,
review passes. Commit `perf(loadout)[p1]: write creation Gestures and Reactions in batches`.

Recovery: the change is confined to creation; revert the phase commit.

Starting source: `487cf745` (plan commit on `fc825a9b`).

Check record (working tree `fa608eaf`, root, Python 3.12.13):

- `uv run pytest -q tests/test_anima_creation_batching.py` before the change:
  the statement test failed (`[121, 175]`), the error-order and
  repeated-key tests passed (they pin existing behavior). After: 4 passed.
- `uv run ruff check` and `uv run ruff format --check` on the touched files:
  passed.
- `uv run pytest -q -n 4` over the creation, loadout, starter, Reaction/Idle
  pool, package import/export and portable Anima tests (18 files): 221 passed.
- `uv run pytest -q tests/test_anima_starters.py -k tracked_checkout` with the
  new supplied-starter bound: passed.
- `python3 scripts/heavy-slot.py -- make check-test` (typed-content audit,
  format check, lint, mypy, pytest with 2 workers): passed, 4,733 passed and
  29 skipped.

Results:

- `_exact_targets` locks and types a new loadout's exact sources in one read
  (shared by the Idle seed, Gestures and Reactions); `_insert_bindings` takes
  per-slot configs. `initialize` writes Gestures and Reactions with one insert
  each and one dependency walk; `keep_starter_exclusions` went with the
  per-Gesture path. Avatar, voice and appearances keep `_plan`.
- Error order (accepted deviation, P1-R1-F1): codes and rows are unchanged,
  but the checks now run in this order: every Gesture's availability and
  revision (the first failing Gesture decides), a repeated semantic key, every
  Reaction's availability and revision, then the dependency refusal over both
  families. The per-intent path checked each Gesture fully before the next, so
  a request with two simultaneous faults can report the later check's code.
- Tests: `tests/test_anima_creation_batching.py` (statement count independent
  of 1 vs 4 Gestures and Reactions, with each row's slot, item and distinct
  config; first failing member per family; repeated semantic key; refusal of a
  Gesture behind an unconverted Avatar Effect) and `SUPPLIED_STARTERS_STATEMENTS = 300` on the tracked-content
  creation of both starters.
- Timing, same harness and session (scratch probe around
  `AnimaStarterService.ensure`, not committed), two runs each:

  | | Both starters | Statements | `initialize` per starter | Statements per `initialize` |
  | --- | --- | --- | --- | --- |
  | Before (`fc825a9b`) | 18.6 s, 19.6 s | 5,571 | 8.3–8.9 s | 2,705 |
  | After | 2.7 s, 3.0 s | 267 | 0.23–0.29 s | 53 |

- Docs: the materializer paragraph of `custom-animas-and-content.md` states the
  batch invariant.

#### Code Review #1 Findings

Reviewed source: `487cf745` plus the working tree (tree `6d64985f`, which
differs from the check-record tree only in this plan).

Checks subagent (independent rerun, high-risk tier): `ruff check` and
`ruff format --check` on the four changed Python files passed; `mypy` (the
Makefile target's arguments) passed, 856 files; the 18 affected test files
with `-n 4` through the heavy slot: 221 passed. Regression proof in a
temporary detached worktree at `487cf745` with only the new and changed tests
copied in: the creation statement test failed with `[121, 175]` and the
supplied-starter bound with `5571 <= 300`; the worktree was then removed.

Analysis subagent (`sdlc-reviewer`, no reruns; confirmed the code and doc
blobs match tree `fa608eaf`): rows, configs, locks, the conflict check and the
dependency refusal are equivalent; `keep_starter_exclusions` had no other user
(Cloud included).

- P1-R1-F1 (required): the `initialize` docstring and these Results claimed
  the first failing member still decides; with two simultaneous faults the
  order differs (a repeated key before a later unavailable Gesture; an
  unconverted Avatar Effect before a repeated key).
- P1-R1-F2 (required): plan step 3 asks that created rows match by slot, item
  and config; the test checked only catalog ids, and no test created several
  configured Gestures.
- P1-R1-F3 (optional): no test covers creation's refusal of an unconverted
  Avatar Effect, and the comment did not say the walk exists to refuse.
- P1-R1-F4 (optional): Phase 2 step 2 still lists `keep_starter_exclusions`.

#### Code Review #1 Revisions

- F1 accepted: the docstring and Results state the actual check order, recorded
  as an accepted deviation (restoring per-member order would add code for
  double-fault requests only).
- F2 accepted: the statement test gives each Gesture a distinct
  `time_scale` and asserts every `gesture:`/`reaction:` row's slot, item and
  config.
- F3 accepted: the comment names the refusal, and
  `test_creation_refuses_a_gesture_behind_an_unconverted_avatar_effect` covers
  it through `materialize`.
- F4 accepted: Phase 2 step 2 no longer lists the flag.
- Verification: `ruff check`/`ruff format` on the two files passed;
  `tests/test_anima_creation_batching.py` 5 passed. Mutation check: dropping
  the dependency walk and the per-slot config made the refusal and statement
  tests fail (2 failed, 3 passed); the source was then restored.
- Repair budget: one of two rounds used; targeted recheck below.

#### Code Review #2 Findings

Targeted recheck of P1-R1-F1 to F4 (same reviewer; high-risk reruns): all four
resolved, no regression (the production change since review #1 is a docstring
and a comment). Rerun: `pytest -q tests/test_anima_creation_batching.py
tests/test_anima_materializer.py tests/test_anima_starters.py` 63 passed;
`ruff check` on the service and the batching test passed. Result: pass.

#### Code Review #2 Revisions

None needed. Phase 1 passed with one of two repair rounds used.

### Phase 2: explicit Gesture rows end to end

Review tier: high risk (schema, API contract, generated client, every loadout
reader).

Requirements: R1, R3, R5 and R2 for the hosted path. R4 is met by D2 (reset or
re-equip; no conversion code).

Backend steps:

1. `read_model`: list only `gesture:` rows; drop the starter loop, the
   `starter_gesture_unavailable` read warning, `disabled_starter_gestures` and
   the stashed implementation kinds; sort by name.
2. `_plan`/`_apply_planned`: drop `disable_starter`/`restore_starter`,
   `_PlannedChange.starter_ids`, `_set_exclusion`
   and `_starter_gesture_keys`. Add, update, reconfigure and remove are
   unchanged.
3. `_create_root` and `initialize`: no exclusions.
   `create_starter_loadout`: resolve the policy's Gestures like its Reactions
   (one shared helper for both families: Included by logical key, one locked
   read), write them under each document's declared key in one statement, leave
   an unavailable one out, and return the diagnostics. Keep the existing
   statement guard (`STARTER_LOADOUT_STATEMENTS`) or raise it by the two added
   statements, independent of pool and Gesture counts.
4. Readers: remove the starter loop from `anima_runtime_service._selections`
   (Gesture rows keep `origin: "catalog"`), from the export projection (with
   `package_anima_exclusions_invalid` and, if unused, `package_anima_starter_unavailable`),
   and implicit selections from `content_transition_repo` (`binding_id` becomes
   required; drop the starter fields and the row-insert branch of
   `replace_content`).
5. Drop `starter_exclusions` from the ORM, the baseline SQL (column and CHECK),
   the transition and package-source snapshots, the presentation record and
   `StarterEntryIdentity`; drop `starter_gesture_id` and
   `starter_gesture_semantic_key` and update the policy module docstring.
6. Contract: remove `disabled_starter_gestures`,
   `starter_gesture_implementation_kinds`, Gesture `starter_id` and
   `disable_starter`/`restore_starter`, `PyGestureBinding.origin` and plan
   action `leave_empty`. Bump `contracts/versions.json` `local-http` to the next
   major over the PR base (11.0.0 unless #639 lands first) and the
   `@animama/runtime-contracts` package version for the changed declarations.
7. Tests: replace the implicit-starter assertions in
   `test_starter_gesture_semantic_keys.py`, `test_anima_starters.py`,
   `test_portable_anima.py`, `test_content_consumer_transition.py`,
   `test_music_retirement_transition.py`, `test_product_http_loadouts.py` and
   the fixtures that set `starter_exclusions`. New coverage:
   - R1: an unmodified hosted-path starter's read model, runtime selections and
     export list exactly its rows, under declared keys (`air_quotes`), and the
     runtime Gesture slots equal the policy's available starters (the model's
     list is unchanged).
   - R2/R5: `create_starter_loadout` writes one row per available starter
     Gesture under its declared key, leaves an unavailable one out and returns
     `starter_gesture_unavailable`.
   - R3: removing a starter Gesture from a created and a hosted-path Anima leaves
     it out of the read model, runtime and export.
   - A retired `disable_starter` intent is rejected by the contract.
8. Docs: `docs/backend/architecture/data-model.md` (loadout root),
   `docs/backend/features/custom-animas-and-content.md` (starter loadout),
   `docs/backend/architecture/http-api.md` (Gesture operations).

Frontend steps (`src/frontend`):

1. Regenerate the SDK offline (`pnpm openapi-ts`) and update
   `lib/content/catalogTypes.ts`.
2. `animaLoadoutPresentation.ts`: one row kind; drop the starter/custom split,
   `disabledStarter`, synthetic `starter-disabled:` rows and `starterId`. Keep
   the Included de-duplication an explicit Included binding still needs. Remove
   the custom-first sort if it only orders by kind.
3. `GestureLoadoutSection.tsx`, `AnimaLoadout.tsx`, `ActionManageDialog.tsx`:
   Equip sends `add`, Unequip sends `remove`, every row has the overflow menu, no
   Gesture Starter badge, no `leave_empty` label.
4. Remove the unused locale keys (`loadout.review.actions.leave_empty`,
   `loadout.starter_id_required` and `loadout.starter_gesture_unavailable` if no
   client still receives it), regenerate `i18n/resources.d.ts` with i18next-cli,
   and update `hosted-workflows-http.mjs`.
5. Update the affected unit tests and `docs/frontend/features/anima-management.md`
   ("Disable, and Restore" and the custom-first sort).

Checks: touched backend tests, `uv run ruff check`, the import-boundary script,
`pnpm openapi-ts:check` (or the documented freshness check), then the full
pre-push suite (`make check-test`; `pnpm verify`, `pnpm web:test:browser` and
`pnpm prettier:check` from `src/frontend`) through the heavy slot before review.
Browser check (agent, in-app browser, desktop viewport then narrow): on a task
stack, equip and remove an Included and a Local Gesture, confirm no Starter badge
or starter state, and that a removed Gesture stays removed after reload.

Completion: R1, R3, R5 and hosted R2 tests pass; no source reference to
`starter_exclusions`, `disabled_starter_gestures`, `starter_gesture_implementation_kinds`
or a Gesture `disable_starter`/`restore_starter` remains outside history plans;
checks and review pass. Commit `refactor(loadout)[p2]: store Anima Gestures as explicit rows`.

Recovery: development databases are reset after the schema change
(`./reset.sh --name <stack> --purge` for a task stack). Reverting the phase
restores the column only for databases created afterwards.

Starting source: `774ae198` (Phase 1).

Check record (working tree, root unless noted, Python 3.12.13):

- New `tests/test_explicit_gesture_rows.py` before the change: 4 of 5 failed
  (no `starter_gestures`, retired intents accepted); the created-path case
  passed, as local creation already stored rows. After: 5 passed.
- `uv run pytest -q -n 4` over 25 affected files (creation, loadouts, starters,
  pools, packages, portable Anima, transitions, presentations, runtime
  admission, previews, HTTP loadouts): 258 passed.
- `uv run mypy src/backend/animama tests ...` (Makefile arguments): passed,
  856 files. `ruff check`/`ruff format` on touched Python files: passed.
- `uv run --no-sync python scripts/repository-boundary/check-python-imports.py`:
  0 forbidden edges.
- From `src/frontend`: `pnpm openapi-ts` regenerated the SDK;
  `pnpm openapi-ts:check` current; `pnpm i18n:check` passed;
  `pnpm exec tsc -b` (web) passed; `pnpm exec vitest run` on the loadout,
  Gesture section, loadout page, Action Manage and error tests: 63 passed.
- `pnpm web:lint`: passed.
- Browser check (agent, in-app browser) on development task stack
  `gesture-rows` (base port 8800, fresh database, first-run setup and the 18+
  gate completed, no provider): Andrew's Gesture list read "140 equipped / 152
  total" with no Starter badge and a menu on every row. Removing Air Guitar
  showed a review with action `remove`; after a reload the list read 139 and Air
  Guitar was an ordinary unequipped row with Equip and its menu. Equip planned
  `add` and restored 140. The Library's Add / Manage dialog removed and
  re-equipped Air Guitar on Annie (`gestures:plan`/`commit` 200). At 375 px the
  list had no horizontal overflow. A Local Gesture was not exercised in the
  browser (no Local content on a fresh stack; its add/remove path is the same
  and unit-tested). The stack was then stopped with its volumes kept.
- Full pre-push suite (gate script through the heavy slot, tree `e1efaa53`,
  before the review #1 repairs): `make check-test` 4,732 passed and 1 failed
  (P2-R1-F1's baseline fingerprint), 29 skipped; `pnpm verify` passed;
  `pnpm web:test:browser` 121 of 122 passed; `pnpm prettier:check` passed.
  The browser failure is `voice-clone-library.browser.test.mjs` "picker
  filters expose keyboard gender tabs…" (`filter fits narrow picker` at 390 px),
  which this change does not touch. It fails at the base too: in a temporary
  worktree at `fc825a9b` it passed 1 of 6 runs (this branch 0 of 7). Not fixed
  here; reported as pre-existing.
- After the repairs (tree `2aed0f1c`): `make check-test` through the heavy
  slot passed, 4,733 passed and 29 skipped; the independent checks rerun is
  under Code Review #2. The frontend suite steps ran on frontend files the
  repairs did not change.

Results:

- Backend: the read model, runtime mount (`_selections`), package export and
  content transitions list only rows; `disable_starter`/`restore_starter`,
  exclusions, `_starter_gesture_keys`, `_set_exclusion`,
  `starter_gesture_id`/`starter_gesture_semantic_key` and
  `get_included_by_logical_keys` are gone. `_starter_members` resolves Included
  starter Gestures or Reactions in one locked read; `create_starter_loadout`
  writes the available starter Gestures under their declared keys with one
  insert and returns `starter_gesture_unavailable`/`starter_reaction_unavailable`
  diagnostics. The ORM and baseline drop `starter_exclusions` and its CHECK.
- Contract: `disabled_starter_gestures`, `starter_gesture_implementation_kinds`,
  `PyGestureBinding.origin`, Gesture `starter_id` and
  `disable_starter`/`restore_starter`, and plan action `leave_empty` removed;
  `local-http` 11.0.0, `@animama/runtime-contracts` 0.11.0, SDK regenerated.
- Frontend: one Gesture row kind; Equip adds, Equipped and Remove remove;
  every row has the Library/Remove menu; no Gesture Starter badge; Action
  Manage always removes by binding; "Custom first" lists Local Gestures first;
  retired locale and error keys removed.
- Tests: `tests/test_explicit_gesture_rows.py` (R2/R5 hosted rows and
  diagnostic; R1/R3 read model, runtime and export for a created and a
  hosted-path Anima, before and after a removal; retired intents rejected);
  `test_starter_loadout_batching.py` now includes starter Gestures in the
  lock, shared-row and statement tests; the tracked-content test asserts the
  hosted-path starter has the same 140 Gestures and keys as a created starter.
  `test_starter_gesture_semantic_keys.py` and the two implicit-starter export
  tests were removed with the layer; the transition tests use explicit rows.
- Docs: the starter-loadout, materializer, HTTP loadout, data-model and
  anima-management sections, the export note in typed content, and ADR 0030.


#### Code Review #1 Findings

Analysis subagent (`sdlc-reviewer`, no reruns while the suite ran; source
fingerprinted by `git diff 774ae198` and the new files' hashes). The suite's
`make check-test` meanwhile reported 4,732 passed and 1 failed (F1).

- P2-R1-F1 (required): `tests/test_alembic_fresh_install.py` pins the old
  baseline SHA-256; its fingerprint test fails.
- P2-R1-F2 (required): the R1 test filtered every reader to the two expected
  items, so an implied (even unresolved) Gesture root could not fail it.
- P2-R1-F3 (required): `contracts/hosted-web.md` and `http-api.md` still state
  `local-http` 10.0.0 and `runtime-contracts` 0.10.0.
- P2-R1-F4 (optional): the Reaction warning says "was not restored" when
  creation returns it, and the codes were built with an f-string, so they were
  no longer greppable.
- P2-R1-F5 (optional): the Cloud note should say Cloud discards the returned
  diagnostics.
- P2-R1-F6 (optional): the retired-intent test also sent `starter_id`, which
  `extra="forbid"` rejects on its own.
- P2-R1-F7 (optional): the HTTP doc's warning `params` example still names
  `semanticKey`.
- P2-R1-F8 (optional): a packaged desktop profile does not keep the old column;
  its schema check reports `database_schema_mismatch` until reset.
- P2-R1-F9 (pre-existing): `content_consumers`/`replace_content` have no
  production caller.
- P2-R1-F10 (pre-existing pattern): an unconverted Avatar Effect behind one
  starter Gesture makes `create_starter_loadout` fail instead of leaving that
  Gesture out, as for starter Reactions.

#### Code Review #1 Revisions

- F1 accepted: the pinned hash is the new baseline's
  (`67c1e040…703e`); the CREATE TABLE count is unchanged.
- F2 accepted: `_readers` compares every read-model Gesture, every runtime
  `gesture:` root and every exported Gesture, unfiltered. Mutation check: an
  extra unresolved `gesture:` root in `_selections` failed both paths (2
  failed); the source was then restored.
- F3 accepted: both docs state 11.0.0 and 0.11.0.
- F4 accepted: `_STARTER_UNAVAILABLE` maps each family to a literal code and a
  neutral message ("…is unavailable and was left out.").
- F5 accepted: the Cloud note says so.
- F6 accepted: the test validates the operation alone.
- F7 accepted: the example names `contentId`.
- F8 accepted: the data-model note separates Compose databases from desktop
  profiles.
- F9 deferred: removing the unused transition methods is outside #648; noted
  for a follow-up.
- F10 accepted residual: Included content is always converted (the
  tracked-checkout test passes), and starter Reactions already behave this way.
- Verification: `ruff check`/`ruff format` passed; `tests/test_explicit_gesture_rows.py`,
  `test_alembic_fresh_install.py`, `test_anima_reaction_pools.py` and
  `test_starter_loadout_batching.py`: 30 passed.
- Repair budget: one of two rounds used; targeted recheck and a `make
  check-test` rerun follow.

#### Code Review #2 Findings

Targeted recheck of P2-R1-F1 to F8 (same reviewer, no reruns): all resolved,
no regression; F9 deferred and F10 accepted residual are acceptable. Result:
pass, pending the independent rerun.

Checks subagent (independent high-risk rerun on tree `2aed0f1c`): `ruff check`
and `ruff format --check` over `src/backend` and `tests` passed (868 files);
mypy passed (856 files); import boundary 0 forbidden edges; 22 affected backend
test files with `-n 4` through the heavy slot: 240 passed;
`pnpm openapi-ts:check` current; `pnpm i18n:check` passed; web `tsc -b`
passed; vitest on the loadout, `ui/animas`, Action Manage and error tests: 132
passed; eslint on the touched frontend paths: clean. A grep (with
`--untracked`) for the retired identifiers finds only ADR 0030, the data-model
note and the retired-intent test.

#### Code Review #2 Revisions

None needed. Phase 2 passed with one of two repair rounds used.


## Final integration review

Covers combined acceptance (R1–R5, the statement bound, the unchanged model
Gesture list) and the documented Cloud adoption requirements, reusing the phase
evidence. Then the full pre-push suite once on the final candidate, and the full
`pnpm e2e:test` on a disposable built stack (`ANIMAMA_WEB_BUILD_MODE=production`),
through the heavy slot. Their results go in the PR.

### Final Integration Review #1 Findings

Reviewed source: `0c84ea54` (tree `220f7721`), baseline `fc825a9b`, both
phases at the high-risk tier; no checks run. The candidate tree differs from
the last checked tree (`2aed0f1c`) only in this plan, and no frontend file
changed after `e1efaa53`, so the phase evidence still applies. R1, R2 (local
and hosted, size-independent statement bounds), R3, R5, R4 per D2, the
unchanged model Gesture list (chat reads the projected `_selections` roots,
whose order and keys are unchanged; the tracked test matches the hosted-path
starter's 140 pairs to a created starter), the frontend, contract versions,
docs, ADR 0030 and the Cloud adoption notes (rechecked against Cloud
`9affbe1f`) were found consistent. No blocking finding.

- FI-R1-F1 (optional): `create_starter_loadout` keeps the first of two starter
  Gestures declaring one semantic key without a diagnostic, while `initialize`
  refuses the conflict.
- FI-R1-F2 (optional): the chat leg of acceptance rests on the runtime-mount
  tests and the snapshot path; state that the full e2e run is the direct
  evidence.
- FI-R1-F3 (optional): close this plan's Outcomes, update #648's ExecPlan
  section, and carry the Cloud adoption notes and the #639 collision in the PR.

### Final Integration Review #1 Revisions

- FI-R1-F1 accepted residual: the tracked test proves 140 distinct keys among
  the Included starters, and the code comment states the assumption; only
  malformed Included content could reach it.
- FI-R1-F2 accepted: the PR states it, with the full e2e result.
- FI-R1-F3 accepted: Outcomes below, #648 updated at PR time, the PR carries
  both notes.
- No repair round used; review passed.

## Validation and acceptance

- R1, R2, R3 and R5 each covered by named backend tests; R4 by D2.
- Statement-count tests for `initialize` and `create_starter_loadout`, both
  independent of Gesture and pool sizes; before/after creation time for both
  starters on the same harness.
- An unmodified starter Anima mounts, exports and chats with the same Gestures
  under declared keys.
- Frontend: equip and remove with no starter states; `pnpm verify` and the
  affected browser tests pass.
- Full `pnpm e2e:test` on a built stack.
- PR lists the Cloud adoption requirements above.

## Idempotence and recovery

Creation remains one transaction: a failed `initialize` or
`create_starter_loadout` leaves no loadout, and a retry recreates it. The schema
change applies to fresh databases; reset a task stack with `--purge` after it.
Task stacks are torn down after their last use.

## Outcomes & Retrospective

- An Anima's Gestures are exactly its binding rows on every path: creation and
  the hosted starter step copy the starter policy into rows, removal is final,
  and no reader merges an implicit layer. The `starter_exclusions` column, the
  Gesture starter operations and their API fields are gone (`local-http`
  11.0.0).
- Creating both supplied starters dropped from 18.6–19.6 s and 5,571 statements
  to 2.7–3.0 s and 267 statements on the same harness, with bounds pinned by
  tests.
- Remaining: Cloud adoption (its own migration, tests and contract admission);
  the optional removal of the unused `content_consumers`/`replace_content`
  (P2-R1-F9); the pre-existing voice-picker browser failure.
- Lessons: a test that filters readers to the expected items cannot prove
  "nothing else is implied" (P2-R1-F2); a schema edit must also update the
  pinned baseline fingerprint (P2-R1-F1).
