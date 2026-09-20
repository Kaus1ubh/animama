# 0007: Repository-owned specifications and execution plans

- Status: accepted
- Recorded: 2026-09-20
- Retrospective: no
- Original decision date: 2026-09-20, through the owner's request to keep ExecPlans in their owning repository.
- Decision basis: Explicit owner decision; supersedes only the private planning location/privacy requirement in [ADR 0006](0006-human-ai-software-development-lifecycle.md).

## Context

Requiring private planning in another repository makes an Animama-only change
coordinate two branches and worktrees just to maintain its plan. The product
repositories still have distinct source and runtime ownership. Changing where
new plans live does not require combining those repositories.

## Decision

Track new specs and ExecPlans with the implementation they describe. Animama uses
its own `PLANS.md` and `docs/plans/<scope>/`; Cloud owns its own new plans. Animama
planning records are public-ready, excluding secrets, personal data, raw approval
transcripts, sensitive investigations and private-checkout dependencies.

Retain the existing spec authority: the agreed draft before publication, then the
owning issue, with a tracked snapshot. Multi-repository work uses linked plans for
each repository's implementation scope and explicit shared requirements without
competing specifications. Issues and PRs remain understandable independently.

Historical and active existing plans stay in place unless the owner approves a
deliberate migration that preserves evidence and gates. This decision does not
publish historical private records, change repository visibility, alter the
artifact boundary or waive any review, merge, release or pilot acceptance gate.

## Rationale and consequences

A task can maintain code, plan and evidence in the same isolated worktree. Planning
no longer creates a Cloud dependency for local contributors. Public-ready writing
requires concise decision and validation summaries instead of copying private
conversations or raw evidence. Existing classification and secret/publication
checks still apply; a planning path alone no longer determines Cloud ownership.

The remaining lifecycle in ADR 0006 stays in force, including proportionate plan
requirements, bounded review and exact-candidate owner approval for merging.

## Evidence

- [SDLC repository setup](../../SDLC.md#repository-setup): configured ownership,
  artifact paths, privacy and authority.
- [ExecPlan guide](../../PLANS.md) and [spec guide](../../SPECS.md): authoring,
  resumption, snapshots and cross-repository planning.
- [Repository boundaries](../architecture/repository-boundaries.md): independent
  product ownership and separate publication approval.
- [Task issue](https://github.com/raymond-van/animama/issues/19): agreed change
  scope and acceptance criteria.
