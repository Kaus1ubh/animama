# Library

`/a/library` is the local product collection. It presents Avatars, Gestures,
Reactions, Particle Effects, Avatar Effects, Scene Effects, Sounds, and private
chat uploads without exposing file roles, host paths, digests, or dependency
binding mechanics.

## Route state

Library URLs are sparse and section-specific. The default state is simply
`/a/library`; default values and hidden-section filters are never serialized.
The canonical parameters are:

- `section=avatars|actions|fx|chat-uploads`; omitted means All
- under Actions, optional `action=gestures|reactions`,
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
Discrete filters create history entries; text search replaces the current
entry so typing does not flood history. Authentication redirects use the same
compact contract.

## Product inventory

Product hooks consume concrete typed API groups over the neutral Content
Catalog. Each group owns its own loading, retry, empty, cursor, and collapse
state. Included items are read-only Starters; Local items are editable copies
created by the user, imported from a package, or added by the host operator.

Rows show product name, AI-facing description where relevant, Included/Local
origin, scan health, and context-specific actions. Valid content can Preview;
Local content can open its editor. Gesture/Reaction rows can Add or Manage Anima
loadout selections. Effects and Sounds offer “Use in Gesture/Reaction” because
they are action ingredients, not independent equipment.

Avatar rows use `/v1/avatar-catalog`, which joins Avatar metadata to a valid
catalog model and registered portrait Appearance. Preview resolves registered
VRM bytes; a row can hand its Avatar to Anima creation.

Chat Uploads remain separate. They use `/v1/files`, private `data/` storage,
processing status, and retrieval diagnostics. They never enter the Content
Catalog or runtime package closure.

## Preview

Library Preview issues the selected catalog item's exact current preview and
prepares its files with `PreviewByteSession`. Gestures and Reactions include
their resolved VFX/Sound supports; visual and audio playback therefore uses the
same validated closure as a mounted Anima without changing any loadout.

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
VFX, Scene VFX, and Sound creators. Creator Save writes ordinary files through
the matching typed family route, such as `/v1/gestures/{entry_name}` or
`/v1/particle-effects/{entry_name}`. Editing a Local item updates that item
directly; there is no release, finalize, or Apply workflow.

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
The [live creation workflow](custom-anima-creation.md) implements private live
creation. It does not add a Blueprint Library kind, “Save as Blueprint”,
packages or publication. Discover and hosted acquisition are discontinued.

## Manual files and packages

The catalog health surface exposes explicit Rescan for host edits. Valid manual
files become selectable but never auto-equip. Invalid or missing entries remain
inert with discreet diagnostics.

Package export generates a manifest only at export time. Package import
validates and rewrites the complete hostile typed closure in backend staging,
then promotes ordinary editable Local items through one recoverable operation
using explicit `cancel`, `keep_both`, or reviewed `replace` collision behavior.
Destination drift or late failure exposes no partial Library row. Browser
storage is never the canonical package or content library.
