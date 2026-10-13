# Effect folder

A Scene Effect source is one folder: the descriptor `<stem>/<stem>.json`
holding the `animama/scene-effect/1` definition, and the PNG images its items
and tile name, beside it. `effects check`, `effects:render`,
`animation:preview`, `effects save` and `effects promote` all take the folder.

```text
.animama-drafts/effects/proud-radiance/
  proud-radiance.json
  glint.png
```

## Start from something that works

Copy the closest Included Scene (`content/included/vfx/scene/<stem>/`; most
are the older marquee style), rename the descriptor to the new stem and drop
its `content_id` and `version` (Library metadata a draft leaves out), start
from the example below, or from the every-layer example
`src/frontend/web/src/lib/content/fixtures/scene-effect-all-layers.json`
(a definition only; wrap it in a descriptor). The creator's Export shows the
editor document, not the stored definition; prefer a folder. The example's
values show the shape, not a tuned design.

## Descriptor

```json
{
  "schema_version": 1,
  "content_type": "scene_effect",
  "name": "Proud Radiance",
  "description": "A warm glow and slowly turning rays behind the Avatar with twinkling glints, for proud and confident moments.",
  "definition": {
    "schema": "animama/scene-effect/1",
    "kind": "background_layers",
    "durationMs": null,
    "dismissOnInput": false,
    "coverUiOverlays": false,
    "solid": { "enabled": false, "color": "#000000" },
    "pattern": { "enabled": false, "pattern": "none", "color": "#ffffff", "size": 10, "spacing": 20, "opacity": 0.3 },
    "marquee": {
      "enabled": false, "items": [], "itemSize": 72, "gap": 24, "rowGap": 18,
      "direction": "left", "itemRotationMode": "upright",
      "itemRotationOffsetDeg": 0, "speedPxPerSec": 100, "opacity": 1
    },
    "gradient": {
      "enabled": true, "type": "radial", "angleDeg": 180, "centerX": 0.5, "centerY": 0.32,
      "stops": [{ "color": "#fff4d1", "position": 0 }, { "color": "#f2b86a", "position": 1 }]
    },
    "screen": {
      "enabled": true, "kind": "rays", "color": "#fffaf0", "opacity": 0.35,
      "count": 18, "centerX": 0.5, "centerY": 0.32, "spiky": false,
      "turnSeconds": 60, "throbPerSec": 0, "seed": 7
    },
    "scatters": [
      {
        "enabled": true,
        "items": [{ "id": "glint", "kind": "image", "label": "Glint", "image": "glint.png" }],
        "count": 10, "seed": 21, "minSize": 14, "maxSize": 30,
        "minRotationDeg": 0, "maxRotationDeg": 0, "minOpacity": 0.8, "maxOpacity": 1,
        "regionTop": 0, "regionBottom": 0.8, "keepFaceClear": true,
        "direction": "static", "speedPxPerSec": 0,
        "minSpinDegPerSec": 0, "maxSpinDegPerSec": 0, "alternateSpin": false, "pulse": "twinkle"
      }
    ]
  },
  "files": [{ "path": "glint.png", "role": "image" }]
}
```

- **name**: Local names use letters, digits, spaces, `.`, `_` and `-`,
  starting with a letter or digit; the saved Local folder is the lowercased
  name with spaces and `_` as `-`. The description is what the Library and
  chat selection read.
- **definition**: a `background_layers` definition always has `solid`,
  `pattern` and `marquee` (disable what you do not use); `gradient`, `tile`,
  `screen`, `scatters` and `flash` are optional. See [layers](layers.md). A
  `focus_lines` definition has its own fields ([focus lines](focus-lines.md)).
- **files**: every image an item or the tile names, with role `image`.
  `effects check` fails a shown image that is not listed and warns about a
  listed one nothing shows.

## Images

- One file per logical name, in the folder beside the descriptor, named as
  the definition names it.
- Names use letters, digits, `.`, `_` and `-`, and the extension matches the
  bytes (`drop.png` must be a PNG): the creator names a chosen file that way,
  and `effects save` refuses a name the creator would change.
- PNG for anything that may be promoted. The creator also takes JPEG, WebP
  and restricted static SVG for private Scenes.
- Limits: 8 MiB and 4096 px per image, 16 images and 32 MiB per Scene; the
  art budgets (`scene-sticker`, `scene-tile`) are tighter and are the target.
- To use a built-in sticker, copy its PNG from
  `content/included/resources/scene-vfx/stickers/` into the folder and list
  it like any image (the creator's sticker picker does the same). `emoji`
  items are no longer accepted.
