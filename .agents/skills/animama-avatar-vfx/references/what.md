# What an Avatar Effect is

Read this to choose a rendering mode, reason about compatibility, or understand
how authored content reaches an Anima. For UI steps, see [How to use the
creator](how.md).

Contents: [Content model](#content-model) · [VRM attachment](#vrm-attachment) ·
[Rendering modes](#rendering-modes) · [Placement and motion](#placement-and-motion) ·
[Coexistence and timing](#coexistence-and-timing) · [Playback integration](#playback-integration)

## Content model

An **Avatar Effect** is reusable visual content: one image plus a definition that
specifies how Animama places and animates it on an avatar. It may have an accompanying
Sound Effect. The content type is `avatar_effect`; clip playback calls its event
`avatar_vfx`.

The image supplies the drawing. The definition supplies its rendering kind,
semantic region, placement, transform, and procedural motion. The creator does not
draw the artwork, edit the source VRM, or bake the effect into a model export.

A VRM expression changes the model's expression state, often through morph weights.
An Avatar Effect adds authored imagery. A Reaction can coordinate both, but a
blush decal does not itself author a smile or select an emotion trigger.

Three related formats serve different purposes:

| Format | Purpose |
| --- | --- |
| Runtime definition, `animama/avatar-effect/2` | Describes the effect and names its logical image resource and optional sound alias. |
| Editor export, `animama/avatar-effect-editor/1` | Wraps an authoring `document` for the creator's JSON Import. Includes image metadata, not image bytes. |
| Saved catalog item | Stores the definition, registered image file, optional exact sound dependency, and authoring data as Local or Included content. |

Do not paste a raw runtime definition into the editor importer or treat an editor
JSON export as a complete transferable image package.

Avatar Effects differ from **Particle Effects**, which emit repeated sprites or
other particle primitives, and **Scene Effects**, which affect the surrounding
scene presentation. A single heart hovering above the head can be an Avatar
Effect; a stream of independently moving hearts is a Particle Effect. Reuse of
the same PNG does not make these content types interchangeable.

## VRM attachment

Once a VRM loads, `Avatar` creates `AvatarFaceLandmarks`,
`AvatarFaceTextureAnchors`, and `AvatarVFXController`.

The controller examines rendered mesh/material usages and classifies them into
`face_skin`, `eye_iris`, `eye_highlight`, `eyeline`, and `eyelash`. It works on a
specific primitive binding, not merely every material with a matching display name.
The default profile relies on material-name patterns and layout assumptions.
The model-specific profile list was empty at the verified source baseline.

Facial landmarks come from model geometry, including eye geometry and available
mouth-expression information. These are not camera-based human face tracking.
For decals, the runtime projects facial points onto face triangles and interpolates
UV coordinates. Placement references are cached; the runtime does not solve them
again on every animation frame.

This makes compatibility model-dependent. A valid effect can fail to appear when
the avatar has unrecognized materials, missing eye geometry, unavailable UVs, or
poorly resolved anchors. A different scale value cannot repair a missing binding.
Use the creator's diagnostics and guides to distinguish these cases.

## Rendering modes

The three authoring kinds use two rendering surfaces: texture composites and
head-attached planes.

| Creator type | Runtime kind | Rendering surface | Choose it for |
| --- | --- | --- | --- |
| Hover | `hover` | Transparent planes attached to the head | Punctuation, anger marks, sweat drops, cartoon eye/mouth replacements |
| Face decal | `face_anchored` | Image composited into face-skin textures at UV anchors | Blush, under-eye tears, skin-level mouth marks |
| Texture | `texture` | Image composited into a classified material's texture layout | Iris patterns, UV-matched full-face shading or replacements |

### Hover

Hover art follows the head and retains its flat shape; it does not deform with
facial skin. It is face-aligned geometry in the 3D scene, not a screen-facing HUD
element. Depth testing is enabled, so hair or other geometry can occlude it, and
the plane foreshortens as the head turns.

- **Eye hover** places artwork at resolved eye landmarks. It can mirror a one-eye
  drawing to the other side, target one side, or center combined art between eyes.
- **Mouth hover** uses the mouth's projected surface point and a small outward
  offset. It is useful when the symbol should sit in front of the mouth rather
  than be painted into the face texture.
- **Face box hover** places a symbol at a named forehead or upper-face position.
  It is the usual choice for emotes floating around the head.

Eye hover defaults to **Force blink**, **Hide eye details**, and **Clean up eye
area** enabled. Force blink holds the blink expression at 1. Hide eye details
suppresses classified eye-highlight, eyeline, and eyelash bindings. Clean up eye
area enables **face flattening**: soft fills sampled from the face texture cover
competing painted eye detail. Each can be disabled independently. **Additional
hidden materials** selects explicit material roles to suppress alongside the
automatic eye-detail roles; disabling Hide eye details leaves these selections in
force.

Mouth hover and mouth decals default to **Clean up mouth area** enabled, which
similarly covers painted mouth detail. Disable it when the original texture
should remain visible. Older definitions without these flags retain the enabled
behavior.

**Skin backdrop** is an additional backing plane available for eye and mouth hover.
It uses sampled face color behind the image. Turning it off does not turn off the
separate cleanup pass; use the eye/mouth cleanup control for that. Neither
operation changes the VRM on disk.
Both need visual review on shaded or unusually textured faces because a sampled
patch can remain visible.

### Face decal

Decals target `face_skin` and always use overlay compositing. Anchors are
`undereye`, `blush`, and `mouth`.

Under-eye and blush support **Single side** and **Span face**. Single side uses one
side's artwork, optionally reflected onto the opposite side. Span face places one
combined image across both anchors. It does not generate two independent copies.
Mouth uses one central anchor.

The anchor establishes position and reference size; it is not a clipping mask.
A tear can start under the eye and extend down the cheek. Its image pivot controls
which part of the image rectangle meets the anchor. The artwork becomes part of
the displayed skin texture and follows that mesh's deformation.

### Texture

Texture effects select a material role, an asset shape, and an application mode.
The runtime creates a material clone for the affected binding and composites into
supported `map` and `shadeMultiplyTexture` slots.

- **Overlay** keeps the original texture underneath the effect.
- **Replace** omits the original base in the resulting composite. Transparency
  should not be assumed to reveal that original texture.

`single_eye` maps one drawing into the configured iris regions. `double_eye`
uses combined eye artwork. `full_face` is appropriate for a face texture layout,
not an arbitrary front-facing portrait. Generic Texture placement uses the
profile's layout; it does not discover facial landmarks from the uploaded image.

The UI exposes highlight, eyeline, and eyelash targets as well as face skin and
iris. Their presence in the menu does not imply a specialized UV layout or a usable
texture slot on every avatar. Inspect the target's UV preview before relying on
them. For a localized cheek mark, choose Face decal rather than trying to guess
coordinates in a whole-face atlas.

**Hidden materials** suppresses selected classified roles while the Texture
effect is active. This is independent of Overlay/Replace; for example, an iris
effect can hide existing Eye highlight bindings without replacing the iris base.
Material suppression operates on recognized bindings and can affect both eyes.

General texture effects composite before anchored face decals; later effects
within the same kind draw above earlier ones. Clearing effects restores runtime
resources as needed rather than rewriting source VRM materials.

## Placement and motion

All placement uses the image's full rectangle, including transparent padding.
The creator does not automatically find the opaque silhouette. A tall narrow tear
inside a square PNG remains a square image for sizing purposes. Changing its
pivot to top-center aligns the top of that square, not the first visible tear pixel.

Left and right labels refer to the **avatar's** sides. Offset axes and image
mirroring should be checked in the preview rather than inferred from the viewer's
left/right.

| Setting | Hover | Face decal / Texture |
| --- | --- | --- |
| Position offset | Added in head-anchor local 3D units | X/Y operate in normalized texture coordinates; they are not meters |
| Scale | Multiplies the plane dimensions | Changes placement dimensions relative to the anchor or texture layout |
| Rotation | X/Y/Z orientation; UI uses degrees | A 2D angle; UI uses degrees |
| Serialized rotation | Radians | Radians, using Z for the 2D angle |
| Drift | Rate multiplied by plane width/height | Rate multiplied by the full texture width/height |

For texture surfaces, Z offset/scale and X/Y rotation do not provide 3D depth or
tilt, even though some shared controls are visible. Anchored decal sizing preserves
image aspect relative to a reference box; separate X/Y scale values are not simply
a free stretch operation. Use the visible footprint to judge the result.

The independent animation channels are **Pulse**, **Spin**, and **Drift**. They can
be combined. Pulse changes scale. Spin adds rotation; a range below one turn rocks
back and forth, while one turn spins continuously. Drift moves continuously from
the starting placement and has no automatic return or wrap. The same drift value
can travel very different visible distances on Hover and Face decal.

These animate a still image's transform, not a sequence of drawing frames. Avatar
Effects have no authored flipbook/sprite-sheet control. The controller updates VFX
animation at up to 30 fps; animated texture effects require canvas redraw and
texture upload. A static effect can still move with the avatar's head or skin.

## Coexistence and timing

**Region controls replacement, not geometric placement.** It is separate from the
effect kind, target role, and anchor.

| Region | When another effect in that region is applied |
| --- | --- |
| `eyes`, `undereye`, `blush`, `mouth` | The prior effect in that region is removed |
| `emote`, `full_face` | Different instances may coexist |

Reapplying the same instance ID replaces that instance. Correct regions let blush,
tears, cartoon eyes, and a floating anger mark coexist. A symbol placed above the
head but saved with region `eyes` still competes with eye effects.
See [region verification](how.md#verify-the-region) before saving a new effect.

Current authoring stores reusable appearance and motion. Its **Gesture or Reaction
event** owns Start and End, ending with the Action or after a configured duration.
Legacy `lifetime` metadata in older Local content is ignored by the runtime and
dropped by the creator; conversation-turn/run-end expiry is not a playback contract.
Procedural motion speed does not set effect lifetime.

## Playback integration

```text
Image + creator settings
  -> Local Avatar Effect (+ optional exact Sound dependency)
  -> Gesture / Reaction component and timeline event
  -> Anima's selected Action content and mounted dependency catalog
  -> clip event -> AvatarVFXController -> texture composite or hover plane
```

The creator preview calls the same controller methods used for rendering:
`applyHoverVFX`, `applyFaceAnchoredVFX`, and `applyTextureVFX`.
It previews the selected model but does not prove an Action has been saved or
selected for the Anima.

Live playback uses mounted Included/Local catalog entries. Image bytes are fetched
through registered, revision-scoped file references, bounded by frontend media
budgets, and made available as owned Blob URLs. Sound aliases resolve through the
dependency map. A runtime ID missing from that catalog does not fall back to a
similarly named global template; there is no bundled Avatar Effect catalog.

Clip occurrences receive their own applied IDs, so cancellation or completion can
clear the effects they started. Accompanying sound belongs to that occurrence and
can be disabled on its event. The Disable VFX presentation preference suppresses
clip-owned visual effects; a working manual preview therefore does not establish
that live chat playback is enabled.

## Source navigation

Use these when a concrete question is not answered above or the running UI differs.
Do not load the entire source set for an ordinary creation task.

| Question | Repository path / symbol |
| --- | --- |
| Types, roles, regions, mirroring fields | `src/frontend/web/src/lib/avatar/vfx/types.ts` |
| Material recognition and UV layout defaults | `src/frontend/web/src/lib/avatar/vfx/profiles.ts` |
| Landmark and UV-anchor computation | `src/frontend/web/src/lib/avatar/vfx/AvatarFaceLandmarks.ts`, `AvatarFaceTextureAnchors.ts` |
| Placement, flattening, stacking, material cleanup | `src/frontend/web/src/lib/avatar/vfx/AvatarVFXController.ts` |
| Motion math and texture axes | `src/frontend/web/src/lib/avatar/vfx/animation.ts`, `placement-transform.ts` |
| Content resolution and media ownership | `src/frontend/web/src/lib/runtime-content/AnimaRuntimeMediaCatalog.ts` |
| Clip application, sound, cancellation | `src/frontend/web/src/lib/avatar/Avatar.ts`, `_applyClipOwnedAvatarVFX` |
| Maintained app guide | `docs/frontend/runtime/avatar-vfx.md` |
