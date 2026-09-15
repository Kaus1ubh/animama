# Direct Chat SSE Runtime

`POST /v1/animas/{anima_id}/chat:sse` is the supported direct chat endpoint
for the normal avatar companion turn. It executes one direct model-client turn,
derives emotion updates from that primary response's structured metadata, and
does not execute arbitrary graph workflows.

The implementation lives in:

- `src/backend/animama/server/routers/anima.py`: mounts the HTTP route.
- `src/backend/animama/server/schemas/chat.py`: defines `PyAnimaChatRequest`.
- `src/backend/animama/server/routers/chat/chat_sse.py`: owns the public
  `stream_direct_chat_sse(...)` facade, SSE response creation, and high-level
  ordering of model, TTS, title, compaction, completion, and cleanup work.
- `src/backend/animama/server/routers/chat/turn_setup.py`: owns anima
  ownership loading, request option resolution, repository/service wiring,
  `DirectChatTurnExecutor` construction, prepared-turn setup, and setup error
  translation.
- `src/backend/animama/server/routers/chat/sse_runtime.py`: owns the
  request-local event bridge, direct-event draining, SSE frame dispatch, and
  run-completion helper frames.
- `src/backend/animama/server/routers/chat/session_services.py`: owns
  short-lived session-backed adapters for final turn persistence and memory
  tool execution after the setup session has closed.
- `src/backend/animama/server/routers/chat/setup_helpers.py`: wires request-local chat
  services.
- `src/backend/animama/server/routers/chat/tts.py`: owns direct-chat TTS session and
  finalized-audio helpers.
- `src/backend/animama/server/routers/chat/title.py`: owns first-turn title generation
  helpers.
- `src/backend/animama/server/routers/chat/compaction.py`: owns post-response
  compaction helpers.
- `src/backend/animama/app/chat/direct_executor.py`: validates the selected
  `model_provider_id`, prepares a prompt-backed model-client request, invokes the
  shared model client, parses main structured output, and persists the turn.
- `src/backend/animama/app/chat/openai_prompt.py`: assembles one OpenAI-compatible
  `DirectChatPrompt` with exactly one system message.
- `src/backend/animama/app/chat/memory_context.py`: opens required direct-chat memory
  files and builds the durable memory-context manifest.
- `src/backend/animama/app/model_clients/`: defines the provider-neutral
  model-client contracts.
- `src/backend/animama/adapters/model_clients/`: contains the direct provider-family
  clients, including the split `openai_chat_completions/` and
  `openai_responses/` adapter packages.
- `src/backend/animama/server/model_clients.py`: creates and closes the app-scoped
  `ModelClientRegistry`.
- `src/backend/animama/server/sse_events.py`: owns shared SSE formatting and
  request-local side-effect persistence helpers.

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
  }
}
```

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
active; the transient memory file list developer message is omitted. Provider
rows that expose `supports_developer_role: false`, such as DeepSeek and
Hugging Face, receive the memory file list at the end of the system instruction
instead of as a separate `developer` message.
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

Normal `chat:sse` primary turns use the app-scoped `ModelClientRegistry`.
Server startup registers one reusable direct client for each supported provider
family:

- `OpenAIHTTPAgent` through the OpenAI Python SDK Chat Completions client.
- `OpenAIResponsesHTTPAgent` through the OpenAI Python SDK Responses client.
- `GeminiAgent` through the `google-genai` async SDK client.
- `LiteLLMAgent` through `litellm.acompletion`.

`OpenAIHTTPAgent` can target multiple OpenAI-compatible base URLs. OpenAI rows
use `OPENAI_API_KEY`; DeepSeek rows target `https://api.deepseek.com` and use
`DEEPSEEK_API_KEY`; Hugging Face rows target
`https://router.huggingface.co/v1` and use `HF_TOKEN` with
`HUGGINGFACE_API_KEY` as a fallback. DeepSeek requests use JSON Object response
format, DeepSeek's literal reasoning controls (`none`, `high`, `max`), and
final local `main_structured_response` validation. `none` disables DeepSeek
thinking, while `high` and `max` enable thinking with the matching upstream
`reasoning_effort`. The pinned Hugging Face DeepInfra rows use schema-backed
`json_schema` response format, preserve the exact catalog model ID, omit
OpenAI-specific fields such as `stream_options`, `prompt_cache_key`,
`parallel_tool_calls`, and `reasoning_effort`, and strip OpenAI's
`function.strict` marker from tools before dispatch. Some Hugging Face providers
emit nonstandard streaming choice fields such as `text`, `reasoning`,
`reasoning_content`, and `token_id`; the adapter treats `text` as a
content-delta fallback and ignores the provider-private reasoning/token
identifiers for warning purposes.
The shared response-format instructions include the word `json`, the expected
JSON schema, and an example object so JSON Object providers such as DeepSeek
accept the request and still produce data that Animama can validate locally.

When `ANIMAMA_LLM_SKIP=1`, startup registers `MockModelClient` for those direct
provider families so local chat can run without upstream API keys.

Shared model clients are process-local transport resources only: anima ID,
user ID, chat ID, run ID, selected model provider, request options, the
OpenAI-compatible prompt, structured output requirements, and continuation state
stay request-local. Provider adapters receive only a `ModelClientRequest`
containing the selected provider row, assembled `DirectChatPrompt`, narrow
provider options, and any continuation cursor.

OpenAI Responses continuation is provider-scoped. The direct model-client path
sends `previous_response_id` only when the selected provider is
`OpenAIResponsesHTTPAgent` and the chat row has a nonblank
`openai_previous_response_id`. Responses-to-Responses turns with a stored chat
cursor skip local history fetch during normal setup, continue from that cursor,
and send only the current user input as `input`. The adapter still sends the
current system/developer instruction block through the Responses `instructions`
parameter on every turn, because prior Responses instructions are not carried
forward with `previous_response_id`. Responses turns without a chat-row cursor
fetch and replay the compiled local visible history and send no cursor.
Non-Responses providers never receive Responses cursor state, and persisted
non-Responses assistant turns clear the chat row's `openai_previous_response_id`
during the same chat-row update that reserves turns and updates usage.

If OpenAI reports that a Responses `previous_response_id` cannot be resolved,
the executor lazily fetches local chat context and retries that provider call
once without the continuation cursor. The retry therefore serializes the local
manual context window instead of depending on stored OpenAI state. A successful
non-incognito retry persists the returned `response_id`, which refreshes the
chat row's `openai_previous_response_id` through the normal turn-recording
transaction.

Native memory Apply Patch follows the same continuation boundary. A capable
Responses model returns `apply_patch_call`; the backend applies it once and the
next request sends the matching `apply_patch_call_output`. Cursor-backed rounds
send trailing outputs only. If the cursor is stale, the retry explicitly
replays the provider-neutral call/result items and does not execute the patch a
second time. Native-mode `memory_read_files.content` is a transient synthetic
document containing a strict three-line JSON-string-or-null description header
followed by the stored Markdown body. The planner applies the diff to that exact
representation, strips the header, and atomically commits the parsed body and
description as one Version. Custom-tool reads continue to return raw
Markdown content.

The OpenAI SDK adapters normalize provider errors before they cross the
model-client boundary. Retryable connection, timeout, rate-limit, conflict,
server, and overload errors are retried once only when no text delta has been
yielded yet. Bad requests, authentication, permission, not-found,
unprocessable, and quota errors are surfaced without app retry. SSE error
details use stable Animama codes such as `openai_authentication_error`,
`openai_rate_limit`, `openai_server_error`, and
`openai_previous_response_unresolvable`, plus sanitized fields like status
code, request ID, provider error code/type/param, model, API, and retryability.
Raw OpenAI response bodies are not sent in `chat:sse` error details.

Incognito Responses turns set the upstream Responses `store` option to `false`.
They may still continue from the existing chat-row cursor when one is available,
but the backend does not persist the local turn or advance
`openai_previous_response_id` from the incognito result.

OpenAI Responses turns also send native server-side auto-compaction through the
Responses `context_management` request field. The configured
`compact_threshold` defaults to 200000 rendered tokens and can be disabled by
setting `ANIMAMA_OPENAI_RESPONSES_COMPACTION_THRESHOLD_TOKENS` to `0`. Because
the Responses server carries compacted state forward through the
`previous_response_id` chain, successful `OpenAIResponsesHTTPAgent` turns skip
Animama's local post-response chat-compaction summarizer. Non-Responses
providers continue using the local `chat_compactions` flow.

The backend assembles a `DirectChatPrompt` before the model client serializes
the provider request. Current system instructions are always available to
provider adapters. Conversation history is fetched and physically sent to
`OpenAIResponsesHTTPAgent` only when no chat-row `openai_previous_response_id` is
available or when a stale cursor forces the lazy manual-context retry.

## Model selection

Anima creation writes its chat profile directly. Request-time model selection
uses an explicit `model_provider_id` or that profile's default; missing both
fails setup. Either selection must name an active direct model provider.

## Step-By-Step Flow

1. The client opens `POST /v1/animas/{anima_id}/chat:sse`.
2. The local HTTP boundary validates authority, browser metadata and, on
   desktop, the renderer capability. FastAPI resolves `RequestPrincipal` from
   server-owned admission state established by completed installation bootstrap.
3. The route creates a short-lived setup database session through
   `get_async_session_factory(request.app)`; each app owns or injects its factory.
4. `turn_setup.py` loads `ORMAnima` and checks ownership against the resolved
   installation principal. Missing animas and animas owned by
   another user return `404`.
   Clients send the exact `runtime_revision` issued to the mounted
   route. Setup reads that persisted snapshot (never current ambient loadout
   state) and projects its semantic Gesture selectors into the model enum. An
   expired or unknown snapshot returns `runtime_remount_required` before a run
   starts.
5. `turn_setup.py` resolves request options with
   `resolve_chat_request_options(...)`, combining request-level options with
   user and anima settings into typed direct-chat options.
6. The route fetches the app-scoped `ModelClientRegistry`. If startup did not
   initialize it, setup returns `503 Service Unavailable`.
7. `turn_setup.py` creates a request-local `DirectChatTurnExecutor` with
   SQLAlchemy repositories, `AnimaChatProfileService`, `ChatManager`, and the
   shared registry.
8. `DirectChatTurnExecutor.prepare_turn(...)` resolves the requested
   `model_provider_id` or the explicit anima chat profile default.
9. Before returning `StreamingResponse`, setup validates that the selected
   `model_providers` row is active, has a registered direct model client,
   supports streaming, supports `main_structured_response`, and supports
   requested reasoning effort, native tools, and direct memory tools when those
   tools would be active for the turn. It also classifies the provider's chat
   API standard; unsupported provider families fail setup with
   `chat_api_standard_unsupported`.
10. `ChatManager` verifies the chat is owned by the current user/anima or
    creates it when missing. It writes `api_standard` while creating a new row,
    initializes it on an empty pre-created row, and rejects same-chat standard
    mismatches with `409
chat_api_standard_mismatch`. A non-empty chat whose `api_standard` is still
    null is treated as invalid transcript state and must be replaced by a new
    chat. Foreign or mismatched chats return `404`.
11. The executor opens direct-chat memory context through
    `DirectChatMemoryContextService`, then fetches visible chat context through
    `ChatManager` when the selected provider needs local replay. It
    reads cached path `identity.md` in the active anima scope. Missing/blank
    identity fails setup before model invocation and requires explicit owner
    repair. There is no current-Avatar fallback and no chat-driven identity
    creation/update. New Anima creation owns identity initialization; the current
    baseline provides no legacy identity adoption or read-time backfill.
12. The memory context service returns raw anima identity content, a durable
    metadata manifest, and, when memory influence is enabled, a transient
    user-scope memory file list. The anima identity prompt section contains
    only markdown content; revision and SHA fingerprint details stay in the
    durable manifest keyed by `(anima_id, path)`.
13. The executor assembles a `DirectChatPrompt` in this order: one system
    message containing stable core companion guidance rendered with the active
    Anima's stable `display_name`, anima identity, stable memory guidance, and
    structured-output guidance selected from the persisted provider row
    (`json_schema` gets the shared response guidelines and constrains gestures
    through its response schema; `json_object` gets those guidelines plus the
    dumped schema and example); then active
    compaction summary as a `developer` message, visible chat history, a
    request-local `developer` message containing the `# List of memory files`
    map and, when upload search is available, the
    `# List of attached user-uploaded files`, and the current user message. For
    provider rows without developer-role support, this request-local context is
    appended to the system message instead. The memory file list
    contains only user-scope file entries (`anima_id IS NULL`), uses cached
    paths such as `profile.md`, excludes generated episode logs
    (`kind = "episode_log"`), omits anima-scoped files, and does not include a
    tree. It lists user profile files but does not inject their content. The
    prompt does not read anima profile fields or
    `metadata.direct_chat`. For OpenAI Responses turns with a compatible
    continuation cursor, current system/developer instructions, including the
    map, are serialized through `instructions` and conversation input is
    reduced to the current user message. This keeps the memory map request-local:
    prior Responses `instructions` are not carried forward with
    `previous_response_id`, while input items would become provider-managed
    conversation history and could accumulate stale maps.
14. When memory tools are active, list/read/search use strict function specs and
    are attached when memory influence is enabled. The
    injected memory map provides initial file discovery, and `memory_list_files`
    can refresh that discovery during a tool loop. `search_memory_files`
    accepts only a query and searches user-scope markdown files with backend
    defaults. `search_uploaded_files` and `read_uploaded_file_chunks` are
    attached only when the current
    `chat:sse` request includes attached file IDs that validate as current-user
    searchable uploads and memory reads are enabled. In that case, their
    validated filenames and persisted chunk counts are listed in request-local
    prompt context so the model knows which uploaded files are available and
    can plan bounded reads. Uploaded-file search uses hybrid keyword plus
    semantic retrieval with keyword fallback. The
    bounded reader returns at most five complete stored chunks in source order
    per request, with explicit pagination and a hard serialized response limit;
    it rejects unknown filenames instead of broadening to other attachments.
    Search is intended for relevance and exact lookup, while ordered reading is
    intended for whole-document synthesis and surrounding context. Writes are
    attached only when memory updates are enabled and the turn is non-incognito.
    A capable OpenAI Responses catalog row receives native `apply_patch` and
    omits `memory_apply_patch`/`memory_write_file`; all other supported providers
    retain those JSON-schema functions. The native capability is internal and cannot
    be requested through generic `native_tools`. Both transports reject
    generated episode logs plus the reserved `episodes/**` namespace.
    Tool paths are user-scope cached paths, and anima-scoped identity entries
    remain backend-injected only. Prompt guidance explains that file
    descriptions are the birds-eye navigation index, requires every content
    edit to review description accuracy, and requires native diffs to retain the
    canonical synthetic header without copying it into stored Markdown.
15. The executor builds a request-local `ModelClientRequest` containing the
    selected provider/model, the `DirectChatPrompt`, narrow provider options,
    and any valid OpenAI Responses continuation cursor.
16. The setup database session is closed before `StreamingResponse` waits on
    upstream model or TTS streaming. The prepared turn keeps only detached
    domain data, the prompt-backed `ModelClientRequest`, and a session-backed
    recorder/tool service that opens fresh short-lived sessions later if final
    chat persistence or memory tool execution is needed.
17. For an untitled, non-incognito chat whose `next_turn` is still `1`, the
    generator starts a hidden backend title-generation task using the user's
    first message. This task uses a backend-owned direct model prompt runner; it
    does not use memory/tools and does not write chat messages or chat usage
    counters.
18. The route creates a request-local `DirectChatEventBridge` from
    `server/routers/chat/sse_runtime.py`. The bridge exposes `publish(event)`
    and queues executor events for SSE formatting.
19. The SSE generator starts
    `DirectChatTurnExecutor.stream_prepared_turn(...)` in an async task.
20. The selected shared model client streams or completes the upstream request
    from the `ModelClientRequest` and returns a `ModelClientFinal` with domain
    `Usage`. While that model stream is active, the executor observes provider
    text deltas and may publish semantic main-structured `USER_RESPONSE` chunks
    before the final result arrives. Provider event/tool deltas remain internal
    model-client observations. If the final result contains memory tool calls,
    the executor executes those calls request-locally, appends assistant/tool
    messages only to the in-memory prompt, and repeats the model call up to the
    bounded tool round limit. Responses-native patches are planned with the
    shared V4A planner and committed immediately through `MemoryEntryService`.
    Body-only, description-only, and combined changes use one optimistic Version
    check and one append-only Version; each receives a typed
    `apply_patch_call_output` containing path, operation, and resulting Version.
    Memory tool result message content is a compact JSON string containing only
    model-useful output; backend fingerprints and audit details remain in
    memory-entry storage. If the model
    keeps requesting tools at the limit, the executor makes one final no-tools
    model call with an instruction to answer from the tool results already in
    context; only if that call still returns tool calls does the turn fail with
    `memory_tool_round_limit`. Tool usage is aggregated into the final assistant
    usage. At the limit, outstanding native calls receive failed “not executed”
    outputs and both native and function tools are disabled for the forced
    structured final.
21. The executor parses the final main structured JSON after the provider final
    arrives. That final parse remains authoritative for persistence, gesture,
    emotion updates, episodic-memory `remember` capture, and
    correction/fallback `USER_RESPONSE` events. If no semantic speech/display
    chunks were emitted early, the executor publishes the same full hidden
    emotional-tone, visible `speech`, and optional visible `display`
    `USER_RESPONSE` parts as before. It then emits an optional validated
    `AVATAR_GESTURE_REQUESTED` and a primary-derived
    `EMOTION_UPDATE`.
22. Unless the turn is incognito, the executor persists the user message,
    compact internal memory tool-call/result rows when present, and one visible
    assistant row containing the raw final structured JSON through a fresh
    short-lived `ChatManager` session. Each persisted row also stores the raw
    provider message used for next-turn replay. Responses-native tool rows use
    provider-neutral call/result shapes that the adapter converts back to typed
    Apply Patch SDK input items.
    Assistant usage and the model/provider snapshot live on the visible
    assistant row. The same `record_turn` transaction merges the latest
    memory-context fingerprints into `chats.metadata.memory_context` and
    updates `chats.last_model_client` plus `chats.last_model_id` from the
    selected catalog row. Native memory writes happen before this final-turn
    transaction; a committed patch remains durable if a later provider or final
    parse failure prevents visible chat persistence. If the final structured response contains nonblank
    `remember` text and memory updates are enabled, the executor then
    best-effort creates a `memory_episode_items` row and refreshes the generated
    daily episode file in a separate short-lived session; failure is logged and
    does not emit a public SSE error. Incognito turns read memory context for
    the model but skip message, chat metadata, and episode persistence.
23. The route drains bridge events through `sse_runtime.py` and formats them as
    frontend SSE frames. Hidden tone/intensity parts are consumed as backend
    metadata and are not emitted as visible `user.response` frames. The
    executor does not emit a direct-turn completion event; public completion is
    route-owned.
24. If the hidden title task produced and persisted a title, the route streams
    `event: chat.title.updated` before completion.
25. Before the final completion frame, a successful non-incognito turn may run
    a hidden compaction check through a fresh short-lived database session.
    Compaction uses the same backend-owned direct model prompt runner as title
    generation and does not emit its own SSE event.
26. The route emits exactly one `event: run.completed` on normal completion
    after safe side effects and eager compaction have finished.
27. In `finally`, the route cancels request-local tasks if needed. It does not
    close app-scoped shared model clients for a request-local cancellation or
    provider error.

## What It Deliberately Does Not Do

`chat:sse` does not construct `AnimaRuntime`, call
`make_runner_registry_for_graph(...)`, subscribe to a runtime event bus, enqueue
`INGRESS_FIRED`, schedule arbitrary downstream graph work, run helper nodes, or
execute function/trigger/feed/aggregate nodes.

For the primary chat turn, it also does not read `chat_runtime` metadata, build
`DirectChatAgents`, call `build_agent_provider(...)`, or instantiate
`AgentRunner`. Direct memory tools are limited to user-scope memory file
entries; they do not let the model access anima-scoped identity entries or
delete, move, copy, or arbitrarily edit metadata. Title generation and
post-response compaction also avoid deleted provider-factory paths and use
shared direct model clients.

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
`end_turn`; the next prompt uses the summary as a system continuity message plus
exact visible messages with `turn > end_turn` when the selected provider
serializes local context. If an OpenAI Responses turn continues from a chat-row
`openai_previous_response_id`, the request sends only the new user input and the
cursor, so the active summary is not physically included in that provider
payload.

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
