# Configurable models and local model support

Status: Agreed
Owner decision: 2026-09-26 intent discovery agreed the audience, fully local
operation, two-plan delivery, built-in replacement, template-based model
addition, capability probing, key handling, role defaults, search backends,
degradation, overflow handling, memory-write policy, acceptance servers and
non-goals listed under [Open questions and decisions](#open-questions-and-decisions).
The same day the owner accepted the draft, including the removal behavior (R2),
the summarizing indicator (R10), the shared web-search control (R11) and a
guardrail-only safety posture for non-OpenAI models, by invoking execution
planning.
Authoritative source: this draft (not yet published).
Source baseline: `2064540`.

## Problem and intended users

An Anima's model is fixed by source code. Every selectable model is a row in
`MODEL_CATALOG` that is rendered into an SQL seed and applied by a database
reset, so adopting a newly released model (for example replacing
`gpt-5.6-luna` with a later OpenAI model) needs a code change and a release.

Only OpenAI Responses provides the full companion experience. Chat Completions
providers lack parity because compaction, web search and strict structured
output are provider-native Responses features rather than application
features. Background work is also hard-wired to OpenAI through environment
defaults: chat titles and compaction (`gpt-5-nano`), the memory manager
(`gpt-5.4-mini`, OpenAI Agents SDK) and embeddings (`text-embedding-3-small`).
A desktop owner who wants a private, local companion cannot run one without an
OpenAI key.

Provider credentials are limited to a fixed list of five environment variables
in the desktop vault. Local inference servers such as Ollama, LM Studio and
llama.cpp cannot be configured at all.

Intended users:

- The **installation owner** of the desktop app and the self-hosted web app,
  who chooses providers, models and endpoints for their own installation.
- **Self-host operators**, who configure credentials through their environment.
- The future **hosted** composition is not a user of these features. It keeps an
  operator-fixed model list, and shared code must let it do so.

## Goals, scope and non-goals

Include:

- Owner-managed model connections for any OpenAI-compatible Chat Completions
  endpoint, with presets for common local servers and vendors (R1).
- Owner-added models under any connection, including the built-in OpenAI
  connection, without code changes (R2), with capabilities from a probe or a
  built-in template (R3).
- Model roles for chat, utility, memory manager and embeddings (R4).
- A complete companion turn and a fully local installation on Chat Completions
  models (R5, R6), with clear failures (R7).
- A composition boundary that keeps these features out of the hosted product (R8).
- Replacement of today's non-OpenAI built-ins by presets (R9).
- Application-owned context management, web search and structured-output
  handling that work for any model (R10–R12).
- Current documentation, glossary terms and an ADR (R13).

Delivery is split into two ExecPlans in this directory:

- **Plan A** — R1–R9 and their documentation. Chat Completions models work end
  to end; post-response compaction only and no web search on those models.
- **Plan B** — R10–R12 and their documentation.

Exclude:

- Open Responses or a stateless OpenAI Responses mode for other servers.
  User connections use Chat Completions; Responses remains available through
  the built-in OpenAI connection only.
- Any user-managed connections, models, roles or base URLs in the hosted
  composition.
- TTS and speech-to-text provider configuration.
- Native Anthropic, Gemini or other non-OpenAI-protocol APIs. Such vendors are
  reachable only through their OpenAI-compatible endpoints.
- Changing the chat API-standard fence that prevents one chat from mixing Chat
  Completions and Responses turns.
- Migrating existing installations. The product is in development without
  users; development databases may be reset.
- Pricing for owner-added models. They are explicitly unpriced.

## Required behavior

### R1 — Model connections

- In App Settings, the owner can add, edit and remove a **model connection**:
  a name, an OpenAI-compatible Chat Completions base URL, an optional credential
  and compatibility options.
- Adding a connection offers presets that fill defaults: Ollama, LM Studio,
  llama.cpp, vLLM, DeepSeek, Hugging Face router and Custom. Presets differ only
  in defaults; every connection uses the same protocol behavior.
- Compatibility options cover known server differences: whether `developer`
  messages are folded into the system message (on by default for non-OpenAI
  connections), whether OpenAI-specific request fields such as strict function
  flags are omitted, and where private reasoning output appears. Private
  reasoning is never shown, spoken or persisted as reply text.
- The built-in OpenAI connection remains, supports both Responses and Chat
  Completions, and cannot be removed.
- Credentials:
  - Desktop: each connection's key is stored in the existing encrypted vault,
    is write-only, is never read back and applies with the existing single
    local-service restart.
  - Self-hosted web: a connection names an environment variable that the
    operator sets in their secrets environment file.
  - A connection may have no credential. Keys are never stored in the database,
    returned by an API or logged.
- The owner can list the models a connection reports through `/v1/models` and
  pick one, or type a model ID.
- Each connection has a request timeout, defaulting higher for local presets
  because a first request may load a model.

### R2 — Owner-added models

- The owner can add a model under any connection by model ID and display
  label. For example, a newly released OpenAI model can be added under the
  built-in OpenAI connection and chosen for an Anima without a code change,
  seed regeneration or database reset.
- Built-in models are read-only and updated by releases. The owner may hide a
  built-in model. A release never modifies or removes an owner-added model.
- When adding a model, the owner may copy capabilities from a built-in model
  ("like gpt-5.6-luna"), run the probe (R3) or set them manually, and can edit
  them later.
- Owner-added models appear in the chat model selector, App Settings default
  chat model and role pickers like built-in models.
- Owner-added models are unpriced. Usage is still recorded; cost estimates
  report them as unpriced, never zero.
- Removing a model or connection that an Anima or role uses requires
  confirmation naming what uses it. Affected roles fall back to their defaults
  (R4); affected Animas show the model as unavailable and ask the owner to
  choose another before the next turn. Existing chats and messages keep their
  recorded model snapshot.

### R3 — Capability probe

- A "Test" action checks one model with a small number of bounded requests and
  reports each result: reachable and authorized, streams text, returns
  schema-constrained JSON, and calls a function tool. It states that it sends
  requests to the endpoint.
- Results prefill the model's capabilities; the owner can override any of them.
  A capability the probe did not confirm is off unless the owner turns it on.
- Context window is required before a model can be used for chat or utility
  work. It is filled automatically when the server reports it and is otherwise
  entered by the owner. The UI explains that local servers often use a smaller
  window than the model supports.
- Probe failures show the server's error category without exposing credentials.

### R4 — Model roles

- The owner assigns a model to each role in App Settings:
  - **Chat default** — the existing App Settings default chat model for new
    Animas. Each Anima still selects its own chat model.
  - **Utility** — chat titles and compaction.
  - **Memory manager** — the existing memory manager model setting, which now
    accepts any tool-capable model from any connection.
  - **Embeddings** — the embedding model used for uploaded-file and archive
    search, from a connection that serves `/v1/embeddings`.
- Utility and memory manager default to the installation's default chat model.
- Embeddings are off until the owner selects a model. While off, search uses
  the existing keyword retrieval.
- Changing the embeddings model re-embeds existing content. Until re-embedding
  finishes, search uses keyword retrieval and the setting shows progress.
  Vectors from different embedding models are never compared.
- Environment variables continue to provide system defaults for operators.

### R5 — Companion turns on Chat Completions models

A turn on a Chat Completions model provides the same companion behavior as an
OpenAI Responses turn, within the model's capabilities:

- structured speech and display text, emotion, gesture and TTS;
- memory read tools when tool calling is on, and memory write tools unless the
  owner disabled writes for that model, subject to existing write validation
  and recoverable mutations;
- title generation and post-response compaction through the utility role;
- the Companion Guardrails as the final instruction text (ADR 0008);
- persisted messages with the provider/model snapshot and usage. When a server
  reports no usage, token counts are estimated and marked as estimates.

Turns with tool use and a structured final reply work on models that support
tool calling and structured output separately, even when the server cannot
combine a schema and tools in one request.

### R6 — Fully local installation

When every role and the Anima's chat model use local connections and no OpenAI
key is configured, an installation supports chat, titles, compaction, memory
tools, the memory manager and search without any request to OpenAI or another
remote provider. Features whose required role is unassigned degrade as R4
describes instead of calling a hidden default.

### R7 — Errors and recovery

- Setup errors return before streaming, as today. Stream failures end the turn
  with an error event and exactly one `run.completed`.
- The chat error names the connection and the category: unreachable, rejected
  credential, unknown model, timed out or context exceeded. It suggests the
  likely fix (for example "Is Ollama running?"). No key or raw provider body is
  shown or logged.
- A failed turn persists no assistant message and does not advance chat state.

### R8 — Composition boundary

- Connection, model, role and probe management exist only in the local
  composition (desktop and self-hosted web). The hosted composition does not
  expose those routes or settings and serves an operator-fixed list of built-in
  models.
- User-supplied base URLs are accepted only in the local composition, where
  every admitted request is the installation owner.

### R9 — Built-in catalog changes

- DeepSeek and Hugging Face router models become presets (R1); their built-in
  rows are removed.
- The Gemini and LiteLLM provider families and their rows are removed. Direct
  chat cannot use them today.
- The built-in OpenAI rows remain.

### R10 — Context-window-aware compaction (Plan B)

- Before sending a turn to a model without provider-native compaction, the
  backend compares the prompt estimate plus the reserved output budget with the
  model's context window.
- Over the threshold, it compacts synchronously with the utility role before
  sending. The chat shows that earlier conversation is being summarized. If the
  prompt still exceeds the window, the oldest visible messages beyond the
  summary are omitted from the request (not deleted).
- A prompt that would exceed the window is never sent. If the fixed
  instructions and latest message alone exceed it, the turn fails with a
  context-exceeded error that recommends a larger-context model or window.
- OpenAI Responses models keep provider-native compaction.

### R11 — Web search for any tool-capable model (Plan B)

- The owner can configure a search backend: a SearXNG URL, or one keyed search
  API chosen by the research task below. Keys follow R1 credential handling.
- The existing web-search control enables search for any tool-capable model.
  A model without native web search receives an application web-search tool;
  OpenAI Responses models that support hosted web search continue to use it.
- Web search is unavailable for a turn when no backend is configured or the
  model lacks tool calling, and the control explains why.
- Search queries leave the device only to the configured backend. Backend
  failures return a tool error to the model rather than failing the turn.

### R12 — Structured-output handling (Plan B)

- Models whose probe confirmed schema-constrained output receive the schema.
  Others use JSON mode with local validation.
- An invalid final reply gets one repair attempt. If that also fails, the turn
  completes with the model's plain text as the reply, spoken by TTS, with
  neutral emotion and no gesture. The event is logged as a warning without
  message content. Memory changes already committed by tool calls in that turn
  remain.

### R13 — Documentation and decisions

- Backend and frontend docs describe connections, models, roles, the probe,
  local-server setup (including reaching host servers from Docker Compose) and
  degraded behavior.
- The glossary defines **model connection** and **model role**.
- An ADR records that companion features are application-owned with
  provider-native fast paths, and that catalog policy is a composition input.

## Constraints

- **Security.** No credentials in the database, API responses, logs or
  diagnostics. Owner-supplied endpoints only in the local composition.
- **Safety.** The guardrail remains the final instruction on every provider.
  Crisis-card detection depends on OpenAI Responses moderation under the
  companion safety baseline and is unchanged: turns on other models, including
  fully local installations, have the guardrail but no crisis card.
- **Data.** No Alembic revisions during development; update the baseline and
  seed directly. Built-in seeding must not modify owner-added rows.
- **Contracts.** Generated API clients are regenerated, never hand-edited.
  Shared backend code takes catalog policy as a composition input so the hosted
  composition can supply a fixed list without Cloud imports.
- **Networking.** Desktop reaches local servers on loopback. Self-hosted Docker
  Compose containers need the host address rather than `localhost`.
- **Performance.** The probe and synchronous compaction are bounded by
  timeouts. Pre-send compaction adds latency only to turns that need it.
- **Pricing.** Unknown pricing is never treated as zero.

## Acceptance criteria

Plan A:

- [ ] Adding a new OpenAI model ID from a built-in template under the built-in
  OpenAI connection makes it selectable and usable for a turn without a code
  change or reset. *Evidence:* backend tests; browser check.
- [ ] Owner-added connections and models survive a restart and a release seed;
  hidden built-ins stay hidden. *Evidence:* seed and repository tests.
- [ ] Keys are write-only in both editions and absent from the database, API
  responses and logs. *Evidence:* tests; desktop vault test; log inspection.
- [ ] The probe reports each capability and prefills editable values.
  *Evidence:* adapter tests with stubbed servers; manual run against each
  acceptance server.
- [ ] With no OpenAI key, on each of Ollama, LM Studio and llama.cpp, one Anima
  completes turns with speech, emotion, gesture, TTS, memory read and write,
  a generated title, post-response compaction, a memory manager run and
  embedding search, with no request to OpenAI. *Evidence:* owner manual
  verification recording server versions and models; backend test asserting
  no OpenAI client use when roles are local.
- [ ] Unreachable server, rejected key, unknown model and timeout each produce
  the specified error with one `run.completed` and no assistant row.
  *Evidence:* route tests.
- [ ] Changing the embeddings model re-embeds content and never mixes vector
  spaces; search stays available through keyword retrieval meanwhile.
  *Evidence:* service tests.
- [ ] The hosted composition exposes no connection, model, role or probe routes.
  *Evidence:* composition test.
- [ ] Gemini, LiteLLM, DeepSeek and Hugging Face built-ins are gone and their
  presets work. *Evidence:* catalog tests; one preset smoke check.

Plan B:

- [ ] A chat on a local model whose history exceeds its window compacts before
  sending, shows the summarizing state and never sends an over-window prompt.
  *Evidence:* direct-turn tests; manual long-chat check.
- [ ] Web search works on a tool-capable local model through SearXNG and the
  chosen keyed API, and is unavailable with an explanation otherwise.
  *Evidence:* tool tests with stubbed backends; manual check.
- [ ] A reply that fails validation and repair completes as plain text with
  neutral emotion, no gesture and TTS. *Evidence:* direct-turn tests.
- [ ] Docs, glossary and ADR are updated. *Evidence:* review.

## Open questions and decisions

Agreed on 2026-09-26:

- Fully local operation is required; no hidden OpenAI calls.
- Two ExecPlans: Plan A (R1–R9), Plan B (R10–R12).
- DeepSeek and Hugging Face become presets; Gemini and LiteLLM are removed.
- Built-in models are read-only templates; owner-added models are separate rows
  and are never overwritten by releases.
- Capabilities come from a probe with manual override.
- Keys: desktop vault per connection; self-hosted web by environment variable
  reference; none in the database.
- Utility and memory manager inherit the default chat model; embeddings are off
  until chosen, and changing them re-embeds.
- Web search: SearXNG plus one keyed API; OpenAI Responses keeps hosted search.
- Invalid structured output degrades to a plain-text reply after one repair.
- Context overflow compacts before sending, then trims.
- Memory writes are allowed when tool calling is on, with per-model opt-out.
- Manual acceptance on Ollama, LM Studio and llama.cpp; vLLM is supported by the
  generic connection but not an acceptance gate.
- Non-goals as listed above.
- Removing an in-use model or connection falls back roles and marks affected
  Animas' model unavailable (R2).
- Synchronous compaction shows a summarizing indicator (R10).
- The existing web-search control also enables the application search tool
  (R11).
- Non-OpenAI models, including fully local installations, keep the guardrail
  without a crisis card.
- Acceptance models: `qwen3.5:4b-mlx` or `gemma4:e4b-mlx`, or the same model
  in the format each server loads (owner, 2026-09-26).

Open:

- **Keyed search API** — bounded research comparing Brave, Tavily and Exa on
  terms for application use, free tier, result format and privacy. Blocks R11
  only.

## Spec

This document before publication.

## ExecPlan

- Plan A (R1–R9): [configurable-models-execplan.md](configurable-models-execplan.md)
  (draft for owner review).
- Plan B (R10–R12): `configurable-models-features-execplan.md`, to be written
  after Plan A merges.

## Delivery links

None yet.
