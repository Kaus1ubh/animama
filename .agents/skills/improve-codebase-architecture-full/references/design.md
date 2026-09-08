# Design vocabulary and review lenses

This compact reference adapts the deep-module approach of the companion
`codebase-design` skill so a full review can run without a global skill installation.

## Vocabulary

- **Module**: a cohesive capability with an interface and implementation; it may
  span functions, files, packages, or deployment tiers.
- **Interface**: everything callers must know, including inputs/outputs, ordering,
  invariants, errors, configuration, ownership, and performance obligations.
- **Depth**: useful behavior hidden behind a small amount of caller knowledge;
  depth is not a ratio of implementation lines to interface lines.
- **Seam**: a place where behavior can vary through an interface.
- **Adapter**: a concrete implementation satisfying an interface at a seam.
- **Leverage**: capability gained per interface a caller or test must learn.
- **Locality**: knowledge, change, and verification concentrate in the module that
  owns them, instead of spreading through callers.

Use the repository's domain vocabulary for the capability being discussed.
Architecture vocabulary should clarify reasoning; preserve real symbol names and
established terms when referring to the implementation.

## Review lenses

Investigate these across all owned areas, including stable ones:

| Lens | Evidence to seek |
| --- | --- |
| Caller knowledge | Repeated call ordering, configuration, validation, or error handling needed to use a capability correctly |
| Ownership/locality | One invariant or transaction coordinated across unrelated callers; competing owners of the same state |
| Depth | Several modules expose nearly the same complexity as the behavior they wrap |
| Coupling | Changes propagate through shared mutable state, cross-module internals, dependency cycles, or duplicated policy |
| Lifecycle | Startup/shutdown, cancellation, rollback, retries, or cleanup depend on hidden coordination |
| Verification | Meaningful outcomes require mocking through many internals; contract behavior is untested or awkward to exercise |
| Navigability | Understanding one domain operation requires unrelated file hops or ambiguous ownership |
| Cross-tier contracts | Transport, UI state, persistence, workers, and external calls disagree about ownership or failure semantics |

Inspect concrete callers and tests before promoting a lead to a finding. These
lenses guide exploration; they are not a quota or a checklist of mandatory defects.

## Evaluate a deepening proposal

Apply the deletion test: if a module disappeared, would complexity disappear with
it, or spread across its callers? Disappearing complexity suggests indirection
without sufficient payoff; spreading complexity suggests the module earns its keep.

Ask what behavior the proposed module would own, which caller obligations it would
absorb, what observable contract tests would exercise, and what migration would be
needed. Propose the conceptual shape first; detailed interface design follows
selection of a candidate.

A thin module may be justified by ownership, transport, security isolation, resource
lifecycle, generated contracts, or independent deployment. Multiple adapters support
a seam's usefulness, but adapter count alone does not justify adding or deleting it.
Consolidation that erases a trust or lifecycle distinction can reduce correctness
even when it reduces file count.

Classify dependencies to make the verification proposal concrete:

- **In-process**: verify observable computation/state through the owning interface.
- **Local I/O**: use suitable real local dependencies or faithful stand-ins; identify
  the behaviors a stand-in cannot exercise.
- **Remote but owned**: consider a transport adapter and contract/integration tests
  for serialization, errors, and compatibility.
- **External service**: isolate provider behavior with an adapter; distinguish test
  doubles from evidence about the real provider contract.

Keep useful behavioral tests. A proposal may replace tests coupled to internals
only when equivalent or better behavioral coverage has a concrete home.
Architecture review itself does not delete tests or alter runtime behavior.

## Recommendation strength

Use **Strong** for observed friction, a plausible improvement, and checked callers,
tests, and constraints. Use **Worth exploring** when friction is real but the design
or migration tradeoff remains unresolved. Use **Speculative** for an explicit
hypothesis with missing evidence, outside the main recommendation list.

Rank without invented numerical precision. Explain the likely gain in leverage/
locality, affected user or developer behavior, effort, risks, and why existing
architecture may still be preferable. No justified refactor is a valid conclusion.
