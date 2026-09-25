# 0008: Non-overridable companion guardrail

- Status: proposed
- Recorded: 2026-09-25
- Retrospective: no
- Original decision date: 2026-09-25 (owner decisions during companion safety discovery)
- Decision basis: new proposal; accepted spec for [companion safety baseline](https://github.com/raymond-van/animama/issues/134)

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

Every chat turn ends its provider instructions with a fixed, server-owned
**Companion Guardrails** section. It comes after the core instruction, the
identity, memory and response guidance, the memory map, attachments, the
compaction summary and any per-turn care note. For providers without a developer
role, the trailing developer text is folded into the system message so the
guardrail is still last. The guardrail:

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

No setting, environment variable, persona or `IDENTITY.md` removes or edits it.
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

## Consequences

- Instruction text grows by a small fixed section on every turn.
- Exact-prompt tests assert that the guardrail is the final instruction text.
- Guardrail wording changes are product decisions reviewed by the owner.
- Persona immersion is preserved by asking for in-character honesty rather than
  robotic disclaimers.

## Evidence

- [`app/safety/prompts.py`](../../src/backend/animama/app/safety/prompts.py):
  guardrail text.
- [`app/chat/openai_prompt.py`](../../src/backend/animama/app/chat/openai_prompt.py):
  trailing instruction placement.
- [`tests/test_companion_guardrail.py`](../../tests/test_companion_guardrail.py):
  placement and coverage tests.
