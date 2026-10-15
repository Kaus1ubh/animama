# Avatar Planner

`AvatarPlanner` chooses autonomous presentation actions from runtime state and
planner events. `Avatar` executes them through its motion, expression and
procedural controllers.

## Scope

File: `src/frontend/web/src/lib/avatar/planner/AvatarPlanner.ts`

`AvatarPlanner` owns autonomous motion policy for:

- Emotion-aware intermittent idle VRMA stints from the mounted motion catalog.
- One-shot catalog gestures requested through planner events. `vrma` gestures
  execute through `AnimationManager`; `animaPoseClip` gestures execute through
  `PoseController`.
- Delayed thinking `PoseController` clips selected from chat run-start events.
- Planner-owned procedural policy, currently listening bounce/head-nod,
  talking-hands enablement, and emotion-driven posture enablement.
- Transition policy selection for planner-owned actions, such as crossfade,
  fade-in, and fade-out durations.
- Planner debug state: active plans, pending events, consumed event ids, and
  ignored event reasons.
- Dynamic reaction clips from `emotionReactionUpdated` events. Talking-scoped
  reaction clips start only while the matching run is `talking` and remain
  active until their `playback.lifetime` condition ends. High-intensity
  reaction clips can own particle events through their normal clip event
  timeline.

Execution ownership is listed under [Execution Boundary](#execution-boundary).

## Runtime Flow

`Avatar.updateState(...)` is the runtime integration point. It gathers the
current avatar snapshot, planner state, active manual/planner-owned pose and
procedural ownership, pending planner events, and random rolls. It then calls:

```ts
const output = this._avatarPlanner.plan(this._avatarPlannerState, input);
```

The returned `AvatarPlannerOutput` contains:

- next `AvatarPlannerState`
- planner actions to execute this evaluation
- consumed planner event ids
- debug snapshot

`Avatar` stores the next planner state, exposes the debug snapshot, applies
emotion expression changes, and executes planner actions through the concrete
runtime controllers.

## Inputs

The planner input describes facts, not commands:

- `interactionPhase`: current voice/chat phase.
- `activeRunId`: active chat run, used to reject stale events.
- `emotionalState`: normalized emotion runtime state.
- `activeVrmaActions`: currently active VRMA action metadata.
- `activePlannerPoseClip`: planner-owned pose clip state, if any.
- `manualPoseClipActive`: whether a non-planner pose clip is active.
- `activePlannerProceduralLayerIds`: currently active planner-owned procedural
  layers.
- `manualProceduralLayerIds`: procedural layers currently controlled manually.
- `eligiblePlannerProceduralLayerIds`: procedural layers the planner may enable.
- `pendingEvents`: queued `runStarted`, `emotionUpdated`, and
  `gestureRequested` motion events plus `emotionReactionUpdated` reaction clip
  events.
- `randomRolls`: injectable randomness for deterministic planning and tests;
  injected rolls read 0 once used up. Without them (the live avatar) every
  draw is `Math.random()`. One reader serves a frame: motion draws first, then
  Reaction picks.
- `idleStintQuietIntervalSec`: optional idle quiet period override. The
  default comes from `DEFAULT_IDLE_STINT_QUIET_INTERVAL_SEC`.
- `emotionPostureConfig`: debug/runtime gates for the `emotionPosture`
  procedural layer. The planner reads the global planner gate and per-emotion
  group preset toggles from the layer snapshot instead of importing UI state.
- `motionCatalog`: focused idle/gesture/pose/reaction inventory and VRMA
  resource resolution for the mounted Anima. `AvatarPlanner` receives it in
  its constructor; the optional pure-function field supports explicit
  built-in parity fixtures and standalone callers.

Because `planAvatar(...)` is pure, tests can pass fixed inputs and assert the
exact state/actions without rendering a VRM.

## Lanes

Planner actions are separated into lanes:

- `baseVrma`: looping VRMA state motion.
- `gestureVrma`: one-shot VRMA gesture motion.
- `poseClip`: planner-owned `PoseController` clips.
- `procedural`: planner-owned procedural animation policies.
- `reactionClip`: planner-owned, non-body `AnimaPoseClip` playback selected
  from the mounted Anima's reaction catalog.

The lane selects the executor and the actions that require arbitration.

The AI-facing Gesture selector is the Gesture item's stable reviewed semantic
key, not an opaque file or support-resource ID. Catalog revisions may change
while that product selector remains intelligible to the model. Reaction
selection uses the event's emotion/intensity cell and its pool; a member need
not have the same authored placement hint. Runtime projection continues to
project away humanoid body motion while using expression/VFX/SFX channels; the
typed validator therefore prevents a Reaction that would become a no-op after
that projection.

The live loadout selects Gesture and Reaction roots. At route mount, the
backend resolves their registered dependencies, and browser preparation
verifies and mounts their bytes. `adaptRuntimeSnapshot` projects that catalog
into `AnimaRuntimeCatalog`; only prepared resources enter playback. Particle,
Avatar, Scene, and Sound dependencies are not independent Action loadout rows.
See [Local content runtime](../architecture/local-content-runtime.md).

An `AnimaPoseClip` payload is an implementation document inside a catalog
Gesture or Reaction, not a loadout item. Product placement determines
the planner lane: Gestures use gesture playback and Reaction pool members use
non-body reaction playback. Dependencies are compiled with the root and
are never separately equipped.

Reaction Equip is available when projection leaves at least one expression,
avatar VFX, scene VFX, particle VFX, or SFX channel. `ReactionClipPlayer`
explicitly projects every sampled generic clip to expressions before its
fade/interpolation path and dispatches the supported events separately, so any
humanoid transforms retained for Gesture use never claim the reaction body
lane. The author may suggest a tracked emotion and intensity (Mild to
Intense); the suggestion is only a hint for equipping. Each Reaction mounts
once, with runtime ID `reaction:<item_id>` from its binding, however many
cells hold it.

There is no planner-owned `particleVfx` lane.
Particle effects for normal emotion reactions are authored as
`particle_vfx` events inside selected reaction clips, so they use the same
executor and same-run lifetime as the expression, avatar VFX, scene VFX, and
SFX channels on that clip.

## State Mapping

The planner maps interaction phases to base avatar states:

- `talking -> talking`
- `responding_no_tts -> talking`
- `thinking` and `submitting -> thinking`
- `listening`, `user_speaking`, and `semantic_check -> listening`
- `user_typing -> idle` for base VRMA selection
- everything else -> `idle`

Non-idle interaction phases do not select authored base-loop clips from hidden
manifest lanes. Listening, thinking, talking, and `responding_no_tts` motion
comes from procedural policies, planner-owned pose clips, and selected
gestures.

While the base state is `idle`, the planner schedules one intermittent authored
occurrence after 90 seconds of quiet. The mounted Anima's Idle pool weights
Default at one half and the dominant emotion's cells from Mild up to its
intensity at the other, uniformly within each half; neutral, or an emotion with
no Gestures there, uses Default alone. An empty resolved pool leaves procedural
rest active. Each half avoids the last Gesture when it has another choice. Built-in preview providers
continue to adapt their animation manifest; live Anima routes use the Idle pool.

A candidate may use VRMA or `animaPoseClip`. Its finite horizon comes from the
exact admitted timeline, positive authored speed and positive finite repetition
count. Loading has a separate pending state: its playback clock starts only when
the Avatar acknowledges that motion is ready. Completion returns to the full
quiet interval. Higher-priority or manual playback interrupts the occurrence;
interrupted pending work cannot restart or resume it. Emotion changes select the
next occurrence rather than replacing an active motion.

Idle owns its motion, expressions, effects and sound handles. Completion,
interruption and unmount invalidate asynchronous loads and stop only that
occurrence's resources. TTS and unrelated Sound Effects continue. Clip events at
time zero and each intended boundary fire once, with no extra loop at completion.

`user_typing` is intentionally narrow: it maps to the idle base state, but the
procedural lane treats it like a listening-style stint so the planner can
occasionally enable `bounce` or `headNod` while the user is actively typing.
During the idle quiet period, `user_typing` has no planner-owned idle VRMA.

The `emotionPosture` procedural policy is independent of the interaction
phase. When the dominant emotion group is one of the supported posture groups
(`gloom`, `revulsion`, or `rejection`) at intensity level 1, 2, or 3, the
planner may enable the `emotionPosture` layer if the layer is eligible, not
manually owned, globally planner-enabled, and the dominant group preset is
enabled. It coexists with listening and whichever assistant presentation motion
source is active. If the main structured response requested a manifest gesture
for the run, that gesture owns talking motion. Planner-owned `talkingHands` can run as the
fallback only after a same-run `emotionUpdated` event confirms no manifest
gesture request is pending for that run. Until that arbitration resolves, the
avatar may be talking, but the planner keeps `talkingHands` disabled so it
cannot overlap with a late manifest gesture request.
`responding_no_tts` is a non-audio assistant presentation phase: it can play
same-run gestures and emotion reaction clips, but it does not enable
`talkingHands` and it does not require lip-sync or speech timing. Reaction
clips started during `responding_no_tts` play for at most 6s before the planner
clears them, even if their authored lifetime would otherwise last until the
assistant presentation phase ends.
Unsupported dominant groups and disabled supported presets resolve to no
posture instead of falling back to another group.

## Events

Planner events are the bridge from runtime facts to autonomous motion policy:

- `runStarted`: used for delayed thinking pose selection.
- `emotionUpdated`: consumed every time for debug accounting. The first same-run
  emotion update also arbitrates talking motion for that run when no gesture
  request already claimed it; no gesture request allows `talkingHands`.
- `gestureRequested`: requests a one-shot gesture from the dedicated
  `avatar.gesture.requested` SSE event. The planner accepts the hint only when
  its runtime ID occurs in the mounted catalog. A still-preparing root is
  consumed immediately, before phase eligibility or talking-motion arbitration,
  with a bounded diagnostic. Its later admission cannot replay that event.
- `emotionReactionUpdated`: requests a reaction clip from
  main-structured emotion metadata. The planner keeps same-run reaction events
  pending until `talking` or `responding_no_tts`, consumes stale, neutral,
  zero-intensity, duplicate, and unmapped events, and clears active reactions
  when their playback lifetime ends.

Reaction selection is per cell. An exact `TRACKED_EMOTIONS` tone and a
Reaction intensity of 1–4 name one cell, and
`AvatarMotionCatalog.getReactionRuntimeId` picks one of the cell's members that
mounted and is not still preparing, uniformly from one random roll. When the
planner first accepts an event it draws that roll and stores the pick on the
pending event (`reactionRuntimeId`, null when nothing can play), so the event
keeps one pick while it waits for talking. Planner state remembers the member
each cell played last (`lastPlayedReactions`, recorded when the clip starts
and cleared when the Anima changes); a pick dropped before playing does not
count. A cell with two or more playable members never picks the member it
played last, while a one-member cell always plays its member. Group names such
as `alarm`, unknown tones, neutral tones and intensity 0 (model intensity 1–2)
name no cell, so they draw no roll; they and empty cells produce no reaction
clip, and no other cell is tried. Other tones/groups do not
fall back to the baseline emotion expression state. The built-in catalog used
outside an Anima route serves one-member pools of the bundled
`<emotion>-<intensity>` clips. Reaction clips declare
`playback.lifetime.kind: "whileInteractionPhase"` with `phases: ["talking"]`
and `scope: "activeRun"`, so the planner retains them only while the same run
is talking.

The planner validates event run ids against `activeRunId`. Stale events are
consumed with ignored reasons instead of lingering indefinitely.

## Execution Boundary

`AvatarPlanner` returns action objects; it does not execute animation.

`Avatar` executes those actions:

- `playVrmaLoop`, `stopVrmaLoop`, and `playVrmaGesture` call
  `AnimationManager`.
- Manifest `type: "animaPoseClip"` gestures emit planner-owned
  `playPoseClip` actions and execute through `PoseController`.
- `playPoseClip` and `stopPoseClip` call `Avatar.playClip(...)` and
  `Avatar.stopClip(...)`, which delegate to `PoseController`.
- `setProceduralPolicy` calls `ProceduralAnimationController`.
- `playReactionClip` and `clearReactionClip` call `ReactionClipPlayer`.
  Reaction clips sample expression, avatar VFX, scene VFX, particle VFX, and
  SFX channels. They do not call `Avatar.playClip(...)`, do not suspend
  automatic VRMA playback, and do not claim the coordinated body pose lane.
  Reaction definitions cannot declare humanoid transforms, and the reaction player
  defensively discards any such samples before expression fade/interpolation.
  The built-in canonical reaction catalog applies the same restriction.
- `AnimaPoseClip.playback` lifetimes are evaluated by the planner for
  autonomous clips. The playback controllers own sampling: non-loop clips with
  `playback` hold their final sample until `clearReactionClip` or
  `stopPoseClip` runs, while clips without `playback` still complete by
  duration.

The `presentation.disable_vfx` preference is enforced by runtime executors,
not by `AvatarPlanner`. It suppresses clip-owned avatar, scene, and particle
VFX while leaving reaction SFX and manual/debug controls available.

The Animation Debug modal's `Reactions` section reads planner reaction
diagnostics from `AvatarPlannerDebugSnapshot` and live playback diagnostics
from `ReactionClipPlayer`. Its manual reaction play/restart/clear controls are
debug-only runtime commands; they do not enqueue planner events.

## Transition Policies

Planner transition policies describe handoff intent:

- `crossfade`: blend between VRMA clips over a duration.
- `fadeIn`: enter a pose clip over a duration.
- `fadeOut`: exit a pose clip over a duration.

Finite idle completion is part of the occurrence policy. VRMA completion emits
`stopVrmaLoop` and returns to quiet with the existing entry/exit fade; clip
completion clears its occurrence with the existing pose blend. `Avatar` executes that stop by fading the mixer
action and blending the visible base pose back to `relaxedRest` while preserving
procedural offsets. The same Avatar-side rest blend is also used for manual VRMA
fade-outs/stops and finite VRMA mixer completion; the planner only decides when
to request a runtime-owned stop.

No planner policy should time-scale authored motion to meet a deadline. Smooth
handoffs may change blend weights or interpolate from captured current output,
but the authored clip's local timing should remain intact.

## Testing

The web package has Vitest coverage for pure planner behavior:

```bash
cd src/frontend
pnpm web:test
```

Current tests live under `src/frontend/web/tests/avatar/` and cover event
consumption, stale-run rejection, phase-ineligible gestures, pose exit policy
selection, idle-stint quiet/active transitions, manifest idle candidate
selection, playback-scoped reaction retention, and reaction debug snapshot
fields. `AvatarPlanner.test.ts` covers reaction clip planning, while
`AvatarPlannerMotion.test.ts` covers the retained motion policy behavior.
