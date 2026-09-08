# Context and coverage protocol

Use disk as the review's working memory. Conversation history is a transport for
decisions and small summaries, not the only record of what was inspected.

## Artifact layout and ownership

Create these files as needed inside the review directory:

| Artifact | Purpose and writer |
| --- | --- |
| `inventory.json` | Immutable baseline from the helper; coordinator |
| `checkpoint.md` | Current phase, decisions, queue, gaps, next actions; coordinator |
| `units.json` | Review units, assigned paths, status, note paths; coordinator |
| `coverage.jsonl` | One disposition per inventory path; coordinator |
| `system-map.md` | Entrypoints, responsibility map, important dependency edges; coordinator |
| `flows.md` | Cross-unit obligations, evidence, status, unresolved edges; coordinator |
| `units/<id>.md` | One worker's evidence and conclusions |
| `candidates/<id>.md` | Consolidated candidate and source-backed evaluation |
| `report.md`, `report.html` | Human-facing results; coordinator |

Workers write only their assigned unit/candidate notes and return proposed coverage
updates. One writer merges shared state after each completed batch. Save a worker's
partial note before yielding if its assignment cannot fit; a missing result is
pending, never implicitly complete.

Keep `checkpoint.md` short enough to reread on every resume: aim for 100–150 lines.
Include the repository root, artifact directory, inventory filename and HEAD,
dirty-work scope, active phase, unit IDs/status counts, key decisions, unresolved
flow IDs, and the next concrete commands or source locations. Link to detail.
Update it after each batch, a scope change, and before a context handoff.

## Context budgets and worker contract

Use these starting budgets, adjusting downward for constrained environments:

- Keep the coordinator's active context to the checkpoint, system map, ledger
  summary, current flow, and a few candidate briefs. Query the inventory/ledger
  with scripts; do not print thousands of paths into the conversation.
- Aim for 20–50 ordinary source files in a worker batch, fewer for complex or
  very large files. Split by behavior when a single module exceeds that budget.
- Limit worker returns to roughly 500 words, with artifact paths, key source
  locations, findings, uncertainty, and next actions. Keep raw searches in notes
  only when they substantiate a claim; do not save whole source dumps.
- Keep at most a small available wave of workers active. Merge results and release
  finished context before dispatching another wave. Do not create a worker per file.

Give each worker a brief in this form:

> Review unit U03 at REPO_ROOT against inventory SNAPSHOT. Assigned paths: PATHS
> (or a manifest subset path). Read GUIDES and DOMAIN_POINTERS. Inspect responsibility,
> interface/caller obligations, dependencies, state/lifecycle, and tests. Persist
> evidence and counterevidence to REVIEW_DIR/units/U03.md. Use the unit-note fields
> below. Return a concise summary and proposed per-file dispositions; do not edit
> application code or shared ledgers. Flag related paths outside your assignment
> for cross-unit follow-up. Stop and split the assignment if context is tight.

The worker must read this protocol's disposition rules and the skill's design
reference, supplied by path. It need not inherit the coordinator's conversation.
If a worker delegates further, divide its paths explicitly and merge child evidence
before returning; keep the same ownership and context limits.

## Coverage records

`coverage.jsonl` is UTF-8 JSON Lines, one object per inventory path:

```json
{"path":"src/orders/intake.py","unit":"U03","disposition":"reviewed","note":"units/U03.md: intake, save, and rollback; callers traced in F02"}
```

Each record requires nonempty `path`, `unit`, `disposition`, and `note`.
Use these dispositions consistently:

- **pending**: not yet inspected or an unresolved architecture-relevant gap.
- **reviewed**: source/config/tests/docs were inspected sufficiently to explain
  their responsibility, interface, dependencies, and relation to the unit.
  Identify inspected symbols/sections in the unit note. This does not claim every
  line was read or every bug found.
- **supporting**: generated files, binary assets, lockfiles, or similar material
  were characterized through their producer/consumer and architectural role.
  Name that owner and the supporting evidence. A directory listing alone does
  not justify treating owned source/configuration as supporting.
- **excluded**: deliberately outside review scope, with a concrete reason
  (for example, vendored dependency implementation). An inaccessible owned source
  file stays pending rather than being excluded to obtain a green check.

Initialize paths as pending. Only mark a source file reviewed after inspection;
a unit summary based on a few representative files cannot mark unseen source
reviewed. For a large file, inspect its structure and all architecture-relevant
sections in successive batches, recording what was inspected and any remaining
gap. Exclusions remain visible in the report denominator.

The helper inventories nonignored untracked and all tracked paths, including
tracked ignored files and deletions. It records symlinks without following them.
For a tracked deletion, document the deletion and inspect remaining references.
For a submodule, either review a separate snapshot of that repository and link its
result, or disclose its implementation as outside scope. Owned submodule code not
reviewed prevents an unqualified whole-system claim.

For in-repo artifacts, explicitly exclude their relative directory using the
helper's `--exclude-prefix` option. This exception is for review output, not a way
to remove inconvenient source. The snapshot records excluded paths; the report
must include their scope/counts. An outside-repo review directory is simpler.

## Unit notes and cross-unit obligations

A unit note contains:

1. Scope: paths assigned, inspected symbols/sections, snapshot, guides/ADRs read.
2. Responsibility and interface: callers, inputs, outputs, errors, state ownership.
3. Dependencies and verification: concrete call/registration points and tests;
   distinguish tests inspected from tests actually executed.
4. Findings: source-backed friction and conceptual deepening, or no justified change.
5. Counterevidence: why the existing shape may be intentional; ADR references.
6. Proposed per-file dispositions, remaining gaps, and outgoing flow questions.

Use `path:line` plus a symbol name and short evidence explanation so a changed
line number can be relocated. Separate observed facts, inferences, and proposals.

Maintain `flows.md` with flow ID, entrypoint, units traversed, edge evidence, owner,
status (`pending`, `reviewed`, `blocked`), and gaps. Seed it from every major
entrypoint, then add obligations as workers discover dependencies. Trace success
and relevant failure paths, transaction/rollback behavior, async cancellation,
startup/shutdown, and ownership/auth decisions where they exist. Resolve cycles
and registration/configuration-driven edges rather than relying only on imports.

## Completion gate

The review is complete at its stated scope only when:

- Every inventory path has exactly one valid disposition, with reasons for all
  supporting/excluded paths and no pending owned source.
- Every planned unit and cross-unit obligation is reviewed, or an explicit scope
  limitation is carried into a **partial** report.
- Leading findings were checked against source, callers/tests, and ADRs; worker
  disagreements have a resolution or remain visible uncertainty.
- The snapshot remains current or all drift has been reconciled, and report links
  resolve to evidence.

A green helper validates file accounting and currency only. It cannot verify that
files were read, flow coverage is adequate, or conclusions are correct. Report
inventoried, reviewed, supporting, excluded, and pending counts separately. Include
a unit/flow coverage summary and the default Git-ignore limitation; avoid a single
percentage that disguises shallow or missing coverage.

## Helper operation

The helper requires Python 3.10+ and Git, with no third-party Python dependencies.
It streams regular-file hashes and writes paths, metadata, and fingerprints rather
than source contents. Its own checks can be run with:

```sh
python3 -m unittest discover -s "$SKILL_DIR/scripts" -p 'test_*.py'
```

The `check` command exits **0** for complete file accounting against an unchanged
snapshot, **1** for missing/pending coverage or checkout drift, and **2** for invalid
input or an execution error. Read the diagnostic before deciding whether to resume
inspection, reconcile drift, or fix the input. Neither exit 0 nor hashing a file
counts as inspecting its architecture.

If the helper cannot finish because owned files are inaccessible, preserve its
diagnostic, build a manual path ledger, and continue reviewing readable units.
Keep inaccessible paths pending and the report partial. Record the missing
fingerprint/drift proof rather than manufacturing values or excluding those paths
to make validation pass. A corrected environment can later supply a new snapshot.

## Resume and drift

Read `checkpoint.md`, not the whole prior transcript. Run the helper's `check`
against the saved snapshot and current ledger. Inspect incomplete/stale diagnostics.

If unchanged, load only the current unit/flow notes and continue the queue. If
changed, preserve the original inventory and ledger, take a newly named snapshot,
and compare per-path fingerprints. Reset changed/added paths and affected callers,
tests, and flows to pending. Record removed paths and whether remaining claims
still hold. A changed HEAD with identical content needs provenance reconciliation,
not a complete re-review.

Carry unchanged evidence forward with its source snapshot recorded; revalidate
affected findings and references. Update the checkpoint to the new inventory only
after recording this reconciliation. The helper detects many kinds of drift; it
does not perform dependency impact analysis or refresh evidence automatically.

If the user sets a time limit, stop with a partial report and the exact next unit/
flow. Context pressure alone calls for checkpointing and continuation, not silently
reducing scope or declaring the review complete.
