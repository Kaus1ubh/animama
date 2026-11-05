# 0011: Application-owned companion features and composition catalog policy

The restriction of hosted owner role choices below is superseded by
[ADR 0017](0017-common-web-application-and-hosted-artifact.md). The admitted
catalog, provider custody and companion design remain applicable.

- Status: accepted
- Recorded: 2026-09-27
- Retrospective: no
- Original decision date: 2026-09-26 (owner decisions during configurable-models discovery)
- Decision basis: owner decisions in the accepted spec for [configurable models](https://github.com/raymond-van/animama/issues/165)
- Amended: 2026-09-30, Consequences updated for Plan B delivery (owner
  decisions of 2026-09-28, including Brave as the keyed search backend; the
  result-storage rule is an agent implementation decision recorded in the
  Plan B ExecPlan)
- Amended: 2026-11-03, each stored key is bound to its own origin (owner,
  [issue #838](https://github.com/raymond-van/animama/issues/838)).

## Context

Every selectable model was a row in a code-defined catalog, seeded by a database
reset, so adopting a new model needed a release. The full companion experience
depended on OpenAI Responses features: server-side conversation state and
compaction, hosted web search and strict structured output. Background work was
also fixed to OpenAI: titles and compaction, the Memory Manager (Responses via
the Agents SDK) and embeddings. A desktop owner could not run a private, local
companion, and local servers such as Ollama, LM Studio and llama.cpp could not
be configured.

[ADR 0001](0001-independent-local-product-and-packaged-sharing.md) requires
shared code to take explicit composition inputs. The future hosted composition
keeps an operator-fixed model list, so owner configuration cannot be a
security-changing mode flag in shared code.

## Decision

**Companion features are application-owned, with provider-native fast paths.**
The application implements each part of a companion turn so that it works on
any OpenAI-compatible Chat Completions model:

- memory tools are function tools, offered only when the model calls tools
  and write tools only when the model may write memory;
- tool rounds and the structured final reply are split when a model cannot
  combine tools with a response schema;
- the Utility role compacts after a response, using estimated usage when a
  server reports none;
- failures are classified into provider-neutral categories that name the
  connection;
- the Memory Manager runs on Chat Completions with an approval-gated function
  tool;
- the Embeddings role embeds and re-embeds stored content, and search uses
  keywords until vectors from the chosen model exist.

Provider-native features (Responses conversation state and compaction, hosted
web search, strict schemas) stay in use where the model supports them. They are
fast paths, never prerequisites. Each model row carries capabilities, from a
built-in template or a probe, and the turn degrades to what the model can do
instead of failing. In Plan A a chat model still needs streaming, JSON output
and (for owner rows) a context window.

**Catalog policy is a composition input.** Shared services receive a
`ModelCatalogPolicy` (owner models enabled, optional built-in allowlist), and
the role resolver receives whether owner role choices apply, which the server
derives from that policy; owner models are off unless a composition enables
them. Only the local composition enables
owner connections, owner models, App Settings roles and their management
routes. A hosted composition supplies its fixed list and operator defaults
without Cloud imports.

**Keys stay outside the database.** Connections store only a credential mode
and an environment variable name. Desktop keeps the value in its encrypted
vault; self-hosted operators set the variable themselves. A key that an owner
connection names goes only to its own origin: a provider key to its provider's
API, and a connection key to the origin saved with it (recorded by the vault
when the key is entered, or set by the operator as
`ANIMAMA_CONNECTION_<NAME>_ORIGIN`), never over plain HTTP to another
computer. The built-in OpenAI connection keeps the operator's
`OPENAI_BASE_URL`.

## Alternatives

- **Require OpenAI for background work.** Keeps one code path, but rules out a
  fully local installation, which was a primary goal.
- **Open Responses or a stateless Responses mode for other servers.** Few local
  servers implement it; Chat Completions is the common protocol. The built-in
  OpenAI connection keeps Responses.
- **A proxy layer such as LiteLLM.** Adds a large dependency and a second
  configuration surface; direct chat could not use the existing LiteLLM rows,
  which were removed.
- **A local/hosted mode flag in shared code.** Contradicts ADR 0001 and the
  local HTTP boundary; an explicit policy object keeps the hosted default safe.

## Consequences

- Two model APIs stay supported; turn, Memory Manager and error tests cover
  both.
- Capabilities are owner-declared or probed. A wrong declaration surfaces as a
  categorized failure, not silent misbehavior.
- Plan A gave Chat Completions models post-response compaction only and no web
  search. Plan B adds the application-owned paths: pre-send compaction that
  keeps every request within the model's context window, an application
  `web_search` tool, and local structured-output validation with one repair
  and a plain-text fallback, so a chat model no longer needs JSON output.
  OpenAI Responses models keep native compaction and hosted search as fast
  paths.
- Application web search uses one installation-wide backend: SearXNG or the
  Brave Search API. Its settings, like model connections, are local
  composition only. Chat history keeps only the query and each result's title
  and URL for both backends: Brave allows only transient storage of results,
  and one rule keeps replay the same for SearXNG.
- Crisis-card detection still relies on OpenAI Responses moderation. Turns on
  other models keep the [companion guardrail](0008-non-overridable-companion-guardrail.md)
  as the final instruction, without the crisis card.
- A hosted composition must pass its policy explicitly to expose anything
  beyond built-in rows.

## Evidence

- [`app/services/model_provider_catalog_service.py`](../../src/backend/animama/app/services/model_provider_catalog_service.py):
  `ModelCatalogPolicy`.
- [`app/services/model_role_resolver.py`](../../src/backend/animama/app/services/model_role_resolver.py)
  and [`server/model_roles.py`](../../src/backend/animama/server/model_roles.py):
  role resolution and its composition settings.
- [`server/app.py`](../../src/backend/animama/server/app.py): the local
  composition enables owner models and mounts management routes.
- [`adapters/model_clients/openai_chat_completions/`](../../src/backend/animama/adapters/model_clients/openai_chat_completions/):
  Chat Completions turns, probe and embedder.
- [`app/web_search/tool.py`](../../src/backend/animama/app/web_search/tool.py)
  and [`app/chat/direct_turn/context_fit.py`](../../src/backend/animama/app/chat/direct_turn/context_fit.py):
  Plan B application web search and pre-send context fitting.
- [`app/model_clients/error_categories.py`](../../src/backend/animama/app/model_clients/error_categories.py):
  provider-neutral error categories.
- [`tests/test_model_configuration_api.py`](../../tests/test_model_configuration_api.py)
  and [`tests/test_model_roles.py`](../../tests/test_model_roles.py):
  only the local composition mounts management routes and applies owner roles.
- [`tests/test_fully_local_roles.py`](../../tests/test_fully_local_roles.py) and
  [`tests/test_model_error_categories.py`](../../tests/test_model_error_categories.py):
  fully local operation and error categories.
