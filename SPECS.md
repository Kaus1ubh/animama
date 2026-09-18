# Writing specifications

A spec records the agreed problem, desired behavior, constraints and acceptance.
An ExecPlan records how to deliver and verify it. Follow [SDLC.md](SDLC.md) for
when each is needed and who can authorize work.

## Where a spec lives

Use the owning GitHub issue body, or the parent issue for substantial work. Start
with the [parent form](.github/ISSUE_TEMPLATE/parent.yml); it can begin as a proposal
with open questions. For routine work, the [task form](.github/ISSUE_TEMPLATE/task.yml)
or [bug form](.github/ISSUE_TEMPLATE/local-bug.yml) may contain enough acceptance
without a separate specification. Before tracker activation, draft the same content
in the authorized task record; do not create a parallel local issue tracker.

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

User stories and Given/When/Then examples are optional. Do not restate every
requirement in several formats. Use stable IDs such as `R1` only when they help
link sub-issues and acceptance evidence.

## Template

Use these sections in the parent issue. The YAML form presents the same concepts
as entry fields. Agents creating or editing issues through tools follow this
content contract too; browser field validation is not proof of readiness.

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

When creating an ExecPlan, record the source issue and the accepted revision or
dated decision, and include enough approved context for independent resumption.
Material requirement changes return to the owner; update the issue, affected
plan, sub-issues and tests together. Agents may revise implementation details
within the accepted scope without repeating product approval.

Close the parent only after its acceptance and required owner verification, or
an explicit cancellation/deferral decision. Merged sub-issues alone are insufficient.
Promote implemented behavior into current documentation and significant choices
into ADRs. Retain the spec as delivery history, not a competing current-system
manual. Full execution evidence and approval history stay in private plans.
