# Animama particle integration

Read this to connect saved effects to avatar playback, diagnose placement, or
reason about lifecycle and resource ownership. UI controls are in
[creator.md](creator.md).

## Content and playback path

A Particle Effect is a typed `particle_effect` catalog item with runtime defaults,
a Quarks manifest, and registered texture files. Included assets live under
`content/included/vfx/particle`; Local items are saved through the typed content
API. The code-defined `AVATAR_PARTICLE_VFX_CATALOG` supplies authoring defaults,
not an unrestricted runtime fallback.

The normal path is:

1. Save a Particle Effect.
2. Add it to a Gesture or Reaction as an exact catalog dependency with a local alias
   and a timed `particle_vfx` event.
3. Complete Preview or the live Anima mounts the Action's resolved dependency
   closure into its runtime catalog.
4. Pose/Reaction clip playback dispatches the event to `Avatar`.
5. `Avatar` calls `ParticleVFXController.playEffect` with the clip's applied ID.
6. The controller resolves, clones, places, registers, updates, and clears Quarks
   systems for that instance.

Saving alone does not equip the effect or assign an emotion trigger. Reaction
selection supplies particles through the selected clip's events; there is no
separate planner particle lane. A missing mounted effect ID fails locally rather
than falling back to a similarly named built-in.

Distinguish catalog item ID, Action dependency alias, effective runtime `effectId`,
and per-play `appliedId`. Names are not interchangeable with these identities.
This example shows runtime event fields, not a complete dependency declaration:

```json
{
  "id": "particle-event-1",
  "time": 0.25,
  "kind": "particle_vfx",
  "effectId": "mounted-effect-id",
  "anchor": "head",
  "duration": 2,
  "followAnchor": true,
  "transform": {
    "offset": { "x": 0, "y": 0.2, "z": 0 },
    "depthOffset": 0.1,
    "rotation": { "x": 0, "y": 0, "z": 0 },
    "scale": { "x": 1, "y": 1, "z": 1 }
  }
}
```

Omitted placement/follow/duration values use the resolved catalog defaults.
Overrides merge with the default transform. `envelope` and `parameterKeyframes`
are parsed by the clip schema but are not mapped onto Quarks emitter internals
by `Avatar._applyParticleVFXEvent` at this baseline.

## Placement and following

`Avatar` creates `ParticleVFXController` when loading its VRM. Active objects live
under `avatar.scene`; updates run after VRM constraints and spring bones so anchor
positions reflect the current avatar frame.

Supported anchors are root, hips, spine, chest, neck, head, leftHand, rightHand,
leftFoot, and rightFoot. `resolveParticleVFXAnchorLocalPosition` reads normalized
humanoid bone positions and converts them into avatar-local coordinates. Missing
bones fall back through documented candidates, eventually to root, with warnings.

- Offsets are avatar-local meters, not screen pixels or bone-local axes.
- `depthOffset` adds to local Z offset; positive is toward the avatar's front.
- Following refreshes position, not bone orientation. Authored rotation and scale
  remain the effect's own transform.
- `followAnchor: false` stops continuous anchor tracking, but the effect still
  belongs to the avatar scene hierarchy; it is not automatically independent of
  the avatar's overall scene transform.
- `userData.animamaParticleAnchor` on an emitter overrides the default anchor.
  Inherit removes that metadata. Authored parent transforms and emitter offsets
  are retained; anchor deltas are applied separately to avoid double transforms.
- If any system has `worldSpace: true`, continuous following is disabled for the
  entire instance, including emitters with overrides, and a warning is recorded.

Avatar-bounds rectangle fitting runs once per play on rendered mesh bounds,
excluding active particle roots. It patches selected cloned shapes, preserving
cached prefabs and placement. Failure to obtain bounds or match emitters leaves
normal placement and produces a warning. It does not continuously resize with pose.

## Lifetime, admission, and cleanup

Clip events use duration-backed playback. Requested durations are capped by the
effect's maximum; clearing the event or stopping its clip clears the applied ID.
Request versions and tracked IDs fence late asynchronous loads so a cancelled
effect does not reappear after loading completes.

Explicit runtime/debug calls can request `lifetime: { kind: "manual" }` only when
the catalog allows looping. Manual lifetime bypasses elapsed-time expiry, not
cleanup, following, or admission limits. Clear it explicitly or through avatar
unload/controller disposal. The ordinary creator preview is not a manual lifetime
Action authoring control.

The controller reserves up to four active/pending instances and a total declared
budget of 512 particles. It includes pending reservations to avoid concurrent-load
oversubscription. Reusing an applied ID replaces its instance. If the incoming or
existing effect is exclusive (`canCoexist: false`), conflicting instances clear.
The declared budget is not a live particle counter or a per-spawn Quarks clamp.

The presentation VFX preference suppresses clip-owned particle effects and clears
tracked ones when disabled. Explicit manual/debug effects and SFX are separate.

Quarks loads lazily. Prefabs are cached per effect ID and cloned for instances;
failed load promises are evicted for retry. Instance removal stops/disposes its
systems and detaches its object. Controller disposal also releases prefab and
batch resources. The runtime media catalog owns fetch cancellation and Blob URLs
for its mounted lifetime; do not revoke shared URLs or textures on each clip end.

## Resource resolution and validation boundaries

`AnimaRuntimeMediaCatalog` takes the mounted manifest and exact logical texture
mapping, fetches the registered files, checks declared byte sizes and package
limits, and rewrites image references to owned Blob URLs. Missing mappings and
unused extra mappings fail resolution. It enforces a 5 MiB manifest and 64 MiB
particle package limit. The manifest remains content bytes, not an inline API
definition for agents to substitute.

Frontend creator/package validation is described in [creator.md](creator.md).
Do not describe those bounds as a fully matching server-side Quarks validator:
at the checked baseline the typed backend handler parses generic runtime-default
and definition objects, and the content store performs generic companion checks.
The runtime loader's resource checks are another boundary, not validation of
every Quarks behavior or generator.

Preload tier is saved metadata. The controller has `preloadCatalogTier`, and the
media catalog allocates IDs under a shared eager-byte budget, but no production
caller of that controller method was found at this baseline. Do not promise that
selecting Tier A eliminates first-play loading merely because older runtime docs
describe automatic preloading.

## Source navigation

- Entry points/update order: `src/frontend/web/src/lib/avatar/Avatar.ts`.
- Instances and budgets: `src/frontend/web/src/lib/avatar/particle-vfx/ParticleVFXController.ts`.
- Anchors/transforms: `src/frontend/web/src/lib/avatar/particle-vfx/runtime.ts`,
  `emitterAnchors.ts`, and `autoFit.ts` in that directory.
- Saved-default decoding: `src/frontend/web/src/lib/avatar/particle-vfx/runtimeConfig.ts`.
- Mounted resources: `src/frontend/web/src/lib/runtime-content/AnimaRuntimeMediaCatalog.ts`.
- Clip contracts: `src/frontend/web/src/lib/avatar/poses/animaPoseClip/schemaV2.ts` (parser) and `clipVocabulary.ts` (events and fades).
- Backend projection: `src/backend/animama/app/services/typed_runtime_projection.py`.
- Backend validation boundary: `src/backend/animama/app/services/content_kind_registry.py`
  and `src/backend/animama/adapters/content_store/filesystem_store.py`.
- Existing runtime/controller tests: `src/frontend/web/tests/avatar/particleVfx.test.ts`
  and `particleClipPlayback.test.ts` in that directory. Their mocked controller
  coverage is not a substitute for real-library or rendered-browser verification.
