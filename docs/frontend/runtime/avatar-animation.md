# Avatar + Animation Runtime Guide

This document explains how the current frontend avatar system works, how animation/emotion state is resolved, and how a chat request lifecycle drives avatar behavior.

For the end-to-end phoneme -> viseme -> VRM mouth animation pipeline
(including Pocket TTS timing alignment), see
`docs/frontend/runtime/avatar-lipsync.md`.

For the focused guide to planner-owned state-triggered motion policy, see
`docs/frontend/runtime/avatar-planner.md`.

Library and Anima Gesture/Reaction previews compile one exact root plus its
transitive Effect/Sound closure and adapt that immutable closure to the existing
motion/media catalog. VRMA Gestures use the gesture animation lane; Anima Clip
Gestures use the pose-clip gesture lane; Reactions use the non-body reaction
lane. Chat consumes the same frozen runtime snapshot as the player.

The direct Gesture and Reaction creators preview the current in-memory draft
through the client-side timeline without saving it or changing an Anima
loadout. The editor prepares an exact dependency closure locally when timeline
events need Effects or Sounds. Gesture supports the Anima Clip schema and a
self-contained VRMA import. Reaction exposes expression/effect/sound timing and
rejects humanoid tracks.

Idle Styles add an emotion-aware idle lane. A mounted runtime uses the exact
selected style (or an intentionally empty
lane), including authorized private VRMA memberships. The runtime first picks
the pool for the current dominant canonical emotion and otherwise uses the
style's non-empty Default pool. Selection inside that pool is uniform and the
existing transient previous-clip avoidance remains in force. The existing
Motion Planner, intermittent stint timing, Animation Manager, and single-canvas
ownership do not change; only the mounted idle catalog input changes. As with
the rest of the Loadout, a changed style appears on the next route/chat mount.

## 1) High-level architecture

The avatar runtime is split into four layers:

1. **3D actor layer**  
   File: `src/frontend/web/src/ui/main/canvas/AvatarCanvasActor.tsx`  
   Loads the VRM model for the active anima, owns a runtime `Avatar` instance, and runs per-frame updates.

   The model source is the resolved `avatar_model` from
   `GET /v1/animas/{anima_id}/runtime`. Its effective/content revision,
   slot, and runtime ID form the stable canvas load key; short-lived download targets are
   never identities. `AnimaRouteProviders` freezes the first resolved response
   for the route mount, so a background refetch cannot replace a model during
   an active chat. Included and Local model files are verified through the application origin
   before the loader receives prepared Blob URLs. The same frozen response
   constructs one `AnimaRuntimeCatalog`, which appends verified optional roots
   without replacing the model or catalog. Owner, route, or explicit revision
   replacement cancels the old preparation and disposes its resources. A fully
   prepared creation handoff retains its existing StrictMode-safe ownership.

2. **Avatar runtime layer**  
   Files: `src/frontend/web/src/lib/avatar/*`  
   Core runtime classes:
   - `Avatar.ts`
   - `AnimationManager.ts`
   - `poses/PoseController.ts`
   - `planner/AvatarPlanner.ts`
   - `ExpressionController.ts`
   - `ProceduralAnimationController.ts`

- `proc-animation/*`
- `spring-bone/SpringBonePhysicsController.ts`
- `animationManifest.ts`

3. **Reactive state bridge layer**  
   File: `src/frontend/web/src/stores/avatar-runtime-store.ts`  
   Holds UI/runtime signals (`interactionPhase`, emotion state, and queued gesture requests).

4. **Chat/SSE integration layer**  
   Files:
   - `src/frontend/web/src/ui/main/chat/useChatSession.ts`
   - `src/frontend/web/src/query/mutations/useChatSse.ts`
   - `src/frontend/web/src/ui/main/chat/ChatInterface.tsx`  
     Converts chat lifecycle + SSE events into avatar store updates.

## 2) Core runtime classes

### `Avatar`

File: `src/frontend/web/src/lib/avatar/Avatar.ts`

Responsibilities:

- Load/unload VRM.
- Own `PoseController` (JSON-backed catalog poses).
- Own `AnimationManager` (skeletal/VRMA playback).
- Own `ExpressionController` (emotion expressions, blink, lip-sync APIs).
- Own `ProceduralAnimationController` (additive body motion and idle cursor
  look-at).
- Own `SpringBonePhysicsController` (runtime spring-bone tuning/helpers).
- Own `AvatarVFXController` (runtime material/texture VFX for the active VRM).
- Own `AvatarPlanner` (state-triggered VRMA loop/gesture, PoseController clip,
  and procedural layer policy).
- Expose high-level APIs for animation/expression/lip-sync operations.
- Consume the mounted `AvatarMotionCatalog` for idle animations, gestures,
  pose clips, reaction clips, static pose support, and VRMA resource loading.

Important behavior:

- `Avatar.load` applies the engine-owned default `relaxedRest` pose through
  `PoseController`, including VRM 0/1 retargeting. `prepareFirstFrame()` requires
  that pose to be active with both upper arms resolved, then updates the VRM
  rig and world transforms at zero elapsed time before scene attachment. A
  failure leaves the non-avatar fallback; it never exposes a T-pose.
- `resetAnimations()` resets procedural layers, clip animation, and
  PoseController state before explicitly reapplying default poses.
- `applyPose(...)`, `playClip(...)`, and `stopClip(...)` accept
  `preserveProceduralOffsets`. When enabled, `Avatar` removes the previous
  frame's procedural offsets from the old base pose, replaces the static
  pose/clip base, then reapplies procedural layers at `delta=0` so active
  layers such as sway do not visually restart during debug pose or clip
  invocation. Pose clips remember the flag so default-pose restoration on stop
  or non-looping completion uses the same preservation path.
- `playClip(...)` is synchronous for an already loaded catalog entry.
  `loadAndPlayClip(...)` lazily decodes a prepared private `animaPoseClip/1.0`
  manifest before playback. Planner-owned pose, reaction, and VRMA actions
  verify that the requesting owner/run/plan is still current after asynchronous
  work. Pending resources are skipped, never fetched around the preparation
  session. A disposed animation manager cannot cache or play a late decode.
- `update(delta)` is the per-frame coordination point:
  1. clear procedural offsets from the previous frame
  2. update `AnimationManager` so authored VRMA clips establish the base pose
  3. blend any automatic idle VRMA exit back to the default `relaxedRest` base
     pose
  4. update `PoseController` so active `animaPoseClip/1.0` samples can layer
     on top of mixer output
  5. apply procedural animation layers on top of that pose
  6. sample active reaction clips into expression overlays and effect events
  7. update expressions, look-at, lip-sync, and VFX
  8. update spring-bone physics settings before three-vrm evaluates spring bones
  9. call `vrm.update(delta)`
  10. update optional spring-bone helper visuals
- `updateState(snapshot)`:
  - Resolves dominant emotion from `snapshot.emotionalState.activeEmotions`.
  - Asks `AvatarPlanner.plan(...)` for next VRMA, planner-owned pose clip,
    planner-owned procedural actions, and reaction clip actions.
  - Applies emotion preset only when label/intensity changed.
  - Plays gesture/loop VRMA clips only when the active plan key changes.
  - Runs idle VRMAs as intermittent stints from `manifest.json`: quiet
    period, one finite emotion-aware idle VRMA, then quiet again.
  - Plays and stops planner-owned PoseController clips through
    `Avatar.playClip(...)` / `Avatar.stopClip(...)` with procedural offset
    preservation.
  - Plays and clears planner-owned reaction clips through `ReactionClipPlayer`.
    Reaction clips are expression/VFX/SFX-only, can include particle VFX events,
    and do not suspend automatic VRMA playback.
  - Applies planner-owned procedural layer policy through
    `ProceduralAnimationController`, while debug/manual layer changes keep
    manual ownership.
  - Stores the latest planner debug snapshot for the Animation Debug modal.
  - Planner-owned VRMA playback always receives a nonzero transition duration
    when the planner supplies one, including the first automatic VRMA play.
    When automatic VRMA playback resumes after a coordinated PoseController
    clip, `Avatar` applies a one-shot short fade to the resumed VRMA plan.
  - VRMA action stops and natural finite completions capture the current
    humanoid base with procedural offsets stripped, blend that base back to
    `relaxedRest` over the relevant fade duration, and reapply procedural
    layers throughout the blend. Crossfades into another VRMA cancel the rest
    blend because the next authored clip becomes the base.

### `AnimationManager`

File: `src/frontend/web/src/lib/avatar/AnimationManager.ts`

Responsibilities:

- Own `THREE.AnimationMixer`.
- Load VRMA clips, cache clips, and play/crossfade actions.
- Track active actions and metadata (blend mode, additive ref, loop mode, etc.).

Important behavior:

- `playLoop(...)` and `playGesture(...)` are wrappers over `playAnimationWithName(...)`.
- `playGesture(...)` forces `loopType="once"`.
- Planner-owned idle stints use `playLoop(...)` with the production manifest
  `loop_type`, `loop_count`, and `time_scale`, then `stopAction(...)` when the
  computed finite stint duration elapses.
- Natural mixer `finished` events release the completed action; `Avatar` wraps
  VRMA playback callbacks so finite actions can fade the visible base back to
  `relaxedRest`.
- Supports additive clips when `blendMode="additive"` and an additive reference is supplied.
- Stops and cleans up stale actions/timers on fade completion and mixer `finished` events.
- `resetAll()` also resets humanoid pose when possible.
- The Animation Debug modal exposes a global **Root VRMA playback** toggle. When
  enabled, `AnimationManager` regenerates VRMA clips without `.position`
  translation tracks, so Mixamo-style root/hips translation does not move the
  avatar through the scene. Rotation, expression, and look-at tracks still play.
  Changing the toggle clears generated clip caches and restarts active VRMA
  playback through the normal planner/manual paths.

### `PoseController`

File: `src/frontend/web/src/lib/avatar/poses/PoseController.ts`

Responsibilities:

- Own the built-in JSON-backed `animaPose/1.0` catalog for loaded VRM models.
- Own the built-in JSON-backed `animaPoseClip/1.0` catalog and active clip
  playback state for loaded VRM models.
- Apply the app default `relaxedRest` catalog pose after load and after avatar
  resets.
- Invoke catalog poses as absolute normalized humanoid poses, not offsets from
  `relaxedRest` or from the previously active pose.
- Sample timed pose clips every frame when a clip is explicitly started through
  `Avatar.playClip(...)` or `Avatar.playAnimaPoseClip(...)`.

Important behavior:

- `applyPose(poseId)` resolves any `AnimaPose.parent` chain, clears other
  active PoseController state, resets the VRM humanoid to its normalized
  T-pose, then applies exactly one resolved catalog pose.
- `applyPose(poseId)` does not apply `relaxedRest` before other poses.
  `relaxedRest` is only the app default because `Avatar` explicitly applies it
  on load/reset through `applyDefaultPoses(...)`.
- Parent pose inheritance uses sparse absolute overrides, not quaternion
  deltas. Missing child humanoid targets inherit from the resolved parent;
  child-defined values replace the inherited field. Humanoid inheritance
  defaults on, expression inheritance defaults off.
- Expression values authored by a pose are restored to their captured
  pre-pose values when switching or clearing poses, so pose expression weights
  do not leak into later states.
- One active PoseController output is allowed at a time. Applying a static pose
  clears any active clip, and playing a clip clears active static pose state.
- Active clips are sampled after VRMA mixer output and before procedural
  animation layers. Procedural layers therefore remain additive on top of the
  sampled clip.
- Clips can define optional `fadeIn` and `fadeOut` playback envelopes. Fade-in
  blends from the current normalized avatar pose into the sampled clip, while
  fade-out blends sampled clip output back to the app default pose path
  (`relaxedRest` today) before automatic playback resumes. Pose clip events are
  not newly dispatched during fade-out; active VFX events remain owned by the
  clip and clear when their event duration expires or when the clip fully
  stops.
- Clips can define optional `playback.lifetime` rules. A non-loop clip with a
  playback lifetime plays its authored timeline once, holds the final sample,
  and exits only when the planner/user stops it. A loop clip with a playback
  lifetime loops while that lifetime remains active.
- Loop clips should author the repeating body of the motion directly and use
  `fadeIn`/`fadeOut` for entry and exit instead of adding `relaxedRest`
  endpoint keyframes solely for runtime transitions.
- Active clips also evaluate optional effect events while playback advances.
  `PoseController` owns scheduling and diagnostics; runtime adapters owned by
  `Avatar`, scene VFX, and sound perform the actual avatar VFX, scene VFX, and
  SFX side effects.
- `Avatar.playClip(...)` temporarily suspends automatic VRMA playback while the
  clip is active and restores the previous automatic-playback setting when the
  clip stops. If automatic playback is restored, the next planner-owned VRMA
  plan gets a short resume fade so the handoff does not snap from the final
  pose-clip output.
- Non-looping clips without `playback` stop automatically at their duration,
  restore expression baselines, and return the avatar to the normal default
  pose/runtime path.
- VFX events can remain active for a duration and are cleaned up when the clip
  stops, switches, resets, or unloads. VFX events without duration remain
  active until the owning clip clears. SFX events are one-shot events and are
  not replayed during manual scrub preview or a held final sample.
- The animation debug modal's `PoseController` section lists built-in catalog
  poses and invokes them through `Avatar.applyPose(...)` with procedural
  offset preservation enabled.
- The animation debug modal's `PoseController Clips` section lists the mounted
  Anima catalog clips and invokes them through `Avatar.loadAndPlayClip(...)` and
  `Avatar.stopClip()` with procedural offset preservation enabled. The UI does
  not sample clip data directly; it reads the runtime `AvatarPoseClipSnapshot`
  for active clip id, elapsed time, resolved targets, missing targets, and
  missing pose refs. The same snapshot reports effect-event totals by kind,
  fired/active runtime counts, chat availability, skipped events, and the
  latest event adapter error when present.
- The animation debug modal's `Reactions` section lists clips mounted in the
  reaction runtime slot and resolves them lazily through debug-only
  `ReactionClipPlayer` APIs, and shows both live reaction playback state and
  planner reaction diagnostics. Manual debug reaction playback is runtime-only:
  it does not enqueue planner events or mutate canonical emotion state.

### Pose and clip JSON artifacts

`AnimaPose` and `AnimaPoseClip` are separate `1.0` JSON artifacts:

- `animaPose/1.0` is a single absolute pose snapshot. It can contain partial
  normalized humanoid bone transforms, expression weights, and an optional
  `parent` ref to another catalog pose. `parent` fills missing targets before
  application; no `parent` means omitted static-pose bones fall back to the VRM
  normalized T-pose after `PoseController` resets the humanoid. The built-in
  catalog makes this fallback explicit for default/rest authoring by storing
  `vrmTPose` as a concrete all-identity catalog pose and making `relaxedRest`
  inherit from it.
- `animaPoseClip/1.0` is a timed sequence. It contains clip metadata,
  optional `role`, optional `basePose`, optional `playback`, optional
  `fadeIn` / `fadeOut` playback envelopes, local pose aliases, pose keyframes,
  and transition settings. `role` is accepted only as legacy compatibility
  metadata (`"motion"` or `"reaction"`); parsing no longer injects a default,
  and runtime routing does not inspect it. The effective loadout collection
  determines whether a generic clip runs as a gesture, pose, or reaction.
  Built-in JSON directories likewise determine legacy App catalog membership.
  Local poses can be inline snapshots or `{ "ref": "catalogPoseId" }`
  references. Clips may also include timed `events` for avatar VFX, scene VFX,
  and SFX. Those events store catalog ids, not embedded effect assets. An
  effect-only clip may use empty `poses` and `poseKeyframes` collections as long
  as it contains at least one valid event; the editor does not manufacture a
  neutral expression landmark merely to carry VFX or sound.
- Clip `duration` is required when `playback` is absent. When `playback` is
  present, `duration` may be omitted; runtime helpers derive the authored
  timeline extent from pose keyframe times and event trigger times. VFX event
  duration does not extend the authored timeline because it describes the
  event lifecycle, not pose/expression sampling.
- `playback.lifetime.kind: "whileInteractionPhase"` keeps a planner-owned clip
  eligible while the current interaction phase is in `phases`. Reaction clips
  use this with `phases: ["talking"]` and `scope: "activeRun"` so they fade in
  and hold for the same speaking run, then fade out when talking ends or the
  run changes. `whileAvatarState` is available for future state-owned clips.
- Clip fade envelopes are objects with `duration` plus optional `easing` and
  optional interpolation overrides. Fade interpolation is usually omitted: it
  resolves from `fadeIn`/`fadeOut`, then `defaultTransition`, then the schema
  defaults (`slerp` rotation, linear position/expression), so a clip only needs
  a fade-local interpolation when entry/exit blending should differ from normal
  keyframe blending.
- Clip easing values include linear, sine, cubic, and stylized `back`,
  `elastic`, and `bounce` curves. The stylized curves are soft-blended with
  `easeInOutSine` so humanoid motion remains smoother than raw back, elastic,
  or bounce easing. They are still best reserved for playful gestures, VFX,
  props, or intentionally cartoon-like motion because they can overshoot or
  oscillate around the destination.
- Clip refs resolve through the same parent-aware catalog path used by static
  poses. Sampling precedence is `clip.basePose`, then
  `resolved pose parent chain`, then `keyframe child overrides`.

### Mounted motion catalog

`src/frontend/web/src/lib/avatar/motion/AvatarMotionCatalog.ts` defines the
small runtime boundary consumed by `Avatar`, `AvatarPlanner`,
`PoseController`, and preload planning. The explicit built-in implementation
adapts the existing animation/pose/reaction registries for standalone creator,
preview, and compatibility surfaces.

Live Anima routes instead build
`src/frontend/web/src/lib/runtime-content/AnimaRuntimeCatalog.ts` from the exact
frozen `GET /v1/animas/{anima_id}/runtime` response. It projects only
that Anima's effective idle, gesture, pose, and reaction entries. Removing a
Starter binding therefore removes it from the next mount; another Anima's
similarly named content release cannot be discovered through a global lookup.

VRMAs resolve to verified prepared resources for the active mount. Their cache
identity is `runtime_id + content_revision`, not a short-lived protected URL. Idle entries
use resolved emotion weights and finite loop metadata; preload tiers come from
the binding configuration. Private pose/reaction manifests stay lazy, have a
2 MiB streamed-read limit, parse once, and are aborted/released when their
catalog is disposed. User clip event references are accepted only when their
SFX/VFX runtime IDs occur in the same effective response. Duplicate or invalid
motion identities are omitted with safe diagnostics. Effect and audio resources
resolve through the mounted media providers with the same revision and
prepared-byte boundary.

The Animation Debug modal and the compact Anima debug panel list the mounted
catalog rather than the process-global motion inventory. The compact panel can
play both active VRMA entries and `animaPoseClip` gestures, while the larger
modal can manually resolve mounted Gesture and Reaction releases by runtime ID.
Standalone authoring pages explicitly receive the built-in provider and never
acquire private Anima resources implicitly.

Expanding the compact panel's Active Motion Catalog does not enable the
500 ms live animation-snapshot publisher. Catalog membership is static for the
route mount, so it renders without polling; current playback and fade telemetry
belongs to the separate Active Actions section, which opts into live snapshots.

Built-in runtime assets behind the App provider live under:

- `src/frontend/web/src/lib/avatar/poses/pose_catalog.json`
- `src/frontend/web/src/lib/avatar/poses/json/*.json`
- `src/frontend/web/src/lib/avatar/poses/json/clips/*.json`
- `src/frontend/web/src/lib/avatar/poses/json/clips/reactions/*.json`

`catalog.ts` validates these files on load and exposes raw and resolved pose
helpers. Missing, invalid, duplicate, or id-mismatched pose/clip entries are
skipped with console warnings instead of breaking app startup. Poses whose
parent chain cannot resolve are also skipped, so UI lists only usable catalog
poses. `getAvatarPose(...)` returns the raw catalog artifact, while
`getResolvedAvatarPose(...)` returns a parent-free clone from a cached resolved
catalog path so per-frame clip playback does not repeatedly walk parent
chains. To register an exported clip for runtime debug playback, add the clip
JSON under `poses/json/clips/` and add its id/path metadata to
`pose_catalog.json`.

Reaction clips are loaded separately from `poses/json/clips/reactions/` by file
name. The canonical catalog contains 72 files: each `TRACKED_EMOTIONS` value
from `src/frontend/web/src/lib/emotion` at intensities `1`, `2`, and `3`, using
`<emotion>-<intensity>.json` ids. Reaction clips are not added to
`pose_catalog.json`, do not run through `Avatar.playClip(...)`, and are skipped
if channel analysis finds any humanoid transforms. This strict authoring rule
applies to built-in and private Reaction releases. Playback projects Reaction
sequences to expressions/events and defensively ignores humanoid samples.
Selection is canonical-only: exact tracked emotion tones
resolve to matching clips, while `neutral`, blank, unknown values, and group
names such as `alarm` produce no clip. The clips are
playback-scoped to same-run `talking`, so a single peak expression or VFX event
can hold without looping or replaying SFX. Level 1 clips are expression-only.
Selected level 2 and 3 clips add avatar VFX and one particle VFX event; level 3
clips can also add the `scene-vfx-emotion-<emotion>` background preset plus
stronger avatar VFX. The `presentation.disable_vfx` preference suppresses
clip-owned avatar, scene, and particle VFX from pose/reaction playback while
leaving SFX and manual/debug VFX controls unchanged.

The catalog includes a concrete `vrmTPose` JSON pose with identity rotations
for every `VRMHumanBoneList` bone. `relaxedRest` inherits from this pose so
omitted relaxed-rest bones still resolve to explicit T-pose anchors. This keeps
sparse child poses, such as clips that add `neck`, interpolating from identity
instead of snapping from a missing source rotation.

Runtime pose application checks `vrm.meta.metaVersion` through `isVrm0(...)`.
VRM 1.x models use the catalog's normalized rotations unchanged. VRM 0.x models
use `retargetPoseForVrm0(...)` and `retargetClipSampleForVrm0(...)` at the
runtime application boundary, treating the built-in JSON pose catalog as VRM
1-authored data and converting it into the VRM 0 normalized basis before
`setNormalizedPose(...)`. The conversion flips authored position X/Z values and
conjugates quaternion rotations with the equivalent `[-x, y, -z, w]` component
mapping. The conversion is centralized in
`poses/poseRetargeting.ts` without changing the `animaPose/1.0` or
`animaPoseClip/1.0` schemas.

Typed Gesture and Reaction editors reuse the shared timeline, pose, expression,
and preview primitives through their product routes. They keep an editable
client document and resolve its component dependencies into an editor-owned
sandbox. Playback belongs to the timeline Play/Pause/Stop/Restart controls and
does not persist the Action. Save sends the sequence or VRMA file and its
descriptor through `saveCatalogItem(...)` to the typed catalog Save endpoint.
Updates include the catalog item ID and expected revision; the backend validates
and atomically updates readable Local files. Save & Equip uses the saved catalog
selection in the reviewed Anima loadout flow. Existing and starter Actions use
typed preview reads to hydrate protected files and dependency runtime.

There is no separate generic Pose Creator route or raw package save provider.
Clip JSON remains `animaPoseClip/1.0`; a separate versioned project envelope is
available when typed effect/sound dependencies must round-trip with the sequence.

For an Action implemented by `animaPoseClip/1.0`, the Action display name is
the authoritative authoring name. The embedded clip `name` matches it, and the
clip `id` is its normalized lowercase ASCII kebab-case form. Creator rename,
load, import, JSON export, and Save boundaries all reapply this invariant, so
generic timeline identities such as `pose_creator_clip` cannot leak into newly
saved Gesture or Reaction files.

Saving updates the Local catalog item. It does not advance immutable releases
or hot-swap a mounted chat: active chats retain their prepared bytes until
reopened. See [Local content runtime](../architecture/local-content-runtime.md)
for revision checks, preparation, and recovery behavior.

### `AvatarPlanner`

File: `src/frontend/web/src/lib/avatar/planner/AvatarPlanner.ts`

Focused guide: `docs/frontend/runtime/avatar-planner.md`

Responsibilities:

- Decide state-triggered motion actions from:
  - animation signals (`interactionPhase`),
  - current emotional state,
  - generic avatar planner events such as `runStarted`, `emotionUpdated`, and
    `gestureRequested`,
  - expression reaction events such as `emotionReactionUpdated`.

Base-state mapping from `interactionPhase`:

- `talking -> talking`
- `responding_no_tts -> talking`
- `thinking/submitting -> thinking`
- `listening/user_speaking/semantic_check -> listening`
- `user_typing -> idle` for base VRMA selection
- fallback `idle`

Plan behavior:

- Non-idle interaction phases use procedural policies, planner-owned pose
  clips, and selected gestures rather than hidden manifest base-loop lanes.
- Intermittent idle VRMA stints for idle state. The idle path reads
  `manifest.json`, waits through a configurable quiet interval, plays one
  eligible finite idle VRMA, then stops it and returns to quiet.
- One-shot gesture plans start when:
  - phase allows gestures (`idle` or `talking`),
  - a pending `gestureRequested` planner event matches the active run.
- Manifest `type: "vrma"` gesture ids play through `AnimationManager`.
- Manifest `type: "animaPoseClip"` gesture ids play through
  planner-owned `PoseController` clips.
- Keeps VRMA gestures active until their computed end time. Pose-clip Gestures
  also receive a bounded planner deadline derived from authored duration (with
  a short default minimum), so a clip authored with `loop: true` cannot pin a
  non-TTS chat run indefinitely. Natural clip completion, run fencing, and
  phase changes may still end the Gesture sooner.
- Resolves `gestureRequested.animationHint` as a production manifest gesture id.
- Consumes `emotionUpdated` events every time with a debug reason. Emotion
  updates no longer create paired gesture requests.
- Emits consumed planner event ids so the frame loop can remove exact events
  from the store.
- Uses plan keys prefixed with `gesture:` vs `loop:` to avoid collisions between one-shot and loop plans for the same clip.
- Runtime-facing transitions are limited to enforced policies:
  `fadeIn` / `crossfade` on entry and `fadeOut` on exit. Idle VRMA stints emit
  an explicit faded stop on completion using the same duration as the active
  plan's entry crossfade; other natural completion is represented by not
  emitting a stop or replacement action.
- Selects optional thinking PoseController clips from `runStarted` events using
  the shared prompt-length chance table.
- Keeps selected thinking clips pending until the avatar remains in `thinking`
  for the configured dwell time, default `600ms`.
- Cancels planner-owned thinking clips outside `thinking` and never treats a
  planner-owned active clip as a manual/debug clip.
- Selects a stable listening procedural stint once on listening or
  `user_typing` entry: `bounce` has 40% chance, `headNod` has 40% chance, and
  the remainder selects no listening procedural layer. `user_typing` keeps the
  idle base VRMA loop while borrowing this procedural policy.
- Enables planner-owned `talkingHands` while talking only after same-run
  emotion arbitration confirms no manifest gesture request is pending. A
  selected or requested manifest VRMA or `animaPoseClip` gesture bypasses that
  fallback for the run, so talking hands cannot start before a late request is
  known.
- Emits a compact debug snapshot that reports current phase/base state,
  planner-owned VRMA, planner-owned pose clip, talking-motion arbitration,
  pending events, procedural stints, cancellation reasons, and ignored request
  reasons.
- The Animation Debug modal's Avatar Planner section lists only Gestures from
  the mounted frozen catalog and can queue one through the normal runtime store.
  This exercises the same planner arbitration as chat without relying on model
  prompt compliance. The console lifecycle uses bounded `accepted`, `loading`,
  `playing`, `completed`, and `rejected` diagnostics and omits private URLs.

### `ExpressionController`

File: `src/frontend/web/src/lib/avatar/ExpressionController.ts`

Responsibilities:

- Manage expression weights and transitions.
- Apply emotion presets by intensity (`EMOTION_INTENSITY_MAP`).
- Run auto-blink.
- Provide lip-sync timeline APIs (segment/frame registration, sampling, interpolation, decay).

Important behavior:

- Emotion weights fade toward targets over time (`EMOTION_FADE_SPEED`).
- Blink is auto-driven while respecting emotion-provided baseline blink. The
  blink scheduler samples a non-zero, center-biased open wait bounded by
  `BLINK_OPEN_MAX`, eases eyelids closed and open, randomizes the fully closed
  hold with `BLINK_CLOSE_MAX`, and occasionally schedules shorter partial
  follow-up blinks.
- Lip-sync has:
  - segment scheduling by audio start,
  - interpolation between frames,
  - transition blending between segments,
  - post-segment decay back to neutral.

Note: chat request now wires viseme input queuing for Pocket TTS when TTS is enabled.

### `ProceduralAnimationController`

File: `src/frontend/web/src/lib/avatar/ProceduralAnimationController.ts`
Layer files: `src/frontend/web/src/lib/avatar/proc-animation/*`

Responsibilities:

- Own optional code-generated animation layers that run alongside VRMA clips.
- Clear prior-frame additive offsets before the mixer writes the next pose.
- Apply procedural layers after the mixer writes the base pose.
- Manage smooth layer activation/deactivation for manual debug controls and
  planner-owned policy actions.
- Forward per-frame speech timing from the canvas actor to layers that need
  real audio playback windows.

Important behavior:

Current layers include breathing, idle sway, bounce, listening head nods,
curious head-side tilt, idle cursor look-at, talking-hands gestures, and
emotion posture. The `cursorLookAt` layer owns `vrm.lookAt.target` while
active; `ExpressionController` does not install a camera-owned look-at target.
Cursor look-at normalizes pointer coordinates against the active WebGL canvas,
measures movement from the camera-projected look-at origin at the eyes, mirrors
horizontal cursor offsets for VRM0 `faceFront = -Z`, and keeps VRM1 neutral
gaze from depending on raw window center. The same smoothed target delta also
drives conservative additive head, neck, and torso follow offsets, with
separate visual-axis compensation for VRM0 horizontal body yaw and VRM1
vertical body pitch.
In native Desktop PiP, the layer can receive an Electron global-cursor provider
instead of DOM `pointermove`; this lets the PiP avatar follow the desktop cursor
outside the PiP window and while Anima is unfocused, while preserving the same
idle-only tracking windows and calibrated mapping.

Default activation policy:

- `breathing` is enabled by default.
- `sway` is enabled by default, but only contributes visible motion during idle
  windows. The current default requests 10 seconds of sway about every 60
  seconds with 2.0 second enter and 2.4 second exit blends.
- `headSideTilt` is enabled by default as scheduled curious motion.
- `cursorLookAt` is enabled by default, but only contributes while idle and
  inside its tracking windows.
- `bounce`, `headNod`, `talkingHands`, and `emotionPosture` are disabled by
  default. The avatar planner can policy-enable `bounce` or `headNod` during
  listening, `talkingHands` during talking after no-hint emotion arbitration,
  and `emotionPosture` whenever the dominant emotion group is `gloom`,
  `revulsion`, or `rejection` with an enabled level 1-3 posture preset. The
  controller executes those actions and
  disables planner-owned activations again when policy no longer wants them;
  manually enabled debug layers are left alone.

Procedural offsets are frame-local. `Avatar.update(...)` clears each layer's
previous additive offsets before the mixer writes the clip pose, then active
layers rebuild their offsets after clip animation for that frame.

Debug controls in the animation debug modal tune procedural parameters at
runtime. They do not persist defaults by themselves.

#### Emotion posture procedural layer

- File: `src/frontend/web/src/lib/avatar/proc-animation/EmotionPostureProceduralAnimationLayer.ts`
- Params: `src/frontend/web/src/lib/avatar/proc-animation/types.ts`
- Debug UI: `src/frontend/web/src/ui/debug/AnimationDebugModal.tsx`

The `emotionPosture` layer is a single additive posture layer for emotion body
language. It resolves the avatar's dominant emotion group from the full
`EmotionRuntimeState`, chooses that group's level 1, 2, or 3 posture intensity,
scales the group's single authored posture target by that intensity, and blends
head, neck, torso, and shoulder offsets toward the scaled target. Neutral
emotion state, intensity level 0, a disabled global planner gate, or a disabled
dominant-group preset resolves to no posture target.

Posture targets are authored in the same VRM1-style basis used by
`PoseController` catalog poses: VRM1 faces +Z, so positive local X pitch bends
the torso/head forward and negative local X pitch opens or leans back. For VRM0
models, `EmotionPostureProceduralAnimationLayer` retargets the authored
quaternion offsets by flipping the X and Z quaternion components, matching
`PoseController`'s VRM0 retargeting rule.

The supported default presets are Gloom, Revulsion, and Rejection. Gloom is the
clearest preset: disappointment, grief, and sadness lower the head, round the
upper body, and droop the shoulders more strongly as the emotion level rises.
Revulsion uses a pronounced recoil and turn-away posture for disgust,
embarrassment, and remorse. Rejection uses a strong forward, squared posture for
anger, annoyance, and disapproval. Other dominant emotion groups do not drive
posture.

By default, Gloom scales its single target at 0.3 for level 1, 0.5 for level 2,
and 0.7 for level 3. Revulsion scales at 0.15, 0.30, and 0.45. Rejection scales
at 0.20, 0.30, and 0.40. The debug modal can tune those per-group level
intensities directly.

The animation debug modal has an `Emotion Posture` section with:

- a planner gate, live runtime enabled toggle, and debug mode override,
- enter blend and exit blend sliders,
- supported-group preset toggles and level-intensity sliders,
- a single target editor for each supported posture group,
- the currently resolved group, level, primary emotion, reason, selected level
  intensity, effective activation intensity, active target, and blended current
  target.

`Planner gate` controls whether `AvatarPlanner` is allowed to automatically
enable emotion posture from the live emotion state. `Runtime enabled` is the
current layer activation flag itself; toggling it manually takes the layer out
of planner ownership like other procedural debug controls. `Debug mode`
temporarily enables the layer and resolves posture from the selected debug
group and level instead of the live avatar emotion state. Turning debug mode
off disables that manual layer activation so normal planner ownership can
resume if the live emotion state still qualifies.

#### Talking-hands procedural layer

- File: `src/frontend/web/src/lib/avatar/proc-animation/TalkingHandsProceduralAnimationLayer.ts`
- Params: `src/frontend/web/src/lib/avatar/proc-animation/types.ts`
- Debug UI: `src/frontend/web/src/ui/debug/AnimationDebugModal.tsx`

The `talkingHands` layer is an additive procedural gesture scheduler for
speech. It does not own the avatar's static relaxed arms-down pose; that
base comes from the active `PoseController` catalog pose, usually the
explicitly applied default `relaxedRest` pose. Talking hands contributes
temporary offsets on top of the current clip/rest pose while the layer is
active.

Activation:

- The layer default is `enabled=false`.
- `AvatarPlanner` can request policy enablement while `avatarState="talking"`;
  it does so only after same-run emotion arbitration confirms no primary-chat
  gesture request has claimed talking motion. `ProceduralAnimationController`
  owns the activation blend and offsets.
- The animation debug modal exposes a one-shot Play control instead of a
  persistent talking-hands toggle. Pressing Play enables the layer if needed
  and restarts a single randomized group using the current slider values.
- The Talking Hands debug section also shows the last live TTS speech-plan
  diagnostics, including chunk decisions, selected pulse apexes, and skipped
  beat reasons. When the last plan is playable, Replay TTS replays that same
  speech-planned group without requiring a new chat response. The last
  speech-plan diagnostics remain visible after the chat turn ends and the
  policy-enabled layer deactivates.
- The same section exposes live TTS timing controls for minimum primary-stress
  beat spacing, gesture entry, entry grace, gesture return, pulse attack, pulse
  release, and the ordinary sentence-chunk skip chance.
- When the layer is disabled or its weight/intensity reaches zero, it clears
  its additive offsets and scheduled playback state.
- During deactivation, the controller stops the layer from starting new gesture
  groups; current offsets fade through the generic layer activation weight.
- While `avatarState="talking"`, gesture groups require a speech timing context
  from Pocket TTS or ElevenLabs audio playback. Browser TTS does not currently
  provide this audio-clock timing context, so policy activation alone is not
  enough to start talking-hands groups.
- If talking hands are enabled after speech audio has already started, the
  layer uses the live speech timing context and skips elapsed beats rather than
  replaying earlier hand motion.
- Manual debug animation outside `avatarState="talking"` still runs without
  live TTS timing.

Execution paths:

- Debug Play is an immediate manual sample. It does not require
  `avatarState="talking"`, TTS chunk metadata, a speech gesture timeline, or
  audio-clock timing. The modal sends one play request, the layer builds one
  randomized group, and playback starts immediately.
- Debug Play uses `gestureDurationSec / speed` as the group duration. The group
  uses fixed entry/middle/return proportions: about 28% entry, 44% middle, and
  28% return. If micro motion is enabled, the entry target is the first sampled
  micro-pulse pose rather than a separate base gesture pose.
- Debug Play schedules `microBendCount` pulse cycles. It samples optional pause
  durations between pulses from `microBendPauseChance`,
  `microBendPauseMinSec`, and `microBendPauseMaxSec`, so two Play clicks with
  the same sliders can still have different internal timing.
- Debug Play randomizes the group-level pose once per group: one-hand vs
  both-hand mode, selected side for one-hand groups, base elbow bend, both-hand
  bend asymmetry, elbow side drift, shoulder-forward amount, palm direction,
  and active-side rest finger curl jitter.
- Debug Play also samples pulse-level variation for each micro pulse. Finger
  uncurl uses per-finger variance, thumb uncurl uses thumb variance, hand flex
  samples inside the configured signed range, and secondary micro twist samples
  inside `secondaryMicroTwistMin..secondaryMicroTwistMax`.
- Live TTS synchronization is a speech-planned path. It only starts groups
  while the avatar is talking and the lip-sync bridge exposes audio-clock
  timing, TTS chunks, and a speech gesture timeline for the active `runId`.
  Pocket TTS and ElevenLabs can provide audio-clock timing and
  actual-duration-scaled gruut timing.
  Replay TTS in the debug modal reuses the last speech-planned request, so it
  follows this TTS path rather than the randomized debug Play path.
- Live TTS timing is driven by selected primary-stress beats inside one TTS
  chunk. It waits until the first usable beat is close enough for the configured
  entry envelope, schedules each pulse apex at its selected beat time, stretches
  base-pose holds to wait for later beats, and returns over
  `speechGestureReturnSec`.
- Live TTS still samples the visible pose when it starts a group: the ordinary
  side is stable for the whole speech run, exclamation chunks use both hands,
  group-level elbow/palm/rest-jitter values are sampled per played chunk group,
  and pulse-level finger/thumb/hand-flex/secondary-twist values are sampled per
  selected beat.
- Live TTS does not use randomized micro-pause durations. Beat spacing comes
  from the selected speech beat times, filtered by `speechBeatMinSpacingSec`.
  Its planned `pulseScale` is currently fixed at `1`, so the main micro bend,
  primary micro twist, thumb unspread amount, and micro head nod amount are not
  varied by beat unless their runtime params change. The current per-beat
  variation comes from the sampled finger/thumb uncurl, hand flex, and
  secondary twist channels.

Scheduling model:

- The layer plays one group at a time. It does not autonomously alternate
  pauses and groups.
- Debug Play uses `gestureDurationSec`, scaled by `speed`, as the manual group
  duration. The legacy `pauseMinSec` and `pauseMaxSec` params are kept for
  compatibility but are not used by talking-hands playback.
- In `avatarState="talking"`, the layer waits until TTS chunk metadata and a
  speech gesture beat timeline are available, then attempts at most one group
  per eligible TTS chunk. It can use provisional gesture timing before actual
  audio duration is resolved so early chunk beats are not missed unnecessarily.
- TTS chunks provide word ranges; the run-level speech gesture timeline provides
  primary-stress beat times from gruut phoneme units. Chunks with no
  primary-stress beats are skipped automatically.
- Ordinary chunks sample one stable left/right hand for the whole speech
  `runId` and can be skipped by `speechChunkSkipChance`. Exclamation chunks
  with usable beats bypass random skipping and use both hands.
- If duration or timeline data arrives after early beats have passed, those
  beats are skipped without speeding up the remaining gesture. Later usable
  beats in the same chunk can still play.
- Live TTS uses an explicit main gesture envelope. `speechGestureEntrySec`
  controls the neutral-to-first-pulse entry stroke, and
  `speechGestureReturnSec` controls the final return to neutral. Beats that are
  too early for the configured entry envelope, minus
  `speechGestureEntryGraceSec`, are skipped instead of causing a rushed hand
  raise.
- Beat selection uses the chunk/window end as the final beat cutoff, not
  `chunkEnd - speechGestureReturnSec`. If a selected beat lands near the end of
  the chunk, the return envelope starts after that beat and may slightly overrun
  the chunk instead of deleting the beat.
- Micro-pulse apexes are scheduled to land on selected beat times; nearby beats
  hold the base gesture pose between pulses instead of forcing the group to
  reset.
- Manual debug groups choose one-hand or both-hand playback from
  `oneHandChance` and `bothHandsChance`.
- Active elbows sample a base bend from `elbowBendMin..elbowBendMax`.
- Both-hand groups can add `elbowBendAsymmetry`, splitting a sampled signed
  bend difference across left and right hands.
- Elbow side drift samples one signed value from
  `elbowSideDriftMin..elbowSideDriftMax` and mirrors it by side in the apply
  path.
- `shoulderForward` samples a signed shoulder-forward amount up to the
  configured magnitude; `shoulderBeat` follows elbow bend magnitude.
- `palmDirectionRange` samples a signed base palm direction around the inward
  default so the palm can trend downward, inward, or upward on a continuum.

Gesture shape:

- Each group starts at neutral procedural offsets and moves into a stroke.
- If micro motion is active, the stroke target is the first micro pulse rather
  than a separate base-pose stop. This makes gesture entry and the first micro
  movement read as one motion. Live TTS uses the same shape for the first
  selected speech beat through `speechGestureEntrySec`.
- `microEntryBlend` controls how long the first micro pulse settles back into
  the base gesture pose.
- Debug Play schedules `microBendCount` randomized pulse cycles. In live TTS,
  `microBendCount` is the maximum selected speech beats for one TTS chunk
  group; if a chunk has fewer usable beats, the group has fewer pulses.
- Live TTS beat selection enforces `speechBeatMinSpacingSec`, then caps
  selected primary-stress beats to `microBendCount`. Timing and cap skips are
  recorded in speech-plan diagnostics.
- Optional base-pose holds between later pulses are sampled from
  `microBendPauseChance`, `microBendPauseMinSec`, and
  `microBendPauseMaxSec` during debug playback. Live TTS instead lengthens
  holds as needed to wait for the next selected speech beat.
- `speechBeatPulseAttackSec` and `speechBeatPulseReleaseSec` tune later live
  TTS pulse envelopes around selected beat times; the pulse apex remains tied
  to the beat time when enough schedule space is available.
- The return segment eases back to neutral procedural offsets over
  `speechGestureReturnSec` during live TTS. The return duration shapes the exit
  motion; it is not a strict reservation that prevents end-of-chunk beats from
  playing.

Current live TTS timing defaults:

| Param                        | Default | Effect                                                                                              |
| ---------------------------- | ------: | --------------------------------------------------------------------------------------------------- |
| `speechGestureEntrySec`      | `0.56s` | Duration of the neutral-to-first-pulse entry stroke.                                                |
| `speechGestureEntryGraceSec` | `0.08s` | Tolerance that keeps a small frame miss from skipping an otherwise usable first beat.               |
| `speechGestureReturnSec`     | `0.56s` | Duration of the final return to neutral.                                                            |
| `speechBeatMinSpacingSec`    | `0.40s` | Minimum spacing between selected primary-stress beats in a chunk.                                   |
| `speechBeatPulseAttackSec`   | `0.40s` | Maximum lead-in time for later pulses before their beat apex.                                       |
| `speechBeatPulseReleaseSec`  | `0.40s` | Maximum settle time after a pulse before holding the base pose.                                     |
| `speechChunkSkipChance`      |  `0.30` | Random skip chance for ordinary non-exclamation chunks only.                                        |
| `microBendCount`             |     `8` | Exact pulse count for debug Play; maximum selected beat count per live TTS chunk group.             |
| `gestureDurationSec`         | `2.00s` | Manual debug Play duration only; live TTS group timing comes from speech beats and envelope params. |

Speech-plan diagnostics:

- `status` is `ready`, `waiting`, or `skipped`. Waiting means the required
  speech data exists but the first usable beat is still in the future.
- `scope` is usually `chunk` during live TTS. The older `utterance` scope
  remains in the planner/replay types for compatibility.
- `windowEndSec` is the selected chunk/window end used for beat cutoff.
- `returnStartSec` is the planned start of the final return after the selected
  beats are laid out.
- `selectedBeats` are the primary-stress beats that became pulse apexes.
- `pulseApexes` records each beat time, planned apex time, drift, and
  `pulseScale`. `pulseScale` currently remains `1`.
- Chunk skip reasons include `missing_beat_timeline`, `no_primary_beats`,
  `no_usable_beats`, `random_skip`, and `planner_skipped`.
- Beat skip reasons include `too_early_for_gesture_entry`,
  `after_window_end`, `too_close_to_previous_beat`, and
  `exceeds_max_pulse_count`.

Arm, wrist, and palm motion:

- `microBendAmount` adds to the active elbow bend during each micro pulse. In
  the current live TTS planner this amount is multiplied by fixed
  `pulseScale=1`, so selected beats do not yet get stronger/weaker elbow
  pulses from the speech plan.
- `microTwistAmount` applies primary micro twist through the configured
  `microTwistMode`:
  - `forearmRoll`: lower-arm roll only.
  - `forearmRollWithHandFollow`: lower-arm roll plus local hand follow.
  - `handOnly`: hand twist only.
- `secondaryMicroTwistMin..secondaryMicroTwistMax` samples a per-pulse
  secondary twist on `secondaryMicroTwistAxis`, which can be `x`, `y`, or `z`.
- `microHandFlexAmount` is sampled per pulse as a signed maximum. For example,
  `30deg` samples `0..30deg`; `-30deg` samples `-30..0deg`.
- Hand flex uses the same mirrored local hand `Z` axis family as the relaxed
  hand pose and intentionally bypasses rendered-pose lag so the wrist accent
  stays crisp.
- `microHeadNodAmount` rides the same micro-pulse schedule and contributes
  small spine/chest/neck/head offsets.

Finger and thumb motion:

- Rest finger curls are configured independently with
  `restIndexFingerCurlOffset`, `restMiddleFingerCurlOffset`,
  `restRingFingerCurlOffset`, and `restLittleFingerCurlOffset`.
- Thumb rest shape is split across `restThumbCurlOffset`,
  `restThumbMetacarpalCurlOffset`, `restThumbProximalCurlOffset`,
  `restThumbDistalCurlOffset`, and `restThumbSpreadOffset`.
- Rest finger/thumb curl offsets are gesture-scoped. They blend in during
  gesture entry and back out during return for the selected active side or
  sides only. An inactive hand does not receive talking-hands rest curl offsets
  just because the layer is active.
- `restFingerCurlJitter` samples stable per-group rest curl offsets for index,
  middle, ring, and little fingers on active sides. The sampled jitter stays
  fixed for the whole gesture group and blends with the same gesture envelope.
- `microFingerUncurlAmount` drives the main finger release on each micro pulse,
  but the layer samples independent index/middle/ring/little values using
  `microFingerUncurlVariance` so the hand does not open as one rigid shape.
- Thumb uncurl is sampled independently using the effective thumb amount
  `microFingerUncurlAmount + microThumbUncurlAmount`, then varied by
  `microThumbUncurlVariance`.
- `microThumbUnspreadAmount` and the linked finger-release spread signal relax
  the thumb spread during the pulse.
- Finger bones use fixed proximal/intermediate/distal multipliers, then apply
  `fingerLagSec` plus extra proximal-to-distal lag so fingertips trail the base
  knuckles.
- `fingerCascadeLag` scales per-finger timing so index can lead, middle stays
  near baseline timing, and ring/little trail slightly.

Rendered-pose lag:

- The scheduler produces target poses, then a separate rendered pose follows
  those targets.
- `armLagSec` damps elbow, shoulder, and micro head channels.
- `palmLagSec` damps palm direction and twist channels.
- `fingerLagSec` damps finger and thumb channels.
- `microHandFlexAmount` is excluded from this lag path by design.

VRM bone usage:

- The layer uses `@pixiv/three-vrm` normalized humanoid bones rather than raw
  glTF extension traversal.
- Dynamic offsets can target spine/chest/neck/head, shoulder/upper/lower arm,
  hand, thumb, and finger bones when those normalized bones are present.
- Missing optional finger/thumb bones are reported in the debug snapshot and
  skipped rather than throwing.
- Forearm roll resolves a runtime lower-arm-to-hand axis in the target bone's
  local space so the same control can work across VRM0 and VRM1 models.

### `SpringBonePhysicsController`

File: `src/frontend/web/src/lib/avatar/spring-bone/SpringBonePhysicsController.ts`

Responsibilities:

- Own runtime spring-bone tuning for VRM secondary motion.
- Snapshot original spring joint stiffness, gravity, and drag settings.
- Apply debug parameters for gravity, drag, updraft, wind, gusts, and helper
  visibility before `vrm.update(delta)`.
- Scale environmental physics per semantic spring-bone profile. Hair receives
  full intensity; named non-hair profiles and unprofiled joints receive the
  conservative fallback intensity unless their profile is tuned.
- Restore cached settings on disable, reset, or dispose.

Current defaults keep spring physics enabled, use a stronger drag multiplier,
apply a subtle updraft, enable gust shaping, and keep helpers hidden.

Semantic profile behavior:

- `hair` receives the global spring-bone controls at full intensity.
- Named non-hair profiles (`cloth`, `accessory`, `tail`, `ear`, and `chest`)
  and unprofiled or unmapped joints use the conservative half-intensity
  fallback unless a profile override is active.
- Global Spring Bones controls are the shared baseline for all joints and are
  the only controls that affect unprofiled or unmapped joints.
- Semantic profile controls are runtime-only debug overrides layered on top of
  the global defaults for named profiles. They can tune profile intensity and
  per-profile numeric physics values.
- Resetting spring-bone defaults restores authored spring settings and clears
  semantic profile overrides.

Semantic profile assignment:

- Spring bones are identified from VRM spring-bone metadata: VRM 1.0
  `extensions.VRMC_springBone.springs[*].name` and VRM 0.x
  `extensions.VRM.secondaryAnimation.boneGroups[*].comment`.
- Runtime `VRMSpringBoneJoint` instances are mapped back to source glTF node
  indices through parser associations, then classified using spring names,
  comments, and participating joint node names.
- Token matching groups joints into `hair`, `cloth`, `accessory`, `tail`,
  `ear`, or `chest`; missing, ambiguous, or unmapped joints remain unprofiled
  and use the conservative fallback intensity.

Debug visibility:

- The Spring Bones section reports semantic totals, profile counts, unmapped
  joints, low-confidence assignments, and a collapsible per-joint assignment
  table for diagnosing model-specific classification issues.
- Helper visualization draws spring-bone lines as overlay helpers with semantic
  colors and collider helpers in magenta. Helpers are still anchored to the
  authored spring bones, so they may appear inside the avatar mesh; the overlay
  styling is intended to keep those lines visible through geometry.
- The color legend in the Spring Bones diagnostics panel maps helper colors to
  `hair`, `cloth`, `accessory`, `tail`, `ear`, `chest`, unprofiled, unmapped,
  and collider helpers.

## 3) Animation manifest resolution

File: `src/frontend/web/src/lib/avatar/animationManifest.ts`  
Source data: `src/frontend/web/src/assets/vrm/animations/manifest.json`

The manifest is bundled authoring/policy metadata, not a playable byte
inventory. Included VRMA files live under `content/included/gestures`; Local
content lives under `content/local`. Both are registered by the backend Content
Catalog. Preview and live Anima preparation fetch protected registered files,
verify their size and hash, and give the loader ephemeral Blob URLs. There is
no supported `/vrm/animations` public content directory.

Creator Save performs backend type validation before reconciling the catalog.
Runtime VRMA loading uses `VRMAnimationLoaderPlugin`; avatar loading uses
`Avatar.preloadVrm(...)`. Neither a manifest filename nor an old public URL
bypasses catalog preparation. See
[Content and browser workers](../architecture/content-and-workers.md) for the
storage and byte-delivery contract.

Current format admission is owned by
`src/backend/animama/app/services/content_kind_registry.py`:

- Avatar Save and scanning call the strong validator in
  `src/backend/animama/app/services/content_gltf.py`. VRMs must be
  self-contained GLB 2 with a supported VRM 0.x or 1.0 extension, valid embedded
  resource ranges, and the required humanoid bone map. External resources are
  rejected. See the backend
  [Avatar content contract](../../backend/features/custom-animas-and-content.md#confirmed-avatar-and-appearance-content).
- VRMA catalog admission accepts bounded JSON glTF or GLB, verifies the GLB
  envelope when present, and requires a glTF 2 asset and the
  `VRMC_vrm_animation` extension. The stronger canonicalizer in
  `content_gltf.py` validates one animation, finite samples, and embedded
  resources and can emit canonical GLB, but the current catalog admission path
  does not call it. Those stronger checks and canonical rewriting must not be
  described as guarantees of current VRMA Save or Rescan.

How selection is indexed:

- `Animations.idle` entries are parsed as idle-stint candidates.
- `Animations.gesture` entries are parsed as gesture candidates keyed by
  normalized manifest id.
- The helper also exposes a flattened manifest inventory for debug surfaces and
  VRMA preload planning.

Normalization rules:

- Leading `/` removed.
- `vrm/animations/` prefix removed.
- Any legacy emotion/role path segment is reduced to the filename.
- `.vrma` suffix normalized when deriving ids from VRMA file paths.
- The retained `resolveAnimationUrl(...)` helper can form legacy
  `/vrm/animations/<filename>.vrma` paths; those paths are not the current
  catalog delivery contract and must not be used to infer playable files.

Built-in production animation manifest and mounted live catalog:

- File: `src/frontend/web/src/lib/avatar/animationManifest.ts`
- Source data:
  `src/frontend/web/src/assets/vrm/animations/manifest.json`
- Scope: authoring metadata and motion policy. Live Anima chat uses a prepared
  `AnimaRuntimeCatalog` containing registered Included and Local Gesture,
  Reaction, and Idle Style selections with frozen bytes for that mount.
- Candidate rules: use non-disabled `Animations.idle` entries with
  `type: "vrma"` and finite effective duration. Empty `emotions` maps are
  neutral; non-empty maps match active tracked emotions at intensity levels 1,
  2, or 3.
- Gesture rules: use every non-disabled `Animations.gesture` entry without
  emotion filtering. `vrma` entries resolve to gesture VRMA actions;
  `animaPoseClip` entries resolve to planner-owned pose clip actions.
- Preload rules: preload non-disabled `vrma` entries only. Idle entries are
  tier A; the remaining VRMA entries are tier B. `animaPoseClip` entries are
  local JSON pose clips and are not treated as VRMA preload URLs.
- Timing: active stint duration comes from `duration / time_scale` multiplied
  by loop repetitions. `repeat` requires positive `loop_count`; `pingpong`
  uses positive `loop_count` or the runtime default of 2.
- Debug: the Avatar Planner section of `AnimationDebugModal` exposes the idle
  quiet interval and lists eligible/excluded idle candidates with match,
  weight, loop metadata, and effective duration.

## 4) Store: the runtime bridge

File: `src/frontend/web/src/stores/avatar-runtime-store.ts`

State tracked:

- Anima/run context:
  - `animaId`
  - `activeRunId`
  - `activeSpeechRunId`
- Signals:
  - `interactionPhase`
  - `activeVoiceTurn`
  - `plannerEvents` (bounded queue of typed planner events)
- Emotion:
  - `emotionalState`
  - `activeEmotions`
  - `activeEmotionGroups`
  - `dominantGroup`
  - `lastEmotionEventId` for dedupe

Important actions:

- `resetForAnima(animaId)` resets runtime state.
- `setAnimaEmotionSnapshot(snapshot)` seeds current emotional baseline from anima API state.
- `startRun(runId)` sets `interactionPhase="thinking"` and queues a
  `runStarted` planner event for the new run.
- `markSpeechStarted(runId)` transitions to `interactionPhase="talking"` based on real audio playback start.
- `markSpeechEnded(runId)` clears active speech and returns phase to idle.
- `markNonTtsResponseStarted(runId)` transitions to
  `interactionPhase="responding_no_tts"` for visible assistant presentation
  without TTS audio.
- `requestNonTtsResponseCompletion(runId)` defers run cleanup until
  `AvatarCanvasActor` observes no same-run gesture or reaction planner work.
  Reactions started during `responding_no_tts` clear after 6s, even when their
  authored lifetime is phase-bound.
- `finishRun(runId?)` clears active run/speech and returns phase to idle.
- `abortRun(runId?)` immediately clears run, speech, VFX, and planner-event
  state (used for stop/error/navigation).
- `beginListeningCapture()` / `endListeningCapture()` mirror dictation listening lifecycle.
- `applyEmotionUpdate(update)`:
  - ignores duplicate event IDs,
  - ignores stale run updates when active run mismatches,
  - stores the full per-emotion runtime state,
  - stores ranked active emotions/groups,
  - enqueues an `emotionUpdated` planner event,
  - enqueues an `emotionReactionUpdated` planner event so `AvatarPlanner` can
    start a same-run reaction clip during `talking`.
- `requestGesture(request)`:
  - ignores empty, inactive-run, and stale-run requests,
  - normalizes the gesture id,
  - enqueues a `gestureRequested` planner event from
    `avatar.gesture.requested`.
  - receives events only after the chat transport has matched the event's
    `runtime_revision` to the same mounted catalog used by the canvas.
- `consumePlannerEvents(eventIds)` removes planner events after the
  planner consumes or explicitly ignores them.

Legal interaction-phase transitions are enforced in-store (`canTransitionPhase`), replacing implicit priority-only behavior:

- `idle -> user_typing | listening | thinking`
- `user_typing -> idle | listening | submitting | thinking`
- `listening -> idle | user_speaking | semantic_check | submitting | thinking`
- `user_speaking -> listening | semantic_check | submitting | thinking | idle`
- `semantic_check -> listening | submitting | thinking | idle`
- `submitting -> thinking | listening | idle`
- `thinking -> talking | responding_no_tts | idle | listening`
- `responding_no_tts -> idle | listening`
- `talking -> idle | listening`

`activeEmotions` are now read from the backend-provided emotional state instead
of being derived locally from valence/control/openness axes.

## 5) Canvas runtime lifecycle

### Scene setup

`src/frontend/web/src/ui/main/canvas/Scene.tsx` renders `<AvatarCanvasActor />`
inside the main `Canvas`. Live, management, creator, and Create Anima Avatar
canvases share `CONTINUOUS_CANVAS_RESIZE`, which disables React Three Fiber's
measurement debounce. This keeps the renderer and perspective camera aligned
with every intermediate width while the adaptive application sidebar animates;
otherwise the Avatar can overshoot with the old Canvas center and disappear for
a frame when the renderer finally adopts the settled width.

### Actor setup

`src/frontend/web/src/ui/main/canvas/AvatarCanvasActor.tsx`:

- Reads `animaId` from route params.
- Uses the model and stable catalog supplied by `AnimaRouteProviders` after
  essential bytes are verified; it never substitutes a sample model.
- Creates `Avatar` with the mounted motion/media catalog and loads the verified
  model plus its exact prepared resource map.
- Calls `prepareFirstFrame()` before attaching `avatar.scene` as `<primitive />`.
  The planner cannot run before the first actual main-camera mesh draw.
- `observeFirstPosedFrame` ignores offscreen/shadow passes and releases optional
  preparation on the following animation frame. It restores mesh callbacks
  after observation and cancels a stale callback on cleanup.
- Schedules bounded, yielding animation/particle warm-up after that first frame.
  New ready roots join the same background job; they do not restart the avatar,
  camera, or canvas. An applicable idle then uses the existing planner and blend
  from relaxed-rest. No/failed idle leaves the resting model visible.
- Registers the loaded avatar with debug-only stores:
  - VRM object inspection/editing target
  - animation/procedural/spring-bone tuning target
- Passes the R3F scene as the spring-bone helper host so helper visuals can render outside `vrm.scene`.
- On cleanup, cancels first-frame/warm-up callbacks, unsubscribes availability,
  and disposes the avatar instance. Late decoding cannot animate the old rig.

### Per-frame update

After the first posed draw, on every `useFrame` tick:

- Pull latest store snapshot via `useAvatarRuntimeStore.getState()`.
- Call `avatar.updateState({ emotionalState, signals })`.
- If returned plan is a gesture with `gestureRequestId`, call `consumeGestureRequest(...)`.
- Tick the lip-sync bridge gate so queued viseme segments can start once audio
  and avatar state are ready.
- Read a provider-agnostic speech timing context from the same bridge. The
  context contains `runId`, `elapsedSec`, `utteranceDurationSec`, `durationSec`,
  `remainingSec`, `durationKnown`, and a speech gesture timeline when available;
  it is emitted only for providers that supply audio-clock timing. The gesture
  timeline may be estimated or actual-duration-scaled depending on which speech
  timing data has arrived for the run.
- Call `avatar.update(delta, { speechTiming })`.

This avoids coupling avatar updates to React render frequency.

### Animation debug modal

Files:

- `src/frontend/web/src/ui/debug/AnimationDebugModal.tsx`
- `src/frontend/web/src/stores/animation-debug-store.ts`

When debug mode is enabled and an avatar target is registered, the header shows the animation debug button. The modal is right-docked and does not dim the rest of the UI so the avatar remains visible while tuning values.

The modal currently exposes:

- **Breathing** controls for enablement, layer weight, BPM, intensity, torso/head/shoulder amplitudes, breath sway, and lag.
- **Sway** controls for enablement, layer weight, CPM, side shift, torso lean, head counterbalance, shoulder drift, and lag.
- **Bounce**, **Head Nods**, **Head Side Tilt**, **Cursor Look At**, **Talking Hands**, and **Emotion Posture** controls for optional procedural layers.
- **Spring Bones** controls for enablement, helper visibility, gusts, global physics values, and semantic profile overrides.
- **PoseController** catalog pose controls that invoke `Avatar.applyPose(...)`, show active/missing target diagnostics, and clear the active pose.
- **PoseController Clips** catalog clip controls that invoke `Avatar.playClip(...)`, stop active clips, restart the selected clip, and show active clip diagnostics.
- The clip controls also show effect-event counts by kind and runtime dispatch diagnostics while a built-in clip is playing.
- **Avatar Planner** readouts for planner state, active planner-owned VRMA,
  active planner-owned pose clip, pending delayed work, cancellation reasons,
  ignored request reasons, and planner-owned procedural layers.
- **Runtime** readouts for loaded/missing bones, active pose state, spring-bone manager counts, helper counts, and gust state.

These controls are runtime-only tuning tools. They do not persist procedural parameters, spring-bone settings, pose selection, or helper visibility to anima settings or VRM files.

## 6) Dispatch lifecycle -> avatar behavior

This is the full frontend lifecycle for one chat run.

### 0. Anima context established

In `useChatSession`:

- On anima change: `resetAvatarRuntime(animaId)`.
- Once anima data is loaded: `setAnimaEmotionSnapshot(anima.emotional_state)`.

Result:

- Avatar starts from persisted emotional baseline instead of always neutral.

### 1. User submits message

`handleSubmit()` in `useChatSession`:

- Generates `runId`.
- Starts chat SSE.
- Resolves speech settings from user preferences:
  - `ttsEnabled`
  - provider (`browser` / `pocket_tts`)
  - whether viseme queueing should be enabled (`pocket_tts` + TTS enabled).
- Calls:
  - `startTtsRun(runId)` only when `ttsEnabled=true`,
  - `startAvatarRun(runId, { inputText })` always.

`startAvatarRun` includes the trimmed input text in a generic `runStarted`
avatar planner event.

Store effect:

- `activeRunId = runId`
- `interactionPhase = "thinking"`
- `plannerEvents` contains one `runStarted` event until the avatar frame
  loop consumes the planner output.

Animation effect:

- Avatar planner base state becomes `thinking` unless phase is in a listening state.
- The planner may select a thinking PoseController clip after consuming the
  `runStarted` event. Each thinking clip has a 10% chance above 10 trimmed
  characters, 20% above 30, 30% above 50, and 40% above 80.
- Selected thinking clips start only after the dwell delay, default `600ms`,
  and fade out when talking, idle, or another non-thinking phase begins.

### 2. Streaming tokens begin (`user.response`)

In SSE callback `onToken(...)`:

- Appends text token stream.
- Appends token to TTS queue only when `ttsEnabled=true`.

Store effect:

- No direct talking transition. Avatar remains in thinking until TTS playback starts.

Animation effect:

- State remains `thinking` unless TTS playback has started (or user is dictating/listening).

### 2a. TTS playback starts (`playback_started`)

When provider playback starts (browser utterance `onstart` or Pocket playback event):

- `markSpeechStarted(runId)` is called.

Store effect:

- `interactionPhase = "talking"`

Animation effect:

- Base state becomes `talking`.
- Avatar planner switches to talking state. `talkingHands` stays disabled until
  the run has either a manifest gesture request or an emotion update that allows
  the talking-hands fallback.

### 3. Gesture requests arrive (`avatar.gesture.requested`)

In SSE callback `onAvatarGestureRequested(...)`:

- `requestAvatarGesture({ eventId, runId, gesture })`.
- The callback is reached only when both run ID and
  `runtime_revision` match the active request and mounted catalog. A
  mismatch is logged and dropped before store/planner queueing.

Store effect:

- A `gestureRequested` planner event is queued with a unique `requestId`,
  normalized `animationHint`, timestamp, run id, and source SSE event id.

Animation effect on next frame:

- If the requested root is still preparing, consume the event immediately with
  a bounded preparation diagnostic, even in a phase that would normally queue
  a gesture. Completing the download cannot replay this event later.
- If phase allows gesture playback and a matching gesture event is pending, the
  planner creates a one-shot gesture plan from that event.
- If the hint resolves in the mounted motion catalog, the exact selected
  runtime Gesture release is used. Its implementation may be VRMA or an
  `animaPoseClip` clip.
- Any valid mounted-catalog gesture request reserves talking motion for the
  requested motion and bypasses `talkingHands` for that run. There is no
  same-named global-manifest fallback for an unknown runtime ID.

### 4. Emotion updates arrive (`emotion.update`)

In SSE callback `onEmotionUpdate(...)`:

- `applyAvatarEmotionUpdate({ eventId, runId, emotionalState })`.

Store effect:

- Full emotional state is replaced from the backend payload.
- Ranked `activeEmotions`, emotion groups, and dominant group are updated.
- An `emotionUpdated` planner event is queued for consumption/debug.

Animation effect on next frame:

- If no manifest gesture request has claimed talking motion, the same-run
  emotion update allows `talkingHands` to run when that procedural layer is
  eligible.
- When the planner consumes or ignores events, the canvas frame loop removes
  matching planner event ids from the store.

Expression effect:

- Dominant emotion label/intensity changes drive `ExpressionController.applyEmotionPreset(...)`.

### 5. Run completes (`run.completed`)

In SSE callback `onComplete(...)`:

- `completeTtsRun(runId)` when TTS is enabled; otherwise `finishAvatarRun(runId)` directly.
- message cache updates and route replacement logic proceed.

Store effect:

- If `ttsEnabled=true`, no immediate phase transition; avatar remains `thinking` (before playback start) or `talking` (while speaking) until playback end callbacks.
- If `ttsEnabled=false`, `finishAvatarRun(runId)` is called on completion, returning to idle/listening according to current capture state.

Animation effect:

- After TTS playback ends, base state falls back to:
  - `listening` if dictation listening capture is still active,
  - otherwise `idle`.

### 6. Error/stop/abort paths

On `onError`, `AbortError`, manual stop, conversation switch, and unmount:

- `abortAvatarRun(...)` is called to avoid stale talking/thinking state.
- `stop()` aborts SSE when appropriate.

## 7) Dictation -> listening state

File: `src/frontend/web/src/ui/main/chat/ChatInterface.tsx`

`useDictation` state drives:

- `beginListeningCapture()` / `endListeningCapture()` via effect.
- Cleanup forces `endListeningCapture()` on unmount.

Listening transitions are constrained by legal transition rules in the runtime store. Dictation attempts to enter/exit listening, but illegal transitions are rejected when run/speech state is active.

## 8) Typing -> idle-base procedural state

File: `src/frontend/web/src/ui/main/chat/ChatInterface.tsx`

Manual textarea edits with non-empty text call `beginTypingActivity()` and
refresh a short inactivity timer. If the user stops typing, clears the input,
submits, starts dictation/voice mode, or leaves the component, the chat UI calls
`endTypingActivity()`. The planner maps `user_typing` to the idle base state,
so idle stints remain governed by the same quiet/active policy while the
procedural lane borrows the listening `bounce` / `headNod` policy.

## 9) Event filtering and safety guards

SSE integration (`useChatSse.ts`) filters by expected `run_id` before invoking callbacks.

Store guards add another layer:

- Ignore duplicate emotion event IDs.
- Ignore emotion deltas from non-active runs.

Together this prevents stale cross-run emotion/gesture contamination.

## 9) Current limitations / intentional gaps

1. `playDefaultAnimation()` in `AnimationManager` is currently a no-op; runtime is driven by state-machine plans.
2. Viseme queueing is currently gated to Pocket TTS when TTS is enabled; non-Pocket providers skip that bridge path.
3. `useChatSse` currently surfaces emotion updates through normal chat callbacks, which may be noisy in normal UX if surfaced directly.
4. `AnimationDebugModal` tuning is runtime-only; values reset with the avatar instance and are not persisted.
5. Spring-bone wind/updraft editing is debug-controlled and runtime-only.

## 10) Mental model summary

Think of the system as:

- **Chat/SSE emits intent signals and emotion deltas** ->
- **Zustand store holds canonical avatar runtime state** ->
- **Canvas frame loop converts state into animation plans** ->
- **AnimationManager plays skeletal clips** ->
- **ProceduralAnimationController layers breathing and idle sway additively** ->
- **SpringBonePhysicsController adjusts spring-bone force settings before three-vrm updates secondary motion**.
- **PoseController provides the active absolute catalog pose** ->
- **ExpressionController animates face/blink/lip-sync while VFX and spring-bone controllers update runtime visuals and secondary motion**.

That split keeps runtime deterministic, frame-driven, and decoupled from React render timing.
