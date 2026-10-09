# Model Clients And Providers

Normal `POST /v1/animas/{anima_id}/chat:sse` turns use shared direct model
clients. The boundary accepts a prepared prompt, provider options and
continuation state, then emits normalized deltas and sanitized observations.

## Direct Chat Boundary

Direct chat resolves model selection in this order:

1. request `model_provider_id`, when present
2. `anima_chat_profiles.default_model_provider_id`

The selected ID must name an active chat row on an active connection whose
capabilities support the requested turn; [direct chat](chat.md#request-contract)
lists the owner-row rules. Setup errors happen before the SSE
stream opens, so callers receive a normal HTTP error instead of a partially
opened stream.

`DirectChatTurnExecutor` owns the app-layer turn:

- verifies chat ownership through `ChatManager`
- fetches visible chat history and active compaction context
- opens direct-chat memory context for anima identity
- assembles one OpenAI Chat Completions-compatible prompt
- attaches scoped memory tools when request options, the row's tool support and
  its `allow_memory_writes` flag allow them
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

- `OpenAIHTTPAgent`: OpenAI Chat Completions via the OpenAI Python SDK, for
  every model connection
- `OpenAIResponsesHTTPAgent`: OpenAI Responses via the OpenAI Python SDK, on
  the built-in OpenAI connection only
- `MockModelClient`: deterministic local/test model client

Provider type names, including their `Agent` suffixes, are durable catalog
identifiers.

The public model-provider catalog also reports a nullable chat compatibility
profile for each row. `OpenAIHTTPAgent` maps to
`model_client="openai_chat_completions"` and
`api_standard="chat_completions"` on every connection.
`OpenAIResponsesHTTPAgent` maps to `model_client="openai_responses"` and
`api_standard="responses"`.

`chat:sse` treats `api_standard` as the compatibility key for one persisted
chat. A new or empty chat records the selected row's `api_standard` before any
provider call. Successful non-incognito turns then update
`chats.last_model_provider_id` from the row ID,
`chats.last_model_client` from the selected catalog row's `model_client` and
`chats.last_model_id` from the selected model slug in the same chat-row update
that records usage and advances turns. Later requests can switch to another
catalog row with the same `api_standard`, but a different standard is rejected
with `409 chat_api_standard_mismatch` before local history, Responses cursors,
memory side effects, or upstream model clients are used. Rows whose provider
type has no compatibility profile fail setup with
`chat_api_standard_unsupported`.

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

`ANIMAMA_OPENAI_RESPONSES_COMPACTION_THRESHOLD_TOKENS` controls native
server-side auto-compaction for `OpenAIResponsesHTTPAgent` Responses create
requests. It defaults to `90000`. Values less than or equal to zero disable
the `context_management` payload. When enabled, the adapter sends
`context_management: [{"type": "compaction", "compact_threshold": ...}]`; the
OpenAI server decides whether to compact based on the rendered token count.
Chat Completions rows have no provider-side compaction; they use the local
post-response pass described under
[prompt-only maintenance calls](#prompt-only-maintenance-calls).

When `ANIMAMA_LLM_SKIP=1`, startup registers `MockModelClient` for all direct
provider families so local chat can run without upstream API keys. Mock mode is
all-or-nothing for direct provider families.

## Connections And Credentials

Every catalog row belongs to a model connection
([model catalog](../model-catalog.md#connections-and-row-ownership)). A request
goes only to the row's connection base URL, with only that connection's key and
timeout. `app/model_clients/credentials.py` resolves keys, and
`adapters/model_clients/openai_chat_completions/connection_sdk.py` builds SDK
clients from them.

Keys live in the process's runtime credential store
(`app/model_clients/credential_store.py`, instance in
`server/runtime_credentials.py`). Startup loads the allowed names below, plus
`ELEVENLABS_API_KEY`, from the environment once; nothing reads keys from
`os.environ` afterwards. The embedded desktop backend then removes those names
from its environment, and Electron main replaces the store while it runs.

- **Per request.** `PinnedCredentialsMiddleware` pins the current snapshot
  for each HTTP request and WebSocket, and tasks the request starts inherit it.
  A request finishes on the keys it was admitted with; the next request uses a
  replaced key. Adapters resolve a key once per stream, run or probe and reuse
  it for retries and headers. Background loops read the latest snapshot per job.
- **No cached keys.** Long-lived SDK clients are built key-free by
  `base_client_for_connection`. `keyed_client` adds the key to a per-request
  view that shares the pool, so a removed key stops working on the next request.

- **Built-in `openai` connection.** Uses `OPENAI_API_KEY` and `OPENAI_BASE_URL`
  (default `https://api.openai.com/v1`). It is the only connection that runs
  `OpenAIResponsesHTTPAgent`: setup rejects a Responses row elsewhere, and the
  adapter refuses one with `responses_connection_unsupported`.
- **Owner connections.** `StoreModelCredentialResolver` reads only the
  key variable the connection names in `credential_env`. The name must
  be `OPENAI_API_KEY`, `DEEPSEEK_API_KEY`, `HF_TOKEN`, `OPENROUTER_API_KEY` or
  match `ANIMAMA_CONNECTION_<NAME>_API_KEY`; desktop-managed keys use
  `ANIMAMA_CONNECTION_<ID>_API_KEY`. An owner connection never falls back to
  the OpenAI key.
- **Isolation.** Owner-connection SDK clients omit the process
  `OpenAI-Organization` and `OpenAI-Project` headers and every header listed in
  `OPENAI_CUSTOM_HEADERS`, and set `Authorization` from the connection's own
  key. A keyless connection (no `credential_env`) sends no `Authorization`
  header. A preset's fixed `request_headers` are then added to every request
  (chat, probe and model listing); only `openrouter` has them, sending
  `X-Title: Animama` and `HTTP-Referer: https://animama.ai`.
- **Missing keys.** A named key that is not in the store fails the turn with
  `missing_api_key` (category `credential_missing`). Self-hosted backends read
  the environment only at startup, so restart them after changing a variable.
- **Timeouts.** Owner connections store their own timeout: 60 s by default for
  cloud presets and 300 s for local presets, because a first request may load a
  model. The built-in connection and `OpenAIResponsesHTTPAgent` use
  `ANIMAMA_MODEL_CLIENT_TIMEOUT_SECONDS` (default 60). Chat Completions requests
  also cap connecting at 10 s (`connection_timeout`), so a stopped server fails
  quickly.
- **Clients.** `OpenAIHTTPAgent` caches one SDK client per connection.
  `OpenAIResponsesHTTPAgent` owns one OpenAI-only SDK client.

### Connection Presets

Presets (`app/model_connection_presets.py`) only fill defaults when the owner
adds a connection; every value except a preset's fixed request headers can be
changed afterwards. Local presets build their base URL from
`ANIMAMA_LOCAL_MODEL_HOST` (`127.0.0.1` by default, `host.docker.internal` in
Compose).

| Preset        | Default base URL                   | Key                                     | Timeout | Compatibility defaults                                                                                    |
| ------------- | ---------------------------------- | --------------------------------------- | ------- | --------------------------------------------------------------------------------------------------------- |
| `ollama`      | `http://<host>:11434/v1`           | none                                    | 300 s   | fold `developer`, no OpenAI extensions                                                                    |
| `lmstudio`    | `http://<host>:1234/v1`            | none                                    | 300 s   | fold `developer`, no OpenAI extensions                                                                    |
| `llamacpp`    | `http://<host>:8080/v1`            | none                                    | 300 s   | fold `developer`, no OpenAI extensions                                                                    |
| `vllm`        | `http://<host>:8000/v1`            | none                                    | 300 s   | fold `developer`, no OpenAI extensions                                                                    |
| `deepseek`    | `https://api.deepseek.com`         | expected; suggests `DEEPSEEK_API_KEY`   | 60 s    | fold `developer`, no OpenAI extensions, `reasoning_mode=deepseek_thinking`                                |
| `huggingface` | `https://router.huggingface.co/v1` | expected; suggests `HF_TOKEN`           | 60 s    | fold `developer`, no OpenAI extensions, no streamed usage, strip function `strict`, `reasoning_mode=omit` |
| `openrouter`  | `https://openrouter.ai/api/v1`     | expected; suggests `OPENROUTER_API_KEY` | 60 s    | fold `developer`, no OpenAI extensions                                                                    |
| `custom`      | none                               | optional                                | 60 s    | fold `developer`, no OpenAI extensions                                                                    |

DeepSeek models typically need the `json_object` structured-output mode, which
the probe selects when schema output fails. Hugging Face model IDs are sent
exactly, so a suffix such as `zai-org/GLM-5.2:deepinfra` pins the router's
inference provider. Without `stream_options`, servers usually stream no usage;
the adapter then estimates it (see [chat persistence](#chat-persistence)).

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
OpenAI-compatible servers may add choice or delta extras. On every connection,
`reasoning`, `reasoning_content` and `token_id` are private provider metadata:
they never become public text deltas, final assistant text, spoken text or
persisted chat content, and they do not raise unknown-provider warnings. A
choice-level `text` extra is used as content when `delta.content` is absent.

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
`DirectChatPrompt.response_format`; `json_object` JSON-mode rows and rows
without a structured transport (which get no `response_format`) receive those
guidelines plus the dumped schema and example object because nothing enforces
schema adherence. The identity section
contains only file content rather than file path, status, revision, or
fingerprint details. Anima profile columns, `metadata.direct_chat`, and pinned
user profile content are not prompt sources. The system message ends with the
server-owned
[Companion Guardrails](../../adr/0008-non-overridable-companion-guardrail.md).
One request-local `developer` message always sits immediately before the latest
user message: the user-scope memory file map (when memory influence is
enabled), the attached-file list and finally the guardrails again, so they are
the last instruction text before the user's words. An app compaction summary is
a `developer` message directly after the system message. The
[turn layout](prompt-caching.md#turn-layout) describes each provider path and
its cache breakpoints.

Model clients receive the same prompt contract. Chat Completions requests are
shaped by the row's connection compatibility options
(`ModelConnectionCompatibility`, stored in `model_connections.compatibility`
and edited under Advanced in App Settings). The built-in OpenAI connection uses
the defaults: no folding, every field sent and `openai_effort`.

- `fold_developer_role`: send no `developer` messages. The row's
  `supports_developer_role` is then false, so the prompt assembler puts the
  turn context and the guardrails in a `<turn_context>` block at the start of
  the user message, which the system message describes, and folds a compaction
  summary into the system message before its closing guardrails. The adapter
  folds within-turn `developer` instructions (forced final, repair) into the
  end of the system message before dispatch. On by default for every
  non-OpenAI preset.
- `send_openai_extensions`: send `prompt_cache_key` and `parallel_tool_calls`,
  which some servers reject as unknown fields.
- `send_stream_usage`: send `stream_options` (`include_usage`).
- `strip_function_strict`: drop `strict` from function tool definitions while
  keeping the schema and Animama's local argument validation.
- `reasoning_mode`: `openai_effort` sends a supported effort as
  `reasoning_effort`; `deepseek_thinking` sends
  `extra_body={"thinking":{"type":"disabled"}}` for `none` and enabled thinking
  with a literal `reasoning_effort` for `high` and `max` (other values fail with
  `unsupported_reasoning_effort`); `omit` never sends an effort.

JSON-mode rows (`structured_output_transport="json_object"`) receive
`response_format={"type":"json_object"}` whatever the connection.

### Reply validation and recovery

The executor validates each final reply locally
(`recover_main_structured_response`). A reply is valid when it contains a JSON
object with a non-blank `speech` string, even inside a markdown fence or prose.
Unknown keys are dropped; a missing or unknown tone becomes `neutral`, intensity
is clamped and an unknown gesture is dropped.

An invalid reply is recovered in this order, and the assistant row records the
outcome in `data.structured_recovery`:

1. **Salvaged** — speech from the invalid reply has already streamed. The
   streamed tone, gesture, speech and display become the reply, so no speech is
   repeated.
2. **Repaired** — otherwise one repair request is sent: the request that
   produced the reply, without tools, plus a repair instruction and the
   Companion Guardrails last. Chat Completions rows with a developer role also
   see the invalid reply as the previous assistant message. Rows that fold
   developer messages (every local preset) and Responses rows get the
   instruction alone, because a trailing assistant message is continued as a
   prefill and Responses resends the round from its own cursor. Usage covers
   both requests.
3. **Plain text** — the repair also fails, or its request errors. The
   model's text becomes speech (only its `speech` value if it looks like JSON;
   the invalid original's text if the repair has none), with
   `neutral` emotion, intensity 1 and no gesture, and is spoken by TTS.

Salvaged and plain-text rows store and replay a synthesized valid reply as
their `content`, so later turns do not learn to answer in plain text. Each
recovery logs `Direct chat structured reply recovered` with ids, the transport
and lengths, never message text. A reply with no speakable text fails with
`main_structured_response_parse_failed`. Memory changes made by the turn's
tool calls stay in every case.

`OpenAIResponsesHTTPAgent` sends only the stable system message as the
Responses `instructions` parameter, which ends with the guardrails. The turn
context travels as a `developer` input item before the user item. If the chat
row has an `openai_previous_response_id`, its `input` contains only that
developer item and the current user message, or the current turn's
function-call outputs, followed by any forced-final or repair instruction as a
`developer` item. The executor skips fetching local chat history for that
normal cursor-backed request. Each turn's context item stays in the stored
chain until native compaction.
Without a cursor, Responses input contains the remaining conversation messages
in the same order: user and assistant content become normal Responses input
messages, assistant function calls become Responses `function_call` items, and
tool rows become Responses `function_call_output` items. Persisted
provider-neutral native patch exchanges become typed SDK `ApplyPatchCall` and
`ApplyPatchCallOutput` items. This is the manual-context path used for new
Responses chats, incognito turns (`store: false`) and stale-cursor fallback; it
marks the last two history user messages as explicit cache breakpoints.
OpenAI SDK clients and provider
response objects stay inside adapter modules; application services persist only
domain data and JSON-safe metadata.

When memory tools are attached, the prompt sets `parallel_tool_calls` to
`false`. Read/search tools and function-tool writers use strict JSON-schema functions.
For `OpenAIResponsesHTTPAgent`, the adapter additionally sends typed SDK
`ApplyPatchToolParam(type="apply_patch")` when memory writes are allowed and the
selected catalog row advertises `apply_patch`. That request keeps read/search
functions and omits the two function-tool writers. The official OpenAI Responses row
for `gpt-6-luna` has that capability; Chat Completions rows retain JSON-schema
functions. `apply_patch` is
intentionally absent from the user-requestable generic `native_tools`
allowlist. Public catalog rows keep the complete capability in
`native_tool_support` and separately expose
`requestable_native_tool_support`; both that public projection and direct-turn
validation use the same backend allowlist.

`ModelClientFinal` can carry provider-neutral
`tool_calls`; OpenAI Chat Completions aggregates streamed tool-call
argument fragments before returning the final, while OpenAI Responses converts
Responses `function_call` and `apply_patch_call` output items into the same
provider-neutral call shape with an explicit tool type. Follow-up native results
become exactly one `apply_patch_call_output` per call ID. The app caches results
by call ID and explicit stale-cursor replay reuses the stored result instead of
executing the patch again.
Tool execution belongs to
`DirectChatTurnExecutor` and `DirectChatMemoryToolService`, not the provider
adapters.

Some servers reject a response format together with tools, or ignore the tools.
When a Chat Completions row's internal `tools_with_structured_output`
capability is false (set by the probe or the owner) and the turn offers tools,
direct chat splits the turn: tool rounds send tools without `response_format`,
then one structured round sends `response_format` without tools, built like
the forced final after the tool limit. Only the structured round streams public
text; the last tool round's unconstrained answer is discarded. Responses rows
never split.

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
request carries only the stable instructions, the turn context and user input
or function-call outputs, and `previous_response_id`. If OpenAI reports that the previous
response cannot be resolved, the executor fetches local history lazily and
retries the same provider call once with continuation removed. The retry uses
the manual-context serialization above, and a successful non-incognito final
response refreshes the chat-row cursor through normal persistence.

When companion crisis detection is effective, direct chat sets the provider
option `moderation_model` for `OpenAIResponsesHTTPAgent` rows only, and the
adapter sends `moderation={"model": "omni-moderation-latest"}` with the
Responses create request. The option is cleared on tool follow-up and forced
final requests, so only round 0, whose new input is the user's message, is
moderated. The adapter parses the completed response's input moderation into a
content-free `ModelClientFinal.input_moderation` (`status` `result` or `error`,
flagged categories and scores). Moderation is report-only: it never blocks or
alters the reply, and the executor only uses a self-harm signal to add a
[crisis card](chat.md#sse-events). Chat Completions rows do not support
moderation and never receive the option.

Both OpenAI SDK adapters share one error classifier
(`adapters/model_clients/openai_errors.py`) on every connection. It maps SDK
exceptions and status codes into stable model-client codes such as
`openai_bad_request`, `openai_authentication_error`,
`openai_permission_denied`, `openai_not_found`, `openai_rate_limit`,
`openai_quota_exceeded`, `openai_timeout`, `openai_connection_error`,
`openai_conflict`, `openai_server_error`, `openai_overloaded`, and
`openai_previous_response_unresolvable`; connection failures before a request
use codes such as `missing_api_key` and `connection_unavailable`. The adapters
retry one request-local
time only for retryable failures before any downstream text delta has been
yielded. Once text has streamed, the adapter surfaces the error without retry
so the runtime does not duplicate a partial generation. Error metadata exposed
through model-client errors is sanitized to provider/API/model, status code,
request ID, retryability, retry-after, provider error code/type/param, and a
redacted provider error message; raw provider response bodies and keys are
intentionally not carried into `chat:sse` details.

When direct chat emits the `error` event, `model_error_details`
(`app/chat/direct_turn/events.py`) adds a provider-neutral `category` from
`app/model_clients/error_categories.py` and names the connection:
`connection_id`, `connection_name`, `connection_preset` (also written to
`provider`) and, for connections other than the built-in one,
`connection_base_url`. The event `code` stays the adapter code on every
connection, so clients explain failures from `details.category`:

- `unreachable`, `timeout`, `server_error`;
- `credential_missing`, `credential_rejected`;
- `model_not_found`, `bad_request`;
- `context_exceeded`: OpenAI's `context_length_exceeded` code, a rejected
  request whose message matches known llama.cpp, vLLM or LM Studio wording, or
  llama.cpp's HTTP 500 "input is too large";
- `rate_limited`, `quota_exceeded`;
- `provider_error` for any other code.

The connection probe also reports `invalid_base_url` and `unexpected_response`
(a reply that is not OpenAI-compatible).

The prompt `prompt_cache_key` is a SHA-256 scope derived from user ID, anima
ID, provider type, and model. This avoids mixing incompatible anima prefixes
while keeping repeated turns for the same user/anima/provider/model eligible
for provider prompt caching. Responses always sends it; Chat Completions sends
it only when the connection's `send_openai_extensions` option is on.

`native_tools` and `reasoning_effort` are request-scoped options validated
against the selected catalog row. Current direct support includes the
Responses-native `web_search` tool for catalog rows that advertise it; Chat
Completions rows never advertise native web search and use the
[application web search](#application-web-search) tool instead. The Responses
adapter sends native web search with `search_context_size: "low"` by default. Anima
memory tools are separate app-layer function tools, supported for
`OpenAIHTTPAgent`, `OpenAIResponsesHTTPAgent` and `MockModelClient` rows with
tool calling. A row without tool calling runs the turn without memory tools
(and without attached-file search) instead of failing setup, and a row with
`allow_memory_writes=false` gets read tools only. The Responses adapter
converts the shared Chat Completions-style function schemas and tool-result
messages into Responses `function` tools and `function_call_output` input
items. For Chat Completions models whose ID starts with `gpt-5.4`, a turn that
would attach memory function tools is rejected when `reasoning_effort` is also
requested, because that `/v1/chat/completions` combination is not supported
upstream.

## Prompt-Only Maintenance Calls

Title generation and chat compaction use `DirectModelPromptRunner`, which
resolves the Utility [model role](../../frontend/features/model-settings.md#default-models)
(the App Settings choice, then `ANIMAMA_DEFAULT_UTILITY_MODEL_PROVIDER_ID`,
then the default chat model) and invokes the same shared model-client registry.
It sends a requested `request_options` reasoning effort only when the row
supports that effort. These prompt-only calls are separate from the primary
anima turn, do not stream to the frontend, and persist usage only where their
service owns durable state, such as `chat_compactions`.

After a successful non-incognito Chat Completions turn, the local
post-response compaction pass runs when `chats.active_context_tokens` reaches
the smallest of `ANIMAMA_CHAT_COMPACTION_THRESHOLD_TOKENS` (default 90000), 70%
of the model's context window, and 75% of the window left after the reply
reserve. The last bound matters only for rows with a large reply reserve; it
keeps this pass ahead of the 90% pre-send trigger. Each compaction rewrites
the summary that heads the cached history, so the trigger is set high. Primary `chat:sse` turns that use
`OpenAIResponsesHTTPAgent` skip the local pass and rely on Responses
server-side compaction instead.

### Context window budget

Chat Completions rows with a context window never receive a prompt larger than
it (`app/chat/direct_turn/context_fit.py`, `app/model_clients/context_budget.py`):

- **Budget.** Available tokens are the window minus the row's
  `max_output_tokens`, or minus a quarter of the window (at most 4096) when
  the row records none. Prompts are estimated offline and conservatively: ASCII
  at four characters per token, every other character as one token, over the
  messages, tools and response format.
- **Pre-send compaction.** Above 90% of available, the executor emits
  `run.status` `summarizing_context` `started`, compacts through the Utility
  role in its own session (`ChatCompactionService.compact_for_budget`, bounded
  by `ANIMAMA_CHAT_PRESEND_COMPACTION_TIMEOUT_SECONDS`, default 90), then emits
  `finished`. Incognito turns skip compaction.
- **Omission.** If the prompt still does not fit, or compaction failed or timed
  out, the oldest turns after the summary are left out of this request only
  (never deleted). History is kept in whole turns that start with a user
  message, so a tool call stays with its results, and it is fitted below the
  90% trigger to leave room for tool rounds. The warning log records counts,
  never content.
- **Too large.** When the instructions and latest message alone exceed the
  window, the turn fails with `error` code `context_window_exceeded` and
  category `context_exceeded`, before any model request.
- **Within the turn.** Tool results that would push the next round past the
  window become a `tool_result_too_large` tool error the model can react to.
  If even those errors do not fit, the model is asked for its final reply
  without tools and without that exchange; if that final would not fit
  either, the turn fails with `context_window_exceeded`. A structured-reply
  repair leaves out the invalid reply when it would not fit, and is skipped
  (plain-text fallback) when it still would not. A server that still rejects the
  first request as oversized gets one retry with about half of the history
  left out.

Compaction input is itself bounded to the Utility model's window (oldest
messages beyond it are left out of the new summary), and both compaction
passes keep a user message together with its reply.

## Application Web Search

`native_tools: ["web_search"]` means "search the web" for any model:

- A Responses row that advertises hosted `web_search` keeps hosted search.
- Otherwise, when the installation has a search backend and the row calls
  tools, the turn offers the application function tool `web_search(query)`
  (`app/web_search/`), also on turns without memory tools. The tool shares the
  memory tool round limit.
- Otherwise the turn runs without search and logs why (`no_backend`,
  `model_without_tools`, `provider_without_function_tools`, or
  `reasoning_with_function_tools` for Chat Completions models that reject a
  reasoning effort with function tools) instead of failing setup.

Backends are SearXNG (`GET {base_url}/search?format=json`, the instance's
`search.formats` must include `json`) and the Brave Search API
(`X-Subscription-Token`), in `adapters/web_search/`. Queries go only to the
configured backend. A result is a title, URL, snippet (at most 600
characters) and date; a call returns at most five. A backend failure becomes
a tool error (`web_search_<category>`) the model can explain, never a turn
failure. While a search runs, the turn emits `run.status` `searching_web`
`started` and `finished`.

The model sees full results within the turn. The persisted tool-result row
keeps only the query and each result's title and URL: Brave allows only
transient storage of results, and one rule covers both backends. Settings are
the local-only [web search routes](../architecture/http-api.md#web-search);
the backend reads its key from `ANIMAMA_CONNECTION_WEB_SEARCH_API_KEY` or
`BRAVE_SEARCH_API_KEY`, and model connections cannot read the former.

## Chat Persistence

Normal direct `chat:sse` turns persist messages through `ChatManager` unless
dispatch options mark the turn incognito. Assistant messages store a lightweight
`model_provider` and `model` snapshot, without a foreign key, so later catalog
changes and model removal do not rewrite history. Assistant usage is added
eagerly to the parent chat's cumulative usage counters.

When a Chat Completions stream reports no usage, the adapter estimates it at
about four characters per token over the serialized request and reply, and
marks the provider metadata with `usage_estimated` (and `usage_missing`). A turn
with tool rounds or a split structured round bills the sum of every request,
while `context_tokens` in the provider metadata records the last request's
footprint; `chats.active_context_tokens` uses that footprint, so estimated or
multi-request turns still trigger post-response compaction at the right size.

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
snapshot for frontend restore: `chats.last_model_provider_id` is the exact
catalog row ID, `chats.last_model_client` is the row's model-client profile
such as `openai_chat_completions` or `openai_responses`, and
`chats.last_model_id` is the model slug such as `gpt-6-luna`. The frontend
restores by row ID, since several connections can serve the same model slug,
and falls back to the client and slug only for chats without a row ID.

## Adding Provider Support

Follow [Adding AI model support](adding-ai-models.md) for catalog, adapter,
registration, schema, and validation changes.
