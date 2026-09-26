# Direct Chat SSE Runtime

`POST /v1/animas/{anima_id}/chat:sse` is the supported direct chat endpoint
for the normal avatar companion turn. It executes one direct model-client turn,
derives emotion updates from the primary response's structured metadata, and
persists the turn.

Implementation entrypoints are `server/routers/chat/chat_sse.py` for stream
lifecycle, `turn_setup.py` for admission and preparation, `sse_runtime.py` for
frames, `session_services.py` for short-lived persistence, and
`app/chat/direct_executor.py` for model/tool execution.

## Request Contract

The route accepts `PyAnimaChatRequest`:

```json
{
  "message": "Hello",
  "chat_id": "optional-existing-or-client-id",
  "run_id": "optional-client-run-id",
  "model_provider_id": "optional-model-providers-id",
  "runtime_revision": "mounted-runtime-revision",
  "dispatch_options": {
    "main_structured_response": true,
    "incognito": false
  },
  "client_context": {
    "time_zone": "America/Toronto",
    "locale": "en-US"
  }
}
```

`client_context` is optional and used only for companion safety: the IANA
`time_zone` sets the local calendar day for the AI notice (unknown or missing
zones use UTC), and the BCP 47 `locale` selects the crisis-resource region when
the owner has not chosen one.

`message` is trimmed by the schema and must be non-empty. `chat_id` is the
thread identifier. The backend creates `chat-<uuid>` and `run-<uuid>` values
when the chat/run identifiers are omitted. The resolved chat ID is used for
durable chat lookup, persistence, and runtime events.
`runtime_revision` is required and identifies the persisted runtime snapshot
frozen by the mounted Anima route. Setup authorizes that exact owner/Anima
snapshot and returns `409` with `detail.code="runtime_remount_required"`
before provider selection or model usage when it is missing or expired. The
client remounts explicitly; it never silently retries a turn against a newer
loadout revision. Setup consumes the immutable typed catalog and Action
selector inventory persisted in that snapshot; it does not consult current
catalog revisions. The snapshot's bounded item-revision map protects later
file preparation, while already prepared browser bytes remain stable if a
source is subsequently edited.
`model_provider_id` is an optional stable catalog selector that must match
`model_providers.id`. When it is present, the backend validates that the row
exists, is active, supports streaming, supports the required
`main_structured_response` kind, and supports requested reasoning effort or
native tools before the provider is invoked. When it is omitted, the route
requires an explicit `anima_chat_profiles` row for the anima. Missing
profiles fail setup before any upstream model call. Unsupported, inactive, or
unregistered provider IDs are rejected before model invocation. Accepted turns
persist the resolved assistant message `model_provider` and `model` snapshot
through the existing chat-message persistence path.

Direct chat also enforces the chat API standard recorded on `chats`. The first
model-backed `chat:sse` request for a missing or empty chat stores the selected
provider's `api_standard` on the chat row before memory context, history
replay, Responses cursor use, or upstream model invocation.
Subsequent requests may switch models only within the same `api_standard`.
Requests that would switch between OpenAI Chat Completions
(`chat_completions`) and OpenAI Responses (`responses`) fail setup with
`409` and detail code `chat_api_standard_mismatch`. Gemini and LiteLLM catalog
rows currently have no direct-chat standard mapping and fail setup with
`chat_api_standard_unsupported`.
DeepSeek V4 Flash and V4 Pro rows use `OpenAIHTTPAgent`, classify as
`chat_completions`, and can continue existing Chat Completions chats. They are
rejected from Responses-backed chats by the same mismatch fence.
Hugging Face Inference Provider rows also use `OpenAIHTTPAgent`, classify as
`chat_completions`, route through `https://router.huggingface.co/v1`, pin
DeepInfra through the catalog model ID suffix, and are rejected from
Responses-backed chats by the same mismatch fence.
`dispatch_options` reuses `PyAnimaDispatchOptions`, so the direct path
receives the same request-level controls used by chat settings: memory
influence, memory updates, emotion influence, emotion updates, incognito,
main-structured response, native tools, and reasoning effort. Direct chat always
opens the anima identity file because it is anima configuration. When
`disable_memory_influence` is true, direct chat still keeps anima identity
active; the memory file list is omitted from the trailing `developer` message.
That message, placed just before the user message, holds the memory file list,
the attached-file list, any crisis care note and, always last, the
[Companion Guardrails](../../adr/0008-non-overridable-companion-guardrail.md).
Provider rows that expose `supports_developer_role: false`, such as DeepSeek
and Hugging Face, receive every `developer` message folded in order into the
end of the system instruction, so the guardrail remains the final instruction
text.
The model catalog separates complete `native_tool_support` from
`requestable_native_tool_support`. Clients may send only the latter through
`dispatch_options.native_tools`; backend-owned capabilities such as memory
`apply_patch` are activated by server policy and remain invalid as explicit
request options.
When TTS is enabled, `dispatch_options.tts` can carry explicit provider intent.
For ElevenLabs, `model_id="eleven_v3"` selects backend-pushed finalized audio.
The optional `finalized_chunking` field accepts `"sentence"` or `"paragraph"`
and applies only to Eleven v3; omitted or unsupported combinations behave as
`"sentence"`.

## Shared Model-Client Layer

The app-scoped `ModelClientRegistry` owns reusable provider transports. Each
turn supplies its selected row, prompt, options, and continuation state in a
`ModelClientRequest`; clients retain no owner, Anima, chat, or tool state.
`ANIMAMA_LLM_SKIP=1` registers deterministic clients for all provider families.

See [model clients and providers](model-client-providers.md) for credentials,
request translation, Responses continuation and compaction, retries, and stream
finality. [Memory tools](../features/memory.md#direct-chat-memory-tools) defines
the function/native-patch boundary.

## Model selection

Anima creation writes its chat profile directly. Request-time model selection
uses an explicit `model_provider_id` or that profile's default; missing both
fails setup. Either selection must name an active direct model provider.

## Step-By-Step Flow

1. The local HTTP boundary admits the request and resolves the installation
   principal. Setup validates Anima/chat ownership, the issued runtime snapshot,
   model capabilities, and chat API-standard compatibility before opening SSE.
   It also resolves [companion safety](#companion-safety) and runs the local
   crisis detector on the message; detection never blocks the turn.
2. The executor loads required `IDENTITY.md`, current memory/attachment
   navigation, and local history when the provider needs replay. It assembles
   the prompt, ending with the Companion Guardrails, and closes the setup
   database session before upstream streaming.
3. The route starts the request-local event bridge and model task, plus eligible
   title/TTS work. While the model task runs, it records the AI-notice decision
   and yields any `safety.ai_notice` and local `safety.crisis_support` frames
   before draining provider events. The executor runs bounded memory-tool rounds
   and validates the final structured response. At the tool limit, it makes one
   no-tools attempt to produce the final answer, restating the guardrail after
   the limit instruction; further tool calls fail the turn.
4. Structured speech/display can stream before completion. Final validation
   controls corrections, Gesture selection, emotion, and durable persistence;
   raw provider observations remain internal.
5. A fresh short-lived session persists non-incognito chat messages, tool rows,
   usage, model selection, and memory fingerprints. Memory tool writes commit
   separately and survive a later model or final-parse failure. Eligible episode
   capture is best-effort after visible persistence.
6. The route drains events, emits any saved title, waits for TTS and applicable
   compaction, then emits one `run.completed`. Cleanup settles request-local
   tasks without closing shared model clients.

See [memory](../features/memory.md), [user files](../features/user-files.md), and
[model clients](model-client-providers.md) for tool, prompt, and replay contracts.

## What It Deliberately Does Not Do

Direct chat runs one companion turn. Memory tools operate only on user-scope
files and cannot edit Anima identity, move/delete files, or change arbitrary
metadata. Workflow orchestration requires a separate API contract.

## Companion Safety

`server/routers/chat/safety.py` and `app/safety/` own per-turn safety. The
user-facing contract is the [safety and crisis protocol](../../safety/crisis-protocol.md).

- **Companion Guardrails.** `COMPANION_GUARDRAILS` is always the final
  instruction text of every provider request, including after a care note and
  in the forced-final tool-limit request. No setting disables it
  ([ADR 0008](../../adr/0008-non-overridable-companion-guardrail.md)).
- **Effective configuration.** Setup combines operator settings
  (`ANIMAMA_COMPANION_SAFETY_ENABLED`, `ANIMAMA_AI_NOTICE_ENABLED`,
  `ANIMAMA_AI_NOTICE_REMINDER_HOURS`, `ANIMAMA_CRISIS_DETECTION_ENABLED`,
  `ANIMAMA_CRISIS_RESOURCES_PATH`) with the owner's
  `user_settings.preferences.safety`. The global switch turns the AI notice,
  crisis detection, moderation and crisis card off together. Owners may choose
  `crisis_resource_region` and a `reminder_hours` value that applies only when
  it is shorter than the operator interval. Reminder hours must be 0.25–168,
  and an invalid resource table fails startup. Each operator override of a
  safe default logs a startup warning.
- **AI notice.** `app/safety/ai_notice.py` decides per owner principal, across
  Animas, under a `companion_safety_state` row lock. A `start` notice is due on
  the first turn of each local calendar day; a `reminder` is due once the
  reminder interval (default 3 hours) has passed since the later of the
  continuing interaction's start and the last notice. Turns less than 30
  minutes apart continue an interaction. If the state cannot be read or
  written, the notice is shown anyway.
- **Crisis detection.** The local detector (`app/safety/crisis_detector.py`)
  is deterministic and makes no network call. A positive result adds
  `CRISIS_CARE_NOTE` to the trailing instructions before the guardrail and
  emits a crisis card before provider output. For OpenAI Responses rows only,
  round 0 also requests [inline moderation](model-client-providers.md#provider-behavior);
  a self-harm result emits a crisis card after the reply text. Crisis
  resources resolve from the owner's region, then the `client_context`
  locale, then the fallback entry.

Crisis turns stream, persist and update memory like any other turn. Safety
code never logs message text or detection results (crisis frames are excluded
from SSE frame logging) and stores no detection results. Opt-in model-client
prompt previews (`ANIMAMA_MODEL_CLIENT_LOG_PREVIEWS`, on by default in Compose)
can still include the user message and the care note.

## SSE Events

The direct endpoint uses this frontend SSE contract:

- `event: tts.session`
- `event: tts.session.error`
- `event: tts.audio`
- `event: tts.done`
- `event: tts.error`
- `event: user.response`
- `event: emotion.update`
- `event: avatar.gesture.requested`
- `event: chat.title.updated`
- `event: safety.ai_notice`
- `event: safety.crisis_support`
- `event: error`
- `event: run.completed`

These are Animama domain/backend events, not raw upstream model-provider stream
events. OpenAI Chat Completions chunks, OpenAI Responses lifecycle events,
Responses assistant `phase` events, native hosted tool events, function-call
argument fragments, and unknown provider events are normalized as internal
model-client `MC*` events. They are logged and summarized for persistence, but
they are not forwarded directly to browser clients over `chat:sse`.

`user.response` frames include:

- `event_id`
- `run_id`
- `node_id`
- `text`
- optional `response_format`
- optional `response_part`
- optional `is_delta`
- optional `part_index`
- optional `part_final`
- optional `tokenized_text`
- optional `phonemized_text`
- optional `tts_text`
- optional `tts_phonemized_text`
- optional `tts_text_basis`

Main structured turns use one JSON shape: `emotional_tone`,
`emotional_intensity`, nullable `gesture`, `speech`, and nullable `display`.
All fields are required in the provider JSON schema; `gesture: null` or
`gesture: ""` means no avatar gesture, and `display: null` means no separate
visual response. The provider schema constrains non-null `gesture` values to
the exact effective runtime IDs exposed by this Anima's fenced loadout. No
separate gesture catalog, label, description, motion type, catalog item/file
ID, storage locator, package manifest, or resource URL is injected into the
system prompt. Older unfenced compatibility callers use the packaged Starter
loadout instead of reading a frontend manifest at request time.
Normal chat emits `response_format="main_structured_json"` and uses
`response_part="speech"` or `response_part="display"` for visible
`user.response` frames. Those visible parts may arrive as sentence-level stream
chunks with `is_delta=true`, increasing `part_index` values scoped to the
response part, and `part_final=true` on the final chunk or final empty marker.
The hidden `emotional_tone` event is emitted only after both
`emotional_tone` and `emotional_intensity` have been decoded, so request-local
state receives the paired delivery metadata before speech chunks arrive. The
stream parser also waits for the ordered `gesture` field to complete before
speech starts; gesture validation and the public `avatar.gesture.requested`
event still come from the final validated JSON.
If early semantic streaming is unavailable or the final parsed response differs
from the streamed chunks, the backend emits a full/correction frame with
`is_delta=false` and `part_final=true`. The tone and intensity parts are
backend-internal and filtered before `user.response` SSE reaches the browser.
Missing or blank tone metadata falls back to `neutral`; values outside the
allowlist are logged and ignored for Eleven v3 prefixing and durable emotion
updates. Gruut tokenization and phonemization are attached to speakable `speech`
text, not display-only text or tone metadata.

When a run requests ElevenLabs `eleven_v3`, each main-structured `speech`
segment is still prepared with gruut and exposed as sentence-level
`user.response` metadata as soon as it is emitted. Empty `part_final=true`
speech markers close the segment stream without adding audio text. If semantic
deltas were unavailable, one complete non-delta `speech` fallback is queued; if
a complete correction arrives after speech deltas have already been queued, it
updates visible text only and is not re-spoken.

Finalized v3 TTS starts as soon as both the hidden `emotional_tone` and the
first prepared speech segment are available. In default `"sentence"` chunking,
each prepared speech segment becomes one upstream finalized TTS request and
only the first request may receive the backend-only emotional prefix. In
`"paragraph"` chunking, sentence-level SSE stays unchanged while backend audio
accumulates segments by paragraph, flushing when a new paragraph starts, when a
batch reaches four sentence segments, when it reaches about 600 visible
characters, or when the speech stream closes. Paragraph batches are rebuilt
from visible sentence text and re-prepared through gruut before ElevenLabs sees
them, and every paragraph batch may receive the backend-only emotional prefix.
Before each paragraph batch after the first, the backend inserts a 400 ms silent
PCM `tts.audio` frame so adjacent paragraph utterances do not play back-to-back.

Finalized v3 audio batches are streamed back as the existing `tts.audio` frames.
The backend emits exactly one `tts.done` after the last batch completes. If
segment setup or upstream audio streaming fails, the backend emits `tts.error`,
stops v3 synthesis, skips `tts.done`, and still lets the chat run finish with
`run.completed`. Eleven v3 requests omit `previous_text` and `next_text`
because the live API rejects those continuity fields. The backend coalesces
upstream PCM bytes into larger `tts.audio` frames before sending them over SSE
so the frontend does not need to schedule many tiny audio buffers. The frontend
`tts_text`, `tts_phonemized_text`, chat text, and avatar viseme inputs remain
untagged, and no paragraph-specific fields are added to public SSE events.

`emotion.update` frames include the event ID, run ID, direct chat node ID, and
full emotion state payload. They also include optional context metadata:
`emotional_tone`, mapped `emotional_intensity` on the avatar `0..3` scale,
`promoted_emotion`, and `demoted_emotion`. The required frontend source of
truth is the full `emotions` array. The intensity key is `emotional_intensity`;
the frame does not include animation or VFX fields.

`avatar.gesture.requested` frames include the event ID, run ID, direct chat
node ID, validated runtime gesture ID, and `runtime_revision`. Unknown
or invalid model-selected IDs are logged and dropped before SSE delivery. A
normal browser queues the gesture only when both run ID and revision match its
currently mounted catalog.

`chat.title.updated` frames include `type="chat.title.updated"`, `run_id`,
`chat_id`, and the saved title. The title is generated only for first-turn,
untitled, non-incognito chats and is capped at 48 characters after server-side
sanitization. Title-generation failures are logged and do not emit `error`.

`safety.ai_notice` frames include `type="safety.ai_notice"`, `run_id`,
`kind` (`start` or `reminder`), and nullable `anima_name`. When due, the frame
precedes every provider-derived frame of the turn. Clients render it as app UI,
never as assistant text.

`safety.crisis_support` frames include `type="safety.crisis_support"`,
`run_id`, `source` (`local` or `moderation`), and `resources`, the resolved
crisis-resource region entry (`code`, `label`, nullable `emergency_number`,
`services` with `phone`, `sms` or `chat` contacts, nullable `source_url`, and
`verified_on`; the fallback entry has no services, emergency number or source). A `local` card precedes provider frames. A `moderation` card
comes from an executor `EventType.CRISIS_SUPPORT` domain event, formatted by
`sse_runtime.py`, and arrives after the reply text but before `run.completed`.
Each turn emits at most one crisis card.

`run.completed` is emitted once after safe side effects have run and includes
both `run_id` and the resolved `chat_id`. For normal non-voice text, completion
is usually only the run/chat terminal marker because structured speech/display
text has already been emitted as `user.response`. Unstructured fallback paths
can include final `tokenized_text` and `phonemized_text` metadata derived from
the accumulated response text.

## Persistence And Side Effects

Chat persistence is owned by `DirectChatTurnExecutor` through `ChatManager`.
The executor fetches visible chat history by chat ID during setup, then records
the user/assistant turn through a separate short-lived recorder session unless
the request is incognito. The route supplies that recorder through
`server/routers/chat/session_services.py`, so the setup session can close before
upstream model streaming begins. Assistant message usage is persisted on the message
row and added eagerly to the parent `chats.cum_*` usage counters in the same
unit of work. The parent chat's `active_context_tokens` is replaced with the
latest normal assistant turn's provider-reported `total_tokens` minus output
reasoning tokens. The same non-incognito update stores the last durable model
snapshot as `last_model_client` from the catalog row's model-client profile and
`last_model_id` from the selected model slug. Incognito turns skip durable
message writes and chat usage updates.

Visible assistant rows store `message_data.structured` for the parsed
speech/display/emotion payload and `message_data.model_client` for JSON-safe
provider metadata. When provider adapters emit internal `MC*` stream events,
the direct turn observer persists only a compact `stream_event_summary` under
`message_data.model_client.raw_provider_metadata`. OpenAI Responses rows with a
final response ID also expose compact continuation, phase, output item, native
tool, and stream-summary metadata under `message_data.openai` so manual
history replay can preserve assistant `phase` values when the
`previous_response_id` cursor is unavailable or stale.

Normal chat persistence also reserves per-chat `chat_messages.turn` values from
`chats.next_turn`. The value starts at `1` for each chat and increments for each
persisted message row, including multiple rows in the same run.

For first-turn title generation, `chat:sse` conditionally writes `chats.title`
only while it is still blank through its own short-lived database sessions.
Generated-title model usage is stored as small metadata under
`chats.metadata.title_generation`; it is not added to chat usage counters. The
title model is controlled by `ANIMAMA_CHAT_TITLE_GENERATION_PROVIDER` and
`ANIMAMA_CHAT_TITLE_GENERATION_MODEL`. The hidden title prompt defaults to a
low reasoning effort and a 20 second timeout through
`ANIMAMA_CHAT_TITLE_GENERATION_REASONING_EFFORT` and
`ANIMAMA_CHAT_TITLE_GENERATION_TIMEOUT_SECONDS`. Incognito turns skip title
generation.

After a successful non-incognito response and before the normal
`run.completed` frame, the route runs a hidden compaction check. If
`chats.active_context_tokens` is at or above the configured compaction threshold,
`ChatCompactionService` calls a separate backend-owned direct model prompt and
stores the resulting summary in `chat_compactions`. Compaction summaries are not
streamed as `user.response` events and are not inserted into `chat_messages`.
Compaction model usage stays on the `chat_compactions` row rather than the
chat's `cum_*` counters. Active compaction summaries record `start_turn` and
`end_turn`; the next prompt uses the summary as a `developer` continuity
message ahead of the exact visible messages with `turn > end_turn` when the
selected provider serializes local context. If an OpenAI Responses turn
continues from a chat-row `openai_previous_response_id`, the request sends only
the new user input and the cursor, so the active summary is not physically
included in that provider payload.

Before provider frames, the route records the AI-notice cadence for the owner
in `companion_safety_state` through its own short-lived session. That row
holds timestamps and the local notice date only, never message content.

Emotion persistence reuses `persist_sse_side_effect(...)`. Current-run
`EMOTION_UPDATE` events are persisted with
`persist_emotional_state_update(...)` before being streamed.

No background memory extraction queue is scheduled by this route. Direct
model-client turns can attach
request-local memory entry tools for provider families that support Anima's
function-tool loop.

## Error And Cancellation Behavior

Provider/model-client errors after stream setup are caught by the SSE generator.
The route emits `event: error`, skips title persistence and post-response
compaction, and then emits exactly one `event: run.completed` with `chat_id`.
For OpenAI-backed direct clients, the error payload contains the normalized
safe metadata described above rather than raw SDK response bodies.
Setup-time validation failures such as missing animas, foreign chats,
inactive model rows, unsupported capabilities, missing direct clients, or a
missing app-scoped registry return normal HTTP errors before `StreamingResponse`
is opened.

If the client closes the SSE stream early, the generator cancels the active
executor task without emitting `run.completed`. The setup database session has
already been closed before model streaming begins, and any auxiliary
title/TTS/final-persistence work is cancelled or cleaned up by its own
short-lived session owner. Shared registry clients remain app-scoped and are
not closed by request cancellation. This matches the expectation that
cancellation is not a completed chat turn.

Post-response compaction failures are logged but do not emit `event: error` and
do not alter the already-completed assistant response. Pre-response hard-ceiling
protection is not part of the current compaction path.

Request-local cleanup runs in `finally` and is guarded so each task/session is
settled at most once.

## Runtime scope

`chat:sse` runs one avatar companion turn. Helper, trigger, feed and aggregate
workflows are outside this API. A separate workflow API requires its own
contract and ownership review.

## Transport verification

Run `uv run pytest -q tests/test_anima_chat_sse_transport.py` from the repository
root. It serves the real Anima router, local admission/principal resolution,
direct executor, structured parser and SSE bridge through Uvicorn on an owned
ephemeral loopback socket. A controlled provider double holds the final bytes
until the client observes an incremental frame. Separate cases verify terminal
errors, disconnect cleanup and a successful next request on the same registry.

Repository/context inputs are fixture doubles and turns are incognito with
memory/emotion updates and TTS disabled. These tests need socket permission but
no database, provider credentials or user installation. They complement the
existing HTTP-boundary probes and SQL-backed chat tests; they do not establish
persistence or optional provider/audio integration acceptance.
