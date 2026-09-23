# Library

`/a/library` is the local product collection. It presents Avatars, Gestures,
Reactions, Poses, Particle Effects, Avatar Effects, Scene Effects, Sounds, and private
chat uploads without exposing file roles, host paths, digests, or dependency
binding mechanics.

## Route state

Library URLs are sparse and section-specific. The default state is simply
`/a/library`; default values and hidden-section filters are never serialized.
The canonical parameters are:

- `section=avatars|actions|fx|chat-uploads`; omitted means All
- under Actions, optional `action=gestures|reactions|poses`,
  `gestureMotion=anima_clip|vrma`, `gestureUpdatesOnly=true`,
  `gestureStatus=equipped|unequipped`, and
  `gestureSort=name-asc|name-desc`
- under FX, optional `fx=particle|avatar|scene|sound`
- under All, Avatars, Actions, or FX, optional `showStarters=false`,
  `query`, and a non-default `sort=relevance|updated|name`
- under Chat Uploads, optional `uploadQuery` and
  `uploadStatus=pending_upload|uploaded|processing|ready|ready_keyword_only|failed`

For example, Scene FX is `/a/library?section=fx&fx=scene`. Changing sections
discards filters owned by the previous section. The route expands sparse URL
state into complete internal defaults before rendering Library components.
Gesture-only filters are cleared for Poses; its available sorts are name and
relevance. The typed Pose response has no update timestamp, so Recently updated
is unavailable for that subtype.
Discrete filters create history entries; text search replaces the current
entry so typing does not flood history.

## Product inventory

Product hooks consume concrete typed API groups over the neutral Content
Catalog. Each group owns its own loading, retry, empty, cursor, and collapse
state. Included items are read-only Starters; Local items are editable copies
created by the user, imported from a package, or added by the host operator.

An attention indicator exposes affected items, validation details and Retry scan
when content is invalid, missing, awaiting a scan or unavailable. Valid content can Preview;
Edit follows Preview for Poses, Gestures, Reactions and Particle/Avatar/Scene Effects.
It opens the selected item in its creator: Local content updates that
item, while Included content starts a Local copy. Gesture/Reaction rows can Add or Manage Anima
loadout selections. Sounds offer Play/Stop and Manage for Local rename, same-format replacement and
guarded deletion. Included Sounds are read-only. Effects and Sounds offer “Use in Gesture/Reaction” because
they are action ingredients, not independent equipment.

Actions contains All, Gestures, Reactions and Poses. Poses also appear in the
combined All inventory. Pose rows offer Preview and Edit without a Starter badge.
Editing opens `/a/poses/$poseId/edit` with the
existing Pose controls and an isolated Avatar, without creating a Gesture or
replacing a suspended clip draft. Included customization creates a new Local
identity; it never changes the starter. The five starter Poses are Relaxed Rest,
Shy Finger Poke 1 and 2, and Thinking Head Scratch 1 and 2. Poses have no Add/Manage
equipment action; only Local poses offer deletion in the creator load panel.

Avatar rows use `/v1/avatar-catalog`, which joins Avatar metadata to a valid
catalog model and registered portrait Appearance. Each row uses that model's
generated portrait (never an Anima's custom profile picture), falling back to an
icon when unavailable. Preview resolves registered VRM bytes; Create Anima hands
the Avatar to Anima creation. Entries without model files are omitted; reference-safe seed reconciliation
preserves records needed by Animas.

Chat Uploads remain separate. They use `/v1/files`, private `data/` storage,
processing status, and retrieval diagnostics. They never enter the Content
Catalog or runtime package closure.

## Preview

Library Preview issues the selected catalog item's exact current preview and
prepares its files with `PreviewByteSession`. Gestures and Reactions include
their resolved VFX/Sound supports; visual and audio playback therefore uses the
same validated closure as a mounted Anima without changing any loadout.

Static Pose preview reads a verified registered descriptor and plays a temporary
hold clip in the Dock. Its preview identity is distinct from equipped Gesture
identities, and it retains the selected Anima's Avatar without changing its loadout.

Every playable Included or Local item has registered files. Preview performs
one protected FastAPI fetch per unique file during preparation and then uses
ephemeral Blob URLs. It never follows a public media alias or downloads from an
object store.

## Add and Manage

Add/Manage reviews logical catalog selections for one or more owned Animas.
Each commit carries the expected loadout revision and an idempotency key. A
clear checkbox in Add mode never silently removes an existing choice.

Equip advances future loadout resolution only. The current chat remains pinned
to its prepared runtime revision until the route remounts. Effects and Sounds
remain transitive dependencies of their owning Gesture or Reaction.

## Creation

`/a/create` links to dedicated Anima, Gesture, Reaction, Particle VFX, Avatar
VFX and Scene VFX creators. Sound uploads live in Gesture/Reaction SFX tabs and
Avatar/Scene FX accompanying-sound pickers. Creator Save writes ordinary files through
the matching typed family route, such as `/v1/gestures/{entry_name}` or
`/v1/particle-effects/{entry_name}`. Editing a Local item updates that item
directly; there is no release, finalize, or Apply workflow.

There is no Pose entry on Create or New Pose button in Library. Author a new Pose
inside the Gesture editor, then Save to Local content. Library is for previewing,
editing and customizing these saved items. Inserting a Pose into a Gesture copies
its effective values, so later Pose edits or deletion cannot change that clip.

Gesture and Reaction creators use an immersive Avatar workspace. Gesture
supports VRMA and Anima Pose Clip motion. Reaction uses expression/VFX/SFX
timeline authoring without humanoid motion. Adding a component creates one
dependency plus a timeline event as one undoable document edit.

Load groups customizable Included templates separately from Local content.
Loading an Included template creates a new unsaved Local document; it never
modifies Included. Loading Local opens its current descriptor/sequence and
dependencies. Import/export of direct Anima Pose Clip or typed project JSON is
an editor-document workflow; package import/export is a separate Content
Catalog boundary.

Save & Equip saves the current Local item, then opens the normal reviewed Anima
selection flow. An already-mounted chat still adopts it only after remount.
Unknown event aliases remain visible and block Preview/Save until mapped or
removed.

Avatar-to-Anima entry links reach the four-step `/a/animas/new` creator with a
logical Avatar ID. The creator resolves its exact admitted revision; an
existing saved owner draft wins over a new hint and unavailable content leaves
a recoverable error instead of silently choosing another Avatar.
See the [live creation workflow](custom-anima-creation.md) for validation and recovery.

## Manual files and packages

The local watcher scans normal host edits automatically. Catalog polling refreshes
Library and Appearance queries when content changes; scan timestamps alone do not
trigger repeated list fetches. Valid manual files become selectable but never
auto-equip. Invalid or missing entries remain inert with discreet diagnostics and
a Retry scan action.

Package export generates a manifest only at export time. Package import
validates and rewrites the complete hostile typed closure in backend staging,
then promotes ordinary editable Local items through one recoverable operation
using explicit `cancel`, `keep_both`, or reviewed `replace` collision behavior.
Destination drift or late failure exposes no partial Library row. Browser
storage is never the canonical package or content library.
