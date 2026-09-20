# Writing execution plans

An ExecPlan is a living guide to implementing and verifying an agreed outcome.
Use one for substantial, uncertain or risky work, or when explicitly requested.
Routine work uses an issue with acceptance and a brief approach. Follow
[SDLC.md](SDLC.md) for authorization, phase progression, review and merge gates.

## Location and ownership

Track new Animama plans at `docs/plans/<scope>/<scope>-execplan.md`, beside
`<scope>-spec.md` when a separate spec is useful. Use the task's existing checkout
and branch. Planning alone needs neither a Cloud checkout nor a Compose stack.
These direct files are trackable; nested evidence directories are ignored by
default. Keep necessary, public-safe evidence summaries in the plan and deliberately
classify any new tracked supporting files through the
[boundary inventory](docs/architecture/repository-boundaries.md#classification-provenance-and-licensing).
Do not force-add a directory of raw evidence.

Cloud owns new Cloud plans. For work across repositories, keep each repository's
implementation steps and evidence in its own plan. Name the authoritative issue
for each outcome and the shared requirements/dependencies; link related records
only when the audience can access them. Public records must explain the relevant
contract without requiring private Cloud internals. Do not duplicate requirements
as independently editable specs. [SPECS.md](SPECS.md) owns the authority rule:
the agreed draft is authoritative before issue publication; afterward the owning
issue is authoritative and the tracked spec is a dated snapshot.

Resume existing plans in place. Historical plans are not bulk-migrated or
published. Moving an active plan requires an owner-approved migration that
preserves its source, decisions, evidence, review counts and explicit gates.

## Public-ready content

Write Animama plans as reviewable engineering records. Include the agreed scope,
relevant source revisions, rationale, implementation discoveries, exact validation
commands/results and non-sensitive dated decision summaries. Distinguish proposed
choices, agent findings and actual owner decisions; do not invent approval.

Exclude credentials, personal data, raw conversations, sensitive security
investigations and private machine or planning paths. Keep such supporting material
in its appropriate private channel; summarize only what can safely stand alone.
Use repository-relative paths and placeholders for environment-specific values.
A plan link does not replace an understandable issue or PR. Tracking a plan does
not change repository visibility or authorize release/publication; those gates
remain separate.

## Author and maintain the plan

Identify the accepted spec revision or dated task instruction and authorized phase
range. Explain the outcome, relevant code and contracts, dependencies, working
directories, concrete steps, observable validation and recovery. Inspect available
facts instead of inventing them. Keep implementation choices consistent with the
spec; material changes to behavior, scope or constraints require an owner decision.

Organize phases around verifiable outcomes. Each phase names its requirements,
issue, starting revision, intended changes, checks, completion criteria and any
human, hardware, provider or release gate. Default to one branch and PR per plan
in each affected repository and one issue per authorized phase. New phases may
advance after their required checks and review pass within the authorized scope;
preserve every explicit gate in an existing plan unless the owner changes it.

At each stopping point, update progress, discoveries, decisions, validation and
remaining work. Record exact source and commands with results and limitations.
Separate local, hosted CI, browser, provider, native and physical evidence as
applicable; never mark an unperformed check passed. Record phase commits using
[the naming convention](SDLC.md#names-and-labels). Update durable documentation
when behavior changes; the plan remains delivery history, not the current manual.

## Independent review

Follow [bounded code review](SDLC.md#bounded-code-review): one full initial review
and at most two repair rounds per phase and final integration scope. Record
`Code Review #1 Findings` with source, stable finding IDs, evidence and impact.
The implementing agent verifies each finding and records its disposition, reason,
change and checks under `Code Review #1 Revisions`. No actionable findings is a
valid result; optional preferences do not block completion.

Subsequent reviews target accepted fixes and resulting regressions. Preserve the
review count across resumption and migration. Stop automatic progression when
supported blockers remain at the limit. Final integration review covers combined
acceptance using still-valid phase evidence. Agent readiness does not replace
owner acceptance or exact-candidate merge approval.

## Template

Scale detail to the work; replace placeholders before requesting review.

```markdown
# <Outcome>

Source agreement: <spec revision or dated task instruction>
Authorized scope: <whole plan or selected phases>

## Purpose and context

<Observable outcome, code/contracts, ownership and relevant boundaries.>

## Progress

- [ ] Phase 1: <status, remaining gate and evidence>

## Surprises & Discoveries

<Evidence-backed observations, or none yet.>

## Decision Log

<Dated decision, actor, rationale and non-sensitive reference.>

## Phased implementation

### Phase 1: <Verifiable outcome>

<Requirements, issue, starting source, dependencies and intended changes.>
<Steps, working directories, checks and expected observations.>
<Recovery, completion criteria and explicit gates.>
<Results, limitations and phase commits as work proceeds.>

#### Code Review #1 Findings

<Reviewed source, checks, stable findings and supporting evidence.>

#### Code Review #1 Revisions

<Dispositions, reasons, fixes, verification and remaining repair budget.>

## Final integration review

<Combined acceptance, reused evidence, findings/revisions and remaining gates.>

## Validation and acceptance

<Observable criteria, exact commands/results and outstanding manual checks.>

## Idempotence and recovery

<Safe retries, retained data and recovery steps for consequential changes.>

## Outcomes & Retrospective

<Delivered outcome, remaining limitations and lessons.>
```
