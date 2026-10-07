# VRM Inspector + Editor Session Guide

The VRM inspector exposes asset structure and runtime material overrides for
the rendered avatar in the Vite web frontend.

See [Avatar animation](avatar-animation.md) for rendering and motion.

## 1) Why this layer exists

`AvatarCanvasActor.tsx` loads the active avatar, `Avatar.ts` wraps `three-vrm`,
and the scene renders `avatar.scene` as a React Three Fiber `<primitive />`.
Inspection and runtime editing use three cooperating components:

1. **`VRMDocument`**  
   A file/document view of the asset. It loads raw `.vrm` bytes, preserves raw glTF/VRM JSON, parses a `gltf-transform` document, and builds structural inspection data.

2. **`VRMEditorSession`**  
   A live runtime session bound to the currently rendered `Avatar`. It merges document inspection with live Three.js objects and owns runtime-only overrides.

3. **`AvatarVFXController`**  
   A live runtime VFX controller owned by `Avatar`. It applies Avatar Effects by cloning per-usage materials, compositing stacked texture layers into runtime textures, creating planes in front of the face, on body points and beside the Avatar, and drawing silhouette overlays.

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
2. `Avatar` retains:
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

The Geometry section toggles one bound primitive usage's `visible` flag.
Overrides belong to the session; Reset overrides and disposal restore original
visibility. Shared material definitions are unaffected.

## 8) Runtime texture VFX

See [Avatar VFX](avatar-vfx.md) for effect kinds, binding, texture composition,
placement and animation.

### Session + modal integration

`VRMEditorSession` does not own VFX runtime state. Instead it subscribes to `avatar.vfxController` and exposes the controller snapshot through the main session snapshot.

The debug modal includes an `Effects` section with:

- the Anima runtime catalog effects that have been resolved
- detected VFX target bindings
- original runtime slot sizes
- active effect counts and active effect lists per binding

The VFX snapshot exposes both binding-level summaries and per-applied-effect rows.

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

The hook:

- creates the `VRMEditorSession`
- exposes the session snapshot through `useSyncExternalStore`
- returns `{ session, snapshot, status, error, refresh }`

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

The inspector supports runtime overrides with these limits:

- wired only to the main rendered avatar
- no document mutation APIs yet
- no binary export/write-back path yet
- no vertex or bone highlight overlays yet
- inspector-applied overrides are not persisted to the VRM or an Anima loadout
- the inspector does not configure automatic emotion-driven effects; chat
  Reaction clips own their effect events
- target-role matching is still heuristic-first unless a model profile override exists
- VFX application is currently limited to `map` and `shadeMultiplyTexture`
- no diff/compare workflow between two VRMs

## 12) Extension boundaries

Keep ownership explicit when extending inspection or editing:

- document changes belong in `VRMDocument`
- live rendered-object inspection changes belong in `VRMEditorSession`
- live texture/material VFX changes belong in `AvatarVFXController`
- React hooks and Zustand should stay thin
