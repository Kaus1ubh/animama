# Everyday and romance Gestures, new effects and a Scene FX restyle

Source agreement: parent issue
[#585](https://github.com/raymond-van/animama/issues/585) (goals G1–G5, owner
decisions of 2026-10-15).
Authorized scope: the whole plan, Phases 1–5 (owner, 2026-10-15).
Branch: `feat/content-library-wave-2` in its own worktree, created at
`b1ccb485` (`origin/main`, 2026-10-15). One PR for the whole plan.

## Purpose and context

This is the second content wave after
[#575](https://github.com/raymond-van/animama/issues/575), whose plan
(`docs/plans/content-library-expansion/`) set the house styles, the delegated
authoring workflow and the promotion steps reused here. It adds 20 Gestures
(everyday, expressive and romance), 9 Avatar Effects including four hand-held
props, 8 Particle Effects, kiss lips for the two blow-a-kiss Gestures, a
`doki_doki` redraw without lettering, and a restyle of the symbol sprites in
the Included Scene Effects.

Rules agreed for this wave, on top of the first wave's house styles:

- No mimed objects or invisible partners. A Gesture that holds something
  holds a real hand-attached Avatar Effect prop (like `glowstick`).
- No new heart effects and no lettering.
- Scene Effects keep their backgrounds, patterns, rays, spotlights and light
  sprites. Only the scattered symbol sprites are redrawn, at the same file
  names, sizes and placements.

## Progress

- [x] 2026-10-15 Owner agreed the lists; issue #585 opened.
- [x] Phase 1: Gesture drafts, agent and owner review rounds (G1).
- [x] Phase 2: Avatar Effects (props, new effects, `doki_doki`).
- [x] Phase 3: Particle Effects.
- [x] Phase 4: Scene FX sprite restyle; pairing; blow-a-kiss revisions.
- [x] Phase 5: owner approval (G2), save and promotion (`741032db`).
- [x] Eyelid correction (owner-added scope, `8b445fed`).
- [ ] PR and merge approval.

## Decision Log

- 2026-10-15 owner: replaced casual salute, eye rub, money rub and tea sip
  with romance Gestures; then replaced chin-in-hands and slow dance (mimed or
  invisible partner) and hair twirl (hard to get right). Final romance set:
  confession_letter_bow, offer_a_rose, lean_in_coy, mojimoji_shy_sway,
  hand_hold_offer.
- 2026-10-15 owner: dropped coin-shower, brain_gears, soap-bubbles and
  ghost-wisps (overlaps `gloom-wisps` and `hitodama_flames`); no new hearts,
  so the planned heart arrow and cupid hearts became `cupid_arrow_stuck` and
  `rose-bloom-burst`.
- 2026-10-15 owner: blow-a-kiss Gestures play floating kiss lips
  (`kiss-lips-float`) instead of their heart effect; `doki_doki` lettering
  becomes heartbeat pulse lines.
- 2026-10-15 agent: `detective_squint` holds a `magnifier` prop instead of
  miming a lens.
- 2026-10-15 owner: removed `mojimoji_shy_sway`; renamed the tilt to
  `surprised_head_tilt` and the snicker to `snicker_laugh`; `offer_a_rose`
  keeps the rose prop and blush without a particle; `checking_phone` kept
  with a camera-facing phone in the palm.
- 2026-10-15 owner: fix over-closed eyelids (blink on top of happy/relaxed)
  at runtime in this PR, calibrated per Avatar, with preview/render parity;
  happy closes the lids more than relaxed.
- 2026-10-15 owner: browser journeys skipped for this PR; Codex agents used
  for drafting, Claude agents for the rest.

## Gates

| Gate | When | Owner action | Effect |
| ---- | ---- | ------------ | ------ |
| G1 | After each batch's drafts | Review in `animation:preview` (Prev/Next through the batch) and leave notes | Approved drafts are saved as Local content |
| G2 | Before promotion | Approve items, new-effect sounds, licence wording and the promote dry-run list | Only approved items enter `content/included/` |
| — | Before merge | Exact-candidate merge approval | Separate from G1/G2 |

## Phased implementation

Commands run from `src/frontend/web`. Drafts live in the Git-ignored
`.animama-drafts/`; render sheets stay outside the repository. Authoring is
delegated to at most four Codex agents at a time, each following the content
skills, with a save lock so two creator saves never overlap.

- **Phase 1:** 20 Gesture clips (`animama-animation` batch mode),
  +15% timing over first briefs, expressions keyed on beats.
- **Phase 2:** Avatar Effects through `animama-effect-assets` and
  `animama-avatar-vfx`; props are body attachments on a hand bone checked
  `--with-clip` in their Gesture.
- **Phase 3:** Particle Effects through `animama-particle-vfx`, compared side by
  side with `sparkle-hearts`.
- **Phase 4:** Scene sprite redraws through `animama-effect-assets` and
  `animama-scene-vfx`, saved as Local revisions of each Scene Effect; effect
  events paired into the new Gestures and the two blow-a-kiss Gestures.
- **Phase 5:** owner review, `effects save` / `animation:save` (with
  `project` items for effect dependencies), promote dry-runs, promotion,
  thumbnails and pinned counts and Included checks (browser journeys skipped by owner decision).

## Validation and acceptance

- Per item: `pnpm -s animation validate`, `pnpm -s animation check`,
  `pnpm -s effects check` — zero FAIL; accepted WARNs listed in the PR.
- Before merge: backend Included/starter tests, `pnpm check`, `pnpm web:lint`,
  `pnpm build`, focused content tests and `make format-check`. `pnpm e2e:test`
  is skipped for this PR (owner, 2026-10-15).

## Idempotence and recovery

Saves revise Local items with the same Selector ID or name. Promotion is
dry-run first; a wrong promotion is undone by reverting its commit.

## Outcomes & Retrospective

Delivered: 19 Gestures (152 Included), 9 Avatar Effects including four
hand-held props (109 Included), 8 Particle Effects, `doki_doki` redrawn as
heartbeat lines, symbol sprites redrawn in 32 Scene Effects, kiss lips for
both blow-a-kiss Gestures, and a runtime eyelid correction
(`src/frontend/web/src/lib/avatar/eyelidClosure.ts`).

Validation is recorded in the PR. Lessons: props work as hand-attached Avatar
Effects when the grip and the attachment are fitted together, and a
camera-facing attachment reads better than a bone-facing one for flat props;
VRoid mood expressions already close the eyelids, so blink needs an
overrideBlink-style correction rather than per-clip thresholds.
