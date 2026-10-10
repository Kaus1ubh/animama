# Focus lines

A `focus_lines` Scene draws comic speed lines converging on the Avatar's face
or a box, behind or in front of the Avatar. One focus-lines Scene and one
background can show at once.

```json
{
  "schema": "animama/scene-effect/1",
  "kind": "focus_lines",
  "durationMs": 1200,
  "dismissOnInput": false,
  "renderPlacement": "behind_avatar",
  "lineCount": 50,
  "color": "#ffffff",
  "opacity": 0.92,
  "baseThicknessPx": 10,
  "thicknessVariationPx": 5,
  "lengthVariation": 0.18,
  "overscanPx": 48,
  "target": { "kind": "avatar_face", "paddingXPx": 48, "paddingYPx": 96 },
  "animation": { "minVisibleMs": 90, "maxVisibleMs": 280, "minHiddenMs": 50, "maxHiddenMs": 200, "opacityJitter": 0.18 }
}
```

| Field | Range and meaning |
| --- | --- |
| `renderPlacement` | `behind_avatar` (underlay band) or `front_of_avatar` (overlay band, above the canvas) |
| `lineCount` | 1–256 lines |
| `color`, `opacity` | `#rrggbb`, 0–1 |
| `baseThicknessPx`, `thicknessVariationPx` | 0.1–128 and 0–128 px: line thickness and its random variation |
| `lengthVariation` | 0–1: how unevenly the lines reach toward the target |
| `overscanPx` | 0–4096 px drawn past the view edges |
| `target` | `avatar_face` with `paddingXPx`, `paddingYPx` 0–2048 (the clear oval around the face), or `manual_box` with a `rect` `{ x, y, width, height }` |
| `animation` | visible and hidden spans 0–10000 ms (`minVisibleMs`…`maxHiddenMs`) for the flicker, `opacityJitter` 0–1 |
| `seed` | optional whole number; a fixed seed gives the same lines every time |

Keep the face padding generous enough that lines never cross the eyes. Front
placement suits a brief, loud beat; behind suits a longer emphasis.

A focus-lines Scene has no images, so it needs no art and promotes with no
image files (content ID `builtin:scene-effect:focus:<stem>`).
