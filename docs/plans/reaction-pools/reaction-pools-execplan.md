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
- [ ] Dependency: #559 merged; branch rebased; baseline refreshed.
- [x] Phase 3: backend pools and four intensities.
- [x] Phase 4: runtime selection and `/animas/` pool editing.
- [x] Phase 5: equip dialog cell chooser and wizard pools.
- [ ] Phase 6: promotion, starter pools and journeys. G3 list reviewed with G2 before merge.
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
