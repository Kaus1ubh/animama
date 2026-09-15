# VRM Inspector + Editor Session Guide

This document explains the current VRM inspection and runtime-edit foundation in the Vite web frontend.

It covers:

- how the active rendered VRM is exposed to inspection code
- how raw `.vrm` bytes and live Three.js runtime state are merged
- how runtime texture VFX is applied to live eye/face material usages
- how the debug modal is wired into the main canvas
- what the first runtime edit does and does not do

For the broader avatar animation runtime, see `docs/frontend/runtime/avatar-animation.md`.

## 1) Why this layer exists

The avatar runtime already had a strong rendering/animation path:

- `AvatarCanvasActor.tsx` loaded the active avatar
- `Avatar.ts` wrapped `three-vrm`
- the scene rendered `avatar.scene` as a React Three Fiber `<primitive />`

That was enough for rendering, animation, expressions, and lip-sync, but not enough for asset inspection or live editor-style tooling.

The new VRM inspector/editor layer adds three concepts:

1. **`VRMDocument`**  
   A file/document view of the asset. It loads raw `.vrm` bytes, preserves raw glTF/VRM JSON, parses a `gltf-transform` document, and builds structural inspection data.

2. **`VRMEditorSession`**  
   A live runtime session bound to the currently rendered `Avatar`. It merges document inspection with live Three.js objects and owns runtime-only overrides.

3. **`AvatarVFXController`**  
   A live runtime VFX controller owned by `Avatar`. It applies mesh-bound eye/face VFX by cloning per-usage materials, compositing stacked texture layers into runtime textures, and creating hover planes for face-attached overlays.

This split is intentional:

- `Avatar` remains the render/animation runtime.
- `VRMDocument` is the asset/document layer.
- `VRMEditorSession` is the runtime editing/inspection layer that can evolve toward richer tools.
- `AvatarVFXController` is the live material/texture VFX layer that runs with the avatar.

## 2) Main files

### Document + inspection core

- `src/frontend/web/src/lib/avatar/VRMDocument.ts`
- `src/frontend/web/src/lib/avatar/VRMEditorSession.ts`
- `src/frontend/web/src/lib/avatar/vrmEditorInspection.ts`
- `src/frontend/web/src/lib/avatar/vrm-editor-types.ts`

### Runtime VFX core

- `src/frontend/web/src/lib/avatar/vfx/AvatarVFXController.ts`
- `src/frontend/web/src/lib/avatar/vfx/catalog.ts`
- `src/frontend/web/src/lib/avatar/vfx/profiles.ts`
- `src/frontend/web/src/lib/avatar/vfx/types.ts`

### React bridge + UI state

- `src/frontend/web/src/hooks/useVRMEditorSession.ts`
- `src/frontend/web/src/stores/vrm-editor-debug-store.ts`

### Runtime/UI integration

- `src/frontend/web/src/lib/avatar/Avatar.ts`
- `src/frontend/web/src/ui/main/canvas/AvatarCanvasActor.tsx`
- `src/frontend/web/src/ui/debug/VRMEditorDebugModal.tsx`
- `src/frontend/web/src/ui/main/header/Header.tsx`

## 3) High-level flow

The runtime flow is:

1. `AvatarCanvasActor` loads the active anima avatar through `Avatar`.
2. `Avatar` now retains:
   - the loaded `GLTF` result as `sourceGltf`
   - the resolved file URL as `sourceUrl`
   - the stable avatar/debug key as `sourceKey`
3. `Avatar` creates `AvatarVFXController` after the VRM is loaded.
4. `AvatarCanvasActor` registers the active rendered avatar in `vrm-editor-debug-store`.
5. The header exposes a debug-only VRM button when a target avatar exists.
6. Opening the modal initializes `useVRMEditorSession(...)`.
7. The hook creates a `VRMEditorSession`.
8. The session:
   - builds live primitive bindings from the rendered avatar scene
   - tries to load a `VRMDocument` from the active source URL
   - merges document inspection with runtime bindings
   - exposes both inspection data and VFX controller state for the modal

This means the modal is inspecting and editing the same avatar that is already rendered on screen, not a second detached VRM load path.

## 4) `VRMDocument`: raw asset parsing

File: `src/frontend/web/src/lib/avatar/VRMDocument.ts`

Responsibilities:

- load source bytes from `sourceUrl` or `ArrayBuffer`
- preserve the raw glTF JSON document
- build a sanitized `gltf-transform` document
- produce a reusable structural inspection snapshot

### Parsing pipeline

`VRMDocument` uses `@gltf-transform/core` `WebIO`:

1. `binaryToJSON(...)`
   - reads the `.vrm`/GLB bytes
   - preserves the raw JSON and resources

2. `sanitizeJsonDocument(...)`
   - removes `VRM` / `VRMC_*` names from `extensionsUsed`
   - removes `VRM` / `VRMC_*` names from `extensionsRequired`
   - keeps the raw extension payload in the raw JSON

3. `readJSON(...)`
   - parses the sanitized document into a `gltf-transform` `Document`

The sanitize step matters because the current use of `gltf-transform` is aimed at standard glTF/Khronos extensions, while VRM-specific extensions still need to be preserved in the raw JSON for VRM metadata and material inspection.

### What `VRMDocument` keeps

- raw `JSONDocument`
- sanitized `JSONDocument`
- parsed `gltf-transform` `Document`
- inspection snapshot
- source summary:
  - URL
  - source key
  - byte length
  - fetch timestamp

### Why both raw JSON and `Document` are needed

The raw JSON is still the authoritative source for:

- VRM 0 metadata: `extensions.VRM`
- VRM 1 metadata: `extensions.VRMC_vrm`
- VRM 0 material texture references: `VRM.materialProperties[*].textureProperties`
- VRM 1 MToon material payload: `material.extensions.VRMC_materials_mtoon`

The parsed `Document` is useful for normalized glTF structure and counts:

- node, mesh, skin, and material lists
- accessor-backed vertex counts
- index counts
- texture/image metadata

## 5) `vrmEditorInspection`: snapshot building

File: `src/frontend/web/src/lib/avatar/vrmEditorInspection.ts`

This module is the shared inspection builder used by both `VRMDocument` and `VRMEditorSession`.

It provides:

- VRM extension/version detection (`VRM` vs `VRMC_vrm`)
- metadata extraction
- node hierarchy inspection
- mesh and primitive usage rows
- skin and humanoid bone summaries
- material inventory
- texture inventory and reverse material usage lookup
- runtime primitive binding construction from the live avatar

### Snapshot shape

The main inspection snapshot includes:

- source summary
- asset summary
- VRM metadata
- warnings
- totals
- nodes
- meshes
- primitive usages
- skins
- bones
- materials
- textures

This snapshot is intentionally UI-friendly. The modal should not need to know how to traverse raw glTF or Three.js internals.

## 6) `VRMEditorSession`: live runtime editor boundary

File: `src/frontend/web/src/lib/avatar/VRMEditorSession.ts`

Responsibilities:

- own the current `Avatar`
- own a `VRMDocument` when document parsing is available
- build live runtime bindings from `Avatar.sourceGltf.parser.associations`
- merge document and runtime inspection into one snapshot
- manage runtime-only overrides
- expose `subscribe(...)` / `getSnapshot()` for React

### Runtime primitive bindings

The important bridge here is `GLTFLoader` parser associations.

The session traverses `avatar.scene` and inspects `avatar.sourceGltf.parser.associations` to recover:

- glTF node index
- glTF mesh index
- primitive index
- material index
- runtime object name/type
- current visibility
- original visibility
- skinned-mesh flag

Bindings are keyed by:

- `nodeIndex:meshIndex:primitiveIndex` when node information exists
- a runtime fallback key when necessary

This is why the first editor action is modeled per primitive usage, not per material definition.

### Fallback behavior

If the document/source fetch path fails, the session falls back to `avatar.sourceGltf.parser.json` and still builds a runtime-backed inspection snapshot when possible.

That fallback mode is intentionally non-fatal:

- the modal still works
- warnings explain the degraded path
- runtime edit controls can remain available

## 7) First runtime edit: primitive visibility toggle

The first edit is intentionally narrow.

It is **not** a global material-definition toggle.

Instead, it is a **per primitive-usage visibility override**:

- the UI row lives in the `Geometry` section
- the edit targets one bound runtime mesh/primitive usage
- the session toggles the bound object's `visible` flag
- `Reset overrides` restores original visibility

This choice avoids several problems in v1:

- mutating a shared material definition could affect many unrelated usages
- it avoids commit/export semantics too early
- it proves the runtime binding model with minimal risk

Current semantics:

- overrides are runtime-only
- overrides live inside the session, not Zustand
- disposing the session restores original visibility
- the current UI/API should be read as "primitive visibility", not "material enabled"

## 8) Runtime texture VFX

Files:

- `src/frontend/web/src/lib/avatar/vfx/AvatarVFXController.ts`
- `src/frontend/web/src/lib/avatar/vfx/catalog.ts`
- `src/frontend/web/src/lib/avatar/vfx/profiles.ts`

For a dedicated guide to VFX types, placement modes, and authoring/runtime tradeoffs, see `docs/frontend/runtime/avatar-vfx.md`.

This runtime VFX layer exists for effects that should stay attached to the avatar's existing surface UVs instead of floating in front of the face as sprites or billboards.

### What `AvatarVFXController` owns

`AvatarVFXController` is created by `Avatar` after a VRM load succeeds and is updated every frame from `Avatar.update(delta)` before `vrm.update(delta)`.

It owns:

- detection of effect-compatible primitive usages
- role assignment for those usages (`eye_iris` vs `face_skin`)
- original material and texture references for reset
- cloned runtime materials on a per-usage basis
- generated `CanvasTexture` overrides
- per-binding effect state and UV animation state
- a subscribable VFX snapshot for debug UI

### Target detection

The controller reuses the same live primitive-binding model as the inspector:

- bindings are derived from the rendered `avatar.scene`
- bindings are keyed by `nodeIndex:meshIndex:primitiveIndex`
- effects are applied to one primitive usage at a time

Target roles are currently detected by material-name heuristics, with support for future per-model profile overrides:

- eye materials are matched from names like `eye` / `iris`
- face materials are matched from names like `face` / `skin`

The profile layer also defines the normalized eye/face atlas regions that an effect should draw into.

### Catalog + application model

The VFX catalog is code-defined in `vfx/catalog.ts`. Each entry now belongs to one of three kinds:

- `texture`
- `face_anchored`
- `hover`

`AvatarVFXController` exposes matching apply entrypoints:

- `applyTextureVFX(...)`
- `applyFaceAnchoredVFX(...)`
- `applyHoverVFX(...)`

Each entry describes a shared base plus kind-specific fields:

- shared: PNG asset path, transform, and animation config
- `texture`: target role, asset shape, replace/overlay mode, and optional side/mirroring
- `face_anchored`: face anchor, bilateral layout, pivot, and optional side/mirroring
- `hover`: `eye_hover`, `mouth_hover`, or `box_hover`, plus the subtype-specific placement fields when needed and optional runtime skin backdrop for eye/mouth hover

Application is runtime-only and per binding, but a binding can now host multiple simultaneous effects:

1. clone the runtime material for that primitive usage
2. resolve placement rects or hover placements for each applied effect
3. store the effect as one active runtime layer or hover instance
4. redraw one composite canvas-backed texture per active texture slot when needed
5. assign the composite texture back to the cloned material

The first implementation only targets these slots when they exist:

- `map`
- `shadeMultiplyTexture`

That means:

- eye effects can fully replace the original iris texture look
- face effects can preserve the original face texture and composite on top
- multiple mesh-bound effects can now stack on the same binding
- resetting the effect restores the original runtime material

### Eye and face atlas behavior

For eye effects:

- `single_eye` assets are drawn into both eye regions
- the right-eye draw can be mirrored
- `double_eye` assets are drawn into the combined eye region

For face effects:

- `full_face` assets are drawn into the configured face region, currently the whole texture by default

The draw surface always matches the original runtime texture dimensions, so the generated replacement/overlay textures stay aligned to the VRM's existing atlas size.

### Animation model

Texture effects no longer animate by transforming the entire generated atlas texture.

Instead, the controller:

- resolves texture placements once
- evaluates pulse/spin/drift from `animationConfig`
- redraws animated layers around each placement's local center

Hover effects still animate through local transform changes on their face-attached groups.

Current presets are:

- `none`
- `pulse`
- `spin`
- `drift`
- `pulse_spin`

The VFX controller also throttles animation updates to 30 FPS. Animated texture effects still require composite redraw plus texture upload on those ticks, so they remain the most expensive VFX path.

### Session + modal integration

`VRMEditorSession` does not own VFX runtime state. Instead it subscribes to `avatar.vfxController` and exposes the controller snapshot through the main session snapshot.

The debug modal now includes an `Effects` section with:

- the bundled effect catalog
- detected VFX target bindings
- original runtime slot sizes
- active effect counts and active effect lists per binding

The VFX snapshot now exposes both binding-level summaries and per-applied-effect rows.

In practice that means the modal can:

- show multiple active effects on one binding
- apply a new effect without clearing sibling effects of the same kind
- remove one specific applied effect instance by `appliedEffectId`
- per-binding `Apply` / `Remove` actions
- per-binding animation preset selection
- a global `Reset VFX` action

## 9) React integration

### `useVRMEditorSession`

File: `src/frontend/web/src/hooks/useVRMEditorSession.ts`

This hook is intentionally thin.

It:

- creates the `VRMEditorSession`
- exposes the session snapshot through `useSyncExternalStore`
- returns `{ session, snapshot, status, error, refresh }`

The hook is not the domain layer. The class owns the real logic.

### `vrm-editor-debug-store`

File: `src/frontend/web/src/stores/vrm-editor-debug-store.ts`

This Zustand store is UI-only. It tracks:

- whether the modal is open
- the current inspect target:
  - `animaId`
  - `avatar`
  - `sourceUrl`
  - `sourceKey`

It does **not** own the asset document or editor session state.

## 10) UI wiring

### Canvas registration

File: `src/frontend/web/src/ui/main/canvas/AvatarCanvasActor.tsx`

After avatar load succeeds, the actor registers the active VRM object target in `vrm-editor-debug-store`.

The same actor also registers the avatar with `animation-debug-store` for procedural animation and spring-bone tuning. That is a separate debug surface covered in `docs/frontend/runtime/avatar-animation.md`.

On cleanup it clears the target, which also closes the modal if that target was active.

### Header entry point

File: `src/frontend/web/src/ui/main/header/Header.tsx`

The header has three debug-only surfaces with separate responsibilities:

- Anima debug panel: general anima/runtime diagnostics.
- Animation debug modal: procedural animation and spring-bone tuning.
- VRM editor debug modal: VRM object inspection and live material/geometry/VFX edits.

The VRM editor button appears only when:

- debug mode is enabled
- an active VRM object target is registered

### Debug modal

File: `src/frontend/web/src/ui/debug/VRMEditorDebugModal.tsx`

The modal uses the shared `SectionedModalFrame` pattern and currently exposes:

- `Overview`
- `Nodes`
- `Geometry`
- `Rig`
- `Materials`
- `Effects`
- `Raw JSON`

The `Geometry` and `Effects` sections contain the current live runtime edit controls.

For breathing, idle sway, wind, updraft, and spring-bone helper controls, use `AnimationDebugModal` instead.

## 11) Current limitations

This is intentionally a foundation, not a finished editor.

Current limitations:

- wired only to the main rendered avatar
- no document mutation APIs yet
- no binary export/write-back path yet
- no vertex or bone highlight overlays yet
- no persistent VFX save/load path yet
- no automatic emotion/state-driven VFX triggers yet
- target-role matching is still heuristic-first unless a model profile override exists
- VFX application is currently limited to `map` and `shadeMultiplyTexture`
- no diff/compare workflow between two VRMs

The important thing that now exists is the boundary needed for those features:

- `VRMDocument` for document-level inspection and future mutations
- `VRMEditorSession` for live runtime bindings and overrides
- `AvatarVFXController` for live texture/material VFX on the rendered avatar

## 12) Good next steps

The current structure is ready for future work like:

1. material replacement on a primitive usage
2. texture slot replacement and richer slot targeting
3. bone and skin visualization overlays
4. vertex highlighting by material / texture / bone / skin
5. commit/export paths from runtime/session state back into document bytes
6. reuse of the same session model in anima preview/detail surfaces
7. automatic VFX triggers driven by anima/emotion/runtime state

When adding those features, keep the boundary stable:

- document changes belong in `VRMDocument`
- live rendered-object inspection changes belong in `VRMEditorSession`
- live texture/material VFX changes belong in `AvatarVFXController`
- React hooks and Zustand should stay thin
