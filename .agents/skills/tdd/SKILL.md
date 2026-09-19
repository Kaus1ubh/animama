---
name: tdd
description: Implement or repair behavior through small red-green-refactor cycles using observable contracts and the configured test tools. Use within implementation or for an explicitly requested test-driven change.
---

# Test the behavior, then implement it

Read the accepted requirements and configured test guidance. Identify a stable public or
domain boundary and meaningful failure/recovery cases from the behavior. Reuse
appropriate existing tests and fixtures. Do not require the human to reconfirm
ordinary test boundaries already implied by the agreed design.

For each small useful slice:

1. Write a behavior test with an independently reasoned expected result. For a bug,
   reproduce the reported failure rather than merely asserting the proposed patch.
2. Run it and observe the intended failure. An import, environment or fixture error
   is not proof of the missing behavior; fix that prerequisite first.
3. Implement the smallest change that satisfies the requirement and run the test.
4. With relevant tests green, simplify structure where that improves the code,
   then rerun affected checks. Continue with the next useful behavior.

Prefer vertical slices over writing an entire speculative suite before observing
any behavior. Test through interfaces that survive reasonable internal refactoring;
avoid mirroring implementation branches or asserting incidental call ordering.
Use fakes/mocks at real external boundaries where justified, not for every internal
method. Cover consequential errors and recovery, not a quota of edge cases.

Documentation, mechanical edits and behavior-preserving refactors may justify no
new failing test. Record the reason and use meaningful existing regression or
artifact checks. Do not manufacture tests merely to claim TDD. If a manual/provider
check is required, distinguish it from automated evidence and respect its gate.

Return the behavior tested, observed red/green results, relevant commands and any
exceptions or remaining validation to the invoking implementation workflow.
