# Adding AI Model Support

This guide explains how model-provider integration is wired from the durable
backend catalog through direct chat and the frontend model selector, then gives
the implementation workflow for adding a model or a provider family.

Use this page together with:

- [Model catalog](../model-catalog.md) for the current supported rows and field
  definitions.
- [Model clients and providers](model-client-providers.md) for detailed runtime
  behavior.
- [Direct chat SSE runtime](chat.md) for the public chat lifecycle.

When a change depends on current vendor behavior, verify the model ID, endpoint,
request fields, reasoning values, tools, context limits, and pricing against the
provider's authoritative documentation before editing the catalog or adapter.
OpenAI changes must follow the repository's `openai-knowledge` workflow.

## Mental Model

Animama separates a selectable model row from the code that calls its provider:

- A **model** is a provider-specific model ID such as `gpt-5.4-nano`.
- A **provider type** is a durable adapter-family identifier such as
  `OpenAIResponsesHTTPAgent`.
- A **model-provider row** is one supported provider/model pair, identified by
  `${provider_type}:${model}`.
- A **model client** is the app-scoped adapter implementation registered for a
  provider type.
- An **API standard** is the persisted chat-transcript compatibility boundary,
  currently `chat_completions` or `responses` for direct OpenAI-compatible chat.

Adding a model to an existing provider type normally adds catalog data, not a
new FastAPI endpoint or a new app-scoped client. For example, adding
`OpenAIResponsesHTTPAgent:gpt-5.6-terra` reuses Animama's existing
`POST /v1/animas/{anima_id}/chat:sse` route and shared OpenAI Responses client.
That client sends the selected row's model ID to OpenAI's `POST /v1/responses`
endpoint.

## End-To-End Integration Map

```text
app/model_catalog.py
    -> serialize provider/model rows
    -> alembic/seeds/01-seed-model-providers.sql
    -> model_providers table
    -> GET /v1/model-providers
    -> generated frontend client + useModelProviders()
    -> chat model selector
    -> PATCH /v1/animas/{anima_id}/chat-profile
    -> POST /v1/animas/{anima_id}/chat:sse with model_provider_id
    -> persisted row resolution and capability validation
    -> app-scoped ModelClient selected by provider_type
    -> provider SDK/API stream
    -> provider-neutral ModelClientDelta stream
    -> DirectChatTurnExecutor parsing, tools, persistence, and domain events
    -> public Animama SSE frames
    -> frontend chat, TTS, emotion, and avatar runtime
```

### Catalog And Database

`src/backend/animama/app/model_catalog.py` is the built-in source of model and
provider metadata. `serialize_model_provider_catalog()` expands it into durable
rows for `model_providers`; `serialize_model_catalog()` creates the safe public
fallback projection.

The generated post-schema seed
`alembic/seeds/01-seed-model-providers.sql` upserts those rows after
Alembic creates the table. `animama.server.db_bootstrap` executes it for both
`reset.sh` and native/packaged bootstrap. Restarting FastAPI alone does not
synchronize a changed Python catalog into an existing database.

`ModelProviderCatalogService` can synchronize repository rows from the Python
catalog, but normal app startup currently relies on the post-schema SQL seed.
The SQL renderer currently lives in `tests/test_model_provider_catalog.py`; if
catalog updates become frequent, extract it into a supported generation script
instead of maintaining another serialization path.

### Public Catalog And Frontend Discovery

`GET /v1/model-providers` reads active database rows and exposes the public
`PyModelProviderCatalogItem` projection. It omits provider credentials, base
URLs, internal structured-output transport, and pricing.

The frontend does not hardcode supported model IDs. `useModelProviders()` calls
the generated API client, and `ChatInputModelSelector` groups returned rows by
provider label. A schema-preserving catalog addition therefore appears in the
selector without a frontend source change or client regeneration.

Selecting a row updates
`anima_chat_profiles.default_model_provider_id` through
`PATCH /v1/animas/{anima_id}/chat-profile`. Accepted sends also include the
same row ID as `model_provider_id` in the `chat:sse` body, so the displayed and
executed selections agree.

### Direct Chat Resolution And Validation

Direct chat resolves the selected row in this order:

1. request `model_provider_id`, when present;
2. the anima chat profile's `default_model_provider_id`.

Before opening the SSE stream, setup verifies ownership and validates that the
persisted row is active and supports streaming, the canonical
`main_structured_response` kind, the requested reasoning effort, requested
native tools, and any active memory tools.

The provider type also supplies `model_client` and `api_standard`. A chat may
switch between rows with the same API standard, but switching between
`chat_completions` and `responses` requires a new chat. The frontend gates this
selection for usability; the backend remains authoritative and returns
`409 chat_api_standard_mismatch` for incompatible turns.

### Provider Invocation And Streaming

`server/model_clients.py` constructs one shared client per registered provider
type. The selected durable row remains request-local and supplies the exact
model ID, provider base URL, capabilities, and pricing metadata.

Adapters translate a provider-neutral `ModelClientRequest` into SDK/API request
fields and stream provider-neutral `ModelClientDelta` values:

- `text_delta` for public assistant text;
- `event` for sanitized provider observations;
- `final` for the authoritative response, usage, metadata, and tool calls;
- `error` for a classified provider failure;
- `done` after successful adapter completion.

Provider event payloads are not forwarded directly to the browser. The direct
turn executor observes and summarizes them, performs bounded app-layer tool
loops, validates the structured main response, persists chat messages and usage,
and emits Animama domain events. The route converts those events into public
SSE frames and owns the single final `run.completed` frame after success-side
effects.

OpenAI Responses chats additionally persist the latest successful response ID
on `chats.openai_previous_response_id`. The next turn normally sends it as
`previous_response_id`; a stale-cursor failure is retried once with locally
replayed history. Successful chat rows also retain `api_standard`,
`last_model_client`, and `last_model_id`, which let the frontend restore the
historical selection when reopening a chat.

## Decide The Change Type First

### Existing Provider Type, New Model

Use this path when the existing adapter already supports the required endpoint,
request shape, stream semantics, structured output, and tools. Typical work is:

1. add a `MODEL_CATALOG` entry;
2. add or update pricing metadata;
3. regenerate the SQL seed;
4. update catalog and validation tests;
5. update documentation and run a live smoke test.

No registry, adapter, route, or frontend code should be necessary when the
public schema remains unchanged.

### Existing Protocol, New Compatible Vendor

An OpenAI-compatible vendor may reuse `OpenAIHTTPAgent` only when its actual
Chat Completions behavior fits that adapter. The catalog row may provide a base
URL, provider label/logo, provider family, API family, developer-role support,
and other capability overrides. Credentials must still come from settings or
secret storage, and `server/model_clients.py` must map the vendor base URL to
the appropriate credential.

Do not label a vendor OpenAI-compatible merely because its payload looks
similar. Verify unsupported request fields, stream chunks, errors, tool calls,
reasoning configuration, structured-output transport, and usage reporting.

### New Provider Type Or API Standard

Add a new provider type when an existing adapter cannot accurately represent
the provider's lifecycle. This is a larger change:

1. implement the provider-neutral model-client contract under
   `adapters/model_clients/`;
2. keep vendor SDK types inside the adapter package;
3. register and close the app-scoped client in `server/model_clients.py`;
4. add credentials, base URL, timeout, and other settings without placing
   secrets in the catalog;
5. decide whether the provider shares an existing transcript standard or needs
   a new `api_standard` mapping;
6. translate structured output, reasoning, tools, usage, errors, retries, and
   terminal stream events explicitly;
7. add focused adapter, registry, direct-turn, route, persistence, and public
   catalog tests;
8. regenerate the frontend client if public schemas change.

Do not expose a catalog row for direct chat until its provider type has a
registered client and a supported API-standard profile.

## Adding A Model To An Existing Provider

### 1. Verify The Provider Contract

Record authoritative answers for:

- exact stable model ID and any dated snapshot;
- supported API endpoints;
- input and output modalities;
- context, maximum input, and maximum output limits;
- streaming and structured-output support;
- function and hosted tool support;
- accepted reasoning efforts and defaults;
- service tiers and short/long-context pricing;
- deprecation or preview status;
- SDK version or event-type requirements.

Prefer an explicit model ID over a moving alias for durable catalog rows unless
following the alias is intentional product behavior.

### 2. Add The Catalog Entry

Add the model to `MODEL_CATALOG` with only verified, Animama-supported
capabilities. A schema-backed reasoning model generally resembles:

```python
"vendor-model-id": {
    "model_metadata": {
        "model_type": "reasoning",
        "current_snapshot": "vendor-model-snapshot",
        "context_window_tokens": 1_000_000,
        "max_output_tokens": 128_000,
    },
    "capabilities": {
        "accepts": _s("text", "image"),
        "produces": _s("text"),
        "supports_tools": True,
        "supports_streaming": True,
        "structured_kinds": MAIN_STRUCTURED_RESPONSE_KINDS,
        "structured_output_transport":
            STRUCTURED_OUTPUT_TRANSPORT_JSON_SCHEMA,
        "supports_reasoning": True,
        "supported_reasoning_efforts": {"low", "medium", "high"},
    },
    "providers": {
        "ExistingProviderType": {
            "base_url": "https://provider.example/v1",
        },
    },
    "pricing": VERIFIED_PRICING,
},
```

Provider attributes override shared model capabilities when one endpoint has a
different feature set. Add multiple provider types only when each path is
intentionally supported and tested; a model being offered by both Responses
and Chat Completions does not require Animama to expose both.

### 3. Model Capabilities Conservatively

Capabilities drive runtime validation and UI controls, so an optimistic value
creates executable behavior rather than harmless descriptive metadata.

- Use `json_schema` only when the selected provider path accepts the schema
  transport the adapter sends.
- Use `json_object` only with explicit JSON prompting and local validation.
- Set `supports_tools` only when the adapter handles the provider's tool-call
  stream and follow-up result format.
- Put a hosted tool in `native_tool_support` only when Animama can request or
  safely execute/observe it through that adapter.
- Update `REQUESTABLE_NATIVE_TOOL_SUPPORT_BY_PROVIDER` only for tools users may
  explicitly select. Backend-owned capabilities such as memory `apply_patch`
  should not become generic request options.
- List only reasoning efforts accepted by the concrete provider/model pair.

The frontend currently treats the first ordered supported reasoning effort as
the model's request default. Ordering is normalized by
`REASONING_EFFORT_ORDER`, so adding `none` causes the UI to explicitly send
`none` even when the provider's omitted-field default is `medium`. If product
defaults must differ from the first supported value, introduce an explicit
`default_reasoning_effort` catalog field across the domain, ORM, public schema,
generated client, and selector instead of relying on set order.

### 4. Add Pricing Without Inventing Precision

Pricing is backend-internal but participates in usage estimates. Populate the
source URL and checked date together with every verified tier. Preserve
trailing decimal precision as strings in the catalog constants.

The current model supports input, cached-input, and output prices for standard,
batch, flex, and priority tiers, plus corresponding long-context rates and a
long-context token threshold. It does not have separate cache-write price
columns or a distinct Fast-mode name. When a provider rate card cannot be
represented faithfully, either:

- mark the missing dimension in `pricing_notes` and document the estimate's
  limitation; or
- extend the domain, ORM, migration, mapper, serializer, estimator, seed, and
  tests before claiming complete pricing support.

Unknown pricing must remain explicitly unpriced, never zero.

### 5. Regenerate And Apply The Seed

Update `alembic/seeds/01-seed-model-providers.sql` from
`serialize_model_provider_catalog()` and run the catalog parity test. Do not
hand-edit only the SQL while leaving the Python source stale.

Apply the new rows locally through the normal stack reset:

```bash
./reset.sh
```

For a named worktree stack, follow the repository's local-stack instructions
and use `reset.sh --name ... --base-port ...`. Do not use an unscoped Compose
reset.

### 6. Update Or Regenerate Frontend Contracts Only When Needed

A catalog-only addition is data and needs no generated client change. If the
public `PyModelProviderCatalogItem`, chat request options, error contract, or
another FastAPI schema changes, regenerate instead of editing
`packages/runtime-contracts/src/generated/**`:

```bash
cd src/frontend
pnpm openapi-ts
pnpm packages:build
```

Update selector logic and tests when introducing a new public capability,
default, grouping rule, or API-standard behavior.

## OpenAI Responses Example: GPT-5.6 Luna, Terra, And Sol

As of 2026-08-08, OpenAI documents these explicit model IDs:

- `gpt-5.6-luna` for cost-sensitive, high-volume work;
- `gpt-5.6-terra` for a balance of intelligence and cost;
- `gpt-5.6-sol` for frontier capability.

The `gpt-5.6` alias routes to Sol, but explicit IDs are clearer durable catalog
keys. All three document a 1,050,000-token context window, 922,000-token maximum
input, 128,000-token maximum output, text/image input, text output, Responses
support, streaming, structured outputs, function calling, prompt caching, and
reasoning efforts `none`, `low`, `medium`, `high`, `xhigh`, and `max`.

Animama currently implements Responses-only product support for Luna and Terra:

```text
OpenAIResponsesHTTPAgent:gpt-5.6-luna
OpenAIResponsesHTTPAgent:gpt-5.6-terra
```

Sol can be added through the same catalog path when the product needs it. The
implemented rows reuse `OpenAIResponsesModelClient`; no new backend or upstream
endpoint is needed. The basic adapter already sends the model ID, strict
`text.format`, `reasoning.effort`, streaming, supported tools, prompt cache
key, `context_management`, and `previous_response_id`.

Advertise only native tools integrated by Animama. Although the models support
additional OpenAI-hosted tools, the existing direct-chat path deliberately
supports requestable `web_search`, backend-controlled memory `apply_patch`, and
provider-neutral function tools. Other hosted tools need explicit request,
stream-event, result, safety, persistence, and UI design before catalog
exposure.

GPT-5.6 defaults omitted reasoning effort to `medium`. Animama intentionally
lists all six efforts with `none` first, so its current selector explicitly
sends `none` for Luna and Terra by default. If a future model needs a different
product default, add a first-class default as described above.

The documented standard short-context token prices per million are:

| Model | Input | Cached input | Cache write | Output |
| --- | ---: | ---: | ---: | ---: |
| `gpt-5.6-luna` | $0.20 | $0.02 | $0.25 | $1.20 |
| `gpt-5.6-terra` | $2.00 | $0.20 | $2.50 | $12.00 |
| `gpt-5.6-sol` | $5.00 | $0.50 | $6.25 | $30.00 |

Requests with more than 272,000 input tokens are billed at twice the input rate
and 1.5 times the output rate for the full request. Batch and Flex rates are
half the corresponding standard rates. OpenAI Fast mode rates are stored in
Animama's existing priority-tier fields. Animama can represent the short/long
input, cached-input, and output rates, but not the distinct cache-write column;
preserve that limitation in `pricing_notes` unless the pricing schema is
extended.

Current OpenAI references:

- <https://developers.openai.com/api/docs/models>
- <https://developers.openai.com/api/docs/models/gpt-5.6-luna>
- <https://developers.openai.com/api/docs/models/gpt-5.6-terra>
- <https://developers.openai.com/api/docs/models/gpt-5.6-sol>
- <https://developers.openai.com/api/docs/guides/latest-model>
- <https://developers.openai.com/api/docs/pricing>

Recheck these sources when implementing the change; model capabilities and
pricing are time-sensitive.

## Tests And Verification

### Catalog And Runtime Tests

At minimum, cover:

- one serialized row per configured provider/model pair;
- exact IDs, labels, logos, API family, and active state;
- public `model_client` and `api_standard` projections;
- structured-output transport and supported kind;
- reasoning effort normalization and validation;
- complete versus requestable native tools;
- short/long-context pricing and explicitly missing rates;
- SQL seed parity with the Python serializer;
- repository sync insertion, update, and retirement behavior;
- adapter request shape and terminal stream behavior;
- direct-turn selection, capability rejection, persistence, and API-standard
  fencing;
- anima chat-profile and `chat:sse` request overrides.

Useful backend validation from the repository root:

```bash
uv run pytest -q \
  tests/test_model_provider_catalog.py \
  tests/test_model_pricing.py \
  tests/test_model_client_registry.py \
  tests/test_direct_chat_turn_executor.py \
  tests/test_anima_chat_profile.py \
  tests/test_anima_chat_sse.py

uv run ruff check
```

When public schemas or frontend behavior changes, also run from
`src/frontend`:

```bash
pnpm openapi-ts
pnpm packages:build
pnpm check
pnpm web:lint
pnpm web:test
```

### Local And Live Smoke Checks

After applying the seed:

1. confirm `GET /v1/model-providers` returns the new active row;
2. select it in the frontend and confirm the anima chat profile persists its
   exact ID;
3. send a turn and confirm the request uses that same `model_provider_id`;
4. verify structured speech/display output, emotion, gesture, optional TTS, and
   exactly one `run.completed` frame;
5. confirm the assistant row stores the exact provider/model snapshot and
   usage;
6. reopen the chat and confirm model restoration;
7. for Responses, confirm `openai_previous_response_id` advances and the next
   turn continues successfully;
8. exercise every advertised reasoning effort and requestable native tool;
9. run an opt-in real-provider smoke for structured output, tools, continuation,
   rate-limit/error classification, and terminal stream handling.

Use `ANIMAMA_LLM_SKIP=1` for local flow checks that must not call providers.
Never use production credentials in tests or commit provider secrets, raw
responses, user content, tool arguments, or sensitive stream previews.

## Common Failure Modes

- **The model is in Python but absent from the UI:** the database seed was not
  regenerated or applied, or the row is inactive.
- **The selector shows the row but send is blocked:** the provider type has no
  supported API-standard profile or the active chat uses another standard.
- **Setup returns 400 before SSE opens:** a persisted capability does not cover
  streaming, structured output, reasoning, native tools, or memory tools.
- **The provider rejects the request:** catalog capability metadata is broader
  than the adapter/provider combination actually supports, or the SDK/request
  translation needs updating.
- **A Responses turn loses continuity:** inspect the chat cursor, terminal
  response ID, incognito/store behavior, stale-cursor retry, and manual-history
  serialization.
- **Costs are missing or misleading:** verify the service-tier mapping,
  long-context threshold, cached-token rates, and any provider pricing
  dimension the current schema cannot represent.
- **A frontend change disappears after regeneration:** generated client files
  were hand-edited instead of changing the FastAPI schema or generator input.
