# Software development lifecycle

Humans direct intent, consequential requirements and acceptance. Agents investigate,
plan, implement, test, review and provide evidence within that agreement. Do not
repeat decisions already supplied by the owner. A skill does not create authority
to change scope, repository settings, publish, deploy or merge.

## Repository setup

Setup status: {{READY_SCOPE_AND_UNRESOLVED_PREREQUISITES}}

| Field                    | Configured value                                                                                                                                                           |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Repository               | {{REPOSITORY_IDENTITY}}                                                                                                                                                    |
| Default base             | {{DEFAULT_BASE}}                                                                                                                                                           |
| Spec guide               | {{SPEC_GUIDE}}                                                                                                                                                             |
| ExecPlan guide           | {{PLAN_GUIDE}}                                                                                                                                                             |
| Planning root            | {{PLANNING_ROOT_AND_ACCESS_REQUIREMENTS}}                                                                                                                                  |
| Artifact names           | New `<scope>/<scope>-spec.md` and `<scope>/<scope>-execplan.md` under the planning root; retain existing filenames.                                                        |
| Spec authority           | Agreed draft before publication; owning issue afterward, with the local file a dated snapshot. {{EXISTING_AUTHORITY_EXCEPTIONS}}                                           |
| Issue templates          | {{ISSUE_TEMPLATES}}                                                                                                                                                        |
| PR template              | {{PR_TEMPLATE}}                                                                                                                                                            |
| Checks and evidence      | {{COMMANDS_WITH_WORKING_DIRECTORIES_FULL_PRE_PUSH_SUITE_AND_ACTUAL_CI_POLICY}}                                                                                             |
| Heavy jobs               | {{MACHINE_WIDE_HEAVY_JOB_WRAPPER_OR_NONE}}                                                                                                                                 |
| Development environment  | {{ENVIRONMENT_PROCEDURE_OR_NONE_REQUIRED}}                                                                                                                                 |
| Domain guidance          | {{GLOSSARY_AND_ADR_LOCATIONS}}                                                                                                                                             |
| Privacy                  | {{PUBLIC_PRIVATE_BOUNDARIES}}                                                                                                                                              |
| Approval and phase gates | {{EXISTING_GATES_AND_MERGE_AUTHORITY}}                                                                                                                                     |
| Review policy            | One full initial review, at most two repair rounds; preserve counts across resumption. Depth follows the review tier; reviewers reuse the check record.                    |
| Names                    | Branch `<type>/<short-kebab-case-task>`; PR `<type>: summary`; commit `<type>(scope): summary`; phase commit `<type>(scope)[p#]: summary`. Preserve configured exceptions. |
| Labels                   | {{EXISTING_LABEL_MAPPING_OR_NO_REQUIRED_LABELS}}                                                                                                                           |
| Skill bundle             | `setup-ray-skills`, `intent-discovery`, `to-spec`, `to-execplan`, `workspace-setup`, `implement`, `tdd`, `code-review`, `git-workflow`, `merge-n-clean`.                   |

Maintain this contract when the configured workflow changes. Execution skills
consume it instead of discovering alternatives. Repair missing prerequisites
through `setup-ray-skills`; do not invent paths or claim unavailable checks ran.
The agent entrypoint routes skills here. Load the configured guide for the requested
step and preserve this contract across skill handoffs.

Parent issues and PRs include **Spec** and **ExecPlan** sections. Link the current
spec authority; when the parent itself owns the spec, say “This issue”. Link an
ExecPlan only when readers can access it and publication is permitted. Otherwise
state that it is retained privately, or is not required for this work. A snapshot
link identifies its captured revision and never competes with the owning issue.

## Choose the appropriate path

Tiny incidental corrections may omit an issue and ExecPlan. Routine bounded work
uses an issue with acceptance and a brief approach. Substantial, uncertain or risky
work needs an agreed spec and ExecPlan. Judge impact, coordination and recovery,
not file count or duration. Escalate routine work if its approach no longer fits.

## Delivery

Use `intent-discovery` when intent needs clarification. `to-spec` prepares the agreed
outcome; `to-execplan` describes its delivery when needed. Review these artifacts
before invoking `implement`. An explicit instruction may already provide agreement.
Unresolved consequential questions block dependent implementation.

`implement` starts with `workspace-setup`, which publishes the agreed spec, prepares
any phase issues and chooses a safe workspace. The parent issue and the plan's
phase sections track phases; add a phase issue only when a phase is assigned
separately, spans repositories or needs its own dependency tracking. Owner-only
checks are PR/plan gates, not issues. Use one branch/PR per plan per affected
repository by default. Reuse existing records;
do not create retrospective work merely to fit this convention.

Implement meaningful behavioral slices using `tdd`. Preserve architecture and
unrelated work. Update changed contracts and any current guidance
made incomplete or misleading by the change. No documentation edit is needed
when existing guidance remains useful and accurate. Inside a phase, run the checks
its changes affect and keep a check record; a high-risk phase also runs the full
pre-push suite. Then run independent `code-review` at the phase's tier. Commit
evidence with the phase it describes.
Advance automatically after required evidence and gates pass within the authorized
phase range. Preserve every explicit gate in existing plans.

Run the full pre-push suite once on the candidate, then review the final
integration against overall acceptance, reusing that run and valid phase evidence.
`git-workflow` pushes and opens/updates the PR. Open
regular PRs by default; automatically convert drafts when ready for review,
unless explicitly instructed otherwise. Present
the exact candidate, actual CI, review outcome and limitations for merge approval.
Default to an ordinary merge commit; recheck the approved candidate and use head
matching where supported. Read back the resulting merge and post-merge checks.
Use `merge-n-clean` for an explicitly approved merge, primary-checkout update and
task-scoped cleanup.

## Review and quality

Prefer clear ownership, appropriate reuse and the simplest solution meeting the
requirements. Avoid speculative abstractions, hidden failures and tests that copy
implementation details. Reviewers identify concrete violations with evidence;
zero findings is valid and subjective suggestions do not block.

Record `Code Review #1 Findings`, then the implementing agent's verified dispositions
and fixes in `Code Review #1 Revisions`. Allow at most two repair rounds after the
initial comprehensive review. Follow-ups target fixes and their regression risks,
not a new general audit. Persist numbering and dispositions across resumptions.
Remaining blockers at the limit stop progression; they are not waived.

Each phase has a review tier. **Light** (documentation, test-only, mechanical and
small covered changes): one analysis subagent; the phase may skip its own review
when the final integration review covers it; the coordinator verifies trivial
repairs. **Standard** (other behavior changes): one analysis subagent, and checks
only where the record has gaps. **High risk** (security, ownership, persistence,
contracts, dependencies, build, CI, release, concurrency, recovery): analysis plus
an independent rerun of affected checks, its own review, the full pre-push suite
first and a recheck of every repair. A reviewer moves a change up a tier when it
finds a high-risk trigger.

The implementing agent records each check's command, working directory, result and
Git tree. Reviewers rerun only checks the record lacks or whose covered files
changed after that tree, and skip formatting checks that an edit hook enforces.
The final integration review runs no checks unless source changed after the last
full pre-push run.

## Evidence and boundaries

Separate local checks, hosted CI, rendered behavior, provider/native tests and human
acceptance. Report exact source, commands, results and unperformed checks. Never
impersonate owner review or assume written policy is remotely enforced. Public
issues/PRs stand alone without private transcripts, credentials or private-plan links.
Merge, deployment, release and publication are separate outcomes.
