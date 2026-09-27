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
- [x] Phase 1: backend `MEMORIES.md` lifecycle, prompt placement and templates
      (review #2 pass; commit `6393451`).
- [x] Phase 2: memory workspace and create-Anima template (review #1 pass;
      commit `6a218fd`).
- [x] Phase 3: live edits and the chat memory cue (backend review #2 pass,
      frontend review #1 pass; commit `59db411`).
- [x] Phase 4: Reflection (review #2 pass; commit `6c95470`).
- [x] Final integration review (review #2 pass; see section).
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
- 2026-09-26, implementation (Phase 1): the `# Anima Memories` preamble only frames
  the file (first-person relationship memory, user facts belong in shared memory,
  an untouched template means no shared history). Write guidance (size target,
  `remember` versus `MEMORIES.md`, sensitive-memory rule) moves to Phase 3 with
  the edit tools, so Phase 1 never describes an action the Anima cannot take.
- 2026-09-26, implementation (Phase 1): the listing field is `memories_entry`;
  a missing file reports `missing` in the chat manifest and an unreadable one
  `unreadable`. Legacy Anima-scope rows other than the two files can be read,
  edited in place or deleted but not created, moved or renamed.
- 2026-09-26, implementation (Phase 3 contract, fixed before splitting backend
  and frontend work): a `memory_cue` object is
  `{"episode": {"text": str} | null, "memories": {"entry_id": str, "version": int,
  "excerpt": str} | null}`. `episode` is the `remember` text actually recorded as
  an episode item; `memories` names the turn's last successful `MEMORIES.md`
  version and up to 600 characters of text added during the turn. The history
  API returns it as nullable `PyChatMessage.memory_cue` on the final visible
  assistant message of a turn. The SSE event is `memory.updated` with data
  `{"type": "memory.updated", "run_id", "message_id", "memory_cue"}` and ID
  `memory-updated-<run_id>`, sent after episode recording and before
  `run.completed`, only when either part is present. Persisted assistant
  `message_data.memory` holds `updates_enabled` and the `memories` part.
- 2026-09-26, implementation (Phase 3 frontend): the cue opens on click or
  keyboard, not hover (R6 allows either; click suits keyboard users and Quick
  Chat's click-through window). "Open in Memories" appears only when the cue has
  a `MEMORIES.md` part; an episode-only cue shows the note without a link,
  because the note has no file of its own yet and linking to an unchanged
  `MEMORIES.md` would mislead. Quick Chat sends `open-memory-entry`; the main
  process reads only the command type and brings the existing main window
  forward, while the main renderer validates the entry ID before navigating.
  The `memory.updated` event also marks memory-entry and episode queries stale
  so the link never opens outdated content.
- 2026-09-26, implementation (Phase 4 backend): "nothing to reflect" mirrors
  episode processing: `409` with a readable string `detail`, creating no run and
  leaving the open run alone; a missing `MEMORIES.md` also returns `409` asking
  for repair. The summary is a separate `run.reflection` object
  (`anima_id`, `anima_name`, `turn_count`, `remaining_turn_count`, `started_at`)
  rather than a union inside `run.task`. A turn is the visible rows sharing a
  chat and `run_id`; a turn whose assistant row recorded `updates_enabled: false`
  is skipped whole. Coverage advances at approval only if it is still where the
  run started (or already at this run's boundary), otherwise the approval
  returns `409` and stays pending; undo restores the previous coverage only if
  coverage still points at this run's boundary and no other applied change from
  the run remains. Reflection runs can read user files but change only their
  own `MEMORIES.md`, and never see identities. The turn tool
  `read_reflection_turns` pages 50 turns, shortens each side past 2,000
  characters and shows times in the owner's time zone.
- 2026-09-26, implementation (Phase 4 review): a Reflection batch is the oldest
  uncovered turns up to 400 turns and 200,000 characters of the text the model
  reads (each side shortened past 2,000 characters), always at least one turn,
  so long-reply histories cannot fail on the same batch forever. The Reflect
  button appears in both Manual and Memory Manager modes; refusals share one
  "Reflection did not start." toast carrying the server's reason; a dirty
  `MEMORIES.md` draft asks for confirmation; failed and completed banners say
  whether an applied change stands.
- 2026-09-26, owner: owners may write their own `MEMORIES.md` headings, so the
  template is not a required shape. Live edits and Reflection keep the file's
  existing headings and order (including owner-written ones) and file memories
  under the best fit; Reflection uses the template's headings, read from
  `ANIMA_MEMORIES_TEMPLATE`, only when the file has none. Spec R5 wording updated
  to match.
- 2026-09-26, owner: first-run personalization must not depend on the
  `PROFILE.md` template text. `with_preferred_name` replaces an existing
  `Preferred name:` line or inserts one under a Basics heading, the first
  heading or the top; the file counts as managed while its
  `managed_entry_version` equals its version, whatever template it came from.
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
   in the manifest). Frame the file with a short preamble: relationship-only
   scope, first-person prose, an untouched template means no shared history.
   Write guidance follows in Phase 3. Keep the guardrail last; a test asserts the
   section order.
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

Phase record: issue #157; starting source `6c9bc36`. Implementation evidence
(Python 3.12.13 venv): `make check-test` 1933 passed, 7 skipped, mypy clean;
`uv run ruff check` pass; `pnpm check`, `pnpm web:lint` and `pnpm openapi-ts:check`
pass; `git diff --check` clean; Python import boundary 0 forbidden edges.
Repository-wide `uv run ruff format --check` flags two unmodified
`scripts/repository-boundary` files that fail identically on `main`. Browser
checks: not applicable (no UI in this phase). Also changed: first-run
personalization now fills `Preferred name:` in the v2 Basics section, and
`scripts/repository-boundary/consumers/backend.py` follows the v2 policy.

#### Code Review #1 Findings

Reviewed the working tree on `6c9bc36` (sdlc-reviewer analysis plus a separate
checks run; all checks passed).

- P1-R1-F1 (blocking): `docs/backend/features/user-profiles-and-usernames.md`
  still stated bootstrap template version `1` and an in-place preferred-name
  line update.
- P1-R1-F2 (optional): repair took no Anima lock; two concurrent repairs raced to
  a 409, and a repair racing Anima deletion could leave an orphan template row.
- P1-R1-F3 (optional): the version-1 starter seed-pin test became vacuous once no
  starter is version 1.
- P1-R1-F4 (optional): `http-api.md` overstated the Anima-scope restriction
  (legacy rows remain readable, deletable and editable in place).
- P1-R1-F5 (optional): the glossary's Reflection entry describes Phase 4 behavior.
- P1-R1-F6 (optional): the plan's Phase 1 step 5 still listed write guidance the
  implementation deferred.

#### Code Review #1 Revisions

- F1 accepted: the doc now states template version `2` and the Basics
  `Preferred name:` line.
- F2 accepted: `repair_anima_memories` locks the owned Anima row
  (`_lock_anima`) before checking for the file, serializing concurrent repairs and
  Anima deletion. Verified by code reading and the existing repair tests
  (39 passed with the starter and personalization tests); a two-session race test
  was not added because the fixture has no concurrent-session helper.
- F3 accepted: removed the vacuous test and its unused import.
- F4 accepted: `http-api.md` now names the rejected operations.
- F5 deferred to Phase 4, which delivers Reflection in the same PR; the final
  integration review confirms the entry.
- F6 accepted: recorded in the Decision Log.

Checks after revisions: `uv run ruff check src/backend tests`, `ruff format
--check src/backend tests`, `mypy src/backend/animama` pass; focused pytest on
starters, Anima memory directory and personalization 39 passed.

#### Code Review #2 Findings

Targeted recheck of F1–F4 and F6 on the repaired tree: all verified, including
scratch two-session race tests (concurrent repairs serialize to one row; repair
and Anima deletion leave no orphan). Result: pass. Optional notes:

- P1-R2-F1: a no-op repair returned inside the transaction, holding the Anima
  lock until the request session closed.
- P1-R2-F2: Phase 1 step 5 and Phase 3 steps did not reflect the guidance move.
- P1-R2-F3: `memory.md` said an Anima scope "holds only" the two files, which
  overstates it for legacy rows.

#### Code Review #2 Revisions

- F1 accepted: the existing-file path rolls back its read-only transaction before
  returning.
- F2 accepted: Phase 1 step 5 now describes the preamble only; Phase 3 step 1 and
  its checks carry the write guidance.
- F3 accepted: "admits only", matching ADR 0009.

Checks: repair tests 10 passed; ruff and format clean. Repair budget used: one of two.

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

Phase record: issue #158; starting source `6393451`. Task stack
`animama-anima-memories` at `http://animama-anima-memories.localhost:8760`
(development mode, `ANIMAMA_LLM_SKIP=1`, only `web` published). Local evidence
from `src/frontend`: `pnpm check`, `pnpm web:lint`, `pnpm build` pass;
`pnpm web:test` 317 files / 1927 tests pass; Prettier check on changed files
clean. Browser evidence at 1440×900 on a fresh stack: first run fills
`Preferred name:` in the v2 `PROFILE.md`; each Anima folder lists `IDENTITY.md`
then `MEMORIES.md` with the template; the `MEMORIES.md` row menu disables Rename,
Move to… and Delete, and Manual Delete is disabled; edit and save created
Version 2 and a blank save Version 3 while the Anima's aggregate revision stayed
1; deleting Caitlyn's row through SQL on the task stack showed "Needs repair" and
"MEMORIES.md is missing." with Repair, which restored the template with a toast;
Annie's Identity tab renders the new starter identity and "Open memories" opens
the file; the create-Anima Identity step shows the R9 template with the name in
the heading. Narrow layout (375×812): the Files pane shows both files per folder
without overflow.

#### Code Review #1 Findings

Reviewed the Phase 2 files in the working tree on `6393451` (sdlc-reviewer;
concurrent Phase 3 backend edits excluded). Checks: 11 Phase 2 test files 115
passed, full web vitest 1927 passed, eslint, Prettier, `tsc` and
`git diff --check` clean; upgrade edge cases probed on a scratch copy. Result:
pass; all findings optional.

- P2-R1-F1: `summarizeIdentityMarkdown` has no production caller, so the
  Essence-first change only touched dead code.
- P2-R1-F2: two `MemoryLibraryPage` comments still said "identity" for label
  paths that now include `MEMORIES.md`.
- P2-R1-F3: a local `animaFile` in `resolveWorkspaceSelection` shadowed the
  module helper.
- P2-R1-F4: after a successful repair the focused Repair button disappears and
  focus falls to the document body.
- P2-R1-F5: `data-layer.md` did not mention the repair and memories-entry hooks.
- P2-R1-F6: deleting an Anima with both drafts dirty raises two same-titled
  toasts.

#### Code Review #1 Revisions

- F1 accepted: reverted the summary change and its test; the helper is untouched
  (removing the pre-existing unused helper is outside this plan).
- F2 accepted: comments say "Anima file".
- F3 accepted: renamed to `labelled`.
- F4 deferred: repair is a rare recovery action and the spec sets no focus
  requirement; the file reappears in place.
- F5 accepted: one sentence added to `data-layer.md`.
- F6 rejected: rare, and the two descriptions name different files.

Checks after revisions: memory-entries, memory UI and animas vitest 117 passed;
eslint, Prettier and `tsc -p tsconfig.app.json --noEmit` clean.

### Phase 3 — Live edits and the chat memory cue

Requirements: R4, R6, R7 (updates, incognito), R8 (safety, limits). Depends on
Phase 1; the cue link uses Phase 2's workspace selection.

1. Tool access. Wire the Anima repository and the `MEMORIES.md` limit into chat
   tool services. Resolve `[self]/MEMORIES.md` to the turn's Anima in read, patch,
   replace and native `apply_patch` (construct the planner with the Anima ID).
   Reject create, delete and move of the alias, any other Anima path, identity and
   oversized writes with actionable tool errors; stale versions return the existing
   retryable conflict. Reads follow memory influence; writes require updates
   enabled and not incognito. Add write guidance: the alias, small edits only,
   relationship-only content, the size target, `remember` versus `MEMORIES.md`,
   the sensitive-memory rule and guardrail-consistent framing.
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
gating, incognito, oversize, stale version, cue shape, failed episode, write
guidance present only when writes are enabled); frontend
guard, mapping, session and Quick Chat validator tests; `pnpm desktop:check`; the
standard backend and frontend commands. Browser check with the deterministic
runtime configured to write both memories: cue while streaming and after reload,
popover contents, link, keyboard access, Quick Chat link.

Completion: checks and browser evidence recorded; review has no unresolved blockers.

Phase record: issue #159; starting source `6393451` (backend) and `6a218fd`
(frontend, after Phase 2 landed). The backend and frontend halves were built in
parallel against the Decision Log contract. Backend implementation evidence:
`make check-test` 1968 passed, 7 skipped, mypy and ruff clean; import boundary 0
forbidden edges; `pnpm openapi-ts:check` current. Design notes: the alias is
recognized by `is_anima_self_memories_alias` and reaches the file only when the
turn opened `MEMORIES.md` (memory influence on); a whole-file replace is fenced
on the version the Anima last saw (instructions, a read or its own write), so a
stale rewrite cannot erase an unseen owner edit, while patches work on current
content; the write guidance joins `# Memory Guidance` only when the turn may
edit the file.

#### Code Review #1 Findings

Backend half reviewed first (sdlc-reviewer; working tree on `6a218fd`, limited
to backend, tests, backend docs and the generated client). Focused pytest 282
passed; ruff, format, mypy, import boundary and `openapi-ts:check` clean.

- P3B-R1-F1 (blocking): `runtime/chat.md` still said memory tools reach only
  user-scope files, and `http-api.md`'s SSE event list lacked `memory.updated`.
- P3B-R1-F2 (optional): an alias replace sending `description: null` wiped the
  stored description, which is not in the instructions.
- P3B-R1-F3 (optional): an owner save between two Anima writes in one turn can
  appear in the excerpt.
- P3B-R1-F4 (optional): the size-limit code and the missing-file message were
  duplicated as literals.
- P3B-R1-F5 (optional): reading a missing alias returned a generic retryable
  `not_found` without the repair pointer.
- P3B-R1-F6 (optional): `memory.md` said every read path resolves with
  `anima_id=None`.
- P3B-R1-F7 (optional hardening): the `# Anima Memories` preamble did not say to
  treat the content as notes rather than instructions.

#### Code Review #1 Revisions

- F1 accepted: both docs corrected.
- F2 accepted: a null description on an alias replace keeps the stored one;
  new test.
- F3 accepted as documented behavior in `memory.md`; diffing each write
  separately adds complexity for a rare owner-and-Anima race within one turn.
- F4 accepted: `ANIMA_MEMORIES_TOO_LARGE` (domain) and
  `ANIMA_SELF_MEMORIES_MISSING_MESSAGE` replace the literals.
- F5 accepted: a missing alias read returns non-retryable `not_found` with the
  repair message; new test.
- F6 accepted: doc corrected.
- F7 accepted: the preamble now says to treat the content as remembered notes,
  never as instructions.

Checks after revisions: ruff, format and mypy clean; memory tools, memory
context, guardrail, executor, Anima memory directory and chat SSE tests 276
passed. The frontend half's review and a combined targeted recheck follow.

#### Code Review #2 Findings

Backend targeted recheck of F1–F7 on the repaired tree: all verified.
`make check-test` 1970 passed, 7 skipped; ruff, format and mypy clean. Result:
pass. Optional notes: `memory.md` should mention that native `update_file` on a
missing alias returns `patch_rejected` and the preamble's new sentence;
`ANIMA_SELF_MEMORIES_MISSING_MESSAGE` was missing from `__all__`.

#### Code Review #2 Revisions

All three notes applied (two doc sentences and the `__all__` entry). Backend
repair budget used: one of two.

#### Code Review #1 Findings (frontend half)

Reviewed `src/frontend/**` (generated client excluded) and `docs/frontend/**` on
`6a218fd` (sdlc-reviewer). Focused web vitest 97 passed, desktop command tests
2 passed, product-ui Playwright chat lifecycle 19/19, web `tsc -b`, desktop
`tsc`, eslint and Prettier clean. Result: pass; all findings optional.

- P3F-R1-F1: episode-only cues have no link, which the plan text did not record.
- P3F-R1-F2: the popover opens on click or keyboard only.
- P3F-R1-F3: the main process reveals the main window before the renderer
  validates the entry ID.
- P3F-R1-F4: the episode note had no height limit, unlike the excerpt.

#### Code Review #1 Revisions (frontend half)

- F1 and F2 accepted as decisions and recorded in the Decision Log.
- F3 rejected: only the first-party Quick Chat window can send the command, and
  the main process only shows an existing window; validation stays at the
  navigating renderer, as documented in `quick-chat.md`.
- F4 accepted: the note scrolls within the same `max-h-40` as the excerpt.

Implementation evidence (frontend, from `src/frontend`): `pnpm packages:build`,
`packages:check`, `check`, `web:lint`, `build`, `desktop:check` pass;
`web:test` 319 files / 1938 tests; `packages:test` product-ui 19/19;
`desktop:test` 17 files / 311 tests. Browser evidence on the task stack at
1440×900 (the web service was restarted so its container rebuilt product-ui):
the deterministic runtime cannot produce memory writes, so a `memory.updated`
frame was injected into the live SSE stream by wrapping `fetch`. The cue icon
appeared on the reply while streaming; its popover (dialog "What Annie
remembered") listed "Noted in episodes" and "Added to Annie's memories" with
"Open in Memories"; Escape closed it and returned focus to the icon. For the
reload path, the last assistant message's `message_data.memory` and a linked
episode item were seeded in the task-stack database: the history API returned
the combined `memory_cue`, the icon rendered after reload, and "Open in
Memories" opened Annie's `MEMORIES.md`. Chat-only mode shows the cue;
avatar-only mode shows none. At 375×812 the popover flips above the icon and
stays inside the viewport with nothing covering it. Not performed: Quick Chat
in Electron and a live-model turn (owner gate G1).

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

Phase record: issue #160; starting source `59db411`. The backend was started by
one agent that stalled twice (likely an untimed test run) and finished by a
fresh agent with every test command under `timeout`. Backend evidence after
repairs: `make check-test` 1994 passed, 7 skipped; ruff, format, mypy clean;
import boundary 0 forbidden edges; `openapi-ts:check` current. Frontend
evidence after repairs: `pnpm check`, `web:lint`, `build` pass; `web:test`
320 files / 1949 tests. Browser evidence on the purge-reset task stack
(deterministic runtime, 1440×900): Reflect with no chats switched to Memory
Manager and showed "There are no new turns with Annie to reflect on" without a
run; after one chat turn, Reflect showed "Reflecting on 1 turn with Annie", a
proposal card labelled `Animas/Annie/MEMORIES.md` with a dated line under Our
story, and Reflect disabled while pending; Approve produced Version 2 in
Preview; Undo restored the file (Version 3) and the same turn became
uncovered again; Reflect with Auto approve applied it without a card
(Version 4); Reflect again returned 409 "no new turns"; a dirty draft raised
"Reflect with an unsaved draft?" and Cancel kept Manual mode; Reflect is hidden
for `IDENTITY.md`; at 375×812 the header fits the tabs and Reflect. The check
found a horizontal overflow of the Memory Manager panel from an unbreakable
path and "1 turns" wording in the deterministic runtime, both fixed below. Not
performed: a live-model Reflection (owner gate G1).

#### Code Review #1 Findings

Backend (sdlc-reviewer, `59db411` working tree; focused pytest 162 + 349
passed; scratch probes for coverage fencing and multi-change undo passed).
Result: pass, all optional.

- P4B-R1-F1: no service tests for a failed Reflection, the coverage-fencing
  409, undo with another applied change, or turn shortening.
- P4B-R1-F2: leftovers (unused helpers, duplicated branch, hardcoded constants,
  wrong message for invalid content).
- P4B-R1-F3: three copies of owner time-zone resolution.
- P4B-R1-F4: the refusal message said "change" for refused reads.
- P4B-R1-F5: 400 maximal turns could exceed model context on every attempt.
- P4B-R1-F6: millisecond commit-order window around the boundary (theoretical).

Frontend (sdlc-reviewer; focused vitest 172 passed, `tsc`, eslint, Prettier
clean). Result: blocked.

- P4F-R1-F1 (blocking): a failed Reflection's banner claimed `MEMORIES.md` was
  unchanged even after a change from the run had been applied.
- P4F-R1-F2 (optional): "Reflect anyway" did not recheck whether a run could
  start.
- P4F-R1-F3 (optional): Auto approve is not visible in Manual mode.
- P4F-R1-F4 (optional): a doc sentence overstated query recovery; a completed
  run still said "Reflecting on".

#### Code Review #1 Revisions

- P4B-R1-F1 accepted: four tests added (reflection tests 17 → 24 with F5).
- P4B-R1-F2 accepted: leftovers removed, constants reused, invalid content
  reported as invalid.
- P4B-R1-F3 accepted: `time_zone_or_utc` and `preferred_time_zone` in
  `domain/settings.py`; the episode recorder now falls back to UTC for a
  malformed zone name instead of failing.
- P4B-R1-F4 accepted: separate messages for refused Anima files and read-only
  user files.
- P4B-R1-F5 accepted: 200,000-character batch budget (Decision Log).
- P4B-R1-F6 rejected: needs concurrent chats committing within milliseconds of
  a Reflect; recorded here for awareness.
- Browser findings accepted: shared `format_turn_count` pluralizes the
  deterministic runtime's text; the Memory Manager panel root gained `min-w-0`
  and message bodies wrap long tokens.
- P4F-R1-F1 accepted: banners branch on whether the run has an applied,
  not-undone change; tests added.
- P4F-R1-F2 accepted: confirmation rechecks and explains why a run cannot
  start.
- P4F-R1-F3 rejected: Reflect switches to Memory Manager, where the setting is
  visible; it is the same conversation setting as every other run.
- P4F-R1-F4 accepted: doc corrected; completed runs say "Reflected on".
- Also fixed: stale "modal" wording in the backend Memory Manager doc.

#### Code Review #2 Findings

Targeted recheck of all accepted Phase 4 revisions, backend and frontend:
all verified (reflection/manager/episode/executor/fresh-install pytest 188
passed; ruff, format, mypy, import boundary clean; web vitest 177 passed,
`tsc`, eslint, Prettier clean). Result: pass. Optional notes: the model-facing
mandate said "1 chat turns"; a few edited backend doc lines are unwrapped; a
completed Reflection with an applied change uses the neutral banner style.

#### Code Review #2 Revisions

The mandate now uses `format_turn_count` (reflection tests 24 passed, ruff and
format clean). Doc wrapping and banner styling left as is (cosmetic). Browser
re-check: a general-run message naming `animas/<id>/MEMORIES.md` rendered the
long path, and after Approve the Work pane stayed at its width with no
horizontal scroll. Repair budget used: one of two.


## Final integration review

After Phase 4, one full review of the combined diff against spec R1–R10, reusing
still-valid phase evidence, with at most two repair rounds. Confirm the docs,
glossary and ADR describe delivered behavior, and that no requirement is covered
only by a test double where the spec asks for rendered or manual evidence.

#### Code Review #1 Findings

Reviewed `b633af1..6c95470` (sdlc-reviewer, final integration mode).
`make check-test` 1994 passed, 7 skipped; `openapi-ts:check` current;
`pnpm check` and 39 focused web test files (255 tests) passed. A separate full
frontend run passed `packages:build`, `packages:check`, `check`, `web:lint`,
`web:test` (320 files / 1949 tests), `packages:test` (product-ui 19/19),
`build`, `desktop:check`, `desktop:test` (17 files / 311 tests) and
`openapi-ts:check`; `prettier:check` flags only 13 files unchanged since
`b633af1`, and every changed frontend file passes Prettier. No correctness,
security or cross-phase defect: version fencing, identity-only revisions,
memory controls, the `updates_enabled` handoff from Phase 3 to Phase 4, cache
refreshes, Anima deletion and safety ordering were verified across phases.

- FI-R1-F1 (blocking): G1 did not include a real `MEMORIES.md` edit producing
  the cue, or the Quick Chat cue and its handoff, so those R6 behaviors rested
  only on injected and seeded evidence without an owner check.
- FI-R1-F2 (optional): the Final integration review heading was lost and two
  Phase 1 references pointed to missing evidence.
- FI-R1-F3 (optional): the Phase 2 browser evidence lacked the `MEMORIES.md`
  conflict flow.
- FI-R1-F4 (optional): several backend docs, the glossary and ADR wording were
  slightly stale or imprecise.
- FI-R1-F5 (optional hardening): general Memory Manager instructions for
  `MEMORIES.md` lacked the sensitive-memory and guardrail-framing rules.

#### Code Review #1 Revisions

- F1 accepted: G1 now includes the real write→cue path and the Electron Quick
  Chat cue with "Open in Memories".
- F2 accepted: heading restored; commit references added to Progress.
- F3 accepted: the conflict flow is added to G1 (unit coverage exists in
  `workspace-drafts.test.ts`; the conflict UI is shared with other files).
- F4 accepted: backend doc wording corrected; the glossary now says "while
  memory influence is on". ADR 0009 keeps the spec's wording as decision
  history.
- F5 accepted: general-run `MEMORIES.md` instructions carry both rules; a test
  asserts them.

Checks after revisions: ruff and format clean; Memory Manager identity and
reflection tests 32 passed.

#### Code Review #2 Findings

Targeted recheck of FI-R1-F1–F5: all verified, no regressions (Memory Manager
tests 91 passed; ruff, format, mypy, import boundary and `git diff --check`
clean). Result: pass. Optional notes: the guardrail-framing sentence now exists
in three prompt places and could become one constant; two edited prose lines
are longer than their neighbours.

#### Code Review #2 Revisions

None applied: the three framings differ in person (chat addresses the Anima
directly) and the line lengths are cosmetic. Final repair budget used: one of
two. Agent work is complete; owner gate G1 and exact-candidate merge approval
remain.


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
claim shared history; a Reflection produces a sensible curated diff; a real turn
in which the Anima edits `MEMORIES.md` shows the memory cue while streaming and
after reload; in Electron Quick Chat the cue appears and "Open in Memories"
brings the main window forward on the file; and a `MEMORIES.md` edit that
conflicts with a newer save offers Use latest and Save over latest. Record the
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
