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
| Plan/commit | same file, `_plan`, `_apply_planned`, `_set_exclusion`, `_starter_gesture_keys` | `disable_starter`/`restore_starter`; an add lifts a matching exclusion unless `keep_starter_exclusions` |
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
  is required.
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
- [ ] Phase 1: batched creation writes.
- [ ] Phase 2: explicit Gesture rows end to end.
- [ ] Final integration review, full pre-push suite, full `pnpm e2e:test`, PR.

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

Check record: (pending)

Results: (pending)

#### Code Review #1 Findings

(pending)

#### Code Review #1 Revisions

(pending)

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
   `keep_starter_exclusions`, `_PlannedChange.starter_ids`, `_set_exclusion`
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

Check record: (pending)

Results: (pending)

#### Code Review #1 Findings

(pending)

#### Code Review #1 Revisions

(pending)

## Final integration review

Covers combined acceptance (R1–R5, the statement bound, the unchanged model
Gesture list) and the documented Cloud adoption requirements, reusing the phase
evidence. Then the full pre-push suite once on the final candidate, and the full
`pnpm e2e:test` on a disposable built stack (`ANIMAMA_WEB_BUILD_MODE=production`),
through the heavy slot. Their results go in the PR.

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

(pending)
