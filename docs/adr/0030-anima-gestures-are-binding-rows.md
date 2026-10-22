# 0030: An Anima's Gestures are its binding rows

- Status: accepted
- Recorded: 2026-10-22
- Retrospective: no
- Original decision date: 2026-10-21, through the owner's direction in [#648](https://github.com/raymond-van/animama/issues/648) after the #555/#647 review, with the restore and conversion choices of 2026-10-21 recorded in the [explicit Gesture rows ExecPlan](../plans/explicit-gesture-rows/explicit-gesture-rows-execplan.md)
- Decision basis: Explicit owner decision

## Context

An Anima's AI-callable Gestures came from two layers. The starter policy
version stored on the loadout made all 140 starter Gestures equipped without a
row unless `anima_loadouts.starter_exclusions` named them, and the owner's own
Gestures were `anima_content_bindings` rows. Local creation wanted exact
membership, so it excluded every starter and stored each selected Gesture as a
row; the hosted starter step relied on the implicit layer.

Every reader (the loadout read model, the runtime mount, package export and
content transitions) merged both layers. Deriving a starter's key from its id
in each reader caused #555, and removing a Gesture could bring a starter back
depending on exclusion bookkeeping. Reaction and Idle pools already stored only
explicit rows.

## Decision

An Anima's Gestures are exactly its `gesture:<semantic_key>` rows. The starter
policy's `gestures` list is a creation template: local creation (through the
creation request) and `create_starter_loadout` copy each available starter into
a row under the semantic key its Included document declares. There are no
starter exclusions, no implicit starter Gestures and no starter-specific Gesture
operations or states; the API drops `disabled_starter_gestures`,
`starter_gesture_implementation_kinds`, `PyGestureBinding.origin` and the
Gesture `disable_starter`/`restore_starter` intents. Re-adding a removed starter
is an ordinary add from the Gesture list.

Existing databases are not converted in code. Local loadouts already stored
every Gesture as a row; a starter that the old per-Gesture Equip re-enabled
implicitly is re-equipped by the owner, and a reset gives the new baseline.
Cloud converts or resets hosted loadouts when it adopts this change.

## Rationale and consequences

- One model for Gestures, Reactions and Idle pools; readers list rows and
  cannot disagree about which starter is present.
- Removing a Gesture is final, and an Anima's Gestures no longer change when
  the policy file changes; the policy version remains for Reaction `origin`,
  cell `state` and the cell's `restore_starter`.
- Creation writes the starter Gestures in one batched insert (with #636's
  pools), so first-run creation stays bounded.
- The `local-http` contract takes a major version, and Cloud must adopt it with
  a hosted migration and test changes.

Alternatives considered: keep the implicit layer with fixed keys (the #647
interim fix; every new reader still has to merge), keep a "Restore starter
Gestures" action (an additive or a destructive reset; it reintroduces
starter-specific Gesture state), and an in-code one-time conversion of existing
loadouts (a new startup data-migration pattern for little retained data).
