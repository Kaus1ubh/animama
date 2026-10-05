---
name: animama-animation
description: Author natural, expressive Animama Gestures from a text prompt by writing a per-bone motion description, generating an animaPoseClip/1.0 sequence, running the motion checks and review renders on both Included Avatars, and saving it as Local content through the Gesture creator. Use for new or revised body-and-face Gesture motion; VRM internals, Avatar Effects and particle effects have their own skills.
---

# Animama Animation

Turn a motion prompt into a Gesture that reads well in chat. You write a
**motion description**: anatomical joint angles keyed per bone over time. The
generator turns it into a smooth `animaPoseClip/1.0` sequence; checks and
renders show what it does on both Included Avatars. Never hand-write
quaternions, bypass creator Save, or write into `content/included/`.

Use `animama-vrm` for VRM, coordinate and runtime facts. Repository paths are
relative to the Animama Git root. Commands run from `src/frontend/web`; in a
fresh checkout run `pnpm install` in `src/frontend` first (a package build is
not needed for these commands).

## Workflow

1. **Plan the performance.** Read the prompt into beats with times:
   anticipation → action → follow-through → settle (one-shot), or an alive hold
   that loops seamlessly (held). Choose duration, kind, which body regions lead
   and lag, facial expressions, hand shapes, contacts and layer mutes.
   Read [motion principles](references/motion-principles.md).
2. **Write the description** as `<name>.motion.json` in the location the
   owner names; otherwise in
   `src/frontend/web/src/lib/avatar/motion-authoring/examples/` on the task
   branch, where it stays visible for review and future edits. Look up joints and ranges
   with `pnpm -s animation joints` and base values with `pnpm -s animation base`.
   Read [description format](references/description-format.md),
   [human movement](references/human-movement.md) and
   [hands and face](references/hands-and-face.md).
3. **Generate:** `pnpm -s animation generate <file>.motion.json --out <clip.json>`.
   It refuses invalid descriptions, baked playback that strays beyond 1° /
   5 mm from the curves, and clips that would save larger than the 2 MB the
   app loads. Every keyframe stores every animated bone, so long, busy clips
   grow fast; the output reports the saved size.
4. **Check:** `pnpm -s animation check <file>.motion.json`. Fix every FAIL;
   treat WARN as a prompt to look. See [checks and review](references/checks-and-review.md).
5. **Render and look:** `pnpm -s animation:render <clip.json> --out <dir>`
   (add `--times` for beats and `--side left` for left-handed action). Inspect
   front, ¾, side and face views on both Avatars. Revise and repeat from step 2
   until it reads clearly and naturally.
6. **Confirm in the creator and save:** import the clip JSON in
   `/gestures/new` (Clip tab → Import), check Clip settings → Mute while
   playing, play it on each Avatar, then **Save** (not Save & Equip unless the
   owner asks). Reopen and confirm playback.
7. **Chat check** when mutes or expressions matter: play it on a test Anima.
8. **Hand off** with the saved item, description path, check summary, render
   sheets, the chat check and known limits. Keep the description out of
   scratch space: it is the only editable source of a generated clip. Clips
   and renders can go to scratch; regenerate them from the description.

## Decision rules

- Describe intent anatomically (degrees on named joint components); let the
  generator handle bases, VRM 0 conversion, smoothing and planted legs.
- Stagger regions: the eyes/head lead, the torso follows, arms trail and
  overshoot, hands and fingers settle last. Uniform timing looks robotic.
- Keep feet planted (`plantFeet` default) and move weight through hips offset
  and small pelvis rotation; the legs are solved automatically.
- Prefer the Hands-tool presets for hand shapes; key finger joints only for
  shapes presets cannot make.
- A Gesture's keyed emotion expressions replace the emotion face while it
  plays. Key expressions that suit the motion, and leave them out when the
  Gesture should keep the Anima's current emotion.
- Mute live layers that would fight the motion (default: all but breathing).
  Keep `cursorLookAt` unmuted only when the head does not move.
- Checks catch anatomy, collisions, grounding and continuity; they cannot
  judge naturalness. Always look at the renders, and report what was not
  reviewed.
