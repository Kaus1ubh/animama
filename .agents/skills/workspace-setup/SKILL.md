---
name: workspace-setup
description: Prepare or resume the issues, task branch, checkout and development environment for authorized implementation using an already configured lifecycle. Use at the start of implement or when explicitly preparing a task workspace.
---

# Prepare the task workspace

Confirm the outcome, spec/plan revision, requested phases and any blocking decision
or explicit gate against the established repository setup.

Inspect the actual repository, base, branch, worktrees, dirty changes and concurrent
work. Search existing issues/PRs and prior task handoffs before creating anything.
Read back uncertain creation results before retrying. Preserve completed phases;
do not manufacture retrospective issues simply to populate the new convention.

Use `git-workflow` for tracker and branch operations. Publish the agreed draft spec
to the owning issue, identify the authority/revision in the retained snapshot, and
create or reuse one issue per authorized phase. Include bounded scope, requirements,
acceptance, dependencies and relevant handoff. Use native relationships where
available or reciprocal links otherwise. Routine work may use a single issue;
apply the configured incidental-change exception without inventing an ExecPlan.

Default to one branch per plan per affected repository. Reuse the task checkout
when it is safe and nondisruptive. Isolate conflicting or disruptive work with an
ordinary worktree from an explicit base. Do not switch an occupied checkout, copy
unrelated changes, or push unrelated local commits as part of preparation.

Follow the configured environment procedure and any applicable available local
skill. A worktree does not imply that a service stack must start. Install declared
dependencies or start isolated services only when the work requires them. Preserve
other tasks' services and data. Handle credentials through the configured secure
mechanism without copying secret files or exposing their contents.

Record repository/checkout, branch and base, spec authority, issues and dependencies,
requested phase range, environment URLs if started, checks to run and remaining
gates in the existing task record. Return this handoff to the caller.
On resumption, verify and reuse this state
instead of creating duplicate issues, branches or environments.
