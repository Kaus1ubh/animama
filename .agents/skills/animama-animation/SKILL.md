---
name: animama-animation
description: Author natural, expressive Animama Gestures from a text prompt by writing an animaPoseClip/2.0 clip (beats and per-joint tracks), validating it, running the motion checks, live preview and review renders on both Included Avatars, and saving it as Local content through the Gesture creator; starts with a short clarifying interview, authors up to ten Gestures as a batch, and revises saved Gestures from their Library item. Use for new or revised body-and-face Gesture motion; VRM internals, Avatar Effects and particle effects have their own skills.
---

# Animama Animation

Turn a motion prompt into a Gesture that reads well in chat. You write an
**`animaPoseClip/2.0` clip**: named beats on a timeline, and anatomical joint
angles keyed to those beats. The same file plays in chat, opens in the Gesture
creator and is what Save stores. Checks, the live preview and renders show
what it does on both Included Avatars. Never hand-write quaternions, bypass
creator Save, or write into `content/included/`.

Use `animama-vrm` for VRM, coordinate and runtime facts. Repository paths are
relative to the Animama Git root. Commands run from `src/frontend/web`; in a
fresh checkout run `pnpm install` and `pnpm packages:build` in `src/frontend`
first.

## Workflow

0. **Interview.** Before planning, ask the owner the few questions whose
   answers would change the clip (when chat uses it, one-shot or held,
   intensity, leading hand, contacts, face), with your recommended option
   first, and confirm the resulting brief. Skip it when the prompt already
   settles the performance or the owner says to use your judgement. See
   [interview](references/interview.md).
1. **Plan the performance.** Read the prompt into beats with times:
   anticipation → action → follow-through → settle (one-shot), or an alive hold
   that loops seamlessly (held). Choose duration, loop, which body regions lead
   and lag, facial expressions, hand shapes, contacts and layer mutes.
   Read [motion principles](references/motion-principles.md).
2. **Write the clip** as `<name>.clip.json` in the location the owner names;
   otherwise in `src/frontend/web/src/lib/avatar/motion-authoring/examples/`
   on the task branch, where it stays visible for review and future edits.
   Look up joints and ranges with `pnpm -s animation joints` and base values
   with `pnpm -s animation base`. Read [clip format](references/clip-format.md),
   [human movement](references/human-movement.md) and
   [hands and face](references/hands-and-face.md).
3. **Validate:** `pnpm -s animation validate <file>.clip.json`. It reports
   structural problems and values beyond anatomical limits with JSON paths,
   and the saved size against the 2 MB the app loads.
4. **Check:** `pnpm -s animation check <file>.clip.json`. Fix every FAIL;
   treat WARN as a prompt to look. See [checks and review](references/checks-and-review.md).
5. **Preview and look:** `pnpm -s animation:preview <file>.clip.json`
   plays it live on both Avatars with live layers, beat markers and camera
   presets, and reloads as you edit; its pickers switch to other clips and
   Library items without a restart. Judge timing there; use
   `pnpm -s animation:render <file>.clip.json --out <dir>` for still contact
   sheets (`--times` for beats, `--side left` for left-handed action). Revise
   and repeat from step 2 until it reads clearly and naturally. When the owner
   leaves review notes, apply them and resolve each with
   `pnpm -s animation resolve` (see checks and review).
6. **Save through the creator:** `pnpm -s animation:save <items.json>` saves
   each listed clip with its name, AI description and Selector ID through the
   Gesture creator (a new Local Gesture, or a revision when that Selector ID
   is already saved) and reopens it; or do the same by hand (see
   [checks and review](references/checks-and-review.md)). Never Save & Equip
   unless the owner asks.
7. **Chat check** when mutes or expressions matter: play it on a test Anima.
8. **Hand off** with the saved item, clip path, check summary, preview notes,
   render sheets, the chat check and known limits.

**Several Gestures at once:** follow [batch mode](references/batch.md) for up
to ten per batch: one interview round, parallel authoring, a consistency
pass, one preview for the owner and one save run.

**Revising a saved Gesture:** start from the Library item itself. Preview it
with `pnpm -s animation:preview library:<selector>`, which prints its clip
file's path. Copy that file to your working location, edit it, then validate, check
and preview with `--compare library:<selector>` to see old and new together.
Save it with `animation:save` under the same Selector ID (or import it in
the creator and Save); the item keeps its identity. A 1.0
Gesture (most Included content) must first be opened and saved once in the
creator, which converts it to 2.0; `validate` accepts only 2.0.

## Decision rules

- Describe intent anatomically (degrees on named joint components) on
  readable beats; playback handles bases, VRM 0 conversion, smoothing, hand
  fitting and planted legs on each Avatar.
- Keep each key on the beat it belongs to, offset with `dt`, so retiming a
  beat in the creator moves the right motion with it.
- Stagger regions: the eyes/head lead, the torso follows, arms trail and
  overshoot, hands and fingers settle last. Uniform timing looks robotic.
- Set `"plantFeet": true` (2.0 clips do not plant feet unless asked) and move
  weight through hips offset and small pelvis rotation; the legs are solved
  automatically on each Avatar.
- Prefer the Hands-tool presets for hand shapes; key finger joints only for
  shapes presets cannot make.
- A Gesture's keyed emotion expressions replace the emotion face while it
  plays. Key expressions that suit the motion, and leave them out when the
  Gesture should keep the Anima's current emotion.
- List `mutedProceduralLayers` explicitly: a clip without it mutes nothing.
  Usually mute all but `breathing`; keep `cursorLookAt` unmuted only when the
  head does not move.
- **Selector IDs and tiers:** the Selector ID is how chat picks a Gesture.
  Use lowercase snake_case naming the action (`wave_hello`); for intensity
  tiers of one action, share the stem and add the tier (`laugh_mild`,
  `laugh_medium`, `laugh_hysterical`), and say in each AI description when
  that tier fits. Ask the owner which Selector ID a replacement for an
  existing Gesture should use.
- Long Gestures (10–20 s) are sequences of short actions: give each its own
  beats, let each settle briefly before the next, and keep loops of attention
  (blinks, small head moves) alive through the holds.
- Checks catch anatomy, collisions, grounding and continuity; they cannot
  judge naturalness. Always look at the preview and renders, and report what
  was not reviewed.
