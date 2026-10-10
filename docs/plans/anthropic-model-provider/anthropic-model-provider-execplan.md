# Anthropic model provider and cache-friendly instructions execution plan

Status: Implemented; awaiting owner review of the PR. All phases were authorized
by the owner's `/implement` on 2026-10-08. The explicit gates:

- Phase 1 live spend, already authorized;
- the Phase 2 owner decision, made 2026-10-09 (D19);
- the Phase 9 owner live smoke, accepted by the owner on 2026-10-09.

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
- **2026-10-09 owner decisions at the Phase 2 presentation (D19):**
  - R4, R6 and R8 confirmed;
  - OpenAI Responses keeps server state, with compaction at 90,000 tokens;
  - turn context and guardrails go before the user's new message.

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

- [x] Phase 1: Live contract verification, SDK and cache baseline. Done
      2026-10-08. Live checks and isolated baseline recorded; Review #3
      passed.
- [x] Phase 2: Caching findings and layout recommendation. Done 2026-10-09.
      Owner decisions D19 and D21, strategy D20; Review #3 limit acknowledged by
      the owner.
- [x] Phase 3: Provider identity, connection, credentials and catalog. Done
      2026-10-09; Review #3 passed.
- [x] Phase 4: Cache-friendly instruction assembly for every provider. Done
      2026-10-09; Review #3 passed. After-shares: Responses cursor 0.90,
      Chat Completions developer 0.87, tagged block 0.84.
- [x] Phase 5: Chat turns on Anthropic models. Done 2026-10-09; Review #3
      passed. Anthropic cache share 0.88 through the real adapter.
- [x] Phase 6: Native web search and compaction. Done 2026-10-09; Review #2
      passed.
- [x] Phase 7: Utility role and the Anthropic Memory Manager runtime. Done
      2026-10-09; Review #2 passed; D23 and D24 implemented.
- [x] Phase 8: Desktop key, App Settings and chat UI. Done 2026-10-09; Review #2
      passed; D25 implemented.
- [x] Phase 9: Documentation, ADR, measurements and owner live smoke. Done
      2026-10-09; Review #2 passed; the owner smoke was accepted; D26 and D27
      implemented.
- [x] Final integration review. Done 2026-10-10 after merging main at
      `fb50fc55`; Review #3 passed (repair round 2).

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
- **D4 (2026-10-08, owner; trigger revised 2026-10-09 by owner):** compaction
  uses threshold `compact_20260112`.
  - `pause_after_compaction` is false, and turns are never re-inserted.
  - The trigger comes from the row:
    - with **Compact early** on (the default, offered only on rows with a
      long-context price threshold), the trigger is
      `max(50_000, floor(0.9 × threshold))`, which is 90,000 for Haiku 5.5;
    - otherwise it is 150,000.
  - There is no environment setting.
  - The OpenAI Responses native compaction default also becomes 90,000
    (`ANIMAMA_OPENAI_RESPONSES_COMPACTION_THRESHOLD_TOKENS`, today 10,000).
    This is done in Phase 4.
- **D5 (planning):** Haiku's tiered pricing populates the existing long-context
  fields (threshold 100,000; $0.50 input, $0.05 cached, $2.50 output). The
  estimator's tier gap is recorded, not fixed.
- **D6 (planning):** Anthropic efforts are `none`, `low`, `medium`, `high`,
  `xhigh` and `max`.
  - `none` sends `thinking: {type: "disabled"}`.
  - Any other effort omits `thinking` and sets `output_config.effort`.
  - Phase 1 confirmed that real `tool_use` blocks still appear with thinking
    disabled, so `none` is offered.
- **D7 (2026-10-08, owner; version chosen in Phase 1):** Anthropic rows use
  Anthropic's native `web_search` server tool, never the application Brave or
  SearXNG tool. Phase 1 measured the two versions; the result is basic
  `web_search_20250305` with `allowed_callers: ["direct"]`. The selection rule
  that Phase 1 applied was:
  - Prefer `web_search_20260318` (dynamic filtering, with
    `response_inclusion: "excluded"`).
  - Use basic `web_search_20250305` with `allowed_callers: ["direct"]` if
    dynamic filtering's median latency is more than 30% higher on three fixed
    prompts, or if it fails with structured output.
- **D8 (planning; spec R4 clarification):** within a turn, prior rounds' content
  blocks are resent exactly. Completed turns replay visible text, memory-tool
  exchanges and the latest compaction block, without thinking or raw search
  blocks.
- **D9 (planning, confirmed in Phase 1; superseded by the Phase 2 layout
  decision):** until Phase 2 decides otherwise, Anthropic places per-turn
  context in a mid-conversation `system` message as the last entry. Phase 1
  confirmed Haiku 5.5 accepts it. The fallback, a leading text block in the
  latest user message, is not needed.
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
- **D16 revision (2026-10-09, owner, D22):** the Anthropic chat default
  becomes `medium` (see D22). Utility stays `low`; the Memory Manager stays
  `medium`.
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
- **D19 (2026-10-09, owner, at the Phase 2 presentation):**
  - R4, R6 and R8 follow the recommendations (D8; sources stored and not
    displayed; delete and rename refused).
  - OpenAI Responses keeps OpenAI server state (`previous_response_id`,
    `store: true`) and native compaction, with the threshold raised to 90,000
    (L2 and L3).
  - Turn context and guardrails go **before** the user's new message:
    - as a `developer` message, or a mid-conversation `system` message, where
      the provider supports that position;
    - otherwise as a tagged block inside the user's message, which the
      top-level instructions describe (L1 and L4, the owner's variant).
  - Tool-call and reasoning handling per provider follows the planning
    recommendation.
  - The owner authorized live API runs against the real endpoints for
    evaluation during this plan, and asked that decisions use the providers'
    current documentation.
- **D22 (2026-10-09, owner):** Anthropic chat turns with no effort set use
  `medium`, revising D16's `low`.
  - Phase 5 live runs showed Haiku 5.5 at `low` made a needed memory-tool call
    in only 1 of 5 attempts (plus 1 of 3 earlier), against 5 of 5 at `medium`.
    That held even with Anthropic's recommended JSON-plus-tools prompt line.
  - Utility stays `low`; the Memory Manager stays `medium`.

- **D23 (2026-10-09, planning, resolves P6-R1-F4):** Anthropic Utility
  requests (chat titles, app compaction summaries for other chats) omit
  `context_management` and the compaction beta. A summarization input is
  already bounded by its source chat's trigger. Server compaction of that input
  would summarize a summary and bill an extra step. Utility effort is `low`
  unless set; the title prompt's `minimal` is not offered by Anthropic, so
  `low` applies.

- **D24 (2026-10-09, owner):** the Memory Manager turn budget resets on each
  approval resume, for both runtimes. Each start and each resume gets the full
  budget: 8 turns, plus one per Reflection page. An automatic chain of
  approvals therefore no longer ends a run at the budget. A single step that
  exceeds the budget still ends blocked. This changes the OpenAI runtime too,
  where the Agents SDK previously carried the turn count across resumes.

- **D25 (2026-10-09, owner, at Phase 8):**
  - **Setup:** first-run setup's AI step offers Anthropic, adding a key and
    picking Claude Haiku 5.5, beside OpenAI and local servers.
  - **Logo:** the Anthropic logo is taken from models.dev
    (`providers/anthropic/logo.svg`) at a pinned revision. Its provenance and
    license are recorded under the provider-logo rules (README and the
    `model-provider-logos` license inventory group). The owner approved the
    download, which supersedes D14's fallback.
  - **Preselection:** "Preselect Haiku 5.5" as the preselected template in the
    Add model dialog is accepted.
- **D26 (2026-10-09, owner, at Phase 9):** the chat picker's effort default.
  - The Phase 9 docs audit found that choosing a model in the chat picker
    saved its first listed effort, `none`, for every row. Anthropic chats
    therefore ran with thinking off, and D22's `medium` applied only when no
    effort was saved.
  - Decision: the backend reports each catalog row's default chat effort
    (`default_reasoning_effort`), and the picker uses it, falling back to the
    first listed effort.
  - Anthropic rows report `medium` when they support it. OpenAI rows report
    none and keep their current behaviour.
- **D27 (2026-10-09, owner, at Phase 9):** Memory Manager outdated facts. Both
  runtimes' instructions say to correct or remove a statement that a new fact
  replaces, so memory files never contradict each other.

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
7. Phases run in order. Phase 4 needs the Phase 2 owner decision, recorded
   2026-10-09 as D19.

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
   - When `ANIMAMA_TEST_LOCAL_CHAT_BASE_URL` and `ANIMAMA_TEST_LOCAL_CHAT_MODEL`
     are set, it also covers a local Chat Completions server.
   - It reports cached-input share per turn, model, revision and method, and
     records no content.
4. Record the results under this phase. Finalize D6, D7 and D9, and record the
   baseline table.

Checks: `uv lock --check`, `make check-test`, and both live files.

Completion: live checks pass or each deviation is decided; the baseline is
recorded; review leaves no blocker.

Phase record: issue #365; starting source `b37abfa5`; commit `93387454`.

Results (2026-10-08). Source: `b37abfa5` plus this phase's working tree. Model
`claude-haiku-5-5`; SDK `anthropic` 1.12.1. Live spend was well under budget:
six web searches, compaction requests of about 81,000 and 57,000 tokens, and
small requests.

Commands:

- Live checks:
  `ANIMAMA_RUN_LIVE_TESTS=1 uv run --env-file "$HOME/.config/animama/dev-secrets.env" pytest -q -s tests/live/test_anthropic_messages_contract.py tests/live/test_prompt_cache_layout.py`.
  After the review repairs, checks 3, 5 and 7 and the harness were rerun.
- `uv lock --check`: "Resolved 272 packages", passes.
- `make check-test` (before the review repairs):
  - audit, format, lint and mypy pass;
  - 3,265 passed, 20 skipped (live tests skip without keys).
- mypy accepts the new modules and tests. The live files deliberately pass raw
  JSON-shaped request parameters through an untyped client view, because they
  test the wire shape the adapter will build.

Findings:

- **Dependencies.** `anthropic>=1.12,<2` is locked.
  - New packages: `anthropic`, `httpx2` 2.13.1, `httpcore2`, `httpx2-jsfetch`
    (marker only), `truststore` and `docstring-parser`. `jiter` was already
    present through `openai`. `idna` moves from 3.11 to 3.20.
  - `httpx2` sits beside `httpx` 0.28.1, which `openai` uses.
  - `httpx2` uses the operating-system trust store through `truststore`, not
    certifi. Phases 3 and 9 must confirm TLS in Docker and the frozen desktop
    runtime.
  - The Phase 9 license-inventory gate covers all of these packages.
- **Strict schemas.** Anthropic rejects:
  - `maxItems` in a strict tool (`memory_read_files`);
  - integer `minimum`/`maximum` in the response schema
    (`emotional_intensity`).

  The SDK's `transform_schema` rejects `type` lists (`["string", "null"]`).
  `adapters/model_clients/anthropic_messages/schema.py::anthropic_strict_schema`
  handles all three:
  - type lists become `anyOf`, with each branch's `enum` filtered;
  - a branch the enum gives no value for is dropped (an Anima with no
    Gestures gets a plain `null` gesture);
  - a single branch collapses;
  - the SDK transform then moves unsupported bounds into descriptions.

  Tests in `tests/test_anthropic_messages_schema.py` cover every app tool schema
  and the main response schema with and without Gestures. Local validation keeps
  the original bounds; check 3 validates the live reply with the app's own model.
- **Check 1/9:** text streamed in 9 deltas. A 16,732-token system block was
  written to cache, then fully read on repeat. Anthropic documents a 512-token
  minimum cacheable prefix for Haiku 5.5 (prompt-caching guide,
  platform.claude.com, read 2026-10-08). This check did not isolate it.
- **Check 2 (D6):** with thinking disabled, strict tools returned real
  `tool_use` blocks (`text`, `tool_use`; stop reason `tool_use`).
- **Check 3:** the converted main response schema and strict memory tools work
  together. The JSON streamed in 14 deltas and validates against the app's
  response model.
- **Check 4 (D9):** a mid-conversation `system` message as the last entry is
  accepted.
- **Check 5 (D8):**
  - The first response held a signed `thinking` block and a `tool_use` block.
  - Resending both unchanged with the tool result and `tool_choice: none` (the
    forced-final shape) ended `end_turn`.
  - The next turn, replayed as text without thinking, was accepted; the model
    chose a tool.
- **Check 6 (D7):** three fixed prompts with structured output.

  | Version | Median latency | Median input tokens | Pauses | Searches |
  | --- | --- | --- | --- | --- |
  | basic `web_search_20250305` (direct) | 7.38 s | 14,982 | 0/0/0 | 1/1/1 |
  | dynamic `web_search_20260318` (`excluded`) | 10.35 s | 20,127 | 0/0/0 | 0/1/1 |

  One sample per prompt.
- **Check 7 (D4):** a history of about 57,000 tokens with the 50,000-token
  trigger.
  - Stream: one compaction block start, then exactly one `compaction_delta`
    carrying the whole summary, then a signed `thinking` block (even at effort
    `low`), then text in 18 deltas.
  - `usage.iterations`: `compaction` (56,828 input), then `message` (346).
  - Resending with the compaction block cost 981 input tokens and ended
    `end_turn`. The API drops everything before the block.
  - An earlier run of about 81,000 tokens behaved the same way.
- **Check 8:** the memory tool ran `view /memories`, then `view` of the
  profile, then `str_replace` on it. Under the manager instruction it created no
  extra file.
- **Check 10:** an invalid key raised `AuthenticationError` (401); an unknown
  model raised `NotFoundError` (404).

Cache baseline (`tests/live/test_prompt_cache_layout.py`):

- Method: six scripted turns, a synthetic Anima, a memory map changing each
  turn, effort `low`, and a fresh nonce per path and run, so no run reads
  another's cache.
- Source: `b37abfa5-dirty`, the Phase 1 working tree. Models: OpenAI
  `gpt-6-luna` and Anthropic `claude-haiku-5-5`.

| Path | Cached share by turn | Mean, turns 2–6 |
| --- | --- | --- |
| Responses without cursor | 0, 0, 0, 0, 0, 0 | 0.00 |
| Responses with cursor | 0, 0, 0, 0, 0, 0 | 0.00 |
| Chat Completions, developer role | 0, 0, 0.838, 0.827, 0.811, 0.795 | 0.65 |
| Chat Completions, folded | 0, 0, 0, 0, 0, 0 | 0.00 |
| Anthropic, folded layout with auto cache | 0, 0, 0, 0, 0, 0 | 0.00 |

The first unisolated run reported 0.94 for the cursor path. That number came
from the stateless run's cache entries, which carried identical instructions,
and is withdrawn (finding P1-R1-F1).

Observations for Phase 2. These are inferences from the data, checked against
OpenAI's prompt-caching guide (developers.openai.com, read 2026-10-08). That
guide says:

- on GPT-5.6 and later, implicit cache writes land at the end of the latest
  eligible message: user messages, the last tool result, and the end of the
  initial developer-message block;
- top-level `instructions` cannot carry a breakpoint.

Inferences:

- **Responses, with or without a cursor:** the per-turn memory map is inside
  `instructions`, which render first, so nothing is reused.
- **Chat Completions with a developer role:** the leading system message is the
  initial block. It is written and reused (about 4,055 tokens). The other write
  lands at the end of the latest user message. Today the per-turn developer
  message sits before that user message and moves every turn, so no later
  request repeats that prefix and history is never reused.
- **Folded layouts (Chat Completions and Anthropic):** nothing is reused,
  because the system message changes each turn.
- **Token counts:** Anthropic counted about 1.8× OpenAI's input tokens for the
  same prompt, including its structured-output schema.
- **Worst case:** in production the memory map lists files and descriptions
  only, so it changes when files change, not every turn. The harness models the
  worst case.

No local Chat Completions server was available, so that path was not measured.

#### Code Review #1 Findings

Reviewer: independent `sdlc-reviewer`, full initial review of `b37abfa5` plus
the Phase 1 working tree.

- **Checks the reviewer ran:**
  - `uv lock --check`;
  - ruff, format and mypy on the changed files;
  - the focused tests (4 passed, 10 live skipped);
  - the import-boundary check (no forbidden edges);
  - a read-only script running the schema conversion over every app schema.
- **Blocking findings:**
  - **P1-R1-F1 (blocking):** the cursor baseline was contaminated by the
    stateless run's cache, because both runs used identical per-turn
    instructions.
  - **P1-R1-F2 (blocking):** `anthropic_strict_schema` emitted an empty `enum`
    for an Anima with no Gestures.
  - **P1-R1-F3 (blocking):** check 5 asserted neither the presence of thinking
    nor the follow-up stop reasons.
- **Optional findings:**
  - **P1-R1-F4:** the D6 and D9 log entries still read as conditional.
  - **P1-R1-F5:** the compaction delta count was not observable, and the
    81,000-token trigger was misleadingly worded.
  - **P1-R1-F6:** the Haiku 5.5 minimum cacheable prefix was not recorded.
  - **P1-R1-F7:** the commands and results were not recorded.
  - **P1-R1-F8:** the test environment scrub omitted the Anthropic variables.
  - **P1-R1-F9:** the live README did not describe the new paid tests.
  - **P1-R1-F10:** the dependency list was incomplete, and the `truststore` TLS
    note was missing.
  - **P1-R1-F11:** the harness revision hid uncommitted changes.
  - **P1-R1-F12:** a null branch broadened enums that exclude null; check 3
    validated only `speech`.

#### Code Review #1 Revisions

All verified before fixing.

- **F1 (accepted):** each path and run now starts its prompt with a fresh nonce.
  The rerun shows the cursor path at 0.00, and the plan's table and
  observations are corrected.
- **F2 (accepted):** gesture-less schemas now collapse to `null`. Test added and
  passing.
- **F3 (accepted):** check 5 asserts a signed thinking block, `end_turn` on the
  follow-up and acceptance of the next turn. The follow-up uses `tool_choice:
  none`, which also covers the forced-final shape. The rerun passed. The next
  turn's assertion accepts `tool_use`, because the contract is acceptance, not
  the model's choice.
- **F4 (accepted):** D6 and D9 are updated in the Decision Log.
- **F5 (accepted):** deltas are run-length counted, and history is resized to
  about 57,000 tokens. The rerun recorded exactly one `compaction_delta`.
- **F6 (accepted):** the documented 512-token minimum is recorded with its
  source.
- **F7 (accepted):** commands and results are recorded above.
- **F8 (accepted):** `ANTHROPIC_API_KEY` and `ANTHROPIC_BASE_URL` are scrubbed
  in `tests/conftest.py`, and the key is kept only for live runs.
- **F9 (accepted):** a README paragraph covers purpose, keys, budget and `-s`.
- **F10 (accepted):** the full dependency list and the TLS note are recorded.
- **F11 (accepted):** the harness records `git describe --always --dirty`.
- **F12:**
  - **Accepted:** the enum-excluding-null case is fixed (test added), and check
    3 validates with the response model.
  - **Rejected:** moving a `default` into the description is the SDK's
    documented behaviour, and no app schema uses `default`.

Verification after the repairs:

- schema tests: 6 passed;
- ruff, format and mypy on the changed files pass;
- live reruns of checks 3, 5 and 7 and the harness pass.

Repair budget: one of two rounds used. A targeted recheck (Review #2) followed.

#### Code Review #2 Findings

Targeted recheck by the same reviewer. It confirmed the fixes for F1–F12 and
accepted the F12 rejection. Checks: ruff, format and mypy on the changed files;
146 focused tests passed (schema, credentials, desktop credentials route), with
the live tests skipped as intended.

- **P1-R2-F1 (blocking):** the harness's local-server variables
  (`ANIMAMA_LOCAL_CHAT_*`) are deleted by the root conftest's `ANIMAMA_*` scrub,
  so the documented local path could never run.
- **P1-R2-F2:** the nonce leads the identity, not the whole prompt, and the
  isolation claim needed qualifying.
- **P1-R2-F3:** the Phase 2 observations stated mechanisms as fact without a
  source.
- **P1-R2-F4:** `jiter` was wrongly listed as a new dependency.
- **P1-R2-F5:** an unsatisfiable type list produced `{"anyOf": []}`.

#### Code Review #2 Revisions

- **R2-F1 (accepted):** renamed the variables to
  `ANIMAMA_TEST_LOCAL_CHAT_BASE_URL` and `ANIMAMA_TEST_LOCAL_CHAT_MODEL`, which
  conftest preserves, in the harness and the README.
- **R2-F2 (accepted):**
  - The docstring and README now state that the tag follows about 265 tokens of
    core instructions, below OpenAI's minimum.
  - Phase 4 must move the tag ahead of any newly shared prefix.
- **R2-F3 (accepted):** the observations are labelled as inferences and cite
  OpenAI's prompt-caching guide. The guide's initial-developer-block write also
  explains the system-message reuse.
- **R2-F4 (accepted):** the dependency list is corrected.
- **R2-F5 (accepted):** an unsatisfiable type list now raises `ValueError`
  ("Fail clearly"), and a test was added.

Verification:

- schema tests: 7 passed;
- ruff, format and mypy on the changed files pass;
- the post-repair `make check-test` on the repair-1 tree: audit, format, lint
  and mypy pass; 3,267 passed and 20 skipped (live tests). The repair-2 edits
  touch only the schema module, its tests, the live tests, the README and the
  plan, and their focused checks pass.

Repair budget: two of two rounds used.

#### Code Review #3 Findings

Final targeted recheck: **pass**. The reviewer confirmed the fixes for R2-F1
to R2-F5 with no regressions. For R2-F1, it imported conftest with the
`ANIMAMA_TEST_LOCAL_CHAT_*` variables set and confirmed they survive. Focused
checks passed: ruff, format, mypy, and 7 tests passed with 1 skipped.

- **P1-R3-F1 (optional):** Phase 1 step 3 named the old variables.
- **P1-R3-F2 (optional):** the post-repair `make check-test` result was not yet
  recorded.

#### Code Review #3 Revisions

- **R3-F1 (accepted):** step 3 now names `ANIMAMA_TEST_LOCAL_CHAT_*`.
- **R3-F2 (accepted):** the result is recorded above.

### Phase 2: Caching findings and layout recommendation

Requirements: R11 (findings and recommendation), closing #155's investigation.

Outcome:

- `docs/backend/runtime/prompt-caching.md` describes each provider path's
  caching rules, a volatility map of every prompt part, and the measured
  baseline.
- The owner decides the layout before Phase 4.
- The decided per-provider strategy is recorded in D20. It reaches the doc in
  Phase 4, which implements it, because docs describe current behavior.

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

Phase record: issue #366; starting source `93387454`; commit `39d2ffee`.
Issue #364 was republished from the spec after this commit (updated
2026-10-09T16:09:22Z) and read back: it carries the 90,000 thresholds and the
2026-10-09 decisions.

Candidate measurements (2026-10-08, `test_measure_candidate_layouts` in
`tests/live/test_prompt_cache_layout.py`, source `93387454-dirty`, same method
and isolation as the baseline). Every candidate keeps the system or
`instructions` text stable and sends the per-turn context and guardrails after
the latest user message.

| Candidate | Cached share by turn | Mean, turns 2–6 | Input tokens, turn 6 |
| --- | --- | --- | --- |
| Responses without cursor (full history, trailing developer item) | 0, 0.86, 0.86, 0.866, 0.863, 0.866 | 0.86 | 5,082 |
| Responses with cursor (new user + developer item per turn) | 0, 0.766, 0.79, 0.813, 0.827, 0.843 | 0.81 | 7,970 |
| Chat Completions, trailing developer message | 0, 0.858, 0.859, 0.865, 0.862, 0.867 | 0.86 | 5,130 |
| Chat Completions, trailing system message | 0, 0.858, 0.859, 0.865, 0.864, 0.868 | 0.86 | 5,119 |
| Chat Completions, context appended to the user message | 0, 0.855, 0.839, 0.825, 0.808, 0.792 | 0.82 | 5,120 |
| Anthropic, breakpoints on system and latest user text, trailing system message | 0, 0.875, 0.874, 0.876, 0.868, 0.882 | 0.88 | 9,032 |

- **Cursor candidate:** history grows faster because each turn's context and
  guardrails stay in OpenAI's stored state.
- **Appended-to-user candidate:** on OpenAI it reuses only the system prompt,
  because the stored user message differs from the one sent. On local servers,
  token-prefix caching reuses up to the user's text. No local server was
  available to confirm this.

Owner presentation: a private page compares today's and the recommended
strategy for each provider. It asks for decisions L1–L4, R4, R6 and R8 and
recommends:

- **L1:** the common order (fixed instructions, history, user message, then
  turn context and guardrails).
- **L2:** app-owned Responses history with `store: false`.
- **L3:** a Responses compaction threshold of 64,000 tokens (today 10,000).
- **L4:** for rows without a developer role, a tagged block at the end of the
  user message (amends ADR 0008).
- **R4:** option A (drop thinking across turns).
- **R6:** option A (store sources; don't display them).
- **R8:** option A (refuse delete and rename).

Phase 2 live runs, all with the owner's keys:

- 2026-10-08, candidates:
  `ANIMAMA_RUN_LIVE_TESTS=1 uv run --env-file "$HOME/.config/animama/dev-secrets.env" pytest -q -s tests/live/test_prompt_cache_layout.py::test_measure_candidate_layouts`.
- 2026-10-09, owner layout (live evaluation authorized by the owner that day):
  - the same command with `::test_measure_owner_layout`;
  - two Chat Completions reruns through an inline `python` driver of
    `_run_chat_owner_layout`, after the breakpoint fixes.
- Spend: 6 candidate and 9 owner-layout six-turn runs. That is about 470,000
  OpenAI input tokens at `gpt-6-luna`'s $0.10 per million (under US$0.05) and
  about 160,000 Anthropic input tokens at Haiku 5.5's $0.10 per million (under
  US$0.02), plus small outputs.
- Two intermediate findings came from harness versions since changed: the 0.65
  result with one breakpoint, and the turn-2 miss without a system marker.
  Reproduce them by removing the extra markers in `_with_openai_breakpoint` and
  `_openai_system_with_breakpoint`.

Owner decisions (2026-10-09, D19), then a measurement of the owner's layout:
turn context and guardrails before the user message (`test_measure_owner_layout`,
same method, source `93387454-dirty`, live runs authorized by the owner).

| Owner layout | Cached share by turn | Mean, turns 2–6 | Input tokens, turn 6 |
| --- | --- | --- | --- |
| Chat Completions, developer message before user; explicit breakpoints on system and the last two assistant replies | 0, 0.857, 0.857, 0.862, 0.853, 0.864 | 0.86 | 5,168 |
| Chat Completions, tagged block in the user message; same breakpoints | 0, 0.856, 0.858, 0.863, 0.861, 0.866 | 0.86 | 5,161 |
| Responses with server state; stable instructions ending in the guardrails; context sent only when it changes (map changes once) | 0, 0.785, 0.971, 0.856, 0.842, 0.829 | 0.86 | 5,995 |
| Responses with server state; worst case, map changes every turn | 0, 0.703, 0.791, 0.864, 0.787, 0.847 | 0.80 | 8,284 |
| Anthropic, tagged block in the user message; breakpoints on system and the last history message | 0, 0.871, 0.869, 0.869, 0.861, 0.878 | 0.87 | 9,330 |

Findings from these runs, checked against the providers' current documentation
(OpenAI prompt-caching, compaction and conversation-state guides; Anthropic's
mid-conversation system message and prompt-caching guides, read 2026-10-08/09):

- **OpenAI breakpoint lookup.** A request looks up only breakpoints it marks
  itself, plus eligible message endings (user messages, the last tool output,
  and the end of the initial developer block).
  - One breakpoint on the last history message never hit: 0.65, system only.
  - Marking the previous reply as well reads the last request's entry, while
    the latest reply writes the next one.
  - A developer message right after the system prompt joins the initial block,
    so the system prompt needs its own marker. Without it, turn 2 misses.
  - The markers are `prompt_cache_breakpoint: {"mode": "explicit"}` on a text
    content part. This uses 3 explicit writes plus the implicit one, within the
    limit of 4.
  - openai-python 2.41 does not type the field, but passes it through.
- **Responses caching.** With server state, the cached prefix grew in
  1,024-token steps. The share therefore dips between steps but is not lost.
  Sending the context only when it changes keeps stored history small.
- **Anthropic.** A mid-conversation `system` message may follow only a user
  turn (or a server-tool result), so it cannot precede the new user message.
  The owner's rule then selects the tagged user block. The docs also say Haiku
  5.5 may ignore a system message placed right after tool results, so
  forced-final and repair instructions go in the user turn.

- **D20 (planning, applying D19 with the measurements above; revised after
  Phase 2 Review #1): per-provider strategy for Phases 4 and 5.**
  - **Shared:**
    - **Stable instructions.** The system or `instructions` text is stable:
      core instructions, identity, `MEMORIES.md`, memory and response guidance,
      Gestures, then the Companion Guardrails.
      - `MEMORIES.md` stays there. Only a chat memory write or a Reflection
        edits it. On Responses an edit also invalidates the stored chain's
        cached prefix. That trade is accepted, because edits are rare.
    - **App compaction summary** (Chat Completions only):
      - With a developer role, it is a developer message directly after the
        stable instructions.
      - Without one, it is folded into the system prompt just before the
        closing guardrails, so the system prompt still ends with them.
      - In both cases each app compaction costs one miss of the history
        cache. Each app compaction therefore costs one miss of
      the history cache. How often that happens depends on the app-compaction
      trigger, which is an open owner question (see below).
    - **History** is replayed byte-for-byte.
    - **Turn context.** On every turn, the turn context (memory map, then
      attachments) and the guardrails go immediately before the new user
      message.
    - **Tag escaping** (tagged-block paths only). Every occurrence of
      `<turn_context` or `</turn_context` is escaped before it goes into a
      request (any case).
      That covers user text and the untrusted text inside the block: memory-map
      descriptions, attachment names, descriptions and outlines. Nothing can
      close or forge the block.
    - **Tool list.** It is unchanged from today, because offering tools on more
      turns would change what the model sees.
      - Uploaded-file tools appear only on turns with attachments.
      - Write tools follow chat options; native web search follows the shared
        control.
      - Changing the tool list misses the whole cache on OpenAI and Anthropic,
        so a turn with attachments, and the turn after it, miss. This is
        accepted and documented.
  - **OpenAI Chat Completions with a developer role:**
    - A developer message carries the context and guardrails.
    - On the built-in OpenAI connection only, explicit breakpoints go on the
      system prompt and the last two assistant replies. Other servers never
      receive content-part breakpoints.
    - Measured: 0.86.
  - **Chat Completions without a developer role** (local servers and similar):
    - A tagged `<turn_context>` block at the start of the user message carries
      the context and guardrails.
    - The system prompt describes the block and ends with the guardrails.
    - No breakpoint fields are sent. Local servers reuse the token prefix by
      themselves; this is not measured, because no local server was available.
  - **OpenAI Responses:**
    - Uses server state: `previous_response_id`, `store: true`, and native
      compaction with the threshold default raised to 90,000 tokens.
    - `instructions` stays stable and ends with the guardrails.
    - On every turn a developer item (context, then guardrails) goes before the
      user item. Sending it every turn follows D19 literally:
      - after a native compaction the model still sees the current context;
      - on a `disable_memory_influence` turn the newest context item has no
        map;
      - no fingerprint state is needed.

      The cost is that earlier copies accumulate in the stored chain until
      compaction. Measured 0.80, using as a stand-in the harness run that sends
      a developer item on every turn because the map changes every turn.
    - On continuation after tool calls, only tool outputs are sent, as today.
      The forced-final instruction goes in a developer item after the tool
      outputs, with the guardrails restated, not in `instructions`.
    - Reasoning items and function calls continue through
      `previous_response_id`.
    - **Full history** (a stale-cursor replay, or incognito turns with
      `store: false`) uses the same order, with explicit breakpoints on the
      last two history user items (Responses `output_text` parts cannot carry
      one). This share is not yet measured; Phase 4 measures it.
  - **Anthropic Messages** (D21):
    - A mid-conversation `system` message right after the new user turn carries
      the turn context (memory map, then attachments) and the guardrails.
      Anthropic accepts a system message only after a user turn, so it follows
      the user's words rather than preceding them.
    - No tagged block and no tag escaping are used on this path.
    - The stable system prompt ends with the guardrails.
    - `cache_control` goes on the system prompt and the last history block.
    - Within a turn, tool rounds follow the system message with the assistant's
      `tool_use`, which is valid. Thinking and `tool_use` blocks are resent
      exactly.
    - Across turns, history replays visible text, memory-tool exchanges as
      `tool_use`/`tool_result` blocks without thinking, and the latest
      compaction block (R4/D8). Earlier turns' context messages are not
      replayed.
    - Forced-final instructions go in the user turn after tool results, since
      Haiku 5.5 may ignore a system message placed there. Repair instructions
      follow the invalid reply in a user turn.
    - Measured: 0.875 (candidate run, 2026-10-08).
  - **ADR 0008 amendment** (recorded in Phase 9):
    - The guardrails are part of the stable instructions, last.
    - They are repeated with the turn context immediately before the user's new
      message, word for word.
    - On every path, the last instruction text the model reads before the
      user's words is the guardrails.
  - **Tool calls and reasoning:**
    - Chat Completions replays stored tool exchanges and no reasoning, as
      today.
    - Responses and Anthropic follow the bullets above.
  - **App-compaction trigger** (D21): `min(90_000, floor(0.7 × the row's
    context window))`. `ANIMAMA_CHAT_COMPACTION_THRESHOLD_TOKENS` becomes the
    cap, with a new default of 90,000 (today a fixed 6,000).
- **D21 (2026-10-09, owner):**
  - **Anthropic:** turn context and guardrails go in a mid-conversation `system`
    message after the user turn, with no tagged block. The owner chose this over
    the tagged block and a split.
    - Measured reuse: no block 0.875, tagged block 0.871, split 0.878 (data in
      a tagged block, guardrails in a system message).
    - The no-block layout keeps the guardrails at operator authority and uses
      one mechanism.
    - Attachment metadata gains system authority, as it already has in the
      OpenAI developer message, and stays labelled as untrusted document
      metadata.
  - **Chat Completions app-compaction trigger:** 70% of the model's context
    window, capped at 90,000 tokens.
    - Phase 4 refinement (planning, recorded at Phase 4 review): the code
      keeps the existing bound of 75% of the window minus the reply reserve,
      so the trigger is `min(cap, 0.7 × window, 0.75 × (window − reply
      reserve))`.
    - For small windows with the default reserve (a quarter of the window),
      0.7 × window would sit above the 90% pre-send trigger, so post-response
      compaction would never run first. For example, at 8,192 tokens it would
      be 5,734 against a pre-send trigger of 5,529.
    - The extra bound only makes the trigger earlier, so it stays within the
      owner's intent.
  - **Phase 2:** the owner accepted closing Phase 2 at the review limit, after
    the mechanical record fix that a diff verified.

#### Code Review #1 Findings

Reviewer: independent `sdlc-reviewer`, full initial review of the working tree
on `93387454`. It treated D19 as fixed.

Checks run by the reviewer:

- ruff, format and mypy on the harness;
- the harness skipped without keys;
- the doc's links resolved;
- every table mean recomputed and matched;
- `gh issue view 364` (read-only).

Blocking findings:

- **P2-R1-F1:** Responses "context only when it changes" contradicted D19 and
  the rest of D20, and nothing reset it after native compaction.
- **P2-R1-F2:** the Responses full-history case claimed "the same layout"
  without breakpoints or a measurement.
- **P2-R1-F3:** tag escaping covered only user text. Attachment and
  memory-map text could close the block.
- **P2-R1-F4:** D20 did not place the compaction summary, and the doc did not
  state the 6,000-token app-compaction trigger.
- **P2-R1-F5:** the volatility map omitted tool definitions, so attachment
  turns change the tool list.
- **P2-R1-F6:** the doc omitted `prompt_cache_key` and the OpenAI lookup rule.
- **P2-R1-F7:** issue #364 still carried the 2026-10-08 spec.
- **P2-R1-F8:** stale plan text (header, progress, validation row, Phase 4
  step 1, Phase 5 step 2, recovery, Phase 4 missing the 90,000 change).
- **P2-R1-F9:** the Phase 2 outcome promised the recommended layout in the doc.
- **P2-R1-F10:** the Phase 2 live commands and spend were not recorded.

Optional findings:

- stale harness comments and method string;
- the README budget;
- the harness system prompt not ending with guardrails;
- two different statements of the breakpoint gating rule;
- unmeasured local reuse;
- no evidence for keeping `MEMORIES.md` in place;
- the app-compaction owner question;
- Responses forced-final placement;
- doc details (revision, nonce wording, SDK field, index links, class names,
  repair placement);
- unreproducible intermediate findings.

#### Code Review #1 Revisions

All verified against code, docs or data before fixing.

- **F1 (accepted):** Responses now sends the developer item before the user item
  on every turn, following D19 literally. Measured 0.80. No fingerprint state is
  needed, and context survives native compaction.
- **F2 (accepted):** full-history Responses requests use explicit breakpoints on
  the last two history user items. Phase 4 measures the share.
- **F3 (accepted):** escaping covers user text and all block contents.
- **F4 (accepted):** D20 keeps the summary directly after the stable
  instructions, and the doc states the trigger. The trigger itself is an open
  owner question, asked in Phase 4.
- **F5 (accepted):** the doc gains a Tools row and a corrected Attachment row.
  D20 first kept the tool list stable; Review #2 F2 showed that changes what
  the model sees, so D20 now accepts the misses instead.
- **F6 (accepted):** the doc gains an "OpenAI lookups" section and the
  `prompt_cache_key` scope, linked to the providers doc.
- **F7 (accepted):** the issue is republished from the spec right after the
  Phase 2 commit, so its ExecPlan link can point at that revision. The read-back
  and the snapshot metadata are recorded in a follow-up docs commit.
- **F8 (accepted):** every listed passage is updated. Phase 4 now covers the
  90,000 default, escaping, the stable tool list, breakpoints and the
  forced-final placement, with tests.
- **F9 (accepted):** the outcome now records the layout in D20, reaching the doc
  in Phase 4.
- **F10 (accepted):** commands, spend and the reproduction note are recorded.
- **Optional, accepted:**
  - harness comments, method string and docstring;
  - the README budget;
  - one gating rule (built-in OpenAI connection only);
  - local reuse marked unmeasured;
  - the `MEMORIES.md` rationale;
  - forced-final placement on Responses and Anthropic;
  - all doc details.
- **Optional, rejected:** ending the harness system prompt with the guardrails.
  The measured numbers are conservative, and the baseline test will measure the
  real assembly after Phase 4.

Repair budget: one of two rounds used.

#### Code Review #2 Findings

Targeted recheck. It verified F1–F3, F6–F10 and the optional fixes, and found
F4 and F5 only partly fixed.

- **P2-R2-F1 (blocking):** the Phase 2 review record had landed in the Phase 3
  section, and Phase 3's slots were lost.
- **P2-R2-F2 (blocking):** the stable tool list offered uploaded-file tools on
  turns without attachments. That changes model-facing content, which the spec
  excludes without an owner decision. Phase 4 step 3's "same text, new
  positions" was also no longer accurate.
- **P2-R2-F3 (blocking):** D20 did not place the compaction summary for rows
  without a developer role. Today's fold would put it after the closing
  guardrails.
- **Optional findings:**
  - stale gate status lines;
  - the Responses 0.80 run is a stand-in;
  - the harness docstring pointer.

#### Code Review #2 Revisions

- **R2-F1 (accepted):** moved the record to the end of Phase 2 and restored
  Phase 3's empty slots.
- **R2-F2 (accepted):** D20 leaves the tool list as today and accepts the misses
  on attachment turns. Phase 4 step 2 and its test were removed. Step 3 now
  names the three deliberate additions: the guardrails repeated in the stable
  instructions, the block description, and tag escaping.
- **R2-F3 (accepted):** without a developer role, the summary is folded into the
  system prompt just before the closing guardrails. Phase 4 has a test for it.
- **Optional, accepted:**
  - the status lines;
  - the D20 stand-in wording;
  - the `disable_memory_influence` wording (no map is sent; an empty map would
    have been new text).
- **Optional, rejected:** the harness docstring pointer. The plan remains the
  authoritative baseline record until Phase 4 rewrites the doc.

Repair budget: two of two rounds used. Review #3 is the final targeted recheck.

#### Code Review #3 Findings

Final targeted recheck. It verified R2-F2, R2-F3 and the optional items; ruff,
format and mypy passed and the harness skipped without keys.

- **P2-R3-F1 (blocking, record placement only):** moving the Review #2 record
  matched Phase 1's identical "Repair budget" line. That put Phase 2's Review #2
  record inside Phase 1 and altered one line of Phase 1's committed record.
- **Optional findings:**
  - the summary bullet's wrap and indentation;
  - an F8 note that the stable tool list was later reverted;
  - D20's wording about how the model reads a superseded map.

#### Code Review #3 Revisions

- **R3-F1 (fixed mechanically):** Phase 1 was restored and the record moved to
  the end of Phase 2. `diff` of the Phase 1 section against `HEAD` reports no
  differences, and the heading map shows each phase's own reviews.
- **Optional, accepted:** the summary bullet and the map wording.
- **Optional, rejected:** the F8 note. F5 and R2-F2 already record the
  reversal.

The repair budget was exhausted at Review #3. The only blocker it found was a
misplaced record, fixed and checked by a deterministic diff rather than a
further review. Per SDLC.md, Phase 2 completion awaits owner acknowledgement.

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

Phase record: issue #367; starting source `e7fd83e9`; commit `a94b820b`.

#### Code Review #1 Findings

Implementation by a delegated agent; review by an independent `sdlc-reviewer`
(full initial review of the working tree on `e7fd83e9`).

Checks run by the reviewer:

- focused tests: 138 passed;
- ruff, format, and mypy (706 files);
- the import-boundary check;
- `pnpm openapi-ts:check`;
- both compose configs and `bash -n reset.sh`.

It confirmed:

- every Phase 3 acceptance item;
- no Phase 4+ behaviour;
- clear failure with no OpenAI fallback (turn, Utility and Memory Manager
  paths);
- credential isolation;
- that the implementer's deviations are acceptable.

- **P3-R1-F1 (blocking):** a test depended on built-in flags left by earlier
  tests. Running two tests in order failed.
- **P3-R1-F2:** Anthropic owner rows accepted the `minimal` effort and
  `json_object` structured output.
- **P3-R1-F3:** `data-model.md` and `http-api.md` are now stale, and Phase 9 did
  not list them.
- **P3-R1-F4:** a malformed Models reply could raise outside the probe's error
  guard.
- **P3-R1-F5:** the SDK still merges `ANTHROPIC_CUSTOM_HEADERS`; the docstring
  overstated the isolation.
- **P3-R1-F6:** the `anthropic` preset carried misleading Chat Completions
  compatibility values.
- **P3-R1-F7:** an inline import duplicated a constant already available.
- **P3-R1-F8:** Anthropic rows could reach the application web-search tool in
  Phase 6 (D7).
- **P3-R1-F9:** Cloud adoption needs a hosted migration for `early_compaction`.
- **P3-R1-F10:** expected interim UI states until Phases 5 and 8
  (informational).

#### Code Review #1 Revisions

- **F1 (accepted):** the dependent test now clears rows first. The failing pair
  passes in order.
- **F2 (accepted):** `invalid_capabilities` for `json_object` and for efforts
  outside `ANTHROPIC_REASONING_EFFORTS`, with two new test cases.
- **F3 (accepted):** both docs added to Phase 9's list.
- **F4 (accepted):** report building is guarded, and returns a failed
  `available` step.
- **F5 (accepted):** the docstring is corrected. Animama never sets
  `ANTHROPIC_CUSTOM_HEADERS`.
- **F6 (accepted):** neutral compatibility values (no OpenAI extensions, no
  stream usage, reasoning `omit`). The first attempt landed on the OpenAI preset
  (see R2-F2); it was corrected in repair round 2.
- **F7 (accepted):** imports the constant from `model_provider_native_tools`.
- **F8 (accepted):** Phase 6 step 1 now forbids the application search tool on
  Anthropic rows.
- **F9 (accepted):** recorded under Final integration review for the PR.
- **F10:** no change.

Verification: focused tests (140) passed; the isolation pair passed; ruff,
format and mypy passed on the changed files. A full `make check-test` rerun
follows.

Repair budget: one of two rounds used.

#### Code Review #2 Findings

Targeted recheck. F1, F3, F4, F5 and F7–F9 were verified; 117 focused tests
passed. Two accepted fixes were wrong:

- **P3-R2-F1 (blocking):** the F2 check ran only when adding a model. An edit
  through `PATCH /v1/model-providers/{id}` skipped it. A scratch test stored
  `json_object` and `["minimal"]` with HTTP 200.
- **P3-R2-F2 (blocking):** the F6 edit matched the identical OpenAI preset entry
  first. That gave the built-in OpenAI preset neutral values, while the
  Anthropic preset and its seed row stayed unchanged: the seed reads the
  built-in connection, not the preset.
- **Optional findings:**
  - no test of the guarded probe path;
  - a stale `_owner_capabilities` docstring.

#### Code Review #2 Revisions

- **R2-F1 (accepted):**
  - `update_model` passes the row's provider type.
  - `provider_type` is now a required argument, so no call site can skip it.
  - Two PATCH test cases were added.
- **R2-F2 (accepted):**
  - The OpenAI preset was restored to defaults.
  - A new `ANTHROPIC_CONNECTION_COMPATIBILITY` is used by both the Anthropic
    preset and `builtin_anthropic_connection()`.
  - The seed was regenerated; its `anthropic` row now carries `reasoning_mode:
    omit` and no OpenAI extensions.
  - A test pins both connections' values.
- **Optional, accepted:** a probe test for a reply in an unexpected shape, and
  the corrected docstring.

Verification:

- 144 focused tests passed;
- ruff, format and mypy passed (181 files);
- a full `make check-test` on this tree runs alongside Review #3.

Repair budget: two of two rounds used. Review #3 is the final targeted recheck.

#### Code Review #3 Findings

Final targeted recheck: **pass**, with no findings.

- R2-F1 is verified: the Review #2 scratch PATCH now returns 400
  `invalid_capabilities`.
- R2-F2 is verified: the OpenAI preset and seed row are unchanged from the
  baseline, and the Anthropic preset and seed row carry the neutral values.
- Checks: 144 focused tests passed; ruff, format and mypy passed (274 files);
  the import-boundary check passed; `git diff --check` was clean.

#### Code Review #3 Revisions

None needed. Full `make check-test` on the final tree: audit, format, lint and
mypy pass; 3,327 passed and 22 skipped (live tests).

### Phase 4: Cache-friendly instruction assembly for every provider

Requirements: R11 (implementation and OpenAI-path measurements). It depends on
the Phase 2 owner decision.

Outcome: Responses and Chat Completions turns use the approved layout. Within a
chat, the cacheable prefix is byte-identical across turns while its inputs are
unchanged. The guardrails are still last, with unchanged wording, on every path.

1. Tag instruction parts by volatility class, so each provider strategy can
   order and place them as approved (D18).
   - Responses: stable `instructions`, plus a developer item before the user
     item on every turn (D20).
   - Chat Completions: system and developer roles, or the approved fallback for
     rows without a developer role.

   Keep shared assembly code where strategies coincide. Do not add a layer that
   no strategy needs.
2. Apply the D20 placement for `MEMORIES.md`, Gesture descriptors, the
   compaction summary, the memory map and attachments.
   - Escape `<turn_context` and `</turn_context` in user text and in block
     contents.
   - Add explicit breakpoints on the built-in OpenAI connection: on the system
     prompt and the last two assistant replies for Chat Completions, and on the
     last two history user items for Responses full-history requests.
   - Restate the guardrails at the end of forced-final and repair rounds.
   - Keep the current `prompt_cache_key` scoping.
   - Raise the Responses compaction default to 90,000 in `server/config.py`,
     `docker-compose.yml` and `docs/backend/operations/development.md`.
   - Make the app-compaction trigger `min(90_000, floor(0.7 × context
     window))`, with `ANIMAMA_CHAT_COMPACTION_THRESHOLD_TOKENS` as the cap
     (default 90,000), in config, compose and the development docs (D21).
3. Keep instruction content unchanged apart from three deliberate additions:
   - the guardrails repeated at the end of the stable instructions;
   - the short description of the `<turn_context>` block in the system prompt,
     on tagged paths;
   - escaping of forged tags.

   Everything else is the same text in new positions. Update the exact-prompt
   tests to the new layout, and add stability tests.
4. Rerun the Phase 1 harness for the OpenAI paths and record the **after**
   numbers.

Tests:

- Per path:
  - the guardrails are the final instruction text and byte-identical to
    `COMPANION_GUARDRAILS`;
  - the system and cacheable prefix are identical across two turns with a
    changed memory map;
  - a `MEMORIES.md` edit changes only what the recommendation says it may.
  - `<turn_context` tags are escaped in user text and block contents;
  - on rows without a developer role, the compaction summary sits in the system
    prompt before the closing guardrails;
  - breakpoints appear only on built-in OpenAI connection requests;
  - Responses sends a developer item before the user item on every turn, and
    the forced-final developer item after tool outputs;
  - the Responses compaction default is 90,000.
- Forced-final and repair rounds end with the guardrails.
- Rows without a developer role follow the approved fallback.
- Every existing safety, structured-recovery and executor test passes.

Checks:

- `make check-test`
- live `test_prompt_cache_layout.py` for the OpenAI paths, within budget

Completion: tests pass; the OpenAI share does not fall and rises where layout
was the cause; review leaves no blocker. If a path regresses, revise the layout,
or return to the owner when the fix needs a different placement.

Phase record: issue #368; starting source `a94b820b`; commit `9330838a`.

Implementation (delegated agent, reviewed independently):

- **Assembler:** `app/chat/openai_prompt.py` implements the D20 layout, and
  `_fold_developer_messages_into_system` is gone.
- **Chat Completions adapter:** explicit breakpoints on the built-in OpenAI
  connection with a developer role.
- **Responses adapter:** `instructions` holds only the stable system text; a
  developer item goes before the user item every turn; with a cursor only new
  items are sent; full-history requests get breakpoints on the last two
  history user items.
- **Compaction:** the Responses default is 90,000. The app-compaction trigger
  is in `context_budget.py`, with a config cap of 90,000.
- **Docs:** `prompt-caching.md` rewritten (Turn layout section); placement and
  defaults updated in `model-client-providers.md`, `chat.md`, `http-api.md`,
  `features/memory.md`, `model-catalog.md`, `local-models.md` and
  `development.md`.
- **Tests:** new `tests/test_turn_instruction_layout.py` (22) and
  `test_context_budget.py` additions; the layout tests are updated.

Live after-measurement (real assembly through the real adapters, source
`a94b820b-dirty`, 2026-10-09, after the review fixes), mean cached share for
turns 2–6:

| Path | Phase 1 baseline | After |
| --- | --- | --- |
| Responses with a cursor | 0.00 | 0.90 |
| Responses without a cursor (`store: false`) | 0.00 | 0.68 (the second request always misses) |
| Chat Completions, developer role | 0.65 | 0.87 |
| Chat Completions, no developer role (tagged block) | 0.00 | 0.84 (system prompt only on OpenAI) |

No OpenAI path fell. The Anthropic line in this harness is still the naive
mapping; Phase 5 replaces it.

Command:
`ANIMAMA_RUN_LIVE_TESTS=1 uv run --env-file "$HOME/.config/animama/dev-secrets.env" pytest -q -s tests/live/test_prompt_cache_layout.py::test_measure_prompt_cache_share_per_provider_path`.

#### Code Review #1 Findings

Independent `sdlc-reviewer`, full initial review of the working tree on
`a94b820b`.

It verified:

- guardrails last on every path, including forced-final and repair;
- nothing persisted beyond today's user text and tool rows;
- the Responses cursor, tool-continuation and stale-cursor flows;
- breakpoint gating;
- the compaction wiring;
- unchanged user text on developer-role paths.

Checks: 252 focused tests passed; ruff, format and mypy passed; the import
boundary was clean; the compose config was valid.

- **P4-R1-F1 (blocking):** the harness's no-developer-role row still declared a
  developer role on the built-in connection. The adapter therefore sent
  breakpoints, and the published 0.87 for the tagged path measured a shape
  production never sends. The local row would also have sent breakpoint fields.
- **P4-R1-F2 (blocking, record only):** the app-compaction trigger adds a third
  bound beyond D21's formula without a recorded decision.
- **Optional findings:**
  - **F3:** config-default tests read the import-time environment.
  - **F4:** `prompt_instruction_text` has no production caller.
  - **F5:** the fold option's UI label now overstates what it does.
  - **F6:** pre-existing: the stale-cursor rebuild omitted the Gesture list.
  - **F7:** the tag escape misses format-character variants.
  - **F8:** ADR 0008 is stale until Phase 9.
  - **F9:** breakpoints follow the built-in connection, even when
    `OPENAI_BASE_URL` points it elsewhere.
  - **F10:** a dangling sentence in `chat.md`.

#### Code Review #1 Revisions

- **F1 (accepted):**
  - The harness rows now declare `supports_developer_role` as production does,
    and the local row uses a non-built-in connection.
  - Live re-measure: the tagged path is 0.84, reusing the system prompt only on
    OpenAI.
  - The doc and plan numbers and text are corrected.
- **F2 (accepted, recorded):** the bound is recorded under D21 with its
  rationale. It only makes the trigger earlier.
- **F3 (rejected):** the root conftest deletes inherited `ANIMAMA_*` variables
  before `animama.server.config` is imported, so operator values cannot reach
  these tests.
- **F4 (deferred, optional):** the cleanup is left for later, because tests
  still use the helper.
- **F5 (accepted):** added as Phase 8 step 6.
- **F6 (accepted, fixed):**
  - A new shared `gesture_response_guidance` is used by the executor and the
    stale-cursor rebuild.
  - A failing test was written first: the stale retry now keeps the Gesture
    list, and the system prompt is byte-identical.
- **F7 (deferred, optional):** a literal-tag escape meets D20.
- **F8:** Phase 9, as planned.
- **F9 (accepted):** an operations note added to `prompt-caching.md`.
- **F10 (accepted):** the sentence is fixed.

Verification: executor and layout tests (112) passed; ruff, format and mypy
passed; full `make check-test` follows with Review #2.

Repair budget: one of two rounds used.

#### Code Review #2 Findings

Targeted recheck. It verified F1, F2, F3 (the rejection holds), F5, F6, F9 and
F10. Checks: 150 focused tests passed; ruff, format and mypy passed; the import
boundary was clean.

- **P4-R2-F1 (blocking, regression from F1):** the local row named
  `local-harness` without a loaded connection, so
  `connection_for_model_provider` raised `connection_unavailable` before any
  request.
- **P4-R2-F2:** the Responses-without-cursor mean was double-rounded to 0.69;
  it is 0.68.
- **P4-R2-F3:** the harness docstring still said every row names the built-in
  connection.

#### Code Review #2 Revisions

- **R2-F1 (accepted):** the local row carries a loaded owner `ModelConnection`
  (`local-harness`, preset `custom`, the Ollama preset's options: folded
  developer role, no OpenAI extensions). An offline check resolves its
  connection, with `accepts_developer_role` false.
- **R2-F2 (accepted):** 0.68 in the doc and the plan.
- **R2-F3 (accepted):** the docstring is corrected.

Repair budget: two of two rounds used. Review #3 is the final targeted recheck.

#### Code Review #3 Findings

Final targeted recheck: **pass**, with no findings.

- An offline run showed the local row now resolves its connection and fails
  only at the network.
- Request shapes are confirmed:
  - built-in developer row: breakpoints and `prompt_cache_key`;
  - built-in row without a developer role: `prompt_cache_key`, no
    breakpoints;
  - local row: neither.
- 0.68 and the docstring are verified.

#### Code Review #3 Revisions

None needed. Full `make check-test` on the final tree passes audit, format,
lint and mypy, with 3,352 passed and 22 skipped (live tests). The run started
before the harness-only Review #2 edits; those files pass ruff, format and mypy
and skip without keys.

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
     history message, and a mid-conversation `system` message after the latest
     user turn carrying the turn context and guardrails (D20, D21).
   - Memory tools: `{name, description, input_schema, strict: true}`, with
     `tool_choice: auto` and `disable_parallel_tool_use: true`.
   - Structured output goes in `output_config.format`.
   - Effort per D6, D16 and D22. Chat with no setting uses `medium` (D22).
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
  - effort and thinking mapping, including the D22 chat default;
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

Phase record: issue #369; starting source `9330838a`; commit `929acfbe`.

Implementation (delegated agent, reviewed independently):

- **Adapter** `adapters/model_clients/anthropic_messages/`
  (`client`, `request`, `events`, `final`, `errors`):
  - It streams through `client.messages.stream`, with one SDK client per key
    digest, and serves only the built-in `anthropic` connection.
  - It retries once, only before any text has streamed.
  - A stream that ends before `message_stop` fails with
    `anthropic_stream_incomplete`.
  - A refusal raises `model_refused` with its `stop_details` category.
- **App:**
  - Anthropic tool item types.
  - `ModelClientFinal.continuation`, which carries the turn's messages to the
    collector and is never persisted.
  - Anthropic hidden rows and `data.anthropic`.
  - Forced-final and repair keep the tools and set `tool_choice: none`, so the
    signed thinking and the cache stay valid.
  - R12 variants in `app/chat/anthropic_instructions.py`, with an
    `instruction_style` in the assembler.
- **Interim placement:** an app-compaction summary is folded into the system
  text just before the closing guardrails. Phase 6 removes app compaction for
  Anthropic.
- **Ordering rule beyond D20:** a within-turn instruction with no reply before
  it joins the turn-context system message. A system message must be last or
  followed by an assistant turn, and nothing earlier is edited.
- **Deviation:** no per-turn output limit exists in code, so each request is
  capped at 64,000 output tokens (thinking included), or the row's lower limit.
  The cap does not count against Anthropic's output rate limit.
- **Tests:**
  - `tests/anthropic_fakes.py`;
  - `tests/test_anthropic_messages_client.py` (44);
  - `tests/test_anthropic_direct_chat.py` (13, executor plus the real
    adapter);
  - route tests in `tests/test_anthropic_model_provider.py`.

Live results (owner-authorized, 2026-10-09):

- **Command:**
  `ANIMAMA_RUN_LIVE_TESTS=1 uv run --env-file "$HOME/.config/animama/dev-secrets.env" pytest -q -s tests/live/test_anthropic_direct_turn.py tests/live/test_prompt_cache_layout.py::test_measure_prompt_cache_share_per_provider_path tests/live/test_anthropic_messages_contract.py`.
  The second run passed 12 of 12.
- **Cache share, Anthropic through the real adapter:** 0.88 (0, 0.88, 0.876,
  0.88, 0.881, 0.887). The OpenAI paths were unchanged from Phase 4.
- **Direct-turn smoke:**
  - A structured turn streamed incrementally.
  - A tool round resent `thinking` and `tool_use` and ended `end_turn`.
  - The next turn, rebuilt from stored rows, was accepted.
- **Contract checks:** all 10 passed.
- **First run:** the harness dropped the Anthropic assistant history, which
  made its 0.891 invalid. That was fixed.
- **Effort finding:** at effort `low`, Haiku 5.5 made a needed memory-tool call
  in only 1 of 5 attempts, against 5 of 5 at `medium`. This led to the owner's
  D22.

#### Code Review #1 Findings

Independent `sdlc-reviewer`, full initial review of the working tree on
`9330838a`.

No correctness defects were found. The reviewer verified:

- the D20/D21 mapping;
- ordering on every after-turn path, against Anthropic's current docs;
- byte-exact within-turn rounds;
- D8 persistence;
- D12 refusals and errors;
- usage;
- credentials;
- R12 directive parity;
- no OpenAI regressions.

Checks: 282 focused tests and 57 OpenAI regression tests passed; ruff, format
and mypy passed on 44 files; the import boundary was clean.

- **P5-R1-F1 (blocking):** the chat effort default was still `low`, against
  D22.
- **P5-R1-F2 (blocking, record):** the plan did not record Phase 5.
- **Optional findings:**
  - **F3:** web search does nothing on Anthropic rows until Phase 6.
  - **F4:** a refusal on the repair request falls back to the invalid reply,
    which is existing repair behaviour.
  - **F5:** the new `<anima_identity>` and `<anima_memories>` tags are not
    escaped.
  - **F6:** `support.py` loads the whole chat package for one constant;
    duplicated helpers.
  - **F7:** the parity markers miss three directives.
  - **F8:** two imprecise doc sentences.
  - **F9:** minor items: the output reserve against the cap, no retry for an
    incomplete stream, a log field name, idle clients, and request-building
    errors outside the try.

#### Code Review #1 Revisions

- **F1 (accepted):** `DEFAULT_ANTHROPIC_CHAT_EFFORT = "medium"`. Tests, the
  live-smoke comment, `model-client-providers.md` and this plan's step 2 and
  tests are updated.
- **F2 (accepted):** the implementation, deviations and live results are
  recorded above.
- **F3 (accepted as interim):** Phase 6 lands before the PR.
- **F4 (rejected):** this is the repair behaviour shared by every provider. The
  original reply was already produced, and R9 covers the primary request.
- **F5 (accepted):** `_escape_tags` escapes `<anima_identity` and
  `<anima_memories` (any case) inside owner text, with a test.
- **F6 (partly accepted):** `support.py` imports the constant from
  `model_provider_native_tools`. Deduplicating the helpers is deferred.
- **F7 (accepted):** three markers added. The Anthropic gesture line now uses
  the shared phrase "if there is no suitable gesture".
- **F8 (accepted):** both doc sentences are fixed.
- **F9 (deferred, optional):** minor, and none affects correctness.

Verification: 231 focused tests passed; ruff, format and mypy passed on 31
files. A full `make check-test` follows with Review #2.

Repair budget: one of two rounds used.

#### Code Review #2 Findings

Targeted recheck. It verified F1–F8 and accepted the F4 rejection and the F9
deferral. Checks: 193 focused tests passed; ruff, format and mypy passed; the
import boundary was clean; an isolated import confirmed the adapter no longer
loads `animama.app.chat`.

- **P5-R2-F1 (blocking, documentation):** the `effort_and_thinking` docstring
  still said `low` (D16).
- **Optional findings:**
  - point the spec's dated `low` record at D22;
  - Phase 9 should say "D16/D22";
  - the "explicit setting wins" test case now equals the default;
  - `_escape_turn_context_tags` could reuse `_escape_tags`.

#### Code Review #2 Revisions

- **R2-F1 (accepted):** the docstring cites D22 and `medium`.
- **Optional, accepted:**
  - the spec pointer and the Phase 9 wording;
  - the explicit case now uses `low`;
  - `_escape_turn_context_tags` reuses `_escape_tags`, and the unused regex is
    removed.

Verification: 103 focused tests passed (80 adapter and direct-chat, 23
layout); ruff, format and mypy passed.

Repair budget: two of two rounds used. Review #3 is the final targeted recheck.

#### Code Review #3 Findings

Final targeted recheck: **pass**, with no findings.

- The R2-F1 docstring is fixed.
- The explicit-effort test is fixed.
- The shared escaping is character-for-character equivalent.
- The spec and Phase 9 wording are updated.
- Checks: 195 focused tests passed; ruff, format and mypy passed.

#### Code Review #3 Revisions

None needed. Full `make check-test` (started after the Review #1 repairs)
passes audit, format, lint and mypy, with 3,415 passed and 24 skipped (live
tests). The later repair-2 edits are a docstring, a test case and a helper
reuse, and their focused tests pass.

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
   - Never offer the application Brave/SearXNG tool on an Anthropic row (D7),
     including owner rows without native web search. Phase 3 added Anthropic
     to `DIRECT_MEMORY_TOOL_SUPPORT_BY_PROVIDER`, which otherwise enables it.
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
- Trigger of 90,000 for Haiku with **Compact early** on, 150,000 with it off,
  and 150,000 for an unpriced owner row.
- Compaction events.
- Compaction block persistence and replay.
- No app compaction for Anthropic chats, and Chat Completions unchanged.

Checks: focused tests, `make check-test`, both compose config commands, and the
live contract test.

Completion: tests pass; review leaves no blocker.

Phase record: issue #370; starting source `929acfbe`; commit `4eb9b0a9`.

Implementation (delegated agent, reviewed independently):

- **Requests:**
  - Every Anthropic request uses the beta messages stream with
    `compact-2026-01-12` and `compact_20260112` (`pause_after_compaction:
    false`).
  - The trigger follows D4, revised: 90,000 for Haiku with **Compact early**
    on, otherwise 150,000.
  - With web search on and supported, requests add `web_search_20250305` with
    `max_uses` 5 and `allowed_callers: ["direct"]`.
  - `pause_turn` resends the round's content unchanged, at most 3 times.
- **Statuses and data:**
  - `searching_web` and `summarizing_context` arrive as `run_status` deltas.
    Open statuses are finished before a retry, before the final and at turn
    end, even on failure.
  - `data.anthropic` gains `native_tool_summaries`, `citations` (url, title,
    and a short `cited_text` excerpt, which Anthropic limits to 150
    characters), `pause_turn_continuations` and a turn-wide
    `web_search_requests`.
- **Storage and replay:**
  - Stored assistant content is `[compaction?, text]`.
  - Replay starts at the newest visible assistant row with a compaction block
    (no 200-row limit; JSONB `content[0].type`), and `cache_control` is added
    to that block when the request is built.
  - Anthropic chats skip app compaction and pre-send fitting.
  - Anthropic rows never get the application search tool (closes P3-R1-F8).

Deviations:

- **App-summary folding removed.** The Phase 5 interim folding is gone, and
  Anthropic replay ignores `chat_compactions`: app compaction never runs for
  Anthropic chats.
- **Compaction on every Anthropic request**, including Utility prompts. Phase 7
  decides whether Utility omits it (P6-R1-F4).
- **Replay start.** Replay starts at the compacting assistant row, so that
  turn's tool exchanges are not replayed. The API ignores everything before
  the block.
- **Repair.** A repair request does not carry the invalid round's compaction or
  searches (P6-R1-F2, as on Responses).
- **No user-message breakpoint.** In the live tool round only 888 of 6,086
  input tokens were uncached.
- **`cache_control` on the compaction block** is added at request time, not
  stored (equivalent).
- **`pause_turn`** was verified offline only; the live search did not pause.

Tests: new `tests/test_anthropic_search_and_compaction.py` (22), two
database-backed replay-start tests in `tests/test_chat_manager.py`, and fake-SDK
extensions.

Checks: `make check-test` (implementer) passed audit, format, lint and mypy,
with 3,438 passed and 26 skipped; both compose configs were valid.

Live (owner-authorized, 2026-10-09):

- **Command:** `tests/live/test_anthropic_direct_turn.py`, 4 passed. The
  run-in-turn tests:
  - **Web search:** a web-search turn made one search, with
    `searching_web` started and finished.
  - **Compaction:** a compaction turn at the 50,000 minimum gave
    `summarizing_context` started and finished, stored `[compaction, text]` and
    `context_tokens` of 5,728.
  - **Follow-up:** a turn replayed from the block was accepted, with 6,245
    input tokens, 5,198 of them cached.
- **Spend:** about US$0.05.
- The live contract test was rerun at review (see Review #1 Revisions).

#### Code Review #1 Findings

Independent `sdlc-reviewer`, full initial review of the working tree on
`929acfbe`.

No code defects were found. The reviewer verified:

- the API usage against SDK 1.12.1 types;
- no application search on Anthropic rows;
- the breakpoint budget (at most 3);
- ordering on pause resends;
- persistence with no thinking or encrypted search content;
- the replay start;
- status pairing;
- usage;
- that the other providers are unchanged.

Checks: 394 focused tests passed (including the database replay tests); ruff,
format and mypy passed; the import boundary was clean.

- **P6-R1-F1 (blocking, record):** the Phase 6 record was missing, and the live
  contract test listed in Checks was not run.
- **Optional findings:**
  - **F2:** repair drops the invalid round's search record and compacts again.
  - **F3:** `usage.web_search_requests` covers only the final round.
  - **F4:** compaction on Utility requests (Phase 7).
  - **F5:** repeated block-type constants.
  - **F6:** a docstring overstates "never kept".
  - **F7:** no test of the request shape on later pauses.
  - **F8, F9:** informational: server summaries cover the turn context;
    `data-model.md` is queued for Phase 9; Phase 5 development chats lose
    their app summary.

#### Code Review #1 Revisions

- **F1 (accepted):** the record is above, and the live contract test was rerun
  on 2026-10-09 with the direct-turn tests: 13 passed.
  - All 10 contract checks still hold.
  - It reconfirms D7: basic search 6.96 s and 14,530 tokens median; dynamic
    13.11 s and 28,267 tokens.
- **F2 (deferred):** repair is rare and matches Responses behaviour. Recorded as
  a known limitation.
- **F3 (accepted):** the turn-wide `data.anthropic.web_search_requests` counts
  successful searches, with tests.
- **F4:** carried to Phase 7. Decide whether Utility requests omit
  `context_management`.
- **F5 (deferred, optional):** DRY cleanup.
- **F6 (accepted):** the docstring now notes the `cited_text` excerpt.
- **F7 (accepted):** the pause test asserts each resume resends the prefix
  unchanged, with every paused round's server tool blocks merged into one
  trailing assistant message.
- **F8, F9:** no change.

Verification: 78 focused tests passed (search and compaction, adapter, direct
chat); ruff and format passed.

Repair budget: one of two rounds used.

#### Code Review #2 Findings

Targeted recheck: **pass**. It verified F1, F3, F6 and F7 and accepted the F2,
F4 and F5 dispositions. Checks: 78 focused tests passed; ruff, format and mypy
passed.

- **P6-R2-F1 (optional):** document the turn-wide `web_search_requests`
  alongside the per-round usage field.
- **P6-R2-F2 (optional):** the 150-character limit on `cited_text` comes from
  Anthropic, not the app.

#### Code Review #2 Revisions

- **R2-F1 (accepted):** `model-client-providers.md` now distinguishes the
  round's usage from the turn's billed searches.
- **R2-F2 (accepted):** the plan wording is corrected.

Final `make check-test` on this tree: audit, format, lint and mypy pass; 3,438
passed and 26 skipped (live tests). The doc and plan wording edits came after
it started and touch no code.

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
   - Decide whether Utility requests omit `context_management` (P6-R1-F4). A
     large summarization input above the trigger would otherwise be compacted
     by the server first.
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

Phase record: issue #371; starting source `4eb9b0a9`; commit `b7649699`.

Implementation (delegated agent, reviewed independently):

- **Utility:** a `utility_task` provider option marks Utility prompts; on
  Anthropic they use effort `low` and no compaction (D23).
- **Selector:** `runtime_selector.py` (`MemoryManagerRuntimeSelector`) chooses
  by provider type, and `for_run` resolves the pinned row's own runtime. The
  OpenAI runtime refuses Anthropic rows.
- **Memory tool handler:** `anthropic_memory_tool.py` (`AnthropicMemoryToolHandler`):
  - maps `/memories` paths and refuses traversal variants;
  - applies the existing normalization, `ManagerFileAccess` scope and
    protected paths;
  - `view` gives a listing or a line-numbered file, with `view_range` and a
    16,000-character cut;
  - `create`, `str_replace` and `insert` become approvals through the new
    `workspace.plan_target_content`, fenced by the version the edit was
    computed from;
  - `delete` and `rename` are refused.
- **Runtime:** `anthropic_runtime.py` (`AnthropicMemoryManagerRuntime`) is a
  Client SDK loop:
  - effort `medium`, adaptive thinking, no compaction, cached system prompt;
  - instructions that forbid progress and scratch notes;
  - refusals and errors end the run `failed` with category metadata;
  - one transient retry.
- **Shared code:** `runtime_support.py` holds the turn budget and rejection
  text for both runtimes. The Reflection and episode wording gains a
  memory-tool variant; the OpenAI text is byte-identical.

Deviations:

- **Stored state includes the system prompt.** `serialized_agent_state` also
  stores `system`, because Haiku 5.5 rejects stored thinking if anything before
  it changes, and the memory map in the prompt changes after an approved
  create.
- **Turn budget across resumes.** The first pass counted turns across resumes,
  matching the OpenAI Agents SDK (`RunState._current_turn`). The owner then
  decided D24: the budget resets on each resume, for both runtimes. This is
  implemented in the Review #1 repair.
- **One tool call per response** was first used, then removed in repair (see
  Review #1).

Tests (first pass):

- `tests/test_anthropic_utility.py` (4);
- `tests/test_anthropic_memory_tool.py` (29);
- `tests/test_anthropic_memory_manager.py` (18);
- the router test parametrized for both runtimes.

Checks: `make check-test` (implementer) passed audit, format, lint and mypy,
with 3,490 passed and 27 skipped.

Live (owner-authorized, 2026-10-09): `tests/live/test_anthropic_memory_manager.py`
passed.

- Start took 3 requests (view, view, insert) and produced one update approval.
- Approval from a fresh service committed, then resumed to completion in 1
  request.
- No progress or scratch paths; about 13,600 input and 400 output tokens.

Quality note for the Phase 9 smoke: Haiku recorded a new preference in
`notes/preferences.md` and left a contradicting older `PROFILE.md` line in
place. Prompt review was deferred to Phase 9.

#### Code Review #1 Findings

Independent `sdlc-reviewer`, full initial review of the working tree on
`4eb9b0a9`.

It verified:

- path handling, including probed encodings;
- scope and the version fence;
- no writes without approval;
- the persisted state and resume;
- rejection;
- Reflection coverage;
- the selector and the OpenAI refactor;
- Utility;
- credentials and logging.

Checks: 468 focused tests passed; ruff, format and mypy passed; the import
boundary was clean.

- **P7-R1-F1 (blocking, record):** the plan was not updated, and the
  Utility decision and three deviations were unrecorded.
- **P7-R1-F2 (blocking, R8 parity):** one tool call per response spends the
  shared 8-request budget on single reads. A general "update four files"
  request, or episode batches with searches, can end blocked or failed where
  the OpenAI runtime completes. The OpenAI runtime batches reads and does not
  disable parallel calls.
- **Optional findings:**
  - the automatic chain ending failed at the budget (doc wording, owner
    question);
  - directory `view` lists `episodes/**`;
  - file views load the whole tree;
  - failure metadata names the selector's runtime;
  - small duplication;
  - mixed path spellings in error text;
  - doc wording on empty segments;
  - no undo or episode end-to-end test for the Anthropic runtime.

#### Code Review #1 Revisions

- **F1 (accepted):** this record, D23 and the deviations above.
- **F2 (accepted):** parallel tool use is allowed. Only one edit may be pending
  per response; later edits in the same response are refused with a reason.
  Sibling results are merged in order on resume. Tests were added (see repair
  results below).
- **Optional items:** sent to the implementer with F2: protected entries out of
  directory listings, the tree built only for directory views, the runtime
  named in failure metadata, the doc wording, and undo and episode tests.

Repair results, including D24 (all behaviour changes test-first):

- **F2:**
  - `tool_choice: auto` without `disable_parallel_tool_use`.
  - A later edit in the same response is refused; on resume the pending
    result is placed in call order.
  - Tests: parallel view, edit, view resuming in call order; a second edit
    refused.
- **Optional items:**
  - directory listings omit protected entries;
  - file views skip the listing queries;
  - failure metadata names the runtime that ran the resume (tested);
  - doc wording;
  - an Anthropic-created approval can be undone (tested);
  - an episode batch is curated through the memory tool and processed (tested).
- **D24 on Anthropic:** each start or resume counts turns from 0;
  `turns_used` is kept only as a diagnostic. An 8-change automatic chain
  completes in 9 requests, and a single step over the budget still blocks.
- **D24 on OpenAI:**
  - In openai-agents 0.18, `Runner.run` on a `RunState` ignores the
    `max_turns` argument and uses the state's own limit and current turn, so
    the `max_turns` passed on resume had never taken effect.
  - `OpenAIAgentsRunner.load_state(turn_budget=...)` writes
    `max_turns = current_turn + budget` into the snapshot that
    `RunState.from_json` reads. That is the public snapshot path; no private
    attributes are used.
  - A real-SDK test with a fake model shows a turn-8-of-8 state completes with
    the fresh budget and fails without it.
  - An end-to-end test applies 8 automatic changes and the run completes after
    9 model calls.

Checks: `make check-test` passed audit, format, lint and mypy, with 3,499
passed and 27 skipped.

Live: `tests/live/test_anthropic_memory_manager.py` passed.

- Start took 2 requests (parallel `view`, `view`, then `insert`) instead of 3,
  and produced one update approval.
- Resume from a fresh service took 1 request.
- No progress paths; about 10,400 input and 414 output tokens.

Repair budget: one of two rounds used.

#### Code Review #2 Findings

Targeted recheck: **pass**.

- It verified F1, F2 and all the optional items.
- It verified D24 on both runtimes against the openai-agents 0.18.0 source:
  the snapshot fields, approve and reject running after load, no turn spent on
  resume, and no unbounded loop.
- Checks: 283 focused tests passed; ruff, format and mypy passed; the import
  boundary was clean.
- Optional notes:
  - path wording around `/memories//x.md`;
  - `view /memories/episodes` reports "does not exist", matching OpenAI's
    hidden list;
  - the `max_turns` argument on OpenAI resume is now inert.

#### Code Review #2 Revisions

- The path wording is corrected in the docstring and the feature doc.
- The other notes are left as they are: the episodes behaviour matches OpenAI,
  and the inert argument is documented in the runner.

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
6. Correct the "Merge developer instructions into the system message" label and
   help text (`ModelConnectionDialog.tsx`; `fold_developer_role` docstring in
   `domain/model_connection.py`). Since Phase 4 that option sends the turn
   context as a tagged block in the user message, and merges only the
   compaction summary and within-turn instructions.

Checks:

- `pnpm check`, `pnpm web:lint`, `pnpm web:test`, `pnpm build` and
  `pnpm desktop:check`
- `pnpm e2e:test:fast` on a disposable built task stack
- a visual check of API Keys and Models settings at desktop viewport, then
  narrow, on the skip stack

Completion: checks pass; the visual check matches existing styling; review
leaves no blocker.

Phase record: issue #372; starting source `b7649699`; commit: this phase's commit (see git log for `[p8]`).

Implementation (delegated agent, reviewed independently):

- **Desktop key:** `credentialProviders` and the vault gain `anthropic`, mapped
  to `ANTHROPIC_API_KEY`, and `DesktopCredentialsPanel` gains an Anthropic
  entry.
- **Models settings:**
  - an Anthropic cloud tab, with built-ins placed by preset;
  - per-connection key controls on built-in cards;
  - "Anthropic Messages" as the API label, and a "Built-in search" chip.
- **`OwnerModelDialog` on the Anthropic connection:**
  - the API is fixed and only chat models can be added;
  - JSON mode is not offered, and only Anthropic templates are listed;
  - Haiku 5.5 is the preselected template;
  - "Test model" uses the Models API probe.
- **Compact early:** an `EarlyCompactionSwitch` in model details, shown when
  `early_compaction` is not null.
- **Chat copy:** `chat-failure.ts` gains copy for `model_refused` and the
  `anthropic_*` codes.
- **Fold option:** relabelled "Send no developer messages", with corrected help
  text and docstring (step 6).
- **Setup:** setup finds the OpenAI built-in by preset.

Deviations:

- **Preselection:** "Preselect Haiku 5.5 when the Anthropic connection is
  chosen" is the preselected template in the Add model dialog, because no
  picker chooses a connection first. The owner accepted this (D25).
- **Setup:** the first pass did not offer Anthropic; the owner then decided it
  should (D25).
- **Tab padding:** provider tabs use `px-2` (was `px-4`) so six Cloud tabs fit
  at 1440 px.
- **Logo:** none was shipped in the first pass (D14). The owner then approved
  models.dev's logo (D25).

Checks (first pass):

- `pnpm check`, `web:lint`, `desktop:check`, `prettier:check` and `build`
  pass.
- `desktop:test`: 468 passed.
- `web:test`: 3,220 passed and 4 failed. The failures are environmental:
  `tests/local-api-proxy.test.ts` cannot bind port 5173, held by another
  task's process, and Vite maps `port: 0` to 5173.
- `e2e:test:fast`: 36 passed on the disposable built stack
  `animama-anthropic-e2e`.
- `make check-test`: 3,499 passed.
- Visual check at 1440×900 and 900×800 on
  `http://animama-anthropic.localhost:8820` (skip mode).

#### Code Review #1 Findings

Independent `sdlc-reviewer`, full initial review of the working tree on
`b7649699`.

It verified:

- the credential flow;
- the generalized built-in cards and tab placement;
- the dialog rules against backend validation, apart from F1;
- the Compact early switch;
- the refusal copy;
- the fold relabel;
- the setup change;
- D14.

Checks: type checks, 136 changed web tests and 127 desktop tests passed; lint
and prettier passed. The 4 proxy failures are environmental.

- **P8-R1-F1 (blocking):** after a successful Anthropic probe, the template's
  efforts and structured-output transport leak into the draft when the report
  has none. A model without effort or structured outputs would be saved
  advertising them.
- **P8-R1-F2 (blocking, documentation):** the desktop-runtime,
  local-http-components and Electron guide docs still list only the OpenAI and
  ElevenLabs keys.
- **P8-R1-F3 (blocking, record):** the Phase 8 record and deviations were
  missing.
- **Optional findings:**
  - no tests for the Compact early switch or the Anthropic dialog mode;
  - no desktop-backend key parity test;
  - `chat.md` overstated the `anthropic_*` copy;
  - smaller notes on downgrade, duplication and dead code.

#### Code Review #1 Revisions

- **F3 (accepted):** this record; D25 records the owner's answers.
- **F1, F2 and the optional tests and doc wording:** sent to the implementer
  together with D25 (the setup Anthropic option and the models.dev logo).

Repair results (uncommitted, on `b7649699`):

- **F1:** fixed. A pure `draftAfterProbe` helper replaces `templateAfterProbe`.
  - After a successful Anthropic Models API probe, the template is cleared.
    Efforts become `supported_reasoning_efforts ?? []`, and structured output
    takes the report's transport, or null if the report has none.
  - A failed probe keeps the template, and OpenAI and owner merges are
    unchanged.
  - Unit tests cover every case. A live probe of `claude-haiku-4-5-20251001`
    saved null efforts, no template and a 200,000-token window.
- **F2:** fixed.
  - `desktop-runtime.md` and `local-http-components.md` list
    `ANTHROPIC_API_KEY`, and `electron-guide.md` lists the Anthropic key.
  - `chat.md` now says only the `anthropic_*` codes with an OpenAI counterpart
    reuse its copy.
- **Optional tests:** done.
  - `OwnerModelDialog.test.tsx` adds 7 tests for the Compact early switch and
    the Anthropic dialog mode.
  - The vault parity test in `tests/test_desktop_credentials_route.py` now
    covers OpenAI, Anthropic and ElevenLabs.
- **D25(a), setup:** the first-run AI step has an Anthropic tab.
  - On desktop it has a key panel; on web it shows the `ANTHROPIC_API_KEY`
    line.
  - "Use Anthropic" (Haiku 5.5) is enabled only once the key exists, and
    saving the key chooses Haiku when nothing is chosen yet.
  - OpenAI behaviour is unchanged. Unit and setup browser tests cover it.
- **D25(b), logo:** `provider-logos/anthropic.svg` comes from models.dev
  `providers/anthropic/logo.svg` at the pinned revision, unmodified.
  - It is a single `currentColor` path. The MIT licence is byte-identical to
    the bundled one.
  - Provenance is recorded in the logo README and in the `license-sources.json`
    group `model-provider-logos`, which now lists ten files.
  - It is registered in `PROVIDER_LOGOS`.
  - The desktop notice inventory is produced at staging and its hash is bound
    in `release-policy.json`, so the owner re-reviews it before a release.
- **Checks after the repair:**
  - `prettier:check`, `check`, `web:lint`, `desktop:check` and `build` pass.
  - `desktop:test`: 468 passed.
  - `web:test`: 3,233 passed, plus the same 4 environmental port-5173
    failures.
  - Browser tests: 39 of 39 passed.
  - `make audit-typed-content format-check lint mypy` passes.
  - The `e2e:test:fast` and `make check-test` reruns could not finish: OrbStack
    stopped responding (Helper at about 750% CPU; `docker version` timed out).
    They are to be repeated after recovery.
  - Visual check at 1440×900 on a fresh no-key setup stack and on the dev
    stack: setup tabs, disabled choices with hints, and the Anthropic logo on
    the card and in the picker.

#### Code Review #2 Findings

Independent `sdlc-reviewer`, repair round 1. It reviewed the uncommitted tree
on `b7649699`, covering F1–F3, D25 and the optional tests.

**Result: pass, with no blocking findings.**

Verified:

- **F1 and F2:** fixed. The reviewer checked `chat.md` against
  `chat-failure.ts`.
- **F3:** the record is complete.
- **D25 setup:** Haiku is chosen only from the visible built-in Anthropic
  connection. OpenAI is unchanged and is the only Recommended choice.
- **D25 logo:** the file is byte-identical to models.dev at the pinned
  revision. The SVG has no script, style or external reference.
- **Release:** the `license-sources.json` change invalidates the
  `release-policy.json` inventory hashes, so the owner re-reviews them before a
  release, as recorded.

Checks run by the reviewer:

- type checks for web, desktop and product-ui;
- 165 targeted web tests;
- 20 of 20 setup browser tests;
- 196 desktop runtime tests;
- `web:lint`, `prettier:check`, the parity test and `ruff`.

Non-blocking findings:

- **Both keys ready at once:** if both built-in keys became ready in the same
  refetch with nothing chosen, Anthropic would win over the Recommended
  OpenAI. Saves run one at a time, so this is unlikely.
- **Image input:** after an Anthropic test, `accepts_images` still comes from
  the template, because the Models API probe does not report image input.
- **Spec label:** the spec placed D24 and D25 under the Phase 2 presentation
  heading, and issue #364 has not received D22, D24 or D25.

#### Code Review #2 Revisions

- **Both keys ready at once:** accepted as is. Setup saves keys one at a time,
  and the chosen model stays visible and editable before Finish.
- **Image input:** accepted. Every Claude model in the catalog accepts image
  input, and the checkbox stays visible and editable.
- **Spec label:** fixed. D22, D24 and D25 now sit under their own
  "during implementation" heading. Issue #364 is to be republished from the
  Phase 8 commit.

Final checks on the candidate, after OrbStack was restarted (the owner
approved force-quitting the hung VM manager):

- `pnpm e2e:test:fast`: 36 passed in 5.0 minutes on the rebuilt
  `animama-anthropic-e2e` (run `run-1009204115`).
- `timeout 2400 make check-test`: 3,499 passed and 27 skipped.

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
     - `docs/backend/architecture/data-model.md` (`api_standard` and
       `last_model_client` values, both built-in connections,
       `early_compaction`)
     - `docs/backend/architecture/http-api.md` (the Anthropic probe, the
       `early_compaction` update, the default catalog policy)
   - Frontend: `docs/frontend/features/model-settings.md`.
   - `docs/backend/operations/development.md`: `ANTHROPIC_API_KEY` in the
     secrets file and compose.
   - Cover the moderation gap, the fence, search billing and **Compact early**.
2. **ADRs.**
   - New ADR 0021 "Native Anthropic Messages provider" (drafted as 0016 and
     renumbered when main added ADRs 0016–0020) records:
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
   - Also judge reply quality and latency at the D16/D22 defaults.
6. **Release gate.** Record that the next desktop release needs owner re-review
   of the Python license inventory.

Checks: `docs-sync` review, the final checks below, and the measurement run.

Completion: docs and ADRs reviewed; measurements and owner smoke recorded;
failures become in-scope fixes or follow-up issues, per the owner.

Phase record: issue #373; starting source `76bea118`; commit: this phase's commit (see git log for `[p9]`).

Implementation:

- **Docs (delegated agent; reviewed in Code Review #1 below):**
  - backend: `model-client-providers.md`, `adding-ai-models.md` (Haiku 5.5
    example), `model-catalog.md` (Compact early section), the Memory Manager
    and memory feature docs, `data-model.md`, `http-api.md`, `chat.md`,
    `overview.md`, `local-models.md`, `development.md` (the key in the
    owner-only secrets file);
  - frontend: `model-settings.md` (search billing, moderation gap),
    `installation.md`;
  - `tests/live/README.md` and `src/backend/AGENTS.md`;
  - `prompt-caching.md`: final measurements by the coordinator.
- **ADRs:**
  - new ADR 0021, "Native Anthropic Messages provider" (drafted as 0016;
    renumbered after merging main);
  - ADR 0008 amended for the guardrail placement (D20/D21);
  - both indexed in the ADR README.
- **Glossary:** "Model connection" extended (D1), and "Application web search"
  corrected for Anthropic.
- **Release gate:** `redistribution-review.md` requires owner re-review of:
  - the Python license inventory (`anthropic`, `httpx2`, `httpcore2`,
    `truststore`, `docstring-parser`; `idna` 3.20);
  - one Anthropic request from the frozen runtime per target, for trust-store
    TLS;
  - the desktop notice inventory (the tenth provider logo).
- **Docs-sync audit:** run over `2b546185...HEAD` plus the working tree. Gaps
  were fixed in the files above, and links and anchors were checked (0
  broken).
- **Gaps between the code and the spec found by the audit:**
  - **Picker effort:** handled by D26.
  - **Search shown but never run:** application search was reported for
    Anthropic rows without native search, although the backend never offers
    it there.
  - **Billing copy:** R6 requires settings copy saying that Anthropic bills
    searches.

  All three are fixed in this phase, by a delegated agent working test-first:
  - **D26 (picker effort):**
    - `DEFAULT_ANTHROPIC_CHAT_EFFORT` moves to `app/model_catalog.py`, and
      `request.py` imports it.
    - `default_chat_reasoning_effort` computes `default_reasoning_effort` when
      the catalog is served (`serialize_model_catalog`, the public catalog
      service, `PyModelProviderCatalogItem`). The SDK is regenerated offline.
    - The frontend `defaultReasoningEffort` moves to `lib/chat/model-catalog.ts`
      and uses the reported default, otherwise the first listed effort.
    - Live: Haiku 5.5 and the owner Sonnet row report `medium`, and
      `gpt-6-luna` still shows `none`.
  - **Search availability:** `webSearchAvailability` returns null for Anthropic
    rows without native `web_search`. The same bug in `modelCapabilityChips`
    is fixed.
  - **R6:** the Anthropic "Built-in search" chip's hover and screen-reader text
    states that Anthropic bills each search to the owner's account. The Web
    search settings copy now says Anthropic models never use that service.
  - **Checks:**
    - `make check-test`: 3,501 passed.
    - `ruff`, with no forbidden import edges.
    - `pnpm check`, `web:lint`, `build`, `desktop:check`, `prettier:check`
      and `openapi-ts:check` pass.
    - `web:test`: 3,240 passed, plus the same 4 environmental port-5173
      failures.
    - Browser tests: 39 of 39 passed.

Memory Manager prompt review: the Phase 7 live run left a contradicting
`PROFILE.md` line. The Anthropic instructions now say that when a new fact
replaces an older one, the outdated statement is corrected or removed wherever
it appears.

- A unit assertion covers the wording.
- The live test now asserts the coffee line is gone. In the live rerun Haiku
  viewed both files, searched, and replaced the `PROFILE.md` line ("Prefers
  green tea in the morning (switched from coffee)"). That took 4 requests, 1
  approval and no new files.
- At the owner's request (2026-10-09), the OpenAI Agents runtime's
  instructions gain the same rule.
  - A missing space before "When proposing a memory edit" in that prompt is
    also fixed.
  - Unit assertions in `tests/test_memory_manager.py` cover both.
  - A one-off live check on `gpt-6-luna` used the same seed and request. It
    replaced the `PROFILE.md` line ("Switched from coffee to green tea in the
    morning") in 7 requests with 1 approval, and left `notes/preferences.md`
    unchanged. That test was temporary and is not kept.

Final measurements, 2026-10-09, source `76bea118` plus Phase 9 changes
(`-dirty`), owner-authorized. Command:
`ANIMAMA_RUN_LIVE_TESTS=1 uv run --env-file "$HOME/.config/animama/dev-secrets.env" pytest -q -s tests/live/test_prompt_cache_layout.py tests/live/test_anthropic_direct_turn.py tests/live/test_anthropic_messages_contract.py`

- Result: 16 passed in 310 seconds. The local-server row was skipped; no local
  server was configured.
- Mean cached share, turns 2–6, through the production assembler:

  | Path | Share |
  | --- | --- |
  | Responses with server state | 0.902 |
  | Responses without a cursor | 0.686 |
  | Chat Completions, developer role | 0.868 |
  | Chat Completions, tagged block | 0.837 |
  | Anthropic Messages (Haiku 5.5) | 0.880 |

- Baselines before this work: Responses 0, Chat Completions with a developer
  role 0.65, without one 0, and a direct Anthropic mapping 0.
- Every path matches its Phase 4 or Phase 5 result.

#### Owner live smoke checklist

Run it on the live development stack `animama-anthropic`
(`http://animama-anthropic.localhost:8820`). The stack was started with the
owner-only secrets file and without `ANIMAMA_LLM_SKIP`, so both keys are set.
It already has two owner rows, `claude-sonnet-5-5` and Haiku 4.5. Each item
names the acceptance criterion it covers.

1. **Chat, quality and latency (D16/D22).** Choose Claude Haiku 5.5 for an
   Anima, at the default effort (medium), and hold a few turns.
   - Check: replies stream; emotion and gesture updates apply; quality and
     latency are acceptable.
2. **Restart.** Restart the backend
   (`docker compose -p animama-anthropic restart animama-server`), then
   continue the same chat.
   - Check: the reply follows on from the earlier turns.
3. **Web search.** Turn web search on and ask about a recent event; then turn
   it off and ask again.
   - Check: with search on, the answer is grounded. With search off, no search
     is made (the request log shows no `web_search` tool).
4. **Compaction.** On request, the coordinator lowers Haiku 5.5's trigger to
   Anthropic's 50,000-token minimum. This changes
   `long_context_token_threshold` on the task stack only, and a restart's
   re-seed restores it. Paste a long document, then keep chatting.
   - Check: the compaction indicator appears and the chat continues coherently.
5. **Compact early.** Open model details for Haiku 5.5, then for an owner row.
   - Check: Haiku 5.5 shows the switch, on by default, and toggling it
     persists. Owner rows without long-context pricing show no switch.
6. **Utility.** Set the Utility role to Haiku 5.5 and start a new chat.
   - Check: the chat gets a sensible title.
7. **Memory Manager.** Set the Memory Manager to Haiku 5.5 and ask it to record
   a changed preference.
   - Check: it proposes an edit that also corrects the older contradicting
     line.
   - Approve one proposal. Restart the backend while another is pending, then
     approve it.
   - Reject one proposal.
   - Check: a delete or rename request is refused.
8. **Owner row.** Chat once with `claude-sonnet-5-5`.
   - Check: it replies, and the fence prevents switching an existing OpenAI
     chat to it.
9. **Missing key.** On the key-less setup stack `animama-anthropic-setup`, start
   it again with the same stack record and choose Haiku 5.5 in a chat.
   - Check: the missing-key state and error appear.
10. **Desktop key (optional).** In a packaged desktop build, add the Anthropic
    key in App Settings without restarting.
    - Check: Haiku replies, and the key is not stored in the database or logs.
    - Automated desktop and IPC tests already cover this path.

Results: on 2026-10-09 the owner tested on the live stack, judged it enough,
and accepted the smoke. The owner did not report results item by item. The
two backend-restart steps (items 2 and 7) were waived by the owner; automated replay and resume tests cover them. Item 4
(compaction at the minimum trigger) and item 10 (desktop key) were not run;
automated event, replay, desktop and IPC tests cover them.

#### Code Review #1 Findings

Independent `sdlc-reviewer`, full initial review of the uncommitted tree on
`76bea118`.

Verified:

- the Memory Manager rule in both runtimes, and the space fix;
- the D26 backend, the generated SDK (current) and the frontend default on the
  row-click and page-load paths;
- the search-availability fix against
  `direct_executor._application_web_search_active`;
- the R6 copy;
- ADR 0016 against D1–D26 and the code;
- the measurements in `prompt-caching.md`;
- doc claims against the code;
- the release-gate package list against `git diff 2b546185 -- uv.lock`.

Checks: `ruff`, the import-boundary script, targeted `mypy`,
`openapi-ts:check`, `pnpm check`, 252 targeted web tests and a link check (0
broken).

- **P9-R1-F1 (blocking):** in `chat-input.tsx` `applySettingsForModel`,
  changing a setting in an inactive model's popover saves the previous model's
  effort instead of the shown default. Haiku could be saved at `none`, and
  Luna at `medium`.
- **P9-R1-F2 (blocking):** issue #364 lacked the Phase 9 decision lines that
  the spec snapshot claims.
- **Non-blocking:**
  - the live Memory Manager test printed memory content, contrary to its
    docstring;
  - plan status, the smoke itemization, the evidence table, the baseline
    mapping and the D-number for the Memory Manager rule;
  - glossary wording for Anthropic rows without search;
  - the ADR 0016 nit that `none` disables thinking;
  - the ADR 0008 in-place rewrite;
  - the duplicated provider-type literal;
  - the duplicated "default only if offered" rule.

#### Code Review #1 Revisions

- **F2 (fixed):** issue #364 is republished with D26 and D27 (2026-10-10T01:52:03Z,
  read back). The spec header records the revision as `76bea118` plus the
  Phase 9 decisions.
- **Plan record:**
  - the Status gate and the Phase 9 progress line are updated;
  - the smoke results say that the owner did not report results item by item;
  - the evidence table marks the waived restart steps and the unrun smoke
    items (4 and 10);
  - the baselines are named by path;
  - the Memory Manager rule is D27.
- **Glossary and ADR 0016:** fixed.
- **ADR 0008:** kept. The old placement is summarized under Consequences,
  following ADR 0011's in-place amendment.
- **F1 (fixed, test-first):** when a popover change also selects a model,
  `applySettingsForModel` ignores the previous model's effort. It uses the
  chosen effort, or else the new row's default.
  - `chat-input-model-settings.test.tsx` renders the real selector and covers
    both scenarios (they failed before the fix), an explicitly chosen effort,
    and the active model keeping its effort.
- **Live test (fixed):** records `coffee_line_removed`, and its docstring
  states the check.
- **Provider-type literal (fixed):** `ANTHROPIC_MESSAGES_PROVIDER_TYPE` is
  exported from product-ui and re-exported by web `model-catalog.ts`.
- **Shared effort rule (done):** `offered_effort` in `app/model_catalog.py` is
  used by `default_chat_reasoning_effort` and `effort_and_thinking`. The import
  boundary check finds 0 forbidden edges.
- **Repair checks:**
  - backend `ruff` and targeted pytest: 162 passed;
  - 176 targeted web tests;
  - `pnpm check`, `web:lint`, `prettier:check` and `packages:check` pass.

#### Code Review #2 Findings

Independent `sdlc-reviewer`, repair round 1. It reviewed the uncommitted tree
on `76bea118`.

**Result: pass, with no blocking findings.**

Verified:

- **F1:** no other path carries the previous model's effort. That includes
  row click, keyboard select, external model changes and the
  search-availability effect.
- **F2:** the issue body matches the snapshot apart from headings and links.
- All non-blocking repairs.

Checks:

- 116 DB-backed targeted tests;
- `ruff`, the format check, the import-boundary script and targeted `mypy`;
- 286 targeted web tests;
- `pnpm check` and `packages:check`;
- eslint and prettier on the repaired files;
- the link check.

Non-blocking findings:

- the evidence cell overstated the OpenAI live coverage;
- issue #364 links the Decision Log at `76bea118`, where D26 and D27 do not
  exist yet;
- one unwrapped plan line.

#### Code Review #2 Revisions

- **Evidence cell:** reworded to "the Anthropic live test and a one-off OpenAI
  live check".
- **Plan line:** wrapped.
- **Issue links:** issue #364's plan links are re-pointed to the Phase 9
  commit after it is pushed.

Phase checks on the final Phase 9 tree:

- `make check-test`: 3,501 passed and 27 skipped.
- `uv lock --check`, `bash -n reset.sh` and both compose config commands pass.
- `pnpm check`, `web:lint`, `build`, `desktop:check`, `prettier:check` and
  `openapi-ts:check` pass.
- `desktop:test`: 468 passed.
- `web:test`: 3,245 passed. The 4 `tests/local-api-proxy.test.ts` failures
  are environmental: port 5173 is held by another task's process.
- Browser tests: 39 of 39 passed.
- `e2e:test:fast` runs on the final candidate after the final integration
  review.

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

Cloud follow-up: Animama Cloud copies `model_providers` from this repository's
ORM. When it adopts this release, it needs:

- a hosted migration for the new `early_compaction` column (Phase 3);
- tenant-inventory review rows for the new
  `adapters/model_clients/anthropic_messages/*` modules;
- rows for the Memory Manager modules `anthropic_runtime`,
  `anthropic_memory_tool`, `runtime_selector` and `runtime_support`.

Record that in the PR. No change is needed here.

#### Merge with main (2026-10-09)

Before the final review, `origin/main` (`1470e675`, 176 commits past
`2b546185`) was merged into the branch with an ordinary merge commit.

Conflicts resolved:

- **Contracts:** main moved `PyModelProviderCatalogItem` to
  `app/contracts/model_provider.py`, which now carries
  `default_reasoning_effort`. `server/schemas/model_provider.py` is main's
  re-export. `model_configuration.py` keeps both main's contract imports and
  `OwnerModelProviderType`.
- **ADR numbering:** main added ADRs 0016–0018, so the Anthropic ADR is
  renumbered 0019, along with its links, ADR 0008's amendment pointer and the
  index.
- **Native compaction:** main's `uses_native_context_compaction` replaces the
  executor's provider-type check, and the Anthropic client reports
  `native_context_compaction`. The post-response compaction skip keeps
  `NATIVE_COMPACTION_PROVIDERS`.
- **Memory Manager:** main's hosted `_turn_limit` cap wraps the shared
  `max_turns_for_run`, and the D24 resume budget uses it too.
- **Responses:** main's `spec.limits` payload fields are combined with the
  branch's stable-instruction layout.
- **`ModelClientFinal`:** keeps `continuation`, `replay_prefix` and main's
  `usage_reported`. `event_summary` uses `replace`, which preserves all of
  them. The Anthropic final reports `usage_reported`.
- **Failure copy:** `chat-failure.ts` keeps both the Anthropic codes and main's
  hosted denials.
- **Search availability:** main's runtime-field rule is kept, with Anthropic
  rows excluded.
- **Docs and tests:** chat docs and executor tests are combined.
- **Setup:** main removed the setup model radio group; the last setup choice
  wins. D25 is rebuilt on that design by a delegated agent:
  - an Anthropic tab beside OpenAI, with its own key panel on desktop and the
    `ANTHROPIC_API_KEY` line on web;
  - saving the Anthropic key during setup chooses Haiku 5.5 when the built-in
    connection and visible row exist;
  - main's rules hold for both providers: the last choice wins, and a key that
    was already set chooses nothing;
  - main's "first built-in connection" lookup now finds each connection by
    preset;
  - unit and browser tests cover all of this, including last-wins ordering
    against OpenAI and added models;
  - the setup docs are updated.

Merge follow-ups found by inspection:

- The Anthropic client now honours main's composition `ModelCallLimits`:
  `max_tokens` and web search `max_uses` are capped, the limits' timeout is
  used, and a bounded request is never retried. Tests were written first. The
  hosted policy still offers no Anthropic rows.
- Main's `griffe` 2.1 upgrade needed a package reinstall in the task venv; no
  tracked change.

Checks on the merge (`fb50fc55`):

- `make check-test`: 3,595 passed.
- The setup agent ran `pnpm check`, `web:lint`, `prettier:check`,
  `packages:check`, `web:test` (3,409 passed, with no port conflict this time),
  `build`, `desktop:check`, `desktop:test` (484 passed) and
  `openapi-ts:check`.
- `e2e:test:fast`: 36 passed in 5.5 minutes on the rebuilt
  `animama-anthropic-e2e` (run `run-1009224457`).

#### Second merge with main (2026-10-10)

PR #408 later conflicted with main (`5be960f0`, 20 more commits), which had
added ADRs 0019 and 0020. A second ordinary merge renumbered the Anthropic ADR
to 0021, with its index row, ADR 0008's pointer and the doc links. The ADR
index was the only conflict. The checks for this merge are recorded in the PR.

#### Final Integration Review Code Review #1 Findings

Independent `sdlc-reviewer`, full review of `1470e675...fb50fc55`, including
the merge's own hunks.

It verified:

- the layout and guardrail order on every path;
- the fence;
- credential isolation, apart from F1;
- hosted policy and the merge interactions (`AccountedModelClient`
  forwarding, limits, `usage_reported`, `model_stream` limits);
- replay;
- the compaction triggers and executor fitting;
- Memory Manager pinning, the D24 budget under the hosted cap, and D27;
- every merge hunk;
- D25 and D26;
- the ADR 0019 links;
- the docs, with a link check over 32 files.

Checks:

- 764 targeted backend tests;
- `ruff`, the format check, the import-boundary script and `make mypy`;
- `openapi-ts:check`;
- 175 targeted web tests.

- **FIR-R1-F1 (blocking):** `ANTHROPIC_API_KEY` was in
  `KNOWN_PROVIDER_CREDENTIAL_ENVS`, so an owner OpenAI-compatible connection
  could name it and send the Anthropic key to its host. The docs say the key
  goes only to Anthropic's API. Phase 3 step 4's "joins the known set" caused
  this.
- **Non-blocking:**
  - `pause_turn` resends are not bounded by the call limits, although the docs
    implied invocation scope;
  - the context-window doc listed only Responses as compacting natively;
  - a dangling comment in `openai_prompt.py`;
  - Cloud adoption needs inventory rows for the new modules;
  - a stale Responses cursor after a Responses → Anthropic → Responses Memory
    Manager role switch within one run;
  - main's stale-cursor retry drops `limits` (pre-existing on main);
  - `MockModelClient` lacks `native_context_compaction` (no effect).

#### Final Integration Review Code Review #1 Revisions

- **F1 (fixed, test-first):** `ANTHROPIC_API_KEY` leaves the owner-connection
  allowlist and is loaded at startup like the ElevenLabs key.
  - Owner connections naming it resolve as missing, and configuration refuses
    it with `invalid_credential`. The built-in Anthropic connection still
    reads it through its own mapping.
  - A new test covers the refusal and the built-in path.
  - `local-models.md`, `http-api.md` and (in repair round 2)
    `model-client-providers.md` no longer list the key as an allowed name.
- **Pause-turn scope:** documented as per request, with the note that hosted
  compositions offer no Anthropic rows.
- **Context-window doc:** now names the Anthropic client.
- **Comment:** removed.
- **Cloud inventory rows:** recorded for the PR's Cloud follow-up, together
  with the `early_compaction` hosted migration.
- **Stale cursor after a role switch:** accepted. The pattern already exists
  for Responses ↔ Chat Completions, a role switch inside one run is rare, and
  the impact is a lost earlier exchange.
- **Main's dropped limits:** out of scope (pre-existing on main).
- **`MockModelClient`:** accepted; it has no effect.
- **Changed files:**
  - `app/model_clients/credential_store.py`;
  - `tests/test_anthropic_model_provider.py`;
  - `app/chat/openai_prompt.py`;
  - `docs/backend/operations/local-models.md`,
    `docs/backend/architecture/http-api.md` and
    `docs/backend/runtime/model-client-providers.md`;
  - this plan.
- **Validation:** `make check-test` on the repaired tree passed 3,596 with 27
  skipped. Frontend files are unchanged.

#### Final Integration Review Code Review #2 Findings

Independent `sdlc-reviewer`, repair round 1.

It verified:

- the F1 code: allowlist removal, startup loading, desktop delivery, the
  built-in path, and owner refusal with `invalid_credential`;
- the new test;
- the corrected docs and the UI mapping;
- the non-blocking repairs;
- the plan counts.

Checks: 341 targeted backend tests, `ruff`, the format check and the
import-boundary script.

- **FIR-R2-F1 (blocking):** `model-client-providers.md` still listed
  `ANTHROPIC_API_KEY` among allowed owner-connection names.
- **Non-blocking:**
  - the revision record had no validation or changed-files line;
  - the Cloud follow-up paragraph lacked the inventory rows;
  - two overlong doc lines.

#### Final Integration Review Code Review #2 Revisions

- **F1 (fixed):** the list now omits the key and says it is reserved for the
  built-in Anthropic connection. The F1 revision note above names the file.
- **Plan record:** the validation and changed-files lines are added above, and
  the Cloud follow-up lists the inventory rows.
- **Overlong lines:** rewrapped.
- **Validation:** docs and plan only; the link check is clean.

#### Final Integration Review Code Review #3 Findings

Independent `sdlc-reviewer`, repair round 2, the last allowed.

**Result: pass, with no blocking findings.**

Verified:

- **FIR-R2-F1:** fixed. No doc lists `ANTHROPIC_API_KEY` as an allowed
  owner-connection name.
- **Context-window paragraph:** rewrapped.
- **Plan records:** the Cloud follow-up, the changed files and validation, and
  the round 2 sections are accurate.
- **Code:** unchanged since round 2.

Checks: a link and anchor check over the 32 changed docs, and a grep for
allowlist mentions of the key.

Non-blocking findings:

- one remaining overlong line in the limits paragraph;
- no validation line in the round 2 revisions.

#### Final Integration Review Code Review #3 Revisions

- **Overlong line:** the limits paragraph is rewrapped.
- **Validation line:** added to the round 2 revisions.

The final integration review is complete.

## Validation and acceptance

| Spec criterion | Evidence | Phase |
| --- | --- | --- |
| No key → missing-key state and error | backend test; owner smoke | 3, 5, 9 |
| Key added without restart → streamed structured reply; key not persisted | desktop and IPC tests; persistence test (smoke item 10 not run) | 5, 8, 9 |
| Multi-turn continues after restart | replay test (smoke restart waived) | 5, 9 |
| Fence mismatch both ways | backend test | 5 |
| Web search grounded and recorded; absent when off | request-shape test; smoke | 6, 9 |
| Compaction continues with indicator | event and replay tests; live contract and direct-turn compaction checks (smoke item 4 not run) | 6, 9 |
| **Compact early** default on, 90k/150k, survives re-seed, hidden for unpriced rows | seed and request tests; smoke | 3, 6, 8, 9 |
| Utility title on Haiku | test; smoke | 7, 9 |
| Memory Manager approvals, restart resume, reject, fence, scope | runtime tests; the Anthropic live test and a one-off OpenAI live check; smoke (restart step waived) | 7, 9 |
| Refusal error, no reply persisted | fake-refusal test | 5 |
| Owner-added `claude-sonnet-5-5` row works | probe test; smoke | 3, 8, 9 |
| Hosted composition unchanged | default-policy tests | 3 |
| Guardrails last and unchanged; stable prefix per path | exact-prompt and stability tests | 4, 5 |
| Caching recommendation documented; ADR 0008 amended if departed | review; owner decision; ADR 0008 amended, ADR 0021 | 2, 9 |
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
  regresses quality or caching, revert its commit. The Anthropic adapter then
  uses today's order: a folded system prompt, history, then the user message.
  That keeps working at lower cache reuse until the layout is fixed.
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
