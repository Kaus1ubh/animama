# 0023: Native Anthropic Messages provider

- Status: accepted
- Recorded: 2026-10-09
- Retrospective: no
- Original decision date: 2026-10-07 (owner decisions during intent discovery:
  a native provider, roles, native features, the chat fence and the moderation
  gap), 2026-10-08 (owner: the Client SDK and native memory tool for the Memory
  Manager) and 2026-10-09 (owner: instruction placement for prefix caching)
- Decision basis: owner decisions in the accepted spec for
  [Anthropic models and cache-friendly instruction assembly](https://github.com/raymond-van/animama/issues/364)
  and its [execution plan](../plans/anthropic-model-provider/anthropic-model-provider-execplan.md)
  (Decision Log D2, D4, D7, D10, D19, D20 and D21)
- Amended: 2026-10-25, the turn context no longer ends with the guardrails
  (see [ADR 0008](0008-non-overridable-companion-guardrail.md)).

## Context

Every cloud model the local application could run used OpenAI's protocols:
the built-in OpenAI connection (Responses or Chat Completions) and owner
connections to OpenAI-compatible Chat Completions servers. The
[configurable-models spec](../plans/configurable-models/configurable-models-spec.md)
([#165](https://github.com/raymond-van/animama/issues/165)) excluded native
Anthropic and other non-OpenAI-protocol APIs: such vendors were reachable only
through their OpenAI-compatible endpoints. Anthropic's compatible endpoint lacks
the server-side compaction, server tools and strict schemas that companion chat
uses, and the product depended on one cloud vendor for availability, pricing
and policy.

[ADR 0011](0011-application-owned-companion-features-and-composition-catalog-policy.md)
makes companion features application-owned, with provider-native features as
fast paths. A provider that keeps no conversation state resends the whole chat
every turn, so its cost depends on prefix caching. Instruction assembly limited
caching on every path ([#155](https://github.com/raymond-van/animama/issues/155)):
the per-turn memory map sat inside or ahead of stable text, and rows without a
developer role folded it into the system message, which then changed every
turn.

Claude Haiku 5.5 rejects sampling parameters, assistant prefill and fixed
thinking budgets. Its signed thinking blocks are valid only while the content
before them is unchanged, and a mid-conversation `system` message may follow
only a user turn.

## Decision

1. **A native provider.** `AnthropicMessagesHTTPAgent` calls Anthropic's
   Messages API under its own API standard, `anthropic_messages`. Only a
   built-in `anthropic` connection serves it, with only `ANTHROPIC_API_KEY`,
   against Anthropic's own API. Anthropic rows serve the chat, Utility and
   Memory Manager roles, not Embeddings. Claude Haiku 5.5 is a built-in row;
   the owner adds other Claude model IDs, described by Anthropic's Models API.
   Only the local composition exposes Anthropic rows, and OpenAI stays the
   application default. The chat API-standard fence keeps Anthropic and
   OpenAI chats apart in both directions.
2. **The official Client SDK.** Chat and the Memory Manager call the API
   through Anthropic's `anthropic` Python Client SDK, never the Claude Agent
   SDK or an OpenAI-compatible shim. The Memory Manager drives its own request
   loop, because an approval pauses a run until the owner decides, possibly
   after a restart, and resumes it from state stored with the run.
3. **Native features as fast paths under ADR 0011.** Anthropic rows use
   strict structured output and strict function tools for chat memory tools;
   threshold server-side compaction (`compact_20260112`) instead of
   application compaction, triggered at 90% of a row's long-context price
   step when its **Compact early** setting is on (never below Anthropic's
   50,000-token minimum) and at Anthropic's default of 150,000 otherwise;
   Anthropic's `web_search` server tool (basic `web_search_20250305`) instead
   of the application search tool; and, for the Memory Manager, Anthropic's
   memory tool (`memory_20250818`). Animama executes memory-tool commands
   against its database-backed memory workspace: edits become the same
   version-fenced approvals as on OpenAI models, and `delete` and `rename` are
   refused. Thinking is adaptive and steered by effort, and effort `none`
   disables it. Thinking is never displayed and not replayed across turns.
4. **Instruction layout chosen per provider for prefix caching.** Every path
   sends the stable instructions first (core instructions, identity,
   `MEMORIES.md`, memory and response guidance with the Gestures, then the
   Companion Guardrails), byte-identical within a chat while their inputs are
   unchanged, then history exactly as stored. The turn context (memory map and
   attachments, ending with the guardrails again) goes immediately before the
   user's new message: a developer message on Chat Completions, a developer
   input item on OpenAI Responses (which keeps OpenAI server state with native
   compaction at 90,000 tokens), or a tagged `<turn_context>` block at the
   start of the user message on rows without a developer role. On Anthropic
   Messages it is a mid-conversation `system` message after the user's
   message, with no tagged block, and `cache_control` marks the system prompt,
   a replayed compaction block and the last history block. This amends the
   placement in [ADR 0008](0008-non-overridable-companion-guardrail.md).

## Rationale and consequences

The owner chose a native provider for vendor choice and redundancy. The native
protocol keeps the compaction, server tools and strict schemas that the
compatible endpoint lacks, which ADR 0011's fast-path policy is meant to use.

The Claude Agent SDK was rejected for this scope: its built-in file and shell
tools act on the real disk rather than the virtual memory workspace, its
sessions live outside the database that holds run state and approvals, it
bundles a native binary of about 236 MB unpacked per platform, and the agent
loop it provides is not needed. It remains an option for future agents that
work on real files or run commands. A shim over the OpenAI-compatible endpoint
was the status quo this decision reverses.

Basic web search was chosen over dynamic filtering after both were measured on
fixed prompts with structured output: the dynamic version was slower and read
more input tokens. Compact early keeps a chat below Claude Haiku 5.5's
long-context price step, which bills every token of a request at about five
times the rate above 100,000 prompt tokens.

For the layout, the owner put turn context and guardrails before the user's
new message wherever the provider allows. On Anthropic the owner chose the
trailing system message over a tagged block or a split: the measured cache
reuse was equivalent, and one mechanism keeps the guardrails at operator
authority. Attachment metadata then has system authority, as in the OpenAI
developer message, and stays labelled as untrusted document metadata. Measured
reuse for each path is in
[prompt caching](../backend/runtime/prompt-caching.md#current-reuse).

Consequences:

- **Moderation gap.** Anthropic offers no moderation endpoint, so Anthropic
  turns show no crisis card and rely on the Companion Guardrails alone, as
  Chat Completions turns do. The owner accepted this.
- **Fence and refusals.** Moving a chat between Anthropic and OpenAI models
  needs a new chat. A refusal ends the turn with `model_refused`; no other
  model is tried.
- **History.** Anthropic chats replay application-owned history from the
  newest server compaction block. Thinking blocks, raw search results and
  earlier turns' context messages are not replayed, and application
  compaction summaries are unused.
- **A second Memory Manager runtime.** A selector chooses the runtime by the
  provider type of the row that runs each step, so an approval resumes on the
  runtime that proposed it. Both runtimes give each start and each resume the
  full turn budget.
- **Cost.** Anthropic bills web searches per search to the owner's account.
  The cost estimator ignores long-context rates and search fees.
- **Every provider's prompt changed.** Exact-prompt and stability tests cover
  each path, and the live cache harness is rerun after changes to instruction
  assembly.
- **Cloud is unchanged.** The default `ModelCatalogPolicy` exposes no
  Anthropic rows. A hosted schema derived from these ORM models needs the new
  `model_providers.early_compaction` column.
- **Desktop release.** The SDK adds Python packages and the provider logo adds
  a notice source, so the owner re-reviews both inventories before the next
  desktop release ([redistribution review](../frontend/desktop/redistribution-review.md#exact-artifact-review)).

## Evidence

- [`adapters/model_clients/anthropic_messages/`](../../src/backend/animama/adapters/model_clients/anthropic_messages/):
  the chat adapter, request positions, compaction trigger, web search tool,
  strict-schema conversion, refusals and the Models API probe.
- [`app/chat/openai_prompt.py`](../../src/backend/animama/app/chat/openai_prompt.py)
  and [`app/chat/anthropic_instructions.py`](../../src/backend/animama/app/chat/anthropic_instructions.py):
  the stable-first layout and Anthropic-phrased sections.
- [`adapters/memory_manager/anthropic_runtime.py`](../../src/backend/animama/adapters/memory_manager/anthropic_runtime.py),
  [`anthropic_memory_tool.py`](../../src/backend/animama/adapters/memory_manager/anthropic_memory_tool.py)
  and [`runtime_selector.py`](../../src/backend/animama/adapters/memory_manager/runtime_selector.py):
  the memory-tool loop, approvals and runtime selection.
- [`app/services/model_provider_catalog_service.py`](../../src/backend/animama/app/services/model_provider_catalog_service.py):
  `ModelCatalogPolicy.local()` and the default policy.
- [`tests/test_turn_instruction_layout.py`](../../tests/test_turn_instruction_layout.py),
  [`tests/test_anthropic_messages_client.py`](../../tests/test_anthropic_messages_client.py)
  and [`tests/test_anthropic_memory_manager.py`](../../tests/test_anthropic_memory_manager.py):
  layout, request shape and runtime behavior.
- [`tests/live/test_anthropic_messages_contract.py`](../../tests/live/test_anthropic_messages_contract.py)
  and [`tests/live/test_prompt_cache_layout.py`](../../tests/live/test_prompt_cache_layout.py):
  the opt-in checks of Anthropic's API behavior and cache reuse.
- [Model clients and providers](../backend/runtime/model-client-providers.md#anthropic-messages)
  and [prompt caching](../backend/runtime/prompt-caching.md): current behavior.
