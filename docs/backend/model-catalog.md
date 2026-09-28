# Model Catalog

The durable backend model catalog is stored in `model_providers`. Every row
belongs to one model connection in `model_connections`. Built-in rows and the
built-in `openai` connection come from `src/backend/animama/app/model_catalog.py`;
the installation owner adds other connections and models in App Settings →
Models ([model settings](../frontend/features/model-settings.md)). The design is
recorded in
[ADR 0010](../adr/0010-application-owned-companion-features-and-composition-catalog-policy.md).

The public API is:

```text
GET /v1/model-providers
```

That route returns active rows on active connections that the composition's
catalog policy allows. Hidden rows are included with `hidden: true`, so a client
can still show a hidden row that an Anima uses. Provider credentials, base URLs,
pricing metadata and internal capability fields are omitted from the public
payload. A database failure returns `503` with
`detail.code="model_catalog_unavailable"`; the route never substitutes the
static catalog, which would silently drop owner rows.

## Connections And Row Ownership

A `model_connections` row names one OpenAI-compatible server: `name`, `preset`,
`base_url`, `credential_env` (the name of the environment variable that holds
its key, never the key), `compatibility` options and `timeout_seconds`. Requests
for a model row go only to its connection's base URL with only that
connection's key. [Model clients](runtime/model-client-providers.md#connections-and-credentials)
describes credentials, presets and compatibility options.

- The built-in `openai` connection stores no base URL or key reference. It uses
  `OPENAI_BASE_URL` (default `https://api.openai.com/v1`) and `OPENAI_API_KEY`.
  It is the only connection that serves `OpenAIResponsesHTTPAgent` rows. The
  owner cannot edit or remove it but can add models to it.
- Built-in rows (`source="builtin"`) are release-managed. The owner can only
  hide or show them.
- Owner rows (`source="owner"`, ids `owner:<hex>`) are added, edited and removed
  by the owner. Their capabilities come from a copied built-in template, the
  connection probe or values the owner enters.
- `model_kind` is `chat` or `embedding`. Embedding rows serve only the
  Embeddings model role; chat profiles and direct chat reject them.
- Removal is soft (`active=false`) because chat profiles reference rows.
  Re-adding a model to the same connection reactivates its row. Removing a
  connection retires its rows.
- Rows are unique on `(connection_id, provider_type, model, source)`, so two
  connections can serve the same model ID.

Connection, owner-model, probe and role routes are mounted only by the local
composition; see [HTTP API](architecture/http-api.md).

### Catalog Policy

Shared services receive a `ModelCatalogPolicy`
(`app/services/model_provider_catalog_service.py`) from the composition:
`owner_models_enabled` and an optional `builtin_allowlist`. The default exposes
built-in rows only. `create_local_app` enables owner models, which also applies
the owner's App Settings model roles. The policy filters the listing and role
resolution only; a composition that restricts built-in rows must also restrict
chat profiles and turn setup, which validate the selected row directly.

## Public Catalog Shape

Each serialized row has:

- `id`: `${model_provider}:${model}` for built-in rows, `owner:<hex>` for owner
  rows
- `model`: provider-specific model ID
- `model_provider`: backend provider adapter type
- `model_label`: the owner's label, else the model ID
- `provider_label`: human-readable provider name; owner rows use their
  connection's current name
- `logo_provider`: frontend logo key; owner rows use their connection preset's
  logo
- `model_client`: nullable direct model-client profile for chat compatibility,
  `openai_chat_completions` or `openai_responses`
- `api_standard`: nullable chat transcript standard, `chat_completions` or
  `responses`
- `source`: `builtin` or `owner`
- `connection_id` and `connection_name`
- `model_kind`: `chat` or `embedding`
- `hidden`: whether the owner hid the row from model lists
- `context_window_tokens`: nullable; owner chat rows need it before they can
  chat
- `accepts`: sorted input modalities
- `produces`: sorted output modalities
- `supports_developer_role`: whether requests may send OpenAI-style `developer`
  messages; false when the model lacks the role or its connection folds them
  into the system message
- `supports_tools`
- `supports_streaming`
- `supports_reasoning`: optional boolean for models with explicit reasoning
  support metadata
- `supported_reasoning_efforts`: optional ordered list of allowed
  request-scoped reasoning effort values
- `native_tool_support`: optional list of native provider tools supported by
  that concrete provider/model row; individual tools may be frontend opt-ins or
  backend-owned capabilities
- `requestable_native_tool_support`: optional list derived from the complete
  capability set and the direct-chat runtime allowlist; only these tools may be
  selected through `dispatch_options.native_tools`

Built-in chat rows produce text and support tools and streaming. Built-in
embedding rows accept text, produce `embedding` and advertise neither. Owner
rows carry whatever the owner confirmed. The internal `structured_kinds`,
`structured_output_transport`, `tools_with_structured_output`,
`allow_memory_writes` and `probe_result` fields are used by the backend
runtime and App Settings but are not exposed in the `/v1/model-providers`
public payload.

## Where Models Are Configured

Normal avatar chat stores the selected default as a stable catalog row ID on
`anima_chat_profiles.default_model_provider_id`:

```json
{
  "default_model_provider_id": "OpenAIResponsesHTTPAgent:gpt-6-luna"
}
```

Strict Anima creation seeds the profile from the owner's App Settings default
chat model (`user_settings.preferences.chat.default_model_provider_id`) when it
names an active model that direct chat supports. Otherwise, and always for
installation bootstrap, it uses `ANIMAMA_DEFAULT_MODEL_PROVIDER_ID`, which
defaults to `OpenAIResponsesHTTPAgent:gpt-6-luna`. Existing Animas keep their
own profile. The frontend model selector persists
changes through `PATCH /v1/animas/{anima_id}/chat-profile`.

The backend validates anima chat-profile updates (an active chat row) and
request-level `chat:sse` model overrides against `model_providers` rows; see
[direct chat](runtime/chat.md#request-contract) for turn validation.

Persisted assistant chat messages also store a lightweight `(model_provider,
model)` snapshot for the provider/model that produced the row. The snapshot has
no foreign key, so history survives a row's removal. User messages and
non-provider rows intentionally keep those fields null. Successful turns also
record the exact row on `chats.last_model_provider_id`, which the frontend uses
to restore a chat's model.

## Pricing Metadata And Cost Estimates

`model_providers` stores backend-internal token pricing and rate-card source
metadata for each provider/model row. Public `/v1/model-providers` responses do
not expose pricing fields. Owner rows and the built-in embedding rows are
`unpriced`; their usage is still recorded.

The pricing fields include:

- `pricing_status`, such as `priced` or `unpriced`
- source provider/model/URL/checked date
- currency and billing unit
- supported service tiers
- input, cached-input, and output prices per 1M tokens for standard, batch,
  flex, and priority tiers when known
- optional notes and regional-processing uplift metadata

`animama.app.util.model_pricing.estimate_model_token_cost()` calculates a
backend-only token-cost estimate from a `Usage` payload and a `ModelProvider`
row. It defaults `default`, `auto`, and unset service tiers to `standard`.
Cached input tokens are charged at the cached-input rate, while uncached input
tokens are `max(input_tokens - cached_input_tokens, 0)`. Output reasoning tokens
are not priced separately; they are part of the provider-reported output token
count.

When a row is unpriced, a requested service tier is unsupported, or a required
rate is missing (for example, cached tokens on a row without a cached-input
rate), the helper returns an explicit unpriced result with `None`
cost fields. It does not treat unknown pricing as zero dollars. The helper does
not apply regional-processing uplifts, long-context rates or tool-call fees;
later billing work must opt into those adjustments with the right request
context.

`gpt-6-luna` rows (both APIs) record the owner-supplied standard rates of
$0.10 input and $0.50 output per 1M tokens, checked 2026-09-28, with no source
URL. Its cached-input, batch, flex, priority and long-context rates are unknown
and stored as null, so `service_tiers_supported` is `["standard"]`: other tiers
and turns that report cached input tokens produce unpriced estimates.

## Provider Types

| Provider type              | Provider label                                     | Default logo                              | Notes                                                                                                                                                                                                                                                                                                    |
| -------------------------- | -------------------------------------------------- | ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `OpenAIHTTPAgent`          | OpenAI HTTP, or the connection name for owner rows | `openai`, or the connection preset's logo | Chat Completions adapter shared by every connection, including owner connections. Requests go to the row's connection base URL. Built-in embedding rows also use this provider type.                                                                                                                     |
| `OpenAIResponsesHTTPAgent` | OpenAI Responses HTTP                              | `openai`                                  | OpenAI Python SDK Responses adapter, valid only on the built-in OpenAI connection. Turns call `/responses` directly, support typed SSE text streaming, continue chats through the chat row's `openai_previous_response_id`, and use Anima memory function tools through Responses tool/input item types. |

## Built-In Provider/Model Pairs

| Provider type              | Model                    | Accepts     | Produces  | Tools | Streaming | Reasoning efforts                               | Native tools                |
| -------------------------- | ------------------------ | ----------- | --------- | ----- | --------- | ----------------------------------------------- | --------------------------- |
| `OpenAIHTTPAgent`          | `gpt-6-luna`             | image, text | text      | yes   | yes       | `none`, `low`, `medium`, `high`, `xhigh`, `max` | none                        |
| `OpenAIResponsesHTTPAgent` | `gpt-6-luna`             | image, text | text      | yes   | yes       | `none`, `low`, `medium`, `high`, `xhigh`, `max` | `apply_patch`, `web_search` |
| `OpenAIHTTPAgent`          | `text-embedding-3-small` | text        | embedding | no    | no        | n/a                                             | none                        |
| `OpenAIHTTPAgent`          | `text-embedding-3-large` | text        | embedding | no    | no        | n/a                                             | none                        |

The two `text-embedding-3-*` rows have `model_kind: "embedding"`. The
`gpt-6-luna` rows are chat rows with a 1,050,000-token context window, 128,000
max output tokens and a 2026-05-18 knowledge cutoff.

The `Tools` column is a broad provider capability flag. Anima memory tools are
app-layer tools executed by the direct chat runtime when the selected row
supports tool calling. Responses-native tools are
advertised through `native_tool_support`. Hosted `web_search` is observed
through model-client stream metadata; backend-owned memory `apply_patch` calls
are validated and executed by Animama.

## Structured Output Capabilities

`structured_kinds` is internal runtime metadata used by direct chat to decide
whether a provider/model can enforce
`main_structured_response` JSON. The canonical structured kind is
`main_structured_response`, which emits SSE parts with
`response_format="main_structured_json"`. The durable `model_providers` row also
stores backend-internal `structured_output_transport`, `json_schema`
or `json_object`, so adapters use the selected persisted row instead of the
in-process catalog helper at request time. This field is not returned by
`/v1/model-providers`.

Every built-in chat row supports this kind through schema-backed `json_schema`.
Owner chat rows take their transport from the template, the probe or the owner:
`json_schema`, `json_object` (the probe's fallback when schema output fails),
or none. A row without a transport has no structured kind and cannot run
direct chat, which requires `main_structured_response`.

JSON mode only guarantees parseable JSON, not schema adherence. For
`structured_output_transport="json_object"` rows, the backend prompts with the
shared response guidelines, the word `json`, the expected JSON schema, and an
example object in the response-format instructions, validates the completed
response locally, and
treats validation failure as an invalid structured response. For
`structured_output_transport="json_schema"` rows, the backend sends the schema
through the provider response-format field and keeps prompt guidance brief.
Main-structured streaming uses final-output validation for JSON-mode rows
instead of publishing partial semantic speech/display events before the object is
known to be valid.

The internal `tools_with_structured_output` capability records whether one
request may carry both function tools and a response format. When it is false,
direct chat splits a Chat Completions turn into tool rounds and one structured
round; see [model clients](runtime/model-client-providers.md#context-and-structured-output).

## Reasoning And Native Tool Capabilities

Reasoning and native tool metadata is optional in `MODEL_CATALOG`. Models that
do not declare those fields omit them from the public API payload rather than
returning empty capability lists.

`supported_reasoning_efforts` is normalized using
`REASONING_EFFORT_ORDER = ("none", "minimal", "low", "medium", "high",
"xhigh", "max")`, so frontend controls receive a stable display order.
Per-model values are listed in
[Built-In Provider/Model Pairs](#built-in-providermodel-pairs).

For both `gpt-6-luna` rows, `none` is first in the normalized list. The
frontend therefore sends `reasoning.effort: "none"` by default when either row
is selected, instead of inheriting OpenAI's omitted-field default of `medium`.

`OpenAIHTTPAgent` and `OpenAIResponsesHTTPAgent` honor request-scoped
`reasoning_effort` values when the selected effort is listed for the active
provider/model pair. `OpenAIResponsesHTTPAgent` sends supported efforts through
the Responses API `reasoning.effort` request field. `OpenAIHTTPAgent` follows
the connection's `reasoning_mode`: `openai_effort` sends the effort literally,
`deepseek_thinking` (the DeepSeek preset) turns `none` into disabled thinking
and sends `high` and `max` with thinking enabled, and `omit` never sends one.

`native_tool_support` lists provider-native tools by stable request name. The
catalog advertises `web_search` and `apply_patch` for the official
OpenAI Responses row `OpenAIResponsesHTTPAgent:gpt-6-luna`.
Runtime turns user-requested
`web_search` into a hosted Responses tool with `search_context_size: "low"`.
`requestable_native_tool_support` contains only `web_search` for that row.
`apply_patch` is therefore visible as a complete model capability but is not in
the generic request allowlist; the backend enables it only for permitted
direct-memory writes. Catalog serialization and direct-turn validation derive
the requestable list from the same backend policy. `OpenAIHTTPAgent:gpt-6-luna`
uses Chat Completions and advertises neither capability. Native tools are not
owner-editable: an owner Responses row keeps those of the Responses template it was copied from, and
Chat Completions rows never advertise them. Chat Completions models have no
web search.

## Production Selection

`OpenAIResponsesHTTPAgent` is selectable as a distinct direct OpenAI provider on
the built-in OpenAI connection.
Use it when Responses behavior, typed SSE streaming, supported native tools,
and `previous_response_id` continuation are the desired provider boundary.

DeepSeek and Hugging Face router models have no built-in rows. The owner adds a
connection from the `deepseek` or `huggingface` preset and adds models under it.
On self-hosted web the connection names the environment variable that holds
its key (conventionally `DEEPSEEK_API_KEY` or `HF_TOKEN`); on desktop the key is
kept in the encrypted vault. Both presets fold `developer` messages into the
system message and omit OpenAI request extensions; the
[preset table](runtime/model-client-providers.md#connection-presets) lists the
remaining differences. Their rows use `OpenAIHTTPAgent`, so they share the
`chat_completions` API standard and are blocked from Responses-backed chats by
the chat API standard fence.

## Resolution And Validation

Direct chat, chat-profile updates and model roles read the persisted row by ID.
Missing, inactive, non-chat, or unsupported rows fail setup before a direct
model-client call. Direct chat also requires an active connection, a context
window on owner rows, and the built-in connection for Responses rows.

This resolution is used by:

- anima chat-profile validation and direct-chat setup
- model roles (Utility, Memory Manager and Embeddings)
- tests that assert frontend-facing model selector behavior

Unsupported provider/model pairs should fail at validation time instead of
falling through to provider construction.

## Updating The Catalog

A newly released OpenAI model needs no code change: the owner adds it in App
Settings → Models on the built-in OpenAI connection, copying the capabilities
of a built-in template such as `gpt-6-luna`. Change `MODEL_CATALOG` only when
a model should ship as a release-managed built-in row.

Follow [Adding AI model support](runtime/adding-ai-models.md) when adding or
changing a built-in model, connection preset, provider type, or public model
capability. That guide covers the complete catalog-to-frontend flow, database
seed regeneration, adapter and API-standard decisions, pricing limitations,
tests, and live verification.

The generated seed `alembic/seeds/01-seed-model-providers.sql` upserts the
built-in `openai` connection and the built-in rows. It updates only
`source='builtin'` rows, never changes their `hidden` flag, and retires built-in
rows that are no longer in `MODEL_CATALOG`. Owner connections and rows are never
touched, and retired rows keep their IDs, so history stays valid.

`RETIRED_BUILTIN_REPLACEMENTS` in `animama.app.model_catalog` maps retired
built-in chat rows to a current row on the same API. On every run the seed moves
Anima chat profiles (`default_model_provider_id`) and the owner's
`chat.default_model_provider_id`, `models.utility_model_provider_id` and
`models.memory_manager_model_provider_id` preferences from a mapped row to its
replacement; other preference keys and profile metadata are kept. The embedding
role is not remapped because retired rows are chat rows. Operator defaults
(`ANIMAMA_DEFAULT_MODEL_PROVIDER_ID` and the utility and Memory Manager
defaults) that name a mapped row use its replacement when settings load, with a
warning in the log; update the environment to silence it. Current mappings:

| Retired row                                                                               | Replacement                           |
| ----------------------------------------------------------------------------------------- | ------------------------------------- |
| `OpenAIResponsesHTTPAgent:` `gpt-5.6-luna`, `gpt-5.6-terra`, `gpt-5-nano`, `gpt-5.4-nano` | `OpenAIResponsesHTTPAgent:gpt-6-luna` |
| `OpenAIHTTPAgent:` `gpt-5-nano`, `gpt-5.4-nano`                                           | `OpenAIHTTPAgent:gpt-6-luna`          |

When retiring a built-in row that Animas may use, add its mapping in the same
change and regenerate the seed.

Do not put provider secrets in `MODEL_CATALOG` or connection rows. Connections
store only the name of the environment variable that holds a key.
