# What an Avatar Effect is

Read this to choose an attachment, reason about compatibility, or understand how
authored content reaches an Anima. For UI steps, see [How to use the
creator](how.md).

Contents: [Content model](#content-model) · [Attachments](#attachments) ·
[Face parts](#face-parts) · [Placement and motion](#placement-and-motion) ·
[Coexistence and timing](#coexistence-and-timing) ·
[Playback integration](#playback-integration)

## Content model

An **Avatar Effect** is reusable visual content: an image (or a flipbook sprite
sheet, optionally with a second image for the other eye or side) plus a
definition that says where the art attaches, how it looks and how it moves. It
may have an accompanying Sound Effect. The content type is `avatar_effect`; clip
playback calls its event `avatar_vfx`.

The creator does not draw the artwork, edit the source VRM, or bake the effect
into a model export. A VRM expression changes the model's expression state; an
Avatar Effect adds authored imagery. A Reaction can coordinate both, but a blush
effect does not itself author a smile or select an emotion trigger.

| Format                                          | Purpose                                                                                                                                                                                                      |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Runtime definition, `animama/avatar-effect/2`   | Describes the effect and names its logical images and optional sound alias. One contract, `src/backend/animama/app/contracts/avatar_effect.py`, defines it for the backend and the generated frontend types. |
| Editor export, `animama/avatar-effect-editor/2` | Wraps an authoring `document` for the creator's JSON Import. Includes image metadata, not image bytes.                                                                                                       |
| Saved catalog item                              | Stores the definition, registered image files, optional exact sound dependency, and authoring data as Local or Included content.                                                                             |

Do not paste a raw runtime definition into the editor importer or treat an editor
JSON export as a complete transferable image package. `animama/avatar-effect/1`
is refused everywhere until converted; Local content converts automatically at
startup or Rescan (see the runtime guide for the commands).

Avatar Effects differ from **Particle Effects**, which emit many independently
moving sprites, and **Scene Effects**, which draw backgrounds and focus lines
around the Avatar. A single heart hovering above the head is an Avatar Effect; a
stream of hearts is a Particle Effect. Reusing a PNG does not make these content
types interchangeable.

## Attachments

The creator's **Attach to** choice is the definition's `attachment.kind`.

| Attach to                 | `kind`          | How it renders                                                                                                                                          | Choose it for                                                 |
| ------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Floating on the face      | `face_landmark` | A flat plane on the head bone in front of the eyes, mouth, forehead, top of the head or above the head                                                  | Cartoon eyes or mouths, anger marks, punctuation, sweat drops |
| Painted on the face       | `face_surface`  | Drawn into a face part's texture: a decal at the under-eye, cheek or mouth anchor, or the whole part (face skin, irises, highlights, eye lines, lashes) | Blush, tears, iris patterns, UV-matched face shading          |
| On the body               | `body`          | A plane on a body point (hips, waist, chest, neck, head, hands, feet or the whole avatar), facing the camera or the bone                                | A heart on the chest, a glow in a hand                        |
| Sticker beside the avatar | `sticker`       | A camera-facing image beside the head or body, sized by the avatar's height and drawn over it                                                           | Comic lettering, idea bulbs, music notes                      |
| Fill the silhouette       | `silhouette`    | A tiled pattern or flat tint drawn only over the avatar's visible pixels                                                                                | Gloom shading, despair stripes                                |

**Floating art** follows the head and keeps its flat shape; it does not deform
with facial skin. It is depth tested, so hair or other geometry can cover it, and
it foreshortens as the head turns. Eye art defaults to **Close the eyes** (holds
`blink`), **Hide eye details** (highlights, eye lines, lashes) and **Clean up
the eye area** (soft skin-coloured fills over the painted eyes); mouth art
defaults to **Clean up the mouth area**. **Skin-coloured backing**, off by
default, adds a plane of sampled skin colour behind eye or mouth art. Each can be turned off; none
changes the VRM on disk, and the sampled patch needs visual review on shaded or
unusual faces.

**Painted art** becomes part of the displayed texture and follows that mesh's
deformation. Decals use a face anchor for position and reference size; the
anchor does not clip the art, so a tear can run down the cheek. Cheek and
under-eye decals use one side (optionally mirrored) or one image spanning both
sides. Whole-part art must match that part's UV layout; a face-shaped PNG does
not map to every VRM, so use a decal for a localized mark. **Keep the original
underneath** chooses overlay (on) or replace (off). **Hide other face parts**
hides selected parts while the effect is active.

**Body, sticker and silhouette** effects need no face part, follow the avatar
through every motion, and coexist with face effects. The silhouette never
changes the avatar's materials and skips outlines and transparent eye layers.

## Face parts

Effects find the face from VRM signals, not material names: the humanoid eye
bones and skin weights for the irises, the mesh that the `blink` and `aa`
expressions morph for face skin, small blink-moved primitives for eye lines and
lashes, and spring joints for hair. Names are only a per-part fallback.

The creator's **Face parts** panel shows each part as Detected (with a
confidence), uncertain, Corrected or Missing for the selected Avatar. A user can
correct a part; the correction is saved with that Avatar, applies in the creator
and in chat, and only to the exact VRM file it was made on. An effect whose part
is missing is not applied: the creator names the part, and chat continues
without the effect and logs `avatar_effect_face_part_unavailable`. A larger size
or offset cannot repair a missing part.

## Placement and motion

Placement uses the image's full rectangle, including transparent padding. A tall
narrow tear inside a square PNG is still a square for sizing and pivots.

Left and right are the **avatar's** sides. Units depend on the attachment, so do
not copy numbers between attachments:

| Attachment           | Position                                                                              | Size                     | Rotation                                     |
| -------------------- | ------------------------------------------------------------------------------------- | ------------------------ | -------------------------------------------- |
| Floating on the face | cm from the face point: +x toward the viewer's right (the avatar's left), up, forward | width and height factors | degrees, plus tilt forward and turn sideways |
| Painted on the face  | % of the texture                                                                      | width and height factors | degrees in the texture plane                 |
| On the body          | cm from the body point, in the bone's frame                                           | plane height in cm       | degrees in its own plane                     |
| Sticker              | % of the avatar's height, in the screen plane                                         | % of the avatar's height | degrees                                      |
| Silhouette           | pattern tile size and scroll (tiles/s)                                                | —                        | —                                            |

A mirrored copy (the other eye or cheek) mirrors its horizontal offset and can
use the **Other side image** instead of a mirrored one, so a wink needs one
effect.

The effect owns its motion. **Pulse** scales between two sizes, **Spin** turns
(°/s; a range below one turn rocks back and forth), **Drift** moves continuously
in art widths or heights per second with no return, and **Keyframes** change
opacity, scale, turn and offset over the effect's own timeline (scale and opacity
multiply the presets; turn and offset add). An **Animated sprite sheet** plays
frames from a grid at a frame rate, repeating, once or back and forth. The
controller animates at up to 30 fps; animated painted effects redraw and upload
their texture on each tick, so they cost more than floating ones.

**Look** sets opacity, tint and blend (Normal, Glow for additive light, Shade for
multiply).

## Coexistence and timing

**Region controls replacement, not placement.** The creator sets it
automatically from the attachment; **Advanced → Replaces** overrides it.

| Region                               | When another effect in that region is applied                  |
| ------------------------------------ | -------------------------------------------------------------- |
| `eyes`, `undereye`, `blush`, `mouth` | The prior effect in that region is removed                     |
| `emote`, `full_face`                 | Different effects coexist                                      |
| `body`, `sticker`, `silhouette`      | Coexist, up to four active at once; a fifth removes the oldest |

Re-applying the same instance replaces it. Correct regions let blush, tears,
cartoon eyes and a floating anger mark coexist; a mark above the head saved with
region `eyes` still replaces eye effects.

The **Gesture or Reaction event** owns Start and End (with the Action or after a
duration) and, for an event that ends after a duration, **Fade in** and **Fade
out**. Motion speed does not set an effect's lifetime.

## Playback integration

```text
Image + creator settings
  -> Local Avatar Effect (+ optional exact Sound dependency)
  -> Gesture / Reaction component and timeline event
  -> Anima's selected Action content and mounted dependency catalog
  -> clip event -> AvatarVFXController -> texture composite, plane or overlay
```

The creator preview uses the same controller as chat. It previews the selected
model but does not prove an Action has been saved or selected for the Anima.

Live playback uses mounted Included and Local catalog entries. Images are fetched
through revision-scoped file references, bounded by media limits, and held as
owned Blob URLs. A runtime ID missing from that catalog does not fall back to a
similarly named effect; there is no bundled Avatar Effect catalog.

Clip occurrences receive their own applied IDs, so cancellation or completion
clears the effects they started. Accompanying sound belongs to that occurrence and
can be disabled on its event. The Disable VFX presentation preference suppresses
clip-owned visual effects, so a working creator preview does not establish that
live chat playback is enabled.

## Source navigation

Use these when a concrete question is not answered above or the running UI
differs. Do not load the entire source set for an ordinary creation task.

| Question                                 | Repository path / symbol                                                                    |
| ---------------------------------------- | ------------------------------------------------------------------------------------------- |
| Fields, enums, bounds, cross-field rules | `src/backend/animama/app/contracts/avatar_effect.py`                                        |
| Parsing into runtime entries             | `src/frontend/web/src/lib/avatar/vfx/definition.ts`                                         |
| Face parts and their fallback            | `src/frontend/web/src/lib/avatar/vfx/faceParts.ts`, `profiles.ts`                           |
| Landmark and UV-anchor computation       | `src/frontend/web/src/lib/avatar/vfx/AvatarFaceLandmarks.ts`, `AvatarFaceTextureAnchors.ts` |
| Placement, cleanup, stacking, transforms | `src/frontend/web/src/lib/avatar/vfx/AvatarVFXController.ts`                                |
| Body, sticker, silhouette                | `src/frontend/web/src/lib/avatar/vfx/AvatarAttachmentEffects.ts`, `silhouetteOverlay.ts`    |
| Motion math                              | `src/frontend/web/src/lib/avatar/vfx/animation.ts`, `placement-transform.ts`                |
| Content resolution and media ownership   | `src/frontend/web/src/lib/runtime-content/AnimaRuntimeMediaCatalog.ts`                      |
| Clip application, fades, cancellation    | `src/frontend/web/src/lib/avatar/Avatar.ts`, `_applyClipOwnedAvatarVFX`                     |
| Maintained app guide                     | `docs/frontend/runtime/avatar-vfx.md`                                                       |
