# Hand authoring in the Gesture Pose tab

Status: Agreed
Owner decision: On 2026-09-23 the owner accepted the panel mockup's visual
direction, requested a slightly more compact vertical layout, and requested this
specification. Individual bone selection and omission of selection shortcuts are
explicit requirements. The subsequent 2026-09-23 request to create an ExecPlan
accepts this specification, including its interaction defaults, as the planning basis.
Authoritative source: https://github.com/raymond-van/animama/issues/76.
Snapshot captured 2026-09-23T22:04:51Z after publication and readback.
Owner authorized all implementation phases and a development stack on 2026-09-23.
Owner feedback on 2026-09-23 revises thumb scope to proximal/distal only, corrects
fist/together thumb alignment and outward spread, and removes the live-edit footer.

## Problem and intended users

Gesture authors currently rotate finger bones individually through the Bones
controls or canvas gizmo. Shaping a hand requires many repetitive edits. A hand
helper should offer useful starting shapes and coordinated adjustments while
retaining fine control over individual finger segments and existing poses.

## Goals, scope and non-goals

Add a Hands panel to the Pose tab of the Gesture new/edit routes under
`/a/gestures/`. Support left, right and both hands, three presets, individual
bone multi-selection and live named rotation adjustments.

This specification covers that Pose-tab surface, including an inline clip pose
while it is edited there. It does not add controls during Clip playback, to
Reaction authoring, or to standalone Library Pose editing. Existing save, pose
insertion and inline-keyframe completion actions retain their meanings.

Do not add a Hands-panel Apply button, selection shortcuts, whole-finger selection actions,
custom preset storage, hand tracking, inverse kinematics, wrist/arm posing, or a
second set of XYZ controls. Existing numerical bone controls remain available.

## Required behavior

### R1 — Entry point and compact layout

Place a hand icon immediately to the right of the bone visualization helper icon
in the Bones panel. It is off by default, but clickable when pose editing is
available. Its pressed state and accessible name identify whether Hands is open.
Hand-panel visibility is independent of bone-marker/gizmo visibility.

On a sufficiently wide desktop, opening it shows a top-aligned floating panel
immediately to the right of Bones, matching the existing panel surfaces,
typography and active accents. Provide a close button. Opening or closing the
panel changes neither rotations nor document dirty state.

Use the accepted mockup's order: Hands title; Left/Right/Both selector; three
compact preset tiles; selectable hand diagram and selection summary; named
adjustments. Omit the live-edit footer. Reduce section gaps, preset padding and
diagram height relative to the mockup. Preserve legibility and distinct bone hit
targets rather than uniformly shrinking the interface. Avoid unnecessary section
headings or repeated explanatory text.

Keep the panel within the available viewport with internal scrolling when
necessary. Adapt to the app sidebar and existing pose inspector/expression
panels without overlapping controls. At widths that cannot accommodate adjacent
panels, present Hands through the existing narrow-layout panel pattern. Do not
require horizontal page scrolling. Collapsing Bones must not strand an open
Hands panel without a reachable close/reopen path.

### R2 — Hand targeting and individual selection

Left and Right refer to the Avatar's own sides. Selecting Both targets the
corresponding bones on both hands; it does not copy one hand onto the other.
Changing the target or selection never changes the pose.

Use a plain hand schematic with 14 selectable targets: proximal, intermediate
and distal for each of the four fingers, and proximal/distal for the thumb.
The thumb metacarpal is not selectable and helper operations preserve its current
rotation. Each target toggles independently without a modifier key. Users can select
any combination across digits. The palm/wrist is not an editable target.

Show selected segments and a concise selection summary with correct digit/segment
names. Keep the schematic a stable selection map rather than deforming it to the
current pose. The displayed side and labels must agree. Do not reproduce a
mockup label if it identifies the wrong finger.

No All, None, Clear, whole-finger shortcuts or shortcut toolbar. Deselecting is
done by toggling selected segments again. Every segment must also be operable
by keyboard, with a descriptive accessible name, selection state and visible
focus; selection cannot rely on color alone.

### R3 — Hand presets

Provide Fist, Open · spread and Open · together. A preset replaces the eligible finger
rotations of the selected hand(s), regardless of diagram selection. Make that
whole-hand scope apparent through a concise tooltip or accessible description.
Preserve thumb metacarpals, wrists, arms, other body bones, bone positions and expressions.

Presets are immediate actions, not persistent modes or inferred classifications.
Selecting the same preset repeatedly must not accumulate rotation. Apply Both
with anatomically corresponding left/right shapes. One preset action is one
undoable operation across all affected bones.

### R4 — Relative named adjustments

Provide Curl, with Straighten/Curl directions, and Spread, with Bring together/
Spread directions. Curl affects selected finger joints; Spread affects only
selected eligible base segments. If a selection mixes base and other segments,
Spread changes only the bases and identifies that scope. Disable an adjustment
with a concise reason when no selected available bone supports it.

Thumb Curl bends its selected proximal/distal segments inward; Spread acts on
the thumb proximal and fans it outward. Together aligns the thumb alongside the
fingers with a small visible gap, while Fist folds it across the outside of the
curled fingers without leaving its tip protruding downward. Presets account for the
retained metacarpal orientation. Do not spread finger middle/tip joints. Exact rotation
mapping, ranges and preset angles require validation on supported Avatars.

Adjustments operate relative to each affected bone's current rotation. A drag
previews live from its starting pose, preserves existing differences between
joints, and does not repeatedly accumulate the same pointer value. Both applies
equivalent anatomical adjustments from each hand's own values, preserving
asymmetry. The helper's target selector exclusively governs its edits, regardless
of the existing single-bone mirror toggle.

The adjustment control starts at zero and recenters after the interaction ends;
the resulting pose remains. Zero means no additional adjustment, not a neutral
finger pose. Keyboard adjustments follow the same relative behavior and provide
usable undo grouping. Each continuous interaction is one Undo step, not one per
rendered preview. Preserve unrelated rotations and transforms.

### R5 — Live editing, lifecycle and recovery

No Hands-panel Apply or tool-reset confirmation is needed. Changes update the
pose immediately without a footer stating this. Changing selected bones or hand target lets the user continue
editing without discarding earlier changes. Closing Hands preserves edits;
existing Save remains responsible for persistence.

Integrate presets and adjustments with the active pose/inline-pose undo history,
dirty tracking and existing manual bone controls. Manual edits and Undo/Redo
must be reflected by the next helper interaction; never reuse a stale starting
pose. Finish the current edit group before changing target, selection or mode.
On pointer cancellation, keep the latest previewed result as an undoable edit.

Pose replacement, Avatar changes and route/session changes terminate active
interactions and invalidate their starting transforms. Late interaction events
must not change the replacement pose. Honor existing dirty-replacement guards;
opening Hands must not bypass them.

Show unavailable finger bones distinctly and disable their selection. When only
some requested bones exist, operate on available eligible bones and clearly
identify the unavailable targets; Both must not imply that an absent counterpart
was changed. Disable mutations while the Avatar is unavailable/loading or the
pose is not editable, without discarding the draft. An invalid operation leaves
the pose unchanged and reports a useful error rather than partially applying it.

### R6 — Existing poses and persistence

Actual bone rotations are authoritative, whether authored manually, imported,
loaded from saved content or produced by this helper. Opening Hands on an
existing pose must not normalize, straighten or otherwise change it. Do not
reverse-engineer preset identity or slider percentages from arbitrary rotations.

Write ordinary pose bone values through the existing authoring/persistence
contract. Save/reopen, export/import and copying into a Gesture must preserve the
result without helper-specific provenance, saved slider values or schema changes.
Panel visibility, target selection and selected segments are transient UI state.
Preserve Included immutability and existing Local save/conflict/failure behavior.

## Constraints

- Preserve [Pose terminology](../../../GLOSSARY.md#pose) and the
  [poses-as-content contract](../poses-as-content/poses-as-content-spec.md),
  including value-copy insertion and existing inline-pose completion boundaries.
- Reuse the shared pose draft/history and normalized-bone conventions. Supported
  VRM versions must produce equivalent anatomical directions; raw Euler signs
  or existing procedural-animation constants alone are insufficient evidence.
- Follow [recoverable content mutations](../../adr/0004-filesystem-content-and-recoverable-mutations.md).
  No backend API, ownership, content storage or Cloud dependency changes are needed.
- Keep previews responsive during multi-bone drags and avoid losing manual pose
  details merely because a named control cannot describe them.

## Acceptance criteria

- [ ] **R1:** Browser evidence shows the icon in the requested position, initially
      off; independent helper visibility; compact adjacent panels at a desktop
      viewport; usable scrolling and narrow layout. Check expanded/collapsed app
      sidebar and Bones, with other pose controls present. Owner visual review
      confirms the more compact layout without cramped selection targets.
- [ ] **R2:** Individual segment and keyboard selection work across all digits,
      including both editable thumb segments. Correct names, side orientation, selection states
      and Both correspondence are verified. No selection shortcuts appear.
- [ ] **R3–R4:** Focused tests establish preset idempotence, selected-bone scope,
      unchanged unrelated transforms, relative adjustment without drift, preserved
      asymmetry, and isolation from the existing mirror toggle. Rendered checks
      confirm all presets and curl/spread directions on left, right and both hands,
      including thumbs, on representative supported VRM 0.x and 1.x Avatars.
- [ ] **R4–R5:** A multi-bone drag or preset undoes/redoes in one step; recentering,
      selection changes and closing the panel do not revert changes. Manual edits,
      pointer cancellation, loading/replacement and stale-event handling preserve
      the correct draft. Verify ordinary and inline-pose history boundaries.
- [ ] **R5:** Missing bones, asymmetric availability, unavailable Avatar and invalid
      operation cases have accurate disabled/error states and preserve valid work.
- [ ] **R6:** Load a pose with arbitrary hand rotations, open/close Hands and verify
      no mutation. Adjust a subset, save/reopen and round-trip through existing
      export/import and Gesture insertion; preserve edited and untouched values
      without helper metadata. Use focused tests and a representative browser journey.

Report local automated, browser/manual and actual hosted CI evidence separately.
The generated mockup is design direction, not functional or native-release evidence.

## Open questions and decisions

Agreed direction: optional hand panel, Left/Right/Both, three named presets,
fine-grained individual bone multi-selection, no selection shortcuts, and a more
compact version of the reviewed mockup, live relative named controls and no
Hands-panel Apply button.

Accepted planning defaults: start with Left and no segments selected; retain
the segment pattern when changing sides; in Both show one diagram labeled Both
and select corresponding segments on each available hand. Count actual selected
available bones in the summary. Preserve selection while reopening the panel in
the same pose, but reset it on document replacement or Avatar change. Narrow
layout uses a single active tools panel rather than simultaneous side-by-side tools.

No blocking product question remains for planning. The request to proceed to an
ExecPlan accepts these defaults and the Gesture Pose-tab scope; it does not
authorize implementation or waive visual acceptance. Preset angles, sensible adjustment bounds and thumb mapping are
implementation investigations whose visual verification belongs in the ExecPlan.

## Spec

The owning issue #76 is authoritative; this file is its retained snapshot.

## ExecPlan

Required before implementation: coordinated multi-bone editing, history/lifecycle
integration, anatomical mappings and responsive layout need explicit validation.
See the [execution plan](hand-authoring-execplan.md), prepared for review.

## Delivery links

Parent: https://github.com/raymond-van/animama/issues/76. PR pending.
Task branch: `docs/hand-authoring-spec`.
Source inspected at `98220eae162651207960ffa9657aa54581a80265`.
