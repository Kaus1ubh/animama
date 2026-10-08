# Effect folder

An effect source is one folder: `<stem>/<stem>.json` plus the images it names.
`effects check`, `effects:render`, `animation:preview` and `effects save` all
take the folder. The authoritative schema is
`src/backend/animama/app/contracts/avatar_effect.py`; the frontend parses the
same definition (`src/frontend/web/src/lib/avatar/vfx/definition.ts`).

```json
{
  "content_type": "avatar_effect",
  "name": "Sweat Drop",
  "description": "A big anime sweat drop on the temple for nervous, caught-out moments.",
  "definition": {
    "schema": "animama/avatar-effect/2",
    "region": "emote",
    "attachment": { "kind": "face_landmark", "landmark": "forehead", "position": "right" },
    "art": { "image": "sweat_drop.png" }
  }
}
```

The description is what the Library and chat selection read: say what the
effect shows and when it fits. The name follows Local naming: letters,
digits, spaces, `.`, `_` and `-`, starting with a letter or digit. Library
metadata in Included files (`content_id`, `version`, `dependencies`, `files`)
is not needed in a draft.

## Definition fields

- `region`: `eyes`, `undereye`, `blush`, `mouth`, `emote` or `full_face` for
  face attachments; `body`, `sticker` or `silhouette` for those attachments
  (it must equal the kind). Effects in `eyes`, `undereye`, `blush` or
  `mouth` replace each other; `emote` and `full_face` effects stack.
- `attachment` (one of):
  - `face_landmark` — floating art: `landmark` `eyes`, `mouth`, `forehead`,
    `top` or `top_edge`. `position` (`left`, `middle`, `right`, plus
    `left_corner`/`right_corner` on `top_edge`) is required for forehead,
    top and top_edge and not allowed otherwise. Eyes take `side` and
    `mirror` (draw the right eye and mirror it). `offset` (metres; +x toward
    the viewer's right, +y up, +z forward, the same on VRM 0 and VRM 1),
    `scale` `{x,y}`, `rotationDeg` `{x,y,z}`.
  - `face_surface` — painted art: `part` (`face_skin`, `eye_iris`,
    `eye_highlight`, `eyeline`, `eyelash`) and `area`. `full` and `eyes`
    cover the part's texture layout (art drawn to that UV layout);
    `undereye`, `blush` and `mouth` are decals on `face_skin` at a face
    anchor (`pivot` picks the image point placed there). `eyes`, `undereye`
    and `blush` need `layout` `single` (one side, `side` required for
    decals, optional `mirror`) or `span` (one image across both sides).
    A decal's size follows its image's aspect against the anchor: a taller
    canvas gives a longer mark, a wider one a broader mark. Generate decal
    art at the aspect you want rather than stretching it, which thickens the
    outline unevenly; `effects:assets flipbook --cell <W>x<H>` keeps
    non-square frames.
    `mode` `overlay` or `replace` (decals overlay only); `offset` (UV),
    `scale`, `rotationDeg`.
  - `body` — `bone` (`root`, `hips`, `spine`, `chest`, `neck`, `head`,
    `leftHand`, `rightHand`, `leftFoot`, `rightFoot`), `offset` (metres in
    the bone's frame: +x viewer's right, +y up, +z toward the viewer),
    `size` (plane height in metres, default 0.2), `facing` `camera` or
    `bone`, `rotationDeg`.
  - `sticker` — `around` `head` or `body`, `offset` and `size` as fractions
    of the Avatar's height in the screen plane (+x toward the viewer's right,
    +y up), `rotationDeg`. Draws over the Avatar. The default size 0.25 is
    about a head; props such as a bulb or a note read well at 0.1–0.15.
  - `silhouette` — `fill` `pattern` (tiles the art; `patternScale`, `scroll`
    in tiles per second) or `tint` (the art's average colour × tint).
- `art`: `image`, optional `otherEyeImage` (a different file; only with
  `mirror: true` on an `eyes` landmark or on a `single`-layout `eyes`,
  `undereye` or `blush` surface). Name images with plain file names in
  the folder, no subfolders, optional `flipbook`
  `{ columns, rows, frames, fps, loop }` from `effects:assets flipbook`.
- `appearance`: `opacity` 0–1, `tint` `#rrggbb` (multiplies), `blend`
  `normal`, `additive` or `multiply`.
- `motion` (all optional, combined): `pulse { scaleMin, scaleMax,
  cyclesPerSecond }`, `spin { degreesPerSecond, amountTurns, direction }`
  (under one turn it swings from 0 to `amountTurns` and back, not around 0:
  for a centred wobble offset the attachment's `rotationDeg` by half the
  swing), `drift { x, y }` (art sizes per second),
  `keyframes { loop, frames: [{ t, opacity?, scale?, rotationDeg?, offset? }] }`
  on the effect's own timeline in seconds: times increase; omitted channels
  interpolate from neighbouring frames; keyframe `scale` is one number
  (uniform) and multiplies the attachment's scale, `opacity` multiplies,
  `rotationDeg` adds degrees, and `offset` `{x,y}` adds in the attachment's
  own offset units (metres for floating and body art, fractions for
  stickers). Without `loop` the last frame's values hold, which suits a pop-in
  followed by a held pose. With `loop` the whole timeline restarts from 0
  each time it reaches the last keyframe time, so a looping timeline repeats
  its pop-in too: combine a one-off keyframe pop-in with a `pulse` (scale
  only) for an ongoing beat. There is no separate glow or opacity loop.
- `faceOptions` (only where they apply): eye landmarks take `forceBlink`,
  `hideEyeDetails`, `faceCleanup` (default on), `skinBackdrop` (default
  off) and `hideParts`; the mouth landmark takes `faceCleanup` and
  `skinBackdrop`; mouth decals `faceCleanup`; `full` and `eyes` surfaces
  `hideParts`.

Omit fields at their defaults. Limits: flipbook grid up to 16×16 and 256
frames at up to 60 fps; up to 64 keyframes; scale up to 20.

## Recipes

Start here, then fit to the art with renders. Sizes that read well on the
Included Avatars, for trimmed square art: floating eye art `scale` 0.45–0.6;
forehead marks about 0.55; a mark on `top_edge` 1.4–1.6; a column rising
from `top` about 2.0 with `offset.y` 0.06 (metres up); stickers `size`
0.1–0.15. Several effects on one Avatar look crowded when they share a
side: spread emotes and stickers across both sides of the head.

| Effect | Attachment | Notes |
| --- | --- | --- |
| Shape over each eye | `face_landmark` `eyes`, `side: "right"`, `mirror: true` | Draw the right eye; add `otherEyeImage` only when the left differs. |
| Mark on the forehead | `face_landmark` `forehead`, `position: "left"` | `region: "emote"`; a small `pulse` reads as throbbing. |
| Sweat drop at the temple | `face_landmark` `forehead`, `position: "right"`, `offset.y` 0.015, `scale { x: 0.75, y: 0.75 }` | `region: "emote"`; keyframes: pop in (opacity 0 → 1, scale 0.3 → 1.2 → 1 over 0.35 s), then slide `offset.y` down about 0.015 m. |
| Pop above the head | `face_landmark` `top_edge`, `position: "right_corner"` | `region: "emote"`; `keyframes` for a scale overshoot. |
| Blush | `face_surface` `face_skin`, `area: "blush"`, `layout: "span"` | `region: "blush"`; soft art, `opacity` 0.8. |
| Tears | `face_surface` `face_skin`, `area: "undereye"`, `layout: "single"`, `side: "right"`, `mirror: true` | `region: "undereye"`; flipbook for streaming. |
| Pattern in the irises | `face_surface` `eye_iris`, `area: "eyes"`, `layout: "single"` | `region: "eyes"`; art drawn to the iris layout. |
| Whole-face tint | `face_surface` `face_skin`, `area: "full"` | `region: "full_face"`; art on the face UV layout. |
| Heart on the chest | `body` `chest`, `offset.z` 0.12, `size` 0.12 | `region: "body"`; `pulse` 1.5 cycles/s. |
| Comic text beside the head | `sticker` `around: "head"`, `offset { x: 0.18, y: 0.05 }` | `region: "sticker"`; tilt with `rotationDeg`. |
| Prop popping up beside the head | `sticker` `around: "head"`, `offset { x: 0.12, y: 0.08 }`, `size` 0.12 | `region: "sticker"`; keyframe pop-in (scale 0.3 → 1.3 → 0.9 → 1 over 0.3 s) plus a gentle `pulse`. |
| Gloom over the body | `silhouette` `fill: "tint"`, `appearance.tint` | `region: "silhouette"`; `opacity` 0.5–0.7. |
