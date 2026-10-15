# Reaction pools, a fourth intensity and a second Included Reaction per cell

Source agreement: [reaction-pools-spec.md](reaction-pools-spec.md) (R1–R16,
owner decisions D1–D3 and D5–D16 of 2026-10-14), published as parent
[#563](https://github.com/raymond-van/animama/issues/563).
Authorized scope: the whole plan, Phases 1–6 (owner, 2026-10-14).
Branch: `feat/reaction-pools` in its own worktree, created at `50640701`
(`origin/main`, 2026-10-14) for planning. One PR for the whole plan.

## Purpose and context

After this plan:

- Reactions have four intensities (96 cells per Anima). The model's 1–10
  intensity maps 1–2 to no Reaction, then 3–4, 5–6, 7–8 and 9–10 to
  intensities 1–4.
- Each cell holds a pool of up to four Reactions. The avatar runtime picks one
  member at random per emotion event without repeating the previous pick for
  that cell. Pools are edited in `/animas/`, the Create Anima wizard and the
  equip dialog, and travel through creation, export and import.
- The Included set follows a documented four-step ladder (expression; plus one
  or two Avatar Effects; plus a Particle Effect; plus a Scene Effect) and holds
  168 Reactions: one expression Reaction at intensity 1 and two Reactions in
  every cell at intensities 2–4. Starter pools hold all of a cell's Included
  Reactions.

**Dependency (D1).** Pool code starts only after the Idle pool work
([#559](https://github.com/raymond-van/animama/issues/559), plan
`docs/plans/anima-idle-pool/` on `feat/anima-idle-pool`) merges. That work
stores each Idle pool member as its own `anima_content_bindings` row, adds an
immediate plan-and-commit mutation and builds an Idle section with member
chips and an Add picker on the Reaction grid shell; this plan reuses them.
Content design and drafting (Phases 1–2) touch no shared code and run
before that merge (D15). Phase 3 step 0 refreshes the baseline below against
the merged code.

### Current implementation (baseline `50640701`)

Intensity and chat (backend `src/backend/animama`):

- `app/primary_emotion_update.py` `voice_intensity_to_avatar_level` maps the
  model's 1–10 intensity to 1 (1–3), 2 (4–6) or 3 (7–10). The same value both
  shifts the emotion state (promoted emotion +level, an opposing one −level)
  and becomes `emotion.update` `emotional_intensity` (0 for neutral or
  invalid). The frontend uses `emotional_intensity` only for Reactions; Idle
  cells use the emotion state through `intensityFromEmotionValue`.
- Intensity is `Literal[1, 2, 3]` in loadout contracts, `"1"|"2"|"3"` in
  creation and portable matrices and inline `{1, 2, 3}` checks in services;
  the frontend has `EmotionReactionIntensity = 1 | 2 | 3`
  (`web/src/lib/avatar/reactionClips.ts`).

Loadout and runtime:

- **Storage.** Each equipped Reaction is one `anima_content_bindings` row with
  `slot_key = "reaction:<emotion>-<intensity>"`, unique per
  `(anima_id, slot_key)` (`orm/content_catalog.py` `_TYPED_SLOT_CHECK`,
  `uq_anima_content_slot`; `alembic/versions/0001_baseline.sql`). Its
  `RESTRICT` foreign key blocks deleting an equipped Local item.
- **Starter cells.** `AnimaLoadoutService.initialize` writes an explicit row
  for every selected cell and a `starter_exclusions` entry for every empty one.
  "Revert to starter" deletes the row so the cell falls back to the implicit
  starter in `resources/starter-loadout.v1.json` (72 entries).
- **Slot parsing.** Four places recover the cell with `rpartition("-")`:
  `content_kind_registry.py`, `anima_package_source_service.py`,
  `anima_runtime_service.py` and `content_transition_repo.py`.
- **Contracts.** `app/contracts/anima_loadout.py` (`PyReactionIntent` with
  `add | replace | update | reconfigure | revert | leave_empty`, of which only
  `replace`, `revert` and `leave_empty` have callers; `PyReactionCell` with one
  `source`), routes `reactions:plan|commit`
  (`product_http/routes/loadouts.py`), creation `ReactionCells`
  (`app/anima_creation_contract.py`), `PortableAnima.reactions`
  (`app/contracts/portable_anima.py`) and the Reaction placement hint
  (`domain/content_documents.py`).
- **Runtime.** `PyAnimaRuntime.reactions` lists `PyRuntimeAction` entries with
  `emotion`/`intensity`. Closure roots are keyed `slot_key|item|kind`; catalog
  entries are deduplicated against `MAX_RUNTIME_ENTRIES = 500`, and an
  over-budget root is omitted with a diagnostic.
- **Frontend runtime.** `runtimeSnapshotAdapter.ts` gives each Reaction the
  runtime ID `<emotion>-<intensity>` and replaces duplicates by ID.
  `AnimaRuntimeCatalog.getReactionRuntimeId` returns one ID; the built-in
  `AvatarMotionCatalog` (`lib/avatar/poses/catalog.ts`) and
  `PreviewRuntimeCatalogSession` implement the same interface.
  `AvatarPlanner.planReactionClip` re-evaluates a pending emotion event every
  frame until talking and draws no random rolls; Idle selection already has
  avoid-repeat picking with injected rolls (`lib/avatar/animationManifest.ts`).
- **UI.** `ui/animas/AnimaLoadout.tsx` → `ReactionLoadoutGrid.tsx`
  (single-choice selector; Preview, Choose from Library, Revert to starter,
  Leave empty; plan → review dialog → commit); `lib/loadout/reactionLoadoutGrid.ts`;
  `ui/action-manage/ActionManageDialog.tsx` and `actionManageTarget.ts`;
  `ui/create-anima/` (one item per cell); `ui/library/SharingPackageDetails.tsx`;
  `ui/debug/AnimationDebugModal.tsx`; `lib/content/catalogTypes.ts`;
  `locales/*/animas.json`; `lib/errors/userVisibleCodes.json`.

Content (`content/included/`):

- 72 Reactions in `reactions/<emotion>-<n>/` (`animaPoseClip/2.0` clip plus
  `.meta.json` with `placement_hint` and effect dependencies), 70 Avatar
  Effects (`vfx/avatar/`), 19 Particle Effects (`vfx/particle/quark/`) and 27
  Scene Effects (`vfx/scene/`: one background per emotion plus
  `awkward-silence`, `dark` and `light-streak`).
- Today's ladder (approved in the particle and scene effects content plan,
  R12): intensity 1 has Avatar Effects only, 2 adds a Particle Effect where one
  fits, 3 adds the emotion's background. Audit of effect dependencies by
  today's intensity (A Avatar, P Particle, S Scene):

  | Emotion        | 1   | 2     | 3        |
  | -------------- | --- | ----- | -------- |
  | admiration     | A1  | A1 P1 | A1 P1 S1 |
  | amusement      | A1  | A2    | A1 P1 S1 |
  | anger          | A1  | A1 P1 | A3 P1 S1 |
  | annoyance      | A1  | A1 P1 | A1 P1 S1 |
  | caring         | A1  | A1 P1 | P1 S1    |
  | confidence     | A1  | A1    | A1 P1 S1 |
  | confusion      | A1  | A1 P1 | A2 P1 S1 |
  | curiosity      | A1  | A1 P1 | A1 P1 S1 |
  | desire         | A1  | A1 P1 | A2 P1 S1 |
  | disappointment | A1  | A1 P1 | A1 P1 S1 |
  | disapproval    | A1  | A1    | A1 S1    |
  | disgust        | A1  | A1 P1 | A1 P1 S1 |
  | embarrassment  | A1  | A2    | A2 P1 S1 |
  | excitement     | A1  | A1 P1 | A1 P2 S1 |
  | fear           | A1  | A2    | A2 S1    |
  | gratitude      | A1  | A1 P1 | A2 P1 S1 |
  | grief          | A1  | A1 P1 | A3 P2 S1 |
  | joy            | A1  | A1 P1 | A1 P2 S1 |
  | love           | A1  | A2 P1 | A2 P1 S1 |
  | nervousness    | A1  | A1    | A2 S1    |
  | optimism       | A1  | A1 P1 | A1 P1 S1 |
  | remorse        | A1  | A1    | A1 P1 S1 |
  | respect        | A1  | A1 P1 | A1 P1 S1 |
  | sadness        | A1  | P1    | A2 P1 S1 |

- Tooling (`src/frontend/web`): `pnpm -s animation validate|check`,
  `animation:preview`, `animation:render`, `animation:save`, `pnpm -s effects
  check|promote`, `effects:render`, `effects:bench --reaction`,
  `effects:assets`. Drafts live in the ignored `.animama-drafts/`.

## Progress

- [x] Owner review of the spec and this plan (approved 2026-10-14).
- [x] Workspace setup: parent #563, phase issues #564–#569 (2026-10-14).
- [x] Phase 1: ladder table, briefs and new-effect list. G1 approved 2026-10-14; Code Review #1 passed after two repair rounds.
- [ ] Phase 2: content drafts, renders and benchmarks. Gate G2.
- [ ] Dependency: #559 merged; branch rebased; baseline refreshed.
- [ ] Phase 3: backend pools and four intensities.
- [ ] Phase 4: runtime selection and `/animas/` pool editing.
- [ ] Phase 5: equip dialog cell chooser and wizard pools.
- [ ] Phase 6: promotion, starter pools and journeys. Gate G3.
- [ ] Final integration review, full validation and PR.
- Remaining owner gate: escalation and variety check in chat.

## Surprises & Discoveries

- 2026-10-14: new Animas already store an explicit row for every non-empty
  cell; the implicit starter fallback is reached only after "Revert to
  starter". Explicit member rows lose no current upgrade behavior.
- 2026-10-14: no frontend caller uses the `update` or `reconfigure` Reaction
  operations.
- 2026-10-14: runtime catalog entries are already deduplicated by item, and an
  over-budget root is dropped on its own; per-member roots inherit that.
- 2026-10-14: one avatar level both shifts the emotion state and selects the
  Reaction intensity; D13 separates them.
- 2026-10-14: today's ladder exists only in the effects content plan, not in
  current guidance; Phase 1 writes the new ladder as current guidance.

## Decision Log

- 2026-10-14, owner: D1–D3 and D5–D8 in the spec (after #559; immediate edits;
  no old-shape compatibility; four per cell; wizard pools; "Restore starter"
  only; equip dialog cell chooser).
- 2026-10-14, owner: D9–D11 (four intensities and their mapping; the ladder as
  guidelines; update existing Reactions and add a second Reaction per cell
  except intensity 1, creating high-quality content with the Animama skills).
  D11 supersedes D4.
- 2026-10-14, owner: D12–D15 (labels Mild/Moderate/Strong/Intense;
  emotion-state scale kept; IDs shift up with `-b` second Reactions; content
  design and drafting start before #559 merges). P4 (starter pools hold all
  Included Reactions of a cell) was approved with the spec as D16.
- 2026-10-14, owner: approved the spec and this plan and authorized all six
  phases; G1–G3 remain owner gates.
- 2026-10-14, agent: Phase 3 step 2 implements D13 by splitting today's
  avatar level into the emotion-state scale and the Reaction intensity.
- 2026-10-14, owner (during Phase 1): create more new Avatar Effects in the
  anime manpu style, without lettering; every new Avatar Effect is a
  flipbook, either a line boil from one key image or a fully generated
  frame-by-frame sheet, never a draw-on. Agent application: the second (B)
  Reactions use no lettering effects (`doki_doki`, `bleh_lettering_head`,
  `sorry_lettering`, `heh_lettering`); entrances use motion keyframes.
- 2026-10-14, owner (during Phase 1): expressions must be noticeable and
  exaggerated; every Reaction's main expression plays at full strength (1.0)
  from intensity 1 and the effects carry the escalation. Today's Reactions
  are scaled up to match. Agent finding behind it: calibration renders on both
  Included Avatars showed today's weights (0.2–0.6) barely change the face,
  and `angry` alone stays faint at any weight, so anger-family faces add
  `blink` to read as a glare.
- 2026-10-14, owner (during Phase 1): the first new Avatar Effect key images
  looked cheap and generic; new Avatar Effects use a more hand-drawn style.
  The style is chosen from a three-way test before the set is regenerated.
- 2026-10-14, owner (during Phase 1): of the three test styles, use manga
  G-pen ink with screentone (Ink) and marker-and-crayon doodle (Marker),
  chosen per effect; record both as house styles in the
  `animama-effect-assets` and `animama-avatar-vfx` skills so future effects
  follow them. Then replace the mushroom, shiver and stink lines, thought
  bubble, interrobang, sweat and flame concepts with new ones: agent
  replacements `wilting_flower`, `petrified_cracks`, `skunk_cloud`,
  `passing_crow`, `ahoge_curl`, `stomach_butterflies`, `guilt_arrow`,
  `shadowed_glare` and `triumph_halo` (16 new Avatar Effects in all).
- 2026-10-14, owner: D19 (after Code Review #1 repair round 1 found
  intensity-1 look-alikes): close intensity-1 pairs add one subtle existing
  Avatar Effect not used at that emotion's other intensities: desire-1
  `blush_band`, excitement-1 `kira_star`, disappointment-1 `gloomy_cloud`,
  annoyance-1 `sigh_puff_droop`. Corrections made after G1 (eight
  intensity-1 faces, five B faces, three overlay attachments and these
  effects) are presented for approval at G2.
- 2026-10-14, owner: G1 approved (ladder table, expressions, briefs and the
  new-effect list as published on the G1 review page, version 2); proceed to
  Phase 2.
- 2026-10-14, agent proposal (for plan review): store each member as its own
  binding row with `slot_key = "reaction:<emotion>-<intensity>:<catalog_item_id>"`,
  mirroring the Idle pool. The unique key prevents duplicates in a cell; the
  service enforces the limit; deletion and pack-removal protection are
  unchanged. One shared helper builds and parses the slot key and replaces the
  four `rpartition` sites, and one shared constant defines the intensities.
- 2026-10-14, agent proposal: drop the implicit Reaction starter and Reaction
  `starter_exclusions`. Every member is an explicit row; "Restore starter"
  replaces a cell's rows with its policy Reactions. A cell reads `starter` when
  its pool equals its policy pool, `empty` with no members, else `custom`.
  Gesture exclusions are unchanged.
- 2026-10-14, agent proposal: Reaction intents become `add`, `remove` (by
  member binding) and `restore_starter` (by cell); `replace`, `update`,
  `reconfigure` and `leave_empty` are removed.
- 2026-10-14, agent proposal: the runtime contract carries one action per
  admitted Reaction plus a cell → member list map, so a Reaction in several
  cells loads once. The frontend chooses the member when the planner first
  accepts an emotion event and keeps that choice on the pending event; the last
  pick per cell lives in planner state.
- 2026-10-14, agent proposal: no ADR. No recorded decision covers Reaction
  cells or intensities; a new Glossary "Reaction" entry, the ladder guidance
  and the affected docs describe the result.

## Gates

| Gate | When            | Owner action                                                                                          | Effect                                                    |
| ---- | --------------- | ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| G1   | End of Phase 1  | Approve the ladder table, the briefs for new and revised Reactions, and the new-effect list with concept stills | Fixes what Phase 2 builds; changes are recorded here      |
| G2   | During Phase 2  | Approve each new or revised Reaction and new effect in the live preview, in batches by emotion family | Only approved items are promoted (R16)                    |
| G3   | Phase 6         | Approve the promotion dry-run list (adds, replacements, renames, deletes)                             | Content enters `content/included/`                        |
| —    | After the PR    | Escalation and variety check in chat                                                                  | Remaining acceptance; merge approval stays separate       |

## Phased implementation

Working directories are relative to the task worktree root. Code phases use
TDD: write the failing test from the spec requirement first, then the smallest
passing change. Delegated test runs are wrapped in `timeout`. Content phases
use the Animama content skills: Reaction clips follow `animama-animation`
conventions (`animaPoseClip/2.0`, authored as `animamaActionProject/1.0`
project files, as the effects content plan did), new art goes through
`animama-effect-assets`, and new effects through `animama-avatar-vfx`,
`animama-particle-vfx` and `animama-scene-vfx`.

### Phase 1: ladder table, briefs and new-effect list (G1)

Requirements: R2, R13–R15 (design). Issue: #564. No code dependency;
starts before #559 merges (D15). Working directory: repository root.

Steps:

1. **Ladder guidance.** Draft the four-step ladder (R2) for current guidance:
   the Reactions section of `content/included/README.md`, the Reaction-use
   guidance in the Avatar, Particle and Scene effect skills, and
   `docs/frontend/runtime/avatar-emotion.md` (mapping). Committed with Phase 6
   so docs match the shipped content.
2. **Ladder table.** One row per emotion and intensity (24 × 4) with the A and
   B Reactions: new ID (D14), source (today's ID, revised or new), expression
   idea, Avatar, Particle and Scene Effects, and any departure from the
   ladder with its reason. Effect timing follows today's convention (Scene at
   0 s; Avatar Effects at 0.1 s, or at the settle beat of a two-beat face;
   Particle Effects at 0.12 s at intensity 3 and 0.1 s at 4; durations from
   each effect) and is tuned per Reaction in Phase 2. Rules:
   - intensity 1: a new full-strength expression (D17), no effects except a
     subtle D19 Avatar Effect where two faces stay alike;
   - intensities 2–4 A: today's Reaction one level up (D14), its expression
     strengthened to full strength (D17) and revised to remove a departure
     without a good reason (the R13 list);
   - intensities 2–4 B: a visibly different expression and at least one
     different effect from A at the same step; prefer existing effects that
     fit, and propose new ones where reuse would look like a copy or borrow
     another emotion's identity (likely most intensity-4 B backgrounds).
3. **Briefs.** One short brief per new effect (purpose, look, motion,
   placement, which Reactions use it) in each skill's brief format, and an
   expression brief per new Reaction. Produce concept stills for new effects
   and a contact sheet of the proposed expressions on both Included Avatars.
4. **Review page.** Publish the table, briefs and stills for G1 as a private
   review artifact; record the owner's answers and any changes here.

Completion: G1 approved. Outputs live in `.animama-drafts/reaction-pools/`;
the approved table is copied into this plan's Phase 1 record (public-safe).

Results (2026-10-14, source `50640701` plus the Phase 1 working tree):

- **Outputs** (ignored drafts in `.animama-drafts/reaction-pools/`):
  `ladder.py` and `expressions.py` generate `ladder.json`, the 168-row
  `ladder.md` table and `ladder-effects.json`; `briefs/avatar.md` (16),
  `briefs/particle.md` (11) and `briefs/scene.md` (8 designs, 23 presets);
  Avatar key art in `.animama-drafts/effects/<stem>-work/`; Particle and
  Scene concept stills in `concepts/`; expression contact sheets in
  `sheets/` from 168 expression-only renders; `ladder-guidance.md`, the step 1
  guidance text that Phase 6 commits.
- **Ladder:** 24 emotions × 4 intensities; 96 A (72 today's moved up, 24 new
  intensity-1) and 72 B. Ten R13 departures are fixed (caring-4 and
  sadness-3 gain an Avatar Effect; amusement-3, confidence-3,
  disapproval-3/4, embarrassment-3, fear-3/4, nervousness-3/4 and remorse-3
  gain a Particle Effect). 50 new effects: 16 Avatar, 11 Particle, 23 Scene
  presets in 8 family designs; disappointment-4-b reuses `awkward-silence`.
- **Expressions:** calibration renders (`calib/calib.jpg`) set the rules in
  `expressions.py`: full strength from intensity 1 (D17), open smiles at
  `happy` 0.75, closed-eye smiles as `happy` 1.0 without blink, winks with low
  `happy`, and a glare blink floor for the anger family.
- **Tracked edits:** house styles (Ink, Marker) with reference images in
  `.agents/skills/animama-effect-assets/` (`references/style/ink.png`,
  `marker.png`), matching rules in `animama-avatar-vfx` (SKILL, brief and
  batch references) and a manpu-sticker note in `animama-scene-vfx`; two
  generated-art records in `licenses/source-review.json`; spec R13, R14 and
  R16 amended with D17 and D18 in #563 (read back 2026-10-15T00:34:13Z).
- **Checks:** `uv run pytest -q scripts/public-release/test_prepare_source.py`
  12 passed; `python3 -m json.tool licenses/source-review.json` valid;
  `git diff --check` clean.
- **G1:** published as a private review page (versions 1 and 2); approved
  by the owner 2026-10-14.

#### Code Review #1 Findings

Round 1 (full, `sdlc-reviewer`, working tree on `50640701` with the drafts):
the ladder counts, IDs, stems, departures, lettering rule, brief usage lines
and region conflicts all checked clean. Findings:

- **P1-R1-F1 (blocking):** `amusement-4-b` rendered identical to
  `amusement-4` (the B laugh lost its closed eyes).
- **P1-R1-F2 (blocking):** `disapproval-4-b` was nearly the same frown as A.
- **P1-R1-F3 (blocking):** spec R13/R14 and step 2 still said "keep its
  expression" and "mild, weaker than intensity 2", against D17.
- **P1-R1-F4:** three face overlays were briefed as whole-part `full_face`
  surface art, which does not map to every VRM.
- **P1-R1-F5:** eight Avatar briefs lacked a Style line; `ahoge_curl` said
  "glossy".
- **P1-R1-F6:** skills still offered draw-on for Avatar Effects and "flat
  colours, no texture" for oversized art.
- **P1-R1-F7:** the style references used the original-work licence basis
  instead of the generated-art basis.
- **P1-R1-F8:** confidence-1 = gratitude-1, admiration-1 ≈ excitement-1,
  grief-1 ≈ sadness-1.
- **P1-R1-F9:** the table has no effect timing.
- **P1-R1-F10:** the plan lacked the style outcome, the tracked edits and the
  step 1 guidance draft.
- Optional: F11 brief style paths, F12 anger-family B faces without blink,
  F13 stale ladder.py weights and intensity-1 idea text, F14 stale P
  references, F15 single-style wording in batch and Scene guidance.

#### Code Review #1 Revisions

All findings accepted and fixed:

- F1: 4B is a two-beat closed-eye laugh (`happy` 1.0, `sad` .26); F2: 4B is a
  half-lidded cold stare (`relaxed` 1, `angry` .69, `blink` .62); both
  re-rendered and visibly distinct.
- F3: R13, R14 and R16 amended with D17/D18 in the spec and #563; step 2
  rules updated.
- F4: the three overlays are floating `face_landmark` emote art.
- F5, F11: Style lines with reasons on all 16 briefs; references point to the
  skill files; "glossy" removed.
- F6, F15: draw-on removed for Avatar Effects in both skills; oversized-art
  advice keeps the house style; batch and Scene wording updated.
- F7: generated-art basis with #564 and the approval date.
- F8, F12: new intensity-1 blends for admiration, confidence, gratitude,
  grief and sadness, and glare blinks for annoyance 1/3B/4B; disapproval-2-b
  became a smirk. Re-rendered; confidence-1 and gratitude-1 remain close
  (both smiles) but differ in eyes and mouth.
- F9: step 2 records the timing convention; Phase 2 tunes it per Reaction.
- F10, F13, F14: this record, the Decision Log entries, `ladder-guidance.md`,
  the ladder.py note and idea text, and D-references replace the gaps.

Repair round 1 recheck (same reviewer): F1–F15 resolved. New findings:

- **P1-R1-F16 (blocking, regression):** anger-1/annoyance-1,
  love-1/optimism-1 and confusion-1/fear-1 rendered alike.
- **P1-R1-F17:** the G1 page predates the corrections.
- Optional: "new" Avatar Effects in the draw-on rule and Particle-only
  draw-on; name the `forehead` landmark; an unwrapped line in `batch.md`.

#### Code Review #2 Revisions

- F16: annoyance-1 is a relaxed half-lidded "ugh", optimism-1 a ^^ smile,
  confusion-1 a one-eyed squint. A grid of all 24 intensity-1 faces still
  showed same-family look-alikes; the owner chose D19, adding one subtle
  existing Avatar Effect to desire-1, excitement-1, disappointment-1 and
  annoyance-1 (each unused at that emotion's other intensities). R2 and R14
  amended in the spec and #563 (read back 2026-10-15T00:41:44Z).
- F17: the corrections are listed in the Decision Log and go to the owner at
  G2.
- Optional notes applied.

Repair round 2 of 2 used. Final recheck (same reviewer): F16 and F17
resolved with D19 counted, optional notes applied, ladder rules and outputs
re-verified (168 rows, byte-identical regeneration). **Result: pass.**
Carried to G2: **P1-R1-F18** — on `A_1_New`, love-1, optimism-1, gratitude-1
and amusement-1 are all closed-eye smiles that differ mainly in the mouth;
the owner checks them live and may add a D19 effect.

### Phase 2: content drafts, renders and benchmarks (G2)

Requirements: R13–R16 (drafts). Issue: #565. Depends on G1. Runs
before #559 merges (D15). Working directories: repository root and
`src/frontend/web`.

Steps:

1. **Task stack.** `git lfs pull`, then `./reset.sh --name reaction-pools
   --base-port <free port>` from the worktree. Drafts in
   `.animama-drafts/reaction-pools/` are the source of truth; Local saves on
   the stack are reproducible from them.
2. **New effects.** Build each approved effect with its skill: art through
   `animama-effect-assets` (`pnpm -s effects:assets` checks), the effect folder,
   `pnpm -s effects check`, review renders on both Included Avatars, then Save
   as Local content on the task stack.
3. **Reactions.** Write a project file per new or revised Reaction (96 new,
   up to 72 revised): expressions and beats per the brief, effect events and
   dependencies per the table, durations from each effect. If the draft tooling
   rejects intensity 4 hints before Phase 3, drafts carry their final hints in
   the table and Phase 6 writes them.
4. **Checks.** `pnpm -s animation validate` and `pnpm -s animation check` on
   every project file; review renders (`animation:render`) on both Included
   Avatars; `pnpm -s effects:bench --reaction` on the heaviest intensity-4
   Reactions of each family (budget 4 ms added frame interval and GPU time on
   the owner's development Mac).
5. **G2.** Present each family's Reactions and new effects in the live preview
   (`pnpm -s animation:preview <file>.project.json`, both Avatars) with their
   renders; revise until approved. Record dated approvals per item.

Completion: every planned item approved in G2, checks pass and benchmarks are
within budget (or the owner decides otherwise).

Results: _pending._

#### Code Review #1 Findings

_Pending (drafts against the approved table, briefs and checks)._

#### Code Review #1 Revisions

_Pending._

### Phase 3: backend pools and four intensities

Requirements: R1, R3, R4, R6 (backend), R9 (API), R10, R11, R12 (backend).
Issue: #566. Depends on #559 merged. Working directory: repository root.

Steps:

0. **Refresh.** Rebase `feat/reaction-pools` onto `origin/main` containing
   #559. Re-read the merged Idle pool storage, plan/commit, runtime projection
   and package capture; update "Current implementation" and any step below
   they change. Record the new baseline.
1. **Tests first.** Add or replace backend tests:
   - emotion update: model intensities 1–2 give Reaction intensity 0 and keep
     today's emotion-state shift; 3–10 map per R1 (D13);
   - loadout: new and starter Animas read 96 starter pools; `add`, `remove`,
     `restore_starter`; duplicate, fifth member, unknown or non-Reaction item,
     invalid cell (including intensity 5) and stale revision rejected without a
     revision change; `starter`/`custom`/`empty` states;
   - deletion of a Local Reaction used only as a pool member is blocked;
   - runtime: every member admitted, a Reaction in several cells projected once
     with all its cells, one missing member skipped with a diagnostic;
   - creation: API creation with multi-member and empty pools across 96 cells
     reads back exactly; more than four or duplicates rejected;
   - packages: complete-Anima export/import round trip of multi-member pools,
     imported Anima not given starter pools.
   Update existing tests that encode one Reaction per cell or three intensities.
2. **Intensity.** Add one shared Reaction-intensity definition (1–4) and use
   it in contracts, placement hints, services and the slot helper. Split
   `voice_intensity_to_avatar_level` into the emotion-state scale (unchanged)
   and the Reaction intensity (R1); `emotion.update` carries the latter. Update
   the mock model client and chat docs.
3. **Persistence.** Keep `kind = 'reaction'`; tighten the slot check to the
   member shape in `orm/content_catalog.py` and `0001_baseline.sql`; update
   `tests/test_content_catalog_schema.py`; add the slot helper in `domain/` and
   use it at every parse site.
4. **Domain and contracts.** `ReactionCell` gains `members` (binding id, item
   id/source, name, origin, availability, config overrides) in place of the
   single source. Replace `PyReactionCell`/`PyReactionIntent`; `ReactionCells`
   and `PortableAnima.reactions` hold a list (max 4, unique) per cell for four
   intensities; `ResolvedReactionSelection` becomes one per member.
5. **Loadout service and routes.** Plan/commit `add`, `remove` and
   `restore_starter` with limit, uniqueness and ownership checks; record
   `loadout_reaction_update`. Remove the Reaction implicit-starter and
   exclusion paths from `read_model`, `initialize`, runtime selection,
   transitions and export; `initialize` writes one row per member. Add error
   codes (for example `reaction_pool_full`, `reaction_member_duplicate`,
   `reaction_member_missing`) and remove retired ones.
6. **Starter policy.** The policy lists a pool per cell for 96 cells. Until
   Phase 6 promotes the new content, intensity 1 starts empty and intensities
   2–4 hold today's Reactions one level up (existing IDs); Phase 6 replaces
   the policy with the final IDs.
7. **Runtime.** One closure root per member row; the projection emits each
   admitted Reaction once with its cells and a cell → runtime-ID map; the
   cell-encoded runtime identity is removed.
8. **Packages and creation sources.** Capture every member row; import
   materialises exactly the package's pools; the creation recommender returns
   the starter pools; budget checks count deduplicated entries.
9. **Contract versions.** Bump `local-http` in `contracts/versions.json` (after
   #559's bump) and update `contracts/hosted-web.md`; update
   `scripts/repository-boundary/consumers/` fixtures that encode Reaction cells.
10. **Docs.** Add a Glossary "Reaction" entry (four intensities, pool per cell,
    random pick, no fallback). Update `docs/backend/runtime/chat.md`,
    `features/typed-content-and-marketplace.md`, `custom-animas-and-content.md`,
    `architecture/data-model.md`, `local-content-storage.md` and `http-api.md`.

Checks (repository root):

```bash
uv sync --python 3.12.13
uv run pytest -q
uv run ruff check
make check-test
git grep -n -E 'rpartition\("-"\)' -- src/backend
```

The final search must show no Reaction slot parsing outside the helper.

Completion: backend tests and `make check-test` pass, OpenAPI exposes the new
contract, and Code Review #1 has no supported blocking finding. The frontend
does not typecheck against the new contract until Phase 4; that is expected.

Recovery: schema edits need a fresh development database for the task stack
(`./reset.sh --name reaction-pools --purge`); re-save Local drafts from
`.animama-drafts/reaction-pools/` afterwards if needed.

Results: _pending._

#### Code Review #1 Findings

_Pending._

#### Code Review #1 Revisions

_Pending._

### Phase 4: runtime selection and `/animas/` pool editing

Requirements: R1 (frontend), R5, R6 (frontend), R7, R12 (frontend). Issue: #567. Depends on Phase 3. Working directory: `src/frontend`.

Steps:

1. **Client.** Regenerate the SDK offline (`pnpm openapi-ts`, `pnpm prettier`,
   `pnpm packages:build`); bump `runtime-contracts`/`product-ui` versions where
   declarations change; update `lib/content/catalogTypes.ts`.
2. **Tests first.** In `AvatarPlanner.test.ts`, `AnimaRuntimeCatalog.test.ts`,
   `runtimeSnapshotAdapter.test.ts` and `avatar-runtime-store.test.ts`: four
   intensities accepted and 0 plays nothing; uniform choice from injected
   rolls; no repeat of the previous pick for a cell with two or more members;
   one pick per pending event; empty pool plays nothing; a shared Reaction
   adapted once.
3. **Runtime.** `EmotionReactionIntensity` becomes 1–4. Adapt the projection to
   per-Reaction runtime IDs plus a pool map; `getReactionRuntimeId` takes the
   cell, a roll and the previous pick; the planner draws the roll when it first
   accepts an emotion event, stores the choice on the event and records the
   last pick per cell. The built-in (`AvatarMotionCatalog`) and preview
   catalogs serve one-member pools; their four-intensity built-in map is
   finalised in Phase 6. Update `AnimationDebugModal`.
4. **Pool editing.** Replace the single-choice rows with the shared pool cell
   from the Idle section (member chips with Starter badge, Preview, Remove; Add
   picker with Local/Included groups, preview, in-cell members marked, Add
   disabled at four with a reason) across four intensity rows with the D12
   labels. The cell menu keeps "Choose from Library" and "Restore starter". Add
   an immediate plan-and-commit Reaction mutation (fresh idempotency key; stale
   revision refetches; failure toasts and leaves the pool) and remove the
   Reaction review dialog. Generalise rather than fork the Idle components;
   Idle keeps three intensity rows.
5. **Compile-level adaptations.** Make the equip dialog add to/remove from the
   suggested cell's pool and the wizard send one-member pools for 96 cells, so
   the app builds; Phase 5 finishes their UI.
6. **Copy and errors.** Update `animas` strings in en, ja, ko, zh-Hans and
   zh-Hant (four labels, pool and limit text, no "Leave empty"),
   `userVisibleCodes.json` and `pnpm i18n:extract`.
7. **Docs.** Update `docs/frontend/features/anima-management.md`,
   `runtime/avatar-planner.md`, `avatar-emotion.md`, `avatar-animation.md`,
   `runtime/content-previews.md` and `architecture/local-content-runtime.md`.

Checks (`src/frontend`, after `git lfs pull` at the repository root):

```bash
pnpm openapi-ts:check
pnpm check
pnpm web:lint
pnpm web:test
pnpm build
pnpm desktop:check
```

Manual (agent): on the task stack at desktop width and 390 × 844, add,
preview, remove and restore members in cells at intensities 1 and 4, hit the
four-member limit, reload, and confirm a stale tab refreshes.

Completion: checks and manual checks pass, and Code Review #1 has no supported
blocking finding.

Results: _pending._

#### Code Review #1 Findings

_Pending._

#### Code Review #1 Revisions

_Pending._

### Phase 5: equip dialog cell chooser and wizard pools

Requirements: R8, R9 (UI), R10 (UI). Issue: #568. Depends on Phase 4.
Working directory: `src/frontend`.

Steps:

1. **Tests first.** Component tests for the equip dialog (default cell from the
   suggestion or Joy/Mild, per-Anima Add/Remove for the chosen cell, full-cell
   reason, other members untouched) and the wizard (starter pools, add/remove,
   limit, duplicates, review counts, submitted lists for 96 cells).
2. **Equip dialog.** Add the emotion and intensity chooser to
   `ActionManageDialog`; `actionManageRowState` reports membership in the
   chosen cell and whether it is full; remove the Reaction "replace" path.
3. **Wizard.** `createAnimaDraft.ts` holds a list per cell seeded from the
   recommended starter pools; `CreateAnimaActionsStep.tsx` uses the shared
   pool cell; `CreateAnimaReviewStep.tsx` counts filled cells and members.
4. **Sharing details.** `SharingPackageDetails.tsx` lists each cell's pool.
5. **Docs.** Update `docs/frontend/features/custom-anima-creation.md`,
   `library.md` and `architecture/data-layer.md`.

Checks: the Phase 4 commands.

Completion: checks pass, the equip dialog and wizard work on the task stack at
desktop and narrow widths, and Code Review #1 has no supported blocking
finding.

Results: _pending._

#### Code Review #1 Findings

_Pending._

#### Code Review #1 Revisions

_Pending._

### Phase 6: promotion, starter pools and journeys (G3)

Requirements: R2, R4, R13–R16 (delivery), R10 (journeys). Issue: #569.
Depends on G2 and Phase 5. Working directories: repository root and
`src/frontend/web`.

Steps:

1. **Promotion list.** One `promote.json`: add each approved new effect;
   rename today's Reactions up one intensity in descending order (4 before 3
   before 2) with their revisions; add the 24 intensity-1 and 72 second
   Reactions with dependencies re-pointed to Included IDs in the same run; set
   placement hints to the final cells. `pnpm -s effects promote promote.json
   --dry-run`; present the list for G3; then run it and `git add` the result.
2. **Starter policy and built-ins.** The starter policy holds the final pools
   (D16). Update the frontend built-in Reaction map (`lib/avatar/poses/catalog.ts`,
   `reactionClips.ts`) to four intensities and the final IDs, and any bundled
   copies, debug shortcuts and generators that name Reaction IDs.
3. **Licences and integrity.** Owner-authored licence rules for new art;
   update `content/included/licenses` and `licenses/source-review.json`; run
   `uv run pytest -q tests/test_included_content_integrity.py
   tests/test_included_content_catalog.py tests/test_starter_content_closure.py
   scripts/public-release/test_prepare_source.py`.
4. **Runtime load.** Confirm the starter Anima's runtime snapshot admits all
   168 Reactions and their effects without budget diagnostics; benchmark the
   heaviest promoted Reactions again.
5. **Journeys and fixtures.** Update `e2e/journeys/playback-anima-loadout`,
   `create-anima`, `accountless-imported-playback`, `helpers/preview-surfaces.ts`,
   `fixtures/animama.ts` and the hosted workflow fixtures
   (`web/scripts/fixtures/hosted-workflows-http.mjs`,
   `hosted-workflows.browser.test.mjs`) for 96 cells and the new IDs. Add a
   journey step that builds a two-member pool, exports and imports the Anima
   and finds the pool intact.
6. **Ladder docs.** Commit the Phase 1 ladder guidance and the final ladder
   table (in this plan).

Checks: Phase 3 and Phase 4 commands, the included-content tests above, and
`pnpm e2e:test` (full suite) against a disposable built stack, torn down
afterwards.

Completion: G3 approved and written; 168 Included Reactions on the approved
table; checks and journeys pass; Code Review #1 has no supported blocking
finding.

Results: _pending._

#### Code Review #1 Findings

_Pending._

#### Code Review #1 Revisions

_Pending._

## Final integration review

Covers R1–R16 across all phases, the package-set compatibility comparison, the
full browser journeys and the promoted content, reusing still-valid phase
evidence.

_Pending._

## Validation and acceptance

Local, before opening the PR:

- Backend: `make check-test`. Tests expected to change include
  `test_anima_loadouts.py`, `test_anima_loadouts_api.py`,
  `test_product_http_loadouts.py`, `test_anima_materializer.py`,
  `test_anima_creation.py`, `test_anima_starters.py`, `test_portable_anima.py`,
  the `test_content_package_*` suites, `test_content_type_handlers.py`,
  `test_removed_effect_dependency.py`, `test_content_consumer_transition.py`
  and the emotion-update tests.
- Frontend: the Phase 4 checks.
- Content: `pnpm -s animation validate` and `check`, `pnpm -s effects check`,
  the included-content tests and recorded benchmarks.
- Contracts: the package-set `build`/`compare` against a `main` baseline
  (`scripts/package-sets/README.md`).
- Browser journeys: `pnpm e2e:test` against a disposable built stack.
- Owner gates: G1, G2 and G3 approvals recorded with dates.

Remaining owner gate: in chat, stronger replies escalate along the ladder and a
cell with several Reactions plays different members across repeated emotion
events. Hosted validation is disabled; the PR records that no hosted CI ran
unless the owner starts a run.

## Idempotence and recovery

Schema edits apply to fresh databases only; reset the task stack with
`--purge` after them. Pool commits are idempotent through the unique slot key
and idempotency receipts. Content drafts in `.animama-drafts/reaction-pools/`
are the source of truth until promotion; Local saves can be recreated from
them. Promotion is planned with `--dry-run` first and changes only
`content/included/` and licence records, which Git can revert. Reverting the
branch restores single cells and three intensities but needs another
development database reset. Tear the task stack down after its last use.

## Outcomes & Retrospective

_Pending._
