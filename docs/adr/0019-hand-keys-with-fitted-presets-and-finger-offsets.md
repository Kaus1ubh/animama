# 0019: Hand keys with fitted presets and per-finger offsets

- Status: accepted (owner, 2026-10-09)
- Recorded: 2026-10-09
- Retrospective: no
- Original decision date: 2026-10-09 (owner agreement to decision D0 on
  [issue #314](https://github.com/raymond-van/animama/issues/314))
- Supersedes: [ADR 0014](0014-track-based-anima-pose-clips.md) decision 4's
  hand tracks as "presets with Curl and Spread" only, and its statement that a
  creator finger edit converts a hand to finger tracks
- Decision basis: [issue #314](https://github.com/raymond-van/animama/issues/314),
  the [specification](../plans/hand-animation-gestures/hand-animation-gestures-spec.md)
  (D0) and the prototype recorded in the
  [execution plan](../plans/hand-animation-gestures/hand-animation-gestures-execplan.md)

## Context

[ADR 0014](0014-track-based-anima-pose-clips.md) made a clip's hand track a list
of keys naming one of the Hands tool's seven presets with relative Curl and
Spread, fitted to each Avatar at playback. Finger detail could only come from
finger `joints` tracks, which replace the hand key on that segment for the whole
clip, and a creator edit to one finger converted the hand's keys into fixed
rotation tracks.

That model could not make a pinch, a kiss, an OK sign or a cupped clap. No
Included Gesture keyed finger joints, and one finger edit in the creator turned a
readable hand into rotation tracks. Hand-written thumb angles also missed small
contacts: the Included Avatars have near-identical finger rigs, yet a pinch
written as fixed angles left the thumb and index tips 25–29 mm apart.

This record covers hand shapes only. Making declared contacts move the arms at
playback is a separate decision.

## Decision

1. **Hand keys remain the way Gestures author hands.** A key names a preset,
   then optional whole-hand `curl` and `spread`, then optional per-finger
   `fingers` offsets, applied in that order. Offsets are joint-model degrees:
   `curl` (one value, or one per segment) and proximal `splay` for fingers;
   `curl` (one value, or one per segment), `palmarAbduction` and `twist` for
   the thumb. They belong to the key's beat and blend between keys with the
   preset.
2. **Twelve presets.** The seven existing presets keep their shapes wherever
   the thumb joint can reach them. A fitted thumb is now held within the
   joint's anatomical limits, which changes only fits that were past them (for
   example a fist around an unrotated thumb metacarpal). `thumbs-up` is held
   within the joint's natural range instead: even around the Included Avatars'
   own metacarpals its thumb needed a curl of about −70° against the −60°
   limit, so it stops at −50° and its tip bends back 25°. `cupped`,
   `soft-claw`, `palm-flat`, `pinch` and `ok` are written as the same offsets. `pinch` and `ok` are fitted to each Avatar: the index curl is scaled
   until its tip is one thumb length from the thumb's base, then the thumb is
   aimed at that tip.
3. **Finger `joints` tracks remain** for shapes offsets cannot express. They
   still replace the hand key on their segments for the whole clip.
4. **Creator finger edits write offsets.** Editing finger bones at a beat writes
   `fingers` offsets onto that beat's hand key instead of converting the hand to
   finger tracks. Edits that offsets cannot express (finger twist, splay beyond
   the proximal segment, the thumb metacarpal) fall back to joint or rotation
   tracks for the affected bones only.

## Rationale and consequences

The prototype authored the same shapes both ways. As hand keys, the eight-shape
gallery took 8 keys and about 1 KB. Expanded to per-beat finger joint keys, the
alternative model, it took 244 keys and about 12 KB. Two real Gestures (Thinking
Chin Rest and Blow a Kiss) took 3–4 KB against 12–13 KB. Hand keys also keep
the authored intent readable and revisable, which ADR 0014 chose presets for.

Fitting pinch and OK per Avatar brings the thumb and index tips within 6–7 mm on
both Included Avatars. Fixed thumb angles cannot do this because the fit depends
on each rig's thumb position and finger lengths.

Consequences:

- Clips without `fingers` sample as before, except `thumbs-up` hands (no
  Included Gesture used one) and thumb fits that were past the joint's
  anatomical limit, which now stop at it.
- Builds without this change drop `fingers` silently and reject a package that
  uses a new preset. None had been released by 2026-10-09.
- The frontend and backend validate presets and offsets from one shared
  vocabulary.
- An offset adds the same joint-component change on every Avatar, but to that
  Avatar's fitted preset. The fitted parts (thumbs, and the index of `pinch`
  and `ok`) differ between Avatars, so there the same offset gives a slightly
  different rotation.
- The pinch fit runs a short search once per hand key when a clip is prepared
  for an Avatar, not per frame.

## Evidence

- [Specification](../plans/hand-animation-gestures/hand-animation-gestures-spec.md),
  decision D0 and requirements R1–R3; the execution plan's Decision Log records
  the prototype method and measurements.
- `src/frontend/web/src/lib/avatar/poses/anatomy/handPresets.ts`:
  `OFFSET_PRESETS`, `fitPinch` and `handShapeRotations` (application order).
  `handPresetIds.ts`: preset ids and the offset vocabulary
  (`HAND_DIGIT_OFFSETS`, `HAND_FINGER_OFFSET_LIMIT`).
- `handPresets.test.ts`: the original presets match digests computed from
  `bfc0de4f` (`thumbs-up` updated deliberately); thumb fits within the
  anatomical limits stay exactly as at `bfc0de4f`, also around Library Poses'
  thumb metacarpals; every preset keeps the finger and thumb joints within
  their anatomical limits around every Library Pose's thumb metacarpal; and
  pinch and OK tips meet within 1 cm on both Included Avatars (6.1 mm on
  AvatarSample_A_1_New, 7.1–7.2 mm on AvatarSample_Y_0).
