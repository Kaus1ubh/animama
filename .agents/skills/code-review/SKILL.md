---
name: code-review
description: Independently review a defined working-tree or committed change for agreed behavior, engineering quality and validation. Delegates checks and analysis, supports targeted rechecks and final integration review, and bounds repair loops.
---

# Review the defined change

Use the configured review policy. Establish the accepted requirements, requested phase or
whole-plan scope, relevant base and current source state. Include intended staged,
unstaged and untracked changes; do not silently replace a working-tree request with
a HEAD-only diff. Separate unrelated edits. Freeze the boundary while reviewing;
changes afterward require affected evidence to be refreshed.

## Delegate independent work

Use available subagents for two bounded responsibilities: applicable read-only
checks, and independent analysis against requirements and engineering standards.
They may run concurrently when safe; add another specialist only for a concrete
risk. Give them the source boundary, spec, relevant plan/standards and existing
evidence without instructing them to find a minimum number of problems.

Checks use configured commands and working directories: relevant lint/type/format
checks, tests or builds. Do not run autofix formatters or duplicate valid unchanged
checks. Analysis covers observable behavior, failure/recovery paths, ownership,
security where relevant, architecture, useful reuse and unnecessary complexity.
Reviewers remain read-only, return evidence and never implement their own findings.
If delegation is unavailable, report that limitation; a self-review cannot be
represented as independent review or silently satisfy a required independent gate.

## Record findings and return control

Each finding has a stable ID, location, violated requirement/standard, concrete
impact and supporting evidence. Distinguish required fixes from optional ideas.
Simplicity and DRY are criteria for solving demonstrated problems, not a license
for speculative redesign. No actionable findings is a valid result.

Write `Code Review #1 Findings` in the phase's configured record, or return the
section for its coordinator to record. In an explicitly read-only request, return
it without editing. The main implementing agent adjudicates each finding and writes
`Code Review #1 Revisions`: accepted/rejected/deferred, reasons, fix and evidence.
Rejected findings must have a reason; reviewer agreement is not a substitute for
verification. Material unresolved disagreement is reported as a blocker.

## Bound the review

One comprehensive initial review is followed by at most two repair rounds. After
each repair, perform a targeted recheck of accepted findings and regressions caused
by revisions; number Findings/Revisions consistently. Thus the default permits
review #1, repair #1, review #2, repair #2, and final targeted review #3. Persist
counts and dispositions across resumptions. Do not launch another broad audit to
search for optional improvements or reopen resolved findings without new evidence.

Pass only when required checks succeed, concrete blockers are resolved and all
applicable gates are satisfied. Optional suggestions do not block. If blockers
remain at the budget limit, return them and stop automatic progression; the limit
does not waive requirements. Tool failures and unrun checks remain explicit.

Final integration mode checks cross-phase behavior and overall acceptance using
valid phase evidence. It does not restart every completed phase review. Return
pass, blocked or incomplete with the reviewed source, evidence, dispositions,
remaining repair budget and next action. The coordinator owns fixes and progression.
