# Execution plans

An ExecPlan is a self-contained, living guide to delivering and verifying an agreed
outcome. Use the configured spec authority, planning root and privacy policy from
the repository setup contract. New plans use `<scope>-execplan.md` beside the spec;
preserve existing locations on resumption. Create phase directories only when needed
for real supporting evidence.

Require a plan for substantial, uncertain or risky work, or when explicitly
requested. Routine work can use its issue and brief approach; incidental corrections
need neither. Judge uncertainty, impact, dependencies and recovery, not size alone.

## Authoring and execution

Identify the accepted spec revision or dated task decision. Include enough context
for a new implementer: definitions, relevant paths/interfaces, working directories,
concrete steps, validation and expected observations, dependencies and recovery.
Keep the outcome consistent with the spec. Agents can revise implementation details
within scope; consequential changes need an owner decision.

Define phases around independently verifiable outcomes. Each phase records its
scope, requirements, review tier, any issue, starting source, intended changes,
check record, review and commits. The parent issue and phase sections track phases;
phase issues are optional. Default to one branch/PR per plan per repository.
New phases advance when required evidence and review pass; name genuine human,
hardware, product or release gates explicitly. Preserve every explicit gate in an
existing plan unless the owner specifically changes it. Agent readiness and human
acceptance must remain distinguishable.

Keep Progress, Surprises & Discoveries, Decision Log and Outcomes & Retrospective
current at each stopping point. Record phase commits using
`<type>(scope)[p#]: summary`. A completed phase has satisfied its required criteria
and gates; tests or a merged PR do not waive outstanding acceptance.

## Review records

Within each phase record `Code Review #1 Findings` with stable finding IDs,
evidence, impact and the violated requirement/standard. The implementing agent
verifies each finding and records its disposition, reason, fix and checks in
`Code Review #1 Revisions`. Optional suggestions do not block; no findings is valid.

Allow one full initial review and at most two repair rounds. Number subsequent
targeted findings/revisions and preserve counts through resumption. Follow-ups
cover accepted fixes and resulting regressions. Stop automatic progression if
blockers remain at the limit. Record a separate final integration review using
valid phase evidence rather than restarting cleared phase reviews; it also covers
light phases that skipped their own review. Commit records with the work they
describe rather than in record-only commits.

## Authoring skeleton

    # <Action-oriented outcome>

    Source agreement: <spec revision or dated task instruction>
    Authorized scope: <whole plan or selected phases>

    ## Purpose and context
    <Outcome, how to observe it, relevant repository knowledge and boundaries.>

    ## Progress
    - [ ] Phase 1: <state, evidence and gate; timestamp/commits when available>

    ## Surprises & Discoveries
    <Observations with evidence, or none observed yet.>

    ## Decision Log
    <Decision, rationale, date and actor.>

    ## Phased implementation

    ### Phase 1: <Verifiable outcome>
    <Scope, requirements, review tier and reason, dependencies, any issue and starting source.>
    <Concrete steps and intended interfaces.>
    <Checks, working directories, expected results and recovery.>
    <Check record: command, working directory, result and Git tree.>
    <Explicit gates, or no additional gate after considering the work.>
    <Completion evidence and commits.>

    #### Code Review #1 Findings
    <Reviewed source/scope; checks; finding IDs, evidence and impact.>

    #### Code Review #1 Revisions
    <Dispositions, reasons, fixes, verification and remaining repair budget.>

    ## Final integration review
    <Overall acceptance, reused evidence, findings/revisions and gates.>

    ## Validation and acceptance
    <Observable criteria and exact checks; separate human/manual evidence.>

    ## Idempotence and recovery
    <Safe retries and recovery for risky steps.>

    ## Outcomes & Retrospective
    <Delivered behavior, remaining gaps and useful lessons.>
