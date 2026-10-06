# Track-based Anima Pose Clips, a motion preview tool and the first generated animation set

Status: Agreed
Owner decision: Intent discovery on 2026-10-05 settled who animates, how
generated clips appear in the creator, the UI bounds, one format, agent
revisability, length and acceptance (recorded on #282). On 2026-10-06 the owner
added the preview tool, replacements for six Included Gestures and a first
generated animation set to the scope. The owner deferred the remaining open
questions to the agent's recommendations, to be confirmed by a prototype, and
asked for the spec, ExecPlan and implementation to proceed. The prototype
results and the resulting decisions are under
[Open questions and decisions](#open-questions-and-decisions).
Authoritative source: https://github.com/raymond-van/animama/issues/282.
Snapshot captured 2026-10-06T17:51:22Z at publication; refresh from the issue
before resuming.
Related: #260 and PR #267 delivered the motion description, generator, checks,
review renders and the `animama-animation` skill this work builds on.

## Problem and intended users

Agents author Gestures as per-bone motion curves (`animamaMotion/1`), and the
generator bakes them into dense `animaPoseClip/1.0` keyframes. The owner judged
the resulting motion smooth and natural, but the baked format has four costs:

- **Size:** baked clips are about 100 times larger than their curves. The
  hearty laugh is 719 KB, baked from a 7 KB description.
- **Length:** the 2 MiB clip limit allows only about 8 s of busy full-body
  motion.
- **Editing:** a generated clip opens in the Gesture creator as 60–250
  whole-body keyframes on one lane, which nobody can edit by hand.
- **Revision:** the saved Library item loses the authoring intent. An agent can
  only revise a Gesture from a separate description file.

Review is also slow. Agents judge motion from still contact sheets, which miss
timing, and the owner has no way to point at a moment and say what to change.

Finally, most Included Gestures are low-quality, hand-made pose-to-pose clips,
and the library lacks common conversational reactions.

Intended users:

- **Coding agents** author and revise Gestures with the `animama-animation`
  skill.
- **The owner** reviews motion in a live preview, leaves notes, and adjusts
  Gestures by beats in the creator.
- **Anima users** get longer, richer and more varied motion.

## Goals, scope and non-goals

In scope:

1. An interactive motion preview tool with review notes (built first; it works
   with `animaPoseClip/1.0` and serves every later review).
2. A track-based clip format, `animaPoseClip/2.0`, organised by beats, used by
   all new Gesture and Reaction saves.
3. Runtime playback of 2.0 alongside unchanged 1.0 playback.
4. Agent authoring of 2.0 clips directly, with the motion checks, renders and
   skill updated, and the bake step retired.
5. Gesture and Reaction creator support for 2.0: beats with generated detail on
   the existing Pose lane, v1 conversion on save, and no UI regressions.
6. Backend and package acceptance of 2.0.
7. Content, saved as Local content after owner review in the preview tool:
   - the six #260 evaluation Gestures, migrated;
   - wave 1: three laugh tiers and a 20 s storytelling sequence;
   - new-format replacements for six Included Gestures;
   - wave 2: eleven new reactions.

Non-goals:

- Runtime generation of motion by an Anima from chat.
- Locomotion, stepping and foot travel. All new content keeps the feet planted.
- VRMA authoring or VRMA → clip conversion.
- Bulk migration of Included content. Included 1.0 files stay as they are until
  edited; promotion of new content to `content/included/` is a separate,
  owner-approved step with a licence inventory.
- Human per-bone keying (a dope sheet), and editing generated detail itself.
- An automatic "natural timing" stagger for hand-made beats (deferred).
- Static hand-sign replacements (OK sign, peace sign); lower priority, deferred.
- Idle Style creator changes. Idle Styles keep playing whichever Gesture format
  they reference.
- Live procedural layers inside the Gesture creator preview (the preview tool
  provides them).

## Required behavior

### R1 — Interactive motion preview tool

From `src/frontend/web`, `pnpm -s animation:preview <source> [--compare <source>]`
serves a local page and opens it in the system's default browser (not a
headless or embedded browser). A source is any of:

- a clip file, `animaPoseClip/1.0` or `2.0` (a 2.0 clip is also the authoring
  source of an agent-authored Gesture);
- an `animamaMotion/1` description, for as long as that format exists;
- a Library item, by name or selector, read from the Included content directory
  or the Local content directory of the selected local stack.

The page shows:

- **Both Included Avatars** (VRM 0 `AvatarSample_Y_0` and VRM 1
  `AvatarSample_A_1_New`) side by side, animating in real time through the
  app's own playback path (`Avatar` and its `PoseController`). Fades,
  live-layer mutes, expression precedence and the live procedural layers appear
  as they do in chat. A control turns the live layers off.
- **Transport:** play, pause, loop on/off, speed from 0.25× to 1×, and a
  scrubber with beat markers (2.0 beats with their labels, or 1.0 keyframes)
  and a time readout. Scrubbing or pausing shows the pose playback would show
  at that time.
- **Camera presets:** front, three-quarter, side and face, applied to every
  view.
- **Live reload:** when a source file changes, the page reloads it and keeps the
  playhead. An invalid source shows its validation errors on the page and keeps
  the last valid version playing.
- **Compare mode:** with `--compare`, a second source plays in a second row on
  the same transport, for example an Included 1.0 Gesture above its
  replacement.

**Review notes:**

- The owner adds a note at the current time or on a beat, optionally with a
  body region (head, face, torso, hips, left or right arm, left or right hand,
  legs), for example "slap the thigh here" or "settle slower".
- Notes are saved to a sidecar file beside the source, `<name>.review.json`.
  For a Library item, which the tool never writes, the sidecar is created in
  the working directory (or at `--notes <file>`).
- The agent applies a note by changing the source, then marks it resolved in
  the sidecar with a short resolution. The page shows open and resolved notes;
  selecting one seeks to its time.
- Each note records the source version it was made against. When the source
  changes, the tool keeps the previous version, and the page can play the
  previous and current versions together (as in compare mode).

The tool serves only on the loopback interface, reads only its sources and the
Included Avatars, and writes only review sidecars and its retained versions. It
needs no running Animama stack.

### R2 — The `animaPoseClip/2.0` format

A 2.0 clip stores motion as keyed tracks grouped by **beats**. It is
self-contained: it carries everything needed to play, edit and revise it.

**Clip fields.** As in 1.0: `schema` (`"animaPoseClip/2.0"`), `id`, `name`
(the Action naming invariant applies), `duration` (required, positive), `loop`,
`role`, `playback`, `basePose`, `fadeIn`/`fadeOut`, `mutedProceduralLayers` and
`events` (unchanged from 1.0, at absolute times). New fields:

- `plantFeet`: when true, the legs are solved during playback so both feet stay
  where they are at rest, and leg joints cannot have tracks. Default false.
- `beats`: the clip's beats.
- Track sections: `joints`, `rotations`, `hipsPosition`, `hands` and
  `expressions`.
- `contacts`: intended touches (authoring metadata used by the checks; playback
  ignores them).

Top-level fields the app does not know are preserved through import, editing,
save and export, as for 1.0.

**Beats.** Each beat has a stable `id`, a readable `label` and a `time` within
0…duration, and optionally an easing. Beats are listed in time order and have
distinct times. Every key belongs to one beat and stores its time as an offset
`dt` from that beat (default 0). A key's time lies strictly between the times
of its beat's neighbours, and within 0…duration. Within a track, key times
strictly increase. A beat's keys at nonzero offsets, and any additional keys it
owns, are its **generated detail**: lead and lag between body parts, overshoots,
bounces and finger motion.

**Track kinds:**

- **Anatomical tracks** (`joints`): `joints.<joint>.<component>` keys in
  degrees, in the `animamaMotion/1` vocabulary (for example
  `rightUpperArm.elevation`). Each joint also gets auxiliary components that
  complete its three rotation axes, so any rotation an edit produces can be
  represented. A value may be `"base"`, the base pose's value. Joints without a
  track hold the base pose; a joint's components without keys hold their base
  values.
- **Rotation tracks** (`rotations`): per-humanoid-bone quaternion keys in the
  canonical basis. They are used for hand-made poses, converted 1.0 clips and
  bones without a joint definition (such as the jaw and thumb metacarpals). A
  bone has at most one track kind.
- **Hips position** (`hipsPosition.x|y|z`): metres from rest.
- **Hand shapes** (`hands.left|right`): Hands-tool preset references (Relaxed,
  Fist, Open · spread, Open · together, Point, Peace, Thumbs up) with optional
  Curl and Spread. Finger joints with their own tracks override the hand shape
  for those bones.
- **Expressions** (`expressions.<name>`): weights 0–1.

**Interpolation.** Each key's `ease` sets how motion arrives at it:
`smooth` (monotone cubic with automatic tangents, as the generator uses today),
`linear`, `hold` (keep the previous value, then change at this key), or one of
the 1.0 easings. A key without `ease` uses its beat's easing, then the track
default: `smooth` for anatomical, position and expression tracks, and
`easeInOutSine` for rotation and hand tracks (`smooth` behaves as
`easeInOutSine` there). A `tangent` of `flat` stops motion at a smooth key.
Rotation tracks interpolate by slerp. Before its first key a track holds the
first value and after its last key the last value; in a loop it wraps across
the seam.

**Validation and limits.** Parsing is bounded and rejects, as one invalid
clip, structural errors: unknown beat references, misordered keys, keys outside
their beat window, unknown joints, components or bones, bones with two track
kinds, non-finite values and malformed quaternions. A saved clip is at most
`MAX_ANIMA_POSE_CLIP_BYTES` (2 MiB) as compact JSON, and the numbers of beats,
tracks and keys are bounded. Anatomical range limits are reported by the
motion checks, not enforced by the parser, so a valid edit is never unreadable.

### R3 — Runtime playback

- Gestures, Reactions and Idle Styles may reference 2.0 clips. 1.0 clips play
  exactly as before.
- A 2.0 clip has the same playback behavior as 1.0: fades in and out, holds and
  loops, interruption and completion, live-layer mutes, expression precedence
  over the emotion face, lip-sync priority, automatic blink replacement and
  events.
- Anatomical values produce the same anatomical motion on VRM 0 and VRM 1
  Avatars, through the existing canonical-basis conversion.
- Hand presets resolve on each Avatar with the Hands-tool logic, including the
  per-Avatar thumb fit. Preset resolution lives in `lib/`, shared by the
  creator, the runtime and the authoring tools.
- With `plantFeet`, the legs are solved on each Avatar against the clip's own
  hips motion, so planted feet do not drift on either Avatar. Live layers that
  move the hips (sway, bounce, emotion posture) still offset them when not
  muted, as they do for 1.0 clips; generated Gestures mute them by default.
- A clip is prepared once per Avatar when it loads. Per-frame sampling of a
  2.0 clip costs no more than sampling the 1.0 bake of the same motion.
- An invalid 2.0 clip fails to load like an invalid 1.0 clip: the Gesture or
  Reaction is skipped with a diagnostic, and the Avatar keeps working.

### R4 — Agent authoring, checks and skill

- Agents write `animaPoseClip/2.0` directly. The authored file is the editable
  source, and the saved Library item carries the same intent (beats and labels,
  anatomical values, `"base"` references, hand presets, contacts), so an agent
  can revise a Gesture from the Library item alone. Separate description files
  are no longer needed.
- A validation command reports every problem with its JSON path, including
  anatomical range limits, and writes nothing on failure. It reports the saved
  size.
- `pnpm -s animation check` and `pnpm -s animation:render` accept 2.0 (and
  1.0) clips. The checks keep their categories (range of motion, smoothness,
  intersections, contacts, planted feet, loop seams and VRM 0/1 parity) on
  both Included Avatars, with contacts and `plantFeet` read from the clip.
- `animamaMotion/1` and the bake step are retired. The six #260 example
  descriptions are migrated to 2.0 clips with named beats, keeping their keys
  and therefore their motion.
- The `animama-animation` skill covers beat planning, writing 2.0, the preview
  tool and its review notes, intensity tiers with semantic keys (for example
  `laugh_mild`, `laugh_medium`, `laugh_hysterical`) and saving through the
  creator.

### R5 — Gesture and Reaction creator

**Opening:**

- A 2.0 Gesture shows its beats as keyframes on the existing Pose lane, with
  their labels instead of `F000`-style aliases.
- A beat that carries generated detail shows a subtle marker. The keyframe
  inspector shows a read-only note describing the detail (for example how many
  joints it moves and how far it reaches before and after the beat), and that
  the detail follows the beat.
- A 1.0 Gesture, Local or an Included copy, opens as beats without detail, one
  per keyframe, and plays as before.

**Editing:**

- **Retime** (drag or the Time field): the beat's own keys move with it and keep
  their spacing. Detail of neighbouring beats stretches or compresses so that
  every key stays in order. A beat carrying detail cannot pass a neighbour; the
  drag stops where its detail meets the neighbouring beat. As today, a beat
  without detail can pass other beats without detail.
- **Edit the pose** (Pose tab): the tab shows the beat's key pose. A joint the
  edit leaves unchanged keeps all its keys and detail. A changed joint with
  generated detail is re-targeted: every key the beat owns on that joint shifts
  by the change, so overshoots and bounces ride along. Other changed joints
  take the new pose at the beat.
- **Hands:** editing the fingers of a hand driven by Hands-tool presets turns
  that hand's shape keys into equivalent finger keys, then applies the edit.
- **Easing:** the beat's easing sets how motion arrives at all of its keys.
- **Delete:** removes the beat and all of its detail; the motion between the
  neighbouring beats interpolates across the gap.
- **Add:** capturing the pose at the playhead or inserting a Library Pose (by
  value, as today) adds a beat without detail.
- The detail itself is not hand-editable.

**Saving:**

- Every Gesture and Reaction save writes 2.0, including edited 1.0 clips.
  Reactions keep their expression-only beats, events and playback lifetime.
- Save, reopen, Import and Export round-trip 2.0 clips and project envelopes,
  including beats, labels, detail and unknown fields. Import also accepts 1.0.
- The 2 MiB save limit and the existing Save, revision and recovery behavior
  are unchanged.

**UI:** the creator keeps its layout and styling. Changes beyond the marker,
the inspector note and the labels are limited to what 2.0 editing needs, with
no regressions.

### R6 — Backend and package compatibility

- Gesture clips used by Idle Styles (idle-playback validation), content package
  export and import (with an `animaPoseClip/2.0` capability), and content
  validation accept 2.0 under the same structural rules as the frontend parser.
  A shared fixture keeps the two validators in agreement.
- Every path that accepts 1.0 continues to accept it unchanged.
- An application version without 2.0 support rejects a package that requires
  the 2.0 capability with its existing unavailable-capability error.

### R7 — Conversion from 1.0

Converting a 1.0 clip (in the creator, and in the authoring tools) produces a
2.0 clip that plays the same motion:

- one beat per keyframe, labelled from its pose name;
- rotation tracks for every bone in the resolved poses (pose references and the
  base pose resolved by value, as Pose insertion copies values today);
- hips-position and expression tracks;
- each keyframe's easing and interpolation, and the clip's fades, mutes,
  events, playback, role and unknown fields.

Sampled playback of the converted clip matches 1.0 playback to within 0.01°
and 0.1 mm at every frame. Two exceptions, neither used by Included content:

- a 1.0 bone that a keyframe omits with no base pose holds its last value
  instead of jumping;
- `nlerp` rotation interpolation converts to slerp. (`step` converts exactly
  to `hold`.)

### R8 — Wave 1 content (acceptance content)

Authored as 2.0 clips with named beats, feet planted, and saved as Local
content:

- **The six #260 Gestures**, migrated: wave hello, gentle double nod, hearty
  laugh, palms-up shrug, excited triple clap and thinking chin rest.
- **Mild laugh** (`laugh_mild`): a chuckle with a small shoulder shake and a
  hand near the mouth, about 1.5 s.
- **Medium laugh** (`laugh_medium`): the hearty laugh re-authored with an
  active left arm.
- **Hysterical laughter** (`laugh_hysterical`): doubles forward, one hand on the
  stomach and the other slapping the thigh, wipes a tear and recovers; about
  5–6 s.
- **Storytelling sequence:** about 20 s, moving through thinking, an "idea!"
  with a finger up, explaining with the hands, a shrug and a laugh.

Where possible they also address the known #267 weaknesses: the A_1 chin fist
sitting near the jaw, the slightly sleepy nod on A_1, the passive laugh left
arm, and the clap's palms landing apart on Y_0.

### R9 — Replacements for six Included Gestures

New 2.0 versions of right-face-palm, thinking-head-scratch, arms-crossed,
cheeky-finger-guns, hands-on-hips and cat-monster-rawr. Each is reviewed in the
preview tool next to its Included original and saved as Local content. Nothing
in `content/included/` changes.

### R10 — Wave 2 content

New reactions with feet planted, saved as Local content after review: surprise
gasp (hands to cheeks, lean back), gentle head-shake "no", enthusiastic yes
(nod and fist pump), shy giggle hiding the face, deflated sigh, pout or huff
(arms crossed, turn away), celebration (double fist pump with a knee bounce),
blow a kiss, small shy wave, polite bow, and attentive listening lean-in.

### R11 — Documentation

- The runtime animation guide describes 2.0 as the current format and keeps
  1.0 documented for compatibility.
- The glossary defines **Gesture**, **Beat** and **generated detail**.
- An ADR records the track-based format decision: beats owning detail,
  anatomical and rotation tracks, runtime hands and legs, and the retirement of
  baking.
- The skill references and the creator documentation are current.

## Constraints

- **Compatibility:** existing 1.0 Gestures, Reactions and Idle Styles keep
  playing unchanged, and Included 1.0 files are not modified. Older app versions
  are not expected to read 2.0.
- **Untrusted content:** 2.0 parsing is bounded and validated, like 1.0, and an
  invalid clip never crashes playback or the creator.
- **Performance:** sampling runs every frame for every playing clip; its cost
  must stay at or below 1.0's for equivalent motion.
- **Parity:** both Included Avatars play 2.0 with the VRM 0/1 parity the motion
  checks enforce.
- **Terminology and decisions:** keep the Pose and Pose Clip terminology,
  value-copy Pose insertion, the Action naming invariant, and the #267
  decisions on mutes (fade-scaled), expression precedence and unknown-field
  preservation.
- **Ownership:** no Cloud dependency, private source or network service is
  needed to author, check, preview or play motion. No Mixamo, SMPL or other
  non-redistributable motion data. Content saves go through the creator's Save
  path as Local content; agents never write `content/included/`.
- **Preview tool:** loopback only; writes only review sidecars and retained
  versions; must not change Library content.
- **Repository rules:** no new Alembic revisions and no generated-client hand
  edits. Backend schema changes, if any, regenerate the client offline.

## Acceptance criteria

- [ ] **R1:** The preview tool plays a 1.0 clip, a 2.0 clip and an Included
      Library Gesture on both Avatars with transport, beat markers, camera
      presets, live reload and compare mode. A note added in the page is saved
      to the sidecar; after the agent changes the source and resolves the note,
      the page shows it resolved and can play the previous and current versions
      together. Evidence: tests for sidecar and version handling, a browser
      walkthrough with screenshots, and owner use during content review.
- [ ] **R2, R3:** Tests establish validation (each structural error is reported
      or rejected), interpolation and hold semantics, loops, beat offsets, hand
      presets on both Avatars, planted feet within the check tolerances on both
      Avatars, fades, mutes, expression precedence, events, Reactions and Idle
      Style playback of 2.0, and unchanged 1.0 playback. A measurement shows
      per-frame sampling at or below the 1.0 bake of the same motion.
- [ ] **R4:** The six #260 Gestures, migrated to 2.0, pass the motion checks on
      both Avatars. In the preview tool they play the same as their 1.0 bakes,
      and the owner confirms that. Validation errors carry JSON paths.
- [ ] **Size:** each migrated #260 Gesture saves at no more than 10% of its 1.0
      bake (the prototype measured 1.1–7.8%), and the 20 s sequence saves well
      under the 2 MiB limit.
- [ ] **R5:** The creator round trip:
      - open a generated Gesture; retime one beat and edit its pose; play, save
        and reopen with the detail intact;
      - open a 1.0 Gesture; it plays as before and saves as 2.0;
      - a Reaction saves as 2.0 and reopens.

      Evidence: tests for retime ordering, re-targeting, delete, hand
      conversion, easing and v1 conversion, plus a browser journey.
- [ ] **R5 UI:** before-and-after screenshots of the Pose and Clip tabs at
      desktop and narrow widths show no layout or styling regressions beyond the
      agreed additions.
- [ ] **R6:** Backend tests accept 2.0 in idle-playback validation, package
      export/import and content validation, keep accepting 1.0, and agree with
      the frontend on a shared fixture.
- [ ] **R7:** Every Included 1.0 Gesture and Reaction converts, and its 2.0
      playback matches 1.0 within the stated tolerance at every frame.
- [ ] **R8:** The laugh tiers and the storytelling sequence pass the checks on
      both Avatars, pass owner review in the preview tool (notes resolved), are
      saved as Local content with their semantic keys, and the 20 s sequence
      plays in chat.
- [ ] **R9, R10:** Each replacement and wave 2 reaction passes the checks, has
      been reviewed by the owner in the preview tool (replacements next to their
      originals), and is saved as Local content. Promotion to Included is
      recorded as a separate follow-up.
- [ ] **R11:** The glossary entries, ADR, runtime guide and skill are updated.
- [ ] Applicable checks pass, with any unperformed checks stated: from
      `src/frontend`, `pnpm check`, `pnpm web:lint`, `pnpm web:test` and
      `pnpm build`; from the repository root, `uv run pytest -q` for the
      affected backend tests and `uv run ruff check`.

## Open questions and decisions

**Agreed with the owner, 2026-10-05:** see #282. Agents author per-bone motion;
humans work by beats on the existing Pose lane (no dope sheet). Generated
detail belongs to its beat: it moves when the beat is retimed, re-targets when
its pose is edited, and is deleted with it; it is not hand-editable. Keep the
creator's layout, with pre-approved additions: a detail marker, a read-only
inspector note and readable beat labels. All new Gesture and Reaction saves use
the new format; the runtime keeps playing 1.0; 1.0 clips convert on save;
Included 1.0 files stay until edited. A saved Gesture keeps its authoring
intent. Comfortably support about 20 s. Natural-timing stagger is deferred.

**Added by the owner, 2026-10-06:** the preview tool (first), the six
replacements and the generated animation set (R1, R8–R10). Promotion to
Included is separate and needs a licence inventory. Static hand signs are lower
priority.

**Decided by the agent under the owner's deferral (2026-10-06), with prototype
evidence.** The prototype annotated the six #260 descriptions with named beats
and exercised the operations headlessly on both Avatars.

- **Beat model:** beats are explicit and named; every key belongs to a beat and
  stores `dt` from it; values stay absolute.
  - All six examples round-trip with identical keys.
  - Their 2.0 files are 1.1–7.8% of the 1.0 bakes (laugh: 12.3 KB against
    718.6 KB).
  - Delete and re-target kept every track in order.
- **Retime** keeps the moved beat's keys rigid and stretches or compresses
  neighbouring detail.
  - A proportional time-warp of the whole interval also preserves order, but it
    distorted the moved beat's own motion far more: for example, retiming the
    laugh's burst drifted the beat's motion 28.4° with the warp against 3.3°
    with rigid keys.
  - The cost is that a beat with wide detail can move only until its detail
    meets a neighbouring beat.
- **Rotation tracks for hand-made and converted content.** Converting the 22
  Included 1.0 Gestures to anatomical tracks was not faithful, for two reasons:
  - Hand-made poses rotate joints about non-anatomical axes: keyframe residuals
    reached 138° with the current joint model.
  - Interpolating components instead of slerping deviated by up to 22°
    mid-segment.

  Per-bone quaternion tracks reproduce 1.0 exactly, so they carry hand-made
  poses and conversions. Anatomical tracks carry authored motion.
- **Auxiliary joint components** complete every joint's three axes so a
  Pose-tab edit of a generated joint is represented exactly. The checks flag
  unusual values.
- **Planted feet at runtime.** The leg solver was generalised to VRM 0 by
  converting its rig offsets to the canonical basis. Solved per Avatar, the
  feet held at 0.0–3.0 mm on both Avatars. Solved once on the reference
  Avatar, as today, Y_0's feet drifted up to 3.9 mm.
- **Hands:** preset references, resolved per Avatar at runtime; a creator
  finger edit converts that hand to finger keys.
- **Interpolation:** `smooth` (monotone cubic) plus `linear`, `hold` and the
  1.0 easings per key or beat, arriving at the key, matching the 1.0 keyframe
  convention.
- **Authoring format:** agents write 2.0 directly and `animamaMotion/1` is
  retired, because two formats would duplicate the authoring source.
- **Preview tool:**
  - It uses the real `Avatar` with the built-in motion catalog. The survey
    found that `Avatar` needs no prepared runtime catalog, contrary to a #267
    note.
  - It reads Library items from disk, avoiding the local HTTP admission
    boundary.
- **Planted feet and live layers:** the solver runs within clip playback, so
  unmuted live hips layers still move the feet as they do for 1.0. Solving
  after the live layers would conflict with the bounce layer's foot offsets.

**Open, for owner confirmation (not blocking):**

1. **Size target:** "at most 10% of the 1.0 bake" as acceptance (proposed by
   the owner on 2026-10-05; measured 1.1–7.8%).
2. **Beat ordering:** a beat carrying detail cannot be dragged past a
   neighbour. Beats without detail keep today's behavior.

## Spec

https://github.com/raymond-van/animama/issues/282 (this file is a snapshot).

## ExecPlan

Required: substantial, cross-cutting and uncertain work. See
[track-based-pose-clips-execplan.md](track-based-pose-clips-execplan.md).

## Delivery links

Phases: #289 (P1), #292 (P2), #290 (P3), #293 (P4), #294 (P5), #295 (P6),
#291 (P7). One PR for the plan.
