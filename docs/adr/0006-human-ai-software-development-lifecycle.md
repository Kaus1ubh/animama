# 0006: Human and AI software development lifecycle

- Status: accepted; planning location/privacy superseded by [ADR 0007](0007-repository-owned-planning.md)
- Review-depth proposal: [ADR 0027](0027-risk-tiered-review-and-single-suite-run.md) (proposed) would replace the per-phase review rule with risk-tiered review; this record's rule applies until it is accepted.
- Recorded: 2026-09-19
- Retrospective: no
- Original decision date: 2026-09-19, through the owner's portable lifecycle implementation request and request for this record.
- Decision basis: Explicit owner decision, recorded in the current lifecycle and specification guides.

## Context

Human and AI collaboration needs an agreed outcome, a reviewable implementation
approach and evidence that the delivered changes meet both. Lifecycle steps must
be independently invocable, resumable and usable by other codebases. Project
conventions and private planning must remain in their appropriate repository
records, with local contributor guidance independently accessible.

## Decision

Humans direct intent, review specifications and required execution plans, and
resolve consequential product and architecture choices. Agents investigate
available facts, prepare those artifacts, set up the workspace, implement the
authorized outcome, validate it and perform independent review. Intent discovery
interviews address unresolved intent; already settled decisions do not require
another interview.

Use a portable bundle of nine skills: `setup-ray-skills`, `intent-discovery`,
`to-spec`, `to-execplan`, `workspace-setup`, `implement`, `tdd`, `code-review`
and `git-workflow`. Setup reconciles the repository's existing guides, templates
and conventions and records them in `SDLC.md`. Subsequent skills use that
established contract. Project-specific commands, locations and gates belong in
repository guidance rather than the portable skill instructions.

Specifications define the problem, behavior, constraints and acceptance.
ExecPlans define the phased approach, dependencies, validation and recovery for
substantial, uncertain or risky work. A reviewed draft spec is authoritative
until workspace setup publishes it to the owning GitHub issue; the retained file
then becomes a snapshot. Routine work can use an issue and brief approach, with
the existing incidental-correction exception. Full execution plans and approval
history remain private; local issues, PRs and durable documentation stand alone.

After spec and plan review, `implement` starts with workspace setup and then
executes the authorized phases. Use TDD through observable interfaces where it
provides useful evidence, with proportionate exceptions for documentation,
mechanical changes and adequately covered refactors. Prefer the simplest solution
that meets the requirements and existing engineering standards.

Each phase and the final integration scope receive one comprehensive independent
review and at most two repair rounds. Reviewers report evidence; the implementing
agent verifies findings, records their disposition and makes accepted fixes.
Repair reviews check those fixes and resulting regressions. Optional preferences
do not block progress, and unresolved verified blockers stop progress when the
repair budget is exhausted. Persist evidence and counts across resumptions.

New plans advance automatically when required checks and review pass, within the
authorized phase range. Preserve every explicit verification gate in an existing
plan. Final validation and integration review lead to an automatically prepared
PR. Merge requires owner approval of the exact candidate and defaults to an
ordinary merge commit. Deployment, publication and other explicit gates retain
their separate authority.

## Rationale and consequences

This directs human attention to intended outcomes and consequential choices while
giving agents a clear execution boundary. Observable acceptance and independent
review make delivery assessable without requiring the owner to inspect every
implementation detail. A bounded review budget prevents speculative improvements
from becoming an endless completion condition; it does not waive real defects or
failed checks.

Repository setup makes the skills reusable without competing workflow defaults.
That requires maintaining the configured guides and templates as conventions
change. Separating the spec from the plan keeps agreement about behavior distinct
from implementation strategy, while explicit authority and snapshot rules avoid
two competing specifications. Private planning remains compatible with a
self-contained local contribution workflow.

## Evidence

- [SDLC](../../SDLC.md): responsibilities, repository setup, progression,
  bounded review and exact-candidate merge authority.
- [Specification guide](../../SPECS.md): outcome and acceptance authoring,
  issue publication and snapshot authority.
- [Agent guide](../../AGENTS.md#planning-and-change-records): planning threshold,
  private records and independently usable local guidance.
- [Setup skill](../../.agents/skills/setup-ray-skills/SKILL.md),
  [implementation skill](../../.agents/skills/implement/SKILL.md) and
  [review skill](../../.agents/skills/code-review/SKILL.md): executable lifecycle
  instructions, handoffs and the bounded review procedure.

This record accepts the workflow decision. It does not claim completion of a
separately gated pilot, acceptance of a particular delivery or merge approval.
