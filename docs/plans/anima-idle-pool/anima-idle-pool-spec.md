# Give every Anima one built-in Idle pool and replace Idle Styles

Status: Agreed
Owner decision: owner hand-off and answers on 2026-10-14 (D1–D10 below);
implementation authorized the same day.
Authoritative source: [issue #559](https://github.com/raymond-van/animama/issues/559).
This file is an issue snapshot, published and read back at 2026-10-14T22:56:39Z.
Source baseline: `2e18090b` (`origin/main`, 2026-10-14).

## Problem and intended users

Idle playback is the finite Gesture motion an Anima plays while it is quiet.
Today it comes from an **Idle Style**: reusable catalog content with a Default
pool and optional emotion/intensity pools. Each Anima selects one Style or none
through the loadout, and new and starter Animas start with none. Pools can only
be changed in a separate Creator Studio editor, and a Style shared by several
Animas changes for all of them. The Included "Streamer Idle" set and the
Mixamo pack's "Emotive Idle" set exist only as Library content that a user has
to find and select.

As a result, a new companion stands still while quiet until its owner discovers
a separate content type, and tuning one Anima's idle motion means duplicating
and editing a Style elsewhere. The owner wants idle motion to belong to the
Anima: always present, seeded with good defaults, and edited in place next to
the Reaction grid.

Intended users: Animama users, whose companions idle naturally from the first
chat and whose idle motion is tuned per Anima; the owner, who maintains one
fewer content type.

## Goals, scope and non-goals

In scope:

- One unnamed, always-equipped Idle pool per Anima, including starter and
  imported Animas, seeded from the current Included and Mixamo idle sets.
- Editing that pool in the `/animas/` loadout panel.
- Removing Idle Style as a content type and every surface built on it.
- Renaming "Idle Style" to "Idle" in user-visible text and internal identifiers.
- Carrying the pool through Anima export and import.
- Reducing the quiet interval between idle stints from 180 to 90 seconds.

Non-goals:

- Changing which Gestures are idle-eligible, or how the runtime picks and plays
  an idle Gesture (beyond the quiet interval).
- Making idle Gestures AI-callable.
- Migrating existing Idle Style selections, Local Idle Styles or packages
  containing Idle Styles (D2, D3).
- A per-cell "No idle" state (D5), a "Restore defaults" action, or reusable
  idle presets.
- Publishing a new Mixamo pack version (D8).
- Animama Cloud's adoption of the new contract. Cloud pins reviewed package
  sets and owns its own migration and plan.

## Required behavior

R1. **One pool per Anima.** Every Anima has exactly one Idle pool: a Default
pool plus one cell for each of the 24 tracked emotions at intensities 1–3
(Mild, Moderate, Strong). The pool exists from the moment the Anima is created.
It cannot be removed, replaced by another set or left unselected; there is no
whole-set selection.

R2. **Cell meaning.** A cell with Gestures plays only those Gestures at that
emotion and intensity. An empty cell uses Default. Neutral, or no dominant
emotion, uses Default. Default may be empty; then every cell that uses Default
schedules no idle Gestures, and procedural breathing and resting continue.

R3. **Members.** Only Gestures that pass the existing finite-playback
eligibility rules can be added. A Gesture appears at most once in a cell and may
appear in any number of cells. Adding a Gesture to the Idle pool does not equip
it for AI invocation, and idle members never appear in the AI-callable Gesture
list.

R4. **Seed.** A newly created Anima, including the starter Animas, starts with
the merged seed:

- the 12 Included Streamer Idle Gestures with their current Default and cell
  mapping; and
- where the `mixamo-motion` Included source is installed, its five idle
  Gestures with the Emotive Idle mapping.

Default is Streamer Idle's Default. Each cell contains what Streamer Idle plays
there today, with inheritance resolved, plus the Mixamo idles that Emotive Idle
maps to that cell; Emotive Idle's own Default is not used. A cell equal to
Default is left empty and so uses Default. Without the Mixamo pack the seed
equals Streamer Idle exactly (7 Default Gestures, 44 explicit cells); with it,
Default is unchanged and 56 cells are explicit. Seed Gestures that are unavailable when the
Anima is created are left out; installing content later does not change
existing pools. Seeded Gestures are ordinary members that can be removed.
Locally acquired Mixamo Gestures are not part of the seed.

R5. **Editing in `/animas/`.** The loadout panel's Idle section follows the
Reaction grid layout: a Default row, then one expandable row per emotion with
its three intensities. Each cell lists its Gestures with Preview and Remove, and
an Add control opens a searchable picker of Local and Included Gestures that
shows finite-playback eligibility and disables ineligible Gestures with the
reason. An empty cell reads "Uses Default"; an empty Default explains that no
idle Gestures are scheduled. Each add or remove takes effect immediately
without a review dialog. A failed change shows an error and leaves the pool
unchanged; a stale tab refreshes instead of overwriting newer state. Changes
reach chat on the next runtime mount, as for other loadout changes.

R6. **Runtime.** The idle scheduler plays from the Anima's pool with the
existing selection behavior. A member that is unavailable or no longer eligible
when the runtime snapshot is built is skipped on its own with a diagnostic;
the rest of the pool keeps playing. The quiet interval between idle stints is
90 seconds.

R7. **Idle Style removed.** There is no Idle Style content kind, catalog item,
`/v1/idle-styles` route, Creator Studio editor, `/idle-styles/*` page, Library
filter or group, sharing kind, preview or Idle Style conversion. The Included
Streamer Idle set is deleted; its 12 Gestures remain Included Gestures. The
Mixamo pack's Emotive Idle document is no longer read. The Mixamo acquisition
script installs Gestures only. Leftover Local `idle-styles/` folders are
ignored.

R8. **Naming.** User-visible "Idle Style" becomes "Idle" in all five locales.
Internal identifiers drop `idle_style`/`idle-style` for Idle names (for
example the loadout field, routes, runtime snapshot field, binding kind and
package field).

R9. **Sharing.** An Anima export includes its Idle pool, referencing exported
Gesture entries. Non-portable members are omitted from the files and recorded
as bytes-free references with the cells that used them; import rebinds each to
the receiver's matching non-portable Included Gesture or drops it with a review
notice. An imported Anima gets exactly the pool in its package, not the seed.
Packages containing Idle Style entries are not supported.

R10. **Deletion.** Deleting a Local Gesture that is in any Anima's Idle pool is
blocked with the existing in-use error, as it is for equipped Gestures and
Reactions. Deleting an Anima deletes its pool.

R11. **Contracts.** The public HTTP contract and generated client change
structurally; their versions are bumped under the package-set rules.

## Constraints

- No Alembic revision: edit the ORM and `alembic/versions/0001_baseline.sql`;
  development databases may be reset (D2).
- [ADR 0018](../../adr/0018-non-portable-included-content.md) still holds:
  non-portable bytes never leave the app; only its Idle Style wording changes.
- Finite-playback eligibility rules and the runtime planner's selection are
  unchanged apart from the interval.
- Shared product routes stay in `animama.product_http`
  ([ADR 0021](../../adr/0021-shared-product-http-routes.md)); the local
  installation remains the only owner.
- The Mixamo pack manifest is unchanged (D8).
- Desktop-first UI, verified at desktop width then narrower widths.
- Public-ready records: no private pack bytes or private inventory content.

## Acceptance criteria

- [ ] A new Anima created in the UI, and each starter Anima, reads back an Idle
  pool equal to the seed (R1, R4). Evidence: backend tests with and without a
  `mixamo-motion` source; a manual check on the development stack.
- [ ] The loadout API offers no operation that removes, replaces or unselects
  the pool, and adding an ineligible, unknown or duplicate Gesture is rejected
  without changing the revision (R1, R3). Evidence: backend tests.
- [ ] Runtime selection follows R2: a filled cell plays only its Gestures, an
  empty cell uses Default, an empty Default schedules nothing. Evidence:
  frontend runtime/planner tests and backend projection tests.
- [ ] Idle members are absent from the AI-callable Gesture list (R3).
  Evidence: runtime projection test.
- [ ] One ineligible or missing member is skipped with a diagnostic while the
  rest of the pool plays (R6). Evidence: runtime closure test.
- [ ] The default quiet interval is 90 seconds (R6). Evidence: planner tests.
- [ ] In `/animas/`, adding and removing Gestures in Default and in an
  emotion/intensity cell persists across reload, previews play, ineligible
  Gestures are disabled with their reason, and a stale revision refreshes
  (R5). Evidence: component tests and manual desktop-width check.
- [ ] In chat, an Anima idles from its seeded pool after 90 seconds of quiet
  (R4, R6). Evidence: owner manual check.
- [ ] No Idle Style route, page, Library entry, sharing kind, content file or
  user-visible "Idle Style" string remains; existing Local `idle-styles/`
  folders do not break a rescan (R7, R8). Evidence: repository search, backend
  tests, `pnpm check`.
- [ ] Exporting and importing a complete Anima preserves its pool, and
  non-portable members rebind or drop with a notice (R9). Evidence: backend
  package tests and `pnpm e2e:test`.
- [ ] Deleting a Local Gesture used only by an Idle pool is blocked (R10).
  Evidence: backend test.
- [ ] Contract versions and the generated SDK are updated and the package-set
  compatibility comparison passes (R11). Evidence: `pnpm openapi-ts:check` and
  the package-set compare against the `main` baseline.
- [ ] `uv run pytest -q`, `pnpm check`, `pnpm web:test` (with Git LFS files
  present) and `pnpm e2e:test` pass.

## Open questions and decisions

Owner decisions (2026-10-14):

- D1. Seed with the 12 Streamer Idle Gestures and the Mixamo idles where the
  pack is installed.
- D2. No data migration: a development database reset is acceptable; there are
  no existing Animas to preserve.
- D3. No compatibility for packages containing Idle Styles.
- D4. Rename both user-visible text and internal identifiers.
- D5. Drop the explicit "No idle" cell state; an empty cell uses Default.
- D6. Merge the two sets per cell as the union of what each plays there today,
  inheritance resolved.
- D7. Idle add/remove applies immediately without the Reaction review dialog.
- D8. Keep Mixamo pack `v2`; the backend ignores its Emotive Idle document,
  and the next pack version omits it.
- D9. Quiet interval 90 seconds; the debug slider's 0–180 range is unchanged.
- D10. Refining D6: Mixamo idles join only the cells Emotive Idle maps them to.
  Emotive Idle's Default (`mixamo-idle-happy`) is not used, so the happy loop
  plays only for amusement, excitement, joy and optimism.

Conflicts with recorded decisions, resolved by this change:

- [Glossary](../../GLOSSARY.md) "Idle Style" and the backend content docs
  define idle motion as reusable content with no per-Anima pool overrides.
- [ADR 0018](../../adr/0018-non-portable-included-content.md) decision 3
  describes non-portable Gestures inside a portable Idle Style.

A new ADR records the reversal.

## Spec

[Issue #559](https://github.com/raymond-van/animama/issues/559).

## ExecPlan

[anima-idle-pool-execplan.md](anima-idle-pool-execplan.md).

## Delivery links

Phase 1: [#560](https://github.com/raymond-van/animama/issues/560).
Phase 2: [#561](https://github.com/raymond-van/animama/issues/561).
