# Architecture decision records

ADRs explain significant product and architecture choices, generally developed
through human–AI collaboration. They preserve why a choice was made; current
architecture docs explain how the system works and the [glossary](../../GLOSSARY.md)
establishes common meanings between Raymond and agents.

## Index

Records 0001–0005 document foundational decisions retrospectively; records 0006–0007
record lifecycle and planning ownership decisions; later records document product decisions. Each record states its decision basis
and dates. Acceptance is not proof of unknown historical human approval,
production readiness or publication rights.

| ID   | Decision                                                                                                                                           | Status                                |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| 0001 | [Independent local product and packaged sharing](0001-independent-local-product-and-packaged-sharing.md)                                           | accepted                              |
| 0002 | [Accountless installation ownership and local HTTP admission](0002-accountless-installation-and-http-admission.md)                                 | accepted                              |
| 0003 | [Request-local direct chat and streamed delivery](0003-request-local-streamed-chat.md)                                                             | accepted                              |
| 0004 | [Filesystem content, catalog persistence and recoverable mutations](0004-filesystem-content-and-recoverable-mutations.md)                          | accepted                              |
| 0005 | [Client-rendered shared UI and local/native composition](0005-client-rendered-ui-and-local-native-composition.md)                                  | accepted                              |
| 0006 | [Human and AI software development lifecycle](0006-human-ai-software-development-lifecycle.md)                                                     | accepted; planning superseded by 0007 |
| 0007 | [Repository-owned specifications and execution plans](0007-repository-owned-planning.md)                                                           | accepted                              |
| 0008 | [Non-overridable companion guardrail](0008-non-overridable-companion-guardrail.md)                                                                 | accepted                              |
| 0009 | [Shared user memory and per-Anima relationship memory](0009-shared-user-memory-and-per-anima-relationship-memory.md)                               | accepted                              |
| 0010 | [Shared voice model objects and optional downloads](0010-shared-model-object-distribution.md)                                                      | accepted; partly superseded by 0012   |
| 0011 | [Application-owned companion features and composition catalog policy](0011-application-owned-companion-features-and-composition-catalog-policy.md) | accepted                              |
| 0012 | [Parakeet speech models as backend model assets](0012-backend-parakeet-model-assets.md)                                                            | accepted                              |
| 0013 | [Native Windows desktop packaging](0013-native-windows-desktop-packaging.md)                                                                       | accepted                              |
| 0014 | [Track-based Anima Pose Clips organised by beats](0014-track-based-anima-pose-clips.md)                                                            | accepted                              |
| 0015 | [One Avatar Effect definition source and model-agnostic face parts](0015-avatar-effect-definition-source-and-face-parts.md)                        | accepted                              |

## When and how to record a decision

Create an ADR when reversal has meaningful cost, the choice needs its context to
be understood, and there is a genuine trade-off between alternatives. Routine
implementation details and task progress belong in their existing records.

1. Read relevant glossary entries, ADRs, current docs and representative source.
   Surface contradictions; distinguish observed behavior from documented intent.
2. Use the next sequential `NNNN-short-slug.md` in this repository. Recheck before
   landing concurrent additions and repair links if an unaccepted record is renumbered.
3. Write concise context, decision and rationale, with evidence. Include alternatives
   and consequences when they explain a real trade-off; do not invent past deliberation.
4. Mark unresolved choices `proposed`. An AI agent may accept a supported record
   without separate confirmation from Raymond. Record the decision basis;
   this grants no authority to make otherwise unauthorized product or architecture changes.
5. Add the record and its status to this index. Correct current documentation
   made incomplete or misleading by the decision; an ADR is not a usage guide.

## History, corrections and supersession

Use `proposed`, `accepted`, `deprecated` or `superseded`. Deprecated means the
choice no longer applies without a replacement; superseded records link a successor.
A changed significant decision gets a new ADR, with reciprocal links and the index
updated when the successor is accepted. Preserve the old decision and rationale.
Corrections may clarify facts or evidence without silently replacing the original choice.

A retrospective record separates its recording date from original decision dates.
Write unknown dates, authorship or rationale as unknown. Identify present-day
justification as such. Accepting a record today does not prove who approved the
original implementation or why they chose it. Unknown historical rationale alone
does not prevent accepting an accurately evidenced current boundary.

References must resolve within Animama or to independently accessible material.
Do not link private plans, copy approval transcripts or require a Cloud checkout.
Keep detailed historical investigation and private evidence with their private
planning owner; state any uncertainty needed to understand the record here.

## Authoring template

Copy this structure into the new record; replace all placeholders. Recording dates
use `YYYY-MM-DD`. Evidence should link
specific source files or durable docs, with symbols or sections when helpful.

```markdown
# NNNN: Decision title

- Status: proposed
- Recorded: YYYY-MM-DD
- Retrospective: yes / no
- Original decision date: YYYY-MM-DD with evidence, or unknown
- Decision basis: documented decision / observed current contract / new proposal

## Context

The problem and relevant constraints.

## Decision

The chosen boundary or behavior.

## Rationale and consequences

Documented reasons, present-day justification and unknown historical rationale,
clearly distinguished. Alternatives and consequences only when useful.

## Evidence

Links supporting the claims; explain what each establishes.
```

Follow the [domain documentation guide](../agents/domain.md) for terminology
conflicts, current documentation and authorization boundaries.
