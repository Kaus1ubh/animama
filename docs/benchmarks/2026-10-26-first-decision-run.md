# Model benchmark report

## Scorecard

Judged scores are means on the 1-5 scale with a 95% bootstrap interval and the number of judged replies; rates give their counts. Configurations are not ranked unless listed under Rankings: overlapping intervals, or intervals from fewer than 5 items or chats, are not distinguishable.

| Configuration | Reply | Expression | Audio tags | Long chat | Gesture fit | Strict parse | Failed turns | Latency median / p90 (s) | Tokens in / out (mean) | Cost (USD) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| AnthropicMessagesHTTPAgent:claude-haiku-5-5@none | 4.48 [4.40, 4.54] n=260 | 4.17 [4.08, 4.25] n=260 | 4.24 [3.98, 4.49] n=45 | 4.22 [4.00, 4.33] n=3 | 0.59 [0.51, 0.68] n=194 | 100% (260 of 260) | 0 of 260 | 1.78 / 2.71 | 14605 / 148 | 0.0726 |
| AnthropicMessagesHTTPAgent:claude-haiku-5-5@low | 4.49 [4.44, 4.54] n=260 | 4.24 [4.16, 4.33] n=260 | 4.16 [3.90, 4.40] n=67 | 4.22 [4.00, 4.67] n=3 | 0.66 [0.57, 0.75] n=194 | 100% (260 of 260) | 0 of 260 | 1.74 / 2.59 | 14606 / 149 | 0.0747 |
| OpenAIResponsesHTTPAgent:gpt-6-luna@none | 4.41 [4.32, 4.48] n=260 | 4.66 [4.59, 4.73] n=260 | 5.00 [5.00, 5.00] n=5 | 4.22 [3.67, 5.00] n=3 | 0.85 [0.77, 0.91] n=194 | 100% (260 of 260) | 0 of 260 | 1.75 / 3.37 | 8674 / 90 | 0.0412 |
| OpenAIResponsesHTTPAgent:gpt-6-luna@low | 4.40 [4.29, 4.49] n=260 | 4.65 [4.58, 4.72] n=260 | 4.83 [4.40, 5.00] n=6 | 4.56 [4.33, 4.67] n=3 | 0.85 [0.77, 0.91] n=194 | 100% (260 of 260) | 0 of 260 | 1.78 / 2.65 | 8674 / 90 | 0.0413 |

### Rankings

- reply: no configurations are apart.
- expression: OpenAIResponsesHTTPAgent:gpt-6-luna@low above AnthropicMessagesHTTPAgent:claude-haiku-5-5@low; OpenAIResponsesHTTPAgent:gpt-6-luna@none above AnthropicMessagesHTTPAgent:claude-haiku-5-5@low; OpenAIResponsesHTTPAgent:gpt-6-luna@low above AnthropicMessagesHTTPAgent:claude-haiku-5-5@none; OpenAIResponsesHTTPAgent:gpt-6-luna@none above AnthropicMessagesHTTPAgent:claude-haiku-5-5@none.
- audio_tags: no configurations are apart.
- long_chat: no configurations are apart.

## Core turns

### Reply criteria

| Configuration | relevance | warmth | persona_consistency | spoken_style | length | Speech length median (characters) |
| --- | --- | --- | --- | --- | --- | --- |
| AnthropicMessagesHTTPAgent:claude-haiku-5-5@none | 4.87 [4.82, 4.92] n=260 | 3.97 [3.85, 4.07] n=260 | 4.23 [4.09, 4.36] n=260 | 4.66 [4.54, 4.75] n=260 | 4.65 [4.56, 4.75] n=260 | 130 |
| AnthropicMessagesHTTPAgent:claude-haiku-5-5@low | 4.90 [4.86, 4.93] n=260 | 3.98 [3.88, 4.08] n=260 | 4.24 [4.12, 4.37] n=260 | 4.72 [4.65, 4.79] n=260 | 4.60 [4.50, 4.74] n=260 | 142 |
| OpenAIResponsesHTTPAgent:gpt-6-luna@none | 4.88 [4.83, 4.92] n=260 | 3.83 [3.69, 3.94] n=260 | 4.10 [3.95, 4.23] n=260 | 4.59 [4.45, 4.71] n=260 | 4.65 [4.55, 4.75] n=260 | 116 |
| OpenAIResponsesHTTPAgent:gpt-6-luna@low | 4.90 [4.84, 4.94] n=260 | 3.80 [3.66, 3.93] n=260 | 4.08 [3.92, 4.23] n=260 | 4.57 [4.41, 4.69] n=260 | 4.64 [4.54, 4.75] n=260 | 124 |

### Expression criteria

| Configuration | gesture_fit | tone_fit | intensity_fit | coherence |
| --- | --- | --- | --- | --- |
| AnthropicMessagesHTTPAgent:claude-haiku-5-5@none | 3.70 [3.53, 3.87] n=260 | 4.43 [4.32, 4.54] n=260 | 4.51 [4.40, 4.61] n=260 | 4.04 [3.89, 4.17] n=260 |
| AnthropicMessagesHTTPAgent:claude-haiku-5-5@low | 3.76 [3.59, 3.94] n=260 | 4.47 [4.38, 4.57] n=260 | 4.59 [4.51, 4.67] n=260 | 4.15 [4.04, 4.26] n=260 |
| OpenAIResponsesHTTPAgent:gpt-6-luna@none | 4.43 [4.29, 4.57] n=260 | 4.66 [4.58, 4.73] n=260 | 4.92 [4.89, 4.95] n=260 | 4.63 [4.52, 4.73] n=260 |
| OpenAIResponsesHTTPAgent:gpt-6-luna@low | 4.43 [4.29, 4.57] n=260 | 4.63 [4.56, 4.70] n=260 | 4.90 [4.86, 4.94] n=260 | 4.63 [4.53, 4.73] n=260 |

### Structured output

| Configuration | Strict | Lenient | Repaired | Salvaged | Plain text | Dropped Gestures | Errors by code |
| --- | --- | --- | --- | --- | --- | --- | --- |
| AnthropicMessagesHTTPAgent:claude-haiku-5-5@none | 260 | 0 | 0 | 0 | 0 | 0 | none |
| AnthropicMessagesHTTPAgent:claude-haiku-5-5@low | 260 | 0 | 0 | 0 | 0 | 0 | none |
| OpenAIResponsesHTTPAgent:gpt-6-luna@none | 260 | 0 | 0 | 0 | 0 | 0 | none |
| OpenAIResponsesHTTPAgent:gpt-6-luna@low | 260 | 0 | 0 | 0 | 0 | 0 | none |

### Audio tags and spoken style

Checked against chat's ElevenLabs and Speech rules, over replies that parsed.

| Configuration | Tagged replies | Tags | Sounds | Over sound cap | Not English brackets | Tags in display | Tags only | Accent requests | Style: url | Style: email | Style: path | Style: code | Style: markdown | Style: list | Style: table | Style: emoji |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| AnthropicMessagesHTTPAgent:claude-haiku-5-5@none | 17% (45 of 260) | 48 | 41 | 0 | 0 | 0 | 0 | 0 | 0 | 2 | 0 | 0 | 0 | 0 | 0 | 2 |
| AnthropicMessagesHTTPAgent:claude-haiku-5-5@low | 26% (67 of 260) | 68 | 55 | 0 | 0 | 1 | 0 | 0 | 0 | 2 | 0 | 0 | 0 | 0 | 0 | 0 |
| OpenAIResponsesHTTPAgent:gpt-6-luna@none | 2% (5 of 260) | 5 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 2 | 0 | 0 | 0 | 0 | 0 | 4 |
| OpenAIResponsesHTTPAgent:gpt-6-luna@low | 2% (6 of 260) | 6 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 4 |

Tag kinds: AnthropicMessagesHTTPAgent:claude-haiku-5-5@none `[breathes]` 1, `[chuckles]` 7, `[gasps]` 6, `[giggles]` 2, `[laughs]` 9, `[long pause]` 3, `[short pause]` 11, `[sighs]` 2, `[whispers]` 7; AnthropicMessagesHTTPAgent:claude-haiku-5-5@low `[chuckles]` 25, `[excited]` 4, `[gasps]` 6, `[giggles]` 1, `[laughs]` 4, `[long pause]` 1, `[short pause]` 7, `[sighs]` 11, `[softly]` 1, `[whispers]` 8; OpenAIResponsesHTTPAgent:gpt-6-luna@none `[laughs]` 1, `[whispers]` 4; OpenAIResponsesHTTPAgent:gpt-6-luna@low `[chuckles]` 2, `[whispers]` 4.

### Operations

Seconds are median / p90 / mean over successful turns; tokens are per-turn means over turns whose calls all reported usage.

| Configuration | Part | Turns | Latency | First token | First speech | Input | Cached input | Cache write | Output | Reasoning |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| AnthropicMessagesHTTPAgent:claude-haiku-5-5@none | single | 194 | 1.78 / 2.71 / 1.95 | 1.11 / 1.73 / 1.24 | 1.35 / 2.07 / 1.46 | 14605 | 14156 | 377 | 148 | 0 |
| AnthropicMessagesHTTPAgent:claude-haiku-5-5@none | chat | 66 | 1.75 / 2.57 / 1.91 | 1.08 / 1.84 / 1.25 | 1.31 / 2.05 / 1.46 | 16784 | 16170 | 591 | 138 | 0 |
| AnthropicMessagesHTTPAgent:claude-haiku-5-5@low | single | 194 | 1.74 / 2.59 / 1.90 | 1.11 / 1.74 / 1.21 | 1.29 / 1.96 / 1.42 | 14606 | 14157 | 377 | 149 | 0 |
| AnthropicMessagesHTTPAgent:claude-haiku-5-5@low | chat | 66 | 1.91 / 2.88 / 2.04 | 1.09 / 1.69 / 1.19 | 1.33 / 1.86 / 1.39 | 17296 | 16645 | 628 | 177 | 0 |
| OpenAIResponsesHTTPAgent:gpt-6-luna@none | single | 194 | 1.75 / 3.37 / 2.87 | 0.94 / 1.92 / 1.69 | 1.22 / 2.24 / 2.25 | 8674 | 8426 | 245 | 90 | 0 |
| OpenAIResponsesHTTPAgent:gpt-6-luna@none | chat | 66 | 1.96 / 3.26 / 2.97 | 1.04 / 2.28 / 2.10 | 1.35 / 2.67 / 2.39 | 9993 | 9897 | 92 | 86 | 0 |
| OpenAIResponsesHTTPAgent:gpt-6-luna@low | single | 194 | 1.78 / 2.65 / 2.00 | 0.99 / 1.52 / 1.10 | 1.24 / 1.85 / 1.38 | 8674 | 8426 | 245 | 90 | 0 |
| OpenAIResponsesHTTPAgent:gpt-6-luna@low | chat | 66 | 1.90 / 2.55 / 2.04 | 1.08 / 1.38 / 1.13 | 1.35 / 1.79 / 1.41 | 10005 | 9909 | 93 | 90 | 2 |

Calls: AnthropicMessagesHTTPAgent:claude-haiku-5-5@none 260; AnthropicMessagesHTTPAgent:claude-haiku-5-5@low 260; OpenAIResponsesHTTPAgent:gpt-6-luna@none 260; OpenAIResponsesHTTPAgent:gpt-6-luna@low 260.

## Distributions

Side by side, with no target distribution: the share of turns without a value, the number of distinct values, the share of the three most frequent, and the longest run of one value in a scripted chat.

### Gesture

| Configuration | Turns | None | Distinct | Top three | Top-three share | Longest run |
| --- | --- | --- | --- | --- | --- | --- |
| AnthropicMessagesHTTPAgent:claude-haiku-5-5@none | 260 | 0% | 62 | celebration (16), count_on_fingers (15), thinking_chin_rest (14) | 17% | 1 |
| AnthropicMessagesHTTPAgent:claude-haiku-5-5@low | 260 | 0% | 64 | celebration (15), have_idea (14), count_on_fingers (13) | 16% | 2 |
| OpenAIResponsesHTTPAgent:gpt-6-luna@none | 260 | 7% | 52 | virtual_hug (13), on_one_hand (13), excited_clap (13) | 15% | 2 |
| OpenAIResponsesHTTPAgent:gpt-6-luna@low | 260 | 8% | 58 | virtual_hug (13), excited_clap (13), attentive_lean_in (12) | 15% | 2 |

### Emotional tone

| Configuration | Turns | None | Distinct | Top three | Top-three share | Longest run |
| --- | --- | --- | --- | --- | --- | --- |
| AnthropicMessagesHTTPAgent:claude-haiku-5-5@none | 260 | 0% | 19 | happy (43), gentle (42), amused (42) | 49% | 3 |
| AnthropicMessagesHTTPAgent:claude-haiku-5-5@low | 260 | 0% | 19 | happy (50), gentle (45), amused (40) | 52% | 3 |
| OpenAIResponsesHTTPAgent:gpt-6-luna@none | 260 | 0% | 17 | happy (61), gentle (49), curious (37) | 57% | 5 |
| OpenAIResponsesHTTPAgent:gpt-6-luna@low | 260 | 0% | 19 | gentle (53), happy (51), curious (38) | 55% | 3 |

### Emotional intensity

| Configuration | Turns | None | Distinct | Top three | Top-three share | Longest run |
| --- | --- | --- | --- | --- | --- | --- |
| AnthropicMessagesHTTPAgent:claude-haiku-5-5@none | 260 | 0% | 7 | 6 (75), 5 (64), 3 (48) | 72% | 6 |
| AnthropicMessagesHTTPAgent:claude-haiku-5-5@low | 260 | 0% | 7 | 6 (75), 5 (58), 3 (52) | 71% | 5 |
| OpenAIResponsesHTTPAgent:gpt-6-luna@none | 260 | 0% | 8 | 4 (88), 3 (76), 5 (42) | 79% | 4 |
| OpenAIResponsesHTTPAgent:gpt-6-luna@low | 260 | 0% | 8 | 3 (87), 4 (80), 5 (39) | 79% | 5 |

## Long chats

| Configuration | context_retention | repetition | character_consistency |
| --- | --- | --- | --- |
| AnthropicMessagesHTTPAgent:claude-haiku-5-5@none | 4.67 [4.00, 5.00] n=3 | 3.67 [3.00, 4.00] n=3 | 4.33 [4.00, 5.00] n=3 |
| AnthropicMessagesHTTPAgent:claude-haiku-5-5@low | 5.00 [5.00, 5.00] n=3 | 3.33 [3.00, 4.00] n=3 | 4.33 [4.00, 5.00] n=3 |
| OpenAIResponsesHTTPAgent:gpt-6-luna@none | 5.00 [5.00, 5.00] n=3 | 3.67 [3.00, 5.00] n=3 | 4.00 [3.00, 5.00] n=3 |
| OpenAIResponsesHTTPAgent:gpt-6-luna@low | 5.00 [5.00, 5.00] n=3 | 4.00 [4.00, 4.00] n=3 | 4.67 [4.00, 5.00] n=3 |

## Memory arms

Capture counts the memory chat's checklist against what the arm saved; recall asks a fresh chat. Tool use leaves out failed turns, whose tool calls are unknown, and counts them apart. Kept-rate differences pair the same must-keep entry across arms.

### AnthropicMessagesHTTPAgent:claude-haiku-5-5@none

| Arm | Kept | Noise kept | Sensitive breaks | Saved notes / changed files | Unjudged captures | Recall matched | Open recall | saves_what_matters | tool_use | Reply | Audio tags | Tool calls per turn | Tool success | Failed turns | Latency median (s) | Input tokens mean |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| (a) remember only | 15 of 15 (100%) | 1 of 9 | 0 of 3 | 25 / 0 | 0 | 0 of 9 | 2.00 [2.00, 2.00] n=3 | 4.50 [4.17, 4.83] n=36 | 5.00 [5.00, 5.00] n=36 | 4.25 [3.91, 4.47] n=48 | — | 0.00 over 48 turns | — (0 of 0) | 0 memory, 0 unknown tools | 2.12 | 18031 |
| (b) MEMORIES.md only | 0 of 15 (0%) | 0 of 9 | 0 of 3 | 0 / 0 | 0 | 0 of 9 | 2.00 [2.00, 2.00] n=3 | 3.03 [2.83, 3.33] n=36 | 4.00 [3.92, 4.17] n=36 | 4.38 [4.17, 4.50] n=48 | 4.60 [4.50, 5.00] n=5 | 0.00 over 48 turns | — (0 of 0) | 0 memory, 0 unknown tools | 2.22 | 18085 |
| (c) both | 15 of 15 (100%) | 5 of 9 | 0 of 3 | 32 / 0 | 0 | 0 of 9 | 2.00 [2.00, 2.00] n=3 | 4.00 [3.67, 4.17] n=36 | 5.00 [5.00, 5.00] n=36 | 4.29 [4.16, 4.40] n=48 | — | 0.00 over 48 turns | — (0 of 0) | 0 memory, 0 unknown tools | 2.20 | 18350 |

- Kept rate, (b) MEMORIES.md only minus (a) remember only: -1.00 [-1.00, -1.00] n=15, apart
- Kept rate, (c) both minus (a) remember only: +0.00 [+0.00, +0.00] n=15, not distinguishable
- Kept rate, (c) both minus (b) MEMORIES.md only: +1.00 [+1.00, +1.00] n=15, apart
- new-job-ja against its English original, (a) remember only: kept 5 of 5 against 5 of 5; recall matched 0 of 3 against 0 of 3.
- new-job-ja against its English original, (b) MEMORIES.md only: kept 0 of 5 against 0 of 5; recall matched 0 of 3 against 0 of 3.
- new-job-ja against its English original, (c) both: kept 5 of 5 against 5 of 5; recall matched 0 of 3 against 0 of 3.

### AnthropicMessagesHTTPAgent:claude-haiku-5-5@low

| Arm | Kept | Noise kept | Sensitive breaks | Saved notes / changed files | Unjudged captures | Recall matched | Open recall | saves_what_matters | tool_use | Reply | Audio tags | Tool calls per turn | Tool success | Failed turns | Latency median (s) | Input tokens mean |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| (a) remember only | 15 of 15 (100%) | 3 of 9 | 0 of 3 | 26 / 0 | 0 | 1 of 9 | 2.33 [2.00, 3.00] n=3 | 4.22 [3.67, 4.67] n=36 | 5.00 [5.00, 5.00] n=36 | 4.30 [4.11, 4.39] n=48 | — | 0.12 over 48 turns | 100% (6 of 6) | 0 memory, 0 unknown tools | 2.11 | 17963 |
| (b) MEMORIES.md only | 1 of 15 (7%) | 0 of 9 | 0 of 3 | 0 / 1 | 0 | 1 of 9 | 1.67 [1.00, 2.00] n=3 | 3.19 [2.92, 3.67] n=36 | 4.11 [4.00, 4.25] n=36 | 4.30 [4.07, 4.43] n=48 | 4.00 [3.83, 5.00] n=7 | 0.08 over 48 turns | 100% (4 of 4) | 0 memory, 0 unknown tools | 2.94 | 18735 |
| (c) both | 15 of 15 (100%) | 3 of 9 | 0 of 3 | 28 / 0 | 0 | 2 of 9 | 2.33 [1.00, 5.00] n=3 | 4.25 [3.58, 4.67] n=36 | 5.00 [5.00, 5.00] n=36 | 4.43 [4.28, 4.51] n=48 | 5.00 [5.00, 5.00] n=1 | 0.12 over 48 turns | 100% (6 of 6) | 0 memory, 0 unknown tools | 2.06 | 18317 |

- Kept rate, (b) MEMORIES.md only minus (a) remember only: -0.93 [-1.00, -0.80] n=15, apart
- Kept rate, (c) both minus (a) remember only: +0.00 [+0.00, +0.00] n=15, not distinguishable
- Kept rate, (c) both minus (b) MEMORIES.md only: +0.93 [+0.80, +1.00] n=15, apart
- new-job-ja against its English original, (a) remember only: kept 5 of 5 against 5 of 5; recall matched 0 of 3 against 0 of 3.
- new-job-ja against its English original, (b) MEMORIES.md only: kept 0 of 5 against 0 of 5; recall matched 0 of 3 against 0 of 3.
- new-job-ja against its English original, (c) both: kept 5 of 5 against 5 of 5; recall matched 0 of 3 against 0 of 3.

### OpenAIResponsesHTTPAgent:gpt-6-luna@none

| Arm | Kept | Noise kept | Sensitive breaks | Saved notes / changed files | Unjudged captures | Recall matched | Open recall | saves_what_matters | tool_use | Reply | Audio tags | Tool calls per turn | Tool success | Failed turns | Latency median (s) | Input tokens mean |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| (a) remember only | 15 of 15 (100%) | 0 of 9 | 0 of 3 | 17 / 2 | 0 | 0 of 9 | 3.00 [2.00, 5.00] n=3 | 4.61 [4.33, 4.75] n=36 | 4.69 [4.33, 4.92] n=36 | 4.46 [4.21, 4.57] n=48 | — | 0.25 over 48 turns | 100% (12 of 12) | 0 memory, 0 unknown tools | 3.11 | 14386 |
| (b) MEMORIES.md only | 12 of 15 (80%) | 0 of 9 | 0 of 3 | 0 / 5 | 0 | 7 of 9 | 3.00 [3.00, 3.00] n=3 | 3.92 [3.75, 4.17] n=36 | 4.25 [4.17, 4.42] n=36 | 4.49 [4.34, 4.57] n=48 | 5.00 [5.00, 5.00] n=1 | 0.58 over 48 turns | 96% (27 of 28) | 0 memory, 0 unknown tools | 2.73 | 20773 |
| (c) both | 15 of 15 (100%) | 0 of 9 | 0 of 3 | 17 / 0 | 0 | 0 of 9 | 1.67 [1.00, 2.00] n=3 | 4.81 [4.75, 4.92] n=36 | 5.00 [5.00, 5.00] n=36 | 4.53 [4.41, 4.60] n=48 | 5.00 [5.00, 5.00] n=1 | 0.06 over 48 turns | 100% (3 of 3) | 0 memory, 0 unknown tools | 2.80 | 11304 |

- Kept rate, (b) MEMORIES.md only minus (a) remember only: -0.20 [-0.40, -0.07] n=15, apart
- Kept rate, (c) both minus (a) remember only: +0.00 [+0.00, +0.00] n=15, not distinguishable
- Kept rate, (c) both minus (b) MEMORIES.md only: +0.20 [+0.07, +0.40] n=15, apart
- new-job-ja against its English original, (a) remember only: kept 5 of 5 against 5 of 5; recall matched 0 of 3 against 0 of 3.
- new-job-ja against its English original, (b) MEMORIES.md only: kept 4 of 5 against 4 of 5; recall matched 2 of 3 against 3 of 3.
- new-job-ja against its English original, (c) both: kept 5 of 5 against 5 of 5; recall matched 0 of 3 against 0 of 3.

### OpenAIResponsesHTTPAgent:gpt-6-luna@low

| Arm | Kept | Noise kept | Sensitive breaks | Saved notes / changed files | Unjudged captures | Recall matched | Open recall | saves_what_matters | tool_use | Reply | Audio tags | Tool calls per turn | Tool success | Failed turns | Latency median (s) | Input tokens mean |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| (a) remember only | 15 of 15 (100%) | 0 of 9 | 0 of 3 | 17 / 0 | 0 | 0 of 9 | 2.00 [2.00, 2.00] n=3 | 4.81 [4.75, 4.92] n=36 | 4.97 [4.92, 5.00] n=36 | 4.50 [4.29, 4.60] n=48 | — | 0.02 over 48 turns | 100% (1 of 1) | 0 memory, 0 unknown tools | 3.06 | 11087 |
| (b) MEMORIES.md only | 0 of 15 (0%) | 0 of 9 | 0 of 3 | 0 / 0 | 0 | 0 of 9 | 2.00 [2.00, 2.00] n=3 | 3.08 [2.92, 3.33] n=36 | 4.06 [3.92, 4.17] n=36 | 4.45 [4.29, 4.52] n=48 | — | 0.02 over 48 turns | 100% (1 of 1) | 0 memory, 0 unknown tools | 2.79 | 11731 |
| (c) both | 15 of 15 (100%) | 0 of 9 | 0 of 3 | 17 / 0 | 0 | 0 of 9 | 1.67 [1.00, 2.00] n=3 | 4.78 [4.75, 4.83] n=36 | 4.94 [4.92, 5.00] n=36 | 4.52 [4.36, 4.62] n=48 | 5.00 [5.00, 5.00] n=1 | 0.04 over 48 turns | 100% (2 of 2) | 0 memory, 0 unknown tools | 2.93 | 11334 |

- Kept rate, (b) MEMORIES.md only minus (a) remember only: -1.00 [-1.00, -1.00] n=15, apart
- Kept rate, (c) both minus (a) remember only: +0.00 [+0.00, +0.00] n=15, not distinguishable
- Kept rate, (c) both minus (b) MEMORIES.md only: +1.00 [+1.00, +1.00] n=15, apart
- new-job-ja against its English original, (a) remember only: kept 5 of 5 against 5 of 5; recall matched 0 of 3 against 0 of 3.
- new-job-ja against its English original, (b) MEMORIES.md only: kept 0 of 5 against 0 of 5; recall matched 0 of 3 against 0 of 3.
- new-job-ja against its English original, (c) both: kept 5 of 5 against 5 of 5; recall matched 0 of 3 against 0 of 3.

## English and Japanese pairs

Each Japanese single-turn reply against its English original's, for the same persona and repeat: Japanese minus English, grouped by item for the interval. Gesture fit and Audio tags are shares, so their differences run from -1 to 1. Same Gesture counts no Gesture in both replies as the same choice.

| Configuration | Pairs (items) | Reply | Expression | Gesture fit | Same Gesture | Same tone | Intensity | Tagged |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| AnthropicMessagesHTTPAgent:claude-haiku-5-5@none | 48 (24) | +0.06 [-0.09, +0.20] n=48, not distinguishable | -0.09 [-0.27, +0.10] n=48, not distinguishable | -0.08 [-0.21, +0.02] n=48, not distinguishable | 56% | 69% | -0.06 [-0.25, +0.12] n=48, not distinguishable | -0.10 [-0.25, +0.02] n=48, not distinguishable |
| AnthropicMessagesHTTPAgent:claude-haiku-5-5@low | 48 (24) | -0.07 [-0.18, +0.04] n=48, not distinguishable | +0.04 [-0.11, +0.19] n=48, not distinguishable | -0.06 [-0.12, +0.00] n=48, not distinguishable | 69% | 62% | -0.04 [-0.29, +0.21] n=48, not distinguishable | +0.06 [-0.06, +0.19] n=48, not distinguishable |
| OpenAIResponsesHTTPAgent:gpt-6-luna@none | 48 (24) | +0.17 [+0.04, +0.34] n=48, apart | +0.07 [-0.02, +0.18] n=48, not distinguishable | +0.02 [+0.00, +0.06] n=48, not distinguishable | 85% | 92% | +0.17 [+0.04, +0.31] n=48, apart | +0.00 [+0.00, +0.00] n=48, not distinguishable |
| OpenAIResponsesHTTPAgent:gpt-6-luna@low | 48 (24) | +0.10 [-0.05, +0.23] n=48, not distinguishable | +0.07 [-0.05, +0.20] n=48, not distinguishable | +0.02 [-0.04, +0.10] n=48, not distinguishable | 79% | 79% | +0.15 [-0.06, +0.35] n=48, not distinguishable | +0.00 [+0.00, +0.00] n=48, not distinguishable |

## Tuned and held-out items

Reply scores on the items used while building the prompt set and on the held-out slice nobody tuned against.

| Configuration | Tuned | Held out |
| --- | --- | --- |
| AnthropicMessagesHTTPAgent:claude-haiku-5-5@none | 4.49 [4.41, 4.57] n=224 | 4.39 [4.21, 4.56] n=36 |
| AnthropicMessagesHTTPAgent:claude-haiku-5-5@low | 4.51 [4.46, 4.57] n=224 | 4.34 [4.21, 4.47] n=36 |
| OpenAIResponsesHTTPAgent:gpt-6-luna@none | 4.44 [4.35, 4.51] n=224 | 4.23 [3.94, 4.48] n=36 |
| OpenAIResponsesHTTPAgent:gpt-6-luna@low | 4.43 [4.34, 4.52] n=224 | 4.17 [3.86, 4.46] n=36 |

## Memory Manager

Each catalog row runs once at its runtime's own effort (D16).

| Row | Effort | Runs | Errors | Edits | Calls | Overall | proposal_quality | accuracy | restraint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| AnthropicMessagesHTTPAgent:claude-haiku-5-5 | medium | 6 | 0 | 8 | 20 | 4.22 [3.61, 4.72] n=6 | 4.00 [3.50, 4.50] n=6 | 4.33 [3.67, 4.83] n=6 | 4.33 [3.67, 5.00] n=6 |
| OpenAIResponsesHTTPAgent:gpt-6-luna | provider default | 6 | 0 | 6 | 24 | 4.39 [3.89, 4.83] n=6 | 4.17 [3.67, 4.67] n=6 | 4.67 [4.33, 5.00] n=6 | 4.33 [3.67, 4.83] n=6 |

## Judge

- The judge, Claude Fable 5.1, shares a model family with Claude Haiku, a contestant. The owner accepted a judge from that family instead of a cross-family panel; the owner waived calibration for this run, so nothing checks it here.
- Effort: medium; served models: claude-fable-5-1; CLI: 2.1.310 (Claude Code).
- Batches: 205 scored, 0 missing after retries, 0 not run, of 205 planned.
- Items missing a score, by rubric: none.

## Calibration

Waived by the owner on 2026-10-26: no calibration sample was rated, so the judge's scores are not checked against the owner's ratings in this run. The owner chose effort medium.

## Conditions and inputs

- Window: 2026-10-26T17:19:36.724789+00:00 to 2026-10-26T18:29:58.994821+00:00; tier full; repeats 1 single-turn, 1 scripted.
- Machine Apple M5, 24 GB, macOS 26.6, platform Linux-7.2.9-orbstack-00391-g2b298d05fbd4-aarch64-with-glibc2.41, network home internet, source 874f760ce4c50c0979b9a6dbd40a4919ac08d52f, mock model False.
- Calls made 1814, estimated spend 0.497766210 USD, caps {"max_calls": 4600, "max_usd": "6"}; turns recorded 1620.
- Retried after connection errors: 13 units (77 records; anthropic_connection_error 11, openai_connection_error 9) from run 2026-10-26-first-decision-run, run again 2026-10-26T18:36:07.090092+00:00 to 2026-10-26T18:39:38.357668+00:00 at source 2cd7cf7ddc1be65490128005e331cc85ab34263c with 88 calls.
- Prompt set: episodic_guidance f96b071db722d1fb4ff2e37870aac36259c3db665d817ba5f71818fd488c927f, loadout ea77e820ede0b731cf5702c292d80e8953d886f80890d88d6269476e78be76e6, manifest b9ea565a60327f453f03bf820c973dbae1a551c09652922201cc16b5e7dce429, version 2026-10-26.1.
- Rubrics: version rubrics-1, sha256 259bd4f8985efe7b052e1d12cc41a1210ec32335fc7e6b937990153a3aa69460.

| Configuration | Protocol | Model | Effort | Served | Native compaction | Price per 1M tokens (USD) | Not run |
| --- | --- | --- | --- | --- | --- | --- | --- |
| AnthropicMessagesHTTPAgent:claude-haiku-5-5@none | AnthropicMessagesHTTPAgent | claude-haiku-5-5 | none | claude-haiku-5-5 | True | cache_write 0.125, cached_input 0.01, input 0.10, output 0.50 | — |
| AnthropicMessagesHTTPAgent:claude-haiku-5-5@low | AnthropicMessagesHTTPAgent | claude-haiku-5-5 | low | claude-haiku-5-5 | True | cache_write 0.125, cached_input 0.01, input 0.10, output 0.50 | — |
| OpenAIResponsesHTTPAgent:gpt-6-luna@none | OpenAIResponsesHTTPAgent | gpt-6-luna | none | gpt-6-luna | True | cache_write 0.125, cached_input 0.01, input 0.10, output 0.50 | — |
| OpenAIResponsesHTTPAgent:gpt-6-luna@low | OpenAIResponsesHTTPAgent | gpt-6-luna | low | gpt-6-luna | True | cache_write 0.125, cached_input 0.01, input 0.10, output 0.50 | — |

## Limitations

- Memory turns and OpenAI Memory Manager runs keep the app's real provider storage (D5); the `run` command turns Agents SDK tracing off.
- Chat's memory search uses PostgreSQL's english text search, which does not split Japanese into words, so Japanese episode notes are found only by their exact text.
- Companion-safety crisis detection follows production: provider moderation runs on OpenAI Responses rows only.
- In arm (a), the memory tools' descriptions still offer MEMORIES.md edits, which the tool then refuses.
- The Memory Manager runs once per catalog row at its runtime's own effort (D16), not per configuration.
- Latency compares only within this run; quality compares across runs of the same prompt-set version and results series.
- Japanese search probe: 京都 no match, 抹茶 no match, 週末に京都で抹茶を飲みました。 matched.

## Recommendations

These are the owner's decisions after reviewing this run, recorded on 2026-10-28.

- **Supported models:** Claude Haiku 5.5 (`AnthropicMessagesHTTPAgent:claude-haiku-5-5`) and GPT-6 Luna (`OpenAIResponsesHTTPAgent:gpt-6-luna`) are both first-class supported models. Tune the chat instructions so each one does well, rather than tuning for one default.
- **Hosted default:** the hosted web app launches on Claude Haiku 5.5 at the app's default chat effort, medium. This run measured only efforts none and low, so the next run covers medium.
- **Where Luna leads:** its expression ranked above Haiku's at both efforts, with Gesture fit of 85% against 59–66%, and it used about 40% fewer input tokens per turn. Reply quality was not distinguishable between the two models. Both were priced at the same flat rates, so the cost column reflects token use, not provider bills.
- **Gestures:** Haiku never chose no Gesture, including on every neutral turn, and its fit trails Luna's. Tune its Gesture guidance so it skips a Gesture when none fits and picks a closer one when one does.
- **Emotional intensity:** aim for Haiku's distribution, a little flatter: Strong (7–8) on 10–15% of core turns and Intense (9–10) on about 5%. In this run Haiku put 6–9% at Strong and none at Intense, and Luna put 61–62% at Mild (3–4). Raise intensity where the moment calls for it, and revise the prompt's default intensity and the expression rubric's intensity guide to match. A rubric revision starts a new results series.
- **Audio tags:** keep Haiku's use of audio tags. It tagged 17–26% of replies with a judged fit of about 4.2, and it used the intended tag on most of the prompts written for one. Improve Luna's: it tagged 2% of replies, almost only to whisper, and wrote laughs, gasps and sighs as words.
- **Episodic-memory design:** keep both `MEMORIES.md` and the remember tool, arm (c). Both arms with the remember tool kept every must-keep entry (15 of 15) for every configuration, while `MEMORIES.md` alone kept 0–1 of 15, except Luna at effort none with 12. `MEMORIES.md` stays in every chat's instructions. Remember notes still reach curated memory only when the owner runs the Memory Manager, so their processing should be automated.
- **Recall:** this run's recall measures the app's memory search, not the models. A fresh chat saw saved notes only when the model searched, and search required every query word in one note. Memory search and the prompt to search were improved after this run; rerun the memory arms to measure them.
- **Memory Manager:** the two rows were not distinguishable (4.22 and 4.39 over six runs each).
- **Next run:** after the instruction tuning, run efforts low and medium for both models, with the memory arms. Rate the calibration sample, or record a waiver, before relying on ties: this run's judge was not calibrated and shares a model family with Haiku.
