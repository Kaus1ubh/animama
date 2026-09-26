# Anima memories and companion memory templates execution plan

Status: Accepted; implementation of all four phases authorized.
Source agreement: [Anima memories spec](anima-memories-spec.md), agreed by the owner
on 2026-09-26 with three changes (identity-adjacent placement, Reflection as a
specialized Memory Manager prompt, fully written starter identities). The owner then
invoked execution planning.
Authorized scope: all four phases, following the owner's implement instruction on
2026-09-26. Owner gate G1 and exact-candidate merge approval remain separate.

## Purpose and context

Deliver spec R1–R10: a protected, per-Anima `MEMORIES.md` loaded right after the
Anima's identity; live edits by the Anima; a Reflect action that runs a specialized
Memory Manager prompt over this Anima's uncovered turns; an in-chat memory cue for
`MEMORIES.md` changes and `remember` episodes; redesigned `IDENTITY.md`,
`PROFILE.md` and `MEMORIES.md` templates; and current docs, glossary and an ADR.
The spec is the requirements authority; this plan records how to build and verify it.

Repository `raymond-van/animama`. Worktree `worktrees/anima-memories/animama`,
branch `feat/anima-memories`, starting revision `b633af1`. The primary checkout
stays on `main`. All work stays in Animama; no Cloud checkout is needed.

Implementation should use a task stack so Anima creation, memory writes and
database resets do not touch the owner's main installation, for example
`ANIMAMA_LLM_SKIP=1 ./reset.sh --name anima-memories --base-port 8760`.
`ANIMAMA_LLM_SKIP=1` selects the deterministic chat and Memory Manager runtimes.
Live-model checks need an OpenAI key from the owner's external secrets file (see
Validation). The schema changes need a fresh database; reset only the task stack.

Follow [SDLC](../../../SDLC.md), [PLANS](../../../PLANS.md), the root and scoped
agent guides, [ADR 0004](../../adr/0004-filesystem-content-and-recoverable-mutations.md)
and [ADR 0008](../../adr/0008-non-overridable-companion-guardrail.md). No Alembic
revision: edit ORM and `alembic/versions/0001_baseline.sql` directly. Regenerate
the client offline with `pnpm openapi-ts` under a Python 3.12.13 venv (CI's
version; 3.14 changes OpenAPI wording); never hand-edit generated output.

## Progress

- [x] Read agreed spec, lifecycle guides and affected backend/frontend contracts.
- [x] Prepare phases, recovery steps and acceptance evidence.
- [x] Owner accepts plan and authorizes all four phases (2026-09-26).
- [x] Workspace setup published https://github.com/raymond-van/animama/issues/156
      (read back 2026-09-26T18:10:04Z) with native sub-issues #157, #158, #159,
      #160 and blocked-by dependencies.
- [ ] Phase 1: backend `MEMORIES.md` lifecycle, prompt placement and templates.
- [ ] Phase 2: memory workspace and create-Anima template.
- [ ] Phase 3: live edits and the chat memory cue.
- [ ] Phase 4: Reflection.
- [ ] Final integration review.
- [ ] Owner gate G1: desktop acceptance with a live model.
- [ ] PR opened; hosted Validation recorded.
- [ ] Exact-candidate owner merge approval.

## Surprises & Discoveries

Planning findings at `410425e` (unchanged at `b633af1`):

- Nothing prevents other files in Anima scope. `POST /v1/memory/entries` accepts
  `anima_id` with any path, and `tests/test_anima_memory_directory.py` creates
  `notes/extra.md` there to test purging. Spec R2 requires restricting Anima scope.
- Identity special cases in `memory_entry_service.py` mix two concerns:
  protection (delete, move, rename, kind binding, move-onto, kind preservation in
  `put_file_by_path`) and aggregate revision (`_lock_identity_*`,
  `_record_identity_change`, `_with_aggregate_revision`). `MEMORIES.md` needs the
  first set only. `put_file_by_path` clears the kind on a kind-less write to a
  non-identity file, so it needs the same exemption.
- `anima_repo._purge_anima_memory` already deletes all Anima-scope rows, so
  `MEMORIES.md` is removed with its Anima without changes.
- Chat memory tools are built without an `animas=` repository and with the default
  32 KiB limit (`server/routers/chat/session_services.py`). Any Anima-scope tool
  call would raise `MemoryEntryConfigurationError` until this is wired.
- Bracketed first segments are already rejected by chat tool paths and can never
  appear in stored names, so a reserved alias such as `[self]/MEMORIES.md` cannot
  collide with a user file.
- Per-turn memory-update settings are not persisted. `structured.remember` is
  stored even when updates are disabled, so it cannot drive the cue or exclude
  turns from Reflection. `ChatMessageRepository` is append-only; data needed on the
  assistant row must be computed before `record_turn`. Episode items already
  record `source_message_id`.
- `chat_messages` has no `anima_id`; Anima-scoped history joins through
  `chats.anima_id` (indexed). No port reads messages by Anima across chats.
- The Memory Manager allows one open run per user, has no streaming and no Stop,
  and has no chat-history tool. Run `kind` is CHECK-constrained to `general` and
  `episode_processing` in both baseline SQL and ORM. Episode items carry a global
  `processed` flag; there is no per-Anima watermark.
- `anima_identity_memory.parse_anima_identity_manager_path` rejects every
  `animas/<id>/*` path other than `IDENTITY.md`; it is used by read tools, the patch
  planner, the manager workspace and approval validation.
- Placing `MEMORIES.md` in the system message (owner decision) means each edit
  changes the cached prefix. The active OpenAI Responses provider sends all
  instructions each request, so the effect is small today; for future Chat
  Completions providers a `MEMORIES.md` edit invalidates the cached history
  prefix. Accepted cost, noted for provider work.
- Starter version-1 identities are pinned to `alembic/seeds/02-seed-avatars.sql` by
  `tests/test_anima_starters.py`; new identity text needs a version bump (Annie 1→2,
  Caitlyn 3→4). Version bumps never rewrite existing starters.
- Frontend: protection is keyed on identity only, so an unrecognized `MEMORIES.md`
  row would offer Rename, Move and Delete. `onComplete` appends synthetic assistant
  rows without `data` and new chats never refetch, so a streamed cue must be copied
  into those rows. One assistant row can render as speech and display bubbles, so
  the cue belongs on the last bubble. Quick Chat cannot navigate the main window
  without a new desktop command. SSE guards classify frames by shape; a new event
  needs an explicit `type` and must be checked before `isUserResponse`.

## Decision Log

- 2026-09-26, owner: accepted the spec and its proposals with three changes (see
  spec header), then invoked execution planning.
- 2026-09-26, plan design: removed "streams, stops" from spec R5. The Memory
  Manager has neither; Reflect behaves like any other Memory Manager conversation.
  This corrects wording, not scope.
- 2026-09-26, plan design: Anima scope admits only `IDENTITY.md` and `MEMORIES.md`
  at its root. Both are protected; only identity carries the aggregate revision.
- 2026-09-26, plan design: the Anima addresses its own file in chat tools as
  `[self]/MEMORIES.md`, resolved server-side to the turn's Anima. Tools support
  read, patch and whole-file replace; never create, delete, move or other paths.
- 2026-09-26, plan design: each assistant row stores a `memory` block in
  `message_data` before persistence: whether memory updates were enabled for the
  turn and any successful `MEMORIES.md` changes (entry, version, bounded excerpt of
  added text). Episode cues are derived from `memory_episode_items` by
  `source_message_id`. The messages API returns a typed `memory_cue`; a new SSE
  event carries the same shape during streaming.
- 2026-09-26, plan design: Reflection is a new Memory Manager run kind
  `reflection` bound to one Anima. A per-Anima watermark in a new table records the
  last covered turn and advances when an approval from a reflection run commits to
  that Anima's `MEMORIES.md`; undoing that approval restores the previous watermark
  unless a later Reflection has advanced it.
- 2026-09-26, plan design: a reflection run reads its uncovered turns through a
  paged manager tool, with a safety cap of 400 turns per
  run; beyond it, Reflect covers the oldest 400 and says how many remain. Spec R5
  says the first Reflection covers all turns; the cap only matters for very long
  histories.
- 2026-09-26, owner: accepted this plan and authorized all four phases by
  invoking implementation, without changing the 400-turn Reflection cap, which
  therefore stands and remains revisable. At the owner's request, prompt-prefix
  caching optimization was filed as follow-up issue #155.
- 2026-09-26, plan design: one branch and one PR; four phases ordered by
  dependency. Implementation details may change with evidence within the spec.

## Implementation orientation

Backend (`src/backend/animama/`):

| Boundary | Existing implementation |
| --- | --- |
| Identity constants and memory guards | `domain/anima_definition.py`; `app/services/memory_entry_service.py` (`is_anima_identity`, `_require_not_identity`, `_create_entry`, `_update_file_entry`, `_move_entry`, `put_file_by_path`, `initialize_anima_identity`) |
| Anima listing and creation | `adapters/repositories/sqlalchemy/memory_entry_repo.py` `list_anima_identity_summaries`; `server/routers/memory_entries.py` `list_anima_identities`; `server/schemas/memory_entry.py`; `domain/memory_entry.py` `AnimaIdentitySummary`; `app/services/anima_aggregate_materializer.py` `_write_definition` |
| Templates | `app/services/anima_starter_service.py` `STARTER_ANIMA_SPECS`; `app/services/owner_bootstrap_service.py` `PROFILE_TEMPLATE_V1`; `server/local_installation_bootstrap.py` policy |
| Prompt | `app/chat/memory_context.py` (context, guidance); `app/chat/openai_prompt.py` `_direct_chat_system_instruction`; `app/safety/prompts.py` |
| Chat tools and turns | `app/chat/memory_tools.py`; `app/services/user_memory_read_tools.py`; `adapters/memory_patch.py`; `app/chat/direct_turn/{provider_state,model_stream,message_builders}.py`; `app/chat/direct_executor.py`; `server/routers/chat/session_services.py` |
| SSE and history | `domain/events.py`; `server/sse_events.py`; `server/routers/chat/{sse_runtime,chat_sse}.py`; `server/routers/chats.py`; `server/schemas/chat_history.py` |
| Memory Manager | `app/services/memory_manager_service.py`; `adapters/memory_manager/{openai_agents_runtime,fake_runtime,workspace,episode_processing}.py`; `app/services/anima_identity_memory.py`; `domain/memory_manager.py`; `orm/memory_manager.py`; `server/routers/memory_manager.py`; `server/schemas/memory_manager.py` |
| Chat history reads | `adapters/repositories/sqlalchemy/chat_message_repo.py`; `app/ports/chat_message_port.py` |

Frontend (`src/frontend/`):

| Boundary | Existing implementation |
| --- | --- |
| Folders, tree, protection | `web/src/lib/memory-entries/{anima-folders,workspace-tree,protection,workspace-moves,explorer-actions,workspace-drafts}.ts` |
| Workspace UI | `web/src/ui/memory/{MemoryLibraryPage,MemoryFileExplorer,MemoryManualPanel}.tsx`; `web/src/query/hooks/useMemoryEntries.ts` |
| Memory Manager UI | `web/src/ui/memory/{MemoryManagerPanel,MemoryManagerChatPanel,useMemoryManagerWorkspace}.tsx/ts`; `web/src/lib/memory-manager/{workspace-state,transcript-projection}.ts`; `web/src/query/mutations/memoryManagerMutationCache.ts` |
| Chat stream and transcript | `packages/product-ui/src/query/mutations/useChatSse.ts`; `packages/product-ui/src/lib/chat/{companion-safety,display-message-mapping}.ts`; `packages/product-ui/src/chat/useProductChatSession.ts`; `packages/product-ui/src/components/chat-conversation.tsx`; `web/src/ui/main/chat/ChatInterface.tsx` |
| Quick Chat | `web/src/routes/desktop/quick-chat/$animaId.tsx`; `web/src/hooks/useDesktopQuickChatRuntime.ts`; `desktop/src/main-process/quick-chat/quick-chat-window-manager.ts` |
| Create-Anima template | `web/src/ui/create-anima/{createAnimaIdentity,createAnimaDraft,createAnimaDraftStorage}.ts`; `web/src/lib/animas/anima-management-presentation.ts` |

Tests: backend `tests/test_anima_memory_directory.py`, `test_memory_files*.py`,
`test_memory_file_context.py`, `test_memory_file_tools.py`,
`test_memory_manager.py`, `test_memory_manager_identities.py`,
`test_memory_episodes.py`, `test_anima_materializer.py`, `test_anima_starters.py`,
`test_owner_bootstrap.py`, `test_direct_chat_turn_executor.py`,
`test_anima_chat_sse.py`, `test_anima_sse_events.py`, `test_chats_api.py`,
`test_companion_guardrail.py`, `test_alembic_fresh_install.py`. Frontend
`web/src/lib/memory-entries/*.test.ts`, `web/src/lib/memory-manager/*.test.ts`,
`web/src/lib/chat/display-message-mapping.test.ts`,
`web/src/query/mutations/useChatSse.test.ts`,
`web/src/ui/main/chat/useChatSession.test.ts`,
`web/src/ui/safety/CompanionSafetyView.test.tsx`, create-Anima tests and
`packages/product-ui/tests/chat-lifecycle.test.mjs`. The memory workspace has no
component tests; it relies on unit tests plus browser checks.

## Setup and execution rules

When implementation is authorized, use workspace-setup to publish the spec as the
parent issue and one sub-issue per authorized phase; read them back and record
URLs here and in the spec snapshot. Phase commits use `feat(memory)[p#]: ...`
(`feat(chat)[p3]` where the chat cue is the primary purpose). Work test-first on
observable behavior. Before each phase commit run the affected read-only checks and
an independent `sdlc-reviewer` review: one full initial review and at most two
targeted repair rounds. Stop and report if blockers remain after the repair
budget. Later phases may proceed within the authorized range once the previous
phase's completion conditions pass. Update docs for touched areas in the phase
that changes them.

## Phased implementation

### Phase 1 — Backend `MEMORIES.md` lifecycle, prompt placement and templates

Requirements: R1, R2 and R8 (backend), R3, R7 (influence), R9 (backend), R10
(glossary, ADR). Depends on plan acceptance. Output: every Anima has a protected
`MEMORIES.md` that chat loads right after identity.

1. Domain. Add `ANIMA_MEMORIES_PATH = "MEMORIES.md"`,
   `ANIMA_MEMORIES_KIND = "anima_memories"`, a 16 KiB limit and the R9
   `MEMORIES.md` template beside the identity constants.
2. Protection. Introduce one predicate for protected Anima files and use it where
   identity is protected today: delete, move/rename, undo of creation, kind binding
   to path, kind immutability, move-onto guard and kind preservation in
   `put_file_by_path`. Keep aggregate-revision locking and definition revisions
   identity-only. `MEMORIES.md` accepts blank content, normalizes line endings and
   enforces 16 KiB. Reject creating or moving any other entry into Anima scope.
   Replace the `notes/extra.md` purge test with a `MEMORIES.md` purge assertion.
3. Creation. Add `initialize_anima_memories` and call it in
   `_write_definition` right after identity, in the same transaction, for custom
   and starter Animas. Add an idempotent owner-scoped repair operation that creates
   the file from the template when missing and otherwise changes nothing, with an
   HTTP route and tests (404 for foreign/missing Anima).
4. Listing. Extend the Anima listing (`list_anima_identity_summaries` and
   `GET /v1/memory/anima-identities`) with each Anima's `MEMORIES.md` header, null
   when missing, keeping the endpoint path.
5. Prompt (R3, R7). Open `MEMORIES.md` as a second opened file when memory
   influence is on and include it as `# Anima Memories` directly after
   `# Anima Identity`. Omit the section when influence is off, and omit it without
   failing the turn when the file is missing, blank or unreadable (record the status
   in the manifest). Add memory guidance describing the file: relationship-only
   scope, first-person prose, an untouched template means no shared history, the
   size target, the `remember`/`MEMORIES.md` distinction and the sensitive-memory
   rule. Keep the guardrail last; a test asserts the section order.
6. Templates (backend). Replace the `PROFILE.md` template with the R9 version
   (template version 2 in the bootstrap policy). Rewrite Annie (version 2) and
   Caitlyn (version 4) with every R9 identity section written out, preserving
   their appearance and personality; update starter tests.
7. Glossary and ADR. Add **Anima memories** and **Reflection** to `GLOSSARY.md`.
   Add ADR 0009 for the memory scope split: shared user facts, per-Anima
   relationship memory, owner-approved curation.
8. Regenerate the client; update `docs/backend/features/memory.md` and
   `custom-animas-and-content.md` (lines stating new Animas have no relationship
   memory and the required-file rules) and `docs/backend/architecture/http-api.md`.

Checks: focused pytest while developing, then `uv run pytest -q`,
`uv run ruff check`, `make check-test`, and from `src/frontend` `pnpm check` and
`pnpm openapi-ts:check` after regeneration. A fresh task-stack reset shows both
files for both starters through the API.

Completion: tests cover creation, protection, blank save, size limit, scope
restriction, repair, listing, prompt order, influence off and missing-file
tolerance; review has no unresolved blockers.

#### Code Review #1 Findings

Not started.

#### Code Review #1 Revisions

Not started.

### Phase 2 — Memory workspace and create-Anima template

Requirements: R1, R2 and R8 (frontend), R9 (frontend). Depends on Phase 1.

1. Folders. Add the `MEMORIES.md` header and path to the folder model, a second
   child in each Anima folder after `IDENTITY.md`, label-path resolution, filter
   text and removed-Anima draft handling for both files.
2. Protection. Add `isAnimaMemoriesEntry`; protect it from rename, move and delete
   and as a move target; keep it out of the blank-identity guard so it saves blank.
   Update creation-toast wording for Anima folders.
3. Editing. It saves as an ordinary file (no aggregate revision). Verify drafts,
   conflicts, versions and Preview.
4. Repair. When the listing reports a missing `MEMORIES.md`, show the folder state
   and a Repair action that calls the Phase 1 operation and refreshes.
5. Links. Add an "Open memories" link from the Anima identity section to the file
   by entry ID.
6. Create-Anima template. Replace the default identity with the R9 template. The
   upgrade logic recognizes the previous headed and headingless defaults under any
   name and replaces only untouched drafts; the heading-sync behavior is preserved.
   `summarizeIdentityMarkdown` prefers Essence, then Personality.
7. Update `docs/frontend/features/anima-memory.md`,
   `custom-anima-creation.md` and `anima-management.md`.

Checks: unit tests for folders, tree, protection, explorer actions, moves, drafts,
route resolution and the create-Anima template; from `src/frontend`
`pnpm check`, `pnpm web:lint`, `pnpm web:test`, `pnpm build`. Desktop-viewport
browser check on the task stack: both files per folder, `MEMORIES.md`
edit/save/blank save/conflict/versions, protected actions, repair after deleting
the row through SQL on the task stack, identity link, create-Anima default; then a
narrow-layout regression check.

Completion: checks and browser evidence recorded without personal content; review
has no unresolved blockers.

#### Code Review #1 Findings

Not started.

#### Code Review #1 Revisions

Not started.

### Phase 3 — Live edits and the chat memory cue

Requirements: R4, R6, R7 (updates, incognito), R8 (safety, limits). Depends on
Phase 1; the cue link uses Phase 2's workspace selection.

1. Tool access. Wire the Anima repository and the `MEMORIES.md` limit into chat
   tool services. Resolve `[self]/MEMORIES.md` to the turn's Anima in read, patch,
   replace and native `apply_patch` (construct the planner with the Anima ID).
   Reject create, delete and move of the alias, any other Anima path, identity and
   oversized writes with actionable tool errors; stale versions return the existing
   retryable conflict. Reads follow memory influence; writes require updates
   enabled and not incognito.
2. Turn record. Before `record_turn`, add a `memory` block to the assistant
   `message_data`: `updates_enabled` and successful `MEMORIES.md` changes with
   entry ID, version and a bounded excerpt of added text.
3. History API. Return a typed `memory_cue` per assistant message combining the
   stored changes with episode items found by `source_message_id` (one batched
   query per page). Failed writes produce nothing.
4. SSE. Add a `memory.updated` event with the same shape and the run ID, emitted
   after episode recording and before `run.completed`, only when something was
   remembered. Document it in `docs/backend/runtime/chat.md`.
5. Frontend stream. Add a typed guard checked before `isUserResponse`, a
   `memoryCue` field on display messages attached to the last bubble of a run, and
   copy the cue into the rows appended by `onComplete`. Reload maps `memory_cue`.
6. Cue UI. Add a `renderAssistantAccessory` slot to `ChatConversation`; the web
   host renders a `Brain` icon button with a popover listing the episode note
   and/or `MEMORIES.md` excerpt and an "Open in Memories" link. Keyboard reachable
   with accessible names. Quick Chat mirrors the field and sends a new desktop
   command that opens the file in the main window. Avatar-only mode shows nothing.
7. Update `docs/frontend/runtime/chat.md`, `docs/frontend/desktop/quick-chat.md`
   and `docs/backend/features/memory.md`.

Checks: backend tool, executor, SSE and chats API tests (own file only, refusals,
gating, incognito, oversize, stale version, cue shape, failed episode); frontend
guard, mapping, session and Quick Chat validator tests; `pnpm desktop:check`; the
standard backend and frontend commands. Browser check with the deterministic
runtime configured to write both memories: cue while streaming and after reload,
popover contents, link, keyboard access, Quick Chat link.

Completion: checks and browser evidence recorded; review has no unresolved blockers.

#### Code Review #1 Findings

Not started.

#### Code Review #1 Revisions

Not started.

### Phase 4 — Reflection

Requirements: R5. Depends on Phases 1–3 (the Phase 3 turn record excludes
update-disabled turns).

1. Persistence. Add run kind `reflection` to the baseline CHECK and ORM, and a
   table `anima_memory_reflections` (Anima key with cascade delete, owner,
   covered-through message timestamp and ID, run ID, updated time).
2. History port. Add an Anima-scoped read of visible user/assistant turns after the
   watermark, across the owner's chats, excluding internal rows and turns whose
   `memory.updates_enabled` is false, ordered by time and ID, with count.
3. Run creation. Add `POST /v1/memory/manager/runs:reflect` with
   `{anima_id, auto_approve_diffs}`. It follows `create_run` rules (supersede open
   runs, 409 while an approval is pending), returns a clear "nothing to reflect"
   response without creating a run when no turns are uncovered, and stores the
   Anima, batch boundary and turn count in `task_state`.
4. Runtime. Reflection instructions (relationship scope, R9 shape, size target,
   drop resolved threads, say so and propose nothing when there is nothing new,
   sensitive-memory and guardrail framing rules) and a paged turn-reading tool in
   both the live and deterministic runtimes. Extend the manager path parser for
   `animas/<id>/MEMORIES.md`. Reflection runs may only target their Anima's
   `MEMORIES.md`; general runs may see and edit any Anima's `MEMORIES.md` when the
   owner asks; episode runs see neither Anima file.
5. Watermark. Advance it when an approval from a reflection run commits to its
   Anima's `MEMORIES.md` (manual or auto); restore it on undo per the Decision Log.
   Conflicts keep the approval pending and the watermark unchanged.
6. Frontend. Add a Reflect button in the Work-pane header when `MEMORIES.md` is
   selected. It warns about a dirty draft, switches to Memory Manager and starts
   the run with an optimistic line naming the Anima. Show the run kind, the
   nothing-to-reflect message, 409 handling and model-unavailable errors like
   episode processing does.
7. Update `memory-manager-and-episodic-memory.md` and `anima-memory.md`.

Checks: service and API tests with the deterministic runtime (uncovered-only
reads, exclusion of update-disabled and other-Anima turns, nothing to reflect,
approve advances, reject/abandon/conflict keep, undo restores, target
restriction, episode runs blocked, cap behavior); frontend state and projection
tests; the standard commands. Browser check on the task stack with the
deterministic runtime, then one live-model Reflection if the owner provides a key.

Completion: checks and evidence recorded; review has no unresolved blockers.

#### Code Review #1 Findings

Not started.

#### Code Review #1 Revisions

Not started.

## Final integration review

After Phase 4, one full review of the combined diff against spec R1–R10, reusing
still-valid phase evidence, with at most two repair rounds. Confirm the docs,
glossary and ADR describe delivered behavior, and that no requirement is covered
only by a test double where the spec asks for rendered or manual evidence.

## Validation and acceptance

Local commands (repository root, then `src/frontend`):

```bash
uv run pytest -q
uv run ruff check
make check-test
pnpm check
pnpm web:lint
pnpm web:test
pnpm build
pnpm desktop:check
pnpm openapi-ts:check
```

Browser evidence at a desktop viewport on the task stack for Phases 2–4, then a
narrow-layout regression check. Record commands, results, revision and stack URL;
never record personal memory content.

Owner gate G1 (desktop app, live OpenAI model): the spec's owner-verification
criterion. Across two chats with one Anima, the second follows up an open thread
from the first; a second Anima does not know that history; a new Anima does not
claim shared history; a Reflection produces a sensible curated diff. Record the
owner's dated result; agent evidence cannot substitute for it.

Hosted `Validation` is recorded separately from local evidence in the PR.

## Idempotence and recovery

- Schema changes edit the baseline; recovery is a task-stack reset (`reset.sh`
  with the task stack name). Never reset or purge the owner's main stack.
- Anima creation writes identity and `MEMORIES.md` in one transaction; a failure
  leaves neither. Repair is idempotent and never overwrites existing content.
- Chat tool writes use version fencing and fail without partial writes; the turn
  continues on failure.
- Reflection proposals are ordinary Memory Manager approvals: rejection or
  conflict changes nothing; undo restores the file version and watermark.
- Starter version bumps affect only new installations.

## Outcomes & Retrospective

Not started.
