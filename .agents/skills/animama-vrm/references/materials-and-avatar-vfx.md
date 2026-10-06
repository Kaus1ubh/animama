# Materials, skinning, and Avatar VFX

Use for avatar appearance inspection, generated texture integration, and Avatar Effect creator work. Paths are relative to the active Animama repository.

## Separate skinning, surfaces, and shader state

A glTF **skin** is a joint/inverse-bind-matrix relationship; `face_skin` in Animama is a **material-role heuristic**. Neither a skin nor the humanoid mapping defines a universal face UV atlas. A mesh has primitives that reference materials; multiple usages can share one material or texture. Morphs/skinning move vertices, while UVs identify positions in textures. A UV decal deforms with its surface; a head-attached plane has different behavior.

Inspect the rendered primitive, material instance, texture slot, UVs, and relevant deformation, not just a suggestive material name. This also distinguishes a missing UV/material binding from a bone-orientation problem. [glTF meshes, skins, materials, and textures](https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html)

MToon supplies lit/shade colors and textures, toon shading, rim/matcap effects, outlines, alpha handling, and UV animation. Replacing an MToon material with a generic material discards behavior. Preserve the relevant shader properties and expression bindings. Base/shade color textures use color-space handling distinct from numerical masks/normal maps; do not mark all textures sRGB. [MToon specification](https://github.com/vrm-c/vrm-specification/blob/master/specification/VRMC_materials_mtoon-1.0/README.md)

When replacing a glTF-loaded texture, preserve its sampler, UV transform/channel as applicable, orientation, color space, and alpha behavior. Do not fix upside-down art with an arbitrary global `flipY` toggle. Animama's controller has `copyTextureSettings` and placement helpers for its CanvasTexture path; use that established behavior and inspect supported fields for the installed Three.js version.

## App attachment and classification

Read `docs/frontend/runtime/avatar-vfx.md` and these sources for the relevant operation:

- `src/frontend/web/src/lib/avatar/vfx/AvatarVFXController.ts`: bindings, application, composites, hover planes, restoration/disposal.
- `src/frontend/web/src/lib/avatar/vfx/types.ts`: actual discriminated union and transform fields.
- `src/frontend/web/src/lib/avatar/vfx/profiles.ts`: material-name role classification and optional per-model layout overrides.
- `src/frontend/web/src/lib/avatar/vfx/AvatarFaceLandmarks.ts`: face bounds and eye landmarks from live primitive geometry, normalized eye/head information, and fallbacks.
- `src/frontend/web/src/lib/avatar/vfx/AvatarFaceTextureAnchors.ts`: face-surface projection and interpolated UV anchors; mouth expression-based/fallback anchors and flatten regions.
- `src/frontend/web/src/lib/avatar/vrmEditorInspection.ts`: `buildRuntimePrimitiveBindings` for exact live usages.

Roles include face skin, iris, eyeline, eyelashes, and eye highlights. They are heuristics; the baseline profile override list is empty. Unrecognized material names do not imply an invalid VRM. Check snapshot warnings and the exact binding before proposing a profile change.

Landmarks prefer the normalized head as their anchor object, then use available fallback objects. Version-specific face-front handling remains necessary even after the scene-root facing correction. The normal path builds landmarks/UV anchors at load and placement at effect application; it is not a fresh semantic face solve every frame. Do not assume an attachment follows every facial morph perfectly.

## Choose the effect kind

The catalog union has three `kind` values; the renderer has two surfaces:

| Creator kind / data | Render surface | Suitable artwork |
| --- | --- | --- |
| Face decal / `face_anchored` | Composite texture on `face_skin` | Blush, tears, under-eye marks, mouth decals |
| Texture / `texture` | Composite texture on classified target role | UV-matched overlays or iris replacement |
| Hover / `hover` | Separate `hover_plane` | Stylized eyes/mouth or floating forehead symbols |

For `face_anchored`, `anchor` is `undereye`, `blush`, or `mouth`. Bilateral anchors use `single` (one side asset with side/mirror controls) or `span` (one wide image covering both anchors once). Mouth uses its own center anchor. An anchor/reference rectangle sets placement, pivot, and scale; it is not a clipping boundary. Transparent image padding therefore affects apparent scale and placement.

`texture` supports `overlay` (retain original appearance below the effect) and `replace` (effect result replaces that texture slot). Full-face art requires matching UV layout; do not assume a face-shaped PNG automatically maps to every VRM.

`hover` subtypes:

- `eye_hover`: art in front of iris landmarks; can disable selected underlying roles.
- `mouth_hover`: art near the projected mouth surface, sized from its anchor and image aspect ratio.
- `box_hover`: named face/forehead/top-edge placements for anger marks and other symbols.

Left/right refer to the avatar's anatomy, not screen sides. Hover offsets operate in the resolved head/anchor-local placement space; texture offsets operate in UV/compositor space. Runtime transform rotations are radians. The applicable axes and placement math differ by kind; do not copy numeric values unchanged between them. `placement-transform.ts` shares the texture compositor/guide transform, while anchored pivot/scale placement is resolved in the controller before that transform.

## Composite and masking behavior

Texture effects clone the material per active primitive usage, maintaining one composite canvas/CanvasTexture per active compatible slot. Current slots are `map` and `shadeMultiplyTexture`. Full-surface layers precede anchored decals; later applications of the same kind render above earlier ones. Reapplying the same effect ID replaces that logical instance. Avoid bypassing this controller with a shared original-material mutation.

The controller's **face flatten** prepass samples skin color and paints soft fills before VFX layers. Eye hover enables eye flattening; mouth decals/hover enable mouth flattening. This hides conflicting painted detail and is not another VFX kind or a mesh deformation. Optional `skinBackdrop` on eye/mouth hover generates a skin-colored layer behind the art. Its quality depends on the sample/anchor and original geometry; do not bake one avatar's skin color into a reusable transparent asset to compensate.

Animated texture effects redraw/upload composites on VFX ticks; static segments are cached. Hover animation changes transforms. When diagnosing performance, distinguish texture upload cost from landmark setup or React rendering.

## Use the in-app creator

1. Open `/avatar-effects/new` or the intended existing effect's edit route, select the intended avatar preview, and choose the kind based on how the art should attach.
2. Import the image and configure the target/anchor/side/mirroring. Current creator input is one PNG, JPEG, or WebP. Check actual transparency; a checkerboard painted into an image is not alpha.
3. Use **Guides** to inspect reference anchors versus the solid artwork footprint. The footprint includes transparent padding. Use **UV preview** for the selected live texture slot and **Skin coverage** for flatten/sample regions. Estimated anchors are marked. These controls affect preview only.
4. Tune scale, pivot, offset, rotation, and supported animation. Play/Stop/restart, inspect front and oblique views, and check relevant facial expressions. Resolve definition errors separately from model compatibility warnings: the former block Save; the latter can mean a valid effect lacks a binding on this model.
5. When persistence is requested, use the creator's Save flow and verify reopening. Add it to a Gesture/Reaction through the typed dependency handoff when requested; the action event supplies timing.

Implementation: `src/frontend/web/src/ui/avatar-effect-creator/AvatarEffectCreatorPage.tsx`, `AvatarEffectGuideRenderer.tsx`, `AvatarEffectUvPreview.tsx`, `useAvatarEffectSave.ts` in that directory, and `src/frontend/web/src/lib/avatar/vfx/editor/document.ts`.

The portable definition is `animama/avatar-effect/1`. Its logical image name and optional Sound alias resolve through the exact content revision's file/dependency map. There is no bundled Avatar Effect catalog; Included and Local descriptors are the only sources.

## Cleanup and useful diagnostics

The serializable editor document holds logical metadata/digest, not File objects, Blob URLs, live Avatar objects, or Three.js textures. Preview media and catalog leases have separate owners. `effect-image.ts` shares only pending loads and removes settled promises; completed images belong to active effects. Retaining completed promises by temporary Blob URL pins decoded images after a preview is destroyed.

`AvatarVFXController` restores original material/visibility state and disposes owned composites/planes. Stop/unmount should remove the applicable instances without clearing unrelated effects. For clip-owned effects, preserve their event/instance ownership instead of broadly clearing the canvas.

| Symptom | First boundary to inspect |
| --- | --- |
| Missing effect | Catalog readiness, binding role, compatible slot, image load, snapshot warnings |
| Mirrored or opposite-side art | Anatomical side, `requiresMirror`, model UV layout, anchor basis |
| Correct center but wrong size | Transparent padding, single/span choice, reference rectangle, scale/pivot |
| Washed-out or dark art | Color space, source color multipliers, lit and shade slots, expression/material writer |
| Flicker, hair intersection, visible painted mouth | Plane depth/placement, flatten anchors, backdrop, role visibility |
| Preview works, saved playback fails | Portable definition, logical media alias, exact revision dependency closure, action timing |
| Growth after repeated replacement | Owned canvases/textures/images, settled promises, URL leases, controller disposal |

Source-backed diagnosis is a starting point. Verify the affected model and route before claiming visual compatibility or a fixed resource leak.
