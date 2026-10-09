# 0020: Solved hand contacts

- Status: accepted (owner, 2026-10-09)
- Recorded: 2026-10-09
- Retrospective: no
- Original decision date: 2026-10-09 (owner agreement to the specification and
  execution plan for [issue #314](https://github.com/raymond-van/animama/issues/314))
- Decision basis: [issue #314](https://github.com/raymond-van/animama/issues/314),
  the [specification](../plans/hand-animation-gestures/hand-animation-gestures-spec.md)
  (R4–R7) and the solver proposal in the
  [execution plan](../plans/hand-animation-gestures/hand-animation-gestures-execplan.md)
  Decision Log

## Context

An `animaPoseClip/2.0` contact (`bone`, `target`, beat-relative `from`/`to`,
`offset`, `tolerance`) declared an intended touch that only the motion checks
measured, at the bone's joint origin (usually the wrist). Playback ignored it.
The Included Avatars are almost the same height but differ by about 6 cm in
arm length and 5 cm in shoulder width, so the same joint angles put a hand on
a forearm on one Avatar and in the air on the other. Several Included Gestures
also declared their faulty pose: a wrist at an elbow with a 10–12 cm tolerance
passed the checks.

## Decision

1. **A contact may be solved.** `solve: {}` or `{ blendIn?, blendOut? }`
   (0–2 s, default 0.15 s, applied at playback and never written) makes
   playback move that arm on each Avatar so the contact lands during its
   window, easing in before it and out after it with smootherstep ramps.
   Ramps of consecutive solved windows on one side are shortened to meet
   midway, so repeated contacts such as claps chain through the authored pose.
2. **Only the upper arm and elbow move.** An analytic two-bone reach changes
   the elbow's flexion and the upper arm's swing, keeping the authored
   collarbone, elbow swivel, forearm rotation, wrist and fingers. The solve
   runs per Avatar when the clip is prepared and sampled, after the planted
   legs, on the final pose. The pinned target moves from the authored point to
   the target by the solve weight, so the authored arm returns exactly outside
   the window. Over the last 3 cm of an arm's reach the distance saturates
   smoothly (soft reach), so the elbow slows to rest as it straightens: a
   target at full reach misses by about 1.1 cm, and one beyond reach leaves
   the arm pointing at it. A target inside the fold clamps.
3. **Contacts are measured at a point.** `point` and `targetPoint` choose the
   joint origin (`joint`, the default), the palm surface halfway from the
   wrist to the middle finger's base (`palm`, hand bones only) or the far end
   of a finger segment, the pad for a last segment (`tip`, finger bones only).
   `offset` is in metres at a reference rest height of 1.25 m (head bone above
   the feet) in the target's rest-aligned frame, and scales with each
   Avatar's height.
4. **Palm direction stays authored.** `facing: true` asks the checks to verify
   that the palm turns toward the target; playback does not aim the palm.
5. **One solved contact per side at a time; mutual solves only for crossed
   arms.** A solved contact moves a hand or finger bone, its target is not on
   the arm it moves, and solved windows on one side must not overlap. Two
   solved contacts on opposite sides whose targets each lie on the other arm
   may not be active at once (windows with their blends, wrapped across a
   loop's seam) unless both targets are an upper arm or forearm: when either
   targets the other hand or its fingers, each hand chases the other and the
   solve diverges. A clap therefore solves one palm onto the other. When each
   hand rests on the other upper arm or forearm (crossed arms), both are
   solved and the sides alternate until they agree.

The frontend parser and the backend validator share these rules and their
vocabulary; absent fields stay absent. Retiming a beat maps solved windows
through the old and new beat times; unsolved contacts keep their offsets from
their beat.

## Rationale and consequences

Solving per Avatar is the only way one clip lands on rigs with different arm
proportions; joint angles cannot. Moving only the upper arm and elbow keeps
the authored character of the motion (shoulder, forearm roll, wrist, fingers)
and has a closed-form solution: solving adds a few microseconds to a sampled
frame, and ramps stay continuous. Keeping solving opt-in leaves every existing
clip playing exactly as before.

Alternatives considered:

- **Check-only contacts** (the previous behavior) cannot make the same clip
  land on both Included Avatars.
- **Writing a solved arm into the clip** would fit one Avatar and break the
  other; the creator therefore never writes one Avatar's solve into the clip.
- **An offset mode** (keeping the authored distance from a moving target
  instead of pinning to it) and **a palm-aiming solve** (turning the wrist
  toward the target) are deferred. Pinning covers the reviewed Gestures, and
  authored palm direction plus the `facing` check keeps the wrist expressive.

Consequences:

- Clips without `solve` sample exactly as before; the Included Gesture sample
  baseline proves it.
- Live layers that run after the clip (breathing; any head or torso layer the
  clip does not mute) can still move a solved contact by millimetres. Clips
  with solved head contacts should mute the head and torso layers.
- Builds without this change silently drop `point`, `targetPoint`, `facing`
  and `solve`: they play the authored arms and measure contacts at joints.
  None had been released by 2026-10-09.
- The motion checks (spec R8) measure parity between the Avatars before
  solving, and a solved contact on the solved pose, reporting an unreachable
  target.
- Large corrections move fast. A target at or beyond an Avatar's reach, a
  correction of several centimetres in a short ramp, or an arm the solve
  drives nearly straight (whose swivel is undefined, so the solver fades its
  swivel correction out) can turn the upper arm or elbow by many degrees per
  frame. The soft reach keeps the elbow's speed bounded near full reach, but
  no solve can shorten the distance a ramp must cover. Authored arms should
  come within a few centimetres of their solved contacts, elbows bent.
- A solved window that starts where another on its side ends gets no ramps
  between them, so a different target there makes the arm jump. Such windows
  continue the same contact, or leave a gap for the ramps.

## Evidence

- [Specification](../plans/hand-animation-gestures/hand-animation-gestures-spec.md)
  R4–R7 and the execution plan's Decision Log (solver v1: pin mode, authored
  wrist kept, one solved contact per side, solved after legs, 0.15 s blends,
  ramps meeting midway).
- `src/frontend/web/src/lib/avatar/poses/anatomy/arms.ts`: `ArmReachSolver`,
  `solveArmContacts`, `contactSolveWeight`, `fitContactSolveRamps`,
  `CanonicalSkeleton.pointOffset` and `avatarScale`; `arms.test.ts` lands palm,
  tip and joint contacts (and a one-sided clap) on both Included Avatars and
  checks swivel, ramps, mutual crossed arms and the elbow's bounded speed past
  full reach.
- `src/frontend/web/src/lib/avatar/poses/animaPoseClip/prepareV2.ts`
  (`armContactSolver`) and `prepareV2.test.ts`: a solved palm lands on the chin
  on both Included Avatars where the authored arm misses by 1.7–2.9 cm; ramps,
  a loop seam and claps 0.2 s apart (one solved palm) stay continuous.
- `schemaV2.ts` and `src/backend/animama/app/services/idle_clip_validation.py`
  with the shared `fixtures/contacts-v2.json` (mutual solves onto a hand
  rejected, crossed arms accepted) and `fixtures/v2-vocabulary.json`.
