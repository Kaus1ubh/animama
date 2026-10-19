# 0027: Risk-tiered review and a single suite run per candidate

- Status: proposed; amends the per-phase review rule of [ADR 0006](0006-human-ai-software-development-lifecycle.md)
- Recorded: 2026-10-19
- Retrospective: no
- Original decision date: unknown; awaiting the owner's decision
- Decision basis: new proposal

## Context

[ADR 0006](0006-human-ai-software-development-lifecycle.md) gives each phase and
the final integration scope one comprehensive independent review and up to two
repair rounds, with repair reviews checking every fix. In practice:

- each review used a checks subagent and an analysis subagent;
- the backend and frontend suites ran in the phase, in the reviewer's checks, in
  every repair recheck, in a per-phase pre-push step and again before the PR;
- `make check-test` alone takes about nine minutes locally;
- an N-phase plan could start up to 6(N+1) reviewer runs.

Several agent sessions now share one machine, so duplicated heavy work also
slows other tasks.

## Decision

Review depth follows a risk tier recorded for each phase:

- **High risk:** auth, ownership, privacy or security; persistence, schema or
  data deletion; the API, shared contracts or generated clients; dependencies,
  build, CI, packaging or release; concurrency or recovery. It keeps ADR 0006's
  depth and adds an independent rerun of the affected checks. Any change matching
  a high-risk description is high risk.
- **Standard:** other behavior changes get one analysis reviewer per scope.
- **Light:** documentation, test-only and mechanical edits. A light phase may be
  reviewed inside the final integration review instead of separately.

Below high risk, the implementing agent verifies trivial repairs and records how,
instead of starting a reviewer recheck.

Reviewers reuse the implementing agent's check record (command, directory, result
and Git tree). They rerun only checks it lacks or whose files changed later. They
leave formatting to the edit hook and the full pre-push suite.

Phases run the checks their changes affect. The full pre-push suite runs once, on
the final candidate after the final integration review and its repairs. Phase
issues and record-only commits become optional.

The rest of ADR 0006 stays in force: bounded repair rounds, verified dispositions,
explicit gates, exact-candidate merge approval and separate release authority.

## Rationale and consequences

Present-day justification:

- Most duplicated cost came from re-executing unchanged checks and from fixed
  review depth on low-risk work.
- Reusing recorded results and tiering review removes most of that cost and keeps
  the strongest review where failure is most expensive.

What the change gives up:

- Below high risk, reviewers trust reported check results.
- Light phases lose their individual review.
- A regression in an untouched area surfaces at the final suite run, not in its
  phase.
- A mis-tiered change gets lighter review until a reviewer escalates it. The
  recorded tier and the high-risk precedence rule limit this.

## Evidence

- [SDLC.md bounded code review](../../SDLC.md#bounded-code-review),
  [review tiers](../../SDLC.md#review-tiers) and
  [check records](../../SDLC.md#check-records): the operating rules.
- [Review skill](../../.agents/skills/code-review/SKILL.md) and
  [implementation skill](../../.agents/skills/implement/SKILL.md): how agents
  apply them.
- [Local checks before pushing](../backend/operations/development.md#local-validation-before-pushing):
  where the full pre-push suite runs.
