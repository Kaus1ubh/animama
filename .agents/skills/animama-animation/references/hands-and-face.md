# Hands and face

## Hand shapes

Key hands in `hands.left` and `hands.right`. Each key names a `preset`, then
optional whole-hand `curl` (±90°) and `spread` (±30°), then optional per-finger
`fingers` offsets, applied in that order. Presets are fitted to each Avatar's
fingers when the Gesture plays.

| Preset | Use for |
| --- | --- |
| `relaxed` | Rest, idle hands and the moments between actions |
| `open-together` | Presenting, waving, "stop" |
| `open-spread` | Surprise, excitement, big reveals |
| `palm-flat` | A palm resting or pressed on something: hips, forearm, chest, cheek |
| `cupped` | Claps, cradling, holding something round |
| `soft-claw` | Paws, "rawr", playful grabbing |
| `fist` | Determination, cheering, punching |
| `point` | Pointing with the index |
| `peace` | The V sign |
| `thumbs-up` | Thumbs up; turn the forearm for thumbs down |
| `pinch` | Index and thumb pads together, other fingers folded: a blown kiss, "a little bit", holding something small |
| `ok` | The OK sign: a pinch with the other fingers raised and fanned |

`pinch` and `ok` curl the index and aim the thumb on each Avatar so the pads
meet. Offsets on their index or thumb pull the pads apart; vary the other
fingers instead.

```json
"hands": {
  "right": [
    { "beat": "start", "preset": "relaxed" },
    { "beat": "raise", "dt": -0.1, "preset": "open-together", "spread": 8 },
    { "beat": "lower", "dt": -0.2, "preset": "open-together", "spread": 8 },
    { "beat": "settle", "dt": -0.2, "preset": "relaxed" }
  ]
}
```

- Each key is a held shape; the hand eases between neighbouring keys and
  settles on each. Put the shape change slightly before the arm arrives
  (0.05–0.15 s) and repeat a key to hold a shape.
- Before the first key and after the last the hand holds that shape; a hand
  without keys stays at Relaxed Rest. Thumb metacarpals are never changed.
- If a shape still needs work, finish it in the creator's Hands tool on that
  beat and say so in the hand-off.

### Finger offsets

`fingers.<digit>` (`thumb`, `index`, `middle`, `ring`, `little`) adjusts one
digit of the key's shape, in the joint model's degrees:

- Fingers: `curl` (+ toward the palm) and `splay` (+ toward the thumb side;
  proximal segment only).
- Thumb: `curl` (+ folds across the palm), and on its proximal segment
  `palmarAbduction` (+ lifts it out of the hand's plane toward the palm side)
  and `twist` (rolls it about its length).
- `curl` is one value for every segment or a list of one value per segment
  from the knuckle out: three for a finger, two for the thumb. Other fields are
  single values. Every value is from −90 to 90.
- Offsets belong to the key's beat and blend to the neighbouring keys with the
  preset. A digit without offsets keeps the shape; zero offsets are dropped on
  save.

A softer point, the index slightly bent and the middle finger half open:

```json
{
  "beat": "point",
  "preset": "point",
  "fingers": {
    "index": { "curl": [0, 10, 15] },
    "middle": { "curl": [-25, -15, 0] }
  }
}
```

### When to key finger joints

Key finger segments in `joints` (for example `rightIndexDistal.curl`) only for
what offsets cannot express: a finger twist, splay beyond the proximal segment,
or a finger moving on its own throughout the clip (tapping, wiggling). A keyed
finger joint replaces the hand key on that segment for the whole clip, so the
hand keys no longer shape it.

### Contact shapes

When a hand touches something, choose the shape for the contact:

- A palm resting on the body or pressed flat on something: `palm-flat`.
- Claps: `cupped`, so the palms meet with slightly bowed fingers.
- Fingertips meeting (a kiss, a pinch, the OK sign): `pinch` or `ok`.
- A chin resting on the hand: a soft fist, either `cupped` with `curl` 30–40
  or `fist` with offsets that open the knuckles (`"curl": [-30, -15, 0]` on each
  finger). Do not use `fist` with a negative `curl`: it reads as a claw.

### Hand close-ups

```sh
pnpm -s animation:render <clip.json> --out <dir> --view hands [--side left] [--times 0,0.5,1]
```

Renders the `--side` hand (right by default) on both Avatars from the front,
¾, below and facing the palm, one row per time, into
`<clip id>.<side>-hand.png`. Use it to check hand shapes, finger contacts and
palm direction; body sheets are too small to judge fingers.

## Facial expressions

Key VRM preset expressions: `happy`, `angry`, `sad`, `relaxed`, `surprised`,
`neutral`, `blink`, `blinkLeft`, `blinkRight` and vowels `aa`, `ih`, `ou`,
`ee`, `oh`. Weights are 0–1. Do not key the look presets (`lookUp`,
`lookDown`, `lookLeft`, `lookRight`); gaze belongs to the eyes/head.

Moods are blends; start from these and adjust on the face close-up:

| Mood | Face | Body cue |
| --- | --- | --- |
| Joy, greeting | happy 0.6–0.8 | lifted chest, open hands |
| Warm, content | relaxed 0.5 + happy 0.2 | slow, soft settle |
| Curious, interested | surprised 0.3 + happy 0.2 | head tilt 6–10°, lean in 3–5° |
| Surprised | surprised 0.7–0.9 (brief) | quick head back, hands up |
| Thinking, unsure | relaxed 0.3 (+ sad 0.1) | head tilt and turn, eyes up |
| Embarrassed, shy | happy 0.4 + sad 0.15 | head down and aside, shoulders in |
| Sad, sorry | sad 0.5–0.7 | head and chest down, slow |
| Annoyed | angry 0.3–0.5 | sharp head turn, arms in |

- If the Gesture keys any emotion preset, the Anima's emotion face fades out
  for the Gesture and back afterwards. Key the expression the motion needs
  and let it rise slightly ahead of the action (0.1–0.2 s) and fade with the
  return.
- A keyed `blink` replaces automatic blinking while the Gesture plays; use it
  for winks or closed-eye smiles, and keep it brief.
- Lip-sync wins over mouth shapes while the Anima speaks.
- Keep weights moderate (0.5–0.85) for warmth; 1.0 reads as exaggerated on
  most models.
- `happy` already closes the eyes on these models and `relaxed` narrows them
  (about a fifth as much). The runtime scales every blink channel by the
  closure left over, `blink × (1 − happy − k × relaxed)` with k ≈ 0.2 per
  Avatar, so blink can no longer push lids past shut; under happy 0.8 a
  keyed blink barely moves the lids. Author the look you want, not a
  compensated blink: key `blink` high (up to 1) for genuinely closed eyes or
  winks — under a partial smile it only fills the closure still open — and
  lower `happy`/`relaxed` themselves for eyes that should stay open. On an
  open-eyed face, blink 0.3 reads as a soft lid drop and 0.45+ as closed.
  Review the face column on both Avatars; their lids differ.
