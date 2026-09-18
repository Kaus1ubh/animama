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
Consult relevant entries in the [glossary](../../GLOSSARY.md) and
[ADR index](../adr/README.md).

This repository has one root glossary and one ADR collection. The glossary
establishes common language between Raymond and agents: a term should mean the
same thing in discussion, specifications, implementation and review. Package
boundaries alone do not require more glossaries.

Each artifact has a distinct job:

- **Glossary:** common human–AI meanings, distinctions and discouraged synonyms.
  Surface ambiguous usage and propose a precise definition before treating a new
  meaning as established. Do not rename source code merely to match a glossary edit.
- **Current documentation:** implemented behavior, interfaces, architecture and
  operational instructions. Update it when that behavior changes.
- **ADR:** a significant architectural choice and its rationale, alternatives
  and consequences. It explains why; it is not a second implementation guide.
- **Private ExecPlan:** execution steps, phases, approval history and validation
  evidence. Full plans remain privately owned, including plans for local code.
- **Future GitHub parent issue:** the agreed product specification and acceptance
  scope once the tracker workflow is enabled. Its relationship with ExecPlans is
  deferred; existing planning rules remain in force during the pilot.

For ADR selection criteria, authoring, retrospective evidence and supersession,
follow the [ADR authoring guide](../adr/README.md#when-and-how-to-record-a-decision).
Keep current behavior documentation up to date alongside decision records.

## Privacy and authorization

Public documentation must be self-contained without private plans, private links
or a Cloud checkout. Promote only the enduring, reviewable contract or rationale;
leave private execution evidence and approvals with their planning owner. Cite
publicly available evidence where possible, without exposing private material.

Reading this guide grants no publication, GitHub mutation or implementation
authority. Do not automatically create issues, labels or comments. In Plan mode,
discuss proposed artifacts without writing files or changing GitHub state. In an
implementation task, follow its authorized scope and existing verification gates.
