# Chat Interface Runtime Guide

## Package and local composition ownership

The shared session implementation lives at
`src/frontend/packages/product-ui/src/chat/useProductChatSession.ts`, and SSE
classification lives at `packages/product-ui/src/query/mutations/useChatSse.ts`.
The local SSE path re-exports the package implementation. The local
`web/src/ui/main/chat/useChatSession.ts` is the playback/settings adapter: it
connects `useTtsPlayback`, avatar and lip-sync stores, mounted-content readiness,
and ElevenLabs speech policy to the shared session. Run lifecycle order and
structured-response handling remain in the shared hook.

A consumer supplies `ProductRuntimeProvider` with owner, chat capability and
transport, plus its own `QueryClientProvider`. `useProductChatSession` also
requires the issued `runtimeRevision`, `canChat`, and an explicit remount action;
a chat capability alone never substitutes for a runtime fence. Text-only hosts
may use the stable `textOnlyChatEffects` and `textOnlySpeechPolicy` adapters.
Playback hosts provide `ChatSessionEffects` and `ChatSpeechPolicy`. Routes are
callbacks (`openDraftChatRoute`, `replaceChatRoute`), so the package owns no router.
The SSE hook aborts its owned stream on Stop, unmount, or owner/transport
remount. Buffered or late frames cannot update callbacks after cancellation,
and a replaced stream cannot clear the new stream's controls.
POST streams still permit one attempt; typed chat mutations explicitly disable
query-client retry defaults. A remount conflict preserves the unsent input and
requires the existing explicit recovery action.

## Model selector provider icons

The selector and selected-model control use the catalog's `logo_provider` to
render a bundled provider mark from `web/public/provider-logos`. OpenAI, Google,
xAI, Groq, DeepSeek and Hugging Face have pinned local SVGs; other adapters keep
an accessible initial fallback. The same assets ship in the production web
build served by FastAPI and embedded desktop. Logos never require a CDN request.
The asset directory records the upstream revision and preserves its MIT notice;
desktop runtime staging includes the corresponding notice group.

## Failed turns and recovery

The shared session keeps a failure notice beside the affected user message. Known
provider codes distinguish missing/rejected credentials, access or usage limits,
rate limits, timeouts and unavailable providers. Local admission errors describe
installation access, without treating every HTTP 403 as an invalid provider key.
Unknown errors use a safe fallback; raw provider bodies, URLs, credentials and
exception messages are never inserted into the notice. Details show only an
allowlisted error code. A valid provider retry delay is shown as guidance.

Any received partial reply remains visible and is labelled incomplete. The notice
makes no claim that an uncertain turn was saved. Failed turns are local to the
mounted chat session; switching chats or reloading discards that notice/partial
output and loads actual server history. Later successful turns do not clear older
failure notices or move them below the new conversation. A server-confirmed
message with the same run ID replaces its optimistic local projection.

**Restore message** puts the original text into an empty composer for editing; it
never sends a request, replaces an existing draft, or restores attachment choices.
It is disabled while another reply is active or the composer contains a draft.
The user decides whether to resend, including after a suggested rate-limit delay.
POST streams are never automatically retried. Intentional Stop remains quiet and
does not imply that the upstream provider stopped generating or billing.

An in-stream error is terminal: subsequent duplicate errors, text and
`run.completed` cannot turn that failure into a successful cached answer. EOF
without completion reports an interrupted turn unless the stream was intentionally
cancelled or superseded. Text snapshots update synchronously so an error or
completion arriving in the same network chunk cannot lose the last text increment.

Mounted package browser tests exercise these states with an injected fake
transport. They prove the shared session and notice behavior without provider
calls, a running Compose stack or native/physical acceptance.

`ChatInterfaceView` renders the package's actual `ChatConversation` and existing
`ChatInput` primitives. Its upload/model/dictation controls, quick-chat behavior,
and desktop message insets stay local. `SidebarAnimas` renders the shared
`AnimaSelection` using TanStack links supplied by the local route composition.
Compiled `@animama/product-ui/styles.css` includes the shared theme and component
utilities; `theme.css` also exposes those theme tokens for the local utility build.
No consuming build needs the original web sources or their aliases.

This document describes how the Vite web chat runtime runs end-to-end, including:

- chat UI wiring (`ChatInterface`)
- session orchestration (`useChatSession`)
- SSE transport (`useChatSse`)
- STT dictation flow
- TTS playback flow
- avatar update integration points

For canonical STT/TTS/voice-mode details, see `docs/frontend/runtime/voice.md`.

## 1) File map

Primary files:

- `src/frontend/web/src/ui/main/chat/ChatInterface.tsx`
- `src/frontend/web/src/ui/main/chat/useChatSession.ts`
- `src/frontend/web/src/query/mutations/useChatSse.ts`

Related speech/avatar files:

- `src/frontend/web/src/hooks/use-dictation.ts`
- `src/frontend/web/src/hooks/use-tts-playback.ts`
- `src/frontend/web/src/stores/avatar-runtime-store.ts`

Related layout files:

- `src/frontend/web/src/ui/main/MainShell.tsx`
- `src/frontend/web/src/ui/components/message.tsx`

Related model-selection files:

- `src/frontend/web/src/ui/components/chat-input.tsx`
- `src/frontend/web/src/query/hooks/useModelProviders.ts`
- `src/frontend/web/src/query/hooks/useAnima.ts`
- `src/frontend/web/src/query/mutations/useUpdateAnimaChatProfile.ts`
- `src/frontend/web/src/ui/components/model-selector.tsx`
- `src/frontend/web/src/ui/settings/SettingsProvider.tsx`

## 2) High-level flow

1. User types or dictates text in `ChatInterface`.
2. `useChatSession.handleSubmit()` validates the loaded anima plus its frozen
   mounted runtime catalog and ensures a chat id exists.
3. The hook starts a run (`run_id`) and opens SSE via `useChatSse.startChat(...)`,
   sending the catalog's required `runtime_revision` with the turn.
4. SSE events stream back:

- response tokens -> update streaming assistant text and TTS queue
- main-structured response parts -> render `speech`, render distinct
  `display`, and speak only `speech`
- emotion updates -> update avatar runtime store
- same-run, same-revision avatar gesture requests -> queue one-shot gesture planner events
- run completion -> finalize run state + cache messages; talking ends on TTS audio-ended

5. `displayMessages` merges persisted server messages + local optimistic message + in-flight assistant stream.

## 3) `ChatInterface.tsx`

Responsibilities:

- Renders message list, empty state, submit/stop controls.
- Calls `useChatSession` and renders its `displayMessages` projection.
- Owns dictation composition behavior via `useDictation`.
- Renders the chat model selector immediately before dictation controls.

Sidebar Search is implemented outside `ChatInterface` in
`ui/sidebar/ChatSearchModal.tsx`. It searches persisted current-user chat
messages through `POST /v1/chats/search`, renders anima profile pictures from
the search response with anima names underneath, shows the matching message
date beside the chat title, highlights matching snippet terms, shows one result
per matching chat, and navigates to the selected chat without participating in
the active SSE stream lifecycle.

### Canvas controls

The main chat header places floating settings, picture-in-picture and fullscreen
buttons at the top right. The settings popover contains the display mode selector,
a camera preset dropdown (while the main scene is visible),
volume/mute settings and background music transport/track selection. Beneath the
preset dropdown, **Fine-tune camera** expands the numeric, field-of-view and
orbit-target controls; it starts collapsed. Camera is not an App Settings section.
These controls appear only for an available main scene, outside picture-in-picture.
Numeric edits show **Custom** in the preset
dropdown; choosing a preset or Reset restores a named preset. Camera adjustments
remain session-only. **Mute all** sits beside the **Volume** heading. There are no separate camera or
music launchers and no bottom-right control pill. The popover fits the viewport
and scrolls when needed; its BGM menu stays inside the canvas fullscreen root.
The camera dropdown lists every preset directly and remains usable in fullscreen.
The floating header buttons use a muted gray hover background.

### Layout modes

`MainShell` owns `canvasMode` and passes it to the route-provided `chatPanel`
render function. The anima route renders `ChatInterface` with
`layout="chat-only"` when `canvasMode === "chat"` and with
`layout="scene-overlay"` for the normal avatar + chat surface.

On desktop, `MainShell` uses the shared adaptive Canvas/sidebar layout. The
expanded sidebar docks beside and resizes the runtime surface; the collapsed
sidebar becomes a transparent compact overlay above the full-width Canvas.

In chat-only mode, `AvatarSceneHost` stops rendering the main avatar scene
unless desktop PiP is active. The chat panel stays mounted as the primary
surface.

`ChatInterface` centers the transcript and composer in a full-height chat
column with `max-w-[800px]` and horizontal padding. `MessageContent` keeps user
bubbles constrained with `max-w-[min(72%,36rem)]` while assistant bubbles can
use the full centered column width. The desktop sidebar overlay inset is only
applied to `scene-overlay`, so chat-only spacing is not shifted to make room for
the avatar scene or sidebar overlay.

Assistant chat bubbles render streamed and persisted text with Streamdown
Markdown by default. The non-persisted Account settings toggle "Render
assistant Markdown" can turn this off for the current app session, which falls
back to the plaintext renderer and sparkle animation path. User bubbles always
render as plaintext.

### Model selector behavior

`ChatInputModelSelector` controls the anima's explicit direct-chat profile
default for the active anima. It loads the backend model catalog from
`GET /v1/model-providers`, loads the anima detail, reads the
active model from `anima.chat_profile.default_model_provider_id`, and persists
changes through `PATCH /v1/animas/{anima_id}/chat-profile`.

The selector groups catalog options by provider label, marks the active
`default_model_provider_id`, closes after selection, and disables while a chat
stream or profile update mutation is in flight. A failed update surfaces a
toast and leaves the current persisted profile unchanged. The selected model
applies to future chat requests; it does not alter an already-running stream.
`useChatSession` also sends the active catalog row id as `model_provider_id` in
each accepted `chat:sse` request, so the streamed turn uses the same row the
selector displays.

When a persisted chat is opened, `useChatSession` loads the chat row from
`GET /v1/chats/{chat_id}` and restores the catalog row that matches
`last_model_client`, `last_model_id`, and `api_standard`. The restored row is
written back to the anima chat profile before normal send is enabled for that
chat.

The frontend treats `api_standard` as the chat compatibility fence.
`last_model_client` is used only to restore the last historical model row. A
selected catalog row with no `api_standard` is disabled for direct chat. If the
active chat already has an `api_standard`, a different-standard model selection
does not update `default_model_provider_id`; it opens a confirmation dialog
above the still-open model selector. Cancel keeps the current chat and model so
the user can keep choosing from the selector. Confirm closes the selector,
switches the profile to the new model, and navigates to the anima draft chat
route so the current draft text can be sent as the first turn of a new chat.

Catalog rows that advertise `requestable_native_tool_support` or
`supported_reasoning_efforts` show a settings button with the `Settings2`
lucide icon. The menu lets users toggle supported native tools, currently
`web_search`, and choose a supported reasoning effort. Supported native tools
are enabled by default when the active model advertises them. Empty
`native_tools` arrays are preserved in `SettingsProvider`, so unchecking a tool
stays unchecked instead of falling back to defaults on the next render.

`native_tool_support` is the complete provider/model capability set and may
also contain backend-owned tools such as memory `apply_patch`. The selector
renders and defaults only `requestable_native_tool_support`. The request builder
filters native-tool overrides against that list as a final defense against
stale in-memory settings after a catalog update; internal capabilities are
never sent through `dispatch_options.native_tools`.

Changing the base model resets request-scoped model settings to that model's
catalog defaults. Changing settings for an inactive row first selects that model
and then applies the requested native-tool or reasoning override. These settings
live in `SettingsProvider` chat request overrides and are sent with future dispatch
requests; they do not persist to the anima chat profile.

Important dictation behavior:

- Maintains two refs:
- `dictationBaseRef`: text that existed before dictation session
- `dictationBufferRef`: incremental transcript accumulated during current dictation session
- `onSegment` appends final transcript segments to buffer and recomputes textarea value.
- Input edits while dictating attempt to preserve user-typed base text and clear stale dictation buffer if needed.
- `isDictating` drives avatar listening phase via `beginListeningCapture()` / `endListeningCapture()`.

Important typing behavior:

- Manual textarea edits with non-empty text start a short-lived
  `user_typing` avatar phase.
- Each manual edit refreshes the inactivity timer; clearing input, submitting,
  starting dictation/voice, or leaving the component ends typing activity.
- The typing phase keeps the avatar's idle base loop and only borrows the
  listening procedural policy for occasional `bounce` or `headNod` motion.

## 4) `useChatSession.ts`

Responsibilities:

- Resolves route anima/chat ids and ingress node.
- Loads anima and chat messages.
- Creates a chat on first message and accepts backend-generated title updates.
- Controls SSE streaming lifecycle.
- Coordinates avatar runtime store and TTS playback hook.
- Reconciles query cache for chat/messages after completion.

### Core state

- `input`: textarea value.
- `draftChatId`: temporary chat id before route replacement.
- `localMessages`: optimistic user message(s) added immediately on submit.
- `streamingRunId`: active run being streamed.
- `streamingSegments` + `streamingSegmentsRef`: incremental assistant output.
- `streamingDisplayText` + `streamingDisplayTextRef`: visible-only display text
  for main structured responses.

Derived state:

- `activeChatId = routeChatId ?? draftChatId`
- `canChat` requires the Anima plus its resolved mounted runtime response and catalog
- `displayMessages = serverMessages + localMessages + optional streaming assistant placeholder`

### Submit lifecycle

`handleSubmit()` executes these phases:

1. Validation and submit setup:

- Rejects empty text or re-entry while streaming.
- Records chat submit interaction metrics.
- Validates `animaId` and the frozen mounted Anima runtime catalog.

2. Chat resolution:

- Reuses existing chat when present.
- Otherwise creates one (`useCreateChat`) and stores temporary `draftChatId`.
- Leaves `title` unset so `chat:sse` can generate the first-turn title server-side.
- Untitled newly-created chats are not inserted into sidebar chat-list caches
  until the backend `chat.title.updated` event supplies a generated title.

3. Run initialization:

- Generates UI run id.
- Adds optimistic local user message.
- Starts TTS run (`startTtsRun(runId)`) and avatar run
  (`startAvatarRun(runId, { inputText })`).
- The avatar runtime store enqueues a generic `runStarted` avatar planner
  event. `AvatarPlanner` consumes that event and may select one delayed
  thinking PoseController clip from the trimmed input text.
- Chat does not choose or play animation clips directly; planner decisions are
  visible through the Animation Debug modal's Avatar Planner section.
- Clears streaming text buffer.

4. Chat SSE request and callbacks:

- Calls `chat:sse` with `animaId`, `message`, `chat_id`, `run_id`, and the
  mounted `runtime_revision`.
- Before clearing input, creating a chat, starting avatar/TTS side effects, or
  opening SSE, checks the selected catalog row against the active chat's stored
  `api_standard`. Missing, unsupported, or different-standard rows block the
  send locally; the backend fence remains authoritative.
- Merges request-scoped `chatRequestOptions` from `SettingsProvider` into the chat
  request body.
- When the effective TTS setting is enabled, adds
  `dispatch_options.main_structured_response=true`.
- `onToken`: appends normal text to `streamingSegments`, routes
  main-structured `speech` and `display` parts, and pushes speakable text to
  TTS only when TTS is enabled. With TTS disabled, the first assistant output
  starts the avatar's `responding_no_tts` presentation phase instead.
- `onEmotionUpdate`: applies the full-state emotion update to avatar runtime store.
- `onAvatarGestureRequested`: queues a gesture request only after transport has
  matched both its run ID and `runtime_revision` to the request.
- `onRuntimeContentRevisionMismatch`: drops the gesture and invalidates the
  runtime query; it never resolves through a similarly named global motion.
- `onChatTitleUpdated`: patches chat-list query caches when the backend saves an
  AI-generated first-turn title. For a newly-created chat, this is the first
  point where the sidebar chat list receives that chat row.
- `onComplete`: calls `completeTtsRun(runId)` for TTS runs, or requests
  non-TTS avatar completion after text animation and planner presentation work
  drain; then writes user+assistant messages into cache, clears
  streaming/local pending state, invalidates chat lists, and replaces route for
  new chats. New chats skip chat-list invalidation until a title update has
  arrived, preventing a temporary `Untitled chat` sidebar row.
- `onError`: abort-safe cleanup; for a pre-stream runtime revision conflict it
  removes the optimistic message, restores the draft, invalidates/refetches and
  remounts the runtime catalog, then asks the user to send again. It never
  resubmits automatically. Other non-abort errors stop TTS/avatar, clear
  streaming state, and show a toast.

### Main Structured Response Mode

Main structured response mode is the backend contract used by normal direct
chat:

- normal `chat:sse` uses `response_format="main_structured_json"` and semantic
  `speech`/`display` parts
- the frontend still sends `dispatch_options.main_structured_response=true` for
  TTS-enabled turns as request intent
- the backend validates the selected anima chat profile or request
  `model_provider_id` against catalog support for `main_structured_response`

The backend direct model-client executor builds the schema for each request.

The request body sent to `/v1/animas/{anima_id}/chat:sse` looks like a
normal chat request with request-scoped options:

```json
{
    "message": "...",
    "run_id": "ui-...",
    "chat_id": "chat-...",
    "model_provider_id": "OpenAIHTTPAgent:gpt-5-nano",
    "dispatch_options": {
        "main_structured_response": true,
        "native_tools": ["web_search"],
        "reasoning_effort": "low"
    }
}
```

If other dispatch options already exist, `useChatSession.ts` merges
`main_structured_response` into that object. When TTS is disabled, the option is
omitted and the backend still emits the normal main structured response as
`response_format="main_structured_json"`. The frontend consumes `speech` and
`display` parts for visible text and avatar presentation. If a future backend
path emits ordinary text without `response_format="main_structured_json"`, token
handling falls back to the normal streaming text path.

For Hugging Face Inference Provider rows, `model_provider_id` preserves the
exact selected catalog id, such as
`OpenAIHTTPAgent:deepseek-ai/DeepSeek-V4-Pro:deepinfra`.

In main structured mode, backend `user.response` events are semantic parts, not
raw JSON fragments. Speech events carry the text that should be rendered and
spoken:

```json
{
    "run_id": "ui-...",
    "node_id": "agent:...",
    "text": "Short spoken text.",
    "response_format": "main_structured_json",
    "response_part": "speech",
    "is_delta": true,
    "part_index": 0,
    "part_final": false,
    "tokenized_text": "Short spoken text.",
    "phonemized_text": [["..."]]
}
```

Display events carry visible-only text and are never sent to TTS:

```json
{
    "run_id": "ui-...",
    "node_id": "agent:...",
    "text": "Display-only text.",
    "response_format": "main_structured_json",
    "response_part": "display",
    "is_delta": true,
    "part_index": 0,
    "part_final": true
}
```

The stream metadata is optional for backward compatibility:

- `is_delta=true` means `text` is an incremental semantic part. For `speech`,
  the frontend appends the text exactly as received, including leading
  whitespace between sentences. For `display`, it appends to the visible-only
  display buffer.
- `is_delta` missing or not `true` means the event is a complete part or
  correction. The frontend replaces the current speech or display text with
  that complete text.
- `part_index` is accepted as ordered metadata for diagnostics and future
  safeguards. The frontend trusts SSE ordering and does not reorder frames.
- `part_final=true` marks the final frame for that part. A final `speech` frame
  can have an empty `text` value; that marker finalizes the accumulated speech
  without changing the assistant bubble.

`useChatSession.ts` treats a token as main structured only when the SSE event
uses `response_part="speech"` or `response_part="display"`. The dispatch option
alone is not authoritative because future backend paths may still return normal
text during a TTS-enabled chat request.

The streaming behavior is:

1. `speech` updates the assistant streaming bubble through the structured
   accumulator. Delta speech grows the same assistant message sentence by
   sentence; complete non-delta speech replaces the current speech text so
   older backend fallback events and correction events still work.
2. `display` updates `streamingDisplayText` separately from speech. Delta
   display appends; complete non-delta display replaces the current display
   text. Display text is never sent to TTS.
3. Normal `user.response` text without `response_part` keeps the older text
   streaming path and can still queue TTS incrementally.
4. Structured speech deltas are routed into the existing TTS pipeline as they
   arrive. When a speech event includes non-blank `tts_text` with
   `tts_text_basis="gruut_text_with_ws"`, that prepared text is sent to TTS;
   otherwise the visible speech text is used. `part_final=true` and
   `run.completed` close the TTS run without re-appending accumulated speech.
   The same TTS-routed speech events append their matching gruut phonemes to
   the run-level avatar viseme inputs; empty final markers and visible
   corrections after streamed TTS do not append duplicate lipsync data.
5. On `run.completed`, the optimistic cache writes one assistant message for
   speech plus one additional assistant message for distinct display text.
   Display text equal to speech is not duplicated.
6. After a reload, the history API returns one provider-shaped assistant row
   with both values in `data.structured`. `mapServerMessagesForDisplay()`
   expands that row back into speech followed by distinct display text, matching
   the live stream. Legacy or malformed structured rows fall back to `content`.

The backend owns JSON parsing and final validation for main structured output.
The frontend trusts the typed SSE parts and does not parse the raw model JSON.

Backend `chat:sse` derives normal emotion updates from the main structured
response, not from a second emotional analyst runner. The hidden
`emotional_tone` and `emotional_intensity` metadata are used
server-side to compute and persist one full-state `emotion.update`. The
frontend continues to treat the event's `emotions` array as the source of
truth; metadata such as `emotional_tone`, mapped `emotional_intensity`,
`promoted_emotion`, and `demoted_emotion` is optional context only.

### Stop lifecycle

`handleStop()`:

- calls `useChatSse.stop()` (aborts stream)
- cancels TTS playback
- finishes avatar run
- clears streaming text/run state

### Route/anima sync effects

- Anima change resets avatar runtime (`resetForAnima`) and seeds baseline emotion snapshot.
- Chat switch clears transient run state (`localMessages`, stream text, active TTS/avatar run).
- Unmount cleanup aborts any active SSE stream and finishes avatar run.

## 5) `useChatSse.ts`

Responsibilities:

- Own one active SSE stream at a time.
- Abort previous stream before starting a new chat request.
- Classify raw SSE chunks into typed events.
- Emit typed callbacks to `useChatSession`.
- Record SSE metrics.

### Event classification

Type guards map incoming chunks to:

- `user.response`-like chunks (contains `text`) -> `onToken`; optional
  `response_format`, `response_part`, `is_delta`, `part_index`, `part_final`,
  tokenized text, and phonemized text are passed through for main-structured
  and viseme handling
- emotion updates (contains `emotions`, with optional tone/intensity context)
  -> `onEmotionUpdate`
- gesture requests (`avatar.gesture.requested` with `gesture` and
  `runtime_revision`) ->
  `onAvatarGestureRequested`
- run completed (contains `run_id` without `text`, `emotions`, or `gesture`) ->
  `onComplete`
- error event (contains `error`) -> `onError`

Run-id guard behavior:

- When a run id is expected, mismatched event run ids are ignored.
- This prevents cross-talk from stale/multiplexed streams.
- When a runtime revision is expected, gesture events with a missing or
  different revision are logged, dropped, and reported to the session for
  query invalidation before they can reach the planner.

POST reconnect behavior:

- The generated SSE transport is limited to one attempt. A chat POST may have
  reached the model before a connection failure, so an automatic reconnect
  could duplicate the user's turn and consume tokens twice.
- Pre-stream HTTP failures preserve their status and JSON detail through
  `ChatSseHttpError`, allowing the session to distinguish the safe
  `runtime_remount_required` recovery path.

### Stream status

`isStreaming` reflects active request lifecycle.
Final status tracked for metrics:

- `ok`
- `error`
- `cancelled` (aborted before error/completion)

## 6) STT dictation pipeline (`use-dictation.ts`)

`ChatInterface` uses `useDictation({ onSegment, onError })`.

Provider selection:

- Resolves preferred STT provider from settings.
- Uses local client Parakeet when `parakeet` is selected.
- Uses browser speech recognition for browser STT providers.

### Parakeet path

1. Load or reuse the client Parakeet worker.
2. Start MicVAD capture for speech-window segmentation.
3. Send accepted mono 16 kHz speech windows to the worker through
   `client_parakeet/transcribe`.
4. Ignore stale worker results by active session, provider, run, turn, and
   dictation state.
5. Emit final transcript text through `onSegment`.

### Browser speech path

1. Start Web Speech recognition (`continuous`, `interimResults`).
2. Emit only final transcript segments via `onSegment`.
3. Maintain optional visualizer stream for UI waveform/stream consumers.
4. Handle provider-specific errors and local-language fallback.

## 7) TTS pipeline (`use-tts-playback.ts`)

`useChatSession` integrates TTS via:

- `startRun(runId)` at dispatch start
- `appendToken(runId, token)` for each streamed token
- `completeRun(runId)` on stream completion
- `cancelAll()` on stop/error/navigation cleanup

Pipeline behavior:

- Buffers token stream and chunk-splits text with `tts-chunker` helpers.
- Supports provider routing (`browser` or `pocket_tts`) from settings.
- Streams chunks incrementally when enabled; otherwise flushes full text at completion.
- Uses idle flush timer so speech starts even when punctuation boundaries are delayed.

Provider details:

- Browser TTS: queues `SpeechSynthesisUtterance` chunks and drains sequentially.
- Pocket TTS: queues generation jobs and supports stream-end semantics for final chunk closure.

## 8) Avatar updates from chat

`useChatSession` updates avatar runtime store on run events:

- submit -> `startAvatarRun(runId, { inputText })`
  (`interactionPhase=thinking`, plus a queued `runStarted` planner event)
- TTS audio started -> `markSpeechStarted(runId)` (`interactionPhase=talking`)
- TTS audio ended -> `markSpeechEnded(runId)` + `finishAvatarRun(runId)`
- TTS disabled, first assistant output -> `markNonTtsResponseStarted(runId)`
  (`interactionPhase=responding_no_tts`)
- TTS disabled, text animation complete -> `requestNonTtsResponseCompletion(runId)`;
  `AvatarCanvasActor` finishes the run after same-run gesture/reaction planner
  work drains. Reactions started during `responding_no_tts` clear after 6s,
  even when their authored lifetime is phase-bound.
- emotion update -> `applyAvatarEmotionUpdate({ emotions, eventId, runId })`
- accepted avatar gesture request -> `requestAvatarGesture({ gesture, eventId, runId })`
- run complete -> `completeTtsRun(runId?)` (run cleanup deferred to TTS completion)
- stop/error/navigation/unmount -> `abortAvatarRun(runId?)` (immediate speech + run reset)

`ChatInterface` also drives listening signal:

- dictation active -> `beginListeningCapture()`
- dictation inactive/unmount -> `endListeningCapture()`

The avatar render loop consumes these signals each frame via `AvatarCanvasActor` and the avatar animation runtime.

## 9) Error handling and cleanup summary

- SSE abort is treated as cancellation, not user-visible failure.
- Runtime-revision conflicts preserve the draft, remount the latest catalog,
  and require an explicit retry.
- Other non-abort SSE errors surface a toast and clear run state.
- Route changes clear transient stream/local state to avoid ghost messages.
- Hook unmount path aborts active stream and resets avatar run.
- TTS is always cancelled/completed with run lifecycle to avoid leaked playback.

## 10) Practical debugging checklist

1. Verify `canChat` (`animaId` + ingress id) before chasing transport bugs.
2. Confirm `run_id` consistency across submit body and SSE events.
3. Check `streamingRunId`, `streamingSegments`, and `streamingDisplayText`
   transitions in `useChatSession`.
4. Validate dictation provider selection and the active provider callback path for STT issues.
5. Validate TTS provider availability and chunk queue drain behavior.
6. Inspect avatar store updates (`startRun`, `markSpeechStarted`, `markSpeechEnded`, `applyEmotionUpdate`, `requestGesture`, `finishRun`) for animation mismatch.
