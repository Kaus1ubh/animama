---
name: implement
description: Execute an authorized discussion, spec or ExecPlan using workspace setup, behavior-focused TDD, bounded independent review, phase commits and automatic PR handoff. Supports an explicitly limited phase range.
---

# Implement the agreed outcome

Resolve the identified discussion/spec/plan and requested scope. An explicit request
to implement a sufficiently resolved outcome supplies implementation authority;
do not ask for the same approval again. Stop dependent work for unresolved product
decisions, missing setup prerequisites or an explicit existing gate.

Invoke `workspace-setup` first, including on resume so existing state is verified.
Use the configured brief approach for routine work; if scope becomes substantial,
uncertain or risky, create an ExecPlan through `to-execplan` and stop for the
owner's review of it before implementing.

## Execute each authorized phase

Record its starting revision and intended change boundary. Inspect relevant scoped
instructions, architecture, contracts and existing patterns. Use `tdd` for changed
behavior and record warranted exceptions. Prefer the simplest implementation that
meets requirements. Reuse suitable abstractions without adding speculative layers.
Update changed contracts and documentation made incomplete or misleading by the
change. Follow the repository's reader-value standard; no doc edit is a valid outcome.

Before review, run the checks the phase's changes affect: its new and touched
tests, and lint and type checks for the touched packages. A high-risk phase also
runs the configured full pre-push checks. Keep a check record (command, working
directory, result and Git tree) for the reviewer. Fix implementation failures,
rerunning affected checks rather than unchanged expensive suites. Run heavy jobs
through the configured heavy-job wrapper when the setup names one. Delegate bounded
independent work where useful, then integrate and inspect its actual result.
Preserve unrelated edits.

Invoke `code-review` at the phase's configured review tier with the check record;
a light phase may instead be covered by the final integration review. Record its
Findings; verify each finding before making fixes. Add matching Revisions with
disposition, reasons, changes and verification. Follow the review's targeted
recheck mode and persistent budget: one full initial review, at most two repair
rounds. Do not reset the budget on resumption or relabel a failed review as
passing. Escalate remaining concrete blockers at the limit.

Commit verified phase changes through `git-workflow` using
`<type>(scope)[p#]: summary` (or `<type>[p#]: summary` when no scope fits), with the phase's records in the same commit. If an existing
gate controls committing, honor it. Mark the phase complete only when its required
checks, review and explicit gates are satisfied. Distinguish agent readiness from
pending human acceptance. Advance automatically within the authorized phase range
when no gate remains; do not start unrequested phases.

## Finish the requested scope

For a full plan, run `code-review` in final integration mode: assess cross-phase
behavior and all accepted requirements, reusing valid phase evidence. For a phase
subset, review the completed scope and its integration without claiming the rest
of the plan is delivered. Apply the same bounded repair policy. Then run the
configured full pre-push checks once on the final candidate; a fix for a failure
reruns them, and a non-trivial fix gets a targeted review recheck.

Use `git-workflow` to finish scoped commits, push and create/update the PR automatically. Automatically convert drafts when ready for
review, unless explicitly instructed otherwise. Follow the actual CI policy and report
the exact candidate, results, review dispositions, outstanding gates and limitations.
Close the parent and delivered phase issues through the PR; record outstanding
owner checks as PR gates, not open issues. Merge requires separate
exact-candidate approval. Keep retained workspace/services documented for handoff.
