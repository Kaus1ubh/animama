# Model Clients And Providers

Normal `POST /v1/animas/{anima_id}/chat:sse` turns use shared direct model
clients. The boundary accepts a prepared prompt, provider options and
continuation state, then emits normalized deltas and sanitized observations.

## Direct Chat Boundary

Direct chat resolves model selection in this order:

1. request `model_provider_id`, when present
2. `anima_chat_profiles.default_model_provider_id`

The selected ID must name an active `model_providers` row whose provider/model
capabilities support the requested turn. Setup errors happen before the SSE
stream opens, so callers receive a normal HTTP error instead of a partially
opened stream.

`DirectChatTurnExecutor` owns the app-layer turn:

- verifies chat ownership through `ChatManager`
- fetches visible chat history and active compaction context
- opens direct-chat memory context for anima identity
- assembles one OpenAI Chat Completions-compatible prompt
- attaches scoped memory tools when request options and model capabilities allow them
- builds a provider-neutral `ModelClientRequest`
- invokes the selected shared model client
- executes bounded request-local memory tool loops when the model asks for them
- parses the `main_structured_response` JSON envelope
- emits `user.response`, `avatar.gesture.requested`, `emotion.update`,
  and `error` domain events
- persists user and assistant chat messages through `ChatManager`

The public `run.completed` SSE frame is route-owned by `chat_sse.py`, not an
app-layer direct-turn event. That lets the route wait for TTS, title
generation, compaction, and cleanup-sensitive side effects before sending the
single public completion frame. Model clients never create chats or write SQL
rows directly.

## Shared Model Clients

The provider-neutral contracts live in `src/backend/animama/app/model_clients/types.py`.
The implementations live under `src/backend/animama/adapters/model_clients/`.
OpenAI provider SDK types stay inside those adapter modules. Chat Completions
is organized under `openai_chat_completions/` with separate modules for the SDK
client lifecycle, request kwargs, typed chunk events, streamed tool-call
aggregation, and usage conversion. Responses follows the same package pattern
under `openai_responses/`.

Registered provider families are:

- `OpenAIHTTPAgent`: OpenAI Chat Completions via the OpenAI Python SDK
- `OpenAIResponsesHTTPAgent`: OpenAI Responses via the OpenAI Python SDK
- `GeminiAgent`: Google Gemini via `google-genai`
- `LiteLLMAgent`: LiteLLM async chat completions
- `MockModelClient`: deterministic local/test model client

The provider type names are durable catalog identifiers. Some still end in
`Agent` for compatibility with existing `model_providers` rows, but they are no
longer backed by backend agent objects or graph runners.

The public model-provider catalog also reports a nullable chat compatibility
profile for each row. `OpenAIHTTPAgent` maps to
`model_client="openai_chat_completions"` and
`api_standard="chat_completions"`. `OpenAIResponsesHTTPAgent` maps to
`model_client="openai_responses"` and `api_standard="responses"`. Gemini and
LiteLLM rows currently report null compatibility fields because their transcript
standard has not been defined for the chat API standard fence.
DeepSeek V4 Flash and V4 Pro rows also use `OpenAIHTTPAgent`, so they expose
`model_client="openai_chat_completions"` and
`api_standard="chat_completions"` while carrying DeepSeek provider label,
logo, base URL, and credential metadata.
Hugging Face Inference Provider rows use the same `OpenAIHTTPAgent`
compatibility profile and expose `model_client="openai_chat_completions"` plus
`api_standard="chat_completions"` while carrying Hugging Face provider label,
logo, router base URL, and credential metadata.

`chat:sse` treats `api_standard` as the compatibility key for one persisted
chat. A new or empty chat records the selected row's `api_standard` before any
provider call. Successful non-incognito turns then update
`chats.last_model_client` from the selected catalog row's `model_client` and
`chats.last_model_id` from the selected model slug in the same chat-row update
that records usage and advances turns. Later requests can switch to another
catalog row with the same `api_standard`, but a different standard is rejected
with `409 chat_api_standard_mismatch` before local history, Responses cursors,
memory side effects, or upstream model clients are used. Rows with null
compatibility fields are not accepted for direct chat in this phase and fail
setup with `chat_api_standard_unsupported`.

Server startup builds the app-scoped registry in `server/model_clients.py`.
Clients may hold reusable SDK or HTTP resources. They must not store
request-local anima, user, chat, run, prompt, memory, structured-output, or
tool state. Provider invocation state must come from `ModelClientRequest`;
route/runtime bookkeeping stays in the prepared direct chat turn and executor.

Model clients stream `ModelClientDelta` values across the provider-neutral
boundary. The supported delta kinds are:

- `text_delta`: public assistant text that can contribute to the final
  structured response
- `event`: internal provider observations represented by typed `MC*` event
  dataclasses from `app/model_clients/event_types.py`
- `final`: the authoritative `ModelClientFinal` for one provider call
- `error`: stream-level provider failure
- `done`: successful adapter completion after the final value

The `event` deltas are ordered with text/final deltas but are not public
`chat:sse` frames. They preserve provider facts such as finish reasons, usage,
assistant phases, native hosted tool activity, terminal events, and unknown
provider events. `app/model_clients/event_summary.py` records a sanitized
request-local summary for direct chat persistence and warnings through
`app/model_clients/event_sanitizer.py`; raw provider event payloads are not
persisted.

`ANIMAMA_MODEL_CLIENT_TIMEOUT_SECONDS` sets the timeout passed to direct model
clients and defaults to 60 seconds. `OpenAIResponsesHTTPAgent` owns an
OpenAI-only SDK client. `OpenAIHTTPAgent` owns Chat Completions SDK clients per
OpenAI-compatible base URL so OpenAI rows use `OPENAI_API_KEY` and DeepSeek
rows use `DEEPSEEK_API_KEY`; Hugging Face rows use `HF_TOKEN` with
`HUGGINGFACE_API_KEY` as a fallback. `GeminiAgent` and `LiteLLMAgent` own
their provider-family client/module state through the same registry boundary.

`ANIMAMA_OPENAI_RESPONSES_COMPACTION_THRESHOLD_TOKENS` controls native
server-side auto-compaction for `OpenAIResponsesHTTPAgent` Responses create
requests. It defaults to `200000`. Values less than or equal to zero disable
the `context_management` payload. When enabled, the adapter sends
`context_management: [{"type": "compaction", "compact_threshold": ...}]`; the
OpenAI server decides whether to compact based on the rendered token count.

When `ANIMAMA_LLM_SKIP=1`, startup registers `MockModelClient` for all direct
provider families so local chat can run without upstream API keys. Mock mode is
all-or-nothing for direct provider families; it does not use the old agent-era
mock tuning variables.

## Stream Event Finality And Observability

Provider adapters own upstream stream semantics and convert them into the
provider-neutral delta sequence. The direct chat executor consumes every delta
until it sees `final`, `error`, or adapter completion. It records `event` deltas
with `ModelClientStreamEventObserver`, attaches the compact
`stream_event_summary` to `ModelClientFinal.raw_provider_metadata`, and then
persists that metadata in assistant `message_data.model_client.raw_provider_metadata`.
For OpenAI Responses rows that include a final response ID, the same compact
summary is also copied into `message_data.openai.stream_event_summary`.

Normal INFO logs stay content-free unless preview logging is enabled. The local
Docker Compose `animama-server` service sets
`ANIMAMA_MODEL_CLIENT_LOG_PREVIEWS=true` by default so local debugging includes
truncated prompt, response, tool argument, and tool result previews in selected
model-client lifecycle logs. `ANIMAMA_MODEL_CLIENT_LOG_PREVIEW_CHARS` controls
each preview length and defaults to 240 characters. Preview logs are redacted
for obvious secret shapes but can still include user, memory, file, or tool
content, so disable them in shared or long-retention environments.

`stream_event_summary` can include:

- total event counts and counts by provider event type
- unknown provider event counts and warnings
- finish reasons
- whether usage was observed
- terminal completed/incomplete/failed events
- assistant message phases and output item summaries
- native hosted tool lifecycle summaries

OpenAI Chat Completions uses `client.chat.completions.create(..., stream=True)`
and normalizes SDK `ChatCompletionChunk` objects with typed helpers for
`Choice`, `ChoiceDelta`, `ChoiceDeltaToolCall`,
`ChoiceDeltaToolCallFunction`, and `CompletionUsage`. Choice index `0` is the
only public assistant output and tool-call source; additional choices are
recorded as unknown/multi-choice observations. The adapter emits finish-reason
and usage observations when those chunk fields appear, buffers text and streamed
function tool-call fragments, and emits `ModelClientFinal` only after the SDK
stream iterator closes. If no finish reason or usage appears, direct chat keeps
the turn behavior unchanged but records summary warnings such as
`missing_finish_reason` or `missing_usage`.
For DeepSeek thinking-mode streams, `delta.reasoning_content` is treated as
internal provider metadata and is not folded into public text deltas, final
assistant text, or persisted chat messages.

OpenAI Responses uses SDK `ResponseStreamEvent` variants and maps lifecycle,
output item, text, function-call argument, native hosted/tool-call, terminal, and
unknown events into `MC*` observations. Public chat text comes only from
unphased assistant output or assistant output with `phase="final_answer"`.
`phase="commentary"` and other intermediate provider text are observable
internally but are not public `user.response` text. The adapter emits a final
only for `response.completed` or the compatibility `response.done` event.
`response.failed`, `response.incomplete`, `error`, and SDK equivalents become
provider errors. If the stream reaches EOF without a terminal event, the adapter
emits an internal incomplete terminal observation and raises
`openai_stream_incomplete`; it does not persist partial text as a successful
assistant response. If a phased completed response never contains
`final_answer`, the adapter raises `openai_missing_final_answer_phase`.

Responses assistant `phase` is preserved for manual replay. Cursor-backed
Responses turns normally continue from `chats.openai_previous_response_id`, so
the provider retains previous assistant state. New chats and stale-cursor
fallbacks serialize local history instead; in that path the Responses adapter
reads persisted assistant phase metadata and writes valid assistant phases back
onto assistant input items. Chat Completions ignores Responses-only phase
metadata.

The Responses adapter also recognizes SDK `ResponseApplyPatchToolCall` output
items as executable app-layer work. Its lifecycle observations expose only the
call ID, status, operation type, and path length; the path and V4A diff are not
copied into sanitized provider metadata. Other hosted native tools remain
observations rather than app-executed calls.

## Context And Structured Output

`DirectChatPrompt` is the app-layer model-client prompt contract: an OpenAI
Chat Completions-compatible `messages` list plus request fields such as
`response_format`, `stream_options`, `prompt_cache_key`, `reasoning_effort`,
`tools`, `tool_choice`, and `parallel_tool_calls`.
`DirectChatPromptAssembler` builds exactly one system
message at `messages[0]` with Markdown sections for stable core companion
guidance, the raw current anima identity markdown, stable memory guidance, and
structured-output guidance selected from the persisted `model_providers`
capability row. Schema-backed `json_schema` rows receive the shared response
guidelines because the actual schema travels in
`DirectChatPrompt.response_format`; `json_object` JSON-mode rows receive those
guidelines plus the dumped schema and example object because JSON mode does not
enforce schema adherence. The identity section
contains only file content rather than file path, status, revision, or
fingerprint details. Anima profile columns, `metadata.direct_chat`, and pinned
user profile content are not prompt sources. When memory influence is enabled,
the user-scope memory file map is request-local developer context appended near
the latest user message rather than stable system identity.

Model clients receive the same prompt contract. OpenAI Chat Completions rows
that support the OpenAI `developer` role pass prompt `messages` through
directly. For DeepSeek rows, the adapter targets
`https://api.deepseek.com`, sends `response_format={"type":"json_object"}`,
uses `extra_body={"thinking":{"type":"disabled"}}` for `none`, uses
`extra_body={"thinking":{"type":"enabled"}}` with literal `reasoning_effort`
values for `high` and `max`, and omits OpenAI-only request fields such as
`prompt_cache_key` and
`parallel_tool_calls`. Catalog rows expose `supports_developer_role`; when it is
false, direct chat places the request-local memory map at the end of the system
instruction and the Chat Completions adapter folds any remaining `developer`
messages into the first `system` message before dispatch. `LiteLLMAgent`
normalizes system/developer instruction messages into one leading `system`
message before calling `litellm.acompletion`, because several LiteLLM-backed
providers do not accept OpenAI's `developer` role. `OpenAIResponsesHTTPAgent` moves all
system/developer instruction text into the Responses `instructions` parameter
every turn. Request-local guidance such as the memory map stays in
`instructions` so Responses continuation via `previous_response_id` does not
carry stale map copies forward in provider-managed input history. If the chat
row has an `openai_previous_response_id`, its `input` contains only the current
user message or current turn's function-call outputs, and the executor skips
fetching local chat history for that normal cursor-backed request.
Without a cursor, Responses input contains the remaining conversation messages:
user and assistant content become normal Responses input messages, assistant
function calls become Responses `function_call` items, and tool rows become
Responses `function_call_output` items. Persisted provider-neutral native patch
exchanges become typed SDK `ApplyPatchCall` and `ApplyPatchCallOutput` items.
This is the manual-context path used for new Responses chats and for
stale-cursor fallback. With a cursor, a tool follow-up sends only the trailing
call outputs required by the previous response.
`GeminiAgent` moves system/developer
instruction text into `system_instruction` and sends user/assistant
conversation content through `contents`. OpenAI SDK clients and provider
response objects stay inside adapter modules; application services persist only
domain data and JSON-safe metadata.

When memory tools are attached, the prompt sets `parallel_tool_calls` to
`false`. Read/search tools and function-tool writers use strict JSON-schema functions.
For `OpenAIResponsesHTTPAgent`, the adapter additionally sends typed SDK
`ApplyPatchToolParam(type="apply_patch")` when memory writes are allowed and the
selected catalog row advertises `apply_patch`. That request keeps read/search
functions and omits the two function-tool writers. The official OpenAI Responses rows
for `gpt-5.4-nano`, `gpt-5.6-luna`, and `gpt-5.6-terra` have that capability;
`gpt-5-nano` and other providers retain JSON-schema functions. `apply_patch` is
intentionally absent from the user-requestable generic `native_tools`
allowlist. Public catalog rows keep the complete capability in
`native_tool_support` and separately expose
`requestable_native_tool_support`; both that public projection and direct-turn
validation use the same backend allowlist.

The LiteLLM adapter strips the
OpenAI-specific `function.strict` marker before dispatch and asks LiteLLM to
drop unsupported OpenAI parameters, while keeping the schema and backend
argument validation. `ModelClientFinal` can carry provider-neutral
`tool_calls`; OpenAI Chat Completions and LiteLLM aggregate streamed tool-call
argument fragments before returning the final, while OpenAI Responses converts
Responses `function_call` and `apply_patch_call` output items into the same
provider-neutral call shape with an explicit tool type. Follow-up native results
become exactly one `apply_patch_call_output` per call ID. The app caches results
by call ID and explicit stale-cursor replay reuses the stored result instead of
executing the patch again.
Tool execution belongs to
`DirectChatTurnExecutor` and `DirectChatMemoryToolService`, not the provider
adapters.

Direct chat requires the canonical `main_structured_response` envelope. SSE
`user.response` events for structured turns carry
`response_format="main_structured_json"` and a `response_part` such as
`emotional_tone`, `speech`, or `display`. The OpenAI-facing schema requires all
main structured fields and represents absent optional values with
`gesture: null`/`display: null`; the parser normalizes `gesture: null` and
`gesture: ""` to no avatar gesture. Non-null `gesture` values are constrained
to the current production gesture IDs from the animation manifest. The backend
uses the parsed `emotional_tone`, `emotional_intensity`, and `gesture` fields to
drive avatar state and emits `speech` plus optional distinct `display` to the
UI. Persistence keeps the raw final structured JSON as one visible assistant
message instead of splitting speech and display into separate durable rows.

## Provider Behavior

`OpenAIResponsesHTTPAgent` continues prior Responses turns from the chat row's
`openai_previous_response_id`. If that chat-row cursor is null, direct chat
replays local visible history instead of sending `previous_response_id`. Active
compaction summaries are part of that replayed local context. They are not
fetched or sent as Responses `input` on cursor-backed turns because the provider
request carries only current instructions, current user input or function-call
outputs, and `previous_response_id`. If OpenAI reports that the previous
response cannot be resolved, the executor fetches local history lazily and
retries the same provider call once with continuation removed. The retry uses
the manual-context serialization above, and a successful non-incognito final
response refreshes the chat-row cursor through normal persistence.

Both OpenAI SDK adapters share one error classifier. It maps OpenAI status and
SDK exceptions into stable model-client codes such as
`openai_bad_request`, `openai_authentication_error`,
`openai_permission_denied`, `openai_not_found`, `openai_rate_limit`,
`openai_quota_exceeded`, `openai_timeout`, `openai_connection_error`,
`openai_conflict`, `openai_server_error`, `openai_overloaded`, and
`openai_previous_response_unresolvable`. The adapters retry one request-local
time only for retryable failures before any downstream text delta has been
yielded. Once text has streamed, the adapter surfaces the error without retry
so the runtime does not duplicate a partial generation. Error metadata exposed
through model-client errors is sanitized to provider/API/model, status code,
request ID, retryability, retry-after, provider error code/type/param, and a
redacted provider error message; raw OpenAI response bodies are intentionally
not carried into `chat:sse` details.

The prompt `prompt_cache_key` is a SHA-256 scope derived from user ID, anima
ID, provider type, and model. This avoids mixing incompatible anima prefixes
while keeping repeated turns for the same user/anima/provider/model eligible
for provider prompt caching. DeepSeek Chat Completions rows omit this field
because DeepSeek's documented request shape does not use OpenAI's
`prompt_cache_key`. Hugging Face Chat Completions rows also omit
`prompt_cache_key`, `stream_options`, `parallel_tool_calls`, and
`reasoning_effort` for router compatibility.

DeepSeek JSON Object mode is selected from the persisted
`structured_output_transport="json_object"` capability on the chosen
`model_providers` row. It requires the prompt to ask for JSON, so the
direct-chat response-format instructions include the shared response guidelines,
the word `json`, the expected JSON schema, and an example object. DeepSeek
still receives
`response_format={"type":"json_object"}`; schema adherence is enforced by
Animama's local final-response validation.

Hugging Face rows use
`structured_output_transport="json_schema"` and target
`https://router.huggingface.co/v1` through the same Chat Completions adapter.
The catalog pins DeepInfra with model IDs such as
`zai-org/GLM-5.2:deepinfra`, and the adapter preserves that exact model string.
It folds any `developer` messages into `system` and strips the OpenAI-specific
`function.strict` marker from function tools before dispatch while keeping
Animama's local tool-argument validation. Hugging Face chunks may include
provider-specific choice extras such as `text`, `reasoning`,
`reasoning_content`, and `token_id`; `text` is normalized as assistant content
when `delta.content` is absent, while private reasoning/token metadata is not
treated as an unknown-provider warning.

`native_tools` and `reasoning_effort` are request-scoped options validated
against the selected catalog row. Current direct support includes the
Responses-native `web_search` tool for catalog rows that advertise it; the Chat
Completions `OpenAIHTTPAgent:gpt-5.4-nano` row does not advertise native web
search, while the GPT-5.6 entries are Responses-only. The Responses adapter
sends native web search with `search_context_size: "low"` by default. Anima
memory tools are separate app-layer function tools. They are
currently supported for `OpenAIHTTPAgent`, `OpenAIResponsesHTTPAgent`,
`LiteLLMAgent`, and `MockModelClient`. The Responses adapter converts the
shared Chat Completions-style function schemas and tool-result messages into
Responses `function` tools and `function_call_output` input items. For
`OpenAIHTTPAgent:gpt-5.4-nano`, a turn that would attach
memory function tools is rejected when `reasoning_effort` is also requested,
because that `/v1/chat/completions` combination is not supported upstream.
Gemini setup fails when memory tools would be active for the requested turn.

LiteLLM support is intentionally constrained to the provider-prefixed aliases in
`MODEL_CATALOG`; arbitrary LiteLLM model IDs are not accepted by the model
selector.

## Prompt-Only Maintenance Calls

Title generation and chat compaction use `DirectModelPromptRunner`, which
resolves a backend-owned catalog row and invokes the same shared model-client
registry. These prompt-only calls are separate from the primary anima turn,
do not stream to the frontend, and persist usage only where their service owns
durable state, such as `chat_compactions`. Primary `chat:sse` turns that use
`OpenAIResponsesHTTPAgent` skip this local post-response chat-compaction pass
and rely on Responses server-side compaction instead.

## Chat Persistence

Normal direct `chat:sse` turns persist messages through `ChatManager` unless
dispatch options mark the turn incognito. Assistant messages store a lightweight
`model_provider` and `model` snapshot so later catalog changes do not rewrite
history. Assistant usage is added eagerly to the parent chat's cumulative usage
counters.

Direct chat also persists a raw Chat Completions-style `raw_provider_message`
for each durable row used in model replay. User rows store `role: "user"`,
tool-call rows store the assistant `tool_calls`, tool-result rows store
`role: "tool"` plus `tool_call_id`, and final assistant rows store the raw
structured JSON as assistant `content`. Tool-assisted successful turns persist
compact internal assistant/tool rows for memory tool calls and tool results
before the visible assistant message. Public history readers hide internal rows
by default and project final assistant JSON back to display or speech text; chat
search indexes that user-facing projection.

The same non-incognito `ChatManager.record_turn` transaction also merges the
latest direct-chat memory fingerprints into
`chats.metadata.memory_context`. The manifest records opened file paths,
statuses, revisions, SHA-256 values, kinds, run metadata, and reserved message
turns. Incognito turns may read memory context for model setup but do not update
chat metadata.

For `OpenAIResponsesHTTPAgent`, assistant rows may contain compact
`data.openai` metadata such as response IDs and request cursors. The parent
chat's `openai_previous_response_id` advances only from Responses assistant
turns that include a final response ID. Persisted non-Responses assistant turns
clear the cursor during the same chat-row update that reserves turns and updates
usage. Incognito Responses turns send `store=false` upstream and do not advance
the local Responses cursor.

The same successful non-incognito chat-row update stores the last durable model
snapshot for frontend restore: `chats.last_model_client` is the catalog row's
model-client profile such as `openai_chat_completions` or `openai_responses`,
and `chats.last_model_id` is the model slug such as `gpt-5-nano`.

## Adding Provider Support

When adding a provider/model:

1. Update `MODEL_CATALOG` in `src/backend/animama/app/model_catalog.py`.
2. Add or extend a direct model client in `src/backend/animama/adapters/model_clients/`.
3. Register the client in `src/backend/animama/server/model_clients.py`.
4. Add capability and provider-switching tests.
5. Update [Model catalog](../model-catalog.md) and generated frontend clients if
   the public API shape changes.
