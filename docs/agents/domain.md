# Domain documentation

When the user requests intent discovery, clarify the problem, terms and
consequential choices before implementation.
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
- **ExecPlan:** execution steps, phases, decision summaries and validation evidence
  for substantial, uncertain or risky work. Track new plans with their owning
  implementation; [PLANS.md](../../PLANS.md) defines authoring and privacy.
- **Specification:** agreed intent, behavior, constraints and acceptance. Draft
  it in this repository's configured planning destination; workspace setup publishes
  the agreed spec in the owning issue, or parent issue for substantial work.
  The issue then owns the spec and the tracked file becomes a dated snapshot.
  [SPECS.md](../../SPECS.md) defines authoring; [SDLC.md](../../SDLC.md) defines
  delivery. Routine issues need a brief approach, not a separate ExecPlan.

Keep one authoritative spec. Plans may summarize its accepted context and identify
the source decision, but cannot independently change requirements. Reconcile
material scope changes with the owner before dependent implementation.

For ADR selection criteria, authoring, retrospective evidence and supersession,
follow the [ADR authoring guide](../adr/README.md#when-and-how-to-record-a-decision).
Keep current behavior documentation up to date alongside decision records.

## Privacy and authorization

Public documentation must be self-contained without private plans, private links
or a Cloud checkout. Plans may contain public-safe decision and validation
summaries; current docs contain enduring contracts and rationale. Keep secrets,
personal data, raw transcripts and sensitive investigations out of both. Existing
private planning evidence stays with its owner unless deliberately reviewed for
migration; changing the default location does not authorize publication.

Reading this guide grants no publication, GitHub mutation or implementation
authority. In an authorized implementation task, follow
[SDLC.md](../../SDLC.md) for issue creation, workspace setup, implementation and
review. Preserve every explicit verification gate in an existing plan.
