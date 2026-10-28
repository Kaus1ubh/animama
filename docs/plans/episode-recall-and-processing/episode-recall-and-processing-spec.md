# Recall recent episode notes and process them automatically

Status: Agreed
Owner decision: 2026-10-28. Intent discovery agreed the direction recorded under
[Open questions and decisions](#open-questions-and-decisions). On review the owner
moved recent notes into the system instruction and made the setting a pending-note
threshold, then accepted the revised draft and its proposed defaults. During
ExecPlan review the same day the owner added R13 (a progress line in chat).
Authoritative source: https://github.com/raymond-van/animama/issues/775 (this
file is a snapshot).
Snapshot captured: 2026-10-28T18:03:01Z, updated from revision `aef6dcf7` (first
published 2026-10-28T16:56:10Z from `7b2772f0`; both rebased onto `bddaa75c`
before any push).
Source baseline: `da23aaaa`.

## Problem and intended users

On each successful turn with memory updates on, outside incognito, direct chat records a nonblank
`remember` value as one `pending` episode item, projected into the read-only daily
episode log. Since #739, `search_memory_files` matches any query word in that log,
and the memory guidance asks chat models to search before answering about the
user's news or plans. Three gaps remain:

- **Fresh chats do not see recent notes.** A new chat's context carries no episode
  notes, so recall depends on the model choosing to search. In the #470 model
  benchmark, capture kept 15 of 15 notes but fresh-chat recall matched 0–2 of 9
  probes per configuration: models searched in 12 of 96 recall turns, and every
  match came from a search. That run predates #739, whose search and guidance
  changes are not yet measured.
- **Notes reach curated memory only by hand.** The owner must open the Memory
  Manager and start episode processing, 50 notes at a time. Nothing else does, so
  notes accumulate as `pending` and `PROFILE.md` keeps its template text.
- **Curated user memory is not in context either.** Chat instructions include the
  Anima's `IDENTITY.md` and `MEMORIES.md`. `PROFILE.md` and other shared files
  appear only by path and description in the memory map, so even processed notes
  reach a fresh chat only when the model reads `PROFILE.md`.

After the #470 benchmark the owner kept both the `remember` field and live
`MEMORIES.md` edits (2026-10-28), because models fill in `remember` more reliably
than they read memory files, and asked for its processing to be automated.

Intended users: the installation owner of a local or desktop installation, who
chats with one or more Animas and expects each to remember what they said recently
and shared facts about them to accumulate without maintenance. Users of the hosted
web app receive the chat-context changes only.

## Goals, scope and non-goals

Include:

- `PROFILE.md` content and the current Anima's recent episode notes in each turn's
  instructions, in every composition (R1–R4).
- Automatic episode processing in the local composition once a set number of notes
  (default 10) are pending, with automatic approval, bounded retries and cost
  limits (R5–R9).
- Automatic changes identified in file version history, an App Settings control,
  and a progress line above the chat input while a run works (R10, R11, R13).
- Updated documentation, glossary and a decision record (R12).

Non-goals:

- **Automatic Reflection.** `MEMORIES.md` stays curated by live chat edits and
  owner-started Reflection; ADR 0009's no-background-rewrite decision still holds
  for it.
- **Per-Anima episode logs.** The episode log remains one shared user-memory log
  (ADR 0009). Recall is per Anima through R1's filter on the note's source Anima.
- **Automatic runs in the hosted composition.** Hosted keeps owner-started
  processing.
- **Episode processing writing Anima files.** Relationship moments in notes still
  reach `MEMORIES.md` only through chat edits or Reflection.
- A Memory Manager view of automatic runs, other shared files in context, semantic
  episode retrieval, and changes to `remember` capture, the episode table, batch
  selection or memory search.

## Required behavior

### Recent episode notes in chat

- **R1. Selection.** When memory influence resolves on, a direct-chat turn includes
  the current Anima's most recent episode notes: items whose source Anima is the
  turn's Anima and whose source chat is not the current chat, pending or processed,
  newest first, up to 20 notes and 3,000 characters of note text from the last 14
  local days, counted in whole days (proposed bounds). A note that would pass the
  character budget is left out whole, not cut. Other Animas' notes are not included
  and stay reachable through search. With memory influence off, no notes are
  included.
- **R2. Presentation.** Included notes appear in the system instruction after the
  `PROFILE.md` section (R3), oldest first with their local date, framed as notes
  from earlier chats, never instructions. Note text never changes after capture and
  processing status is not shown, so within one chat the section changes only when
  another chat with the same Anima saves a note or a day boundary moves the window.
  An empty selection adds nothing. The chat's memory-context manifest records which
  notes were included.

### `PROFILE.md` in chat instructions

- **R3. Inclusion.** When memory influence resolves on, the system instruction
  includes the user-scope `PROFILE.md` content after the Anima memories section,
  under its own heading and framed as notes about the user, never instructions;
  lines describing what belongs under a heading are hints, not facts. A missing,
  blank or unreadable file is left out without failing the turn, and the manifest
  records its status as for `MEMORIES.md`. The memory guidance says the profile is
  already in context, so the model reads it again only to edit it. `PROFILE.md`
  stays in the memory map.
- **R4. Size bound.** Content up to 16 KiB is included whole (proposed bound; the
  file limit is 32 KiB). A larger file contributes its first 16 KiB, ending at a
  line boundary, followed by a line saying the rest can be read with
  `memory_read_files`.

### Automatic episode processing (local composition)

- **R5. Trigger.** While automatic processing is set to a threshold N (R11), after
  a turn's episode note is saved and the owner has N or more pending notes, the
  backend starts an episode-processing run. It also checks once at backend startup.
  The run uses the existing fixed oldest-first batch (up to 50 notes across all
  Animas), the Memory Manager model role and the existing instructions and limits.
  At most one automatic run per owner is in flight; a trigger during a run starts
  nothing. After a successful run, the next one starts if N or more notes remain
  pending, within R8.
- **R6. Off the turn path.** Chat streaming, saving and capture never wait on
  automatic processing, and a failure to start or finish a run never changes a
  turn's result. Failures are logged and handled by R8.
- **R7. Approvals and owner-started runs.** Each proposed change is approved
  automatically through the existing approval path, including its version checks.
  An automatic run never leaves an approval for the owner: when it stops with a
  proposal pending (the eight-approval ceiling, a version conflict or an invalid
  target), that proposal is closed unapplied, the run closes, and the batch's notes
  stay pending for a later run; changes already applied stay. An automatic run
  never completes, supersedes or waits for an owner-started Memory Manager run and
  never becomes the run the Memory Manager opens. While an automatic run is
  processing, an owner-started episode-processing request is refused with a
  message that automatic processing is in progress. Processing still writes only
  shared user memory, never Anima files.
- **R8. Failures and cost bounds.** A failed or blocked automatic run, including an
  R7 closure, leaves its notes pending. After a failure the next automatic attempt
  waits at least 1 hour, doubling up to 24 hours. After 3 consecutive failed runs,
  automatic processing pauses until an owner-started episode-processing run
  succeeds or the owner changes the setting. At most 10 automatic
  runs start per owner per local day. Without a usable tool-capable Memory Manager
  model or its key, no run starts and the setting says so. (All values proposed.)
- **R9. Memory controls.** Automatic runs start only while App Settings memory and
  memory updates are both on. Incognito turns and turns with memory updates off
  already record no notes.
- **R10. Provenance.** Versions written by an automatic run record that source in
  their change provenance. The file's version history labels them as automatic
  updates from episode notes, with the existing diff and Revert. Runs, messages
  and approvals persist as today for audit, marked automatic.
- **R11. Setting.** App Settings has "Process episode notes automatically" beside
  the Memory and Memory updates controls: Off, or the pending-note threshold N from
  5 to 50. It defaults to 10 for new and existing local installations. Off starts
  no further runs; a run in flight finishes. The control explains when
  memory or memory updates are off, and shows a paused or missing-model state with
  the last error (R8). An existing backlog is processed under R8's daily limit. The
  hosted composition shows no control and never starts automatic runs.
- **R13. Progress line.** While an automatic run is processing, the chat view shows
  "Crystallizing N notes into memory…" among the status lines above the chat input,
  where N is the run's batch size. The line appears within a few seconds of the run
  starting and disappears when it ends; failures are reported only beside the
  setting (R11). Hosted never shows it.

### Records

- **R12. Documentation and decision.** Backend memory documentation and the
  glossary describe the new behavior. A new ADR supersedes ADR 0009's rejection of
  automatic background consolidation for shared user memory only, and records
  `PROFILE.md` in every turn's instructions; `MEMORIES.md` remains free of
  background rewrites.

## Constraints

- **Turn path.** Core chat dispatch must not depend on background workers or
  queues (backend memory rule). Automatic processing runs inside the backend
  process without a new service, container or deployment, including on desktop.
  It runs only while the backend runs; the startup check catches up.
- **Ownership and privacy.** Selection and processing filter by the installation
  principal and accept no client-supplied owner or note IDs. Note text is
  untrusted data in chat and Memory Manager prompts. Incognito, memory and
  memory-update settings behave as above; the sensitive-memory rule is unchanged.
  Notes outlive their chats today; this is unchanged.
- **Prompt caching.** The system instruction changes only when `IDENTITY.md`,
  `MEMORIES.md` or `PROFILE.md` changes, or R2's note selection changes. Each such
  change makes the following turn re-cache its prefix and history once, accepted as
  for `MEMORIES.md` edits; on the other turns the notes are read from the cache.
- **Hosted.** R1–R4 add up to about 19 KiB of input per model round and no model
  requests. Hosted's input cutoff and per-round reservation stay authoritative;
  Cloud checks its token estimates when it adopts the change. Hosted starts no
  automatic runs, so its trial and monthly ceiling see no background spend.
- **Local cost.** Automatic runs spend the owner's Memory Manager model key,
  bounded by the existing per-step request budget, the Auto approve ceiling, one
  run in flight, R8's backoff and daily limit.
- **Data and contracts.** No Alembic revision: update the ORM and baseline SQL
  directly for any new state. Settings or API changes update backend docs and
  regenerate the frontend client. New strings ship in every UI locale.
- **Compatibility.** Owner-started episode processing, Reflection, approvals, Undo
  and Revert are unchanged apart from R7's refusal during an automatic run.

## Acceptance criteria

- [ ] R1–R2: backend tests show a fresh chat's system instruction with the
      current Anima's recent notes after `PROFILE.md`, within the bounds, oldest
      first with dates; other Animas' and the current chat's notes excluded;
      nothing with memory influence off; and the instruction byte-identical across
      turns of one chat when no other chat adds a note and no day boundary passes,
      including after a note becomes processed.
- [ ] R3–R4: backend tests show `PROFILE.md` after the Anima memories section,
      left out when memory influence is off or the file is missing or blank, cut at
      the bound with the read-more line, and recorded in the manifest.
- [ ] R5–R6: tests show that with threshold N the turn saving the Nth pending note
      starts one automatic run and the one before it does not; the startup check;
      one run in flight; and a failing start or run leaving the turn and its SSE
      stream unchanged.
- [ ] R7: tests show applied changes kept, a leftover proposal closed unapplied
      with its notes pending, an owner-started run untouched and still the one
      the Memory Manager opens, and owner-started processing refused during an
      automatic run.
- [ ] R8–R9: tests cover backoff, the pause after 3 failures and its two
      resumptions, the daily limit, no run without a usable model, and no run
      while memory or memory updates are off.
- [ ] R10–R11: version history shows the automatic label and Revert works; the
      setting defaults to 10, accepts Off and 5–50, Off starts no runs, and the
      hosted composition seam neither exposes the control nor starts runs.
- [ ] R13: component tests show the progress line with the run's note count while
      a run is processing and no line otherwise or without the capability; the
      browser check shows it above the chat input during an automatic run.
- [ ] Manual check on a local stack with a live Memory Manager model: after
      chatting until the threshold's notes are pending, `PROFILE.md` gains an automatic version,
      and a fresh chat with the same Anima recalls a recent note without searching.
- [ ] R12: backend docs, glossary and the new ADR are merged with the change.
- [ ] Optional and paid, at the owner's discretion: rerun #470's memory arms
      against the 2026-10-27 baseline. This is not a merge gate.

## Open questions and decisions

Agreed, 2026-10-28 (owner, intent discovery):

- Keep both `remember` and live `MEMORIES.md` edits, and automate processing of
  `remember` notes (#470 recommendations).
- Include recent notes in chat, `PROFILE.md` in chat instructions and automatic
  episode processing. Exclude automatic Reflection.
- Automatic processing runs locally only, never in hosted; both context changes
  apply in every composition.
- Changes are approved automatically and reviewed through file version history and
  Revert, with no Memory Manager view of automatic runs.
- A run starts right after the turn that brings pending notes to the threshold.
  The setting is Off or a pending-note threshold, defaulting to 10 (owner review of
  the draft, 2026-10-28).
- A turn includes only the current Anima's notes. The owner considered per-Anima
  episodic memory and kept one shared log, since filtering on the source Anima
  gives per-Anima recall without restructuring the log.
- Recent notes go in the system instruction rather than the per-turn context,
  because note text never changes and status is not shown (owner review of the
  draft, 2026-10-28).
- Added after publication (owner, 2026-10-28, ExecPlan review): R13's progress line
  above the chat input, styled like the existing loading status lines.

Proposed defaults for owner review: R1's bounds (20 notes, 3,000 characters, 14
whole days, current chat excluded), R4's 16 KiB bound, R7's closure of leftover
proposals and refusal of owner-started processing during an automatic run, R8's
backoff, pause and daily limit, R9's dependence on App Settings memory and updates,
R11's threshold range of 5–50, and its default of 10 for existing installations
with backlog processing.

Follow-ups outside this spec: episode processing proposing `MEMORIES.md` updates
from relationship notes, automatic Reflection, and hosted automation once priced
against hosted quotas.

## Spec

https://github.com/raymond-van/animama/issues/775

## ExecPlan

Required. The change spans chat context assembly, a background trigger, Memory
Manager run semantics, settings, frontend and a decision record. It is written with
`to-execplan` after this spec is agreed.

## Delivery links

None yet. Related: #470 (benchmark evidence), #734 and #739 (memory search),
[ADR 0009](../../adr/0009-shared-user-memory-and-per-anima-relationship-memory.md).
