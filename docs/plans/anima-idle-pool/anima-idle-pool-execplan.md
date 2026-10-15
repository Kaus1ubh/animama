# Give every Anima one built-in Idle pool and replace Idle Styles

Source agreement: [anima-idle-pool-spec.md](anima-idle-pool-spec.md) (R1–R11,
owner decisions D1–D10 of 2026-10-14), published as parent
[#559](https://github.com/raymond-van/animama/issues/559).
Authorized scope: the whole plan (owner, 2026-10-14).
Branch: `feat/anima-idle-pool` in its own worktree. Starting revision:
`2e18090b` (`origin/main`, 2026-10-14). One PR for the whole plan.

## Purpose and context

Idle motion moves from reusable Idle Style content to a pool that every Anima
owns. After this plan:

- each Anima's loadout has an `idle` pool (Default plus emotion/intensity cells
  of Gestures), seeded at creation, edited in `/animas/` and exported with the
  Anima;
- the runtime snapshot carries the pool's eligible Gestures and pool membership,
  and the planner waits 90 seconds of quiet between idle stints;
- the `idle_style` content kind, its routes, editor, Library and sharing
  surfaces, conversion code and the Included Streamer Idle set are gone.

### Current implementation (baseline `2e18090b`)

Backend (`src/backend/animama`):

- **Content kind.** `ContentKind.IDLE_STYLE` (`domain/content_catalog.py`) is
  registered in `app/services/content_kind_registry.py` (folder `idle-styles`,
  v2 validation `_idle_style_v2`, legacy v1 paths, projections). Typed APIs live
  in `app/contracts/idle_style.py`, `app/contracts/typed_content.py`
  (`PyIdleStyle`) and `product_http/routes/typed_content.py` (`/v1/idle-styles`
  list, get, `:preview`, save). Save calls `validate_idle_style`
  (`app/services/typed_content_service.py`), which resolves each Gesture and
  reads finite playback facts through `app/services/idle_playback.py`.
- **Loadout.** The selected Style is one `anima_content_bindings` row
  (`kind='idle_style'`, `slot_key='idle-style'`) plus
  `anima_loadouts.idle_style_empty`. `AnimaLoadoutService`
  (`app/services/anima_loadout_service.py`) reads it, plans/commits
  `idle-style:plan|commit` (`product_http/routes/loadouts.py`) and initialises
  it from `ResolvedAnimaSpec.idle_style` (creation always passes `None`, so new
  Animas start empty). Read, runtime, package capture and transition code fall
  back to `builtin:idle-style:starter`, which no longer exists.
- **Reactions model.** Each Reaction cell is one binding row
  (`reaction:<emotion>-<intensity>`), unique per `(anima_id, slot_key)`, with a
  `RESTRICT` foreign key to the catalog item. Binding rows block deletion of
  Local items (`catalog_item_in_use`) and feature-pack removal.
- **Runtime.** `AnimaRuntimeService._selections` turns bindings into roots;
  `runtime_content_closure.py` validates the whole Idle Style root (any bad
  Gesture drops the whole root); `typed_runtime_projection.py` emits
  `idle_style {default_pool, cells, gestures[]}` keyed by Gesture item id, with
  binding ids `idle:<item_id>` and private support ids.
- **Packages.** `PortableAnima.idle_style` is a nullable entry id.
  Non-portable Gestures inside an Idle Style are stripped and recorded as
  references (`non_portable_packages.py`, `content_package_export.py`), and
  import rebinds them (`content_package_import.py`).
- **Conversion.** `content_transition_service.convert_idle_styles` converts v1
  Styles at startup and rescan.
- **Seed sources.** `content/included/idle-styles/streamer-idle/` (12 Included
  Gestures, Default of 7, Moderate/Strong cells). The Mixamo pack `v2`
  (`resources/mixamo-motion-manifest.json`) bundles
  `idle-styles/mixamo-emotive-idle/` over five `builtin:gesture:mixamo-idle-*`
  Gestures. `scripts/acquire-mixamo.py` writes a Local `mixamo-starter` Style.
  The scanner only walks registered kind folders, so an unregistered
  `idle-styles/` folder is ignored.

Frontend (`src/frontend`):

- `web/src/lib/runtime-content/runtimeSnapshotAdapter.ts` adapts
  `idle_style` into `idle_animations` and `idle_style_pools`;
  `AnimaRuntimeCatalog.idlePool` resolves `cell ?? default`;
  `RuntimeMountPreparer` treats the Style as one root.
- `web/src/lib/avatar/planner/AvatarPlanner.ts` schedules stints
  (`DEFAULT_IDLE_STINT_QUIET_INTERVAL_SEC = 180`).
- `/animas/` loadout: `ui/animas/AnimaLoadout.tsx` hosts
  `IdleStyleLoadoutSection.tsx` (Style picker, read-only pools) beside
  `ReactionLoadoutGrid.tsx`.
- `ui/creator/IdleStyleEditorPage.tsx` holds the pool editor and the
  `GesturePoolEditor` picker with eligibility checks
  (`query/hooks/useIdleGesturePlayback.ts`).
- Library, sharing, catalog API/types, preview adapters, create-Anima draft
  (`default_idle`), locales, e2e journeys and fixture scripts reference
  Idle Styles.

Cloud's hosted API mirrors the loadout schema and route lists. It adopts this
change separately when it moves to the new package set; nothing here imports
or edits Cloud.

## Progress

- [x] Plan review by the owner (2026-10-14).
- [x] Workspace setup: parent #559, phase issues #560 and #561 (2026-10-14).
- [x] Phase 1: backend Idle pool replaces Idle Style (#560; review passed after two repair rounds).
- [x] Phase 2: frontend Idle grid, removal of Idle Style surfaces, 90 seconds (#561; review passed after two repair rounds).
- [ ] Final integration review, full validation and PR.
- Remaining owner gate: manual idle playback check in chat (see Validation).

## Surprises & Discoveries

- 2026-10-14: `builtin:idle-style:starter` exists only in test fixtures. Its
  fallbacks make a reverted Idle read as empty while the runtime reports an
  unresolved root and Anima export fails. Removing the kind removes this path.
- 2026-10-14: the scanner walks only registered kind folders, so Mixamo pack
  `v2` can keep its Emotive Idle file without a manifest change (D8).
- 2026-10-14: a Reaction cell holds one item; there is no pool precedent in
  the binding table. Pool members therefore use one binding row each.

## Decision Log

- 2026-10-14, owner: D1–D9 in the spec (seed contents, no migration, no old
  packages, rename identifiers, drop "No idle", union merge, immediate edits,
  keep pack `v2`, 90 seconds).
- 2026-10-14, owner: D10 keeps Mixamo idles to the cells Emotive Idle maps
  them to (its happy Default is not used); approved the plan and authorized all
  phases. The agent proposals below were accepted with the plan.
- 2026-10-14, agent proposal (for plan review): store each pool member as an
  `anima_content_bindings` row of kind `idle_gesture` with slot
  `idle:<cell>:<catalog_item_id>`, where `<cell>` is `default` or
  `<emotion>-<intensity>`. Rows reuse the unique key, cascade with the Anima and
  keep the existing deletion and pack-removal protection. A JSON column would
  need new protection logic.
- 2026-10-14, agent proposal: the seed is a tracked resource holding the
  precomputed D6/D10 seed by logical key. Creation filters it to visible,
  idle-eligible Gestures, then clears any cell whose members equal Default, so
  an installation without the Mixamo pack gets exactly Streamer Idle.
- 2026-10-14, agent proposal: one runtime root per distinct pool Gesture
  instead of one root per Style, so a bad member drops alone (R6).
- 2026-10-14, implementation: pool rows keep `kind='gesture'` (the bound item's
  content kind) and take their role from the `idle:` slot, instead of a new
  `idle_gesture` kind. Existing kind conversions, deletion protection and
  pack-removal checks then apply unchanged; AI-callable Gesture code filters on
  the `gesture:` slot prefix.
- 2026-10-14, implementation: an Idle add checks finite playback against exact
  bytes, so the `idle:plan|commit` routes pass the request's content store to
  the loadout service; other families never open files.
- 2026-10-14, owner: fold the follow-up cleanup into this PR. Removing the Idle
  Style editor left `lib/content/contentEditRecovery.ts` without a production
  caller; Phase 2 deletes it and moves the hosted recovery tests and fixture to
  Action editor recovery keys. Session purges keep the `animama:content-edit:`
  prefix so drafts the retired editor left behind still end with their session.

## Phased implementation

### Phase 1: backend Idle pool replaces Idle Style

Requirements: R1–R4, R6 (backend), R7–R11 (backend). Issue:
[#560](https://github.com/raymond-van/animama/issues/560). Working directory: repository root. Starting source:
`2e18090b`.

Steps:

1. **Tests first.** Add failing tests for the new contract, replacing the Idle
   Style tests that encode removed behavior:
   - loadout: a new Anima reads the seed with and without a `mixamo-motion`
     source; add/remove in Default and a cell; duplicate, unknown, non-Gesture
     and ineligible members rejected without a revision change; no remove-all,
     replace or unselect operation; deletion of a pooled Local Gesture blocked;
   - runtime: pool projection by item id, idle members absent from AI
     Gestures, one ineligible member skipped with a diagnostic;
   - packages: complete-Anima export/import round trip of the pool,
     non-portable member omitted and rebound or dropped with a notice, imported
     Anima not reseeded;
   - removal: no `/v1/idle-styles` routes or `idle_style` schemas in OpenAPI;
     a Local `idle-styles/` folder is ignored by rescan.
2. **Persistence.** In `orm/content_catalog.py` and `0001_baseline.sql`:
   remove `idle_style` from `CONTENT_KINDS` and the binding kind/slot checks;
   let `gesture` rows also use the slot shape `idle:%` (see the Decision Log).
   Drop `anima_loadouts.idle_style_empty` (`orm/anima_loadout.py`, baseline
   SQL) and update the baseline fingerprint test.
3. **Domain and contracts.** Replace `IdleStyleBinding` with an `IdlePool`
   (Default and cells of member summaries: binding id, item id, logical key,
   name, availability). Replace `PyAnimaIdleStyle`, `PyIdleStyleIntent` and
   the plan/commit requests with `PyAnimaIdle` and `PyIdleIntent`
   (`operation: add | remove`, optional `emotion`/`intensity` for a cell,
   `source` for the Gesture). Move `PyIdlePlayback` into an `idle` contract
   module and delete `app/contracts/idle_style.py` and its server schema.
   `PyAnimaLoadout.idle_style` becomes `idle`.
4. **Loadout service and routes.** In `AnimaLoadoutService`: family `idle`;
   read the pool from Gesture rows with `idle:` slots; plan validates the cell, resolves
   the Gesture with `_target`, checks finite playback with
   `read_gesture_idle_playback` and rejects duplicates; removal names the
   member's `binding_id`; commit upserts or deletes one row and records reason
   `loadout_idle_update`.
   Remove every `builtin:idle-style:starter` fallback. Replace
   `idle-style:plan|commit` with `idle:plan|commit` in
   `product_http/routes/loadouts.py` and `product_http/inventory.py`. Add new
   error codes to `src/frontend/web/src/lib/errors/userVisibleCodes.json` in
   Phase 2.
5. **Seed and creation.** Add the tracked seed resource under
   `src/backend/animama/resources/` with the D6/D10 seed (Default 7, 56 explicit
   cells by logical key) and a loader. `AnimaLoadoutService.initialize` seeds
   when `ResolvedAnimaSpec` carries no pool and uses the package pool when it
   does. Remove `default_idle` from creation options, `idle_style` from
   `SourceKind` and dead idle checks in `anima_creation_sources.py`. Starter
   Animas get the seed through the same path.
6. **Runtime.** `_selections` adds one idle root per distinct pool Gesture
   (with a priority entry) carrying its cells; the closure reads finite facts
   per root and drops a failing root with a diagnostic; the projection emits
   `idle {default_pool, cells, gestures[]}` with only admitted Gestures and
   keeps private support identities. Remove the Idle Style root path and the
   v1 projection.
7. **Packages.** `PortableAnima.idle` holds Default and cells of Gesture entry
   ids (required, may be empty). Capture writes the rows; non-portable members
   become `anima_slot: "idle"` references with their pools; import rebinds or
   drops them and materialises the pool. Remove `idle_style` from package root
   kinds, non-portable reference kinds, archive and capability checks; keep
   the finite-playback check for pooled Gesture entries.
8. **Remove the kind.** Delete `ContentKind.IDLE_STYLE` and its registry
   definitions, v1/v2 documents, typed content routes and schemas,
   `validate_idle_style`, save/preview branches, `CONTENT_TYPE_DIRECTORIES`
   entry, `reset.sh` folder creation, `convert_idle_styles` and the transition
   repo/port idle methods, and the Idle parts of the test-only
   `content_consumers` path. Keep `idle_playback.py`,
   `idle_clip_validation.py` and `GET /v1/gestures/{item_id}/idle-playback`.
9. **Content and scripts.** Delete `content/included/idle-styles/`; remove its
   licence inventory rule and `licenses/source-review.json` entries (including
   the stale `idle-styles/starter` entry); drop the root from
   `runtime/starter_content.py`; remove stale `.gitignore`/`.dockerignore`
   lines; make `scripts/acquire-mixamo.py` and `scripts/mixamo-assets.json`
   install Gestures only. Update
   `scripts/repository-boundary/consumers/contracts.py`. The hosted-app
   consumer fixture mirrors the frontend routes and runtime, so it moves with
   them in Phase 2.
10. **Contract versions.** Bump `local-http` to `8.0.0` in
    `contracts/versions.json` and update `contracts/hosted-web.md`; package
    version bumps follow in Phase 2 with the regenerated client.
11. **Docs.** Add ADR 0026 (per-Anima Idle pool replaces Idle Style; partly
    supersedes ADR 0018 decision 3) and update the ADR index and 0018 status;
    replace the Glossary "Idle Style" entry with "Idle"; update
    `docs/backend/features/custom-animas-and-content.md`,
    `typed-content-and-marketplace.md`, `architecture/http-api.md`,
    `data-model.md`, `local-content-storage.md`,
    `operations/mixamo-motion-pack.md` and `content/included/README.md`.

Checks (repository root):

```bash
uv sync --python 3.12.13
uv run pytest -q
make check-test
git grep -n -i -E "idle[_ -]?style|IdleStyle" -- src/backend tests scripts content
```

The final search may list only intentional history (ADRs, older plans).

Completion: new and updated backend tests pass, `make check-test` passes,
OpenAPI no longer exposes Idle Style operations, and Code Review #1 has no
supported blocking finding. The frontend does not typecheck against the new
contract until Phase 2; that is expected within this branch.

Recovery: the change is confined to the branch; reset the development
database of the task stack (`./reset.sh --name <stack> --purge`) after schema
edits. No production data exists.

Results (2026-10-14): implemented as above. New tests:
`tests/test_anima_idle_pool.py` (loadout add/remove per cell, rejections without
a revision, unavailable members, deletion protection, intent contract, runtime
selection), `tests/test_starter_idle_pool.py` (seed with and without the Mixamo
Gestures, unavailable/ineligible seed Gestures), the runtime closure idle test,
the leftover `idle-styles/` rescan test and the package idle round trips. About
30 existing test files were adapted; `tests/test_content_idle_transition.py`
was deleted with the conversion. `make check-test` passes: typed-content audit,
ruff format/lint, mypy (842 files), pytest 4441 passed, 29 skipped. The Python
import boundary and contract-consumer checks pass. Expected limitation: the
frontend does not typecheck against the new contract until Phase 2.
Commit: `b5fa2d73` `feat(idle)[p1]`.

#### Code Review #1 Findings

Reviewed source: baseline `2e18090b` plus the uncommitted Phase 1 working tree
(independent read-only reviewer, 2026-10-14). Checks the reviewer ran: ruff
check/format on `src/backend/animama` and `tests`, mypy on the changed services,
the Python import boundary, and 80 targeted tests; a read-only comparison of the
seed with the baseline Streamer Idle and Mixamo Idle documents (exact Streamer
match; Mixamo differs only where the Local `sway` loop is absent, per D10).

- F1 (required): `content/README.md` still listed `idle-styles` as a typed
  folder; `tests/test_pose_clip_v2.py` docstring named Idle Style eligibility.
- F2 (required, record-only allowed): Phase 1 step 9 claimed the hosted-app
  consumer fixture update, but `server.mjs`/`server.test.mjs` still route
  `idle-styles` and send `idle_style`.
- F3 (optional): a rebound non-portable Idle member is not checked for finite
  playback on import; the `initialize` comment claimed it was.
- F4 (optional, latent): readers took the member's item id from the slot, while
  the test-only content transition rewrites only `catalog_item_id`.
- F5 (optional): removing a member required `source.source`, which an
  unavailable member (no `source`) cannot supply.
- F6 (optional): no test exercised runtime selection from stored idle rows.
- F7 (optional): stale wording in `development.md` (Idle sources), the Included
  README Gesture count, ExecPlan steps 2 and 4, and the `PyIdleMember` docstring.
- F8 (optional): seed-key flattening repeated five times; seed cells built
  without `idle_cell_key` validation.
- F9 (observation): removing the `mixamo-motion` source entirely is blocked
  while seeded pools bind its Gestures.

#### Code Review #1 Revisions

- F1 accepted: removed `idle-styles` from `content/README.md`; reworded the
  docstring.
- F2 accepted: the fixture mirrors frontend routes and runtime, so it moves to
  Phase 2 step 7; step 9 now says so.
- F3 accepted in part: the comment now states the actual guarantees. No import
  check added: rebound targets are the receiver's own Included Gesture with the
  sender's logical key, and runtime admission drops an ineligible member alone
  with a diagnostic (R6); adding it at commit would contradict the review's
  "rebound" outcome.
- F4 accepted: the read model, runtime selection and Anima capture now read
  `row.catalog_item_id`; the slot only names the cell. Transition docstring fixed.
- F5 accepted: `PyIdleIntent` `remove` takes only `binding_id` (and `add` only
  `source` plus cell); the service removes by member row. Tests updated.
- F6 accepted: `test_runtime_selects_one_idle_root_per_gesture_ahead_of_ai_gestures`.
- F7 accepted: all four corrected (Included README now says 111 Gestures).
- F8 accepted: `starter_idle_keys()` helper used by the resolver and four
  tests; every seed cell is validated with `idle_cell_key`.
- F9 accepted: one sentence in `docs/backend/operations/mixamo-motion-pack.md`.

Verification after revisions: ruff check/format clean; 132 affected tests pass
(`tests/test_anima_idle_pool.py`, loadout routes, seed, starters, Included
catalog/integrity, packages, portable, runtime closure, content consumers);
`make check-test` passes (4441 passed, 29 skipped; audit, ruff, mypy clean).

#### Code Review #2 Findings

Targeted recheck (repair round 1) of the Review #1 revisions: F1–F9 resolved or
recorded. Checks: ruff check/format, mypy on the revised files, 57 targeted tests.

- F10 (required, regression from F5): `docs/backend/architecture/http-api.md`
  and `docs/backend/features/custom-animas-and-content.md` still described
  removal as targeting a Gesture in a cell.
- F11 (optional, latent): duplicate detection compared slot text rather than
  the cell and `row.catalog_item_id`.
- F12 (optional): ExecPlan step 4 still named `idle_gesture` rows.
- F13 (nit): the F6 test comment named the wrong Gesture.

#### Code Review #2 Revisions

- F10 accepted: both docs state that `add` takes a `source` plus cell and
  `remove` takes the member's `binding_id`.
- F11 accepted: duplicate detection compares the cell and the stored
  `catalog_item_id`.
- F12, F13 accepted: wording corrected.

Verification: ruff and mypy clean on the service; `tests/test_anima_idle_pool.py`
and `tests/test_product_http_loadouts.py` pass (8). Remaining repair budget:
one round.

#### Code Review #3 Findings

Final targeted recheck (repair round 2): F10–F13 resolved; result **pass**, no
blocking findings. Residual note (no action): the test-only
`content_transition_repo.replace_content` can repoint an Idle row's
`catalog_item_id` without renaming its slot; nothing in production calls it.

### Phase 2: frontend Idle grid, Idle Style removal and 90 seconds

Requirements: R2, R5, R6 (frontend), R7, R8, R11. Issue:
[#561](https://github.com/raymond-van/animama/issues/561). Working directory: `src/frontend`. Depends on Phase 1.

Steps:

1. **Client.** Regenerate the SDK (`pnpm openapi-ts`, then `pnpm prettier`
   and `pnpm packages:build`). Bump `runtime-contracts` and `product-ui`
   versions where emitted declarations change, and the version text in
   `contracts/hosted-web.md`.
2. **Runtime.** Adapt `idle` instead of `idle_style` in
   `runtimeSnapshotAdapter.ts`, rename `idle_style_pools` to `idle_pools`
   (`types.ts`, `AnimaRuntimeCatalog.ts`, preview targets), drop the v1 path,
   and make `RuntimeMountPreparer` ready-check each idle Gesture's root on its
   own. Update `idleStyleProjection.test.ts` (renamed) for empty cells using
   Default and no `none` mode.
3. **90 seconds.** Set `DEFAULT_IDLE_STINT_QUIET_INTERVAL_SEC` to 90 in
   `AvatarPlanner.ts`, update `tests/avatar/AvatarIdlePlayback.test.ts`
   (`nextDueAtMs` 280_500) and `docs/frontend/runtime/avatar-planner.md`.
4. **Idle grid.** Replace `IdleStyleLoadoutSection.tsx` with an Idle section
   built on the Reaction grid shell (`ReactionLoadoutGrid.tsx`,
   `ActionLoadoutRows.tsx`): Default row, emotion rows with three intensity
   rows, member chips with Preview/Remove, an Add picker moved out of
   `GesturePoolEditor` with `useIdleGesturePlayback` eligibility, and "Uses
   Default" for empty cells. Add `planIdle`/`commitIdle` mutations that plan
   and commit in one action (no review dialog) with a fresh idempotency key,
   invalidating loadout and runtime; a stale revision refetches. Previews reuse
   the Gesture preview path (`idleStylePreviewTarget` renamed for Gestures).
5. **Remove surfaces.** Delete `IdleStyleEditorPage.tsx`, its routes
   (regenerate `routeTree.gen.ts`), `idleStyleDocument.ts` (keep the
   ineligibility messages beside the picker), `useIdleStyles.ts`,
   `idleStylePresentation.ts`, Idle Style branches in catalog API/types,
   preview adapters, Library inventory/filters/cards, export selection,
   sharing presentation and package details (show the Anima's Idle pool
   instead), query keys and invalidation, and create-Anima `default_idle` and
   `idle_revisions`. Delete `lib/content/contentEditRecovery.ts`, which only
   the editor used (owner decision above).
6. **Copy.** Rename user-visible text to "Idle" in `animas`, `library`,
   `actionEditor` and `errors` for en, ja, ko, zh-Hans and zh-Hant; update
   `i18n/terms.json`; add and remove error codes in `userVisibleCodes.json`;
   regenerate `resources.d.ts` with `pnpm i18n:extract`.
7. **Journeys and scripts.** Update e2e fixtures and journeys
   (`imported-playback`, `accountless-imported-playback`, `create-anima`,
   `preview-network`), `scripts/e2e/content-ledger.mjs`,
   `package-import-ownership.mjs`, `verify-accountless-journey.ts`,
   `web/scripts/fixtures/hosted-workflows-http.mjs`,
   `hosted-workflows.browser.test.mjs` and the hosted-app consumer fixture
   (`scripts/repository-boundary/consumers/hosted-app/server.mjs` and its test).
8. **Docs.** Update `docs/frontend/features/anima-management.md`,
   `library.md`, `custom-anima-creation.md`, `runtime/content-previews.md`,
   `avatar-animation.md`, `mixamo-acquisition.md`,
   `architecture/routing.md`, `data-layer.md`, `local-content-runtime.md` and
   `desktop/runtime-staging.md` where they describe Idle Styles.

Checks (`src/frontend`, after `git lfs pull` at the repository root):

```bash
pnpm openapi-ts:check
pnpm check
pnpm web:lint
pnpm web:test
pnpm build
pnpm desktop:check
```

Completion: all checks pass, no user-visible "Idle Style" string remains, the
Idle grid works on the task stack at desktop and narrow widths, and Code Review
#1 has no supported blocking finding.

Results (2026-10-14): implemented as above. Step 4 shipped as one
`changeIdle` mutation that plans and commits in a single action (documented in
`docs/frontend/architecture/data-layer.md`) rather than separate
`planIdle`/`commitIdle` mutations. The folded cleanup deleted
`lib/content/contentEditRecovery.ts`. New tests: `IdleLoadoutSection.test.tsx`,
`idleLoadoutGrid.test.ts`, `useAnimaLoadoutMutations.idle.test.tsx`,
`idlePoolProjection.test.ts`, `idlePreviewTarget.test.ts` and a per-member
`RuntimeMountPreparer` case. Frontend gate (`src/frontend`): `openapi-ts:check`,
`pnpm check`, `web:lint`, `prettier:check`, `e2e:check:source`,
`e2e:test:unit`, `web:test` (523 files, 4853 passed, 1 skipped), `build` and
`desktop:check` pass; the `hosted-workflows` (25/25) and `hosted-composition`
browser suites pass. Live API checks on the development stack: starter seed of
7 Default members and 44 cells, 12 eligible idle Gestures in the runtime,
`idle_gesture_ineligible` 409, add/remove by `binding_id`, stale revision 409.
Browser journeys run in the final validation.

#### Code Review #1 Findings

Reviewed source: the uncommitted Phase 2 working tree on `b5fa2d73`
(independent read-only reviewer, 2026-10-14). Checks: `openapi-ts:check`,
targeted vitest (121 tests), eslint, prettier, e2e tsc, script node tests.

- F1 (required): a failed eligibility check stored a reason that disabled the
  Gesture in the picker until it remounted; the old editor had a retry.
- F2 (required): `prettier:check` failed on three web files.
- F3 (required): no tests covered the immediate-apply path (plan then commit,
  fresh idempotency key, Default vs cell intent, refetch on failure).
- F4 (optional): a stale Idle edit showed "Review the change again", but Idle
  edits have no review step.
- F5 (optional, DRY): the picker shell and emotion rows repeat the Reaction
  grid's markup and strings.
- F6 (observation): eligibility shows only after a Gesture is chosen or cached.
- F7 (optional, a11y): disabling every Add trigger while a change applies drops
  keyboard focus.
- F8 (record): Phase 2 results and the `changeIdle` deviation unrecorded.
- F9 (in-flight): the removed `animama:content-edit:` purge prefix and fixture
  helpers placed between imports.
- F10 (gate): browser journeys not yet run.

#### Code Review #1 Revisions

- F1 accepted: only a known ineligible result (by Gesture revision) disables a
  choice; a failed check shows its message and choosing the Gesture checks
  again. Test: "keeps a Gesture selectable after a failed check, then retries it".
- F2 accepted: formatted; `prettier:check` passes.
- F3 accepted: `query/mutations/useAnimaLoadoutMutations.idle.test.tsx` covers
  plan then commit with the planned digest and distinct idempotency keys, no
  commit after a rejected plan, and Loadout/runtime refetch on settle;
  `idleAddIntent` (Default vs cell) is tested in `idleLoadoutGrid.test.ts`.
- F4 accepted: a revision conflict on an Idle edit says the Idle changed
  elsewhere and was refreshed (`idle.changedElsewhere`, all five locales).
- F5 deferred: sharing a shell with the Reaction grid would change that grid,
  which needs its own visual check; recorded as a follow-up candidate.
- F6 kept as designed (owner D7 and the on-demand check avoid reading every
  VRMA); stated in `anima-management.md`.
- F7 accepted in part: a pending change disables choices and Remove but keeps
  each Add trigger enabled, so focus returns to it. Focus after removing the
  last chip still falls back to the page.
- F8 accepted: recorded here.
- F9 accepted: the `animama:content-edit:` prefix stays purged for drafts the
  retired editor may have left; fixture helpers now follow the imports.
- F10: the full journey suite runs before the PR (Validation and acceptance).

Verification: 6 affected test files pass (81 tests); `hosted-workflows`
browser suite 25/25 and `hosted-composition` suite pass when run alone.
Remaining repair budget: two rounds.

#### Code Review #2 Findings

Targeted recheck of the Review #1 repairs and the folded-in cleanup (same
reviewer, same uncommitted tree). F1–F4, F7, F9 and the `contentEditRecovery`
removal verified; F5, F6 and F10 not reopened.

- R2-F1 (required): the new required `busy` prop was missing from the
  `IdleLoadoutSection` test's defaults, so `tsc -b` (`pnpm check`) failed.
- R2-F2 (optional): no test covered the `busy` behaviour.
- R2-F3 (optional): a "could not be checked" message outlived a passed retry.
- R2-F4 (optional): the Decision Log said the purge prefix was dropped, but it
  is kept.
- R2-F5 (optional): no test still proved a legacy `animama:content-edit:` row
  is purged with its session.

#### Code Review #2 Revisions

- R2-F1 accepted: the test passes `busy={false}`; the web `tsc` is clean.
- R2-F2 accepted: a test checks that Add stays enabled while choices and
  Remove are disabled during a change.
- R2-F3 accepted: an eligible result clears an earlier failure for that
  revision; the retry test asserts the message is gone.
- R2-F4 accepted: the Decision Log now says the prefix is kept.
- R2-F5 accepted: `recovery-session.test.ts` purges a legacy row.

Verification: affected tests pass (8 tests), web `tsc` and eslint clean.

#### Code Review #3 Findings

Final targeted recheck of R2-F1–R2-F5: all verified, no new findings. Checks:
web `tsc` clean; 3 affected test files (9 tests) pass; eslint and
`prettier:check` clean. **Pass.** Repair budget used: two rounds.

## Final integration review

Covers R1–R11 across both phases, the package-set compatibility comparison and
the full browser journeys. Reuses still-valid phase evidence.

_Pending._

## Validation and acceptance

Local, before opening the PR:

- Backend: `make check-test`.
- Frontend: the Phase 2 checks.
- Contracts: the package-set `build`/`compare` against a `main` baseline
  (`scripts/package-sets/README.md`).
- Browser journeys: `pnpm e2e:test` (full suite; loadout and import/export
  change) against a disposable built stack, torn down afterwards.
- Manual, agent: on a task stack (`./reset.sh --name idle-pool --base-port
  <free port>`, fresh database), create an Anima and open `/animas/`: the Idle
  section shows the seed; add and remove Gestures in Default and a cell,
  reload, preview, and try an ineligible Gesture.

Remaining owner gate: in chat, an Anima idles from its pool after about
90 seconds of quiet, with the Mixamo pack where installed. Hosted validation is
disabled; the PR records that no hosted CI ran unless the owner starts a run.

## Idempotence and recovery

Schema edits apply to fresh databases only; a task stack is reset with
`--purge` after them. Seed loading and pool commits are idempotent through the
unique slot key and idempotency receipts. Removing `content/included/idle-styles`
and the Local `idle-styles/` handling deletes no user files; leftover Local
folders are ignored. Reverting the branch restores Idle Styles but requires
another development database reset.

## Outcomes & Retrospective

_Pending._
