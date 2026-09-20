---
name: workspace-setup
description: Prepare or resume the issues, task branch, checkout and development environment for authorized implementation using an already configured lifecycle. Use at the start of implement or when explicitly preparing a task workspace.
---

# Prepare the task workspace

Confirm the outcome, spec/plan revision, requested phases and any blocking decision
or explicit gate against the established repository setup.

Start with the checkout supplied to the task. Inspect its absolute Git root,
HEAD and branch (or detached HEAD), recorded base, worktree registration, dirty
changes and concurrent work. Reconcile any mismatch with the task handoff before
switching directories, branches or the selected revision. Search existing
issues/PRs and prior task handoffs before creating anything.
Read back uncertain creation results before retrying. Preserve completed phases;
do not manufacture retrospective issues simply to populate the new convention.

Use `git-workflow` for tracker and branch operations. Publish the agreed draft spec
to the owning issue, identify the authority/revision in the retained snapshot, and
create or reuse one issue per authorized phase. Include bounded scope, requirements,
acceptance, dependencies and relevant handoff. Use native relationships where
available or reciprocal links otherwise. Routine work may use a single issue;
apply the configured incidental-change exception without inventing an ExecPlan.

Follow the repository's workspace policy, including any requirement to keep the
primary checkout on its default branch and use worktrees for task branches. Apply
only explicitly authorized exceptions; an issue exception does not imply a
workspace exception. Default to one branch per plan per affected repository.
Reuse an existing suitable task worktree across phases, review and resumption.
Creating a task branch does not require another worktree. Preserve an existing
task branch; for a detached task worktree, use `git-workflow` to create the branch
at its verified current HEAD when implementation is authorized, preserving task
commits and intended changes. Create another worktree only for an identified
repository policy requirement, isolation need or explicit request. Do not switch an occupied checkout, copy
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
