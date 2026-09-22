# Poses as content execution plan

Status: Accepted; implementation authorized on 2026-09-22.
Source agreement: [Poses as content spec](poses-as-content-spec.md), accepted by
owner instruction to proceed to execution planning on 2026-09-22.
Accepted spec Git blob: `869ab830cb6a2b99e675a9102ec14de6e05a4dad`.
Authorized scope: all four phases, following the owner's implement instruction
on 2026-09-22. No additional product decision is required. Exact-candidate merge
and release approval remain separate.

## Purpose and context

Deliver spec R1–R6: durable Included/Local poses, the existing starter collection,
copy-based Gesture insertion, and Library Actions/Poses preview and editing.
The spec is the requirements authority; this plan records how to implement and
verify it. There is no Pose entry on Create, no Library “New Pose” button, no new
starter authoring, no live pose links and no browser-pose migration.

The repository is `raymond-van/animama`. Reuse the task's existing
`poses-as-content/animama` worktree and branch `feat/poses-as-content`.
Starting revision: `0657c51e211efa8bd16d1efca8dbefd878aacc74`.
Primary `main` remains unchanged. Implementation uses task stack `animama-poses-content`,
development mode, at `http://localhost:8720` (Vite is the only published application
service; PostgreSQL/supporting services stay private; no optional profiles).
Started with `ANIMAMA_LLM_SKIP=1 ./reset.sh --name poses-content --base-port 8720 --host localhost`.
Task Local content/database are separate from the main installation; no provider calls are needed.
Before any implementation, verify Git root, branch, HEAD and dirty state; retain
these planning files and unrelated changes. Do not replace this worktree or reset
its revision merely because the base branch advances.

Follow [SDLC](../../../SDLC.md), [PLANS](../../../PLANS.md), root/scoped agent guides
and the [content decision](../../adr/0004-filesystem-content-and-recoverable-mutations.md).
All work stays in Animama. No Cloud checkout or private planning input is needed.

Authoritative spec: https://github.com/raymond-van/animama/issues/55 (captured 2026-09-22T18:12:50Z).

## Progress

- [x] Read accepted specification, lifecycle guides and affected source contracts.
- [x] Inspect backend and frontend boundaries independently.
- [x] Prepare phases, recovery steps and acceptance evidence.
- [x] Owner accepts plan and authorizes all four implementation phases.
- [x] Workspace setup published and read back https://github.com/raymond-van/animama/issues/55
  at 2026-09-22T18:12:50Z; four native phase issues and dependencies created.
- [x] Phase 1: standalone Pose content contract and recoverable persistence.
- [x] Phase 2: canonical Included starters and distribution completeness.
- [x] Phase 3: durable editor collection and independent clip copies.
- [ ] Phase 4: Library integration and complete acceptance.
- [ ] Final integration review, regular PR, actual hosted Validation and owner acceptance.

## Surprises & Discoveries

- The baseline has `POSE_CLIP`, but no `POSE` kind. Both the ORM kind check and
  `alembic/versions/0001_baseline.sql` explicitly enumerate allowed values.
- `animaPose.ts` resolves inherited humanoid values by default; expression
  inheritance is opt-in. Bone transform fields merge individually. A generic
  JSON deep merge would change authored starter behavior.
- Inline insertion currently copies only explicit fields and drops `parent`.
  `animaPoseClip/sampling.ts` also merges a live `clip.basePose` into each pose.
  Therefore removing a source reference alone does not establish copy independence.
- `bakePoseCreatorClipReferences` already materializes clip bases and references.
  Its resolver must supply effective poses. Draft hydration currently inserts a
  fallback base, so baked clips need explicit no-external-base handling.
- Browser pose persistence lives in `pose-creator-store.ts`; the Gesture picker
  reads that collection. TanStack Query should own the replacement server data.
- The existing mutation adapter can generate a fresh operation ID and fetch a new
  revision during Save. Pose retry/conflict handling must retain the actual loaded
  revision and same-payload operation identity rather than copying those shortcuts.
- Desktop `starter_inventory` classifies content outside starter loadout closures
  as expanded. The shipped authoring poses must explicitly remain in the core
  distribution even though they are not equipped by an Anima.
- Library's internal section is already `actions`. Its visible label and subtype
  enumeration need updating. Some Gesture filters currently test only “not
  Reactions”; that would incorrectly include the new Poses subtype.

## Decision Log

- 2026-09-22, owner: accepted the product choices recorded in the spec and invoked
  execution planning. No migration/backward compatibility for browser poses.
- 2026-09-22, plan design: persist self-contained, resolved Pose payloads and reject
  saved parent references. This avoids a new live pose dependency graph.
- 2026-09-22, plan design: canonical starter documents live in Included content;
  retain only a deterministic generated projection for synchronous runtime defaults
  and shipped clip references. Do not maintain a second editable starter catalog.
- 2026-09-22, plan design: reuse existing typed content, mutation, preview and package
  infrastructure. Do not add an equip lane, arbitrary filesystem API or database
  blob store for poses.
- 2026-09-22, plan design: use four verifiable phases on one branch and one PR.
  These are implementation choices within the accepted spec and may be refined
  with evidence; material behavior changes require updating the agreed authority.

## Implementation orientation

Backend entrypoints are under `src/backend/animama/`:

| Boundary | Existing implementation |
| --- | --- |
| Kinds, documents, database checks | `domain/content_catalog.py`, `domain/content_documents.py`, `orm/content_catalog.py`; root `alembic/versions/0001_baseline.sql` |
| Admission and persistence | `app/services/content_kind_registry.py`, `typed_content_service.py`, `content_save_service.py`, `local_content_mutations.py` |
| HTTP and shared typed models | `server/routers/typed_content.py`, `server/schemas/typed_content.py`, `app/anima_creation_contract.py` |
| Source/package boundary | `adapters/content_store/`, `app/services/content_package_service.py` |
| Desktop starter selection | `runtime/starter_content.py`; `src/backend/packaging/desktop/stage_content.py` |

Frontend entrypoints are under `src/frontend/web/src/`:

| Boundary | Existing implementation |
| --- | --- |
| Pose values and starter resolution | `lib/avatar/poses/animaPose.ts`, `catalog.ts`, `pose_catalog.json`, `json/` |
| Drafts and controls | `stores/pose-creator-store.ts`, `ui/pose-creator/poseCreatorAuthoring.ts`, `PoseCreatorLibrarySection.tsx` |
| Clip persistence and history | `ui/pose-creator/poseCreatorClipAuthoring.ts`, `ui/action-editor/actionPersistence.ts`, `ActionTimelineEditor.tsx` |
| Picker and insertion | `ui/action-editor/ActionEditorWorkspace.tsx`, `ActionEditorEffectsPanel.tsx`, `actionEditorSavedPose.ts`, `ActionCatalogDrag.tsx`, `timelineCatalogDrop.ts` |
| Queries and previews | `query/keys.ts`, `query/hooks/`, `query/mutations/`, `lib/content/catalogApi.ts`, `typedPreviewAdapters.ts`, `lib/content-preview/` |
| Library and routes | `lib/content/librarySearch.ts`, `libraryContentInventory.ts`, `libraryPresentation.ts`, `ui/library/`, `routes/a/library.tsx` |

## Setup and execution rules

When implementation is authorized, use workspace-setup to publish the agreed spec
and create/reconcile one parent and one issue per phase. Read the remote issue back;
it becomes the authority. Add issue URLs and its captured update time here and in
the spec. Parent and phase issues are recorded above; no PR exists yet. Preserve the task branch and use
`feat(poses)[p#]: ...` phase commits; one regular PR covers the combined result.

Install locked dependencies following the existing worktree preparation guide.
Use the repository's supported Python/Node/pnpm versions and hydrate required
tracked LFS assets. Do not copy a checkout's secret `.env`. Use external credentials
only if actually required; this feature needs no paid provider call.

Run focused red/green behavior tests while implementing. Before each phase commit,
run affected read-only static checks and independent review. One full initial review
and at most two targeted repair rounds apply per phase and to final integration.
Each review identifies baseline and candidate, checks every finding against evidence,
and records fixes or reasons for dismissal. If blockers remain after the bounded
repair budget, stop dependent work and report them. A plan review is not a code review.

Fill each phase's issue, starting source, candidate/commit, exact commands/results,
review and remaining gate fields. Subsequent phases may proceed within the authorized
range after their predecessor's completion conditions pass; do not invent interim
owner approvals. Owner acceptance, merge and release gates remain distinct.

## Phased implementation

### Phase 1 — Standalone Pose content and durable APIs

Scope: spec R1, backend R5 and security/Reaction constraints. Depends on accepted
plan, published spec and phase issue. Output: tested Pose APIs and content lifecycle
usable without a browser library.

1. Add `ContentKind.POSE`, a neutral Pose document and typed response/page models.
   Use a normal content descriptor with metadata and a nested resolved
   `animaPose/1.0` payload under `poses/<entry>/<entry>.json`. Keep descriptor
   identity/name and payload identity/name consistent across save and import.
   Validate known bone names, transform shapes, finite bounded values and expression
   weights with parity fixtures against the frontend parser. Admit no `parent` or
   executable/arbitrary resource references in this standalone payload.
2. Extend the closed kind registry, scanner, typed projection, content access and
   package descriptor handling. Use existing publication journals, receipts,
   identity rewriting and deletion. Poses have no source-pose dependencies and no
   Anima loadout slot. Extend shared kind unions only at the needed boundaries;
   broadening preview/evidence kinds must not admit Poses as Anima equipment.
3. Update the ORM and baseline SQL kind checks together. Add no Alembic revision.
   Exercise these checks with a newly initialized disposable database; do not reset
   a user's existing installation or hide a baseline mismatch.
4. Register `/v1/poses` via the existing typed-family route mechanism: list, item,
   preview and revision-fenced/idempotent Save. Retain generic content Delete and
   package APIs. Confirm expected operation IDs, item identity and revision semantics
   in tests, including Included mutation denial and another owner's access denial.
5. Regenerate the SDK offline with `pnpm openapi-ts` from `src/frontend`, then build
   runtime-contracts/packages. Do not hand-edit generated clients.

Focused evidence from repository root (add Pose cases to these existing suites):

```bash
uv run pytest -q tests/test_content_type_handlers.py tests/test_content_catalog_schema.py tests/test_local_content_scan.py tests/test_typed_content_apis.py tests/test_typed_content_preview_batch.py tests/test_typed_content_save_replay.py tests/test_content_save_service.py tests/test_content_mutation_workflows.py tests/test_content_mutation_cancellation.py tests/test_local_content_import_contract.py tests/test_local_content_export_contract.py tests/test_local_content_access_policy.py
uv run --no-sync python scripts/repository-boundary/check-python-imports.py
```

Include restart persistence, invalid/missing files, Included immutability, stale
revisions, interrupted publication, same-operation replay and standalone package
collision/round-trip behavior. Assert saved values and catalog/file outcomes, not
private helper call counts. Run affected Ruff, format and type checks.

Completion: the new family passes these behaviors on a real baseline-initialized
database, SDK generation agrees with HTTP models, and review is clear. No UI claim.
Recovery: retain mutation journals/originals on failure; use existing recovery tests
and never weaken validation to make test fixtures pass.

Issue: https://github.com/raymond-van/animama/issues/56.
Starting source: `72b30658307f59fafac5d9548421888947f9724b` (planning commit;
implementation baseline unchanged). Committed candidate: `db1a7d90a1a04420733d3851417291982384d482`.

Evidence so far (2026-09-22, Python 3.12.13, Node 24.15.0, pnpm 10.33.0):

- New HTTP route contract initially failed because `/v1/poses` did not exist.
  The four API/save/conflict/replay/package tests subsequently passed; the separate
  Included/manual-health test passed after using the existing denial/unavailable
  HTTP 404 contract. No backend status semantics were changed to fit the test.
- `uv run --no-sync pytest -q tests/test_pose_content_restart.py`: 2 passed on real
  Alembic baseline databases. Fresh database/bootstrap/session/store lifetimes retain
  pose identity and values; injected receipt-stage failure restores files/catalog
  and permits the identical retry after restart. These tests began green after the
  concurrent implementation; they are integration evidence, not an asserted red.
- Planned 12-file backend regression command above: 81 passed. Strict admission
  includes a huge-integer regression that failed with OverflowError before repair.
- Backend affected Ruff/format and 11-file mypy checks passed; shared-import check
  reported zero forbidden edges. Broader final verification remains in Phase 4.
- `pnpm openapi-ts` and `pnpm packages:build` passed. Generated kind changes exposed
  frontend transport/revision-schema omissions; authored transport/evidence plumbing
  now passes TypeScript and its focused regressions without adding equip behavior.
- The shared resolved Pose fixture passes both Python handler admission and the
  TypeScript parser without dropped values (`tests/test_pose_content.py -k
  fixture_matches` and frontend catalog API test). This is an additional sixth
  API/contract test; the earlier five behavior cases remain green.
- Frontend focused regression set: 69 tests across seven files passed; three newly
  introduced transport/evidence tests failed before implementation. TypeScript,
  affected ESLint and read-only formatting passed. SDK freshness check passed.
- No browser, native, hosted CI or user-data reset occurred. Independent analysis
  and checks are clear after the one type-annotation repair below.

#### Code Review #1 Findings

Reviewed `72b3065` against the complete Phase 1 working tree, including new validator,
API/restart tests, generated clients and final authored type plumbing. Independent
analysis found no behavioral/security blockers. Independent checks found CHECK-1:
`tests/test_pose_content_restart.py` required an explicit type for its command map.
Affected Python lint/format and whitespace checks otherwise passed. Both reviewers
accepted the existing test evidence without duplicating unchanged runs.

#### Code Review #1 Revisions

CHECK-1 accepted and fixed with `dict[str, Any]`. Targeted mypy/format recheck passed;
SDK freshness passed. The final shared-fixture evidence was added to both language
boundaries. One repair round used; one remains. No unresolved phase blockers.
Independent phase result: pass; full product/browser acceptance remains Phase 4.

### Phase 2 — Canonical Included starter poses

Scope: spec R1/R3 starter availability and shipped-content constraints.
Depends on Phase 1. Output: the existing pose collection is typed Included content,
with default-runtime integrity and core-distribution evidence.

1. Capture the original manifest inventory and resolved pose values before replacing
   inputs. Convert every existing built-in using the current TypeScript
   `resolveAnimaPose` semantics; preserve stable IDs, names and effective transforms,
   including `relaxedRest` and `vrmTPose`. Add comparison fixtures for inheritance
   flags, partial transforms and expressions so conversion is demonstrably equivalent.
2. Put the resolved, parent-free descriptors under `content/included/poses/` as the
   canonical authored inputs. Reuse documented provenance for these existing assets
   in `content/included/licenses/inventory.json`; do not invent licensing claims.
3. Generate a deterministic frontend projection from these canonical files for
   `catalog.ts`'s synchronous default and shipped-clip resolution. Keep generated
   output clearly identified and add a drift check to the relevant build/check path.
   Remove hand-maintained duplicate authority. Backend package resources do not need
   a second Pose catalog merely because animation/VFX catalogs already use one.
4. Include the shipped pose authoring collection in core starter inventory explicitly,
   independently of Anima loadout reachability. Verify both ordinary Included roots
   and staged immutable desktop core mounts contain the collection. The staging tool
   reads tracked paths; stage reviewed new assets before testing this boundary.
5. Check that existing starter Actions and clips still resolve their IDs and that
   the generated runtime projection exactly matches the canonical pose payloads.
   No backwards-compatibility adapter for browser drafts is introduced.

Run from repository root:

```bash
uv run pytest -q tests/test_included_content_catalog.py tests/test_included_content_integrity.py tests/test_starter_content_closure.py
```

Add a focused frontend conversion/projection parity test and run it with Vitest;
record its actual filename/command. After staging reviewed assets, run the existing
content staging command with a new task-owned output directory:

```bash
uv run python src/backend/packaging/desktop/stage_content.py --output "$POSE_STAGING_DIR"
```

Set `POSE_STAGING_DIR` to an unused temporary directory first. Validate its inventory
and rescan the staged core; retain diagnostics if inputs block staging. This checks
content distribution completeness, not a signed installer or native acceptance.

Completion: all original starters retain effective values, ordinary and staged core
catalogs expose them, generated output is fresh, and independent review passes.
Recovery: retain original definitions until equivalence passes; recover with Git,
not an ad hoc reverse converter or user-data reset. Missing source/licensing evidence
blocks affected distribution work and must be reported rather than bypassed.

Issue: https://github.com/raymond-van/animama/issues/57. Starting source: `db1a7d90a1a04420733d3851417291982384d482`.
Commit: `d6f2b727a1939f998d8677c1abb4f214159ee708`.
Evidence (2026-09-22):

- Four core-distribution regressions failed before implementation, then passed:
  standalone unequipped poses ship in core; untracked, excluded and invalid Pose
  roots fail distribution instead of disappearing.
- All 27 ordinary Included Pose descriptors scan as valid. The canonical collection
  preserves original IDs and names, including `relaxedRest` and `vrmTPose`.
- `git lfs pull` hydrated tracked assets in this worktree before staging.
- `uv run --no-sync python src/backend/packaging/desktop/stage_content.py --output
  /private/tmp/poses-core-stage.gZwgKF`: passed, 165 core entries, both starter
  Animas zero diagnostics. Staged output remains available for review; this is
  content-distribution evidence, not signed/native installer acceptance.
- Affected backend Ruff lint/format and mypy (4 files) passed.
- `uv run --no-sync pytest -q tests/test_included_content_catalog.py
  tests/test_included_content_integrity.py tests/test_starter_content_closure.py`:
  23 passed. Independent reviewer verified all 27 staged Pose bytes and exact fresh
  core-inventory rescan equality.
- `node --test src/frontend/scripts/generate-pose-catalog.test.mjs`: 3 passed,
  covering deterministic projection, read-only stale/missing checks and invalid
  descriptor identity/parent rejection.
- `pnpm --dir src/frontend/web exec vitest run src/lib/avatar/poses
  src/lib/avatar/reaction/ReactionClipPlayer.test.ts`: 9 passed across 4 files.
  Captured pre-conversion resolved hashes match all 27 canonical poses; 22 Gesture
  and 72 Reaction clips resolve. Canonical-content existence test failed before
  conversion, then passed. Other parity checks started green and remained green.
- `pnpm --dir src/frontend/web check:source`: passed, including `poses:check`.
  Focused ESLint, Prettier and `git diff --check` passed. Full web build is Phase 4.
- Original raw conversion capture remains in `/tmp/poses-original-resolved.json`;
  tracked `fixtures/starter-inventory-before-content.json` records original
  revision, IDs, names, defaults and hashes at 12-decimal numeric precision.

#### Code Review #1 Findings

Initial phase review against `db1a7d9`: independent analysis and checks passed.
No actionable findings. Reviewed canonical authority, captured value parity,
Docker/Compose source paths, drift enforcement, core selection and provenance.

#### Code Review #1 Revisions

No repairs required. Zero repair rounds used; two remain. Phase 2 completion
conditions satisfied; no native/release/browser acceptance claimed.

### Phase 3 — Durable pose authoring and true copy-on-insert

Scope: spec R3–R6 and editor use of R1. Depends on Phases 1–2.
Output: the Gesture editor authors and lists content-backed poses; copied animation
is independent of source, parent and external base changes.

1. Add focused Pose queries/mutations using generated APIs and shared query keys.
   TanStack Query owns list/item server state; Zustand retains only transient
   authoring values/history and loaded item identity/revision. Fetch only the data
   needed for listing; resolve registered pose bytes through existing typed preview
   adapters when loading/previewing/inserting, with session/revision checks so a late
   response cannot mutate a different document.
2. Replace `hydrateLocalDrafts`, browser Save/Delete and picker hydration with that
   content flow. Preserve new pose authoring within the Gesture editor, names,
   edits and Included-to-Local customization. Save success updates the saved identity
   and clears dirty state only for the submitted draft version; edits made while a
   request is pending remain dirty. Failed/conflicting saves keep the draft and show
   retryable errors. Keep the revision loaded for editing; do not fetch a newer one
   merely to force a stale save through. Reuse the operation ID for an identical
   retry payload and assign a new ID after payload changes.
3. Route click insertion and drag insertion through one checked snapshot operation.
   Assemble a candidate containing the resolved inserted pose, then bake that
   candidate with `bakePoseCreatorClipReferences` so the new pose receives the same
   clip-base overlay as ordinary playback. Use `getResolvedAvatarPose` for generated
   runtime references. On this first successful copy insertion, commit all baked
   values, removal of the external base and insertion as one undoable edit; do not
   defer baking until Save. Verify pre-existing samples are unchanged by baking.
   Reject null/unresolved candidates before changing the draft. Do not create a
   source-pose dependency edge.
4. Preserve baked/no-external-base state through validation, base controls, timeline
   hydration, Undo/Redo, Save and both JSON/project export paths. Do not reinsert
   `relaxedRest` via fallback hydration when the saved clip deliberately has no
   external base. Reuse the existing clip format; no new live-link mode is needed.
   Compare sampled poses at keyframes and between them before/after source/base
   replacement and deletion, including default endpoint keyframes and inherited
   channels. A structural “no ref” assertion alone is insufficient.
5. Remove the old pose-library localStorage key usage, collection UI and browser-only
   wording. Do not migrate or delete unrelated storage; preserve action recovery.
   Test with preexisting old pose data and with storage unavailable. Keep dirty-edit
   cancellation and Gesture/pose session isolation through mode switches.

From `src/frontend`, build packages once, then run affected tests:

```bash
pnpm packages:build
pnpm --filter animama-web exec vitest run src/stores/pose-creator-store.test.ts src/ui/pose-creator/poseCreatorAuthoring.test.ts src/ui/pose-creator/poseCreatorClipAuthoring.test.ts src/ui/pose-creator/PoseCreatorLibrarySection.test.tsx src/ui/action-editor/actionEditorSavedPose.test.ts src/ui/action-editor/ActionEditorEffectsPanel.test.tsx src/ui/action-editor/ActionCatalogDrag.test.tsx src/ui/action-editor/timelineCatalogDrop.test.ts src/ui/action-editor/ActionTimelineEditor.test.tsx src/ui/action-editor/ActionEditorWorkspaceHistory.test.tsx src/ui/action-editor/ActionTimelineDocumentSync.test.tsx src/ui/action-editor/actionPersistence.test.ts
pnpm --filter animama-web check:source
```

Add focused Pose mutation/preview and sampled-copy regressions alongside existing
patterns; record actual paths. Verify stale revision, response loss/retry, edits
during Save, late preview response, one-step undo/redo, and cancelled replacement.
Check affected lint/formatting. Use a real Avatar for desktop picker/authoring and
click/drag playback evidence when the source-serving task environment is available.

Completion: browser pose storage is no longer canonical, new saves reopen correctly,
copy sampling remains invariant under source changes, errors preserve work, and
review passes. Recovery: retain dirty drafts on failed publication; do not fall
back to browser persistence. Keep operation receipts to reconcile ambiguous success.

Issue: https://github.com/raymond-van/animama/issues/58. Starting source: `d6f2b727a1939f998d8677c1abb4f214159ee708`. Commit: pending.
Evidence in progress (2026-09-22):

- New checked byte loader first reproduced two meaningful failures: changed revision
  and mismatched descriptor identity were accepted. Both now reject before returning
  a draft; stale selection rejects before fetching bytes.
- `pnpm --dir src/frontend/web exec vitest run src/lib/content/poseContent.test.ts
  src/query/mutations/usePoseContentActions.test.ts
  src/query/contentCatalogInvalidation.test.ts`: 9 passed. Tests cover captured
  revision/operation reuse after response loss, fresh operation for changed payload,
  descriptor identity, conflict propagation and owner-scoped cache invalidation.
- Planned 12 editor suites plus `poseContent`, `usePoseContentActions`, `usePoses`,
  `contentCatalogInvalidation` and `ActionEditorHeader` suites: 130 passed across
  17 files (`/tmp/poses-phase3-full.log`). Final toolbar remount retry regression
  then failed before repair and all 8 toolbar tests passed after; no unrelated
  passing suite was repeated. Copy regressions first reproduced the retained
  external base and wrongly accepted missing parent, then passed.
- Store/authoring/persistence 62 tests include sampled keyframe/interpolation
  invariance after parent/base replacement and deletion, atomic Undo/Redo,
  save-during-edit acknowledgment, stale sessions, ignored browser records and
  JSON/project no-base round-trips. Query hook 8 tests verify owner gating and
  isolated caches with metadata-only listing.
- Manual development browser at `http://localhost:8720`, desktop 1280x720:
  Create page has no Pose entry; Gesture picker lists Included content; Arms
  Crossed click insertion rendered on the real Annie Avatar; one Undo restored
  original base/keyframes and Redo restored the copy. Included Customize opened
  a separate unsaved Pose; Save showed Saved/disabled Save and created Local
  item `4a44f0d6-9d05-4e6e-ac1a-48ff19ed2824`, named
  `Pose content browser check`, revision
  `f95cac8e9f8ce8dafbbb7ade291fa6cea873094a2574c3ee1993b549ae999e50`.
  Returned to the unchanged Gesture and dragged that Local pose to 1.00s;
  the keyframe and success toast appeared. Saved `Pose copy browser gesture`
  after required AI guidance; inspected persisted sequence has no `basePose`
  or pose `ref` and contains base, armsCrossed and poseContentBrowserCheck values.
  These two manually created items remain only in the task-owned Local root
  for subsequent Library/restart acceptance and exact-identity cleanup.
- Task container package outputs were rebuilt after shared query-key changes;
  the initial stale-package page-load failure resolved. This was an environment
  refresh, not a source change or a waived browser failure.
- Browser reload of saved Gesture retained all three copied keyframes and disabled
  external-base endpoint controls; saved status remained correct. See review below.

#### Code Review #1 Findings

Initial review against `d6f2b727`: independent checks passed (web source check,
product-ui type check, 29-file ESLint, 30-file read-only Prettier, diff whitespace).
Analysis identified three R5 failures:

- P3-1: insertion could succeed with an unavailable Avatar before/during loading.
- P3-2: failed atomic baking returned silently instead of an actionable error.
- P3-3: changing a new draft after an ambiguous create response could create a
  second item or collide by path instead of reconciling the retained receipt.

#### Code Review #1 Revisions

Accepted all three findings against explicit R5. P3-1/P3-2 guard initial/current
Avatar and report atomic rejection; three meaningful reds preceded 22 passing
helper/drag/history tests. P3-3 reconciles the retained request before updating
changed payloads, preserves newer edits/session ownership, and allows corrected
submissions after definitive domain rejection. Twelve toolbar tests passed after
three meaningful retry/rejection reds. Independent targeted analysis and checks
passed: integrated web TypeScript/projection, affected ESLint/Prettier and whitespace.
One repair round consumed; one remains. No unresolved Phase 3 blockers.

Full backend validation exposed pre-existing missing type narrowing in two tests
(byte-identical to the original baseline). Added explicit PyReaction and non-None
row assertions without weakening behavior; targeted mypy, three tests and Ruff
lint/format passed, with independent review. Broader backend validation continues
for Phase 4; it is not represented as passing yet.

### Phase 4 — Library integration and complete acceptance

Scope: spec R2 and combined R1–R6 acceptance. Depends on Phases 1–3.
Output: usable Actions/Poses Library, isolated preview/edit, complete validation
and useful current documentation.

1. Extend Library search/URL normalization, inventory groups, presentation, rows and
   query adapters with Poses. Rename the visible section to Actions, retain All,
   and include poses in combined inventories. Apply Gesture-only filters explicitly
   to Gestures, not Poses. Keep source/search/sort/health conventions and ensure no
   Library new-item button or Create-page Pose entry is introduced.
2. Add an item edit route such as `routes/a/poses.$poseId.edit.tsx` with a focused
   wrapper around existing pose controls/preview providers. Local items edit their
   saved identity; Included customization initializes an unsaved Local copy. Do not
   open a fake unsaved Gesture document or overwrite a suspended Gesture draft.
   Regenerate TanStack routes rather than editing generated output.
3. Reuse the existing protected preview dock by adapting an admitted static pose to
   a checked static-hold clip target. Keep pose bytes and Avatar preview ownership
   within the existing byte-session/lifetime rules; do not equip the pose or write
   an Anima selection as a preview side effect. Cover unavailable Avatar/content,
   disposal and stale responses with focused tests and rendered evidence.
4. Extend Library search/inventory/presentation and new edit-route/preview tests.
   Add active accountless browser journeys for the acceptance matrix below; confirm
   selection with `pnpm e2e:list` instead of relying on inactive historical specs.
   Backend package tests establish portable file round-trips; manually preview the
   imported pose/action. Do not invent a package-import browser screen.
5. Update current Library, content storage/runtime and relevant HTTP/authoring docs,
   and add concise Pose/Pose Clip glossary entries. Explain canonical saved content
   and source-independent copies, removing obsolete browser-library guidance.
   An ADR is needed only if implementation changes a significant existing decision;
   ordinary adoption of ADR 0004 does not require a duplicate record.
6. Run the complete affected local checks below before publishing a CI candidate.
   Record all spec acceptance evidence and missing checks. Complete phase review
   and final integration review, then use the normal PR workflow when authorized.

Focused UI checks from `src/frontend`:

```bash
pnpm --filter animama-web routes:generate
pnpm --filter animama-web exec vitest run src/lib/content/librarySearch.test.ts src/lib/content/libraryContentInventory.test.ts src/lib/content/libraryPresentation.test.ts
pnpm e2e:check
pnpm e2e:list
```

Add new pose Library/edit/preview tests to that command and record actual filenames.
Completion: the acceptance matrix has passing evidence, all affected local gates
pass and independent review is clear. Full hosted Validation and owner acceptance
remain explicitly pending until actually observed.
Recovery: failed content operations use normal journals/receipts; failed test data
cleanup uses the runner's exact ownership ledger. Do not hide failed cleanup as a pass.

Issue: https://github.com/raymond-van/animama/issues/59. Starting source: Phase 3 completion, to record. Commit: pending.
Evidence and remaining gates: not run.

#### Code Review #1 Findings

Not started. Record source, UI and combined acceptance findings here.

#### Code Review #1 Revisions

Not started. Record repairs and affected reruns; at most two repair rounds.

## Validation and acceptance

### Environment and commands

Planning has run no application tests or stack. Implementation must first confirm
which stack serves the actual task source. Reuse a suitable non-disruptive stack for
manual checks; automated mutating journeys require the disposable named setup in
[browser journeys](../../frontend/testing/browser-journeys.md). Read the local-stack
skill before startup. If creating a task stack, verify shared model assets first,
choose an available base port, and use `reset.sh --name poses-content --base-port B`
with deterministic clients for automation. Record exact URL, project, source and
Local root. Use task-specific nonsecret configuration and external secrets only as
needed. Do not run a reset or purge against main or another task.

Baseline changes require a fresh disposable database. No reset of preexisting owner
data is authorized by this plan. Browser-storage clearing/restart tests target only
the disposable task origin/installation. Scope all Compose follow-ups using its
trusted `.animama-stack.env` and project identity.

Final local gates from repository root:

```bash
make check-test
uv run --no-sync python scripts/repository-boundary/check-python-imports.py
uv build --wheel
```

From `src/frontend`:

```bash
pnpm openapi-ts:check
pnpm packages:check
pnpm packages:test
pnpm check
pnpm web:lint
pnpm web:test
pnpm build
pnpm e2e:check
pnpm e2e:test -- --project chromium --grep "pose content"
```

The final command names the planned active journey group; implement those cases
and verify nonzero selection first. Run the existing real-avatar built-in playback
journey as a regression. Apply read-only Prettier checks to changed authored
frontend files and `git diff --check` to the patch. Regeneration commands above are
intentional edits; they are not substitutes for freshness checks.

Reuse unchanged passing checks when their source and environment still apply.
This mixed persistence/API/asset/UI change requires full hosted `Validation` under
the current policy; do not substitute a routine-change receipt or draft deferral.
Report actual CI profile, results and tested revision independently of local checks.
Native signing/installer/release and real audio/paid-provider acceptance are not
claimed by these gates. Starter staging evidence covers content packaging only.

### Acceptance evidence matrix

| Evidence | Requirements and observable result |
| --- | --- |
| API/database and scan tests | R1/R5: durable identity/value updates, restart persistence, stale-save rejection, recoverable publication/retry, invalid/missing health, Included/access denial |
| Canonical starter and staging parity | R3/constraints: every former built-in preserves effective values; shipped defaults/clips work; default core distribution includes poses |
| Real-Avatar Library journey | R2/R3: Actions/Poses and combined lists, filtering/search/navigation, starter/local preview, Customize, Local edit/reopen, no new-item/Create entry |
| Persistence browser journey | R1/R6: editor Save survives reload, scoped browser storage clearing and backend restart; seeded legacy browser poses stay unused |
| Sampled values and rendered action playback | R3/R4: click/drag, one Undo/Redo, cancel and independent copied poses after source/parent/base updates or deletion, including saved/reopened action |
| Conflict/error/dirty-work journey | R5: failed save keeps work, stale revisions are visible, cancellation preserves drafts and unrelated Gesture editing, unavailable preview has no false success |
| Backend package round-trips plus preview | R1/R4: standalone imported Pose has the same values; imported action plays copied poses with original pose files absent |
| Desktop then narrow layout and keyboard | Constraints: usable bounded controls, explicit insertion alternative to drag, no Reaction humanoid or equip expansion |

Use real Avatar evidence for rendering; synthetic smoke tests alone do not establish
pose fidelity. Record desktop and narrow viewport dimensions, representative poses,
commands, artifacts and source identity. Keep public-safe summaries here; raw logs,
screenshots or personal runtime data do not belong in tracked planning documents.

## Final integration review

After Phase 4, review the combined diff and each spec criterion independently using
valid phase evidence. Check duplicated authorities, hidden browser fallback, live
pose/base dependencies, Include immutability, package completeness, editor lifetimes
and UI exclusions. One full review and at most two repair rounds apply; do not
repeat cleared findings without new evidence.

### Code Review #1 Findings

Not started. Baseline/candidate, evidence mapping and findings: pending.

### Code Review #1 Revisions

Not started. Repairs, reruns and remaining review budget: pending.

Open/update one regular PR after required local gates and authorized implementation
are complete. Link the authoritative spec issue and plan, separate local/browser
results from hosted CI, and use the template's compact validated revision reference.
Do not mark the work delivered just because code or a PR exists. Obtain exact-head
owner merge approval after review/checks; ordinary merge is the default method.

## Idempotence and recovery

- Resume this branch/worktree and reconcile existing issues/PR before creating any.
  Record starting sources rather than silently rebasing onto a different candidate.
- Save retries reuse operation identity only for identical payloads; conflicts retain
  the loaded revision and editable draft. Never force-write a stale editor snapshot.
- Asset conversion/projection is deterministic; preserve parity evidence and fail on
  drift instead of silently sourcing a different catalog. Retain provenance blockers.
- No browser-pose migration exists. Do not delete unrelated browser state or attempt
  to reconstruct legacy records during failures.
- Let the existing mutation journal and receipts recover interrupted filesystem/DB
  publication. Preserve originals and report unresolved recovery conflicts.
- Retain task stack data until scoped cleanup is authorized. Use exact ownership
  ledgers for temporary items; never purge shared volumes or remove another task's
  worktree. A failed or cancelled run remains recorded evidence.

## Planning review and document verification

2026-09-22: independent backend/starter and frontend/editor plan reviews found no
blocking design or acceptance gaps. The frontend review corrected the timeline
synchronization source path and clarified that baking applies to the candidate
containing the insertion, before the single undoable commit. This review does not
consume any implementation-phase code-review round.

Document verification passed: all relative links resolve, all 15 cited backend
and 15 cited frontend test paths exist, the recorded spec Git blob matches its
contents, both Markdown files pass Prettier check, and no trailing whitespace was
found. No product tests, asset conversion or application startup occurred.

## Outcomes & Retrospective

All implementation phases are authorized. Workspace and tracker setup are complete.
Phase work, product tests, browser evidence, hosted CI and final acceptance remain
pending; update this section as execution progresses.
There are no unresolved product decisions. The implementation choices above are
concrete defaults; adjust them within the spec if source evidence warrants it.
Runtime/input availability is checked at setup and must be recorded as a blocker
if missing, not treated as successful validation.
