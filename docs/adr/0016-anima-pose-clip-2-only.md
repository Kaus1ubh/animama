# 0016: animaPoseClip/2.0 is the only clip format

- Status: accepted
- Recorded: 2026-10-08
- Retrospective: no
- Original decision date: 2026-10-08 (owner decisions on
  [issue #337](https://github.com/raymond-van/animama/issues/337))
- Supersedes: [ADR 0014](0014-track-based-anima-pose-clips.md) consequence
  "Two clip schemas coexist" (1.0 stays playable)
- Decision basis: [issue #337](https://github.com/raymond-van/animama/issues/337)
  and the [execution plan](../plans/clip-format-v2-only/clip-format-v2-only-execplan.md)

## Context

[ADR 0014](0014-track-based-anima-pose-clips.md) introduced `animaPoseClip/2.0`
for new saves and kept `animaPoseClip/1.0` playable: 16 Included Gestures and
all 72 Reactions stayed 1.0, and the runtime, creators, backend validation and
package import each carried a 1.0 path, including runtime-only poses that 1.0
clips referenced by id. The owner confirmed that no 1.0 clip exists outside
development environments: there are no shipped installations or shared
packages.

## Decision

1. **`animaPoseClip/2.0` is the only Gesture and Reaction clip format.** The
   schema name stays `animaPoseClip/2.0`.
2. **1.0 clips are rejected, never converted.** The `animaPoseClip/1.0` schema
   string identifies a retired clip, which is refused with one user-facing
   reason: in the frontend runtime, creators, import and preview tools
   (`UnsupportedAnimaPoseClipFormatError`), in backend Local scans, Save and
   package import (`clip_format_unsupported`), and in idle playback
   (`idle_motion_invalid` with the same message). Any other schema gets the
   same treatment.
3. **Included clips were converted once.** The 1.0 Gestures and Reactions were
   converted with the 1.0 converter and verified against 1.0 playback (within
   0.01° rotation, 0.1 mm position and 0.001 expression weight, with one
   owner-accepted exception) before the converter and sampler were deleted.
   Their identities, loop kinds and Reaction fields are unchanged.
4. **The poses those Gestures referenced are Included Poses.** Clips name a
   Pose only as their `basePose`. The retired standalone `pose_clip` kind is
   parsed only for Save-receipt replay; its transitions were removed.

`animaPose/1.0` (standalone Poses) is a separate format and is unaffected.

## Rationale and consequences

One format removes a parallel parser, sampler, converter and creator path from
both runtimes. Rejecting rather than converting keeps no conversion code alive
for content that does not exist outside development; development databases can
be reset. Dry runs of a one-off migration tool on the owner's Local roots
before removal found no 1.0 clips.

Converted Gestures are beats with rotation tracks, not anatomical joint tracks.
They play the same but are less pleasant to hand-edit; that trade-off was
accepted. A 2.0 expression track drives its channel for the whole clip, so a
1.0 expression that was only driven between some keyframes holds its value
elsewhere (`finger-heart-pose` blink, accepted by the owner).

## Evidence

- [Issue #337](https://github.com/raymond-van/animama/issues/337): scope, owner
  decisions and acceptance.
- [Execution plan](../plans/clip-format-v2-only/clip-format-v2-only-execplan.md):
  conversion verification, Local migration dry runs and review records.
- `src/frontend/web/src/lib/avatar/poses/animaPoseClip/parseClip.ts` and
  `src/backend/animama/app/services/clip_format.py`: the rejection and its
  message.
