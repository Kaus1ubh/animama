# Anima identities in the Memory workspace

Status: Agreed
Owner decision: 2026-09-25 intent discovery established the outcome; the owner
accepted the remaining proposals the same day, added identity deletion with an
Anima, and invoked execution planning.
Authoritative source: https://github.com/raymond-van/animama/issues/101
Snapshot captured: 2026-09-25T16:59:56Z.
Source baseline: `c612e9d790b014fb6342aa67824c5ccfb43fb2a3`.

## Problem and intended users

The installation owner uses `/a/memories` to review and maintain what their
Animas know. The workspace currently shows only user-scope memory: `PROFILE.md`,
ordinary files and the virtual `Episodes` root. Each Anima's required
`IDENTITY.md` lives in that Anima's own memory scope and can only be viewed or
edited from `/a/animas/:animaId`. Memory Manager explicitly rejects identity paths,
so the owner cannot ask it to refine an Anima's identity.

The owner wants one place for all memory: every Anima's identity visible and
editable beside their own memory, with Memory Manager able to propose identity
changes on request.

## Goals, scope and non-goals

Include:

- A virtual `Animas` root in the Memory workspace explorer with one subdirectory
  per owned Anima containing its `IDENTITY.md`.
- Manual editing, Versions and Revert for identity from the workspace.
- Memory Manager reading identities and proposing approval-gated identity diffs,
  including Auto approve and Undo.
- Reserving the user-scope `animas` path so it cannot collide with the virtual root.

Exclude:

- Moving identity storage into user scope or changing how chat injects identity.
- Additional files in an Anima's subdirectory, or any per-Anima memory beyond
  `IDENTITY.md`.
- Normal Anima chat memory tools reading or writing any identity.
- Episode-processing runs proposing identity changes.
- Changing the existing `/a/animas/:animaId` identity view and editor.

## Required behavior

### R1 — Explorer presentation

The explorer shows a virtual `Animas` root as its first item, followed by the
virtual `Episodes` root, then ordinary entries. `Animas` is always present and
shows an empty state when the owner has no Animas. It contains one subdirectory
per owned Anima, ordered by Anima creation, each containing only that Anima's
`IDENTITY.md`.

A subdirectory is labeled with the Anima's current name. When several Animas
share a name, the earliest-created keeps the plain name and later ones receive
` (2)`, ` (3)` and so on by creation order. Labels follow renames and deletions
after the workspace refreshes; selection, focus, expansion and drafts remain
attached to the same Anima's identity entry rather than to its label.

`Animas`, its subdirectories and identity files are not valid creation, move or
drop targets and cannot be renamed, moved or deleted from the explorer. Creation
and move actions are disabled while they are focused, matching the existing
virtual `Episodes` treatment. Filtering matches identity files by their visible
label path. The initial selection remains `PROFILE.md`.

### R2 — Manual editing, Versions and Revert

Selecting an identity file opens it in the existing Manual editor, Preview,
Copy, and Versions/Revert flows with the same draft, dirty-indicator, conflict,
leave-guard and confirmation behavior as other editable memory files.

Identity saves and reverts keep every guard the `/identity` editor already
enforces: the identity cannot be saved blank, and a concurrent identity, name,
Avatar or loadout change produces a conflict that preserves the dirty draft for
explicit resolution. A save made in either surface is visible in the other after
refresh and appears as one version history.

### R2a — Anima deletion

Deleting an Anima also deletes its identity, so no orphaned identity remains in
the workspace, Memory Manager context or database. If the identity is open when
its Anima is deleted, it leaves the explorer on refresh and any unsaved draft for
it cannot be saved; the owner is told why. A pending Memory Manager proposal for a
deleted Anima's identity cannot be approved.

### R3 — Memory Manager access

Memory Manager can read every owned Anima's identity and see identities in its
navigation context, identified unambiguously as belonging to a specific Anima.
In general runs it proposes an identity diff only when the owner's request
concerns that Anima's identity. Episode-processing runs never propose identity
diffs.

Identity diffs use the existing approval card, Request changes and description
channels. A proposal and its approval target the Anima it was proposed for, even
if that Anima is renamed or another Anima takes its name before approval.
Approval of a stale proposal returns a conflict rather than overwriting newer
content; a blank result is rejected.

Auto approve applies to identity diffs exactly as it does to other memory
diffs, subject to the same guards and eight-decision limit.

### R4 — Undo

An approved identity diff shows Undo under the existing eligibility rules:
latest approved patch for that identity, no pending approval in the run, and the
live identity still at the version the approval committed. Undo writes a new
identity version restoring the prior content and description. It never blanks,
deletes, renames or moves the identity file. This replaces the current rule that
forbids AI Undo of identity.

### R5 — Reserved `animas` path

User-scope memory cannot create, rename or move an entry to `animas` or any path
beneath it, compared case-insensitively, through the workspace, public memory
APIs, chat memory tools or Memory Manager. The rejection explains that the name
is reserved for Anima identities.

An existing user-scope entry already occupying that path remains visible, readable
and recoverable; it is not deleted, hidden or silently renamed. The workspace
indicates that it must be moved or renamed, and allows doing so.

### R6 — Unchanged chat boundary

Normal Anima chat continues to inject only its own identity. Its memory list,
`memory_list_files`, `memory_read_files`, `search_memory_files` and write tools
still exclude every identity, and chat never falls back to Avatar identity.

## Constraints

- Identity storage stays anima-scoped; the `Animas` root is a presentation and
  addressing layer, like `Episodes`.
- Owner and Anima ownership checks apply to every identity read and write; an Anima
  outside the installation owner's scope is not found.
- Workspace moves and saves remain non-optimistic and version-aware, as today.
- Route state keeps using stable entry IDs so a selected identity survives an
  Anima rename; path-based URLs follow the current label.
- Desktop viewport is the primary layout; narrower Files/Work/Preview panes must
  not regress.
- No new Alembic revision; update the baseline directly if schema changes.
- Regenerate the frontend API client offline if backend contracts change.
- These changes supersede established documented contracts, which must be updated
  together: `/a/memories` as a user-scope-only explorer and Memory Manager as a
  user-scope-only workflow (`docs/frontend/features/anima-memory.md`,
  `docs/backend/features/memory.md`,
  `docs/backend/features/memory-manager-and-episodic-memory.md`), and the shared
  navigation projection that currently hides identities from both chat and
  Memory Manager. The glossary meaning of Anima's "private identity" is unchanged:
  identity stays private to the owner and to that Anima's chat.

## Acceptance criteria

- [ ] The explorer shows `Animas` first and `Episodes` second, with per-Anima
  subdirectories in creation order, duplicate-name suffixes and an empty state.
  Evidence: frontend tree tests and a desktop browser check.
- [ ] Renaming an Anima updates its label while an open dirty identity draft stays
  attached and saveable. Evidence: frontend test and browser check.
- [ ] Editing an identity in the workspace, then viewing `/a/animas/:animaId`,
  shows the new content; blank saves and concurrent Anima edits are rejected
  without losing the draft. Evidence: backend and frontend tests, browser check.
- [ ] Explorer create, move, drop, rename and delete actions are unavailable for
  `Animas`, its subdirectories and identity files. Evidence: frontend tests.
- [ ] In a general Memory Manager run, a request about one Anima produces an
  approvable identity diff that updates only that Anima, including after a
  rename between proposal and approval; Auto approve applies it; eligible Undo
  restores the prior version. Evidence: backend service/API tests and a manual
  run with the deterministic or live manager runtime.
- [ ] Episode-processing runs cannot produce identity diffs. Evidence: backend test.
- [ ] Deleting an Anima removes its identity and workspace subdirectory; an open
  draft or pending proposal for it cannot be saved or approved. Evidence: backend
  test, frontend check and a manual deletion journey.
- [ ] Creating, renaming or moving user memory to `animas`/`Animas/...` is rejected
  in every write surface; a pre-existing entry there stays visible and movable.
  Evidence: backend tests and a frontend check.
- [ ] Normal chat's prompt list and memory tools still exclude all identities.
  Evidence: existing and updated backend tests.
- [ ] The affected frontend and backend docs describe the new behavior.

## Open questions and decisions

Decisions from 2026-09-25 discovery: virtual `Animas` root first; identity-only
subdirectories; Manual editing with existing guards; creation-order duplicate
suffixes; Memory Manager may read and propose identity diffs on request only;
Auto approve applies; Undo allowed under normal rules; `animas` reserved; chat
tools unchanged.

Accepted by the owner on 2026-09-25 after spec review:

- Episode-processing exclusion (R3) is enforced by the backend, not only by
  manager guidance.
- An open draft for a deleted Anima cannot be saved and the owner is told why (R2a).
- A pre-existing user-scope `animas` entry is flagged in place and must be moved
  or renamed before it can be edited (R5).
- Deleting an Anima deletes its identity (R2a). The owner noted that the overall
  Anima deletion flow has not been exercised; the plan must verify it.

Left to the ExecPlan: how Memory Manager addresses an identity so proposals stay
bound to the correct Anima across renames and duplicate names.

## Spec

https://github.com/raymond-van/animama/issues/101 (this file is a snapshot).

## ExecPlan

Required: backend service, Memory Manager and frontend changes with a relaxed
identity-protection rule. See
[anima-memory-directory-execplan.md](anima-memory-directory-execplan.md).

## Delivery links

Phase issues #102, #103, #104; PR pending.
