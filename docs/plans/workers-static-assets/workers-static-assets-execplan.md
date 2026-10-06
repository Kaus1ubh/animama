# Migrate the existing user documentation to Workers Static Assets

Maintain this living plan under [PLANS.md](../../../PLANS.md) and
[SDLC.md](../../../SDLC.md), updating Progress, Surprises & Discoveries,
Decision Log and Outcomes & Retrospective at each handoff.

Source agreement: the owner's accepted documentation migration instructions of
2026-10-06. Create or reuse the Animama parent issue only at authorized setup;
it then owns acceptance. This public-safe plan is not a second spec.
Authorized scope now: research and planning only. Implementation, tracker writes,
pushes, provider mutations, publication and merge await separate authorization.

## Purpose and context

Serve the existing four reader pages at `https://docs.animama.ai/` from Workers
Static Assets while preserving reviewed content, routes, redirects, true 404s,
assets, availability declarations and Home/Download navigation. Publication stays
manual. The docs build needs no provider credentials, application build, running
stack or sibling checkout. Preserve provider-injected cookie-free Web Analytics
and RUM; do not embed a beacon in source output.

Animama owns `docs/user`, its output guard, deployment configuration and operating
guidance. The product site has a separate owner and implementation record. Its
public dependency is only continued HTTPS availability at `https://animama.ai/`
and `https://animama.ai/download`, with working navigation back to these docs.
Exclude redesign, docs expansion, authentication, backend/R2 changes and new
installer or source availability.

Starting source: `10216cd36251b8e011557250f3c4951e8bd39a69` (PR #283 merge).
The owner supplied successful required PR and actual post-merge CI for that
completed Pages delivery. Those historical checks do not validate this migration.
Task branch: `chore/workers-static-assets`; primary stays on `main`. On resumption
record checkout, verify HEAD/dirty state and preserve other work. No stack needed.

Orientation: `docs/user/.vitepress/config.mts` selects `pages/`, base `/`, clean
URLs and the default theme. `site-links.json` has Home/Download readiness true;
the reader pages retain installer/source-download "Coming soon" declarations.
`scripts/check-site.mjs` restricts publication to five HTML files and required
assets; fixtures reject leaks, symlinks, broken links and remote runtime assets.
`docs/user/README.md` describes Pages publication. Existing `Validation` includes
this independent package.

## Progress

- [ ] (2026-10-06) Phase 1: proposed local tooling/configuration and compatibility evidence;
  requires owner plan/phase authorization. No implementation has begun.
- [ ] (2026-10-06) Phase 2: pending local proof; operator guidance, exact candidate CI and
  separately approved provider/canary transfer-and-recovery acceptance.
- [ ] (2026-10-06) Phase 3: pending accepted previews; approved docs cutover, final integration
  review, evidence and separately approved exact-candidate merge/post-merge checks.

## Surprises & Discoveries

- The docs output currently contains 33 reviewed files. Its strict guard rejects
  `_redirects`; preserving Pages behavior requires one deliberately audited
  serving-control file rather than relaxing the entire allowlist.
- Fresh anonymous Pages checks on 2026-10-06 matched all reviewed docs files after
  removing only the observed singleton empty provider script and inserted newline.
  No checked response set a cookie. The broader two-site check covered 63 requests
  and 37 archived files; these are baseline findings, not Workers acceptance.
- Pages uses 308 aliases. Workers automatic HTML handling uses different redirect
  behavior and can recognize extra index aliases. Use explicit rules and test
  them; do not silently accept 301/307 changes or newly valid routes.
- Previous publication observed injected markup, without verified analytics event
  delivery. A prior Download-to-Docs browser navigation hit
  `ERR_BLOCKED_BY_CLIENT`; another narrow viewport override did not take effect.
  Full browser network/storage tracing was unavailable. None is fresh migration
  evidence, and a blocked navigation must not be reported as passing.
- The existing zone uses the Free-plan automatic RUM setting "Enable, excluding
  visitor data in the EU". The proposed canary is under that zone; no analytics
  setting change is needed. A `workers.dev` preview is not assumed to receive RUM.
- A Workers Custom Domain cannot coexist with the existing canonical CNAME. The
  eventual transfer has a possible interruption window; zero downtime is not an
  accepted or demonstrated property.

## Decision Log

| Date | Actor/status | Decision and reason |
| --- | --- | --- |
| 2026-10-06 | Owner, accepted | Plan the existing static-site migration only; preserve behavior, manual publication, provider-injected cookie-free RUM and retained Pages recovery. |
| 2026-10-06 | Agent proposal | Pin Wrangler 4.147.0 in this package and use an assets-only Worker with no application code or bindings. |
| 2026-10-06 | Agent proposal | Worker `animama-docs-static`; temporary zone canary `docs-workers-preview.animama.ai`; retain `docs.animama.ai` as canonical. Names require fresh inventory and later exact-action approval. |
| 2026-10-06 | Agent proposal | Disable automatic HTML handling; add exact 200 clean-route proxies and 308 aliases, with real 404 fallback. Phase 1 must prove pinned-runtime behavior. |
| 2026-10-06 | Agent proposal | Accept docs canary first, then transfer docs canonical host before the product-site owner's separately approved landing transfer. |

Plan review decisions: proposed names/order and acceptance of a possible bounded
transfer interruption in a later packet. If pinned behavior cannot preserve
routing or provider injection, stop and present the necessary scope change.
Do not substitute a source beacon, change canonical behavior or add runtime code
without an owner decision. Capacity constraints or paid upgrades need a decision.

## Phased implementation

Each phase below is proposed, not authorized now. At approved setup, create or
reuse one self-contained Animama parent issue and one assignment per authorized
implementation phase, using `SDLC.md`. Keep provider/human gates in this plan and
PR, not as separate issues. Use one branch and PR for this plan. Public records
must describe their contract without private links or machine paths.
Every phase and final integration gets one full independent review and at most
two repair rounds. Preserve counts on resumption; unresolved blockers stop work.

### Phase 1: Prove local serving compatibility

Scope: docs deployment tooling/configuration, narrowly required output controls
and behavior fixtures. Requirements: independent builds, unchanged reader/asset
bytes, pinned tooling, clean routes, exact redirects and true 404s. Dependencies:
owner plan/phase authorization and approved setup; starting source is above.

1. Add exact development dependency `wrangler: 4.147.0` to `docs/user/package.json`
   and regenerate its own lockfile using Node 24.15.0 and pnpm 10.33.0. Preserve
   VitePress 1.6.4 and all existing build/availability behavior.
2. Add two configurations outside output: `docs/user/wrangler.preview.jsonc`
   has no routes; `docs/user/wrangler.jsonc` declares the canary and canonical
   `custom_domain` routes. Both use the same proposed name, compatibility date
   `2026-10-06`, `workers_dev: true`, `preview_urls: true`, assets directory
   `.vitepress/dist`, `html_handling: "none"` and
   `not_found_handling: "404-page"`. Audit their
   identity/settings invariant; only domain declarations differ. No bindings,
   secrets, runtime entrypoint, deploy hook or CI provider credentials.
3. Generate one exact `_redirects` control file. Use relative 200 proxies from
   `/` to `/index.html`, `/desktop` to `/desktop.html`, `/self-host` to
   `/self-host.html`, `/troubleshooting` to `/troubleshooting.html`, and `/404`
   to `/404.html`. Add the recorded literal 308 aliases below.
   There is no wildcard SPA fallback or proxy to a remote origin.
4. Extend the guard only for that exact control file and reviewed contents.
   Retain all existing source/map/symlink/link/asset guards. Add behavior fixtures
   for missing/changed rules, config divergence, status/Location/query fidelity,
   no repeated rule processing, deep index aliases and missing-asset 404s.
5. Compare the 33 reader/assets files against retained reviewed bytes and record
   a fresh source-bound inventory/hash including the new control file. Any
   unexplained reader-byte change blocks acceptance.
6. Run the commands and route matrix below against the pinned local Workers
   runtime. Dry-run packaging must show only selected static output. Publish
   nothing and attach no domain in this phase.

Completion: local output/runtime checks and independent review pass; routing is
resolved and builds remain independent. Stop before preview if research differs.
Recovery: rebuild only task output/state and retry the same candidate.
Issue/commit/evidence: pending authorized setup;
commit form `chore(docs)[p1]: prepare Workers static assets`.

#### Code Review #1 Findings

Not run; repair rounds used 0 of 2. Record exact source, independent
configuration/output/runtime findings and stable IDs.

#### Code Review #1 Revisions

Pending: dispositions, changed files, checks and remaining repair budget.

### Phase 2: Prepare and accept a provider canary

Scope: current operator guidance, validation/evidence integration if required,
and the candidate approval packet. Provider execution is a separate manual gate.
Dependencies: Phase 1 passed, owner authorization for this phase, read-only
account/project/version/domain/DNS/analytics inventory, and each approved action.

1. Replace obsolete publication guidance in `docs/user/README.md` with pinned
   manual commands, exact-artifact review, separation of versions and domain
   triggers, and bounded recovery. Keep historical Pages evidence in its plan.
2. Refresh account capacity for this small assets-only site: Worker count, asset
   count/per-file limits, preview/version support and proposed names. Read-only
   planning inventory shows Free capacity; documented limits are 100 Workers,
   20,000 files per version and 25 MiB per file. Existing docs are 33 files,
   999,246 total bytes, largest 120,840 bytes. Static requests/storage are free;
   script invocation quotas are separate. No paid upgrade or bindings are needed.
   Record current usage and reconfirm existing RUM/exclusion settings.
3. Run applicable local checks before push. New configuration/tooling files
   require actual full `Validation`; retain its selected profile and results.
   Do not add a deployment workflow or claim local evidence is hosted CI.
4. Freeze source SHA, exact output/config hashes, toolchain, upload inventory and
   proposed actions. Obtain acceptance of unchanged rendered content and this
   candidate. Keep one PR open through authorized provider evidence updates.
5. After Gate A, use only the preview config for explicit initial Worker
   creation/upload. Enumerate creation, static upload and initial preview
   activation together in its packet. Record returned version/deployment URLs;
   re-read an uncertain outcome before retrying.
6. Validate the exact version at its provider URL. Obtain Gate B for a bounded
   canary transfer/recovery rehearsal, enumerating every association/DNS effect.
   First associate the unused canary with the retained Pages project and verify
   its proxied Auto-TTL CNAME and accepted production content. Transfer it by
   removing that CNAME, detaching only its Pages domain, then associating it with
   the approved Worker Custom Domain. Read back managed DNS/TLS and verify it.
   No Pages upload, production-pointer change or canonical transfer is needed.
   Do not assume `workers.dev` proves automatic RUM injection.
7. Collect fresh route/asset/browser/privacy evidence, including a loaded beacon
   and associated collector request accepted by the provider. An aggregate
   dashboard alone does not prove this session's event delivery. Preserve the EU
   exclusion; no analytics setting change or source beacon is proposed.
8. Complete Gate B's separately approved reverse rehearsal: remove the canary's
   Worker association and attributable managed record if still present, then
   reassociate it with Pages before restoring/verifying its recorded CNAME.
   Verify accepted Pages content/TLS, then repeat the approved forward transfer
   to the accepted Worker version and rerun final preview acceptance. Preserve
   canonical domains and the accepted Pages deployment throughout. Rehearsal
   does not guarantee canonical activation timing or continuous availability.

Completion: full CI, provider preview and zone-canary acceptance pass; recovery
is reviewable and the approved version is identified. Keep provider/browser and
local/CI evidence distinct; blocked navigation or unobserved events stay pending.
Recovery: retain all Pages resources; canonical DNS is untouched. Any canary
removal or new version activation requires an exact approved action.
Issue/commit/evidence: pending; commit form
`chore(docs)[p2]: document manual Workers publication`.

#### Code Review #1 Findings

Not run; repair rounds used 0 of 2. Record publication/privacy, pinned commands,
CI and candidate evidence.

#### Code Review #1 Revisions

Pending: dispositions, fixes, refreshed checks and repair count.

### Phase 3: Transfer the canonical host and hand off

Scope: final operator/evidence updates. Dependencies: this site's Phase 2
acceptance and the product-site owner's readiness receipt confirming its own
provider/canary previews and transfer/recovery rehearsal passed before either
canonical transfer. The receipt names tested public origins/version, content,
route/browser/RUM checks and recovery outcome; it supplies no private source or
build dependency. Also require authorization of this phase, current read-only
DNS/domain inventory, the approved exact docs cutover/rollback packet and a
capable browser or owner-run evidence. Readiness supplies no mutation authority.

1. Present Gate C with exact current/expected records, approved version/output,
   interruption window, rollback triggers and separately approved or concretely
   preauthorized rollback actions. Never infer cutover approval from plan review.
2. Transfer docs first: remove only its approved Pages CNAME, detach its Pages
   domain using the supported procedure, then associate the Workers Custom
   Domain and verify its generated DNS/TLS state. Read back after each action;
   preserve unrelated records. Do not run final-config `wrangler deploy` as an
   implicit trigger-sync shortcut.
3. Immediately repeat canonical HTTP/assets, direct reloads, clicked cross-site
   navigation and RUM/privacy acceptance against the approved version. On a
   supported failure, execute only approved recovery or stop for the exact
   missing authorization. Record any observed interruption and recovery.
4. Give the product-site owner the public docs compatibility result. Their
   later landing cutover is a separate host, candidate and approval; repeat
   both-direction canonical navigation after that owner reports completion.
5. Update this plan and operating guidance with actual provider identities,
   exact evidence and limitations. Refresh affected checks and final candidate
   CI. Preserve Pages deployment/archive, canary and provider previews until
   their separately authorized disposition.

Completion: canonical/shared navigation acceptance, operator evidence and final
review pass. Merge remains Gate D. Issue/commit/evidence: pending;
commit form `chore(docs)[p3]: record Workers cutover acceptance`.

#### Code Review #1 Findings

Not run; repair rounds used 0 of 2. Record domain sequence, recovery and evidence
freshness.

#### Code Review #1 Revisions

Pending: dispositions and remaining repairs; unresolved blockers stop.

## Validation and acceptance

From the repository root, after implementation authorization:

```bash
pnpm --dir docs/user install --frozen-lockfile
pnpm --dir docs/user test
pnpm --dir docs/user build
pnpm --dir docs/user check
pnpm --dir docs/user format:check
WRANGLER_SEND_METRICS=false pnpm --dir docs/user exec wrangler --version
WRANGLER_SEND_METRICS=false pnpm --dir docs/user exec wrangler deploy --config wrangler.preview.jsonc --dry-run
WRANGLER_SEND_METRICS=false pnpm --dir docs/user exec wrangler deploy --config wrangler.jsonc --dry-run
WRANGLER_SEND_METRICS=false pnpm --dir docs/user exec wrangler dev --config wrangler.preview.jsonc --local --ip 127.0.0.1 --port 4185
git diff --check
```

Run Git checks outside the running preview. Check ports; stop only task processes.
Content preview remains `pnpm --dir docs/user preview` at `127.0.0.1:4175`.
New fixtures use the existing `test` command. For changed CI policy, also run
`python3.12 -m unittest discover -s scripts/ci -p 'test_*.py' -v`.

| Matrix, repeated locally, at provider preview/canary and canonical host | Expected |
| --- | --- |
| `/`, `/desktop`, `/self-host`, `/troubleshooting` and their heading anchors | 200, correct selected content; direct reload and no-JavaScript readability |
| `/index.html` | 308 to `/` |
| `/index` | 308 to `/` |
| `/<reader>.html`, `/<reader>/` for the three non-root reader routes | 308 to the extensionless route; query preserved |
| `/<reader>/index` | 308 to `/<reader>/`, then 308 to `/<reader>`; preserve the existing two-hop chain |
| `/404.html`, `/404/`, and `/404` | First two redirect 308 to `/404`; direct `/404` returns 200 with reviewed 404-page bytes |
| `/desktop.html?migration=58` | 308 to `/desktop?migration=58` |
| `/<reader>/index.html`, unknown/deep routes, missing assets and source/plan paths | Actual 404 with reviewed fallback; no SPA 200 or broadened index alias |
| `/.env`, `/.git/config`, `/docs/plans/`, `/docs/user/pages/index.md`, `/wrangler.jsonc`, `/_redirects` | Actual 404; source/configuration/control files are unservable |
| Successful and redirect routes with a query, using GET and HEAD | Same status/Location contract; query retained; HEAD body empty; no loop |
| Every reviewed asset and direct 404-page aliases | Bytes and status/Location match fresh baseline; only the reviewed control file is added |

Fresh browser acceptance uses measured desktop and narrow viewports, keyboard
focus/menu/anchors, no-JavaScript content, console and network traces, and clicked
Docs-to-Home/Download plus Download-to-Docs navigation. If a tool blocks the
route or cannot set the viewport, use a capable browser or owner-run evidence;
do not relabel HTTP success or earlier screenshots as that browser check.
Check response cookies and browser cookies/storage. Only the documented
VitePress theme preference is allowed; observe provider-only beacon delivery.
Report injection, script loading, collector acceptance and reporting separately.

## Exact provider-action and merge gates

Run templates from the repository root with the operator's external approved
credentials. Fill placeholders; review account targets privately. Log no secrets.

| Gate | Separate approval packet and allowed action |
| --- | --- |
| A: initial preview | Approved name/source/output/config hashes, creation + upload + preview activation; `pnpm --dir docs/user exec wrangler deploy --config wrangler.preview.jsonc`. No domain routes. |
| A2: later version/activation | Exact candidate and actions approved separately: `pnpm --dir docs/user exec wrangler versions upload --config wrangler.jsonc`, then `pnpm --dir docs/user exec wrangler versions deploy '<APPROVED_VERSION>@100%' --config wrangler.jsonc`. These do not synchronize domain triggers. Never redeploy the provider-only config after domain attachment or implicitly synchronize unapproved final routes. |
| B: zone canary | Exact retained-Pages association, forward/reverse/forward canary transfers, DNS/certificate effects and readbacks; preserve canonical domains and accepted production deployment. No Pages upload. |
| C: canonical transfer/recovery | Exact old CNAME deletion, Pages detachment, Workers association and DNS/TLS effects; interruption and concrete rollback actions. Each effect is enumerated, never bundled implicitly by CLI. |
| D: source merge | PR URL, exact final head, actual `Validation` result/scope, bounded reviews and limitations; separate owner approval and ordinary merge commit under SDLC. Verify resulting main and post-merge validation. |

Plan/phase acceptance is not provider authorization. Resource retirement,
DNS/version rollback and deletion need explicit approval or concrete cutover
preauthorization; Pages retirement remains excluded.

## Final integration review

Review combined acceptance at the exact final candidate with still-valid phase
evidence. Reviewers do not mutate state or rewrite files.

### Code Review #1 Findings

Not run; integration repair rounds used 0 of 2. Record source, stable IDs,
command/provider/browser evidence and impact.

### Code Review #1 Revisions

Pending: dispositions, changes, checks and repairs. Owner acceptance and merge
remain separate.

## Idempotence and recovery

Use pinned commands and inspected identities. Rebuild/review changed source or
configuration; never upload stale output or repository contents. Read uncertain
actions back before retrying; preserve unrelated state and previous versions.

Retain Pages project `animama-docs`, deployment
`8021c42d-3d13-41da-a078-8f92118ff70e`, its reviewed 33-file archive/inventory and
the verified `animama-docs.pages.dev` recovery destination. The approved archive
SHA-256 is `2081582957e7a6473c40182321e5a8fe8a64279f47211c0cc84f9a16b494503f`;
inventory SHA-256 is
`fa89a2c19b9bd9fd1839f92d7f67238f33d52b82309df3e7c32529e8a64d95e7`.
Inspect actual retained state before cutover; baseline evidence is not permission
to redeploy or change it.

Concrete canonical rollback: remove the approved Worker domain association and
its provider-managed DNS record if still present; reassociate `docs.animama.ai`
with the retained Pages project before restoring/verifying its proxied Auto-TTL
CNAME to `animama-docs.pages.dev`; then verify Pages activation, TLS, exact content,
routes, true 404s and navigation. Readback may show a step already completed.
Mutations require Gate C's explicit rollback authorization or new approval.
For an accepted domain with a bad Worker version, an exact previously accepted
version activation may be narrower recovery, but also needs its own approval.
No global purge, unrelated teardown or Pages retirement is part of recovery.

## Research references

- [Static-asset redirects and first-match 200 proxies](https://developers.cloudflare.com/workers/static-assets/redirects/), [HTML handling](https://developers.cloudflare.com/workers/static-assets/routing/advanced/html-handling/) and [static-site generation/404 serving](https://developers.cloudflare.com/workers/static-assets/routing/static-site-generation/).
- [Wrangler 4.147.0 release redirect parser](https://raw.githubusercontent.com/cloudflare/workers-sdk/64c1337155a6bc7224b5d47f58ca521d8b8ee3fe/packages/workers-shared/utils/configuration/parseRedirects.ts) accepts 200 rules. Local and uploaded pinned-runtime tests must still prove query preservation, first-match behavior and 404 semantics.
- [Wrangler Workers commands](https://developers.cloudflare.com/workers/wrangler/commands/workers/) and [version preview URLs](https://developers.cloudflare.com/workers/versions-and-deployments/version-urls/).
- [Pinned workerd maximum compatibility date](https://raw.githubusercontent.com/cloudflare/workerd/v1.20261001.1/src/workerd/io/maximum-compatibility-date.txt): supports through `2026-10-08`, including the proposed `2026-10-06` date.
- [Workers Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/) and [Pages custom-domain procedures](https://developers.cloudflare.com/pages/configuration/custom-domains/).
- [Static asset billing and limits](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/) and [platform limits](https://developers.cloudflare.com/workers/platform/limits/).
- [Web Analytics setup](https://developers.cloudflare.com/web-analytics/get-started/), [FAQ](https://developers.cloudflare.com/web-analytics/faq/) and [limits](https://developers.cloudflare.com/web-analytics/limits/).

## Planning review record

Draft authored 2026-10-06. Planning review #1 used independent requirements and
technical analysis plus read-only static checks. Analysis passed with no required
findings at this draft's SHA-256
`a9baaa5b06a425acfaad446caa2c3c15660561ac7d725cc305637c14768e4f58`.
Static structure, whitespace, links and public privacy boundaries passed.

Main-agent dispositions: ST-01 is advisory; a forced Prettier check reports
formatting differences, while configured policy ignores this plan. Retain readable
Markdown; do not claim forced formatting passed. Accept ST-02 and add timestamps
to each phase Progress item. Accept ST-03 and explicitly require the product-site
owner's public-safe preview/recovery readiness receipt before docs cutover.
The independent runtime date check supports the existing pin; its source is cited.

Planning repair #1 uses one of two allowed rounds. Targeted analysis and static
review #2 passed: ST-02/ST-03 resolved, no new required findings, links/whitespace/
public boundaries and phase/final review records remain valid. Reviewed SHA-256
was `9dfa4ec981a93ab6f3e101318971ce6a52deec75281c849641ddea4f5b41671b`.
Only this review-result record changed afterward. Implementation phase and
integration review budgets have not started; owner plan review remains pending.

## Outcomes & Retrospective

2026-10-06: planning only; no implementation, issues, provider changes or merge.
First implementable outcome after authorization: Phase 1 local configuration,
output and routing proof. Preview, event-delivery, canonical and merge acceptance
remain unperformed; record actual outcomes as execution advances.
