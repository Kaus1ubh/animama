# Timeline catalog drag and drop

## Outcome and authority

Implement the accepted September 21, 2026 plan for dragging saved poses and effects
onto the Gesture/Reaction timeline. Automatic lane placement, snapped transparent
time preview, occupied-pose replacement preview, one undoable insertion, and
post-drop selection/seek are required. Existing plus buttons and mobile remain.
The task is associated with creator polish issue #39. The owner explicitly keeps
this work local: no push or PR update. The accepted conversation remains the
specification authority for this increment while remote updates are paused.

## Workspace

Use the assigned 0889/animama worktree on `fix/gesture-header-polish`.
Starting revision: `eeb21ade0da1cc44393208307ab80d5d60b9af1b`.
Base: `7df1b615b00067cf9c9655a4f0e70ac9c9c80e25`.
Reuse development stack at http://localhost:8320; do not reset user data.

## Phase 1: Catalog insertion and desktop drag interaction

Extend existing insertion APIs with explicit time, retaining atomic history and
same-time pose replacement. Use the installed dnd-kit with 6px pointer activation;
keep temporary pointer/preview state out of the document. Add a lightweight ghost,
matching lane marker, guide, transparent readout, and collision wording. Reuse
snap/clamp and track geometry. Select effects after matching-session hydration.
Handle cancel, blur, route/session changes and collapsed timeline auto-expansion.

Validation: focused insertion/history/geometry tests; source typecheck, affected
lint and formatting; desktop browser at 1440 and 1280. Check valid drops, cancellation,
replacement, collapsed timeline, label edges, plus buttons and existing marker drag.
One independent initial review and at most two repair rounds; retain evidence here.
No backend or persisted-format changes. Recovery is reverting only this increment's
files; drag cancellation must never require restoring persisted content.

## Progress

- [x] Inspect existing insertion, hydration, geometry, and drag-library patterns.
- [x] Implement explicit insertion and drag coordination.
- [x] Run focused checks and desktop browser acceptance.
- [x] Independent review; local commit prepared with concurrent edits excluded.

## Surprises & Discoveries

Effect document hydration currently preserves playhead and resets selection, so
post-drop effect selection must wait for the new event to appear. Existing endpoint
VFX insertion extends duration by its default lifetime; preserve this behavior.

The installed dnd-kit MouseSensor cancels on viewport resize. Keep this safe
cancellation rather than introducing a custom sensor; subsequent drags and layout
changes use current geometry. ResizeObserver and scroll observations update preview
geometry without document writes.

## Decision Log

- 2026-09-21: Owner chose automatic lane placement, seek after drop, and explicit
  replacement preview for occupied pose timestamps.
- Reuse dnd-kit; no new dependencies. Keep plus actions as the keyboard/mobile path.

## Code Review #1 Findings

R1: Explicit pose insertion retained a selected effect, so the inspector could
show the wrong item. R2: Desktop and hidden mobile catalog copies shared dnd-kit
IDs, allowing hidden registrations to replace visible drag handles.
Browser verification additionally found the mobile timeline used the workspace
variant and registered a hidden drop target (R3).

## Code Review #1 Revisions

Accepted R1-R3: explicit pose drops clear the selected event, hydrated effect
selection clears the selected keyframe, catalog handles use per-instance IDs,
and the mobile timeline explicitly uses its mobile variant. Added mode/session
selection guards and lifecycle tests. Independent targeted review #2 passed.

## Code Review #2 Findings and Revisions

Browser verification found Reaction uses mode `reaction`, not `clip`; enabled
shared effect dragging for both and added a coordinator regression (R4).
Real Reaction plus-button and drop Undo both looped on normalized timeline fields
(R5): hydration removes explicit `loop: false` and can resolve Gesture basePose.
Repair the insertion/history boundary with a real hydration roundtrip regression.
R4 and R5 repaired: insertion canonicalizes via the existing pure draft converter
and serializer before the history commit; invalid imported documents remain intact.
The dropped event ID is captured before canonicalization sorts events. Independent
final targeted review #3 passed with no concrete blockers. The two repair rounds
are exhausted; future findings require a separately scoped decision.

## Final integration review and outcomes

Delivered drag handles, automatic lane selection, snapped ghost/time preview,
occupied-pose replacement feedback, cancellation and collapsed hover expansion.
The plus actions remain available. Dropped items select and seek consistently.
The real hydration roundtrip history regression is fixed for both creator types.

Validation performed from the frontend workspace:

- `pnpm --dir web check:source`: passed.
- Focused `pnpm --dir web exec vitest run` covering `ActionCatalogDrag`,
  `catalogDropSelection`, `timelineCatalogDrop`, `ActionEditorEffectsPanel`,
  `ActionTimelineDocumentSync`, `ActionTimelineEditor`, `poseCreatorClipAuthoring`,
  `pose-creator-store`, `actionDependencies`, and `actionPersistence`: passed.
  The last broad pass had 70 passing tests and one suite interrupted while package
  dist was being rebuilt; `ActionTimelineDocumentSync.test.tsx` was rerun after
  the build and both tests passed. This was an environment race, not a code failure.
- Scoped `pnpm --dir web exec eslint` and `prettier --check`: passed; `git diff
--check` and staged patch checks passed. Shared staged files were separately
  checked with Prettier after excluding concurrent edits.
- `pnpm build`: passed with the existing large-chunk warning.
- Browser at localhost:8320: desktop layouts at 1280 and 1440; Gesture pose drop
  at 0.65/0.70, resized placement at 0.60, occupied-time replacement, unsnapped
  placement at 0.625, plus-button and existing-marker dragging, outside cancellation,
  Reaction particle drop at 0.60 and one Undo removing event and dependency.
- Hover without writes, Escape/blur cancellation, 300ms auto-expansion/collapse
  restoration, and delayed hydration/session guards are covered by coordinator
  tests. Continuous held-drag visual smoothness and auto-expansion were not separately
  captured in the browser automation; no frame-rate measurement is claimed.

Native packaged acceptance and hosted CI were not run. No push or PR update.
Concurrent header, inspector and timeline-toolbar edits were preserved in the working
files and excluded from this increment's local commit. Temporary browser tabs were
closed and viewport overrides reset. The existing local stack remains available.
