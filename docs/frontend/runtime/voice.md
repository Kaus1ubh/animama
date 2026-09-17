# Voice Guide (`src/frontend/web`)

This is the canonical frontend guide for voice input/output in `src/frontend/web`.

## Scope

Focus areas:

- STT audio input, with emphasis on browser providers:
  - Dictation mode
  - Voice mode (same base STT flow + smart-turn auto-submit)
- TTS audio output, with emphasis on Pocket TTS and ElevenLabs TTS
- Runtime integration with chat + avatar phase state + debug surfaces
- anima-specific Pocket voice catalogs when a persisted catalog URL exists

Out of scope:

- Backend service internals
- Full avatar animation authoring details (see
  `docs/frontend/runtime/avatar-animation.md` and
  `docs/frontend/runtime/avatar-lipsync.md`)

For Pocket catalog details and current custom-authoring limitations, see:

- `docs/frontend/features/emotional-voice-catalog.md`

## Runtime Summary

### Input modes

| Mode        | How user starts it                          | STT provider path                         | Acoustic VAD             | Semantic VAD (smart-turn) | Submit behavior    |
| ----------- | ------------------------------------------- | ----------------------------------------- | ------------------------ | ------------------------- | ------------------ |
| `typed`     | text input                                  | none                                      | n/a                      | n/a                       | manual             |
| `dictation` | mic button                                  | resolved provider (`parakeet` or browser) | yes for Parakeet/browser | no                        | manual             |
| `voice`     | voice button or voice-mode switch from chat | resolved provider (`parakeet` or browser) | yes                      | yes                       | auto on `end_turn` |

### STT provider matrix

| Provider           | Source                               | Where used        | Notes                                                                 |
| ------------------ | ------------------------------------ | ----------------- | --------------------------------------------------------------------- |
| `browser_external` | Web Speech API                       | dictation + voice | default browser path                                                  |
| `browser_local`    | Web Speech API with `processLocally` | dictation + voice | strict capability check; en-US fallback on unsupported locale         |
| `parakeet`         | local Parakeet ONNX worker           | dictation + voice | MicVAD speech windows are transcribed locally with final results only |

In the Animama Electron desktop shell, browser Web Speech providers are treated
as unavailable even if Chromium exposes `SpeechRecognition` or
`webkitSpeechRecognition`. Electron can surface the API but fail recognition
with a `network` error, so desktop dictation and voice mode use Parakeet only
when its runtime capability is available.

### Optional offline speech pack

The embedded core does not contain Parakeet weights. Setup offers its install
option unchecked, and Settings provides catalog-sized download, cancellation,
and removal controls. `GET /v1/runtime-capabilities` supplies
`offline_speech_enabled` and nullable `offline_speech_asset_version`. Unknown
or disabled availability is not treated as support; dictation checks fresh
metadata before starting and the worker loader checks it again. Saved provider
preferences are not rewritten just because a capability request failed.

Without the pack, desktop offline dictation and Voice Mode cannot start. Text
chat, avatar animation, microphone permission, and PocketTTS are independent.
The main chat/settings surface offers installation; companion windows direct
the user to main-window Settings. Browser Web Speech fallback remains available
only where the ordinary web platform supports it.

Installed model requests stay on the protected local origin at
`/onnx/models/parakeet-tdt-0.6b-v2/` with `?v=<asset-version>`. FastAPI checks
inventory and containment, supports single byte ranges, and rejects stale
versions. Main disposes every renderer context before removing/replacing bytes,
which terminates existing ONNX workers. Pack transitions keep the same application
origin but reload the app and close companion windows. Native pack installation
and inference still require real reviewed artifacts and user verification.

### TTS provider matrix

| Provider     | Source                       | Primary path           | Notes                                                                                                                                |
| ------------ | ---------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `browser`    | `speechSynthesis`            | fallback/simple speech | queue of utterances                                                                                                                  |
| `pocket_tts` | local worker/worklet runtime | primary voice UX       | detailed below; preferred for avatar sync                                                                                            |
| `elevenlabs` | ElevenLabs WS or HTTP stream | streamed speech output | realtime Flash/Multilingual models stream from text chunks; v3 plays backend-pushed finalized audio grouped by sentence or paragraph |

## Core Concepts and IDs

### `runId` vs `turnId` vs `jobId`

- `runId`: chat request run identifier. Created when we actually submit user text to backend (`useChatSession.ts`).
- `turnId`: local user speaking turn identifier. Created at voice/dictation start and rotated after smart-turn auto-submit.
- `jobId`: smart-turn inference job identifier for one semantic check.

Why both `turnId` and `runId`:

- `turnId` exists before any submit, so it is the stable key for local VAD windows/transcript/audio aggregation.
- `runId` starts only when chat chat run begins.

### Shared voice types

Runtime voice types live in:

- `src/frontend/web/src/lib/types/voice-types.ts`

Important types:

- `AvatarInteractionPhase`
- `SttSegment` + `SttSegmentSource`
- `AcousticVadEvent`
- `SmartTurnJob`
- `SemanticVadDecision`
- `VoiceTurnState` (type-level scaffold)

Note:

- `activeVoiceTurn` exists in `avatar-runtime-store` shape but is not fully populated by current dictation runtime yet.

### Runtime session state

`useDictation()` distinguishes session mode from live capture state.

Important exposed state:

- `activeMode: "dictation" | "voice" | null`
- `isMicCaptureActive`
- `isVoiceMicMuted`

Why this matters:

- a voice session can remain active while mic capture is paused
- `activeMode` distinguishes dictation from voice mode
- avatar listening UI follows active capture, not merely "some voice session exists"

## Developer and self-host model inputs

Parakeet weights are acquired from exact pinned upstream revisions into a verified
shared store, outside Git worktrees. Use the [model setup guide](../../backend/operations/model-assets.md)
before starting Vite or Compose. The same-origin model URLs, inference worker and
installed desktop pack lifecycle are unchanged. Runtime startup never downloads
from Hugging Face; browsers do not receive upstream acquisition URLs or credentials.

## STT Pipeline (Dictation + Voice Mode)

Primary orchestration:

- `src/frontend/web/src/hooks/use-dictation.ts` (top-level lifecycle and integration)
- `src/frontend/web/src/hooks/voice/browser-recognition-runtime.ts` (Web Speech result/lifecycle + text buffers)
- `src/frontend/web/src/hooks/voice/mic-vad-runtime.ts` (MicVAD callback cluster + runtime creation)
- `src/frontend/web/src/lib/speech/client-parakeet/client.ts` (client Parakeet worker client)
- `src/frontend/web/src/workers/client-parakeet-worker.ts` (local Parakeet ONNX runtime)
- `src/frontend/web/src/hooks/voice/use-voice-end-turn-coordinator.ts` (pending end-turn submit coordinator)

### Start behavior

Entrypoint:

- `startDictation(mode?: "dictation" | "voice")`
- `switchMode(nextMode: "dictation" | "voice")`

Rules:

- `mode === "voice"` resolves the preferred provider:
  - Parakeet is used when available and selected, or as an available fallback
    when browser STT is unavailable
  - browser STT remains the normal web default when available
- `mode === "dictation"` resolves preferred provider via `resolvePreferredSttProvider(...)`:
  - may choose Parakeet
  - surfaces Parakeet startup/transcription errors instead of silently switching providers
- desktop shell detection disables Web Speech availability; without an
  installed Parakeet capability, desktop dictation and Voice Mode stay disabled
- `switchMode("voice")` is used by `ChatInterface` to hand off from active plain dictation into voice mode

Provider helpers:

- `src/frontend/web/src/lib/speech/stt-provider.ts`

### Voice mode provider flows

Voice mode has two STT provider implementations. Both share the same MicVAD,
smart-turn, auto-submit, avatar phase, mute/unmute, silence-reset, and chat
input integration. They differ in where transcript text comes from and when
smart-turn is run.

#### Browser STT voice mode

Browser voice mode is recognition-event driven:

1. `startDictation("voice")` resolves to `browser_external` or
   `browser_local` when browser STT is selected and supported.
2. `startBrowserDictation(provider, "voice")` creates:
   - a browser `SpeechRecognition` instance
   - MicVAD acoustic gate state
   - per-turn text buffers (`finalText` and `interimText`)
   - the smart-turn worker
   - a separate visualizer stream for the waveform
3. Browser recognition runs continuously with interim results enabled.
4. Result events are parsed by `processBrowserRecognitionResult(...)`.
5. Transcript text is routed through the current MicVAD gate:
   - outside a window: ignored
   - inside a non-real speech window: tentative
   - inside a real speech window: committed
   - just after an accepted real window: can be committed during the late-final
     grace window
6. Final browser text emits through `onSegment(...)` and final/interim buffers
   publish `onTranscriptPreview(...)`.
7. Accepted MicVAD audio is appended to `smartTurnAudioRef` at speech end.
8. Smart-turn runs on the rolling accepted audio. If it returns `end_turn`, the
   end-turn coordinator submits committed text immediately or waits briefly for
   browser transcript updates/fallback buffers.

Browser voice mode can show live interim text because the browser recognition
API exposes interim transcript events.

#### Parakeet STT voice mode

Parakeet voice mode is accepted-audio-window driven:

1. `startDictation("voice")` resolves to available `parakeet` when selected or
   when browser STT is unavailable, including the desktop shell.
2. `startParakeetDictation("voice")` loads or reuses the local Parakeet worker,
   creates MicVAD acoustic gate state, creates final/interim text buffers,
   loads the smart-turn worker, and starts a separate visualizer stream.
3. No browser `SpeechRecognition` instance is created.
4. MicVAD is the only source of speech-window boundaries.
5. On accepted `onSpeechEnd(audio)`, `transcribeParakeetSpeechWindow(...)`
   sends the complete accepted mono `Float32Array` window to the worker with
   `client_parakeet/transcribe`.
6. The worker runs `model.transcribe(audio, 16000, ...)` once and returns final
   text.
7. Non-empty final text is committed to the current voice turn, emitted through
   `onSegment({ source: "parakeet", isFinal: true })`, and recorded in the
   shared text buffer with empty `interimText`.
8. After text commit, the accepted audio is appended to `smartTurnAudioRef`.
9. Smart-turn then runs on the rolling accepted audio. If it returns
   `end_turn`, the committed Parakeet transcript is already available to the
   same end-turn coordinator used by browser voice mode.

Parakeet voice mode does not show live interim text. The first visible text for
a speech window arrives after MicVAD accepts the window and local transcription
finishes.

#### Shared voice-mode behavior

- `muteVoiceMic()` pauses capture while preserving the current voice session.
- In Animama Desktop, Press to talk is a hold shortcut for the same Voice Mode
  session. It does not start a new mode: when Voice Mode is active and muted,
  holding the configured keyboard shortcut or mouse button calls
  `unmuteVoiceMic()`, and release calls `muteVoiceMic()` only if Press to talk
  was what changed the mic state. Press to talk release flushes any active
  MicVAD speech window before pausing capture, so releasing the shortcut marks
  the end of the utterance instead of discarding buffered speech. Smart-turn
  still runs for that flushed speech window, but with a lower `0.05` threshold
  so Press to talk release strongly biases the turn toward `end_turn`.
- Browser mute stops browser recognition, MicVAD, and the visualizer.
- Parakeet mute stops MicVAD and the visualizer while preserving the warmed
  Parakeet worker, smart-turn worker, turn id, and text/audio buffers.
- `unmuteVoiceMic()` resumes capture for the same voice turn and reuses the
  smart-turn worker when possible.
- `stopDictation()` fully tears down the active voice session.
- The silence reset timer is provider-agnostic: if stale transcript or
  smart-turn audio remains after the timeout, it rotates to a new `turnId` and
  clears the visible chat input.

### Parakeet STT details

Parakeet STT is local client-side STT:

- the browser worker loads `parakeet.js` from local v2 int8 assets with
  `backend: "wasm"`
- MicVAD owns speech-window segmentation and stop/start decisions
- accepted MicVAD windows are sent to the worker for final-window transcription
- the model stays warm for the current app session; mic/VAD/audio resources are
  stopped on every stop

Primary files:

- `src/frontend/web/src/hooks/use-dictation.ts`
- `src/frontend/web/src/hooks/voice/mic-vad-runtime.ts`
- `src/frontend/web/src/lib/speech/client-parakeet/client.ts`
- `src/frontend/web/src/lib/speech/client-parakeet/worker-protocol.ts`
- `src/frontend/web/src/workers/client-parakeet-worker.ts`

#### Parakeet startup

`startParakeetDictation(mode)` sets the active provider to `parakeet`, enters
`dictation` or `voice` mode, and exposes the preparation/loading state used by
the chat mic/voice controls. It then tears down or reuses VAD/smart-turn state
as appropriate before creating or reusing a local `runId`, `turnId`, and
acoustic gate.

The Parakeet worker is loaded with:

- `loadClientParakeetWorker({ backend: "wasm", sampleRateHz: 16000 })`
- local model URLs from `CLIENT_PARAKEET_MODEL_ASSET_PATHS`
- ORT WASM URLs bundled through Vite `?url` imports

The worker serializes all requests through a promise queue so load,
transcription, and dispose operations cannot use the model concurrently. If the
same model URLs/backend/sample rate are already loaded, the worker returns
`reused: true` and keeps the warmed model.

After the worker is ready, Parakeet starts MicVAD with:

- model `v5`
- `processorType: "AudioWorklet"`
- positive threshold `0.3`
- negative threshold `0.25`
- redemption window `1400ms`
- pre-speech padding `200ms`
- minimum speech `180ms`

Those thresholds live in `use-dictation.ts`. They apply to the MicVAD speech
window, not to Parakeet decoding.

#### MicVAD window lifecycle for Parakeet

Parakeet uses the same acoustic gate callbacks as browser STT, but it does not
route Web Speech transcript text through the gate. MicVAD is the source of truth
for when Parakeet should transcribe.

Window events:

1. `onSpeechStart`
   - opens an acoustic gate window with `openSpeechWindow(...)`
   - publishes a debug `speech_start` event
   - calls `onSpeechWindowStarted(...)` with `turnId` and `windowId`
2. `onSpeechRealStart`
   - marks the active gate window as real speech
   - publishes a debug `speech_real_start` event
   - moves avatar phase to `user_speaking`
3. `onVADMisfire`
   - discards the active gate window
   - calls `onSpeechWindowInvalidated({ reason: "vad_misfire" })`
4. `onSpeechEnd(audio)`
   - closes the gate window with `finishSpeechWindow(...)`
   - if rejected, calls
     `onSpeechWindowInvalidated({ reason: "speech_end_rejected" })`
   - if accepted, calls `onAcceptedSpeechEnd(...)` with the MicVAD audio,
     `turnId`, `windowId`, sample count, and close time

Only accepted windows are transcribed. Rejected windows and VAD misfires are
discarded and do not emit chat input text.

#### Final-window Parakeet path

Parakeet uses final-window transcription:

1. `startParakeetDictation()` loads/reuses the Parakeet worker.
2. It starts MicVAD and a separate visualizer `getUserMedia` stream for the chat
   mic waveform.
3. MicVAD records each speech window and passes the accepted mono `Float32Array`
   to `onAcceptedSpeechEnd(...)`.
4. `onAcceptedSpeechEnd(...)` calls `transcribeParakeetSpeechWindow(...)`.
5. `transcribeParakeetSpeechWindow(...)` sends one
   `client_parakeet/transcribe` worker request containing the complete accepted
   window.
6. The worker calls `model.transcribe(audio, 16000, ...)` once and returns final
   text plus timing/metric data.
7. `useDictation` ignores stale results by session id, provider, run id, turn
   id, and current dictation state.
8. Non-empty final text is emitted through `onSegment(...)` with
   `source: "parakeet"` and `isFinal: true`, which lets `ChatInterface` insert
   it into the chat input.

In voice mode, Parakeet commits that final text to the current voice turn before
running smart-turn for the accepted window. This keeps the existing browser
voice-mode auto-submit timeout unchanged: when smart-turn returns `end_turn`,
the committed Parakeet transcript is already available to the end-turn
coordinator.

This path has no interim transcript preview. The first text visible to the user
arrives after MicVAD accepts the speech window and the worker finishes the final
`transcribe(...)` call.

### Browser recognition details

Recognition configuration:

- `continuous = true`
- `interimResults = true`
- local mode sets `recognition.processLocally = true` when supported

Result collection model:

- Browser result parsing runs in `collectBrowserSpeechSegments(...)`.
- Changed tail is scanned from `event.resultIndex` through `event.results.length - 1`.
- Final and interim segments are separated per event.
- Final text is appended to a per-turn `finalText` buffer.
- Interim text is replaced as a per-turn `interimText` preview buffer (not append-only).

Locale fallback:

- local mode catches `language-not-supported`
- retries once with `en-US`

Session resilience behavior:

- `no-speech` is treated as transient for browser STT:
  - it does not stop dictation/voice mode
  - recognition is restarted on `onend`
- unexpected browser `onend` (when user did not request stop) auto-restarts recognition to keep capture active
- explicit user stop still tears down recognition/VAD/smart-turn as before
- voice mode also supports a temporary pause path (`Mute Mic`):
  - browser recognition, acoustic VAD, and the visualizer stream are paused
  - voice mode remains active
  - current turn/session state is preserved instead of being treated as a full stop
  - interim preview is cleared on mute
  - unmute resumes browser capture for the same voice-mode session
- fatal browser errors (`not-allowed`, `service-not-allowed`, `audio-capture`, unrecoverable language support issues) suppress auto-restart and surface as errors

Voice-mode silence reset behavior:

- Voice mode adds a one-shot silence timeout (`VOICE_SILENCE_RESET_MS`, currently `6000ms`) that applies only when stale buffers exist.
- On timeout, the runtime clears transcript/smart-turn buffers by rotating to a new `turnId` (`silence_timeout_6s`).
- Reset is deferred while a smart-turn inference job is active, then retried after a short delay.
- Reset is also deferred while an end-turn auto-submit is pending.
- The timeout is cancelled on resumed speech (`onSpeechStart` / `onSpeechRealStart`) and does not continually churn during long idle periods.
- `ChatInterface` clears visible input text when this timeout reset fires, keeping UI text aligned with internal buffer resets.

### Acoustic VAD gating

Gate state machine:

- `src/frontend/web/src/lib/voice/acoustic-vad-gate.ts`

VAD runtime:

- `MicVAD.new(...)` from `@ricky0123/vad-web`
- forced `processorType: "AudioWorklet"`
- model `v5`
- assets:
  - base model path `/onnx/models/vad/`
  - ORT wasm base `/onnx/ort/1.24.2/`

Important browser commit rule:

- Browser transcript text is committed only when routed through a real-speech window.
- Text outside active windows or in non-real-speech windows is dropped/tentative.

Late-final transcript grace:

- Web Speech final transcript delivery can lag behind VAD `speech_end`.
- To avoid dropping valid trailing text as `no_active_window`, dictation keeps the most recent accepted real-speech window alive for a short grace period (`LATE_FINAL_TRANSCRIPT_GRACE_MS`, currently `1000ms` in `use-dictation.ts`).
- During this grace window, final transcript segments are committed against the just-closed window instead of being ignored.

Window lifecycle:

1. `onSpeechStart`: open window (tentative)
2. `onSpeechRealStart`: mark real speech, promote tentative text
3. `onVADMisfire`: discard window tentative text
4. `onSpeechEnd(audio)`: accept/reject window audio + finalize window

Transcript routing:

- handled by `routeTranscriptSegment(...)`
- decision outcomes:
  - `committed`
  - `tentative`
  - `ignored`

### Interim vs final transcript buffers

Per turn, voice STT keeps:

- `finalText`: authoritative committed text, appended only from final results
- `interimText`: live preview text, replaced on each browser recognition update

Display model:

- Chat input preview is rendered as `finalText + interimText`.
- Interim text is shown as a lighter overlay in `ChatInputTextArea`.
- Parakeet writes final text only; its interim text remains empty.

Interim clearing rules:

- cleared when an update contributes final text and no interim tail remains for that update
- cleared when no VAD window is active for current turn (`no_active_vad_window`)
- cleared when assistant run/TTS is active (`activeRunId` or `activeSpeechRunId`) to avoid self-transcription echo
- cleared on VAD misfire/rejected speech window invalidation and on turn rotation/stop teardown

### Audio stream model

Browser STT has parallel input channels:

- Web Speech internal audio path for transcription
- VAD mic stream managed by `vad-web` for acoustic boundary detection
- optional visualizer `getUserMedia` stream for UI waveform

In muted voice mode:

- browser recognition is paused
- VAD capture is suspended
- the visualizer stream is stopped
- the voice-mode session remains active in UI/runtime state

This is intentional because Web Speech does not expose raw transcript audio for custom processing.

Parakeet uses MicVAD's accepted audio window for transcription and a separate
visualizer stream for the waveform. In muted Parakeet voice mode, MicVAD and
the visualizer are stopped while the active turn, transcript buffer,
smart-turn worker, and warmed Parakeet worker are preserved.

## Voice Mode Semantic VAD (Smart-Turn)

Voice mode extends browser or Parakeet STT with semantic end-of-turn
classification.

Main files:

- `src/frontend/web/src/lib/voice/smart-turn-worker-client.ts`
- `src/frontend/web/src/lib/voice/smart-turn-worker-protocol.ts`
- `src/frontend/web/src/workers/smart-turn-worker.ts`
- `src/frontend/web/src/hooks/use-dictation.ts` (job orchestration + decision handling)
- `src/frontend/web/src/hooks/voice/use-voice-end-turn-coordinator.ts` (pending submit + timeout)
- `src/frontend/web/src/lib/voice/smart-turn-short-utterance-overrides.ts` (short utterance forced `end_turn` phrases)

### Model/runtime contract

Load-time config:

- model: `/onnx/models/smart-turn/smart-turn-v3.2-cpu.onnx`
- ORT wasm base: `/onnx/ort/1.24.2/` (resolved to absolute URL before worker load)

Worker preprocessing:

- requires mono 16kHz audio
- target length: 8s (`128000` samples)
- behavior:
  - truncate from front when longer
  - left-pad zeros when shorter
- applies waveform normalization (mean/std) before feature extraction
- uses the local Whisper-compatible feature extractor implementation in `src/frontend/web/src/lib/voice/smart-turn/local-whisper-feature-extractor.mjs`
- asserts feature shape `[1, 80, 800]`

Inference result:

- probability score
- decision by threshold (`0.2`):
  - `> 0.2` => `end_turn`
  - else => `continue`

### Rolling audio and supersession behavior

In `use-dictation.ts`:

- accepted VAD speech segments append to `smartTurnAudioRef` (rolling turn audio buffer)
- browser STT appends accepted audio immediately at speech end
- Parakeet voice mode transcribes the accepted window first, commits final text,
  then appends the same accepted audio
- semantic check runs once per accepted speech window after that provider has
  updated its turn transcript/audio state
- if a new speech segment arrives before prior result settles:
  - previous job is superseded
  - newest job/result wins by `(jobId, sequence)` guard

Current retention policy:

- keep accumulating voiced audio for the current turn
- worker always truncates/pads to last 8s at inference time
- reset buffer only at turn boundary/reset events (for example after semantic auto-submit turn rotation)

### Auto-submit behavior

When semantic result is `end_turn`:

1. Queue a pending end-turn submit request (`queuePendingVoiceEndTurn`).
2. Immediately try to submit using committed transcript (`submitPendingVoiceEndTurn("smart_turn_decision")`).
3. If committed transcript is not ready yet, keep pending and wait for
   transcript updates (`submitPendingVoiceEndTurn("transcript_update")`).
4. If still pending at timeout (`SMART_TURN_END_TURN_WAIT_MS`, currently `1000ms`):
   - first fallback to buffered `finalText`
   - then fallback to buffered `interimText`
5. If transcript and callback are present, invoke `onVoiceAutoSubmit(...)`.
6. `ChatInterface` forwards to `handleSubmitText(...)` with:
   - `inputMode: "voice"`
   - `submitReason: "semantic_end_turn"`
   - `turnId`, `smartTurnJobId`, `smartTurnScore`, `smartTurnLatencyMs`
7. rotate to a new `turnId` and reset per-turn smart-turn state

If no transcript/callback exists:

- logs + debug event `auto_submit_skipped`
- returns to listening phase without dispatch

Provider timing:

- Browser STT may run smart-turn before final browser text has arrived, so the
  pending submit path often waits for transcript updates or uses timeout
  fallback buffers.
- Parakeet STT commits final text before running smart-turn for the accepted
  window, so `smart_turn_decision` usually submits immediately when the
  semantic decision is `end_turn`.
- If Parakeet returns empty text, smart-turn can still produce `end_turn`, but
  the coordinator skips auto-submit after the normal timeout rather than
  submitting an empty message.

### Short utterance override behavior

To reduce false `continue` decisions on short utterances:

- if smart-turn model returns `continue`
- and voiced turn audio is short (`< 2000ms`)
- and current turn text (normalized) matches `SMART_TURN_FORCE_END_TURN_SHORT_UTTERANCE_SET`

then effective decision is forced to `end_turn`.

Matching source priority:

1. current turn buffered `finalText`
2. current turn buffered `interimText`

For browser STT, the match can come from final or interim recognition text. For
Parakeet STT, the match comes from final text only because Parakeet has no
interim path.

## Chat and Avatar Runtime Integration

### Chat input integration

`src/frontend/web/src/ui/main/chat/ChatInterface.tsx`:

- tracks three dictation buffers:
  - `dictationBaseRef` (user-typed base text)
  - `dictationCommittedRef` (final dictation text)
  - `dictationInterimRef` (live interim dictation preview)
- merges display text as `base + (committed + interim)`
- updates interim preview from `onTranscriptPreview` (browser STT buffer updates)
- starts:
  - `startDictation("dictation")`
  - `startDictation("voice")`
- switches from active dictation into voice mode with `switchMode("voice")`
- toggles voice capture pause/resume with:
  - `muteVoiceMic()`
  - `unmuteVoiceMic()`
- handles smart-turn auto-submit callback
- clears input + dictation buffers on voice silence reset callback
- drives avatar listening capture from `isMicCaptureActive`, so muted voice mode does not count as active listening

`src/frontend/web/src/ui/components/chat-input.tsx`:

- `ChatInputTextArea` accepts `interimSuffix`
- when suffix is present, textarea text is rendered via overlay spans:
  - committed/base portion in normal foreground
  - interim suffix in lighter muted color
- underlying textarea text is made transparent with normal caret to keep typing/editing behavior intact
- composer button state is mode-specific:
  - idle:
    - mic button starts dictation
    - voice button starts voice mode
  - dictation active:
    - mic button becomes `Stop dictation`
    - voice button keeps voice-mode affordance and switches to voice mode when clicked
  - voice active:
    - voice button becomes `Stop voice mode`
    - mic-side button becomes `Mute Mic` / `Unmute Mic`

`src/frontend/web/src/ui/main/chat/useChatSession.ts`:

- `submitMessage(...)` accepts voice metadata args
- metadata currently used for logging/telemetry; chat request payload remains standard text payload

### Avatar interaction phases

Canonical runtime phase:

- `interactionPhase` in `src/frontend/web/src/stores/avatar-runtime-store.ts`

Voice-related phases:

- `listening`
- `user_speaking`
- `semantic_check`
- `submitting`

Run/TTS phases:

- `thinking`
- `talking`
- `idle`
- `user_typing` is text-input driven, not voice driven, but shares the same
  runtime phase field.

Animation state mapping:

- in `src/frontend/web/src/lib/avatar/planner/AvatarPlanner.ts`
- mapping summary:
  - `talking` -> talking animation loop
  - `thinking`/`submitting` -> thinking loop
  - `listening`/`user_speaking`/`semantic_check` -> listening loop
  - `user_typing` -> idle animation loop with listening-style procedural policy
  - default -> idle

## Debug Surface and Logging

### Voice debug store

Store:

- `src/frontend/web/src/stores/voice-vad-debug-store.ts`

Tracks:

- acoustic VAD session status/errors/provider/turn/window
- transcript char counters (committed/tentative)
- rolling accepted audio samples + latest frame probs
- VAD event history
- gate decision history
- smart-turn enablement, worker/job status, buffered samples, superseded count
- smart-turn decision/event history

### AnimaDebugPanel

UI section:

- `Voice / Acoustic VAD` in `src/frontend/web/src/ui/debug/AnimaDebugPanel.tsx`

Shows:

- VAD status + context
- smart-turn status + errors + active job + buffer + latest decision
- recent VAD events, gate decisions, and smart-turn events

### Logger categories

Common categories you will see:

- STT/voice: `Dictation`, `BrowserSTT`, `VADInit`, `VADLifecycle`, `VADEvent`, `VADGate`
- smart-turn: `SmartTurnWorker`, `SmartTurnWorkerClient`, `SmartTurnJob`, `SmartTurnDecision`, `SmartTurnSubmit`, `SmartTurnAudio`
- chat integration: `ChatInterface` (`Submit`, `Dispatch`, `TTS`, etc.)
- pocket runtime: `PocketTTSRuntime`, `TTSPlayback`

## TTS Runtime (Focus: Pocket TTS)

Primary orchestration:

- `src/frontend/web/src/hooks/use-tts-playback.ts`

Pocket runtime bridge:

- `src/frontend/web/src/hooks/use-pocket-tts-runtime.ts`

Pocket core:

- `src/frontend/web/src/lib/speech/pocket/createPocketTTS.ts`
- `src/frontend/web/src/lib/speech/pocket/core/PocketTTSCore.js`

### Provider selection

Source of truth:

- merged settings from `SettingsProvider`
- provider parsing/capability checks in `src/frontend/web/src/lib/speech/tts-provider.ts`

Provider ids:

- `browser`
- `pocket_tts`
- `elevenlabs`

### TTS run lifecycle

`useChatSession.ts` drives:

1. `startRun(runId)` at dispatch start
2. `appendToken(runId, token)` on SSE token
3. `completeRun(runId)` on SSE complete
4. `cancelAll()` on stop/error/route cleanup

### Chunking behavior

Chunk helpers:

- `src/frontend/web/src/lib/speech/tts-chunker.ts`

Behavior:

- browser TTS respects `tts_stream_chunks`
- pocket TTS is forced non-streaming at token phase (`shouldStreamChunksForProvider` returns `false` for pocket), then emits final chunks on completion
- ElevenLabs v3 is forced non-streaming in the frontend token pipeline because
  backend-pushed `tts.audio` frames carry the finalized audio for structured
  speech batches

### Browser TTS

Mechanics:

- `SpeechSynthesisUtterance` queue
- emits `onAudioStarted` on utterance start
- emits `onAudioEnded` only after run complete + queue drained
- robust cancellation via `speechSynthesis.cancel()`

### ElevenLabs TTS

Primary files:

- `src/frontend/web/src/hooks/use-elevenlabs-tts-runtime.ts`
- `src/frontend/web/src/hooks/use-elevenlabs-finalized-tts-runtime.ts`
- `src/frontend/web/src/hooks/use-tts-playback.ts`
- `src/frontend/web/src/ui/main/chat/useChatSession.ts`

Bootstrap flow:

1. `useChatSession.ts` starts a TTS run when chat SSE starts.
2. If the resolved provider is `elevenlabs`, `useChatSession.ts` sends
   `dispatch_options.tts` with `enabled: true`, `provider: "elevenlabs"`,
   `transport: "auto"`, `language_code: null`, and the selected
   `model_id` in the `POST /v1/animas/{anima_id}/chat:sse` body. When
   `model_id` is `eleven_v3`, it also sends `finalized_chunking` as
   `"sentence"` or `"paragraph"`.
3. For `eleven_flash_v2_5` and `eleven_multilingual_v2`, `chat:sse` starts
   ElevenLabs session setup concurrently with the primary chat agent and emits
   `tts.session` when it can initialize the realtime session. Assistant text
   may arrive before that event.
4. `use-elevenlabs-tts-runtime.ts` accepts the SSE session and opens the
   direct ElevenLabs websocket. If no `tts.session` or `tts.session.error`
   arrives within 1500 ms, the runtime marks TTS failed for that run.
5. Backend returns a fresh single-use `tts_websocket` token for direct
   browser-to-ElevenLabs realtime playback.
6. For `eleven_v3`, `chat:sse` does not emit `tts.session`. The backend
   synthesizes prepared speech as sentence or paragraph finalized-audio batches
   and pushes `tts.audio`, `tts.done`, or `tts.error` events over the same chat
   SSE stream.

Runtime behavior:

- realtime ElevenLabs audio is played through the shared PCM worklet path, not
  `speechSynthesis`
- finalized Eleven v3 `pcm_24000` SSE frames are decoded into Web Audio
  `AudioBuffer` objects and scheduled with `AudioBufferSourceNode`
- output format is `pcm_24000`
- supported realtime models are `eleven_flash_v2_5` and
  `eleven_multilingual_v2`; frontend speech preferences default to
  `eleven_flash_v2_5`
- `eleven_v3` is a finalized-text model; it uses `chat:sse` audio events and
  starts audio once backend main-structured tone and speech text are ready
- v3 `sentence` grouping is the default and keeps one upstream finalized
  request per sentence for the fastest first audio; v3 `paragraph` grouping
  waits for paragraph, four-sentence, 600-character, or final flush boundaries
  for smoother long-form audio
- v3 finalized speech requests can send gruut `text_with_ws` to ElevenLabs
  with ElevenLabs text normalization off; the backend omits `previous_text` and
  `next_text` plus request-id continuity fields for v3 because the live API
  rejects or does not support those fields, and the resulting audio stream does
  not request or consume ElevenLabs alignment metadata
- Eleven v3 may receive a backend-only emotional audio tag prefix derived from
  main-structured `emotional_tone` and backend-visible anima emotion
  intensity; sentence grouping prefixes only the first upstream request, while
  paragraph grouping prefixes every paragraph batch; this prefix is not present
  in frontend text or lip-sync metadata
- the selected model is returned as `tts.session.model_id` and used as the
  ElevenLabs websocket `model_id` query parameter for realtime models
- realtime playback uses `AudioContext` + `AudioWorklet`
- finalized v3 prewarms its local `AudioContext` and gain node at run start,
  then uses native `AudioBufferSourceNode` playback when `tts.audio` arrives
- finalized v3 `tts.audio` frames are backend-coalesced PCM chunks so the
  browser schedules fewer, larger audio buffers
- paragraph-grouped v3 audio includes a backend-generated 400 ms silent PCM
  `tts.audio` frame before each paragraph batch after the first
- `tts_stream_chunks` remains meaningful for realtime models, so streamed SSE
  text can be chunked into realtime TTS requests before completion
- application settings show the chunked TTS switch unchecked and disabled while
  `eleven_v3` is selected without overwriting the saved preference
- application settings show the v3-only `Audio grouping` control while `eleven_v3`
  is selected without overwriting that saved grouping when the user switches
  back to a realtime model
- text chunks may queue while the realtime runtime waits for the SSE-provided
  session
- no reconnect is attempted mid-run; websocket failure ends TTS for that run only
- chat delivery still completes even if ElevenLabs audio fails
- v3 audio playback and run completion are not coupled to provider timing
  metadata

### Main structured chat responses

When the effective TTS setting is enabled, `useChatSession.ts` sends
`dispatch_options.main_structured_response=true` with the chat SSE request. The
backend validates the selected anima chat profile or request override against
catalog support for `main_structured_response`, parses and validates the model's
JSON envelope, then emits semantic `user.response` events with
`response_format="main_structured_json"` and
`response_part="speech"` or `response_part="display"`.

If TTS is enabled but the backend emits ordinary `user.response` events without
`response_part="speech"` or `response_part="display"`, chat and TTS use the
normal text streaming path.

The frontend contract is:

- `emotional_tone`: requested in the model's JSON envelope but
  backend-internal; it is not emitted as visible frontend text. Together with
  hidden `emotional_intensity`, it lets backend `chat:sse` compute and persist
  a full-state `emotion.update`. Missing, blank, neutral/default-friendly, or
  unrecognized tone metadata logs a backend warning when malformed, emits a
  no-op emotion update with `emotional_intensity=0`, and uses the backend-only
  `[friendly]` Eleven v3 provider prefix when Eleven v3 synthesis is active.
- `emotional_intensity`: requested in the model's JSON envelope but
  backend-internal; the backend maps the raw `1..10` value to the avatar
  `0..3` scale before including it as optional context on `emotion.update`.
- `speech`: required string; rendered as the normal assistant bubble and sent to
  TTS from the typed speech event
- `display`: optional visible-only string; rendered as a subsequent assistant
  bubble when it differs from `speech`

Speech events can include tokenized and phonemized metadata for avatar visemes.
For structured speech streaming, `useChatSession.ts` accumulates the raw viseme
inputs from every speech segment that is actually sent to TTS, preferring
`tts_text` and `tts_phonemized_text` when the backend supplies gruut
`text_with_ws`. Display events and `emotional_tone` are never sent to frontend
TTS. Backend parsing validates structured voice JSON before semantic events
reach the browser; malformed JSON is not spoken as fallback text.

Transport details:

- realtime ElevenLabs sends text frames straight to the upstream websocket
- finalized Eleven v3 receives `tts.audio` frames from `chat:sse`
- sentence and paragraph v3 grouping use the same frontend SSE event contract
- paragraph pauses are ordinary silent PCM audio frames, not separate frontend
  timing metadata

Single-run walkthrough:

1. Chat opens the normal assistant SSE run and creates a `runId`.
2. As assistant text arrives, `useChatSession.ts` hands TTS chunks to `use-tts-playback.ts`.
3. If provider is `elevenlabs`, `useChatSession.ts` sends explicit TTS intent
   in `dispatch_options.tts`. Realtime models start the websocket runtime for
   that run; `eleven_v3` prewarms local finalized audio resources while it
   waits for finalized speech text.
4. Realtime startup does two things in parallel:
   - creates local audio resources (`AudioContext` + shared `PCMPlayerWorklet`)
   - waits up to 1500 ms for the `chat:sse` `tts.session` event
5. The backend `chat:sse` TTS bootstrap runs concurrently with assistant text
   generation, resolves the active anima voice from
   `preferences.speech.elevenlabs.primary_voice`, and emits the session event
   as soon as setup finishes. Emotion label and intensity are accepted for
   compatibility but do not affect voice selection.
6. The session response includes a fresh single-use token and the browser
   connects to ElevenLabs directly.
7. On websocket open:
   - realtime sends `{ "text": " " }` to ElevenLabs immediately and marks the runtime ready
8. As more assistant text arrives, the runtime queues and flushes incremental
   `{ "text": "..." }` frames.
9. When the assistant run finishes, the frontend flushes the realtime stream
   with `{ "text": "" }`.
10. For Eleven v3, the backend emits `tts.audio` base64 PCM chunks after the
    main-structured `emotional_tone` and sentence or paragraph speech batch are
    known. Any emotional prefix is applied only to the upstream ElevenLabs
    request text.
11. Audio frames are decoded into `Int16Array` chunks, converted to normalized
    `Float32Array` samples, copied into 24 kHz `AudioBuffer` objects, and
    scheduled with `AudioBufferSourceNode`.
12. Playback timing stays local:
    - the first scheduled v3 buffer start drives `onAudioStarted`
    - accumulated scheduled samples drive `onAudioDurationResolved`
13. When the upstream signals final output or `chat:sse` emits `tts.done`, the
    runtime marks the stream finished and waits for scheduled local audio
    sources to drain before emitting playback end.
14. If `chat:sse` emits `tts.session.error`, the frontend marks TTS skipped for
    that run.
15. If websocket setup, upstream streaming, SSE-pushed v3 generation, or audio
    decode fails, the runtime emits one warning, tears down TTS for that run,
    and leaves the chat/SSE response stream intact.

Lip-sync behavior:

- ElevenLabs is treated as lip-sync-capable in the same lifecycle tier as Pocket
- viseme source remains SSE `phonemized_text` / `tokenized_text`, with
  gruut-prepared `tts_phonemized_text` / `tts_text` preferred when those fields
  are the text actually sent to ElevenLabs
- actual audio start is anchored on the local playback start event: PCM worklet
  `firstPlayback` for realtime/Pocket paths, or the first scheduled v3
  `AudioBufferSourceNode` start
- actual duration is derived from played sample count, not provider timestamps
- `avatar-lipsync-bridge-store.ts` stores provider-agnostic speech audio timing
  so both Pocket and ElevenLabs feed the same viseme timing pipeline
- if duration resolves before raw viseme inputs are queued, the bridge stores
  the duration and rebuilds when inputs arrive instead of throwing through the
  TTS callback

### Pocket TTS (detailed)

Runtime setup:

- `createPocketTTS()` uses:
  - `assetBaseUrl: "/tts"`
  - `playbackStrategy: "adaptive"`
  - `enableVoiceCloning: true`

Core initialization loads:

- audio worklet + playback pipeline
- worker runtime
- Pocket model assets (`/onnx/models/pocket-tts/*`)
- ORT runtime (`/onnx/ort/1.24.2/*`)

Generation path:

- `generateAndWait(text, { preservePlayback, endStream, voice, animaId, animaVoiceKey, signal })`
- queued sequentially in `use-tts-playback` with abort support

End-of-stream handling:

- explicit stream-end flags are tracked (`pocketStreamOpenRef`, `pocketStreamNeedsExplicitEndRef`)
- if needed, `endPocketStream()` is called to force deterministic playback completion

Playback event bridge:

- `playback_started` => avatar speech start + optional viseme timing start
- `generation_finished` => audio duration metrics for viseme timing
- `playback_ended` => playback end signal and eventual audio-ended completion

Voice resolution:

- helper: `src/frontend/web/src/lib/speech/pocket/voice-preferences.ts`
- anima/emotion helper: `src/frontend/web/src/lib/speech/pocket/anima-voice-selection.ts`
- selection happens once at `completeRun(runId)`, using the latest dominant avatar emotion from `avatar-runtime-store`
- anima voice keys normalize to:
  - `neutral`
  - `{emotion}_{1|2|3}` for non-neutral emotions
- anima catalog path:
  - `/onnx/models/pocket-tts/animas/{animaId}_voices.bin`
- anima catalog format matches the shared `voices.bin` format:
  - multiple named embeddings in one binary file
  - each embedding is stored as `[1, numFrames, 1024]`
- fallback order:
  1. exact anima emotion key
  2. same emotion with lower intensity, descending
  3. anima `neutral`
  4. legacy Pocket voice preference path
  5. shared default voice `cosette` (or first shared voice if `cosette` is absent)
- legacy Pocket voice preference path still uses:
  1. anima override `tts_pocket_anima_voice`
  2. user default `tts_pocket_voice`
- custom voice token `custom` is still supported in the legacy path when a custom voice embedding exists
- custom/cloned voices remain in-memory only; cloning does not create a anima `{animaId}_voices.bin`

## End-to-End Lifecycle

### A) Dictation mode (browser provider)

1. User starts dictation.
2. VAD starts and speech recognition starts.
3. Web Speech result updates refresh per-turn text buffers (`finalText` + `interimText`).
4. Final segments are routed/committed by acoustic gate state.
5. Late-arriving final segments can still be committed during post-window grace.
6. User manually submits text.
7. Normal chat request + TTS flow starts.

### B) Voice mode with browser STT

1. User starts voice mode.
2. Provider resolution selects `browser_external` or `browser_local`.
3. Browser `SpeechRecognition`, VAD, the smart-turn worker, and waveform
   visualizer start.
4. User speaks:
   - browser recognition emits final/interim transcript events
   - transcript segments are routed through acoustic windows
   - accepted speech audio is appended to the smart-turn turn buffer
5. On each accepted `speech_end`, smart-turn classification runs on the rolling
   turn audio.
6. `continue`:
   - keep listening
   - keep existing turn transcript/audio
7. `end_turn`:
   - queue pending auto-submit and attempt immediate commit-based submit
   - wait briefly for transcript updates if needed
   - timeout fallback can use buffered final/interim text
   - rotate to new turn
   - continue listening for next turn
8. User can pause capture without leaving voice mode:
   - mic-side button becomes `Mute Mic` / `Unmute Mic`
   - mute pauses recognition, VAD, and waveform capture
   - voice mode remains active and can still be fully stopped by the voice button
   - unmute resumes capture for the same voice-mode session
9. If voice buffers remain stale with no further speech for 6s:
   - runtime performs a one-shot silence reset
   - `turnId` rotates and transcript/audio buffers are cleared
   - listening continues in the same voice-mode session

### C) Voice mode with Parakeet STT

1. User starts voice mode.
2. Provider resolution selects available `parakeet` because it is selected or
   browser STT is unavailable.
3. The local Parakeet worker, VAD, the smart-turn worker, and waveform
   visualizer start.
4. User speaks:
   - MicVAD opens, marks, and closes speech windows
   - no browser recognition is created
5. On accepted `speech_end(audio)`, the accepted audio window is transcribed by
   the Parakeet worker.
6. Final text from Parakeet:
   - commits to the current voice turn
   - emits through `onSegment({ source: "parakeet", isFinal: true })`
   - updates the shared final text buffer with empty interim text
7. The accepted audio is appended to the smart-turn turn buffer.
8. Smart-turn classification runs after the Parakeet final text commit.
9. `continue`:
   - keep listening
   - keep existing turn transcript/audio
10. `end_turn`:

- queue pending auto-submit and attempt immediate committed-text submit
- committed Parakeet final text is normally already available
- rotate to new turn
- continue listening for next turn

11. User can pause capture without leaving voice mode:

- mic-side button becomes `Mute Mic` / `Unmute Mic`
- mute pauses VAD and waveform capture
- the warmed Parakeet worker and smart-turn worker are preserved
- voice mode remains active and can still be fully stopped by the voice button
- unmute resumes capture for the same voice turn

12. If voice buffers remain stale with no further speech for 6s:

- runtime performs a one-shot silence reset
- `turnId` rotates and transcript/audio buffers are cleared
- listening continues in the same voice-mode session

### D) Assistant response with Pocket or ElevenLabs TTS

1. Chat run starts -> TTS run starts.
2. Tokens buffer while response streams.
3. Provider-specific runtime is prepared:
   - Pocket resolves anima/emotion voice selection once near completion
   - ElevenLabs bootstraps per run up front via `chat:sse` `tts.session`, with
     a legacy realtime session endpoint fallback
4. Pocket voice selection uses:
   - current anima id
   - dominant avatar emotion/intensity
   - anima catalog fallback chain
   - legacy shared/custom voice fallback if no anima match exists
5. Text is synthesized through the active provider runtime:
   - Pocket uses the local worker/runtime
   - ElevenLabs realtime uses a direct provider websocket; finalized Eleven v3
     audio arrives through `chat:sse`
6. Shared playback events drive avatar speech/lipsync lifecycle.
7. When playback and run are complete, audio-ended is emitted and avatar returns to idle.

## Assets and Configuration Checklist

### STT/VAD/smart-turn assets

- VAD model:
  - `src/frontend/web/public/onnx/models/vad/silero_vad_v5.onnx`
- VAD worklet bundle (vad-web asset path):
  - `src/frontend/web/public/onnx/models/vad/vad.worklet.bundle.min.js`
- ORT wasm runtime:
  - `src/frontend/web/public/onnx/ort/1.24.2/*`
- smart-turn model:
  - `src/frontend/web/public/onnx/models/smart-turn/smart-turn-v3.2-cpu.onnx`

### Pocket TTS assets

- core bundle assets:
  - `src/frontend/web/public/tts/*`
- Pocket ONNX model files:
  - `src/frontend/web/public/onnx/models/pocket-tts/*`
- shared predefined voice catalog:
  - `src/frontend/web/public/onnx/models/pocket-tts/voices.bin`
- optional anima voice catalogs:
  - `src/frontend/web/public/onnx/models/pocket-tts/animas/{animaId}_voices.bin`

## Known Constraints and Troubleshooting

1. Smart-turn worker load fails with invalid ORT wasm URL:

- Ensure worker receives absolute URLs for model and ORT base.
- This is handled in:
  - `src/frontend/web/src/hooks/use-dictation.ts` (voice start path)
  - `src/frontend/web/src/lib/voice/smart-turn-worker-client.ts` (normalization + trailing slash)

2. STT starts but VAD fails immediately:

- AudioWorklet support is required for acoustic VAD in browser and Parakeet
  STT paths.

3. Browser local STT fails on locale:

- Local mode retries once with `en-US` after `language-not-supported`.

4. Pocket TTS unsupported:

- Requires secure context (`https` or localhost), Worker, and AudioWorklet support.

5. ElevenLabs TTS unsupported:

- Requires secure context (`https` or localhost), `WebSocket`, `AudioContext`, and `AudioWorklet`.
- If the active anima lacks a usable ElevenLabs voice profile, the backend
  realtime bootstrap or finalized stream route returns `409` and only audio is
  skipped.
- If ElevenLabs is not configured server-side, the bootstrap route returns `503`.

6. No auto-submit in voice mode:

- Check smart-turn status/events in debug panel.
- If decision is `continue`, this is expected.
- If decision is `end_turn`, check `SmartTurnSubmit` logs for:
  - immediate attempt trigger (`smart_turn_decision`)
  - transcript-update trigger (`transcript_update`)
  - timeout trigger (`timeout`)
- `auto_submit_skipped` after timeout means committed/final/interim text was unavailable or callback was missing.

7. Frequent `no_active_window` gate decisions while tuning VAD:

- Usually indicates VAD windows are closing faster than browser STT emits final transcript.
- Mitigations:
  - increase `redemptionMs` and/or `minSpeechMs`
  - use less aggressive thresholds
  - rely on late-final transcript grace to bridge modest timing mismatch

8. Voice-mode transcript/audio clears after 6s silence:

- This is expected when stale voice buffers exist and no new speech arrives.
- Behavior is voice-mode-only and implemented as a one-shot reset/turn rotation, not repeated stop/start churn.

9. TTS output appears in browser interim transcript preview:

- Browser STT result processing ignores transcript updates while assistant run/TTS is active (`activeRunId` or `activeSpeechRunId`).
- In that state, interim preview is explicitly cleared to avoid self-transcription echo.

## Implementation File Map

### STT + voice mode

- Provider helpers: `src/frontend/web/src/lib/speech/stt-provider.ts`
- Dictation/voice orchestrator: `src/frontend/web/src/hooks/use-dictation.ts`
- Browser STT runtime helpers: `src/frontend/web/src/hooks/voice/browser-recognition-runtime.ts`
- MicVAD runtime helpers: `src/frontend/web/src/hooks/voice/mic-vad-runtime.ts`
- Client Parakeet worker client:
  `src/frontend/web/src/lib/speech/client-parakeet/client.ts`
- Client Parakeet worker protocol:
  `src/frontend/web/src/lib/speech/client-parakeet/worker-protocol.ts`
- Client Parakeet worker runtime:
  `src/frontend/web/src/workers/client-parakeet-worker.ts`
- Voice end-turn coordinator: `src/frontend/web/src/hooks/voice/use-voice-end-turn-coordinator.ts`
- Acoustic gate state machine: `src/frontend/web/src/lib/voice/acoustic-vad-gate.ts`
- Smart-turn protocol/client: `src/frontend/web/src/lib/voice/smart-turn-worker-protocol.ts`, `src/frontend/web/src/lib/voice/smart-turn-worker-client.ts`
- Smart-turn worker: `src/frontend/web/src/workers/smart-turn-worker.ts`
- Smart-turn short utterance overrides: `src/frontend/web/src/lib/voice/smart-turn-short-utterance-overrides.ts`
- Voice runtime types: `src/frontend/web/src/lib/types/voice-types.ts`

### Chat integration

- Chat input UI integration: `src/frontend/web/src/ui/main/chat/ChatInterface.tsx`
- Chat input interim overlay rendering: `src/frontend/web/src/ui/components/chat-input.tsx`
- Chat SSE + TTS bridge: `src/frontend/web/src/ui/main/chat/useChatSession.ts`
- Avatar runtime phase store: `src/frontend/web/src/stores/avatar-runtime-store.ts`
- Animation phase policy: `src/frontend/web/src/lib/avatar/planner/AvatarPlanner.ts`;
  `src/frontend/web/src/lib/avatar/Avatar.ts` executes its actions. See
  [Avatar Planner](avatar-planner.md).

### TTS

- TTS orchestrator: `src/frontend/web/src/hooks/use-tts-playback.ts`
- ElevenLabs runtime hook: `src/frontend/web/src/hooks/use-elevenlabs-tts-runtime.ts`
- Pocket runtime hook: `src/frontend/web/src/hooks/use-pocket-tts-runtime.ts`
- TTS provider helpers: `src/frontend/web/src/lib/speech/tts-provider.ts`
- Shared speech PCM player: `src/frontend/web/src/lib/speech/audio/PCMPlayerWorklet.js`
- Pocket core factory: `src/frontend/web/src/lib/speech/pocket/createPocketTTS.ts`
- Pocket core engine: `src/frontend/web/src/lib/speech/pocket/core/PocketTTSCore.js`
- Pocket voice preference logic: `src/frontend/web/src/lib/speech/pocket/voice-preferences.ts`
- Pocket anima/emotion voice selection: `src/frontend/web/src/lib/speech/pocket/anima-voice-selection.ts`

### Debug surfaces

- Voice debug store: `src/frontend/web/src/stores/voice-vad-debug-store.ts`
- Anima debug panel: `src/frontend/web/src/ui/debug/AnimaDebugPanel.tsx`
