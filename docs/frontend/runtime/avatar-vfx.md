# Avatar VFX Guide

This document explains the avatar VFX system in the Vite web frontend.

Every retained built-in or private Avatar Effect projects through the typed
content catalog used by Gesture/Reaction closure Preview. An Avatar Effect's
associated Sound is a second exact dependency in that closure, so users do not
bind or repair the cue separately.

It covers:

- the VFX types we currently support
- how those effects are resolved and applied at runtime
- when each effect type is the right tool
- the practical authoring constraints behind each mode

For the VRM inspection and debug modal layer around this runtime, see `docs/frontend/runtime/vrm-inspector-editor.md`.

## 1) Main files

- `src/frontend/web/src/lib/avatar/vfx/AvatarVFXController.ts`
- `src/frontend/web/src/lib/avatar/vfx/catalog.ts`
- `src/frontend/web/src/lib/avatar/vfx/types.ts`
- `src/frontend/web/src/lib/avatar/vfx/profiles.ts`
- `src/frontend/web/src/lib/avatar/vfx/AvatarFaceLandmarks.ts`
- `src/frontend/web/src/lib/avatar/vfx/AvatarFaceTextureAnchors.ts`
- `src/frontend/web/src/lib/avatar/vfx/editor/`
- `src/frontend/web/src/ui/avatar-effect-creator/AvatarEffectCreatorPage.tsx`
- `src/frontend/web/src/ui/debug/VRMEditorDebugModal.tsx`

Authoring-template source:

- `src/frontend/web/src/assets/effects/vfx/catalog.json`

The catalog is imported into bundled frontend code through `vfx/catalog.ts`
for creator templates and explicit debug tools. It is application-version
coupled and is not a mounted typed-content source or package member.

Live Anima routes do not query that global catalog by effect ID. Every Included
and Local Avatar Effect descriptor contains its strict portable definition and
registered image file. The mounted `AnimaRuntimeCatalog` consumes those
handler-owned projections, fetches images through revision-scoped authorized
file references, bounds them by media budgets, converts them to owned Blob
URLs, and revokes them when the catalog is disposed. An absent or unknown
runtime ID fails locally without a static/public fallback. Standalone editors
and debug tools may construct the explicitly named authoring provider.

Avatar Effects use the closed `animama/avatar-effect/1` definition. The runtime
rewrites its canonical logical image name and optional local Sound alias
through the exact catalog revision's file and dependency maps before applying
the effect. Avatar Effects are selected as dependencies inside Gestures and
Reactions rather than independently equipped to an Anima.

### Avatar Effect creator

The protected `/a/avatar-effects/new` and
`/a/avatar-effects/:avatarEffectId/edit` routes provide the typed Avatar Effect
creator. The editor follows the same scene-first layout as the Gesture,
Reaction, and Particle Effect creators: one route-owned portrait Canvas docks
beside the expanded desktop sidebar and returns to full viewport width beneath
the compact controls. Effect Setup, Inspector, camera controls, and the compact
Preview bar float above it using the remaining local safe inset. On a narrow
viewport those controls return to normal document flow without mounting a
second Canvas.

The author chooses the effect kind first:

- **Hover** places eye, mouth, or face-box art on live face landmarks.
- **Face decal** anchors a single or spanning image to under-eye, blush, or
  mouth UV landmarks.
- **Texture** overlays or replaces a classified live VRM material role.

The creator accepts exactly one PNG, JPEG, or WebP image. Its serializable
editor document stores only logical metadata and a digest; the browser-owned
`File`, preview Blob URL, upload capability, and live `Avatar`/Three objects
stay outside that document. The Blob URL is revoked whenever its image is
replaced or the route unmounts.

An optional Sound Effect is stored as an exact typed dependency source. The
portable definition refers to the root-local alias, so the runtime can rewrite
it through the validated dependency map. Reopening an owned Avatar Effect
hydrates the current Local descriptor, exact Sound source, and authorized image
bytes into a new editor session. Save validates through the Avatar Effect
handler and directly replaces the editable Local entry through
`PUT /v1/avatar-effects/{entry_name}`; it creates no draft release or finalize
step. Browser recovery remains authoring state only and is cleared after the
direct Save succeeds.

The live preview calls the production `AvatarVFXController` against the
selected Anima's exact Avatar model. Diagnostics distinguish a malformed
definition (blocks Save) from a model-specific missing binding or landmark
(warning only). Play, stop, restart, duration, camera framing, placement guides,
keyboard shortcuts, and reduced-motion behavior are preview-only and never
change the portable document unless their corresponding authoring field changes.

The common Library previews Local and Included Avatar Effects through the typed
preview route and links owned rows back to the stable edit route. After a ready
Local item exists, the creator offers optional Gesture and Reaction handoffs
containing only the stable catalog item ID and `avatar_effect` token. The
action creator then resolves its current exact catalog revision.

## 2) High-level model

The runtime models VFX as a discriminated catalog union:

1. `texture`
2. `face_anchored`
3. `hover`

Rendering still happens through the same two surfaces:

1. `texture`
2. `hover_plane`

At a high level:

- `texture` effects stay attached to existing UVs on the avatar mesh
- `hover_plane` effects are separate planes placed in front of the face

This is all owned by `AvatarVFXController`, which is created by `Avatar` after a VRM loads successfully.

## 3) Runtime flow

The VFX flow is:

1. `Avatar` loads the VRM and creates:
   - `AvatarFaceLandmarks`
   - `AvatarFaceTextureAnchors`
   - `AvatarVFXController`
2. `AvatarVFXController` scans live primitive bindings from the rendered avatar scene.
3. Material-name heuristics and per-model profile rules classify bindings into roles such as:
   - `face_skin`
   - `eye_iris`
   - `eyeline`
   - `eyelash`
4. The mounted provider resolves the entry. Built-ins are immediate; private
   entries are loaded asynchronously and stale results are discarded.
5. The resolved entry is applied through one of the controller's kind-specific APIs:
   - `applyTextureVFX(...)`
   - `applyFaceAnchoredVFX(...)`
   - `applyHoverVFX(...)`
6. The controller either:
   - contributes texture-backed layers to a binding-level composite texture
   - or creates head-attached hover planes
7. Active effects are animated at the controller's VFX tick rate when their `animationConfig` enables pulse, spin, or drift.

A binding can hold multiple active effects at once.

In practice that means:

- multiple `texture` and `face_anchored` effects can stack on the same binding
- multiple `hover` effects can coexist on the same binding
- reapplying the same `effectId` replaces that logical effect instance rather than duplicating it

The key design choice is that effects are applied to live primitive usages, not to abstract material definitions in isolation.

### Face flatten prepass

The VFX controller also owns a face-flatten system for the resolved `face_skin` binding.

This is not a separate catalog VFX kind. It is a controller-generated texture prepass used to neutralize painted facial detail that would otherwise conflict with 2D VFX, especially:

- painted eye shading under `eye_hover`
- painted mouth detail under mouth decals
- painted mouth detail under `mouth_hover`

The flatten pass is driven by `AvatarFaceTextureAnchors`, which resolves dedicated UV regions for:

- `flatten.sample.center`
- `flatten.eyes.left`
- `flatten.eyes.right`
- `flatten.mouth.center`

At runtime the controller:

1. resolves the correct live `face_skin` binding
2. samples an average face-skin color from the central sample patch
3. keeps that sampled color in the VFX snapshot's `flatten` state
4. draws soft elliptical fills into the face-skin composite before normal face-skin VFX layers are drawn

Current auto-activation rules are:

- eyes flatten while any `eye_hover` effect is active
- mouth flatten while any mouth `face_anchored` decal is active
- mouth flatten while any `mouth_hover` effect is active

The debug/editor layer can also enable eye or mouth flatten explicitly through `setFaceFlattenPreview({ previewEyes, previewMouth })`.

Current implementation detail:

- flattening is applied through the face binding's composite texture path, not by editing the source VRM asset
- when both `map` and `shadeMultiplyTexture` are available on the face binding, the controller samples and flattens per slot
- hover `skinBackdrop` uses the same sampled face color source as this flatten system

## 4) VFX type 1: Anchored `face_skin` texture decals

This is the mode for:

- blush
- under-eye effects
- mouth decals

These are `kind: "face_anchored"` entries.

### How they work

`AvatarFaceTextureAnchors` computes a small set of cached face anchors at avatar load:

- `undereye.left`
- `undereye.right`
- `blush.left`
- `blush.right`
- `mouth.center`

Those anchors are derived from 3D face landmarks and then projected onto the exact `face_skin` primitive to get UV coordinates.

So the runtime does not guess placement from the face texture image alone. Instead it:

1. finds a semantic 3D point on the face
2. projects that point onto the `face_skin` mesh
3. interpolates the UV at that point
4. caches that UV for later use

### Important property

These anchors determine placement, not clipping.

That means:

- a tear asset can start under the eye and continue well below it
- a mouth asset can be centered on the mouth anchor and extend outward

The anchor box is only a placement basis for pivoting, offsets, and default scale.

### Best use cases

Use anchored decals when the effect should look painted onto the face surface, but should not be stretched across the whole face texture.

Good examples:

- blush
- under-eye shadows
- mouth symbols
- small cheek decals

When the anchor is `mouth`, the controller also contributes to the automatic mouth flatten flow described above so the painted base mouth can be neutralized before the decal stack renders.

### Main config fields

- `anchor`: `undereye` | `blush` | `mouth`
- `layout`: `single` | `span` for bilateral anchors
- `pivot`
- `side`
- `requiresMirror`
- `transform.offset`
- `transform.scale`

### `single` vs `span`

- `single` means one side-specific decal, optionally mirrored to the other side
- `span` means one combined decal stretched once across both bilateral anchors

In practice:

- `single` is usually the better fit for authored left/right blush or under-eye assets
- `span` is only appropriate for one wide image that is meant to cover both sides together

## 5) VFX type 2: Full-surface `texture` effects

The on-mesh texture path uses `kind: "texture"` entries.

It is still the right choice for effects that should use the full texture dimensions of an existing surface.

Typical targets:

- `face_skin`
- `eye_iris`

Typical examples:

- full-face sick/sweat overlays
- full-face tinted overlays
- iris replacements like stars or stylized pupils

### How they work

For texture-backed effects, the controller composites all effects at the binding level:

1. clone the runtime material for the chosen primitive usage once
2. resolve one or more placement rects for the effect inside each compatible slot
3. store that effect as one active layer on the binding
4. redraw one composite canvas per active slot
5. assign one composite `CanvasTexture` per slot back to the cloned material

This is the main architectural change behind stacked VFX support.

The material still only sees one final texture per slot, but that final texture can represent a stack of active effects.

The controller currently targets these slots:

- `map`
- `shadeMultiplyTexture`

For stacked texture-backed effects, layer order is:

1. full-surface `texture` effects
2. anchored `face_anchored` decals
3. within the same kind, later applies render above earlier applies

The current implementation uses one logical active instance per `effectId`, so applying the same `effectId` again replaces the existing one.

`AnimaPoseClip` playback can apply avatar VFX through timed clip events. The
clip event stores the avatar VFX catalog `effectId`; `PoseController` schedules
the event, and the runtime adapter applies it through the existing
`AvatarVFXController`. Clip-owned applied ids are namespaced by clip/event
context so cleanup can remove only the effects started by that clip. Baked pose
clip export keeps avatar VFX events as catalog references rather than embedding
VFX definitions.

### `overlay` vs `replace`

- `overlay` preserves the original texture and composites the VFX on top
- `replace` draws only the effect result into the runtime texture slot

### Best use cases

Use this mode when the effect should stay fully UV-bound to the original mesh surface.

Good examples:

- iris replacement
- full-face overlays
- texture-bound animated face filters

### When not to use it

Do not use the full-face texture path for small localized cheek or mouth decals unless the asset is intentionally authored to that full-face atlas layout.

If the effect is conceptually local, anchored decals are a better fit.

## 6) VFX type 3: `hover_plane`

This mode creates actual planes in front of the face rather than painting into the existing UV map, and is represented by `kind: "hover"` entries.

It supports three placement kinds:

1. `eye_hover`
2. `mouth_hover`
3. `box_hover`

Note: "plane hover" is informal shorthand for the `hover_plane` render mode. The current hover subtypes are `eye_hover`, `mouth_hover`, and `box_hover`.

### 6.1) `eye_hover`

This mode exists because the `face_skin` primitive usually does not contain usable eye geometry.

So for some eye effects, painting onto `face_skin` is the wrong tool.

Instead:

- the runtime resolves iris landmarks from the `eye_iris` primitive
- it builds a face-aligned placement slightly in front of the iris
- it attaches a small transparent plane there

While an `eye_hover` effect is active, the face flatten system also neutralizes painted eye shading on the resolved `face_skin` binding. This helps stylized 2D eye art sit more cleanly over face textures that already contain eye-region shading but no usable eye geometry.

This is the current workaround for eye effects that should visually sit over the eye area but cannot be expressed through the face mesh texture path.

Good examples:

- special closed-eye art
- stylized eye plates
- eye overlays that need to hover slightly above the eye

### 6.2) `mouth_hover`

This mode uses the resolved mouth anchor from `AvatarFaceTextureAnchors`.

Instead of painting into the `face_skin` UV map, the runtime:

- resolves the cached mouth anchor on the face skin binding
- starts from that projected mouth surface point
- moves slightly outward toward the face front plane instead of snapping to the box-hover plane
- sizes that plane from the mouth anchor's reference size while preserving the asset's aspect ratio

This is the hover-plane equivalent of a mouth decal.

It is useful when the effect should sit over the mouth area, but should not be painted directly into the face texture.

When a `mouth_hover` effect is active, the runtime also enables mouth flattening on the resolved `face_skin` binding so the authored mouth texture underneath is neutralized before the hover art renders above it.

`eye_hover` and `mouth_hover` entries can also opt into a runtime-generated `skinBackdrop`.

When enabled:

- the controller reuses the sampled face-skin color from the flatten system
- generates a soft elliptical backdrop at apply time
- renders that backdrop as a second hover-plane layer behind the foreground art
- uses a trimmed face-style material clone rather than a plain `MeshBasicMaterial`, so it follows the same `map` / `shadeMultiplyTexture` path while stripping normal, matcap, emissive, and similar face-only extras from the backdrop clone

This is useful for stylized 2D hover effects that should mask some of the underlying 3D facial geometry without baking avatar-specific color into the PNG asset.

Good examples:

- stylized closed-mouth symbols
- mouth overlays that should float just above the face
- mouth art that conflicts with the painted mouth in the base face texture

### 6.3) `box_hover`

This mode uses a face bounding box and named positions derived from `AvatarFaceLandmarks`.

Supported positions include:

- `forehead-left`
- `forehead-middle`
- `forehead-right`
- `top-left`
- `top-middle`
- `top-right`
- `top-edge-left-corner`
- `top-edge-left`
- `top-edge-middle`
- `top-edge-right`
- `top-edge-right-corner`

These positions are resolved in head-local space and then used to place a face-attached plane.

Good examples:

- anime anger mark
- exclamation mark
- forehead icons
- symbols that should float around the top of the face rather than sit on the skin

## 7) Animation model

Both `texture` and `hover_plane` effects can use the same animation config system.

Current supported channels are:

- pulse
- spin
- drift

The controller resolves animation from `animationConfig`, not from a shader-specific system.

That means:

- texture effects animate through draw-time transforms on their resolved placement rects
- hover planes animate through local transform changes on the plane group

Texture animation uses placement-local draw transforms:

- eye and face placements are resolved once when the effect is applied
- pulse/spin/drift are evaluated against those placements
- the animated draw happens around each placement's own local center

Placement-local transforms keep localized iris effects centered within their
regions of the atlas.

The controller also throttles VFX animation updates to 30 FPS.

In practice:

- hover transforms update on that VFX tick
- animated texture composites redraw on that VFX tick
- avatar skeletal animation and the main render loop can still run faster than that

Common fields include:

- `pulseScaleMin`
- `pulseScaleMax`
- `pulseCyclesPerSecond`
- `rotationAmountTurns`
- `rotationRadiansPerSecond`
- `rotationDirection`
- `driftPerSecond`

## 8) Transform model

Each `AvatarVFXCatalogEntry` has a `transform` object with:

- `offset`
- `scale`
- `rotation`

Each of those currently has `x`, `y`, and `z`.

Current practical usage:

- `texture`
  - `offset.x/y` shift the effect in UV space
  - `scale.x/y` change the effect rect size
- `hover_plane`
  - `offset.x/y/z` move the plane in head-local space
  - `scale.x/y` change the plane size

Not every axis is equally meaningful for every render mode.

## 9) Choosing the right mode

### Use anchored `face_skin` texture decals when:

- the effect should look printed onto the face
- the placement is local, not full-face
- the target is blush, under-eye, or mouth-adjacent

### Use full-surface `texture` effects when:

- the asset is authored against the full eye or face texture dimensions
- the effect should remain fully UV-bound to the mesh
- the effect is a full-face overlay or iris replacement

### Use `hover_plane` when:

- the effect should float in front of the face
- the effect should sit above the forehead or above the eyes
- the face texture path cannot represent the effect cleanly

## 10) Asset authoring guidance

### Anchored decals

Prefer small, local assets.

In practice, a single-sided asset is the cleanest format for:

- blush
- under-eye decals
- tears

Recommended convention:

- author the asset for one side
- set `side`
- use `requiresMirror` if the opposite side should be a mirrored copy

### Full-surface texture effects

Use these when the asset is intentionally authored against the original UV layout.

Examples:

- full-face overlays
- iris replacements

### Hover planes

Use transparent PNGs designed to read as floating art.

Examples:

- forehead symbols
- eye plates
- exclamation marks

## 11) Performance profile

The runtime still keeps several expensive operations one-time:

- face landmarks are resolved once at avatar load
- face texture anchors are resolved once at avatar load
- texture and hover placements are resolved once at effect application
- material cloning happens once per active composite binding

Each VFX tick performs this work:

- hover effects update local transforms
- animated texture effects redraw the binding's composite texture
- the resulting composite `CanvasTexture` is marked dirty and re-uploaded
- face flattening only forces a composite rebuild when its state changes, not on every frame by itself

The controller caches the static parts of the texture stack:

- original base texture content for `overlay`
- face flatten fills for eye and mouth regions
- all non-animated texture-backed layers
- static segments between animated layers

On an animation tick, the controller composites those cached static segments with the current animated layers instead of rebuilding the full static stack every render frame.

Animated texture effects require canvas redraw and texture upload on animation
ticks; account for that work when measuring VFX performance.

There is no per-frame face landmark solve in the normal path.

## 12) Current limitations

- target matching is still heuristic-first unless a per-model profile override exists
- anchored decal quality still depends on the quality of the cached anchors
- `face_skin` usually does not include usable eye geometry
- full-face overlay artwork may fit poorly when used as an anchored decal
- `span` decals are easy to misuse if the art was not authored as one wide bilateral image
- animated texture effects are still more expensive than hover effects because the final composite texture must be refreshed on animation ticks
- texture slot targeting is still broad; the current runtime considers both `map` and `shadeMultiplyTexture` when they exist
- flatten quality depends on both anchor quality and the sampled face-skin region; if those are poor, the neutralized area can still look off

The important takeaway is:

- if the effect is local and skin-bound, use anchored decals
- if the effect is full-texture UV-bound, use the texture path
- if the effect should float in front of the face, use `hover_plane`
