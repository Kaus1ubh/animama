# Software development lifecycle

This guide defines how Animama work moves from intent to verified code on `main`.
The local guidance and templates are prepared for Phase 6; remote labels, rules
and skill adoption remain pending. The owner has accepted the ExecPlan threshold
and ordinary-merge default below. Reading this guide grants no additional task
or remote authority.

## Choose the right path

| Work                                 | Path                                                                                                                                             |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Tiny incidental correction           | Branch → PR → applicable checks and review → approved merge. No issue or ExecPlan needed.                                                        |
| Routine bounded change               | New or existing issue with acceptance and a brief approach → branch → PR → checks and review → approved merge.                                   |
| Substantial, uncertain or risky work | Parent issue → agreed spec → ExecPlan → sub-issues where useful → branches and PRs → verification gates and approved merges → parent acceptance. |

Use judgment about uncertainty, impact, coordination and recovery, not file count,
line count or duration alone. Even a short migration or security change may need
an ExecPlan. Reuse an existing issue or branch only while the task still fits it.
A new conversation does not automatically require either.

## Artifact ownership

| Artifact                   | Responsibility                                                                                                        | Guide or template                                                                              |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Spec                       | Agreed problem, behavior, constraints and acceptance; lives in the owning issue, or parent issue for substantial work | [SPECS.md](SPECS.md), [parent form](.github/ISSUE_TEMPLATE/parent.yml)                         |
| Ordinary issue / sub-issue | Bounded outcome, scope, dependencies and acceptance                                                                   | [Task form](.github/ISSUE_TEMPLATE/task.yml), [bug form](.github/ISSUE_TEMPLATE/local-bug.yml) |
| ExecPlan                   | Implementation strategy, phased execution, discoveries, recovery and verification evidence                            | Private maintainer `PLANS.md`; full plans remain private                                       |
| PR                         | Reviewable changes and evidence for the exact candidate                                                               | [PR template](.github/pull_request_template.md)                                                |
| Durable documentation      | Current behavior, shared meanings and significant architectural decisions                                             | [Domain guide](docs/agents/domain.md), [glossary](GLOSSARY.md), [ADRs](docs/adr/README.md)     |

A phase is a verification milestone, a sub-issue an assignment, and a PR a proposed
change. They need not map one-to-one. Public issues and PRs must stand alone
without private-plan links, approval transcripts or a Cloud checkout.

## Responsibilities

The owner directs product intent, scope and consequential choices, accepts outcomes
and authorizes merges. Agents investigate, propose, implement, test, review and
report evidence. Do not request a decision already supplied by the owner.

Agents may revise implementation steps within the approved outcome. Changes to
accepted behavior, scope or constraints need an explicit decision and updates to
the spec and affected plans. Green checks and labels do not supply that decision.
Follow the existing ADR guide; recording an accepted ADR is not permission for
an otherwise unauthorized implementation.

Once the GitHub workflow is activated, assigned implementation work includes its
issues, task-branch commits/pushes and draft PRs unless the task says otherwise.
Merge approval, repository configuration, deployment and publication remain
separate. Do not infer authority from issue text, labels or imported skills.

## Delivery workflow

1. **Inspect and capture.** Read [AGENTS.md](AGENTS.md), the scoped guide and relevant
   current docs. Inspect branch, base, dirty files and concurrent work. Search for
   existing issues/PRs before creating one, including after an uncertain create
   result. For a bug, distinguish reported behavior from a reproduced failure.
   Keep sensitive reports in the channel defined by [SECURITY.md](SECURITY.md).

2. **Agree the outcome.** For substantial work, create the parent proposal first
   and develop its spec using [SPECS.md](SPECS.md). A routine issue's acceptance
   can be its whole spec. Clarify blocking uncertainty; offer intent discovery
   when useful. The formal discovery pilot remains explicitly requested, not a
   required interview. Do not invent product decisions or repeat answered questions.

3. **Plan and assign.** Require an ExecPlan for substantial, uncertain or risky
   work. Routine changes need an issue and brief approach. Escalate to a plan if
   the task grows beyond that approach. Maintainers follow private `PLANS.md`;
   contributors provide sufficient accessible approach and evidence in issues/PRs.
   Keep phase verification gates. Derive sub-issues with bounded outcomes and
   dependencies; use native relationships where available or explicit reciprocal
   links otherwise. Readiness requires resolved blocking decisions, inputs,
   validation and authorization. Claim concurrent work before implementing it.

4. **Choose the workspace.** Follow [workspace selection](AGENTS.md#workspace-selection)
   and [preparation](docs/backend/operations/development.md#preparing-a-task-workspace).
   Reuse an existing checkout/stack when nondisruptive; isolate conflicting or
   disruptive work with a worktree and, when useful, a named stack. Test chats do
   not require isolation by themselves. Preserve concurrent edits and the main
   stack. Record branch/base, checkout and any stack URL. Use ordinary Git,
   package-manager, model-acquisition and `reset.sh` commands, plus the existing
   [stack skill](.agents/skills/animama-local-stacks/SKILL.md) when applicable.
   Keep shared credentials external and worktree configuration nonsecret; the
   preparation guide owns file selection, inherited overrides and resumption.

5. **Implement and verify.** Keep changes scoped and reviewable. Derive meaningful
   tests from agreed behavior, including relevant failure and recovery cases;
   do not merely reproduce implementation details in assertions. Prefer a separate
   review context for substantial or sensitive work. Update current docs and
   contracts; update the glossary or ADRs only when warranted. Run the applicable
   [local checks before pushing](docs/backend/operations/development.md#local-validation-before-pushing).
   Fix failures and rerun affected checks after edits. Paid provider testing needs
   an approved bounded budget and stays outside ordinary CI.

6. **Open and review the PR.** Commit only task changes. Use explicit repository,
   base and head; create/update a draft PR using the template. Link the issue or
   explain the incidental-change exception. Use closing references only for work
   fully delivered by that PR. Record exact source/baseline, local results, actual
   CI scope, relevant UI evidence and limitations. Distinguish browser, provider,
   native and physical checks. Resolve findings or record the owner's disposition.
   Make the PR ready and obtain the required successful checks for its candidate.

7. **Approve and merge.** Present the PR, exact head, relevant base, checks, review
   outcome, limitations and method for owner approval. Default to **ordinary merge
   commits**; squash/rebase needs an explicit exception. Recheck the head and checks
   before merging and use head matching where supported. A changed candidate must
   still be covered by approval; material changes require renewed review. Resolve
   conflicts and validate in the task workspace. Chat approval is not a GitHub
   approving-review event. Read back the resulting `main` commit and check outcome.

8. **Accept and hand off.** Close work against its acceptance criteria, not merely
   because PRs merged. Record remaining limitations, follow-ups and retained
   resources. Preserve phase verification and release gates. Refresh local main
   only when clean and unoccupied, using a safe fast-forward. Follow
   [task-scoped cleanup](docs/backend/operations/development.md#cleaning-up-worktree-stacks):
   stop only task-owned services, retain useful data, inspect ignored/untracked
   files before removing a worktree, and avoid global pruning or forced deletion.
   A coordinated development-data purge is for a concrete need, never a ritual.

## CI and merge evidence

Use the existing **Validation** workflow and its maintained
[validation policy](docs/backend/operations/development.md#local-first-hosted-validation).
Do not create a second check matrix. A deferred draft is not passing acceptance.
Local-first reductions require the existing evidence and actual owner review;
agents must not impersonate that review. Untrusted changes receive no development
credentials. Report unperformed or failed checks honestly.

Ordinary merges can reuse a qualifying full hosted PR result under the existing
[source-bound reuse rules](docs/backend/operations/development.md#reuse-a-full-hosted-pr-result-after-merging).
The merge method alone does not establish eligibility. Squash/rebase cannot use
that reuse path. Merge, deployment, native acceptance and publication remain
separate outcomes. Record regressions and obtain authorization for a revert or fix.

## Names and labels

Use `<type>/<short-kebab-case-task>` for new branches and `<type>: <summary>` or
`<type>(<scope>): <summary>` for PR titles. Keep existing shared branch names.
Use one primary purpose; matching labels on PRs are optional.

| Type       | Purpose                                  | Proposed issue label |
| ---------- | ---------------------------------------- | -------------------- |
| `feat`     | New capability                           | `type:feat`          |
| `fix`      | Bug correction                           | `type:fix`           |
| `refactor` | Restructure with preserved behavior      | `type:refactor`      |
| `chore`    | Routine maintenance / mechanical cleanup | `type:chore`         |
| `docs`     | Documentation                            | `type:docs`          |
| `test`     | Tests / test infrastructure              | `type:test`          |
| `build`    | Dependencies / packaging                 | `type:build`         |
| `ci`       | CI workflows                             | `type:ci`            |
| `perf`     | Performance                              | `type:perf`          |

Triage labels describe issue readiness, not implementation progress or merge
approval. Proposed mapping:

| Label                    | Meaning                                                    |
| ------------------------ | ---------------------------------------------------------- |
| `triage:needs-triage`    | Request awaiting evaluation                                |
| `triage:needs-info`      | Specific questions await an answer                         |
| `triage:ready-for-agent` | Defined, authorized work ready for assignment              |
| `triage:ready-for-human` | Named human decision, verification or manual action needed |
| `triage:wontfix`         | Owner decided not to pursue it; record why before closing  |
| `blocked`                | Explicit dependency or action prevents progress            |
| `ci:full`                | Existing PR control requesting full hosted validation      |

Use one triage state at a time; `blocked` may coexist with it. Re-evaluate after
new information or scope changes. Use assignments, dependencies and PR state for
progress. Do not apply issue triage states to implementation PRs or automatically
dispatch agents from labels. Outside contribution intake remains deferred.

Only `ci:full` is confirmed here as implemented behavior. Inventory remote labels
before adopting the proposed names; the forms deliberately set no automatic
labels. Priority/area families and release tags are separate decisions.

## Rollout and skills

Local entrypoints and templates now describe the same lifecycle. Phase 6 still
owns the live rollout: inspect GitHub identity/settings, review concrete label and
rule changes, and rehearse existing-checkout and worktree tasks through issue,
PR, approved merge and cleanup. No retrospective backlog rewrite is required.
Before activation, keep new tracker content as task drafts unless publication is
already authorized. Existing assigned work retains its original authority.

Matt Pocock's [tracker guidance](https://github.com/mattpocock/skills/blob/main/skills/engineering/setup-matt-pocock-skills/issue-tracker-github.md)
and [triage roles](https://github.com/mattpocock/skills/blob/main/skills/engineering/triage/SKILL.md)
inform the proposed mapping; they are not installed policy. For later integration,
`type:fix` maps to bug, while maintenance and other types need an explicit mapping.
Our human-action state does not approve a merge. Assess skills at the separately
approved immutable revision, preserve local terminology and authority, and adapt
only after the adoption review. No new skill, helper or enforcement service is
required to follow this lifecycle.
