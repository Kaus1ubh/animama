# 0026: One built-in Idle pool per Anima replaces Idle Style content

- Status: accepted
- Recorded: 2026-10-14
- Retrospective: no
- Original decision date: 2026-10-14 (owner decisions D1–D10 on
  [issue #559](https://github.com/raymond-van/animama/issues/559))
- Supersedes: the Idle Style parts of
  [ADR 0018](0018-non-portable-included-content.md) decision 3
- Decision basis: [issue #559](https://github.com/raymond-van/animama/issues/559)
  and the [execution plan](../plans/anima-idle-pool/anima-idle-pool-execplan.md)

## Context

Idle motion came from Idle Style content: a reusable catalog item with a Default
pool and emotion/intensity pools of finite Gestures. An Anima selected one Style
or none, new and starter Animas started with none, and pools could only be
changed in a separate editor. Editing a shared Style changed every Anima that
used it, so tuning one companion meant duplicating a Style elsewhere. The
Included "Streamer Idle" and Mixamo "Emotive Idle" sets were Library content
that a user had to find and select.

## Decision

1. **The pool belongs to the Anima.** Every Anima has exactly one unnamed Idle
   pool: a Default pool plus the 72 emotion/intensity cells. It always exists
   and cannot be removed, replaced or unselected.
2. **Cells are lists or Default.** A cell with Gestures plays only those; an
   empty cell uses Default; Default may be empty. There is no per-cell "No idle".
3. **Edited in place.** The `/animas/` loadout panel adds and removes Gestures
   per cell, one plan/commit change at a time, without the Reaction review
   dialog. Only finite-playback Gestures qualify, and membership never makes a
   Gesture AI-callable.
4. **Seeded at creation.** New and starter Animas receive a tracked seed:
   Streamer Idle's mapping plus the Mixamo idles in the cells Emotive Idle mapped
   them to, where the `mixamo-motion` source is installed. Later installs never
   change an existing pool.
5. **Idle Style is not a content kind.** Its catalog items, routes, editor,
   conversion and Included set are removed. Old `idle-styles/` folders are not
   scanned. The Mixamo pack keeps its unused Emotive Idle file until its next
   version.
6. **Sharing.** An Anima package carries its pool. A non-portable member is
   omitted and recorded with the pools that used it; import rebinds it to the
   receiver's matching Included Gesture or drops it.

## Rationale and consequences

Idle motion is a property of a companion's personality, like its Reactions, so
it lives with the Anima rather than in a shared catalog item. Seeding gives every
companion natural idle motion from its first chat. Storing each member as a
binding row reuses the loadout revision, deletion protection and pack-removal
checks that Gestures and Reactions already have.

- A Local Gesture in any Idle pool cannot be deleted until it is removed.
- Packages containing Idle Style entries, and older Anima packages with an
  `idle_style` field, are no longer readable; no such packages existed.
- Removing the kind and routes is a breaking `local-http` contract change; the
  hosted consumer adopts it with its own schema migration.

## Evidence

- [Spec snapshot](../plans/anima-idle-pool/anima-idle-pool-spec.md): agreed
  requirements R1–R11 and decisions D1–D10.
- `src/backend/animama/resources/starter-idle-pool.v1.json` and
  `app/services/starter_idle_pool.py`: the seed and its resolution.
- `app/services/anima_loadout_service.py`: the `idle` family and binding slots
  `idle:<cell>:<item>`.
