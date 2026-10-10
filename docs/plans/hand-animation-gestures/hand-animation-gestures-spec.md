# Better hands, solved hand contacts and revised Included Gestures

Status: Agreed
Owner decision: 2026-10-09, the owner approved this spec, the ExecPlan and decisions
D0–D6 as recommended, except D3: the unlisted legacy clips are re-animated in this
issue. Scope from issue #314 (2026-10-07), extended by the owner on 2026-10-09.
Authoritative source: https://github.com/raymond-van/animama/issues/314, published
and read back 2026-10-09T17:55:48Z. This file is a snapshot of that publication.

## Problem and intended users

Chat plays Included Gestures on every Anima: the agent-authored clips from #282
and the converted legacy clips promoted in #310. The owner's review found four
kinds of fault.

1. **Hand shapes.** Seven Hands-tool presets plus Curl and Spread cannot make a
   pinch, a kiss, an OK sign or a cupped clap. A keyed finger joint replaces the
   preset for the whole clip, so no clip uses one, and the creator turns a hand
   into fixed rotation tracks as soon as a finger is edited.
2. **Contacts.** A declared contact measures a joint origin (usually the wrist)
   and is only checked, never enforced. The two Included Avatars differ by 6 cm in
   arm length and 5 cm in shoulder width at almost equal height, so the same
   angles put a hand on a forearm on one Avatar and in the air on the other.
   Hands do not rest on the forearms (Arms Crossed, Pout Huff) or the hips (Hands
   on Hips). The right elbow rests on the left wrist instead of the palm
   (Thinking Chin, Storytelling), and the chin fist misses on A_1. In the clap the
   palms face down, so the hands pass through each other. Palms face the wrong way
   in Right Face Palm, Blow a Kiss and Small Wave.
3. **Motion quality.** Laughs pulse at 4.5–5.5 Hz with spine, chest, head,
   shoulders and mouth in phase, 6–11 times in a row, and read as twitching.
   Several converted legacy clips are static or abrupt, have no fades or mutes,
   and exceed joint limits.
4. **Names.** Many Gestures still show legacy hyphenated names in the Library and
   chat.

Users: Anima owners watching chat on any Avatar, Gesture authors in the creator,
and the `animama-animation` agent skill.

## Goals, scope and non-goals

In scope:

- The hand-authoring model (R1–R3), per the prototype decision below.
- A per-Avatar solver that makes declared hand contacts land (R4–R6).
- Checks and tools that catch the reviewed faults (R7–R9).
- Revising, adding, renaming and removing the Included Gestures in R10–R12, with
  one owner review in `animation:preview` and promotion to Included (R13).

Non-goals: facial-expression changes; procedural-layer changes; Reaction clips;
a fingertip anchor for effects (a hand-attached effect is enough); new Avatar
Effect art; a palm-aiming solver (palm direction stays authored); Gentle Double
Nod (optional in #314; not in the owner's 2026-10-09 list); renaming Particle
Effects (pending D6).

## Required behavior

### Hands

- **R1 — Presets.** Add `cupped`, `soft-claw`, `palm-flat`, `pinch` and `ok` to
  the existing seven, which keep their exact current shapes. Pinch and OK fit the
  index to the thumb on each Avatar so the pads meet (tip gap under 1 cm on both
  Included Avatars). The creator Hands tool offers them.
- **R2 — Per-finger offsets.** A hand key may carry `fingers.<digit>` offsets in
  the joint model's degrees: `curl` (one value, or one per segment) and proximal
  `splay` for fingers; `curl` (one or two values), `palmarAbduction` and `twist`
  for the thumb. Offsets belong to the key's beat and blend between keys with the
  preset. The app and the backend validate them.
- **R3 — Creator round trip.** At a beat that owns a hand key, choosing a preset,
  Curl or Spread in the Hands tool rewrites that key; editing finger bones
  writes `fingers` offsets onto that key. Keys at other beats are untouched, and
  retiming or deleting a beat moves or removes its hand keys. Edits offsets cannot
  express (finger twist, non-proximal splay, the thumb metacarpal) fall back to
  joint or rotation tracks for the affected bones only, keyed at every hand key
  with their current values so the hand at other beats is unchanged.

### Contacts

- **R4 — Solved contacts.** A contact may set `solve` (optional `blendIn` and
  `blendOut`, default 0.15 s; ramps of consecutive solved contacts on one side
  shorten to meet midway, so repeated contacts such as claps chain) and a `point` of `joint`, `palm` or `tip` (with
  `targetPoint` on a hand or finger target). During its window, playback adjusts
  that arm's upper arm and elbow on each Avatar so the point lands on the target,
  keeping the authored collarbone, elbow swivel, forearm rotation, wrist and
  fingers. Motion stays continuous through the blends. Unsolved contacts behave
  as today. Live layers that run after the clip (breathing; any unmuted head or
  torso layer) can still move a solved contact by millimetres; clips with solved
  head contacts mute the head and torso layers.
- **R5 — Avatar scale.** Contact offsets scale with Avatar height. Existing
  Included contacts move by at most 2.3 mm.
- **R6 — Creator editing of solved arms.** The creator shows the solved pose.
  An edit at a solved beat changes the authored arm by the same local change; one
  Avatar's solve is never written into the clip or into other beats. Retiming a
  beat maps solved contact windows through the new beat times (unsolved contacts
  move with their beat as today).
- **R7 — Palm facing.** A contact may declare `facing` so the checks verify the
  palm turns toward its target.

### Checks and tools

- **R8 — Checks.** Contacts are measured at their `point`; solved contacts use a
  tight tolerance and report an unreachable target. Parity is measured before
  solving. New findings: finger collisions (a finger through another finger, the
  palm or the other hand, outside a declared contact); a solved arm that is far
  from its contact before solving; a palm not facing its declared target; rapid
  oscillation (a joint swinging faster than about 4 Hz, measured as
  1 / (2 × time between reversals), for three or more cycles above a small
  amplitude).
- **R9 — Authoring tools.** `animation:render --view hands` shows hand
  close-ups. `animation promote` can add a Gesture with effect dependencies and,
  only for items the owner listed, change the display name or loop kind. The skill
  references describe the hand model, solved contacts, palm orientation, laugh
  rhythm and the new checks.

### Gesture content

- **R10 — Revisions** on both Included Avatars:

  | Gesture | Folder | Change |
  |---|---|---|
  | Arms Crossed | arms-crossed | Hands rest on the forearms |
  | Blow a Kiss | blow-a-kiss | Fingertips gathered; palm toward the mouth on the way up |
  | Cat Monster Rawr | cat-monster-rawr | Hold the "Rawr!" beat, then several swipes |
  | Cheeky Finger Guns | cheeky-finger-guns | Elbows and hands higher: guns at chest level |
  | Finger Heart Pose | finger-heart-pose | Re-animated: keep the current hand rotations (heart shape, wrist toward the viewer), smoother, hand(s) lifted to the shoulder (D5) |
  | Hands on Hips | hands-on-hips | Palms on the hips |
  | Hearty Laugh, Medium Laugh | hearty-laugh, medium-laugh | Fewer (3–4 per burst), slower (2.5–3.3 Hz), decaying, staggered pulses; Medium loses its forearm flap; the rest kept |
  | Hysterical Laughter | hysterical-laughter | Softer, slower pulses only |
  | Pout Huff | pout-huff | Hands rest on the arms |
  | Right Face Palm | right-face-palm | Palm faces the face |
  | Right Finger Point | right-finger-point | Re-animated: points toward the viewer, several points (D4) |
  | Small Wave | small-shy-wave | Palm toward the viewer; wrist out from the body centre, about shoulder width |
  | Salute | soldier-salute | Re-animated: holds the end of the salute (D4) |
  | Thinking Chin | thinking-chin-rest | Right elbow rests in the upturned left palm; fist under the chin on both Avatars |
  | Excited Triple Clap | excited-triple-clap | Palms meet flat in each clap (#314 weak spot) |
  | Right Thumbs Up / Down | right-thumbs-up, right-thumbs-down | Re-animated (D3): a lively thumbs gesture instead of a static 1 s pose |
  | Double Thumbs Up / Down | double-thumbs-up, double-thumbs-down | Re-animated (D3) |
  | Left OK Sign | left-ok-sign | Re-animated (D3) with the fitted `ok` shape |
  | Left Peace Sign | left-peace-sign | Re-animated (D3) |
  | Double Peace Pop | double-peace-pop | Re-animated (D3) |
  | Thinking Hand on Chin | thinking-hand-on-chin-hold | Re-animated (D3): hand on the chin as a solved contact |

  Each re-animation keeps the item's loop kind unless the owner says otherwise,
  and is authored from scratch or revised from the current clip at the author's
  discretion depending on how large the change is.

- **R11 — New Gestures.**
  - **Blow a Kiss 2:** the Blow a Kiss motion with both hands.
  - **Have an Idea** (replaces Storytelling, D1): the thinking pose from
    Storytelling (right elbow in the left palm) rising to a raised index finger,
    with a light bulb Avatar Effect appearing above the fingertip. This covers
    #314's Storytelling Think-beat item.
- **R12 — Names and removals.** Display names (proposed names marked *):

  | Folder | Current name | New name |
  |---|---|---|
  | arms-crossed | arms-crossed | Arms Crossed |
  | cat-monster-rawr | cat-monster-rawr | Cat Monster Rawr |
  | cheeky-finger-guns | cheeky-finger-guns | Cheeky Finger Guns |
  | finger-heart-pose | finger-heart-pose | Finger Heart Pose |
  | hands-on-hips | hands-on-hips | Hands on Hips |
  | heart-hands-build | heart-hands-build | Heart Hands (rename only) |
  | meme-dab | meme-dab | Meme Dab (rename only) |
  | right-face-palm | right-face-palm | Right Face Palm |
  | right-finger-point | right-finger-point | Right Finger Point |
  | shy-finger-poke-loop | shy-finger-poke-loop | Shy Finger Poke Loop (rename only) |
  | single-hand-on-heart | single-hand-on-heart | Hand on Heart (rename only) |
  | small-shy-wave | Small Shy Wave | Small Wave |
  | soldier-salute | soldier-salute | Salute |
  | thinking-chin-rest | Thinking Chin Rest | Thinking Chin |
  | double-peace-pop | double-peace-pop | Double Peace Pop* |
  | double-thumbs-down / -up | (same) | Double Thumbs Down* / Double Thumbs Up* |
  | left-ok-sign / left-peace-sign | (same) | Left OK Sign* / Left Peace Sign* |
  | right-thumbs-down / -up | (same) | Right Thumbs Down* / Right Thumbs Up* |
  | thinking-hand-on-chin-hold | (same) | Thinking Hand on Chin* |
  | thinking-head-scratch | (same) | Thinking Head Scratch* |

  \* Name proposed by the agent; display name only.

  Remove `shy-finger-poke` and `storytelling` (replaced by Have an Idea). The
  motion manifest, starter loadout (D2), tests, journeys and docs agree after the
  change.
- **R13 — Review and promotion.** Every new or revised Gesture passes
  `animation validate`/`check` (no FAIL; WARNs explained) and the bulb effect
  passes `effects check`; each is rendered on both Avatars, and is reviewed by the owner in one `animation:preview` session
  with every note resolved. Promotion to Included happens only after the owner
  approves each item (mode and identity) and the licence and source-review wording.

## Constraints and compatibility

- Clip format stays `animaPoseClip/2.0`; new fields are optional and no package
  capability is added. Clips without them sample identically (baseline: hashes of
  quantized samples on both Included Avatars from `main` at `bfc0de4f`).
- Older builds (none released as of 2026-10-09) silently drop `fingers`, `point`,
  `targetPoint`, `facing` and `solve`, and reject a package containing a new
  preset at import.
- The backend validates new presets, offsets and contact fields on package
  import, export and Idle Style eligibility, sharing vocabulary and fixtures with
  the app.
- The new bulb effect appears in the Avatar Effect picker with a thumbnail, as
  `effectTemplates.test.ts` requires for every Included Avatar Effect.
- **Renames** keep folder, content ID and Selector ID unless D1 says otherwise;
  Loadouts keep working.
- **Removals** (`shy-finger-poke`, `storytelling`): an Anima that equips one
  explicitly shows a Loadout warning and cannot be exported until the binding is
  removed; Local Idle Styles pooling them lose that entry; editing starter policy
  v1 in place changes every existing Anima's implicit starters and invalidates
  in-progress Anima creation drafts (409, retry); the Scene Effects used only by
  `shy-finger-poke` move from the desktop core partition to the expanded pack.
  Recovery: remove the binding in Loadout, or reset a development database at the
  owner's discretion. Policy, content and test pins change in one commit.
- **ADR conflict:** R2/R3 amend ADR 0014 (hand tracks are presets with Curl and
  Spread; a finger edit converts a hand to finger tracks), and R4 makes contacts
  affect playback. A new ADR records the change.

## Acceptance criteria

- [x] Owner agrees the hand model (D0) and D1–D6 (2026-10-09); recorded in #314
      and, for D0, in the new ADR (pending).
- [ ] Unit tests: presets and fitting on both Avatars, offsets, schema and backend
      validation (shared fixtures), creator round trip, solver on both Avatars,
      checks (including oscillation and finger collisions), promote tooling.
- [ ] Sample hashes of untouched Included clips match the `bfc0de4f` baseline.
- [ ] Every R10/R11 item, including the re-animated legacy clips: validate and check clean, body and hand renders on both
      Avatars, owner approval in the preview session with notes resolved.
- [ ] Owner approves licence/source-review wording and each promotion; recorded in
      the PR.
- [ ] `pnpm check`, `pnpm web:lint`, `pnpm web:test`, `pnpm build`,
      `pnpm desktop:runtime:stage`, `pnpm desktop:runtime:audit`; `uv run pytest -q`,
      `make check-test`; e2e `accountless-creator-generated-gesture` and the
      retargeted Library/playback journeys, on a task stack.
- [ ] Hosted Validation is not available (workflow disabled); the PR records
      local evidence and the owner's acceptance of it.

## Decisions

Made:

- 2026-10-09, owner: promotion to Included, renames and removals are now in scope;
  #314's "re-save as Local" and "keep 1.0 clips playing" lines are superseded
  (all clips are 2.0 since #375; Included content is revised by promotion).
- 2026-10-09, owner: build the contact solver here if it helps (it does: about
  half of R10/R11 are contact faults).

Agreed 2026-10-09 (owner: "approve with recommendations"; D3 changed):

- **D0 — Hand model.** Model B hybrid: fitted presets plus per-finger offsets on
  beat-owned hand keys; finger `joints` kept for rare shapes. Prototype evidence:
  the same eight shapes take 8 keys/1 KB vs 244 keys/12 KB as per-finger joints
  (model A); real Gestures 3–4 KB vs 12–13 KB; pinch/OK fit per Avatar (6–7 mm
  gap) where hand-written thumb angles miss by 25–29 mm.
- **D1 — Identities.** Renames change display names only. Have an Idea is added
  as a new one-shot (`have-an-idea`, Selector ID `have_idea`) and Storytelling
  (`tell_story`) is removed. Blow a Kiss 2 is a one-shot `blow-a-kiss-2` /
  `blow_kiss_both`. Neither is a starter. The bulb effect is `idea_bulb_fingertip`.
- **D2 — Starters.** Remove `shy-finger-poke` from starter policy v1 in place (21
  → 20 starters), without a replacement.
- **D3 — Unlisted legacy clips** (thumbs up/down, double thumbs, Left Peace/OK
  Sign, Double Peace Pop, Thinking Hand on Chin): renamed and re-animated in this
  issue (owner's change to the recommendation).
- **D4 — Loops.** Right Finger Point becomes a one-shot with two or three points
  (it is a 1 s static loop today). Salute stays a one-shot with about 1 s held at
  the end.
- **D5 — Finger Heart Pose** stays one-handed (as today), lifted to the shoulder.
- **D6 — Particle Effects** with legacy hyphenated names (`hearts-v1`,
  `hearts-v2`, `star-v2`, `exclamation-v1`, `question-v1`) stay as they are.

## Spec

#314 (this file is its snapshot).

## ExecPlan

[hand-animation-gestures-execplan.md](hand-animation-gestures-execplan.md)

## Delivery links

Phase issues #380 (P1), #381 (P2), #382 (P3), #383 (P4), #384 (P5), sub-issues of
#314 with blocked-by links. One PR from `feat/hand-animation-gestures` closes all six.
