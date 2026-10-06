# 0014: Track-based Anima Pose Clips organised by beats

- Status: accepted
- Recorded: 2026-10-06
- Retrospective: no
- Original decision date: 2026-10-05 (owner intent decisions in
  [issue #282](https://github.com/raymond-van/animama/issues/282)); format
  choices 2026-10-06 under the owner's deferral, confirmed by a prototype
- Decision basis: [issue #282](https://github.com/raymond-van/animama/issues/282)
  and the [execution plan](../plans/track-based-pose-clips/track-based-pose-clips-execplan.md)

## Context

`animaPoseClip/1.0` stores whole-body poses at keyframes with one easing per
segment. Agent-authored Gestures (#260) are per-bone curves, so they had to be
baked into dense keyframes: about 100 times the size of their curves, about
8 s of busy motion within the 2 MiB clip limit, and 60–250 keyframes that
cannot be edited in the Gesture creator. The saved clip also lost the
authoring intent, so revising a Gesture needed a separate description file.

The owner decided (2026-10-05) that agents author per-bone motion while people
work by beats on the creator's existing Pose lane, and that generated detail
belongs to its beat. One format serves all new Gesture and Reaction saves; the
runtime keeps playing 1.0.

## Decision

1. **`animaPoseClip/2.0` stores keyed tracks grouped by named beats.** Every key
   belongs to a beat and stores its time as an offset from it; values stay
   absolute. Keys lie between their beat's neighbours. A beat's keys at an
   offset, and any further keys it owns, are its generated detail.
2. **Two rotation track kinds.** Anatomical tracks key the joint model's named
   components in degrees (the `animamaMotion/1` vocabulary plus auxiliary
   components completing each joint's three axes) and carry authored motion.
   Per-bone quaternion tracks with slerp carry hand-made poses, converted 1.0
   clips and bones without a joint definition. A bone uses one kind.
3. **Interpolation arrives at keys:** `smooth` (monotone cubic), `linear`,
   `hold` or a 1.0 easing, per key or beat, matching 1.0's destination-keyframe
   convention.
4. **Hands and planted feet are resolved per Avatar at playback.** Hand tracks
   reference Hands-tool presets with Curl and Spread; the leg solver runs on the
   Avatar's own rig when `plantFeet` is set.
5. **Retiming moves a beat's keys rigidly** and stretches or compresses
   neighbouring detail so key order is kept. Editing a beat's pose shifts its
   keys; deleting it removes them. That a beat carrying detail cannot pass a
   neighbour awaits owner confirmation (#282).
6. **Agents write 2.0 directly.** The bake step and `animamaMotion/1` are
   retired; the saved clip is the authoring source.

## Alternatives considered

- **A proportional time-warp on retime.** It also preserves order, but it
  distorted the moved beat's own motion (28° against 3° for the laugh's burst
  in the prototype).
- **Anatomical tracks only.** Converting the Included 1.0 Gestures was not
  faithful: hand-made poses rotate joints about non-anatomical axes (residuals
  up to 138° with the previous joint model), and interpolating components
  instead of slerping deviated by up to 22° mid-segment.
- **Baking leg-solver output into tracks.** Solving per Avatar removed the VRM 0
  foot drift (up to 3.9 mm to 0.0 mm) and survives beat edits.
- **Per-finger tracks only.** Preset references keep Gestures readable and
  revisable; a creator finger edit converts a hand to finger tracks.

## Consequences

- Generated clips shrink to 1–8% of their 1.0 bakes and can run about 20 s or
  more within the existing limit. Sampling them is far cheaper than sampling a
  dense 1.0 bake (0.014 ms against 12.7 ms per frame for the hearty laugh, whose
  1.0 sampler re-parses all 247 keyframes on each call).
- The runtime must prepare a 2.0 clip per Avatar (hand fitting and the leg
  solver) and needs the joint model at playback.
- Two clip schemas coexist; Included 1.0 content is unchanged until edited, and
  older application versions cannot read 2.0 clips.
- Live layers that move the hips still offset planted feet when not muted, as
  for 1.0 clips.
