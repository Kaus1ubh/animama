# Hand off the reader site and revert PR #283

Maintain this living plan under [PLANS.md](../../../PLANS.md) and
[SDLC.md](../../../SDLC.md). Preserve its progress, discoveries, decisions,
review counts and evidence at each handoff.

Source agreement: the owner's accepted 2026-10-06 clarification moves the complete
reader site, including content, generator, tests, lockfile and deployment
guidance, to its maintained website repository before any Workers migration.
Animama retains a link to the published documentation in its root README. The
owner subsequently asked why PR #283 could not be removed entirely; this revised
proposal uses a full merge revert after verified source handoff. This supersedes the
previous proposal for Animama to implement and publish its own docs Worker.
[Issue #285](https://github.com/raymond-van/animama/issues/285), published and read
back on 2026-10-06 at `updatedAt=2026-10-06T16:59:50Z`, now owns acceptance.
This plan does not create a competing spec.

The owner invoked `$implement` for both reviewed plans on 2026-10-06, accepting
the full-revert boundary and authorizing implementation/tracker/PR work within
its dependencies. The source-custody gate is still pending; no source removal
may begin before accepted destination merge/CI evidence. Provider actions and
exact-candidate merges retain their separate approval requirements.

## Purpose and context

Animama will continue building and running independently, while readers reach
its maintained guides at `https://docs.animama.ai/`. Remove the duplicate reader
site build/test/publication ownership only after its complete maintained source
has been accepted elsewhere. Keep contributor documentation and its validation,
application documentation inputs and recovery material. PR #283's original
specification and delivery plan remain accessible at their original Git revision
and PR, rather than in the current tree. The existing live Pages site stays
unchanged through source handoff.

This repository's assignment is one full PR #283 revert and one public PR,
including a new root README link to the published docs.
The destination maintainer owns the full-site copy and its later hosting work.
Their accepted, independently built copy must be merged first; the separately
approved Animama cleanup merge must follow before Workers implementation begins.
The dependency is an operator readiness receipt, never a private checkout,
source import, sibling build input or inaccessible URL.

Starting application/source baseline:
`10216cd36251b8e011557250f3c4951e8bd39a69`, PR #283's merge. Local planning commit
`c4245b1284ffc92f3d0156e22863e1a6ad546952` records the former hosting-only proposal;
it is not implementation or provider acceptance. Reuse assigned task branch
`chore/workers-static-assets`, verify checkout/HEAD/dirty state on resumption,
and keep the primary checkout on `main`. No Compose stack is required.

## Progress

- [ ] (2026-10-06) Phase 1: authorized full merge revert and root docs link;
  setup complete, waiting for accepted destination merge/CI/source-custody receipt.

Planning review for the earlier selective-removal proposal passed after one
targeted repair round. The full-revert amendment passed its independent
affected-boundary recheck; owner plan review is complete through the explicit
implementation request. Implementation phase and
integration reviews have not started. Source removal, cleanup merge, post-merge
acceptance and any later hosting work are unperformed.

## Surprises & Discoveries

- PR #283's first-parent diff touches 23 paths: 16 site package files, two
  historical delivery records and five CI/operations/ignore files. A full revert
  removes all 23 changes from the current tree, including the original plan/spec
  and `.animama-docs-first-run.env` ignore. It preserves Git/PR history and does
  not mutate the manually published Pages deployments or retained archives.
  The earlier selective-removal rationale confused current-tree retention with
  preservation of history; neither a link stub nor that old ignore is required.
- Read-only GitHub inventory on 2026-10-06 confirms `main` still at `10216cd3`;
  there are no later main commits to the site or CI paths. Its first parent is
  `b9a1e588ac820e0b50e1622c914668a69650275a`. Refresh before implementation.
- `docs/user` builds independently with Node 24.15.0, pnpm 10.33.0 and VitePress
  1.6.4. Its package includes selected Markdown, theme, build/check/test/preview
  scripts, its own lockfile, output guards and readiness flags. No Worker config
  has been implemented; publication instructions currently live in its README.
- The reviewed output contains 33 files and 999,246 bytes. Home/Download readiness
  is true; installer and public-source declarations remain "Coming soon".
  Ownership transfer does not change those declarations or reader coverage.
- Contributor-doc `docs-tests` runs synthetic-document and accountless repository
  checks. It predates the reader site and must remain after site-specific CI
  work is removed. Documentation bundled into the application remains an
  application input, including the safety protocol.
- Previous delivery had `ERR_BLOCKED_BY_CLIENT` for a Download-to-Docs browser
  transition and incomplete network/storage and RUM event-delivery evidence.
  Source handoff does not clear those later hosting-acceptance limits.

## Decision Log

| Date | Actor/status | Decision and reason |
| --- | --- | --- |
| 2026-10-06 | Owner, accepted | Move the complete reader site before the hosting migration; Animama links the published site. |
| 2026-10-06 | Agent proposal | Merge and accept the maintained copy first, then one separately approved Animama cleanup PR; provider state stays unchanged. |
| 2026-10-06 | Agent proposal, superseded | Selective source/CI removal with a link stub and retained original plans/ignore. |
| 2026-10-06 | Revised proposal following owner question | After verified destination merge, revert all of PR #283, including its original plan/spec and ignore addition; add only a new root README published-docs link. Git/PR history and separately retained Pages evidence provide historical recovery. |
| 2026-10-06 | Owner, accepted execution | Invoke `$implement` both reviewed plans; full-revert scope and tracker/PR work accepted, with source-custody and separate merge/provider gates preserved. |

The implementation request accepts the full-revert boundary, including removal
of the original tracked spec/plan and task-record ignore. That deliberate removal
replaces the earlier retention proposal; it is not an unapproved plan migration.
The owning
maintainer must supply the source-handoff receipt before removal; future hosting
choices and provider approvals belong to the site's later work. New scope that
would remove contributor/application docs, weaken validation or change live
behavior returns to the owner before dependent work.

## Source handoff gate

Before implementing cleanup, obtain a self-contained operator receipt confirming:

1. The complete site source, generator/configuration, seven output-guard tests,
   independent package/lock and manual deployment guidance have durable maintained
   ownership. The destination copy is merged into its authoritative main branch.
2. Fresh independent frozen installation, tests, build, output audit and formatting
   pass without sibling source, application artifacts or provider credentials.
   Record toolchain and commands/results; no installed dependency tree is copied.
3. All 33 original publication files are byte-identical to the reviewed archive.
   Record relative file inventory, lengths and SHA-256 plus aggregate/archive
   hashes. Path-only maintainer guidance changes are separately reviewed and do
   not change reader output. No hosting controls are added during this handoff.
4. The exact source-copy candidate's actual required CI and actual post-merge
   checks passed, with their executed scopes and reviewed source identified.
   A draft, local-only test or old publication CI is not source-handoff acceptance.
5. `https://docs.animama.ai/`, its four reader routes, required assets and true
   unknown-route 404 remain live on the retained accepted Pages deployment.
   No upload, domain/DNS/RUM change or retirement was part of the source copy.
6. The owner accepts this receipt and authorizes Animama cleanup. The receipt
   includes public-safe results/identities without requiring private links,
   checkout paths, accounts, credentials or raw evidence. It is an attestation
   of maintained ownership, not an Animama build dependency.

If byte equality, independent builds, destination merge or required CI is missing,
keep Animama's source intact. Resolve the specific failure before cleanup rather
than changing the gate or treating a live site alone as maintained source custody.

## Phased implementation

### Phase 1: Revert the original site PR after verified source handoff

Authorized scope after review: the full inverse of PR #283 and a new root README
published-docs link. Requirements:
completed source handoff, independent application builds, unchanged live docs,
retained contributor validation, revision-addressable history and a separately
approved exact merge.
Dependencies: the gate above, owner phase authorization and authorized setup.
Starting source is the baseline above plus this reviewed planning record.

At setup, search existing public issues/PRs and reuse suitable records. Publish
and read back the self-contained cleanup acceptance in its owning issue; create
one bounded implementation assignment if required by SDLC. Use one public cleanup
branch/PR. Do not link inaccessible source-copy records or create an issue for
provider/manual gates. Record the operator receipt and source revisions here.

Setup on 2026-10-06 created/read back public parent #285 and its bounded
[assignment #286](https://github.com/raymond-van/animama/issues/286). Reuse the
assigned task worktree/branch at `608e670e`; primary main remains clean at the
original source merge. Source files, CI and publication remain intact. No local
stack is required. The destination custodian is currently implementing its
source copy; no accepted merged-copy receipt exists yet.

1. Reinspect PR #283's full first-parent diff, current paths and later changes.
   Inventory ignored local output/cache and `.animama-docs-first-run.env` without
   printing its contents. Preserve any useful task records/output outside the
   checkout before removing their ignore rules; never stage them or purge data.
   Stop only task-owned previews. A revert changes tracked files, not deployed
   Pages state, retained archives or ignored local files.
2. On this verified task branch only, prepare the full inverse without committing:

       git revert --no-commit --mainline 1 10216cd36251b8e011557250f3c4951e8bd39a69

   This removes all 16 tracked `docs/user` files, both original
   `docs/plans/user-docs-site` records and the added root ignore entry, and
   reverses the five CI/operations/ignore modifications. No `docs/user` link stub
   remains. The separate current migration plan remains tracked. Inspect all
   staged changes; never substitute a hard reset or history rewrite. If later
   changes conflict, reconcile only this PR's inverse and preserve unrelated
   work. Surface any consequential departure from a full revert before proceeding.
3. Add a User guides link to `https://docs.animama.ai/` in root `README.md`.
   This is a new change accompanying the revert, not retained site source.
   Check current documentation for incoming links to the removed site/records;
   use the canonical site for reader links and frozen public Git references for
   delivery history. No other incoming links were found during planning.
4. Verify the revert restored `.github/workflows/validate-public.yml`,
   `scripts/ci/validation_policy.py`, `scripts/ci/test_validation_policy.py` and
   the affected operations table to their pre-PR contracts, preserving any
   subsequently authorized edits. `docs-install`, `docs-test`, `docs-build`,
   `docs-check` and their `DOCS` set must be gone; contributor `docs-tests`,
   `COMMON`, full/frontend requirements and fail-closed profiles must remain.
   Node/pnpm setup returns to `full`/`web`. Added/deleted/renamed/unknown inputs
   still select full validation. For unchanged original paths, compare the
   result byte-for-byte to first parent `b9a1e588ac820e0b50e1622c914668a69650275a`;
   all 18 originally added paths must be absent. Do not recreate the old plan,
   site stub or ignore entry as part of this phase.
5. Run the commands below, independently review the exact cleanup boundary and
   prepare one public PR with the source-handoff receipt and local evidence.
   Obtain actual full `Validation` for the current candidate; preserve separate
   evidence for any unperformed checks. A plan approval does not approve merge.
6. Present the exact final head, actual CI scope/results, bounded phase/final
   review and limitations for separate owner approval. Use the ordinary merge
   procedure under SDLC. Read back the merge commit and actual post-merge
   `Validation` result/profile; a reused profile is not independent re-execution.
   Do not mark handoff complete or release the subsequent hosting prerequisite
   until the owner accepts the required post-merge evidence.

Completion: no tracked `docs/user` or `docs/plans/user-docs-site` files remain;
the root README links the published docs and all PR #283 changes are reversed. No
retired site steps/requirements remain active, contributor/full validation is
preserved, public records are self-contained, and exact-source checks/reviews,
owner merge and post-merge acceptance pass. Published docs and retained Pages
resources remain unchanged. Issue/commit/evidence: pending authorized setup;
proposed phase commit `chore(docs)[p1]: revert retired reader site ownership`.
Record the original merge SHA and mainline parent in the commit body.

#### Code Review #1 Findings

Not run; phase repair rounds used 0 of 2. Review exact source/baseline and
tracked/untracked boundary, exact full inverse, preserved contributor/full CI,
root link and revision-addressable history
contracts and the operator receipt. Record stable IDs, evidence and impact.
One full initial review and at most two repairs; supported blockers stop work.

#### Code Review #1 Revisions

Not run. Record accepted/rejected/deferred dispositions, minimal fixes, files,
affected checks and remaining repair budget. Preserve counts on resumption;
reviews #2/#3 target accepted fixes and their regressions.

## Validation and acceptance

From the assigned repository root, after implementation authorization:

```bash
uv run --no-sync python -m unittest discover -s scripts/ci -p 'test_*.py' -v
uv run --no-sync ruff check scripts/ci/validation_policy.py scripts/ci/test_validation_policy.py
uv run --no-sync ruff format --check scripts/ci/validation_policy.py scripts/ci/test_validation_policy.py
uv run --no-sync pytest -q tests/test_generate_synthetic_docs.py tests/test_accountless_repository_boundaries.py
bash scripts/audit-typed-content.sh
uv run --no-sync python scripts/repository-boundary/check-python-imports.py
git diff --check
```

Expected: commands exit 0; policy tests retain conservative full selection and
fail-closed required guards. Search active workflow/policy/current guidance for
`docs/user` and retired check IDs; only this migration's delivery record may
describe the retired build. Verify all 23 inverse changes against PR #283,
including the restored pre-PR CI tests and deleted historical source files.
Resolve current links and verify
no private imports, source paths or provider credentials entered local builds.
Use read-only formatting checks, not rewriting formatters. Run any additionally
applicable checks required by the current scoped guides before candidate push;
the existing hosted `Validation` workflow remains authoritative.

| Surface | Required acceptance |
| --- | --- |
| Source custody | Operator receipt confirms accepted merged copy, independent build and unchanged 33-file output plus actual candidate/post-merge CI. |
| Local source | All 23 PR #283 changes are reversed; no tracked `docs/user` or original `docs/plans/user-docs-site` files remain. The root README supplies the published-docs link. |
| Contributor/application docs | Existing contributor guards and app-bundled documentation remain; synthetic-document/accountless tests and typed-content audit pass. |
| CI | Site steps retired in workflow and required sets together; `docs-tests` and full/frontend requirements remain fail-closed. |
| Public records | Current reader links reach `https://docs.animama.ai/`; original records remain readable at the public merge revision/PR without private links or source dependencies. |
| Merge/evidence | Owner approves exact cleanup head; actual full PR `Validation` and distinct post-merge outcome/scope are recorded and accepted. |
| Live/provider state | Existing Pages deployment, DNS/domain/RUM, content, flags and archives are untouched; no publication authority is inferred. |

No site build or provider migration test belongs to the cleaned Animama package.
The source-copy receipt establishes moved-site build fidelity; later Workers
browser, analytics event delivery and cutover acceptance must be obtained by
that site's owner and are not claimed here.

## Final integration review

Perform one full independent integration review and at most two repair rounds,
separate from Phase 1. Review the complete cleanup against accepted ownership,
source custody, full-revert fidelity, root link, validation preservation,
revision-addressable history and recovery.
Reuse current phase evidence; optional improvements do not block. Preserve
counts across resumption and stop at unresolved supported blockers.

### Code Review #1 Findings

Not run; integration repair rounds used 0 of 2. Record exact source, phase
references, stable IDs, evidence and remaining owner gates.

### Code Review #1 Revisions

Not run. Record dispositions, changes and affected verification. Owner acceptance
and exact-candidate merge remain separate from agent readiness.

## Idempotence and recovery

Keep Git/PR history, original publication inventory/archive and all Pages
resources. The original [PR #283](https://github.com/raymond-van/animama/pull/283),
[specification](https://github.com/raymond-van/animama/blob/10216cd36251b8e011557250f3c4951e8bd39a69/docs/plans/user-docs-site/user-docs-site-spec.md)
and [delivery ExecPlan](https://github.com/raymond-van/animama/blob/10216cd36251b8e011557250f3c4951e8bd39a69/docs/plans/user-docs-site/user-docs-site-execplan.md)
retain the original source, decisions, reviews and completed evidence after their
working-tree removal. The current migration plan stays tracked. Accepted Pages deployment is
`8021c42d-3d13-41da-a078-8f92118ff70e`; recovery provider origin remains
`animama-docs.pages.dev`. Original archive SHA-256 is
`2081582957e7a6473c40182321e5a8fe8a64279f47211c0cc84f9a16b494503f`;
inventory content digest SHA-256 is
`fa89a2c19b9bd9fd1839f92d7f67238f33d52b82309df3e7c32529e8a64d95e7`.
The serialized inventory JSON file SHA-256 is
`2053cdedaf83176c7f9738e9d4259a33c9e2255f042a83532b96fb1421025df4`;
these are distinct identities, both reverified during source-transfer setup.
These identities are retention references, not authority to redeploy or alter DNS.

Before retrying setup/removal, inspect actual paths, branch/status, receipt and
issue/PR state. Do not create duplicates or remove ignored data blindly. If
source-custody evidence becomes invalid before removal, leave source intact.

If accepted ownership later needs reversal, restore the original Animama site
source/lock/tests and its CI/operations/ignore and original planning records first
through an authorized task and reviewed inverse of the completed revert,
preserving later unrelated work. Verify its
independent build and original output before any separately approved removal of
the maintained destination copy. A source revert or restored README does not
perform DNS rollback, Pages upload or analytics changes. Destination removal,
source merges and any future provider recovery each require their own authority.

## Planning review record

### Former hosting-only scope: completed review, superseded approach

The draft committed at `c4245b1` received independent technical analysis and
read-only static checks. Initial analysis reported no required finding at draft
SHA-256 `a9baaa5b06a425acfaad446caa2c3c15660561ac7d725cc305637c14768e4f58`.
ST-01 was advisory: configured policy ignores plans, while a forced Prettier
check reported differences; no forced formatting pass was claimed. ST-02
accepted timestamps and ST-03 accepted two-site preview readiness. One repair
round was used; targeted analysis/static review passed at SHA-256
`9dfa4ec981a93ab6f3e101318971ce6a52deec75281c849641ddea4f5b41671b`.
Only the old review-result record changed afterward.

That review covered Animama-owned Workers preparation/cutover, not the newly
accepted complete-site handoff. It is retained as history and does not establish
this cleanup plan's readiness. No old implementation/review phase was executed.

### Complete-site ownership scope: initial review and targeted repair

2026-10-06: independent expanded-scope analysis review #1 passed with no required
findings at this draft's SHA-256
`7203ca0507715c2344a2858bf6b89a3ff58a80aff1ce2ebe17a0b9cbbee198cc`.
Static structure/whitespace/links/privacy checks passed. ST-OWN-01 identified
missing parity in the coordinating plan for this plan's receipt acceptance,
cleanup authority and post-merge acceptance gates; the coordinating plan now
states them explicitly, including honest reporting of reused Validation scope.
ST-OWN-02 was advisory and accepted there to label the proposed new CI guard file.

Planning repair #1 uses one of two rounds for this accepted new scope. Targeted
analysis/static review #2 passed: both dispositions verified, no new required
findings, and whitespace/links/public boundaries remain valid. Reviewed SHA-256
was `29696d63b995490102286fc27b3c8540e7759f2e5d09a7bfadd9a5ac19c4e131`.
Only planning-review result summaries changed afterward. This plan's source/CI/
provider boundaries are unchanged by the repair. Distinct-scope review does not
reset executed implementation budgets; Phase 1 and final integration remain
unstarted at 0 of 2 repairs each. Owner plan review remains pending.

### Full-revert amendment: affected-boundary recheck

2026-10-06: the owner questioned retaining any part of PR #283. The revised
proposal uses its complete mainline-1 inverse after the accepted source handoff,
with a new root README published-docs link and no local site stub. Read-only PR
metadata confirms the merge and complete 23-path boundary. The original
specification/delivery plan remain accessible at the frozen public merge
revision and PR; Pages resources and retained recovery evidence are unaffected.

Independent analysis/static affected-boundary recheck passed with no required
findings at SHA-256
`edb58701daba42cee481d29528075e235f279fad818851724503c3b36a54d8d9`.
Whitespace, structure, relative links, public privacy and unchanged handoff gates
passed. The read-only command
`git diff 10216cd36251b8e011557250f3c4951e8bd39a69^1 10216cd36251b8e011557250f3c4951e8bd39a69 | git apply --reverse --check`
also exited 0 without applying the inverse. Only review/progress result summaries
changed afterward. The ownership-scope repair count remains 1 of 2; this
owner-requested method revision does not restart a broad review or implementation
budget. Phase 1 and final integration remain unstarted; owner plan approval must
cover the complete revert, including original planning-file and ignore removal.

## Outcomes & Retrospective

2026-10-06, planning before execution authorization: read-only inventory established the exact
merged source/CI boundary and current main revision. Expanded-scope planning
analysis/static review passed after one targeted repair; the full-revert proposal
passed its independent affected-boundary recheck. No copy, cleanup, new
issue, provider mutation, push or merge occurred. First executable Animama outcome is
Phase 1 after the accepted source-copy merge/CI receipt and phase authorization.
Later hosting work waits for the separately merged/accepted source cleanup.

2026-10-06, execution setup: the owner invoked `$implement` for both reviewed
plans. Parent #285 and native child #286 were published and read back with
self-contained acceptance and source-custody gates. The assigned branch remains
`chore/workers-static-assets`, starting implementation setup at
`608e670ec87c74eaf05abfeb2cdc5ccdac91cf4f`; only this living record has changed.
The primary checkout remains clean on `main` at the original merge. No source,
CI, application, provider, publication or merge change was made here.

The destination maintainer has prepared the complete site copy and independently
verified three package builds against all 33 original archive files. Local
browser/HTTP evidence and bounded import review pass. Its actual candidate CI,
separate merge, actual main CI and owner-accepted durable source receipt remain
pending; this local evidence does not release Animama's source-removal gate.
Phase 1 and final implementation integration remain unstarted at 0 of 2 repairs.
