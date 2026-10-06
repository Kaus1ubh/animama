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
its dependencies. On 2026-10-06 the owner explicitly approved the destination
copy's merge and directed the complete PR #283 revert afterward. That merge and
its actual full main CI now pass, releasing source removal under that instruction
and the operator receipt below. Provider actions and the cleanup candidate's
exact-head merge retain their separate approval requirements.

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
`10216cd36251b8e011557250f3c4951e8bd39a69`, PR #283's merge. Current main is
`dfd8bb15a2c4f09eaffc527803fe2878fd414b11`; its unrelated PR #288 desktop fix
must remain. The existing task branch merged that main without rewriting its
planning history and starts this inverse at `6d35989efa77f9c883d307e6e2278605fac069a0`.
Local planning commit
`c4245b1284ffc92f3d0156e22863e1a6ad546952` records the former hosting-only proposal;
it is not implementation or provider acceptance. Reuse assigned task branch
`chore/workers-static-assets`, verify checkout/HEAD/dirty state on resumption,
and keep the primary checkout on `main`. No Compose stack is required.

## Progress

- [ ] (2026-10-06) Phase 1: destination source custody and actual full main CI
  accepted through the owner's merge-then-revert instruction; full inverse and
  root link implemented. All seven scoped local checks and independent phase
  and final integration review pass without findings/repairs. Actual full PR CI,
  exact cleanup merge and post-merge acceptance remain.

Planning review for the earlier selective-removal proposal passed after one
targeted repair round. The full-revert amendment passed its independent
affected-boundary recheck; owner plan review is complete through the explicit
implementation request. Initial implementation phase and final integration
reviews each pass with 0 of 2 repairs used. Cleanup merge, post-merge
acceptance and later hosting work remain unperformed.

## Surprises & Discoveries

- PR #283's first-parent diff touches 23 paths: 16 site package files, two
  historical delivery records and five CI/operations/ignore files. A full revert
  removes all 23 changes from the current tree, including the original plan/spec
  and `.animama-docs-first-run.env` ignore. It preserves Git/PR history and does
  not mutate the manually published Pages deployments or retained archives.
  The earlier selective-removal rationale confused current-tree retention with
  preservation of history; neither a link stub nor that old ignore is required.
- Refreshed Git inventory on 2026-10-06 finds main at `dfd8bb15`, including the
  unrelated desktop packaging fix in PR #288. All 23 PR #283 paths still exactly
  match their `10216cd3` blobs; the complete inverse has no later-path collision.
  Its first parent is `b9a1e588ac820e0b50e1622c914668a69650275a`.
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
| 2026-10-06 | Owner, accepted continuation | Approve the destination-copy merge, then direct the full Animama #283 revert. Actual full destination main CI passed before source removal; separate cleanup-head merge and post-merge acceptance still apply. |

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

## Accepted source-custody receipt

2026-10-06, operator attestation before source removal: the owner approved the
reviewed destination copy's ordinary merge and explicitly directed the full
Animama PR #283 revert afterward. All conditional source-custody checks below
passed before the inverse. This record is self-contained and requires no private
checkout, service account, source import or inaccessible link.

- Complete maintained source: all 16 package files transferred. Fifteen blobs are
  identical; only the maintainer README's relocated operator references changed,
  with no reader, generator/config, lockfile or seven output-guard changes.
  Opaque reviewed candidate identity is `69eff39cfca8552c4b26aaac703d9534c0e3d5a3`;
  accepted destination main identity is `968fbf0f54f3176d32799581f004fb5aa8e6797f`.
  Candidate and main trees are identical; no Worker hosting controls were added.
- Three independent frozen installs/builds: original source extracted from
  `10216cd3`, the extracted destination package and the maintained package each
  used Node `24.15.0`, pnpm `10.33.0` and VitePress `1.6.4`. From each package,
  `pnpm --ignore-workspace install --frozen-lockfile` with its own isolated store,
  then `pnpm --ignore-workspace test`, `build`, `check` and `format:check` all
  exited 0. Each ran seven guards and audited five HTML files/108 links. Clean
  environments supplied no provider credentials, sibling source or application
  artifacts; installed dependencies were not copied.
- Publication fidelity: each build matches all 33 relative paths, lengths and
  SHA-256 values below, totaling 999,246 bytes. Archive SHA-256 is
  `2081582957e7a6473c40182321e5a8fe8a64279f47211c0cc84f9a16b494503f`.
  Reviewed inventory content digest is
  `fa89a2c19b9bd9fd1839f92d7f67238f33d52b82309df3e7c32529e8a64d95e7`;
  its serialized JSON file digest is
  `2053cdedaf83176c7f9738e9d4259a33c9e2255f042a83532b96fb1421025df4`.
  Those distinct identities and every archive byte were reverified.
- Actual CI: the exact source-copy candidate's push and PR runs passed both
  independent static-doc checks and the full service foundation. The actual
  destination main-push run completed successfully at 18:38:31 UTC, executing
  both jobs, including frozen docs installation/test/build/audit/format and the
  foundation's build/static/Python/hosted-schema/composition/identity/browser
  checks. No reduction, reuse, waiver or old publication run supplied acceptance.
  Bounded independent import review passed after one repair; scoped integration
  passed without repairs. Full run metadata and artifacts are retained by the
  operator; this public attestation does not expose private records.
- Continuing publication: a fresh read-only Pages probe at 18:34:01 UTC passed
  38 checks: all 33 docs files, three landing entry/asset files and each site's
  true unknown-route 404. The four guide routes and assets remain available at
  `https://docs.animama.ai/`. No upload, DNS/domain, analytics or retirement action
  occurred. The accepted docs Pages deployment remains
  `8021c42d-3d13-41da-a078-8f92118ff70e`, with archives retained separately.
- Limits: these HTTP checks observed no cookies and no RUM beacon. They establish
  Pages bytes/availability, not new Workers behavior, full browser privacy,
  canonical new-tab navigation or correlated analytics event delivery. The prior
  `ERR_BLOCKED_BY_CLIENT` navigation limitation and unverified event delivery
  remain explicit requirements of the later hosting migration.

The owner's merge-then-revert instruction accepts continuation once these checks
pass; the cleanup head's separate merge approval and actual post-merge acceptance
remain outstanding. This attestation is an operator readiness dependency only.

| Publication file | Bytes | SHA-256 |
| --- | ---: | --- |
| `404.html` | 2097 | `4d5e76085e9a552d1949718d0555d3b7a06e378402cbc68703afeaddb135c434` |
| `assets/app.Br4IF3YI.js` | 1352 | `526ef3d0d5c918331fc719f08e5b64a8966aafe10fbf1bf2dc21341055e66a31` |
| `assets/chunks/framework.C4zpkcTP.js` | 104615 | `e7a84b125edfdceca50c01abfd8bebf000d8e7c62c5885f79141cf552604eae4` |
| `assets/chunks/theme.Be-zRBiP.js` | 53214 | `ec625e2b129f861ba6a8ebbb8f0318f02444e9a774e2269da8013fd10bb76752` |
| `assets/desktop.md.BDntYtf9.js` | 4882 | `6a856bf4a2de56836be96bde5a790102e95f0a3be2b13a71a276a053c0828c69` |
| `assets/desktop.md.BDntYtf9.lean.js` | 391 | `61b217c63df38a8e9817b70c45d2c83bb07765dd35dca8bf02152210a53bc00c` |
| `assets/index.md.D3Uq1osL.js` | 2212 | `b0f3bb5f4955c392b027b62a0316b48cb7c6fbbb66f825bfa5143a8c5f5fb160` |
| `assets/index.md.D3Uq1osL.lean.js` | 373 | `4cd737a7c3fdbb12f7570f6cf445a9ce6cf24efc17b6781cc4203fa1c83a6578` |
| `assets/inter-italic-cyrillic-ext.r48I6akx.woff2` | 43112 | `3f2ea09e148441f83171eae388d00da780b24b9bd155c141d0b5fbb0d803871d` |
| `assets/inter-italic-cyrillic.By2_1cv3.woff2` | 31300 | `2a1c3126375078cd85d262aad635ac9d9ff9ac2c18b8143b2d21d540f9cd3dfb` |
| `assets/inter-italic-greek-ext.1u6EdAuj.woff2` | 17404 | `bae39b1cc79168c9ac47f120c3eaa82cb634dc17e457cdd484725d8c7a60ab3e` |
| `assets/inter-italic-greek.DJ8dCoTZ.woff2` | 32564 | `138cf731e5a284e262c576f765a6cb8f58045cb798d16693091e2251a0f63559` |
| `assets/inter-italic-latin-ext.CN1xVJS-.woff2` | 120840 | `3e166de9aeff2d6a3d13c9228e03f7ff76369f5fa95fe0ab1d1d44235d5516aa` |
| `assets/inter-italic-latin.C2AdPX0b.woff2` | 74784 | `3570e65005ccd9ecd87c6ccc7c713fc474a80ff7c3abbb1063f0e8ab4f8dc891` |
| `assets/inter-italic-vietnamese.BSbpV94h.woff2` | 14884 | `a0aae13c473b99b63f3c0b8b692b3b2a4023145171aa86964f268235573e4ce5` |
| `assets/inter-roman-cyrillic-ext.BBPuwvHQ.woff2` | 40488 | `a49e47fb34f94acf8ceb57603cb2fc4c01861527a9a304de3a0236b7b67da2c6` |
| `assets/inter-roman-cyrillic.C5lxZ8CY.woff2` | 29164 | `d888610b6342164a592e59a4ce91a3755126a6ca2ee4e0d75c8e915eebaeed68` |
| `assets/inter-roman-greek-ext.CqjqNYQ-.woff2` | 16272 | `7b7519f21aff6b3a011099999cec8a9d4c99173a8c9adeecffb0bd032fc49f69` |
| `assets/inter-roman-greek.BBVDIX6e.woff2` | 29920 | `1a1997dfdcd7a9e0d2b26944b4b7fd1f1b2fde91bb405cb7a5870f93b45d2e05` |
| `assets/inter-roman-latin-ext.4ZJIpNVo.woff2` | 110160 | `539d139f99942e93bead7bbcd18bc00f5a73932eb3a8997367f2b79f4f75bc60` |
| `assets/inter-roman-latin.Di8DUHzh.woff2` | 67792 | `f7ab715caa2c78facb4334b211c81ee66f037cf9c99ca3f24acd543e84a93278` |
| `assets/inter-roman-vietnamese.BjW4sHH5.woff2` | 14072 | `b315417b28ce251a54000a824d73c5af36798a88b3c05594f28dada0cbffab5a` |
| `assets/self-host.md.DMl_F7N_.js` | 8366 | `ffd1666a2e63db48b4db03a2ee43e152d785eebdd7f0388ba3a6b41b72fd02a9` |
| `assets/self-host.md.DMl_F7N_.lean.js` | 400 | `c60f37f86154d13686d2d691f9f2164efa3bda8142bf90569dd190ed4e0f9016` |
| `assets/style.C04r2E4u.css` | 108435 | `d80e316837b6a1427f0bfca284c848ce05bb63ee8a9866357f101f2c6e6d3eb9` |
| `assets/troubleshooting.md.BGLMDK8f.js` | 6967 | `fcdaf1cabda34d233bd8142c5aeeaf048ebd72783d68b6168d384cb17046bfd6` |
| `assets/troubleshooting.md.BGLMDK8f.lean.js` | 412 | `32030407e30c455d82fccca51b2a72a8c77d66d6a5124b327b8f1ed2eec255fa` |
| `desktop.html` | 15036 | `b73a34e5e65382847253f59980173a2d783d0a3035b1c8038fc899e98822684c` |
| `hashmap.json` | 106 | `61e86effe6b473ceaf4db4f1be86240762b1d70ec0c93eb69dc4b1425dc15069` |
| `index.html` | 12167 | `01dfb732574e40b88b3761b8be2d973f67250e1f81f12971f0db4ec3131e9653` |
| `self-host.html` | 18536 | `b80edba41f366e2241f8d580baa6e66b0ff99c256fb6f6e8e88bd37ed1823f99` |
| `troubleshooting.html` | 16929 | `0d5b5ea6801dd1bf113f7b7a75ba2d137e537a37b496418f42a2e06310f4aa22` |
| `vp-icons.css` | 0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |

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
assigned task worktree/branch, initially at `608e670e` and now at `6d35989e`
after merging current main `dfd8bb15`. Primary main remains clean; no local
stack is required. The destination copy is merged with actual full main CI
success and the source-custody receipt below. Neither checkout contains ignored
docs output, dependencies, cache or a docs-first-run record to relocate. Existing
primary environment/stack files were inspected only for existence/mode and left
untouched. Frozen Python 3.12.13 server dependencies were installed in this task's
own environment; no sibling environment or installed dependency tree was copied.

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
resources remain unchanged. Owning issues are #285/#286; phase commit
`bcfa3e6897a35df556c004e36c8fd2b953a23f7c`
(`chore(docs)[p1]: revert retired reader site ownership`) records the verified
implementation and the original merge/mainline-parent identities in its body.
Subsequent delivery-record changes alter only this living plan.

#### Code Review #1 Findings

2026-10-06: independent analysis and read-only checks pass with no required or
advisory findings. Reviewed HEAD `6d35989efa77f9c883d307e6e2278605fac069a0`
plus all staged inverse changes and unstaged root README/living plan, against
main `dfd8bb15a2c4f09eaffc527803fe2878fd414b11`: 25 paths, no untracked source.
Both reviewers independently verify all 23 inverse paths in index and worktree,
five exact first-parent restorations, eighteen additions removed and four
unrelated desktop paths preserved. Contributor `docs-tests`, full/frontend
requirements, conservative full selection and the final fail-closed guard remain.
The root link, public custody inventory, history and ordered source recovery pass.

Source manifest excluding this living plan is SHA-256
`3fb1d1096c0056986e1cab18b0855a8488cce96598f6f7fb6992e4206b66d211`
(path-ordered file/bytes/SHA-256 entries; deleted paths use null bytes/hash;
compact sorted-key JSON). The reviewed plan hash before this result-only update
is `f71825541145c58bdcfd8e1f378e2e69a6c4e0fd3b308d0886c993e6e82e002c`.
Actual full PR CI, exact-head merge and post-merge acceptance remain separate.

#### Code Review #1 Revisions

No findings or repairs. Phase repair usage is 0 of 2; no source changes followed
the review, only these delivery-result records. Preserve this count on resumption;
any later supported repair receives a targeted recheck.

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

2026-10-06 local execution: all seven commands above exited 0 in the frozen
task-local Python 3.12.13 environment. CI-policy discovery ran 95 tests;
synthetic-document/accountless tests ran 20, with existing FastAPI lifespan
deprecation warnings. Ruff lint and read-only format pass. Typed-content audit
passes; Python import audit reports zero forbidden edges, 268 reachable modules
and 207 shared modules. Whitespace passes for the complete baseline diff.
Exact inverse/retained-path assertions also pass. No application/frontend suite
was rerun locally for this mechanical inverse; actual full hosted Validation
remains required. The TDD exception uses the existing conservative CI/contributor
guards and exact Git inverse proof, without artificial implementation-mirroring
tests. No local stack or provider operation was needed.

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

2026-10-06: separate final integration analysis and read-only checks pass local
delivery readiness, with no required or advisory findings. Reviewed phase commit
`bcfa3e6897a35df556c004e36c8fd2b953a23f7c` plus its unstaged living-plan commit
receipt against baseline `dfd8bb15`. All 24 non-plan committed paths match the
passing phase/local receipts and unchanged source manifest above; seven valid
checks were reused without repeating unchanged suites. Overall custody,
full-inverse fidelity, unrelated-work preservation, canonical link, public
privacy/history/recovery and conservative CI remain valid. Full baseline
whitespace passes. Reviewed plan before this result-only update is SHA-256
`974ff57fe49ecabf55b6164670560f3d80a058414e330667f677c85ea27a315d`.
Actual full PR Validation, exact-head merge and owner-accepted main scope remain
pending; local integration readiness does not release later hosting work.

### Code Review #1 Revisions

No findings or repairs; integration usage is 0 of 2, separately from phase
usage 0 of 2. Only living delivery-result records changed after review. Owner
acceptance and exact-candidate merge remain separate from agent readiness.

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

The destination maintainer independently verified three complete package builds
against all 33 original archive files. Local browser/HTTP evidence and bounded
import review pass. Actual full candidate and main CI passed, and the owner
approved the exact source-copy merge followed by this full revert. The receipt
below releases source removal, while the cleanup candidate's exact merge and
actual post-merge acceptance remain separate. The complete inverse and root link
now pass all seven scoped local checks and independent phase analysis/checks.
Phase and final integration reviews each pass with 0 of 2 repairs. Actual full
PR Validation, separate cleanup-head merge and accepted post-merge outcome remain.
