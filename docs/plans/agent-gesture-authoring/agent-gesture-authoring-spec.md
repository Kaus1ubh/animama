# Agent-authored Gesture motion

Status: Agreed
Owner decision: On 2026-10-03 the owner agreed the discovery outcome summarized
below. This includes a phased approach: per-bone motion authoring baked into
`animaPoseClip/1.0` first, with a track-based clip format and creator timeline
only if this step earns them. The owner asked to proceed while noting that the
evaluation prompt set and rubric are not final. Later on 2026-10-03 the owner
resolved mute storage, headless Hands presets, the skill name and expression
precedence, then requested an ExecPlan. That request accepts this specification
as the planning basis.
Authoritative source: https://github.com/raymond-van/animama/issues/260.
Snapshot captured 2026-10-03 at publication; refresh from the issue before resuming.
Related: [#243](https://github.com/raymond-van/animama/issues/243) evaluates
external motion sources; this work is tracked separately.

## Problem and intended users

The Included motion library is small, and most Gestures look stiff. The 22 Included
Gestures use 2–7 whole-body keyframes over 1–2.6 s. The `animaPoseClip/1.0`
format makes richer motion hard to author:

- Every bone shares the same keyframe times and one easing per segment.
- A bone omitted from a keyframe resolves to `basePose` rather than holding.
- Interpolation does not carry velocity through a keyframe. Eased segments
  stop at every keyframe, and linear segments kink.

As a result, the overlapping timing of a real body, where the head leads, an
arm trails and overshoots, and the spine moves before the shoulder, can only be
approximated by hand-computing every bone at many keyframes.

The intended user is a coding agent (for example Claude Code or Codex) working in
this repository on the owner's behalf. Given a text description such as "wave
hello with the right hand", it should produce a natural Gesture and save it as
Local content for owner review. The owner benefits from a growing library without
hand-posing every keyframe, and Anima users benefit from more expressive avatars.

This step also tests a hypothesis. Generating per-bone motion and baking it into
dense `animaPoseClip/1.0` keyframes may produce clearly better Gestures. If it
does, a track-based clip format and creator timeline become justified follow-ups.

## Goals, scope and non-goals

In scope:

- A reusable repository agent skill for authoring Gesture motion from a text prompt.
- A tracked generator in the frontend workspace that turns a per-bone motion
  description into a valid `animaPoseClip/1.0` Gesture sequence.
- Automated motion checks on both Included Avatars, and a repeatable visual review
  method.
- Per-Gesture muting of live procedural layers during playback, with a simple
  Gesture creator control.
- An owner-scored evaluation that decides whether the follow-up format work is
  justified.

Clip kinds: one-shot Gestures (enter, perform, return) and held or looping
Gestures. Body scope: the full body with feet kept planted, including torso,
hips, knees, weight shifts, head, eyes, arms and fingers. A clip contains body
motion and facial expression keys.

Non-goals:

- An `animaClip/2.0` format, a track-based sampler, a creator key timeline or
  bone-offset tools. These are follow-ups only if the evaluation passes.
- Idle loops for Idle Styles, stepping, foot travel and locomotion.
- Avatar Effect, Scene Effect, particle or Sound events in generated clips.
- An Anima generating Gestures at runtime from chat.
- Editing existing Gestures, or adding generated content to `content/included/`.
  Promotion is a separate owner-approved step with licence inventory.
- A live procedural-layer preview inside the Gesture creator.
- VRMA authoring or VRMA → Anima Clip conversion.

## Required behavior

### R1 — Gesture authoring skill

Add a repository skill, `animama-animation`, under `.agents/skills/` that guides an agent from a text
prompt to a saved Local Gesture. It builds on `animama-vrm` for VRM, coordinate
and runtime facts rather than duplicating them. It covers:

- **Motion planning:** reading the prompt into beats and timing, and choosing a
  one-shot or held/looping kind, duration, expressions and layer mutes.
- **Performance principles:** anticipation, staggered and overlapping timing
  between body regions, follow-through and settle, arcs, holds that stay alive,
  weight and counterbalance, asymmetry, and appropriate easing.
- **Human movement:** plausible joint ranges and coupled motions, such as
  shoulder elevation accompanying high arm raises, distribution of bending across
  spine segments, forearm rotation for palm direction, eyes and head leading
  body turns, and hips and knees balancing a planted stance.
- **Hands:** using the creator's Hands-tool presets (Relaxed, Fist, Open · spread,
  Open · together, Point, Peace, Thumbs up) with Curl and Spread, and when to
  finish a shape with the Hands tool instead.
- **The workflow:** describe → generate → automated checks → creator import and
  visual review → chat check → Local save → owner hand-off. It includes how to
  interpret and fix check failures.
- **Limits:** model-specific limits, and what automated checks cannot establish.

The skill must not direct agents to write raw quaternions by hand, to bypass
creator Save, or to save into `content/included/`.

### R2 — Per-bone motion description

The agent describes motion as independent tracks rather than whole-body poses:

- Each humanoid bone, the hips position and each expression may have its own
  keys, with time, value and per-key easing or tangent behavior.
- Bone rotations are expressed as named anatomical motions in degrees, such as
  flexion/extension, abduction/adduction and internal/external rotation, with
  meanings defined for each joint and side.
- A bone or expression without a track holds its base value. A track holds its
  last key after its final key.
- Hand-shape keys may name a Hands-tool preset with optional Curl and Spread.
  The generator applies the same preset logic as the creator's Hands tool
  outside the browser. As in the creator, the thumb fit uses one reference
  Avatar and the resulting values are stored in the clip. Unpreset finger tracks remain
  possible.
- The description identifies the Gesture name, kind, duration, loop and fade
  settings, and layer mutes.

The same description must produce the same anatomical motion on VRM 0 and VRM 1
Avatars. The description is the editable source of a generated Gesture. Its
semantics should be adoptable by a future track-based clip format without
reinterpretation.

### R3 — Generated Gesture sequence

The generator converts a description into an `animaPoseClip/1.0` sequence, or
the typed project envelope where needed, that the Gesture creator imports and
saves:

- Bone values use the canonical pose basis and existing VRM 0 conversion
  boundary. No Avatar-specific raw rotations are stored.
- Motion is continuous through authored keys. Velocity stops occur only where
  the description asks for them, and keyframe density keeps the baked result
  within a stated tolerance of the described curves.
- Output is deterministic for the same description and tool version.
- One-shot Gestures start and end compatibly with `relaxedRest` under the
  configured fades. Held and looping Gestures have no visible seam at the loop
  boundary.
- Names follow the Action naming invariant: the clip `name` matches the display
  name and the `id` is its kebab-case form.
- Invalid descriptions fail with a specific error identifying the track, key and
  reason. No partial output is written.

### R4 — Automated motion checks

A check command evaluates a generated Gesture on `AvatarSample_Y_0` (VRM 0) and
`AvatarSample_A_1_New` (VRM 1), loaded from their `.vrm` files. It reports, per
Avatar, with times and bones:

- Joint values outside a documented range-of-motion table. The table records its
  sources and Animama's chosen limits.
- Discontinuities, unintended stops, and velocity or acceleration spikes.
- Hands or forearms passing into the torso, head or each other, using a stated
  approximation.
- Declared contact targets missed beyond tolerance, such as a hand near the chin.
- Planted feet that slide, lift or sink beyond tolerance.
- Loop-boundary discontinuity for held or looping clips.
- Disagreement between VRM 0 and VRM 1 in anatomical direction.

Check failures block hand-off unless the agent records why a finding is
acceptable. Passing checks does not establish natural-looking motion.

### R5 — Visual review

The skill defines a repeatable way to review a Gesture visually on both Avatars.
It renders frames at significant times from front, three-quarter and side views,
using the production Avatar runtime and loaded `.vrm` files. The agent reviews
and revises before hand-off, then imports the candidate into the Gesture
creator and confirms its playback there. It then plays the saved Gesture in a real chat with
its layer mutes active, because the creator preview omits live layers. Hand-off
states which reviews were performed and what remains for the owner.

### R6 — Per-Gesture live-layer muting

A Gesture can mute any of the procedural layers `breathing`, `sway`, `bounce`,
`headNod`, `headSideTilt`, `cursorLookAt` and `emotionPosture` while it plays.
`talkingHands` keeps its existing Gesture suppression.

- Muted layers stop contributing offsets for the Gesture's playback, including
  fades. They transition out at start and back in at end without visible pops.
  Interrupted or cancelled playback restores them.
- A Gesture without mute settings plays exactly as today. Existing Included
  Gestures are not changed.
- Settings persist through creator Save and reopen, JSON import and export,
  typed project export, and portable package export and import.
- The Gesture creator shows a simple control for these settings. The creator
  preview remains free of live layers.
- Generated Gestures default to muting every listed layer except `breathing`.
  The agent may choose otherwise with a recorded reason.
- Settings are stored as an optional field in the Gesture's `animaPoseClip/1.0`
  document. Readers that predate the field ignore it.
- Reactions, VRMA Gestures and the user's global procedural-layer settings are
  unchanged.

### R6a — Gesture expression precedence

While an Anima Clip Gesture that keys emotion expressions (for example `happy`,
`sad`, `angry`, `surprised`, `relaxed`) plays in chat, those keyed weights take
precedence over the emotion system:

- The emotion system's expression contribution is suppressed for the Gesture's
  playback, so a smiling Gesture is not mixed with a concurrent sad face.
- The Gesture's keyed weights appear as authored. The handover blends in and out
  with the Gesture's fades, and interruption restores the emotion expression.
- If the Gesture keys `blink`, its weight replaces automatic blinking while the
  Gesture plays.
- Lip-sync keeps priority over Gesture-keyed mouth shapes while speech is active.
- Gestures that key no expressions behave exactly as today.

### R6b — Clip field preservation in the Gesture creator

The Gesture creator preserves top-level `animaPoseClip/1.0` fields it does not
edit, including `playback`, `role` and fields unknown to this app version. They
survive JSON import, Save, reopen, clip export and typed-project export unchanged.
Fields the creator edits are rewritten from the draft as today. An unknown field
never makes a valid clip unreadable.

### R7 — Saving and hand-off

Generated Gestures are saved as Local content through the Gesture creator's
existing Save path, with its revision and conflict behavior. Saving does not
equip a Gesture to an Anima unless the owner requests Save & Equip. The hand-off
identifies:

- the saved item,
- the motion description used,
- check results,
- captures,
- the chat check performed, and
- known limitations.

The motion description is retained where the owner can find it to revise the
Gesture.

### R8 — Evaluation and follow-up decision

Run the skill on prompts 1–6 of #243's prompt set on both Included Avatars, using
#243's 1–5 rubric. Prompts 7 (idle loop) and 8 (stepping) are out of scope. The
owner scores the results. Post scores, representative captures and the decision
on the owning issue.

Proposed pass threshold, pending owner confirmation: at least four of six prompts
score 4 or more on naturalness and prompt fidelity on both Avatars. The results
must also visibly improve on comparable Included Gestures such as
`thinking-hand-on-chin-hold`. A pass opens follow-up issues for a track-based
clip format with v1 conversion, then creator timeline editing. A fail records
findings and stops at this step.

## Constraints

- Preserve the [Pose and Pose Clip terminology](../../../GLOSSARY.md#pose),
  value-copy pose insertion, and the Action naming invariant. Do not break
  existing `animaPoseClip/1.0` documents. Any schema addition is optional and
  additive, and it is ignored or preserved safely where it is not understood.
- Reuse the clip schema, canonical-basis conversion in `poseRetargeting.ts`, the
  Hands-tool preset logic and the installed three-vrm. Do not create a parallel
  pose interpretation. The generator is tracked frontend-workspace code with tests.
- Follow [recoverable content mutations](../../adr/0004-filesystem-content-and-recoverable-mutations.md)
  for saves. No backend API or ownership change is expected. Mute settings ride
  in existing content documents unless the plan shows otherwise.
- No Cloud dependency, private source or network service is required to
  generate or check motion. Do not use Mixamo, SMPL or other non-redistributable
  motion data. Cite range-of-motion sources and record values in Animama's own
  words.
- Muting must not add measurable per-frame cost to chat rendering. Generated
  clips stay well within existing content size bounds.
- A muted layer must never remain muted after its Gesture ends or is interrupted.

## Acceptance criteria

- [ ] **R1:** The skill exists under `.agents/skills/`, passes the repository's
      skill structure expectations, and an agent following it produces the R8
      Gestures without undocumented steps. Owner review confirms its guidance.
- [ ] **R2–R3:** Tests establish:
      - description validation and specific errors,
      - deterministic output,
      - continuity through keys,
      - hold semantics,
      - Hands-preset keys,
      - loop seams,
      - the naming invariant, and
      - equal anatomical direction on VRM 0 and VRM 1 for each named joint
        motion.

      A generated clip imports into the Gesture creator and survives Save and
      reopen unchanged.
- [ ] **R4:** Tests with deliberately faulty descriptions show each check
      category reporting the expected bone, time and Avatar. Checks run on both
      Included Avatars from their `.vrm` files.
- [ ] **R5–R7:** For each R8 Gesture, the hand-off records:
      - check results,
      - creator captures on both Avatars,
      - the chat check,
      - the saved Local item, and
      - where its description is retained.
- [ ] **R6:** Tests establish:
      - that a Gesture without settings matches current layer behavior,
      - per-layer mute and restore, including interruption,
      - smooth transitions, and
      - persistence through Save/reopen, JSON, typed project and package
        round trips.

      Browser evidence shows the creator control, and a chat in which a muted
      Gesture stops cursor look-at and sway and restores them afterwards.
- [ ] **R6a:** Tests establish that a Gesture's keyed expressions win over
      concurrent emotion expressions for the Gesture's duration and fades, and
      that a Gesture without expression keys leaves emotion expressions unchanged.
      A chat check shows a smiling Gesture during a non-happy emotion.
- [ ] **R6b:** Tests establish that `playback`, `role` and an arbitrary unknown
      top-level field survive import → Save → reopen → export in the Gesture creator.
- [ ] **R8:** The owner's rubric table, representative captures and the
      follow-up decision are posted on the owning issue.
- [ ] Applicable frontend checks (`pnpm check`, `pnpm web:lint`, `pnpm web:test`,
      `pnpm build`) pass, with any unperformed checks stated.

## Open questions and decisions

Agreed on 2026-10-03:

- **Users and tooling:** coding agents only; generator tracked in the frontend
  workspace.
- **Output:** Local output, with promotion separate.
- **Motion scope:** full body with planted feet; one-shot and held/looping kinds;
  body plus expressions; Hands-tool presets or Hands-tool finishing.
- **Live layers:** per-layer mutes with a simple creator control and no creator
  live-layer preview; existing Gestures unchanged.
- **Review:** agent self-review through captures and a chat check before owner
  review.
- **Evaluation:** prompts 1–6 of #243 on both Avatars; separate issue linked to
  #243.
- **Mute storage:** an optional field in the clip JSON.
- **Headless presets:** the generator uses the Hands-tool presets outside the
  browser.
- **Skill name:** `animama-animation`.
- **Unknown clip fields:** the Gesture creator stops dropping unknown and
  unedited clip fields (R6b), added by the owner when authorizing implementation.
- **Expression precedence:** generated (Gesture-keyed) expressions take
  precedence over emotion expressions (R6a).

Open:

1. **Prompt set and rubric:** not final (owner, 2026-10-03). Work proceeds with
   #243 prompts 1–6 and its rubric; the owner may revise them before R8 scoring.
2. **Pass threshold:** the R8 threshold is a proposal awaiting owner confirmation.
3. **Idle-lane playback:** whether mutes also apply when a Gesture plays through
   an Idle Style. The proposed default (yes) is implemented, pending owner
   confirmation.
4. **Description retention:** where descriptions for Local Gestures are kept so
   they can be revised. Proposed and implemented, pending owner confirmation:
   the owner's chosen location, otherwise `motion-authoring/examples/` on the
   task branch.
5. **Implementation deviations awaiting owner acceptance:**
   - R6 mutes follow the Gesture's fade weight, so layers fade instead of
     staying fully muted during fades.
   - R5 renders use the app's loader and sampler rather than the full
     `Avatar` class.

## Spec

https://github.com/raymond-van/animama/issues/260.

## ExecPlan

Required: substantial, cross-cutting and uncertain work. See
[agent-gesture-authoring-execplan.md](agent-gesture-authoring-execplan.md).

## Delivery links

Phases: #261, #262, #263, #264, #265.
