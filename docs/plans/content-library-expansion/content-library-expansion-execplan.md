# Expand and restyle the Gesture and effect library

Source agreement: parent issue
[#575](https://github.com/raymond-van/animama/issues/575) (goals G1–G4, owner
decisions of 2026-10-15).
Authorized scope: the whole plan, Phases 1–5 (owner, 2026-10-15).
Branch: `feat/content-library-expansion` in its own worktree, created at
`dca4af86` (`origin/main`, 2026-10-15). One PR for the whole plan.

## Purpose and context

Owners chat with one Anima whose Avatar plays Gestures and Reactions, and
those play Avatar, Particle and Scene Effects. The Included library has 111
Gestures, 87 Avatar Effects and 30 Particle Effects. This plan adds 20 new
Gestures, restyles the off-brand Avatar Effects, adds new Avatar and Particle
Effects and pairs them with the new Gestures. It changes content only; no
runtime, creator or backend code.

House styles agreed for this plan:

- **Avatar Effects:** colored manga with light screentone and a hand-drawn
  pencil, crayon or marker texture, each a flipbook (drawn frame by frame
  when the shape changes, otherwise a line boil from one key image). No new
  lettering. Style anchors among the current effects: `craving_drool`,
  `steam_puffs`, `teary_sparkle_eyes`, `tehe_star`, `happy_flowers`,
  `stomach_butterflies` and the boiling letterings. Glossy, plastic or flat
  vector art is off-brand.
- **Particle Effects:** the glowing 3D look of `sparkle-hearts`; the
  hand-drawn style does not apply.
- **Gestures:** rich, multi-joint motion with weight through the hips and
  pelvis, staggered regions, readable holds and an unhurried settle;
  references `hysterical-laughter`, `stretch-break`, `double-take` and
  `soul-leaves-body`. Expressions are keyed on the beats.

Authoring is delegated to Codex CLI agents (at most four at a time, owner
2026-10-15) that follow the repository content skills; the orchestrating
agent reviews their render sheets and decides what is kept, revised or
dropped before the owner's live review.

## Progress

- [x] 2026-10-15 Owner agreed the Gesture list and the Avatar and Particle
  Effect lists; issue #575 opened.
- [ ] Phase 1: Gesture drafts.
- [ ] Phase 2: Avatar Effects, batches A and C.
- [ ] Phase 3: Particle Effects.
- [ ] Phase 4: Avatar Effects, batches B and D; Gesture effect events.
- [ ] Phase 5: owner review, save, promote and journeys.

## Decision Log

- 2026-10-15 owner: 20 Gestures; table flip, shoulder shimmy, achoo, ninja
  seals and mic drop replaced (a mic that falls when the hand opens cannot be
  done reliably) by excited two-arm wave, jazz-hands ta-da, sniff sniff, big
  arm heart and idol glowstick cheer. Rock Paper Scissors ships as three
  throws (`rps_rock`, `rps_paper`, `rps_scissors`).
- 2026-10-15 owner: Gesture durations about 15% longer than first briefs;
  earlier generated Gestures looked rushed.
- 2026-10-15 owner: replace angry, heart_eyes, money-eyes, little-devil-horns,
  mind_blown_burst, tiny-victory-crown, suspicious-side-eye and
  streaming_tears; replace Musical Cascade and Hearts v1; approve the agent's
  further replacement and new-effect lists in #575.

## Gates

| Gate | When | Owner action | Effect |
| ---- | ---- | ------------ | ------ |
| G1 | After each batch's drafts | Review items in the live preview (`animation:preview` Review picker) and leave notes | Approved drafts are saved as Local content |
| G2 | Before promotion | Approve each item and the promote dry-run list (adds and replacements) | Only approved items enter `content/included/` |
| — | Before merge | Exact-candidate merge approval | Separate from G1/G2 |

## Phased implementation

Commands run from `src/frontend/web` unless noted. Drafts live in the
Git-ignored `.animama-drafts/`; render sheets stay outside the repository.

### Phase 1: Gesture drafts (G1 of #575)

Author the 22 clips from the confirmed briefs with `animama-animation` batch
mode: `animation validate` and `animation check` with zero FAIL, render sheets
on both Included Avatars, a consistency pass across the batch, then one
`animation:preview` session for the owner. Save approved clips with
`animation:save`.

### Phase 2: Avatar Effects, batches A and C

Art through `animama-effect-assets`, folders and checks through
`animama-avatar-vfx` (`effects check`, `effects:render`, preview, `effects
save`). Batch A replacements are revised from their Library items and saved
under the same names so a later `promote` with `mode: "replace"` keeps their
identity.

### Phase 3: Particle Effects

Two replacements and eight new effects through `animama-particle-vfx`, in the
`sparkle-hearts` style; textures through `animama-effect-assets`.

### Phase 4: Avatar Effects B and D; pairing

Batch B replacements and batch D new effects as in Phase 2. Add action-bound
effect events to the new Gestures (reusing Included effects through event
`override` where possible) and re-run checks and renders.

### Phase 5: review, promote and journeys

Owner live review of every remaining item, `promote --dry-run` lists for each
kind, promotion of approved items (effects before the Gestures that depend on
them), then the full browser journeys.

## Validation and acceptance

- Per item: `pnpm -s animation validate`, `pnpm -s animation check`,
  `pnpm -s effects check` — zero FAIL; accepted WARNs listed in the PR.
- Before merge: `pnpm -s effects check` over the promoted folders, `pnpm
  check`, and `pnpm e2e:test` from `src/frontend` on a disposable built stack.

## Idempotence and recovery

Drafts and saves are repeatable: `animation:save` and `effects save` revise an
existing Local item with the same Selector ID or name instead of duplicating
it. Promotion is reviewed with `--dry-run` first; a wrong promotion is undone
by reverting its commit.

## Outcomes & Retrospective

To be completed at the end of the plan.
