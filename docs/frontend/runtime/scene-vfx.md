# Scene VFX Guide

This document explains the current scene-scoped VFX system in the Vite web frontend.

Scene Effects are typed catalog content and dependencies of Gestures and
Reactions. The product creator authors Local Background Layers or Focus Lines
items, while runtime preparation keeps those lanes distinct and resolves their
registered files and configuration for Preview and playback.

It covers:

- why scene VFX is separate from avatar VFX
- how scene VFX is stored, resolved, and rendered at runtime
- how the current `background_layers` and `focus_lines` effects work
- how the debug modal previews and applies scene effects

For avatar-bound eye/face effects, see `docs/frontend/runtime/avatar-vfx.md`.

For the VRM debug modal and editor-session architecture around this runtime, see `docs/frontend/runtime/vrm-inspector-editor.md`.

For the implementation planning notes that led to this runtime, see `background-vfx.md` and `focus-lines-vfx.md` at the repo root.

## 1) Why this layer exists

The frontend already had an avatar VFX runtime, but that runtime is intentionally avatar-owned:

- `AvatarVFXController` is created by `Avatar` after VRM load
- it binds effects to live avatar primitives and hover planes
- it updates from the avatar runtime tick
- it targets face and eye surfaces, not the whole scene

Scene VFX solves a different problem:

- it is viewport-scoped rather than mesh-scoped
- it can render either behind the avatar or in front of it
- it can optionally cover normal chat/header/panel overlays
- it should be reusable for future scene-only effect kinds

That is why scene VFX is implemented as a separate runtime instead of another `AvatarVFXController` entry kind.

## 2) Main files

### Scene VFX core

- `src/frontend/web/src/lib/scene-vfx/types.ts`
- `src/frontend/web/src/lib/scene-vfx/catalog.ts`
- `src/frontend/web/src/lib/scene-vfx/presets.ts`
- `src/frontend/web/src/lib/scene-vfx/patterns.ts`
- `src/frontend/web/src/lib/scene-vfx/assets.ts`
- `src/frontend/web/src/lib/scene-vfx/focus-lines.ts`
- `src/frontend/web/src/lib/scene-vfx/runtime-state.ts`
- `src/frontend/web/src/stores/scene-vfx-store.ts`

Catalog source:

- `src/frontend/web/src/assets/effects/scene-vfx/catalog.json`

The JSON catalog owns reusable marquee line items, background-layer presets, and
focus-line presets. `catalog.ts` validates that JSON and exposes runtime-ready
entries to the TypeScript helpers.

On a live Anima route, the mounted `AnimaRuntimeCatalog` resolves exact built-in
App sources and private `animama/scene-effect/1` definitions. Private
background images are fetched through revision-scoped authorized file
references, bounded by media budgets, rewritten to owned Blob URLs, and
revoked on disposal. Clip events await private resolution and discard stale
results; an unavailable ID does not fall through to the global JSON catalog.
Standalone debug/editor surfaces may opt into the explicit built-in provider.

Private entries remain selectable as Gesture or Reaction dependencies rather
than independent loadout rows. Their optional local Sound alias is rewritten
through the parent Action's prepared reference map and played once when the
effect is applied. The ordinary scene background image is loadout-owned: live
`Scene` rendering uses the typed Appearance binding and never falls back to a
settings-owned media URL.

### Rendering

- `src/frontend/web/src/ui/main/scene-vfx/SceneVFXLifecycleBridge.tsx`
- `src/frontend/web/src/ui/main/scene-vfx/SceneVFXUnderlayHost.tsx`
- `src/frontend/web/src/ui/main/scene-vfx/SceneVFXOverlayHost.tsx`
- `src/frontend/web/src/ui/main/scene-vfx/SceneVFXLayers.tsx`
- `src/frontend/web/src/ui/main/scene-vfx/SceneVFXBackgroundLayersEffect.tsx`
- `src/frontend/web/src/ui/main/scene-vfx/SceneVFXFocusLinesEffect.tsx`
- `src/frontend/web/src/ui/main/scene-vfx/SceneVFXSolidLayer.tsx`
- `src/frontend/web/src/ui/main/scene-vfx/SceneVFXPatternLayer.tsx`
- `src/frontend/web/src/ui/main/scene-vfx/SceneVFXMarqueeLayer.tsx`

### Runtime integration

- `src/frontend/web/src/ui/main/canvas/Scene.tsx`
- `src/frontend/web/src/ui/main/MainShell.tsx`
- `src/frontend/web/src/ui/main/canvas/SceneRuntimeContext.tsx`
- `src/frontend/web/src/lib/avatar/Avatar.ts`
- `src/frontend/web/src/styles/globals.css`

### Debug authoring

- `src/frontend/web/src/ui/debug/VRMEditorDebugModal.tsx`

### Product authoring

- `src/frontend/web/src/routes/a/scene-effects.new.tsx`
- `src/frontend/web/src/routes/a/scene-effects.$sceneEffectId.edit.tsx`
- `src/frontend/web/src/ui/scene-effect-creator/SceneEffectCreatorPage.tsx`
- `src/frontend/web/src/ui/scene-effect-creator/useSceneEffectSave.ts`
- `src/frontend/web/src/lib/scene-vfx/editor/`
- `src/frontend/web/src/lib/content/catalogApi.ts`

The creator uses the neutral Effect creator presentation primitives in
`ui/content-creator/`; the document, recovery, file collection, and catalog Save lifecycle
remain Scene-specific.

## 3) High-level model

The current scene-VFX runtime and authoring path are built around six pieces:

1. `runtime-state` and `scene-vfx-store`
   - the pure runtime-state module normalizes, stamps, and derives presentation
     flags without selecting an owner
   - owns the active live scene effects
   - resolves defaults into runtime-ready entries
   - enforces one active effect per `SceneVFXKind`
   - derives cover-state separately for underlay and overlay bands

2. `SceneVFXLifecycleBridge`
   - owns expiration and dismiss-on-input side effects for all active scene effects

3. `SceneVFXUnderlayHost`
   - adapts the live store to the pure `SceneVFXUnderlayLayers` renderer
   - renders under-canvas scene effects inside `Scene.tsx`
   - currently hosts `background_layers` and `focus_lines` with `renderPlacement: "behind_avatar"`

4. `SceneVFXOverlayHost`
   - adapts the live store to the pure `SceneVFXOverlayLayers` renderer
   - renders over-canvas scene effects inside `MainShell.tsx`
   - currently hosts `focus_lines` with `renderPlacement: "front_of_avatar"`

5. `VRMEditorDebugModal`
   - owns local draft editing per scene-VFX kind
   - previews or applies entries through the shared store

6. `SceneEffectCreatorPage`
   - owns a versioned portable editor document and private image resources
   - renders the production pure underlay/overlay layers inside an isolated
     `AvatarPreviewSurface`
   - never reads or writes `useSceneVFXStore`
   - saves readable Local files through the typed Scene Effect catalog Save API

There are currently two scene-VFX kinds:

- `background_layers`
- `focus_lines`

The Library Content Preview Dock is a second state owner, not a second scene-VFX
runtime. It uses the same pure normalizer and layer renderers with a local
single-effect state value, its own viewport provider, and its own Avatar
context. Preview Stop/Minimize/Close therefore cannot mutate scene effects in a
simultaneously mounted live Anima scene.

## Product creator behavior

Routes:

- `/a/scene-effects/new`
- `/a/scene-effects/:sceneEffectId/edit`

The creator starts with all three Background Layers enabled. Solid uses the
Anima theme's default chat-canvas background (`#faf9f5`), Pattern starts with a
primary-blue (`#87ceeb`) polkadot, and Marquee starts enabled without any loaded
items. Each fixed layer card exposes its enabled switch directly. Built-in
templates remain explicit starting choices and are cloned into an independent
private document only when selected. Marquee items can be reordered and can
contain allowlisted Twemoji or private PNG/JPEG/WebP sources. `Focus Lines`
exposes render placement, procedural geometry, Avatar-face or normalized
manual-box targeting, flicker animation, and style controls.

The portable `animama/scene-effect-editor/1` JSON contains logical image names
and exact Sound sources only. It never contains Blob URLs, download URLs, or
storage capabilities. Private image `File` objects and their object URLs live
outside the document. Save collects the referenced image files and companion
paths, the Scene Effect definition, Sound dependency references, and the
portable authoring document into a catalog Save request. It includes an
operation ID and, for an existing item, its ID and expected revision. The
backend validates and atomically updates readable Local files and reconciles
the catalog; there is no server draft or immutable-release finalization step.

Recovery stores the document, operation identity, and bounded image Blobs in
IndexedDB. A metadata-only localStorage fallback keeps the authored document
and save identity but surfaces a repair state requiring the user to reselect
private images. Retries preserve the operation identity, and a successful Save
clears the recovery record.

The preview reuses the production pure scene renderers and an editor-owned
Avatar/viewport context. Backgrounds render below the Avatar; Focus Lines honor
`behind_avatar` or `front_of_avatar`. No preview draft is dispatched to the
global live scene store, so leaving the creator cannot alter a mounted Anima
runtime.

The common Library resolves Included and Local Scene Effects through typed
catalog previews and returns editable Local rows to this stable edit route.
Once the item is saved, the creator can hand its catalog item ID and
`scene_effect` token to a new Gesture or Reaction. Definitions, private images,
and preview capabilities remain out of route history.

## 4) Runtime flow

The current runtime flow is:

1. `MainShell` measures the canvas host and provides viewport data through `CanvasViewportProvider`.
2. `MainShell` also provides the live `Avatar | null` through `SceneRuntimeProvider` so scene effects can resolve avatar-dependent targets without putting the avatar instance in Zustand.
3. `Scene` renders:
   - the mounted Anima Appearance Image, if configured
   - `SceneVFXUnderlayHost`
   - the transparent `<Canvas>`
4. `MainShell` renders `SceneVFXOverlayHost` as a sibling above the scene host.
5. `SceneVFXLifecycleBridge` watches every active scene effect and:
   - sets expiry timers from `expiresAtMs`
   - attaches temporary capture-phase dismiss listeners only when at least one live entry has `dismissOnInput: true`
6. `scene-vfx-store` resolves and stores one runtime entry per kind.
7. `MainShell` uses the store's derived cover flags to raise either the whole scene host or just the overlay host when needed.

One additional safety rule still exists in `MainShell`:

- if the UI leaves scene mode, it clears all scene VFX so elevated cover state cannot get stuck

## 5) Render placement and z-order

Scene VFX is intentionally not rendered inside Three.js.

There are now two DOM render bands:

### Underlay band

Mounted in `Scene.tsx` like this:

1. static anima background image
2. `SceneVFXUnderlayHost`
3. transparent React Three Fiber canvas

This is where:

- `background_layers` always renders
- `focus_lines` renders when `renderPlacement === "behind_avatar"`

### Overlay band

Mounted in `MainShell.tsx` as a sibling above the scene host.

This is where:

- `focus_lines` renders when `renderPlacement === "front_of_avatar"`

That split is what makes true "in front of avatar" rendering possible. A child inside `Scene.tsx` can never outrank the canvas or the surrounding DOM overlays by itself.

### Cover behavior

The store derives three booleans:

- `underlayCoverUiOverlaysActive`
- `overlayCoverUiOverlaysActive`
- `coverUiOverlaysActive`

Current behavior:

- underlay cover raises the scene host wrapper so the whole scene stack can sit above normal UI overlays
- overlay cover raises only the overlay host
- if both are active, underlay cover wins and the overlay host is raised above that elevated scene host

## 6) Store model and runtime semantics

File: `src/frontend/web/src/stores/scene-vfx-store.ts`

The store state is intentionally small:

- `activeByKind`
- `coverUiOverlaysActive`
- `underlayCoverUiOverlaysActive`
- `overlayCoverUiOverlaysActive`
- `applySceneVFX(...)`
- `applySceneVFXPreset(...)`
- `clearSceneVFXKind(...)`
- `clearAllSceneVFX()`

Current semantics:

- only one active entry may exist per `SceneVFXKind`
- applying a new entry replaces the old entry for that kind only
- `background_layers` and `focus_lines` can coexist
- applying an entry with `enabled: false` clears that kind
- presets are still only a `background_layers` feature

Default resolution happens in the store:

- `durationMs` defaults to `5000`
- `coverUiOverlays` defaults to `false`
- `dismissOnInput` defaults to `true` for `background_layers`
- `dismissOnInput` defaults to `false` for `focus_lines`
- `durationMs: null` means sticky and does not auto-expire
- emoji marquee items are resolved to local mirrored Twemoji SVG paths before rendering
- marquee `itemRotationMode` defaults to `"upright"` if missing
- marquee `itemRotationOffsetDeg` defaults to `0` if missing

Focus-lines-specific normalization also happens in the store:

- `lineCount` is clamped to `[50, 200]`
- `opacity` is clamped to `[0, 1]`
- `baseThicknessPx` is clamped to `[1, 48]`
- `thicknessVariationPx` is clamped to `[0, 32]`
- `lengthVariation` is clamped to `[0, 0.75]`
- `overscanPx` is clamped to `[0, 256]`
- `target.paddingXPx` is clamped to `[0, 240]`
- `target.paddingYPx` is clamped to `[0, 240]`
- `animation.opacityJitter` is clamped to `[0, 1]`
- `seed` defaults to a deterministic hash of `entry.id`

The live runtime shape adds:

- `startedAtMs`
- `expiresAtMs`

There is also a small compatibility shim in the store for older focus-line entries that still used a single `target.paddingPx` field.

## 7) `SceneVFXLifecycleBridge`

File: `src/frontend/web/src/ui/main/scene-vfx/SceneVFXLifecycleBridge.tsx`

`SceneVFXLifecycleBridge` is the side-effect boundary between the store and the DOM scene effects.

Responsibilities:

- subscribe to all active runtime entries
- schedule effect expiry
- attach and remove temporary dismiss listeners

Dismiss behavior is now intentionally stricter than the original background-only controller:

- keydown dismiss ignores modifier keys, repeated keys, and editable targets
- only `Escape`, `Enter`, and `Space` are treated as dismiss keys
- pointer dismiss only reacts to primary-button pointerdown
- if any dismissible active effect has `coverUiOverlays: true`, the first dismissing input is consumed so hidden UI does not receive an accidental click

Important implementation detail:

- there is no timer per triangle in the focus-lines renderer
- the lifecycle bridge only creates one timeout per active scene effect that has an expiry

## 8) Effect kind: `background_layers`

File: `src/frontend/web/src/ui/main/scene-vfx/SceneVFXBackgroundLayersEffect.tsx`

`background_layers` is the original shipped scene effect kind.

It renders three DOM layers in order:

1. `SceneVFXSolidLayer`
2. `SceneVFXPatternLayer`
3. `SceneVFXMarqueeLayer`

This effect remains fully DOM/CSS-based:

- no Three.js plane
- no post-process pass
- no shader

### Solid fill

File: `src/frontend/web/src/ui/main/scene-vfx/SceneVFXSolidLayer.tsx`

This layer is a fullscreen absolutely positioned `div` with `backgroundColor`.

### Static SVG pattern

Files:

- `src/frontend/web/src/ui/main/scene-vfx/SceneVFXPatternLayer.tsx`
- `src/frontend/web/src/lib/scene-vfx/patterns.ts`

The pattern layer uses generated SVG data URLs rather than building lots of decorative DOM nodes.

Current pattern kinds:

- `none`
- `polkadot`
- `heart`
- `star`

### Marquee

Files:

- `src/frontend/web/src/ui/main/scene-vfx/SceneVFXMarqueeLayer.tsx`
- `src/frontend/web/src/styles/globals.css`
- `src/frontend/web/src/assets/effects/scene-vfx/catalog.json`
- `src/frontend/web/src/lib/scene-vfx/assets.ts`
- `src/frontend/web/src/lib/scene-vfx/emoji.ts`

This is the animated layer in the background-VFX system.

The scene VFX catalog's marquee line-item registry supports three item kinds:

- `png`
- `svg`
- `emoji`

`png` and `svg` items resolve directly to root-relative public asset paths.
`emoji` items resolve through the authoring-only mirrored Twemoji resource at
`/effects/resources/scene-vfx/twemoji`. The resource lives outside typed
product roots, so catalog Rescan does not register each SVG as an Avatar Effect.
The resolver is pinned to the frontend's installed
Twemoji `14.0.2` codepoint conversion behavior, so newly mirrored emoji should
be fetched from the matching upstream Twemoji version.

Custom `svg` line items are project-owned public assets under
`/effects/scene-vfx/svg/`. The catalog validator rejects SVG `src` values
outside that directory, paths with traversal, and paths with query or hash
suffixes. SVG assets should stay static and flat: no scripts, external
references, embedded raster images, or runtime/user-controlled inline SVG
strings.

Current direction options:

- `static`
- `left`
- `right`
- `up`
- `down`
- `diagonal-up-left`
- `diagonal-down-left`
- `diagonal-up-right`
- `diagonal-down-right`

The actual motion is driven by the global `scene-vfx-marquee-shift` keyframes in `globals.css`.

### Background-layer presets

Catalog source: `src/frontend/web/src/assets/effects/scene-vfx/catalog.json`

Runtime wrapper: `src/frontend/web/src/lib/scene-vfx/presets.ts`

Current preset ids:

- `none`
- `shoujo-hearts`
- `comic-pop`
- `kawaii-sparkles`
- `scene-vfx-emotion-<emotion>` for retained emotion backgrounds; annoyance, caring, confusion, desire and remorse no longer include scene backgrounds

`none` clears the live background effect. The other presets are full `background_layers` snapshots.

The emotion presets are intended for reaction clips and use stable ids such as
`scene-vfx-emotion-joy`, `scene-vfx-emotion-fear`, and
`scene-vfx-emotion-gratitude`. Reaction clip scene VFX events should reference
the canonical emotion id directly through `scene_vfx.presetId` unless a clip
deliberately needs a generic fallback preset.

## 9) Effect kind: `focus_lines`

Files:

- `src/frontend/web/src/lib/scene-vfx/focus-lines.ts`
- `src/frontend/web/src/ui/main/scene-vfx/SceneVFXFocusLinesEffect.tsx`
- `src/frontend/web/src/lib/avatar/Avatar.ts`

`focus_lines` is a screen-space manga emphasis effect rendered as SVG triangles.

Focus-line presets are also catalog-backed. Current preset ids:

- `dark`
- `light-streak`

It supports two placement modes:

- `behind_avatar`
- `front_of_avatar`

It supports two target modes:

- `avatar_face`
- `manual_box`

### Target resolution

`manual_box`:

- authors a normalized `0..1` rectangle
- resolves to viewport pixels at render time

`avatar_face`:

- projects `left eye`, `right eye`, and `mouth` anchors to viewport space
- builds a loose face-focused rectangle from those points
- expands that rectangle with independent padding values:
  - `paddingXPx`
  - `paddingYPx`
- returns `null` when no valid points are available, which means nothing renders

Current default face padding is:

- `paddingXPx = 48`
- `paddingYPx = 96`

The avatar-side projection helper lives on `Avatar` because the avatar already owns:

- the camera reference
- face landmark snapshots
- face texture anchor snapshots

### Geometry model

The renderer builds polygons in `buildFocusLinePolygons(...)`:

1. resolve a focus rect and center point
2. treat that focus rect like an ellipse-shaped exclusion zone
3. march around the center at `lineCount` evenly spaced angles with jitter
4. cast each line outward until it reaches the overscanned viewport bounds
5. build a thin triangle from:
   - two outer points offset by thickness
   - one inner tip near the exclusion ellipse

The geometry is deterministic for a given seed, so previews are stable and repeatable.

### Animation model

Focus lines do not animate through React timers.

Each triangle gets:

- a deterministic duration
- a deterministic negative delay
- a deterministic max opacity

The actual flicker is driven entirely by the global `scene-vfx-focus-lines-flicker` keyframes in `globals.css`.

This means:

- no timer per triangle
- no per-frame React updates
- only CSS opacity animation on mounted SVG polygons

### Runtime update model

`manual_box`:

- resolves only from viewport and draft/runtime data
- does not poll avatar state

`avatar_face`:

- polls target resolution at `1000 / 2` ms
- compares the new target against the previous target with `areResolvedTargetsSimilar(...)`
- only rebuilds geometry when the resolved target materially changes

The avatar projection path was also optimized after the initial focus-lines implementation:

- camera matrices are updated once per sampling pass
- a reusable scratch `THREE.Vector3` is used for projection work instead of allocating one per sampled point

## 10) Pose Clip Events

`AnimaPoseClip` playback can trigger scene VFX through timed clip events. Scene
events keep a catalog `presetId` and `sceneKind` (`background_layers` or
`focus_lines`) in the clip JSON. `PoseController` schedules the event, while the
runtime adapter applies it through the existing scene VFX store and lifecycle
hosts.

Scene clip events follow existing store semantics: only one active entry may
exist per scene kind, so a later same-kind scene event replaces the earlier
active entry. Clip playback cleanup clears or restores clip-owned scene effects
so background cover and focus-line overlay state should not remain stuck after a
clip stops, resets, or unloads. `presentation.disable_vfx` skips new
clip-owned scene VFX applies and clears tracked clip-owned scene records, but it
does not disable manual/debug scene VFX controls or clip SFX events. Baked pose
clip export keeps scene VFX events as catalog references rather than embedding
preset definitions.

## 11) Debug modal integration

File: `src/frontend/web/src/ui/debug/VRMEditorDebugModal.tsx`

Scene VFX is exposed through a dedicated top-level `Scene VFX` section in the VRM debug modal.

This is intentionally separate from the avatar `Effects` section because the two runtimes have different ownership and rendering surfaces.

The modal now keeps independent draft state per scene-VFX kind:

- background draft state
- focus-lines draft state
- background preview bookkeeping
- focus-lines preview bookkeeping

When the modal opens for a target:

- if a live `background_layers` effect exists, the background draft is seeded from it
- otherwise the background draft is seeded from `kawaii-sparkles`
- if a live `focus_lines` effect exists, the focus-lines draft is seeded from it
- otherwise the focus-lines draft is seeded from `createDefaultSceneFocusLinesVFXEntry()`

### Preview vs Apply

Preview and apply are isolated per kind.

Preview:

- clones the current draft for that kind
- adds a `-preview` id suffix and preview label
- sets `durationMs: null`
- sets `dismissOnInput: false`
- stores the previous live entry for that same kind so it can be restored later

Apply:

- clears preview bookkeeping for that kind
- writes the normal draft entry to the live store

Because preview state is tracked per kind, previewing `focus_lines` does not overwrite `background_layers`, and vice versa.

### Current Scene VFX controls

Background-layer controls expose:

- enabled toggle
- preset selector
- duration and sticky lifetime fields
- `coverUiOverlays`
- `dismissOnInput`
- solid color controls
- pattern kind, color, size, spacing, and opacity
- marquee item selectors
- marquee direction
- marquee item size, gap, row gap, speed, opacity, rotation mode, and rotation offset

Focus-line controls expose:

- enabled toggle
- duration and sticky lifetime fields
- `coverUiOverlays`
- `dismissOnInput`
- render placement
- target kind
- face padding X and Y
- manual-box rectangle controls
- line count
- color
- opacity
- base thickness
- thickness variation
- length variation
- overscan
- seed
- animation timing controls

## 12) Performance notes

The current scene-VFX system is still intentionally DOM-first, but the cost profile differs by kind.

`background_layers`:

- pattern is cheap because it is one cached SVG background tile
- marquee uses CSS transforms instead of per-frame React updates
- main cost is DOM size when the marquee grid gets dense

`focus_lines`:

- triangle creation is O(`lineCount`) and is usually cheap at the current `50-200` clamp
- the main steady-state cost is SVG paint plus opacity animation
- there is no timer per line
- the only recurring JS timer in this path is the avatar-face sampling interval, and only when `target.kind === "avatar_face"`

The current implementation also avoids a common `useSyncExternalStore` pitfall by subscribing `SceneVFXLifecycleBridge` to `activeByKind` and deriving arrays with `useMemo`, instead of returning a fresh array directly from the Zustand selector.

## 13) Current limitations

The scene-VFX runtime is still intentionally narrow.

Current limits:

- Scene Effects are triggered by configured clip events or explicit preview/
  debug controls; they are not a separate autonomous scene planner.
- Persistent authoring belongs to typed catalog items and Action dependencies,
  rather than Anima settings or preferences.
- Shader-based, canvas-composited, and world-space Three.js scene effects are
  not implemented by this DOM/SVG layer.
