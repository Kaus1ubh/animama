# Poses as content execution plan

Status: Accepted; implementation authorized on 2026-09-22.
Source agreement: [Poses as content spec](poses-as-content-spec.md), accepted by
owner instruction to proceed to execution planning on 2026-09-22.
Accepted spec Git blob: `869ab830cb6a2b99e675a9102ec14de6e05a4dad`.
Authorized scope: all four phases, following the owner's implement instruction
on 2026-09-22. No additional product decision is required. Exact-candidate merge and release approval remain separate.

## Purpose and context

Deliver spec R1–R6: durable Included/Local poses, the existing starter collection,
copy-based Gesture insertion, and Library Actions/Poses preview and editing.
The spec is the requirements authority; this plan records how to implement and
verify it. There is no Pose entry on Create, no Library “New Pose” button, no new
starter authoring, no live pose links and no browser-pose migration.

The repository is `raymond-van/animama`. Reuse the task's existing
`poses-as-content/animama` worktree and branch `feat/poses-as-content`.
Starting revision: `0657c51e211efa8bd16d1efca8dbefd878aacc74`.
Primary `main` remains unchanged. No Compose stack has been started for planning.
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
- [ ] Phase 1: standalone Pose content contract and recoverable persistence.
- [ ] Phase 2: canonical Included starters and distribution completeness.
- [ ] Phase 3: durable editor collection and independent clip copies.
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

Issue: https://github.com/raymond-van/animama/issues/56. Starting source: `0657c51e211efa8bd16d1efca8dbefd878aacc74`. Candidate/commit: pending.
Evidence and remaining gates: not run; implementation authorization pending.

#### Code Review #1 Findings

Not started. Record source, commands, stable findings and disposition here.

#### Code Review #1 Revisions

Not started. Record accepted repairs and affected reruns; at most two repair rounds.

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

Issue: https://github.com/raymond-van/animama/issues/57. Starting source: Phase 1 completion, to record. Commit: pending.
Evidence and remaining gates: not run.

#### Code Review #1 Findings

Not started. Record source, starter inventory/parity evidence and findings here.

#### Code Review #1 Revisions

Not started. Record repairs and affected reruns; at most two repair rounds.

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

Issue: https://github.com/raymond-van/animama/issues/58. Starting source: Phase 2 completion, to record. Commit: pending.
Evidence and remaining gates: not run.

#### Code Review #1 Findings

Not started. Record source and behavior/history evidence here.

#### Code Review #1 Revisions

Not started. Record repairs and affected reruns; at most two repair rounds.

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
