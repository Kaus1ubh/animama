# Background layers

A `background_layers` Scene draws these layers behind the Avatar, back to
front. Every layer has `enabled`; a disabled or absent optional layer draws
nothing. Ranges are inclusive (`lib/scene-vfx/limits.ts`, enforced by the
creator, `effects check` and the backend at Save, scan and import). Colours are
`#rrggbb`. Directions are `static`, `left`, `right`, `up`, `down`,
`diagonal-up-left`, `diagonal-down-left`, `diagonal-up-right`,
`diagonal-down-right`. Seeds are whole numbers from 0 to 4294967295; the same
seed and view size give the same picture everywhere.

Top level: `schema` (`animama/scene-effect/1`), `kind`, `durationMs` (`null`
holds the Scene; otherwise 100–30000), `dismissOnInput`, `coverUiOverlays`
(raise the Scene above the chat's UI overlays), optional `soundAlias`.

## 1. Solid (required)

`color`. A flat fill; disable it to let the Anima's own background show.

## 2. Gradient (optional)

`type` `linear` (`angleDeg` 0–360; 180 runs top to bottom) or `radial`
(`centerX`, `centerY` 0–1); `stops`: 2–4 `{ color, position }` with positions
0–1 in ascending order. The usual base of a mood: a sky, a vignette, a glow
behind the head.

## 3. Pattern (required)

`pattern` `none`, `polkadot`, `heart` or `star`; `color`, `size` 1–512,
`spacing` 0–1024, `opacity` 0–1. A static procedural texture (halftone dots,
small hearts).

## 4. Tile (optional)

`image` (one image name), `size` 16–1024 px, `opacity` 0–1, `direction`,
`speedPxPerSec` 0–600. One image repeated across the view and drifting one
tile per cycle: bokeh, a star field, clouds. Art: `scene-tile` budget (may be
opaque; keep its margins so the repeat is seamless).

## 5. Screen (optional)

`kind` `rays` or `lines`, `color`, `opacity` 0–1, `seed`, and only the
fields of that kind:

- **Rays:** `count` 4–48 wedges from `centerX`, `centerY` (0–1); `spiky` draws
  a starburst instead of wedges; `turnSeconds` 0 (still) or 4–600 per turn,
  its sign giving the direction; `throbPerSec` 0–4. Pride, radiance, rage.
- **Lines:** `count` 4–96 lines hanging from the top edge, `minLength` and
  `maxLength` 0.05–1 (fractions of the view height), `minWidthPx` and
  `maxWidthPx` 0.5–16, `swaySeconds` 0 (still) or 1–60. Gloom lines (tate-sen)
  and shock lines.

## 6. Marquee (required)

`items` (up to 64), `itemSize` 1–1024, `gap` and `rowGap` 0–2048,
`direction`, `itemRotationMode` (`upright` or `follow-track`),
`itemRotationOffsetDeg` −360–360, `speedPxPerSec` 0–2000, `opacity` 0–1.
Rows of items scrolling across the whole view, the older emotion-background
style.

## 7. Scatters (optional, up to three)

Each scatter places `count` 1–48 items (at most 96 across all scatters) picked
from its `items` (1–8), with seeded per-item ranges:

| Field | Range |
| --- | --- |
| `minSize`, `maxSize` | 4–512 px |
| `minRotationDeg`, `maxRotationDeg` | −360–360 |
| `minOpacity`, `maxOpacity` | 0–1 |
| `regionTop`, `regionBottom` | 0–1 of the view height that holds still items, and the lanes of left and right drifters (two left or right layers whose regions overlap share their combined span) |
| `speedPxPerSec` with `direction` | 0–600; drifting items cross the view on off-screen tracks |
| `minSpinDegPerSec`, `maxSpinDegPerSec` | 0–720; `alternateSpin` reverses every other item |
| `pulse` | `none`, `twinkle`, `pop` or `flicker` |

Placement is even and depends on the seed and the view size. Still items
never overlap: they sit wholly inside the region, spread evenly and clear of
earlier layers' still items, and in small views every still item of the
Scene shrinks by one factor (down to 0.4) until they fit; only a region too
crowded at that floor overlaps, so keep still `count` and `maxSize` modest.
Drifters run in equal lanes, as many as `maxSize` fits, evenly spaced along
the track; a drifting layer overlaps itself only when its items cannot fit.
Layers moving the same way share the span in separate interleaved lanes, so
they never collide while the span has room for a lane of each. A drifter may
pass over another layer's still items, and layers moving in different
directions may cross. `keepFaceClear` keeps still items' centres out of the
column behind the head, and items drifting straight up or down out of that
column's width. Petals, drops, confetti, anger marks, bubbles. Art: `scene-sticker` budget.

## 8. Entry flash (optional)

`color`, `durationMs` 50–2000. One fade from that colour when the Scene
starts: shock, a gacha flash. Use it sparingly.

## Items

Marquee and scatter items are `{ "id", "kind": "image", "label", "image":
"<file name>" }`, each naming a listed image of the folder. Ids are unique
within a layer; labels are what the creator shows. Animama no longer provides
Twemoji: an `emoji` item is refused by `effects check` and Save (an old Local
Scene that has one plays without it until it is replaced).
