# Anima identities in the Memory workspace execution plan

Status: Accepted; implementation of all three phases authorized.
Source agreement: [Anima memory directory spec](anima-memory-directory-spec.md),
agreed by the owner on 2026-09-25 (discovery decisions, accepted proposals and the
added Anima-deletion requirement R2a), who then invoked execution planning.
Authorized scope: all three phases, following the owner's implement instruction on
2026-09-25. Anima deletion UI is a separate task. Exact-candidate merge approval
remains separate.

## Purpose and context

Deliver spec R1–R6: a virtual `Animas` root in `/a/memories` exposing each owned
Anima's anima-scoped `IDENTITY.md` for Manual editing, Memory Manager identity
diffs with Auto approve and Undo, deletion of identity with its Anima, a reserved
user-scope `animas` path, and an unchanged normal-chat boundary. The spec is the
requirements authority; this plan records how to implement and verify it.

Repository `raymond-van/animama`. Worktree
`worktrees/animama/anima-directory-memories-8c0edd`, branch
`feat/anima-memory-directory` (renamed from the generated `claude/...` branch). Starting revision:
`c612e9d790b014fb6342aa67824c5ccfb43fb2a3`. The primary checkout stays on `main`.
All work stays in Animama; no Cloud checkout or private planning input is needed.

Planning needed no stack. Implementation should start a task stack so Anima
deletion and identity edits do not touch the owner's main installation, for
example `ANIMAMA_LLM_SKIP=1 ./reset.sh --name anima-memdir --base-port 8740`.
`ANIMAMA_LLM_SKIP=1` selects the deterministic Memory Manager runtime. A live
Memory Manager check needs an OpenAI key from the owner's external secrets file
and is optional (see Validation).

Follow [SDLC](../../../SDLC.md), [PLANS](../../../PLANS.md), the root and scoped
agent guides, and [ADR 0002](../../adr/0002-accountless-installation-and-http-admission.md)
for owner scoping. No Alembic revision: update ORM and
`alembic/versions/0001_baseline.sql` directly. Regenerate the frontend client
offline with `pnpm openapi-ts`; never hand-edit generated output.

## Progress

- [x] Read agreed spec, lifecycle guides and affected backend/frontend contracts.
- [x] Prepare phases, recovery steps and acceptance evidence.
- [x] Owner accepts plan and authorizes all three phases (2026-09-25).
- [x] Workspace setup published https://github.com/raymond-van/animama/issues/101
      (read back 2026-09-25T16:59:56Z) with native sub-issues #102, #103, #104
      and blocked-by dependencies.
- [x] Phase 1: backend identity access, reservation and deletion (review #2 pass,
      commit `cba8f2d`).
- [x] Phase 2: workspace `Animas` root and Manual identity editing (review #2 pass).
- [x] Phase 3: Memory Manager identity diffs end to end (review #2 pass).
- [x] Final integration review and manual acceptance (review #1 pass after
      record and evidence repairs; commit recorded in PR).
- [ ] Regular PR https://github.com/raymond-van/animama/pull/110 opened
      (validated revision `3802e03`); hosted Validation pending.
- [ ] Exact-candidate owner merge approval.

## Surprises & Discoveries

- `memory_entries.anima_id` has no foreign key to `animas`, and nothing deletes
  anima-scoped memory. `DELETE /v1/animas/{anima_id}` hard-deletes the Anima row
  (cascading chats, loadouts, definition revisions, settings) but leaves its
  `IDENTITY.md`, versions and any other anima-scoped entries live. Memory versions
  and `memory_manager_approvals.target_entry_id` also have no foreign keys.
- The web and desktop frontends have no Anima deletion UI; only the generated SDK
  exposes the delete call, and no HTTP deletion test exists. The deletion journey
  can currently be exercised only through the API. This matches the owner's note
  that deletion is untested.
- Anima display names are 1–40 characters of arbitrary text (spaces, `/`, Unicode)
  and not unique, so they cannot be memory path segments. User-scope memory names
  must match `^[A-Za-z0-9._\-{}]+$`.
- Identity writes require `expected_aggregate_revision` and record a new Anima
  definition revision (`memory_entry_service.py` `_lock_identity_entry`,
  `_record_identity_change`). Memory Manager commits pass no revision and would
  fail with `anima_revision_conflict`; undo explicitly rejects identity.
- The Memory Manager, chat tools and patch planner each reject `animas/...`
  independently (`adapters/memory_manager/workspace.py`, `adapters/memory_patch.py`,
  `memory_manager_service._validate_approval_target_path`,
  `app/chat/memory_tools.py`). The public user-scope API reserves only `episodes`.
- `render_user_memory_file_map` in `app/services/user_memory_read_tools.py` is the
  navigation projection shared by normal chat and Memory Manager; it must split so
  that only the manager sees identities.
- `MemoryManagerApproval` has `target_entry_id` but no Anima column; runs are
  user-scoped. `PyMemoryPatchPreview` carries only `path` and `operation`.
- The workspace loads user-scope headers only; no endpoint lists entries across
  Animas. Frontend header types lack `aggregate_revision`, which only full entry
  responses carry. The workspace has no blank-identity check (only
  `MemoryEntryEditorModal` has one). Manager approval/undo mutations do not call
  `invalidateAnimaDefinition`.
- Frontend protection already recognizes anima identity as required
  (`lib/memory-entries/protection.ts`), and drafts already carry
  `baseAggregateRevision`, so Manual editing mostly reuses existing guards.
- Anima-scoped non-identity memory writes check ownership without locking the
  Anima, so a create committing during Anima deletion could leave an orphan row.
  Accepted as a known single-owner limitation (review P1-R1-F5).
- The worktree venv was created with Python 3.14; OpenAPI export wording differs
  from CI's 3.12.13. Keep the venv on 3.12.13 before regenerating clients.
- No component tests exist for the memory workspace; coverage is unit tests for
  `lib/memory-entries/*` plus manual browser checks.

## Decision Log

- 2026-09-25, owner: accepted the spec, its three proposals, and that deleting an
  Anima deletes its identity; noted Anima deletion is untested overall.
- 2026-09-25, owner: accepted this plan and authorized all phases. An Anima
  deletion UI stays a separate task; this plan verifies deletion through the API.
- 2026-09-25, plan design: Memory Manager addresses identities as
  `animas/<anima_id>/IDENTITY.md`, with the Anima's display name supplied beside
  the path in its navigation map. Names are unsafe and non-unique path segments;
  stable IDs keep proposals bound across renames and duplicates (spec R3). The
  UI never shows this path; it renders the explorer label instead.
- 2026-09-25, plan design: explorer labels (`Annie`, `Annie (2)`) are computed in
  the frontend from the owned-Anima list ordered by creation. Workspace URLs use
  the label path for readability and `entryId` for stability.
- 2026-09-25, plan design: a single read endpoint lists identity headers for all
  owned Animas instead of one query per Anima.
- 2026-09-25, plan design: trusted internal identity writes (manager approval,
  auto approval, undo) lock the Anima definition at its current revision and are
  fenced only by the memory entry's `expected_version`. A rename between proposal
  and approval therefore does not block the approval, while newer identity content
  does.
- 2026-09-25, plan design: Anima deletion hard-deletes all anima-scoped memory
  entries and their versions in the same transaction, matching the Anima row's
  hard delete. Pending approvals targeting them fail with a clear not-found conflict
  and can still be rejected.
- 2026-09-25, plan design: episode-processing runs neither see nor write identities.
- 2026-09-25, implementation: no `reserved_path_conflict` header field. The
  workspace derives a reserved-path conflict from `anima_id == null` and a
  normalized path equal to `animas` or starting with `animas/`, mirroring the
  backend `is_reserved_user_memory_path` rule.
- 2026-09-25, implementation: when an Anima disappears from the identity
  listing, its identity drafts are dropped and a dirty draft raises a warning
  toast, instead of keeping an unsaveable draft. Nothing can accept that text
  once the Anima is deleted; this satisfies spec R2a's "cannot be saved; told why".
- 2026-09-25, implementation: selecting an identity writes `entryId`, and a
  label-path URL is rewritten to `entryId` once resolved, rather than writing
  label paths (plan Phase 2 step 6); labels change on rename, IDs do not.
- 2026-09-25, implementation: Memory Manager identity approvals need no new
  approval column; `target_path` plus `target_entry_id` identify the Anima and
  entry, and the commit verifies both before writing.
- 2026-09-25, plan design: three phases on one branch and one PR. Implementation
  details may be refined with evidence within the agreed spec.

## Implementation orientation

Backend (`src/backend/animama/`):

| Boundary | Existing implementation |
| --- | --- |
| Memory model and guards | `orm/memory_entry.py`, `app/services/memory_entry_service.py` (`is_anima_identity`, reserved roots, identity locks, undo), `domain/anima_definition.py` |
| Memory HTTP | `server/routers/memory_entries.py`, `server/schemas/memory_entry.py`, `adapters/repositories/sqlalchemy/memory_entry_repo.py` |
| Anima deletion | `server/routers/anima.py` `delete_anima`, `app/services/anima_service.py`, `adapters/repositories/sqlalchemy/anima_repo.py` `delete` |
| Navigation and read tools | `app/services/user_memory_read_tools.py`, `app/chat/memory_context.py`, `app/chat/memory_tools.py` |
| Memory Manager | `app/services/memory_manager_service.py`, `adapters/memory_manager/{workspace,openai_agents_runtime,fake_runtime}.py`, `adapters/memory_patch.py`, `domain/memory_manager.py`, `server/routers` manager routes and schemas |

Frontend (`src/frontend/web/src/`):

| Boundary | Existing implementation |
| --- | --- |
| Tree, selection, protection | `lib/memory-entries/{workspace-tree,protection,explorer-actions,workspace-moves,workspace-drafts,library-search}.ts` |
| Workspace UI | `ui/memory/{MemoryLibraryPage,MemoryFileExplorer,MemoryManualPanel,MemoryVersionsDialog}.tsx` |
| Queries | `query/hooks/useMemoryEntries.ts`, `query/mutations/{usePatchMemoryEntry,useRevertMemoryEntry}.ts`, `query/animaDefinitionInvalidation.ts`, `packages/product-ui/src/query/keys.ts`, `packages/product-ui/src/query/hooks/useAnimas.ts` |
| Memory Manager UI | `ui/memory/{MemoryManagerChatPanel,MemoryDiffViewer,useMemoryManagerWorkspace}.tsx/ts`, `query/mutations/{useDecideMemoryManagerApproval,useUndoMemoryManagerApproval}.ts` |

Tests: backend `tests/test_memory_files*.py`, `test_memory_file_tools.py`,
`test_memory_file_context.py`, `test_memory_manager.py`, `test_anima_materializer.py`;
frontend `lib/memory-entries/*.test.ts`, `lib/memory-manager/*.test.ts`,
`query/animaDefinitionInvalidation.test.ts`.

## Setup and execution rules

When implementation is authorized, use workspace-setup to publish the spec as the
parent issue and create one issue per authorized phase; read them back and record
URLs here and in the spec. Rename the branch before the first push. Phase commits
use `feat(memory)[p#]: ...` (or `fix(anima)[p1]: ...` where the primary purpose
is the deletion defect). Work test-first on observable behavior. Before each
phase commit run the affected read-only checks and an independent review: one
full initial review and at most two targeted repair rounds. Stop and report if
blockers remain after the repair budget. Later phases may proceed within the
authorized range after the previous phase's completion conditions pass.

## Phased implementation

### Phase 1 — Backend identity access, reservation and deletion

Requirements: R2a, R5, R6 and backend support for R1/R2. Depends on the accepted
plan and phase issue. Output: tested backend contracts that Phases 2 and 3 use.

1. Anima deletion (R2a). In the Anima deletion transaction, hard-delete every
   memory entry and version with that `anima_id` for the owner, children before
   parents (respecting the `parent_id` RESTRICT key). Keep the existing 404 for
   missing or foreign Animas. Add HTTP tests: delete removes the Anima, its
   identity and versions; other Animas' identities and user memory are untouched;
   a repeated delete returns 404; `GET /v1/memory/entries/{identity_id}` then
   returns 404.
2. Pending approvals targeting a deleted identity. This is exercised fully in
   Phase 3; here ensure lookups by missing entry raise the not-found error, not a
   server error.
3. Reserved `animas` (R5). Extend the user-scope reserved-root check beside
   `episodes` so create, rename and move into `animas` or beneath it are rejected
   case-insensitively with a message naming Anima identities. For an existing
   user-scope entry at or under that path, reject content and description edits
   but allow moving or renaming it out and deleting it. Add a boolean header field
   (for example `reserved_path_conflict`) so the workspace can flag it.
4. Identity listing. Add an owner-scoped read endpoint (for example
   `GET /v1/memory/anima-identities`) returning, for each owned Anima ordered by
   `created_at, id`: the identity entry header, `anima_id`, `display_name`, and
   the Anima's `aggregate_revision`. An Anima whose identity is missing or needs
   repair is included with that status rather than omitted.
5. Internal identity writes. Add a memory-service path for trusted internal
   callers that updates or undoes an identity fenced by `expected_version`, locks
   the Anima definition at its current revision, keeps the nonblank rule and
   records a new definition revision. Allow undo of an approved identity update
   through it; still refuse undo of identity creation, delete, rename, move and
   kind change. Public PATCH keeps requiring `expected_aggregate_revision`.
6. Chat boundary (R6). Add or keep tests proving chat's memory map and
   `memory_list_files`/`memory_read_files`/`search_memory_files` and write tools
   exclude identities and `animas/` paths.
7. Regenerate the frontend client offline; update
   `docs/backend/features/memory.md` for deletion, reservation and the new endpoint.

Checks: focused pytest while developing, then `uv run pytest -q`,
`uv run ruff check`, `make check-test`, and from `src/frontend` `pnpm check`
after regeneration.

Completion: tests above pass; review has no unresolved blockers.

Phase record: issue #102; starting source `e7929ff`; commit recorded in
Progress. Evidence (Python 3.12.13 venv): `uv run pytest -q` 1784 passed,
7 skipped; `ruff check`, `ruff format --check`, mypy and
`make audit-typed-content` pass; `pnpm check` and `pnpm openapi-ts:check` pass.
Full `make check-test` equals these steps. Browser checks: not applicable.

#### Code Review #1 Findings

Reviewed working tree on `e7929ff` (sdlc-reviewer, full initial review).

- P1-R1-F1 (blocking): regenerated SDK changed four unrelated 422 descriptions
  (`Unprocessable Entity` → `Content`) because the worktree venv was Python
  3.14.4; CI exports OpenAPI under 3.12.13, so `sdk-freshness` would fail.
- P1-R1-F2 (optional): `http-api.md` still forbade AI Undo of identity, and
  `memory.md` described Memory Manager as already using the trusted path.
- P1-R1-F3 (optional): the plan's `reserved_path_conflict` header field was
  not implemented; record the decision.
- P1-R1-F4 (optional): hard-coded `"animas"` checks in chat tools, read tools,
  Memory Manager and the patch planner duplicate the new reservation helper.
- P1-R1-F5 (optional): a non-identity Anima-scoped create racing an Anima
  delete can leave an orphan row (no foreign key; non-locking ownership check).
- P1-R1-F6 (optional): tests lacked deletion/Revert of a pre-existing reserved
  entry, moving into it by `parent_id`, and untrusted identity undo.

#### Code Review #1 Revisions

- F1 accepted: recreated the worktree venv with Python 3.12.13 and reran
  `pnpm openapi-ts`; the generated diff now only adds identity-listing types.
- F2 accepted: `http-api.md` and `memory.md` now describe only Phase 1
  behavior; Phase 3 documents Memory Manager use.
- F3 accepted: Decision Log records that the frontend derives the conflict
  from user scope plus a `animas`/`animas/` normalized path, mirroring
  `is_reserved_user_memory_path`.
- F4 deferred to Phase 3, which edits those call sites.
- F5 deferred: recorded in Surprises & Discoveries; single-owner local use
  makes the race unlikely and fixing it needs an Anima lock on every scoped write.
- F6 accepted: added the three assertions; 7 tests pass.

#### Code Review #2 Findings

Targeted recheck of F1, F2, F3 and F6 on the repaired working tree: all
resolved, no actionable findings. Non-blocking notes: the `patch_entry`
docstring and `memory.md` endpoint note anticipate Phases 2–3 in the same PR.

#### Code Review #2 Revisions

None required. Repair budget used: one of two.

### Phase 2 — Workspace `Animas` root and Manual identity editing

Requirements: R1, R2, R2a (frontend), R5 (frontend flag). Depends on Phase 1.

1. Labels. Add a helper that orders owned Animas by creation and assigns
   `Annie`, `Annie (2)`, … using `getAnimaDisplayName`. Unit-test duplicates,
   renames and deletions.
2. Tree. Add virtual node kinds for the `Animas` root (`virtual:animas`) and
   per-Anima directories (`virtual:animas:<anima_id>`); identity files keep their
   entry ID. `buildMemoryWorkspaceTree` returns Animas, Episodes, then ordinary
   entries. Always show the root with an empty state. Filtering matches the
   visible label path. Default expansion keeps current behavior plus the Animas
   root. Initial selection remains `PROFILE.md`.
3. Protection. Treat Animas nodes like Episodes nodes: protected row actions,
   no drag source or drop target, creation disabled with an Animas-specific
   message, and handling in expand/collapse-all, icons and empty states.
4. Data. Load the Phase 1 identity listing alongside user headers and merge
   identity headers into the entries map used for selection, drafts and dirty
   indicators. Carry the Anima revision needed for drafts.
5. Editing. Selecting an identity opens Manual, Preview, Copy and Versions with
   existing draft behavior, sending both guards on save and revert. Add the
   blank-identity check to the workspace save path, sharing it with
   `MemoryEntryEditorModal`. Saves invalidate the Anima definition, so the
   `/a/animas/:animaId` page shows the new content.
6. Route state. Resolve `entryId` first. A `path` beginning with the Animas label
   resolves through the current label map and is then rewritten to `entryId`;
   selecting an identity writes `entryId`. Renames keep the selection.
7. Deleted Anima (R2a). When an identity disappears from the listing, remove it
   from the tree and drop its drafts; a dirty draft raises a warning that its
   unsaved text could not be saved (see Decision Log).
8. Reserved conflict (R5). Flag a user-scope `animas` entry in place, block
   Manual edits, and keep rename, move and delete available.
9. Update `docs/frontend/features/anima-memory.md` for the new explorer and
   editing behavior.

Checks: unit tests for tree building, labels, filtering, protection, explorer
actions, selection/route resolution and drafts; from `src/frontend`
`pnpm check`, `pnpm web:lint`, `pnpm web:test`, `pnpm build`. Desktop-viewport
browser check on the task stack: root order, duplicate labels, edit/save/revert,
blank rejection, concurrent-edit conflict (rename the Anima in another tab),
disabled actions, then a narrow-layout regression check.

Completion: checks pass; browser evidence recorded without personal memory
content; review has no unresolved blockers.

Phase record: issue #103; starting source `cba8f2d`. Task stack
`animama-anima-memdir` at `http://localhost:8740` (development mode,
`ANIMAMA_LLM_SKIP=1`, only `web` published). Local evidence: `pnpm check`,
`pnpm web:lint` and `pnpm web:test` (296 files, 1768 tests) pass; changed files
pass Prettier (13 unrelated baseline files already fail `pnpm prettier:check`).
Browser evidence at 1440×900 with starter fixtures: Animas root first with
Annie and Caitlyn, Episodes second, PROFILE.md initially selected; identity
opens in Manual with `Animas/<name>/IDENTITY.md` in Preview and Delete disabled;
save created Version 2 and the Anima page rendered the new line; blank save
rejected with the draft kept; renaming the Anima through the API to a duplicate
name relabeled folders by creation order (`Caitlyn`, `Caitlyn (2)`), kept the
selection and showed the conflict banner with Use latest / Save over latest;
deleting the other Anima through `DELETE /v1/animas/{id}` with a dirty identity
draft removed its folder and showed the discard warning; identity row menu
items are all disabled; filtering `caitlyn/ident` finds the identity; 375×812
layout renders the Files pane correctly. Not browser-tested: a pre-existing
reserved `animas` user entry (the API now refuses to create one); unit tests
cover it.

#### Code Review #1 Findings

Reviewed working tree on `cba8f2d` (sdlc-reviewer, full initial review).

- P2-R1-F1 (blocking): a `path` URL for an identity stayed label-bound; a
  rename or duplicate-label shift lost or retargeted the selection.
- P2-R1-F2 (blocking): label-path resolution and deleted-identity draft handling
  were inline in the page and untested.
- P2-R1-F3 (blocking): `pnpm build` was neither run nor recorded.
- P2-R1-F4: the deleted-Anima toast ran inside a `setDrafts` updater (duplicated
  under StrictMode); repair-required identities were reported as deleted.
- P2-R1-F5: toolbar creation stayed enabled on a pre-existing reserved entry.
- P2-R1-F6: Anima definition changes did not invalidate identity detail queries,
  so a later workspace save could hit a spurious revision conflict.
- P2-R1-F7: the `workspaceQuery` facade hid identity refresh failures and let an
  identity-listing failure hide all user memory.
- P2-R1-F8: suffixing only avoided earlier Animas' real names.
- P2-R1-F9: a reserved root file got no explorer flag; comment inaccurate.
- P2-R1-F10: the missing-identity empty state pointed to a nonexistent repair UI.
- P2-R1-F11: plan step 6 said selection writes the label path; blank-check
  logic was duplicated.

#### Code Review #1 Revisions

All accepted.

- F1/F2: new pure helpers `resolveWorkspaceSelection` and
  `removedIdentityDrafts` in `anima-folders.ts` with unit tests (label path,
  rename, label shift, stored-path isolation, deleted vs unavailable, clean
  drafts). The page pins identity label-path URLs to `entryId`. Browser:
  `?path=Animas/Caitlyn/IDENTITY.md` became `entryId=…`; renaming the Anima
  and refreshing kept the selection with the new label.
- F3: `pnpm build` exits 0 (existing chunk-size warning only).
- F4: toasts are emitted outside state updaters with stable IDs; repair-required
  identities say "identity is unavailable".
- F5: `memoryCreationTarget` disables reserved entries; unit test added.
- F6: new `memoryEntries.details` prefix key; `invalidateAnimaDefinition`
  invalidates identity detail queries for that Anima; test extended.
- F7: replaced the facade with `workspaceLoaded`, `workspaceFetching` and
  `refreshWorkspace`; explorer errors reflect user memory only; an identity
  listing failure raises a toast and leaves user memory usable.
- F8: labels avoid every Anima's real name (`Annie`, `Annie`, `Annie (2)` →
  `Annie`, `Annie (3)`, `Annie (2)`); test updated.
- F9/F10: reserved flag covers any root reserved entry; copy corrected.
- F11: Decision Log records entry-ID selection; shared
  `isBlankAnimaIdentityDraft` and message used by the workspace and modal.
- Checks after revisions: tsc, eslint and Prettier on changed files pass;
  `pnpm web:test` 296 files / 1774 tests pass; `pnpm build` exit 0.

#### Code Review #2 Findings

Targeted recheck: all eleven fixes hold (74 focused tests, `tsc -b`, eslint and
Prettier pass). P2-R2-F1: the feature doc still said the missing-identity folder
points to the Anima page. Notes: plan step 6 wording; reserved-entry toast copy.

#### Code Review #2 Revisions

Fixed the doc sentence, plan step 6 and the reserved-entry creation toast;
tsc and eslint pass. Repair budget used: one of two.

### Phase 3 — Memory Manager identity diffs

Requirements: R3, R4, R2a (pending approvals), R6. Depends on Phase 1; its
frontend part depends on Phase 2's label helper.

1. Navigation. Split the shared projection: normal chat keeps the user-only map;
   general manager runs additionally list each owned identity as
   `animas/<anima_id>/IDENTITY.md` with the Anima name and description.
   Episode-processing runs keep the user-only map.
2. Reads and search. Manager read and search tools accept identity paths in
   general runs and resolve them through Anima ownership; other `animas/...`
   paths remain rejected. Guidance tells the manager to change an identity only
   when the owner's request concerns that Anima.
3. Proposals. The patch planner and workspace accept updates to existing identity
   paths in general runs; identity create, delete and move remain rejected, as do
   blank results. Episode-processing runs reject every identity target in the
   backend. Store the target Anima (new nullable `target_anima_id` on approvals,
   baseline updated) and expose it on the approval preview so the UI can label it.
4. Approval and auto approval. Commit identity approvals by `target_entry_id`
   through the Phase 1 internal write. Newer identity content yields the existing
   stale-proposal conflict; a deleted Anima yields a clear not-found conflict
   while Reject stays available. Auto approve follows the same path and stops on
   error as today.
5. Undo. Remove the identity exclusion from `_can_undo_approval` eligibility for
   updates; Undo uses the Phase 1 internal identity undo.
6. Deterministic runtime. Extend `fake_runtime.py` only as needed to produce
   identity proposals for tests.
7. Frontend. Show the explorer label (`Animas/Annie (2)/IDENTITY.md`) on approval
   cards when `target_anima_id` is present; invalidate the Anima definition and
   identity caches after approve, auto-approve and undo of identity targets.
8. Docs: update `docs/backend/features/memory-manager-and-episodic-memory.md`,
   `docs/backend/features/memory.md` and the Memory Manager sections of
   `docs/frontend/features/anima-memory.md`.

Checks: backend tests for navigation per run kind, read/search, propose, approve,
approve after rename, stale conflict, blank rejection, deleted-Anima approval,
auto approve, undo eligibility and undo, episode-processing rejection, and the
unchanged chat map/tools; frontend unit tests for card labels and invalidation;
full backend and frontend command sets listed in Validation.

Completion: checks pass; review has no unresolved blockers.

Phase record: issue #104; starting source `c5a612f`. Implementation notes: no
`target_anima_id` column was needed; the approval's `target_path`
(`animas/<anima_id>/IDENTITY.md`) and `target_entry_id` already bind it, and the
frontend parses the path for labels. The deferred P1-R1-F4 consolidation routes the
read-tool and planner checks through `is_reserved_user_memory_path`, the
approval check through `parse_anima_identity_manager_path`, and the chat tool
check through the shared `MEMORY_ENTRY_ANIMAS_ROOT_PATH` constant. Local evidence: `tests/test_memory_manager_identities.py`
(6 tests) plus the memory suites (223 passed); ruff, format, mypy and the import
boundary check pass; `pnpm web:test` 1777 tests and `pnpm check` pass. Browser
(task stack, deterministic runtime): an identity request produced a card labeled
`Update Animas/Annie/IDENTITY.md`; Approve applied it (identity Version 3,
Anima revision 5) and Undo restored it (Version 4, revision 6, card
`Approved · Undone`); Auto approve applied a second request (Version 5), and the
Manual view showed Version 5 without a stale conflict. Rename-before-approve,
stale, deleted-Anima and episode-processing cases are covered by backend tests.
Live OpenAI Memory Manager: not run (requires the owner's API key). After
review repairs: `pnpm web:test` 297 files / 1779 tests, `pnpm check` and
`pnpm build` pass; mypy and `ruff format --check` pass; `uv run pytest -q`
1792 passed, 7 skipped.

#### Code Review #1 Findings

Reviewed working tree on `c5a612f` (sdlc-reviewer, full initial review).
Binding, stale/rename fencing, blank and create rejection, deleted-Anima
conflict, episode guard, chat boundary, ownership, path safety and lock order
verified.

- P3-R1-F1 (blocking): approval summaries and unified-diff file lines still
  showed `animas/<anima_id>/IDENTITY.md`, contradicting the Decision Log and doc.
- P3-R1-F2 (blocking): the deterministic runtime used the identity-enabled
  workspace for episode lookups (a Request-changes path could raise a 500) and
  selected it by task state, so processed episode runs could propose identities.
- P3-R1-F3: no test covered the live runtime's per-run-kind identity access.
- P3-R1-F4: several backend doc lines still described user-only manager paths.
- P3-R1-F5: unreachable reserved-path branch; plan record overstated the chat
  consolidation.
- P3-R1-F6: the committed-approval editor compared paths case-sensitively.
- P3-R1-F7: Auto approve invalidates every approved identity in the snapshot.
- P3-R1-F8: cards for a deleted Anima fall back to the raw path.

#### Code Review #1 Revisions

- F1 accepted: `previewWithDisplayPath` relabels header, summary and diff file
  lines; unit tests added.
- F2 accepted: the deterministic runtime selects its workspace by run kind like
  the live runtime; draft lookups treat rejected targets as absent so planning
  returns a blocked result; test added for a processed episode run.
- F3 accepted: tests for `_allows_anima_identities` and identity instructions.
- F4 accepted: doc lines corrected.
- F5 accepted: branch removed with a comment; record corrected.
- F6 accepted: case-insensitive comparison.
- F7 rejected: over-invalidation of a few Anima views is harmless and keeps the
  snapshot-based helper simple.
- F8 deferred: labeling while the identity list loads would briefly misreport
  live Animas as deleted; the raw path remains accurate.
- Checks: 8 identity tests pass; ruff clean; frontend tsc, eslint and
  `lib/memory-manager` tests (32) pass.

#### Code Review #2 Findings

Targeted recheck: F1–F6 resolved; F7 rejection and F8 deferral reasoning
upheld; no actionable findings. Notes: relabeling also rewrites the raw path
inside identity text (cosmetic); a malformed path in episode reject feedback can
still raise in the pre-existing `_episode_candidate_content` lookup.

#### Code Review #2 Revisions

None required. Repair budget used: one of two.

## Final integration review

Review the combined branch against every spec acceptance criterion, reusing
still-valid phase evidence. One full review and at most two repair rounds.

#### Code Review #1 Findings

Reviewed `28061ef` against baseline `c612e9d` (sdlc-reviewer, final
integration). No code, security or boundary defects; cross-phase guards,
deletion, reservation, chat boundary and docs verified.

- FI-R1-F1 (required): manual acceptance lacked workspace Revert, completing
  Save over latest, rename before approve, and a deleted Anima's pending proposal.
- FI-R1-F2 (required): plan step 7 and the recovery note contradicted the
  shipped draft-dropping behavior and the absent approval column.
- FI-R1-F3: `docs/frontend/architecture/data-layer.md` still described the
  page as user-scope only.
- FI-R1-F4: the manager had no rule mapping duplicate-name workspace labels.
- FI-R1-F5: docs did not say manager history keeps deleted identity text.
- FI-R1-F6: two model-facing rejections did not mention the reservation.

#### Code Review #1 Revisions

All accepted.

- F1: performed on the task stack at 1440×900. Versions → Revert to Version 2
  created Version 6 (`revert`) with Version 2 content. A dirty description edit,
  an API rename and Save produced the conflict banner; Save over latest saved
  Version 7 labeled `Animas/Annie B/IDENTITY.md`. A Memory Manager identity
  proposal, an API rename, then Approve applied it (Version 8, Undo offered).
  With a pending proposal, `DELETE /v1/animas/{id}` (204) then Approve showed
  "This Anima no longer exists; reject the proposal" and stayed pending; Reject
  succeeded and the explorer showed "No Animas yet." Episode processing with
  identities was not run manually; three backend tests cover it.
- F2: step 7 and the recovery note corrected. The PR states that deleted-Anima
  drafts are discarded automatically with a warning.
- F3: data-layer doc updated.
- F4: manager instructions state creation order and the `Name (2)` labels.
- F5: `memory.md` notes that approvals and messages keep run history.
- F6: planner and read-tool rejections mention the reservation.
- Checks: ruff and format pass; 122 affected backend tests pass.

## Validation and acceptance

Backend, from the repository root:

```bash
uv run pytest -q
uv run ruff check
make check-test
```

Frontend, from `src/frontend`:

```bash
pnpm check
pnpm web:lint
pnpm web:test
pnpm build
```

Manual acceptance on the task stack at desktop viewport, using fixture Animas
created for the run (no personal memory content in evidence):

1. Create two Animas with the same name; confirm `Animas` first, `Episodes`
   second, and `Name` / `Name (2)` in creation order.
2. Edit, save and revert an identity in the workspace; confirm the Anima page
   shows the result; confirm blank saves and concurrent Anima edits are rejected
   without losing the draft.
3. In a general Memory Manager run (deterministic runtime), request an identity
   change, rename the Anima before approving, approve, then Undo. Repeat with
   Auto approve on. Confirm an episode-processing run proposes no identity change.
4. Delete an Anima through `DELETE /v1/animas/{anima_id}` (no UI exists) while
   its identity is open with a dirty draft and a pending proposal; confirm the
   folder disappears on refresh, the draft cannot be saved, and the proposal
   cannot be approved but can be rejected.
5. Check a narrow layout for regressions.

A live-provider Memory Manager run is optional and requires the owner's OpenAI
key; record it as not performed if skipped.

## Idempotence and recovery

- Anima deletion permanently removes that Anima's memory entries and versions,
  as it already does for chats. Test it only on the task stack; back up with the
  documented stack backup procedure first if real data is involved.
- Schema changes edit the baseline; resetting the task stack's database applies
  them. Do not purge the main stack.
- Code changes are ordinary commits; revert a phase commit to back it out. The
  new endpoint is additive; no schema change was needed.

## Outcomes & Retrospective

Delivered spec R1–R6 in three phases (`cba8f2d`, `c5a612f`, `28061ef`) plus
final integration repairs. The Memory workspace shows each Anima's identity
under a virtual `Animas` root with full Manual editing; Memory Manager can
read and propose identity updates in general runs with Auto approve and Undo;
Anima deletion now removes its memory; `animas` is reserved in user memory.

Remaining limitations: no Anima deletion UI (separate task); live OpenAI Memory
Manager and a pre-existing reserved `animas` entry were not exercised manually;
deleted-Anima identity drafts are discarded with a warning rather than kept.
Lessons: keep the worktree venv on CI's Python for generated clients; label
paths are for display, stable IDs for binding.
