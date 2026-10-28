# Recall recent episode notes and process them automatically

Source agreement: [#775](https://github.com/raymond-van/animama/issues/775), agreed by
the owner on 2026-10-28 and updated the same day with R13; snapshot
`episode-recall-and-processing-spec.md` captured 2026-10-28T18:03:01Z from revision
`aef6dcf7`. Requirement IDs R1–R13 refer to the issue.
Authorized scope: Phases 1–5 and the final integration review, authorized by the
owner on 2026-10-28 (G1). Pushes wait for the owner's word.
Planning baseline: `da23aaaa` (`main`, after #735); implementation baseline
`bddaa75c` (`main`, after #777), onto which the planning commits were rebased.
Workspace: worktree `festive-lovelace-39dad3`, branch
`feat/episode-recall-and-processing`, no Compose stack yet; backend environment
`uv sync` on Python 3.12.13 with LFS content pulled.

## Purpose and context

After this work a chat turn carries `PROFILE.md` and the current Anima's recent
`remember` notes in its system instruction (R1–R4, every composition). In the local
composition, pending notes reach curated memory without the owner opening the Memory
Manager: a backend task starts episode processing once the owner's pending notes
reach a threshold, approves its own proposals and records them as labelled versions
(R5–R11), while the chat shows "Crystallizing N notes into memory…" above its input
(R13). A new ADR records the change to ADR 0009 (R12).

Orientation, by area:

- **Chat context (shared).** `src/backend/animama/app/chat/memory_context.py` builds
  `DirectChatMemoryContext` (identity, `MEMORIES.md`, memory map, manifest) and holds
  `MEMORY_SYSTEM_GUIDANCE`. `src/backend/animama/app/chat/openai_prompt.py`
  (`_stable_instruction_sections`) orders the system sections for both instruction
  styles; Anthropic rows wrap owner text in escaped XML tags. The context service is
  constructed in `src/backend/animama/product_http/chat/turn_setup.py` from
  `ProductRepositories`, so Cloud picks up R1–R4 when it repins.
- **Episodes.** `memory_episode_items` (`src/backend/animama/orm/memory_episode.py`),
  its port `app/ports/memory_episode_port.py` and repository
  `adapters/repositories/sqlalchemy/memory_episode_repo.py`. Indexes include
  `(user_id, local_date, occurred_at)` and `(user_id, status, occurred_at)`.
  Note text is capped at 2,000 characters (`MEMORY_EPISODE_TEXT_MAX_CHARS`).
- **Memory Manager (shared service).** `app/services/memory_manager_service.py`:
  `create_episode_processing_run`, `_supersede_open_runs`, `get_current_run_snapshot`,
  `append_user_message`, `decide_approval`, `_auto_approve_message_diffs`,
  `_approval_change_metadata`. Runs live in `memory_manager_runs`
  (`orm/memory_manager.py`, `alembic/versions/0001_baseline.sql`).
- **Local composition.** `server/memory_manager.py` (`local_memory_manager_service`),
  `server/product_ports.py` (`LocalProductPorts.memory_manager`,
  `user_settings_changed`, `runtime_capabilities`), `server/app.py`
  (`initialize_accountless_runtime` starts lifespan tasks), and the precedent
  in-process worker `server/embedding_refresh.py`.
- **Capabilities.** `app/contracts/runtime_capabilities.py` (`RuntimeCapabilities`,
  fields default to off for other compositions).
- **Frontend.** `src/frontend/web/src/ui/settings/BehaviorDataSettings.tsx` (Memory and
  Memory updates controls), `src/frontend/web/src/ui/main/chat/ChatLoadingStatus.tsx`
  (the status lines above the chat input, such as model downloads),
  `src/frontend/web/src/ui/memory/MemoryVersionsDialog.tsx`
  (version history; summaries already carry `change_metadata`), locales under
  `src/frontend/web/src/locales/`, generated client under
  `src/frontend/packages/runtime-contracts/src/generated` (regenerate with
  `pnpm openapi-ts`, never hand-edit).

Boundaries:

- Core chat dispatch never depends on the worker (backend memory rule); the worker
  lives only in the local composition (`server/`), never in `product_http/` or `app/`.
- Shared protocols that Cloud implements (`ProductPorts`, `ChatTurnServices`) gain no
  required members, and the shared ORM gains no column, so Cloud needs no code or
  migration change to repin. Cloud's own copy of `memory_manager_runs` keeps its
  open-run index, which is correct there because hosted never creates automatic runs.
  Hosted gets R1–R4 and the capability's default `false` on repin. Cloud checks its
  input-token estimates against the larger instructions when it repins; that is
  Cloud's own follow-up, not part of this plan.
- No Alembic revision: schema changes go into the ORM and `0001_baseline.sql` (G2).

## Progress

- [x] G1: owner review and authorization of this plan (2026-10-28, Phases 1–5).
- [x] Phase 1: recall context (R1–R4). Review passed after two repair rounds; see the phase record.
- [ ] Phase 2: automatic-run semantics in the Memory Manager service (R6, R7, R10).
- [ ] Phase 3: local trigger, setting, status and capability (R5, R8, R9, R11 backend).
- [ ] Phase 4: settings control, chat progress line and version label (R10, R11
      frontend, R13).
- [ ] Phase 5: decision record and documentation sweep (R12).
- [ ] Final integration review and full pre-push suite.
- [ ] G3: live manual check with a real Memory Manager model.

## Surprises & Discoveries

Found while planning (2026-10-28, agent, at `da23aaaa`):

- **One open run per owner is a database invariant.** The partial unique index
  `uq_memory_manager_runs_user_open` (status `active` or `waiting_approval`) allows a
  single open run, and the Memory Manager UI keeps the owner's run open until New.
  R7 therefore needs a run origin that the index can see (Phase 2).
- **Cloud migrates its own copy of the runs table.** Hosted migration
  `008_hosted_companion_memory.sql` creates `memory_manager_runs` and the same open-run
  index, so a new ORM column would need a Cloud migration at repin. The origin is
  therefore kept in the run's `metadata` (owner decision below).
- **An approval holds its file's row lock across the model resume.**
  `decide_approval` commits the patch through `MemoryEntryService` (row
  `FOR UPDATE`), then calls `resume_approval_decision` before committing. While a
  resume runs, a chat memory-tool write to the same file waits. Owner-started Auto
  approve has the same behavior today; automatic runs make it likely, because they
  start while the owner is chatting. Phase 2 commits automatic approvals before
  resuming and bounds the chat side's wait (R6). The general fix, no transaction
  across any Memory Manager model request, is a separate refactor that is not filed
  yet.
- **The local turn lease settles after the note is saved.** `LocalChatTurnLease.settle`
  (`server/product_ports.py`) runs once per turn after the stream body, including
  recording and episode capture, has finished. It is local, so it can wake the worker
  without a shared-protocol change.
- **Provenance is already exposed.** Version summaries return `change_metadata`, so
  R10 needs only a new key and a UI label, with no contract change.
- **Settings preferences are free-form JSON.** `PyUserSettingsUpdate.preferences` is
  `dict[str, Any]`, so a typed local route is the clean way to validate the threshold
  and reset the pause (Phase 3).
- **Desktop and Compose run one backend process.** `local/http/server.py` starts
  uvicorn without workers, so the in-process worker can mark open automatic runs from
  an earlier process, such as one ended by a development reload, as interrupted at
  startup.

## Decision Log

- 2026-10-28, owner: spec agreed as published in #775, including its proposed
  defaults (bounds, backoff, daily limit, threshold range 5–50, default 10).
- 2026-10-28, owner (plan review): record a run's origin as `metadata.origin`
  (`owner` when absent, or `automatic`) rather than a new column, so Cloud needs no
  migration. The local open-run unique index becomes owner-only on that key, and a
  second index allows one open automatic run per owner. Rationale: R7 forbids
  superseding or waiting for an owner run, which the current index makes impossible.
- 2026-10-28, owner (plan review): automatic runs commit each approved change in its
  own short transaction before the model resumes, so they hold no file lock during a
  model request. Chat memory-tool writes also give up after 6 seconds of lock wait
  with a retryable tool error, as a backstop for owner-started Auto approve.
- 2026-10-28, owner (plan review): R13's progress line sits with the loading status
  lines above the chat input (spec updated as R13).
- 2026-10-28, agent, after the owner asked whether Cloud must adopt the planned
  30-second poll: the worker wakes from `LocalChatTurnLease.settle` at the end of each
  local turn, on settings changes and at startup, and otherwise rests until its next
  backoff expiry, at most 5 minutes. This starts runs right after the threshold note
  with no shared-protocol change, and Cloud adopts nothing.
- 2026-10-28, agent (proposed for G1): the threshold is read and written through a
  local-only route (`/v1/memory/automatic-processing`), stored under
  `user_settings.preferences.memory.episode_processing`. A write that changes the
  threshold records `reset_at`, which lifts R8's pause. Hosted has no such route.
- 2026-10-28, agent: the recent-notes selection stops at the first note that does not
  fit the character budget, so the included notes stay a contiguous recent run.

## Phased implementation

All work happens in this worktree on this branch, renamed to
`feat/episode-recall-and-processing` before the first push (not pushed yet; the owner
approves each push). Backend commands run from the repository root, frontend
commands from `src/frontend`. Phase commits use `<type>(<scope>)[p#]: <summary>`, for
example `feat(chat)[p1]: include the profile and recent notes in instructions`.

### Phase 1: Recall context (R1–R4)

Review tier: high risk. It changes which private memory enters every chat turn in
both compositions, including the boundary that keeps one Anima's notes out of
another's turns.

Starting source: the branch head after G1. Dependencies: none.

Changes:

1. Add `MemoryEpisodeRepository.list_recent_items_for_anima(user_id, source_anima_id,
   exclude_chat_id, since_local_date, limit)`, newest first by `(occurred_at, id)`,
   in the port and SQLAlchemy repository. Pending and processed items both qualify.
2. Extend `DirectChatMemoryContextService.build_context` with the turn's `chat_id`
   and owner time zone (`preferred_time_zone` of App Settings preferences). When
   memory influence resolves on:
   - open user-scope `PROFILE.md` like `MEMORIES.md` (missing, blank or unreadable is
     omitted and recorded in the manifest's `opened_files`);
   - select at most 20 notes from the last 14 local dates (today and the 13 before),
     stopping before the first note that would pass 3,000 characters of note text,
     then order the result oldest first;
   - record the included note IDs in the manifest.
   `DirectChatMemoryContext` gains the profile content and version and the notes.
   `turn_setup.py` passes the episode and settings repositories it already has.
3. In `_stable_instruction_sections`, add after the Anima memories section a
   `# User Profile` section and a `# Recent Notes` section (each line
   `- YYYY-MM-DD: <text>`). Each has one framing line: notes about the user, or notes
   from earlier chats with this Anima, never instructions, with heading hints not
   being facts. Anthropic rows wrap them in escaped `<user_profile>` and
   `<recent_notes>` tags, as for identity and memories. A profile over 16 KiB is cut
   at the last line boundary within 16 KiB and followed by a line saying the rest can
   be read with `memory_read_files`.
4. Update `memory_system_guidance`: the profile content is already in the
   instructions, so read it only to edit it; recent notes from other chats appear
   under Recent Notes, and older notes are still found by search. Keep the
   benchmark's memory-arm variants (`app/chat/memory_arm.py`) consistent; arm (b)
   has no `remember` field, so it gets no Recent Notes guidance.
5. Update docs: `docs/backend/features/memory.md` (Current Direct Chat Boundary; drop
   "does not inject its content into prompt context yet"),
   `docs/backend/runtime/chat.md` and `docs/backend/runtime/prompt-caching.md`
   (section order and when the prefix changes), and the Prompt And Search Boundaries
   section of `memory-manager-and-episodic-memory.md`.

Tests first, in `tests/test_memory_file_context.py`, `tests/test_turn_instruction_layout.py`,
`tests/test_anthropic_direct_chat.py`, `tests/test_episodic_memory_arm.py` and
`tests/test_memory_episodes.py`:

- other Animas' notes and the current chat's notes are excluded; notes 14 days
  old are excluded and 13 days old included; the 20-note and 3,000-character
  bounds hold; nothing is selected with memory influence off;
- section order and the escaping of forged tags in both instruction styles;
- the system instruction is byte-identical across two turns of one chat when
  nothing changed, and after a selected note becomes `processed`;
- a profile over 16 KiB is cut with the read-more line; missing and blank profiles
  are omitted with their manifest status.

Checks (record each with tree): `uv run pytest -q` on the files above plus
`tests/test_anima_chat_sse.py`, `tests/test_companion_guardrail.py` and
`tests/test_memory_file_tools.py`; `uv run ruff check`; then, as a high-risk phase,
`python3 scripts/heavy-slot.py -- make check-test` before review.

Completion: tests and checks pass, review passes, docs updated, phase commit recorded.

Check record (repository root; trees are working trees computed with a temporary
index over HEAD `b3275da6`):

- `uv run --no-sync pytest -q tests/test_memory_file_context.py tests/test_turn_instruction_layout.py tests/test_memory_episodes.py`:
  failed at collection before the implementation (red), then 66 passed.
- `uv run --no-sync pytest -q -n 2` over the wider chat and memory files (transport,
  materializer, memory file tools, guardrail, benchmark core, executor, Anthropic chat,
  memory arm, chat SSE, golden SSE, speech tags, Memory Manager): 494 passed, 4 failed.
  Two test fakes lacked the new repositories and one test pinned the old guidance
  wording; after fixing them, 75 passed on the two affected files.
- `ruff check`, `ruff format` and `mypy` on the touched files: pass.
- `python3 scripts/heavy-slot.py -- make check-test` at tree `f67c7fda`: typed-content
  audit, format check, lint and mypy (885 files) pass; pytest 5157 passed, 29 skipped,
  2 failed. The new end-to-end test failed because the shared test owner already had a
  `PROFILE.md` (fixed below). `tests/test_model_assets.py::test_an_interrupted_http_body_logs_its_cause_and_resumes_with_a_range`
  failed on an empty log capture; it passes alone and with its file, and this phase
  does not touch it.
- At tree `83650940`: `pytest -n 2 tests/test_anima_chat_sse.py tests/test_model_assets.py tests/test_memory_files.py`: 236 passed.
- At tree `e36b7667` (review #1 repairs): `pytest -n 2` over the context, episode, chat
  SSE, memory tools, layout and Anthropic files: 270 passed; the end-to-end test alone
  passed; ruff and mypy on the touched files pass.
- At tree `05f01af3` (review #2 repairs): `pytest -q tests/test_anima_chat_sse.py`:
  117 passed; ruff on the file passes.

Results: R1–R4 behave as specified. The profile and notes are read only while memory
influence is on, filtered by owner, Anima and chat; the system text is deterministic
within a chat. No shared protocol gained a required member and no schema changed.

#### Code Review #1 Findings

Independent analysis (sdlc-reviewer) of tree `83650940`, high-risk tier, with a separate
checks agent that reran 14 affected test files (536 passed), `ruff check` over backend,
tests and evals, `mypy` (885 files) and the import-boundary check (0 forbidden edges),
all passing. No blocking findings. Non-blocking:

- P1-F1: a profile line ending exactly at the 16 KiB bound was dropped; a file without
  a line break in its first 16 KiB is cut mid-line.
- P1-F2: the prompt-caching row said "per installation" for the profile, which is per
  owner in hosted; its automatic-processing clause depends on Phases 2–3.
- P1-F3: the Anthropic instructions docstring called notes owner-written and named
  the tags incompletely.
- P1-F4: "read it only to edit it" could contradict the cut-profile notice.
- P1-F5: the end-to-end test left the shared owner's profile and notes changed.
- P1-F6: no real-SQL case for a note without a source chat; no two-turn DB test.
- P1-F7: `memory_episodes` defaults to `None`, which silently turns notes off.

#### Code Review #1 Revisions

- P1-F1 accepted: the head is kept whole when the byte after the bound is a newline;
  the mid-line cut is documented in a comment. Test
  `test_a_profile_line_ending_exactly_at_the_bound_is_kept`.
- P1-F2 accepted in part: "per owner"; the clause stays because Phases 2–3 land in
  the same PR (the final review confirms it).
- P1-F3 and P1-F4 accepted: docstring rewritten; guidance now says "read it only to
  edit it or, when it is cut, to see the rest", with its test updated.
- P1-F5 accepted: first restored in a cleanup block, then (review #2) replaced by a
  dedicated owner.
- P1-F6 accepted in part: the repository test adds a note without a source chat; the
  two-turn test is declined as covered by the layout, fake-repository and SQL tests.
- P1-F7 rejected: tests and other constructors build the service without episodes;
  production `turn_setup` and the benchmark runner pass them, and the profile version
  is in the manifest fingerprint.

#### Code Review #2 Findings

Targeted recheck of tree `e36b7667`, with an independent rerun (311 passed, 3 passed
alone, ruff pass). Repairs confirmed. Non-blocking:

- P2-N1: the cleanup's daily-file refresh does nothing when no rows remain, leaving a
  stale episode file.
- P2-N2: the cleanup restored the profile without its description and bootstrap metadata.

#### Code Review #2 Revisions

- P2-N1 and P2-N2 accepted: the end-to-end test now uses its own owner
  (`user-db-recent-notes`) for every row and the principal, and the cleanup is removed.

#### Code Review #3 Findings

Final targeted recheck of tree `05f01af3`, rerunning `tests/test_anima_chat_sse.py`
(117 passed) and the end-to-end test alone (passed). Both repairs confirmed; no
regressions and no new findings. Result: pass. Repair budget used: 2 of 2.

### Phase 2: Automatic-run semantics in the Memory Manager service (R6, R7, R10)

Review tier: high risk. It changes the schema, run invariants and concurrency between
chat and Memory Manager transactions.

Starting source: Phase 1 commit. Dependencies: Phase 1 only for ordering; the code is
independent.

Changes:

1. Origin and indexes (ORM index definitions and `0001_baseline.sql`, kept
   consistent; no new column): a run's origin is `metadata.origin`, `automatic` for
   automatic runs and absent for owner runs, read through one domain helper. Narrow
   `uq_memory_manager_runs_user_open` to
   `COALESCE(metadata->>'origin', 'owner') = 'owner'`, and add
   `uq_memory_manager_runs_user_open_automatic` on `user_id` for open runs whose
   origin is `automatic`.
2. Owner paths see only owner runs: `list_open_runs(_for_update)` and therefore
   `get_current_run_snapshot`, `create_run`, `create_episode_processing_run`,
   `create_reflection_run` and supersession. Owner-started episode processing returns
   `409 Automatic memory processing is in progress; try again shortly` while an open
   automatic run's task is `processing`.
3. Add `MemoryManagerService.run_automatic_episode_processing(user_id)`. It returns a
   typed outcome (`completed`, `failed`, `skipped` with a reason) instead of a
   snapshot, and:
   - skips when an owner-started episode-processing task is still `processing`, when
     no notes are pending, or when an automatic run is already open;
   - otherwise creates an automatic `episode_processing` run with the existing batch
     selection, without touching owner runs, and runs it with Auto approve;
   - approves each proposal in two transactions that reuse `decide_approval`'s
     helpers: the first locks the approval, commits the patch and records the
     decision; the second resumes the runtime and persists its result. No file row
     stays locked during a model request. A crash between the two leaves an open
     automatic run, which startup recovery (step 5) closes;
   - when Auto approve stops with a pending approval (ceiling, conflict, invalid
     target), records it `rejected` with an `automatic_closed` reason and no runtime
     resume, then marks the run `failed` with a stable error; applied changes stay
     and the batch stays pending;
   - on a processed batch completes the run, so it never stays open.
4. `_approval_change_metadata` adds `"trigger": "automatic_episode_processing"` for
   automatic runs (R10).
5. Add `fail_interrupted_automatic_runs(user_id)`: marks open automatic runs `failed`
   with an `interrupted` reason, so a restart frees the automatic slot and owner
   processing. Interrupted runs do not count toward R8's pause.
6. Backstop for chat (R6): the short-lived sessions that execute chat memory tools
   (`product_http/chat/session_services.py`) set `SET LOCAL lock_timeout = '6s'`
   before a write. A lock timeout (SQLSTATE `55P03`) returns a retryable tool error,
   "the file is being updated; try again later", and the turn continues. This covers
   owner-started Auto approve, which keeps today's single transaction.
7. Docs: `memory-manager-and-episodic-memory.md` (run origin, automatic runs, the new
   409, recovery and status rules) and the chat memory tools section of `memory.md`.

Tests first, in `tests/test_memory_manager.py`, `tests/test_memory_file_tools.py` and
the database constraint tests:

- an automatic run beside an open owner run, which stays open and current;
- owner processing refused during an automatic run, and an automatic run skipped
  during owner processing;
- a leftover proposal closed unapplied with its notes pending and the earlier
  approvals applied;
- a second open automatic run rejected by the index;
- interrupted-run recovery, including a crash between an automatic approval's two
  transactions;
- no file row lock held while an automatic run's runtime resumes (a test runtime
  attempts a `NOWAIT` lock on the patched entry from another session);
- the provenance key;
- a chat memory write against a row locked by another session returning the busy
  tool error within the bound.

Checks: the focused Memory Manager suite listed in
`memory-manager-and-episodic-memory.md#testing`, plus `tests/test_memory_file_tools.py`;
`uv run ruff check`; `python3 scripts/heavy-slot.py -- make check-test` before review.
A fresh database is needed (G2); the test suite creates its own.

Recovery: the index edit does not reach existing databases. On an old database the
code still runs, but its open-run index refuses an automatic run while an owner run
is open; the worker treats that unique violation as a skip, not a failure. Reset only
task-owned stacks; the owner decides for others (G2).

Check record: none yet.

#### Code Review #1 Findings

Not started.

#### Code Review #1 Revisions

Not started.

### Phase 3: Local trigger, setting, status and capability (R5, R8, R9, R11 backend)

Review tier: high risk. It adds background concurrency and recovery, a local API and
a shared capability field with client regeneration.

Starting source: Phase 2 commit. Dependencies: Phase 2.

Changes:

1. `server/episode_processing.py`: `AutomaticEpisodeProcessingWorker`, started in
   `initialize_accountless_runtime` and stopped with the other lifespan tasks, following
   `embedding_refresh.py`. On start it calls `fail_interrupted_automatic_runs` and
   makes a first pass. `LocalChatTurnLease.settle` wakes it at the end of every local
   turn, after the turn's note is saved; between wakes it rests until the next backoff
   expiry, at most 5 minutes. Each pass evaluates the installation owner and starts a
   run only when every condition holds:
   - a threshold N is set (absent means 10; `0` means Off);
   - App Settings memory and memory updates are on;
   - the Memory Manager role resolves a tool-capable model whose key is present;
   - at least N notes are pending;
   - no backoff or pause applies;
   - fewer than 10 automatic runs have started today in the owner's time zone.
   It builds the service through `LocalProductPorts.memory_manager` in a fresh session,
   calls `run_automatic_episode_processing`, and after a completed run passes again
   immediately, so a backlog continues within the daily limit. Exceptions are logged
   and never escape the task.
2. R8 state comes from automatic run rows created after the later of the last
   successful episode processing (either origin) and `reset_at`. Consecutive
   non-interrupted failures k give a next attempt at the last failure plus
   min(1 h × 2^(k−1), 24 h); k ≥ 3 is paused. Only `reset_at` and the threshold are
   stored.
3. Local router `server/routers/memory_automation.py`:
   - `GET /v1/memory/automatic-processing` returns the threshold and a state:
     `off`, `idle`, `running`, `backing_off`, `paused`, `needs_model` or
     `memory_off`, with the last error, next attempt time and runs today, plus the
     batch size and start time while `running` (for R13);
   - `PUT` accepts `{"threshold": 0 | 5..50}`, rejects other values with 422, and
     stores `preferences.memory.episode_processing = {threshold, reset_at}`, setting
     `reset_at` when the value changes; it then wakes the worker.
   `LocalProductPorts.user_settings_changed` also wakes it, because memory flags or the
   Memory Manager model may have changed.
4. `RuntimeCapabilities.automatic_episode_processing: bool = False`; local reports
   `true`. Regenerate the OpenAPI client with `pnpm openapi-ts` (uv environment on
   Python 3.12).
5. Docs: a "Automatic episode processing" section in
   `memory-manager-and-episodic-memory.md` (trigger, conditions, state, route,
   recovery, cost bounds) and the Configuration section.

Tests first, with the deterministic runtime and an injected clock, in a new
`tests/test_automatic_episode_processing.py`, plus `tests/test_product_http_runtime_capabilities.py`:

- below and at the threshold, including a wake from the local turn lease; Off;
- memory off and memory updates off;
- no usable model;
- one run at a time;
- chaining a backlog and stopping at the daily limit;
- backoff timing, the pause after three failures, and resumption by a successful
  owner run or a threshold change;
- interrupted runs not pausing;
- route validation;
- the capability value in each composition;
- a worker failure leaving a concurrent chat turn's stream unchanged.

Checks: the new and touched tests, the Phase 2 focused suite, `uv run ruff check`,
`uv run --no-sync python scripts/repository-boundary/check-python-imports.py`, then
`python3 scripts/heavy-slot.py -- make check-test` before review.

Check record: none yet.

#### Code Review #1 Findings

Not started.

#### Code Review #1 Revisions

Not started.

### Phase 4: Settings control, chat progress line and version label (R10, R11 frontend, R13)

Review tier: standard. It changes UI behavior over an already reviewed API.

Starting source: Phase 3 commit. Dependencies: Phase 3's generated client.

Changes:

1. `BehaviorDataSettings.tsx`, shown only when `automatic_episode_processing` is true:
   "Process episode notes automatically" beside the memory controls, as Off or a
   threshold from 5 to 50 using the existing settings components. Under it a short
   status line for `paused`, `needs_model`, `backing_off` and `memory_off`, with the
   last error where present. While memory or memory updates are off it is disabled
   with an explanation, like Memory updates.
2. `ChatLoadingStatus.tsx` (R13): a new `episodeProcessing: { noteCount } | null`
   item, rendered with the existing loading lines as "Crystallizing {{count}} notes
   into memory…". While the capability is true and the page is visible, a query
   reads the status route when a turn completes and every 10 seconds; the item is set
   only while the state is `running`.
3. `MemoryVersionsDialog.tsx`: label versions whose
   `change_metadata.trigger === "automatic_episode_processing"` as automatic updates
   from episode notes, keeping diff and Revert unchanged.
4. Strings in every locale under `src/frontend/web/src/locales/`.
5. Frontend docs where settings behavior and chat status lines are described.

Tests: component tests for the control (hidden without the capability, value
round-trip, disabled states, status lines), for the progress line in
`ChatLoadingStatus.test.tsx` (shown with its count while `running`, hidden otherwise
and without the capability), and for the version label.

Checks: `pnpm verify`; then a browser check on a disposable task stack
(`./reset.sh --name erp --base-port <free base>`) at desktop width, then a narrow
layout: set the threshold, see the state, see the progress line above the chat input
during an automatic run, and see the label after it, all with `ANIMAMA_LLM_SKIP=1`
(the deterministic runtime); then
`python3 ../../scripts/heavy-slot.py -- pnpm e2e:test:fast` against a built stack.

Check record: none yet.

#### Code Review #1 Findings

Not started.

#### Code Review #1 Revisions

Not started.

### Phase 5: Decision record and documentation sweep (R12)

Review tier: light. Documentation only; the final integration review covers it.

Changes:

- `docs/adr/0033-automatic-episode-processing-and-profile-context.md` (accepted, owner
  decision 2026-10-28 through #775). It permits automatic consolidation of shared user
  memory from episode notes in the local composition, records `PROFILE.md` and recent
  notes in every turn's instructions, and keeps `MEMORIES.md` free of background
  rewrites. Index it in `docs/adr/README.md` and mark ADR 0009 "accepted; partly
  superseded by 0033".
- `GLOSSARY.md`: an "Automatic episode processing" entry; check the Reflection and
  Anima memories entries still read correctly.
- A reader-value sweep of the docs touched in Phases 1–4 for repetition or stale
  statements.

Checks: link check by reading; no tests.

Check record: none yet.

## Final integration review

One independent review of combined acceptance across R1–R13, covering Phase 5
explicitly and reusing still-valid phase evidence. It runs no checks of its own. After
its repairs, the full pre-push suite runs once on the final candidate as a heavy job:
`python3 scripts/heavy-slot.py -- make check-test` from the root, and from
`src/frontend` `pnpm verify`, `pnpm web:test:browser` and `pnpm prettier:check`. Its
results go in the PR.

## Validation and acceptance

Each #775 acceptance criterion maps to:

- R1–R2 and R3–R4: Phase 1 tests.
- R5–R6: Phase 3 tests, with the turn-side bound from Phase 2.
- R7: Phase 2 tests.
- R8–R9: Phase 3 tests.
- R10–R11: Phases 2–4 tests and the Phase 4 browser check.
- R12: Phase 5.
- R13: Phase 4 tests and browser check, over Phase 3's status route.

Gates:

- **G1, owner:** review this plan and authorize a phase range.
- **G2, owner:** the new indexes reach a database only through a fresh baseline.
  Task stacks are reset freely. The owner decides whether and when to reset the main
  stack and other existing stacks; until then they run this code, but automatic runs
  skip while an owner run is open.
- **G3, owner, paid provider:** the live check from #775, with a real Memory Manager
  model on a local stack. After chatting until the threshold's notes are pending,
  `PROFILE.md` gains an automatic version, and a fresh chat with the same Anima
  recalls a recent note without searching. The owner runs it, or approves a bounded
  budget for the agent (suggested ceiling: $1). It is recorded in the PR and does not
  hold the merge (`SDLC.md`, owner checks).
- **Optional, owner:** a paid rerun of #470's memory arms against the 2026-10-27
  baseline. It is not a gate.

Hosted CI stays disabled except by owner approval; each PR push costs billed minutes,
so pushes wait for the owner.

## Idempotence and recovery

- The worker is restart-safe: interrupted automatic runs are marked failed at startup,
  their notes stay pending, and the next pass retries under R8.
- Automatic runs never hold an owner's run or approval; a closed leftover proposal
  is recorded with its reason, so nothing waits for the owner.
- Applied automatic changes are ordinary versions; Revert restores any earlier one.
- Turning the setting Off stops new runs; a run in flight completes or fails normally.
- The index change has no in-place migration (G2). Back up a stack before resetting
  it, using the database operations guide.

## Outcomes & Retrospective

Not started.
