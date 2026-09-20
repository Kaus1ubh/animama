---
name: merge-n-clean
description: Merge an explicitly approved PR, fast-forward the primary checkout, and clean up its task worktree and owned Compose stack including task-only volumes, while preserving shared resources and unrelated work. Use when the user requests post-review merge and cleanup.
---

# Merge and clean up

An explicit invocation for an identified PR authorizes its merge and task-scoped
cleanup, including deletion of verified task-only volumes and disposable test data.
Use the repository setup and `git-workflow` merge requirements. Resolve
an omitted PR from the task context; ask only if the target or approval is unclear.
Do not treat automatic skill selection as merge approval.

## 1. Verify and merge

Inspect the PR, current head, review/check results and actual CI scope. Bind the
request to that head; if a previously reviewed revision is recorded, it must match.
A changed candidate or failing required check blocks merging; pending checks may
be awaited. Do not waive checks, enable auto-merge or bypass protection.

Identify the primary checkout and task worktree from `git worktree list`, shared
Git metadata and the task record. Verify repository/remote identity, the primary
branch (`main` here), task branch, dirty state and concurrent use. Never assume
the current directory is the primary checkout. Record the selected resources
before acting; the variables below stand for these verified values.

Use an ordinary merge with a server-side head match:

```bash
gh pr merge "$task_pr" --repo "$task_repo" --merge --match-head-commit "$task_approved_head"
gh pr view "$task_pr" --repo "$task_repo" --json state,mergeCommit,headRefOid
```

Confirm `MERGED` and retain the merge commit. For an already-merged PR, verify its
identity and resume below; a closed, unmerged PR is not a successful merge.
Reconcile an uncertain response by reading the PR, not blindly repeating the merge.

## 2. Update the primary checkout

Verify it is on the configured base branch, clean and not being modified by
another task. Pull without rewriting local history:

```bash
git -C "$primary_checkout" pull --ff-only "$task_remote" "$task_base"
git -C "$primary_checkout" merge-base --is-ancestor "$merge_commit" HEAD
```

If the checkout is dirty, diverged or on another branch, leave it unchanged and
report the blocker. Do not stash, reset, rebase or force it. Continue cleanup only
after the merged result is present in the primary checkout.

## 3. Stop the task stack, if one exists

Follow the configured cleanup guide and `animama-local-stacks` when applicable.
Verify ownership using the task's trusted stack record and actual Compose project
labels/mounts; never guess a project from a directory name. Inspect volume consumers
and declarations: all volumes selected for deletion must belong solely to this
task. Preserve shared, external and main-stack volumes. With the verified record
sourced from its worktree and no shared resources selected:

```bash
docker compose -p "$COMPOSE_PROJECT_NAME" --profile "*" down --volumes --remove-orphans
```

Use the recorded Compose files and credential-source selection without printing
secrets. If any declared volume is shared or ownership is unclear, omit `--volumes`
and report retained volumes; never delete them by guesswork. Leave shared/main
stacks running. Preserve images and caches; do not use `--rmi` or global pruning.
If teardown cannot be verified, retain the worktree and report what remains.

## 4. Remove the task worktree

Inspect tracked, untracked and ignored files, active processes and other task use.
Worktree removal also deletes bind-mounted data inside it. Dispose of verified
task-only test data; preserve unrelated data, credentials and useful artifacts
outside the worktree with their locations recorded, or retain the worktree if
safe ownership or retention is unclear.
Do not copy credentials into reports. Remove only verified disposable task outputs.

Verify the task branch tip is included in updated main. From the primary checkout,
not from the directory being removed, run:

```bash
git -C "$primary_checkout" merge-base --is-ancestor "$task_branch" HEAD
git -C "$primary_checkout" worktree remove "$task_worktree"
git -C "$primary_checkout" branch -d "$task_branch"
```

Never remove the primary checkout or a worktree used by another task. Do not force
removal or branch deletion, delete remote branches, or prune unrelated resources.
If the worktree or branch is already gone, verify that fact and skip that step.

Report the PR merge, primary update, stack/volume deletion and worktree/branch cleanup
separately, with any retained data or blockers. Report post-merge CI separately;
a successful merge is not proof that the main-branch checks passed.
