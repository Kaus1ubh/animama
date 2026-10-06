# Checks, review and hand-off

## Motion checks

`pnpm -s animation check <motion.json | clip.json> [--description <motion.json>] [--json]`
plays the clip through the production sampler on `AvatarSample_Y_0` (VRM 0)
and `AvatarSample_A_1_New` (VRM 1) and exits 1 on any FAIL. A description
supplies `contacts` and `plantFeet`; pass `--description` when checking a clip.

| Category | Means | Typical fix |
| --- | --- | --- |
| `pose` | A referenced pose is missing from the catalog | Use inline values (generated clips always do) |
| `range` | A joint exceeds its natural (WARN) or anatomical (FAIL) range | Reduce the value or share it with neighbouring joints |
| `smoothness` | Pop, speed or acceleration spike, or a mid-motion stall (WARN) | Spread keys, remove `step`/`linear` jumps, add an easing key, drop accidental `flat` holds |
| `intersection` | Hand or forearm passes into the torso, neck, head or the other arm (capsule approximation, calibrated against the base pose) | Raise elevation before or with elbow flexion (a bent elbow on a hanging arm drives the forearm into the hip); move the arm outward or forward; avoid shoulder depression with a bent elbow; declare an intended touch as a contact |
| `contact` | A declared touch is not within tolerance | Adjust arm/elbow/wrist until the bone reaches the target |
| `feet` | A planted foot slides, lifts or sinks | Reduce hips offset or pelvis rotation; keep `plantFeet` |
| `loopSeam` | A loop's end does not meet its start, or speed jumps there | Match end keys and keep motion consistent across the seam |
| `parity` | A bone turns differently on the two Avatars | Report it: this indicates a conversion bug, not an authoring choice |

Declare intended touches so the checks verify them and stop flagging them:

```json
"contacts": [
  { "bone": "leftHand", "target": "head", "from": 0.6, "to": 1.4, "offset": [0, -0.08, 0.06], "tolerance": 0.06 }
]
```

`bone` and `target` are VRM humanoid bone names, for example `head`, `neck`,
`chest`, `upperChest`, `spine`, `hips`, `leftHand`, `rightIndexDistal`,
`rightThumbDistal`, `leftLowerArm`. `offset` is metres in the target bone's
rest-aligned frame (x Avatar's left, y up, z forward). The `head` bone sits at
the skull base with the eyes about 6 cm above it, so the chin is roughly level
with it and 5–7 cm forward. A hand (wrist bone) resting under the chin sits
about `[0, -0.06, 0.11]` from `head`; confirm with the reported actual offset. A failed contact reports where the bone
actually is as an offset from the target, which tells you which way to move
the arm (or which offset you really meant).

The offset axes are the target bone's T-pose axes carried along with the
bone: for a hand target, the palm faces −y and the fingers point outward
(+x for the left hand, −x for the right). The two Included Avatars have
different proportions (A_1's forearms are longer), so exact touches between
two moving hands land a few centimetres apart on one of them; use tolerances
of 4–7 cm and check both Avatars' renders.

A contact clears intersections only between the two body volumes it names:
a hand or finger bone covers the hand, a `LowerArm` bone the forearm, `head`
the head and neck, torso bones the torso. Declare a second contact if the
forearm also rests on the body.

## Live preview and review notes

`pnpm -s animation:preview <source> [--compare <source>]` opens the motion in
the system browser on both Included Avatars, through the app's own `Avatar`
playback: fades, live layers (toggle them off to see the clip alone), layer
mutes and expression precedence look as they do in chat. A source is a
description, a clip, a creator project file, or a Library item
(`library:<folder | selector | name>`, prefixed `included/` or `local/` when
ambiguous; Local items come from `--local-content <dir>` or the sourced stack
record). Use it to judge timing, which still frames miss:

- play at 0.25–1× speed, loop, scrub, or click a beat marker;
- switch camera presets (front, ¾, side, face);
- `--compare library:<original>` plays an existing Gesture in a second row,
  for example next to its replacement.

Edits to the source reload the page. Notes the owner adds in the page are
saved beside a file source as `<file name without .json>.review.json`
(`laugh.motion.json` → `laugh.motion.review.json`), or in the working
directory for a Library item (`--notes <file>` overrides). After revising the
source for a note:

1. `pnpm -s animation review <notes.review.json>` lists notes with their ids.
2. `pnpm -s animation resolve <notes.review.json> <id> <what you changed>`
   marks one resolved by the source's current version.
3. Ask the owner to look again; **Previous version** in the page plays the
   version the latest note was made against (or else the one before the
   current version) alongside the current one.

Review sidecars and retained versions are ignored by Git; summarise the notes
and resolutions in the hand-off instead.

## Review renders

`pnpm -s animation:render <clip.json> --out <dir> [--times 0,0.4,0.8] [--rows 8] [--side right|left]`
writes `<clip id>.png`: one row per time and, for each Avatar, a front view,
a ¾ and a side view from the Avatar's own `--side` (default right) and a face
close-up, without live layers. The front view faces the Avatar, so its right
hand appears on the viewer's left. Use `--side left` when the left arm acts,
and larger tiles (`--tile 440x660`) with a few `--times` to judge small
motions, palms or hand shapes. Render the beats (keys of the main action) and a
few in-between times. Look for: readable silhouette at each beat, staggered
arrival, arcs, hand shapes, facial expression, odd forearm directions, wrist
breaks, intersections the capsules miss, and agreement between the Avatars.
Write output to a scratch directory, never the repository.

## Creator confirmation and save

1. Open `/gestures/new`, Clip tab → Import → paste the clip JSON (or choose
   the file) → Import.
2. Check Clip settings (timeline settings button) → Mute while playing.
3. Play it with each Avatar selected in the preview; the creator runs no live
   layers.
4. Fill the name and AI description, then **Save** (Local content). Use
   Save & Equip only when the owner asks.
5. Reopen the saved Gesture and play it again.

## Chat check

On a test Anima, equip the Gesture (or use the debug Gesture trigger) and
watch it in a chat: muted layers should settle while it plays, keyed
expressions should replace the emotion face, and everything should return
afterwards.

## Hand-off

Report:

- the saved item and Avatars reviewed;
- the description path (in the owner's location or `motion-authoring/examples/`;
  regenerate rather than hand-editing a dense clip);
- check results with any accepted WARNs and why;
- render sheets, preview review notes and their resolutions, and the chat
  check;
- known limits.

Automated checks and renders do not prove natural-looking motion. Say which
reviews were done and leave the final judgement to the owner.
