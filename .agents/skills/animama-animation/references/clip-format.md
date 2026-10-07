# Clip format

You write Gestures directly as `animaPoseClip/2.0` JSON: named **beats** on a
timeline, and per-joint **tracks** whose keys belong to a beat. The same file
plays in chat, opens in the Gesture creator and is what Save stores, so a
saved Gesture stays editable from its Library item. `pnpm -s animation
validate` reports every problem with a JSON path and writes nothing when
anything is invalid. The full format is described in
`docs/frontend/runtime/avatar-animation.md` (Pose and clip JSON artifacts).

```json
{
  "schema": "animaPoseClip/2.0",
  "id": "wave-hello",
  "name": "Wave Hello",
  "duration": 2.6,
  "basePose": "relaxedRest",
  "fadeIn": { "duration": 0.25 },
  "fadeOut": { "duration": 0.35 },
  "mutedProceduralLayers": ["sway", "bounce", "headNod", "headSideTilt", "cursorLookAt", "emotionPosture"],
  "plantFeet": true,
  "beats": [
    { "id": "start", "label": "Start", "time": 0 },
    { "id": "raise", "label": "Raise", "time": 0.5 },
    { "id": "wave", "label": "Wave", "time": 0.9 },
    { "id": "lower", "label": "Lower", "time": 2 },
    { "id": "settle", "label": "Settle", "time": 2.5 }
  ],
  "joints": {
    "rightUpperArm": {
      "elevation": [
        { "beat": "start", "v": "base" },
        { "beat": "raise", "dt": 0.05, "v": 108 },
        { "beat": "lower", "dt": -0.25, "v": 100 },
        { "beat": "settle", "dt": -0.2, "v": "base" }
      ]
    }
  },
  "hipsPosition": { "x": [{ "beat": "start", "v": 0 }, { "beat": "raise", "dt": 0.15, "v": 0.015 }, { "beat": "settle", "dt": 0.1, "v": 0 }] },
  "hands": { "right": [{ "beat": "start", "preset": "relaxed" }, { "beat": "raise", "dt": -0.05, "preset": "open-together", "spread": 8 }] },
  "expressions": { "happy": [{ "beat": "start", "v": 0 }, { "beat": "raise", "dt": -0.05, "v": 0.75 }, { "beat": "settle", "dt": 0.05, "v": 0 }] }
}
```

Full examples (the six evaluation Gestures, the laugh tiers, storytelling,
the Included-Gesture replacements and more) are in
`src/frontend/web/src/lib/avatar/motion-authoring/examples/*.clip.json`.

## Fields

| Field | Meaning |
| --- | --- |
| `id`, `name` | Gesture display name; `id` is its lowercase kebab-case form (the creator reapplies it). |
| `duration` | Seconds (at most 3,600); every beat and key lies within 0…duration. |
| `loop` | `true` repeats while held; omit for a one-shot (enter, act, return). |
| `basePose` | Use `"relaxedRest"`; `"base"` values and untracked bones come from it. |
| `fadeIn`/`fadeOut` | `{ "duration": s }` blends from/to the live pose (about 0.3 / 0.4 s). |
| `plantFeet` | `true` solves the legs on each Avatar so both feet stay still; leg joints cannot then be keyed. Omit it only to key the legs yourself. |
| `mutedProceduralLayers` | Live layers muted while playing; usually all but `breathing`. |
| `beats` | `{ id, label, time, ease? }` in time order, at least 0.5 ms apart. `label` is what the creator shows; `ease` is the default arrival for the beat's keys. |
| `joints` | `{ jointId: { component: keys[] } }`; see `pnpm -s animation joints`. |
| `hipsPosition` | `{ x, y, z }` metres from rest: x toward the Avatar's left, y up, z forward. |
| `hands` | `{ left, right }` hand-shape keys (see hands-and-face.md). |
| `expressions` | `{ vrmPreset: keys[] }`, weights 0–1. |
| `contacts` | Intended touches, used by the checks (see checks-and-review.md). |
| `rotations` | Raw quaternion tracks used by hand-made and converted clips; do not author them. |

## Beats and keys

`{ "beat": id, "dt"?: seconds, "v": number | "base", "ease"?: …, "tangent"?: "flat" }`

- A key's time is its beat's time plus `dt` (default 0). Keys lie between the
  neighbouring beats of their beat, and a track's keys increase in time.
- Beats are the readable structure: the creator shows them as keyframes on the
  Pose lane, and moving a beat moves all its keys with it. Give each beat a
  short label for what happens ("Raise", "Clap 2", "Settle"); 3–8 beats per
  Gesture, plus one per repeated accent.
- Assign each key to the beat it belongs to musically, with a small `dt` for
  staggered arrival: a hand that lands 0.1 s after the arm is
  `{ "beat": "raise", "dt": 0.1, … }`. Keys stay with their beat when it moves.
- `"base"` means the Relaxed Rest value of that component
  (`pnpm -s animation base`); expressions have no base.
- `ease` says how motion arrives at the key: `smooth` (the default for joints,
  hips and expressions; monotone cubic, keeps speed through a key unless it is
  a peak or valley), `linear` (constant speed, kinks at keys), `hold` (stay on
  the previous value, then snap at this key — deliberate snaps only), or a
  named easing (`easeInOutSine`, the default for hands, `easeOutCubic` and so
  on). A key's `ease` overrides its beat's.
- `"tangent": "flat"` stops motion at a smooth key.
- In a one-shot, a track holds its first value before its first key and its
  last after its last. In a loop, tracks wrap: after the last key the value
  blends back to the first key across the seam. Key 0 and the duration with
  equal values to hold at the seam.
- A joint you never mention stays at the base pose; a component you omit
  holds its base value. A joint must name at least one component.
- Values beyond a component's anatomical limit fail `validate`.

## Joint ids

`hips`, `spine`, `chest`, `upperChest`, `neck`, `head`, `eyes`, then per side
(`left…`/`right…`): `Shoulder`, `UpperArm`, `LowerArm`, `Hand`, `UpperLeg`,
`LowerLeg`, `Foot`, `Toes`, finger segments such as `rightIndexProximal`,
`rightMiddleIntermediate`, `rightRingDistal`, and `rightThumbProximal`,
`rightThumbDistal`. Sides are the Avatar's own. Components marked auxiliary
in `pnpm -s animation joints` complete a joint's three axes for converted
clips; leave them at their base.

## Size and playback

Clips store keys, not frames: the six examples save at 3–13 KB, 1.1–8.2% of their
former baked size, and a 20 s Gesture stays far below the 2 MB the app loads
(`validate` reports the saved size). Each Avatar prepares the clip when it
starts playing: hand presets are fitted to its fingers and planted legs are
solved on its own rig, so both Included Avatars keep their feet still.
