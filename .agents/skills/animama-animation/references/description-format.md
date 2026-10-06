# Motion description format

`animamaMotion/1` JSON is the editable source of a generated Gesture. The
generator validates it, reports every problem with a JSON path, and writes no
output when anything is invalid.

```json
{
  "schema": "animamaMotion/1",
  "name": "Wave Hello",
  "kind": "oneShot",
  "duration": 2.6,
  "fadeIn": 0.25,
  "fadeOut": 0.35,
  "plantFeet": true,
  "mutedProceduralLayers": ["sway", "bounce", "headNod", "headSideTilt", "cursorLookAt", "emotionPosture"],
  "joints": {
    "rightUpperArm": {
      "elevation": [{ "t": 0, "v": "base" }, { "t": 0.55, "v": 108 }, { "t": 2.3, "v": "base" }]
    }
  },
  "hipsPosition": { "x": [{ "t": 0, "v": 0 }, { "t": 0.65, "v": 0.015 }, { "t": 2.6, "v": 0 }] },
  "hands": { "right": [{ "t": 0, "preset": "relaxed" }, { "t": 0.45, "preset": "open-together", "spread": 8 }] },
  "expressions": { "happy": [{ "t": 0, "v": 0 }, { "t": 0.45, "v": 0.75 }, { "t": 2.55, "v": 0 }] },
  "contacts": []
}
```

The full example is
`src/frontend/web/src/lib/avatar/motion-authoring/examples/wave-hello.motion.json`.

## Fields

| Field | Meaning |
| --- | --- |
| `name` | Gesture display name; the clip id is its kebab-case form. |
| `kind` | `oneShot` (enter, act, return) or `loop` (repeats while held). |
| `duration` | Seconds; every key time is within 0…duration. |
| `fadeIn`/`fadeOut` | Blend from/to the live pose (defaults 0.3 / 0.4 s). |
| `plantFeet` | Default `true`: legs are solved to keep feet still; leg joints cannot be keyed. Set `false` to key legs yourself. |
| `mutedProceduralLayers` | Live layers muted while playing. Default: all but `breathing`. |
| `sampleRate` | Baked keyframes per second (10–60, default 30); the baker adds samples where needed. |
| `joints` | `{ jointId: { component: keys[] } }`; see `pnpm -s animation joints`. |
| `hipsPosition` | `{ x, y, z }` metres from rest: x toward the Avatar's left, y up, z forward (±0.3). |
| `hands` | `{ left, right }` hand-shape keys (see hands-and-face.md). |
| `expressions` | `{ vrmPreset: keys[] }`, weights 0–1. |
| `contacts` | Intended touches, used by the checks (see checks-and-review.md). |

## Keys

`{ "t": seconds, "v": number | "base", "tangent"?: "auto" | "flat", "interp"?: "smooth" | "linear" | "step" }`

- Times strictly increase. `"base"` means the Relaxed Rest value of that
  component (`pnpm -s animation base`); expressions have no base.
- In a `oneShot`, a track holds its first value before its first key and its
  last value after its last key. In a `loop`, tracks wrap instead: the time
  after the last key blends back to the first key across the seam (hand
  shapes too), so put the first and last keys where the transition should
  happen, or key 0 and the duration with equal values for a hold at the seam.
- A joint you never mention stays at the base pose; a component you omit
  holds its base value.
- `tangent: "auto"` (default) keeps speed through the key unless the key is a
  peak or valley; `"flat"` stops at the key.
- `interp` controls the segment that leaves the key: `smooth` (cubic, default),
  `linear` (constant speed, kinks at keys) or `step` (holds, then jumps at the
  next key — use only for deliberate snaps).
- Values outside a component's anatomical limit are rejected.

## Joint ids

`hips`, `spine`, `chest`, `upperChest`, `neck`, `head`, `eyes`, then per side
(`left…`/`right…`): `Shoulder`, `UpperArm`, `LowerArm`, `Hand`, `UpperLeg`,
`LowerLeg`, `Foot`, `Toes`, finger segments such as `rightIndexProximal`,
`rightMiddleIntermediate`, `rightRingDistal`, and `rightThumbProximal`,
`rightThumbDistal`. Sides are the Avatar's own.

## Output

The generated clip is `animaPoseClip/1.0` with `basePose: "relaxedRest"`,
linear keyframes dense enough for the curves, the description's fades and
`mutedProceduralLayers`. Dense clips are hard to edit by hand in the creator:
edit the description and regenerate instead, then re-import.
