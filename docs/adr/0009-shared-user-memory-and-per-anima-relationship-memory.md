# 0009: Shared user memory and per-Anima relationship memory

- Status: accepted
- Recorded: 2026-09-26
- Retrospective: no
- Original decision date: 2026-09-26 (owner decisions during Anima memories discovery)
- Decision basis: owner decisions in the accepted spec for [Anima memories](https://github.com/raymond-van/animama/issues/156)

## Context

Animama is moving toward companionship, where each Anima's relationship with the
installation owner matters. Before this decision each Anima owned only its
owner-authored `IDENTITY.md`. Everything learned in conversation went to
installation-wide user memory (`PROFILE.md`, ordinary files and the daily episode
log), so every Anima shared one view of the owner and none had a history of its
own. An owner may run several Animas and expects each to relate to them
differently, while not having to repeat basic facts to each one.

## Decision

Memory is split by what it describes:

- **Shared user memory** holds facts about the owner (`PROFILE.md`, ordinary
  memory files) and the episode log. Every Anima reads it.
- **Anima memories** (`MEMORIES.md`) hold one Anima's relationship and shared
  history with the owner. Each Anima has exactly one, created with it, protected
  like its identity and deleted with it. It is included in that Anima's every
  turn directly after its identity and never in another Anima's turns.
- The Anima maintains its own `MEMORIES.md` with small edits during chat. The
  owner can read and edit it. Curation beyond small edits happens through
  **Reflection**, an owner-started Memory Manager conversation whose proposals
  the owner approves; nothing rewrites it automatically in the background.
- `MEMORIES.md` is not part of the Anima definition: editing it does not advance
  the definition revision, and it is private history that any Anima export or
  sharing must exclude.

## Alternatives

- **Everything per Anima.** Each Anima would learn the owner's basic facts
  separately, and the owner would repeat themselves to every companion.
- **Everything shared.** No Anima could have a distinct relationship; one
  Anima's in-jokes and history would leak into another's conversations.
- **Automatic background consolidation.** Spends model tokens without an owner
  action and could rewrite the file without review.

## Consequences

- Each turn's instructions grow by the bounded `MEMORIES.md` (16 KiB limit), and
  edits to it change the instruction prefix used by provider prompt caching
  (follow-up in [#155](https://github.com/raymond-van/animama/issues/155)).
- The companion guardrail (ADR 0008) stays last and overrides `MEMORIES.md`, and
  the sensitive-memory rule governs its writes.
- Anima scope admits only `IDENTITY.md` and `MEMORIES.md`.

## Evidence

- [Anima memories spec](../plans/anima-memories/anima-memories-spec.md): agreed
  requirements R1–R10.
- [Anima memories plan](../plans/anima-memories/anima-memories-execplan.md):
  implementation decisions and delivery evidence.
