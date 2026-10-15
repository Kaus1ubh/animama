# Per-use Avatar Effect overrides and flipbook effects

Source agreement: [#543](https://github.com/raymond-van/animama/issues/543)
(the issue is the spec; agreed revision updated 2026-10-14T18:02:23Z, with
Q1–Q5 and the accepted plan proposals), and the Decision Log below.
Authorized scope: the whole plan, approved by the owner on 2026-10-14 (G0).
G1–G3 approved; merge approval remains.
Starting revision: `19919ded` (`main`).
Branch: `feat/avatar-effect-overrides-flipbooks`, in a dedicated task
worktree. One branch and one PR for this plan.
Issues: parent #543; phases P1 #546, P2 #547, P3 #548, P4 #549, P5 #550,
P6 #551 and P7 #552, sub-issues of #543 with blocked-by links.

## Purpose and context

Two changes, delivered in this order (Q4):

1. **Per-use overrides (D1–D7).** An `avatar_vfx` event in a Gesture or
   Reaction (`animaPoseClip/2.0`) may override the played effect's
   attachment (same kind), appearance and motion. The Included library then
   merges Avatar Effects that share art: 29 effects become 10 (Steam Puffs stays, D-9). Local Actions
   that reference a removed effect are rewritten automatically.
2. **Flipbooks (F1–F4).** `effects:assets` derives consistent flipbook frames
   from one key image (`boil`, `draw-on`). The effect skills gain a decision
   rule and an "upgrade to flipbook" recipe. A reviewed candidate set of
   Included effects is converted.

The issue holds the requirement text, the merge table, the candidate table
and acceptance. This plan does not restate them as a second contract.

Commands run from the repository root unless stated. Frontend scripts run
from `src/frontend/web`. Paths: `FE/` = `src/frontend/web/src/`, `BE/` =
`src/backend/animama/`, content = `content/included/`.

### Implementation orientation

Survey of `19919ded`.

| Area | Current state and significance |
| --- | --- |
| Effect contract | `BE/app/contracts/avatar_effect.py`: `AvatarEffectDefinitionV2` (:375, `_check_consistency` ties region to attachment, `otherEyeImage` to a mirrored paired placement and `faceOptions` to the attachment); attachments `FaceSurfaceAttachment` :135, `FaceLandmarkAttachment` :177, `BodyAttachment` :203, `StickerAttachment` :220, `SilhouetteAttachment` :234, union `AvatarEffectAttachment` :248 (discriminator `kind`); `AvatarEffectAppearance` :278; `AvatarEffectMotion` :337; `soundAlias` :385. OpenAPI generates `zAvatarEffectDefinitionV2`, `zAvatarEffectAppearance`, `zAvatarEffectMotion` and the five attachment schemas in `packages/runtime-contracts/src/generated/zod.gen.ts`, without the backend's cross-field refinements (ADR 0015). |
| Clip events (frontend) | `FE/lib/avatar/poses/animaPoseClip/clipVocabulary.ts`: `AnimaPoseClipAvatarVFXEvent` :197; `sanitizeAvatarVFXEvent` :401 rebuilds the event from known keys, so an unknown field is **silently dropped**. Particle precedent: `sanitizeParticleVFXEvent` :461, `sanitizeParticleVFXTransform` :713. `validateAnimaPoseClipV2` (`schemaV2.ts:710`) reuses these sanitizers; there is no zod for clips. |
| Clip events (backend) | `BE/app/services/idle_clip_validation.py` `_event` :162 checks `effectId` and `playAccompanyingSound` for `avatar_vfx`; unknown keys are not rejected. Callers: idle playback, and package import/export through `content_package_capabilities.py` `_clip` :829. `_clip_event_dependencies` :795 resolves each `effectId` to one dependency edge; Scene events also check the target document (:819–826), the precedent for checking an override against its effect. **Local Save of a Gesture or Reaction does not validate clip events.** |
| Runtime | `PoseController._dispatchAvatarVFXEvent` (`FE/lib/avatar/poses/PoseController.ts:705`) and `ReactionClipPlayer._dispatchAvatarVFXEvent` (:446) → `Avatar._applyClipOwnedAvatarVFX` (`Avatar.ts:2530`) → `mediaCatalog.loadAvatarVFX(effectId)` (:2547) → `applyAvatarVFXEffectById` (`vfx/runtime.ts:17`). `parseAvatarEffectDefinition` (`vfx/definition.ts:346`) turns a definition into one of six entry shapes. Media providers cache the **parsed** entry by effect id (`AnimaRuntimeMediaCatalog.ts` `avatarVFXEntries` :130, `PreviewMediaProvider` in `motion-authoring/preview/previewMedia.ts:90`). The controller keys all state by applied id, which is unique per clip event, so one effect can already play twice at once. The creator preview has its own dispatch (`PoseCreatorClipPreviewSync.tsx:685`). |
| Action creator | Events are added by `createPoseCreatorClipAvatarVFXEventDraft` (`FE/ui/pose-creator/poseCreatorClipAuthoring.ts:1172`), edited in `EventInspector` (`PoseCreatorClipWorkspaceInspector.tsx:303`) through `patchPoseCreatorClipEventDraft` (:1237); `clonePoseCreatorClipEvent` (:938) copies fields explicitly. Reusable effect-creator parts: `AttachmentFields` (`FE/ui/avatar-effect-creator/AvatarEffectSetupFields.tsx:611`, dispatches only `patch-attachment`), `PlacementFields`/`LookFields` in `AvatarEffectInspector`, the decoupled `AvatarEffectAnimationControls`, helpers in `avatarEffectPlacement.ts`, and direct manipulation (`AvatarEffectHandleRenderer`, `useAvatarEffectManipulation`) that works with any applied id. |
| Content references | A Gesture or Reaction names an effect by alias in `effectId` and declares `{ref, alias, content_type, config}` in `.meta.json` (Local items also carry `source`). Duplicate refs are refused (`content_kind_registry.py:582`). A Local Action naming a removed Included effect stays VALID with `missing_effect_dependency` and plays without it; an Included one is INVALID, and starter closure fails on it. |
| Content transition | `ContentTransitionService.transition` (`BE/app/services/content_transition_service.py:73`) runs at startup, on Rescan and from `content_cli`. The model to copy is `avatar_effect_transition.py`: an idempotent mutation per item (operation id from id and revision), originals retained, publish at the same locator (keeping `content_id` and catalog id), Local-only rescan. |
| Promotion | `pnpm -s effects promote` (`src/frontend/web/scripts/effect-promote.mjs`): effect add, replace and delete; Gesture and Reaction replace from creator project files only. Delete is refused while any reference remains. `--dry-run` writes nothing. It updates `licenses/source-review.json` but not per-stem Avatar Effect rules in `content/included/licenses/inventory.json` (:853–1175). |
| Sounds | Each built-in effect has at most one optional pack sound (`definition.soundAlias`, ADR 0022). `tests/test_included_content_integrity.py` checks that the shipped sounds are exactly those effects use (:202). It also enforces one accompanying sound at a time (:234) and silent idle Gestures (:252). |
| Hard-coded stems | `FE/lib/effects/effectTemplates.ts` lists every stem with a `assets/effect-templates/<stem>.webp` thumbnail (test `effectTemplates.test.ts`). `tests/avatar/reactionClips.test.ts:45-70` maps Reactions to effects. Counts of 75 are pinned in `scripts/effect-render-sources.test.mjs:101` and `scripts/animation-preview-media.test.mjs:201`. Stems also appear in `scripts/effect-thumbnails.browser.test.mjs`, the e2e specs `playback-library` and `accountless-library`, and `tests/test_avatar_effect_conversion.py:49-61`. Licence records list per-stem rules, and Gesture provenance texts name stems. `content/included/README.md:14` gives a stale count (73). |
| Asset tooling | `src/frontend/web/scripts/effect-assets.mjs` is one file that uses only `sharp` over raw RGBA buffers. Its helpers are `readRgba` :151, `measure` :279, `applyAlphaThresholds` :509 and `bleedEdges` :521. `assembleFlipbook` (:710–845) builds a sheet from frames on one canvas. Option allowlists live at :943/:957. Tests are in `scripts/effect-assets.test.mjs` (`node:test`, fixtures painted in code), run by `pnpm web:test`. No warp or noise utility exists; `createMulberry32` (`FE/lib/scene-vfx/focus-lines.ts:86`) can be ported. `effects check` judges visibility at render times (default 0.25 s and 1 s), not per frame. |
| Docs and skills | `docs/frontend/runtime/avatar-vfx.md` §7 (:346–369) states the effect/event ownership, and §9 documents the asset tools. The glossary ("Avatar Effect") states the same ownership. Skills: `animama-avatar-vfx` (decision rules :131–133; references `what.md`, `how.md`, `effect-folder.md`, `brief.md`); `animama-effect-assets` step 7 (:92–102); `animama-animation` (decision rules :128–138, `references/promote.md` :79–105; `clip-format.md` documents no effect event fields). |

### Merge mapping (D5)

Users are the Included Gestures and Reactions that reference each effect
(survey of `19919ded`). Sounds are the pack keys.

| Family (stem after merge) | Variant | Sound | Users |
| --- | --- | --- | --- |
| Kira Star (`kira_star`) | `kira_star_head` (default) | `bell_ding_02` | peace-over-eye; Reactions confidence-1, joy-1, optimism-1, respect-1 |
| | `kira_star_tehe` | `squeaky_mouse_03` | tehepero |
| | `kira_star_wish`, `kira_star_wish_left` | `digital_chime_magical_02` | fingers-crossed (both) |
| | `laugh_sparkle` | none | ohohoho-noble-laugh |
| | `please_sparkle` | none | please-hands |
| Hearts Burst (`hearts_burst`) | `hearts_burst_hands` (default) | `dreamy_bell_02v2` | prayer-hands-thanks |
| | `hearts_burst_kyaa` | `dreamy_bell_02v2` | kyaa-hands-on-cheeks |
| | `hearts_burst_soft` | none | dreamy-gaze |
| | `pat_hearts` | `dreamy_bell_02v2` | head-pat, virtual-hug |
| Heart Pop (`heart_pop`) | `finger_heart_pop` (default) | `bubble_pop_01` | finger-heart-pose |
| | `heart_hands_pop_chest` | `love_bubble_01` | heart-hands-build |
| | `kiss_heart_head` | `accidental_kiss_02` | blow-a-kiss, blow-a-kiss-2 |
| | `heart_throb` | `heartbeat_03v1_light` | single-hand-on-heart; Reactions caring-1, caring-2, gratitude-1–3 |
| Impact Burst (`impact_burst`) | `badum_burst` (default), `badum_burst_left` | `drum_hit_double` | drumroll (both) |
| | `fist_bump_burst` | `bubbly_hit` | fist-bump |
| | `high_five_burst` | `slap_03` | high-five |
| Puff (`puff`) | `sigh_puff` (default) | `whoosh_01v2` | bored-wait, deflated-sigh, phew-brow-wipe, stretch-break; Reaction disappointment-1 |
| | `huff_puff` | `whoosh_01v2` | pout-huff; Reaction annoyance-1 |
| | ~~`steam_puffs`~~ stays its own effect (D-9) | `irritated_02` | Reaction anger-3 (unchanged) |
| Shake Lines (`shake_lines`) | `shake_lines`, `shake_lines_left` | `wobble_short` | cower, ew-recoil, grr-fists (both) |
| Finger Gun Spark (`finger_gun_spark`) | both twins | `retro_laser_focus_02v1` | cheeky-finger-guns (both) |
| Drumroll Ticks (`drumroll_ticks`) | both twins | `drum_tremolo_01` | drumroll (both) |
| Cheer Sparkles (`cheer_sparkles_head`) | both twins | `correct_answer_04` | celebration (both) |

In total, 28 Gestures and 11 Reactions change (39 Actions). The five
multi-variant families take new neutral stems. The four mirror pairs keep the
right-hand stem, so only the left twin's users change (D-4). That removes 24
effects (20 family variants and 4 left twins) and adds 5, so 75 → 56.

## Progress

- [x] Plan drafted (2026-10-14) from `19919ded`.
- [x] G0 (2026-10-14): the owner approved the plan, D-2–D-5 and D-6 (S2).
- [x] Preparation (2026-10-14): decisions published to #543 and read back;
  phase issues #546–#552 created; dependencies installed.
- [x] P1: Override contract and validation (D1, D2), 2026-10-14; review
  passed at round 2. D-8 is for owner review with the PR.
- [x] P2: Runtime playback with overrides (D3), 2026-10-14; review passed at
  round 2.
- [x] P3: Action creator editing (D4), 2026-10-14; review passed; browser
  check done on the task stack.
- [x] P4: Library merge and Local transition (D5, D6), 2026-10-14; G1
  approved; review passed at round 2.
- [x] P5: Flipbook frame tooling and skills (F1–F3, D7), 2026-10-14; review
  passed at round 3.
- [x] P6: Flipbook conversions (F4), 2026-10-14; G2 and G3 approved, 23
  promoted; review passed at round 3.
- [x] P7: Documentation and acceptance, 2026-10-14; main merged twice and
  D-11 added; the full `pnpm e2e:test` is recorded in the P7 record.
- [x] Final integration review: three rounds (budget spent); all required
  findings fixed (see below).

Phase commits: P1 `c32edd57`, P5 `7d02443c`, P2 `2c588cf8`, P3 `31f627ce`,
P4 `65355f18`, P6 `c15f3870`, P7 `fa7a3223` (docs) and `45a7e4cd` (gate
fixes), and the final-review fixes after them.

## Surprises & Discoveries

- **Sounds differ within merge families** (table above). Sound stays with the
  effect under the issue's non-goals. Merging Kira Star, Heart Pop, Impact
  Burst and Puff as agreed would therefore change the audible sound of 11
  Actions: blow-a-kiss, blow-a-kiss-2, fingers-crossed, fist-bump,
  heart-hands-build, high-five, single-hand-on-heart, tehepero, and Reactions
  caring-2, gratitude-2 and gratitude-3. It would also orphan pack sounds, which the
  integrity test at :202 forbids, and force a new pack version. This must be
  decided at G0 (D-6).
- Seven Gestures play an effect and its `_left` twin together (drumroll,
  fingers-crossed, cower, ew-recoil, grr-fists, cheeky-finger-guns,
  celebration). After the merge, each has one dependency and two events on
  the same effect, because duplicate dependency refs are refused. Playback
  supports this: controller state is keyed per event.
- The frontend sanitizer silently drops unknown event fields, and the backend
  does not reject them. Overrides need explicit support on both sides, or a
  saved override would vanish on the next creator save.
- Local Save does not validate clip events today. D2 adds override
  validation at Save.
- Media providers cache the parsed entry by effect id. A merged entry must
  be built per event from the raw definition and never cached under the id.
- `effects promote` replaces Gestures only from creator project files, and
  leaves per-stem Avatar Effect licence rules behind.
- A Local Action naming a removed effect keeps playing without it. This is
  the fallback if the D6 rewrite fails for an item.
- `mouth_w`, `mouth_hover_w` and `sigh_puff_droop` have no Included users.
- `effects promote` with `replace` writes generic owner-attestation
  `source-review.json` records for every file it writes, overwriting
  agent-authored ones (P6 corrected them by hand).
- A template thumbnail's `time` is both the pose clip's sample time and the
  effect's age, so a `once` flipbook can have ended by the pose's moment.

## Decision Log

- **D-1 (owner, 2026-10-14, #543):** one issue for both changes; per-event
  overrides (option 1) for duplicates; the expanded flipbook candidate set.
  Q1: the override covers attachment fields within the effect's kind, plus
  appearance and motion; a kind change is refused, so the Idea Bulb pair
  stays separate. Q2: the content transition rewrites Local references; no
  hidden aliases. Q3: face-surface candidates use the existing `flipbook`
  budget. Q4: D before F4, with F1–F3 free to proceed alongside.
- **D-2 (agent proposal, accepted by the owner 2026-10-14):** the event carries
  `override: { attachment?, appearance?, motion? }`. Each part, when present,
  **replaces** the effect's part whole instead of merging field by field. So
  each part is validated by the existing model (`BodyAttachment`,
  `AvatarEffectAppearance`, `AvatarEffectMotion`, …) and the merged
  definition by `AvatarEffectDefinitionV2`. Nothing new is needed to express
  "remove the pulse". Rationale: one definition source (ADR 0015), no
  partial models, predictable results.
- **D-3 (agent proposal, accepted 2026-10-14):** a merged definition that fails at runtime (for
  example, a hand-edited file) skips the event with a controller diagnostic,
  as a missing face part does. Playing the default placement would put the
  art in the wrong place.
- **D-4 (agent proposal, accepted 2026-10-14):** the five multi-variant families take new neutral
  stems (`kira_star`, `hearts_burst`, `heart_pop`, `impact_burst`, `puff`).
  Their art is copied from the default variant, and their default placement
  and motion are that variant's. The mirror pairs keep the right-hand stem.
- **D-5 (agent proposal, accepted 2026-10-14):** one tracked mapping resource
  (`BE/resources/avatar-effect-merges.json`: removed ref → family ref plus
  the override and sound choice that reproduce it) drives both the
  repository conversion of Included content and the Local transition. A test
  proves that, for every entry, the family definition merged with the
  override equals the removed variant's attachment, appearance and motion.
  The Included rewrite is a repository script, as for the `/1`→`/2`
  conversion (ADR 0015). Promote's project-file path would need 40 creator
  exports for a mechanical change. Variant deletion still goes through
  `effects promote` delete under G1.
- **D-6 (owner, 2026-10-14): sounds of merged variants — S2.** Options
  considered:
  - **S2 (chosen):** a built-in effect may declare several optional pack
    sounds. `definition.soundAlias` names the default, and the event override
    may also carry `soundAlias` to pick another declared sound. This delivers
    29 → 9 with every Gesture's sound unchanged. It amends ADR 0022's
    one-sound rule and the integrity test at :202. Runtime and media
    providers learn to load the selected sound. A missing or unmounted alias
    plays silently. The Avatar Effect creator stays single-sound for Local
    effects; the Action creator shows a sound picker when an effect declares
    several.
  - **S1:** merge only variants with the same sound; silent variants join a
    family with `playAccompanyingSound: false`. No sound-model change, but
    29 → 17: Kira Star keeps three items (default, Tehe, Wish), Heart Pop
    stays four items, Impact Burst stays three, and Steam Puffs stays.
  - S3 (Gestures carry the sound as an `sfx` event) is rejected: pack sounds
    are reachable only through effect edges and cannot be used by Local
    content.
- **D-7 (agent decision, 2026-10-14, P1 review):** Save and package checks
  validate an override against its effect only when that effect is available
  (visible to the owner, or bundled in the package). Otherwise only the shape
  is checked. Save already refuses a missing dependency (`saved_content_invalid`,
  field `dependencies`), and the skip keeps that clearer error. A visible
  effect whose definition is not a valid `/2` is skipped too; its own
  definition error reports it. This replaces P1 step 2's "an unresolvable one
  is refused".
- **D-8 (agent decision, 2026-10-14, P1 review; for owner review with the PR):**
  frontend clip parsing refuses an invalid override at the event level (path
  `events`), like every other event field; it does not name the nested field.
  The backend names it at Save and package import/export, and P3's controls
  validate each field as it is edited. The issue's acceptance "naming the
  field (backend and frontend)" is met by the backend and the editor, not by
  the parser.
- **D-9 (agent decision, 2026-10-14, P4; shown to the owner at G1):**
  Steam Puffs stays its own effect. It floats above the head (`top`
  landmark), and Sigh and Huff Puff carry a mouth face option
  (`faceCleanup: false`) that cannot apply there, so no override can make the
  Puff family play as Steam Puffs; its sound also differs. The Puff family is
  Sigh and Huff Puff: 24 effects are removed and 5 added (75 → 56), and 39
  Actions change (anger-3 keeps Steam Puffs).
- **D-10 (agent decision, 2026-10-14, P4):** an event that played a silent
  variant gets `playAccompanyingSound: false`, because its family has a sound.
  This departs from P4 step 3's "`playAccompanyingSound` is unchanged"; the
  Action still plays no sound, as before.
- **D-11 (owner direction, 2026-10-14, P7):**
  - Equip the four Gestures that #557 added to main on the starter Animas in
    this PR: Double Take, Noted, Ready Let's Do This and Tut-tut Finger Wag.
  - `starter-loadout.v1.json` lists them (99 starter Gestures: every
    non-idle Included Gesture), and they leave `CORE_LIBRARY_ROOTS`.
  - Starter Gestures resolve from the policy at runtime, so existing starter
    Animas get them too, unless the owner disabled them.
  - Main's starter tests already pinned 107 Gestures and 95 starters, which
    its own four Gestures broke; they now pin 111 and 99.

## Gates

| Gate | When | Who | Effect |
| --- | --- | --- | --- |
| G0 | Before Preparation | Owner reviews this plan and decides D-6 (passed 2026-10-14: S2) | Authorizes phases; the decision is published to #543 |
| G1 | P4, before deleting | Owner reviews the merge table, before/after render sheets of the 40 affected Actions on both Included Avatars, and the `effects promote --dry-run` delete list | Nothing under `content/included/` is deleted before approval |
| G2 | P6, per technique batch | Owner reviews each candidate's render sheet and live preview and decides convert or keep static | Approved conversions are saved as Local content; others are revised (at most twice) or kept static |
| G3 | P6, before writing | Owner approves the `effects promote --dry-run` replace list item by item | Writes exactly the approved list |

Merge approval of the exact candidate stays separate. Image generation needs
the owner's Codex login. A failed or quota-limited generation pauses only the
affected candidate.

## Preparation (workspace setup)

1. Recheck the root and scoped `AGENTS.md`, the branch, HEAD and dirty state.
   Run `git lfs pull` if a PNG reads as a pointer.
2. `workspace-setup`, after G0:
   - publish D-6 (S2: overrides may also pick a sound) and the D-2–D-5
     proposals the owner accepts to #543, and read it back;
   - create phase issues P1–P7 as sub-issues of #543. P2 is blocked by P1,
     P3 by P2, P4 by P2, P6 by P4 and P5, and P7 by all. Record them here.
     Do not create gate-only issues.
3. Dependencies: in `src/frontend`, `pnpm install --frozen-lockfile` and
   `pnpm packages:build`; for the backend, `uv sync --python 3.12.13` (before
   `pnpm openapi-ts`).
4. Task stack, needed from P3: `./reset.sh --name effect-overrides --base-port
   <free port>`, then `source .animama-stack.env`. Record the URL here.
   Purge and rebuild it after P4 changes Included content. Stop it after its
   last use. The main stack is not changed.
5. Wrap delegated test runs in `timeout`. Work test-first (`tdd`) for code in
   P1–P5.

#### Preparation record (2026-10-14)

- Checkout: dedicated task worktree, branch
  `feat/avatar-effect-overrides-flipbooks` created at `19919ded`
  (`origin/main`), no upstream yet. LFS files are present.
- #543 updated with Q5 (S2), the accepted proposals, the plan's approval and
  delivery links (updated 2026-10-14T18:03:53Z, read back).
- Phase issues: #546 (P1), #547 (P2, blocked by #546), #548 (P3, blocked by
  #547), #549 (P4, blocked by #547), #550 (P5), #551 (P6, blocked by #549 and
  #550), #552 (P7, blocked by #546–#551), all sub-issues of #543 (read back
  through GraphQL).
- Dependencies: `uv sync --python 3.12.13` (Python 3.12.13),
  `pnpm install --frozen-lockfile` and `pnpm packages:build` passed.
- No stack started; P3 starts one.

## Phased implementation

Each phase starts after its predecessor's checks and bounded review pass: one
full `sdlc-reviewer` review and at most two repair rounds, plus its gate where
one applies. Record per phase: issue, starting SHA, commits
(`<type>(<scope>)[p#]: …`; scopes `effects`, `clips`, `creator`, `content`,
`skills`, `docs`), commands and results, review records and remaining gates.

### P1 — Override contract and validation (D1, D2)

1. **Contract** (`BE/app/contracts/avatar_effect.py`): add
   `AvatarEffectEventOverride` with optional `attachment`
   (`AvatarEffectAttachment`), `appearance`, `motion` and `soundAlias`
   (S2), with `extra="forbid"`. Add `merge_avatar_effect_override(definition,
   override)`. It returns a validated `AvatarEffectDefinitionV2` and refuses an
   attachment kind change or an inconsistent result, naming the field
   (`override.attachment.kind`, …).
2. **Backend clip validation:** `_event` accepts `override` on `avatar_vfx`
   only and validates its shape. Where the target effect document is known,
   validate the merged definition: package import/export in
   `_clip_event_dependencies`, following the Scene precedent, and Local Save of
   Gestures and Reactions. Save resolves each override's effect from the
   item's dependencies; an unresolvable one is refused. Decide in
   implementation whether Save reuses the package path or a shared helper;
   keep one rule.
3. **Frontend clip schema:** `sanitizeAvatarVFXEvent` keeps a valid `override`
   by validating each part with the generated `zAvatarEffectAppearance`,
   `zAvatarEffectMotion` and attachment schemas. An invalid override makes
   the event invalid; it is not dropped silently.
   `clonePoseCreatorClipEvent` copies it. `serializeAnimaPoseClipFile` keeps
   its rounding.
4. **Parity fixtures:** add valid and invalid override cases to
   `tests/fixtures/idle-playback-cases.json`, shared by `test_idle_playback.py`
   and `IdlePlaybackContract.test.ts`.
5. **ADR** (next free number, draft): per-use Avatar Effect overrides and
   several sound edges per built-in effect, amending ADR 0022.

Checks: `uv run pytest -q tests/test_idle_playback.py
tests/test_content_package_capabilities.py tests/test_pose_clip_v2.py`
plus the new tests; `uv run ruff check`; `pnpm openapi-ts` freshness;
`node --test` or `vitest` for the clip vocabulary tests; `pnpm check`.
Completion: an event without an override is byte-identical through every path.
Overrides round-trip through sanitize, serialize, Save, export and import.
Each refusal names its field.

#### P1 record

- Issue #546; starting SHA `19919ded`; work began 2026-10-14.
- Contract: `AvatarEffectEventOverride` (refuses an empty override and `null`
  parts) and `merge_avatar_effect_override` in `BE/app/contracts/avatar_effect.py`.
  `BE/app/services/avatar_effect_overrides.py` wraps them with field-naming
  errors (`parse_avatar_effect_override`, `apply_avatar_effect_override`,
  `check_clip_effect_overrides`). `avatar_effect_error_path` and
  `avatar_effect_validation_error` take a `root`; `avatar_effect_value_error`
  is new.
- Validation: clip shape in `idle_clip_validation._event`
  (`idle_motion_invalid`); merged check in package import/export
  (`package_definition_invalid`) and Local Save of Gestures and Reactions
  (`action_effect_override_invalid`, shown by the frontend's generic
  validation message). Save reads the clip companion only when it has
  overrides (at most 2 MiB, stream position restored).
- **Departure from step 2 (D-7):** the override check skips an effect the
  owner cannot see; Save then refuses the missing dependency itself. The shape
  is still checked.
- Frontend: `AnimaPoseClipAvatarVFXOverride`; `sanitizeAvatarVFXOverride`
  checks parts with the generated zod schemas and keeps the authored copy (no
  defaults). The generated zod is not strict, so unknown nested keys pass the
  frontend; backend Save and package checks refuse them.
  `clonePoseCreatorClipEvent` copies the override.
- ADR 0025 (accepted, owner decisions of 2026-10-14) with reciprocal links in
  ADR 0022 and the index.
- Checks (2026-10-14, working tree): `uv run ruff check src/backend tests`,
  `make format-check` (840 files), `make mypy` (840 files), the import
  boundary script (0 forbidden edges), 611 tests across the affected backend
  modules; from `src/frontend`: `pnpm check`, `pnpm web:lint`,
  `pnpm openapi-ts:check` (SDK current; the override is not an API type), 997
  vitest tests (poses, pose creator, action editor, avatar clip suites),
  prettier on the changed files. All passed.

#### Code Review #1 Findings

Reviewed source: working tree on `19919ded` (P1 files only), independent
`sdlc-reviewer`, 2026-10-14. Checks: scoped ruff check and format, 171
backend tests, 191 vitest tests, a deeply nested clip probe.

- **P1-R1-F1 (required):** Save's clip read caught only `ValueError`; a
  200 KB `[[[…` clip raised `RecursionError`, so Save answered HTTP 500.
- **P1-R1-F2 (required):** frontend refusals do not name the field (only
  `events`), against #546's acceptance wording.
- **P1-R1-F3 (required):** Save skipped unresolvable effects contrary to P1
  step 2 without a recorded decision; ADR 0025 Decision 2 lacked "when that
  effect is available".
- P1-R1-F4 (optional): clip validation named `event.<id>.override…`, the
  merge check `events.<id>.override…`, and package import dropped `field`
  from shape errors.
- P1-R1-F5 (optional): Save parsed up to 2 MiB on the event loop.
- Notes: non-strict generated zod (F6); document the new Save reason in P7
  (F7); ADR 0025 lacked an Evidence section (F8); no export→import round trip
  with an override (low risk).

#### Code Review #1 Revisions

- F1 accepted: `_read_json` catches `(ValueError, UnicodeError,
  RecursionError)`, the repository convention; test
  `test_save_ignores_a_clip_too_deeply_nested_to_parse`.
- F2 accepted as a recorded decision (D-8), for owner review with the PR.
- F3 accepted: D-7 recorded; ADR 0025 qualified. Verifying the skip showed
  that Save refuses a missing dependency anyway, so the docstrings now say so
  and `test_save_names_a_missing_effect_rather_than_its_override` pins it.
- F4 accepted: one path, `event.<id>.override…`; package import keeps the
  shape error's `field`.
- F5 accepted: the clip is parsed with `asyncio.to_thread`.
- F6 no change (ADR 0015); F7 added to P7; F8 accepted (Evidence section);
  export→import round trip not added (pass-through, covered by the package
  capability test).
- Verification: 173 tests across the override, Save, package capability and
  idle playback modules; `ruff check`, `ruff format --check` (840 files) and
  scoped mypy pass. Repair budget: one round used.

#### Code Review #2 Findings

Targeted recheck (repair round 1), 2026-10-14: all five fixes hold, no
regressions; D-7 and D-8 records accurate (D-8 visible for owner review).
Checks: scoped ruff and format, scoped mypy, 232 tests including
`test_content_package_event_dependencies.py`. Optional note: D-7 should also
cover a visible but invalid `/2` effect (applied). Result: **pass**.

### P2 — Runtime playback with overrides (D3)

1. Add `loadAvatarVFX(runtimeId, override?)` to `AnimaRuntimeMediaProvider`
   (`AnimaRuntimeMediaCatalog.ts:62–75`) and its implementations: the media
   catalog keeps the raw definition (`avatarVFXSources`); `PreviewMediaProvider`
   learns to keep it. Both pass through `AnimaRuntimeCatalog.ts:579` and
   `PreviewRuntimeCatalogSession.ts:177`. With an override:
   - merge at the definition level;
   - normalize the attachment (`normalizeAvatarEffectAttachment`) and recheck
     `otherEyeImage` and `faceOptions`;
   - parse with the base entry's image URLs and sound;
   - never store the result under the effect id.
2. `Avatar._applyClipOwnedAvatarVFX` and the creator preview dispatch
   (`PoseCreatorClipPreviewSync.tsx:685`) pass `event.override`. A failed
   merge skips the event with a diagnostic (D-3).
3. The override's `soundAlias` (S2) chooses the played sound. An unknown or
   unmounted alias is silent.
4. Confirm that `effects:render --with-clip` and `effects:bench` pick up
   overrides through the Avatar path.

Tests: two events on one effect with different overrides play together, and
each is removed with its own event. An override changes placement, look and
motion on each attachment kind. A failed merge skips with a diagnostic. The
cache never holds a merged entry.
Checks: `pnpm web:test` (affected suites), `pnpm check`, `pnpm web:lint`.

#### P2 record

- Issue #547; starting SHA `7d02443c`; 2026-10-14.
- `applyAvatarEffectOverride` and `parseAvatarEffectUse` in
  `FE/lib/avatar/vfx/definition.ts` follow the backend merge: each part
  replaces the effect's part whole, a kind change throws with field
  `override.attachment.kind`, and the merged definition must still satisfy
  the two definition-level rules (other-eye art needs a mirrored eye or paired
  placement; face options must suit the attachment), helpers now shared from
  `definition.ts`. Attachment-level shape rules (for example `layout` on a
  paired face area) are not rechecked here: the backend checks them for every
  override at Save and package import, and `parseAvatarEffectDefinition`
  already refuses the ones playback depends on. The parse reuses
  `parseAvatarEffectDefinition`.
  A use keeps the effect's sound unless it sets `soundAlias`; the media catalog
  resolves that alias only through the effect's `runtime_reference_map`, so an
  unknown or unmounted alias is silent.
- `AnimaRuntimeMediaProvider.loadAvatarVFX(runtimeId, override?)`: the media
  catalog keeps each loaded effect's resolved images and sound
  (`avatarVFXContexts`) and parses the use from the raw definition, never
  caching it under the effect id; the preview provider keeps each alias's
  `EffectSource` (`effectSourceEntry` takes an override). Pass-throughs:
  `AnimaRuntimeCatalog`, `PreviewRuntimeCatalogSession`. `Avatar` and
  `PoseCreatorClipPreviewSync` pass `event.override`; `effects:render` and
  `effects:bench` use `PreviewMediaProvider`, so they play overrides too.
- A use the effect cannot play resolves to null, with a warning naming the
  field; the Avatar then reports the event as not applied and the clip
  continues (D-3).
- Checks (2026-10-14): `pnpm check` exit 0; scoped ESLint and prettier on the
  changed files; vitest on `src/lib/avatar`, `src/lib/runtime-content`,
  `src/lib/content-preview`, `src/ui/pose-creator`, `src/ui/action-editor`
  and `tests/avatar`: 154 files, 2023 passed (1 skipped), before the per-kind
  test; `definition.test.ts` 16/16 after it.

#### Code Review #1 Findings

Reviewed source: working tree on `7d02443c` (P2 files), independent
`sdlc-reviewer`, 2026-10-14. Checks: 173 targeted vitest tests, ESLint,
prettier, `tsc` for app and scripts, backend and frontend merge probes.

- **P2-R1-F1 (required):** the frontend merge did not recheck cross-field
  rules, so playback played merged definitions the backend refuses (mirrored
  other-eye art moved to a box landmark or unmirrored; face options on the
  wrong attachment). The record's "mirror the backend merge" was inaccurate.
- P2-R1-F2 (optional): the preview provider discarded the error of a use it
  could not play, so the review tools lost the field.
- P2-R1-F3 (optional, tests): no `body` row in the per-kind table; `as never`
  hid test-data types; the skip test does not assert the warning.
- P2-R1-F4 (optional): an override naming the effect's own sound resolved
  more strictly than the default sound.
- Confirmed: every provider and caller, object-URL lifetimes, concurrency, no
  merged entry cached under the effect id, no boundary violations.

#### Code Review #1 Revisions

- F1 accepted: `avatarEffectAcceptsOtherEyeImage` and
  `avatarEffectFaceOptionNames` moved from `vfx/editor/document.ts` to
  `vfx/definition.ts` (re-exported, so the creator is unchanged; avoids a
  circular import); `applyAvatarEffectOverride` refuses a merged definition
  that breaks either rule (field `override.attachment`); three tests. The
  record is corrected and states why attachment-level rules are left to the
  backend.
- F2 accepted: the preview provider adds the error, with its field, to
  `getProblems()`; test.
- F3 accepted in part: `body` row added and test data typed; the warning
  assertion is not added (logger output is not part of the contract).
- F4 accepted: an override that names the effect's own sound keeps the
  effect's resolved sound.
- Verification: vitest on `src/lib/avatar`, `src/lib/runtime-content`,
  `src/lib/content-preview`, `src/ui/pose-creator`,
  `src/ui/avatar-effect-creator`, `src/ui/action-editor`, `tests/avatar`: 165
  files, 2081 passed (1 skipped); `pnpm check` exit 0; scoped ESLint and
  prettier clean. Repair budget: one round used.

#### Code Review #2 Findings

Targeted recheck (repair round 1), 2026-10-14: F1 holds (both probes refused
with `override.attachment`, matching the backend rules), the record is
accurate, F2 and F4 hold. Optional notes: `effects:render` copied the
provider's problems before clip events loaded, so it still dropped an override
problem; no test for an override naming the effect's own sound. Checks: 925
vitest tests, `tsc` for app and scripts, scoped ESLint and prettier. Result:
**pass**. Both notes applied afterwards: the render report reads
`getProblems()` when it reports, and a test pins the own-sound case
(`effect-render.browser.test.mjs` 4/4, `definition.test.ts` 21/21, scripts
`tsc` clean).

### P3 — Action creator editing (D4)

1. In `EventInspector`, an `avatar_vfx` event gets a "This use" section:
   - placement (`AttachmentFields`, exported with an adapter that patches the
     event's override);
   - look (`LookFields`);
   - motion (`AvatarEffectAnimationControls`);
   - a sound picker listing the effect's sounds, when it declares several (S2).

   Direct manipulation uses `AvatarEffectHandleRenderer` and
   `useAvatarEffectManipulation` with the event's applied id. **Reset to
   effect** removes the override. Changing the effect drops the override.
2. Extend `PoseCreatorClipEventDraftPatch` and `patchPoseCreatorClipEventDraft`.
   Saving re-sanitizes through `actionSequenceFromTimelineDraft`.
3. Reuse the existing components and theme tokens, with no new design. Text
   comes from i18n resources.

Tests: patch and clone keep the override; reset and an effect change drop it;
persistence round-trips.
Browser check on the task stack: set an override by fields and by handles,
preview it, save, reopen, export and import. Desktop viewport first, then a
narrow layout. Record the result here.
Checks: `pnpm web:test`, `pnpm check`, `pnpm web:lint`, `pnpm build`.

#### P3 record

- Issue #548; starting SHA `2c588cf8`; implemented 2026-10-14 by a delegated
  agent (P2 files untouched), integrated here.
- Draft patch `override?: … | null` (null removes; changing the effect drops
  the override unless the same patch sets one). Pure helpers in
  `FE/ui/pose-creator/avatarEffectUse.ts`: the effect's definition and declared
  sounds from the preview runtime snapshot, the use's editor document, the
  minimal override (changed parts whole; nothing changed → no override), and
  `editAvatarEffectUse`, which refuses an edit the effect cannot play.
- `PoseCreatorAvatarEffectUse.tsx` ("This use" in the event inspector) reuses
  the creator's `AttachmentFields` (now exported) and `AvatarEffectInspector`;
  Reset to effect; a sound picker when the effect declares two or more sounds.
  `PoseCreatorEffectHandles.tsx` in `ActionEditorScene` reuses the creator's
  handle renderer and manipulation hook (paused, event visible): the art moves
  in place during a drag and the override is written once at the end, as one
  Undo step. `PoseCreatorClipPreviewSync` uses the shared
  `poseCreatorClipAppliedId`. i18n keys `clip.event.accompanyingSoundLabel`
  and `clip.event.use.*` in five locales.
- Checks: vitest on the pose creator, action editor, avatar effect creator
  and `lib/avatar/vfx` (738 passed); `pnpm check` and `pnpm web:lint` exit 0;
  pose-creator suite 176 passed after integration.
- Browser check (2026-10-14, task stack `animama-effect-overrides`,
  development mode, Fingers Crossed after the merge, 1440×900): the section
  shows the left-hand override from the merge; Size 6 → 12 enlarges the star
  in the preview; Undo restores 6 (preview and inspector refresh a moment
  later); Reset to effect removes the override and the star moves to the
  family default beside the head, and Undo restores it; Save writes a valid
  Local Gesture whose clip carries the override (size 0.09) and its
  `soundAlias`; reopening shows the saved values; dragging the star moves it
  under the cursor, updates the position fields and adds one Undo entry.
  Tablet (768×1024) layout works, inspector included. At phone width
  (375×812) the whole editor is clipped, not just this section; not compared
  with `main`. Export and import were not exercised in the browser (backend
  package tests cover overrides).

#### Code Review #1 Findings

Reviewed source: working tree on `2c588cf8` (P3 files), independent
`sdlc-reviewer`, 2026-10-14. Checks: 562 vitest tests, scoped ESLint and
Prettier, `tsc`, `pnpm -s i18n:check`, and a probe that opens and writes back
all 29 Included overrides (29/29 unchanged in content). No blocking findings.

- P3-R1-F1 (optional): no-op detection compared raw JSON, so a typed-back
  value could rewrite an override with reordered keys and record an empty
  Undo step.
- P3-R1-F2 (optional, DRY): the section re-implemented the creator's setting
  problem wording and its canonical JSON helper.
- P3-R1-F3 (optional): the handle overlay and its per-frame renderer stayed
  mounted with no draggable use.
- Notes: the inspector re-renders per playback frame (existing); a drag moves
  the playhead to the event start (existing store behaviour); after Pause the
  stage is focusable before the scrub re-applies (existing); test gaps for
  the sound picker, refusal alert, focus-visit grouping and nudges.

#### Code Review #1 Revisions

- F1 accepted: `sameAvatarEffectOverride` (sorted-key comparison) in both
  components.
- F2 accepted: `avatarEffectSettingProblem` and `canonicalJson` exported from
  `vfx/editor/document.ts` and reused.
- F3 accepted: the overlay and renderer mount only while a use can be dragged.
- Notes not changed (existing behaviour or no defect); test gaps left for the
  browser check above.
- Verification: vitest on the pose creator, action editor, avatar effect
  creator and `lib/avatar/vfx`: 74 files, 738 passed; `tsc`; scoped ESLint
  and Prettier. Result: **pass** at round 1 (no blockers).

### P4 — Library merge and Local transition (D5, D6). Gate G1

1. **Mapping resource** (D-5), generated once by a script from the current
   definitions and committed. The equivalence test pins it.
2. **Family effects:** write `vfx/avatar/<family>/` descriptors (name,
   description, art copied from the default variant, sound edges per D-6).
   Add licence inventory rules and source-review records, an
   `effectTemplates.ts` entry and a thumbnail.
3. **Included conversion:** a repository script (`scripts/content/`) rewrites
   every user in the merge table. Each event's `effectId` points at the
   family alias with its override, and `playAccompanyingSound` is unchanged.
   Each meta has one dependency per family. Gesture provenance texts are
   updated.
4. **Local transition:** add `AvatarEffectMergeTransitionService` after the
   Avatar Effect conversion in `ContentTransitionService.transition`. It
   copies the idempotent mutation pattern and rewrites the clip and the
   descriptor (including dependency `source`) with the same function as step
   3. A failed rewrite leaves the item unchanged: it keeps today's
   missing-effect behaviour and records a diagnostic, without invalidating
   the item. Imported packages are rewritten on their next rescan; package
   bytes are not.
5. **G1:** render before/after sheets for all 40 Actions on both Included
   Avatars (`effects:render --with-clip`), run `effects promote --dry-run`
   with `delete` items for the 24 removed effects, and present the merge
   table, sheets and list. After approval, run the delete.
6. **Clean up:**
   - per-stem inventory rules of removed stems;
   - `effectTemplates.ts` entries and thumbnails;
   - pinned counts (75 → 56; recount and record);
   - `reactionClips.test.ts`, `effect-thumbnails.browser.test.mjs`, the e2e
     specs, `test_avatar_effect_conversion.py`;
   - the `content/included/README.md` count;
   - the integrity test at :202 (several optional pack sounds per effect, S2)
     and the ADR 0022 cross-reference.

Tests: equivalence (D-5); transition rewrite, idempotent rerun and an
unchanged failure case (`tests/test_avatar_effect_merge_transition.py`); a
Local Gesture and a Local Reaction referencing removed variants play as
before; Included integrity, catalog, starter-closure and removed-dependency
tests.
Checks: `uv run pytest -q`, `make check`, `pnpm web:test`, `pnpm check`.
Completion: G1 approved, with no reference to a removed stem outside the
mapping resource and history (`rg` over the repository).

#### P4 record

- Issue #549; starting SHA `2c588cf8`; 2026-10-14.
- `BE/app/services/avatar_effect_merges.py`: `AvatarEffectMerge`,
  `load_avatar_effect_merges` (reads `BE/resources/avatar-effect-merges.json`)
  and `rewrite_action_effect_merges` (twins share one family dependency; an
  event's own override parts win; a silent variant's events get
  `playAccompanyingSound: false`; a taken alias gets a suffix; inputs are not
  modified; `None` when nothing names a merged effect).
- `scripts/content/merge_avatar_effects.py` (one-time, idempotent): wrote
  the five family effects from their defaults with every member's sound
  (`on-apply` for the default's), the merge map, the removed definitions
  (`tests/fixtures/avatar-effect-merge-variants.json`), the 39 rewritten
  Included Actions (formatting kept; Prettier with the frontend config for the
  files it formats, after Code Review #1),
  family licence rules and source-review records, and copied thumbnails. It
  refuses a member whose art bytes, region or face options differ from its
  family's (found D-9).
- `AvatarEffectMergeTransitionService`
  (`BE/app/services/avatar_effect_merge_transition.py`), run by
  `ContentTransitionService.transition` after the Avatar Effect conversion:
  rewrites eligible Local Gestures and Reactions in place under the mutation
  journal; a failure is logged and leaves the Action unchanged and valid.
- `pnpm -s effects promote` keeps all of an effect's sounds on replace (it
  kept only the first). Integrity test: several optional sounds per effect,
  `soundAlias` names one, and an event's chosen sound must be declared.
  `effectTemplates.ts` lists the families; the level-1 Reaction map in
  `tests/avatar/reactionClips.test.ts` names them. Comedy sound pack doc and
  the avatar-vfx skill's promote wording updated.
- Tests: `test_avatar_effect_merges.py` (6), `test_avatar_effect_merge_map.py`
  (equivalence for all 24 removed effects, map coverage, no Included Action
  names a removed effect), `test_avatar_effect_merge_transition.py` (2),
  integrity, catalog, starter closure (needs the new folders tracked: they
  are marked intent-to-add), removed-dependency, `effects.test.mjs` (29),
  `reactionClips.test.ts`.
- G1 evidence (in `.animama-drafts/effects/merge-g1/`, not committed):
  before/after `effects:render --with-clip` sheets of the 40 listed Actions
  at 0.2, 0.6, 1, 1.5 and 2.5 s on both Included Avatars, their pixel diffs,
  and `effects promote --dry-run` of the 24 deletions (48 files and their
  source-review records).
- **G1 (owner, 2026-10-14): approved** deleting all 24 listed effects
  (`badum_burst`, `badum_burst_left`, `cheer_sparkles_head_left`,
  `drumroll_ticks_left`, `finger_gun_spark_left`, `finger_heart_pop`,
  `fist_bump_burst`, `heart_hands_pop_chest`, `heart_throb`,
  `hearts_burst_hands`, `hearts_burst_kyaa`, `hearts_burst_soft`,
  `high_five_burst`, `huff_puff`, `kira_star_head`, `kira_star_tehe`,
  `kira_star_wish`, `kira_star_wish_left`, `kiss_heart_head`,
  `laugh_sparkle`, `pat_hearts`, `please_sparkle`, `shake_lines_left`,
  `sigh_puff`), after seeing the merge table, D-9, the pixel-diff summary of
  all 40 sheets and one before/after pair (fingers-crossed); the owner chose
  to approve rather than review all 40 sheets, which were offered.
- Deletion (2026-10-14, after G1): `pnpm -s effects promote` applied 49
  changes (48 files and their source-review records); 56 Included Avatar
  Effects remain. Cleanup: 23 per-stem licence rules, 24 templates, 24
  thumbnails and their source-review records removed; the thumbnail browser
  test now uses `impact_burst`; pinned counts 75 → 56 in
  `effect-render-sources.test.mjs` and `animation-preview-media.test.mjs`;
  `content/included/README.md` count corrected (it said 73). Tests that used
  removed effects as fixtures now use `kira_star` and `shake_lines`.
- G1 evidence: all 40 before/after diffs ≤ 16 differing pixels of 2.6 M
  (≤ 0.0006 %), on hair and eye edges, 0 on 20 sheets.

#### Code Review #1 Findings

Reviewed source: working tree on `2c588cf8` (P4 files; P3 excluded),
independent `sdlc-reviewer`, 2026-10-14; the deletion and cleanup landed
during the review. Checks: 165 targeted backend tests, ruff, script and
vitest suites, a semantic diff of all 39 Actions (39/39 equal to HEAD through
the rewrite), Prettier with the frontend config.

- **P4-R1-F1 (required):** the script's Prettier run picked up the root
  config (`tabWidth: 4`) and re-indented 18 Gesture clips (+25.8k/−24.9k
  lines), so "formatting kept" was false.
- **P4-R1-F2 (required):** seven Gesture licence texts named a family twice
  after stem replacement.
- **P4-R1-F3 (required):** transition tests used a made-up mapping and only a
  Reaction; #549 asks that a Local Gesture and Reaction play as before.
- **P4-R1-F4 (required):** the deletions were staged without a G1 record.
- **P4-R1-F5 (required):** the plan said 38 Actions; 39 change.
- Post-G1 notes: family licence texts cite removed effects and paths; the
  script cannot rerun; stale counts (25 removed, 75 → 55); ADR 0025's "one
  effect per image and attachment kind" contradicts D-9; the local-content
  storage doc lacks the merge transition (P7).
- Optional: an event's own `"on-apply"` would switch a non-default variant to
  the family default; dependencies written as `id`/`content_id` are not
  rewritten and nothing is logged; no size check on the rewritten clip; D-10
  unrecorded; the map test compared only three parts; a promote `replace`
  naming one sound drops a merged effect's other sounds.

#### Code Review #1 Revisions

- F1 accepted: the 67 rewritten files whose originals Prettier formats were
  re-formatted with `src/frontend/prettier.config.mjs`; the Action diff is
  now +1,096/−169 lines.
- F2 accepted: duplicates removed; a single remaining effect reads in the
  singular.
- F3 accepted: `test_local_actions_naming_removed_effects_play_their_families_as_before`
  runs a Local Gesture (`kira_star_tehe`) and Reaction (`laugh_sparkle`)
  through the real map and checks the played parts, the sound or silence, and
  `check_clip_effect_overrides`.
- F4 accepted: G1 recorded above. F5 accepted: counts corrected throughout.
- Notes: family licence texts and the heart image records say the cited
  effects and paths were removed in the merge (and where the same bytes now
  live); the script says it ran once; stale counts fixed; ADR 0025 Decision 4
  reworded; the storage doc is on the P7 list.
- Optional: own `"on-apply"` now maps to the variant's family sound (test);
  the transition refuses a rewritten clip over 2 MiB; D-10 recorded; the map
  test also compares region and face options. Not changed: `id`/`content_id`
  dependency forms (the creator writes `ref`, as the backend's own Local
  content does) and promote's single named sound (documented in the skill).
- Verification: 72 tests across the merge, map, transition, integrity,
  catalog and closure modules; `ruff check` and `ruff format`. Repair budget:
  one round used.

#### Code Review #2 Findings

Targeted recheck, 2026-10-14: all five fixes hold; 39/39 Actions still match
HEAD through the rewrite and none are re-indented; the same 11 files differ
from Prettier at HEAD and now. Leftover wording (step 5's "25 removed", the
summary's "29 effects become 9", the G1 evidence description, a circular
source-review note) fixed afterwards. Checks: 121 backend tests, ruff.
Result: **pass**.

### P5 — Flipbook frame tooling and skills (F1–F3, D7)

May proceed in parallel with P1–P4 (Q4).

1. **`effects:assets frames <key.png> --mode boil|draw-on --out-dir <dir>`**,
   with options `--frames`, `--seed`, `--amplitude`, `--origin x,y`,
   `--direction`, `--break-off`:
   - `boil`: a seeded low-frequency displacement per frame over the RGBA
     buffer (port `createMulberry32`), 1–2 px at the output size, then
     `applyAlphaThresholds` and `bleedEdges`.
   - `draw-on`: a reveal mask that grows from an origin (radial) or along a
     direction, optionally followed by a break-off that clears from the
     origin outward.

   Frames keep the key's canvas, so face-surface art keeps its UV layout.
   They feed `flipbook` unchanged. Add the options to the allowlists and
   `USAGE`.
2. Tests in `scripts/effect-assets.test.mjs`:
   - frames are deterministic for a seed;
   - frames share the canvas;
   - frames pass `check`;
   - frames assemble with `flipbook`;
   - a draw-on frame 0 shows less than the last reveal frame.
3. **Skills and docs:**
   - `animama-effect-assets` step 7: frame modes; for shape changes, generate
     each frame by editing the previous one with the key as `--ref`.
   - `animama-avatar-vfx`: the flipbook-versus-motion decision rule, the
     upgrade recipe (key = Library image; `loop`/`pingpong` for held
     Reactions, `once` for beats; `--times` spread across frames; Local save;
     promote `replace`), and D7 (place an existing effect through an event
     override instead of authoring a variant).
   - `animama-animation`: `clip-format.md` documents `avatar_vfx` fields
     including `override`; `references/promote.md`.
   - `docs/frontend/runtime/avatar-vfx.md` §9.

Checks: `node --test scripts/effect-assets.test.mjs`, `pnpm web:test`,
`pnpm web:lint`.

#### P5 record

- Issue #550; starting SHA `19919ded`; implemented 2026-10-14 by a delegated
  agent alongside P1 (disjoint files), integrated and reviewed here.
- `effects:assets frames <key.png> --mode boil|draw-on --out-dir <dir>`
  (`deriveFrames`): boil 4 frames, seed 1, amplitude 1.5 px (up to 8);
  draw-on 6 frames, 8 with `--break-off`; 2–64 frames. Output
  `<key>-<mode>-NN.png`; it prints the `flipbook` command (boil 8 fps loop,
  draw-on 12 fps once) and refuses to overwrite the key, also through a
  symlink.
- Skills: `animama-effect-assets` step 7; `animama-avatar-vfx` (flipbook
  decision rule, upgrade recipe, override instead of variant, ownership
  statement, `references/what.md`, `references/how.md`); `animama-animation`
  (decision rule, `clip-format.md` Avatar Effect events, `promote.md`).
  `docs/frontend/runtime/avatar-vfx.md` §9.
- Left for P4 (D-6): the skills' "one licensed sound" wording in avatar-vfx
  step 9 and `references/promote.md`.
- Checks: `node --test scripts/effect-assets.test.mjs` 41/41 after repairs;
  `pnpm web:lint` pass; prettier on both scripts pass; manual runs on the
  Included `question_mark` (boil) and `shock_marks` (draw-on with break-off).

#### Code Review #1 Findings

Reviewed source: working tree on `19919ded` (P5 files only), independent
`sdlc-reviewer`, 2026-10-14. Checks: 40/40 tests, scoped prettier and
ESLint, edge-case probes (odd canvases, 1 px art, 64 frames at 512² in 7.7 s
and 163 MB, 21 Included images' margins).

- **P5-R1-F1 (required):** `--mode` and `--direction` accepted inherited
  object keys (`toString`, `constructor`): `--mode toString` exited 0 and
  printed `--fps undefined`.
- **P5-R1-F2 (optional):** break-off clearing spaced over the softened span
  could leave small art (extent ≤ about 2 × clearing frames) with empty final
  frames, which `check` fails.
- **P5-R1-F3 (optional):** the CLI comment and the doc's `frames/*.png`
  example invited globbing, which mixes frames left by an earlier, longer run.
- Notes: `frames` does not `check` its output; clip-format "must name" should
  be "should name"; what.md wording; one-sound wording to reconcile in P4.

#### Code Review #1 Revisions

- F1 accepted: `Object.hasOwn` for both lookups, plus two refused cases in
  "frame options are checked".
- F2 accepted: clearing spaced over `farthest - nearest`; new test "a break-off
  keeps the far ends of small art in its last frame".
- F3 accepted: comment reworded; the doc example names the frame files.
- Notes: wording fixes accepted; one-sound wording deferred to P4; `frames`
  output check not added (its tests check the frames, and `flipbook` checks
  the sheet).
- Verification: `node --test scripts/effect-assets.test.mjs` 41/41; prettier
  pass. Repair budget: one round used.

#### Code Review #2 Findings

Targeted recheck (repair round 1), 2026-10-14: F1 and F2 fixed (CLI probes
with `toString`, `__proto__` and `constructor` exit 2 and write nothing;
small-art break-off keeps its far ends); wording fixed.

- **P5-R1R1-F1 (required, regression from the F3 revision):** the doc example
  wrote the sheet to `art/mark.png`, over the key it derived the frames from.
- Notes: art whose pixels all sit at one distance (a 1 px dot) still clears
  to empty frames; `--frames 2 --break-off` has no drawing-on frame. Both
  degenerate, no action.

#### Code Review #2 Revisions

- P5-R1R1-F1 accepted: the example writes `art/mark-sheet.png`.
- Repair budget: two rounds used; the final targeted recheck (#3) follows.

#### Code Review #3 Findings

Final targeted recheck, 2026-10-14: the doc example runs as written and leaves
the key unchanged (sha before and after equal); 41/41 tests. No findings.
Result: **pass**.

### P6 — Flipbook conversions (F4). Gates G2 and G3

1. Work in technique batches over the issue's candidate table (named after
   the merge): draw-on, line boil, then generated sequences. Per candidate,
   follow the upgrade recipe in `.animama-drafts/`:
   - `effects check`;
   - render sheets covering its frames;
   - save as Local on the task stack through `effects save`.
2. **G2** per batch: one headed `animation:preview` review page per batch. The
   owner records convert or keep static, with notes resolved through
   `animation resolve`. Line boil on the eye effects is a trial; keep static
   if it distracts.
3. Check each converted effect in its Gestures and Reactions with
   `effects:render --with-clip`. A `loop: once` sheet must cover the event's
   window.
4. **G3:** `effects promote --dry-run` with `replace` items, approved item by
   item, then the run. Sounds are unchanged.

Record the decision table (candidate, technique, frames, fps, loop, outcome)
here.

#### P6 record

Three agents prepared one batch each from `65355f18` on the task stack
(`animama-effect-overrides`, :8900). Each worked only under
`.animama-drafts/effects/` and saved its drafts as Local effects through
`effects save`. Sheets use 256 px cells and no `--trim`, so each effect keeps
its Included canvas, placement and per-use sizes. Drafts dropped
`soundAlias` because `effects save` refuses sounds; the `replace` promotion
keeps the Included sounds.

Not converted by the batch agents. The owner confirmed keeping all four
static on 2026-10-14 (Code Review #1, P6-R1-F1):
- `drumroll_ticks`: a 0.2 s beat turns the reveal into specks.
- `laugh_marks`: held symbols; the reveal delays the pop.
- `blush_band`: a soft gradient with no lines to boil.
- `eye` (`=` bars): filled bars wobble like jelly.

**G2 (2026-10-14).** The owner reviewed the three preview pages (:5175
draw-on, :5176 boil, :5177 drawn frames), found many conversions marginal,
and accepted the agent's recommendation: convert the 23 below and keep 17
static. Two conversions sit outside the literal #543 F4 table:
`steam_puffs`, because the Puff candidate predates the D-9 split, and
`idea_bulb_fingertip`, because it shares Idea Bulb's art. Kept static:
- Cheer Sparkles: the instant pop is punchier.
- Shake Lines: it already jitters.
- Heart Eyes, Eye Confused Swirl, Star3: their own motion hides the boil.
- Eye 0, Eye O, Eye VV: the boil pulls attention from the face.
- Blush, Blush Deep: three times the size for jittery hatch lines.
- Gloomy Cloud: no better than static.
- Kira Star, Sly Glint: the flare is too faint at chat size.
- Soul Wisp: its waver already does the job.
- Tear Flick, Finger Gun Spark: the flash is too brief.
- Sigh Puff Droop: no users.

| Effect | Technique | Frames | fps | Loop | Definition change besides the sheet |
| --- | --- | --- | --- | --- | --- |
| impact_burst | draw-on, break-off | 8 | 20 | once | none |
| shock_marks | draw-on from the fist | 6 | 20 | once | pop-in from 0.7 (was 0.3) |
| emphasis_lines_peek | draw-on from the eye | 6 | 20 | once | pop-in from 0.7 (was 0.3) |
| gloom_lines | draw-on wipe down | 6 | 12 | once | opaque at 0.15 s (was 0.5 s) |
| scratch_ticks | draw-on, break-off, per rub | 16 | 45.45 | loop | none |
| bleh, heh, sorry, rawr lettering | line boil, amp 3.5 | 3 | 8 | loop | none |
| doki_doki | line boil, amp 3.5 | 3 | 8 | loop | none |
| angry, emote, question_mark | line boil, amp 4 | 3 | 8 | loop | none |
| sweat_drop | drawn | 4 | 10 | once | none |
| single_tear | drawn | 4 | 8 | once | pop-in from 0.7 (was 0.2); overshoot 1.05 (was 1.1) at 0.1 s (was 0.35 s) |
| sweat_splash_cower | drawn | 3 | 10 | once | none |
| puff | drawn (6 drawn in 14) | 14 | 8 | once | none |
| steam_puffs | drawn | 6 | 6 | loop | none |
| mind_blown_burst | drawn (5 drawn in 12) | 12 | 10 | once | none |
| idea_bulb, idea_bulb_fingertip | drawn (one sheet) | 5 | 12 | once | none |
| heart_pop | drawn | 4 | 10 | once | none |
| paw_prints | drawn | 4 | 6 | once | none |

Step 3: before and after sheets in `<stem>-work/renders/` cover the users
the batch agents rendered:
- all users of the draw-on effects except fist-bump (impact_burst),
  disappointment-2 and ew-recoil (gloom_lines);
- all 7 users of Puff and 6 of 10 of Heart Pop (caring-2 and gratitude-1/2/3
  share caring-1's override);
- the single users of Idea Bulb Fingertip (have-an-idea), Sweat Splash
  (cower), Steam Puffs (anger-3), Mind Blown Burst (mind-blown) and Paw Prints
  (cat-paws-nya);
- 2 of 4 of Idea Bulb (confidence-2 with an after sheet only), 1 of 8 of
  Sweat Drop and 1 of 2 of Single Tear;
- none of the boil effects, which were rendered on the face only.

`--with-clip library:<gesture>` plays the Included effect, so the agents
rendered copies of the users that point at the draft; the skill now
documents this.

For the rest, Code Review #1 compared each sheet with its events' windows.
Every `once` sheet fits within each event that has an explicit duration,
except Puff: its 1.75 s sheet runs past the 0.8–1.48 s windows in
deflated-sigh, phew-brow-wipe, pout-huff and stretch-break. The sheet holds
the key frame until 1.375 s. In phew-brow-wipe, pout-huff and stretch-break
the fade therefore ends the puff as before. In deflated-sigh (1.48 s, 0.15 s
fade) the first break-up frame shows in the last 0.1 s of the fade. Boil
sheets loop and keep each effect's canvas and motion.

**G3 (2026-10-14).** `effects promote --dry-run` listed 70 changes for the
23 `replace` items. The definition diffs held only the sheet, its
`art.flipbook` and the four motion changes above, and kept names and
sounds. Seven of the effects had owner-authored art that now holds generated
frames: sweat_drop, single_tear, puff, steam_puffs, idea_bulb,
idea_bulb_fingertip and heart_pop. The owner approved all 23, those seven
moving to agent-authored records. The run applied 70 changes. The
promoted art is about 2.4 MB, from about 2.8 MB.

After the run:
- **Licence records.** `replace` had written generic owner-attestation
  records for all 46 written files, including agent-authored definitions and
  generated art. JSON records were restored from `HEAD`. Each sheet's record
  was rebuilt from the image it replaced, saying how its frames were made.
  The seven sheets above got exact agent-authored inventory rules ahead of
  `vfx/avatar/**/*`. Rules that named a replaced image now name the sheet.
- **Thumbnails.** All 23 template thumbnails were regenerated. Impact Burst
  (at 0.18 s, without its pose clip; it sits at the hips) and Mind Blown
  Burst (at 0.95 s) were retimed, because a thumbnail's clip time is also the
  effect's age, and at the old times their sheets had broken up.
- **Tests.** `tests/test_optional_sound_dependencies.py` and the
  playback-library and accountless-library journeys named the old images.
  They now name the sheets.
- **Tooling (F1/F3 follow-through).** `frames --mode boil` defaults to 1.25% of
  the key's longer side (3.2 px at 256 px; the old 1.5 px was invisible at
  chat size) and prints the amplitude. Its `flipbook` hint no longer suggests
  `--trim`. Skills and `docs/frontend/runtime/avatar-vfx.md` updated.

Checks:
- `node --test scripts/effect-assets.test.mjs`: 41/41.
- Backend content tests (`test_included_content_integrity`,
  `test_optional_sound_dependencies`, merge map and transition, portability,
  non-portable, pose content, package HTTP, override save): 96 passed.
- `vitest run src/lib/effects src/lib/avatar/vfx src/ui/avatar-effect-creator`:
  239 passed.
- Prettier check of the touched scripts, templates and journeys.
- `pnpm -s effects check library:included/<each of the 23>` on the task
  stack, run by the reviewer in Code Review #1: all pass.
  - WARN padding on the scratch_ticks, sweat_drop and sweat_splash sheets.
  - WARN time visibility on scratch_ticks, single_tear and steam_puffs (its
    motion loop's opacity is 0 at 1 s).
  - heart_pop and idea_bulb_fingertip (hand art) fail "no visible art" at
    rest and pass with `--with-clip library:finger-heart-pose` and
    `--with-clip library:have-an-idea --times 2.9,3.3`.

Not performed: live chat playback and sound of the promoted effects.

Known cosmetic issue, deferred: Idea Bulb's first three frames (also used
by Idea Bulb Fingertip) touch the cell's bottom edge. The bulb's base is
clipped by about 4 px, and linear filtering can bleed half a texel into the
next row of frames. The owner reviewed the sheet live.

#### Code Review #1 Findings

Reviewer: independent `sdlc-reviewer`. Source: `65355f18` plus the P6
working tree (P7 hunks excluded).
- **P6-R1-F1 (required):** `drumroll_ticks`, `laugh_marks`, `blush_band`
  and `eye` had no recorded owner decision (#543 F4: every candidate has
  one).
- **P6-R1-F2 (required):** the record claimed every promoted effect was
  rendered in all its users; coverage was partial.
- **P6-R1-F3 (required):** no `effects check` evidence for the promoted
  Included effects.
- **Optional:**
  - single_tear's overshoot change was unrecorded;
  - the tooling section was labelled D7 (it is F1/F3);
  - why steam_puffs and idea_bulb_fingertip are outside the F4 table;
  - Idea Bulb frame clipping;
  - licence prose that named deleted images as current;
  - `deriveFrames` JSDoc omitted `amplitude`;
  - two over-long doc lines;
  - key reordering from promote (no semantic change).

The reviewer verified:
- the definitions change only the sheet, `art.flipbook`, files and the
  recorded motion edits;
- every cell keeps the replaced image's aspect, with no trim;
- each drawn sheet holds the old image as an exact frame;
- inventory first-match and source-review completeness;
- G3 counts and the thumbnail retimes.

#### Code Review #1 Revisions

- **P6-R1-F1:** accepted. The owner kept all four static (2026-10-14),
  recorded above.
- **P6-R1-F2:** accepted. The record now states the actual render coverage
  and the window analysis. The boil sheets are not rendered per user,
  because they loop on the same canvas and motion.
- **P6-R1-F3:** accepted. The reviewer's `effects check` results are
  recorded under Checks.
- **Optional items:**
  - accepted: the single_tear row, the F1/F3 label, the F4 table note, the
    licence prose ("was removed with this change"; replacement notes on the
    puff and idea_bulb_fingertip rules), the JSDoc and both reflows;
  - deferred: Idea Bulb clipping (cosmetic, owner-reviewed);
  - not changed: key order.

#### Code Review #2 Findings

Targeted recheck of the round-1 revisions. P6-R1-F1 to F3 and the
accepted optional items are resolved; the inventory's globs and order are
unchanged.
- **P6-R2-F1 (required):** the Puff window analysis was wrong for
  deflated-sigh. The key frame is held only until 1.375 s, so the first
  break-up frame shows near the end of its fade.
- **P6-R2-F2 (optional):** the Step 3 list left out five fully rendered
  single-user effects.
- **P6-R2-F3 (optional):** a line in the `frames` paragraph of
  `docs/frontend/runtime/avatar-vfx.md` was still over-long.

#### Code Review #2 Revisions

- **P6-R2-F1:** accepted; the window analysis now states the hold and the
  deflated-sigh case. This is a record correction; the owner reviewed Puff
  live and its content is unchanged.
- **P6-R2-F2:** accepted; the five users are listed.
- **P6-R2-F3:** accepted; the paragraph is rewrapped.
- Repair budget: two rounds used; the final targeted recheck (#3) follows.

#### Code Review #3 Findings

Final targeted recheck, 2026-10-14: the three round-2 fixes are correct
(the Puff windows match frame `floor(elapsed × 8)` and the cell order; each
newly listed user has before and after sheets; the doc paragraph is at most
77 characters wide and only the amplitude default changed), and the Code
Review #2 sections match. No findings. Result: **pass**.

### P7 — Documentation and acceptance

- Glossary "Avatar Effect": the event may override placement, look and motion
  per use. The new ADR is finalized and indexed.
- `docs/frontend/runtime/avatar-vfx.md` §7 and §3, and backend
  typed-content docs where they describe Action events, including the Save
  reason `action_effect_override_invalid` and its `event.<id>.override…`
  field (`docs/backend/features/typed-content-and-marketplace.md`).
- The skills' "one licensed sound" wording (avatar-vfx step 9,
  `references/promote.md`): done in P4; `docs/frontend/runtime/sound.md`
  done in P7.
- `docs/backend/architecture/local-content-storage.md`: the merge transition
  beside the `/1`→`/2` conversion.
- Full local checks (below) and the full `pnpm e2e:test` on a purged built
  stack.

#### P7 record

Docs: GLOSSARY "Avatar Effect"; `docs/frontend/runtime/avatar-vfx.md` §1, §3
step 4, §7 and §11; `sound.md`; `local-content-storage.md`;
`typed-content-and-marketplace.md`; ADR 0025 is accepted and indexed
(`fa7a3223`).

Full local checks at `fa7a3223` (`45a7e4cd` fixed the two failures):
- `uv run pytest -q -n auto`: 4257 passed, 29 skipped.
- `make check`: failed at mypy, with four type errors in P4 code
  (`avatar_effect_merges.py` and two tests). Fixed; it then passed.
- `make audit-typed-content` and `uv run ruff check`: pass.
- `pnpm check`, `pnpm web:lint`, `pnpm prettier:check`,
  `pnpm desktop:check`, `pnpm build` and `pnpm openapi-ts:check`: pass.
- `pnpm web:test`: 28 failures in `includedClipBaseline.test.ts`. They are
  exactly the 28 Gestures P4 rewrote. Re-recording the baseline showed every
  sample unchanged; only the file hashes moved. After the rebaseline, 4778
  passed and 1 skipped.

D4 export/import check (final review FI-R1-F2; the owner chose an API round
trip plus a browser reopen), on the task stack:
- Exported the Local Gesture "Fingers Crossed Custom" through
  `/v1/content/package-exports`. The package kept both `avatar_vfx`
  overrides, including `soundAlias`.
- Imported it as "Fingers Crossed Custom-2" with a Local copy "Kira Star-2".
  Both events' overrides are identical to the original's.
- Reopened it in the Action creator in the browser pane. The left event's
  **This use** shows Left hand, Right 14.7, Up 1.6 and Forward 8.2 cm, size
  9 cm and rotation 10°.
- The imported effect copy has no licensed sounds (ADR 0022), so no sound
  choice shows and the stored `soundAlias` plays silent, as designed.

Main merges (owner request, 2026-10-14):
- `fc077dba` merged #557 (companion content: 4 Gestures and 14 Avatar
  Effects) and #556. Resolutions:
  - `source-review.json`: the union of both sides' records, with no
    conflicting path.
  - Effect templates: main's new ones, without its stale `huff_puff` and
    `heart_throb` lines.
  - Effect counts 56 + 14 = 70; README now 111 Gestures, 72 Reactions and
    70 Avatar Effects.
  - `CORE_LIBRARY_ROOTS` and the closure test no longer name the merged
    `hearts_burst_soft`. The test's shared starter effects now name `puff`
    and `hearts_burst` instead of the merged `sigh_puff`.
  - No new Action names a removed effect.
- `339ff3a0`: D-11.
- `bcec0cd0` merged #558 (voice audio tags). Only `source-review.json`
  conflicted, resolved the same way.

Full local checks at `bcec0cd0` (after both merges):
- `uv run pytest -q -n auto`: 4520 passed, 29 skipped.
- `make check`, `make audit-typed-content` and `uv run ruff check`: pass.
- `pnpm check`, `pnpm web:lint`, `pnpm prettier:check`,
  `pnpm desktop:check`, `pnpm build` and `pnpm openapi-ts:check`: pass.
- `pnpm web:test`: 4923 passed, 1 skipped.

Full `pnpm e2e:test`:
- Run `run-1014183141` at `bcec0cd0` on the purged built stack
  `animama-effect-overrides` (production mode, `ANIMAMA_LLM_SKIP=1`):
  39 passed and 1 failed in 31.6 min.
- The failure was the template-picker journey's pinned 89 thumbnails
  (received 70); FI-R3-F1 fixed it in `fcf091ac`.
- `pnpm e2e:test -- --project chromium --no-deps --grep "accountless effect
  template"` at `fcf091ac`, on the same stack: 2 passed. `fcf091ac` changed
  no application source; the other edits were docs.
- An earlier full run, stopped when main moved, left a lock owned by the
  old hostname; its process was dead, so the lock was moved into that run's
  evidence (`run-1014180329`).

## Final integration review

One full review of the combined scope against #543 acceptance, reusing still
valid phase evidence. At most two repair rounds.

#### Final Integration Review #1 Findings

Independent `sdlc-reviewer`, at `fa7a3223`. No correctness, security or
boundary defects across the phase seams.
- **FI-R1-F1 (required):** shake_lines, drumroll_ticks and finger_gun_spark
  descriptions told users to pair them with deleted Left twins.
- **FI-R1-F2 (required):** D4's export and import were never exercised in
  the browser.
- **FI-R1-F3 (required):** the plan record was incomplete or stale:
  - P7 progress was unchecked;
  - phase commits were missing;
  - the idempotence text still called the script rerunnable;
  - the outcomes section was empty.
- **Optional:**
  - PR disclosure of the shipped counts (24 deleted, 75 → 56, 39 Actions)
    against #543/#549's pre-D-9 text, and of D-8;
  - ADR 0025's stale "17 instead of 9" and its missing evidence;
  - §7's "owns its own motion";
  - no troubleshooting row for an override that cannot play;
  - the merge script docstring's contradiction;
  - Impact Burst's held tip ring in fist-bump, the one user not rendered.

#### Final Integration Review #1 Revisions

- **FI-R1-F1:** accepted. The owner approved replacing the sentence with
  "Gestures place it on either hand." in all three descriptions.
- **FI-R1-F2:** accepted. The round trip and reopen are recorded in the P7
  record.
- **FI-R1-F3:** accepted. Progress, phase commits, idempotence, the P7
  record and outcomes are updated.
- **Optional items:**
  - accepted: ADR 0025 (alternative reworded; merge map, equivalence test
    and transition added to Evidence), §7 wording, a §11 row, and the script
    docstring;
  - PR disclosure: the PR body states the counts and D-8;
  - Impact Burst: the owner approved the conversion; fist-bump is left for
    the e2e and live passes.

#### Final Integration Review #2 Findings

Targeted recheck at `e70a367d`. FI-R1-F1 to F3 and the optional items are
fixed; the 28 rebaselined clips changed only their file hashes.
- **FI-R2-F1 (required):** the Outcomes count said 5 families plus Steam
  Puffs; 10 effects remain.
- **Optional:** P7 progress said the e2e run was recorded; the follow-ups
  have no issues yet; #555 may affect the `@complete-anima` journeys.

#### Final Integration Review #2 Revisions

- **FI-R2-F1:** accepted; fixed in `2d97e504`. The rest is addressed in the
  P7 record and the PR.

#### Final Integration Review #3 Findings

Final targeted recheck (last round) at `bcec0cd0`, after the main merges and
D-11. FI-R2-F1 is fixed. The merge resolutions are verified:
- `source-review.json` is the exact three-way union;
- 70 templates, effects and thumbnails;
- core roots and locators match (40 each);
- the shared starter effects are exact;
- no Action names a merged effect, and all 29 overrides still validate.

D-11 is consistent (99 unique starter IDs; existing starter Animas pick the
Gestures up at runtime).
- **FI-R3-F1 (required):** the template-picker journey still expected 89
  thumbnails. P4 never updated it, and the merge auto-merged main's
  75 → 89.
- **FI-R3-F2 (required):** `mixamo-acquisition.md` still said 95 of 99
  starters.
- **Optional:** main's promote guidance told promoters to add every new item
  to `CORE_LIBRARY_ROOTS`, which conflicts with the starter oracle for a new
  non-idle Gesture.

#### Final Integration Review #3 Revisions

- **FI-R3-F1:** accepted; `toHaveCount(70)`. The journey was rerun after the
  fix (P7 record).
- **FI-R3-F2:** accepted; it now says "all 99".
- **Optional:** accepted. The animation promote guide and
  `runtime-staging.md` now say a new non-idle Gesture joins the starter
  loadout, and other new items join the core roots.
- The review budget is spent. Both fixes are one-line changes, verified by
  the rerun journey and by reading; they are listed for the owner in the PR.

## Validation and acceptance

| #543 criterion | Evidence | Phase |
| --- | --- | --- |
| D1–D3 | Contract, clip, Save, package and runtime tests; parity fixtures | P1, P2 |
| D4 | Creator tests; browser check record | P3 |
| D5 | Equivalence test; G1 sheets and approved delete list; repository search | P4 |
| D6 | Transition tests; Local Gesture and Reaction playback | P4 |
| D7, F2, F3 | Skill and doc changes reviewed | P5, P7 |
| F1 | `effect-assets` tests | P5 |
| F4 | Decision table; G2 and G3 records; clean `effects check` | P6 |
| Checks | Full local suites and full `pnpm e2e:test` | P7 |

Before the PR, run from the repository root `uv run pytest -q`, `make check`
and `uv run ruff check`. From `src/frontend`, run `pnpm check`,
`pnpm web:lint`, `pnpm prettier:check`, `pnpm desktop:check`, `pnpm web:test`,
`pnpm build`, a `pnpm openapi-ts` freshness check, and the full
`pnpm e2e:test` on a purged built stack. Hosted validation is disabled today.
Unless the owner approves a run, the PR states that no hosted checks ran.

## Idempotence and recovery

- **Contract:** an event without an override is unchanged everywhere, so
  existing content needs no migration for P1–P3.
- **Included conversion:** the script ran once (2026-10-14) and cannot run
  again now that the variants are deleted; its writes are reviewable Git
  changes, reverted with Git.
- **Local transition:** idempotent per item and revision. Originals are
  retained under the transition operations root. A failed item keeps today's
  missing-effect behaviour.
- **Removal order:** family effects and rewritten users land before
  `effects promote` deletes the variants (delete refuses while references
  remain), so starter closure never sees a missing effect.
- **Drafts:** flipbook drafts live in `.animama-drafts/` and the task stack's
  Local content. Export approved Local items to a package before cleaning up
  the worktree or stack.
- **Database:** no schema change is expected. If one is needed, update the ORM
  and `alembic/versions/0001_baseline.sql` directly.

## Outcomes & Retrospective

Delivered (2026-10-14, pending merge approval):
- `avatar_vfx` events can override an effect's placement, look, motion and
  sound for one use. They are validated at Save and package boundaries,
  played by every runtime path and edited in the Action creator's **This
  use** panel.
- 29 duplicate Included effects became 10: 5 new families, 4 right-hand
  mirrors and the kept Steam Puffs (24 deleted and 5 added, 75 → 56). 39 Included Actions were rewritten, and Local
  Actions are rewritten by a journaled transition.
- `frames` derives boil and draw-on flipbooks. 23 Included effects were
  converted at the owner's G2 and G3; 21 candidates stay static.

Lessons:
- Phase reviews ran targeted checks only. mypy and the Included clip
  baseline caught P4 issues only at the P7 gate. Run `make check` and the
  pinned baselines in the phase that changes Included content.
- `effects promote` `replace` overwrites licence records. Follow-up:
  "Keep licence records on effect promote replace".
- Drafts can't be rendered inside Gestures at event time. Follow-up:
  "Render draft effects inside Gestures by event time".
