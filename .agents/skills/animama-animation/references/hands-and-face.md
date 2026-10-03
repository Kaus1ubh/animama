# Hands and face

## Hand shapes

Hands use the Gesture creator Hands tool's presets, fitted to the reference
Avatar, with optional relative `curl` (±90°) and `spread` (±30°):

`relaxed`, `fist`, `open-spread`, `open-together`, `point`, `peace`,
`thumbs-up`.

```json
"hands": {
  "right": [
    { "t": 0, "preset": "relaxed" },
    { "t": 0.4, "preset": "open-together", "spread": 8 },
    { "t": 1.8, "preset": "open-together", "spread": 8 },
    { "t": 2.3, "preset": "relaxed" }
  ]
}
```

- Each key is a held shape; the hand eases between neighbouring keys and
  settles on each. Put the shape change slightly before the arm arrives
  (0.05–0.15 s) and repeat a key to hold a shape.
- Before the first key and after the last the hand holds that shape; a hand
  without keys stays at Relaxed Rest. Thumb metacarpals are never changed.
- For shapes presets cannot make (a pinch, an OK sign, a curled index), key
  finger segments in `joints` (for example `rightIndexDistal.curl`). Keyed
  finger joints replace the preset on that segment for the whole clip.
- If a shape still needs work, finish it in the creator's Hands tool and
  record that the saved Gesture differs from the description.

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
- `relaxed` and `happy` already narrow the eyes on these models, and a keyed
  `blink` adds to that: 0.3 reads as a soft lid drop, 0.45+ as closed eyes.
  Check the face column on both Avatars; they differ.
