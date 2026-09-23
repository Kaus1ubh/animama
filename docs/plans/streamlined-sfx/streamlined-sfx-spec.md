# Streamlined Sound Effect authoring

Status: Agreed outcome and execution plan.
Owner decision: 2026-09-23 task instruction authorizes the requested feature scope.

## Problem and intended users

Gesture, Reaction and visual-effect authors need to add reusable audio where they
select it, without visiting a separate Sound Effect creator. Library remains the
place to manage saved audio independently of an action draft.

## Goals, scope and non-goals

Preserve typed Sound Effect identities, revisions, validated files and exact
Gesture/Reaction/VFX dependency resolution. Replace dedicated sound creator pages
with uploads in pickers and basic Library management. No waveform editor, trimming,
new inspector, content migration, or unrelated creator redesign.

## Required behavior

- R1: Gesture and Reaction SFX tabs accept one or multiple supported audio files.
  Each valid file becomes one persistent Sound Effect. Names omit extensions and
  follow the existing case-insensitive numeric suffix convention for collisions.
  Show per-file progress/errors; retry failures without duplicating successes.
  Refresh the catalog after saves. Upload never inserts an event, and discarding
  an action draft never deletes uploaded sounds. Omit description/technical fields.
- R2: Each SFX row has separate Play/Stop and Add to timeline controls. Only one
  picker preview plays at once. Stop it on tab change, route exit and timeline
  playback. Add uses existing playhead/undo conventions and exact sound references.
- R3: Avatar FX and Scene FX accompanying-sound pickers reuse uploads and allow
  selecting saved sounds. Preserve transitive sound dependencies and playback.
- R4: Avatar/Scene FX events with accompanying sound show a small speaker marker.
  Their existing event panel shows the sound name and a default-on “Play
  accompanying sound” toggle. Effects without sound show neither marker nor
  sound-specific fields. Disabling affects only that event's accompanying sound,
  retains its visual effect, and leaves independent SFX events unchanged.
- R5: Persist suppression through save/reopen and honor it in creator previews,
  content previews and actual Gesture/Reaction playback. Legacy events play their
  accompanying sound by default. Suppression does not remove dependency edges.
- R6: Retire standalone Sound FX new/edit pages after replacement coverage exists.
  Update Create hub, sidebar, Library and picker links; old URLs reach a useful
  Library destination. Library retains preview, rename, replace audio and guarded
  delete, preserving identity/revision and dependency safeguards.

## Constraints

Keep WAV/MP3/OGG validation at the existing typed save boundary. Reuse protected
preview preparation and operation receipts; do not introduce raw URL/path playback
or a second persistence API. Included content remains immutable. Preserve existing
sound metadata not exposed by this upload flow. Keep personal sample audio outside
tracked source and public evidence. Use the assigned worktree and isolated stack.

## Acceptance criteria

- [ ] Multi-file valid/invalid batch keeps successful items; retry and ambiguous
      response replay do not duplicate them; collisions use unique names.
- [ ] Catalog refresh, explicit insertion, draft discard persistence and exclusive
      preview cleanup pass automated checks and rendered desktop journeys.
- [ ] Both effect pickers upload/select exact sounds; save/reopen preserves them.
- [ ] Default, disabled, legacy and no-sound events behave correctly in the existing
      panel, timeline, creator preview and actual Gesture/Reaction playback.
- [ ] Rename/replacement preserve identity, reject stale revisions, and respect
      dependency safeguards; deletion and old routes remain usable.
- [ ] Desktop layouts pass before narrow layouts; local, browser, hosted CI and
      unperformed/native or audible checks are reported separately.

## Open questions and decisions

No unresolved product scope. Progress can use honest queued/uploading/saved/error
states with completed-file counts; the existing multipart transport provides no
byte-percentage callback. Owner approved implementation of all phases on 2026-09-23 through the implement skill.

## Spec

Snapshot of https://github.com/raymond-van/animama/issues/69, captured 2026-09-23T18:32:16Z. The issue is authoritative.

## ExecPlan

[Execution plan](streamlined-sfx-execplan.md).

## Delivery links

Branch: `feat/streamline-sfx`. Issues and PR pending plan review.
