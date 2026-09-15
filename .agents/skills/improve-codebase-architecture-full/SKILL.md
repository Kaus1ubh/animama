---
name: improve-codebase-architecture-full
description: Review the entire current codebase for architectural deepening opportunities using a complete inventory, bounded parallel reviews, durable checkpoints, and a visual report. Use for comprehensive architecture reviews across all subsystems, including stable code outside recent commit history.
---

# Improve Codebase Architecture — Full Review

Find architectural friction and **deepening opportunities** that improve testability,
locality, and leverage across the whole current codebase. Breadth comes from an
explicit coverage ledger; depth comes from tracing real behavior across interfaces.
Commit history may explain a finding, but never determines which paths get reviewed.

This is the comprehensive companion to `improve-codebase-architecture`. Its default
deliverable is an evidence-backed report, not application changes. Follow an existing
user request for implementation or ticket creation when provided; otherwise present
the report and let the user choose a follow-up.

## 1. Establish scope and durable state

Read repository and scoped agent guides, `docs/agents/domain.md` when present, and
the domain glossary and relevant ADRs they identify. Missing domain docs do not
block the review. Use [the design vocabulary](references/design.md) when judging
opportunities; companion skills are optional, not prerequisites.

Read both subsystem documentation entrypoints: `docs/frontend/README.md` and
`docs/backend/README.md`. Follow their links to the architecture, runtime,
feature, and operational docs relevant to each review unit and cross-subsystem
flow. Use these docs to establish intended responsibilities and contracts, then
verify them against the current source and record discrepancies. Carry the relevant
doc pointers into review-unit briefs so workers can load them as needed.

Review the current checkout: tracked files, tracked deletions, and nonignored
untracked files. Record HEAD and dirty state; distinguish observations about
uncommitted work from the committed architecture. Include all owned application
code, tests, build/configuration, migrations, entrypoints, and operational tooling.
Inventory generated, vendored, binary, and asset files too, then characterize their
architectural role without mechanically reading every byte as source.

Start with `rg --files --hidden`, package manifests, source roots, and entrypoints.
Use the helper below for the definitive Git inventory. Git-ignored local data,
dependencies, credentials, and build output are outside its default scope; disclose
this scope and inspect a specific ignored source root only when repository evidence
or the user says it is owned code. Account for submodules separately. In a non-Git
tree, build an equivalent manifest with `rg --files --hidden` and report that the
helper's Git drift check is unavailable.

Create a unique review directory outside the repository, normally in the OS temp
directory. Use a user-specified persistent artifact directory when provided.
Record its absolute path immediately so a later session can resume from it.
Set `SKILL_DIR` to this skill's absolute directory and `REVIEW_DIR` to that review
directory, then run:

```sh
python3 "$SKILL_DIR/scripts/architecture_inventory.py" snapshot \
  --repo "$PWD" --output "$REVIEW_DIR/inventory.json"
```

Read [the context and coverage protocol](references/context-protocol.md) now.
Initialize its checkpoint and ledger before deep exploration. For an interrupted
review, follow its resume procedure instead of starting over.

## 2. Map the repository and schedule bounded reviews

Partition the inventory into review units by coherent responsibility and ownership,
not arbitrary directory depth. A review unit is a scheduling chunk, not a proposed
module. Every path must belong to one unit or have an explicit supporting/excluded
disposition. Include stable, legacy-but-owned, and low-churn areas.

Map entrypoints, dependency directions, state owners, and user/system flows. Use
imports, registrations, manifests, routing, configuration, and tests as leads;
verify runtime relationships in source rather than treating static imports as a
complete dependency graph.

Delegate independent units to fresh subagents when available. Give each only the
task brief, assigned paths, applicable guide pointers, and relevant domain excerpts.
Workers persist evidence to separate unit files and return a short summary. The
coordinator owns global ledgers and checkpoints. Use the protocol's worker contract
and context budgets; split units that exceed them instead of silently sampling.
Without subagents, run the same batches sequentially and checkpoint between them.

A user-named pain point gets early attention, not exclusive scope. If the user
limits time or scope, honor that limit and identify the resulting review as partial.

## 3. Inspect units and the relationships between them

Use [the review lenses](references/design.md#review-lenses) to investigate actual
friction: caller knowledge, scattered invariants, duplicated policy, unclear
ownership, hidden ordering requirements, and testing through implementation details.
Read source and relevant tests before proposing a change. File size, indirection,
mock count, churn, or lack of tests alone are leads, not findings.

For each unit, save its responsibilities, interfaces, dependencies, verification
surface, inspected files/symbols, candidate evidence, counterevidence, and unresolved
questions. It is valid to report no worthwhile deepening opportunity.

After unit reviews, inspect cross-unit flows separately. Include each major entrypoint
and the important seams it reaches: transport, persistence, background work, state
synchronization, lifecycle, and external dependencies where present. Assign an owner
to each cross-unit question and trace both sides. Reconcile conflicting worker
claims against source. A collection of subsystem summaries is not a complete
architecture review.

## 4. Synthesize and verify coverage

Merge duplicate candidates by root cause. Validate leading candidates in the source
again, including callers, tests, and ADR counterevidence. Rank by demonstrated
friction, expected leverage/locality, confidence, migration cost, and behavioral
risk. History is optional corroboration here; a stable module can still be the
highest-value opportunity.

For a Git snapshot, run the mechanical gate:

```sh
python3 "$SKILL_DIR/scripts/architecture_inventory.py" check \
  --inventory "$REVIEW_DIR/inventory.json" --coverage "$REVIEW_DIR/coverage.jsonl"
```

For a manual/non-Git manifest, reconcile it and its ledger against the current
filesystem and disclose that automated Git drift validation is unavailable.

The helper checks accounting and snapshot drift, not the quality of the analysis. Apply
the protocol's substantive completion gate too. Resolve pending owned source and
cross-unit questions or label the report partial with precise gaps. Never infer
completion from a candidate quota, worker count, or a green helper alone.

If the checkout changed, preserve the old snapshot and reconcile affected units
and their callers before claiming current coverage. Carry forward unchanged work
using the resume protocol. Do not silently refresh the snapshot underneath findings.

## 5. Deliver the visual report and handoff

Read [the report contract](references/report.md) when synthesizing results.
Write `report.md` and an offline `report.html` in the review directory. Include
coverage and limitations, a system overview, all substantiated candidates,
conceptual before/after diagrams, confidence, tradeoffs, and the best next step.
Keep detailed per-file evidence in linked unit notes rather than loading it all into
the main report or conversation.

Verify the report renders, its links resolve, and candidate evidence still matches
the reviewed snapshot. Open it with the available artifact/browser preview and give
the user its absolute path plus the checkpoint path. State which checks were run.

Absent an already-authorized next action, ask which candidate they want to explore.
Follow-up may use `grilling`, `codebase-design`, or `domain-modeling` if available;
otherwise work from the saved evidence. Read `docs/agents/issue-tracker.md` before
creating requested tickets. Domain edits, ADRs, tickets, and refactors belong to
the requested follow-up, not an automatic side effect of this review.
