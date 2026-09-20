---
name: git-workflow
description: Create and maintain GitHub issues, task branches, phase commits and PRs with concrete Git and gh commands. Use for delivery, approved merges and task cleanup under the established repository workflow.
---

# Deliver through Git and GitHub

Use the repository identity, base, templates and checks established by setup.
Run commands from the selected checkout. Execute the requested operation, reusing
existing issues, branches and PRs. The `task_*` variables below stand for inspected
values from the task record; populate them before running a command.

## Names and templates

| Artifact     | Default format                   | Example                                |
| ------------ | -------------------------------- | -------------------------------------- |
| Branch       | `<type>/<short-kebab-case-task>` | `feat/add-search`                      |
| Commit       | `<type>(scope): summary`         | `feat(search): add title matching`     |
| Phase commit | `<type>(scope)[p#]: summary`     | `feat(search)[p1]: add title matching` |
| PR title     | `<type>: summary`                | `feat: add search`                     |

Use `feat`, `fix`, `refactor`, `chore`, `docs`, `test`, `build`, `ci` or `perf`
according to the change. Scope belongs in commits only; omit it when no meaningful
scope exists. Preserve explicit repository exceptions and existing published branches.
Default to one branch/PR per plan per repository.

Use the **configured repository copies** of these templates; the links show the
bundled starters when inspecting their content contract:

- Parent issue: `.github/ISSUE_TEMPLATE/parent.yml` — [starter](../setup-ray-skills/assets/parent.yml).
- Phase/routine issue: `.github/ISSUE_TEMPLATE/task.yml` — [starter](../setup-ray-skills/assets/task.yml).
- PR: `.github/pull_request_template.md` — [starter](../setup-ray-skills/assets/pull-request.md).

Prepare a Markdown body file from the appropriate template's fields; a YAML issue
form is not an issue body. Parent issues and PRs have distinct **Spec** and
**ExecPlan** sections. Link the authoritative spec, or say “This issue” when the
parent owns it. Identify a linked file snapshot with its captured revision. Link
an ExecPlan only when access and privacy permit; otherwise state “Retained privately”
or “Not required” and keep the public record independently understandable.

## Inspect and create issues

```bash
git status --short --branch
git worktree list
gh repo view "$task_repo" --json nameWithOwner,defaultBranchRef
gh issue list --repo "$task_repo" --state all --search "$task_search" \
  --json number,title,state,url
gh pr list --repo "$task_repo" --state all --head "$task_branch" \
  --json number,title,state,url
```

Inspect matching records before creating one. Populate `task_issue_body` with the
agreed requirements, acceptance, dependencies and artifact sections, then use
[`gh issue create`](https://cli.github.com/manual/gh_issue_create):

```bash
gh issue create --repo "$task_repo" --title "$task_issue_title" \
  --body-file "$task_issue_body"
gh issue view "$task_issue" --repo "$task_repo" --json number,url,body,updatedAt
```

Set `task_issue` from the returned issue. After publishing the agreed spec, record
its issue URL and captured revision/time in the local snapshot. For phase issues,
use `--parent "$task_parent"` and `--blocked-by "$task_dependencies"` when applicable
and supported by the installed `gh issue create --help`; otherwise put reciprocal
issue/dependency links in the bodies. Reuse the configured incidental-change
exception. Apply only existing, relevant labels. If creation returns an uncertain
result, search/read it back before retrying.

## Prepare the branch and commit

Adopt the task's supplied checkout first. Verify its path, source revision, dirty
state and recorded branch/base before choosing a preparation path. Use the existing
task branch on resume; a new phase or review does not require another worktree.

For a supplied detached task worktree, create the task branch at its verified
current HEAD, preserving existing task commits and intended changes:

```bash
git switch -c "$task_branch"
```

Do not replace that starting revision with a newly fetched base. If the checkout,
revision or branch conflicts with the task record, reconcile the mismatch first;
do not reset, force an existing branch or create a duplicate workspace.

For genuinely new work without a supplied task workspace, resolve the intended
base explicitly and follow the repository's workspace policy. The following
in-place recipe applies only where that policy permits task branches in the
checkout; a clean primary checkout alone is not permission to switch it:

```bash
git fetch "$task_remote" "$task_base"
git switch -c "$task_branch" FETCH_HEAD
```

If repository policy requires a worktree, or one is needed for isolation or
explicitly requested, use this **instead of** switching the checkout. Run subsequent
commands inside `task_worktree`:

```bash
git fetch "$task_remote" "$task_base"
git worktree add -b "$task_branch" "$task_worktree" FETCH_HEAD
```

Follow the configured environment procedure. Inspect staged, unstaged and untracked
changes before selecting `task_paths`; use selected hunks for mixed files. Keep
unrelated work out of the commit and inspect the final staged diff:

```bash
git diff --stat
git diff --cached --stat
git ls-files --others --exclude-standard
git add -- "${task_paths[@]}"
git diff --cached --check
git diff --cached
git commit -m "$task_commit_subject"
git rev-parse HEAD
```

Commit after applicable validation and review pass. Record phase commits in the
plan. Preserve published history; ordinary revisions use new commits.

## Open or update the PR

Complete configured local checks before pushing. Write `task_pr_body` using the
configured PR template, including one compact validated-revision/baseline reference
with unique short SHAs linked to full commits, artifact links, review outcomes,
actual local evidence and remaining gates. Refer back to that revision reference
in review and merge sections instead of repeating hashes. Use `Refs #N` for partial work and
`Closes #N` only when the issue's acceptance is fully delivered.

```bash
git push -u "$task_remote" "$task_branch"
gh pr create --repo "$task_repo" --base "$task_base" --head "$task_branch" \
  --title "$task_pr_title" --body-file "$task_pr_body"
```

Follow the configured readiness policy. Default to a regular PR for completed
work; add `--draft` only for unfinished work or an explicit instruction/gate.
When an existing draft's condition is resolved, mark it ready as part of delivery
without waiting for merge approval or checks that readiness triggers:

```bash
gh pr ready "$task_pr" --repo "$task_repo"
```

Read back `isDraft` before finishing. If a draft remains necessary, report its
specific blocker and next action. Pending CI or merge approval alone does not
require draft status. Ready status does not waive failed checks or human gates.

For an existing PR, use `gh pr edit "$task_pr" --repo "$task_repo" --body-file
"$task_pr_body"` instead of creating another. Read its actual candidate and checks:

```bash
gh pr view "$task_pr" --repo "$task_repo" \
  --json url,headRefOid,baseRefOid,isDraft,reviewDecision,statusCheckRollup
gh pr checks "$task_pr" --repo "$task_repo" --json name,state,bucket,link
```

Pending, skipped and failed checks are not passes. Report actual CI separately
from local validation and human acceptance. Attach the PR when the host supports
it. See [`gh pr create`](https://cli.github.com/manual/gh_pr_create) for flags.

## Approved merge and cleanup

Use the PR's revision reference when presenting checks, review and remaining gates
for owner approval. Recheck the candidate, ready status and required check results
immediately before merging.

With approval for `task_approved_head` and required checks satisfied, perform an
ordinary merge with a server-side head match:

```bash
task_pr_number="$(gh pr view "$task_pr" --repo "$task_repo" --json number --jq .number)"
gh api --method PUT "repos/$task_repo/pulls/$task_pr_number/merge" \
  -f merge_method=merge -f sha="$task_approved_head"
gh pr view "$task_pr" --repo "$task_repo" --json state,mergedAt,mergeCommit
```

The [merge endpoint](https://docs.github.com/en/rest/pulls/pulls#merge-a-pull-request)
rejects a changed head. Check the response's `merged` value and read back the result
before reporting success. A queue requirement or rejected merge returns to the
configured procedure; do not enable auto-merge or bypass protections. Squash/rebase
requires an approved exception. Report main-branch checks separately from PR checks.

After acceptance, inspect task-owned worktrees, ignored files and services before
cleanup. From a different checkout, `git worktree remove "$task_worktree"` removes
a clean task worktree; `git branch -d "$task_branch"` removes a merged local branch.
Retain useful data and hand off anything still needed. Deployment and release follow
their own configured procedures.
