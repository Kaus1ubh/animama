# Avatar Emotion Guide

The backend persists per-emotion values; the frontend derives groups for
presentation and uses turn metadata to select reactions.

## 1) High-level model

The current emotion system is a categorical per-emotion model with a derived UI/runtime grouping layer.

Core rules:

- The canonical persisted state is a 24-emotion map.
- `neutral` is not persisted as an emotion value. It can appear only as
  metadata on no-op `emotion.update` events.
- `EmotionGroup` is derived from the tracked emotions. It is not persisted and it is not emitted over SSE.
- The backend and frontend both treat `0..30` as the valid value range for each tracked emotion.
- Voice-structured `emotional_tone` and `emotional_intensity` are
  backend-internal metadata. Normal `chat:sse` uses them to compute a
  full-state `emotion.update`; the frontend still treats the `emotions` array
  on that event as the canonical live state.
- Intensity bands are derived from the raw per-emotion value:
  - `0-4 -> level 0`
  - `5-15 -> level 1`
  - `16-25 -> level 2`
  - `26-30 -> level 3`

Backend source of truth:

- `src/backend/animama/domain/emotions.py`

Frontend source of truth:

- `src/frontend/web/src/lib/emotion/index.ts`

## 2) Canonical tracked emotions

The tracked emotions are grouped into 8 `EmotionGroup` values.

| Group     | Tracked emotions                |
| --------- | ------------------------------- |
| Affection | admiration, caring, love        |
| Esteem    | respect, confidence, gratitude  |
| Delight   | amusement, excitement, joy      |
| Drive     | desire, curiosity, optimism     |
| Alarm     | fear, nervousness, confusion    |
| Rejection | anger, annoyance, disapproval   |
| Revulsion | disgust, embarrassment, remorse |
| Gloom     | disappointment, grief, sadness  |

Soft opposing pairs exist only as prompt guidance:

- `Affection ↔ Rejection`
- `Delight ↔ Gloom`
- `Drive ↔ Alarm`
- `Esteem ↔ Revulsion`

They are not hard-coded balancing rules in state application.

## 3) Backend contract and flow

### Persisted state

The backend persists `anima.emotional_state` as a full 24-emotion object keyed by emotion name.

New animas default to all tracked emotions at `0`.

Relevant files:

- `src/backend/animama/domain/emotions.py`
- `src/backend/animama/server/schemas/anima.py`
- `src/backend/animama/adapters/mappers/anima_map.py`

### Primary-derived updates in normal chat

Normal `chat:sse` derives emotion from the primary chat structured response:

```json
{
  "emotional_tone": "joy",
  "emotional_intensity": 5,
  "speech": "..."
}
```

Backend rules for normal chat:

- raw `emotional_intensity` is a model-selected `1..10` value
- the backend maps raw intensity to how far the turn shifts the emotion state:
  - `1-3 -> 1`
  - `4-6 -> 2`
  - `7-10 -> 3`
- separately, it maps raw intensity to the Reaction intensity that
  `emotion.update` carries as `emotional_intensity`:
  - `1-2 -> 0` (no Reaction; the emotion state still shifts)
  - `3-4 -> 1` (Mild)
  - `5-6 -> 2` (Moderate)
  - `7-8 -> 3` (Strong)
  - `9-10 -> 4` (Intense)
- the model-facing `emotional_tone` is a vocal tone key, such as `impressed`
  or `happy`
- the backend maps that tone key back to the canonical emotion before emitting
  `emotion.update`
- a non-neutral allowlisted tone promotes its mapped canonical emotion
- one emotion from the soft opposing group is demoted by the same state-shift
  amount
- all values are clamped to `0..30`
- neutral, missing, blank, default-friendly, or unrecognized tone metadata emits
  a no-op full-state update with `emotional_intensity=0`

For example, if the primary chat model emits:

```json
{
  "emotional_tone": "impressed",
  "emotional_intensity": 6,
  "speech": "..."
}
```

the backend promotes `admiration` and emits `emotional_tone: "admiration"` plus
`promoted_emotion: "admiration"` on the `emotion.update` payload. The frontend
should therefore treat `emotional_tone` on `emotion.update` as canonical
backend metadata, not as the raw model-facing vocal tone key.

Backend vocal-tone-to-canonical mapping:

| Vocal tone key | Canonical emotion |
| -------------- | ----------------- |
| `neutral`      | `neutral`         |
| `impressed`    | `admiration`      |
| `gentle`       | `caring`          |
| `affectionate` | `love`            |
| `respectful`   | `respect`         |
| `confident`    | `confidence`      |
| `grateful`     | `gratitude`       |
| `amused`       | `amusement`       |
| `excited`      | `excitement`      |
| `happy`        | `joy`             |
| `eager`        | `desire`          |
| `curious`      | `curiosity`       |
| `hopeful`      | `optimism`        |
| `scared`       | `fear`            |
| `nervous`      | `nervousness`     |
| `confused`     | `confusion`       |
| `angry`        | `anger`           |
| `irritated`    | `annoyance`       |
| `stern`        | `disapproval`     |
| `disgusted`    | `disgust`         |
| `embarrassed`  | `embarrassment`   |
| `regretful`    | `remorse`         |
| `disappointed` | `disappointment`  |
| `sorrowful`    | `grief`           |
| `sad`          | `sadness`         |

The retained `EmotionalAnalystRunner` can still emit sparse promotions and
demotions for graph-runner compatibility, but it is not part of normal
`chat:sse`.

Relevant files:

- `src/backend/animama/app/primary_emotion_update.py`
- `src/backend/animama/app/voice_emotional_tone.py`
- `src/backend/animama/product_http/chat/stream.py`
- `src/backend/animama/app/main_structured_response.py`

### Backend `emotion.update` event

The backend event contract remains per-emotion and full-state.

Payload shape:

```json
{
  "event_id": "emotion-update-run-123-agent:primary",
  "run_id": "run-123",
  "node_id": "agent:primary",
  "emotions": [
    { "emotion": "admiration", "value": 0 },
    { "emotion": "caring", "value": 2 },
    { "emotion": "love", "value": 1 }
  ],
  "emotional_tone": "joy",
  "emotional_intensity": 2,
  "promoted_emotion": "joy",
  "demoted_emotion": "sadness"
}
```

Important details:

- `emotions` is the full updated state, not just the changed entries
- the array is emitted in canonical backend emotion order
- `EmotionGroup` is not part of the payload
- `emotional_tone`, `emotional_intensity`, `promoted_emotion`, and
  `demoted_emotion` are optional context fields; `emotional_intensity` is the
  Reaction intensity 0–4
- when present, `emotional_tone` is the canonical backend emotion, not the raw
  vocal tone key from the main structured response
- `emotion_intensity` is not part of this event

Relevant files:

- `src/backend/animama/domain/events.py`
- `src/backend/animama/product_http/chat/stream.py`
- `src/backend/animama/product_http/chat/sse_events.py`
- `src/backend/animama/product_http/chat/emotional_state.py`

### Gesture selection lives outside emotion updates

The emotional analyst does not select gestures or VFX. Response-matched gesture
selection is part of the primary chat agent's structured response and is
delivered separately through `avatar.gesture.requested`. The backend accepts
only Gesture selectors from the Anima's mounted runtime snapshot and drops
unknown IDs before delivery. The frontend resolves the selector from the mounted
`AnimaRuntimeCatalog`; an ID missing from that catalog, or whose asset is still
loading, plays no Gesture. There is no fallback to the bundled animation
manifest.

Relevant files:

- `src/backend/animama/product_http/chat/turn_setup.py`
- `src/frontend/web/src/lib/runtime-content/AnimaRuntimeCatalog.ts`
- `src/frontend/web/src/lib/avatar/planner/AvatarPlanner.ts`

## 4) Frontend runtime model

The frontend keeps a live avatar emotion runtime state separate from the persisted anima query data.

Frontend runtime type:

- `EmotionStateMap`: full per-emotion values
- `rankedEmotions`: non-zero emotions sorted by value
- `rankedGroups`: group summaries sorted by average value
- `dominantEmotion`: highest-value tracked emotion
- `dominantGroup`: highest-average emotion group, or `neutral`
- `dominantGroupSummary`: the full summary for the dominant group

Relevant file:

- `src/frontend/web/src/lib/emotion/index.ts`

### Group derivation

For each `EmotionGroup`, the frontend computes:

- the average of the 3 member emotions
- the group intensity from the primary emotion in that group
- the primary emotion as the highest-value member above `0`

Groups with average `0` are omitted from ranked runtime output.

### Anima snapshot seeding

When an Anima is loaded, the avatar runtime store seeds itself from `anima.emotional_state`.

Relevant flow:

- `useChatSession.ts` loads the active anima
- `avatar-runtime-store.ts` normalizes the persisted emotional snapshot
- `buildEmotionRuntimeState(...)` derives ranked emotions and ranked groups

### Applying live emotion updates

While a run is active, incoming `emotion.update` SSE payloads are applied into the avatar runtime store.

Current guard behavior:

- duplicate event IDs are ignored
- emotion updates with no active run are ignored
- stale run IDs are ignored

If the update is accepted:

- the store replaces the current emotion values from the full `emotions` array
- it rebuilds `rankedEmotions`, `rankedGroups`, and `dominantGroup`
- it enqueues an `emotionUpdated` event for `AvatarPlanner`
- it enqueues an `emotionReactionUpdated` event so `AvatarPlanner` can trigger
  a same-run reaction clip while the avatar is `talking`; its intensity is
  read as 0–4, and larger values are clamped to 4

Relevant files:

- `src/frontend/web/src/query/mutations/useChatSse.ts`
- `src/frontend/web/src/stores/avatar-runtime-store.ts`
- `src/frontend/web/src/ui/main/chat/useChatSession.ts`

## 5) Avatar mapping

The avatar runtime uses `EmotionGroup`, then maps that group to animation and
voice asset lanes.

### Animation manifest mapping

Current manifest lane mapping:

- `neutral -> neutral`
- `affection -> neutral`
- `esteem -> neutral`
- `delight -> joy`
- `drive -> joy`
- `alarm -> fear`
- `rejection -> angry`
- `revulsion -> disgust`
- `gloom -> sad`

Relevant files:

- `src/frontend/web/src/lib/emotion/index.ts`
- `src/frontend/web/src/lib/avatar/animationManifest.ts`
- `src/frontend/web/src/lib/avatar/animationPreloadPlan.ts`
- `src/frontend/web/src/lib/avatar/planner/AvatarPlanner.ts`
- `src/frontend/web/src/lib/avatar/Avatar.ts` (executes planner actions)
- [Avatar Planner](avatar-planner.md)

### Expression preset mapping

The facial expression layer also works through `EmotionGroup`.

Current expression presets:

- `affection -> relaxed`
- `esteem -> relaxed + slight happy`
- `delight -> happy`
- `drive -> relaxed + happy blend`
- `alarm -> surprised`
- `rejection -> angry`
- `revulsion -> angry + sad blend`
- `gloom -> sad`
- `neutral -> neutral`

While a Gesture clip that keys emotion presets plays, its keyed expressions
replace this face, blended by the clip's fade weight (see Pose and clip JSON
artifacts in `avatar-animation.md`). The emotion state itself is unchanged and
returns as the clip fades out.

Relevant files:

- `src/frontend/web/src/lib/avatar/emotionExpressionPresets.ts`
- `src/frontend/web/src/lib/avatar/ExpressionController.ts`
- `src/frontend/web/src/lib/avatar/Avatar.ts`

### Faces on non-VRoid Avatars

Content keys VRM mood presets and VRoid `Fcl_*` parts. Avatars converted from
VRChat or exported from Unity or Blender usually have neither, but carry
standard MMD face morphs, ARKit shapes, or both. At load (`prepareLoadedVrm`)
Animama gives such an Avatar the names content keys, region by region: each
mood splits into brow, eye and mouth, `Fcl_BRW_<Mood>`, `Fcl_EYE_<Mood>` and
`Fcl_MTH_<Mood>` play one region each, and the preset and `Fcl_ALL_<Mood>`
play all three. Each region plays, in order:

1. the model's own VRoid part;
2. its standard MMD morph (`mmdFaceExpressions.ts`);
3. the ARKit mix of `arkitFaceCompositions.json`, when every shape that
   region of the table uses resolves (`arkitFaceExpressions.ts`);
4. the VRM preset fallback below.

| Mood      | Brows  | Eyes     | Mouth    |
| --------- | ------ | -------- | -------- |
| Joy       | にこり | 笑い     | にっこり |
| Fun       | にこり | なごみ   | にっこり |
| Sorrow    | 困る   | –        | –        |
| Angry     | 怒り   | じと目   | –        |
| Surprised | 上     | びっくり | お       |

Only these standard MMD names are used, and まばたき, ウィンク and ウィンク右 for
blinks (below). Regions without one (–) use the ARKit mix or the preset.
`Fcl_EYE_Spread` plays びっくり or ARKit's wide eyes.

- The preset and `Fcl_ALL_<Mood>` combine their regions' MMD morphs and ARKit
  mixes and replace a preset the file authors, so such Avatars show the same
  faces in Animama. A mood with a region neither covers keeps the file's own
  preset whole, because one preset cannot be split by region; without one, that
  region stays neutral. Content keying a single region still plays its MMD
  morph or mix.
- An Avatar with VRoid mood parts of its own, such as a VRoid model with added
  ARKit ("Perfect Sync") shapes, keeps its authored face.
- Other parts: `Fcl_EYE_Close`, `_L` and `_R` play ARKit's blink shapes, or
  else `blink`, `blinkLeft` and `blinkRight`; `Fcl_MTH_Large` and `Fcl_MTH_A`
  play ARKit's `jawOpen` only. MMD's お is not used for them, and moods never
  use mouth visemes. `Fcl_EYE_Iris_Hide` hides the detected irises as eye
  effects do (`irisHideExpression.ts`, from weight 0.5); an iris it cannot
  hide (not found, or in the face skin's mesh part) is reported
  (`iris_hide_unavailable`).
- A preset that binds nothing counts as absent: three-vrm registers every
  preset, bound or not.
- `blink`, `blinkLeft` and `blinkRight` that bind nothing play MMD's まばたき,
  ウィンク and ウィンク右 (the unsuffixed wink is the model's left eye), or else
  ARKit's `eyeBlinkLeft` and `eyeBlinkRight`; a file's own bound blinks stay.
  They remain subject to three-vrm's `overrideBlink` and to the eyelid closure
  correction, which never scales a blink preset by itself.
- A name that resolves to nothing is reported once per Avatar in Diagnostics.
  So are emotion-map names the Avatar cannot play, such as `Fcl_MTH_Large`
  beside a smile without `jawOpen`; positive emotions without any smile use the
  whole `relaxed` fallback instead.
- A model with no VRoid parts, MMD morphs, ARKit shapes or mood presets keeps a
  neutral face, and Diagnostics says so (`face_expressions_none`).
- Diagnostics lists each mood's source per region (`own parts`, MMD, ARKit,
  preset or none).
- The table's `vowels` can shape lip sync on Avatars with every vowel shape, a
  separate bar from the moods
  ([ARKit lip-sync shaping](avatar-lipsync.md#arkit-lip-sync-shaping)). With
  the default viseme lip sync a mood's `jawOpen` adds to separate viseme
  morphs; only ARKit lip-sync shaping stacks it on the same `jawOpen` morph.
- The eyelid closure correction (`eyelidClosure.ts`) measures each
  lid-closing expression on the model (mood presets, MMD morphs such as 笑い,
  ARKit mixes) and reduces blink by how far it closes the lids. An ARKit mix
  uses its share of blink's motion. Other expressions use the share at the
  lid's own vertices, scaled so that VRoid's happy counts as closed (a smiling
  arc also raises the lower lid, which blink's motion does not show); that
  scale reproduces Annie's verified relaxed. VRoid faces keep VRoid's profile
  (Annie's verified one, the default for others such as Andrew). Winks
  (`Fcl_EYE_Close_L`/`_R`) are not corrected, so the open eye keeps blinking.

`vrm:inspect` prints each mood's region sources, as `Avatar.load` decides them.

To make a converted Avatar emote in other VRM apps too, bake the mood presets
into a copy of its file (from `src/frontend/web`):

```bash
pnpm -s vrm:bake-expressions <source.vrm> --out <baked.vrm> [--replace]
```

It writes `happy`, `angry`, `sad`, `relaxed` and `surprised` from the same
table, binding each mesh's own spelling of each ARKit shape (or, as the app
does, scaling an expression the file authors under that ARKit name), plus an empty
`neutral` when the file has none. It keeps presets that already bind something
unless `--replace` (an authored `neutral` is always kept), and lists table
shapes the file lacks or matches ambiguously. Animama plays the baked presets
for moods it cannot compose from the Avatar's MMD morphs and ARKit shapes, or
when it has VRoid mood parts; `vrm:inspect` shows which. Only VRM 1.0 files are supported.
It changes nothing but those preset entries, never modifies the source and never
overwrites an existing output. The baked presets keep `overrideBlink: none`, so
another app's automatic blink can close the lids past shut while a preset that
partly closes them (`happy`, `relaxed`, `sad`) is shown; Animama's own correction does not travel with the file.

Tune faces by editing the JSON table. Aim for each region, at weight 1, to move
about as far as the VRoid part it stands for on an Included Avatar (relaxed's
mouth, `mouthSmile` 1, matches `Fcl_MTH_Fun`), because the emotion map's
weights were chosen for VRoid parts. ARKit has no closed-arc eye
shape, so happy's eyes are a partial blink with a squint. On faces whose bangs
cover the brows, only the eye and mouth regions show. Affection, esteem and
delight key `Fcl_MTH_Fun`, so tuning relaxed's mouth retunes all three.

### Reaction clip mapping

Turn-scoped reactions use the `emotion.update` metadata, not the persisted
24-emotion map. An exact canonical `TRACKED_EMOTIONS` tone and Reaction
intensity 1–4 name one of the Anima's Reaction cells, and the planner plays one
member of that cell's pool, picked at random without repeating the member the
cell played last ([avatar planner](avatar-planner.md)). Group names such as `alarm`,
neutral tones, zero-intensity events, empty cells, duplicate events, stale
events, and unknown strings are consumed without a reaction; no other cell is
tried. Idle keeps the emotion state's three intensity levels.

Reaction clips live under
`content/included/reactions/<id>/<id>.json`; outside an Anima route the
built-in catalog picks from the Included Reactions each cell's id names
(`<emotion>-1`, or `<emotion>-<n>` and `<emotion>-<n>-b`). They
can include
expression tracks keyed at beats plus timed avatar VFX, scene VFX, and SFX events,
and the built-in catalog skips files that include humanoid transforms. Reaction
definitions are expression/effect actions and cannot declare humanoid motion;
`ReactionClipPlayer` projects their samples to expressions before
fade/interpolation. Every Included Reaction clip
declares a same-run `talking` playback lifetime: it fades in, holds its final
expression/VFX sample while the avatar remains talking for that run, and fades
out when talking ends or the run changes. VFX events without `duration` hold
until the reaction clears; SFX events fire once and do not replay during the
hold.

Because Reactions play over lip-sync, Included Reactions shape the face with
VRoid's per-feature morphs instead of whole-face presets: brows and eyes
(`Fcl_BRW_*`, `Fcl_EYE_*`) carry the emotion, and mouths stay closed
(`Fcl_MTH_Fun`, `Fcl_MTH_Angry`) or open only slightly (`Fcl_MTH_Joy`,
`Fcl_MTH_Sorrow`, `Fcl_MTH_Surprised` at low weights). Prefer the same for new
Reactions. On an Avatar without those morphs, each missing whole-face, brow or
eye part plays as its mood's VRM preset (`partExpressionFallback.ts`; Joy
`happy`, Fun `relaxed`, Sorrow `sad`, Surprised `surprised`, Angry `angry`),
taking the largest weight among those parts and any value keyed for the preset
itself, for Reaction overlays and Gesture clips alike; mouth parts have no
fallback. Where the parts exist, a Reaction's part only fills the room left by
the same mood's whole-face expression in the resting face, so a Reaction never
pushes brows or eyes past a full expression.

Relevant files:

- `src/frontend/web/src/lib/avatar/reactionClips.ts`
- `src/frontend/web/src/lib/avatar/reactionPools.ts`
- `src/frontend/web/src/lib/avatar/partExpressionFallback.ts`
- `src/frontend/web/src/lib/avatar/reaction/ReactionClipPlayer.ts`
- `src/frontend/web/src/lib/avatar/planner/AvatarPlanner.ts`

### Voice selection mapping

Pocket voice selection uses the derived group layer.

Current voice lane mapping:

- `neutral -> neutral`
- `affection -> joy`
- `esteem -> joy`
- `delight -> joy`
- `drive -> joy`
- `alarm -> angry`
- `rejection -> angry`
- `revulsion -> angry`
- `gloom -> sad`

Important detail:

- voice selection currently uses `dominantEmotion.group` and `dominantEmotion.intensity`
- animation/expression selection uses `dominantGroup` and `dominantGroupSummary`

Relevant files:

- `src/frontend/web/src/lib/speech/pocket/anima-voice-selection.ts`
- `src/frontend/web/src/ui/main/chat/useChatSession.ts`

## 6) UI behavior

The primary emotion UI is group-first.

Relevant files:

- `src/frontend/web/src/ui/components/emotional-state.tsx`
- `src/frontend/web/src/ui/components/mood-bloom.tsx`

Current behavior:

- The profile summary shows up to three active groups, ranked by average, as
  labeled colored bars without scores. “Feeling…” uses the strongest individual
  emotion within the dominant group, with an explicit emoji for each emotion.
  Scores 1–15 add “slightly”, 16–25 use the plain feeling, and 26–30 add “very”.
  Each band also selects its owner-approved emoji from the shared 24 × 3 mapping;
  neutral remains 😐. Both the profile and management header use this mapping.
- `web/src/lib/emotion/presentation.ts` owns the shared group palette and headline
  mappings. Domain normalization, averages and canonical tie-breaking are unchanged.
- Expanded details use the mood bloom: each group, in canonical order clockwise
  from the top, is a fan of three petals in its color, one per emotion, whose
  length grows linearly with the score on a fixed 0–30 scale; faint rings mark
  10, 20 and 30. Every group's symbol and name sit around the rim: the three
  strongest are emphasized and groups at zero are faint. The current mascot sits
  at the center on a glow of the dominant group's color. Petals open from a bud
  on mount and sway; once the strongest emotion reaches 3, its petal sheds
  pollen. When a consumer's reaction `beat` changes, up to three petals that
  grew since the previous render (largest gain first) flash, pulse and throw
  sparks from their tips; the burst is removed after under a second. The
  details surfaces pass no `beat`. Reduced motion shows a still bloom without
  bursts.
- The sway and pollen animate continuously, so the full bloom repaints every
  frame while it is shown; keep it to surfaces opened on demand. The `mini`
  variant has no sway, pollen, bud, shadow, rings, rim or selection and costs
  nothing at rest.
- Each group's slot, out past its name, is a button: hovering, focusing or
  tapping it tints the slot, grows its petals, fades the other groups and
  reveals the group with its three constituents in a reserved caption below the
  bloom, so details never obscure it. A pointer or tap also picks the petal
  nearest its angle: that petal stays bright while its siblings dim, the rim
  shows its emotion and score in place of the group name, and the caption
  emphasizes it. The keyboard selects whole groups. Each button's accessible
  name lists the group maximum and constituent scores. Leaving the bloom clears
  pointer selection, a tap elsewhere clears touch selection, and keyboard focus
  remains independently inspectable. Color supplements labels rather than
  replacing them.
- Neutral shows “Feeling neutral” without empty-state copy or fabricated bars.
  The profile hides its emotion disclosure while neutral; management retains the
  zero-valued bloom, whose petals rest behind the neutral mascot.
- Existing `default`, `compact`, `showcase` and `inline` chart consumers use the
  same presentation data, with compact chart sizing where appropriate.

The chat header opens the profile through one button containing the active
Anima name followed by a `mini` mood bloom: the current feeling's mascot with
her petals around it, overhanging the button so the header keeps its height.
On a chat route whose runtime belongs to the Anima, the runtime's
`lastEmotionEventId` is the bloom's `beat`, so petals a chat emotion update
grows burst; persisted state and snapshots never burst, and the bloom
remounts per Anima. There is no separate emotion-status trigger. The name uses
a plain button with a subtle hover background and visible keyboard focus.
The chat-header profile is one continuous banner, portrait and identity surface.
Details navigates to management; Settings opens existing controls with Back and
restores the profile scroll position. The identity uses sanitized `IDENTITY.md`
Markdown, hiding only a leading H1 that matches the display name in this view.
Edit identity opens the existing memory editor within the chat profile, preserving
the chat route and restoring focus on close. The stored document and management
preview remain unchanged. The management header uses the same feeling emoji and
group color, with a full-feeling tooltip; clicking it still selects Emotions.

Emotions opens a 360px panel 16px to the right of the stationary centered profile
only when the measured desktop position leaves another 16px at the viewport edge.
With a fine hover pointer, the summary opens the compact panel on hover or focus;
a short close delay lets the pointer cross the gap. Keyboard Tab enters the bloom.
The panel uses an inset heading without a close icon or hover instructions.
Without hover support, an explicit toggle controls the disclosure. When the
viewport has insufficient side space, details expand inline above identity.
Resize preserves disclosure state;
Escape collapses emotions before closing the dialog. Both surfaces share one
focus boundary and backdrop, and transitions respect reduced motion.

### Persisted vs live state surfaces

The app uses both persisted and live runtime emotion sources depending on context.

Current behavior:

- chat/avatar surfaces use live runtime emotion state when a run is active
- header and anima info modal can show live runtime state for the active anima, with persisted fallback
- anima list and anima details pages remain persisted-state views

The `EmotionalState` component accepts a `sourceLabel` prop so each surface can explicitly show whether it is displaying live runtime state or persisted anima state.

## 8) Editing rules for future work

If you change the emotion system, update these pieces together:

- backend source of truth: `src/backend/animama/domain/emotions.py`
- frontend source of truth: `src/frontend/web/src/lib/emotion/index.ts`
- backend prompt/schema: `src/backend/animama/app/main_structured_response.py`, `src/backend/animama/prompts/structured_output.py`
- backend primary update helper: `src/backend/animama/app/primary_emotion_update.py`
- frontend runtime/UI/avatar mapping files under `src/frontend/web/src/lib/emotion`, `src/frontend/web/src/lib/avatar`, and `src/frontend/web/src/ui/components`

Invariants to preserve unless intentionally redesigning them:

- storage stays per-emotion
- SSE stays per-emotion full-state
- `EmotionGroup` stays derived
- `neutral` stays non-persisted

If the backend anima schema changes, regenerate the frontend client:

- `pnpm openapi-ts`
- `pnpm prettier`
