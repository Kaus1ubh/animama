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
- [x] Phase 2: content drafts, renders and benchmarks (2026-10-15). Drafts complete (52 effects saved; 168 Reactions checked, reviewed in stills and a reel; the 12 heaviest benchmarked); Code Review #1 pass. G2 moved to before merge (D20) and still pending.
- [x] Dependency: #559 merged (PR #571); branch rebased onto `87dce31b`; baseline refreshed (2026-10-15).
- [x] Phase 3: backend pools and four intensities.
- [x] Phase 4: runtime selection and `/animas/` pool editing.
- [x] Phase 5: equip dialog cell chooser and wizard pools.
- [x] Phase 6: promotion, starter pools and journeys (2026-10-15); Code Review #1 pass after one repair round; full browser journeys 40 passed. G2 and G3 owner review pending before merge.
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
- 2026-10-14: `pnpm -s effects promote` handles a Reaction only as a
  `replace` of an existing Included folder (same stem, same clip id). Phase 6
  needs Reaction adds (96 new) and the one-level ID shift of today's 72, so
  it extends the promote tool (or adds a Reaction promote mode) under test
  before the G3 dry run.
- 2026-10-14 (Phase 2): whole-face painted flipbooks work (the texture
  compositor draws the current frame into the face rectangle);
  `animama-effect-assets` said whole-part art stays a single image, so its
  guidance is corrected with the working recipe. Both Included Avatars are
  VRoid with byte-identical face-skin UV masks.
- 2026-10-14 (Phase 2): on a freshly reset stack every app route redirects
  to first-run `/setup`, so `pnpm -s effects save` fails with "could not
  open the creator" until setup is completed once (test display name; AI and
  voice skipped) including the adult age gate, which the owner approved
  confirming on the task stack.
- 2026-10-14: a Reaction project's dependency on a new effect needs that
  effect saved as Local content first (`ref` is its Local ID), so Phase 2
  builds and saves the effects before generating Reaction project files.

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
- 2026-10-14, owner (Phase 2): drop the new `heartbeat_heart` (too many
  heart effects already); its four B uses become love-4-b `kirakira_cluster`
  + `blush_deep`, desire-3-b `kirakira_cluster` + `blush`, embarrassment-3-b
  `blush` + `startle_ticks`, nervousness-3-b `ticking-fuse` (15 new Avatar
  Effects). Pale Blue Shade and Petrified Cracks become painted face-skin
  textures instead of floating art, and Teary Sparkle Eyes becomes a
  generated multi-frame flipbook instead of a line boil.
- 2026-10-14, agent (Phase 2, within the G1 design intent; shown at G2): a
  `focus_lines` Scene has no background colour or entry flash and nearly
  vanishes on the dark theme, so fear-4-b, nervousness-4-b and
  confusion-4-b each also play a companion backdrop Scene
  (`scene-b-<emotion>-backdrop`: gradient plus entry flash). Rejected: a
  `background_layers` approximation with at most 48 ray wedges (weaker focus
  lines) and adding backdrop fields to `focus_lines` (schema and creator
  changes).
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
- 2026-10-14, owner (while #559 is pending): cherry-pick the
  `feat/action-reel` commits (the `animation:reel` video recorder; 3f83e05f,
  207fbd96, ed276caf as 0f82e122, 490afe9f, 6a458d1f) into this branch,
  label reel Reactions with their ladder intensity (34d62a67), and record a
  reel of all 168 drafts for G2. The cherry-pick conflicted with main's
  per-use Avatar Effect overrides; the resolution keeps both the override
  parse and the sound cue in `effectSource.ts` and moves main's late
  `media.getProblems()` warning read into `effect-render/session.ts`. The
  owner then chose to ship the reel from this branch: #554 and its branch
  close unmerged, and this plan's PR also closes the reel issue #553 (its
  local-only effect-reels commit ed276caf travels here as 6a458d1f).
- 2026-10-14, owner: proceed with Phases 3–6 once #559 merges without
  waiting for the G2 review; ladder edits will follow. Recorded as D20, with
  R16 and its acceptance amended in #563 (2026-10-15T03:47:45Z): G2 moves to
  before merge. Phase 6 promotes the current drafts on this branch only;
  later edits change the drafts and are promoted again. Until G2 approval the
  PR does not merge, so `main` receives only approved content. Phase 2's code
  review and commit proceed now.
- 2026-10-14, agent proposal; the owner did not keep the hard stop: G3 is
  reviewed with G2 before merge. Phase 6 records each promotion dry-run list
  here (the first run and every re-promotion after ladder edits) and runs it
  on the branch; the owner approves the final list with G2. The proposal was
  put to the owner with the option to keep G3 a hard stop; the owner then
  asked for the rest of the plan to be implemented without check-ins. This
  is a plan gate change; the spec (R16, D20) already requires approval
  before merge.
- 2026-10-15, agent (Phase 3 step 0, after #559 merged as #571 into
  `87dce31b`): implementation details adjusted to how the Idle pool landed.
  Reaction members mirror Idle members: one row per member with slot
  `reaction:<emotion>-<intensity>:<catalog_item_id>`, the row's
  `catalog_item_id` authoritative, unavailable members visible and removable,
  and removing an unknown binding is `unchanged` (no `reaction_member_missing`
  code). Reaction binding config is dropped from intents, members, creation and
  packages (packages already reject non-empty Reaction config and no UI sends
  one), which lets one runtime root serve every cell of a Reaction. One shared
  cell parser replaces the Reaction and Idle `rpartition("-")` sites. The
  starter policy stays a flat `reactions` list with one entry per member.
  Packages carry all 96 cells as entry-id lists (empty allowed). `local-http`
  goes from 8.0.0 to 9.0.0. Reaction placement hints accept intensity 4 in
  Phase 3 because the interim starter policy puts today's Reactions at 2–4.
  The chat SSE goldens are re-recorded (model intensity 2 now plays no
  Reaction). Risk carried to Phase 6: the full starter creation closure may
  approach the 500-entry runtime and creation limits.
- 2026-10-15, agent (Phase 6): promoted stems and IDs. Avatar and Particle
  Effects keep their draft stems; the B Scene designs become
  `scene-vfx-emotion-<emotion>-b` and the Alarm backdrops
  `scene-vfx-emotion-<emotion>-b-backdrop`, following the Included emotion
  Scenes. New Avatar Effects are promoted silent (`"sound": null`), as the
  drafts were reviewed; sound choices can follow G2. Existing Reaction IDs
  1–3 are replaced in place (the ID shift keeps each ID in its cell, so the
  meta name and hint stay correct) and 96 Reactions are added.
- 2026-10-15, agent (Phase 6): where a Reaction applies Avatar Effects
  within 0.3 s, only one plays its sound (audible effects kept first; the
  Included-content rule), and every Mild Reaction's Avatar Effect is silent
  (owner rule of 2026-10-12); the promotion builder applies both, so
  re-promotions keep them. After an effect's sound changes, promote it, then
  rebuild and re-promote the Reactions.
- 2026-10-15, agent (Phase 6 review): the new effects and Reactions are
  recorded as agent-authored under the owner's direction (#569), following
  the #523 precedent, with redistribution review and G2 pending.
- 2026-10-15, agent (Phase 6): starter Reactions reuse some Library Avatar
  Effects (for example `broken-heart`, `burning-resolve-eyes`), as the
  G1-approved ladder names them. The companion-content rule that starters
  do not use Library items narrows to "Library items are never starter
  roots"; Library items still ship in desktop core.
- 2026-10-15, agent (Phase 6): `MAX_RUNTIME_ENTRIES` 500 → 1000. A starter
  Anima now holds 445 runtime entries without the optional comedy sound
  pack (about 495 with it), leaving no headroom under 500; bytes stay at
  54 MB of 512 MiB. The limit is defined once in
  `domain/runtime_content_descriptor.py` and bounds the admitted-item map,
  the runtime budget and the creation source-revision map (review F1, F3).

## Gates

| Gate | When            | Owner action                                                                                          | Effect                                                    |
| ---- | --------------- | ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| G1   | End of Phase 1  | Approve the ladder table, the briefs for new and revised Reactions, and the new-effect list with concept stills | Fixes what Phase 2 builds; changes are recorded here      |
| G2   | Before merge (D20; was Phase 2) | Approve each new or revised Reaction and new effect in the live preview or reel, in batches by emotion family | Only approved items merge into `main`'s `content/included/` (R16); edits are promoted again first |
| G3   | Before merge, with G2 | Approve the final promotion dry-run list (adds, replacements, renames, deletes) recorded in Phase 6 | The promoted `content/included/` changes may merge |
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
  intensity-1) and 72 B. R13 departures are fixed in 12 cells (caring-4 and
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

Results (2026-10-15; G2 pending before merge):

- **Stack:** named task stack `animama-reaction-pools` (base port 8800,
  development mode; application only published).
- **Effects built** in `.animama-drafts/effects/` by parallel agents (one
  per Avatar Effect, grouped Particle batches, one per Scene family), each
  with its brief, `effects check`, render sheets and recorded departures:
  15 Avatar Effects (Ink: menace_aura, guilt_arrow, startle_ticks,
  skunk_cloud, pale_blue_shade, shadowed_glare, petrified_cracks,
  wilting_flower, passing_crow; Marker: kirakira_cluster,
  teary_sparkle_eyes, happy_flowers, ahoge_curl, stomach_butterflies,
  triumph_halo), all flipbooks (boil or drawn frame by frame), no lettering;
  11 Particle Effects (14–40 particles each); 23 Scene presets in 8
  designs plus 3 Alarm backdrops.
- **Checks:** a fresh `pnpm -s effects check` on all 52 folders passes; the
  only WARNs are `interior_translucency` on art that is see-through by
  design (glows, glints, tints, bubbles, beams).
- **Consistency:** a first-frame board of the 15 Avatar Effects on dark and
  light backdrops shows each house style consistent in line weight, rim and
  fill.
- **Incident:** one Scene agent's cleanup glob deleted other designs'
  `renders/scene-b-*.png` sheets at about 21:55; only render sheets were
  lost (effect folders, art and briefs intact). Gloom, Revulsion and
  Rejection designs were re-rendered; for the Affection, Esteem, Delight,
  Drive and Alarm B presets and backdrops, the 4B Reaction sheets
  (`g2/sheets/<emotion>-4-b.png`, both Avatars) serve as their review renders.
  Later agents were told to delete only inside their own folders.
- **Bench:** `effects:bench` measures Particle Effects only through a saved
  Reaction, so particle benchmarks run after the Reaction drafts exist.
  `pnpm -s effects:bench --reaction` (2026-10-14, task stack, Local content,
  headless Metal on the owner's development Mac) ran on the heaviest
  intensity-4 drafts of every family, chosen by most concurrent effects,
  painted face flipbooks and two Particle Effects: excitement-4,
  excitement-4-b and joy-4-b (Delight); grief-4 (Gloom); confidence-4-b
  (Esteem); anger-4 and anger-4-b (Rejection); fear-4-b (Alarm); love-4-b
  (Affection); optimism-4-b and desire-4 (Drive); disgust-4-b (Revulsion,
  the only Reaction with two painted face flipbooks). All stay well within
  the 4 ms budget. Added mean frame / CPU / GPU in ms, the maximum of the two
  Included Avatars per metric (≈0 where the difference is within noise):
  fear-4-b 1.47 / 0.44 / 0.45; grief-4 1.36 / 0.86 / 0.95; excitement-4
  1.32 / 0.37 / 0.28; confidence-4-b 1.00 / 0.36 / 0.02; disgust-4-b
  0.96 / 0.37 / 0.70; anger-4-b 0.95 / 0.36 / ≈0; anger-4 0.80 / 0.32 /
  0.06; love-4-b 0.80 / 0.15 / ≈0; joy-4-b 0.71 / 0.63 / ≈0;
  excitement-4-b 0.70 / 0.27 / 0.71; desire-4 0.70 / 0.23 / ≈0;
  optimism-4-b 0.65 / 0.37 / ≈0. Results are in
  `.animama-drafts/reaction-pools/bench/`.
- **Review:** the G2 page shows all 168 drafts on both Included Avatars (148
  `effects:render` sheets; the 20 effect-free intensity-1 Reactions use their
  Phase 1 expression renders, since `effects:render` needs an effect;
  `g2_images.mjs` then `build_g2.py` rebuild it), and the live preview lists
  all 168 projects. All 168 clips pass `animation check` (FAIL=0, WARN=0) and
  all 52 effects pass `effects check`.
- **Timing:** the drafts apply the Phase 1 timing convention uniformly; no
  per-Reaction tuning was needed in the stills or reel, so tuning happens
  where the owner's G2 notes ask for it.
- **Reel:** `pnpm -s animation:reel` recorded all 168 drafts on Annie in
  ladder order with their effects and sounds
  (`.animama-drafts/reaction-pools/reel/reaction-ladder-annie.mp4`, ignored;
  14:25, a chapter per Reaction, 79 sounds including the override heartbeats
  of caring-3, gratitude-3 and gratitude-4, no failures or warnings; recorded
  again after F1). Soul Wisp, faint in the fear-4-b stills, is clearly
  visible in motion. Editing web sources during a recording reloads the reel
  page and stops the run (`closeReelItem is not a function`).

#### Code Review #1 Findings

Independent reviewer, initial full review (2026-10-14; source `34d62a67`
plus the working tree; baseline `bba36192`). **Result: fail** on four
should-fix findings. Checked clean: the drafts regenerate byte-identically
from `ladder.py` and `make_projects.py`; all 168 projects are structurally
sound (references, aliases, hints, A/B differences, ladder steps, D17 and D19
rules, no `heartbeat_heart`); the evidence files match the plan; the
cherry-pick resolution keeps main's override parse and moved warning read;
the reel intensity labels match R1/D12.

- P2-R0-F1 (should-fix): the review tools dropped the sound an Avatar
  Effect event's override picks (`soundAlias`), so the reel left caring-3,
  gratitude-3 and gratitude-4 silent where chat plays the heartbeat, and
  labelled each effect with its default sound even when muted.
- P2-R0-F2 (should-fix): deferring G2 left R16, its acceptance item, the
  Gates table, Phase 6's dependency and the G3 handling inconsistent.
- P2-R0-F3 (should-fix): benchmarks covered six of eight families, missed
  disgust-4-b (two painted face flipbooks), gave no selection basis and
  reported one Avatar's numbers.
- P2-R0-F4 (should-fix): the Pale Blue Shade, Petrified Cracks and Teary
  Sparkle Eyes briefs still described the rejected floating and boil
  versions.
- Optional: render coverage after the incident, the overstated Progress line,
  the timing-tuning claim, the missing G2 image script, skill clarifications,
  the duplicated intensity labels in the reel and its browser test in Phase 6,
  the Phase 1 departure count, stray preview review files.

#### Code Review #1 Revisions

Repair round 1:

- F1: fixed. Effect sources carry every declared `sound_effect` by alias
  (`effect-render-sources.mjs`, `pageEffect`), `effectSourceEntry` resolves
  an override's `soundAlias` through them as chat does, and the reel labels
  and mixes each event's actual sound (none when muted). Tests:
  `previewMedia.test.ts` (override picks a declared sound; an undeclared one
  plays nothing) and `animation-reel.test.mjs` (override and muted labels).
  The reel was recorded again.
- F2: fixed. D20 added and R16 and its acceptance amended in #563
  (2026-10-15T03:47:45Z) and the spec snapshot; the Decision Log, Gates,
  Progress and Phase 6 dependency and completion follow D20; G3 is reviewed
  with G2 before merge, with each promotion list recorded (agent proposal sent
  to the owner).
- F3: fixed. Benchmarked disgust-4-b, optimism-4-b, desire-4 and anger-4;
  the Bench result states the selection basis and the per-metric maximum of
  both Avatars for all 12.
- F4: fixed. The three briefs describe the built painted UV flipbooks and the
  frame-by-frame tears.
- Optional notes applied: render coverage stated, Progress line corrected,
  timing note added, `g2_images.mjs` restored from the earlier command and
  `build_g2.py` points to it, skill paragraph clarified, Phase 6 step 2 lists
  the reel browser test and the shared labels, departure count corrected.
  The `joy-4-b.project.review` files belong to the running live preview and
  stay.

Repair round 1 recheck (same reviewer): F1, F3 and F4 resolved; F2 resolved
except **P2-R1-F5** (should-fix): the G3 change rested on an unaccepted agent
proposal and was attributed to D20. Non-blocking: the reel line still
described the first recording; sound alias lookups should use own
properties, as chat does. **Result: fail.**

Repair round 2:

- F5: the owner was shown the proposal with the option to keep G3 a hard
  stop and then asked for the rest of the plan to be implemented without
  check-ins; the Decision Log records that dated acceptance, and the Phase 6
  header and completion attribute G3 to it instead of D20.
- Sound alias lookups in `effectSource.ts` and `animation-reel.mjs` use
  `Object.hasOwn`. Reel, preview and VFX tests, `tsc -b` and eslint pass.
- The reel was recorded again with the fixes (see the Reel result).

Repair round 2 recheck (same reviewer): F5 and both non-blocking items
resolved; no new problems. **Result: pass** (2 of 2 repair rounds used).

### Phase 3: backend pools and four intensities

Requirements: R1, R3, R4, R6 (backend), R9 (API), R10, R11, R12 (backend).
Issue: #566. Depends on #559 merged. Working directory: repository root.

Step 0 result (2026-10-15): `feat/reaction-pools` rebased cleanly onto
`87dce31b` (#571, the only change since `50640701`); new baseline `87dce31b`.
#571 changed no Reaction behaviour. It stores Idle members as
`idle:<cell>:<item_id>` rows (`domain/anima_loadout.py` `idle_cell_key`,
`idle_slot_key`, `parse_idle_slot_key`), plans `add`/`remove` through
`PyIdleIntent`, projects one runtime root per Idle Gesture with its cells in
the root context (`anima_runtime_service.py`, `typed_runtime_projection.py`),
carries a sparse `PortableIdlePool`, seeds Idle at creation from
`starter-idle-pool.v1.json`, bumps `local-http` to 8.0.0 and keeps its pool UI
private to `IdleLoadoutSection.tsx`. The `rpartition("-")` sites are now
`anima_package_source_service.py` (Idle and Reaction),
`content_kind_registry.py` (Reaction) and `typed_runtime_projection.py`
(Idle); the earlier list in "Current implementation" is stale. Decisions
taken from this refresh are in the Decision Log (2026-10-15).

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

Results (2026-10-15, on `dcb07b03`):

- **Implemented** as the steps say, with the 2026-10-15 Decision Log details:
  shared `REACTION_INTENSITIES`/`IDLE_INTENSITIES`/`REACTION_POOL_LIMIT` and
  cell/slot helpers in `domain/anima_loadout.py` (no `rpartition("-")` left in
  `src/backend`); `voice_intensity_to_reaction_intensity` beside the unchanged
  state-shift scale; member-shape slot CHECK
  (`reaction:%-_:_%`) in the ORM and `0001_baseline.sql`; `PyReactionIntent`
  `add`/`remove`/`restore_starter`, `PyReactionMember` (with `origin`) and
  member lists per cell; `_plan` returns a `_PlannedChange` so a restore
  carries several rows, its digest covers the restored members' revisions,
  an unavailable starter is skipped with the plan warning
  `starter_reaction_unavailable`, and a restore that changes rows plans
  `revert`; no implicit Reaction starters or Reaction exclusions anywhere;
  one runtime root per distinct Reaction with `PyAnimaRuntime.reaction_cells`;
  96-cell entry-id pools in packages and `ItemRevisionRef` lists in creation
  (diagnostics at `/reactions/<emotion>/<level>/<index>`); interim starter
  policy (intensity 1 empty, today's IDs one level up); `local-http` 9.0.0;
  Glossary "Reaction" entry and backend docs. New error codes
  `reaction_member_duplicate` and `reaction_pool_full`;
  `reaction_matrix_incomplete` retired. The mock model client needed no
  change: it sends neutral at intensity 1, which plays no Reaction before and
  after. Chat SSE goldens re-recorded: only `emotional_intensity` 1 → 0.
- **Checks:** `uv run pytest -q` 4541 passed, 29 skipped; `uv run ruff
  check`, `ruff format --check` and `make check-test` (audit, lint, mypy,
  tests) pass; the `rpartition` search is empty; Python import boundary 0
  forbidden edges; hosted-app consumer tests 4 pass. After the review
  repairs: `make check-test` exit 0 (4542 passed, 29 skipped; mypy clean).

#### Code Review #1 Findings

Independent reviewer, initial full review (2026-10-15; working tree on
`dcb07b03`). **Result: pass**; optional findings only:

- P3-R0-F1: an add could rewrite another member whose row sits at the new
  member's slot under a different catalog id (only the test-only
  `replace_content` creates such rows; Idle shares the pattern).
- P3-R0-F2: the `starter_reaction_unavailable` restore path was untested.
- P3-R0-F3: the read model counts a starter that restore would skip (an
  Included starter with a retired dependency, or a duplicated logical key),
  so such a cell reads `custom` after a restore.
- P3-R0-F4: legacy cell-shaped Reaction rows in an unreset development
  database are skipped silently.
- P3-R0-F5: plan step 2's mock-client update was not recorded.
- P3-R0-F6: a weak runtime-warning assertion and no test of the creation
  diagnostic path.
- P3-R0-F7: `PortableAnima.reactions` repeated the intensity-key literal.

#### Code Review #1 Revisions

- F1: applied. An add whose slot an existing row already holds is
  `reaction_member_duplicate`.
- F2: applied. `test_restore_skips_an_unavailable_starter_with_a_warning`.
- F3: accepted residual. Both cases need broken Included content (a retired
  dependency kind or two Included items with one logical key), which the
  included-content integrity tests already reject.
- F4: accepted. Development databases are reset after schema changes
  (Recovery); the CHECK refuses the old shape.
- F5: recorded in the Results above.
- F6: applied. The runtime test asserts `catalog_root_unavailable`, and the
  creation test asserts the `/reactions/joy/4/1` diagnostic path.
- F7: applied. `PortableAnima.reactions` uses `ReactionIntensityKey`.

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

Results (2026-10-15, on `799bea09`):

- **Implemented:** shared `lib/avatar/reactionPools.ts`
  (`REACTION_INTENSITIES`, `REACTION_POOL_LIMIT`, `pickReactionPoolMember`);
  the snapshot adapter gives each Reaction one runtime id (`reaction:<item_id>`)
  and turns `reaction_cells` into cell → runtime-id pools, dropping members
  that did not mount; `getReactionRuntimeId` takes the cell, a roll and the
  previous pick in the Anima, built-in and preview catalogs; the planner
  draws the roll when it first accepts an event, keeps the pick on the event
  and avoids repeating the cell's last played member. A generic pool row,
  chip, picker and emotion row (`ui/animas/LoadoutPool.tsx`) are extracted
  from the Idle section and used by Idle (unchanged behaviour) and the
  rewritten Reaction section (four rows, Starter badge, Preview, Remove,
  Add picker, full-cell reason, Restore starter, Choose from Library);
  `changeReaction` plans and commits at once (shared `planThenCommit` with
  Idle) and the Reaction review dialog is gone. Equip dialog and wizard
  adapted at compile level (wizard draft schema v4 with 96 pools; older
  drafts move each cell up one level). SDK regenerated; `runtime-contracts`
  0.9.0 (`product-ui` unchanged: its declarations did not change); copy in
  five locales; new error codes; frontend docs.
- **Checks:** `pnpm openapi-ts:check`, `pnpm check`, `pnpm web:lint`,
  `pnpm build`, `pnpm desktop:check` pass; `pnpm web:test` passes (vitest 527
  files, 4947 passed, 1 skipped; node suites 108, 4, 13, 115 pass).
- **Browser (task stack, purged and set up on the new schema; headless
  Chromium, 1440 × 900 and 390 × 844):** four labelled rows with starter
  members; adding three Reactions fills a cell to four, Add is then disabled
  with "This cell holds four Reactions, the most it can. Remove one to add
  another."; remove, Restore starter and an intensity-1 add work and survive
  a reload; a stale tab's add is refused with "This Anima's Reactions changed
  elsewhere and have been refreshed. Try again." and shows the current pools.
  At 390 px the shared pool row squeezed member names to nothing (also true
  of Idle on `main`); the row now wraps its controls below the members.

#### Code Review #1 Findings

Independent reviewer, initial full review (2026-10-15; working tree on
`799bea09`). **Result: pass** with should-fix findings:

- P4-R0-F1 (should-fix): the planner recorded the last *picked* member, so a
  pick dropped before playing could cause a repeat; R5 says played.
- P4-R0-F2 (should-fix): the animation debug panel dropped live Reaction ids
  (`reaction:<item_id>`), so its Reaction list was empty on Anima routes.
- P4-R0-F3 (should-fix): the loadout browser-journey helper matched the old
  emotion button name, and `create-anima.spec.ts` asserts the old wizard
  shape.
- P4-R0-F4 (optional): a planner doc sentence on roll consumption.
- P4-R0-F5 (optional): Restore starter does nothing on a cell whose starter
  pool is empty (all intensity-1 cells until Phase 6).
- P4-R0-F6 (optional): the chip Starter badge marks the cell's own starter
  members, while the picker marks every Included Reaction.
- P4-R0-F7 (optional): four rolls per frame, now shared with Reaction picks,
  fall back to 0 when exhausted.
- P4-R0-F8 (optional): planner tests used identical rolls; a mutation test
  depended on declaration order.

#### Code Review #1 Revisions

Repair round 1:

- F1: fixed. The planner records each cell's last played member
  (`lastPlayedReactions`) when it emits `playReactionClip`; a dropped pick
  does not count (new planner test).
- F2: fixed. Motion catalogs expose `listReactionPools()`; the debug panel
  lists each Reaction under every cell whose pool holds it
  (`ui/debug/reactionClipCatalog.ts`, tested), and unpooled ids under All.
- F3: the emotion-row locator in `e2e/helpers/preview-surfaces.ts` and
  `accountless-imported-playback.spec.ts` uses the row's `aria-controls`;
  `create-anima.spec.ts` moves to Phase 5, which rebuilds the wizard UI.
- F4: doc sentence corrected.
- F5, F6: accepted as they are: Phase 6 gives every cell starter Reactions,
  and a chip's Starter badge keeps meaning "one of this cell's starters" as
  the single-cell grid did.
- F7: fixed. Without injected rolls every draw is `Math.random()`; injected
  rolls stay deterministic; the canvas no longer passes a fixed four-roll
  array.
- F8: fixed. A distinct-roll planner test shows motion draws first and is
  unchanged; the Reaction mutation test selects `changeReaction` by name.
- Coordinator change after the browser check: the shared pool row wraps at
  narrow widths (see Results).
- Checks after the repairs: targeted vitest 46 files / 311 tests; `pnpm
  check`, `pnpm web:lint`, `pnpm prettier:check`, `pnpm e2e:check:source`
  exit 0; `pnpm web:test` exit 0 (vitest 528 files, 4953 passed, 1 skipped;
  node suites pass).

Repair round 1 recheck (same reviewer): F1–F4, F7 and F8 resolved, F5 and F6
accepted, the layout change has no regressions. **Result: pass** (1 of 2
repair rounds used).

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
5. **Journey source.** Update `e2e/journeys/create-anima.spec.ts` for four
   rows, 96 cells and pool lists (deferred from Phase 4, P4-R0-F3) so
   `pnpm e2e:check:source` passes; Phase 6 runs the journeys.
6. **Docs.** Update `docs/frontend/features/custom-anima-creation.md`,
   `library.md` and `architecture/data-layer.md`.

Checks: the Phase 4 commands.

Completion: checks pass, the equip dialog and wizard work on the task stack at
desktop and narrow widths, and Code Review #1 has no supported blocking
finding.

Results (2026-10-15, on `5d125903`):

- **Implemented:** the equip dialog chooses an emotion and intensity
  (starting at the Reaction's suggestion, else Joy · Mild; an unusable
  intensity starts at that emotion's Mild) and adds or removes the Reaction
  in that cell per Anima through `changeReaction`, with the full-cell reason;
  the Reaction replace path is gone. The wizard's Reactions tab uses a shared
  `ReactionPoolCellRow` (also used by `/animas/`) across four rows per
  emotion, seeded from the recommended pools with Starter badges, refusing
  duplicates and a fifth member, with Revert when a cell differs from its
  recommended pool; Review counts cells and members; sharing details list
  each cell's pool. `create-anima.spec.ts` source updated. Library cards now
  read a listed Reaction's suggestion from its `emotion`/`intensity` fields
  (they read only `metadata.placement_hint`, which the Reaction list does not
  carry, so every card lacked its suggestion and the equip dialog opened at
  Joy · Mild; also true on `main`).
- **Checks:** `pnpm check`, `pnpm web:lint`, `pnpm build`, `pnpm
  desktop:check`, `pnpm e2e:check:source`, `pnpm prettier:check` pass; `pnpm
  web:test` passes (vitest 531 files, 4973 passed, 1 skipped; node suites
  pass).
- **Browser (task stack, headless, 1440 × 900):** Library → Joy Reaction 2 →
  Add / Manage opens "Equip Joy Reaction 2" at Joy · Moderate (after the
  suggestion fix); Add on Caitlyn's row puts it in that cell ("In this
  cell"), Remove takes it out, other members stay. The wizard's avatar step
  does not finish in an ad-hoc headless script (no "Preview ready"), so the
  wizard is checked by component tests here and by the `create-anima`
  browser journey in Phase 6.

#### Code Review #1 Findings

Independent reviewer, initial full review (2026-10-15; working tree on
`5d125903`). **Result: pass** with one should-fix finding:

- P5-R0-F1 (should-fix): sharing details joined pool names with the CLDR
  "unit" list pattern, which runs zh-Hans names together and separates
  ja/ko/zh-Hant names only by a space.
- P5-R0-F2 (optional): while creation options load or fail, every non-empty
  wizard cell offers Revert, which empties it.
- P5-R0-F3 (optional): four doc sentences imprecise or stale (Revert order,
  the Mild fallback, Save & Equip's former review flow).
- P5-R0-F4 (optional): pin the journey's "recommended cells" count to 96 once
  every cell has starters.
- P5-R0-F5 (optional): equip dialog row buttons are named only Add/Remove.
- P5-R0-F6 (optional): no test of switching cells while a change is pending
  or of plan warnings as toasts.

#### Code Review #1 Revisions

Repair round 1:

- F1: fixed. Each pool is an ordered list with one item per member, so no
  locale list pattern joins names; a zh-Hans test checks separate members.
- F2: fixed. Revert shows only once the recommended pools are known (new
  test).
- F3: fixed in `custom-anima-creation.md`, `library.md`,
  `runtime/avatar-animation.md` and `runtime/content-previews.md`.
- F4: moves to Phase 6 (step 5).
- F5: fixed. Reaction row buttons are named with the Anima and cell ("Add to
  Annie's Joy · Moderate") in five locales.
- F6: fixed. Tests for plan warnings as toasts and a pending row across a
  cell switch.
- Checks after the repairs: targeted vitest 50 files / 320 tests; `pnpm
  check`, `pnpm web:lint`, `pnpm prettier:check`, `pnpm e2e:check:source`
  exit 0; `pnpm web:test` exit 0 (vitest 531 files, 4978 passed, 1 skipped;
  node suites pass).

Repair round 1 recheck (same reviewer): F1–F3, F5 and F6 resolved, F4
deferred, the Library suggestion fix confirmed. New **P5-R1-F1**
(should-fix): with suggestions now read, Library Reaction rows showed
"Joy Level 2" instead of the D12 labels. **Result: pass** with that
should-fix.

Repair round 2:

- P5-R1-F1: fixed. The Reaction label helpers moved to
  `lib/loadout/reactionLabels.ts` (re-exported from `ActionLoadoutRows`), and
  Library rows show the suggested cell as "Joy · Moderate"; the unused
  `row.emotionLevel` string is removed from five locales; a presentation test
  checks the row text; browser-checked on the task stack.

Repair round 2 recheck (same reviewer): P5-R1-F1 resolved, no regressions.
**Result: pass** (2 of 2 repair rounds used). The equip dialog was also
checked at 390 × 844 (chooser, rows and Add/Remove fit and work); the
wizard's browser check is the `create-anima` journey in Phase 6.

### Phase 6: promotion, starter pools and journeys

Requirements: R2, R4, R13–R16 (delivery), R10 (journeys). Issue: #569.
Depends on Phase 5; G2 (D20) and G3 (owner, 2026-10-14) are reviewed
before merge. Working directories: repository root and `src/frontend/web`.

Steps:

1. **Promotion list.** One `promote.json`: add each approved new effect;
   rename today's Reactions up one intensity in descending order (4 before 3
   before 2) with their revisions; add the 24 intensity-1 and 72 second
   Reactions with dependencies re-pointed to Included IDs in the same run; set
   placement hints to the final cells. Extend `effects promote` first: today
   it only replaces Reactions, so it needs Reaction adds and the ID shift.
   `pnpm -s effects promote promote.json --dry-run`; record the list here for
   G3; then run it and `git add` the result. After ladder edits, change the
   drafts and repeat this step, recording each new list.
2. **Starter policy and built-ins.** The starter policy holds the final pools
   (D16). Update the frontend built-in Reaction map (`lib/avatar/poses/catalog.ts`,
   `reactionClips.ts`) to four intensities and the final IDs, and any bundled
   copies, debug shortcuts and generators that name Reaction IDs. Update
   `web/scripts/animation-reel.browser.test.mjs`, which names
   `library:reaction/amusement-3` and its label, and make the reel's
   `REACTION_INTENSITIES` use the shared Reaction-intensity labels from Phase 4
   if they exist by then.
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
   and finds the pool intact. Pin `create-anima.spec.ts`'s "recommended
   cells" count to 96 (P5-R0-F4).
6. **Ladder docs.** Commit the Phase 1 ladder guidance and the final ladder
   table (in this plan).

Checks: Phase 3 and Phase 4 commands, the included-content tests above, and
`pnpm e2e:test` (full suite) against a disposable built stack, torn down
afterwards.

Completion: the promotion is written on the branch with its dry-run list
recorded; 168 Included Reactions on the current table; checks and journeys
pass; Code Review #1 has no supported blocking finding. G2 and G3 approval of
the final content and list is still required before merge.

Results (2026-10-15, on `8cf5cd0d`):

- **Promotion list (G3, for review before merge):** `effects promote` with
  `.animama-drafts/reaction-pools/promote/promote.json` (built by
  `build_promote.py`; dry run then run): 482 changes — 338 created and 144
  updated. Adds 15 Avatar Effects (stems as drafted), 11 Particle Effects
  and 26 Scene Effects (`scene-vfx-emotion-<emotion>-b`, plus three
  `-b-backdrop` Alarm backdrops); replaces the 72 Reactions `<emotion>-1..3`
  with their ladder content in place; adds 96 Reactions (`<emotion>-4` and
  `<emotion>-2..4-b`); updates `content/included/licenses/inventory.json`
  and `licenses/source-review.json`. A second run re-promoted the 168
  Reactions (67 changes) with stacked effect sounds muted. Repair runs (see
  Revisions) rewrote the licence records in the agent-authored form and
  muted every Mild Reaction's sound (48 Reaction clips, inventory and
  source review; a final dry run reports 0 changes). No deletes.
- **Starter policy:** 168 entries in 96 cells (24 one-member at intensity 1,
  72 two-member at 2–4); `build_policy.py` writes it from the ladder and the
  promoted metas.
- **Built-ins and fixtures:** the built-in catalog serves the 168 Included
  Reactions as the starter pools (`reactionPools.ts`
  `parseIncludedReactionId`/`groupIncludedReactionPools`,
  `poses/catalog.ts`); pinned counts and ladder-by-kind tests updated;
  journeys moved to intensity-4 ids; `create-anima.spec.ts` pins 96 cells;
  the `@complete-anima` sharing journey checks the imported Anima's
  two-member starter pool and a pool member added through the Loadout (see
  Browser journeys); two package
  ledger bugs fixed (Reaction cells as entry-id lists; pool order in the
  definition hash) and ledger appends validate only new lines (two
  480-entry imports now take 342 s instead of timing out); an edited
  imported Anima records its revision so cleanup can delete it.
- **Templates:** 15 Effects-picker templates with Annie thumbnails (checked)
  and their source-review records.
- **Runtime load:** on the purged task stack both starters admit all 168
  Reactions in 96 cells with no warnings; 445 runtime entries (comedy sound
  pack absent), 54 MB; `MAX_RUNTIME_ENTRIES` raised to 1000 (Decision Log).
  Promoted benchmarks (max of both Avatars, frame / CPU / GPU ms): fear-4-b
  1.37 / 0.48 / 0.28; grief-4 0.88 / 0.66 / 0.48; disgust-4-b 0.71 / 0.27 /
  0.54; excitement-4 0.73 / 0.29 / 0.22.
- **Docs:** the ladder in `content/included/README.md` (counts 111 / 168 /
  85), the effect brief templates, starter counts in two frontend docs, and
  the promoted ladder table appended to this plan.
- **Checks:** `make check-test` 4637 passed, 29 skipped after the policy
  tests were updated (one stale count then fixed and its file rerun: 43
  passed); Included-content, catalog, starter-closure and release-prep tests
  pass; frontend `pnpm check`, `web:lint`, `prettier:check`,
  `e2e:check:source`, `openapi-ts:check`, `web:test` (vitest 5075 passed,
  1 skipped; node suites pass), `build`, `desktop:check` pass.

- **Browser journeys:** first full `pnpm e2e:test` on a disposable built
  stack (`animama-reaction-pools-e2e`, base port 8640): 38 passed, 2 failed
  (the export-review wait of 10 s was exceeded by a 445-item complete Anima;
  the template picker count was pinned at 70). A rerun of the sharing
  journey then hit its 40-minute budget doing a second complete
  export/import (892 ledger items), so the pool step now checks that the
  single import keeps Annie's exported two-member Joy · Moderate starter
  pool and that a Reaction added to Joy · Mild through the Loadout survives
  a reload. After the review repairs, a fresh built stack ran the full
  `pnpm e2e:test`: **40 passed** (34.6 minutes; about 11 before, because each
  complete-Anima import now plans, owns, verifies and cleans up about 450
  entries). `create-anima.spec.ts` is not in the active journey project (it is
  type-checked only), so the wizard's browser coverage is its component tests
  and the equip dialog's manual check.

#### Code Review #1 Findings

Independent reviewer, initial full review (2026-10-15; working tree on
`8cf5cd0d`). All 168 Reactions, 52 effects, the policy and the appendix
checked clean against the ladder. **Result: fail.**

- P6-R0-F1 (blocker): `MAX_ADMITTED_ITEM_REVISIONS` stayed 500, so a closure
  above 500 entries would fail issuance outright.
- P6-R0-F2 (blocker): the promote tool took the first Avatar Effect record
  (`angry-sheet.png`, "derived from angry.png … #543") as its template, so
  140 new effect records stated a false derivation and six owner sticker
  copies were treated as third-party.
- P6-R0-F3 (should-fix): the creation source-revision map kept a 500 cap.
- P6-R0-F4 (should-fix): agent-built effects and Reactions were recorded as
  owner-created, against the #523 precedent and the thumbnail records.
- P6-R0-F5 (should-fix): `excitement-1` and `desire-1` played their Avatar
  Effect sounds; the mildest level is silent (owner rule, 2026-10-12).
- P6-R0-F6 (should-fix): plan inaccuracies and a builder that muted every
  silent-effect event and read sounds before any sound change.
- Optional: a stale test comment, ladder-test gaps, brittle journey
  thresholds, appendix note wording, the budget comment, untracked
  thumbnails, pending journey evidence.

#### Code Review #1 Revisions

Repair round 1:

- F1: fixed. `MAX_RUNTIME_ENTRIES = 1000` is defined once in
  `domain/runtime_content_descriptor.py` (128 KiB byte cap kept) and
  re-exported by `runtime_budget_policy`; tests compile 600 roots and check
  the admitted-item map at the limit.
- F3: fixed. The creation source-revision maps use the constant (tested);
  the SDK is unchanged.
- F2, F4: fixed. `effects promote` uses a fixed owner record form and takes
  per-item `licence` (own `<folder>/**` rule, or a shared glob) and
  `sourceReview` entries as `animation promote` does; delete removes an
  effect's own rule; owner records are refused under a non-owner rule;
  reused art keeps its origin record. The promotion re-ran with
  agent-authored entries (`build_promote.py` with the ignored `licences.py`):
  476 records rewritten, 41 per-effect agent rules added, the 11 Particle
  rules and `reactions/**/*` rewritten as agent-authored (#569; redistribution
  and G2 review pending). The six sticker exact-path rules stay: they keep
  the owner's sticker terms ahead of each B Scene's agent rule.
- F5: fixed. Every Mild Avatar Effect event is muted; a frontend test
  asserts it; the README and `runtime/sound.md` state it.
- F6: fixed. The builder keeps audible events first, then silent ones,
  muting only what the 0.3 s rule needs, and explains rebuilding after
  sound changes; this plan's Results and Decision Log are corrected.
- Optional items applied: test comment, budget reason, journey thresholds
  with margin, Moderate cap and A/B expression checks in the ladder test,
  thumbnails added, and the journey rework described in Results.
- Checks after the repairs: targeted backend set 175 passed; `make
  check-test` 4640 passed, 29 skipped; frontend `openapi-ts:check`, `check`,
  `web:lint`, `prettier:check`, `e2e:check:source` pass; `web:test` vitest
  5076 passed, 1 skipped; `node --test scripts/effects.test.mjs` 34 pass.

Repair round 1 recheck (same reviewer): F1–F6 resolved, the kept sticker
rules confirmed, a promote dry run reports 0 changes, no regressions.
**Result: pass** (1 of 2 repair rounds used). Non-blocking notes applied (a
stale Results bullet, the limit docstring); the promote tool's owner-terms
guard checking only exact `<folder>/**` rules is latent for older agent
rule shapes and is filed as a follow-up task.

## Final integration review

Covers R1–R16 across all phases, the package-set compatibility comparison, the
full browser journeys and the promoted content, reusing still-valid phase
evidence.

Independent reviewer, final integration mode (2026-10-15; candidate
`3abfa097` against `87dce31b`). **Result: pass**; no blocking findings or
code defects. Cross-checked R1–R16 and the seams from `emotion.update`
through the planner, backend runtime cells through the adapter, the starter
policy against the frontend built-in pools and the Included folders, package
round trips and deletion protection; all 373 added tracked files have
source-review records; commits carry no attribution lines.

- FIN-R0-F1 (should-fix): two frontend docs still described one-member
  built-in pools. Fixed in `runtime/avatar-planner.md` and
  `runtime/avatar-emotion.md`.
- FIN-R0-F2 (should-fix): the package-set comparison had not been recorded.
  Done: `scripts/package-sets/build.py build` for `87dce31b` (from a clean
  temporary worktree) and `3abfa097`, then `compare`: "Compatibility policy
  passed" (`local-http` 9.0.0 major, `runtime-contracts` 0.9.0,
  `product-ui` declarations unchanged).
- FIN-R0-F3 (should-fix): the wizard's pools were never checked in a
  browser (the `create-anima` journey is not in the active project). A
  headless attempt on the development task stack could not pass the avatar
  and voice steps (the canvas preview does not become ready headless, and a
  voice is required), so the wizard's browser check is recorded as not
  performed; it is covered by component tests and left to the owner.
- FIN-R0-F4 (should-fix): browser-journey durations were stale. `AGENTS.md`
  and `browser-journeys.md` now say about 35 minutes and why.
- FIN-R0-F5: the dependency Progress item is checked.
- FIN-R0-F6: the `starter_reaction_unavailable` warning no longer shows the
  internal content ID (five locales; test updated).
- FIN-R0-F7: product-side export/import time for a starter Anima (about 445
  entries) was not measured; noted for the owner.

Follow-ups folded in at the owner's request (2026-10-15), after the PR opened:

- `AnimaLoadoutService._target` raised `content_dependency_retired` inside
  the parse guard, which turned it into `loadout_source_invalid`; the check
  now runs after parsing, and a Gesture add with a retired `pose_clip`
  dependency is refused by its own code (new test in
  `tests/test_anima_loadouts.py`).
- `effects promote` checked an owner-form item only against an exact
  `<folder>/**` rule, so older agent rules shaped `<folder>/*` or
  `<folder>/*.json` did not stop owner records; it now checks the first
  rule matching each of the item's own files and refuses one naming another
  creator (test added; the real promotion still dry-runs with 0 changes).

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

Delivered (2026-10-15): four Reaction intensities with the model mapping of
R1; pools of up to four Reactions per cell, stored as one binding row per
member and picked at random without repeating a cell's last played member;
pool editing in `/animas/`, the equip dialog, the Create Anima wizard and
sharing details, sharing Idle's components; pools in creation and packages;
168 Included Reactions on a four-step ladder with 52 new hand-drawn effects;
every starter cell holding its Included Reactions; the `animation:reel`
recorder. Open: the owner's G2/G3 review before merge, the wizard's browser
check, and the in-chat escalation and variety check after merge.

Lessons: content growth has system-wide costs that show up late. The full
starter set needed the runtime entry limit raised in two places, and the
complete-Anima browser journeys tripled in length. The first review of each
phase caught real defects (sound overlap, licence-record templating, an
uncaught admission cap), so the bounded review was worth its cost. Drafts
kept outside Git, with generator scripts, made the late fixes (muting, licence
wording) reproducible by re-promotion instead of hand edits.

## Appendix: the promoted Reaction ladder

The 168 Included Reactions as promoted in Phase 6 (from the G1-approved table
with the Phase 2 changes in the Decision Log). Expression weights are the
peak beat (`→` marks a two-beat face); A, P and S are Avatar, Particle and
Scene Effects, new ones in bold. Every starter cell holds its Reactions.

| Emotion | Int. | Reaction | Source | Expression | Effects | Note |
| --- | --- | --- | --- | --- | --- | --- |
| admiration | 1 | `admiration-1` | new | surprised 1.00 happy .75 relaxed .38 | — | Impressed, eyes wide |
| admiration | 2 | `admiration-2` | today `admiration-1` | happy .75 relaxed .35 | A: star3 | Expression strengthened |
| admiration | 2 | `admiration-2-b` | new | surprised 1.00 → surprised 1.00 happy .75 | A: **kirakira_cluster** (new) | An impressed "ooh" that warms into a smile |
| admiration | 3 | `admiration-3` | today `admiration-2` | happy .75 relaxed .35 | A: star3; P: twinkle-shimmer | Expression strengthened |
| admiration | 3 | `admiration-3-b` | new | surprised 1.00 → surprised .82 happy .75 | A: kira_star; P: butterfly-flutter | Captivated: a gasp that melts into a glow |
| admiration | 4 | `admiration-4` | today `admiration-3` | happy .75 relaxed .33 | A: star3; P: heart-burst; S: scene-vfx-emotion-admiration | Expression strengthened |
| admiration | 4 | `admiration-4-b` | new | surprised 1.00 → surprised .79 happy .75 | A: mind_blown_burst; A: **kirakira_cluster** (new); P: golden-willow; S: **scene-vfx-emotion-admiration-b** (new) | Awestruck, mind blown |
| caring | 1 | `caring-1` | new | relaxed 1.00 happy .44 | — | Warm, tender look |
| caring | 2 | `caring-2` | today `caring-1` | relaxed 1.00 happy .38 | A: heart_pop | Expression strengthened |
| caring | 2 | `caring-2-b` | new | happy 1.00 relaxed .44 | A: mended-heart | Gentle closed-eye smile |
| caring | 3 | `caring-3` | today `caring-2` | relaxed 1.00 happy .36 | A: heart_pop; P: sparkle-hearts | Expression strengthened |
| caring | 3 | `caring-3-b` | new | happy 1.00 relaxed .55 | A: **happy_flowers** (new); P: **petal-drift** (new) | Tender, eyes softly closed |
| caring | 4 | `caring-4` | today `caring-3` | relaxed 1.00 happy .37 | A: heart_pop; P: heart-burst; S: scene-vfx-emotion-caring | No Avatar Effect; the ladder adds one below the Particle Effect; expression strengthened |
| caring | 4 | `caring-4-b` | new | happy .75 relaxed .50 blink .35 sad .21 | A: hearts_burst; A: mended-heart; P: butterfly-flutter; S: **scene-vfx-emotion-caring-b** (new) | Deeply moved, holding them close |
| love | 1 | `love-1` | new | happy .75 relaxed .44 | — | Fond smile |
| love | 2 | `love-2` | today `love-1` | happy .75 relaxed .44 | A: blush | Expression strengthened |
| love | 2 | `love-2-b` | new | happy 1.00 | A: hearts_burst | Dreamy closed-eye smile |
| love | 3 | `love-3` | today `love-2` | happy .75 relaxed .43 | A: blush; A: doki_doki; P: hearts-v1 | Expression strengthened |
| love | 3 | `love-3-b` | new | happy .75 surprised .42 | A: heart_eyes; P: sparkle-hearts | Smitten, eyes turned to hearts |
| love | 4 | `love-4` | today `love-3` | happy .75 relaxed .42 | A: heart_eyes; A: blush; P: heart-burst; S: scene-vfx-emotion-love | Expression strengthened |
| love | 4 | `love-4-b` | new | happy .75 surprised .58 sad .33 | A: **kirakira_cluster** (new); A: blush_deep; P: **petal-drift** (new); S: **scene-vfx-emotion-love-b** (new) | Swooning bliss, sparkling |
| embarrassment | 1 | `embarrassment-1` | new | sad 1.00 happy .75 blink .35 | — | Awkward, flustered smile |
| embarrassment | 2 | `embarrassment-2` | today `embarrassment-1` | sad 1.00 happy .50 blink .35 | A: blush_band | Expression strengthened |
| embarrassment | 2 | `embarrassment-2-b` | new | surprised 1.00 → sad 1.00 happy .75 | A: **stomach_butterflies** (new); A: awkward-ellipsis | Caught out, then a sheepish smile |
| embarrassment | 3 | `embarrassment-3` | today `embarrassment-2` | sad 1.00 happy .50 blink .35 | A: blush; A: eye_vv; P: **sweat-spray** (new) | No Particle Effect; flustered sweat beads fit the > < eyes and blush; expression strengthened |
| embarrassment | 3 | `embarrassment-3-b` | new | surprised 1.00 → happy 1.00 sad 1.00 | A: blush; A: **startle_ticks** (new); P: fume-puffs | Flustered, jolted |
| embarrassment | 4 | `embarrassment-4` | today `embarrassment-3` | sad 1.00 happy .43 blink .35 | A: blush_deep; A: sweat_drop; P: fume-puffs; S: scene-vfx-emotion-embarrassment | Expression strengthened |
| embarrassment | 4 | `embarrassment-4-b` | new | sad 1.00 blink .85 happy .30 | A: face_red; A: soul_wisp; P: **sweat-spray** (new); S: **scene-vfx-emotion-embarrassment-b** (new) | Dying of embarrassment: the soul leaves |
| respect | 1 | `respect-1` | new | relaxed 1.00 happy .22 | — | Calm, attentive respect |
| respect | 2 | `respect-2` | today `respect-1` | relaxed 1.00 happy .25 | A: kira_star | Expression strengthened |
| respect | 2 | `respect-2-b` | new | surprised 1.00 relaxed .88 | A: star3 | Quietly impressed, eyes bright |
| respect | 3 | `respect-3` | today `respect-2` | relaxed 1.00 happy .28 | A: star3; P: twinkle-shimmer | Expression strengthened |
| respect | 3 | `respect-3-b` | new | relaxed 1.00 blink .85 happy .25 | A: **kirakira_cluster** (new); P: **petal-drift** (new) | A solemn closed-eye nod of respect |
| respect | 4 | `respect-4` | today `respect-3` | relaxed 1.00 happy .29 | A: star3; P: halo-rays; S: scene-vfx-emotion-respect | Expression strengthened |
| respect | 4 | `respect-4-b` | new | surprised 1.00 → surprised 1.00 relaxed .91 happy .36 | A: kira_star; P: golden-willow; S: **scene-vfx-emotion-respect-b** (new) | Honoured and in awe |
| confidence | 1 | `confidence-1` | new | happy .75 angry .55 | — | Determined smile |
| confidence | 2 | `confidence-2` | today `confidence-1` | happy .75 relaxed .64 | A: kira_star | Expression strengthened |
| confidence | 2 | `confidence-2-b` | new | blinkRight 1.00 happy .60 | A: sly_glint | A knowing wink with a glint |
| confidence | 3 | `confidence-3` | today `confidence-2` | happy .75 relaxed .62 | A: idea_bulb; P: twinkle-shimmer | No Particle Effect; a light shimmer keeps the idea bulb the focus; expression strengthened |
| confidence | 3 | `confidence-3-b` | new | blinkRight 1.00 happy .60 | A: tiny-victory-crown; P: star-burst | "Nailed it" wink |
| confidence | 4 | `confidence-4` | today `confidence-3` | happy .75 relaxed .61 | A: star3; P: halo-rays; S: scene-vfx-emotion-confidence | Expression strengthened |
| confidence | 4 | `confidence-4-b` | new | happy .75 angry .27 | A: burning-resolve-eyes; A: **triumph_halo** (new); P: **golden-aura** (new); S: **scene-vfx-emotion-confidence-b** (new) | Fired-up, powering up |
| gratitude | 1 | `gratitude-1` | new | happy .75 sad .50 relaxed .38 | — | Touched, thankful smile |
| gratitude | 2 | `gratitude-2` | today `gratitude-1` | happy .75 relaxed .60 | A: heart_pop | Expression strengthened |
| gratitude | 2 | `gratitude-2-b` | new | happy 1.00 relaxed .30 | A: hearts_burst | Closed-eye thank-you smile |
| gratitude | 3 | `gratitude-3` | today `gratitude-2` | happy .75 relaxed .61 | A: heart_pop; P: twinkle-shimmer | Expression strengthened |
| gratitude | 3 | `gratitude-3-b` | new | sad .89 happy .75 surprised .33 | A: **teary_sparkle_eyes** (new); P: **petal-drift** (new) | Touched, eyes welling up |
| gratitude | 4 | `gratitude-4` | today `gratitude-3` | happy .75 relaxed .59 | A: heart_pop; A: streaming_tears; P: halo-rays; S: scene-vfx-emotion-gratitude | Expression strengthened |
| gratitude | 4 | `gratitude-4-b` | new | surprised 1.00 → happy .75 sad .75 | A: **happy_flowers** (new); A: hearts_burst; P: sparkle-hearts; S: **scene-vfx-emotion-gratitude-b** (new) | Overflowing thanks |
| amusement | 1 | `amusement-1` | new | happy .75 blink .35 | — | Amused smirk |
| amusement | 2 | `amusement-2` | today `amusement-1` | happy .75 | A: eye_vv | Expression strengthened |
| amusement | 2 | `amusement-2-b` | new | blinkLeft 1.00 happy .60 | A: laugh_marks | A haughty "ohoho" |
| amusement | 3 | `amusement-3` | today `amusement-2` | happy .75 | A: eye_vv; A: heh_lettering; P: musical-cascade | No Particle Effect; rising notes read as giggles; expression strengthened |
| amusement | 3 | `amusement-3-b` | new | happy 1.00 angry .15 | A: little-devil-horns; P: **sparkle-bubbles** (new) | Mischievous snicker |
| amusement | 4 | `amusement-4` | today `amusement-3` | happy .75 | A: eye_vv; P: confetti; S: scene-vfx-emotion-amusement | Expression strengthened |
| amusement | 4 | `amusement-4-b` | new | surprised 1.00 → happy 1.00 sad .26 | A: laugh_marks; A: streaming_tears; P: musical-cascade; S: **scene-vfx-emotion-amusement-b** (new) | Cracking up, tears of laughter |
| excitement | 1 | `excitement-1` | new | happy .75 surprised .44 | A: kira_star | Eager, bright-eyed (Subtle effect to tell it from joy and desire (D19)) |
| excitement | 2 | `excitement-2` | today `excitement-1` | happy .75 surprised .17 | A: star3 | Expression strengthened |
| excitement | 2 | `excitement-2-b` | new | surprised 1.00 → happy .75 surprised .70 | A: **startle_ticks** (new) | A gasp, then a grin |
| excitement | 3 | `excitement-3` | today `excitement-2` | happy .75 surprised .21 | A: star3; P: star-burst | Expression strengthened |
| excitement | 3 | `excitement-3-b` | new | happy .75 blink .35 surprised .29 | A: **kirakira_cluster** (new); P: confetti | Can't sit still |
| excitement | 4 | `excitement-4` | today `excitement-3` | happy .75 surprised .23 | A: star3; P: star-burst; P: fireworks-show; S: scene-vfx-emotion-excitement | Expression strengthened |
| excitement | 4 | `excitement-4-b` | new | surprised 1.00 → happy .75 surprised .44 | A: mind_blown_burst; A: star3; P: confetti; P: golden-willow; S: **scene-vfx-emotion-excitement-b** (new) | Mind-blowing hype |
| joy | 1 | `joy-1` | new | happy .75 | — | Happy smile |
| joy | 2 | `joy-2` | today `joy-1` | happy .75 | A: kira_star | Expression strengthened |
| joy | 2 | `joy-2-b` | new | happy 1.00 | A: **happy_flowers** (new) | Closed-eye ^^ smile, little flowers |
| joy | 3 | `joy-3` | today `joy-2` | happy .75 | A: star3; P: confetti | Expression strengthened |
| joy | 3 | `joy-3-b` | new | happy .75 surprised .73 | A: music_notes; P: **sparkle-bubbles** (new) | Bubbly delight, humming |
| joy | 4 | `joy-4` | today `joy-3` | happy .75 | A: star3; P: confetti; P: star-burst; S: scene-vfx-emotion-joy | Expression strengthened |
| joy | 4 | `joy-4-b` | new | surprised 1.00 → happy .75 surprised .69 | A: **kirakira_cluster** (new); A: hearts_burst; P: **flower-pop** (new); S: **scene-vfx-emotion-joy-b** (new) | Flowers bloom around the head |
| desire | 1 | `desire-1` | new | happy .75 surprised .57 relaxed .29 | A: blush_band | Longing glance (Subtle effect to tell it from joy and excitement (D19)) |
| desire | 2 | `desire-2` | today `desire-1` | happy .75 relaxed .50 | A: blush | Expression strengthened |
| desire | 2 | `desire-2-b` | new | happy .75 surprised .60 | A: money-eyes | "I want it!" money eyes (Comedic wanting; heart_pop is the gentler alternative) |
| desire | 3 | `desire-3` | today `desire-2` | happy .75 relaxed .55 | A: heart_eyes; P: hearts-v1 | Expression strengthened |
| desire | 3 | `desire-3-b` | new | surprised 1.00 → surprised .82 happy .75 | A: **kirakira_cluster** (new); A: blush; P: sparkle-hearts | Eager, eyes sparkling |
| desire | 4 | `desire-4` | today `desire-3` | happy .75 relaxed .52 | A: heart_eyes; A: blush; P: heart-fireworks; S: scene-vfx-emotion-desire | Expression strengthened |
| desire | 4 | `desire-4-b` | new | happy .75 surprised .53 | A: star3; A: blush_deep; P: **petal-drift** (new); S: **scene-vfx-emotion-desire-b** (new) | Starry-eyed yearning |
| curiosity | 1 | `curiosity-1` | new | surprised 1.00 happy .38 | — | Interested look |
| curiosity | 2 | `curiosity-2` | today `curiosity-1` | surprised 1.00 relaxed .67 | A: question_mark | Expression strengthened |
| curiosity | 2 | `curiosity-2-b` | new | surprised .89 happy .75 | A: twitching-cat-ears | Ears perk up |
| curiosity | 3 | `curiosity-3` | today `curiosity-2` | surprised 1.00 relaxed .62 | A: emote; P: question-orbit | Expression strengthened |
| curiosity | 3 | `curiosity-3-b` | new | angry 1.00 blink .85 surprised .83 | A: calculating-glasses; P: twinkle-shimmer | Detective mode |
| curiosity | 4 | `curiosity-4` | today `curiosity-3` | surprised 1.00 relaxed .58 | A: idea_bulb; P: question-orbit; S: scene-vfx-emotion-curiosity | Expression strengthened |
| curiosity | 4 | `curiosity-4-b` | new | surprised 1.00 → surprised 1.00 happy .75 | A: twitching-cat-ears; A: **ahoge_curl** (new); P: butterfly-flutter; S: **scene-vfx-emotion-curiosity-b** (new) | Fascinated: "what's this?!" |
| optimism | 1 | `optimism-1` | new | happy 1.00 | — | Bright ^^ smile |
| optimism | 2 | `optimism-2` | today `optimism-1` | happy .75 relaxed .47 | A: kira_star | Expression strengthened |
| optimism | 2 | `optimism-2-b` | new | happy .75 angry .30 | A: burning-resolve-eyes | "I can do this!" |
| optimism | 3 | `optimism-3` | today `optimism-2` | happy .75 relaxed .44 | A: idea_bulb; P: twinkle-shimmer | Expression strengthened |
| optimism | 3 | `optimism-3-b` | new | happy .75 surprised .70 | A: **happy_flowers** (new); P: butterfly-flutter | Hope rising |
| optimism | 4 | `optimism-4` | today `optimism-3` | happy .75 relaxed .43 | A: star3; P: golden-willow; S: scene-vfx-emotion-optimism | Expression strengthened |
| optimism | 4 | `optimism-4-b` | new | happy .75 surprised .62 | A: burning-resolve-eyes; A: **kirakira_cluster** (new); P: **golden-aura** (new); S: **scene-vfx-emotion-optimism-b** (new) | Unstoppable, golden aura |
| fear | 1 | `fear-1` | new | surprised 1.00 sad .50 | — | Frightened |
| fear | 2 | `fear-2` | today `fear-1` | surprised 1.00 | A: eye_0 | Expression strengthened |
| fear | 2 | `fear-2-b` | new | surprised 1.00 → sad 1.00 surprised .60 | A: **pale_blue_shade** (new) | Blood drains from the face |
| fear | 3 | `fear-3` | today `fear-2` | surprised 1.00 | A: eye_o; A: sweat_drop; P: **fright-jolt** (new) | No Particle Effect; a jolt of fright sparks lands the shock; expression strengthened |
| fear | 3 | `fear-3-b` | new | sad 1.00 blink .75 surprised .33 | A: **petrified_cracks** (new); A: sweat_drop; P: **sweat-spray** (new) | Petrified with fright |
| fear | 4 | `fear-4` | today `fear-3` | surprised 1.00 blink .15 | A: emote; A: eye_o; P: **fright-jolt** (new); S: scene-vfx-emotion-fear | No Particle Effect; the fright jolt escalates from intensity 3; expression strengthened |
| fear | 4 | `fear-4-b` | new | surprised 1.00 → surprised 1.00 sad .69 | A: **pale_blue_shade** (new); A: soul_wisp; P: gloom-wisps; S: **scene-vfx-emotion-fear-b** (new); S: **scene-vfx-emotion-fear-b-backdrop** (new) | Scared out of their wits (Focus lines over a companion backdrop Scene with the entry flash) |
| nervousness | 1 | `nervousness-1` | new | surprised 1.00 sad .83 happy .33 | — | Tense, worried |
| nervousness | 2 | `nervousness-2` | today `nervousness-1` | surprised 1.00 blink .19 | A: sweat_drop | Expression strengthened |
| nervousness | 2 | `nervousness-2-b` | new | sad .89 happy .75 surprised .33 | A: **stomach_butterflies** (new) | Forced "ehehe" grin, butterflies inside |
| nervousness | 3 | `nervousness-3` | today `nervousness-2` | surprised 1.00 blink .20 | A: sweat_drop; P: **sweat-spray** (new) | No Particle Effect; flying sweat beads escalate the sweat drop; expression strengthened |
| nervousness | 3 | `nervousness-3-b` | new | sad 1.00 surprised .73 blink .18 | A: ticking-fuse; P: **fright-jolt** (new) | Pressure building |
| nervousness | 4 | `nervousness-4` | today `nervousness-3` | surprised 1.00 blink .24 | A: eye_o; A: sweat_drop; P: **sweat-spray** (new); S: scene-vfx-emotion-nervousness | No Particle Effect; sweat beads as at intensity 3; expression strengthened |
| nervousness | 4 | `nervousness-4-b` | new | surprised 1.00 sad .62 | A: eye_confused_swirl; A: **stomach_butterflies** (new); P: **dizzy-stars** (new); S: **scene-vfx-emotion-nervousness-b** (new); S: **scene-vfx-emotion-nervousness-b-backdrop** (new) | Full panic, spiral eyes (Focus lines over a companion backdrop Scene with the entry flash) |
| confusion | 1 | `confusion-1` | new | surprised 1.00 blinkLeft 1.00 | — | Puzzled squint |
| confusion | 2 | `confusion-2` | today `confusion-1` | surprised 1.00 blink .14 | A: question_mark | Expression strengthened |
| confusion | 2 | `confusion-2-b` | new | relaxed 1.00 surprised .56 | A: blank-dot-eyes; A: **passing_crow** (new) | Blank stare as a crow flies past |
| confusion | 3 | `confusion-3` | today `confusion-2` | surprised 1.00 blink .18 | A: eye_confused_swirl; P: question-orbit | Expression strengthened |
| confusion | 3 | `confusion-3-b` | new | sad 1.00 surprised 1.00 | A: **ahoge_curl** (new); P: **dizzy-stars** (new) | Dizzy, ahoge curling |
| confusion | 4 | `confusion-4` | today `confusion-3` | surprised 1.00 blink .19 | A: emote; A: eye_confused_swirl; P: question-orbit; S: scene-vfx-emotion-confusion | Expression strengthened |
| confusion | 4 | `confusion-4-b` | new | surprised 1.00 → surprised 1.00 sad .53 | A: knockout-x-eyes; P: **dizzy-stars** (new); S: **scene-vfx-emotion-confusion-b** (new); S: **scene-vfx-emotion-confusion-b-backdrop** (new) | Total overload (Focus lines over a companion backdrop Scene with the entry flash) |
| anger | 1 | `anger-1` | new | angry 1.00 blink .56 | — | Angry glare |
| anger | 2 | `anger-2` | today `anger-1` | angry 1.00 blink .30 | A: angry | Expression strengthened |
| anger | 2 | `anger-2-b` | new | angry 1.00 blink .75 | A: **menace_aura** (new) | Menacing glare |
| anger | 3 | `anger-3` | today `anger-2` | angry 1.00 blink .30 | A: angry; P: fume-puffs | Expression strengthened |
| anger | 3 | `anger-3-b` | new | angry 1.00 surprised .50 | A: **shadowed_glare** (new); P: **rage-embers** (new) | Seething, eyes in shadow |
| anger | 4 | `anger-4` | today `anger-3` | angry 1.00 blink .30 | A: angry; A: steam_puffs; A: face_red; P: rage-aura; S: scene-vfx-emotion-anger | Expression strengthened |
| anger | 4 | `anger-4-b` | new | angry 1.00 surprised .44 | A: **menace_aura** (new); A: **shadowed_glare** (new); P: **rage-embers** (new); S: **scene-vfx-emotion-anger-b** (new) | Erupting rage |
| annoyance | 1 | `annoyance-1` | new | relaxed 1.00 angry .75 blink .62 | A: sigh_puff_droop | Bored, half-lidded "ugh" (Subtle effect to tell it from disapproval (D19)) |
| annoyance | 2 | `annoyance-2` | today `annoyance-1` | angry 1.00 blink .29 | A: puff | Expression strengthened |
| annoyance | 2 | `annoyance-2-b` | new | relaxed 1.00 blink .78 angry .67 | A: annoyed_scribble | Half-lidded "ugh" |
| annoyance | 3 | `annoyance-3` | today `annoyance-2` | angry 1.00 blink .29 | A: eye; P: fume-puffs | Expression strengthened |
| annoyance | 3 | `annoyance-3-b` | new | angry 1.00 sad .58 blink .50 | A: ticking-fuse; P: **rage-embers** (new) | Patience running out |
| annoyance | 4 | `annoyance-4` | today `annoyance-3` | angry 1.00 blink .30 | A: angry; P: fume-puffs; S: scene-vfx-emotion-annoyance | Expression strengthened |
| annoyance | 4 | `annoyance-4-b` | new | angry 1.00 surprised .44 blink .25 | A: annoyed_scribble; A: steam_puffs; P: **rage-embers** (new); S: **scene-vfx-emotion-annoyance-b** (new) | Boiling over |
| disapproval | 1 | `disapproval-1` | new | angry 1.00 blink .71 sad .29 | — | Disapproving frown |
| disapproval | 2 | `disapproval-2` | today `disapproval-1` | angry 1.00 blink .30 sad .23 | A: eye | Expression strengthened |
| disapproval | 2 | `disapproval-2-b` | new | angry 1.00 happy .50 | A: suspicious-side-eye | Cool side-eye |
| disapproval | 3 | `disapproval-3` | today `disapproval-2` | angry 1.00 blink .30 sad .26 | A: eye; P: **cold-breeze** (new) | No Particle Effect; a chilly gust lands the flat stare; expression strengthened |
| disapproval | 3 | `disapproval-3-b` | new | angry 1.00 blink .75 sad .25 | A: suspicious-side-eye; P: snow-crystal-flurry | Frosty judgement |
| disapproval | 4 | `disapproval-4` | today `disapproval-3` | angry 1.00 blink .30 sad .29 | A: angry; P: **cold-breeze** (new); S: scene-vfx-emotion-disapproval | No Particle Effect; the gust escalates from intensity 3; expression strengthened |
| disapproval | 4 | `disapproval-4-b` | new | relaxed 1.00 angry .69 blink .62 | A: suspicious-side-eye; A: **menace_aura** (new); P: snow-crystal-flurry; S: **scene-vfx-emotion-disapproval-b** (new) | Withering contempt |
| disgust | 1 | `disgust-1` | new | angry 1.00 sad 1.00 blink .67 | — | Grimace |
| disgust | 2 | `disgust-2` | today `disgust-1` | angry 1.00 sad 1.00 blink .28 | A: eye | Expression strengthened |
| disgust | 2 | `disgust-2-b` | new | sad 1.00 blink .80 angry .60 | A: **skunk_cloud** (new) | Wrinkled nose at a bad smell |
| disgust | 3 | `disgust-3` | today `disgust-2` | angry 1.00 sad .94 blink .28 | A: texture_sick_1; P: stink-miasma | Expression strengthened |
| disgust | 3 | `disgust-3-b` | new | sad 1.00 surprised .58 | A: **pale_blue_shade** (new); P: **buzzing-flies** (new) | Turning blue, flies buzzing |
| disgust | 4 | `disgust-4` | today `disgust-3` | angry 1.00 sad .88 blink .28 | A: texture_sick_2; P: stink-miasma; S: scene-vfx-emotion-disgust | Expression strengthened |
| disgust | 4 | `disgust-4-b` | new | sad 1.00 angry .73 blink .47 | A: **pale_blue_shade** (new); A: **petrified_cracks** (new); P: **buzzing-flies** (new); S: **scene-vfx-emotion-disgust-b** (new) | Utterly grossed out, turned to stone |
| remorse | 1 | `remorse-1` | new | sad 1.00 blink .22 | — | Guilty look |
| remorse | 2 | `remorse-2` | today `remorse-1` | sad 1.00 blink .21 | A: sweat_drop | Expression strengthened |
| remorse | 2 | `remorse-2-b` | new | sad 1.00 happy .50 | A: **guilt_arrow** (new) | Struck by guilt |
| remorse | 3 | `remorse-3` | today `remorse-2` | sad 1.00 blink .26 | A: gloom_lines; P: gloom-wisps | No Particle Effect; spirit flames match its gloom lines; expression strengthened |
| remorse | 3 | `remorse-3-b` | new | sad 1.00 blink .77 | A: gloomy_cloud; A: sweat_drop; P: **drifting-leaves** (new) | Dark cloud of guilt |
| remorse | 4 | `remorse-4` | today `remorse-3` | sad 1.00 blink .28 | A: texture_black_1; P: gloom-wisps; S: scene-vfx-emotion-remorse | Expression strengthened |
| remorse | 4 | `remorse-4-b` | new | sad 1.00 surprised .33 | A: broken-heart; A: **wilting_flower** (new); P: rain-cloud; S: **scene-vfx-emotion-remorse-b** (new) | Heartbroken regret |
| disappointment | 1 | `disappointment-1` | new | sad 1.00 relaxed .38 | A: gloomy_cloud | Let down (Subtle effect to tell it from remorse (D19)) |
| disappointment | 2 | `disappointment-2` | today `disappointment-1` | sad 1.00 blink .12 | A: puff | Expression strengthened |
| disappointment | 2 | `disappointment-2-b` | new | relaxed 1.00 sad .78 | A: sigh_puff_droop | Deflated sigh |
| disappointment | 3 | `disappointment-3` | today `disappointment-2` | sad 1.00 blink .16 | A: gloom_lines; P: gloom-wisps | Expression strengthened |
| disappointment | 3 | `disappointment-3-b` | new | sad 1.00 blink .69 | A: **wilting_flower** (new); P: **cold-breeze** (new) | Wilting with a drooping flower |
| disappointment | 4 | `disappointment-4` | today `disappointment-3` | sad 1.00 blink .18 | A: texture_black_1; P: rain-cloud; S: scene-vfx-emotion-disappointment | Expression strengthened |
| disappointment | 4 | `disappointment-4-b` | new | relaxed 1.00 sad 1.00 | A: gray-silhouette; A: soul_wisp; P: **drifting-leaves** (new); S: awkward-silence | Turned to grey, soul leaving (Reuses the Included tumbleweed Scene instead of a new Gloom B preset) |
| sadness | 1 | `sadness-1` | new | sad 1.00 surprised .33 | — | Teary-eyed |
| sadness | 2 | `sadness-2` | today `sadness-1` | sad 1.00 blink .22 | A: single_tear | Expression strengthened |
| sadness | 2 | `sadness-2-b` | new | sad 1.00 blink .85 | A: gloomy_cloud | Eyes lowered under a small cloud |
| sadness | 3 | `sadness-3` | today `sadness-2` | sad 1.00 blink .26 | A: single_tear; P: rain-cloud | No Avatar Effect; its tear continues intensity 2; expression strengthened |
| sadness | 3 | `sadness-3-b` | new | sad 1.00 surprised .46 | A: **teary_sparkle_eyes** (new); P: **drifting-leaves** (new) | Holding back tears |
| sadness | 4 | `sadness-4` | today `sadness-3` | sad 1.00 blink .28 | A: texture_black_1; A: streaming_tears; P: rain-cloud; S: scene-vfx-emotion-sadness | Expression strengthened |
| sadness | 4 | `sadness-4-b` | new | sad 1.00 blink .63 | A: streaming_tears; A: **wilting_flower** (new); P: snow-crystal-flurry; S: **scene-vfx-emotion-sadness-b** (new) | Alone in the cold |
| grief | 1 | `grief-1` | new | sad 1.00 blink .85 | — | Eyes shut in pain |
| grief | 2 | `grief-2` | today `grief-1` | sad 1.00 blink .29 | A: single_tear | Expression strengthened |
| grief | 2 | `grief-2-b` | new | sad 1.00 blink .85 | A: broken-heart | Eyes shut, heart breaking |
| grief | 3 | `grief-3` | today `grief-2` | sad 1.00 blink .32 | A: texture_black_1; P: rain-cloud | Expression strengthened |
| grief | 3 | `grief-3-b` | new | sad 1.00 blink .73 | A: streaming_tears; P: **drifting-leaves** (new) | Tears streaming |
| grief | 4 | `grief-4` | today `grief-3` | sad 1.00 blink .34 | A: texture_black_1; A: streaming_tears; A: despair_shade; P: rain-cloud; P: gloom-wisps; S: scene-vfx-emotion-grief | Expression strengthened |
| grief | 4 | `grief-4-b` | new | sad 1.00 surprised .42 | A: streaming_tears; A: soul_wisp; P: snow-crystal-flurry; S: **scene-vfx-emotion-grief-b** (new) | Wailing |
