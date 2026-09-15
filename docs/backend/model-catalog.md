# Model Catalog

The durable backend model catalog is stored in `model_providers`. Built-in rows
come from `src/backend/animama/app/model_catalog.py`.

The public API is:

```text
GET /v1/model-providers
```

That route returns active serialized catalog rows for the frontend. Provider
credentials, provider base URLs, pricing metadata, and user-supplied overrides
are intentionally omitted from the public payload.

## Public Catalog Shape

Each serialized row has:

- `id`: `${model_provider}:${model}`
- `model`: provider-specific model ID
- `model_provider`: backend provider adapter type
- `model_label`: currently the same string as `model`
- `provider_label`: human-readable provider name
- `logo_provider`: frontend logo key
- `model_client`: nullable direct model-client profile for chat compatibility,
  currently `openai_chat_completions` or `openai_responses` for the direct
  OpenAI rows
- `api_standard`: nullable chat transcript standard, currently
  `chat_completions` or `responses` for the direct OpenAI rows
- `accepts`: sorted input modalities
- `produces`: sorted output modalities
- `supports_developer_role`: whether the provider accepts OpenAI-style
  `developer` messages directly
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

All current catalog entries produce text, support tools, and support streaming.
The internal `structured_kinds` capability is used by the backend runtime but is
not exposed in the `/v1/model-providers` public payload.
Gemini and LiteLLM rows currently expose `model_client: null` and
`api_standard: null`; their chat transcript compatibility standards are future
work and are not inferred from provider family or model prefix. They also expose
`supports_developer_role: false` because they do not receive OpenAI Chat
Completions developer messages directly.

## Where Models Are Configured

Normal avatar chat stores the selected default as a stable catalog row ID on
`anima_chat_profiles.default_model_provider_id`:

```json
{
  "default_model_provider_id": "OpenAIHTTPAgent:gpt-5-nano"
}
```

Strict Anima creation seeds the profile from `ANIMAMA_DEFAULT_MODEL_PROVIDER_ID`,
which defaults to
`OpenAIResponsesHTTPAgent:gpt-5.6-luna`. The frontend model selector persists
changes through `PATCH /v1/animas/{anima_id}/chat-profile`.

The backend validates anima chat-profile updates and request-level
`chat:sse` model overrides against active `model_providers` rows.

Persisted assistant chat messages also store a lightweight `(model_provider,
model)` snapshot for the provider/model that produced the row. User messages and
non-provider rows intentionally keep those fields null.

## Pricing Metadata And Cost Estimates

`model_providers` stores backend-internal token pricing and rate-card source
metadata for each provider/model row. Public `/v1/model-providers` responses do
not expose pricing fields.

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
rate is missing, the helper returns an explicit unpriced result with `None`
cost fields. It does not treat unknown pricing as zero dollars. The helper does
not apply regional-processing uplifts or tool-call fees; later billing work
must opt into those adjustments with the right request context.

## Provider Types

| Provider type | Provider label | Default logo | Notes |
| --- | --- | --- | --- |
| `OpenAIHTTPAgent` | OpenAI HTTP or provider row override | `openai` or row override | OpenAI-compatible Chat Completions adapter. OpenAI rows use `https://api.openai.com/v1`; DeepSeek rows use `https://api.deepseek.com`; Hugging Face rows use `https://router.huggingface.co/v1` with Hugging Face label/logo overrides. |
| `OpenAIResponsesHTTPAgent` | OpenAI Responses HTTP | `openai` | OpenAI Python SDK Responses adapter. Registry entries include `https://api.openai.com/v1` as the provider base URL. Turns call `/responses` directly, support typed SSE text streaming, continue chats through the chat row's `openai_previous_response_id`, and use Anima memory function tools through Responses tool/input item types. |
| `GeminiAgent` | Gemini | `google` | Google Gemini SDK-backed adapter. Registry base URL is empty. |
| `LiteLLMAgent` | LiteLLM | prefix-based | LiteLLM SDK-backed adapter. Only provider-prefixed aliases in this catalog are accepted. |

LiteLLM logos are chosen from the model prefix:

| Prefix | Logo key |
| --- | --- |
| `openai/` | `openai` |
| `gemini/` | `google` |
| `xai/` | `xai` |
| `groq/` | `groq` |

## Supported Provider/Model Pairs

| Provider type | Model | Accepts | Produces | Tools | Streaming | Reasoning efforts | Native tools |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `OpenAIHTTPAgent` | `gpt-5-nano` | image, text | text | yes | yes | `minimal`, `low`, `medium`, `high` | none |
| `OpenAIResponsesHTTPAgent` | `gpt-5-nano` | image, text | text | yes | yes | `minimal`, `low`, `medium`, `high` | none |
| `OpenAIHTTPAgent` | `gpt-5.4-nano` | image, text | text | yes | yes | `none`, `low`, `medium`, `high`, `xhigh` | none |
| `OpenAIResponsesHTTPAgent` | `gpt-5.4-nano` | image, text | text | yes | yes | `none`, `low`, `medium`, `high`, `xhigh` | `apply_patch`, `web_search` |
| `OpenAIResponsesHTTPAgent` | `gpt-5.6-luna` | image, text | text | yes | yes | `none`, `low`, `medium`, `high`, `xhigh`, `max` | `apply_patch`, `web_search` |
| `OpenAIResponsesHTTPAgent` | `gpt-5.6-terra` | image, text | text | yes | yes | `none`, `low`, `medium`, `high`, `xhigh`, `max` | `apply_patch`, `web_search` |
| `OpenAIHTTPAgent` | `deepseek-v4-flash` | text | text | yes | yes | `none`, `high`, `max` | none |
| `OpenAIHTTPAgent` | `deepseek-v4-pro` | text | text | yes | yes | `none`, `high`, `max` | none |
| `OpenAIHTTPAgent` | `zai-org/GLM-5.2:deepinfra` | text | text | yes | yes | n/a | none |
| `OpenAIHTTPAgent` | `deepseek-ai/DeepSeek-V4-Pro:deepinfra` | text | text | yes | yes | n/a | none |
| `LiteLLMAgent` | `openai/gpt-5.4-nano` | image, text | text | yes | yes | `none`, `low`, `medium`, `high`, `xhigh` | none |
| `LiteLLMAgent` | `gemini/gemini-3.1-flash-lite-preview` | image, text | text | yes | yes | n/a | none |
| `LiteLLMAgent` | `xai/grok-4-1-fast-reasoning-latest` | text | text | yes | yes | n/a | none |
| `LiteLLMAgent` | `groq/openai/gpt-oss-120b` | text | text | yes | yes | n/a | none |
| `GeminiAgent` | `gemini-3.1-flash-lite-preview` | image, text | text | yes | yes | n/a | none |

The `Tools` column is a broad provider capability flag. Anima memory tools are
app-layer tools executed by the direct chat runtime when the selected provider
family supports the provider-neutral tool loop. Responses-native tools are
advertised through `native_tool_support`. Hosted `web_search` is observed
through model-client stream metadata; backend-owned memory `apply_patch` calls
are validated and executed by Animama.

## Structured Output Capabilities

`structured_kinds` is internal runtime metadata used by direct chat to decide
whether a provider/model can enforce
`main_structured_response` JSON. The canonical structured kind is
`main_structured_response`, which emits SSE parts with
`response_format="main_structured_json"`. The durable `model_providers` row also
stores backend-internal `structured_output_transport`, currently `json_schema`
or `json_object`, so adapters use the selected persisted row instead of the
in-process catalog helper at request time. This field is not returned by
`/v1/model-providers`.

This kind is allowlisted for:

- `OpenAIHTTPAgent` and `OpenAIResponsesHTTPAgent` on `gpt-5-nano` and
  `gpt-5.4-nano`
- `OpenAIResponsesHTTPAgent` on `gpt-5.6-luna` and `gpt-5.6-terra`
- `OpenAIHTTPAgent` on `deepseek-v4-flash` and `deepseek-v4-pro` through
  `json_object` JSON mode plus local Pydantic validation
- `OpenAIHTTPAgent` on `zai-org/GLM-5.2:deepinfra` and
  `deepseek-ai/DeepSeek-V4-Pro:deepinfra` through the Hugging Face router's
  schema-backed `json_schema` response format
- `GeminiAgent` on `gemini-3.1-flash-lite-preview`
- `LiteLLMAgent` on `openai/gpt-5.4-nano`,
  `gemini/gemini-3.1-flash-lite-preview`,
  `xai/grok-4-1-fast-reasoning-latest`, and
  `groq/openai/gpt-oss-120b` through schema-backed `json_schema`

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

## Reasoning And Native Tool Capabilities

Reasoning and native tool metadata is optional in `MODEL_CATALOG`. Models that
do not declare those fields omit them from the public API payload rather than
returning empty capability lists.

`supported_reasoning_efforts` is normalized using
`REASONING_EFFORT_ORDER = ("none", "minimal", "low", "medium", "high",
"xhigh", "max")`, so frontend controls receive a stable display order. The current
reasoning entries are:

- `gpt-5-nano`: `minimal`, `low`, `medium`, `high`
- `gpt-5.4-nano`: `none`, `low`, `medium`, `high`, `xhigh`
- `gpt-5.6-luna` and `gpt-5.6-terra`: `none`, `low`, `medium`, `high`,
  `xhigh`, `max`
- DeepSeek V4 Flash/Pro: `none`, `high`, `max`

For both GPT-5.6 rows, `none` is first in the normalized list. The frontend
therefore sends `reasoning.effort: "none"` by default when either model is
selected, instead of inheriting OpenAI's omitted-field default of `medium`.

`OpenAIHTTPAgent` and `OpenAIResponsesHTTPAgent` honor request-scoped
`reasoning_effort` values when the selected effort is listed for the active
provider/model pair. `OpenAIResponsesHTTPAgent` sends supported efforts through
the Responses API `reasoning.effort` request field. DeepSeek rows advertise only
DeepSeek's supported values: `none` disables thinking and omits
`reasoning_effort`, while `high` and `max` enable thinking and are sent
literally.

`native_tool_support` lists provider-native tools by stable request name. The
catalog currently advertises `web_search` and `apply_patch` for the official
OpenAI Responses rows `gpt-5.4-nano`, `gpt-5.6-luna`, and `gpt-5.6-terra`.
Runtime turns user-requested
`web_search` into a hosted Responses tool with `search_context_size: "low"`.
`requestable_native_tool_support` contains only `web_search` for those rows.
`apply_patch` is therefore visible as a complete model capability but is not in
the generic request allowlist; the backend enables it only for permitted
direct-memory writes. Catalog serialization and direct-turn validation derive
the requestable list from the same backend policy. The GPT-5.6 entries are
Responses-only; `OpenAIHTTPAgent:gpt-5.4-nano` uses Chat Completions and
advertises neither capability.

## Production Selection

`OpenAIResponsesHTTPAgent` is selectable as a distinct direct OpenAI provider.
Use it when Responses behavior, typed SSE streaming, supported native tools,
and `previous_response_id` continuation are the desired provider boundary.

DeepSeek V4 Flash and V4 Pro are selectable through `OpenAIHTTPAgent` because
DeepSeek exposes an OpenAI-compatible Chat Completions API. Configure
`DEEPSEEK_API_KEY` for those rows. They share the `chat_completions` API
standard with OpenAI Chat Completions rows and are blocked from Responses-backed
chats by the same chat API standard fence. They expose
`supports_developer_role: false`, so direct-chat memory map instructions are
folded into the system instruction instead of sent as `developer` messages.

The Hugging Face rows `zai-org/GLM-5.2:deepinfra` and
`deepseek-ai/DeepSeek-V4-Pro:deepinfra` are also selectable through
`OpenAIHTTPAgent`. They route through `https://router.huggingface.co/v1` and
pin the DeepInfra provider through the model ID suffix. They use `HF_TOKEN`,
falling back to `HUGGINGFACE_API_KEY`, for credentials. They share the
`chat_completions` API standard, omit OpenAI-specific Chat Completions request
fields that the router may reject, omit OpenAI `reasoning_effort`, and keep
provider model IDs exactly as cataloged.

## Resolution And Validation

Catalog validation normalizes provider aliases, verifies that the model exists,
and verifies that the requested provider is listed for that model. Missing,
inactive, or unsupported rows fail setup before a direct model-client call.

This resolver is used by:

- anima chat-profile validation and direct-chat setup
- tests that assert frontend-facing model selector behavior

Unsupported provider/model pairs should fail at validation time instead of
falling through to provider construction.

## LiteLLM Constraints

LiteLLM support is intentionally strict in the current registry. The backend
accepts only the provider-prefixed LiteLLM model aliases listed above. It does
not accept arbitrary LiteLLM model strings through the model selector.

The v1 LiteLLM path does not support proxy/base-url overrides from request
payloads or anima configuration.

## Updating The Catalog

Follow [Adding AI model support](runtime/adding-ai-models.md) when adding or
changing a model, compatible vendor, provider type, or public model capability.
That guide covers the complete catalog-to-frontend flow, database seed
regeneration, adapter and API-standard decisions, pricing limitations, tests,
and live verification.

Do not put provider secrets in `MODEL_CATALOG`. The public serializer omits base
URLs, but secrets should still come from settings or secret storage rather than
from the registry.
