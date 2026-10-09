# Prompt caching and turn instruction layout

Providers bill and serve repeated prompt prefixes from a cache. A cached input
token costs about a tenth of an uncached one, and it also cuts time to first
token. Whether a chat turn reuses the cache depends on where its instructions,
tools and history sit in the request, and on what changes between turns. This
page describes each provider path's caching rules, the turn layout each path
sends, how often each part of a turn's prompt changes, and how to measure reuse.

## Measuring

`tests/live/test_prompt_cache_layout.py` is an opt-in live harness. It drives
the real prompt assembly through a scripted six-turn chat with a synthetic Anima,
and reports the share of input tokens each provider path served from cache on
every turn.

Each run tags its synthetic identity with a fresh nonce. Runs stay isolated
while the shared text before the identity (the core instructions, about 265
tokens) is shorter than the provider's minimum cacheable length. The harness
sends no tools.

Its rows match what production sends:

- Developer-role rows name the built-in OpenAI connection, so they carry the
  explicit breakpoints described below.
- The row without a developer role, and the optional local row, carry none.

See [tests/live/README.md](../../../tests/live/README.md) for keys, cost and the
local-server option. Rerun it after any change to instruction assembly, tool
declarations, history storage or request building. A layout change must not
lower the share on any path.

## Provider rules

| Path | What is cached | Write and lookup points | Minimum | Lifetime | Price of a cached token |
| --- | --- | --- | --- | --- | --- |
| OpenAI Responses and Chat Completions | Exact rendered prefix: hidden system text, tools, `instructions` or leading system/developer messages, then history in order. The model, tools (and their order), `text.format` (the response schema), reasoning effort and `context_management` are part of the prefix. | See [OpenAI lookups](#openai-lookups). | 1,024 tokens | At least 30 minutes after last use on GPT-5.6 and later. The API field is `prompt_cache_options.ttl`, which openai-python 2.41 does not type. | 0.1× input; writes 1.25× |
| OpenAI Responses with `previous_response_id` | As above. Prior `instructions` are not carried forward, so each request sends them first. Every stored item is billed again as input on each turn. | As above | As above | Stored responses are kept 30 days | As above |
| Anthropic Messages | Exact prefix in render order: `tools`, `system`, `messages`. | Explicit `cache_control` on up to four blocks, or top-level automatic caching on the last cacheable block. A read finds only entries that earlier requests wrote at their own breakpoints, within 20 blocks before a breakpoint. Changing tools invalidates everything; changing `output_config.format`, thinking, effort or `tool_choice` invalidates message caching. | 512 tokens on Claude Haiku 5.5 | 5 minutes, or 1 hour at a higher write price; refreshed on each hit | 0.1× input; writes 1.25× (5 minutes) or 2× (1 hour) |
| Local Chat Completions servers (llama.cpp, Ollama, LM Studio, vLLM) | KV cache of the longest identical token prefix of the rendered chat template. | Per server slot or block, not per message | none | Until evicted, or until the model unloads (Ollama: 5 minutes idle by default) | No price; saves prompt-processing time |

### OpenAI lookups

On GPT-5.6 and later (including `gpt-6-luna`), a request writes cache entries
in two ways:

- **Implicitly**, at the end of the latest eligible message. Eligible messages
  are user messages, the last tool output in a run, and the end of the initial
  block of system or developer messages.
- **Explicitly**, where a text content part carries
  `"prompt_cache_breakpoint": {"mode": "explicit"}`. A request can make up to
  four writes. On Responses, `instructions` and assistant `output_text` parts
  cannot carry a breakpoint.

A request looks up only the breakpoints it marks itself, plus eligible message
endings. If history must stay cached while a per-turn message sits before the
new user message, mark the reply that ended the previous request's history (to
read its entry) as well as the latest reply (to write the next one). A developer
message directly after the system prompt joins the initial block, so the system
prompt then needs its own marker.

`prompt_cache_key` groups requests for cache accounting and, on older models,
routing. Animama scopes it to the user, the Anima, the provider type and the
model. Chat Completions sends it only on connections with
`send_openai_extensions`; see
[model clients and providers](model-client-providers.md).

## Turn layout

`DirectChatPromptAssembler` (`app/chat/openai_prompt.py`) builds every turn
from three parts:

- **Stable instructions:** core instructions, Anima identity, `MEMORIES.md`,
  memory guidance, response guidance with the Gesture list, and then the
  Companion Guardrails.
- **History**, replayed exactly as stored.
- **Turn context:** the memory map, then the attachment list, then the
  guardrails again, immediately before the user's new message.

The last instruction text the model reads before the user's words is therefore
always the guardrails, word for word
([ADR 0008](../../adr/0008-non-overridable-companion-guardrail.md)).

| Path | Request order |
| --- | --- |
| Chat Completions with a developer role | system (stable instructions); developer (app compaction summary, when there is one); history; developer (turn context); user |
| Chat Completions without a developer role (the row lacks the role, or its connection sets `fold_developer_role`) | system (stable instructions, a `# Turn Context` description of the block, the compaction summary, then the guardrails); history; user (a `<turn_context>` block holding the turn context, then the user's words) |
| OpenAI Responses | `instructions` (stable instructions); input: developer item (turn context), user item |

On Responses the chain lives in OpenAI server state (`previous_response_id`,
`store: true`). With a cursor, a request sends only the new items. Each turn's
context item stays in the stored chain until native compaction runs at
`ANIMAMA_OPENAI_RESPONSES_COMPACTION_THRESHOLD_TOKENS` (default 90,000).
Requests without a cursor send history before the new items. These are the
first turn, incognito turns (`store: false`) and the stale-cursor replay.

### Explicit breakpoints

Only requests on the built-in OpenAI connection carry breakpoints. Other servers
never receive the field.

- **Chat Completions with a developer role:** the system message and the last
  two assistant replies before the turn's user message. Those are three
  explicit writes, plus the implicit one at the user message. The previous
  reply reads the entry the last request wrote, and the latest reply writes the
  next one.
- **Responses without a cursor:** the last two history user messages, as
  `input_text` parts. `instructions` and assistant `output_text` cannot carry
  one. Cursor requests need none, because the stored chain is the prefix.
- **Rows without a developer role:** none. Local servers reuse the longest
  identical token prefix by themselves.

### Within a turn

- Tool rounds append each call and its outputs after the user message. On
  Responses with a cursor, a continuation sends only the outputs.
- The forced-final instruction (at the tool or context limit) and the
  structured repair instruction each end with the guardrails. They go where
  they are added:
  - a developer message on Chat Completions;
  - a developer item after the round's new input on Responses;
  - on rows without a developer role, the end of the system message for that
    one request.

### Tag escaping

On rows without a developer role, every `<turn_context` or `</turn_context`
is escaped as `&lt;`, in any case and with any spacing around the slash. This
covers the user's text, replayed user messages, memory-map descriptions and
attachment names, descriptions and outlines. Nothing can open, close or forge
the block.

## What changes, and how often

Each part's volatility class is how often it can change: per installation, per
Anima, per chat, or per turn.

| Part | Class | Where it is | Changes when |
| --- | --- | --- | --- |
| Tool definitions | per turn | before all instructions (OpenAI and Anthropic render tools first) | uploaded-file tools are added only on turns with attachments; write tools follow incognito and memory options; native web search follows the shared control. Any change misses the whole cache, so a turn with attachments and the turn after it miss. |
| Core instructions | per Anima | stable instructions, first | the Anima's name changes |
| Anima identity (`IDENTITY.md`) | per Anima | stable instructions | the owner edits the identity |
| Anima memories (`MEMORIES.md`) | per Anima | stable instructions | a chat memory tool or a Memory Manager Reflection edits it. On Responses this also misses the stored chain's prefix; edits are rare. |
| Memory and response guidance | per Anima | stable instructions | memory-write flags or the response format change |
| Gesture list and response schema | per Anima | stable instructions (response guidance) and `response_format` | the Anima's loadout changes; the schema's `gesture` enum changes with it |
| Companion Guardrails | per installation | end of the stable instructions, and end of the turn context | never ([ADR 0008](../../adr/0008-non-overridable-companion-guardrail.md)) |
| Compaction summary | per chat | developer message after the system message, or the end of the system message before the guardrails | app compaction runs (Chat Completions only). The trigger is the smallest of `ANIMAMA_CHAT_COMPACTION_THRESHOLD_TOKENS` (default 90,000), 70% of the context window, and 75% of the window left after the reply reserve. Each run misses the history cache once. |
| History | per turn | after the stable instructions | every turn (append) |
| Memory map (file paths and descriptions) | per installation | turn context | a memory file is added, removed, moved or re-described |
| Attachment list | per turn | turn context | each turn that attaches files. The uploaded-file tools change with it. |
| Forced-final instruction | per turn | after the tool results | within one turn only |
| Repair instruction | per turn | after the invalid reply's request | within one turn only |

## Current reuse

Measured with `tests/live/test_prompt_cache_layout.py`:

- Method: six scripted turns, a memory map that changes every turn, effort
  `low`.
- Source: `a94b820b-dirty`, 2026-10-09, after the Phase 4 review fixes.
- Model: OpenAI `gpt-6-luna`.

| Path | Cached share by turn | Mean, turns 2–6 | Input tokens, turn 6 |
| --- | --- | --- | --- |
| Responses with a cursor | 0, 0.881, 0.892, 0.897, 0.911, 0.913 | 0.90 | 8,424 |
| Responses without a cursor (`store: false`) | 0, 0, 0.854, 0.857, 0.856, 0.856 | 0.68 | 5,378 |
| Chat Completions, developer role | 0, 0.864, 0.866, 0.872, 0.868, 0.872 | 0.87 | 5,406 |
| Chat Completions, `<turn_context>` block | 0, 0.866, 0.851, 0.841, 0.823, 0.808 | 0.84 | 5,442 |

- **Responses with a cursor:** input grows faster, because each turn's context
  item stays in the stored chain until native compaction.
- **Responses without a cursor:** the second request always misses. On the
  first request the turn-context item directly follows `instructions` and joins
  the initial block, so the only implicit write includes it. From the second
  request on, a history user message follows `instructions`, and
  `instructions` cannot carry a breakpoint. The marked history user messages
  hit from the third request on. This path serves incognito chats and
  stale-cursor replays; ordinary chats use the cursor after their first turn.
- **Chat Completions without a developer role:** no breakpoints are sent. On
  OpenAI only the stable system prompt is reused, through the implicit write at
  the end of the initial block, so the share falls slowly as history grows. The
  previous user message was sent with its block and is replayed without it, so
  no later request repeats that prefix. Local servers reuse their token prefix
  through the history before the previous user message. That was not
  measured; no local server was available.

Breakpoints are gated by the built-in `openai` connection, not by the host it
targets. If `OPENAI_BASE_URL` points that connection at another endpoint, that
endpoint receives the content-part arrays and must accept them.

The harness changes the memory map every turn, which is the worst case. In
production the map changes only when memory files change.

Before this layout (Phase 1 baseline, source `b37abfa5-dirty`, 2026-10-08), the
per-turn memory map sat in Responses `instructions` and in the system message
of rows without a developer role. Responses and those rows reused nothing
(0.00). Chat Completions with a developer role reused only the system prompt
(0.65).
