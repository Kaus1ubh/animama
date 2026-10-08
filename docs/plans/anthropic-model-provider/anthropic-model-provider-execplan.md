# Anthropic model provider and cache-friendly instructions execution plan

Status: In progress. All phases authorized by the owner's `/implement` on
2026-10-08. The explicit gates remain:

- Phase 1 live spend, already authorized;
- the Phase 2 owner decision;
- the Phase 9 owner live smoke.

Source agreement: [spec](anthropic-model-provider-spec.md), published as parent
issue [#364](https://github.com/raymond-van/animama/issues/364) on 2026-10-08.

- **2026-10-08 acceptance:** the owner accepted the spec by invoking execution
  planning.
- **2026-10-08 scope additions:**
  - native web search;
  - the per-model **Compact early** setting (R5);
  - instruction assembly for prefix caching on every provider, absorbing #155
    (R11);
  - Anthropic-tuned instructions and effort defaults (R12).
- **Decided at the Phase 2 gate, not yet:** the R4, R6 and R8 planning
  clarifications, marked in the spec.

Authorized scope: phases 1–9, by the owner's `/implement` on 2026-10-08.
Exact-candidate merge approval stays separate.

Starting source: `2b546185` (`origin/main`, 2026-10-08), checkout
`worktrees/animama/anthropic-model-provider`, branch
`feat/anthropic-model-provider`.

## Purpose and context

After this plan, an installation owner on desktop or a self-hosted local stack
can add an Anthropic API key. They can run Claude Haiku 5.5, or an owner-added
Claude model, for chat, Utility or Memory Manager work. Those models use
Anthropic-native features:

- strict structured output;
- server-side compaction, with a per-model **Compact early** setting;
- the `web_search` server tool;
- the memory tool;
- instructions and effort defaults tuned for Anthropic.

Separately, every provider path assembles turn instructions stable-first, so
provider prefix caches survive from turn to turn. The Companion Guardrails stay
last and unchanged.

OpenAI stays the application default. Animama Cloud, the cloud-platform
endpoints and Anthropic embeddings are out of scope.

Ownership and boundaries:

- **Backend** (`src/backend/animama/`): provider type, catalog, credentials,
  prompt assembly, the chat adapter and the Memory Manager runtime.
- **Frontend** (`src/frontend/`): desktop key delivery, App Settings and chat
  failure copy.
- **Rules:**
  - The generated client is regenerated offline, never hand-edited.
  - Persistence changes go into the ORM and `alembic/versions/0001_baseline.sql`,
    with no new Alembic revisions.
  - API calls go through the official `anthropic` Python Client SDK only. Do not
    add the Claude Agent SDK or an OpenAI-compatible shim.
  - ADR 0008 (guardrail last, fixed wording) stays in force.

## Progress

- [ ] Phase 1: Live contract verification, SDK and cache baseline. Not
      started. Provider gate.
- [ ] Phase 2: Caching findings and layout recommendation. Not started.
      Owner decision gate.
- [ ] Phase 3: Provider identity, connection, credentials and catalog. Not
      started. May run while the Phase 2 gate is pending.
- [ ] Phase 4: Cache-friendly instruction assembly for every provider. Not
      started. Waits for the Phase 2 gate.
- [ ] Phase 5: Chat turns on Anthropic models. Not started.
- [ ] Phase 6: Native web search and compaction. Not started.
- [ ] Phase 7: Utility role and the Anthropic Memory Manager runtime. Not
      started.
- [ ] Phase 8: Desktop key, App Settings and chat UI. Not started.
- [ ] Phase 9: Documentation, ADR, measurements and owner live smoke. Not
      started. Owner acceptance gate.
- [ ] Final integration review.

## Surprises & Discoveries

Planning, 2026-10-08, code at `2b546185` and Anthropic's documentation unless
stated:

- **Models API capabilities.** A free Models API call for `claude-haiku-5-5`
  reported:
  - 1,000,000 input and 128,000 output tokens;
  - effort `low` to `max`;
  - thinking `adaptive` and `disabled` supported, `enabled` (budget) not
    supported;
  - `compact_20260112` and context editing;
  - structured outputs, citations, and the web search and code execution
    server tools.

  The owner's key was used in-process, at the owner's direction, and was not
  stored, printed or logged. The key has since been placed in the owner-only
  secrets file.
- **Threshold compaction** (`compact-2026-01-12`): the trigger minimum is
  50,000 input tokens and the API default is 150,000. The summary arrives as a
  single `compaction_delta`. The client must resend the compaction block; the
  API ignores what precedes it. Haiku 5.5 carries no thinking across a
  compaction.
- **Haiku 5.5 price step:** above 100,000 prompt tokens, input rises from
  $0.10 to $0.50 and output from $0.50 to $2.50 per million tokens.
- **Memory tool:** the API injects an "always view your memory directory first …
  record progress" instruction. `create` may overwrite. Paths are absolute under
  `/memories`, while application memory paths are relative and end in `.md`.
- **Instruction layout today** (`app/chat/openai_prompt.py:85-194`):
  - The order is system, then the compaction summary as developer text, then
    history, then one trailing developer message, then the latest user message.
  - The system message holds the core instruction, identity, `MEMORIES.md`,
    memory guidance, response guidance and per-request gesture descriptors.
  - The trailing developer message holds the memory map, attachments and
    `COMPANION_GUARDRAILS` (`app/safety/prompts.py:11`). It is rebuilt every
    turn and never persisted.
  - For rows without a developer role, all developer text is folded into the
    system message, so the system prefix changes every turn.
  - Responses sends system and developer text together as `instructions`.
  - `prompt_cache_key` comes from `scoped_prompt_cache_key`
    (`app/model_clients/prompt.py:134`).
- **Assistant history rows** store only final text. No reasoning, compaction or
  hosted-search items are stored, and hosted citations are never shown to the
  client.
- **Compaction indicator:** native Responses compaction emits no client
  indicator. Only app pre-send compaction emits `run.status
  summarizing_context`.
- **Cost estimation:** `estimate_model_token_cost` has no production caller and
  ignores the long-context fields, although those fields exist on catalog rows.
- **Memory Manager:**
  - The router always builds the OpenAI Agents runtime
    (`server/routers/memory_manager.py:121-142`).
  - Approvals cover create and update only; the Manager cannot delete or rename.
- **Built-in connection:** `is_builtin_openai` and the catalog serializers
  hard-code the OpenAI connection.
- **Desktop release gate:** new Python dependencies change the license
  inventory hash in `src/frontend/desktop/runtime/release-policy.json`, so owner
  re-review is required before release.
- **Base drift:** fast-forwarded from `1bf91d07` to `2b546185` with no changes
  in the affected areas.

## Decision Log

- **D1 (2026-10-08, owner):** accepted the spec. Extend the "Model connection"
  glossary entry rather than adding a new term.
- **D2 (2026-10-08, owner):** the Anthropic Memory Manager uses the Client SDK and
  the native memory tool. The Claude Agent SDK was rejected.
- **D3 (planning):** ordinary chat memory tools on Anthropic rows keep their
  strict function-tool form.
- **D4 (2026-10-08, owner; replaces the earlier proposal):** compaction uses
  threshold `compact_20260112`.
  - `pause_after_compaction` is false, and turns are never re-inserted.
  - The trigger comes from the row:
    - with **Compact early** on (the default, offered only on rows with a
      long-context price threshold), the trigger is
      `max(50_000, floor(0.8 × threshold))`, which is 80,000 for Haiku 5.5;
    - otherwise it is 150,000.
  - There is no environment setting. The OpenAI Responses threshold is not
    reused.
- **D5 (planning):** Haiku's tiered pricing populates the existing long-context
  fields (threshold 100,000; $0.50 input, $0.05 cached, $2.50 output). The
  estimator's tier gap is recorded, not fixed.
- **D6 (planning):** Anthropic efforts are `none`, `low`, `medium`, `high`,
  `xhigh` and `max`.
  - `none` sends `thinking: {type: "disabled"}`.
  - Any other effort omits `thinking` and sets `output_config.effort`.
  - Phase 1 must confirm that real `tool_use` blocks still appear with thinking
    disabled. If they do not, `none` is withheld.
- **D7 (2026-10-08, owner):** Anthropic rows use Anthropic's native `web_search`
  server tool, never the application Brave or SearXNG tool. Phase 1 picks the
  version.
  - Prefer `web_search_20260318` (dynamic filtering, with
    `response_inclusion: "excluded"`).
  - Use basic `web_search_20250305` with `allowed_callers: ["direct"]` if
    dynamic filtering's median latency is more than 30% higher on three fixed
    prompts, or if it fails with structured output.
- **D8 (planning; spec R4 clarification):** within a turn, prior rounds' content
  blocks are resent exactly. Completed turns replay visible text, memory-tool
  exchanges and the latest compaction block, without thinking or raw search
  blocks.
- **D9 (planning, superseded by the Phase 2 layout decision):** the interim
  Anthropic placement of per-turn context is:
  - a mid-conversation `system` message as the last entry, if Phase 1 confirms
    Haiku 5.5 accepts it;
  - otherwise a leading text block in the latest user message.
- **D10 (planning):** identifiers.
  - Provider type `AnthropicMessagesHTTPAgent`.
  - API standard and model client `anthropic_messages`.
  - Connection and preset `anthropic`; the preset is not owner-selectable.
  - Row `AnthropicMessagesHTTPAgent:claude-haiku-5-5`.
  - Credential variable `ANTHROPIC_API_KEY`.
- **D11 (planning):** a selector chooses the Memory Manager runtime by the
  provider type of the resolved or pinned row, for both start and resume. The
  Anthropic runtime drives its own Client SDK loop, because approvals pause and
  later resume from persisted state.
- **D12 (planning):** a refusal is error code `model_refused` (category
  `provider_error`) with its own chat copy. The `stop_details` category is
  stored in error details.
- **D13 (planning):** credentials. The key is in
  `$HOME/.config/animama/dev-secrets.env`; the owner confirmed it on
  2026-10-08.
  - Host live tests use `uv run --env-file`, and stacks use `COMPOSE_ENV_FILES`.
  - Agents never copy, source or print a `.env` or the secrets file.
- **D14 (planning):** the Anthropic logo ships only with recorded provenance and
  license, under the provider-logo rules. Otherwise the connection shows a
  label only.
- **D15 (planning):** the default `ModelCatalogPolicy` exposes only
  OpenAI-connection built-ins. Anthropic built-ins need the local policy or an
  explicit allowlist.
- **D16 (2026-10-08, owner):** when no effort is chosen, Anthropic requests use
  `low` for chat, `low` for Utility and `medium` for Memory Manager runs.
  Explicit settings win.
- **D17 (2026-10-08, owner):** this plan absorbs #155. Its findings land in the
  backend runtime docs, and the delivering PR closes #155.
- **D18 (2026-10-08, owner):** each provider format may have its own strategy
  for instruction ordering, history storage, retrieval and sending, chosen to
  maximize caching and minimize cost and latency. For example, Responses relies
  on OpenAI server state.
  - The Phase 2 gate presents a clear per-provider comparison of today's
    strategy against the recommended one, for Responses, Chat Completions and
    Anthropic Messages.
  - The owner decides R4 (D8), R6 and R8 at that presentation, together with
    the layout.
  - Until then, D8 is the working assumption, and only phases independent of it
    proceed.

## Implementation orientation

Backend paths are under `src/backend/animama/`; tests under `tests/`.

- **Prompt assembly:**
  - `app/chat/openai_prompt.py` (order :85-117, fold :165-194, system text
    :133-162)
  - `app/chat/memory_context.py`
  - `app/model_clients/prompt.py` (`DirectChatPrompt`, `scoped_prompt_cache_key`)
  - `app/safety/prompts.py`
  - `app/chat/direct_turn/model_stream.py` (forced-final and repair restatement
    :1128-1134)
  - Responses `request.py:47-90`; Chat Completions `request.py:40-143`
  - Tests: `test_companion_guardrail.py`, `test_companion_safety_chat.py`,
    `test_direct_chat_model_clients.py`, `test_direct_chat_turn_executor.py`,
    `test_direct_chat_structured_recovery.py`
- **Provider identity:**
  - `app/chat/api_standard.py`
  - `orm/chats.py:21-30` and `alembic/versions/0001_baseline.sql:378-379`
  - `utils/type_helpers.py:126-139`
  - `server/schemas/model_configuration.py:129,207`
  - `app/chat/direct_turn/constants.py`
  - `app/model_provider_native_tools.py`
  - `adapters/mappers/model_provider_map.py:256-262`
- **Catalog and connections:**
  - `app/model_catalog.py`
  - `app/model_connection_presets.py`
  - `domain/model_connection.py`
  - `orm/model_connection.py`
  - `orm/model_provider.py`
  - `app/services/model_configuration_service.py`
  - `server/routers/model_configuration.py`
  - `app/services/model_provider_catalog_service.py`
  - `app/services/model_role_resolver.py`
  - seed `alembic/seeds/01-seed-model-providers.sql`, generated by
    `tests/test_model_provider_catalog.py`
- **Credentials:**
  - `app/model_clients/credential_store.py`
  - `app/model_clients/credentials.py`
  - `server/runtime_credentials.py`
  - `server/routers/desktop_control.py`
  - `docker-compose.yml:86-90`
- **Model clients:**
  - `app/model_clients/types.py`
  - `server/model_clients.py`
  - `adapters/model_clients/openai_responses/` (pattern)
  - `adapters/model_clients/mock.py`
  - `app/model_clients/error_categories.py`
- **Direct chat:**
  - `app/chat/direct_executor.py`
  - `app/chat/direct_turn/`
  - `app/main_structured_response.py`
  - `app/chat/memory_tools.py`
  - `app/services/chat_manager.py`
  - `adapters/repositories/sqlalchemy/chat_message_repo.py:231`
  - `server/routers/chat/compaction.py`
- **Utility:**
  - `app/services/direct_model_prompt_runner.py`
  - `chat_title_generation_service.py`
  - `chat_compaction_service.py`
- **Memory Manager:**
  - `app/ports/memory_manager_runtime.py`
  - `adapters/memory_manager/openai_agents_runtime.py` (parity reference)
  - `adapters/memory_manager/fake_runtime.py`
  - `adapters/memory_patch.py`
  - `app/services/memory_manager_service.py`
  - `app/services/anima_identity_memory.py`
  - `app/services/user_memory_read_tools.py`
  - `app/services/memory_entry_service.py`
  - `server/routers/memory_manager.py`
- **Frontend** (`src/frontend/`):
  - `shared/desktop-runtime.ts`
  - `desktop/src/main-process/runtime/vault.ts`
  - `web/src/ui/settings/DesktopCredentialsPanel.tsx`
  - `web/src/ui/settings/models/`
  - `web/src/ui/components/model-selector.tsx`
  - `web/public/provider-logos/`
  - `packages/product-ui/src/chat/chat-failure.ts`
  - provider-type constants in `web/src/app/local-runtime/setup/setup-state.ts`
    and `web/src/lib/chat/model-catalog.ts`

## Setup and execution rules

When implementation is authorized:

1. Workspace setup is done (2026-10-08):
   - parent #364, with phase issues #365–#373 as sub-issues and blocked-by
     links;
   - #155 is linked as absorbed;
   - the branch was pushed at `ed3a1863` (spec and plan).
2. Offline work uses a named task stack:

   ```bash
   ANIMAMA_LLM_SKIP=1 ./reset.sh --name anthropic --base-port 8820
   source .animama-stack.env
   ```

   Check `docker ps` for port conflicts first. Schema changes reset this stack
   only.
3. Live work:
   - Tests:

     ```bash
     ANIMAMA_RUN_LIVE_TESTS=1 uv run --env-file "$HOME/.config/animama/dev-secrets.env" pytest -q tests/live/<file>
     ```

   - Stacks: set
     `COMPOSE_ENV_FILES="$HOME/.config/animama/dev-secrets.env,$PWD/.env"`.
   - Never copy, source or print secret files.
4. Work test-first. Offline tests use duck-typed fake SDK clients with scripted
   stream events, never keys or the network.
5. If a worktree venv resolves to Python 3.14, run `uv sync --python 3.12.13`
   before `pnpm openapi-ts`.
6. Before each phase commit:
   - Run the phase's checks.
   - Get an independent `sdlc-reviewer` review: one full initial review and at
     most two repair rounds.
   - Commit as `<type>(<scope>)[p#]: <summary>`, with scope `models`, `chat`,
     `prompts`, `memory` or `settings`.

   Stop and report blockers left after the repair budget.
7. Phases run in order. The exception: Phase 3 may proceed while Phase 2's owner
   gate is pending, and Phase 4 waits for that gate.

## Phased implementation

### Phase 1: Live contract verification, SDK and cache baseline

Requirements: constraints for R3–R8, and R11 measurement. Decisions: D6, D7, D9.

Outcome:

- The `anthropic` SDK is locked.
- An opt-in live contract test records the Haiku 5.5 behaviour later phases rely
  on.
- A repeatable cache-measurement harness records the **before** cached-input
  share for every provider path.

No product behaviour changes.

**Gate:** live calls with the owner's Anthropic and OpenAI keys, authorized by
the owner on 2026-10-08. Budget: under US$0.50 per full run of both live files.
That includes at most six web searches and one compaction request of about
55,000 tokens.

1. Add `anthropic>=1.12,<2`, then run `uv lock`. Confirm that `httpx2`
   coexists with `httpx` and that mypy accepts the SDK types.
2. Add `tests/live/test_anthropic_messages_contract.py`. It is skipped unless
   `ANIMAMA_RUN_LIVE_TESTS=1` and the key are set, and it prints only
   non-sensitive measurements. It checks that:
   1. A streamed request with a cached system block, effort `low` and no
      sampling parameters streams text.
   2. With thinking disabled, a strict tool still produces a `tool_use` block
      (D6).
   3. The real main structured-response schema works in `output_config.format`
      alongside strict memory tools, and the streamed JSON parses.
   4. A mid-conversation `system` message as the last entry is accepted (D9).
   5. A tool round that resends prior content with its thinking succeeds, and a
      next turn without earlier thinking succeeds (D8).
   6. Basic and dynamic web search on three fixed prompts with structured
      output. Record median latency, input tokens, `pause_turn` and block
      shapes (D7).
   7. Compaction with a 50,000 trigger on about 55,000 tokens. Record the event
      sequence, block, resend and usage `iterations`.
   8. The memory tool with an in-memory handler: observe the first call and
      whether a manager instruction stops it writing progress notes.
   9. Cache reads appear on a repeated request, and the minimum cacheable prefix
      for Haiku 5.5 is recorded.
   10. An invalid key raises `AuthenticationError`, and an unknown model raises
       `NotFoundError`.
3. Add `tests/live/test_prompt_cache_layout.py`, the measurement harness.
   - It drives the real prompt assembly with a fixed synthetic Anima:
     - non-personal identity and `MEMORIES.md`, sized above every provider's
       cache minimum;
     - a memory map that changes each turn;
     - one attachment.
   - The chat is a scripted six-turn conversation.
   - It sends the conversation through the real adapters for:
     - OpenAI Responses without a cursor, and Responses with a cursor;
     - OpenAI Chat Completions, using the built-in model with the developer
       role and again with developer text folded;
     - Anthropic, through a minimal direct mapping of the current layout.
   - When `ANIMAMA_LOCAL_CHAT_BASE_URL` is set, it also covers a local Chat
     Completions server.
   - It reports cached-input share per turn, model, revision and method, and
     records no content.
4. Record the results under this phase. Finalize D6, D7 and D9, and record the
   baseline table.

Checks: `uv lock --check`, `make check-test`, and both live files.

Completion: live checks pass or each deviation is decided; the baseline is
recorded; review leaves no blocker.

Phase record: issue #365; starting source —; commit —.

#### Code Review #1 Findings

#### Code Review #1 Revisions

### Phase 2: Caching findings and layout recommendation

Requirements: R11 (findings and recommendation), closing #155's investigation.

Outcome: a backend runtime doc describes, for every provider path:

- its caching rules;
- a volatility map of every instruction part;
- the recommended layout.

The owner approves the layout before Phase 4.

1. Write `docs/backend/runtime/prompt-caching.md`.
   - **Per-path rules:**
     - OpenAI: automatic prefix caching, its minimum length and
       `prompt_cache_key`.
     - Responses with a cursor: instructions are resent on each request.
     - Anthropic: breakpoint placement, minimum, lookback, and the effect of
       system edits.
     - Local servers: KV prefix reuse.
   - **Volatility classes** (installation, Anima, chat, turn), covering:
     - core instruction and response guidance;
     - gesture descriptors;
     - identity and `MEMORIES.md`;
     - memory guidance flags and the memory map;
     - attachments;
     - compaction summary;
     - guardrails;
     - forced-final and repair text.
   - The Phase 1 baseline.
2. Recommend the layout. The expected direction, to be confirmed by evidence:
   - System text holds only installation-stable and Anima-stable parts.
     Gesture descriptors are made per-installation stable or moved later.
   - Chat-scoped text (the compaction summary) follows the history.
   - Turn-scoped text (the memory map and attachments), then the guardrails,
     comes last, after the latest user message where the provider allows:
     - Anthropic: a mid-conversation `system` message.
     - OpenAI developer role: a trailing developer message.
     - Rows without a developer role: a trailing tagged block, instead of
       folding into the system message.
   - `MEMORIES.md` stays in system text if it changes rarely within a chat.
     Otherwise it moves to turn-scoped text. Decide from how often the tool
     edits it.
   - Name each provider's cache controls: breakpoints, `prompt_cache_key`
     scope.
3. **Per-provider strategy (D18).** For each provider format (Responses, Chat
   Completions and Anthropic Messages), compare today's strategy with the
   recommended one, covering:
   - instruction ordering;
   - what is stored per turn;
   - how history is retrieved;
   - what is sent each request: full history, cursor, or cache breakpoints;
   - expected cached share, cost and latency.

   Include the Anthropic storage and replay choice (R4/D8), sources (R6) and
   Memory Manager delete/rename parity (R8).
4. **Owner decision gate.** Present the comparison as a clear side-by-side page
   for the owner. Note where it departs from ADR 0008's described folding for
   rows without a developer role.
   - Record the owner's decisions on the layout, R4, R6 and R8 in the Decision
     Log and the spec.
   - If the decision departs from ADR 0008, draft the ADR 0008 amendment for
     Phase 9.

Checks: the doc reviews against the code paths it describes. Run no live calls
beyond Phase 1 data unless the recommendation needs a targeted comparison;
those count against the Phase 1 budget.

Completion: the doc is reviewed and the owner decision is recorded.

Phase record: issue #366; starting source —; commit —.

#### Code Review #1 Findings

#### Code Review #1 Revisions

### Phase 3: Provider identity, connection, credentials and catalog

Requirements: R1 (backend), R2, the R4 fence constants, and R5 setting
persistence.

Outcome: the backend has:

- the Anthropic provider type and API standard;
- a built-in `anthropic` connection reading `ANTHROPIC_API_KEY`;
- the Haiku 5.5 row, Anthropic owner rows and a Models-API probe;
- a persisted **Compact early** flag.

Turns on Anthropic rows run only under `ANIMAMA_LLM_SKIP` until Phase 5.

1. **Identity.**
   - Add the D10 constants and the `chat_api_standard_for_provider_type`
     profile.
   - Extend both `chats` CHECKs in the ORM and baseline SQL, and update
     `BASELINE_SHA256`.
   - Update the literal lists, the mapper and
     `DIRECT_MEMORY_TOOL_SUPPORT_BY_PROVIDER`.
   - Map Anthropic to `{"web_search"}` in
     `REQUESTABLE_NATIVE_TOOL_SUPPORT_BY_PROVIDER`.
   - Add the "Anthropic" label and logo key.
2. **Connections.**
   - Replace "is built-in" uses of `is_builtin_openai` with a built-in set of
     `openai` and `anthropic`. Keep OpenAI-only rules explicit.
   - Add preset `anthropic`, not owner-selectable, and seed its connection row.
   - Catalog serializers take the connection from each row.
3. **Catalog.**
   - The Haiku 5.5 entry:
     - limits 1,000,000 / 128,000, text and image input;
     - tools, streaming, the main structured kinds with `json_schema` transport,
       and `tools_with_structured_output`;
     - D6 efforts and `native_tool_support={"web_search"}`;
     - pricing $0.10 / $0.01 cached / $0.50, batch at half, and D5
       long-context fields.
   - Add `model_providers.early_compaction` (boolean, default true) to the ORM,
     baseline SQL, domain, mapper and schema. Seed upserts preserve it, like
     `hidden`.
   - Regenerate the seed SQL.
4. **Credentials.**
   - `ANTHROPIC_API_KEY` joins the known and deliverable sets.
   - The resolver maps the `anthropic` connection only to it.
   - Compose passes `ANTHROPIC_API_KEY: ${ANTHROPIC_API_KEY:-}` to
     `animama-server`.
5. **Owner rows and probe.**
   - Anthropic type ⇔ `anthropic` connection.
   - Anthropic built-ins may serve as templates.
   - `adapters/model_clients/anthropic_messages/probe.py` maps
     `models.retrieve` into the probe summary:
     - limits and efforts;
     - disabled thinking;
     - structured outputs;
     - web search.
   - The probe route allows the `anthropic` connection.
   - Add an endpoint or field update so the owner can set `early_compaction` on
     Anthropic rows that have a long-context threshold. Reject it elsewhere.
6. **Policy, roles and registry.**
   - Apply D15.
   - Anthropic rows are eligible for chat, Utility and Memory Manager, never
     Embeddings.
   - The mock is registered under skip.
7. Regenerate the client offline (`pnpm openapi-ts`) and fix the type fallout
   for `pnpm check`.

Tests:

- Catalog and seed parity.
- Idempotent re-seed that preserves `hidden` and `early_compaction`.
- Owner-row validation and templates.
- Probe mapping.
- Credential isolation.
- Missing-key state.
- Default policy hides Anthropic built-ins.
- Role eligibility.
- Startup without the key.
- A mock-mode turn records `anthropic_messages`.
- The `early_compaction` update is accepted only on eligible rows.

Checks:

- `make check-test`
- `uv lock --check`
- `bash -n reset.sh`
- both `docker compose … config --quiet` commands
- `pnpm check`

Completion: tests and checks pass; review leaves no blocker.

Phase record: issue #367; starting source —; commit —.

#### Code Review #1 Findings

#### Code Review #1 Revisions

### Phase 4: Cache-friendly instruction assembly for every provider

Requirements: R11 (implementation and OpenAI-path measurements). It depends on
the Phase 2 owner decision.

Outcome: Responses and Chat Completions turns use the approved layout. Within a
chat, the cacheable prefix is byte-identical across turns while its inputs are
unchanged. The guardrails are still last, with unchanged wording, on every path.

1. Tag instruction parts by volatility class, so each provider strategy can
   order and place them as approved (D18).
   - Responses: `instructions` and trailing developer input, plus its approved
     cursor and storage behavior.
   - Chat Completions: system and developer roles, or the approved fallback for
     rows without a developer role.

   Keep shared assembly code where strategies coincide. Do not add a layer that
   no strategy needs.
2. Apply the approved placement for `MEMORIES.md`, gesture descriptors, the
   compaction summary, the memory map and attachments.
   - The forced-final and repair rounds restate the guardrails last.
   - Keep `prompt_cache_key` scoping per the recommendation.
3. Keep instruction content unchanged: same text, new positions. Update the
   exact-prompt tests to the new layout, and add stability tests.
4. Rerun the Phase 1 harness for the OpenAI paths and record the **after**
   numbers.

Tests:

- Per path:
  - the guardrails are the final instruction text and byte-identical to
    `COMPANION_GUARDRAILS`;
  - the system and cacheable prefix are identical across two turns with a
    changed memory map;
  - a `MEMORIES.md` edit changes only what the recommendation says it may.
- Forced-final and repair rounds end with the guardrails.
- Rows without a developer role follow the approved fallback.
- Every existing safety, structured-recovery and executor test passes.

Checks:

- `make check-test`
- live `test_prompt_cache_layout.py` for the OpenAI paths, within budget

Completion: tests pass; the OpenAI share does not fall and rises where layout
was the cause; review leaves no blocker. If a path regresses, revise the layout,
or return to the owner when the fix needs a different placement.

Phase record: issue #368; starting source —; commit —.

#### Code Review #1 Findings

#### Code Review #1 Revisions

### Phase 5: Chat turns on Anthropic models

Requirements: R3, R4, R9 and R12 (chat), with D3, D6, D8, D12 and D16.

Outcome: an Anima on an Anthropic row streams structured replies, using the
Phase 4 layout and Anthropic-tuned phrasing. It runs memory function tools
across rounds and replays after a restart. It keeps the fence and surfaces
refusals and errors. App pre-send fitting still applies until Phase 6.

1. **Adapter** `adapters/model_clients/anthropic_messages/`:
   - `client.py` (one SDK client per credential);
   - `request.py`;
   - `events.py`;
   - `final.py`;
   - `errors.py`.

   Register the client in `server/model_clients.py`.
2. **Request mapping.**
   - Layout parts map to Anthropic positions per the Phase 2 decision: stable
     system blocks with `cache_control`, a breakpoint on the last replayed
     history message, and turn-scoped text plus guardrails last.
   - Memory tools: `{name, description, input_schema, strict: true}`, with
     `tool_choice: auto` and `disable_parallel_tool_use: true`.
   - Structured output goes in `output_config.format`.
   - Effort per D6 and D16. Chat with no setting uses `low`.
   - `max_tokens` is the row's output limit capped by the per-turn limit.
   - Never send sampling parameters or a prefill.
3. **Anthropic-tuned phrasing (R12).**
   - Add Anthropic variants of the non-guardrail instruction sections. Follow
     Anthropic's "Prompting Claude Haiku 5.5" guidance: delimited sections,
     output guidance matched to strict structured output, and no instructions
     made redundant by structured output or adaptive thinking.
   - Variants keep each directive. A test asserts a shared list of directive
     markers appears on both providers.
   - The guardrails stay byte-identical.
4. **Rounds within a turn.**
   - `ModelClientContinuation.cursor` carries the turn's Anthropic messages
     exactly as returned.
   - Forced-final and repair rounds append their instruction in the turn-scoped
     position with the guardrails last, and set `tool_choice: none`.
5. **Persistence and replay.**
   - Assistant rows store Anthropic text content plus `data.anthropic` (id, stop
     reason and details, usage iterations, block types).
   - Hidden rows store `anthropic_tool_use` and `anthropic_tool_result`.
   - Replay alternates roles, merges neighbours and never replays thinking
     (D8).
6. **Usage.**
   - Input is `input_tokens + cache_read_input_tokens + cache_creation_input_tokens`;
     cached input is the cache reads.
   - Sum `iterations`.
   - Add the type to `_USAGE_REQUIRED_PROVIDER_TYPES`.
7. **Errors and refusal.**
   - Map SDK exceptions and stream errors to `anthropic_*` codes:
     - authentication or permission → `credential_rejected`;
     - not found → `model_not_found`;
     - 429 → `rate_limited`;
     - 529 and 5xx → `server_error`;
     - prompt too long → `context_exceeded`;
     - credit balance → `quota_exceeded`;
     - connection and timeout → their categories.
   - Missing key → the existing missing-credential error naming the Anthropic
     connection.
   - Refusal → `model_refused` after any partial deltas, with no assistant row.
   - A `max_tokens` stop uses the existing repair path.

Tests (fake SDK client):

- Request shape:
  - no sampling parameters;
  - breakpoints;
  - effort and thinking mapping, including the D16 chat default;
  - strict tools and structured output;
  - layout positions with the guardrails last.
- Directive parity and identical guardrails.
- Incremental structured speech deltas.
- Byte-exact resend within a turn.
- Replay without thinking, and after a restart.
- Fence both ways.
- Refusal.
- The error table.
- Usage mapping.
- The key is absent from rows, captured logs and responses.

Checks:

- focused tests
- `make check-test`
- the live contract test, when the mapping differs from what Phase 1 verified

Completion: tests pass; review leaves no blocker.

Phase record: issue #369; starting source —; commit —.

#### Code Review #1 Findings

#### Code Review #1 Revisions

### Phase 6: Native web search and compaction

Requirements: R5 (including **Compact early**) and R6, with D4, D7 and D8.

Outcome: Anthropic chats use the native `web_search` server tool when web search
is on. Past the row's trigger they continue through server-side compaction with
the summarizing indicator. App compaction no longer runs for them.

1. **Web search.**
   - When the shared control is on and the row supports it, add the D7 server
     tool with `max_uses: 5` and no application search tool. When it is off,
     add no search tool.
   - `pause_turn`: resend the continuation, at most three times.
   - Emit `run.status searching_web` around server search blocks.
   - A search error result does not fail the turn.
   - Record queries, titles, URLs and citations in `data.anthropic`.
2. **Compaction.**
   - Beta `compact-2026-01-12`, with a `compact_20260112` trigger from D4 and
     the row's `early_compaction`.
   - `run.status summarizing_context` starts on the compaction block's start and
     finishes on its stop.
   - Store the block first in the assistant row's content, with
     `cache_control`. Within-turn compaction travels in the continuation.
   - Replay from the newest compaction-bearing row, even beyond the 200-message
     window, and omit older rows.
   - `_context_budget` returns no budget and post-response compaction is
     skipped for the type.
   - `active_context_tokens` comes from the final iteration.

Tests:

- Search tool presence and absence.
- `pause_turn`.
- Search error results.
- Citations recorded.
- Trigger of 80,000 for Haiku with **Compact early** on, 150,000 with it off,
  and 150,000 for an unpriced owner row.
- Compaction events.
- Compaction block persistence and replay.
- No app compaction for Anthropic chats, and Chat Completions unchanged.

Checks: focused tests, `make check-test`, both compose config commands, and the
live contract test.

Completion: tests pass; review leaves no blocker.

Phase record: issue #370; starting source —; commit —.

#### Code Review #1 Findings

#### Code Review #1 Revisions

### Phase 7: Utility role and the Anthropic Memory Manager runtime

Requirements: R7, R8 and R12 (Utility and Manager effort), with D2, D11 and D16.

Outcome:

- Haiku 5.5 can be the Utility model, producing titles and compaction summaries
  for other chats.
- It can run the Memory Manager through the native memory tool with the same
  approvals, version fence, path rules, automatic mode and undo as the OpenAI
  runtime.

1. **Utility.**
   - `DirectModelPromptRunner` prompts run on the Anthropic client, with effort
     `low` unless set.
   - Fix any mapping gaps.
2. **Selector.**
   - Choose the runtime (OpenAI Agents or `AnthropicMemoryManagerRuntime`) by
     row provider type.
   - The router uses it to start runs; `for_run(run)` uses it to resume on the
     pinned row's runtime.
   - The deterministic runtime under skip is unchanged.
3. **Memory tool handler** (`adapters/memory_manager/anthropic_memory_tool.py`).
   - **Paths:** map `/memories/<relative>` to `<relative>`.
     - Reject paths outside the root, traversal and encoded traversal.
     - Apply existing normalization, the `ManagerFileAccess` scope and
       protected paths (`episodes/**` is read-only).
   - **`view`:**
     - directory: a two-level listing with sizes;
     - file: line-numbered content honouring `view_range`, within read limits.
   - **Edits:** `create` (new, or an update when the file exists), `str_replace`
     (unique match, documented error strings) and `insert` compute new content.
     - The change is planned as `create_file` or `update_file`, with
       `expected_version` and a display diff.
     - Commit applies it under the version fence. Extend commit for
       content-based operations only as needed.
   - **Refusals:** `delete`, `rename` and disallowed paths return
     `is_error: true` with a reason.
   - **Function tools:** keep `search_memory_files` and, for Reflections,
     `read_reflection_turns` as strict function tools.
4. **Loop.**
   - Manager instructions counter the memory tool's progress-note prompt, per
     the Phase 1 finding.
   - Thinking is adaptive, with effort `medium` unless set (D16), under the
     existing turn budget.
   - A planned edit yields `waiting_approval`:
     - the approval's `operation_metadata` holds the tool-use id and command;
     - `serialized_agent_state` holds
       `{schema: 1, messages, pending_tool_use_id, turns_used}`, with messages
       exactly as returned.
   - **Resume** appends the pending `tool_result` and continues:
     - approval: the memory tool's success text;
     - rejection: the OpenAI runtime's rejection text with feedback.
   - Refusals and errors → `failed`. No compaction in Manager runs.
5. Update the Memory Manager runtime docs.

Tests:

- **Handler, per command:**
  - success and error strings;
  - traversal;
  - `episodes/**` read-only;
  - Reflection scope;
  - `delete` and `rename` refused.
- **Runtime, fake transport:**
  - start → approval;
  - approve from a fresh instance built from persisted state → commit and
    resume to completion;
  - reject with feedback;
  - stale version;
  - automatic mode up to eight changes;
  - byte-exact thinking on resume;
  - refusal → failed with memories unchanged;
  - selector by pinned row;
  - effort defaults.
- **Utility:** a title and a compaction summary on an Anthropic row.

Checks:

- focused `tests/test_memory_manager*.py` and new tests
- `make check-test`
- the live contract test (memory tool)

Completion: tests pass; review leaves no blocker.

Phase record: issue #371; starting source —; commit —.

#### Code Review #1 Findings

#### Code Review #1 Revisions

### Phase 8: Desktop key, App Settings and chat UI

Requirements: R1 and R2 in the UI, the R5 setting, and R9 copy.

Outcome:

- The owner manages the Anthropic key on desktop without a restart.
- Models settings show the Anthropic built-in connection and its key state.
- The owner can add Anthropic models, pick them in pickers and toggle
  **Compact early**.
- Refusals and Anthropic errors have clear copy.

1. **Desktop key.**
   - Add `anthropic` to `credentialProviders`, the vault environment
     (`ANTHROPIC_API_KEY`) and `DesktopCredentialsPanel`.
   - Extend the runtime-state and IPC tests.
2. **Models settings.**
   - Built-in connections render generically, each with its own key control.
   - Show the Anthropic key state.
   - On the Anthropic connection, `OwnerModelDialog` fixes the provider type,
     offers Anthropic templates and runs "Test model" through the Models-API
     probe.
   - Preselect Haiku 5.5 when the connection is chosen.
   - Add a **Compact early** switch on eligible Anthropic rows, explaining the
     price step and trigger.
   - The application default is unchanged.
3. **Logo** per D14.
4. **`chat-failure.ts`** gets copy for `model_refused` ("The model declined to
   respond to this message. Try rephrasing it.") and the `anthropic_*` codes.
5. Update the frontend provider-type constants.

Checks:

- `pnpm check`, `pnpm web:lint`, `pnpm web:test`, `pnpm build` and
  `pnpm desktop:check`
- `pnpm e2e:test:fast` on a disposable built task stack
- a visual check of API Keys and Models settings at desktop viewport, then
  narrow, on the skip stack

Completion: checks pass; the visual check matches existing styling; review
leaves no blocker.

Phase record: issue #372; starting source —; commit —.

#### Code Review #1 Findings

#### Code Review #1 Revisions

### Phase 9: Documentation, ADR, measurements and owner live smoke

Requirements: R10, R11 (Anthropic measurement and documentation) and every
acceptance criterion.

Outcome: current docs describe the Anthropic provider and the instruction
layout, and ADRs record the decisions. Final measurements are recorded, and the
owner's live smoke establishes acceptance.

1. **Docs.**
   - Backend:
     - `docs/backend/runtime/model-client-providers.md`
     - `adding-ai-models.md`
     - `prompt-caching.md` (final layout and measurements)
     - `docs/backend/model-catalog.md`
     - the Memory Manager feature doc
   - Frontend: `docs/frontend/features/model-settings.md`.
   - `docs/backend/operations/development.md`: `ANTHROPIC_API_KEY` in the
     secrets file and compose.
   - Cover the moderation gap, the fence, search billing and **Compact early**.
2. **ADRs.**
   - New ADR 0016 "Native Anthropic Messages provider" records:
     - the reversal of #165's exclusion;
     - the Client SDK over the Agent SDK;
     - native features under ADR 0011.
   - Amend ADR 0008 if the Phase 2 decision changed its described placement.
   - Index the changes in `docs/adr/README.md`.
3. **Glossary.** Extend "Model connection" (D1).
4. **Measurements.** Run the harness for all paths, including Anthropic through
   the real adapter. Record before and after in `prompt-caching.md`.
5. **Owner live smoke** (gate). Run it on a live task stack
   (`COMPOSE_ENV_FILES="$HOME/.config/animama/dev-secrets.env,$PWD/.env" ./reset.sh --name anthropic --base-port 8820`)
   or a desktop development build.
   - The agent prepares the checklist from the spec acceptance criteria and
     records the results.
   - For compaction, lower the row trigger to the 50,000 minimum by test
     configuration and use a long pasted document.
   - Also judge reply quality and latency at the D16 defaults.
6. **Release gate.** Record that the next desktop release needs owner re-review
   of the Python license inventory.

Checks: `docs-sync` review, the final checks below, and the measurement run.

Completion: docs and ADRs reviewed; measurements and owner smoke recorded;
failures become in-scope fixes or follow-up issues, per the owner.

Phase record: issue #373; starting source —; commit —.

#### Code Review #1 Findings

#### Code Review #1 Revisions

## Final integration review

Run after Phase 9, before the PR leaves draft. It covers the combined acceptance
and the boundaries between phases:

- layout and guardrail order on every path;
- fence;
- credential isolation;
- hosted policy;
- replay across restart;
- compaction trigger selection;
- Memory Manager resume across runtimes.

Reuse still-valid phase evidence. Record Final Integration Review findings and
revisions, with at most two repair rounds.

## Validation and acceptance

| Spec criterion | Evidence | Phase |
| --- | --- | --- |
| No key → missing-key state and error | backend test; owner smoke | 3, 5, 9 |
| Key added without restart → streamed structured reply; key not persisted | desktop and IPC tests; persistence test; smoke | 5, 8, 9 |
| Multi-turn continues after restart | replay test; smoke | 5, 9 |
| Fence mismatch both ways | backend test | 5 |
| Web search grounded and recorded; absent when off | request-shape test; smoke | 6, 9 |
| Compaction continues with indicator | event and replay tests; smoke at minimum trigger | 6, 9 |
| **Compact early** default on, 80k/150k, survives re-seed, hidden for unpriced rows | seed and request tests; smoke | 3, 6, 8, 9 |
| Utility title on Haiku | test; smoke | 7, 9 |
| Memory Manager approvals, restart resume, reject, fence, scope | runtime tests; smoke | 7, 9 |
| Refusal error, no reply persisted | fake-refusal test | 5 |
| Owner-added `claude-sonnet-5-5` row works | probe test; smoke | 3, 8, 9 |
| Hosted composition unchanged | default-policy tests | 3 |
| Guardrails last and unchanged; stable prefix per path | exact-prompt and stability tests | 4, 5 |
| Caching recommendation documented; ADR 0008 amended if departed | review; owner decision | 2, 9 |
| Cached share does not fall on any path, rises where layout caused misses | harness before and after | 1, 4, 9 |
| Effort defaults and Anthropic phrasing | request tests; prompt review; smoke | 5, 7, 9 |
| Docs and ADRs | review | 9 |

Final local checks on the exact candidate:

- `make check-test`
- `uv lock --check`
- `bash -n reset.sh`
- both compose config commands
- `pnpm check`, `pnpm web:lint`, `pnpm web:test`, `pnpm build` and
  `pnpm desktop:check`
- `pnpm e2e:test:fast`
- both live files

Record hosted `Validation` separately. This change is high-risk and keeps full
hosted validation when hosted runs are available. Automated evidence does not
establish real avatar or audio fidelity.

## Idempotence and recovery

- **Seeding:** seed upserts are idempotent and preserve owner rows, `hidden` and
  `early_compaction`.
- **Schema changes:** they require resetting the task stack database only. Never
  purge the main stack.
- **Live runs:** they can be rerun but cost money. Keep each to its budget and
  never loop them in automation.
- **Layout changes:** these change every provider's prompt. If Phase 4
  regresses quality or caching, revert its commit. The Anthropic adapter's
  placement then falls back to D9.
- **Reverting a phase:** revert its commits on the task branch. Development
  chats fenced to `anthropic_messages` show the unsupported-standard error until
  the task stack is reset.
- **Memory Manager:**
  - A stale approval keeps its run `waiting_approval`, and the version fence
    prevents a double apply.
  - A run pinned to an Anthropic row without a key fails clearly and leaves
    memories unchanged.

## Outcomes & Retrospective

Not started.
