# Materials, skinning, and Avatar VFX

Use for avatar appearance inspection, generated texture integration, and Avatar
Effect creator work. Paths are relative to the active Animama repository. The
maintained guide is `docs/frontend/runtime/avatar-vfx.md`; this reference adds
the VRM reasoning behind it.

## Separate skinning, surfaces, and shader state

A glTF **skin** is a joint/inverse-bind-matrix relationship; `face_skin` in
Animama is a **detected face part**, not a glTF concept. Neither a skin nor the
humanoid mapping defines a universal face UV atlas. A mesh has primitives that
reference materials; multiple usages can share one material or texture.
Morphs/skinning move vertices, while UVs identify positions in textures. A UV
decal deforms with its surface; a head-attached plane has different behavior.

Inspect the rendered primitive, material instance, texture slot, UVs, and
relevant deformation, not just a suggestive material name. This also
distinguishes a missing UV/material binding from a bone-orientation problem.
[glTF meshes, skins, materials, and textures](https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html)

MToon supplies lit/shade colors and textures, toon shading, rim/matcap effects,
outlines, alpha handling, and UV animation. Replacing an MToon material with a
generic material discards behavior. Preserve the relevant shader properties and
expression bindings. Base/shade color textures use color-space handling distinct
from numerical masks/normal maps; do not mark all textures sRGB.
[MToon specification](https://github.com/vrm-c/vrm-specification/blob/master/specification/VRMC_materials_mtoon-1.0/README.md)

When replacing a glTF-loaded texture, preserve its sampler, UV transform/channel
as applicable, orientation, color space, and alpha behavior. Do not fix
upside-down art with an arbitrary global `flipY` toggle. Animama's controller has
`copyTextureSettings` and placement helpers for its CanvasTexture path; use that
established behavior and inspect supported fields for the installed Three.js
version.

## Face parts

The VRM specification does not define material names, so Avatar Effects find
the face from VRM signals (`src/frontend/web/src/lib/avatar/vfx/faceParts.ts`,
`detectAvatarFaceParts`):

- **Irises** (`eye_left`, `eye_right`): primitives with at least half their skin
  weight on the humanoid `leftEye`/`rightEye` bones, or whose material a look-at
  expression moves through a texture transform. Iris, white and highlight are
  separated by projected area and depth. One primitive may hold both eyes, and
  eye whites are often skinned to the head.
- **Face skin**: the head-skinned primitive of the mesh that both `blink` and
  `aa` morph, with the most area around the eyes.
- **Eye lines and eyelashes**: small primitives of that mesh that `blink` moves
  almost entirely.
- **Hair**: primitives in the head subtree with a real share of spring-joint
  weight (VRoid bangs keep most weight on the head bone).

Material and node names (`profiles.ts`) are only a per-part fallback. Each part
reports `node:mesh:primitive` bindings (from `buildRuntimePrimitiveBindings` in
`vrmEditorInspection.ts`), a source (`signals`, `names`, `corrected`, `missing`)
and a confidence. Detection must not write world matrices; doing so once skewed
VRM 0 landmarks.

A user corrects parts in the creator's **Face parts** panel. The
`animama/avatar-face-parts/1` correction lists primitive keys and the VRM file's
sha256, so it applies only to identical bytes; a mismatch is ignored with a
diagnostic. Local Avatars keep it in their `.meta.json` sidecar; Included Avatars
get an owner-scoped override bound to their revision.
`Avatar.setFacePartCorrections` rebuilds parts, landmarks, anchors and bindings
and re-applies active effects. An effect whose part is missing is skipped with
`avatar_effect_face_part_unavailable`; the Action continues.

Landmarks (`AvatarFaceLandmarks.ts`) prefer the normalized head as their anchor
object. Version-specific face-front handling remains necessary even after the
scene-root facing correction. UV anchors (`AvatarFaceTextureAnchors.ts`) project
landmarks onto the face-skin mesh and interpolate UVs; the mouth anchor uses
expression geometry when available. Landmarks and anchors are built at load (and
after a correction), placements when an effect applies; there is no per-frame
face solve, so do not assume an attachment follows every facial morph.

## The `/2` definition and attachments

`animama/avatar-effect/2` is defined once, in
`src/backend/animama/app/contracts/avatar_effect.py`, and generated into the
frontend types and zod validators; `lib/avatar/vfx/definition.ts` parses it.
`/1` is refused until converted. There is no bundled Avatar Effect catalog;
Included and Local descriptors are the only sources, and image names and the
Sound alias resolve through the exact content revision's file/dependency map.

| Attachment                                        | Render surface                                                                    | Suitable artwork                                 |
| ------------------------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------ |
| `face_surface`, area `undereye`, `blush`, `mouth` | Decal composited into `face_skin` at a UV anchor                                  | Blush, tears, under-eye marks, mouth marks       |
| `face_surface`, area `full`, `eyes`               | Composite on the part's own texture layout                                        | UV-matched face shading, iris replacement        |
| `face_landmark`                                   | Plane on the head bone at the eyes, mouth, forehead, top or above the head        | Stylized eyes or mouth, anger marks, punctuation |
| `body`                                            | Plane on a humanoid bone (shared resolver with Particle Effects)                  | Hearts on the chest, a glow in a hand            |
| `sticker`                                         | Camera-facing quad beside the head or body, sized by avatar height, no depth test | Comic lettering, stickers                        |
| `silhouette`                                      | Overlay meshes sharing each primitive's geometry, skeleton and morph weights      | Gloom shading, patterns over the whole figure    |

Decal anchors set position, pivot and reference size; they are not clipping
boundaries, so transparent padding affects apparent size and placement. `span`
spreads one image across both anchors. Full-surface art must match the model's
UV layout; a face-shaped PNG does not map to every VRM.

Left and right are the avatar's anatomy, not screen sides. Units differ by
attachment: UV fractions for surfaces, metres in head or bone space for planes,
fractions of avatar height for stickers. Rotations are degrees. Do not copy
numbers between attachments. A mirrored copy mirrors its horizontal offset and
can use a separate `otherEyeImage`.

## Composite and masking behavior

Surface effects clone the material per active primitive usage, keeping one
composite canvas/CanvasTexture per active slot (`map` and
`shadeMultiplyTexture`). Full-surface layers precede decals; later applies of the
same kind draw above earlier ones; re-applying an applied ID replaces it. Do not
bypass this with a shared original-material mutation.

The **face cleanup** pass samples skin colour and paints soft fills over the
painted eyes or mouth before effect layers draw (eye planes, mouth planes and
mouth decals request it). It hides conflicting painted detail and is neither an
effect nor a mesh deformation. `skinBackdrop` adds a skin-coloured plane behind
eye or mouth art. Quality depends on the sample and anchors; do not bake one
avatar's skin colour into a reusable transparent asset to compensate.

Silhouette overlays read alpha from the avatar's original material, never a face
effect's composite, and skip MToon outlines and layers that write no depth.

Animated surface effects redraw and upload composites on the 30 FPS VFX tick;
static segments are cached. Planes animate transforms; flipbooks on planes move
texture offsets without a re-upload. When diagnosing performance, use
`pnpm -s effects:bench` and distinguish texture upload cost from landmark setup
or React rendering.

## Use the in-app creator

1. Start from the Effects template picker (sidebar Create → **Effects**, the
   Create page's Avatar FX card or `/effects/new`), choose **Avatar FX**, then a
   template or **Start from scratch**. Saved effects reopen at
   `/avatar-effects/{id}/edit`. Choose the **Model** (Annie, Andrew or the
   active Anima's model) and **View** (Face, Three-quarter, Portrait, Full
   body).
2. In **Effect Setup**, choose **Attach to** (Floating on the face, Painted on
   the face, On the body, Sticker beside the avatar, Fill the silhouette), then
   the attachment's fields, the image (PNG, JPEG or WebP; check for real alpha,
   not a painted checkerboard), an optional other side image or animated sprite
   sheet, and the face options.
3. Open **Face parts** and confirm the parts the effect needs are found on this
   model; correct uncertain or missing ones and save the correction.
4. Drag the art on the preview, and use the corner and round handles to resize
   and turn it; the **Placement** tab shows the same values. Use **Guides**,
   **UV preview** and **Skin coverage** to compare anchors, the full image
   rectangle and the cleanup regions. These affect the preview only.
5. Set **Look** and **Motion**, Play and Restart, and check front, three-quarter
   and face views on both Included Avatars. A definition error blocks Save and
   names its field; a missing part is a model compatibility problem.
6. Save when requested, reopen, and add it to a Gesture or Reaction through
   **Use in…**; the Action event owns timing and fades. For a review outside the
   app, use `pnpm -s effects:render` (sheets) or `pnpm -s animation:preview`
   (live, both Avatars) from `src/frontend/web`.

Implementation: `src/frontend/web/src/ui/avatar-effect-creator/` (page, setup
fields, inspector, manipulator, face parts panel, guides, UV preview, save hook)
and `src/frontend/web/src/lib/avatar/vfx/editor/document.ts`.

## Cleanup and useful diagnostics

The serializable editor document holds logical metadata/digests, not File
objects, Blob URLs, live Avatar objects, or Three.js textures. Preview media and
catalog leases have separate owners. `effect-image.ts` shares only pending loads
and removes settled promises; completed images belong to active effects.
Retaining completed promises by temporary Blob URL pins decoded images after a
preview is destroyed.

`AvatarVFXController` restores original material/visibility state and disposes
owned composites, planes and overlays. Stop/unmount should remove the applicable
instances without clearing unrelated effects. For clip-owned effects, preserve
their event/instance ownership instead of broadly clearing the canvas.

| Symptom                                           | First boundary to inspect                                                                                                        |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Missing effect                                    | Part map and `avatar_effect_face_part_unavailable`, catalog readiness, compatible slot, image load and limits, snapshot warnings |
| Correction ignored                                | `vrm_sha256` or Included revision changed                                                                                        |
| Mirrored or opposite-side art                     | Anatomical side, `mirror`, `otherEyeImage`, model UV layout, anchor basis                                                        |
| Correct centre but wrong size                     | Transparent padding, single/span choice, reference rectangle, scale/pivot                                                        |
| Washed-out or dark art                            | Colour space, source colour multipliers, lit and shade slots, blend mode, expression/material writer                             |
| Flicker, hair intersection, visible painted mouth | Plane depth/placement, hair part, cleanup anchors, backdrop, part visibility                                                     |
| Preview works, saved playback fails               | Portable definition, logical media alias, exact revision dependency closure, action timing                                       |
| Growth after repeated replacement                 | Owned canvases/textures/images, settled promises, URL leases, controller disposal                                                |

Source-backed diagnosis is a starting point. Verify the affected model and route
before claiming visual compatibility or a fixed resource leak.
