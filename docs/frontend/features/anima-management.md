# Anima Management Guide

Anima management covers owned Animas, identity, and the direct typed runtime
loadout used by chat.

Routes:

- `/a/create`: browse the creator hub.
- `/a/animas/new`: Avatar → Identity → Actions → Review live creation;
  existing links and optional logical Avatar handoffs remain intact.
- `/a/animas`: resolve to the first owned Anima or `/a/animas/new`.
- `/a/animas/:animaId`: view the rendered `IDENTITY.md` document by default.
- `/a/animas/:animaId?tab=memories`: read the Anima's relationship `MEMORIES.md`.
- `/a/animas/:animaId?tab=loadout`: configure the typed loadout.
- `/a/animas/:animaId/identity`: edit the Anima's `IDENTITY.md` memory entry.
- `/a/:animaId`: enter the live Avatar/chat surface.

The [live creation journey](custom-anima-creation.md) uses stable live
name/identity authority, atomic creation, and durable idempotency receipts.
Installation bootstrap/repair uses backend starter specifications and preserves existing
customization and deletion. The management Loadout has four sections; creation produces a private live
Anima.

## Identity

Identity is the safe default for a bare or invalid management URL. The URL
continues to call this state `overview`, while the visible tab says Identity.
The panel renders the Anima-scoped `IDENTITY.md`; if that file is unavailable,
the selected Avatar's starter identity is shown as a fallback. Edit identity
opens a nested modal route and closing it returns focus to the Identity panel.
Saving updates the shared memory-entry query used by the rendered preview and
subsequent chat turns.

## Memories

The Memories tab renders the selected Anima's relationship `MEMORIES.md`.
Edit memories opens that exact entry in a Markdown editor modal, preserving the
Memories tab and returning focus to its edit button on close.
An empty file remains editable; a missing
file offers Repair memories, which recreates the template without overwriting
an existing file. Load failures offer Retry.

## Chat profile modal

The Anima's profile modal above chat keeps Identity and Memories in tabs below
the portrait and mood. It opens on Identity each time. Each tab's edit button
opens the corresponding Markdown editor without leaving chat; closing the
editor restores focus to that button and keeps the selected tab. Saving updates
the shared document preview.

## Appearance editor

The [Appearance editor](avatar-releases-and-appearance.md) manages independent
Profile and Background images, framing and Avatar portrait fallback.

## Loadout

`GET /v1/animas/{anima_id}/loadout` supplies one typed aggregate containing:

- a short active Gesture list;
- a canonical emotion-by-intensity Reaction grid;
- one emotion-aware Idle Style;
- zero or more enabled Music Tracks with at most one autoplay track;
- one Avatar content selection; and
- typed profile/background Appearance Images with fit, focal point, and zoom.

Gestures and Reactions are complete actions. Their Particle, Avatar, and
Scene Effects and Sound Effects are compiler-managed dependencies, so those
ingredients never appear as separate loadout checkboxes.

The Loadout panel contains Gestures, Reactions, Idle Style and Music. Avatar,
Appearance and voice use their own focused controls.

The unified Gesture list keeps ready user-created Gestures first and optionally
reveals active or disabled Starter Gestures through the header filter menu.
Local search matches full names and descriptions. The menu filters equipped or unequipped rows
and sorts by custom-first, name A–Z, or name Z–A. Motion type can be narrowed
to VRMA or Clips; Clips maps to the normalized
`anima_clip` implementation. A compact checked status identifies
equipped rows. Equip, Remove, Disable, and Restore continue through the
server-backed loadout review before commit. Creating a Gesture makes it
available here but does not equip it automatically. Reaction cells visibly
distinguish Starter, custom, and intentionally empty states. Every cell's
searchable selector lists every ready Local and Included Reaction, with its
optional suggested emotion/intensity shown as context; choosing one assigns the complete
Action to the clicked cell regardless of that suggested placement. Adding,
updating, replacing, removing, reverting, or leaving a Reaction empty uses the
same review boundary. Replacing a cell names the current occupant.

An Idle Style owns named VRMA animation files and defines a Default pool plus
optional pools for canonical emotions. The loadout presents those assignments
as one continuous set of independently expandable emotion pools. Each pool can
preview, add, and remove animations inline; its final animation cannot be
removed because pools must remain non-empty. The filter can reveal emotions
that inherit Default, and an override can restore the Included mapping. The
active style selector can return to Starter or intentionally disable idle
motion.

Music supports several enabled built-in or private tracks. Per-track loop and
gain are persisted; at most one enabled track autoplays. Playback position,
temporary mute, and current manual selection remain local browser state.

Appearance choices are separate typed images rather than generic files. A
custom profile image wins over the selected Avatar content portrait; otherwise
the UI falls back to the portrait and then initials. Avatar/Appearance changes
use their typed plan/commit lanes from focused management controls.

## Review and commit

Each family uses a typed plan endpoint followed by its matching commit
endpoint. The review labels every selected Anima as Add, Update, Replace,
Remove, Revert, Leave Empty, Unchanged, or Blocked. Target-local failures do
not hide successful targets, and a failed-only retry keeps the same
idempotency intent.

The dialog delegates Preview to the existing Library dock or management stage;
it never owns a second WebGL canvas. Dependency-complete previews are isolated
from the real loadout.

Commits carry the current optimistic revision, server plan digest, and stable
idempotency key. A stale tab refetches instead of overwriting newer state.
Changes appear on the next chat mount because a mounted route keeps its issued
runtime revision.

## Runtime and presentation

`AnimaRouteProviders` freezes one `GET /v1/animas/{anima_id}/runtime` snapshot.
The same `runtime_revision` is sent with every chat turn. If the snapshot is
missing or expired, chat stops before model execution and offers a remount;
the client never silently retries against a different loadout.

Anima list and management presentation uses the bounded server projection, not
a full runtime read per row. Private and Included thumbnails are fetched from
registered authenticated catalog file routes into disposable Blob URLs. The UI
does not infer a public content URL or download a VRM merely to render
navigation.
