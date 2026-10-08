# Anthropic models and cache-friendly instruction assembly

Status: Agreed, including the 2026-10-08 scope additions (R5 setting, R11, R12).
Planning clarifications to R4, R6 and R8 await owner confirmation.
Owner decision:

- 2026-10-07: intent discovery agreed the motivation, owner-supplied key,
  provider-scoped default, roles, native-feature policy, catalog, chat fence,
  Memory Manager runtime, refusal presentation, endpoint scope, moderation gap
  and acceptance evidence. These are listed under
  [Open questions and decisions](#open-questions-and-decisions).
- 2026-10-08: the owner chose the Client SDK and Anthropic's native memory tool
  for the Memory Manager, decided the glossary question and accepted this draft
  by invoking execution planning.
- 2026-10-08: execution planning proposed clarifications to R4, R6 and R8 to
  match current behavior. They are marked *Planning clarification* and await
  owner confirmation.
- 2026-10-08: the owner widened the scope:
  - native web search confirmed;
  - a per-model **Compact early** setting, on by default;
  - Anthropic-tuned instructions with per-role effort defaults;
  - cache-friendly instruction assembly for every provider, absorbing #155.

Authoritative source: this draft until `workspace-setup` publishes it.
Source baseline: `1bf91d07`. Planning re-based on `2b546185`.

## Problem and intended users

Every cloud model the local application can run uses OpenAI's protocols: the
built-in OpenAI connection (Responses or Chat Completions) and owner connections
to OpenAI-compatible Chat Completions servers. An installation owner who prefers
Anthropic's Claude models, or already holds an Anthropic API key, cannot use them
natively. Anthropic exposes only a partial OpenAI-compatible endpoint, which lacks
the compaction, server tools and strict schemas Animama's chat depends on. The
product also depends on a single cloud vendor for availability, pricing and
policy.

This change serves the local installation owner by adding Anthropic's Messages
API as a second native cloud provider. It gives owners a choice of vendor and
reduces single-vendor dependence. The default Anthropic model is Claude Haiku 5.5
(`claude-haiku-5-5`), a fast, low-cost model suited to a companion's chat turns.

The way chat instructions are assembled also limits provider prompt caching on
every path ([#155](https://github.com/raymond-van/animama/issues/155)). Content
that changes per chat or per turn sits inside or ahead of stable text. For
providers without a developer role, the per-turn memory map is folded into the
system message, so each turn invalidates the cached prefix. Adding a stateless
provider makes this cost visible on every turn, so this change also
reorganizes instruction assembly for all providers.

## Goals, scope and non-goals

Include:

- An owner-supplied Anthropic API key and a built-in Anthropic model connection
  in the local and desktop compositions.
- Claude Haiku 5.5 as a built-in catalog model, and owner-added rows for other
  Claude model IDs on the Anthropic connection.
- Anthropic models for the chat role (per Anima and the default chat model), the
  Utility role (titles and compaction of other chats) and the Memory Manager role.
- Anthropic-native features where they exist: server-side compaction, the
  `web_search` server tool and strict structured outputs.
- A per-model early-compaction setting that keeps Anthropic prompts below a
  long-context price step.
- Instructions and thinking settings tuned for Anthropic models.
- Instruction assembly ordered for prefix caching on every provider path:
  OpenAI Responses, Chat Completions (including local servers) and Anthropic.
  This absorbs [#155](https://github.com/raymond-van/animama/issues/155): its
  findings and the implementation are delivered here.

Exclude:

- Animama Cloud: its operator allowlist, pricing and cost model are unchanged.
- Amazon Bedrock, Google Cloud Vertex AI, Microsoft Foundry, Claude Platform on
  AWS and custom Anthropic base URLs or gateways.
- Anthropic embeddings. Anthropic offers no embeddings model; the Embeddings role
  keeps its current choices.
- Switching an existing chat between Anthropic and OpenAI models. The chat
  API-standard fence remains.
- Automatic fallback to another model when a Claude model declines a turn.
- Crisis moderation for Anthropic turns (see R10).
- Making Anthropic the application-wide default. OpenAI remains the default chat
  model for new installations.
- Migrating existing installations. Development databases may be reset.
- Changing the Companion Guardrails text, or moving it from last position
  ([ADR 0008](../../adr/0008-non-overridable-companion-guardrail.md)).
- Changing what the Anima is instructed to do. Instruction changes here are
  about ordering, placement and provider-appropriate phrasing only.

## Required behavior

### R1 — Anthropic key and connection

- The owner can enter, replace and remove an Anthropic API key in the same
  places as the OpenAI key: App Settings → API Keys on desktop, and the
  `ANTHROPIC_API_KEY` environment variable for native and Compose stacks.
- On desktop the key is stored in the encrypted desktop vault and applied to
  the running backend without a restart, as the OpenAI key is today. Keys never
  enter the database, logs, API responses or exported data.
- App Settings → Models lists a built-in **Anthropic** connection beside the
  built-in OpenAI connection. It cannot be deleted, and it shows whether a key
  is configured.
- Without a key, Anthropic models stay listed but cannot be selected for a turn.
  A chat whose Anima uses an Anthropic model reports a clear missing-key error
  that names the API Keys setting. It must not fail silently or fall back to
  another provider.

### R2 — Catalog, owner models and defaults

- The built-in catalog contains Claude Haiku 5.5 on the Anthropic connection.
  It declares the capabilities Animama uses: streaming, tool use, strict
  structured output, native web search, native compaction and the effort levels
  the model accepts. It also carries its published pricing, including the
  higher rate above 100,000 prompt tokens.
- The owner can add owner model rows on the Anthropic connection by model ID,
  for example `claude-sonnet-5-5`. As with other owner-added models, they are
  unpriced and their capabilities are probed or declared using the existing
  owner-model flow.
- When the owner chooses the Anthropic connection in a model picker, Claude
  Haiku 5.5 is preselected. The application-wide default chat model and the role
  defaults remain unchanged.
- The owner can hide the built-in Haiku 5.5 row, as with other built-in rows.

### R3 — Chat turns on an Anthropic model

- An Anima whose chat model is an Anthropic model streams the assistant's
  speech, display text, emotional tone, intensity and gesture through the same
  structured response envelope as other models. The envelope is requested with
  Anthropic's strict structured output. The existing local recovery still
  handles malformed or truncated output.
- Streamed text reaches the client incrementally, so speech and avatar
  updates begin before the turn finishes, as on OpenAI models.
- The Anima's reasoning-effort setting controls Anthropic `effort`. Only the
  levels the selected model accepts are offered. The model's thinking is not
  shown as chat text. R12 covers defaults when no effort is set.
- Memory tools available in chat behave as they do on other tool-capable models.
- Requests never send parameters the model rejects: non-default sampling
  parameters, assistant prefill or fixed thinking-token budgets.

### R4 — Conversation continuity and the chat fence

- Anthropic does not store conversations. Each turn sends the chat's
  application-owned history, after any compaction.
- Within a turn, each request resends the previous rounds' content blocks
  exactly as Anthropic returned them, so tool rounds and web-search
  continuations never fail on edited content. That content includes thinking
  blocks, tool calls and results, web search results with their encrypted
  content, and any compaction block.
- Across turns, history replays each completed turn's visible text, its
  memory-tool exchanges and the latest compaction block. This is how
  application-owned history is replayed today. Thinking blocks and raw
  web-search result blocks from completed turns are not resent.
  *Planning clarification, 2026-10-08:* the per-turn context message (memory
  map, attached files, guardrails) is rebuilt each turn and never persisted. A
  replayed thinking block would therefore follow edited content and be rejected
  by the API.
- No request edits content that precedes a thinking block it resends.
- An Anthropic chat records its API standard on its first turn. Choosing an
  OpenAI model for that chat afterward returns the existing API-standard
  mismatch error and guidance to start a new chat. The reverse also applies.
- Incognito turns keep their existing persistence rules. Anthropic does not
  retain conversation state server-side, so incognito needs no provider-side
  storage opt-out.

### R5 — Long conversations

- An Anthropic chat continues beyond the model's context window by using
  Anthropic's server-side compaction. The owner sees the existing indication
  that earlier conversation was summarized.
- Compaction state returned by the API is persisted and resent so that later
  turns continue from the summary.
- An Anthropic model whose pricing has a long-context step has a **Compact
  early** setting in App Settings → Models. Claude Haiku 5.5's step is at
  100,000 prompt tokens.
  - The setting is on by default, and the owner can turn it off per model.
    The choice survives catalog re-seeding.
  - When on, compaction triggers before the step: at 80% of the step, and
    never below Anthropic's 50,000-token minimum. For Haiku 5.5 that is
    80,000 tokens.
  - When off, compaction triggers at Anthropic's default of 150,000 tokens.
    This keeps more history word for word at the higher price.
  - Models without a price step, including unpriced owner-added rows, always
    use the default trigger and show no setting.
- Utility-role pre-send compaction is not applied to Anthropic chats, matching
  how chats with native compaction behave today.

### R6 — Web search

- The shared web-search control governs Anthropic chats as it governs others.
  When web search is enabled and the selected Anthropic model supports it, the
  turn offers Anthropic's `web_search` server tool. When web search is disabled,
  the turn offers no search tool.
- Search results and citations are available to the Anima's response and are
  recorded with the turn, as hosted OpenAI search results are.
  *Planning clarification, 2026-10-08:* the chat does not display sources for
  any provider today. Displaying them is out of scope.
- Search errors returned inside a successful response, such as a usage limit,
  do not fail the turn. The Anima answers without those results.
- Anthropic bills searches to the owner's account. The settings and model
  documentation state this.

### R7 — Utility role

- The owner can choose an Anthropic model for the Utility role. Chat titles and
  pre-send compaction for chats on other providers then run on that model.

### R8 — Memory Manager

- The owner can choose an Anthropic model for the Memory Manager role.
- A Memory Manager run on an Anthropic model reads the same inputs, applies the
  same kinds of memory changes and produces the same observable results and run
  records as a run on an OpenAI model. Covered turns count as covered only once
  the run's changes are applied.
- On an Anthropic model, the run edits memory through Anthropic's memory tool
  (`memory_20250818`). The application executes each tool command against the
  existing database-backed memory filesystem. Read commands run immediately.
  A file creation or edit (`create`, `str_replace` or `insert`) becomes the same
  persisted approval as on OpenAI models. It is fenced by the target file's
  memory version and obeys the same path rules: a Reflection may change only its
  own Anima's `MEMORIES.md`. `delete` and `rename` are refused with a tool error.
  *Planning clarification, 2026-10-08:* the OpenAI Memory Manager can neither
  delete nor rename files, so parity excludes them.
- An approval can be answered long after the run paused. The run then resumes
  from its stored conversation, including the pending tool call, with the
  owner's decision and feedback as the tool result.
- A failed or declined Memory Manager run leaves memories unchanged and reports
  the failure in the same place as other Memory Manager failures.

### R9 — Errors and refusals

- When a Claude model declines a turn (`stop_reason: refusal`), the chat shows a
  visible error state stating that the model declined the message. No partial
  assistant reply is persisted as if it were complete. The owner can send a
  different message. No other model is tried automatically.
- Missing or invalid keys, permission errors, rate limits, overloaded or
  unavailable service, request-size or context errors, and network failures map
  to the existing neutral model-error categories. They use the same chat error
  presentation and retry behavior as OpenAI errors. Messages never include the
  key.
- A response truncated by the output limit is handled as other truncated
  responses are.

### R10 — Safety posture and documentation

- Anthropic rows report crisis moderation as unavailable, as Chat Completions
  rows do. The existing guardrail-only posture for models without moderation
  applies.
- Backend and frontend documentation explains how to add the key, which roles
  and features Anthropic supports, the moderation gap, the chat fence and
  search billing.

### R11 — Instruction assembly for prefix caching (all providers)

- Each provider format may use its own strategy: instruction ordering, what
  history is stored, how it is retrieved and what is sent. Each strategy should
  maximize caching and minimize cost and latency for that provider. The formats
  are:
  - OpenAI Responses, with and without a continuation cursor;
  - Chat Completions, including local servers without a developer role;
  - Anthropic Messages.

  For example, Responses can rely on OpenAI's server-side state where that is
  cheapest. Where a provider caches by prompt prefix, instructions are
  assembled stable-first by how often each part changes:
  1. static for the installation;
  2. per Anima;
  3. per chat;
  4. per turn.

  Within one chat, the cacheable prefix stays byte-identical across turns while
  its inputs are unchanged. *Owner note, 2026-10-08.*
- The Companion Guardrails remain the final instruction text on every path, with
  unchanged wording (ADR 0008). The forced-final and repair requests still
  restate them last.
- The volatile parts are the per-turn memory map, the attachment list, the
  compaction summary and the per-Anima `MEMORIES.md`. Their placement follows a
  written recommendation that classifies every instruction part by volatility
  and describes each path's caching rules:
  - OpenAI automatic prefix caching and `prompt_cache_key`;
  - Anthropic `cache_control` breakpoints;
  - prefix reuse in local servers.

  The recommendation is recorded in the backend runtime docs, which closes
  #155.
- **Owner decision gate:** a recommended layout that departs from ADR 0008's
  described placement needs owner approval before implementation, with ADR 0008
  amended to match. For example, keeping per-turn developer text out of the
  system message for providers without a developer role.
- **Measurement:** use a fixed, scripted multi-turn chat with no personal
  content. For each turn after the first and on each path, compare the share of
  input tokens served from cache before and after the change.
  - The share must not fall on any path.
  - It must rise on paths where layout was the cause.
  - Measurements state model, provider, source revision and method.
- The Anima's instructed behavior is unchanged. Each path receives the same
  instruction content, reordered or re-placed.

### R12 — Instructions and thinking tuned for Anthropic models

- On Anthropic rows, instruction sections follow Anthropic's prompting guidance
  for the selected model. Examples are clearly delimited sections, output
  guidance that matches strict structured output, and no instructions that
  adaptive thinking or structured output make redundant.
- The Anima receives the same directives as on other providers. The Companion
  Guardrails text is identical on every provider.
- Thinking is never displayed. When neither the owner nor the Anima has chosen
  an effort, Anthropic requests use:
  - `low` for chat turns, which favors companion latency;
  - `low` for Utility tasks;
  - `medium` for Memory Manager runs.

  An explicit setting always wins.

## Constraints

- **Local only:** the local and desktop compositions only. The hosted
  composition must not expose Anthropic connections, models or keys, and it must
  keep building and running without them.
- **Repository boundaries:** the Claude API only, called through Anthropic's
  official Python Client SDK (`anthropic`) for both chat and the Memory Manager.
  Do not use an OpenAI-compatible shim for Anthropic, the Claude Agent SDK, or
  any Cloud dependency.
- **Model request rules:** Haiku 5.5 rejects sampling parameters, assistant
  prefill and `budget_tokens`. Its thinking is adaptive and steered by `effort`
  (default `medium`). Its thinking blocks are valid only in the account that
  produced them, and only while earlier content is unchanged. Requests and
  stored history must respect these rules.
- **Tokenizer:** the same text counts as roughly 30% more tokens than on older
  Claude models. Context budgets and cost estimates use counts for the selected
  model.
- **Credentials:** keys follow the existing credential-store and desktop-vault
  rules: never in the database, logs, telemetry or generated clients.
- **Data and API compatibility:** persistence changes update the ORM and
  `alembic/versions/0001_baseline.sql` directly, without new Alembic revisions.
  API schema changes regenerate the frontend client offline.
- **Test mode:** with `ANIMAMA_LLM_SKIP`, Anthropic rows use the deterministic
  mock client and runtime like other providers. No network or key is required.
- **Cost:** Haiku 5.5 costs $0.10/$0.50 per million input/output tokens up to
  100,000 prompt tokens, and $0.50/$2.50 above. Web search costs $10 per 1,000
  searches. Neither must be incurred by automated tests.
- **Companion guardrail:** [ADR 0008](../../adr/0008-non-overridable-companion-guardrail.md)
  stays in force. The guardrail is last, its wording is fixed, and exact-prompt
  tests assert both. Any change to the placement ADR 0008 describes needs the
  R11 owner gate and an ADR amendment.
- **Prior decision reversed:** this reverses the configurable-models exclusion
  of native Anthropic APIs (issue
  [#165](https://github.com/raymond-van/animama/issues/165)). That spec remains
  delivery history and is not edited. The new decision is recorded under
  [Open questions and decisions](#open-questions-and-decisions) and in an ADR.

## Acceptance criteria

Owner acceptance is a live smoke test on desktop with a real Anthropic key. The
repository workflow also requires automated backend tests with a fake Anthropic
transport. These tests cannot establish real model, audio or avatar fidelity.

- [ ] With no Anthropic key, the Anthropic connection shows that no key is set.
      An Anima set to Haiku 5.5 reports the missing-key error naming API Keys.
      Evidence: owner smoke and a backend test.
- [ ] After the key is added in desktop settings, without restarting, an Anima
      set to Haiku 5.5 streams a reply with speech, emotion and gesture, and the
      avatar responds. The key does not appear in the database or logs.
      Evidence: owner smoke, and a test showing the key is absent from persisted
      rows and API responses.
- [ ] A multi-turn Haiku 5.5 chat continues correctly after an application
      restart. Evidence: owner smoke and a replay test that resends stored
      provider content unchanged.
- [ ] Choosing an OpenAI model for an existing Anthropic chat returns the
      API-standard mismatch error. A new chat with that model works. Evidence:
      backend test.
- [ ] With web search enabled, a question about current events produces a
      response grounded in search results, and the sources are recorded with
      the turn. With web search disabled, no search tool is offered. Evidence:
      owner smoke and a request-shape test.
- [ ] A chat that grows past the compaction trigger continues after server-side
      compaction, and the summarized indication appears. Evidence: owner smoke
      at the 50,000-token minimum trigger, and a test that persists and resends
      the compaction block.
- [ ] Haiku 5.5 shows **Compact early**, on by default. Requests use an 80,000
      trigger when it is on and 150,000 when it is off. The choice survives a
      re-seed. Unpriced owner-added rows show no setting. Evidence: backend
      request-shape and seed tests; owner smoke of the setting.
- [ ] With Haiku 5.5 as the Utility role, a new chat receives a generated title.
      Evidence: owner smoke.
- [ ] With Haiku 5.5 as the Memory Manager, a run over covered turns proposes
      memory changes as approvals.
      - Approving a change, including after a backend restart, resumes the run
        and applies the change, which then appears in the memory view.
      - Rejecting a change with feedback resumes the run without applying it.
      - A stale file version, a disallowed path or a failed run leaves memories
        unchanged.

      Evidence: owner smoke, and runtime tests that use a fake transport to
      cover each memory-tool command, approval resume and the version fence.
- [ ] A refusal response produces the visible declined-message error and
      persists no complete assistant reply. Evidence: backend test with a fake
      refusal. A live refusal is not required.
- [ ] An owner-added `claude-sonnet-5-5` row on the Anthropic connection can be
      selected and chats successfully. Evidence: owner smoke.
- [ ] The hosted composition builds and its tests pass, with no Anthropic
      configuration exposed. Evidence: the existing hosted-composition checks.
- [ ] Instruction layout (R11):
      - On every provider path, the Companion Guardrails text is the final
        instruction text and is unchanged.
      - Within a chat, the cacheable prefix is byte-identical across turns
        while its inputs are unchanged.

      Evidence: exact-prompt tests per path.
- [ ] The caching recommendation is recorded in the backend runtime docs, and
      any layout departing from ADR 0008 has owner approval and an ADR
      amendment. Evidence: review; the recorded owner decision.
- [ ] Measured cached-input share on turns 2 and later does not fall on any
      path, and rises where layout was the cause. Paths measured:
      - OpenAI Responses;
      - OpenAI Chat Completions;
      - Anthropic;
      - a local Chat Completions server, when one is available to the owner.

      Evidence: recorded live measurements with model, revision and method.
- [ ] On Anthropic rows, unset effort resolves to `low` for chat and Utility and
      `medium` for the Memory Manager. An explicit setting overrides it.
      Anthropic instruction phrasing passes review against Anthropic's prompting
      guidance without changing directives. Evidence: request-shape tests;
      prompt review; owner smoke of reply quality and latency.
- [ ] Documentation and the ADR are updated per R10 and Constraints. Evidence:
      review.

## Open questions and decisions

Agreed on 2026-10-07 (intent discovery):

- Motivation: owner choice and provider redundancy.
- Credentials: the owner's own Anthropic key, handled like the OpenAI key, for
  the Claude API only.
- Default: Claude Haiku 5.5 is the default within the Anthropic provider only.
  OpenAI stays the application default.
- Roles: chat, Utility and Memory Manager.
- Features: Anthropic-native features wherever they exist (compaction, web
  search, structured outputs).
- Catalog: built-in Haiku 5.5 plus owner-added Claude rows.
- The chat API-standard fence stays. Provider switching requires a new chat.
- Memory Manager: an Anthropic-native runtime beside the existing OpenAI Agents
  SDK runtime, with the same observable behavior.
- 2026-10-08: the Anthropic Memory Manager runtime uses the Client SDK with
  Anthropic's native memory tool (`memory_20250818`). The application executes
  the tool against the database-backed memory filesystem. The Claude Agent SDK
  was considered and rejected for this scope:
  - Its built-in file and shell tools act on the real disk, not the virtual
    memory filesystem.
  - Its sessions are stored outside the database that holds run state and
    approvals.
  - It bundles a native binary of about 236 MB, unpacked, for each platform.

  The Agent SDK remains an option for future agents that work on real files or
  run commands.
- Refusals: a visible error state with no automatic fallback.
- Moderation: the gap is accepted and documented.
- Scope: local application only. Cloud is unchanged.
- Acceptance: an owner live smoke test with a real key.

Decided on 2026-10-08:

- Glossary (owner): extend the "Model connection" entry to say that a
  connection speaks an OpenAI protocol or Anthropic's Messages API. No new
  "Model provider" term is added.
- Planning items 1–5 (in-chat memory tools, compaction mode and trigger, tiered
  pricing, effort levels and the web search version) are resolved or assigned to
  early verification in the
  [ExecPlan's Decision Log](anthropic-model-provider-execplan.md#decision-log).

- Owner, scope additions:
  - Native Anthropic web search for Anthropic rows.
  - A per-model **Compact early** setting, on by default, for models with a
    long-context price step (R5).
  - Anthropic-tuned instructions, with per-role effort defaults: chat `low`,
    Utility `low`, Memory Manager `medium` (R12).
  - Instruction assembly optimized for prefix caching on every provider path,
    absorbing #155 (R11).

Awaiting owner decision at the Phase 2 gate:

- The R4, R6 and R8 planning clarifications above. The owner asked for a clear
  per-provider comparison of today's behavior against the best strategy before
  deciding R4 and the R11 layout.

## Spec

This document. After publication: the owning issue.

## ExecPlan

[anthropic-model-provider-execplan.md](anthropic-model-provider-execplan.md).
It is required because the work is substantial and risky: it spans
persistence, a new provider type, a second Memory Manager runtime and desktop
credentials.

## Delivery links

None yet.
