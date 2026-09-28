# Configurable models execution plan (Plan B: application-owned features)

Status: Drafted for owner review. No phase is authorized yet.
Source agreement: [Configurable models spec](configurable-models-spec.md) R10–R12
and the Plan B acceptance criteria, accepted 2026-09-26, plus the owner
decisions of 2026-09-28 recorded in the [Decision Log](#decision-log).
Authorized scope: none yet. The owner reviews this plan first. Exact-candidate
merge approval stays separate.

This plan delivers spec R10 (pre-send compaction), R11 (web search for any
tool-capable model) and R12 (structured-output handling), and their
documentation. It also fixes three items that
[Plan A](configurable-models-execplan.md) deferred. Plan A (R1–R9, R13) merged
to `main` in PR #191 as merge commit `9cdaab5`.

## Purpose and context

After this plan, on any model with a context window, and within that model's
capabilities:

- **R10:** a long chat on a small-window local model stays usable. Before
  sending, the backend summarizes earlier conversation with the Compaction
  (Utility) role, and the chat shows "Summarizing earlier conversation…".
  If the prompt still does not fit, the oldest messages are left out of that
  request. No prompt larger than the window is ever sent. A turn whose fixed
  instructions plus latest message cannot fit fails with `context_exceeded`.
- **R11:** the owner configures a SearXNG URL or a Brave Search API key.
  - Every tool-capable model can then search the web. OpenAI Responses models
    keep hosted search.
  - The existing per-model "Web search" checkbox turns it on, and explains
    when search is unavailable.
  - The chat shows "Searching the web…" while a search runs.
- **R12:** the structured reply is requested in the strongest form the model
  supports and then checked locally.
  - A reply that fails the check gets one repair request.
  - A reply that still fails becomes plain text, spoken with neutral emotion
    and no gesture, instead of failing the turn.
  - A model saved with structured output "None" can chat.
- **Deferred Plan A items:**
  - the Memory Manager resumes an approval on the model that proposed it;
  - a chunk the embeddings server always rejects stops blocking re-embedding;
  - `gpt-6-luna` turns with cached tokens are priced.

The hosted composition gains no configurable surface. Search-backend management
is local-only, like model connections
([ADR 0011](../../adr/0011-application-owned-companion-features-and-composition-catalog-policy.md)).

The spec is the requirements authority; this plan records how to implement and
verify it.

**Workspace**
- Repository: `raymond-van/animama`.
- Worktree: `../animama-worktrees/configurable-models-features`, on branch
  `feat/configurable-models-features`.
- Starting revision: `9cdaab5` (`main` after the Plan A merge).
- The primary checkout stays on `main`. No Cloud checkout or private input is
  needed.

Follow:

- [SDLC](../../../SDLC.md) and [PLANS](../../../PLANS.md);
- the root, [backend](../../../src/backend/AGENTS.md) and
  [frontend](../../../src/frontend/AGENTS.md) guides;
- [ADR 0003](../../adr/0003-request-local-streamed-chat.md): request-local
  turns and one `run.completed`;
- [ADR 0008](../../adr/0008-non-overridable-companion-guardrail.md): the
  guardrail is the final instruction, including on repair and forced-final
  requests;
- [ADR 0011](../../adr/0011-application-owned-companion-features-and-composition-catalog-policy.md):
  provider-native features are fast paths, and policy is a composition input.

Standing rules (unchanged from Plan A):

- **Schema changes:** no Alembic revisions. Edit the ORM and
  `alembic/versions/0001_baseline.sql` together, and update `BASELINE_SHA256`
  and the table count in `tests/test_alembic_fresh_install.py`.
- **Generated SDK:** regenerate it offline with `pnpm openapi-ts` from Python
  3.12.13. Never hand-edit `packages/runtime-contracts/src/generated/**`.
- **Import boundary:** `animama.app` and `animama.domain` do not import
  `animama.server`, `animama.local` or `animama.runtime`.
- **Secrets and content:** keys, search queries and message content never
  enter logs, and keys never enter the database or API responses. Tests use
  stubbed servers and fake keys.
- **Hosted validation is disabled** (owner, 2026-09-28). Evidence comes from
  full local suites, recorded per phase.

## Progress

- [x] Plan A merged (PR #191, `9cdaab5`).
- [x] Investigation of the compaction, web-search and structured-output code on
      `9cdaab5`, plus keyed-search research (2026-09-28). Findings are under
      Surprises & Discoveries.
- [x] Owner product decisions (2026-09-28): see the Decision Log.
- [x] Plan drafted (2026-09-28).
- [ ] Owner review and authorization of phases.
- [ ] Workspace setup: parent issue, phase issues, spec snapshot update.
- [ ] Phase 1: structured-output handling (R12).
- [ ] Phase 2: pre-send compaction and turn status (R10).
- [ ] Phase 3: web search backends and the application tool (R11, backend).
- [ ] Phase 4: web search settings and control (R11, frontend and desktop).
- [ ] Phase 5: deferred Plan A items.
- [ ] Phase 6: documentation, decisions and acceptance gates.
- [ ] Final integration review.
- [ ] PR and owner merge approval (hosted Validation disabled).

## Surprises & Discoveries

Observed on `9cdaab5` during planning. Backend paths are under
`src/backend/animama/`, frontend paths under `src/frontend/`.

**Structured output (R12)**

- **The reply schema.** `PyMainAgentResponse`
  (`app/main_structured_response.py:49-94`) forbids extra keys and requires
  six fields.
  - An unknown tone becomes `neutral`, and intensity is clamped.
  - An unknown gesture is dropped later. Blank speech raises.
- **"None" still sends a schema.** Chat Completions requests send the strict
  `json_schema` for any transport other than `json_object`, including `None`
  (`adapters/model_clients/openai_chat_completions/request.py:137-143`). Turn
  setup rejects such rows (`app/chat/direct_turn/provider_state.py:110-115`),
  so removing that check alone would still send a schema.
- **Invalid output fails the turn.** A parse failure logs
  `exc_type` and emits `main_structured_response_parse_failed`
  (`app/chat/direct_executor.py:594-613`).
  - No repair is attempted and nothing is persisted.
  - Speech that already streamed stays on the client.
  - A reply wrapped in a markdown code fence also fails.
- **Streaming starts early.** The incremental parser streams speech once the
  first key is `emotional_tone` (`main_structured_response.py:453-633`), and a
  non-JSON reply never streams.
  - The stream emitter resets only the parser between rounds
    (`direct_executor.py:117-124`).
  - So a repair after streamed speech would duplicate text and audio. This is
    why the owner chose to salvage in that case.
- **TTS needs no change** if the fallback is emitted as a structured reply.
  - The needed parts are a hidden neutral tone part plus a `speech` part.
  - This works for both the backend finalized ElevenLabs path
    (`server/routers/chat/tts.py:288-420`, `server/sse_events.py:263-323`) and
    the frontend TTS (`packages/product-ui/src/chat/useProductChatSession.ts:1114-1179`).
- **Replay uses the raw assistant message.** Prompt replay uses
  `raw_provider_message` as it is (`app/chat/openai_prompt.py:458-490`). A
  persisted plain-text reply would therefore teach the model to answer in plain
  text.

**Context and compaction (R10)**

- **When compaction runs.** Post-response compaction runs inside the stream,
  before `run.completed` (`server/routers/chat/chat_sse.py:351`). It triggers
  at a fixed `ANIMAMA_CHAT_COMPACTION_THRESHOLD_TOKENS` (6000) and ignores the
  window (`app/services/chat_compaction_service.py:79-81`).
  - The split keeps the last N messages by count, so it can separate a user
    message from its reply (`:165-171`).
  - Compaction has no overall timeout.
- **Nothing trims before sending.** Only a 200-message history limit exists
  (`app/services/chat_manager.py:124,234`), and no `max_tokens` is sent.
- **Budget inputs.** `max_output_tokens` is null for owner rows. The only
  estimator is about four characters per token
  (`app/model_clients/usage_estimate.py:30-49`), which undercounts CJK text
  badly. tiktoken is not bundled for the server runtime.
- **Where pre-send work can run.** `prepare_turn` runs before the stream opens
  (`server/routers/chat/turn_setup.py:237`), so it cannot show a status.
  Pre-send compaction must run inside the stream.
  - No status event exists today. `safety.ai_notice` is the precedent for a
    route-yielded frame before provider output (`chat_sse.py:228-239`).
  - The pending assistant bubble (`packages/product-ui/src/components/chat-conversation.tsx:70-71`)
    is the natural place for the indicator.
- **The error copy is too narrow.** `chat-failure.ts:125-130` reads
  `details.category`, and a plain setup-error string gets generic copy. The
  current `context_exceeded` copy does not recommend a larger-context model.
- **The Utility model's own window is unchecked.** A compaction request can
  exceed the Utility model's window, because its input is not bounded to it.

**Web search (R11)**

- **Where the control is.** The checkbox sits in each model row's gear popover
  in the chat-input model selector (`web/src/ui/components/chat-input.tsx:691-748`).
  - It appears only when `requestable_native_tool_support` is non-empty. There
    is no disabled state or explanation.
  - It is on by default when the model supports search, and its setting resets
    when the model changes.
  - The request field is `dispatch_options.native_tools: ["web_search"]`.
- **Setup fails the turn.** Turn setup raises when a requested native tool is
  not requestable (`provider_state.py:136-149`).
- **Tools are memory-only.** The one tool registry and dispatcher is
  `app/chat/memory_tools.py`.
  - Tools exist only when memory reads or writes are enabled, so incognito
    turns have none.
  - The loop allows `MAX_MEMORY_TOOL_ROUNDS = 4`. Tool results return errors
    as JSON, and exchanges persist as hidden internal rows that are replayed.
- **No tool-status events.** Hosted `web_search_call` events are only logged
  (`app/model_clients/event_summary.py`).
- **The key fits Plan A's credential namespace.** Owner connection ids are
  `c_<hex>` (`app/services/model_configuration_service.py:210`), so a fixed
  managed name `ANIMAMA_CONNECTION_WEB_SEARCH_API_KEY` cannot collide.
  - It already passes the managed-name pattern in `app/model_clients/credentials.py`.
  - It fits the desktop vault `connections` field and the Compose keys file,
    so no new vault provider is needed.
- **No SSRF filter exists**, deliberately: loopback and LAN hosts are allowed
  for local servers (`normalize_base_url`, `model_configuration_service.py:171-188`).
  SearXNG URLs follow the same rule, so they are local composition only.
- **SearXNG needs the JSON format enabled** in its `settings.yml`
  (`search.formats`); otherwise it answers 403. The Test action and docs must
  say so.

**Keyed search API research** (2026-09-28; sources were official pages, read
through search results because the proxy blocked direct fetches):

- **Brave Search API.**
  - Its single current plan allows feeding results to AI models.
  - Queries are retained for up to 90 days under a data processing addendum,
    and it has an independent index.
  - It uses `GET /res/v1/web/search` with the `X-Subscription-Token` header,
    and returns `title`, `url`, `description` and optional `extra_snippets`.
  - A $5 monthly credit is included, but a card is required.
  - Results may be stored only "transiently".
- **Tavily** needs no card and returns longer content. Its terms let it reuse
  query data, and Nebius agreed to acquire it in February 2026.
- **Exa's** terms grant a perpetual licence to inputs, which conflicts with
  its marketing.

**Deferred items**

- **Memory Manager runs** store only `model_provider` (the type) and
  `model_name` (`orm/memory_manager.py:41-42`), not the row id. A resume after
  a role switch therefore builds the agent from the new role row.
- **`gpt-6-luna` pricing** (secondary sources, 2026-09-28):
  - Cached input is $0.01 per 1M tokens (10% of input).
  - Cache writes are $0.125 per 1M tokens (1.25× input) and are reported as
    `cache_write_tokens` in usage details.
  - Long-context rates are $0.20 input, $0.02 cached and $0.75 output.
  - Nothing in the backend reads `cache_write_tokens` yet, so priced cache
    writes would be undercounted at the input rate.
  - The official pricing pages were blocked by the proxy and need owner
    confirmation (gate G4).

## Decision Log

- **2026-09-26 — Owner:** the spec decisions in
  [Open questions and decisions](configurable-models-spec.md#open-questions-and-decisions).
- **2026-09-28 — Owner, Plan B decisions:**
  - **Keyed search API: Brave Search API.** It is supported beside SearXNG.
  - **Search default.** With a backend configured, the per-model Web search
    checkbox starts on for tool-capable models, as hosted search does today.
  - **Salvage streamed replies (R12).** If speech from an invalid reply has
    already streamed, the parsed parts become the reply. Repair runs only when
    no speech streamed.
  - **"None" models (R12)** get JSON by prompt without `response_format`,
    then one repair, then plain text.
  - **Compaction failure (R10).** If pre-send compaction fails, is unassigned
    or times out, omit the oldest messages, send the turn and log a warning.
  - **Deferred items in scope:** the Memory Manager model pin, the
    always-rejected chunk, and `gpt-6-luna` cached-input pricing (the owner
    asked the agent to look up the rate). Re-embedding after a connection's
    base URL changes stays a documented limitation.
  - **Search status.** A shared status event also shows "Searching the web…"
    for the application tool. Hosted search stays silent.
  - **Validation.** Hosted validation is disabled; rely on full local suites.
- **2026-09-28 — Agent** (planning; implementation choices within the accepted
  scope, revisable during implementation without new product approval):
  - **Phase order:** R12 → R10 → R11. R12 changes the final-reply path that
    R10's budget and R11's tool rounds build on. R10 introduces the status
    event that R11 reuses.
  - **Local validation is lenient where meaning is unambiguous.** The one
    required field is a non-blank `speech` string, found in:
    - a JSON object, after stripping a markdown code fence;
    - or the first JSON object inside surrounding prose.

    Other fields are coerced: unknown or missing tone becomes neutral,
    intensity is clamped (missing becomes the schema default), an unknown
    gesture becomes none, and unknown keys are dropped. This keeps
    repairs for real failures.
  - **Repair is one request without tools.**
    - It contains the invalid assistant text, a developer repair instruction,
      the guardrail last and the same response format.
    - It uses the existing `_model_request_without_tools`, so Responses
      continuation works the same way. It applies to every API.
  - **The plain-text fallback** takes the last round's text.
    - A JSON-looking `speech` value is used if present. Otherwise the text is
      used with code fences removed.
    - Blank text still fails with `main_structured_response_parse_failed`.
    - The reply is emitted as a structured reply (neutral tone, intensity 1,
      no gesture, speech = text), so TTS and history need no new path.
    - The row is marked `data.structured_fallback`.
    - Its replayed `raw_provider_message` is the synthesized valid JSON, so
      history does not teach plain-text replies.
    - The warning log carries ids, transport, category and lengths only.
  - **Budget (R10).**
    - Available = window − reserved output. The reserve is `max_output_tokens`
      when known, else `min(4096, window / 4)`.
    - The estimator counts non-ASCII characters as one token each and ASCII
      at four characters per token, over messages, tools and the response
      schema. It is conservative, offline and has no tokenizer dependency.
    - Pre-send compaction triggers above 90% of available.
    - As a safety net, a server `context_exceeded` before any output trims
      further and retries once.
  - **Post-response compaction becomes window-aware** for models without
    native compaction. It triggers at
    `min(ANIMAMA_CHAT_COMPACTION_THRESHOLD_TOKENS, 0.75 × available)`, so
    small windows usually compact after a reply rather than blocking the next
    turn.
  - **Compaction input** is bounded to the Utility model's own window, and the
    split never separates a user message from its reply.
  - **The pre-send compaction timeout** is an overall
    `ANIMAMA_CHAT_PRESEND_COMPACTION_TIMEOUT_SECONDS`, default 90.
  - **Omission** drops the oldest history items after the summary. A tool call
    and its result go together. Omitted items stay in the database.
  - **Tool rounds within a turn** are bounded:
    - each tool result is truncated to a share of the remaining budget;
    - a round that would exceed the window goes to the existing forced-final
      path.
  - **Status event.** A new SSE frame `run.status`
    `{status: "summarizing_context" | "searching_web", phase: "started" | "finished"}`
    is yielded by the route while the model task runs. The frontend shows its
    text in the pending assistant bubble, and older clients ignore unknown
    frames.
  - **Search configuration** is an installation-wide shared table
    `web_search_settings`, holding one row.
    - Fields: backend (`searxng` or `brave`), SearXNG base URL, credential
      mode/env and timeout.
    - It is managed only through local-composition routes: get, update and
      Test.
    - A composition input (`application_web_search_enabled`, off by default)
      gates the resolver, and runtime capabilities report whether search is
      configured.
  - **Search keys.**
    - Desktop uses the managed vault name `ANIMAMA_CONNECTION_WEB_SEARCH_API_KEY`.
    - Self-hosted web names an environment variable: the managed name or
      `BRAVE_SEARCH_API_KEY`. No other names are allowed, so no unrelated
      secret can be sent.
  - **The application tool** is `web_search(query)`.
    - It returns up to 5 results (title, URL, snippet, date), with snippets
      capped.
    - It is dispatched beside memory tools by a composite tool service, and
      it is available in incognito turns.
    - It shares the existing tool-round limit.
    - Backend failures return a tool error JSON, never a turn failure.
  - **Persisted search results** keep only the query and each result's title
    and URL. Full snippets live only within the turn. This follows Brave's
    transient-storage terms and applies to both backends.
  - **Request field and turn-time checks.**
    - The request field stays `native_tools: ["web_search"]`, meaning "web
      search on".
    - On a Responses row with hosted search it selects hosted search.
      Otherwise it selects the application tool when a backend is configured
      and the model calls tools.
    - If search is unavailable at turn time (for example, the backend was
      removed), the turn runs without search and logs a warning, instead of
      failing setup.
  - **Memory Manager pin:** a run records its model row id at start. A resume
    uses that row while it stays available and suitable. Otherwise the resume
    fails with a clear error that asks the owner to reject or retry, rather
    than building the agent from the new role row.
  - **The always-rejected chunk:** a text that fails alone with a per-text
    category 3 times is recorded with the model id and no vector. The count
    persists with the chunk or passage.
  - **`gpt-6-luna` pricing:**
    - add the $0.01 cached-input rate;
    - parse `cache_write_tokens` from Responses and Chat Completions usage;
    - price cache writes at $0.125 when the rate is known;
    - leave turns with cache writes unpriced when the rate is unknown (never
      priced at the input rate or zero);
    - add long-context and flex rates only if G4 confirms their thresholds and
      values.

## Implementation orientation

Backend (paths under `src/backend/animama/` unless noted):

- **Reply and validation:** `app/main_structured_response.py`,
  `app/chat/direct_turn/response_format.py`,
  `adapters/model_clients/openai_chat_completions/request.py`,
  `app/chat/direct_turn/provider_state.py`, `app/chat/direct_executor.py`
  (the stream emitter, parse, final events and persistence),
  `app/chat/direct_turn/model_stream.py` (`_model_request_without_tools`,
  `_collect_model_final` and the forced final),
  `app/chat/direct_turn/message_builders.py`.
- **Budget and compaction:** `app/model_clients/usage_estimate.py`,
  `app/services/chat_compaction_service.py`,
  `server/routers/chat/compaction.py`, `app/services/chat_manager.py`
  (`get_chat_context`), `app/chat/direct_turn/provider_state.py`
  (`compiled_context_history`), `app/services/model_role_resolver.py`,
  `app/services/direct_model_prompt_runner.py`, `server/config.py`.
- **Stream:** `server/routers/chat/chat_sse.py`, `server/sse_events.py`,
  `server/routers/chat/sse_runtime.py`, `domain/events.py`.
- **Tools and search:** `app/chat/memory_tools.py`,
  `server/routers/chat/session_services.py`, `app/chat/direct_turn/constants.py`,
  `app/model_provider_native_tools.py`, `app/model_catalog.py`
  (native tool fields), `app/model_clients/credentials.py`,
  `server/routers/runtime_capabilities.py` and `server/app.py`
  (`create_local_app`). New modules include `app/web_search/` (port, result
  normalization and tool) and `adapters/web_search/` (SearXNG and Brave
  clients), plus a local-only router.
- **Deferred items:** `app/services/memory_manager_service.py`,
  `adapters/memory_manager/openai_agents_runtime.py`, `orm/memory_manager.py`,
  the re-embedding service and chunk and passage ORM,
  `app/util/model_pricing.py` and the usage normalizers in both model clients.

Frontend (paths under `src/frontend/`):

- **Status and failures:** `packages/product-ui/src/query/mutations/useChatSse.ts`,
  `packages/product-ui/src/chat/useProductChatSession.ts`,
  `packages/product-ui/src/components/chat-conversation.tsx`,
  `packages/product-ui/src/chat/chat-failure.ts`.
- **Search control:** `web/src/ui/components/chat-input.tsx` (gear popover),
  `packages/product-ui/src/lib/chat/model-provider-native-tools.ts`,
  `packages/product-ui/src/lib/chat/chat-sse-request.ts`.
- **Settings:** `web/src/ui/sidebar/ApplicationSettingsModal.tsx`, a new
  `web/src/ui/settings/web-search/*`, and desktop key apply through the
  existing `connections` credential change.

## Setup and execution rules

After owner authorization:

1. **Issues.** Create a new parent issue for Plan B with R10–R12, their
   acceptance criteria, the 2026-09-28 decisions and links to this plan and
   the spec. Create one sub-issue per authorized phase, chained blocked-by.
   Read them back, and record the URLs here and in the spec.
2. **Stack.** Use a named task stack when a running stack is needed, for
   example
   `ANIMAMA_LLM_SKIP=1 ./reset.sh --name cfgfeatures --base-port 8800`, then
   `source .animama-stack.env`. Phases 3 and 5 change the schema and need a
   reset of this task stack only.
3. **Tests.** Work test-first on observable behavior, using fake
   OpenAI-compatible servers, a fake SearXNG and a fake Brave endpoint.
4. **Review and commit.** Before each phase commit, run the affected
   read-only checks and an independent `sdlc-reviewer` review: one full review
   and at most two repair rounds. Commit as `<type>(<scope>)[p#]: <summary>`,
   with scopes `chat`, `search` or `models`.
5. **Stop and report** if blockers remain after the repair budget.
6. **Sequence.** A phase starts when the previous phase's completion
   conditions pass. For UI phases, the agent posts desktop-width and 375 px
   screenshots in chat for the owner.

## Phased implementation

### Phase 1 — Structured-output handling (R12)

Requirements: R12 and the "None" limitation from Plan A. Depends on nothing.
Outcome: every chat model completes turns with a structured reply, a repaired
reply or a plain-text fallback.

1. **Transport.**
   - `json_schema` rows get the strict schema, and `json_object` rows get JSON
     mode plus the schema guidance.
   - `None` rows get no `response_format` plus the schema guidance. Split turns
     do not apply to them.
   - Remove the setup rejection of rows without the structured kind.
2. **Local validation** follows the Decision Log: fences stripped, embedded
   object extraction, coercion, and a non-blank `speech` required. It is shared
   by final parsing and salvage.
3. **Salvage.** If the stream emitter has already emitted speech, build the
   reply from the parsed stream parts and the final text's valid fields. There
   is no repair and no duplicate audio.
4. **Repair.** When nothing streamed and validation fails, send one repair
   request without tools. It streams through the same emitter, with the
   parser reset.
5. **Fallback** after a failed or erroring repair:
   - synthesize the plain-text structured reply, emit the final events (tone,
     speech, no gesture event), persist it with `data.structured_fallback`, and
     log the warning;
   - memory changes committed by tool calls stay.
6. **Usage** sums every request, and `context_tokens` is the last request's
   footprint.

Tests (executor and route):

- A valid reply is unchanged.
- A fenced reply and a reply inside prose both validate.
- Repair succeeds on the second round.
- Repair fails, so the reply falls back to plain text, with:
  - TTS frames;
  - no gesture event;
  - a neutral emotion update;
  - a persisted marker;
  - the synthesized replay message.
- A streamed-then-invalid reply is salvaged without a second request.
- A `None` row sends no `response_format` and completes.
- Blank text still errors with one `run.completed`.
- Memory writes survive a fallback.
- The warning log contains no content.
- Repair on a Responses row keeps continuation.
- The guardrail is last in the repair request.

Checks: focused pytest, `make check-test`, `pnpm openapi-ts:check` if schemas
change, and `pnpm web:test` if the frontend changes.

Completion: tests pass; review has no blocker. Docs:
`docs/backend/runtime/model-client-providers.md` (structured output) and the
local model guide's "chat needs JSON" note.

Phase record: issue —; starting source —; commit —.

#### Code Review #1 Findings

Not yet run.

#### Code Review #1 Revisions

Not yet run.

### Phase 2 — Pre-send compaction and turn status (R10)

Requirements: R10. Depends on Phase 1. Outcome: no over-window prompt is ever
sent on models without native compaction, and the chat shows when it
summarizes.

1. **Budget helper** (shared and pure): available tokens per row, the
   conservative estimator, and a fits/overflow decision for a
   `DirectChatPrompt`.
2. **Pre-send check.** At the start of the model task, inside the stream:
   - Estimate the assembled prompt. When it is over the trigger:
     - yield `run.status summarizing_context started`;
     - compact through the Compaction role, bounded by the timeout and the
       Utility window;
     - reload context and reassemble the prompt;
     - yield `finished`.
   - If it is still over the window, or compaction failed, omit the oldest
     history items and log a warning without content.
   - If the fixed instructions plus the latest message alone exceed the
     window, emit an in-stream `error` with category `context_exceeded`, then
     one `run.completed`. No assistant row is written and chat state does not
     advance.
3. **Within-turn bounds:**
   - tool results are truncated to the remaining budget;
   - an over-budget next round goes to the forced final;
   - one trimmed retry follows a server `context_exceeded` that arrives
     before any output.
4. **Post-response threshold:** window-aware, as in the Decision Log.
5. **Responses rows** are unchanged: native compaction, and no pre-send
   check.
6. **Frontend:**
   - `useChatSse` parses `run.status`;
   - the pending bubble shows "Summarizing earlier conversation…" until output
     or `finished`;
   - the `context_exceeded` copy recommends a model with a larger context
     window or raising the server's window.

Tests:

- Estimator bounds, including CJK text.
- A long chat on a small-window stub compacts first:
  - the status frames come before any `user.response`;
  - every request the stub receives is within budget.
- A failed compaction trims and continues.
- An oversize latest message gives `context_exceeded` with one `run.completed`
  and no row.
- Tool pairs are omitted together.
- A retry follows a server context error.
- Responses rows are untouched.
- The post-response threshold follows the window.
- Frontend reducer and copy tests.

Checks: `make check-test`, `pnpm openapi-ts:check`, `pnpm check`,
`pnpm web:lint`, `pnpm web:test`. A browser check posts screenshots of the
summarizing state.

Completion: tests pass; review has no blocker. Docs: compaction sections in
`model-client-providers.md`, `local-models.md` (windows and summarizing) and
`docs/frontend/runtime/chat.md` (status event).

Phase record: issue —; starting source —; commit —.

#### Code Review #1 Findings

Not yet run.

#### Code Review #1 Revisions

Not yet run.

### Phase 3 — Web search backends and the application tool (R11, backend)

Requirements: R11 (backend). Depends on Phase 2. Outcome: a tool-capable model
on any connection can search through SearXNG or Brave, and failures never
break a turn.

1. **Configuration:**
   - the `web_search_settings` table (ORM plus baseline);
   - a repository, and a service that validates the URL (as for connections)
     and the credential env policy;
   - local-only routes to get, update and Test;
   - the composition input, which only `create_local_app` enables;
   - the runtime capability `web_search: {configured, backend}`.
2. **Adapters** (httpx, per-backend timeout):
   - SearXNG `GET {base}/search?format=json&q=…`, with a clear 403 message
     for a disabled JSON format;
   - Brave `GET https://api.search.brave.com/res/v1/web/search` with
     `X-Subscription-Token`;
   - both normalize to title, URL, snippet and date;
   - errors are categorized (unreachable, rejected credential, rate limited,
     timeout, bad response) without keys or bodies.
3. **Tool:**
   - the `web_search` schema;
   - a composite tool service that dispatches memory and search tools and is
     available without memory tools;
   - tool-error JSON on failure;
   - reduced persistence for replay;
   - `run.status searching_web` around each execution.
4. **Turn gating:**
   - `native_tools: ["web_search"]` resolves to hosted search (Responses rows
     with hosted support) or the application tool (configured backend and
     `supports_tools`);
   - otherwise the turn continues without search and logs a warning;
   - catalog and runtime fields tell the UI whether the application tool is
     available.
5. **No other egress:** queries go only to the configured backend. A test
   asserts no other outbound request.

Tests:

- Adapter tests against stubbed SearXNG and Brave, covering success, 403, 401,
  429, timeout and malformed JSON.
- Route tests for the local-only routes, credential policy, and key absence in
  responses and logs.
- The hosted composition mounts no routes and resolves no backend.
- Executor tests:
  - a Chat Completions model searches and answers;
  - backend failure gives a tool error and the turn completes;
  - an incognito turn has search but no memory tools;
  - the status frames;
  - reduced persistence and replay;
  - the Responses hosted path is unchanged;
  - an unavailable backend runs without search.

Checks: `make check-test`, `pnpm openapi-ts:check`, and a reset of this task
stack.

Completion: tests pass; review has no blocker.

Phase record: issue —; starting source —; commit —.

#### Code Review #1 Findings

Not yet run.

#### Code Review #1 Revisions

Not yet run.

### Phase 4 — Web search settings and control (R11, frontend and desktop)

Requirements: R11 (owner-facing). Depends on Phase 3. Outcome: the owner
configures search in App Settings, and the per-model checkbox works and
explains itself.

1. **App Settings → Web search** (local composition only, hidden unless the
   runtime capability allows it):
   - choose SearXNG (URL) or Brave (key);
   - desktop saves the key through the vault `connections` change, with the
     existing single restart;
   - self-hosted web names the environment variable;
   - Test shows the result category;
   - copy states that queries go to the chosen service.
2. **Model selector:**
   - every chat model row shows the Web search checkbox;
   - it starts on when available;
   - it is disabled, with a reason, when no backend is configured ("Set up web
     search in App Settings") or the model cannot call tools;
   - Responses rows keep hosted search.
3. **Status:** the pending bubble shows "Searching the web…" for
   `searching_web`.
4. **Desktop:** vault tests confirm the managed search key name is accepted
   and removed.

Tests: settings helper and component tests where the suite supports them,
chat-input availability helpers, and desktop vault tests.

Checks: `pnpm check`, `pnpm web:lint`, `pnpm web:test`, `pnpm build`,
`pnpm desktop:check`, `pnpm desktop:test`. A browser check posts screenshots at
desktop width and 375 px.

Completion: tests and browser check pass; review has no blocker.

Phase record: issue —; starting source —; commit —.

#### Code Review #1 Findings

Not yet run.

#### Code Review #1 Revisions

Not yet run.

### Phase 5 — Deferred Plan A items

Requirements: the owner-selected deferred items. Depends on Phase 4 (for a
linear history only; independent in code). Outcome: the three limitations are
fixed.

1. **Memory Manager pin:**
   - `memory_manager_runs.model_provider_id` (ORM plus baseline) is written at
     run start;
   - resume uses it, with the clear error when it is unavailable;
   - the limitation text is removed from
     `memory-manager-and-episodic-memory.md`.
2. **Always-rejected chunk:**
   - a persisted per-text failure count, and recording without a vector after
     3 isolated per-text failures;
   - role status stops reporting `retrying` for that text;
   - `user-files.md` limitation removed.
3. **`gpt-6-luna` pricing:**
   - the cached-input rate;
   - `cache_write_tokens` parsing and pricing, with unknown rates unpriced;
   - long-context and flex rates only after G4;
   - the catalog seed is regenerated and pricing notes updated.

Tests:

- A resume after a role switch uses the pinned row.
- A removed pinned row gives the clear error.
- A chunk that always fails is recorded after 3 attempts, and re-embedding
  completes.
- Cached and cache-write pricing.
- An unknown cache-write rate leaves the turn unpriced.

Checks: `make check-test`, the seed render test, and a reset of this task
stack.

Completion: tests pass; review has no blocker. Gate G4 before merge.

Phase record: issue —; starting source —; commit —.

#### Code Review #1 Findings

Not yet run.

#### Code Review #1 Revisions

Not yet run.

### Phase 6 — Documentation, decisions and acceptance

Requirements: Plan B documentation (spec acceptance "Docs, glossary and ADR are
updated"). Depends on Phases 1–5. Outcome: current docs describe Plan B
behavior, and owner gates are ready.

1. **Backend docs:** `model-client-providers.md` (pre-send compaction,
   structured output, application search), `local-models.md` (windows,
   summarizing, SearXNG setup including the JSON format and Compose host
   access, and the Brave key), `http-api.md` (search routes and `run.status`),
   and the operations docs for the new environment variables.
2. **Frontend docs:** `docs/frontend/runtime/chat.md` (status, search control
   and fallback) and the settings docs.
3. **Glossary:** a term for **pre-send compaction** if review finds the
   existing Model role entry insufficient, and **application web search**.
4. **ADR 0011:** update the Consequences to say Plan B delivered pre-send
   compaction, application web search and structured-output repair, and name
   Brave as the keyed backend with the persistence rule. This follows the
   ADR guide's rule for amendments; a new ADR is not needed unless review
   finds a changed decision.
5. **Spec:** mark the keyed-search question resolved, add the 2026-09-28
   decisions and link this plan and the parent issue.

Checks: docs review, `pnpm prettier:check` for touched docs if applicable, and
link checks where available.

Completion: review has no blocker.

Phase record: issue —; starting source —; commit —.

#### Code Review #1 Findings

Not yet run.

#### Code Review #1 Revisions

Not yet run.

## Final integration review

This review covers the combined Plan B diff against the Plan B acceptance
criteria, reusing still-valid phase evidence. It allows one full review and at
most two repair rounds. Before it runs, merge `origin/main` if it has moved
and run the full local suites on the merged candidate.

## Validation and acceptance

Spec acceptance (Plan B) and its evidence:

| Criterion | Evidence | Phase |
| --- | --- | --- |
| A long local chat compacts before sending, shows summarizing and never sends an over-window prompt | direct-turn and route tests with a small-window stub; G1 | 2 |
| Web search works on a tool-capable local model through SearXNG and Brave, and is unavailable with an explanation otherwise | adapter and tool tests with stubbed backends; G2 | 3, 4 |
| A reply that fails validation and repair completes as plain text with neutral emotion, no gesture and TTS | direct-turn tests | 1 |
| Docs, glossary and ADR updated | review | 6 |

Full local validation before pushing (hosted Validation is disabled):

```bash
uv run pytest -q
uv run ruff check
make check-test
bash -n reset.sh
docker compose -f docker-compose.yml config --quiet
docker compose -f docker-compose.yml -f docker-compose.development.yml config --quiet
```

From `src/frontend`:

```bash
pnpm openapi-ts:check
pnpm check
pnpm web:lint
pnpm web:test
pnpm build
pnpm desktop:check
pnpm desktop:test
```

Owner gates:

- **G1 — Long local chat.**
  - Setup: Ollama or llama.cpp with an acceptance model at a small window
    (for example 4,096), and a local Compaction role.
  - Run a chat until it exceeds the window.
  - Confirm the summarizing indicator appears, replies continue, and server
    logs show no context-length error.
- **G2 — Web search.**
  - On a tool-capable local model, ask a current-events question through a
    local SearXNG, then through Brave with the owner's key (this uses Brave
    credit).
  - Confirm "Searching the web…" appears and the answer cites results.
  - Confirm the checkbox explains itself with no backend configured, and on a
    model without tools.
- **G3 — Fallback, optional.** On a model saved with structured output "None",
  complete turns and observe either emotions or the neutral plain-text
  fallback.
- **G4 — Pricing confirmation.** Confirm the `gpt-6-luna` cached-input
  ($0.01) and cache-write ($0.125) rates, and any long-context threshold and
  rates, from OpenAI's official pricing page. The agent's proxy could not
  reach it.
- **Brave attribution.** Brave's free credit asks the key holder to credit
  Brave Search. Owner choice: whether the About page should say "Web search by
  Brave Search when configured". This does not block the plan.
- Exact-candidate owner merge approval remains separate.

## Idempotence and recovery

- **Schema:** Phases 3 and 5 edit the baseline, so reset only this task's
  named stack (`./reset.sh --name cfgfeatures --base-port 8800 --purge`). Never
  reset the owner's main stack or another task's stack.
- **Pre-send compaction** writes the same `chat_compactions` rows as
  post-response compaction and supersedes the previous one. A failed or
  timed-out compaction writes a `failed` row or nothing, and the turn
  continues with trimming. Omitted messages are never deleted.
- **Search settings:** removing the backend disables the application tool on
  the next turn. The desktop key is removed through the existing batched
  apply.
- **Fallback replies** are ordinary assistant rows with a marker, and later
  turns replay the synthesized JSON.
- **Rollback:** revert the branch. A reverted build needs a stack reset
  because of the baseline changes.

## Outcomes & Retrospective

Not started.
