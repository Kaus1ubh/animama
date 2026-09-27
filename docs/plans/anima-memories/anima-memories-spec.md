# Anima memories and companion memory templates

Status: Agreed
Owner decision: 2026-09-26 intent discovery agreed the relationship scope, per-Anima
storage, live edits plus an owner-triggered Reflection, the chat memory cue,
existing memory controls, failure priorities, the out-of-scope items and a joint
redesign of the `IDENTITY.md`, `PROFILE.md` and `MEMORIES.md` templates. The owner
delegated template content to this spec. On 2026-09-26 the owner accepted this
draft and its proposals with three changes: `MEMORIES.md` follows the identity
directly in the instructions (R3), Reflection is a specialized Memory Manager
prompt rather than a separate workflow (R5), and the starter identities fill
every section of the new template (R9). The owner then invoked execution planning.
Authoritative source: https://github.com/raymond-van/animama/issues/156 (this
file is a snapshot).
Snapshot captured: 2026-09-26T18:10:04Z, published from revision `c1c215c`.
Source baseline: `b633af1`.

## Problem and intended users

Animama is leaning toward companionship. A companion is valued for its
relationship with the user, but Animas have no memory of that relationship today:

- Each Anima owns exactly one memory file, its owner-authored `IDENTITY.md`, which
  describes who the Anima is and does not change through conversation.
- Everything the Anima learns goes to installation-wide user memory: `PROFILE.md`,
  ordinary memory files and the daily episode logs. Every Anima sees the same
  shared memory, so no Anima has a history of its own with the user.
- Chat history, continuation and compaction are per chat. A new chat begins with
  only the identity and a map of shared memory, which the Anima must search.
  Nothing carries the thread of the relationship from one chat to the next.
- The current `IDENTITY.md` and `PROFILE.md` templates are temporary placeholders.
  The starter Annie and Caitlyn identities follow neither.

Intended users: the installation owner, who chats with one or more Animas and
wants each one to remember their history together, feel continuous across chats,
grow more familiar over time, and remain inspectable and correctable.

## Goals, scope and non-goals

Include:

- A per-Anima `MEMORIES.md` holding that Anima's shared history with the user,
  created with each Anima, loaded into its every turn and protected like
  `IDENTITY.md` (R1–R3).
- Live edits by the Anima to its own `MEMORIES.md` during chat (R4).
- An owner-triggered Reflection that proposes a curated rewrite of `MEMORIES.md`
  from this Anima's unreflected turns (R5).
- An in-chat memory cue when a turn updated `MEMORIES.md` or recorded an episode (R6).
- Existing memory controls, safety rules and failure behavior applied to the new
  file (R7–R8).
- Redesigned `IDENTITY.md`, `PROFILE.md` and `MEMORIES.md` templates, including the
  starter identities (R9).
- Current docs, glossary entries and an ADR for the memory scope split (R10).

Exclude:

- Anima-initiated or proactive messages, check-ins or notifications. Open threads
  are raised only within a conversation the user started. Proactive outreach would
  add New York GBL Art. 47 obligations and is a separate feature.
- Automatic, scheduled or idle-triggered Reflection.
- Per-Anima isolation of user facts. `PROFILE.md`, ordinary memory files and
  episodes stay shared across Animas.
- Backfilling `MEMORIES.md` from past chats or episodes, and migrating or rewriting
  existing `IDENTITY.md`/`PROFILE.md` files. The product is in development with no
  users; development databases are reset.
- Relationship scores, levels, affection meters or any gamified progression.
- Exporting or sharing `MEMORIES.md` with an Anima definition.
- The Anima reading or editing its own `IDENTITY.md` (unchanged).

## Required behavior

### R1. One `MEMORIES.md` per Anima

- Every Anima has exactly one Anima-scoped `MEMORIES.md`, created with the Anima
  (custom and starter) from the R9 template, in the same operation that creates
  its identity.
- In `/a/memories` it appears in that Anima's folder beside `IDENTITY.md`, for
  example `Animas/Annie/MEMORIES.md`, and follows the folder's naming,
  tooltip, filter and Preview behavior.
- It is deleted with its Anima and cannot be reached through another Anima.
- It records only the relationship: shared history and milestones, nicknames,
  in-jokes and shared references, the way the two relate, and open threads. Facts
  about the user that any Anima should know belong in `PROFILE.md` or other shared
  memory.
- It is written as prose from the Anima's first-person point of view and refers to
  the user by their preferred name when known.
- Editing it does not advance the Anima definition or aggregate revision and does
  not conflict with concurrent identity, name, Avatar or loadout edits.

### R2. Owner access and protection

- The owner can open, edit, save, discard and preview `MEMORIES.md` in the Manual
  editor with the same draft, dirty, conflict (`Use latest`/`Save over latest`)
  and version-history behavior as other memory files.
- It cannot be renamed, moved, deleted or used as a move target. Other files
  cannot be created or moved into an Anima folder.
- Unlike `IDENTITY.md`, it may be saved blank.

### R3. Loaded into every turn

- Each chat turn with an Anima includes that Anima's current `MEMORIES.md`
  directly after its identity in the system instructions. The companion
  guardrail remains the last instruction text (ADR 0008).
- The Anima's guidance describes the file's purpose so that an untouched template
  (headings and hints only) is understood as "no shared history yet", never as
  facts.
- A chat with one Anima never includes another Anima's `MEMORIES.md`.

### R4. Live edits during chat

- During a chat the Anima can read and change its own `MEMORIES.md` when something
  worth keeping about the relationship happens. Small edits are expected; it
  should not rewrite the file every turn or copy shared user facts into it.
- The Anima cannot write another Anima's `MEMORIES.md`, any `IDENTITY.md`, or
  create other files in an Anima folder.
- Guidance distinguishes the two write paths: the per-turn `remember` field logs
  what happened in the shared episode log; `MEMORIES.md` curates what the
  relationship means.
- A live edit that would exceed the size limit (R8) is rejected with an
  explanation the Anima can act on, for example by condensing.
- A live edit based on a stale version does not overwrite a newer owner edit.

### R5. Reflection

Reflection is a specialized Memory Manager prompt, not a separate workflow.

- While an Anima's `MEMORIES.md` is selected in `/a/memories`, a **Reflect**
  action starts a Memory Manager conversation for that Anima with a reflection
  prompt. It shows progress, proposes diffs, honors Auto approve and accepts
  owner follow-up messages exactly like any other Memory Manager conversation.
- The reflection can read every persisted turn of this Anima, across all its
  chats, that no applied Reflection has covered. The first Reflection covers all
  such turns. Turns taken with memory updates disabled are excluded; incognito
  turns are never persisted and therefore never read. Turns from deleted chats
  are gone.
- It proposes an edit of `MEMORIES.md` that condenses repetition, integrates new
  history and open threads, drops resolved threads, keeps the file's own headings
  (the R9 layout applies only to a file with none) and fits the size limit. When there is nothing worth adding it says so and proposes
  nothing.
- Turns count as covered only once a Reflection's `MEMORIES.md` change is applied
  (approved or auto-approved). Rejecting, abandoning the conversation or failing
  leaves the file and the covered turns unchanged; a Reflection that proposes
  nothing leaves the same turns for next time.
- If `MEMORIES.md` changed after the Reflection read it, the proposal conflicts
  under the Memory Manager's existing version rule and is not applied over the
  newer content.
- Reflect explains when there are no uncovered turns or when the Memory Manager
  model is unavailable.
- Other Memory Manager conversations may edit an Anima's `MEMORIES.md` only when
  the owner explicitly asks. Episode processing never edits it.

### R6. In-chat memory cue

- An assistant message whose turn updated this Anima's `MEMORIES.md`, recorded a
  `remember` episode, or both shows a small memory icon.
- Hover or click reveals what was remembered, labelled by kind (the episode note
  and/or the `MEMORIES.md` change), with a link that opens the file in
  `/a/memories`.
- The cue appears with the streamed reply and remains on that message after
  reloading the chat.
- A turn that attempted a memory write that failed shows no cue for that write.
- The cue appears wherever the chat transcript and Quick Chat list assistant
  messages; Avatar-only mode shows no cue.

### R7. Memory controls

- With memory influence disabled (request, Anima setting or App setting), the
  turn does not include `MEMORIES.md` and the Anima cannot read or edit it.
- With memory updates disabled or in an incognito chat, the Anima cannot edit it,
  and those turns are never considered by Reflection (R5).
- `IDENTITY.md` stays exempt from these controls as today.

### R8. Failure, safety and limits

- A missing, blank or unreadable `MEMORIES.md` never blocks a chat turn. The turn
  proceeds without it, and the Anima folder in `/a/memories` shows that it needs
  repair, with a repair action that recreates it from the template.
- `MEMORIES.md` has a 16 KiB size limit. Guidance and Reflection aim well below
  it (about 6,000 characters) so the file stays curated.
- The #141 sensitive-memory rule governs live edits and Reflection: no secrets or
  credentials, and no suicide or self-harm crisis specifics unless the user asked.
- The companion guardrail overrides `MEMORIES.md` content. Memory guidance and
  Reflection must not record or frame the relationship in ways the guardrail
  forbids, such as the Anima missing the user, feeling lonely, jealousy, or
  discouraging other relationships.
- The AI notice, crisis protocol and guardrail behave unchanged.

### R9. Templates

The three templates define non-overlapping roles: `IDENTITY.md` is who the Anima
is, `PROFILE.md` is who the user is, and `MEMORIES.md` is what is between them.
Each section carries a short hint the author replaces. The section sets below
were accepted on 2026-09-26.

`IDENTITY.md`: the default in the create-Anima form and the shape of the starter
identities.

```markdown
# <Name>

## Essence
In a sentence or two, who they are at heart.

## Personality
Temperament, quirks, and how they react to people and situations.

## Speaking style
Tone, word choice, pace, humor and verbal habits. Replies are often spoken aloud.

## Appearance and presence
How they look, dress and carry themselves; how they move and express emotion.

## Background
The history and experiences that shape them.

## Interests
What they love, know about and enjoy talking about.

## Values
What matters to them and what they stand for.

## With the user
The role they play in the user's life (friend, sidekick, mentor…) and how they
show care, give support and disagree.

## Boundaries
Topics they avoid, lines they will not cross and how they express limits.
```

`PROFILE.md`: created once per installation; shared by every Anima.

```markdown
# About me

## Basics
Preferred name, pronouns, languages, location or time zone.

## Life right now
Work or study, home, and what this chapter of life looks like.

## People
The people and pets who matter to me.

## Interests
Hobbies, favorite media, food and things I'm into.

## Goals
What I'm working toward or hoping for.

## Routines
My usual daily or weekly rhythm.

## How I like to be treated
Tone, humor, directness, reply length and topics to avoid.
```

`MEMORIES.md`: created with each Anima; maintained by that Anima.

```markdown
# Memories

## Our story
How we met, milestones and memorable moments, with dates.

## How we are together
Nicknames, in-jokes, shared references, rituals and the tone we've settled into.

## What works between us
What helps, what lands and what to avoid in how I am with them.

## Open threads
Things to follow up on: plans, promises and upcoming events, with dates.
```

- The starter Annie and Caitlyn identities fill every `IDENTITY.md` section with
  written content (no hints), preserving their established appearance and
  personality.
- Templates apply to new Animas and new installations only.

### R10. Documentation

- Glossary entries for **Anima memories** (`MEMORIES.md`) and **Reflection**.
- An ADR recording the memory scope split: shared user facts, per-Anima
  relationship memory, and owner-approved curation.
- Backend memory, Memory Manager and chat runtime docs, the frontend Anima memory
  doc and `docs/backend/features/custom-animas-and-content.md` (which currently
  states that new Animas have no relationship memory) describe current behavior.

## Constraints

- Privacy: `MEMORIES.md` is private relationship history. Anima export and sharing
  (issue #84) must exclude it, as it excludes other private history.
- Local-first: no new network services. Reflection uses the configured Memory
  Manager model; live edits use the chat model within the existing turn.
- Cost: nothing runs model calls without an owner action beyond the chat turn
  itself; Reflection runs only on request.
- Prompt size: `MEMORIES.md` is bounded by R8 so every turn's added context stays
  predictable.
- Persistence: follow the development schema policy (edit the baseline SQL, no new
  Alembic revisions). Existing development databases are reset.
- Generated API clients are regenerated, never hand-edited.
- Safety: ADR 0008 guardrail ordering and the #141 sensitive-memory rule are
  preserved.
- Accessibility: the cue and its details are reachable by keyboard and have
  accessible names.

## Acceptance criteria

- [ ] Creating a custom Anima and bootstrapping the starters produce one
      `MEMORIES.md` per Anima with the template; deleting an Anima removes it.
      Evidence: backend tests.
- [ ] `/a/memories` lists `MEMORIES.md` under its Anima folder, edits it with draft
      and conflict handling, blocks rename/move/delete, and allows a blank save.
      Evidence: frontend tests and a desktop browser check.
- [ ] A chat turn includes only the active Anima's `MEMORIES.md`, directly after
      identity, with the guardrail still last. Memory influence off omits it. A missing or
      blank file does not fail the turn, and the folder offers repair.
      Evidence: backend prompt-assembly tests.
- [ ] The Anima can edit its own `MEMORIES.md`, and is refused for another Anima's
      file, any identity, new files in an Anima folder, oversized content and
      stale versions. With updates disabled or incognito it cannot edit.
      Evidence: backend tool tests.
- [ ] Editing `MEMORIES.md` does not advance the Anima definition revision or
      conflict with an open identity draft. Evidence: backend and frontend tests.
- [ ] Reflect opens a Memory Manager conversation for the Anima that reads only
      uncovered turns and proposes a `MEMORIES.md` diff. Applying it marks those
      turns covered; rejection, abandonment, failure and conflicts leave the file
      and covered turns unchanged; Reflect with no uncovered turns says so.
      Update-disabled turns are excluded. Episode processing cannot edit the
      file. Evidence: backend service tests (deterministic runtime) plus a
      desktop run with a real model.
- [ ] A turn that updates `MEMORIES.md` or records an episode shows the cue while
      streaming and after reload; its details name the kind and link to the file.
      Evidence: frontend tests and a desktop browser check.
- [ ] New installations and the create-Anima form use the R9 templates, and the
      starter identities fill every `IDENTITY.md` section. Evidence: tests and a
      fresh-reset check.
- [ ] Owner verification on the desktop app: across two chats with one Anima, the
      second chat naturally follows up an open thread from the first. A second
      Anima does not know that relationship history. A new Anima does not claim
      shared history. Evidence: owner manual acceptance (model behavior is not
      fully testable).
- [ ] Glossary, ADR and affected docs describe the delivered behavior.
      Evidence: review of the docs diff.

## Open questions and decisions

Agreed at intent discovery on 2026-09-26:

- The file is named `MEMORIES.md` and holds only relationship history; user facts
  stay shared ("shared facts, private bond").
- The Anima maintains it; the owner can view and edit it.
- Updates happen by live edits plus Reflection. Reflection is an explicit owner
  button, never automatic, over all unreflected turns, applied as an
  owner-approved Memory Manager patch.
- A subtle in-chat icon marks `MEMORIES.md` updates and episodic `remember` notes;
  it reveals what was remembered.
- Existing memory-influence, memory-update and incognito controls apply.
- Owner edits win over Reflection; a broken `MEMORIES.md` never blocks chat.
- New Animas start from template headings; there is no backfill or migration.
- All three templates are redesigned in this feature; their content was delegated
  to this spec.
- Proactive check-ins are out of scope.

Accepted by the owner on 2026-09-26 (draft proposals and changes):

- The R9 template contents; the starter identities fill every section.
- The 16 KiB limit and about 6,000-character target (R8).
- Memory Manager scope for `MEMORIES.md` outside Reflection (R5).
- Cue placement in the transcript and Quick Chat, not Avatar-only mode (R6).
- A repair action for a missing `MEMORIES.md` (R8).
- An ADR for the memory scope split (R10).
- `MEMORIES.md` follows the identity directly in the instructions (R3).
- Reflection is a specialized Memory Manager prompt (R5). Turns become covered
  when a Reflection's change is applied; a Reflection with no change leaves
  them for next time.

No open product questions block planning.

## Spec

https://github.com/raymond-van/animama/issues/156

## ExecPlan

[anima-memories-execplan.md](anima-memories-execplan.md).

## Delivery links

Phase sub-issues #157, #158, #159 and #160.
