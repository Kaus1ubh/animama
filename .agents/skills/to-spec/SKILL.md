---
name: to-spec
description: Turn an existing discussion, discovery brief or change request into a reviewable specification using the repository's established spec guide and artifact conventions.
---

# Write the specification

Read the configured spec guide. Inspect the existing owning spec/issue before creating a
new artifact. Use current discussion, discovery results and approved decisions;
do not restart intent discovery when those inputs already resolve it.

Explain the problem and intended users, scope/non-goals, observable behavior,
relevant errors and recovery, persistence/compatibility constraints, and acceptance
evidence. Use user stories or requirement IDs when they clarify the work; avoid
restating every requirement in multiple formats. Include technical choices only
when they are agreed requirements or constraints. Leave changeable steps to the plan.

Ground language in configured domain guidance and flag conflicts with established
decisions. Resolve blocking product questions with the owner; label proposals and
unknowns instead of presenting them as accepted behavior. A direct task instruction
can already establish agreement and must not cause a redundant approval request.

Create or revise `<scope>-spec.md` at the configured planning destination. Use the
existing filename when resuming. Record status, decision reference and authoritative
source. Before publication the agreed file is the default authority; `workspace-setup`
publishes it and records its issue/revision, after which the file is a snapshot.
If a published spec needs changes, prepare a clearly identified proposed revision;
update the authority and dependent artifacts together only once agreed.

Return the artifact and material open decisions for review. `to-execplan` consumes
the accepted outcome.
