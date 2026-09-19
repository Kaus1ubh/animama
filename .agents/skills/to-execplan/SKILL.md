---
name: to-execplan
description: Convert an agreed spec or sufficiently resolved discussion into a phased execution plan with concrete implementation, validation, recovery and review evidence. Use for substantial, uncertain or risky work or an explicitly requested plan.
---

# Write the execution plan

Read the configured plan guide. Locate the accepted spec revision or dated task decision,
existing plan and relevant implementation. Confirm the configured planning root,
including required private context, before writing. Do not create a public fallback
plan when the repository requires private planning.

Use `<scope>-execplan.md` for new plans and retain an existing plan's location.
Include enough accepted context to resume independently without reproducing the
spec as a competing contract. Define outcome, orientation, boundaries, phases,
dependencies, concrete implementation steps, meaningful checks, recovery and
acceptance evidence. Split phases by useful verifiable outcomes, not file counts.

Each phase names its authorized scope, relevant requirements, dependencies, likely
interfaces, validation and completion conditions. Record any required human,
hardware, provider, release or product-decision gate explicitly. New phases may
advance after required evidence and bounded review pass; preserve every explicit
gate in an existing plan unless the owner specifically changes it.

Keep Progress, Surprises & Discoveries, Decision Log and Outcomes & Retrospective
live. Provide a place per phase for issue/commit/evidence references and numbered
Code Review Findings/Revisions. Plan one full initial review and at most two repair
rounds, plus a final integration review. Specify phase ranges or necessary PR splits
when agreed; otherwise one branch/PR per plan per affected repository is the default.

Inspect discoverable details rather than asking the owner to supply them. Resolve
consequential uncertainty before dependent execution; agents may later revise
implementation details within the accepted outcome. Routine work can use its issue
and brief approach instead of being inflated into an ExecPlan.

Finish with a reviewable plan and its unresolved decisions, if any.
