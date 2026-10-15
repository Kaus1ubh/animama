# Reaction pools, a fourth intensity and a second Included Reaction per cell

Status: Agreed
Owner decision: 2026-10-14 owner requests and decisions D1–D3 and D5–D19
below (D4 superseded by D11); spec and ExecPlan approved 2026-10-14; R2,
R13, R14 and R16 amended for D17–D19 the same day.
Authority: parent issue [#563](https://github.com/raymond-van/animama/issues/563).
This file is a snapshot of the issue body as updated at 2026-10-15T00:41:44Z;
refresh it from the issue before resuming.

## Problem and intended users

A Reaction is the expression-led Action an Anima plays while talking, chosen by
the turn's emotion (one of 24 tracked emotions) and intensity. Today there are
three Reaction intensities, so each Anima's loadout has 72 cells. Each cell
holds at most one Reaction, and there is exactly one Included Reaction per
cell. Every joyful, moderate reply therefore plays the same clip, and the
three levels compress the model's 1–10 intensity so that a mild remark and a
moderate one look alike.

Intended users: Animama users, whose companions should react with visible
variety and in proportion to how strongly they feel. They tune each Anima's
Reactions in the `/animas/` loadout panel. The owner maintains the Included
Reaction set and its escalation ladder.

## Goals, scope and non-goals

In scope:

- Four Reaction intensities with a new mapping from the model's 1–10 intensity.
- A pool of Reactions in every emotion/intensity cell of every Anima, and
  random selection from the pool for each emotion event in chat.
- Editing pools in the `/animas/` loadout panel and the Create Anima wizard,
  and pool-aware equip/unequip from the Library and the Reaction editor.
- Carrying pools through Anima creation, export and import.
- A documented Reaction ladder for the four intensities.
- Bringing the existing Included Reactions onto that ladder, adding an
  expression Reaction for the new lowest intensity, and adding a second
  Included Reaction to every cell at intensities 2–4, creating new Avatar,
  Particle and Scene Effects where reuse would not give real variety.

Non-goals:

- Changing the model's output (`emotional_tone` and 1–10
  `emotional_intensity`) or its prompts. Neutral and an empty cell still play
  no Reaction, and there is no fallback between cells.
- Changing Idle pools. They use the Anima's emotion state, which keeps three
  intensities.
- Weighted members, per-member probabilities or ordering.
- Pools for AI-invoked Gestures. Idle pools are delivered separately by
  [#559](https://github.com/raymond-van/animama/issues/559).
- Compatibility with packages, loadouts or creation requests that use the
  current cell shape (D3).
- A second Included Reaction at intensity 1 (D11).
- Animama Cloud's adoption of the new contract.

## Required behavior

### Intensities and ladder

R1. **Four intensities.** Reactions have four intensities, giving 96 cells per
Anima (24 emotions × 4). The model's 1–10 intensity maps to a Reaction
intensity as follows (D9):

| Model intensity | Reaction intensity | Label (D12) |
| --------------- | ------------------ | ----------- |
| 1–2             | none               | —           |
| 3–4             | 1                  | Mild        |
| 5–6             | 2                  | Moderate    |
| 7–8             | 3                  | Strong      |
| 9–10            | 4                  | Intense     |

A turn at intensity 1–2 plays no Reaction. How much a turn shifts the Anima's
emotion state is unchanged (D13).

R2. **Ladder.** Current guidance for Reaction content describes this ladder
(D10). Each step adds to the one below:

| Intensity | Guideline                                    |
| --------- | -------------------------------------------- |
| 1         | Facial expression                            |
| 2         | Expression with one or two Avatar Effects    |
| 3         | Intensity 2 plus a Particle Effect           |
| 4         | Intensity 3 plus a Scene Effect              |

The ladder is guidance, not validation: any Reaction may be saved in any cell,
and an Included Reaction may depart from it when a documented reason (for
example, an effect that would hide the expression) makes that better. At
intensity 1, one subtle Avatar Effect may be added where the expression alone
cannot tell the emotion from another emotion's intensity-1 face (D19).

### Pools

R3. **Pool per cell.** Each of an Anima's 96 cells holds zero to four
Reactions (D5). A Reaction appears at most once in a cell and may appear in any
number of cells. Any Local or Included Reaction may join any cell; its
emotion/intensity suggestion stays a hint.

R4. **Starter pools.** A new Anima, including each starter Anima, starts with
every cell's pool holding all Included Reactions for that cell: one at
intensity 1 and two at intensities 2–4 (D16). Restoring a cell's starter pool
replaces its members with those Reactions.

R5. **Selection.** When chat reports an emotion and a Reaction intensity, the
runtime picks one member of that cell's pool uniformly at random. When the
pool has two or more members, it does not pick the member it played last for
that cell. The pick is made once per emotion event and stays fixed while the
event waits for talking. A one-member pool always plays that member. An empty
pool plays no Reaction.

R6. **Availability.** A member that is missing, invalid or over the runtime
budget when the runtime snapshot is built is skipped with a diagnostic; the
other members of that cell and all other cells keep playing.

R7. **Editing in `/animas/`.** The Reactions section keeps its emotion rows,
now with four intensity rows each. Each intensity row lists its Reactions, each
with its name, the Starter badge for Included Reactions, Preview and Remove. An
Add control opens the existing searchable Reaction picker (Local and Included
groups, preview), where Reactions already in the cell are marked and cannot be
added again. When the cell holds four Reactions, Add is disabled and says why.
An empty cell reads "No Reaction". The cell menu keeps "Choose from Library"
and offers "Restore starter" when the pool differs from its starter pool.
"Leave empty" is retired: removing a cell's last member leaves it empty (D7).

Each add, remove or restore applies immediately without a review dialog (D2).
A failed change shows an error and leaves the pool unchanged. A change made
against a stale loadout refreshes the panel instead of overwriting newer state.
Changes reach chat on the next runtime mount, as for other loadout changes. The
Reactions and Idle sections share one pool layout and picker behavior (D1).

R8. **Equip elsewhere.** The equip dialog opened from the Library or the
Reaction editor has an emotion and intensity chooser, defaulting to the
Reaction's suggestion (Joy, Mild when it has none) (D8). For each Anima it
shows whether the Reaction is in the chosen cell's pool and offers Add or
Remove for that cell; Add is disabled with a reason when the cell is full. It
never replaces or removes other members.

R9. **Creation.** The creation API accepts a pool per cell for all 96 cells.
The Create Anima wizard's Reactions step edits pools with the same member list,
picker, duplicate prevention and four-member limit as `/animas/`, starting from
the starter pools; the created Anima reads back exactly the chosen pools (D6).

R10. **Sharing.** An Anima export contains every cell's complete pool, and
importing it recreates exactly those pools rather than starter pools. Each
member is exported as an ordinary Reaction entry under the existing package
rules.

R11. **Deletion.** Deleting a Local Reaction that is a member of any Anima's
pool is blocked with the existing in-use error. Deleting an Anima deletes its
pools.

R12. **Contracts.** The loadout, runtime, creation and package contracts and
the Reaction placement hint change structurally for pools and four
intensities, and the `emotion.update` chat event carries a Reaction intensity
of 0–4. Contract and package versions are bumped under the package-set rules.
Reactions remain absent from the AI-callable Gesture list.

### Included Reactions

R13. **Existing Reactions.** Each of today's 72 Included Reactions moves up one
intensity (1→2, 2→3, 3→4), keeping its effects and the blend of its
expression, which is strengthened to full strength (D17). It is revised where
it departs from its new level's guideline without a recorded reason.
Departures in the current set include intensity-2 Reactions without a Particle
Effect (amusement, confidence, disapproval, embarrassment, fear, nervousness,
remorse), Reactions without an Avatar Effect (caring-3, sadness-2) and
intensity-3 Reactions without a Particle Effect (disapproval, fear,
nervousness); intensities are today's.

R14. **Intensity 1.** Each emotion gets a new intensity-1 Included Reaction: a
full-strength facial expression (D17) that clearly reads as that emotion and
differs from the other emotions' intensity-1 Reactions, without effects
except the subtle Avatar Effect D19 allows; the effects of intensities 2–4
carry the escalation. A D19 effect is not used at that emotion's other
intensities.

R15. **Second Reactions.** Each cell at intensities 2–4 gets a second Included
Reaction (72 in all). It follows the same ladder step but differs visibly from
the first in expression and in at least one effect, so the two read as
alternatives rather than copies. New Avatar, Particle or Scene Effects are
created with the Animama content skills where existing ones would not give
that difference.

R16. **Quality and approval.** New Avatar Effects follow D18. Every new or
revised Included Reaction and effect passes the content checks, has review renders on both Included Avatars,
keeps the heaviest Reactions within the effect performance budget (4 ms added
frame interval and GPU time on the owner's development Mac) and enters
`content/included/` only after the owner approves it in the live preview. New
art carries owner-authored licence records.

## Constraints

- The pool code builds on the merged Idle pool work (D1): reuse its per-member
  storage, pool editing component and picker rather than adding a parallel pool
  mechanism.
- No Alembic revision: edit the ORM and `alembic/versions/0001_baseline.sql`;
  development databases may be reset.
- Pool members count against the existing whole-Anima runtime content budget.
  A Reaction used in several cells counts and loads once; members beyond the
  budget are omitted individually with a diagnostic (R6), as other content is.
  The starter loadout (168 Included Reactions with their effects) must load
  without omissions.
- Shared product routes stay in `animama.product_http`
  ([ADR 0021](../../adr/0021-shared-product-http-routes.md)); the local
  installation remains the only owner.
- Content follows the existing Animama content skills and formats
  (`animaPoseClip/2.0`, `animama/avatar-effect/2`, Particle and Scene Effect
  formats) and the [source and licensing
  boundary](../../architecture/repository-boundaries.md).
- Desktop-first UI, verified at desktop width and then narrower widths; pools
  remain usable by keyboard and screen reader, as the current grid is.
- Public-ready records: no private content or credentials.

## Acceptance criteria

- [ ] Model intensities map to Reaction intensities as in R1, and intensity 1–2
  plays no Reaction while still shifting emotion state as today (R1).
  Evidence: backend emotion-update tests and planner tests.
- [ ] Current Reaction content guidance describes the ladder (R2). Evidence:
  documentation review.
- [ ] A new Anima and each starter Anima read back 96 cells whose pools equal
  their starter Reactions; restoring a modified cell returns its starter pool
  (R4). Evidence: backend tests.
- [ ] The loadout API adds and removes pool members; a duplicate member, an
  unknown or non-Reaction item, an invalid cell or a fifth member is rejected
  without changing the revision (R3). Evidence: backend tests.
- [ ] Runtime selection follows R5: uniform choice, no immediate repeat in a
  cell with two or more members, one pick per event, nothing for an empty pool.
  Evidence: planner and runtime catalog tests with injected random rolls.
- [ ] Every pool member reaches the runtime snapshot, a Reaction shared across
  cells loads once, a missing member is skipped with a diagnostic while the
  rest play, and the starter loadout loads without omissions (R6). Evidence:
  backend projection and frontend adapter tests.
- [ ] In `/animas/`, adding, removing, previewing and restoring members across
  all four intensities persists across reload, duplicates and full cells are
  prevented with a reason, and a stale revision refreshes (R7). Evidence:
  component tests and a manual check on a task stack at desktop and narrow
  widths.
- [ ] The equip dialog adds to and removes from the chosen cell's pool,
  defaults to the suggested cell and leaves other members untouched (R8).
  Evidence: component tests.
- [ ] Creating an Anima through the wizard and through the API with
  multi-member pools reads back those pools; the wizard enforces the limit and
  prevents duplicates (R9). Evidence: backend and component tests and
  `pnpm e2e:test`.
- [ ] Exporting and importing a complete Anima with multi-member pools
  preserves them exactly (R10). Evidence: backend package tests and
  `pnpm e2e:test`.
- [ ] Deleting a Local Reaction used only as a pool member is blocked (R11).
  Evidence: backend test.
- [ ] Contract versions and the generated SDK are updated and the package-set
  compatibility comparison passes (R12). Evidence: `pnpm openapi-ts:check` and
  the package-set compare against a `main` baseline.
- [ ] `content/included/reactions/` holds 168 Reactions: one at intensity 1
  and two at intensities 2–4 for each emotion, with a ladder table recording
  each Reaction's expression, effects and any departure with its reason
  (R13–R15). Evidence: included-content integrity tests and the ladder table.
- [ ] Every new or revised Reaction and effect passes `pnpm -s animation
  validate`, `pnpm -s animation check` and `pnpm -s effects check` as
  applicable, the heaviest are benchmarked within budget, and each was
  approved by the owner in the live preview (R16). Evidence: recorded results
  and dated owner approvals in the plan.
- [ ] In chat, a cell with several Reactions plays different members across
  repeated emotion events, and stronger replies escalate along the ladder.
  Evidence: owner manual check.
- [ ] `uv run pytest -q`, `pnpm check`, `pnpm web:test` and `pnpm e2e:test`
  pass.

## Open questions and decisions

Owner decisions (2026-10-14):

- D1. Implement the pool code after the Idle pool work (#559) merges, reusing
  its pool storage, UI and picker.
- D2. Pool edits apply immediately, without the Reaction review dialog.
- D3. No compatibility with packages or contracts using the current cell shape;
  the product is still in development.
- D4. _Superseded by D11._ No new Included Reaction content.
- D5. At most four Reactions per cell.
- D6. The Create Anima wizard edits pools too.
- D7. The cell menu offers "Restore starter" only; "Leave empty" is retired.
- D8. The equip dialog lets the user choose the cell, defaulting to the
  Reaction's suggestion.
- D9. Four Reaction intensities: model intensity 1–2 none, 3–4 → 1, 5–6 → 2,
  7–8 → 3, 9–10 → 4.
- D10. The ladder in R2, as guidelines rather than rules.
- D11. Update the existing Reactions to the ladder and create a second Reaction
  for each emotion and intensity, except intensity 1 (expression only), using
  the Animama content skills to create high-quality new content where needed.

- D12. Intensity labels Mild, Moderate, Strong and Intense.
- D13. The emotion-state change per turn keeps today's scale (model intensity
  1–3 → 1, 4–6 → 2, 7–10 → 3); only the Reaction intensity uses the new
  mapping, so turns at intensity 1–2 still move the emotion state that drives
  idle motion.
- D14. Today's Reactions keep their content and take the ID of their new level
  (`joy-3` becomes `joy-4`, and so on); new intensity-1 Reactions take
  `<emotion>-1`; second Reactions take `<emotion>-<intensity>-b` and are named
  like "Joy Reaction 3B".
- D15. Content design and drafting start before #559 merges, because they
  touch no shared code; content enters `content/included/` only after the code
  phases.
- D16. Starter pools hold every Included Reaction for their cell.
- D17. Expressions are noticeable and exaggerated: every Reaction's main
  expression plays at full strength from intensity 1, and the effects carry
  the escalation between intensities. Where full weight would close or hide
  the eyes on the Included Avatars (`happy` above about 0.75, or `happy` with
  `blink`), a Reaction uses the strongest readable weight.
- D18. New Avatar Effects are hand-drawn anime manpu without lettering, in
  one of two house styles chosen per effect (manga G-pen ink with
  screentone, or marker and crayon doodle), each a line-boil or
  frame-by-frame flipbook and never a draw-on; the content skills record the
  styles for future effects. Second Reactions use no lettering effects.
- D19. Where two intensity-1 faces stay alike because the Included Avatars
  have only six expressions, one of them adds one subtle existing Avatar
  Effect (owner choice over accepting look-alikes or forcing odd blends).

Conflicts with current documentation, resolved by this change:

- [Typed content](../../backend/features/typed-content-and-marketplace.md) and
  the [data model](../../backend/architecture/data-model.md) state that each
  Reaction binding occupies one canonical emotion/intensity cell.
- [Avatar emotion](../../frontend/runtime/avatar-emotion.md) documents the
  three-level intensity mapping.
- The [avatar planner](../../frontend/runtime/avatar-planner.md) identifies a
  Reaction by its `<emotion>-<intensity>` cell.
- [Anima management](../../frontend/features/anima-management.md) describes a
  single selector per cell and replacement of the current occupant.
- The three-intensity ladder approved in the
  [particle and scene effects content plan](../particle-scene-effects/particle-scene-effects-content-execplan.md)
  (R12, G1) is replaced; that plan remains delivery history.

No ADR covers Reaction cells or intensities; the plan decides whether this
change needs one.

## Spec

[#563](https://github.com/raymond-van/animama/issues/563).

## ExecPlan

To be tracked at `docs/plans/reaction-pools/reaction-pools-execplan.md`.

## Delivery links

Phases: #564, #565, #566, #567, #568, #569 (sub-issues of #563).
