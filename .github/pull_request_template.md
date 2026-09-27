## Summary

<!-- Describe the problem and resulting behavior. -->

## Related work

<!-- Link the parent/phase issues and relevant acceptance criteria; identify delivered
and deferred phases. Use one PR per plan in this repository. For an issue-free incidental
correction, state why the exception applies. Close the parent and every phase issue
this PR implements, even with owner checks pending (list them under limitations);
a partial child PR must not close its parent. No private-plan prerequisite. -->

## Spec

<!-- Link the authoritative owning issue. A retained draft is a snapshot after
publication. For an incidental correction with no spec, explain the exception. -->

## ExecPlan

<!-- Link the tracked ExecPlan at its reviewed revision, or state "Not required"
with the reason for routine or incidental work. For an existing private plan,
state "Private plan retained by maintainers" without a private URL or path.
Keep the scope, approach and evidence understandable within this PR. -->

## Local validation

<!-- Record one compact reference: Validated revision: <short SHA> · baseline: <short SHA>.
Use unique abbreviations linked to full commits; note uncommitted changes if applicable.
Record commands, results and environment.
For local-first reduction, link the generated receipt and digest. Only the owner
can review it; an agent-prepared receipt is not owner approval. -->

## CI validation

<!-- Link the run and state its actual Validation profile and result. Distinguish
checks executed in CI from owner-reviewed local assertions replacing hosted work.
A deferred draft is not passing validation. -->

## UI evidence

<!-- When relevant, link rendered evidence and serving mode; distinguish synthetic
fixtures from real avatar/audio acceptance. Otherwise write "Not applicable". -->

## Risks and limitations

<!-- Disclose unresolved failures, compatibility risks and unperformed checks.
Write "None identified" only if true. -->

## Review and merge handoff

<!-- Record independent phase/final review scope and source, supported findings,
revisions or rejection reasons, repair rounds used (maximum two per scope), and
remaining blockers or explicit gates. Reuse existing evidence without restarting
the review count. Keep private plan paths and transcripts out of this PR.
Before requesting merge: refer to the revision reference above, record current checks
and owner approval status. Default: ordinary
merge commit. Approval is pending until explicitly given for the candidate;
AI review or a passing check is not owner approval. Refresh after material edits. -->

## Checklist

- [ ] Relevant tests and documentation updated, or marked not applicable.
- [ ] Applicable local checks completed; commands, results and source state recorded above.
- [ ] Independent review completed within its bound; findings and revisions recorded above.
- [ ] Unresolved failures and unperformed checks disclosed above.
