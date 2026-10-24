# Anima Management Guide

Anima management covers owned Animas, identity, and the direct typed runtime
loadout used by chat.

Routes:

- `/create`: browse the creator hub.
- `/animas/new`: Avatar → Voice → Identity → Actions → Review live creation;
  existing links and optional logical Avatar handoffs remain intact.
- `/animas`: resolve to the first owned Anima or `/animas/new`.
- `/animas/:animaId`: view the rendered `IDENTITY.md` document by default.
- `/animas/:animaId?tab=memories`: read the Anima's relationship `MEMORIES.md`.
- `/animas/:animaId?tab=loadout`: configure the typed loadout.
- `/animas/:animaId/identity`: edit the Anima's `IDENTITY.md` memory entry.
- `/:animaId`: enter the live Avatar/chat surface.

The [live creation journey](custom-anima-creation.md) uses stable live
name/identity authority, atomic creation, and durable idempotency receipts.
Installation bootstrap/repair uses backend starter specifications and preserves existing
customization and deletion. [Library sharing](library.md#import--export) can copy
a reviewed saved definition to a new independent Anima.

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
- the Anima's Reaction pools: one cell per emotion and intensity (Mild,
  Moderate, Strong, Intense), each holding up to four Reactions;
- the Anima's own Idle pool (Default plus emotion/intensity cells);
- one Avatar content selection; and
- typed profile/background Appearance Images with fit, focal point, and zoom.

Gestures and Reactions are complete actions. Their Particle, Avatar, and
Scene Effects and Sound Effects are compiler-managed dependencies, so those
ingredients never appear as separate loadout checkboxes.

The Behavior tab shows the Anima's Loadout: Voices, Gestures, Reactions and Idle.
Voices configures PocketTTS and ElevenLabs for this Anima, regardless of the
active application provider. Avatar and Appearance use their own focused controls.
Imported encoded-only voice clones remain selectable for speech; their original
recording preview is unavailable because the recording is not shared.

The unified Gesture list includes every ready Local and Included Gesture; the
Anima's Gestures are exactly its equipped rows, so a removed Gesture stays
listed, unequipped, until it is equipped again. The header shows the
number equipped out of the full inventory, independent of search or filters.
The filter menu offers independent Show included and Show local controls;
Included content remains Included when explicitly equipped. Local search matches
any part of a name; rows show the name, and the description appears in a
tooltip on hover or focus. The menu filters equipped or unequipped rows
and sorts Custom first (Local before Included, as in the Library), by name A–Z,
or by name Z–A. Motion type can be narrowed
to VRMA or Clips; Clips maps to the normalized
`anima_clip` implementation. A compact checked status identifies
equipped rows. Equip and Remove continue through the server-backed loadout
review before commit; every row's menu opens the Library, and an equipped
row's menu also removes it. Creating a Gesture makes it
available here but does not equip it automatically.

Reactions show one expandable row per emotion, summarising how many Reactions
it holds, with its four intensity cells. Each cell lists its Reactions with
the Starter badge for the cell's Included starter Reactions, Preview and
Remove; an empty cell reads "No Reaction". Each emotion event in chat plays one
member of its cell, chosen at random ([avatar planner](../runtime/avatar-planner.md)).
The cell's Add picker lists every ready Local and Included Reaction, with its
optional suggested emotion and intensity as context only: any Reaction can join
any cell. Reactions already in the cell are marked and cannot be added again.
A cell holds at most four Reactions; at four, Add is disabled and the cell says
why. The cell menu opens the Library and, unless the cell already holds exactly
its starter Reactions, offers Restore starter. Removing the last member leaves
the cell empty, which plays no Reaction. A starter Reaction that cannot be
restored is skipped with a warning. Unavailable members stay listed, marked,
so they can be removed.

Adding, removing and restoring apply at once through `reactions:plan|commit`
without the review dialog, like Idle. A failure shows an error and leaves the
pool as it was; a stale revision refetches the Loadout and asks the owner to
try again. Changes reach chat on the next runtime mount.

Idle is the Anima's built-in pool of Gestures for quiet moments
([ADR 0026](../../adr/0026-built-in-idle-pool-per-anima.md)); it always exists
and cannot be swapped for another. The section shows Default first, then one
expandable row per emotion with its Mild, Moderate and Strong cells, each
listing its Gestures with Preview and Remove. Moderate and Strong also list,
read-only, the Gestures they inherit from lower intensities. Each idle is a
Default Gesture half the time and a Gesture from the current emotion's cells at
or below its intensity the other half; a cell with nothing to add reads
"Default only". An empty pool schedules nothing, while breathing and resting
continue. Neutral uses Default. A Gesture in the pool is never equipped
for AI invocation, and the same Gesture can sit in several cells.

Each cell's Add picker lists ready Local and Included Gestures not already in
or inherited by that cell. Choosing one checks its finite playback first
(`GET /v1/gestures/{item_id}/idle-playback`); an ineligible Gesture stays in the
list, disabled, with the reason. Both VRMA and `animaPoseClip` Gestures need
finite authored playback. Adding and removing apply at once through
`idle:plan|commit` without the review dialog; a failure, including a stale
revision, shows an error and refetches the Loadout. Removal names the member's
binding, so an unavailable Gesture can still be removed.

Appearance choices are separate typed images rather than generic files. A
custom profile image wins over the selected Avatar content portrait; otherwise
the UI falls back to the portrait and then initials. Avatar/Appearance changes
use their typed plan/commit lanes from focused management controls.

## Review and commit

Each family uses a typed plan endpoint followed by its matching commit
endpoint. Gesture changes open a review that labels every selected Anima as
Add, Update, Replace, Remove, Revert, Leave Empty, Unchanged, or Blocked;
Reaction and Idle pool edits commit their plan at once. Target-local failures
do not hide successful targets, and a failed-only retry keeps the same
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
