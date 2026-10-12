# Expand and improve the Included Gesture catalog

Status: Agreed
Owner decision: 2026-10-10, the owner asked to implement this spec and its
ExecPlan (gate G1), after discovery answers Q1–Q14 the same day (see
Decisions). The plan's proposals were accepted as written.
Authoritative source: https://github.com/raymond-van/animama/issues/409, first
published 2026-10-10T05:14:41Z, agreed version read back 2026-10-10T05:24:23Z; R10 added and extended, read back 2026-10-10T14:25:26Z; R1 extended by 22
Gestures (R1b), read back 2026-10-10T21:30:44Z.
This file is a snapshot of that issue.

## Problem and intended users

After #314 (PR #406, merged as `5c7c3593`), the Included catalog has 43 Gestures
(30 one-shots, 13 loops; 20 starters) with fitted hand presets and solved
contacts. Three problems remain:

1. **Coverage.** Eight of the 24 tracked emotions have no fitting body Gesture:
   sadness/grief, anger beyond pouting, disgust, fear, embarrassment, desire,
   optimism and remorse. Gratitude has only a partial fit. The conversation beats
   chat needs most also have no Gesture: explaining, contrasting, counting,
   emphasis, "so-so", "wait", "shh", beckoning. The legacy VRMA "explain" and
   "talk" entries have no shipped replacement.
2. **Variety.** In long chats the model repeats a small set. Nothing controls
   repetition: the model sees one line per equipped Gesture
   (`- <selector>: <name> — <ai_description>`) and the instruction "Default to
   null… Use a variety of gestures". AI descriptions mostly say what the
   Gesture looks like, not when to use it.
3. **Effects.** Only Have an Idea, Finger Heart Pose and Pout Huff play an
   Avatar Effect. #314 showed that an effect placed at the acting hand or mouth
   and timed to a beat (idea bulb, finger-heart pop, huff puff) makes a Gesture
   read much more clearly.

Self-host users have only this core catalog. Desktop and hosted builds also get
the non-portable Mixamo pack (#242, ADR 0018). Core content cannot depend on that
pack.

Users:
- Anima owners watching chat on any Avatar.
- Gesture authors, who start from Included Gestures.
- The chat model, which chooses a Gesture from names and AI descriptions.

## Goals, scope and non-goals

In scope:
- 52 new Included Gestures: the first 30 (R1) and a second set of 22 (R1b);
  coverage (R2).
- Action-bound Avatar Effects on new and existing Gestures, wherever an effect
  adds meaning: reuse first, new art where nothing fits (R3, R4).
- Sound only through those effects, using the licensed pack from #399 (R5).
- Motion fixes only on existing Gestures that this issue touches (R4).
- AI descriptions for all Gestures that say when to use them (R6).
- A few new starters, chosen with a small selection evaluation (R7).
- A fix for the capsule check's palm-to-palm false positive (R8).
- Review and promotion through gates G2a, G2b and G3 (R9).
- Twelve idle Gestures, and one Included Idle Style that pools them (R10;
  owner, 2026-10-10). Five are natural VTuber streaming idles, five are
  emotion idles, and two are Bored and Sleepy.

Non-goals:
- **Default idle for new companions.** Making an Idle Style the starter
  selection for new companions (starter idle policy) stays out of scope, as
  do Idle Styles other than R10's.
- **Gesture `sfx` events** and any new optional-sound mechanism for Gestures
  (Q10). This includes sound-only cues with no visual effect.
- **Particle and Scene Effects** on Gestures.
- **New platform capabilities:** stepping, sitting, props, a fingertip anchor,
  palm aiming, thumb-metacarpal presets, interactions between two Avatars
  (Q12). Ideas that need them are recorded as separate issues.
- **Changes to existing Gestures nothing else touches.** This covers motion
  revisions of the untouched legacy clips, the four untouched clips that still
  warn, the Medium/Mild laugh bounce and A_1 eye narrowing. A Gesture is
  touched when it gains an effect; an AI-description rewrite alone does not
  count (Q9).
- Reaction changes; changes to the Mixamo pack; motion from non-agent sources
  (#243); themed personality packs (Q1).
- The prompt docs that disagree with the code
  (`docs/backend/runtime/chat.md`, `docs/frontend/runtime/avatar-emotion.md`)
  have their own task.

## Required behavior

### New Gestures

- **R1 — New Gestures.** Add these 30 Included Gestures. The order sets the
  priority if any are cut. Names are working titles; final display names are
  approved at G3.

  | Group | Gestures |
  | --- | --- |
  | Conversation beats (9) | Explain with Open Palms; On One Hand / On the Other; Count on Fingers; Emphasise a Point; So-So Wobble; Wait / Stop Palm; Shh; Beckon; Air Quotes |
  | Emotions (9) | Tear Wipe (sadness, grief); Grr Fists (anger); Ew Recoil (disgust); Cower (fear); Cover Face and Peek (embarrassment); Please Hands (desire); Fighting! Fist Pump (optimism); Apology Bow (remorse); Prayer Hands Thanks (gratitude) |
  | Anime tropes (7) | Ohohoho Noble Laugh; Nervous Head Scratch; Cat Paws Nya; Kyaa Hands on Cheeks; Mind Blown; Peace Over Eye; Flex |
  | Playful and companion (5) | Tongue-out Bleh; Smug Heh; Drumroll; Goodbye Wave; Head Pat (toward the viewer) |

  Each new Gesture:
  - is an `animaPoseClip/2.0` clip that passes the motion checks on both
    Included Avatars;
  - has a unique Title Case display name;
  - has a snake_case Selector ID that does not collide with any core Gesture or
    any Mixamo pack Gesture;
  - has an AI description that says when to use it (R6);
  - stays within today's platform: feet planted, no props.

  Overall shape:
  - **Kinds:** mostly one-shots of 1.5–3.5 s. Use a held loop only where the
    meaning is a sustained state. At most two longer sequences.
  - **Meanings:** distinct. Four items deliberately overlap the Mixamo pack,
    because core has nothing for them or the moment is frequent: Tear Wipe
    (pack crying/sad), Grr Fists (angry/frustrated), Goodbye Wave (wave) and
    Smug Heh (being_cocky). Avoid any other overlap with the pack.
  - **Tone:** an expressive anime companion for emotions, tropes and playful
    items, in the same gag style as the Avatar Effects. Conversation beats stay
    natural, so they still look right when repeated.
- **R1b — Second set (owner, 2026-10-10).** After approving the first 42
  drafts at G2a, the owner added 22 more one-shots, with the same per-Gesture
  rules as R1:

  | Group | Gestures |
  | --- | --- |
  | Conversation beats (9) | This Big!; Just a Tiny Bit; Hand to Ear; Who, Me?; Zip Lips; Presenting; Pon! (realization); Typing Away; Chef's Kiss |
  | Emotions and reactions (5) | Phew Brow Wipe (relief); Fingers Crossed (hope); Flustered Fan (flustered); Big Circle "Maru" (approval); Big X "Batsu" (disapproval) |
  | Anime tropes (3) | Tehepero; Scheming Hands; Soul Leaves Body |
  | Companion (5) | Virtual Hug; High Five; Pinky Promise; Fist Bump; Stretch Break |

  Accepted overlaps: Flustered Fan sits near the Mixamo pack's "flattered",
  Stretch Break near its "relax" and "tired", and Pon! near Have an Idea.
- **R2 — Coverage.** After this issue, each of the nine emotions in R1 and each
  conversation beat in R1 has at least one fitting Included Gesture.

### Effects and sound

- **R3 — Action-bound effects.** A Gesture plays an Avatar Effect only when the
  effect carries or amplifies its meaning. Most conversation beats stay clean.
  - **Placement and timing.** The effect is anchored to the acting hand, mouth,
    head or body, or comes out of the motion (a puff, pop, impact or sparkle).
    It is timed to a beat.
  - **No emotion face paint.** Blush, tears, gloom, sweat drops, anger veins,
    eye hovers and face textures stay with Reactions. Reactions already play
    them in the same turn and hold them while the Anima talks. An exception
    needs the owner's approval at G2a.
  - **Reuse first.** Use one of the 29 Included Avatar Effects where it fits.
    Make new art (`animama-effect-assets`, placed with `animama-avatar-vfx`)
    only where nothing fits.
  - **Dependencies.** Every effect a Gesture plays is declared as a dependency
    and resolves in core content.
  - **Checks.** Each Gesture and effect pair passes `effects check --with-clip`
    on both Included Avatars, with the effect visible where intended.
  - **Picker.** Every new Included Avatar Effect appears in the Avatar Effect
    picker with a thumbnail.
- **R4 — Existing Gestures.** The effect assignment for existing Gestures is a
  reviewed list: Gesture, effect, reused or new, anchor and beat. Each
  assignment follows R3.
  - **Motion fixes.** An existing Gesture that gains an effect also gets its
    check WARNs and known nits fixed.
  - **Legacy clips.** A touched legacy clip (no hand keys, no muted layers,
    exempt from the checks) is re-animated, so its effect lands on real hand
    keys and the clip passes the motion checks.
  - **Identity.** Revised Gestures keep their content ID, Selector ID, display
    name and loop kind, unless the owner approves a change at G3.
- **R5 — Sound through effects only.** No Gesture gets its own `sfx` events.
  - **Reused effects** keep the optional pack sound that #405 assigns them.
  - **New effects** get at most one optional `sound_effect` edge to a sound
    from the `wow-comedy-sfx` pack, following #399's conventions. Revised by
    the owner at G2b (2026-10-11): effects used only by idles, and the gags
    the owner preferred quiet, stay silent, so a built-in effect may have no
    sound. New sounds extend the existing pack as a new version.
  - **Idles** play no accompanying sound.
  - **Stacking.** Where a Gesture applies more than one effect at the same
    moment, only one accompanying sound plays. The others set
    `playAccompanyingSound: false`.
  - **Without the pack** (self-host, public-source and development builds),
    every Gesture and effect stays valid and plays silently, without errors.
  - **Owner review.** The owner approves every new pairing of effect and sound
    at G2b.

### Selection

- **R6 — AI descriptions.** Every Included Gesture, new and existing, has an AI
  description that says when to use it, then briefly what it looks like.
  Rewriting a description does not change any ID or the motion.
- **R7 — Starters and selection evaluation.**
  - **Evaluation.** Run a small, fixed-prompt evaluation on the accepted main
    chat model. Compare the current 20-starter loadout with the candidate
    starter loadout, and with all Gestures equipped. Record per loadout:
    - how often the chosen Gesture fits;
    - the null rate;
    - repetition over a long scripted chat;
    - the prompt size.
  - **Records.** The prompt set, the expected fits, the model and the cost are
    recorded with the results.
  - **New starters.** Add at most five starters (25 in total), chosen with the
    evaluation results and approved at G3.
  - **Consistency.** Starter policy, tests, docs and motion manifest entries
    agree.

### Tooling and process

- **R8 — Palm-to-palm check.** The capsule intersection check no longer reports
  palms pressed together as a hand/forearm overlap during a solved hand-to-hand
  contact. Excited Triple Clap no longer needs its nine check-only contacts:
  they are removed, and the clip's motion is unchanged. Prayer Hands Thanks,
  Please Hands and Apology Bow pass without such workarounds. Real overlaps
  are still reported.
- **R9 — Review and promotion.**
  - **Authoring.** One sub-agent drafts each Gesture with the
    `animama-animation` skill. The drafts are compared side by side for
    consistency, following the #314 conventions.
  - **G2a.** `animation:preview` sessions cover the new Gestures and their
    visual effects on both Avatars: the first 42 drafts, then the R1b set.
    Every owner note is resolved.
  - **G2b.** After #399 merges, a second session covers effects on existing
    Gestures, plus a listening review of every new pairing of effect and sound
    and of the stacking choices. Every owner note is resolved.
  - **G3.** The owner approves the licence and source-review wording, the
    `animation promote` / `effects promote` dry-run list (identities, names,
    loop kinds, dependencies) and the starter changes.
  - **Promotion.** Items are promoted to Included with `animation promote` and
    `effects promote`.

### Idle

- **R10 — Idles.**
  - **Gestures.** Add twelve Included Gestures for Idle Style playback:
    - five natural VTuber streaming idles: Chat Glance, Off-Screen Look, BGM
      Bob, Hmm Drift, Hair Tuck & Settle;
    - five emotion idles: Downcast Sigh (sadness, grief, disappointment,
      remorse), Simmering Huff (anger, annoyance, disapproval, disgust),
      Happy Sway (joy, amusement, excitement, optimism, gratitude), Nervous
      Fidget (nervousness, fear, embarrassment) and Dreamy Gaze (love,
      admiration, caring, desire);
    - Bored Wait and Sleepy Nod-off.
  - **Shape.** Each is a subtle one-shot of about 7–9 s: upper body, feet
    planted, soft fades so it blends in from rest.
  - **Live layers.** While a clip plays it mutes the live layers that would
    fight its head and eye motion (`cursorLookAt`, `headNod`,
    `headSideTilt`), and keeps `breathing`.
  - **Eligibility.** Each passes the Idle Style eligibility rules (finite, no
    `playback` lifetime) and the motion checks on both Included Avatars. Each
    has a unique name, a Selector ID that collides with neither core nor the
    Mixamo pack, and an AI description, in case it is equipped.
  - **Idle Style.** One Included Idle Style, "Streamer Idle":
    - its Default pool holds the five streaming idles plus Bored Wait and
      Sleepy Nod-off;
    - at intensities 2 and 3, each emotion cell above uses its emotion idle,
      curiosity uses Off-Screen Look and confusion uses Hmm Drift;
    - intensity 1 and the remaining emotions inherit Default.
  - **New companions.** Their idle selection does not change: the style is
    offered, not selected by default.
  - **Overlap.** These are upper-body and smaller than the Mixamo pack's
    idles. The pack's look-around idles overlap only for variety. Its angry,
    sad, happy, anxious, bored and sleepy idles overlap deliberately (owner,
    2026-10-10), so self-host gets emotion idles too.

## Constraints

- **Platforms.** Self-host, desktop and hosted. No dependency on non-portable
  content except the optional sound edges in R5.
- **Avatars.** Both Included Avatars: VRM 0 `AvatarSample_Y_0` and VRM 1
  `AvatarSample_A_1_New`.
- **Licensing.**
  - New motion and effect art are agent-authored. They get
    `LicenseRef-Animama-agent-authored` rules and source-review records, with
    redistribution review `pending`.
  - No third-party or Mixamo-derived motion data.
  - Licensed sounds stay non-portable and are never bundled into core.
  - The release licence gate stays closed.
- **Dependency on #399.** R5 and G2b require #399's sound pack, optional sound
  edges (#403) and promotion support to be merged on `main`. If #399 has not
  merged when G2a passes, work pauses before G2b and promotion. This issue
  stays one PR and does not ship without its sounds. Once #405 lands, every
  Included Avatar Effect needs an optional sound. This includes the three
  added in #406, which #405 counted before they existed (26 against 29 today).
- **Prompt budget.** Each starter adds about 150 bytes and one enum value per
  turn:
  - 20 starters: about 3.0 KB;
  - 25 starters: about 3.75 KB;
  - all 73 equipped: about 11 KB.
- **Web bundle.** All Included clip JSON is bundled eagerly: 637 KB today.
  #314 clips are 10–42 KB each; the drafts average about 25 KB, so the 64 new
  clips may add roughly 1.5–1.7 MB.
  Report the measured growth; lazy loading is not in scope. Each clip stays
  under the 2 MiB limit.
- **Compatibility.**
  - No Selector ID is renamed or removed.
  - Adding starters edits starter policy v1 in place. This changes every
    existing Anima's implicit starters and invalidates in-progress Anima
    creation drafts (409, then retry). Policy, content and test pins change
    together.
- **Idle Style promotion.** `animation promote` does not handle Idle Styles,
  so "Streamer Idle" is written by hand under `content/included/idle-styles/`,
  with its licence and source-review records.
- **Untouched clips.** The sampled output of Included clips this issue does not
  touch is unchanged.

## Acceptance criteria

- [x] **G1.** The owner agrees this spec and the ExecPlan (2026-10-10).
- [ ] **New Gestures.** All 52 R1 and R1b Gestures exist as Included content. Every
      new and revised Gesture passes `animation validate` and
      `animation check` on both Avatars with no FAIL. Any WARN has a recorded
      reason. Body and hand renders exist for both Avatars.
- [ ] **Effects.** Every Gesture and effect pair passes `effects check
      --with-clip` on both Avatars. Every new Avatar Effect has a thumbnail
      and at most one optional pack sound (silent effects per G2b, R5). The
      integrity test from #405, as revised, passes.
- [ ] **G2a.** The owner approves every new Gesture and its effects in the
      preview session, with notes resolved.
- [ ] **G2b.** The owner approves the effects on existing Gestures and every new
      effect and sound pairing, with notes resolved.
- [ ] **G3.** The owner approves the licence and source-review wording, the
      promote dry-run list and the starter changes; recorded in the PR.
- [ ] **No pack.** A self-host `./reset.sh` with no sound pack starts with every
      Gesture and effect VALID, and Gestures with effects play silently.
- [ ] **Palm-to-palm check (R8).** Unit tests show palm-to-palm contact during a
      solved hand-to-hand contact is not reported, while a real hand/forearm
      overlap still is. Excited Triple Clap passes without check-only contacts.
- [ ] **Idles (R10).** The twelve idle Gestures pass `animation check` on both
      Avatars and are approved at G2a. "Streamer Idle" validates as an
      Included Idle Style, its members pass idle eligibility, and a test
      resolves it. New companions' idle selection is unchanged.
- [ ] **Unique IDs.** Display names are unique, and Selector IDs are unique
      across core and the Mixamo pack manifest. The manifest, test pins,
      starter policy and docs agree.
- [ ] **Untouched clips.** Their sample hashes match a `5c7c3593` baseline.
- [ ] **Selection evaluation (R7).** Results for the three loadouts are
      recorded in the plan, with the prompt set, model and cost.
- [ ] **Local evidence.** Hosted CI is disabled, so the PR records:
      - `pnpm check`, `pnpm web:lint`, `pnpm web:test`, `pnpm build`;
      - `pnpm desktop:runtime:stage`, `pnpm desktop:runtime:audit`;
      - `uv run pytest -q`, `make check-test`;
      - the full `pnpm e2e:test` on a named built stack.

## Open questions and decisions

Decided by the owner on 2026-10-10 (discovery Q1–Q14):

- **Q1 — Purpose:** coverage and variety. Also add fitting Avatar Effects to
  existing Gestures, and create new effects for new Gestures where they fit.
  Quality was not chosen as a main purpose. Themed personality packs come
  later.
- **Q1 follow-ups:** effects go wherever they add meaning, on new and existing
  Gestures, reusing effects first. They are action-bound: emotion face paint
  stays with Reactions.
- **Q2 — Size:** 30 new Gestures.
- **Q3 — Mix:** mostly one-shots of 1.5–3.5 s, a few held loops for states, and
  at most two longer sequences.
- **Q4 — Variants:** distinct meanings first.
- **Q5 — Tone:** an expressive anime companion, with natural conversation
  beats.
- **Q6 — Set:** the 30 Gestures in R1, accepted as proposed. Extended on
  2026-10-10 by the 22 R1b Gestures (15 proposed plus 7 chosen alternates).
- **Q7 — Mixamo overlap:** keep it small. Overlap only where an animation
  could use variety. The four overlaps in R1 are accepted.
- **Q8 — Idle Styles:** a separate issue at first. Revised by the owner on
  2026-10-10: twelve idle Gestures and an Included "Streamer Idle" Idle
  Style join this issue (R10): five VTuber streaming idles, five emotion
  idles, Bored and Sleepy. Default idle for new companions stays out.
- **Q9 — Revisions:** only for Gestures this issue touches.
- **Q10 — Extras:** sound only through effects. A reused effect keeps its
  sound, and a new effect is assigned one. No Gesture `sfx` events, and no
  Particle or Scene Effects.
- **Q11 — Starters and selection:** a few new starters (25 at most), all AI
  descriptions rewritten to say when, and a small selection evaluation using
  paid model calls.
- **Q12 — Platform:** stay within today's platform, plus the palm-to-palm check
  fix.
- **Q13 — Source:** agent-authored motion and effect art.
- **Q14 — Review:** two preview rounds (G2a and G2b) and one G3.
- **If #399 slips:** wait for it, and keep one PR.

- **G1, 2026-10-10:** the spec and ExecPlan are agreed. That includes the
  selection evaluation pass rule: the candidate starter loadout must fit at
  least as often as the 20-starter baseline. The evaluation informs the
  starter choice at G3 and does not block the new Gestures.

Open, and not blocking:
- **Effects on existing Gestures.** The list is drafted in the plan's effects
  phase and approved before those effects are authored. Final approval is at
  G2b.
- **Effects from a Reaction and a Gesture at the same time.** Whether their
  accompanying sounds overlap in a turn is checked at G2b. If they clash, the
  fix is recorded as a follow-up, unless it is a content choice inside this
  issue.
- **Known conflicts outside this issue.** #406 took ADR 0019 and ADR 0020, but
  the sound-pack plan (#399) still plans an ADR 0019, and #405 counts 26 Avatar
  Effects where there are 29. #399 owns both fixes. This issue expects no ADR.
- **Ruled-out ideas.** Thumbs-back hand poses (the presets never move the thumb
  metacarpal) and other capability ideas found while authoring become separate
  issues.

## Spec

This issue.

## ExecPlan

[gesture-catalog-expansion-execplan.md](gesture-catalog-expansion-execplan.md)
on `feat/gesture-catalog-expansion` (the PR links the reviewed revision).

## Delivery links

Phase issues, sub-issues of #409 with blocked-by links:
- #412 (P1)
- #413 (P2)
- #414 (P3)
- #415 (P4)
- #416 (P5, also blocked by #399)
- #417 (P6)

One PR from `feat/gesture-catalog-expansion` closes all seven.

Related:
- #314 / #406: builds on it.
- #399 (#403, #404, #405): licensed sound pack; a prerequisite for R5 and G2b.
- #243: the AI and CC0 motion source pilot.
- #242: the non-portable Mixamo pack.
