# Deliver the expanded Included Gesture catalog with action-bound effects

Source agreement: [spec](gesture-catalog-expansion-spec.md) for issue #409. It
was published 2026-10-10T05:14:41Z from the discovery answers Q1–Q14
(2026-10-10). The owner agreed the spec and this plan on 2026-10-10 by asking
to implement them (G1).
Authorized scope: the whole plan. Phases 5–6 start only after #399 merges.
G2a, the effect-list approval, G2b and G3 remain owner gates.
Branch: `feat/gesture-catalog-expansion` in its own worktree, created from
`main` at `5c7c3593`.
Baseline for unchanged behavior: `5c7c3593`.
Delivery: one PR from this branch. It closes #409 and each phase issue, #412
to #417 (sub-issues with blocked-by links; #416 is also blocked by #399), with
one `Closes #N` line each.

## Purpose and context

Add 30 Included Gestures that cover the missing emotions and conversation beats.
Give new and existing Gestures action-bound Avatar Effects where an effect adds
meaning. Give every new effect a sound from the licensed pack (#399). Rewrite
all AI descriptions to say when to use each Gesture, and add a few starters
chosen with a small selection evaluation. Fix the capsule check's palm-to-palm
false positive. Promote everything after two preview rounds (G2a, G2b) and a
licence and promotion review (G3).

Paths are relative to `src/frontend/web/src/` unless they start with `src/`,
`content/`, `licenses/`, `tests/`, `docs/`, `.agents/` or `scripts/`, where
`scripts/` means `src/frontend/web/scripts/`. Drafts and working records live in
the git-ignored `.animama-drafts/gesture-catalog-expansion/` of this worktree.

| Area | Entry points |
| --- | --- |
| Motion checks | `lib/avatar/motion-authoring/checks.ts` (`INTERSECTION_PAIRS`, `checkIntersections`, `contactVolume`), `checks.test.ts`, `includedGestures.test.ts` (`MOTION_CHECK_EXEMPT`), `includedClipBaseline.test.ts` |
| Authoring and review tools | `pnpm -s animation validate/check/render/preview/resolve/promote`, `pnpm -s effects check [--with-clip]`, `effects:render`, `effects:thumbnails`, `effects promote` (`scripts/animation-*.mjs`, `effect-*.mjs`, `included-dependencies.mjs`) |
| Skills | `.agents/skills/animama-animation/`, `animama-avatar-vfx/`, `animama-effect-assets/` (art through the global `image-gen` skill) |
| Content and records | `content/included/gestures/<slug>/`, `content/included/vfx/avatar/<id>/`, `content/included/licenses/inventory.json`, `licenses/source-review.json`, `assets/effect-templates/<id>.webp` |
| Registries | `assets/vrm/animations/manifest.json` (backend copy via `uv run --no-sync python src/backend/packaging/shared_catalogs.py --write`), `src/backend/animama/resources/starter-loadout.v1.json`, `tests/anima_creation_service_support.py` (`EXPECTED_STARTER_GESTURE_IDS`), count pins in `includedGestures.test.ts`, `catalog.content.test.ts`, `tests/test_included_content_catalog.py` |
| Chat selection | `src/backend/animama/app/chat/direct_executor.py` and `direct_turn/response_format.py` (`render_available_gestures`, `with_gesture_guidance`), `app/main_structured_response.py` (gesture enum), `app/chat/memory_context.py` (gesture instruction) |
| Mixamo pack identities | `src/backend/animama/resources/mixamo-motion-manifest.json` (public paths of the 30 pack Gestures) |
| Sound pack (after #399) | `src/backend/animama/resources/wow-comedy-sfx-manifest.json`; `effects promote` `"sound": "<key>"`; #405's integrity test |
| Precedent | [hand-animation-gestures spec](../hand-animation-gestures/hand-animation-gestures-spec.md) and [ExecPlan](../hand-animation-gestures/hand-animation-gestures-execplan.md); the #314 working package (brief, consistency notes and promotion package) is kept privately by the maintainer and copied as needed into this task's drafts folder |

## Progress

- [x] 2026-10-10 Discovery Q1–Q14 answered; spec drafted and published to #409;
      worktree created at `5c7c3593` (LFS pulled, Python 3.12.13 venv,
      frontend installed).
- [x] G1: owner agreed the spec and this plan (2026-10-10).
- [x] Phase 1 (#412): palm-to-palm check, identity guard and authoring brief (R8);
      review #2 passed 2026-10-10.
- [x] Phase 2 (#413): 64 new drafts (30 R1 Gestures, 12 R10 idles, 22 R1b
      Gestures), stretched 1.1×, each passing `check` with 0 FAIL (Cover Face
      and Peek keeps one explained WARN). G2a approved 2026-10-10 in two sets:
      the first 42 after two note rounds, then the R1b set after one note
      round and effect removals. Effects ship on 30 of the 52 one-shots and
      7 of the 12 idles (see `EFFECTS.md`).
- [ ] Phase 3 (#414): harness committed (`265fc232`); evaluation run 2026-10-10
      (pass rule met); descriptions and the starter proposal go to G3. AI descriptions and the selection evaluation (R6, R7).
- [x] Phase 4 (#415): effect list approved; effects on ten existing Gestures
      drafted and approved 2026-10-10 (Excited Triple Clap keeps only its R8
      contact cleanup). Sounds follow in Phase 5.
- [ ] Phase 5 (#416): sounds for new effects and listening review; G2b (R5).
      #399 merged 2026-10-10 (PR #427).
- [ ] Phase 6 (#417): promotion, registries, starters and final validation; G3 (R1–R9).
- [ ] Final integration review.
- [ ] PR; owner merge approval.

## Surprises & Discoveries

- 2026-10-10, effects work:
  - **Event attachment.** An `avatar_vfx` event cannot change an effect's
    bone, so two-handed effects ship as right and left twins
    (for example `shake_lines_left`, `drumroll_ticks_left` and
    `finger_gun_spark_left`). Each twin is a separate Included effect that
    will need its own sound in Phase 5.
  - **Project files.** `animation validate` and `check` read clips, not
    projects, so effect projects are checked through their `sequence`.
- 2026-10-10, licensing (G3 item): the nine lettering effects are rendered
  from a script using the macOS system font Arial Rounded Bold. Whether its
  terms allow shipping the rendered PNGs must be confirmed at G3. Otherwise
  the set is regenerated with an OFL rounded font, which needs a font download
  the owner approves; the script makes regeneration quick.
- 2026-10-10, evaluation:
  - The owner chose `gpt-6-luna` ("Luna", the accepted main model
    `OpenAIResponsesHTTPAgent:gpt-6-luna`) at reasoning effort none, low and
    medium, and approved up to $6.
  - Haiku 5.5 was the first choice, but this branch has no Anthropic provider
    (raymond-van/animama#408 is open).
  - Task stack `gce` (development, base port 8440), from this worktree.

- 2026-10-10 discovery:
  - **No repetition control.** Variety depends only on the instruction "Use a
    variety of gestures" and on the equipped list.
  - **Reactions already show emotion effects.** They play in the same turn as
    Gestures and hold their effects while the Anima talks. They already use 23
    of the 29 Included Avatar Effects, including Star3 ×10, Sweat Drop ×4,
    Angry ×4 and Streaming Tears ×3. This led to the action-bound rule (R3).
- 2026-10-10, licensed sound pack (#399):
  - **Optional edges cover effects only.** The pack is non-portable, and its
    optional `sound_effect` edges (#403) cover Avatar and Scene Effects.
    #399's plan leaves Gesture `sfx` events for later, which is why sound goes
    through effects only (R5).
  - **Promotion takes a sound.** #399's `effects promote` takes a `"sound"`
    key.
  - **Every effect must have a sound.** #405's integrity test will require an
    optional sound on every Included Avatar Effect.
- **Replace keeps dependencies.** `animation promote` refuses a dependency
  change on a replace. An existing Gesture that gains an effect is replaced
  through an `effects promote` Gesture item, which keeps the meta's name and AI
  description; its new AI description needs a separate step (#314 package,
  section 1).
- **New effect files fall under the owner-authored rule.** Without their own
  rule, new files are covered by the generic `vfx/avatar/**/*` rule
  (`LicenseRef-Animama-owner-authored`). #314's three effects reused existing
  art and got agent-authored rules. No precedent covers art made with
  `image-gen`, so its wording is a G3 item.
- **No identity guard against the pack.** No test checks core Selector IDs
  against Mixamo pack identities.
- **Some clips are large.** #314 clips are 10–42 KB, and all Included clip
  JSON (637 KB) is bundled eagerly.

## Decision Log

- 2026-10-10, owner (G1): asked to implement the published spec and this plan
  (`/implement`). The proposals below were accepted as written.
- 2026-10-10, owner (G2a round 1): all new Gesture motion is approved.
  Changes requested:
  - **10% slower.** Every new clip is stretched 1.1× by
    `work/_stretch/stretch.py`: durations, fades, beats, key offsets, contact
    windows and blends, and events.
  - **Effects too brief.** Effects of about 0.5 s are too short to read;
    effects now hold at least about 1.0 s.
  - **No romaji lettering.** GOMEN, CHIRA, KYAA, MUKI, NYA and OHOHOHO are
    replaced with English or non-text manpu. BLEH, HEH and RAWR stay.
  - **More manpu.** Add more manpu effects, reusing Included ones such as
    blush. This **relaxes R3's "no emotion face paint" rule**: Gestures may
    reuse blush, sweat, anger and gloom effects, accepting occasional doubling
    with Reactions.
  - **Art.** New manpu art is original work in the style of the owner's
    reference sheet (inspiration only; not traced).
- 2026-10-10, owner (R1b G2a): notes on Hand to Ear, Who Me? and Phew Brow
  Wipe motion and a Pon! idea bulb; asked for more effects on the R1b set,
  then removed them again from Presenting, Chef's Kiss and Pinky Promise. With
  that, every new Gesture is approved, and the rest of the plan proceeds.
- 2026-10-10, owner (G2a round 2 notes):
  - **Fewer effects.** Excited Triple Clap loses all its effects and keeps
    only its R8 contact cleanup, so ten existing Gestures gain effects.
    Apology Bow loses its sweat splash, Head Pat its cloud and sparkle (the
    hearts stay), Happy Sway its music notes, Drumroll its ta-da sparkles and
    Fighting! Fist Pump all effects (a chest sparkle, then fist flames).
  - **Brief flashes are allowed when asked for.** Cheeky Finger Guns plays a
    short spark at each index fingertip (`finger_gun_spark` and a left twin),
    an exception to the round 1 hold of about 1 s.
  - **Motion.** Drumroll drums with the index fingers. Mind Blown puts flat
    hands with the wrists bent so the fingertips rest on the temples, instead
    of pointing index fingers.
- 2026-10-10, owner (G2a): all 42 new drafts (30 Gestures and 12 idles) are
  approved after the round 2 revisions.
- 2026-10-10, owner: the effects on the ten existing Gestures (Phase 4) are
  approved too; only their sounds remain for G2b.
- 2026-10-10, owner (scope change, R1b): add 22 more one-shot Gestures in this
  issue rather than a follow-up, since merges are queued anyway: the 15
  proposed (This Big!, Just a Tiny Bit, Hand to Ear, Who Me?, Zip Lips, Phew
  Brow Wipe, Fingers Crossed, Flustered Fan, Big Circle, Big X, Tehepero,
  Scheming Hands, Soul Leaves Body, Virtual Hug, High Five) and seven of the
  alternates (Pinky Promise, Chef's Kiss, Presenting, Stretch Break, Typing
  Away, Pon!, Fist Bump). The spec was republished to #409
  (2026-10-10T21:30:44Z). They are drafted as items 43–64 with the Phase 2
  pipeline (five agents at a time, authored at the original pace and then
  stretched 1.1×) and reviewed in their own G2a round. Effects follow the
  round 1 and 2 rules and are kept sparse.
- 2026-10-10, owner (scope change, R10): add five VTuber-style idle Gestures
  (Chat Glance, Off-Screen Look, BGM Bob, Hmm Drift, Hair Tuck & Settle) and
  an Included "Streamer Idle" Idle Style to this issue.
  - Default idle for new companions stays out.
  - The spec was republished to #409 (2026-10-10T14:19:04Z).
  - Phase 2 drafts them for G2a; Phase 6 writes the Idle Style by hand, since
    promote tooling doesn't cover Idle Styles.
- 2026-10-10, owner (R10 extended): add five emotion idles (Downcast Sigh,
  Simmering Huff, Happy Sway, Nervous Fidget, Dreamy Gaze) plus Bored Wait and
  Sleepy Nod-off, twelve idles in all.
  - Emotion cells use them at intensities 2–3; intensity 1 inherits Default.
  - Overlap with the Mixamo pack's emotion, bored and sleepy idles is accepted.
- 2026-10-10, owner: go ahead with effect generation without a separate
  approval. The consolidated table (`EFFECTS.md` in the drafts folder) is
  reviewed at G2a and G2b as planned.
- 2026-10-10, owner: run at most five drafting agents at a time, not ten. The
  five most recently started (items 16 and 18–21) were stopped and resume
  first.
- 2026-10-10, owner (Phase 4 effect list): approved the core list as
  proposed. Eleven existing Gestures gain effects:
  - Blow a Kiss and Blow a Kiss 2: `kiss_heart`, a new descriptor reusing the
    heart art;
  - Heart Hands: `heart_hands_pop`, with the legacy clip re-animated;
  - Excited Triple Clap: `clap_burst`;
  - Celebration: `cheer_sparkles`;
  - Cheeky Finger Guns: `finger_gun_spark`;
  - Cat Monster Rawr: `rawr_lettering`;
  - Surprise Gasp: `emote`, reused;
  - Thinking Head Scratch: `question_mark`;
  - Deflated Sigh: `huff_puff`, reused;
  - Hand on Heart: `heart_throb`, reused, with the legacy clip re-animated.

  The optional Shy Finger Poke Loop and Meme Dab stay untouched.
- 2026-10-10, owner (discovery):
  - **Q1–Q8:** purpose, size (30), one-shot mix, distinct meanings, anime tone
    with natural beats, the 30-item set, small Mixamo overlap and no Idle
    Styles.
  - **Q9–Q14 and the #399 slip rule:** touched-only revisions; sound through
    effects only; a few starters plus an evaluation; platform plus the R8 fix;
    agent-authored sources; two preview rounds; wait for #399 in one PR.

  See the spec's Decisions.
- Proposed by the agent and accepted at G1:
  - **Selection evaluation pass rule.** The candidate starter loadout must not
    fit less often than the 20-starter baseline.
  - **R8 approach.** During a declared hand-to-hand contact, also allow the
    hand against the *distal part* of the other forearm. The part is roughly a
    palm length from the wrist. A hand through the middle of a forearm still
    fails. Alternative: narrow the forearm capsule at the wrist. The plan
    prefers the contact rule because it changes nothing outside declared
    contacts.
  - **Evaluation harness.** A backend script reuses the chat prompt assembly
    and structured gesture schema with a supplied list of Gesture descriptors.
    It calls the owner's configured chat model connection directly, so draft
    Gestures can be measured before promotion and no Anima data changes.
    Fallback: chat turns against a task stack with Local copies equipped.

## Phased implementation

Every code phase uses tests first where the behavior is observable, runs the
phase checks, gets a bounded independent review recorded below, and commits as
`<type>(<scope>)[p#]: <summary>`. The review is by `sdlc-reviewer`: one full
review and at most two repair rounds. Draft phases commit only plan evidence.
Promotion is the only phase that writes to `content/included`.

Each Gesture is drafted by its own sub-agent with the `animama-animation` skill,
authored from scratch. Drafting runs at most five concurrent agents (owner,
2026-10-10; it started at ten) to limit host load, because renders and checks time out under heavy load. Each
draft needs:
- `animation validate` and `check` with no FAIL and every WARN explained;
- body and `--view hands` render sheets on both Avatars;
- a notes file with the intent, beats, contacts, an AI description proposal and
  any effect request.

### Phase 1 — Palm-to-palm check, identity guard and authoring brief (R8)

Issue: #412. Starting revision: `5c7c3593`. Gate: G1.

1. **Palm-to-palm check (R8).** In `checkIntersections`, a declared contact
   whose bone and target both map to hand volumes on opposite sides also allows
   `leftHand/rightForearm` and `rightHand/leftForearm`. The allowance holds only
   while the overlap lies within the distal part of that forearm capsule (from
   the wrist up to a palm length measured on the rig). Tests in `checks.test.ts`
   on both Avatars:
   - a flat clap with one solved palm contact passes;
   - the same pose without the contact still fails;
   - a hand through mid-forearm during the contact still fails;
   - Excited Triple Clap with its nine check-only contacts removed passes.
2. **Clap cleanup.** Remove Excited Triple Clap's nine check-only contacts from
   a draft copy, and record that the sampled motion is unchanged: the baseline
   hash still matches. The edit is promoted in Phase 6 (a contacts-only
   replace).
3. **Identity guard.** Add a test that fails when a core Gesture's
   `semantic_key` or content-ID suffix equals a Mixamo pack Gesture identity.
   The pack identities are derived from the public manifest paths. Confirm the
   path format first and record it here.
4. **Authoring brief.** Write `.animama-drafts/gesture-catalog-expansion/BRIEF.md`.
   It carries over the #314 conventions (wink side and shape, `happy` ranges for
   A_1, fades and returns, held-loop cadence, head layers for solved head
   contacts) and adds:
   - the tone split (anime-expressive emotions, tropes and playful items;
     natural beats);
   - the action-bound effect rule and the list of effects Reactions own;
   - one-shot lengths and loop rules;
   - effect-request notes;
   - the AI description form: when to use it, then what it looks like.
5. **Docs.** `checks-and-review.md` and `clip-format.md`: the palm-to-palm
   allowance. A clap no longer needs check-only contacts.

Checks, from `src/frontend/web`:
- `pnpm exec vitest run src/lib/avatar/motion-authoring`;
- `includedClipBaseline.test.ts`;
- the new identity test (`uv run pytest -q` on the touched test file or vitest,
  depending on where it lives);
- `pnpm -s prettier:check`, `pnpm web:lint`.

Completion: R8 tests pass, the identity guard passes on current content, and
the review has passed.

#### Code Review #1 Findings

Reviewed 2026-10-10: the uncommitted tree on `5c7c3593`, excluding
`.animama-drafts/` and the plan records. The independent `sdlc-reviewer` used
scratch probes (since deleted):
- an on-Avatar probe;
- a mutant `checks.ts` without the ramp extension, which gave 36 intersection
  FAILs and 17 finger WARNs on the solved-only clap;
- a template-key comparison.

- **P1-R1-01 (required).** The fail direction of the new forearm geometry had
  no on-Avatar test. The forearm tests used hand-built proximal capsules, so
  `AvatarBody.capsules()` never ran in a failing case. The plan asked for a
  hand through mid-forearm on both Avatars.
- **P1-R1-02 (optional).** No test covered the finger-check ramp extension.
  The clap test asserted only intersection and contact FAILs.
- **P1-R1-03 (optional).** The identity guard missed the public pack renames
  (`dance`, `yawn`, `quick_shrug`, and the v2 `idle_*` loops).
- **P1-R1-04 (optional).** The template keys were read with a regex over
  re-serialized JSON instead of `assets[].document.semantic_key`.
- **Non-blocking observations.**
  - The ramp extension is justified and correctly bounded: it uses the same
    `fitContactSolveRamps` windows as playback, wraps loops and does not wrap
    one-shots.
  - The allowance also applies to unsolved hand-to-hand contacts, which is
    bounded by each contact's tolerance and by the region near the wrist.
  - The `prepareV2` refactor is equivalent.
  - `clip-format.md` needs no edit.
  - Nits: the timeline object was built twice, and the test reached the
    unexported `TouchingContact` type through `Parameters<…>`.

#### Code Review #1 Revisions

Repair round #1 (one of two allowed), 2026-10-10:

- **P1-R1-01 accepted, fixed.** A new on-Avatar test retargets Arms Crossed's
  right-palm-on-left-forearm contact to the left hand. The hand-to-hand
  allowance is then active, and `rightHand/leftForearm` still FAILs on both
  Avatars.
- **P1-R1-02 accepted, fixed.** The clap test also asserts no `fingers`
  findings.
- **P1-R1-03 accepted, fixed.** The guard adds the documented renames and
  derives `idle_*` from the `mixamo-idle-` folders. Its comment says the other
  v2 renames are private, so new names are also checked by hand before
  promotion (Phase 2 `IDENTITIES.md`, and G3).
- **P1-R1-04 accepted, fixed.** Keys are read from
  `assets[].document.semantic_key`.
- **Nits fixed.** The timeline object is built once in `checkMotion`, and
  `TouchingContact` is exported for the test.

Evidence after the repairs:
- `pnpm exec vitest run src/lib/avatar/motion-authoring src/lib/avatar/poses`:
  576 passed, 1 skipped.
- `tsc -b`, eslint and prettier: clean.
- `uv run pytest -q tests/test_included_content_integrity.py`: 7 passed.
- ruff: clean.

#### Code Review #2 Findings

Targeted recheck 2026-10-10: **pass.** P1-R1-01 to 04 and the nits are
resolved, with no regressions. The reviewer's scratch mutants of the forearm
geometry show the new Arms Crossed test catches each regression and the clap
test catches the finger-window one:
- skipping the pair;
- collapsing the short capsule to the elbow;
- inverting the palm fraction;
- reverting the finger window.

Non-blocking:
- On A_1 the Arms Crossed overlap clears the limit by only 6 mm (0.021
  against 0.015).
- The retargeted contact also FAILs as a contact, which the test ignores.

Phase 1 is complete. One repair round of two was used.

### Phase 2 — New Gesture drafts and their effects (R1, R2, R3, R6, R10 idles; gate G2a)

Issue: #413. Starting revision: the Phase 1 commit, so the R8 allowance applies
to Prayer Hands, Please Hands and Apology Bow. Gate: G1. Completion: G2a
approval of every new Gesture and effect by name.

1. **Motion drafts.** Draft in four batches, in priority order: beats (9),
   emotions (9), tropes (7), playful and companion (5). The working titles and
   groups come from spec R1. Each agent proposes the following, which the lead
   records in `IDENTITIES.md`:
   - a folder slug;
   - a snake_case Selector ID, checked against core and pack identities;
   - a loop kind and a length.
2. **Consistency pass.** Compare the drafts side by side, as in #314:
   - pairs and families (Shh / Air Quotes, Cower / Ew Recoil, Please Hands /
     Prayer Hands / Apology Bow, Goodbye Wave / Wave Hello / Small Wave);
   - fades and returns;
   - expression ranges;
   - the tone split.

   Record the results in `CONSISTENCY.md`.
3. **Effect assignment for new Gestures.** Build a table in `EFFECTS.md` with
   one row per Gesture: effect, reused or new, anchor and offset, and event
   window. Rows marked "none" are expected for most beats. Reuse an Included
   effect first, and merge duplicate requests, so one effect serves every
   Gesture that needs it. Exceptions to the rule against emotion face paint
   are listed for the owner.
4. **New effects.** For each new effect:
   - make the art with `animama-effect-assets` (generated through `image-gen`
     or drawn as SVG/canvas where that suits it better), with
     `pnpm -s effects:assets` checks;
   - write an `animama/avatar-effect/2` folder with `animama-avatar-vfx` in a
     scratch Local root `<root>/vfx/avatar/<id>/`, giving it a `content_id`
     and `content_type: "avatar_effect"`;
   - check it with `pnpm -s effects check <folder> --with-clip <clip>
     --times …` on both Avatars.

   Record each piece of art's provenance (tool and prompt summary) for the
   source review.
5. **Idles (R10).** Twelve more drafts, items 31–42 in `BRIEF.md`,
   join G2a. They mute `cursorLookAt`, `headNod` and `headSideTilt`, keep
   `breathing`, and have no `playback` lifetime, so they stay eligible for
   idle playback.
6. **Projects.** A Gesture that plays an effect is previewed as a project file
   with a `ref` dependency and `--local-content <root>`, as #314 did with Have
   an Idea.
7. **Gate G2a.** Run `pnpm -s animation:preview <first draft>`. The owner
   switches items and compares against related Included Gestures. Notes are
   applied and closed with `pnpm -s animation resolve`. Repeat until the owner
   approves each Gesture and each new effect by name. Effects are reviewed
   silent here; sound comes in G2b.

Checks: per-item results recorded in `CHECKS.md` (validate, check, effects
check).

Commits in this phase: plan evidence only, as `docs(content)[p2]`.

### Phase 3 — AI descriptions and selection evaluation (R6, R7)

Issue: #414. Starting revision: Phase 1 commit. It may run alongside Phases 2
and 4. The candidate run needs the Phase 2 descriptions. Gate: G1.

Owner input:
- the evaluation model connection, set up through the owner's credential
  mechanism (agents never read or print key values);
- consent to the estimated cost, which is stated before the first paid run.

1. **Descriptions.** Rewrite the AI descriptions of all 43 existing Gestures
   in `DESCRIPTIONS.md` (current text, proposed text, reason). The new
   Gestures' descriptions come from their drafts. Each description says when
   to use the Gesture, then briefly what it looks like. The owner approves them
   at G3 as part of the promotion package.
2. **Harness.** A backend script, for example
   `scripts/evals/gesture_selection.py` at the repo root (final location chosen
   during implementation), that:
   - takes a loadout file (selector, name, description), a prompt-set file and
     a model connection name;
   - builds the chat prompt with the production assembly
     (through the real `DirectChatTurnExecutor`) and the structured
     response schema with the gesture enum;
   - sends each prompt as a fresh single-turn chat, plus two long scripted
     chats (about 30 turns each) for repetition;
   - records the chosen Gesture, emotional tone, prompt bytes, tokens and
     cost;
   - is runnable offline with a fake model client, which its unit tests use.

   It writes no Anima or chat data.
3. **Prompt set.** About 60 single-turn prompts in
   `docs/plans/gesture-catalog-expansion/eval/` or in the drafts folder if they
   contain anything unsuitable for public view. They cover the nine new
   emotions, the conversation beats, greetings and goodbyes, and neutral turns
   where `null` is right. Each prompt lists its acceptable Gestures, which may
   include `null`.
4. **Runs.** Three loadouts: the current 20 starters, the candidate starters
   (20 plus up to five), and all 73. Run three repeats each. Budget: at most
   about 700 calls, with the estimate given to the owner before running.
   Record per loadout:
   - fit rate;
   - null rate;
   - distinct Gestures and the longest repeat run in the scripted chats;
   - prompt bytes.
5. **Starter proposal.** Up to five starters, chosen from the evaluation
   results and coverage value, for G3.

Checks:
- harness unit tests (`uv run pytest -q <test file>`);
- `uv run ruff check`;
- `make format-check`.

Results: a summary table in this plan, without raw model outputs. The prompt
set is committed if public-safe.

Completion: results recorded and the proposal ready for G3. Review covers the
harness code.

#### Evaluation results (2026-10-10)

Setup:
- **Model:** `OpenAIResponsesHTTPAgent:gpt-6-luna` on task stack `gce` (the
  owner's choice), incognito.
- **Inputs:** `eval/` (git-ignored: the generator, the prompt set of 60 items
  plus 2 × 30-turn chats, and three loadouts).
- **Runs:** 3 repeats per item and 1 per scripted chat, 720 calls per
  reasoning level, no errors.
- **Cost:** about 3.0M input tokens per run, of which about 2.55M cached, and
  63–87k output tokens per run. That is about $0.35 for all three runs at the
  catalog's standard rates. The harness reported "unpriced"; billing is the
  authority.

| Fit rate (null rate) | none | low | medium |
| --- | --- | --- | --- |
| Baseline, 20 starters (3.0 KB list) | 64.4% (20.0%) | 62.8% (20.6%) | 62.8% (20.0%) |
| Candidate, 25 (5.0 KB) | 70.0% (15.0%) | 70.6% (16.1%) | 68.3% (15.6%) |
| All 73 (15.5 KB) | 87.2% (13.3%) | 84.4% (13.3%) | 83.3% (13.3%) |

- **Pass rule:** met at every level.
- **Per-group fit, effort none:**

  | Group | Baseline | Candidate | All 73 |
  | --- | --- | --- | --- |
  | Emotions | 38/54 | 39/54 | 47/54 |
  | Beats | 15/48 | 23/48 | 36/48 |
  | Goodbyes | 6/9 | 9/9 | 9/9 |
  | Neutral | 30/30 | 26/30 | 29/30 |

- **Variety:** scripted chats show 10–13 distinct Gestures (baseline), 9–13
  (candidate) and 14–18 (all 73), with the longest run of one Gesture 1–3.
- **Reasoning:** low and medium effort give no gain over none.
- **Over-selection:** Explain with Open Palms is picked about 20 of 180 times
  in the candidate loadout, including neutral turns. Thinking Hand on Chin is
  the most frequent pick.
- **Starter proposal for G3:** the five candidates, with tighter "when"
  descriptions for those two Gestures.

#### Code Review #1 Findings

Reviewed 2026-10-10: the uncommitted harness tree on `44c16bff` (`scripts/evals/`,
its tests, and the `response_format.py` / `direct_executor.py` refactor). The
independent `sdlc-reviewer` used offline probes only.

What held up:
- **Faithfulness.** Every turn runs through the real `DirectChatTurnExecutor`.
- **Refactor.** It is byte-identical to the old `_gesture_guidance`.
- **Budget, dry run, incognito, scoring, credentials, no data writes and import
  boundaries.**
- **Checks.** The full backend suite passed: 3549 passed, 10 skipped.

- **P3-R1-01 (required).** Scripted chats repeated with `--repeats`, so the
  planned run needed 1080 calls against the plan's budget of about 700, and
  the documented command refused to start.
- **P3-R1-02 to 09 (optional).**
  - 02: a wrong salvage docstring, and unflagged replay mismatches.
  - 03: "no compaction" wording, and the native Responses compaction setting
    not recorded.
  - 04: inputs hashed after the run.
  - 05: no partial results on abort.
  - 06: budget headroom and message wording.
  - 07: no cost-estimate guidance.
  - 08: missing tests (refused repair, `main` refusal before the database) and
    a misnamed test.
  - 09: the documented commands, the compose selection and loadout ordering.

#### Code Review #1 Revisions

Repair round #1 (one of two allowed), 2026-10-10. Every finding was accepted.
- **P3-R1-01.** A separate `--scripted-repeats` (default 1) makes the plan
  720 calls.
- **02–09.** Fixed as listed in the findings.
- **The plan's stale references** to `_gesture_guidance` were corrected.

Evidence after the repair:
- pytest (eval and executor): 111 passed;
- ruff check and format, `make format-check`, mypy and the boundary check:
  clean.

The implementer also corrected a review note: production lists equipped
Gestures sorted by `slot_key` (`gesture:<selector>`), which the reviewer
confirmed.

#### Code Review #2 Findings

Targeted recheck 2026-10-10: **pass.** P3-R1-01 to 09 and the style note are
resolved.
- **Budget.** A plan-size dry run is 720 calls, within `--max-calls 800`.
- **Salvage.** It now follows chat's stream parser.
- **Abort.** SIGINT writes partial results.
- **Interleaving.** Single-turn coverage stays equal across loadouts when the
  cap stops a run.

The production refactor is unchanged since review #1.

Optional findings, both deferred:
- **P3-R2-01.** After a context-exceeded retry, salvage reads the failed first
  call's deltas. This needs a rare combination of conditions (found by
  reading the code, not probed). It is recorded as a known limitation.
- **P3-R2-02.** Scripted chats alternate between loadouts chat by chat, so a
  cap stop can leave scripted coverage uneven. The fit pass rule uses
  single-turn items, which do interleave, and the paid run keeps headroom
  under the cap.

The harness code review passed with one repair round of two used. Phase 3
stays open for the paid run, the descriptions and the starter proposal.

### Phase 4 — Effects on existing Gestures (R3, R4; effect-list approval)

Issue: #415. Starting revision: Phase 1 commit. It may run alongside Phase 2.
Gate: the owner approves the effect list before authoring.

1. **Effect list.** Propose `EXISTING-EFFECTS.md` for the 43 existing Gestures.
   For each Gesture that gains an effect, give the effect, whether it is reused
   or new, the anchor and the beat, with a one-line reason. Expect a minority
   of the 43, for example a heart from the hands in Heart Hands or Blow a Kiss,
   and an impact or sparkle on Celebration or Salute. Each entry follows R3.
   Gestures without an effect are listed with "none". The owner approves the
   list in chat before Phase 4 authoring, and the approval is recorded in the
   Decision Log.
2. **Motion fixes for touched Gestures.** Each Gesture on the approved list:
   - gets its check WARNs fixed;
   - gets its known nits fixed (the Medium/Mild laugh bounce and A_1 eye
     narrowing apply only if those clips are touched);
   - keeps its content ID, Selector ID, display name and loop kind.

   A touched legacy clip (Heart Hands, Meme Dab, Shy Finger Poke Loop or Hand
   on Heart) is re-animated with hand keys and muted layers, so it passes the
   checks and leaves `MOTION_CHECK_EXEMPT` in Phase 6.
3. **Drafting.** Each touched Gesture gets a sub-agent, plus an effect agent
   for any new art, following the same per-item steps as Phase 2.
4. **Preview.** The approved list is previewed together with the sounds at G2b
   (Phase 5). If #399 is still pending once drafts are ready, a silent visual
   preview may be run early to settle motion notes. That preview does not
   replace G2b.

Commits in this phase: plan evidence only, as `docs(content)[p4]`.

### Phase 5 — Sounds for new effects; listening review (R5; gate G2b)

Issue: #416. Starting revision: Phases 2 and 4 drafts complete. Entry
condition: #399 is merged on `main`, including its optional sound edges (#403),
the sound pack (#405) and promotion support.

If #399 has not merged, work pauses here (owner decision, 2026-10-10). Phases
2–4 stay as drafts and plan evidence.

1. **Sync.** Bring the branch up to date with `main`, using the host's
   sync-with-base tool or `git merge origin/main`, and resolve conflicts.
   Record the merged `main` revision. Rerun Phase 1 checks and the identity
   guard.
2. **Assign sounds.** Mount the pack on the task stack (see
   [mixamo-motion-pack.md](../../backend/operations/mixamo-motion-pack.md) and
   #399's sound-pack doc). For each new effect, choose one sound key from
   `wow-comedy-sfx-manifest.json` that fits its art and moment, and record the
   choices in `SOUNDS.md`. Reused effects keep their #405 sounds.
3. **Stacking.** Where a Gesture applies two or more effects at the same
   moment, choose one accompanying sound and set `playAccompanyingSound: false`
   on the others.
4. **Reaction overlap.** Also play each effect-bearing Gesture with a likely
   Reaction, for example Tear Wipe with `sadness-2`, and note any clash of
   sounds. Fix it inside this issue only when it is a content choice; otherwise
   open a follow-up.
5. **Gate G2b.** Run one `animation:preview` session with the pack mounted. It
   covers:
   - the effects on existing Gestures from the approved list;
   - every new pairing of effect and sound;
   - the stacking choices.

   Notes are resolved as in G2a, until the owner approves each item by name.

Commits in this phase: the merge commit and plan evidence (`docs(content)[p5]`).

### Phase 6 — Promotion, registries, starters and final validation (R1–R9; gate G3)

Issue: #417. Starting revision: Phases 1–5 complete. Completion: every spec
acceptance criterion met except merge approval.

**Gate G3.** The owner approves
`.animama-drafts/gesture-catalog-expansion/promotion/PACKAGE.md` before any
write. The package follows #314's format and covers:
1. each item's mode and identity (adds, replaces, contacts-only and
   dependency-only replaces), names and loop kinds;
2. the AI descriptions (`DESCRIPTIONS.md` merged into the items);
3. the licence-inventory and source-review wording for each kind: agent-authored
   motion, effect descriptors, art made with `image-gen` (new wording, since no
   precedent exists) and thumbnails;
4. the effect sounds;
5. the starter change, with the Phase 3 results;
6. the `--dry-run` outputs.

Steps after G3, each write after its own dry run:

1. **Effects.** `effects promote` adds the new effects (with `"sound"`), plus
   Gesture items for existing Gestures that gain a dependency.
2. **New Gestures.** `animation promote` adds the 30 new Gestures with their
   `ref: builtin:avatar-effect:<id>` dependencies.
3. **Replacements.** `animation promote` replaces touched existing Gestures
   (motion fixes), and Excited Triple Clap (contacts only). Description-only
   updates follow #314's description step for items whose meta
   `effects promote` kept.
4. **Starters.** Update starter policy v1 in place,
   `EXPECTED_STARTER_GESTURE_IDS` and the starter count pins, in one commit
   with the content.
5. **Streamer Idle (R10).** Write the Included Idle Style by hand under
   `content/included/idle-styles/streamer-idle/`:
   - shape: modelled on the Idle Style document schema
     (`schema_version` 2; `dependencies` on the twelve `builtin:gesture:`
     IDs);
   - Default pool: the streaming idles plus Bored and Sleepy;
   - emotion cells at intensities 2–3: their emotion idles, with curiosity on
     Off-Screen Look and confusion on Hmm Drift;
   - its licence-inventory rule and source-review record;
   - a backend test that the catalog resolves it and that its members pass
     idle eligibility (`idle_clip_validation.py`);
   - no change to new companions' idle selection.
6. **Registries.**
   - manifest names, durations and loop kinds, plus the backend copy sync;
   - removal of re-animated legacy clips from `MOTION_CHECK_EXEMPT`;
   - count pins;
   - effect picker templates and thumbnails (`pnpm -s effects:thumbnails`)
     with their source-review records;
   - re-baselined hashes for touched items only.
7. **Docs.**
   - `content/included/README.md` (counts, sounds);
   - `docs/frontend/testing/browser-journeys.md` if journeys change;
   - starter counts wherever documented (#314 found two stale docs);
   - the skill references: the action-bound effect rule in
     `animama-animation` (`SKILL.md` or `references/`) and
     `animama-avatar-vfx`.
8. **Staging.** Run `git add` before backend tests and desktop staging, which
   read tracked files only.

Checks:
- From `src/frontend`: `pnpm check`, `pnpm web:lint`, `pnpm web:test`,
  `pnpm build`, `pnpm desktop:runtime:stage`, `pnpm desktop:runtime:audit`.
- From the repo root: `uv run pytest -q`, `make check-test`,
  `uv run ruff check`, `make format-check`, the `shared_catalogs.py` check.
- A self-host-style check: `./reset.sh` on a stack without the sound pack
  starts with every Gesture and effect VALID.
- The full `pnpm e2e:test` on a named built stack:

  ```bash
  ANIMAMA_LLM_SKIP=1 ANIMAMA_WEB_BUILD_MODE=production ./reset.sh --name gestures2 --base-port <p>
  ```

  Timeouts under host load are re-run serially (`--workers 1`) and reported as
  such.
- Measured web bundle growth of the Included clip JSON.

Phase 6 is reviewed as part of the final integration review.

## Final integration review

One full `sdlc-reviewer` pass over the PR against the spec, with at most two
repair rounds. The owner then approves the merge of the exact revision. Before
the review, merge the latest `main` into the branch and record conflicts.

#### Code Review #1 Findings

Not started.

#### Code Review #1 Revisions

Not started.

## Validation and acceptance

The spec's acceptance criteria are the contract. Evidence goes here and in the
PR, separated by kind:

- **Local:** the commands and results above.
- **Browser:** the full `pnpm e2e:test`, on a named built stack with its URL
  recorded.
- **Owner:** G2a, G2b and G3 approvals, with dates.
- **Provider:** the selection evaluation, with its model and cost.

Hosted Validation is disabled, so the PR records
`Validated revision: … · baseline: 5c7c3593` with local evidence, and asks the
owner to accept local evidence explicitly.

Not covered: a live chat check of every Gesture with a paid model beyond the
evaluation, and native release acceptance.

## Idempotence and recovery

- **Code phases (1 and 3)** change only checks, tests and a script. Reverting
  their commits restores prior behavior. Untouched clips keep their baseline
  hashes.
- **Drafts** stay in `.animama-drafts/` until promotion. Promotion writes to
  `content/included` once per item after G3, each after a `--dry-run`. A failed
  step is re-run after fixing its items file. Earlier steps stay as written.
- **No identity changes.** No Selector ID is renamed or removed, so Loadouts
  keep working.
- **Starter edits.** Adding starters changes every existing Anima's implicit
  starters and returns 409 for in-progress Anima creation drafts. Recover by
  retrying creation, or by resetting a development database at the owner's
  discretion.
- **#399 not merged.** If #399 slips, Phases 5–6 wait. If #399 changes its
  sound contract before merging, Phase 5 adapts to the merged contract, and
  any material change is reported to the owner.
- **Evaluation runs** write only local result files. Re-running costs paid
  calls again, so results are kept.

## Outcomes & Retrospective

Not started.
