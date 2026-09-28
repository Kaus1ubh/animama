# Memory Manager And Episodic Memory

This page is the backend deep dive for Animama's episodic memory capture and
manual memory-manager workflow. The shorter memory overview lives in
[`memory.md`](memory.md); this document focuses on the data model, runtime
boundaries, API contract, approval semantics, and operational expectations.

## Purpose

Normal product chat uses `POST /v1/animas/{anima_id}/chat:sse`. The direct chat
runtime can read and update curated markdown memory files through constrained
memory tools, but a normal assistant turn may not choose to write memory even
when the conversation contains something worth preserving.

Episodic memory fills that gap by capturing a raw note from the final structured
chat response after successful non-incognito turns. The note is stored as a row
and projected into a generated, read-only markdown file under the virtual memory
filesystem. A user can later open the Memory Manager and ask it to review
pending episode items. The Memory Manager is a specialist maintenance chat that
can inspect memory, propose curated markdown file edits, and process raw episode
items through the same approval flow used for ad hoc memory edits.

The guiding split is:

- **Episode items** are raw chronological capture notes.
- **Episode logs** are generated read-only markdown projections of those rows.
- **Curated memory** is intentional user-scope markdown such as `PROFILE.md` or
  `notes/preferences.md`.
- **The Memory Manager** reviews raw notes and edits curated memory only after
  user approval.

## Core Concepts

### Curated Memory

Curated memory is the editable user-scope markdown filesystem backed by
`memory_entries` and `memory_entry_versions`. It is addressed by relative POSIX
paths such as `PROFILE.md`, `people/shirley.md`, or `notes/preferences.md`.

Curated memory is what normal direct chat context and memory tools are intended
to use as durable profile or preference state.

### Episode Item

An episode item is one `memory_episode_items` row. It usually comes from one
nonblank direct-chat `remember` value.

Important fields:

- `id`: app-generated `mei-<uuid>` ID.
- `user_id`: generated installation-principal owner.
- `source_anima_id`, `source_chat_id`, `source_run_id`, `source_message_id`:
  provenance for the turn that produced the note.
- `occurred_at`: timezone-aware timestamp for the original event.
- `local_date` and `local_timezone`: day used for the generated episode file.
- `episode_path`: generated path such as `episodes/2026/07/2026-07-07.md`.
- `kind`: currently `chat_turn`.
- `text`: normalized capture note, capped by `MEMORY_EPISODE_TEXT_MAX_CHARS`.
- `status`: `pending` or `processed`.
- `processed_at` and `processed_by_run_id`: review audit fields.
- `metadata`: additional structured provenance.

The episode table is the source of truth. Markdown checkbox state is never the
source of truth.

### Daily Episode File

A daily episode file is a generated user-scope memory entry with
`kind = "episode_log"`:

```text
episodes/YYYY/MM/YYYY-MM-DD.md
```

The file renders all episode rows for that user and local date in deterministic
order:

```markdown
# Episodes for 2026-07-07

- [ ] <!-- episode:mei-... --> Pending note text.
- [x] <!-- episode:mei-... --> Processed note text.
```

The HTML comment embeds the stable episode ID for readability and future tooling,
but the backend updates checkbox state by regenerating the whole file from
`memory_episode_items`.

Episode logs are readable and searchable source material. They are not editable
by public memory APIs, ordinary chat memory write tools, or the Memory Manager's
patch tool.

### Memory Manager Run

A memory-manager run is a user-invoked maintenance chat backed by:

- `memory_manager_runs`
- `memory_manager_messages`
- `memory_manager_approvals`

Runs are separate from normal `chat:sse` product chat. They are mounted under
`/v1/memory/manager/...` and are normally used from the Memory Manager mode of
the `/a/memories` Work pane.

Every run has a permanent kind:

- `general`: ordinary manual memory maintenance.
- `episode_processing`: provenance for one backend-owned fixed episode batch.
- `reflection`: curation of one Anima's `MEMORIES.md` from a fixed batch of its
  uncovered chat turns (see [Reflection](#reflection)).

An episode-processing run also has private versioned task state. It maps ordered
durable episode IDs to run-local aliases `E01` through `E50`, records batch size,
`has_more`, timestamps, and `processing` or `processed` status. The public API
returns only a safe task summary and never exposes that ID mapping or copied
episode text.

Run statuses:

- `active`: the run can accept user messages.
- `waiting_approval`: at least one approval is pending.
- `failed`: runtime execution failed and stored an error.
- `completed`: the run was closed after all approvals were resolved, through
  `:complete` (the frontend's New action) or by a newer run superseding it; it
  no longer accepts messages.

### Approval

An approval is a persisted user decision point for one proposed file operation.
The preview contains:

- `operation`: `create`, `update`, or `delete` in the domain schema. Runtime
  validation rejects delete proposals.
- `path`: target user-scope markdown path, or `animas/<anima_id>/IDENTITY.md` or
  `animas/<anima_id>/MEMORIES.md` for an Anima file update. General runs may
  target any owned Anima's files; a Reflection only its own Anima's
  `MEMORIES.md`.
- `old_content` and `new_content`.
- `old_description` and `new_description`, shown separately from body diffs.
- `unified_diff`.
- `expected_version`: optimistic version guard.
- `summary`.
- `decision_feedback`: optional normalized feedback stored only for a rejection.
- `applied_version`: the target entry Version committed by an approval.
- `undone_at` and `undo_version`: the audit result when that approved patch was
  later Undone.
- `can_undo`: a current, server-computed eligibility projection; it is not
  durable authority and is rechecked under locks by the Undo mutation.

Approval statuses:

- `pending`
- `approved`
- `rejected`

Approving commits a valid create or update through `MemoryEntryService`.
Rejecting records the decision, leaves curated memory unchanged, and resumes
the same runtime task. Optional feedback is passed into the Agents SDK
rejection message so the manager can propose a corrected path or finish the
review without a change. An approved patch remains historically approved after
Undo; its card is projected as `Approved · Undone` instead of rewriting the
original decision.

Native Apply Patch represents the candidate as one transient synthetic
document, but approvals persist and expose the parsed body and description
fields. Description-only proposals therefore remain understandable even when
the body unified diff is empty, and the reserved header never appears in the
approval content diff or stored Markdown.

## End-To-End Flow

### 1. Direct Chat Produces `remember`

The direct chat structured response schema includes a required `remember` key
after `display`. The value can be a short string, `null`, or an empty string.

The model guidance asks for 1-3 concise sentences about durable new facts,
preferences, events, decisions, active projects, or relationship/context changes.
The shared sensitive-memory rule (`SENSITIVE_MEMORY_RULE` in
`app/safety/prompts.py`) forbids secrets, credentials and other raw sensitive
data, and keeps suicide and self-harm crisis specifics (methods, plans, means,
crisis details) out of memory unless the user explicitly asked; at most a
general note, such as that the user had a hard week, is kept. Ordinary health
context the user shares, such as allergies or conditions, is remembered like
other personal facts.

### 2. Successful Chat Captures An Episode Item

After a successful visible turn is parsed and persisted,
`DirectChatTurnExecutor._record_episode_memory(...)` best-effort records the
nonblank `remember` text.

Capture is skipped when:

- `remember` is blank or `null`;
- the turn is incognito;
- memory updates are disabled;
- the episode recorder is unavailable;
- the visible turn did not reach the normal success path.

Capture failure is logged and does not turn an otherwise successful `chat:sse`
response into an SSE error.

The session-backed recorder builds a short-lived `MemoryEpisodeService` and
calls `create_episode_item(...)`.

### 3. The Episode Service Refreshes The Daily File

`MemoryEpisodeService.create_episode_item(...)`:

1. Validates the timestamp, local date, kind, and normalized text.
2. Generates an `episodes/YYYY/MM/YYYY-MM-DD.md` path.
3. Inserts a `pending` `MemoryEpisodeItem`.
4. Refreshes the generated daily file for that local date.
5. Commits when `commit_on_write=True`.

`refresh_daily_episode_file(...)` lists all rows for the day, renders deterministic
markdown, and writes it through `MemoryEntryService.put_file_by_path(...)` with:

- `kind = "episode_log"`
- `create_parents=True`
- `allow_system_managed=True`

That internal flag is important: public writes to generated episode logs remain
blocked, but the episode service can regenerate its own projection.

### 4. The User Opens The Memory Manager

The frontend shows the Memory Manager inline in the `/a/memories` Work pane,
beside Manual editing (`Manual | Memory Manager`). Ordinary maintenance uses `POST /v1/memory/manager/runs`. The authoritative
episode workflow uses `POST /v1/memory/manager/runs:process-episodes`, which
selects and fences a backend-owned batch. `POST /v1/memory/manager/runs:reflect`
starts a [Reflection](#reflection) for one Anima.

Specialized creation locks the user's open runs and refuses to supersede one
that is waiting for approval. It then locks up to 51 oldest pending episode rows
in `(occurred_at, id)` order, retains the first 50, derives `has_more` from the
extra row, assigns ordered aliases, and inserts the run plus private task state
in the same transaction. No pending rows returns `409` without changing an
active run. After commit, the service creates a server-owned visible message
such as `Process 50 pending episodes.` and invokes the normal runtime and
bounded Auto approve pipeline.

### 5. The Runtime Produces A Result

The runtime boundary is `MemoryManagerRuntime`. It returns a
`MemoryManagerRuntimeResult` with a typed outcome:

- `completed`: a genuine terminal result that may finalize a specialized batch.
- `waiting_approval`: at least one approval and resumable state were persisted.
- `blocked`: execution stopped incomplete, including blank final output, missing
  approval state/interruption, turn exhaustion, or invalid-patch exhaustion.
- `failed`: provider, configuration, or runtime execution failed.

The result also carries optional:

- assistant message;
- approval requests;
- serialized agent state;
- usage metadata;
- error.

The model never reports reviewed durable IDs or changes episode status. While a
specialized task is `processing`, each initial invocation and approval resume
reloads the fixed owned rows from private task state and rebuilds the same alias
payload. Episode text is untrusted data. The manager must review every alias,
check duplicates with `include_episodic_memory=false`, and submit at most one
create or update operation per Apply Patch approval.

When a create or append request sets `auto_approve_diffs=true`, the service
continues from that persisted result itself. It selects only pending approvals
attributed to the submitted user message, commits each through the same
`decide_approval(...)` path described below, resumes the SDK state, and repeats
up to eight times. The SDK tool still uses `needs_approval=True`; automatic mode
does not grant the patch editor a separate immediate-write path.

### 6. Approvals Commit Curated Memory Changes

When a user approves an approval, `MemoryManagerService.decide_approval(...)`:

1. Locks the approval and owning run for the current user.
2. Verifies the approval is still pending.
3. Commits the approved create/update through `MemoryEntryService`.
4. Stores the approval decision, committed entry ID, and resulting Version in
   the same transaction.
5. Resumes the runtime with the approval decision.
6. Persists the resumed runtime result.

Rejecting may include up to 2,000 characters of normalized feedback. The
service stores it on the approval and passes it to
`RunState.reject(..., rejection_message=...)`. A revised valid Markdown path
can therefore produce another approval in the same fixed-batch task. Plain
rejection may instead finish the review without a curated-memory mutation.

If the target file changed since preview, optimistic version validation returns
`409 Conflict` and leaves the approval pending. That also leaves any associated
episode items pending.

### 7. Episode Items Become `processed`

Episode status is binary:

- `pending`: the Memory Manager has not reviewed the item.
- `processed`: the Memory Manager reviewed the item.

`processed` does not necessarily mean a new curated memory line was written. It
may mean:

- the useful fact was integrated into curated memory;
- the fact was already represented;
- the item was judged stale or not useful.

Only a `completed` runtime result with no pending approval can finalize a
specialized task. The backend locks and verifies every fixed row belongs to the
user, accepts a same-run already-processed row idempotently, and rejects
conflicting processing provenance. In one transaction it marks exactly the
fixed pending rows processed with the manager run ID, regenerates every affected
daily file, changes private task status to `processed`, records `processed_at`,
and keeps the run `active`.

Overflow rows, rows captured after batch selection, and all other users' rows
remain untouched. A retry after task status is already `processed` is a no-op.
Blocked or failed execution marks the run failed but deliberately leaves the
task `processing` and its episode rows pending. Once processed, later messages
on that same run use general Memory Manager instructions and the existing
Responses cursor without reinjecting the fixed batch.

## Reflection

A Reflection curates one Anima's `MEMORIES.md` from that Anima's chat turns
that no applied Reflection has covered. The owner starts it explicitly; nothing
runs one automatically.

A turn is the visible user and assistant rows of one chat run (they share
`chat_id` and `run_id`; a row without a run is its own turn), across all of the
owner's chats with the Anima, ordered by the `(created_at, id)` of its last row.
Internal rows are never read. When the assistant row's
`message_data.memory.updates_enabled` is `false`, the whole turn, including the
user message, is skipped; a missing flag counts as enabled. Incognito turns are
never persisted, and turns of deleted chats are gone.

Coverage is one `anima_memory_reflections` row per Anima: the last covered
message position and the Reflection run that set it. Creation locks the owner's
open runs, refuses a pending approval (`409`), requires the Anima's
`MEMORIES.md` to exist (`409` asking for repair), and selects the oldest
uncovered turns after the coverage, plus the total uncovered count. The batch
stops at 400 turns or 200,000 characters of turn text, whichever comes first,
and always holds at least one turn. Text is counted as the model reads it, each
side shortened past 2,000 characters, so a page of 50 maximal turns still fits
and a history of long replies cannot fail every Reflection on the same oldest
batch. Turns beyond the batch are reported as remaining. No uncovered turn
returns `409` without creating or superseding a run. Otherwise it stores private task state (Anima ID and name, the starting
coverage position and run, the batch's last message position, batch and total
counts, start time and the owner's `preferences.timezone`) and posts a
server-owned message such as `Reflect on 12 turns with Annie.`

The run may read every user memory file and its own Anima's `MEMORIES.md`, and
may propose only an update to `animas/<anima_id>/MEMORIES.md`; the workspace and
approval both refuse any other target, and an oversized or invalid (NUL or
unencodable) proposal is rejected so the model can fix it. Approving that change, manually or through Auto
approve, commits it fenced by the file's memory version (no aggregate revision)
and moves coverage to the batch boundary in the same transaction. Coverage must
still be where the Reflection started, or already at its boundary from an
earlier change in the same run; otherwise the approval conflicts and stays
pending. Rejection, a superseded or failed run, a version conflict and a
Reflection that proposes nothing leave the file and coverage unchanged, so the
same turns are read next time. Undo restores the file and, when no other
applied change from the run remains and coverage is still at this run's
boundary, restores the coverage the run started from. General runs may edit
`MEMORIES.md` when the owner asks but never move coverage.

## Runtime Implementations

### Live OpenAI Agents Runtime

The normal runtime is `OpenAIAgentsMemoryManagerRuntime`. It uses the OpenAI
Agents SDK with:

- `Agent`
- `OpenAIResponsesModel`
- `function_tool`
- `ApplyPatchTool(editor=..., needs_approval=True)`
- resumable run state for human approval interruptions

OpenAI Agents SDK documentation describes `needs_approval=True` tools as
interrupting a run for human approval. A caller can persist run state, approve
or reject interruptions, and resume the same run. Animama stores the SDK state on
`memory_manager_runs.serialized_agent_state` and maps SDK interruptions to
Animama approval rows.

Normal manager turns use Responses server-managed continuation. After every
successful SDK segment, Animama stores the latest nonblank response ID in the
internal `memory_manager_runs.openai_previous_response_id` column. The next user
turn sends only the new user message plus that cursor with
`auto_previous_response_id=True`; it does not rebuild a `Conversation so far:`
transcript from visible database messages. Responses are explicitly stored so
the cursor can be resolved. OpenAI stores response objects for 30 days by
default, so this chain is not indefinite durable history. If a cursor expires or
cannot be resolved, Animama marks the run failed with
`memory_manager_previous_response_unresolvable` metadata and directs the user to
start a new manager run rather than silently dropping or replaying context.

Approval resume uses only the serialized Agents SDK `RunState`, which already
contains its continuation settings. The run-row cursor is not passed as a
second input during resume; the cursor is advanced from the resumed result.
These two persisted fields therefore solve different recovery problems.

Every Responses request also uses a private SHA-256 prompt-cache key derived
from the manager run ID and model. Reusing one stable key within the run helps
route its repeated instruction/tool prefix to the same cache without exposing
the raw user ID, manager run ID, messages, paths, or memory content in the key.

The live runtime tools are:

- `memory_list_files`: lists the navigable path-and-description references shown
  to normal Anima chat, plus owned identities and `MEMORIES.md` files in general
  runs, or the run's own `MEMORIES.md` in a Reflection.
- `memory_read_files(paths)`: reads one path string or an ordered batch of up to
  10 user-scope markdown paths with partial success. Its `content` value is the
  native synthetic description-plus-body patch document in this runtime.
- `search_memory_files(query, include_episodic_memory)`: searches user-scope
  markdown files. The boolean defaults to true for existing callers; false
  excludes generated episode kinds and the `episodes/**` namespace before the
  result limit.
- `read_reflection_turns(page)`: Reflection runs only. Returns 50 turns per
  page, oldest first, each with a run-local number, chat title, local time in
  the owner's zone, and the user and Anima text (each shortened past 2,000
  characters), plus `has_more` and `next_page`.
- `apply_patch`: SDK patch tool requiring approval.

The manager instructions end with the `# List of memory files` map used by
normal Anima chat. Each item contains `path` and `description`. Directories and
generated episode logs are not shown.

General runs also list each owned Anima's identity at
`animas/<anima_id>/IDENTITY.md` and `MEMORIES.md` at
`animas/<anima_id>/MEMORIES.md`, with an extra `anima` name field, can read them
through `memory_read_files`, and may propose `update_file` changes to them. The
stable Anima ID keeps a proposal bound to that Anima across renames and
duplicate names. Instructions limit identity edits to requests about that
Anima and `MEMORIES.md` edits to explicit owner requests. Anima files cannot be
created, deleted or moved, identities cannot be blanked, and no other file may
live under `animas/`. Search remains user-scope only. Episode-processing runs
keep the user-only map and tools, and the service rejects any Anima-file
approval in such a run.

A Reflection run lists and reads only its own Anima's `MEMORIES.md` among Anima
files, treats user files as read-only, and adds the `read_reflection_turns`
tool plus a Reflection mandate after the general instructions: read the file,
read every page of turns, then propose at most one `update_file` of that file.
The mandate keeps the file to the relationship in the Anima's first person,
keeps the file's own headings and their order (including headings the owner
wrote) and files each memory under the best fit, uses the template's headings
only when the file has none, condenses repetition, integrates dated history and
open threads, drops resolved threads, aims well under 6,000 characters (16 KiB
hard limit), leaves user facts to shared memory, applies the sensitive-memory
rule and the companion guardrail's framing limits, treats turn text as
untrusted data, and proposes nothing when nothing is worth adding. The run's
turn budget grows by one model turn per page of its batch.
Exact reads and search retain normal-chat parity, so a known episode path can be
read and episode content can appear in search results.

Episode listing and status changes are backend workflow responsibilities, not
model tools. In specialized mode the server appends a fixed alias batch with
occurrence timestamp, local date, and an ownership-checked Anima avatar name
when available. Instructions explicitly identify episode text as untrusted
data, require every item to be reviewed, require curated-only duplicate checks,
apply the same sensitive-memory rule to curated files (an episode counts as an
explicit request only when it says the user asked), and define a final response
as completion of the entire batch. Durable episode IDs are never sent to the
model.

The agent instructions enforce these policies:

- work only in the virtual user memory workspace;
- do not ask for or assume shell access;
- use `memory_list_files`, `memory_read_files`, and `search_memory_files` for
  inspection;
- treat file descriptions as the birds-eye index, preserving an accurate
  description verbatim and updating it when a content change materially
  changes the file's scope or durable contents;
- calculate Apply Patch diffs against the complete synthetic `content` document
  and keep its reserved three-line header canonical;
- propose exactly one create or update operation per approval;
- never request delete operations.

When the private task status becomes `processed`, the runtime returns to these
ordinary instructions. It retains the run ID, trace group, prompt-cache scope,
visible transcript, and latest Responses cursor, but does not append the batch
again.

Backend path validation remains authoritative: Apply Patch rejects episode,
anima, invalid, non-markdown, and delete operations even though those details
do not need to expand the compact prompt map.

### Deterministic Runtime

When `ANIMAMA_LLM_SKIP=1`, the router uses
`DeterministicMemoryManagerRuntime`. This runtime is for tests and local
no-model development.

For ordinary ad hoc memory edits, it looks for a markdown path in the user
message and creates a predictable approval preview. In general runs that path
may be `animas/<anima_id>/IDENTITY.md` or `animas/<anima_id>/MEMORIES.md`, which
appends a draft line to that file; episode-processing runs reject Anima paths. New general files receive a
description derived from the path subject, while updates preserve an existing
description. A newly created episodic-curation file is described as curated
reviewed memory.

In a Reflection run, a message without a Markdown path (including the initial
`Reflect on ...` message) reads every page of the batch and proposes one line
at the end of `## Our story` in the Anima's `MEMORIES.md`:
`- <local date>: <latest turn's user text> (<N> turns reflected)`, singular for
one turn. When that text is already in the file it proposes nothing. With the
local stack started with `ANIMAMA_LLM_SKIP=1`, chatting with an Anima and then
reflecting on it therefore always produces an approvable `MEMORIES.md` diff.

For a specialized task, it reloads the same fixed batch and drafts a predictable
update to `notes/episodic-memory.md` when one or more episode texts are not
already represented there. If every fixed text is already present, it returns a
terminal no-patch result. Approval, or plain rejection, returns terminal review
completion. Rejection feedback containing another valid Markdown path produces
one revised approval at that path; resolving it completes the review.

## Virtual Workspace Rules

The Memory Manager never receives OS filesystem access. It sees a virtual
workspace built on `MemoryEntryService`.

Readable paths:

- user-scope markdown files;
- owned Anima identities and `MEMORIES.md` files at `animas/<anima_id>/...` in
  general runs, and only the run's own Anima's `MEMORIES.md` in a Reflection;
- generated episode logs by exact path;
- searchable generated episode log content.

Rejected paths or operations:

- absolute paths;
- traversal paths such as `..`;
- non-markdown paths;
- `animas/**`, except updates to an existing `animas/<anima_id>/IDENTITY.md`
  or `MEMORIES.md` in general runs, or to the run's own Anima's `MEMORIES.md`
  in a Reflection;
- user-scope files in a Reflection, which may change only `MEMORIES.md`;
- generated `episodes/**` paths for edits;
- entries with `kind = "episode_log"` for edits;
- delete operations;
- multi-operation patch approvals.

The workspace converts a valid SDK patch interruption into a
`MemoryManagerRuntimeApprovalRequest` containing full before/after content and a
unified diff. Actual persistence happens later through `MemoryManagerService`
after user approval.

## API Contract

All routes require an admitted installation `RequestPrincipal`. The backend filters by
that principal's value in `user_id`; clients do not provide owner IDs.

### List Episode Items

```http
GET /v1/memory/episodes?status=pending&limit=100
```

Query parameters:

- `status`: optional `pending` or `processed`; defaults to `pending`.
- `limit`: `1..1000`; defaults to `100`.

Response:

```json
{
  "items": [
    {
      "id": "mei-...",
      "source_anima_id": "ani-...",
      "source_chat_id": "chat-...",
      "source_run_id": "run-...",
      "source_message_id": "msg-...",
      "occurred_at": "2026-07-07T12:00:00Z",
      "local_date": "2026-07-07",
      "local_timezone": "America/Toronto",
      "episode_path": "episodes/2026/07/2026-07-07.md",
      "kind": "chat_turn",
      "text": "The user prefers weekend planning reminders.",
      "status": "pending",
      "processed_at": null,
      "processed_by_run_id": null,
      "metadata": {},
      "created_at": "2026-07-07T12:00:01",
      "updated_at": "2026-07-07T12:00:01"
    }
  ]
}
```

There is no public episode-status mutation endpoint. The backend-owned
specialized processing workflow marks its fixed reviewed batch processed
and refreshes the affected daily projections.

### Create Memory Manager Run

```http
POST /v1/memory/manager/runs
```

Body:

```json
{
  "message": "Update notes/preferences.md with my latest preference.",
  "auto_approve_diffs": false,
  "metadata": {}
}
```

`message` is optional. When present and nonblank, the service immediately appends
it as the first user message and invokes the runtime. `auto_approve_diffs`
defaults to false and applies only to approvals produced by that initial
message; it is not stored as a run-wide preference.

Response:

```json
{
  "run": {
    "id": "mmr-...",
    "status": "waiting_approval",
    "kind": "general",
    "task": null,
    "model_provider": "openai",
    "model_name": "gpt-5.4-mini",
    "summary": "Live OpenAI Agents memory-manager run",
    "error": null,
    "usage_metadata": {},
    "metadata": {},
    "created_at": "2026-07-07T12:00:00",
    "updated_at": "2026-07-07T12:00:02",
    "completed_at": null
  },
  "messages": [],
  "approvals": []
}
```

### Create Episode-Processing Run

```http
POST /v1/memory/manager/runs:process-episodes
```

Body:

```json
{
  "auto_approve_diffs": false
}
```

The request cannot select item IDs, batch size, text, aliases, owner, or a
custom prompt. The backend owns the fixed oldest-first batch and returns `201`
with the normal run snapshot. Zero pending rows returns
`409 No pending episodes are available to process`. A safe processing summary
looks like:

```json
{
  "kind": "episode_processing",
  "task": {
    "kind": "episode_processing",
    "status": "processing",
    "batch_size": 50,
    "has_more": true,
    "started_at": "2026-07-07T12:00:00Z",
    "processed_at": null
  }
}
```

The response never includes the private `items` array, durable episode IDs, or
raw task-state JSON.

### Create Reflection Run

```http
POST /v1/memory/manager/runs:reflect
```

Body:

```json
{
  "anima_id": "anima-...",
  "auto_approve_diffs": false
}
```

The backend owns the batch: the Anima's oldest uncovered turns, at most 400
turns or 200,000 characters of turn text (see [Reflection](#reflection)).
It returns `201` with the normal run snapshot. The run has `kind = "reflection"`,
`task = null` and a safe summary:

```json
{
  "kind": "reflection",
  "reflection": {
    "anima_id": "anima-...",
    "anima_name": "Annie",
    "turn_count": 400,
    "remaining_turn_count": 12,
    "started_at": "2026-09-26T12:00:00Z"
  }
}
```

`remaining_turn_count` counts uncovered turns left for a later Reflection.
Errors use the ordinary string `detail` and create no run:

- `404 Anima not found` for a missing or foreign Anima;
- `409 Resolve the pending memory approval before reflecting`;
- `409 <name>'s MEMORIES.md is missing; repair it before reflecting`;
- `409 There are no new turns with <name> to reflect on`.

### Get Memory Manager Run

```http
GET /v1/memory/manager/runs/{run_id}
```

Returns the run plus visible messages and approvals. Ownership is enforced by
`user_id`; foreign run IDs return `404`.

### Complete Memory Manager Run

```http
POST /v1/memory/manager/runs/{run_id}:complete
```

Completion locks the owned run and is idempotent for already-completed runs. An
active run with no pending approvals becomes `completed` and receives a
`completed_at` timestamp. A run with any pending approval returns `409 Conflict`
and remains open so the proposal cannot be silently abandoned.

### Append Manager Message

```http
POST /v1/memory/manager/runs/{run_id}/messages
```

Body:

```json
{
  "content": "Update PROFILE.md with my latest preference.",
  "auto_approve_diffs": false
}
```

The run must not be `failed` or `completed`. If the run is
`waiting_approval`, all pending approvals must be resolved before another user
message is accepted.
When `auto_approve_diffs` is true, the request remains in flight while the
backend performs bounded durable approval/commit/resume steps. If the chain
stops because of a conflict, runtime failure, or the eight-decision limit, any
remaining approval stays pending for manual review.

### Decide Approval

```http
POST /v1/memory/manager/approvals/{approval_id}:decide
```

Body:

```json
{
  "decision": "reject",
  "feedback": "Keep this in projects/animama.md instead."
}
```

`decision` is `approve` or `reject`. `feedback` is optional, normalized to null
when blank, capped at 2,000 characters, and allowed only for rejection.

Approve behavior:

- validates ownership;
- validates the approval is still pending;
- validates the target path is still safe and within the run's file scope;
- commits create/update content with `expected_version`;
- for a Reflection's `MEMORIES.md` change, moves the Anima's coverage to the
  run's batch boundary in the same transaction;
- records the approval as `approved`;
- resumes the runtime with the approved interruption.

Reject behavior:

- records the approval as `rejected`;
- persists and returns optional `decision_feedback`;
- does not mutate curated memory;
- resumes the runtime with a feedback-aware rejection signal.

Conflict behavior:

- stale version or path conflicts return `409 Conflict`;
- the approval remains pending;
- associated episode items remain pending.

### Undo Approved Patch

```http
POST /v1/memory/manager/approvals/{approval_id}:undo
```

Undo is available only for the latest still-applicable approved create or
update for its target entry. The backend locks the owned approval, run, target,
and latest approved target row; requires no pending approval in the same run;
and requires the live editable file to remain exactly at the Version produced
by the approval. An update Undo restores `old_content` and `old_description`
together in one new Version. A create Undo soft-deletes only the created file
and retains generated parent directories.

The operation appends one `undo` Version and records `undone_at` plus
`undo_version` on the source approval. A retry after a successful Undo returns
the same result without another mutation. An undone latest approval does not
make an older approval eligible. Undo does not resume the runtime, add a
message, change run/task state, or reopen processed episodes. Undoing a
Reflection's `MEMORIES.md` change restores the coverage the run started from,
as described under [Reflection](#reflection).

## Configuration

The Memory Manager runtime is selected per request in
`src/backend/animama/server/routers/memory_manager.py`.

Environment and settings:

- `ANIMAMA_LLM_SKIP=1`: use deterministic runtime instead of live OpenAI Agents.
- `OPENAI_API_KEY`: required for the live OpenAI Agents runtime.
- `OPENAI_BASE_URL`: optional OpenAI-compatible base URL.
- `ANIMAMA_MEMORY_MANAGER_AGENT_MODEL`: live manager model, default
  `gpt-5.4-mini`.
- `ANIMAMA_MODEL_CLIENT_TIMEOUT_SECONDS`: shared model client timeout, default
  `60.0`.
- `ANIMAMA_MEMORY_FILE_MAX_BYTES`: inherited memory file size guard used by
  `MemoryEntryService`.

If the live runtime is invoked without `OPENAI_API_KEY`, the run fails clearly
with a configuration error instead of silently falling back to the deterministic
runtime.

## Persistence And Ownership

Backend-owned tables:

- `memory_episode_items`
- `memory_manager_runs`
- `memory_manager_messages`
- `memory_manager_approvals`
- `anima_memory_reflections`: per-Anima Reflection coverage, removed with the
  Anima.

All user-visible operations filter by the current request principal. The API
does not accept client-provided owner IDs.

`memory_manager_runs.kind` distinguishes ordinary and specialized runs.
`task_state` is private versioned JSON containing the fixed alias-to-ID map and
task lifecycle, or a Reflection's Anima, coverage boundaries and counts. `memory_manager_approvals` stores normalized rejection feedback,
the exact applied Version, and any later Undo timestamp/Version. Public run
projection parses task state into safe counts and timestamps only and computes
Undo eligibility from current locked-domain invariants rather than trusting a
stored boolean.

The `baseline_20260908` SQL includes these columns and constraints. During
development, update the ORM and baseline SQL directly for schema changes;
the owner decides when to reset an existing database. Ordinary `./reset.sh`
preserves data and does not reapply an edited baseline or upgrade a database
stamped outside the supported revision graph. See
[Database operations](../operations/development.md#database) before working
with such a database or backup.

## Status And Recovery Rules

Episode status is intentionally simple:

- There is no separate skipped state.
- `processed` means reviewed by the Memory Manager.
- Processing may or may not include a curated-memory mutation.

Important recovery cases:

- **Runtime creates approval:** episode items stay pending while the approval is
  pending.
- **User approves:** curated memory commits first, the runtime resumes, and
  only a later terminal completed result can finalize the fixed batch.
- **User rejects:** curated memory is unchanged; plain rejection may complete
  review, while feedback may produce a revised approval. Rows remain pending
  until the runtime reaches terminal completion.
- **Version conflict:** the API returns `409`, the approval remains pending, and
  episode items remain pending.
- **Missing state/interruption, blank output, turn exhaustion, invalid-patch
  exhaustion:** outcome is blocked, the run becomes failed, and the fixed batch
  stays pending.
- **Provider/configuration/runtime error:** outcome is failed; the task remains
  processing and no fixed row is finalized.
- **Projection or provenance conflict:** the finalization transaction rolls back,
  leaving task and episode state unchanged.
- **Repeated completed result:** an already-processed task is a no-op; a
  same-run processed source row is accepted, while another run's provenance is
  a conflict.
- **Auto approve ceiling:** after eight sequential patch approvals, the next
  approval remains pending and the whole fixed batch remains pending.

## Prompt And Search Boundaries

Generated episode logs are intentionally omitted from the canonical
`# List of memory files` used by both direct chat and the Memory Manager. This
prevents prompt navigation from growing with every captured episode.

Episode logs remain searchable through default `search_memory_files` calls, and
the Memory Manager can use search or an exact `memory_read_files` path to inspect
them as source material. It can set `include_episodic_memory=false` when checking
whether a fact already exists in curated memory.

Direct chat and the Memory Manager both use service-layer protections to reject
writes to generated episode logs. Frontend read-only UI is convenience only; the
backend guard is authoritative.

## Frontend Integration Notes

The current `/a/memories` UI starts specialized episode processing immediately,
projects its server-owned summary while the request runs, renders the safe task
summary, supports rejection feedback, and enables the same-run general composer
after processing. It refreshes episode and curated-memory state only after
authoritative responses.

Approval cards render body unified diffs plus a separate Description section
when `old_description` and `new_description` differ. Set, clear, and replacement
states show exact before/after values. A description-only approval says “No
content changes”; the model-only synthetic header is never rendered. Approved
cards expose Undo only while `can_undo` is true and continue to show the original
decision after Undo. Auto approve remains backend-orchestrated and bounded to
eight sequential approvals.

## Testing

Focused backend tests:

```bash
uv run python -m pytest -q \
  tests/test_memory_manager.py \
  tests/test_memory_manager_identities.py \
  tests/test_memory_manager_reflection.py \
  tests/test_memory_episodes.py \
  tests/test_memory_file_tools.py \
  tests/test_memory_files.py
```

Focused backend lint:

```bash
uv run ruff check \
  src/backend/animama/domain/memory_manager.py \
  src/backend/animama/orm/memory_manager.py \
  src/backend/animama/app/services/memory_manager_service.py \
  src/backend/animama/adapters/memory_manager \
  src/backend/animama/server/routers/memory_manager.py \
  src/backend/animama/server/schemas/memory_manager.py \
  tests/test_memory_manager.py \
  tests/test_memory_episodes.py
```

## Troubleshooting

### Pending episodes do not appear

Check that the direct chat turn:

- returned nonblank `remember`;
- was not incognito;
- did not disable memory updates;
- reached successful visible message persistence;
- had a configured memory episode recorder.

Also check backend logs for `Direct chat episodic memory capture failed`.

### Episode file exists but checkboxes are stale

The table is authoritative. Run or inspect the code path that calls
`MemoryEpisodeService.refresh_daily_episode_file(user_id, local_date)`. Status
updates through `mark_items_processed(...)` should refresh all affected days.

### Manager says OpenAI API key is missing

Live manager mode requires `OPENAI_API_KEY`. For local no-model development, set
`ANIMAMA_LLM_SKIP=1` before starting the backend.

### Approval is stuck pending

Common causes:

- the user has not approved or rejected it yet;
- approving hit a stale version conflict;
- the target path became invalid or protected;
- the SDK state could not find the original interruption.

The approval should remain recoverable. The user can retry after resolving the
underlying conflict or reject the approval.

### Episode items stay pending after a proposed patch

That is expected while any approval remains pending. Episode items are processed
only after the manager reaches a no-pending-approval result.

## Implementation Map

Core domain and services:

- `src/backend/animama/domain/memory_episode.py`
- `src/backend/animama/domain/memory_manager.py`
- `src/backend/animama/app/services/memory_episode_service.py`
- `src/backend/animama/app/services/memory_manager_service.py`

Ports and repositories:

- `src/backend/animama/app/ports/memory_episode_port.py`
- `src/backend/animama/app/ports/memory_manager_port.py`
- `src/backend/animama/adapters/repositories/sqlalchemy/memory_episode_repo.py`
- `src/backend/animama/adapters/repositories/sqlalchemy/memory_manager_repo.py`

ORM:

- `src/backend/animama/orm/memory_episode.py`
- `src/backend/animama/orm/memory_manager.py`

HTTP schemas and routes:

- `src/backend/animama/server/schemas/memory_manager.py`
- `src/backend/animama/server/routers/memory_manager.py`

Runtime adapters:

- `src/backend/animama/adapters/openai_agents/runner.py`
- `src/backend/animama/adapters/memory_manager/openai_agents_runtime.py`
- `src/backend/animama/adapters/memory_manager/fake_runtime.py`
- `src/backend/animama/adapters/memory_manager/workspace.py`
- `src/backend/animama/adapters/memory_manager/reflection.py`: Reflection
  mandate and paged turn reader
- `src/backend/animama/app/services/anima_identity_memory.py`: Anima manager
  paths and each run kind's file scope

Reflection history and coverage:

- `src/backend/animama/adapters/repositories/sqlalchemy/chat_message_repo.py`
- `src/backend/animama/adapters/repositories/sqlalchemy/anima_memory_reflection_repo.py`
- `src/backend/animama/orm/anima_memory_reflection.py`

Direct chat capture:

- `src/backend/animama/app/main_structured_response.py`
- `src/backend/animama/app/chat/memory_context.py`
- `src/backend/animama/app/chat/direct_executor.py`
- `src/backend/animama/server/routers/chat/session_services.py`

Tests:

- `tests/test_memory_episodes.py`
- `tests/test_memory_manager.py`
- `tests/test_memory_manager_identities.py`
- `tests/test_memory_manager_reflection.py`
- `tests/test_memory_files.py`

## Version History

Approved writes use the shared monotonic memory-entry version contract.
See [immutable version history](memory.md#immutable-version-history) for adjacent
version diffs and revision-guarded Revert. Approval Undo has the narrower
eligibility rules described [above](#undo-approved-patch).

## Current Limitations

The deterministic runtime checks workflow mechanics without evaluating memory
quality. Frontend component coverage is limited; verify the affected approval,
Undo, and episode-processing flows in the running UI.
