# Poses as Included and Local content

Status: Implemented locally; hosted validation and owner merge approval pending
Owner decision: 2026-09-22 intent discovery established the scope; the owner then
invoked execution planning on this specification without requesting changes.
Authoritative source: https://github.com/raymond-van/animama/issues/55
Original snapshot captured: 2026-09-22T18:12:50Z; owner follow-up incorporated on 2026-09-22.
Source baseline: `0657c51e211efa8bd16d1efca8dbefd878aacc74`.

## Problem and intended users

Users who author Gesture clips need reusable poses they can save, find, preview
and edit with the same durability as other Animama content. Currently, named pose
drafts are saved in browser local storage, outside the Included/Local library.
Their availability depends on the browser profile and application origin, and a
content backup does not include them. Built-in poses exist separately as bundled
frontend JSON and are not shown in the Gesture editor's saved-pose picker.

Make authored poses ordinary local product content and expose the existing
built-in collection as Included starters. Users can then reuse a pose in a clip
without subsequent changes to the source pose changing their animation.

## Goals, scope and non-goals

Include durable pose storage, the existing starter collection, Library discovery,
preview and editing, and the Gesture editor's pose authoring and insertion flow.
Poses participate in the existing content validation, scanning, deletion and
portable package workflows rather than forming a separate persistence system.

Do not add a Pose entry to the Create page or a Library “New Pose” button.
Do not author an expanded starter collection, add linked/live pose insertion,
make poses independently equippable, or expand Reaction motion capabilities.
Browser-saved poses are retired without migration or legacy compatibility work;
no import prompt, migration service or fallback browser library is required.
Cloud sharing, new content-pack distribution and signed desktop release acceptance
are outside this change.

## Required behavior

### R1 — Durable content and lifecycle

A saved standalone Pose has a stable content identity and Included or Local source.
A Pose describes a static humanoid and/or expression state; a Pose Clip describes
a timed sequence. These remain distinct content concepts.

Included poses belong to the read-only Included content source; authored and
imported poses belong to writable Local content, following the configured content
roots (`content/included/poses/` and `content/local/poses/` in the ordinary layout).
The backend owns validated reads and recoverable writes. Saving a Local pose
updates that item directly, with no release, finalize or equip step.

Saved poses remain available after reload, application/backend restart, or clearing
browser storage. Clients admitted to the same installation see its same pose
collection. Ordinary host edits, rescan, content health reporting, deletion and
package import/export use the existing content contracts. Invalid or missing
content is diagnosed rather than silently usable.

### R2 — Library presentation

At `/a/library`, rename “Gestures & Reactions” to “Actions” and add “Poses” beside
Gestures and Reactions. Retain the existing All selection; poses also appear in
the relevant combined Actions and top-level All inventories.

Use the existing Library conventions for search, sorting, Starter visibility,
loading, empty/error states and persisted URL selection. Reloading or using
browser navigation preserves a selected Poses view. Display Included items as
read-only Starters and Local items as editable content.

Users can preview poses on an Avatar and open Local poses for editing. Included
poses can be used as the starting point for a Local copy without modifying their
originals. The Library has no “New Pose” button, matching Gestures and Reactions.

### R3 — Authoring and starter availability

Retain pose creation through the existing Gesture editor and reuse its pose-editing
capabilities for Library editing. Do not add a Pose entry on the Create page.
Saving a named pose writes Local content; reopening it uses that saved identity.
Editing a pose does not silently overwrite a Gesture document or its clip.

Include only Relaxed Rest, Shy Finger Poke 1 and 2, and Thinking Head Scratch 1
and 2 as standalone starter Poses. Preserve shipped clip/default behavior while
removing the other standalone starter entries. Both Included
and Local poses are available in the Gesture editor's searchable Poses picker.
Keep the existing insertion action and desktop drag-to-timeline flow, including
their undo/redo and cancellation behavior. Included customization saves a Local
copy; subsequent Local edits update that copy. No newly authored starter poses
are required.

### R4 — Copy into clips

Inserting a pose copies its effective humanoid/expression values into the clip.
The copy must include any inherited values needed to reproduce the selected pose;
it must not retain a live dependency on the source pose or its parents.

Later edits, renames or deletion of the source pose, or updates to Included
starters, do not change clips that already copied it. Editing the inserted pose
in a clip does not change its Library source. Saving, reopening, previewing,
playing and exporting/importing the action preserve this independence.
Insertion does not create a source-pose dependency that prevents deleting the
otherwise unreferenced source item.

### R5 — Failures, cancellation and recovery

Report invalid pose data, unavailable preview content and failed saves with an
actionable error. Do not report success or clear unsaved changes when persistence
fails. Retain the editable draft for retry while the editor remains open; preserve
the previously saved version and avoid partially published Library entries.

Use existing content revision/conflict checks and recoverable mutation behavior.
A retry must not create duplicate items or overwrite newer saved content silently.
Keep existing dirty-edit protections when switching poses or leaving the editor;
cancelling replacement or insertion leaves the current work intact. An unavailable
Avatar or invalid pose cannot silently produce a successful preview or insertion.

### R6 — Retire the browser pose collection

Stop reading and writing the browser-saved pose library and remove its browser-only
Load/Save collection behavior and wording. Existing browser pose records need not
be imported, preserved or supported. The new interface must not revive them as
content when encountered. This does not require deleting unrelated browser data.
Transient editor state or optional unsaved-edit recovery must not become a second
canonical pose library.

## Constraints

- Follow the existing Included/Local ownership, registered-byte delivery and
  recoverable mutation contract in [ADR 0004](../../adr/0004-filesystem-content-and-recoverable-mutations.md).
  The renderer gains no arbitrary filesystem access, host paths or new identity
  mechanism. Included sources remain immutable.
- A pose's persisted/imported representation must carry or resolve everything
  needed for its advertised behavior through the content system. A fresh client
  must not depend on hidden browser drafts or unregistered frontend pose data.
  Schema details and treatment of standalone pose inheritance belong in the plan.
- Pre-launch compatibility is not a requirement: do not build a legacy browser
  migration or compatibility layer. However, the resulting shipped collection,
  default poses and shipped clips must remain internally valid and playable.
- Preserve the current Reaction boundary: humanoid/bone pose tracks remain
  unsupported. Poses are ingredients for Gesture clips, not new loadout equipment.
- Reuse existing authoring controls and Library patterns. Validate desktop layouts
  first, then narrower layouts; preserve keyboard-accessible insertion and editing
  so drag-and-drop is not the only path.
- No new provider calls, paid services or cloud dependency are needed. Backup
  guidance must continue to distinguish content bytes from the database-owned
  identities, ownership and mutation receipts that cooperate with them.

## Acceptance criteria

- [ ] **R1, R6:** Save and update a Local pose, restart/reopen the application and
      clear browser storage. The same saved pose remains available with its latest
      values. An old browser pose record is not imported or used as a fallback.
      Establish persistence with backend tests and a browser journey.
- [ ] **R1, R5:** Valid manually added poses become usable through the existing
      scan flow; malformed or missing content receives health diagnostics. Failed,
      interrupted or conflicting writes preserve the saved version, retain retryable
      work and expose no partial item. Cover failure/retry behavior with focused tests.
- [ ] **R2:** Browser evidence shows Actions with All/Gestures/Reactions/Poses,
      poses in combined inventories, Starter filtering and search, and stable selected
      view after reload/navigation. There is no Library “New Pose” button or Create-page
      Pose entry. Check desktop and a narrower layout.
- [ ] **R2, R3:** Preview a starter and a Local pose, customize a starter to Local,
      then edit and reopen that Local item from Library. The Included original and any
      unrelated Gesture work are unchanged. Record browser evidence on a real Avatar.
- [ ] **R3:** Existing built-in poses are discoverable in Library and the Gesture
      pose picker. Author and save a new pose through the existing editor. Verify
      starter catalog validity, including any shipped default/clip references.
- [ ] **R3, R4:** Insert Included and Local poses using the ordinary action and
      desktop drag. Verify one undoable insertion, redo and cancellation. Change and
      delete the Library source, then reopen/play the action: copied values and motion
      remain unchanged, including inherited values. Use focused tests and browser
      playback evidence.
- [ ] **R1, R4:** Round-trip a standalone pose through normal content package
      export/import. Round-trip an action containing copied poses without requiring
      its original standalone pose items. Validate values and preview/playback using
      tests and representative manual evidence.
- [ ] **R5:** Exercise invalid data, unavailable preview and a failed save. Errors
      remain visible and actionable; the editor does not claim success, discard work
      or silently replace the saved version. Cancelling dirty replacement preserves it.
- [ ] **Constraints:** Focused regressions retain the Reaction humanoid restriction
      and protected content access. Report local tests/builds, browser observations and
      actual hosted CI separately; none alone proves packaged/native release acceptance.

## Open questions and decisions

No blocking product questions remain. On 2026-09-22 the owner agreed durable
Included/Local poses, Actions/Poses Library organization, copy-on-insert, reuse of
the existing starter collection, no Create-page entry, no Library new-item button,
and retirement of browser poses without migration or compatibility requirements.

Endpoint/schema design, route wiring, starter conversion and implementation phases
remain execution-plan choices within this behavior. Do not turn those choices into
new product scope. The owner accepted this specification as the basis for execution planning on
2026-09-22. Implementation-plan review and exact-candidate merge approval remain
separate gates.

## Spec

Authoritative specification: https://github.com/raymond-van/animama/issues/55.
This file retains the agreed specification and the owner follow-up below; the
issue and PR track delivery and validation.

Current behavior references:

- [Library](../../frontend/features/library.md).
- [Local content runtime](../../frontend/architecture/local-content-runtime.md).
- [Content storage](../../backend/architecture/local-content-storage.md).
- [Pose persistence and insertion](../../../src/frontend/web/src/stores/pose-creator-store.ts).
- [Included starter poses](../../../content/included/poses/).

## ExecPlan

Required: [Poses as content execution plan](poses-as-content-execplan.md). This
change spans persistence, content validation, starter assets and editor/Library
behavior. The plan records implementation, validation and independent review.

## Delivery links

Parent: https://github.com/raymond-van/animama/issues/55.

- Phase 1: https://github.com/raymond-van/animama/issues/56
- Phase 2: https://github.com/raymond-van/animama/issues/57
- Phase 3: https://github.com/raymond-van/animama/issues/58
- Phase 4: https://github.com/raymond-van/animama/issues/59

All four implementation phases are delivered in [PR #62](https://github.com/raymond-van/animama/pull/62).
See the PR for current validation and owner approval status.

## Owner follow-up — 2026-09-22

The owner narrowed the standalone starter collection to the five named poses above.
Shipped Gestures retain their `ref` and `basePose` references. Other referenced pose
definitions remain bundled internal runtime dependencies, excluded from Library
and creator pose pickers; they are not standalone Included content. This does not
change value-copy insertion for user-authored clips.
In the Pose load panel, omit the “Included and Local content” subtitle and hide
Delete for immutable Included poses. Local deletion remains available.

In Library, omit the Starter tag on Pose rows and label their existing edit/copy
entry “Edit”. Put Edit immediately after Preview on other content types that have
an existing creator route, loading the selected content. Included editing creates
a Local copy; it must never overwrite Included content. Avatars and chat uploads
have no existing creator route and remain outside that editing entry point, as
confirmed by the owner.

All creator routes using the Pose/clip load panels must keep the panel beside both
collapsed and expanded desktop sidebars and within narrow viewports.
