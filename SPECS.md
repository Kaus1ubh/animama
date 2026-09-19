# Writing specifications

A spec records the agreed problem, desired behavior, constraints and acceptance.
An ExecPlan records how to deliver and verify it. Follow [SDLC.md](SDLC.md) for
when each is needed and who can authorize work.

## Where a spec lives

Draft a spec before creating its implementation issues. The
[repository setup contract](SDLC.md#repository-setup) defines the planning
destination. For maintainer work, use `<scope>/<scope>-spec.md` under the private
planning root supplied in the authorized task context, beside
`<scope>-execplan.md` when an ExecPlan is needed. Do not guess that root, write
private planning artifacts into this repository, or expose its location publicly.
If the private destination is unavailable, keep the draft in the conversation;
public contribution never requires a private checkout.

`to-spec` prepares the draft; it does not create issues. When implementation is
authorized, `workspace-setup` publishes the agreed, non-sensitive spec in the
owning GitHub issue, using a parent issue for substantial work and the
[parent form](.github/ISSUE_TEMPLATE/parent.yml) content contract. Read back the
published issue. From that point the issue is authoritative and the local spec
file is a snapshot: record its source URL and captured revision or update time,
and refresh it from the issue before resuming. Do not edit the snapshot as a
competing source of requirements.

For routine work, the [task form](.github/ISSUE_TEMPLATE/task.yml) or
[bug form](.github/ISSUE_TEMPLATE/local-bug.yml) may contain the whole spec and
brief approach. Reuse an existing agreed issue when the outcome still fits it;
no extra draft or discovery interview is required.

This file is authoring guidance, not a collection of feature specs. Keep one
authoritative spec per outcome. Implementation plans and sub-issues may summarize
it and cite requirement IDs; they must not independently redefine it. Public
specs must stand alone without private plans, credentials or personal test data.

## Write for an implementer and a reviewer

- Explain the problem and intended users before proposing a solution.
- Define scope and exclusions. Consult the [glossary](GLOSSARY.md), current docs
  and relevant [ADRs](docs/adr/README.md); flag conflicts with existing contracts.
- Describe observable outcomes, including relevant errors, cancellation, recovery,
  persistence and compatibility. State measurable bounds when they matter.
- Include technical choices only when they are genuine requirements or agreed
  constraints. Leave changeable implementation steps to the plan.
- Make acceptance specific enough to judge independently of the implementation.
  Name the necessary evidence: tests, rendered behavior, migration results or
  owner/manual verification. A passing test alone may not cover the whole outcome.
- State unknowns rather than inventing decisions. Use focused clarification;
  intent discovery is useful when uncertainty warrants it, not mandatory ceremony.

Use user stories when they clarify an actor and goal, and Given/When/Then examples
when they make behavior easier to verify. Do not restate every requirement in
several formats. Use stable IDs such as `R1` for phased work so phase issues and
acceptance evidence can identify the requirements they cover.

## Template

Parent issues and PRs include separate Spec and ExecPlan sections. The Spec
section points to the authoritative issue after publication; a parent containing
the spec says “This issue.” Retained draft files are snapshots, not a competing
authority. Public ExecPlan sections state “Private plan retained by maintainers”
without a private URL or path, or “Not required” with the reason.

Use these sections in the draft and, after publication, in the owning issue. The
YAML parent form presents the same concepts as entry fields. Agents creating or
editing issues through tools follow this content contract too; browser field
validation is not proof of readiness. A local snapshot additionally records its
issue URL and captured revision or update time.

```markdown
# Desired outcome

Status: Proposal / Agreed / Delivered / Deferred
Owner decision: Pending, or dated non-sensitive acceptance reference

## Problem and intended users

Current behavior, the problem it creates, and who benefits from the change.

## Goals, scope and non-goals

Included outcomes and deliberately excluded or deferred work.

## Required behavior

Observable behavior, including relevant failures, recovery and persistence.

## Constraints

Compatibility, security, data, accessibility, performance or cost bounds.
Use "None identified" only after considering the relevant constraints.

## Acceptance criteria

- [ ] Observable condition and the evidence needed to establish it.

## Open questions and decisions

Blocking questions, agreed choices and material scope changes with their dates.

## Spec

This document before publication; the owning issue URL after publication.
In the parent issue containing the spec, write “This issue.”

## ExecPlan

Private plan retained by maintainers; no private URL or path in the public issue.
For routine work, write “Not required” and explain why.

## Delivery links

Sub-issues and PRs as they become available. No private-plan prerequisite.
```

The form can be submitted before all sections are known. A proposal is not ready
for implementation merely because required form fields are filled.

## Example of useful acceptance

For renaming an Anima, "rename works" is insufficient. A concrete criterion is:
"After saving a valid name, the Anima selector shows it and retains it after a
reload. An empty name is rejected without changing the saved value." A browser
journey and persistence check can establish those claims. Whether historical
messages should show the new name is a separate product decision to resolve,
not something an agent should assume.

This is an authoring illustration, not a claim about current product behavior.

## Agreement, changes and completion

The owner accepts the outcome and consequential choices, including through an
explicit task instruction. Record that decision without publishing private
transcripts. Blocking questions, inputs and validation must be resolved before
dependent implementation. Assign a bounded research task if uncertainty remains.

When creating an ExecPlan, record the accepted draft and dated decision, or the
source issue and accepted revision if already published. Include enough approved
context for independent resumption. Workspace setup adds the published issue
reference to the plan and snapshot. Material requirement changes return to the
owner; update the authoritative spec, snapshot, affected plan, phase issues and
tests together. Agents may revise implementation details within the accepted
scope without repeating product approval. Retain any explicit verification gates
already recorded in a plan unless the owner changes or waives them.

Close the parent only after its acceptance and required owner verification, or
an explicit cancellation/deferral decision. Merged sub-issues alone are insufficient.
Promote implemented behavior into current documentation and significant choices
into ADRs. Retain the spec as delivery history, not a competing current-system
manual. Full execution evidence and approval history stay in private plans.
