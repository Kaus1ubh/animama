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
- [ ] Phase 1: backend identity access, reservation and deletion.
- [ ] Phase 2: workspace `Animas` root and Manual identity editing.
- [ ] Phase 3: Memory Manager identity diffs end to end.
- [ ] Final integration review and manual acceptance.
- [ ] Regular PR and hosted Validation.
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

Phase record: issue #102; commits —; evidence —.

#### Code Review #1 Findings

Not started.

#### Code Review #1 Revisions

Not started.

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
   resolves through the current label map; selecting an identity writes its label
   path. Renames keep the selection via `entryId`.
7. Deleted Anima (R2a). When a selected or drafted identity disappears from the
   listing, remove it from the tree, keep but block its draft from saving, and
   explain that the Anima was deleted; the draft can only be discarded.
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

Phase record: issue #103; commits —; evidence —.

#### Code Review #1 Findings

Not started.

#### Code Review #1 Revisions

Not started.

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

Phase record: issue #104; commits —; evidence —.

#### Code Review #1 Findings

Not started.

#### Code Review #1 Revisions

Not started.

## Final integration review

Review the combined branch against every spec acceptance criterion, reusing
still-valid phase evidence. One full review and at most two repair rounds.

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
  new endpoint and approval column are additive.

## Outcomes & Retrospective

Not started.
