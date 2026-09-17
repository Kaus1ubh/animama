# Domain documentation

This guide supports an explicit intent-discovery pilot: when the user requests
discovery, clarify the problem, terms and consequential choices before implementation.
It is not a compulsory interview, document-writing step or skill dependency for
every change. Follow the [root agent guide](../../AGENTS.md) and relevant scoped
guides; this page does not replace their instructions or approval boundaries.

## Read and place information

Read the relevant current architecture, contract and operational docs before
exploring an area. `docs/architecture/`, `docs/backend/` and `docs/frontend/`
remain the sources for current documented behavior. Verify claims against code
when needed and flag conflicts explicitly rather than silently selecting a side.
Consult only relevant glossary entries and ADRs when those artifacts exist.

The planned layout is one root `GLOSSARY.md` and one `docs/adr/` directory for
this repository. These are future artifacts, not prerequisites or instructions
to create empty files. Package boundaries alone do not require more glossaries.

Each artifact has a distinct job:

- **Glossary:** domain terms, their meaning, distinctions and discouraged
  synonyms. Use agreed terms consistently; surface ambiguity before renaming.
- **Current documentation:** implemented behavior, interfaces, architecture and
  operational instructions. Update it when that behavior changes.
- **ADR:** a significant architectural choice and its rationale, alternatives
  and consequences. It explains why; it is not a second implementation guide.
- **Private ExecPlan:** execution steps, phases, approval history and validation
  evidence. Full plans remain privately owned, including plans for local code.
- **Future GitHub parent issue:** the agreed product specification and acceptance
  scope once the tracker workflow is enabled. Its relationship with ExecPlans is
  deferred; existing planning rules remain in force during the pilot.

## Decide whether an ADR is useful

Record a choice as an ADR only when all three tests hold:

1. Reversing the choice would have meaningful cost.
2. It would be surprising without its context.
3. It involves a genuine trade-off between alternatives.

Routine implementation details, observations and execution progress belong in
their existing documents or task records. Do not create an ADR for every change.

An ADR states its status, recording date, supporting evidence and a short
context–decision–reason explanation. Add alternatives and consequences when useful.
Mark a proposed choice as proposed.
An AI agent may mark an ADR accepted without separate human confirmation.
Records generally capture product and architecture decisions developed through
human–AI collaboration. State the decision basis and who accepted the record;
accepting an ADR does not grant authority to make an otherwise unauthorized
product or architecture change.

For a retrospective record, distinguish the date it is written from the original
decision date. Preserve an unknown original date or rationale as unknown rather
than inventing either. Separate observed implementation from documented intent
and identify the evidence for each. Acceptance today, by a human or agent, does
not prove why or when the original implementation was chosen. Existing code establishes observed behavior, not
historical rationale or human approval.

When a decision changes, create a successor and mark the earlier record as
superseded, linking both directions once the records exist. Preserve the original
decision and rationale; do not rewrite history to match today's implementation.
Update current behavior docs separately to describe the resulting system.

## Privacy and authorization

Public documentation must be self-contained without private plans, private links
or a Cloud checkout. Promote only the enduring, reviewable contract or rationale;
leave private execution evidence and approvals with their planning owner. Cite
publicly available evidence where possible, without exposing private material.

Reading this guide grants no publication, GitHub mutation or implementation
authority. Do not automatically create issues, labels or comments. In Plan mode,
discuss proposed artifacts without writing files or changing GitHub state. In an
implementation task, follow its authorized scope and existing verification gates.
