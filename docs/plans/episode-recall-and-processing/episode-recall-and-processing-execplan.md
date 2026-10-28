# Recall recent episode notes and process them automatically

Source agreement: [#775](https://github.com/raymond-van/animama/issues/775), agreed by
the owner on 2026-10-28; snapshot `episode-recall-and-processing-spec.md` captured
2026-10-28T16:56:10Z from revision `605d5e50`. Requirement IDs R1–R12 refer to the
issue.
Authorized scope: none yet. This plan awaits owner review (gate G1); implementation
starts only after the owner authorizes a phase range.
Planning baseline: `da23aaaa` (`main`, after #735).

## Purpose and context

After this work a chat turn carries `PROFILE.md` and the current Anima's recent
`remember` notes in its system instruction (R1–R4, every composition). In the local
composition, pending notes reach curated memory without the owner opening the Memory
Manager: a backend task starts episode processing once the owner's pending notes
reach a threshold, approves its own proposals and records them as labelled versions
(R5–R11). A new ADR records the change to ADR 0009 (R12).

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
  Memory updates controls), `src/frontend/web/src/ui/memory/MemoryVersionsDialog.tsx`
  (version history; summaries already carry `change_metadata`), locales under
  `src/frontend/web/src/locales/`, generated client under
  `src/frontend/packages/runtime-contracts/src/generated` (regenerate with
  `pnpm openapi-ts`, never hand-edit).

Boundaries:

- Core chat dispatch never depends on the worker (backend memory rule); the worker
  lives only in the local composition (`server/`), never in `product_http/` or `app/`.
- Shared protocols that Cloud implements (`ProductPorts`, `ChatTurnServices`) gain no
  required members, so Cloud keeps building at its current pin. Hosted gets R1–R4 and
  the capability's default `false` on repin, and never starts automatic runs. Cloud
  checks its input-token estimates against the larger instructions when it repins;
  that is Cloud's own follow-up, not part of this plan.
- No Alembic revision: schema changes go into the ORM and `0001_baseline.sql` (G2).

## Progress

- [ ] G1: owner review and authorization of this plan.
- [ ] Phase 1: recall context (R1–R4).
- [ ] Phase 2: automatic-run semantics in the Memory Manager service (R6, R7, R10).
- [ ] Phase 3: local trigger, setting, status and capability (R5, R8, R9, R11 backend).
- [ ] Phase 4: settings control and version label (R10, R11 frontend).
- [ ] Phase 5: decision record and documentation sweep (R12).
- [ ] Final integration review and full pre-push suite.
- [ ] G3: live manual check with a real Memory Manager model.

## Surprises & Discoveries

Found while planning (2026-10-28, agent, at `da23aaaa`):

- **One open run per owner is a database invariant.** The partial unique index
  `uq_memory_manager_runs_user_open` (status `active` or `waiting_approval`) allows a
  single open run, and the Memory Manager UI keeps the owner's run open until New.
  R7 therefore needs a run origin in the schema, not just metadata (Phase 2).
- **An approval holds its file's row lock across the model resume.**
  `decide_approval` commits the patch through `MemoryEntryService` (row
  `FOR UPDATE`), then calls `resume_approval_decision` before committing. While a
  resume runs, a chat memory-tool write to the same file waits. Owner-started Auto
  approve has the same behavior today; automatic runs make it likely, because they
  start while the owner is chatting. Phase 2 bounds the chat side's wait (R6). The
  general fix, no transaction across Memory Manager model requests, is a separate
  refactor that is not filed yet.
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
- 2026-10-28, agent (proposed for G1): store `origin` (`owner` | `automatic`) on
  `memory_manager_runs` and scope the open-run unique index to owner runs, with a
  second index allowing one open automatic run per owner. Rationale: R7 forbids
  superseding or waiting for an owner run, which the current index makes impossible.
- 2026-10-28, agent (proposed for G1): the worker polls every 30 seconds and also
  wakes on settings changes, instead of a hook on the chat path. Rationale: a turn
  hook would add a required member to `ChatTurnServices`, which Cloud implements, and
  30 seconds meets "right after" in practice. The owner may ask for an immediate hook
  instead.
- 2026-10-28, agent (proposed for G1): the threshold is read and written through a
  local-only route (`/v1/memory/automatic-processing`), stored under
  `user_settings.preferences.memory.episode_processing`. A write that changes the
  threshold records `reset_at`, which lifts R8's pause. Hosted has no such route.
- 2026-10-28, agent (proposed for G1): chat memory-tool writes set a short PostgreSQL
  `lock_timeout` and return a retryable tool error on timeout, so a turn never waits
  on a Memory Manager transaction.
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

Check record: none yet.

#### Code Review #1 Findings

Not started.

#### Code Review #1 Revisions

Not started.

### Phase 2: Automatic-run semantics in the Memory Manager service (R6, R7, R10)

Review tier: high risk. It changes the schema, run invariants and concurrency between
chat and Memory Manager transactions.

Starting source: Phase 1 commit. Dependencies: Phase 1 only for ordering; the code is
independent.

Changes:

1. Schema (ORM and `0001_baseline.sql`, kept consistent): `memory_manager_runs.origin`
   `VARCHAR NOT NULL DEFAULT 'owner'` with a check for `owner` or `automatic`; replace
   `uq_memory_manager_runs_user_open` with the same index restricted to
   `origin = 'owner'`, and add `uq_memory_manager_runs_user_open_automatic` on
   `user_id` for open automatic runs. Domain `MemoryManagerRun.origin` and the mapper
   follow.
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
   - otherwise creates an `origin = 'automatic'` `episode_processing` run with the
     existing batch selection, without touching owner runs, and runs it with Auto
     approve;
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
6. Bound chat's wait (R6): the short-lived sessions that execute chat memory tools
   (`product_http/chat/session_services.py`) set `SET LOCAL lock_timeout` (about 2
   seconds) before a write. A lock timeout (SQLSTATE `55P03`) returns a retryable
   tool error, "the file is being updated; try again later", and the turn continues.
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
- interrupted-run recovery;
- the provenance key;
- a chat memory write against a row locked by another session returning the busy
  tool error within the bound.

Checks: the focused Memory Manager suite listed in
`memory-manager-and-episodic-memory.md#testing`, plus `tests/test_memory_file_tools.py`;
`uv run ruff check`; `python3 scripts/heavy-slot.py -- make check-test` before review.
A fresh database is needed (G2); the test suite creates its own.

Recovery: the baseline edit does not reach existing databases; on an old database the
new code fails on the missing column. Reset only task-owned stacks; the owner decides
for others (G2).

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
   `embedding_refresh.py`. On start it calls `fail_interrupted_automatic_runs`. Each
   pass (every 30 seconds, or on `wake()`) evaluates the installation owner and starts
   a run only when every condition holds:
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
     `memory_off`, with the last error, next attempt time and runs today;
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

- below and at the threshold; Off;
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

### Phase 4: Settings control and version label (R10, R11 frontend)

Review tier: standard. It changes UI behavior over an already reviewed API.

Starting source: Phase 3 commit. Dependencies: Phase 3's generated client.

Changes:

1. `BehaviorDataSettings.tsx`, shown only when `automatic_episode_processing` is true:
   "Process episode notes automatically" beside the memory controls, as Off or a
   threshold from 5 to 50 using the existing settings components. Under it a short
   status line for `paused`, `needs_model`, `backing_off` and `memory_off`, with the
   last error where present. While memory or memory updates are off it is disabled
   with an explanation, like Memory updates.
2. `MemoryVersionsDialog.tsx`: label versions whose
   `change_metadata.trigger === "automatic_episode_processing"` as automatic updates
   from episode notes, keeping diff and Revert unchanged.
3. Strings in every locale under `src/frontend/web/src/locales/`.
4. Frontend docs where settings behavior is described.

Tests: component tests for the control (hidden without the capability, value
round-trip, disabled states, status lines) and the version label.

Checks: `pnpm verify`; then a browser check on a disposable task stack
(`./reset.sh --name erp --base-port <free base>`) at desktop width, then a narrow
layout: set the threshold, see the state, and see the label after an automatic run
with `ANIMAMA_LLM_SKIP=1` (the deterministic runtime); then
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

One independent review of combined acceptance across R1–R12, covering Phase 5
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

Gates:

- **G1, owner:** review this plan and authorize a phase range.
- **G2, owner:** the baseline change needs a fresh database. Task stacks are reset
  freely; the owner decides whether and when to reset the main stack and other
  existing stacks, which must not run this code until then.
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
- The schema change has no in-place migration (G2). Back up a stack before resetting
  it, using the database operations guide.

## Outcomes & Retrospective

Not started.
