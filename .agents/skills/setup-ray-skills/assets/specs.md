# Writing specifications

A spec owns the agreed problem, intended users, behavior, constraints and acceptance.
The ExecPlan owns delivery steps and evidence. Use the configured lifecycle and
artifact locations in the repository setup contract.

Before publication, draft `<scope>-spec.md` in the planning root. After
`workspace-setup` publishes the agreed content, the owning issue is authoritative
by default; label the retained file with its issue and snapshot revision/date.
Respect an existing different authority convention recorded during setup. Maintain
one authoritative spec per outcome and keep public content independently usable.

Write observable outcomes, including relevant failures, cancellation, persistence,
recovery and compatibility. Include technical choices only when required or agreed.
Use stories and requirement IDs where useful without duplicating every requirement
in several formats. Acceptance must state the evidence needed, not just a test name.
Use configured terminology and decision guidance; surface conflicts and unknowns.

## Authoring template

    # <Outcome>

    Status: Proposal / Agreed / Delivered / Deferred
    Owner decision: <dated decision or pending>
    Authority: <draft, or owning issue and snapshot revision/date>

    ## Problem and intended users
    <Current problem and who benefits.>

    ## Goals, scope and non-goals
    <Included outcomes and explicitly excluded work.>

    ## Required behavior
    <Observable behavior, relevant errors/recovery/persistence, useful stories.>

    ## Constraints
    <Security, compatibility, accessibility, data, performance or cost bounds.>

    ## Acceptance criteria
    - [ ] <Observable condition and evidence needed.>

    ## Open questions and decisions
    <Unresolved questions and dated consequential choices.>

    ## Delivery links
    <Issues and PRs; no private prerequisite for public readers.>

## Agreement and changes

An explicit task instruction can accept an outcome. Do not repeat supplied
decisions; resolve consequential unknowns before dependent work. A completed form
is not proof of agreement. Agents can refine implementation within agreed scope;
material requirement changes need an owner decision and coordinated updates to
the authoritative spec, plan, tasks and validation.

For example, renaming an item should specify where the new name appears, whether
it survives reload and what happens for invalid input. Historical references are
a separate product question, not an implementation assumption.

Accept work against its criteria and explicit gates, not merely merged PRs. Update
current guidance when it becomes incomplete or misleading; retain the spec as
delivery history.
