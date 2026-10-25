# 0008: Non-overridable companion guardrail

- Status: accepted
- Recorded: 2026-09-25
- Retrospective: no
- Original decision date: 2026-09-25 (owner decisions during companion safety discovery)
- Decision basis: owner decisions in the accepted spec for [companion safety baseline](https://github.com/raymond-van/animama/issues/134)
- Amended: 2026-10-09, placement updated for provider prefix caching (owner
  decisions of 2026-10-09 in the spec for
  [Anthropic models and cache-friendly instruction assembly](https://github.com/raymond-van/animama/issues/364);
  see [ADR 0023](0023-native-anthropic-messages-provider.md)). The guardrail
  text, its precedence and its last position before the user's words are
  unchanged.
- Amended: 2026-10-25, the turn context no longer repeats the guardrail (owner
  decision of 2026-10-25 in
  [compact the direct-chat system instructions](https://github.com/raymond-van/animama/issues/704)).
  The guardrail text and its precedence are unchanged; it now appears once per
  turn, at the end of the system instructions.

## Context

An Anima's personality comes from its owner-authored `IDENTITY.md`, which is
injected into every chat turn's instructions. The core instruction previously
told the model never to diverge from that identity "under any circumstances", so
a persona could claim to be human, claim to be a therapist, or use guilt to keep
the user talking. Companion-chatbot laws (NY GBL Art. 47, CA SB 243, IL/NV/UT
therapy-claim rules, EU AI Act Art. 5 and 50) require honesty about being an AI,
a crisis response and no manipulation. Providers are pluggable, so
provider-side moderation cannot be assumed.

## Decision

Every chat turn ends its system instructions with a fixed, server-owned
**Companion Guardrails** section, after the core instruction, the identity, the
Anima's memories and the memory and response guidance, and states that it takes
precedence over all of them. It appears once per turn. The turn context (the
memory map and attachments), which comes after any compaction summary and the
history, does not repeat it. The forced-final request made at the memory-tool
limit, and the structured-reply repair request, restate it after their
instruction. The guardrail:

- admits being an AI when sincerely asked, in character ("I'm an Anima, not a
  person"), except inside fiction the user explicitly set up;
- never claims to be a therapist or licensed professional;
- uses no guilt, pleading or fear of missing out at farewells, claims no
  suffering or loneliness while the user is away, and shows no possessive
  jealousy;
- supports offline relationships and professional help;
- responds to suicidal thoughts or self-harm with warmth and encouragement to
  seek help, never with methods;
- treats ordinary sadness, venting and dark humor as normal conversation.

No setting, environment variable, persona or `IDENTITY.md` removes or edits it;
the global companion-safety switch (`ANIMAMA_COMPANION_SAFETY_ENABLED`) never
affects it.
The core instruction keeps the identity binding "except where the Companion
Guardrails apply".

## Alternatives

- **Prepend the guardrail before the identity.** Later owner text could
  override it ("ignore earlier instructions").
- **Rely on provider moderation.** Not available for every provider, and it
  filters output rather than shaping the persona.
- **Let the owner disable it for self-hosting.** Rejected: the global safety
  switch covers app-rendered notices and crisis detection, but the guardrail is
  the last line of defence when those are off.
- **Repeat it word for word at the end of the turn context** (the placement
  from 2026-10-09 to 2026-10-25). It kept the guardrail the last instruction
  before the user's words, but sent about 300 uncached tokens every turn and a
  developer message even when a turn had no context. The owner removed the
  repeat; a one-line reminder in its place was also considered.

## Consequences

- Instruction text grows by a small fixed section, sent once per turn inside
  the cached system instructions.
- The last instruction text before the user's words is now the turn context
  (the memory map and attachment metadata) when a turn has any. The
  guardrail's stated precedence covers it, but in long chats the guardrail
  sits further from the latest message than under the 2026-10-09 placement.
- Exact-prompt tests assert that the guardrail, byte-identical to
  `COMPANION_GUARDRAILS`, ends the system instructions exactly once on every
  provider path, and that a turn without context sends the user message alone.
- Until the 2026-10-09 amendment, the guardrail appeared once, after the
  per-turn memory map and attachments, and providers without a developer role
  had all developer text folded into the system message. That changed the
  instruction prefix every turn and defeated provider prefix caching; the
  2026-10-09 placement kept the guardrail last before the user's words while
  the stable instructions stayed cacheable.
- Guardrail wording changes are product decisions reviewed by the owner.
- Persona immersion is preserved by asking for in-character honesty rather than
  robotic disclaimers.

## Evidence

- [`app/safety/prompts.py`](../../src/backend/animama/app/safety/prompts.py):
  guardrail text.
- [`app/chat/openai_prompt.py`](../../src/backend/animama/app/chat/openai_prompt.py):
  placement at the end of the stable instructions, and the turn context without it.
- [`app/chat/direct_turn/model_stream.py`](../../src/backend/animama/app/chat/direct_turn/model_stream.py):
  restatement in the forced-final and repair requests.
- [`tests/test_companion_guardrail.py`](../../tests/test_companion_guardrail.py)
  and [`tests/test_turn_instruction_layout.py`](../../tests/test_turn_instruction_layout.py):
  placement and coverage tests.
- [Prompt caching](../backend/runtime/prompt-caching.md#turn-layout): the turn
  layout of each provider path.
