# Anima Memory

Frontend memory workflows use the
scoped `/v1/memory/entries` API through generated client methods and TanStack
Query hooks.

## Current User-Facing Surfaces

`/a/memories` is the protected, installation-wide memory workspace. Beside the
persistent application sidebar, it fills the remaining viewport with an inline
explorer, Manual or Memory Manager work pane, and live Markdown preview. It has
no page-level heading, tabs, outer frame, or content gutter; one shared pane
surface and faint resizable dividers provide the visual structure. Installation upload
management and debug retrieval tools live in Library's Chat Uploads section.

The workspace loads content-free entry headers recursively. Its left explorer
keeps ordinary physical directories explicit but replaces the generated
`episodes/**` storage hierarchy with one virtual `Episodes` root. That root is
always the first explorer item, remains visible with an empty state before any
episodes exist, and cannot be displaced by newly created memory entries.
Canonical `episodes/YYYY/MM/YYYY-MM-DD.md` files are grouped by newest month and
displayed with friendly dates. Malformed or historical episode paths remain
visible under `Other episodes`. Generated episode files are read-only.

The explorer supports local filtering, refresh, file and directory creation,
rename, file deletion and recursive directory deletion, path tooltips, per-file
dirty indicators, and hierarchy moves. Its centered icon toolbar can expand or
collapse every directory group at once. Each ordinary row exposes the same
actions through its ellipsis and right-click menus. Directory rows can create
children; right-clicking empty explorer space creates at Memory root regardless
of the previously focused row. Destructive directory confirmation reports its
contained entries and any unsaved drafts that will be discarded. Dragging an
ordinary file or directory onto another ordinary directory moves it immediately.
The row action's searchable `Move to...` picker provides the same operation for
keyboard and touch use and is the way to move an entry back to Memory root.
Moves and renames preserve stable entry IDs; they do not change the deterministic
directory-first/name ordering.

New file accepts either a leaf name or a relative path. For example,
`projects/launch.md` creates any missing `projects` directory beneath the
current creation target and then selects `launch.md`. The final `.md` extension
is added when omitted. New directory remains a single-segment operation.

Generated episodes, virtual episode groups, `profile.md`, files, the source's
current parent, the source itself, and descendants of a directory being moved
are not valid move targets as applicable. Creation and moves are disabled while
a virtual episode group or generated episode is focused. Creation otherwise
targets the focused physical directory or the selected ordinary file's parent.
The explorer initially selects `profile.md`, then the first ordinary file by
path, then the newest episode.

Protected rows remain explicit about those constraints. The ellipsis and
right-click menus for `profile.md` and generated episode files show Rename,
Move, and Delete in a disabled state. The virtual Episodes root and its month
groups also show their directory creation actions disabled, along with disabled
Rename, Move, and Delete actions.

Move requests use the existing version-aware patch endpoint and are not
applied optimistically. On success the explorer refetches the server tree while
selection, focus, expansion, and dirty drafts remain anchored by stable entry
IDs. Path-based selected-file URLs follow the new path. A locally initiated
path-only version increment rebases affected draft baselines without changing
their text or dirty state; any unexpected version advance is shown as a draft
conflict. A `409` keeps the visible tree unchanged, while an uncertain network
result triggers a refresh before the entry can be retried.

On desktop, the workspace runs edge-to-edge from the sidebar to the viewport
edge. The explorer starts at a bounded 11-15rem width, can be resized up to
28rem when space allows, and can collapse to a 44px icon rail without losing its
expanded width. At compact widths its toolbar buttons shrink, search text
shortens, tree indentation tightens, and row actions remain available on hover
without overflowing the pane. A second separator resizes Work and Preview while
keeping both at least 18rem when the workspace is wide enough. Both faint
separators support pointer dragging and Left/Right Arrow keys; double-clicking
either restores the default proportions. Completed sizes are stored locally on
the device and restored after reload. Every pane scrolls independently.

The middle Work pane switches between Manual editing and Memory Manager through
a `Manual | Memory Manager` control, with Manual first and selected by default.
Selecting a generated episode while Manual is active switches the work mode to
Memory Manager; ordinary files preserve the current mode. On smaller screens,
`Files`, `Work`, and `Preview` select one pane at a time; resize handles are not
shown, and selecting a file opens Preview.

Memory descriptions are first-class metadata, separate from the Markdown body.
They form the birds-eye file index shown to Anima chat and the Memory Manager so
an agent can decide which files merit full reads. Agent guidance requires every
content edit to review description accuracy, preserve an accurate description
verbatim, update it when scope or durable contents materially change, and give
new files useful concise descriptions. Native Apply Patch carries both fields
through a transient model-only synthetic header, but the workspace and ordinary
entry APIs always receive body-only Markdown plus the separate description.

## Manual Drafts

Editable files receive an in-memory draft when their content first loads. Each
draft retains its server version and baseline content and description. Drafts
survive file changes, explorer interactions, responsive pane changes, and
Manual or Memory Manager mode changes. The right pane renders the selected
Manual draft live, while the explorer marks every dirty file.

Save uses `expected_version`. Clean drafts follow newer query results; dirty
drafts are preserved and marked conflicted if the server version advances.
Conflict recovery offers `Use latest` and `Save over latest`. Discard and delete
require confirmation, and required entries plus generated episodes retain
their existing protection.

Dirty drafts do not interrupt normal workspace navigation. Leaving
`/a/memories` opens a prompt with Stay, Discard and leave, and sequential Save
and leave actions. Browser reload or close uses the native unsaved-changes
warning.

## Versions and Revert

The Preview pane shows a Copy icon followed by the selected entry's current
Version action. Copy writes the exact content currently rendered—including an
unsaved Manual draft—to the clipboard. Version opens a responsive read-only
history dialog without changing or discarding the current Manual draft.
Summaries are listed newest first and can
load older pages; the latest Version is selected initially.

Selecting Version N opens “Changes in Version N.” Version N greater than 1 is
shown only against Version N-1, and Version 1 is labeled as creation against an
empty Version 0 baseline. Content changes use the shared unified-diff renderer;
path and description changes show explicit old/new values even when content is
unchanged. On narrow screens, selection moves from the list to the detail view
and an explicit Back action returns to history.

For an older Version of an editable live Markdown file, `Revert to Version N`
opens a separate confirmation with exact current and target content in
side-by-side panels that stack on narrow screens, plus explicit
current-to-target description values. Revert is not optimistic. On success the
returned entry becomes the clean Manual-draft baseline. A `409 Conflict`
refreshes current entry and version data while preserving any newer local
draft.

If the Manual draft is dirty or conflicted, the dialog first offers `Discard
draft and continue` inline. That uses the existing discard behavior, but does
not execute the Revert: the user must still confirm it separately. Generated
episode logs and all other protected/non-editable history remain entirely
read-only. The dialog has no arbitrary two-version selector.

## Route State

The canonical route search state uses `tab=memory|uploads` and
`mode=manual|manager`, with optional `entryId`, file `path`, and `managerRunId`.
Task prompts are not route state. File and manager-run updates replace the
current history entry, while tab and Manual/Memory Manager mode changes push
history. Explorer search, expansion, collapse, focus, responsive pane, drafts,
and the unsent manager composer are intentionally local state.

When `managerRunId` is absent, the workspace resolves the installation owner's
one current open run, but it restores the ID only when the run is
`waiting_approval`. A prior `active`, `completed`, or `failed` run is not shown
in a fresh Memory workspace session; the composer remains a local, row-free new
conversation. This lookup protects unresolved approvals without exposing run
history.

Desktop pane proportions are also excluded from route state. They use the
versioned `animama.memory-workspace.layout.v1` browser-storage key and fall back
to the default layout when the stored value is missing or invalid.

Manual is the normalized mode when `mode` is missing or invalid. Legacy episode
links, legacy `managerOpen=true` links, and run-specific links still infer
Memory Manager when they omit an explicit mode. An explicit `mode=manual`
remains authoritative, including when a manager run is also present in the URL.

Legacy `tab=user`, `tab=episodes`, `directory`, and `managerOpen` URLs normalize
into the workspace contract. Historical `managerTask` values are accepted while
parsing old links but are dropped rather than becoming canonical state. Selected
file and manager state remain in the URL while Uploads is visible so returning
to Memory restores the prior context.

## Memory Manager

Memory Manager is available as the second mode in the inline Work pane. Opening
a new manager keeps its composer local; the first submitted message creates the
durable run and processes that message. A run created or recovered while the
current Memory page remains mounted continues normally across file, mode, and
tab changes.
Leaving `/a/memories`, closing the browser tab, reloading, or returning through
browser history starts a blank ordinary conversation. The only cross-session
exception is a `waiting_approval` run, whose transcript and review card are
restored so the proposed change cannot be stranded. Inline diff approval cards
refresh the explorer and persisted preview after approved changes. Selecting a
file remains visual context and does not change manager requests.

Account settings includes a Memory section with a Memory Manager model
selector. Its choices come from the existing model catalog and are limited to
the OpenAI Responses provider. The choice is installation-wide and applies to new
request-local manager runtime instances; System default clears the override and
uses `ANIMAMA_MEMORY_MANAGER_AGENT_MODEL` from the backend environment.

The conversation uses the same sticky transcript, chat-only message treatment,
Markdown response renderer, assistant loading indicator, rounded auto-growing
composer, and scroll-to-bottom control as the main user chat. User requests use
contained chat bubbles, while assistant responses use a transparent, full-width
text treatment and render Markdown. Newly returned assistant Markdown uses one
response-wide Streamdown word-by-word reveal instead of restarting the
animation for each paragraph or block. Persisted history remains static, and
the complete response still arrives through one request before its reveal
begins; this does not add SSE streaming. The assistant waiting state is a
left-aligned, opacity-only three-dot pulse in a fixed-height line, avoiding the
vertical growth used by the contained main-chat loader. Enter submits and
Shift+Enter inserts a newline. The manager composer is intentionally text-only:
an empty composer shows a disabled send arrow, and an in-flight request shows a
disabled spinner instead of voice controls.

Submissions are projected locally while the request-response manager runtime is
working. The trimmed user request appears immediately with an assistant loader,
then the returned durable transcript replaces that pair without duplication. A
failed request removes the projection and restores the submitted text unless a
newer draft is present. Approval decisions, memory diffs, and memory files are
never changed optimistically; they update only after the backend confirms the
decision.

The toolbar always exposes one `New` action and no separate Finish action,
confirmation dialog, generic Manager heading, or ordinary status pill. New is a
no-op when the conversation is already fresh. Otherwise it completes an active
run before clearing its transcript and task state, but preserves unsent composer
text for the next conversation. It clears completed or failed runs without
another backend write, and a failed run shows its stored error. Pending approvals
and in-flight or loading work disable New until the current operation is safe to
leave. The replacement row is still created lazily by the next sent message.

The backend is the stale-state safety net: creating a run completes any prior
active run in the same transaction and records its supersession reason. It
refuses creation with `409 Conflict` while a run is waiting for approval, and a
database constraint prevents concurrent requests from leaving multiple open
runs. Leaving the route does not attempt an unload-time completion request;
those requests are unreliable and can race in-flight work. The next submitted
message atomically completes the abandoned active run before creating its
replacement. Switching files, Manual mode, or Uploads does not end the mounted
workspace session.

The pending-episode count appears at the right edge of the explorer's virtual
`Episodes` row and on the `Process episodes` action. Selecting that action starts
a specialized backend-owned run immediately; it never prefills or changes the
local composer and never sends client-selected episode IDs or raw notes. The
backend fixes a batch of up to 50 oldest pending episodes. While that request is
in flight, the transcript immediately projects the server-owned summary
(`Process N pending episodes.`) and assistant loader; the durable response
replaces that temporary pair without duplication. The frontend shows
only its safe task summary: batch size, processing or approval state, whether
the batch is processed, and whether another batch was pending when it started.
The composer remains disabled while the fixed batch is processing or waiting for
approval.

Episode checkboxes and the pending count refresh from authoritative backend
state. Items remain unchecked through an approval pause and become checked only
after the manager reaches terminal success and the backend finalizes the fixed
batch, whether or not any curated-memory diff was accepted. A failed run leaves
the batch pending. After successful processing, the same run remains open, the
ordinary composer becomes available, and later messages use general Memory
Manager behavior without reviewing the batch again. If more pending items exist,
`Process episodes` remains available for a new specialized batch; starting it
supersedes the current active conversation, while an unresolved approval blocks
the action. A stale no-work response refreshes the pending count without
replacing the current conversation.

Every diff approval, in both general and episode-processing runs, offers
Approve, plain Reject, and an optional Request changes interaction. Request
changes rejects the current diff with trimmed feedback for the manager to use
when resuming; decided cards display persisted feedback for audit. Rejection
does not itself imply that an episode is unworthy of memory, and the specialized
run may propose a revised diff or complete the review without writing.

Approval previews show Markdown content changes and description changes as two
separate channels. The Description section appears only when the value changes
and labels exact Before/After values, including “No description” for set and
clear operations. A description-only proposal says “No content changes.” The
native Apply Patch synthetic header is model-only and never appears in the
approval UI, Manual editor, or version content.

An approved card shows `Undo` only while the backend projects `can_undo=true`.
Eligibility requires that approval to remain the latest approved patch for its
target, no approval to be pending in the run, and the live editable target to
remain exactly at the Version committed by the approval. Ineligible cards have
no disabled placeholder. Undo is not optimistic; after success, the original
decision remains visible as `Approved · Undone` and memory, entry, path, and
version-history caches refresh. A `409 Conflict` refetches authoritative state
and directs the user to Versions for historical recovery.

The manager toolbar places `New` before `Process episodes` on the left. An
outlined `Auto approve` checkbox sits beside those controls. It is off by
default and captures consent at submission time for ordinary messages and
specialized processing runs; enabling it does not approve an existing pending
diff. The frontend sends that consent as `auto_approve_diffs` and does not issue
automatic approval requests itself. The backend attributes newly generated
diffs to the submitted message, approves them one at a time through the durable
approval service, and resumes the manager until the chain completes or stops on
an error or eight-decision limit. Any remaining diff stays available for manual
review. Starting New resets Auto approve to off.
The manager does not inherit main chat's model selector, uploads, dictation,
voice mode, SSE streaming, TTS playback, avatar reactions, or Anima-scoped chat
session controller.

## Anima Identity

Anima management pages read the anima-scoped `identity.md` entry and open the
memory editor from `/a/animas/:animaId/identity`. This surface intentionally
retains `MemoryEntryEditorModal`. Its editable branch composes the shared
CodeMirror editor and sanitized GFM preview. It keeps both the memory version
and Anima aggregate revision from the loaded baseline. A concurrent name,
Avatar, loadout, or identity edit can conflict; dirty drafts remain open with
their original guards for explicit resolution. Revert sends both current
guards and creates a new identity version rather than replacing history.

The backend enforces nonblank identity and prevents renaming, moving, deleting,
kind changes, or AI Undo for the required identity file, including untyped
legacy `identity.md` entries. Chat never uses a mutable Avatar fallback for a
missing identity. Legacy repair state requires explicit owner repair; a
directory obstructing the reserved path can be explicitly moved first.

Backend direct chat can generate user-scope episodic logs after completed
non-incognito turns with notable `remember` text. These files are generated
projections of backend episode rows and cannot be changed by users or ordinary
chat memory write tools.
