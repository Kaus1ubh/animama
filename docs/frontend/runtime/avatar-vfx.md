# Avatar VFX Guide

Every retained built-in or private Avatar Effect projects through the typed
content catalog used by Gesture/Reaction closure Preview. An Avatar Effect's
associated Sound is a second exact dependency in that closure, so users do not
bind or repair the cue separately.

See [VRM inspection](vrm-inspector-editor.md) for debug session ownership.

## 1) Main files

- `src/frontend/web/src/lib/avatar/vfx/AvatarVFXController.ts`
- `src/frontend/web/src/lib/avatar/vfx/AvatarAttachmentEffects.ts` and
  `silhouetteOverlay.ts` (body, sticker and silhouette effects)
- `src/frontend/web/src/lib/avatar/humanoidAnchors.ts` (body points shared
  with Particle Effects)
- `src/frontend/web/src/lib/avatar/vfx/definition.ts`
- `src/frontend/web/src/lib/avatar/vfx/types.ts`
- `src/frontend/web/src/lib/avatar/vfx/faceParts.ts`
- `src/frontend/web/src/lib/avatar/vfx/profiles.ts`
- `src/frontend/web/src/lib/avatar/vfx/AvatarFaceLandmarks.ts`
- `src/frontend/web/src/lib/avatar/vfx/AvatarFaceTextureAnchors.ts`
- `src/frontend/web/src/lib/avatar/vfx/editor/`
- `src/frontend/web/src/ui/avatar-effect-creator/AvatarEffectCreatorPage.tsx`
- `src/frontend/web/src/ui/debug/VRMEditorDebugModal.tsx`

There is no bundled Avatar Effect catalog. Every Included
and Local Avatar Effect descriptor contains its strict portable definition and
registered image file. The mounted `AnimaRuntimeCatalog` consumes those
handler-owned projections, fetches images through revision-scoped authorized
file references, bounds them by media budgets, converts them to owned Blob
URLs, and revokes them when the catalog is disposed. An absent or unknown
runtime ID fails locally without a static/public fallback. A `runtime_catalog`
Avatar Effect source cannot resolve and records the
`avatar_vfx_source_unsupported` runtime-catalog diagnostic.

Avatar Effects use the closed `animama/avatar-effect/2` definition. Its one
source is the strict Pydantic contract in
`src/backend/animama/app/contracts/avatar_effect.py`; OpenAPI carries it to the
generated TypeScript type and `zAvatarEffectDefinitionV2` validator, which
`parseAvatarEffectDefinition` (`lib/avatar/vfx/definition.ts`) uses before
normalizing into the controller's internal entries. Backend Save, typed
preview, loadout and package import/export validate with the same models and
report a JSON path such as `definition.attachment.offset.x`.

A `/2` definition describes:

- **`attachment`**, discriminated by `kind`: `face_surface` (painted on a face
  part; `full`/`eyes` areas use the part's texture layout, `undereye`/`blush`/
  `mouth` place a decal on `face_skin`), `face_landmark` (a plane at the eyes,
  mouth, forehead, top or top edge, with a free offset in metres), and `body`,
  `sticker` and `silhouette` (see [Attachments beyond the
  face](#attachments-beyond-the-face)). Rotations are degrees. A mirrored eye
  placement mirrors its horizontal offset.
- **`art`**: `image`, an optional `otherEyeImage` that the mirrored eye or side
  draws unmirrored, and an optional `flipbook` grid (`columns`, `rows`,
  `frames`, `fps`, `loop`: `loop`/`once`/`pingpong`).
- **`appearance`**: `opacity`, an optional `#rrggbb` `tint` and `blend`
  (`normal`, `additive`, `multiply`). A `replace` texture below full opacity
  shows the original slot beneath it.
- **`motion`**: the `pulse`, `spin` and `drift` presets (a preset is enabled
  when present) plus optional `keyframes` (`t` in seconds; `opacity`, `scale`,
  `rotationDeg`, `offset`) on the effect's own timeline. Keyframe scale and
  opacity multiply the presets; rotation and offset add.
- **`faceOptions`** where they apply (eye landmark: `forceBlink`,
  `hideEyeDetails`, `faceCleanup`, `skinBackdrop`, `hideParts`; mouth landmark:
  `faceCleanup`, `skinBackdrop`; mouth decal: `faceCleanup`; texture:
  `hideParts`), plus `region` and an optional `soundAlias`.

The runtime rewrites the logical image names and optional local Sound alias
through the exact catalog revision's file and dependency maps before applying
the effect. Avatar Effects are selected as dependencies inside Gestures and
Reactions rather than independently equipped to an Anima.

Untrusted images and definitions are bounded before decoding or GPU upload:
16 MiB and at most 4096 px per side (16.7 M pixels) per image, checked from the
PNG, JPEG or WebP header before an object URL is created and again from the
decoded size; definitions at most 64 KiB; flipbooks at most 16 × 16 cells and
256 frames; at most 64 keyframes. Stored effect images are not resized (the backend
admits up to 16384 px per side), so the creator refuses an oversized image when
it is chosen, and an imported or hand-placed Local image over the limit fails
closed when it loads: the effect is skipped with a diagnostic.

`/1` definitions are no longer accepted. Local `/1` effects convert in place
(keeping their folder, content ID and files, with the originals retained in the
transition journal) at startup, on `POST /v1/content:rescan`, or with
`uv run python -m animama.server.content_cli`. A descriptor folder outside the
Local library, such as Included content, converts with
`uv run python scripts/content/convert_avatar_effects.py --write <folder>`
(a dry run without `--write`). Content packages cannot be converted: their
manifest, sizes and digests cover the original bytes. Import refuses a `/1`
package and asks for the source content to be converted and exported again.
Anything else still `/1` is refused with `avatar_effect_conversion_required`
and a hint, and the API lists it with `definition: null` and
`definition_error`.

A Local `/1` eye effect with a mirrored placement and a nonzero
`transform.offset.x` now mirrors that offset on the other eye; `/1` shifted
both eyes the same way. The Local transition logs an
`avatar_effect_offset_mirrored` warning naming such effects, and the conversion
script prints a note (no Included effect has an x offset).

An event's fade belongs to the Gesture or Reaction: for an `avatar_vfx` event
with an End of "After", the inspector's **Fade in** and **Fade out** write
`envelope.intensity`. Both clip players sample it each frame and pass it to
`AvatarVFXController.setEffectIntensity`, which multiplies opacity (a value that
arrives while the effect is still loading is held until it applies). Events
that end with their Action do not fade.

### Avatar Effect creator

The protected `/avatar-effects/new` and
`/avatar-effects/:avatarEffectId/edit` routes provide the typed Avatar Effect
creator with an isolated portrait preview. The Effects template picker offers
every Included Avatar Effect as a template, grouped by intent in
`lib/effects/effectTemplates.ts`. `/avatar-effects/new?template=<id>` copies the
Included effect into a new, unsaved Local draft with an unused name; Save
creates a separate Local item and never changes the Included one.

The author chooses the effect kind first:

- **Hover** places eye, mouth, or face-box art on live face landmarks.
- **Face decal** anchors a single or spanning image to under-eye, blush, or
  mouth UV landmarks.
- **Texture** overlays or replaces a classified live VRM material role.

Each type exposes **Effect region**, which controls replacement rather than
placement. Regions `eyes`, `undereye`, `blush`, and `mouth` replace earlier effects
in that region; `emote` and `full_face` allow different instances to coexist.
**Automatic** follows changes to type, subtype, decal anchor, or texture target.
Choosing a region manually preserves it across those changes. New effects default
to Automatic; existing definitions and older editor documents preserve their
region as a manual choice. The editor stores this choice in `regionMode`; runtime
definitions always contain the resolved region.

Until the editor redesign, the creator keeps its `/1`-shaped editor document
and saves and reopens `/2` through a temporary adapter
(`lib/avatar/vfx/editor/legacyDefinitionAdapter.ts`). It refuses to reopen an
effect that uses appearance, other-eye, flipbook or keyframe settings, which it
could not keep.

Eye hover exposes **Force blink**, **Hide eye details**, **Clean up eye area**,
and **Additional hidden materials**. Mouth hover and mouth decals expose **Clean
up mouth area**. Texture exposes **Hidden materials**. These settings persist in
the definition and editor document. The blink, automatic eye-detail hiding, and
facial cleanup flags default to enabled when omitted by older content. Explicit
hidden-material roles are additive to automatic eye-detail hiding; turning off
Hide eye details does not clear those selections. **Skin backdrop** controls a
separate hover backing plane and does not enable or disable facial cleanup.

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
step. Browser recovery remains authoring state only. It keeps unsaved changes
across reloads and interrupted work, and is cleared after a successful Save or
explicit discard.
Discarding never changes the saved Library item.

The live preview calls the production `AvatarVFXController` against the
selected Anima's exact Avatar model. Diagnostics distinguish a malformed
definition (blocks Save) from a model-specific missing binding or landmark
(warning only). Play, stop, restart, camera framing, and placement guides are
preview controls. Transform and animation settings define the reusable effect;
its Gesture or Reaction event owns Start and End (with the Action, or after a
specified duration). Selecting an event exposes these settings in the Action
inspector; Reactions place that inspector above Expressions.

The common Library previews Local and Included Avatar Effects through the typed
preview route and links owned rows back to the stable edit route. After a ready
Local item exists, the creator offers optional Gesture and Reaction handoffs
containing only the stable catalog item ID and `avatar_effect` token. The
action creator then resolves its current exact catalog revision.

### Placement guides

The creator's **Guides** toggle follows the selected effect and Avatar. Open
circles and faint reference lines mark the placement basis; solid pink outlines
show the current image rectangle, including transparent padding. Left and right
refer to the Avatar's sides. Eye/mouth hover guides follow their anchors; face-box
hover also shows the face bounds and selected placement. Decals show only the
selected under-eye, blush or mouth anchors. Estimated anchors are labeled.

The **UV preview** icon opens the selected material's live texture and effect
footprint independently of the Guides toggle.
Choose a material/texture slot when more than one applies. Dashed reference boxes
are placement bases, not clipping boundaries; the solid artwork outline includes
pivot, offset, scale, rotation and animation. **Skin coverage** reveals relevant
flattening regions and the sampled skin patch. Guides and UV controls affect only
the preview, never the saved effect. Stopped effects retain available reference
markers but have no live artwork outline.

### Attachments beyond the face

Body, sticker and silhouette effects need no face part. They follow the avatar
through Gestures, Reactions and idle motion, and `AvatarVFXController`
delegates them to `AvatarAttachmentEffects` (`applyAttachmentVFX`).

- **`body`**: a plane on a humanoid body point (`root`, `hips`, `spine`,
  `chest`, `neck`, `head`, hands or feet), parented to the normalized bone.
  `resolveHumanoidAnchorObject` resolves the point with the same fallback
  chain as Particle Effect anchors (for example `chest` → `upperChest` →
  `spine` → `hips`). `offset` is in metres in the bone's frame (+x toward the
  viewer's right when facing the avatar, +y up, +z forward, on VRM 0 and 1),
  `size` is the plane height in metres and `rotationDeg` turns it in its own
  plane. It faces the camera (`facing: "camera"`, oriented per render for each
  camera) or keeps the bone's orientation (`facing: "bone"`).
- **`sticker`**: a camera-facing image beside the head (`around: "head"`) or
  the body centre (between the hips and head bones). `size` (plane height) and
  `offset` (in the screen plane) are fractions of the avatar's height, measured
  once from its bind-pose bounds at load, so stickers keep a readable size on
  any model and scale with the avatar. Stickers ignore depth (render order
  960), so the avatar never hides them.
- **`silhouette`**: art drawn only over the avatar's visible pixels. Each
  depth-writing primitive gets an overlay mesh that shares its geometry,
  skeleton and live `morphTargetInfluences`, as a child with an identity
  transform. For cutout or blended primitives the overlay reuses the
  primitive's original base-map alpha (never a face effect's composite
  texture); opaque primitives ignore map alpha, as their own shader does. It uses
  `LessEqual` depth with a one-unit polygon offset (render order 940), and
  changes no avatar material or canvas option. MToon outlines and transparent
  layers that write no depth (irises, highlights, brows, eye lines, lashes) get
  no overlay; the skin and eye whites beneath already cover them. `fill:
  "pattern"` tiles the art in screen space, anchored at the hips: at
  `patternScale` 1 a tile is a quarter of the avatar's on-screen height, so
  tileable art works best. `fill: "tint"` fills with the art's alpha-weighted
  average colour. `scroll` moves the pattern in tiles per second, and the
  motion presets move, turn and scale it.

Appearance, flipbooks, keyframes and event fades apply to all three; keyframe
offsets use each attachment's offset units. Face effects on the same region
still replace each other, but attachments coexist with face effects and with
each other: at most four (`MAX_ACTIVE_ATTACHMENT_EFFECTS`) are active, and
applying a fifth removes the oldest, logging
`avatar_effect_attachment_limit` and adding a snapshot warning. They appear in
the snapshot's `attachmentEffects` and the observation snapshot, survive a face
part correction, and are disposed by `removeEffect`, `clearAllEffects`, clip
cleanup and `presentation.disable_vfx`. The creator cannot edit them yet.

## 2) High-level model

`parseAvatarEffectDefinition` maps each `/2` face attachment to one internal
render entry; sections 4–8 use these internal names (`face_landmark` eyes,
mouth and forehead/top/top-edge become `hover` `eye_hover`, `mouth_hover` and
`box_hover`; `face_surface` decal areas become `face_anchored`; `full` and
`eyes` areas become `texture`). The runtime models VFX as a discriminated
catalog union:

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

1. `Avatar` loads the VRM, detects its face parts (`vfx/faceParts.ts`) and creates:
    - `AvatarFaceLandmarks`
    - `AvatarFaceTextureAnchors`
    - `AvatarVFXController`
2. `AvatarVFXController` scans live primitive bindings from the rendered avatar scene.
3. The face part map classifies bindings into roles such as:
    - `face_skin`
    - `eye_iris` (the `eye_left`/`eye_right` parts)
    - `eye_highlight`
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

### Face parts

`detectAvatarFaceParts` reads VRM signals, not material names:

- **Eyes:** primitives skinned mostly to the humanoid `leftEye`/`rightEye`
  bones (or whose material a look-at expression moves with a texture
  transform). Iris, white and highlight are separated by projected area and
  depth, per eye when each eye has its own primitives; one primitive may hold
  both eyes.
- **Face skin:** the head-skinned primitive of the mesh that `blink` and `aa`
  morph with the most area around the eyes.
- **Eye lines and eyelashes:** small primitives of that mesh that `blink` moves
  almost entirely; the larger is the eye line.
- **Hair** (box-hover clearance): primitives under the head with a real share
  of spring-joint skin weight.

Material and node names are a per-role fallback; if detection itself fails,
the Avatar still loads and uses name matching throughout. Each part reports
`node:mesh:primitive` bindings, a source (`signals`, `names`, `corrected` or
`missing`) and a confidence. A saved `animama/avatar-face-parts/1` correction
replaces detected roles when its `vrm_sha256` matches the loaded file;
otherwise it is ignored with a diagnostic. The chat canvas passes the
Avatar's correction from the runtime snapshot to `Avatar.load`;
`Avatar.setFacePartCorrections` rebuilds the parts, landmarks, anchors and
bindings and re-applies active effects.

An effect whose required part is missing (face skin for every face effect, the
covered eye for an eye hover, the target part for a texture) is not applied.
The controller logs one structured `avatar_effect_face_part_unavailable`
warning per effect and part and lists it in its snapshot warnings, which the
VRM debug panel shows; a Gesture or Reaction continues without the effect.

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

Auto-activation requires an active effect with `faceCleanup !== false`:

- `eye_hover` requests eye flattening
- mouth `face_anchored` decals and `mouth_hover` request mouth flattening

Disabling cleanup on one effect does not cancel another active effect's request.
Omitting `faceCleanup` preserves automatic cleanup for existing content.

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

Mouth decals activate mouth flattening before the decal stack renders unless
`faceCleanup` is `false`.

### Main config fields

- `anchor`: `undereye` | `blush` | `mouth`
- `layout`: `single` | `span` for bilateral anchors
- `pivot`
- `side`
- `requiresMirror`
- `faceCleanup`: optional mouth cleanup flag, defaults to enabled
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

Texture effects can also specify `disableTargetRoles` to hide recognized material
bindings for the duration of the effect, independently of Overlay/Replace. The
creator's Hidden materials selections round-trip this list; it is not restricted
to eye highlights. Suppression skips the effect's source binding and depends on
the model's material classification.

Use full-surface textures only when the artwork matches the original UV layout.
Localized cheek or mouth art uses anchored decals.

## 6) VFX type 3: `hover_plane`

This mode creates actual planes in front of the face rather than painting into the existing UV map, and is represented by `kind: "hover"` entries.

It supports three placement kinds:

1. `eye_hover`
2. `mouth_hover`
3. `box_hover`

### 6.1) `eye_hover`

This mode exists because the `face_skin` primitive usually does not contain usable eye geometry.

So for some eye effects, painting onto `face_skin` is the wrong tool.

Instead:

- the runtime resolves iris landmarks from the `eye_iris` primitive
- it builds a face-aligned placement slightly in front of the iris
- it attaches a small transparent plane there

Eye hover has three independent flags, all enabled when omitted:

- `forceBlink` holds the blink expression at 1 while an enabled effect is active.
- `autoDisableEyeMaterials` hides `eye_highlight`, `eyeline`, and `eyelash` bindings.
- `faceCleanup` neutralizes painted eye shading on the resolved `face_skin`
  binding through the face-flatten pass.

`disableTargetRoles` adds explicit hidden roles to the automatic set. Disabling
automatic hiding leaves those explicit roles in effect. These options let art
replace the eyes or sit over the existing eyes without requiring a different
rendering kind. Material suppression follows classified bindings rather than
being limited to the effect's left/right placement.

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

A `mouth_hover` effect enables mouth flattening on the resolved `face_skin`
binding by default, neutralizing the painted mouth before the hover art renders.
Set `faceCleanup: false` to preserve that painted detail.

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
- keyframes (opacity, scale, rotation, offset)
- flipbook frames

The controller resolves animation from `animationConfig`, the entry's
`keyframes` and `flipbook`, not from a shader-specific system. Hover flipbooks
move texture `repeat`/`offset` (no re-upload) and size the plane from one frame;
composite flipbooks draw one frame through a source rectangle.

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
- `rotationRadiansPerSecond` (the `/2` definition stores `degreesPerSecond`)
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

| Mode           | Use                                    | Asset guidance                                                            |
| -------------- | -------------------------------------- | ------------------------------------------------------------------------- |
| Anchored decal | Local art painted onto the face        | Author one side; use `side` and `requiresMirror` for bilateral placement. |
| Texture        | Full-face overlays or iris replacement | Match the original UV layout.                                             |
| Hover plane    | Art floating in front of the face      | Use transparent images framed around the intended landmark.               |

## 10) Headless review renders

From `src/frontend/web`, `pnpm -s effects:render` renders effects on both
Included Avatars without a running stack (headless Chromium with SwiftShader):

```bash
pnpm -s effects:render library:eye_vv_pair --out /tmp/eye_vv_pair.png
pnpm -s effects:render --all-included --out /tmp/effect-sheets
pnpm -s effects:render ./my-effect --thumbnail /tmp/my-effect.webp
pnpm -s effects:render --diff before.png after.png --out diff.png
```

- A source is an effect folder, a descriptor `.json`, or
  `library:[included/|local/]<stem|content_id|name>`. `library:local/…` needs
  `--local-content <content root>`, such as `content/local`.
- Each sheet row is a time after applying (`--times`, default 0.1, 0.5, 1 and
  2 s). Each Avatar gets front, ¾ (from its right) and face tiles (`--views`,
  `--tile`). `--expression <name>` holds a VRM expression, and `--with-clip`
  samples an Anima Pose Clip Gesture (body and expressions only, no clip
  events) at the same times.
- The page mounts real `Avatar`s with the chat canvas settings (ACES Filmic,
  sRGB, default scene lights, transparent clear over a grey tile). It applies
  the effect through the runtime parser and `applyAvatarVFXEffectById`, then
  steps fixed 60 Hz frames with automatic animation off. Renders are
  deterministic, so the same source and revision should diff to 0 pixels.
- The run exits 1 when the controller reports a warning or no active effect.
- `--together` applies every source at once on one sheet (`<a+b+c>.png`),
  for example a body effect, a sticker and a silhouette with `--with-clip
  library:soldier-salute` to check that they follow the avatar.
- `--thumbnail` renders Annie with the portrait capture's head framing and
  lighting, keeping the effect's live expression state (no forced smile).
- `pnpm -s effects:thumbnails [template-id...]` regenerates the template
  picker's thumbnails (320 px WebP, 1 s after applying) with the same renderer,
  into `src/assets/effect-templates/`, and removes files for templates that no
  longer exist. Run it after changing the template list or an Included effect it
  uses, review the images and keep that folder's README provenance current.
- `--diff` counts a pixel as different when a channel changes by more than
  `--threshold` (default 8 of 255). It reports the share of such pixels and
  the largest channel change, and writes a red-on-grey diff image.

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

Attachments add little per frame: camera-facing planes and stickers compose
one matrix per render, and a silhouette adds one skinned draw per overlaid
primitive (about 11–13 on the Included Avatars) with a simple fragment shader.

`pnpm -s effects:bench` (from `src/frontend/web`) measures the frame cost on
the development machine's GPU. It plays a looping Gesture through
`Avatar.update` on a chat-equivalent canvas (800 × 600 at DPR 2,
antialiasing, ACES) and times `avatar.update` + `render` on the CPU and the
render on the GPU (`EXT_disjoint_timer_query_webgl2`) over 600 frames per
scenario, per Included Avatar, with no effects and with the heavy combination
(an animated full-face texture, an animated eye hover, a body effect and a
silhouette). The scenarios alternate over `--rounds` passes (default 2, each
after a 120-frame warm-up) so drift favours neither, and GPU samples voided by
a disjoint event are dropped and counted. The budget is a mean added frame time of at
most 2 ms. Chromium runs headless with Metal flags and falls back to a small
headed window when the WebGL renderer is software; a software renderer is
refused because its timings are not representative. Options: `--frames`,
`--warmup`, `--rounds`, `--clip`, `--effects`, `--headed`, `--json <file>`.

## 12) Current limitations

- face part detection is tuned on VRoid-style models; other models may need a correction
- anchored decal quality still depends on the quality of the cached anchors
- `face_skin` usually does not include usable eye geometry
- full-face overlay artwork may fit poorly when used as an anchored decal
- `span` decals are easy to misuse if the art was not authored as one wide bilateral image
- animated texture effects are still more expensive than hover effects because the final composite texture must be refreshed on animation ticks
- texture slot targeting is still broad; the current runtime considers both `map` and `shadeMultiplyTexture` when they exist
- flatten quality depends on both anchor quality and the sampled face-skin region; if those are poor, the neutralized area can still look off
