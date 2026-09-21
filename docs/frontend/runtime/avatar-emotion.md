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
- the backend maps raw intensity to avatar update levels:
  - `1-3 -> 1`
  - `4-6 -> 2`
  - `7-10 -> 3`
- the model-facing `emotional_tone` is a vocal tone key, such as `impressed`
  or `happy`
- the backend maps that tone key back to the canonical emotion before emitting
  `emotion.update`
- a non-neutral allowlisted tone promotes its mapped canonical emotion
- one emotion from the soft opposing group is demoted by the same mapped amount
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
- `src/backend/animama/server/routers/chat/chat_sse.py`
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
  `demoted_emotion` are optional context fields
- when present, `emotional_tone` is the canonical backend emotion, not the raw
  vocal tone key from the main structured response
- `emotion_intensity` is not part of this event

Relevant files:

- `src/backend/animama/domain/events.py`
- `src/backend/animama/server/routers/chat/chat_sse.py`
- `src/backend/animama/server/sse_events.py`
- `src/backend/animama/server/emotional_state_persistence.py`

### Gesture selection lives outside emotion updates

The emotional analyst does not select gestures or VFX. Response-matched gesture
selection is part of the primary chat agent's structured response and is
delivered separately through `avatar.gesture.requested`. The backend validates
that gesture id against non-disabled `Animations.gesture` entries in
`src/frontend/web/src/assets/vrm/animations/manifest.json` before the frontend
sees it.

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
  a same-run reaction clip while the avatar is `talking`

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

Relevant files:

- `src/frontend/web/src/lib/avatar/emotionExpressionPresets.ts`
- `src/frontend/web/src/lib/avatar/ExpressionController.ts`
- `src/frontend/web/src/lib/avatar/Avatar.ts`

### Reaction clip mapping

Turn-scoped reactions use the `emotion.update` metadata, not the persisted
24-emotion map. Exact canonical `TRACKED_EMOTIONS` tones map to
`role: "reaction"` clips named `<emotion>-1`, `<emotion>-2`, or `<emotion>-3`
by normalized intensity. Group names such as `alarm`, neutral tones,
zero-intensity events, duplicate events, stale events, and unknown strings are
consumed without a reaction.

Reaction clips live under
`src/frontend/web/src/lib/avatar/poses/json/clips/reactions/`. They can include
inline expression keyframes plus timed avatar VFX, scene VFX, and SFX events,
and the built-in catalog skips files that include humanoid transforms. Reaction
definitions are expression/effect actions and cannot declare humanoid motion;
`ReactionClipPlayer` projects their samples to expressions before
fade/interpolation. Every canonical clip
declares a same-run `talking` playback lifetime: it fades in, holds its final
expression/VFX sample while the avatar remains talking for that run, and fades
out when talking ends or the run changes. VFX events without `duration` hold
until the reaction clears; SFX events fire once and do not replay during the
hold.

Relevant files:

- `src/frontend/web/src/lib/avatar/reactionClips.ts`
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

Relevant file:

- `src/frontend/web/src/ui/components/emotional-state.tsx`

Current behavior:

- The profile summary shows up to three active groups, ranked by average, as
  labeled colored bars without scores. “Feeling…” uses the strongest individual
  emotion within the dominant group, with an explicit emoji for each emotion.
  Scores 1–15 add “slightly”, 16–25 use the plain feeling, and 26–30 add “very”.
  Each band also selects its owner-approved emoji from the shared 24 × 3 mapping;
  neutral remains 😐. Both the profile and management header use this mapping.
- `web/src/lib/emotion/presentation.ts` owns the shared group palette and headline
  mappings. Domain normalization, averages and canonical tie-breaking are unchanged.
- Expanded details use a Recharts radar with circular rings and a fixed 0–30 scale.
  All eight groups remain in canonical axis order; each spoke plots the maximum
  constituent score in its group. Three faint rings mark 10, 20 and 30. Hovering
  the plot or focusing/tapping an axis label reveals that group and its three
  constituents in a reserved caption below the plot, so details never obscure it.
  There is no separate legend, permanent detail card or diagnostic source/scale copy.
  Hover emphasizes the matching label and point using its group color, without
  a label background. Leaving the plot clears pointer selection; keyboard focus
  remains independently inspectable. Color supplements labels rather than replacing them.
- Neutral shows “Feeling neutral” without empty-state copy or fabricated bars.
  The profile hides its emotion disclosure while neutral; management retains the
  zero-valued eight-axis radar.
- Existing `default`, `compact`, `showcase` and `inline` chart consumers use the
  same presentation data, with compact chart sizing where appropriate.

The chat header opens the profile through one button containing the active
feeling emoji followed by the Anima name. Neutral omits the header emoji; there
is no separate emotion-status trigger. The name uses a plain button with a subtle hover background and visible keyboard
focus.
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
a short close delay lets the pointer cross the gap. Keyboard Tab enters the axes.
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
- backend prompt/schema: `src/backend/animama/prompts/profiles.py`, `src/backend/animama/prompts/structured_output.py`
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
