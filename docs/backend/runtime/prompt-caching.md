# Prompt caching and turn instruction layout

Providers bill and serve repeated prompt prefixes from a cache. A cached input
token costs about a tenth of an uncached one, and it also cuts time to first
token. Whether a chat turn reuses the cache depends on where its instructions,
tools and history sit in the request, and on what changes between turns. This
page describes each provider path's caching rules, how often each part of a
turn's prompt changes, and how to measure reuse.

## Measuring

`tests/live/test_prompt_cache_layout.py` is an opt-in live harness. It drives
the real prompt assembly through a scripted six-turn chat with a synthetic Anima,
and reports the share of input tokens each provider path served from cache on
every turn.

Each run tags its synthetic identity with a fresh nonce. Runs stay isolated
while the shared text before the identity is shorter than the provider's minimum
cacheable length. The harness sends no tools.

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

## What changes, and how often

Each part's volatility class is how often it can change: per installation, per
Anima, per chat, or per turn.

| Part | Class | Where it is today | Changes when |
| --- | --- | --- | --- |
| Tool definitions | per turn | before all instructions (OpenAI and Anthropic render tools first) | uploaded-file tools are added only on turns with attachments; write tools follow incognito and memory options; native web search follows the shared control. Any change misses the whole cache. |
| Core instructions | per Anima | system, first | the Anima's name changes |
| Anima identity (`IDENTITY.md`) | per Anima | system | the owner edits the identity |
| Anima memories (`MEMORIES.md`) | per Anima | system | a chat memory tool or a Memory Manager Reflection edits it |
| Memory and response guidance | per Anima | system | memory-write flags or the response format change |
| Gesture list and response schema | per Anima | system (response guidance) and `response_format` | the Anima's loadout changes; the schema's `gesture` enum changes with it |
| Compaction summary | per chat | developer message before history | app compaction runs, when the whole prompt reaches `ANIMAMA_CHAT_COMPACTION_THRESHOLD_TOKENS` (default 6,000). Not used on native-compaction paths. |
| History | per turn | messages | every turn (append) |
| Memory map (file paths and descriptions) | per installation | trailing developer message | a memory file is added, removed, moved or re-described |
| Attachment list | per turn | trailing developer message | each turn that attaches files. The uploaded-file tools change with it. |
| Companion Guardrails | per installation | trailing developer message, last | never ([ADR 0008](../../adr/0008-non-overridable-companion-guardrail.md)) |
| Forced-final instruction | per turn | appended after tool results | within one turn only |
| Repair instruction | per turn | appended after the invalid reply | within one turn only |

On rows without a developer role, all developer text is folded into the system
message, in order. On OpenAI Responses, system and developer text are sent
together as `instructions`.

## Current reuse

Baseline from `tests/live/test_prompt_cache_layout.py`:

- Method: six scripted turns, a memory map that changes every turn, effort
  `low`.
- Source: `b37abfa5-dirty`, 2026-10-08.
- Models: OpenAI `gpt-6-luna` and Anthropic `claude-haiku-5-5`.

| Path | Mean cached share, turns 2–6 | Why |
| --- | --- | --- |
| Responses, with or without a cursor | 0.00 | The per-turn memory map is inside `instructions`, which render first. |
| Chat Completions, developer role | 0.65 | Only the leading system message is reused. The per-turn developer message sits before the latest user message, where the implicit write lands, and it moves every turn. |
| Chat Completions, developer text folded into system | 0.00 | The system message changes every turn. |
| Anthropic Messages (folded layout, automatic caching) | 0.00 | The system message changes every turn. |

The harness changes the memory map every turn, which is the worst case. In
production the map changes only when memory files change. The default app
compaction trigger (6,000 tokens) can also rewrite the summary every few turns
on Chat Completions; the harness's six turns stay below it.
