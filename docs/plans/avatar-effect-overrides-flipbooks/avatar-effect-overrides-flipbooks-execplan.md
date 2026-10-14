# Per-use Avatar Effect overrides and flipbook effects

Source agreement: [#543](https://github.com/raymond-van/animama/issues/543)
(the issue is the spec; agreed revision updated 2026-10-14T18:02:23Z, with
Q1–Q5 and the accepted plan proposals), and the Decision Log below.
Authorized scope: the whole plan, approved by the owner on 2026-10-14 (G0).
Gates G1–G3 and merge approval remain.
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
   merges Avatar Effects that share art: 29 effects become 9. Local Actions
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
| | `steam_puffs` | `irritated_02` | Reaction anger-3 |
| Shake Lines (`shake_lines`) | `shake_lines`, `shake_lines_left` | `wobble_short` | cower, ew-recoil, grr-fists (both) |
| Finger Gun Spark (`finger_gun_spark`) | both twins | `retro_laser_focus_02v1` | cheeky-finger-guns (both) |
| Drumroll Ticks (`drumroll_ticks`) | both twins | `drum_tremolo_01` | drumroll (both) |
| Cheer Sparkles (`cheer_sparkles_head`) | both twins | `correct_answer_04` | celebration (both) |

In total, 28 Gestures and 12 Reactions change. The five multi-variant
families take new neutral stems. The four mirror pairs keep the right-hand
stem, so only the left twin's users change (D-4). That removes 25 effects
(21 family variants and 4 left twins) and adds 5, so 75 → 55.

## Progress

- [x] Plan drafted (2026-10-14) from `19919ded`.
- [x] G0 (2026-10-14): the owner approved the plan, D-2–D-5 and D-6 (S2).
- [x] Preparation (2026-10-14): decisions published to #543 and read back;
  phase issues #546–#552 created; dependencies installed.
- [x] P1: Override contract and validation (D1, D2), 2026-10-14; review
  passed at round 2. D-8 is for owner review with the PR.
- [x] P2: Runtime playback with overrides (D3), 2026-10-14; review passed at
  round 2.
- [ ] P3: Action creator editing (D4).
- [ ] P4: Library merge and Local transition (D5, D6). Gate G1.
- [x] P5: Flipbook frame tooling and skills (F1–F3, D7), 2026-10-14; review
  passed at round 3. Commits: P1 `c32edd57`, P5 `7d02443c`.
- [ ] P6: Flipbook conversions (F4). Gates G2 and G3.
- [ ] P7: Documentation and acceptance.
- [ ] Final integration review.

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
   with `delete` items for the 25 removed effects, and present the merge
   table, sheets and list. After approval, run the delete.
6. **Clean up:**
   - per-stem inventory rules of removed stems;
   - `effectTemplates.ts` entries and thumbnails;
   - pinned counts (75 → 55; recount and record);
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

### P7 — Documentation and acceptance

- Glossary "Avatar Effect": the event may override placement, look and motion
  per use. The new ADR is finalized and indexed.
- `docs/frontend/runtime/avatar-vfx.md` §7 and §3, and backend
  typed-content docs where they describe Action events, including the Save
  reason `action_effect_override_invalid` and its `event.<id>.override…`
  field (`docs/backend/features/typed-content-and-marketplace.md`).
- The skills' "one licensed sound" wording (avatar-vfx step 9,
  `references/promote.md`) if P4 has not already changed it.
- Full local checks (below) and the full `pnpm e2e:test` on a purged built
  stack.

## Final integration review

One full review of the combined scope against #543 acceptance, reusing still
valid phase evidence. At most two repair rounds.

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
- **Included conversion:** the script is rerunnable (it skips users already
  rewritten); its writes are reviewable Git changes, reverted with Git.
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

Not started.
