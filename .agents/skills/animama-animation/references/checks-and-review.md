# Checks, review and hand-off

## Motion checks

`pnpm -s animation check <clip.json> [--json]` plays the clip through the
production sampler on both Included Avatars, `Andrew` and
`Annie` (both VRM 1), each with its own fitted hands,
solved legs and solved contacts, and exits 1 on any FAIL. A 2.0 clip supplies
its `contacts`; feet are checked unless it keys its legs itself without
`plantFeet`. Findings marked `[canonical]` come from the first Avatar's
playback and stand for both; others name the Avatar. Arms moved by solved contacts are the exception: there a
`[canonical]` range or smoothness finding describes the first Avatar's solve
only, and each other Avatar's solved arms are reported under its own name.

| Category | Means | Typical fix |
| --- | --- | --- |
| `pose` | A referenced pose is missing from the catalog | Use `"relaxedRest"` as the base pose; 2.0 tracks reference no other poses |
| `range` | A joint exceeds its natural (WARN) or anatomical (FAIL) range | Reduce the value or share it with neighbouring joints |
| `smoothness` | Pop, speed or acceleration spike, or a mid-motion stall (WARN) | Spread keys, remove `hold`/`linear` jumps, add an easing key, drop accidental `flat` holds |
| `oscillation` | WARN: a joint swings back and forth faster than about 4 Hz for three cycles or more | Fewer, slower pulses (see human-movement.md, Laughing and bouncing) |
| `intersection` | Hand or forearm passes into the torso, neck, head or the other arm (capsule approximation, calibrated against the base pose) | Raise elevation before or with elbow flexion (a bent elbow on a hanging arm drives the forearm into the hip); move the arm outward or forward; avoid shoulder depression with a bent elbow; declare an intended touch as a contact |
| `fingers` | A finger passes through another finger or its own palm (FAIL when the cores cross, WARN for a deep overlap), or into the other hand (WARN) | Reduce `curl`, inward `spread` or the finger offsets; keep the hands apart, or declare the touch as a contact |
| `contact` | A declared touch is out of tolerance (FAIL), or a solved or `facing` contact needs attention (WARN, below) | See Contacts below |
| `feet` | A planted foot slides, lifts or sinks | Reduce hips offset or pelvis rotation; keep `plantFeet` |
| `loopSeam` | A loop's end does not meet its start, or speed jumps there | Match end keys and keep motion consistent across the seam |
| `parity` | A bone turns differently on the two Avatars | Report it: this indicates a conversion bug, not an authoring choice |

The oscillation check reads each body joint component (not eyes, fingers or
toes) and ignores swings under 1.5°. Three cycles are three peaks and three
troughs, six reversals in a row. Their rate is timed over whole cycles, peak
to peak and trough to trough, so an uneven pulse (a quick rise and a slower
fall) counts at its true cycle rate. Two quick cycles do not warn.

Finger capsules are sized from each Avatar's finger spacing. The thumb is
not checked against the fingers of its own hand, because fitted fist, point,
peace, pinch and OK shapes press it onto them.

### Contacts

Declare intended touches so the checks verify them and stop flagging them.
`from` and `to` are seconds from the named beat, so the touch moves with it.
The fields (`point`, `targetPoint`, `offset`, `tolerance`, `facing`, `solve`)
are described in clip-format.md:

```json
"contacts": [
  { "bone": "rightHand", "point": "palm", "target": "head", "offset": [0, -0.05, 0.1],
    "beat": "touch", "from": 0, "to": 0.8, "facing": true, "solve": {} }
]
```

`bone` and `target` are VRM humanoid bone names, for example `head`, `neck`,
`chest`, `upperChest`, `spine`, `hips`, `leftHand`, `rightIndexDistal`,
`rightThumbDistal`, `leftLowerArm`. The checks measure from `bone`'s `point`
to `target`'s `targetPoint` moved by `offset`. `offset` is metres for a 1.25 m
Avatar in the target bone's rest-aligned frame (x Avatar's left, y up,
z forward); each Avatar scales it by its height. The `head` bone sits at the
skull base with the eyes about 6 cm above it, so the chin is roughly level with
it and 5–7 cm forward. A hand resting under the chin has its palm about
`[0, -0.05, 0.1]` from `head` and its wrist about `[0, -0.055, 0.11]`; confirm
with the reported actual offset. A failed or warned contact reports where its
point actually is as an offset from the target point, at the same 1.25 m
scale. That tells you which way to move the arm, or which offset you really
meant.

The offset axes are the target bone's T-pose axes carried along with the
bone: for a hand target, the palm faces −y and the fingers point outward
(+x for the left hand, −x for the right).

**Unsolved contacts** are only measured, within `tolerance` (default 6 cm).
The Included Avatars' arms are about as long, but Andrew's shoulder joints
sit about 15 cm further apart and his torso is broader, so a touch keyed by
joint angles lands a few centimetres apart on them. Use tolerances of 4–7 cm
and check both Avatars' renders, or solve the contact.

**Solved contacts** (`solve`) move the upper arm and elbow on each Avatar so
the point lands. They are held to `min(tolerance, 1.5 cm)`; a miss reads
"unreachable on this Avatar": the arm cannot stretch or fold that far within
the elbow's range. Move the target or offset nearer the shoulder, or bend the
authored elbow so the reach is comfortable. Further solved-contact findings:

- **WARN reach correction**: during the window, the authored (unsolved) point
  is more than 8 cm (scaled) from the target, so the solver, not your arm, is
  doing the reach. Big corrections bend the elbow and swing the arm
  differently on each Avatar and can spike speed on the blend ramps. Pose the
  authored arm within a few centimetres of the touch, using the reported
  offset.
- **WARN solved head contact with live layers**: a solved contact on the head,
  neck, eyes or jaw while `sway`, `bounce`, `headNod`, `headSideTilt`,
  `cursorLookAt` or `emotionPosture` is not muted. Those layers turn the head
  or neck after the clip, so the hand would be left behind. Mute the layers the
  finding names; `breathing` moves it only by millimetres.
- Range and smoothness are also reported for the solved arms
  (`<side>UpperArm`, `<side>LowerArm`) of each Avatar after the first: the
  solve differs per Avatar, and blend ramps or a near-straight arm can jump.
  Lengthen `blendIn`/`blendOut` or pose the authored arm nearer the touch.
- Parity is measured on the authored arms before solving, so a per-Avatar
  solve is never reported as a conversion bug.

**WARN palm not facing** (`facing: true`): the palm of `bone`'s hand turns
more than 45° away from the target bone during the window. The direction runs
from the middle of the palm to the target bone: a hand target's centre, the
middle of the head (halfway from the `head` joint to the eyes) for head, eye
and jaw targets, and for any other bone the point of its segment nearest the
palm (from its joint to the next joint, for example elbow to wrist for a
`LowerArm`; a finger's segment runs to its tip). A palm resting anywhere along
a forearm, upper arm or the spine therefore aims straight into it. `offset`
and `targetPoint` are ignored, because during a touch the touch point lies on
the palm or at the fingertips. Turn the palm with forearm `supination`,
upper-arm `rotation` and wrist `flexion`/`deviation`; the solver keeps your
wrist as keyed.

A contact also clears intersections, but only between the two body volumes it
names: a hand or finger bone covers the hand, a `LowerArm` bone the forearm,
`head` the head and neck, torso bones the torso. Declare a second contact if
the forearm also rests on the body. Finger collisions are allowed only between
the parts a contact names: two digits, or a digit and its palm, of one hand, or
any parts of the two hands when a contact joins them. A contact allows these
over its window and, when solved, over its blend ramps, while the solver moves
the hand onto and off the target.

While a contact joins the two hands, each hand is measured only against the
part of the other forearm more than a palm length from its wrist: pressed
palms (a clap, prayer hands) put the wrists inside the capsules' radii, and a
hand pressed into the forearm itself still fails. Declare only the solved
palm-to-palm contact; no check-only contacts are needed.

## Live preview and review notes

`pnpm -s animation:preview <source> [--compare <source>]` opens the motion in
the system browser on both Included Avatars, through the app's own `Avatar`
playback with the chat canvas lighting: fades, live layers (toggle them off to
see the clip alone), layer mutes and expression precedence look as they do in
chat. A source is an `animaPoseClip/2.0` clip, a creator project file, or a
Library item
(`library:<folder | selector | name>`, prefixed `included/` or `local/` when
ambiguous; Local items come from `--local-content <dir>` or the sourced stack
record). A Library Gesture or Reaction, or a project file, plays its Avatar,
Particle and Scene Effects from its dependencies, with their fades; sounds are
not played, and the page's **Effect warnings** panel lists them. The preview also
takes an Avatar, Particle or Scene Effect source (an effect folder, its
descriptor, or `library:avatar-effect/`, `library:particle-effect/` or
`library:scene-effect/<name>`); see the `animama-avatar-vfx`,
`animama-particle-vfx` or `animama-scene-vfx` skill. Use it to
judge timing, which still frames miss:

- play at 0.25–1× speed, loop, scrub, or click a beat marker;
- switch camera presets (front, ¾, side, face, and portrait, the chat's
  Portrait framing);
- `--compare library:<original>` plays an existing Gesture in a second row,
  for example next to its replacement;
- switch sources in the page: the **Review** and **Compare** pickers list the
  example clips, the clips in each file source's folder, and the Included and
  Local Gestures, Reactions and Avatar Effects. To hand the owner several Gestures, start one
  preview and name the items to pick; there is no need for one run per item.

Edits to the source reload the page. Notes the owner adds in the page are
saved beside a file source as `<file name without .json>.review.json`
(`laugh.clip.json` → `laugh.clip.review.json`) or beside an effect's folder
(`sparkle/` → `sparkle.review.json`). They go in the working directory instead
for a Library item and for any file inside Library content: under the Included
or Local root, in a `vfx/avatar/<stem>/` folder, or in a `<stem>/` folder that
holds `<stem>.meta.json` (the content scanner would count a notes file there as
one of the item's files). `--notes <file>` overrides this for the command-line
source. After revising the source for a note:

1. `pnpm -s animation review <notes.review.json>` lists notes with their ids.
2. `pnpm -s animation resolve <notes.review.json> <id> <what you changed>`
   marks one resolved by the source's current version.
3. Ask the owner to look again; **Previous version** in the page plays the
   version the latest note was made against (or else the one before the
   current version) alongside the current one.

Review sidecars and retained versions are ignored by Git under
`src/frontend/web`; summarise the notes and resolutions in the hand-off instead.

## Review renders

`pnpm -s animation:render <clip.json> --out <dir> [--times 0,0.4,0.8] [--rows 8] [--side right|left]`
writes `<clip id>.png`: one row per time and, for each Avatar, a front view,
a ¾ and a side view from the Avatar's own `--side` (default right) and a face
close-up, without live layers. The front view faces the Avatar, so its right
hand appears on the viewer's left. Use `--side left` when the left arm acts,
and larger tiles (`--tile 440x660`) with a few `--times` to judge small
motions, palms or hand shapes; `--view hands` renders close-ups of one hand
instead (see hands-and-face.md, Hand close-ups). Render the beats (keys of
the main action) and a few in-between times. Look for: readable silhouette at
each beat, staggered arrival, arcs, hand shapes, facial expression, odd
forearm directions, wrist breaks, intersections the capsules miss, and
agreement between the Avatars. Write output to a scratch directory, never the
repository.

## Creator confirmation and save

Save through the Gesture creator so the Library item, its metadata and the
runtime catalog stay consistent. `pnpm -s animation:save <items.json>` does
this headlessly for one or more clips (see [batch mode](batch.md) for the
items file); the steps below are the same save by hand. Import a project file
to set the name, the AI description (when chat should choose the Gesture) and
the Selector ID together:

```json
{
  "schema": "animamaActionProject/1.0",
  "intent": "gesture",
  "name": "Mild Laugh",
  "aiDescription": "A short, light laugh at something mildly funny.",
  "semanticKey": "laugh_mild",
  "sequence": { "schema": "animaPoseClip/2.0", "…": "the clip" },
  "dependencies": []
}
```

1. Open `/gestures/new`, Clip tab → Import → choose the file (or paste it) →
   Import. A plain clip file also imports: a new Gesture takes the clip's
   name and the Selector ID follows it, so fill only the AI description.
2. Check the beats on the Pose lane and Clip settings (timeline settings
   button) → Mute while playing.
3. Play it with each Avatar selected in the preview; the creator runs no live
   layers.
4. **Save** (Local content). Use Save & Equip only when the owner asks.
5. Reopen the saved Gesture and play it again.

To revise a saved Gesture, open it from the Library, import the revised clip
on the Clip tab and Save; the item keeps its identity and Selector ID.

## Chat check

On a test Anima, equip the Gesture (or use the debug Gesture trigger) and
watch it in a chat: muted layers should settle while it plays, keyed
expressions should replace the emotion face, and everything should return
afterwards.

## Hand-off

Report:

- the saved item and Avatars reviewed;
- the saved Library item (`library:local/<selector>`), which holds the clip
  and is where later revisions start; drafts in `.animama-drafts/` are not
  kept;
- check results with any accepted WARNs and why;
- render sheets, preview review notes and their resolutions, and the chat
  check;
- known limits.

Automated checks and renders do not prove natural-looking motion. Say which
reviews were done and leave the final judgement to the owner.
