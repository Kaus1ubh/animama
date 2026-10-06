# Hand off the reader site and remove its local build ownership

Maintain this living plan under [PLANS.md](../../../PLANS.md) and
[SDLC.md](../../../SDLC.md). Preserve its progress, discoveries, decisions,
review counts and evidence at each handoff.

Source agreement: the owner's accepted 2026-10-06 clarification moves the complete
reader site, including content, generator, tests, lockfile and deployment
guidance, to its maintained website repository before any Workers migration.
Animama retains a link to the published documentation. This supersedes the
previous proposal for Animama to implement and publish its own docs Worker.
Create or reuse the self-contained public parent issue only at authorized setup;
it then owns acceptance. This plan does not create a competing spec.

Authorization now is planning and read-only inventory only. No cleanup,
implementation, issue creation, push, provider action or merge is authorized.
Owner review and subsequent implementation authorization are required.

## Purpose and context

Animama will continue building and running independently, while readers reach
its maintained guides at `https://docs.animama.ai/`. Remove the duplicate reader
site build/test/publication ownership only after its complete maintained source
has been accepted elsewhere. Keep contributor documentation and its validation,
application documentation inputs, historical delivery records and recovery
material. The existing live Pages site stays unchanged through source handoff.

This repository's assignment is one scoped source cleanup and one public PR.
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

- [ ] (2026-10-06) Phase 1: proposed scoped source/CI cleanup; pending revised
  plan acceptance, implementation authorization and completed source handoff.

Planning review for this ownership scope passed after one targeted repair round;
owner review remains pending. Implementation phase and
integration reviews have not started. Source removal, cleanup merge, post-merge
acceptance and any later hosting work are unperformed.

## Surprises & Discoveries

- PR #283's first-parent diff touches 23 paths: 16 site package files, two
  historical delivery records and five CI/operations/ignore files. A blanket
  merge revert would remove retained history and an environment-file safeguard.
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
| 2026-10-06 | Agent proposal | Remove site source and CI hooks selectively, retain a `docs/user/README.md` link stub, preserve delivery plans and the environment-file ignore. |

No consequential product decision remains for this cleanup proposal. The owning
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

### Phase 1: Remove duplicate site ownership while preserving local validation

Authorized scope after review: site-only source removal, published-doc links,
site-specific CI cleanup and useful ownership/validation guidance. Requirements:
completed source handoff, independent application builds, unchanged live docs,
retained contributor validation/history and a separately approved exact merge.
Dependencies: the gate above, owner phase authorization and authorized setup.
Starting source is the baseline above plus this reviewed planning record.

At setup, search existing public issues/PRs and reuse suitable records. Publish
and read back the self-contained cleanup acceptance in its owning issue; create
one bounded implementation assignment if required by SDLC. Use one public cleanup
branch/PR. Do not link inaccessible source-copy records or create an issue for
provider/manual gates. Record the operator receipt and source revisions here.

1. Reinspect the PR #283 first-parent diff and current paths. Inventory ignored
   local output/cache and preserve useful reviewed output before deleting local
   ignore rules; stop only task-owned previews. Do not run a blanket merge revert,
   recursive data purge or unrelated stack/worktree cleanup.
2. Replace `docs/user/README.md` with a short canonical documentation link and a
   clear statement that this repository no longer builds or publishes the reader
   site. Remove the other 15 tracked package files: its `.gitignore`,
   `.prettierignore`, `.prettierrc.json`, `.vitepress` source config/theme,
   `pages/*.md`, `package.json`, `pnpm-lock.yaml`, `scripts/check-site*.mjs`
   and `site-links.json`. Do not leave executable publication/build inputs here.
   Add a User guides link in root `README.md` and a concise ownership note in
   `docs/architecture/repository-boundaries.md` when useful; no UI redesign.
3. Update `.github/workflows/validate-public.yml` and
   `scripts/ci/validation_policy.py` atomically. Remove only `docs-install`,
   `docs-test`, `docs-build`, `docs-check` and their required-step `DOCS` set.
   Keep `docs-tests`, `COMMON`, Python installs/audit and the existing `docs`
   selection profile. Limit Node/pnpm setup back to `full`/`web`; full/frontend
   checks still require them through `FRONTEND`. Preserve all other profiles,
   aggregate failure rules, source-bound receipt/reuse policy and full callers.
4. In `scripts/ci/test_validation_policy.py`, retire the site-specific assertion
   that requires the removed checks. Update the existing minimal-doc profile
   contract to ensure site/Node installation is omitted while required Python
   contributor guards remain fail-closed. Keep added/deleted/renamed/unknown
   input selection full; cleanup's deletions cannot claim docs-only validation.
5. Correct only the reader-site scope in the validation-policy table at
   `docs/backend/operations/development.md`. Retain its synthetic-document and
   accountless checks, local evidence rules and unrelated operational guidance.
6. Retain `docs/plans/user-docs-site/user-docs-site-spec.md` and its ExecPlan in
   place. During implementation add a short explicit ownership supersession note
   to the historical delivery record, identifying this cleanup and the still-live
   canonical site; preserve original source/evidence/gates, not a bulk rewrite.
   Keep `.animama-docs-first-run.env` protected by the root `.gitignore`.
7. Run the commands below, independently review the exact cleanup boundary and
   prepare one public PR with the source-handoff receipt and local evidence.
   Obtain actual full `Validation` for the current candidate; preserve separate
   evidence for any unperformed checks. A plan approval does not approve merge.
8. Present the exact final head, actual CI scope/results, bounded phase/final
   review and limitations for separate owner approval. Use the ordinary merge
   procedure under SDLC. Read back the merge commit and actual post-merge
   `Validation` result/profile; a reused profile is not independent re-execution.
   Do not mark handoff complete or release the subsequent hosting prerequisite
   until the owner accepts the required post-merge evidence.

Completion: the public tree retains only the link stub under `docs/user`, no
retired site steps/requirements remain active, contributor/full validation is
preserved, public records are self-contained, and exact-source checks/reviews,
owner merge and post-merge acceptance pass. Published docs and retained Pages
resources remain unchanged. Issue/commit/evidence: pending authorized setup;
proposed phase commit `chore(docs)[p1]: hand off reader site ownership`.

#### Code Review #1 Findings

Not run; phase repair rounds used 0 of 2. Review exact source/baseline and
tracked/untracked boundary, preserved contributor/full CI, removal/link/history
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
`docs/user` and retired check IDs; only the intentional link stub and historical
records may describe the previous reader build. Resolve relative links and verify
no private imports, source paths or provider credentials entered local builds.
Use read-only formatting checks, not rewriting formatters. Run any additionally
applicable checks required by the current scoped guides before candidate push;
the existing hosted `Validation` workflow remains authoritative.

| Surface | Required acceptance |
| --- | --- |
| Source custody | Operator receipt confirms accepted merged copy, independent build and unchanged 33-file output plus actual candidate/post-merge CI. |
| Local source | Only the canonical-link README remains under `docs/user`; no lock, generator, tests, site content or deployment config remains. |
| Contributor/application docs | Existing contributor guards and app-bundled documentation remain; synthetic-document/accountless tests and typed-content audit pass. |
| CI | Site steps retired in workflow and required sets together; `docs-tests` and full/frontend requirements remain fail-closed. |
| Public records | Current links reach `https://docs.animama.ai/`; historical records remain readable without private links or source dependencies. |
| Merge/evidence | Owner approves exact cleanup head; actual full PR `Validation` and distinct post-merge outcome/scope are recorded and accepted. |
| Live/provider state | Existing Pages deployment, DNS/domain/RUM, content, flags and archives are untouched; no publication authority is inferred. |

No site build or provider migration test belongs to the cleaned Animama package.
The source-copy receipt establishes moved-site build fidelity; later Workers
browser, analytics event delivery and cutover acceptance must be obtained by
that site's owner and are not claimed here.

## Final integration review

Perform one full independent integration review and at most two repair rounds,
separate from Phase 1. Review the complete cleanup against accepted ownership,
source custody, public links, validation preservation, history and recovery.
Reuse current phase evidence; optional improvements do not block. Preserve
counts across resumption and stop at unresolved supported blockers.

### Code Review #1 Findings

Not run; integration repair rounds used 0 of 2. Record exact source, phase
references, stable IDs, evidence and remaining owner gates.

### Code Review #1 Revisions

Not run. Record dispositions, changes and affected verification. Owner acceptance
and exact-candidate merge remain separate from agent readiness.

## Idempotence and recovery

Keep historical delivery records, original publication inventory/archive and
all Pages resources. Accepted Pages deployment is
`8021c42d-3d13-41da-a078-8f92118ff70e`; recovery provider origin remains
`animama-docs.pages.dev`. Original archive SHA-256 is
`2081582957e7a6473c40182321e5a8fe8a64279f47211c0cc84f9a16b494503f`;
inventory SHA-256 is
`fa89a2c19b9bd9fd1839f92d7f67238f33d52b82309df3e7c32529e8a64d95e7`.
These identities are retention references, not authority to redeploy or alter DNS.

Before retrying setup/removal, inspect actual paths, branch/status, receipt and
issue/PR state. Do not create duplicates or remove ignored data blindly. If
source-custody evidence becomes invalid before removal, leave source intact.

If accepted ownership later needs reversal, restore the original Animama site
source/lock/tests and its scoped CI changes first through an authorized task and
reviewed inverse of the cleanup, preserving later unrelated work. Verify its
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

## Outcomes & Retrospective

2026-10-06: revised planning only. Read-only inventory established the exact
merged source/CI boundary and current main revision. Expanded-scope planning
analysis/static review passed after one targeted repair. No copy, cleanup, new
issue, provider mutation, push or merge occurred. First executable Animama outcome is
Phase 1 after the accepted source-copy merge/CI receipt and phase authorization.
Later hosting work waits for the separately merged/accepted source cleanup.
