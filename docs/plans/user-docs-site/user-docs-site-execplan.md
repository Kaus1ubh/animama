# Deliver the minimal Animama user documentation site

Status: Authorized execution plan, 2026-10-05.

Source agreement: the owner's 2026-10-05 `implement` invocation accepts the
resolved [spec snapshot](user-docs-site-spec.md) of authoritative
[issue #279](https://github.com/raymond-van/animama/issues/279), captured at
2026-10-05T17:40:54Z. Standalone VitePress 1.6.4, http-server 14.1.1 and manual
Pages Direct Upload are the accepted implementation defaults.

Authorized scope: Phases 1–2 below, one owning Animama issue, one issue per
phase, the existing task branch and one draft PR. Rendered-content acceptance,
each provider action and exact-candidate merge remain explicit owner gates.

## Purpose and context

Provide four short reader pages at `https://docs.animama.ai/`: Overview,
Desktop getting started, Self-host quick start and Troubleshooting. The site
contains selected user guidance and static assets; it builds independently of
the application and any other repository. The spec owns behavior and acceptance;
this plan explains delivery without creating a second requirements contract.

Planning inspected the assigned Animama worktree, clean except for the proposed
spec, on `docs/minimal-user-docs`, starting at
`f90c080fc343a159cb9d7f9059a35127f871c021`. `main` was clean at the same source.
Reuse this branch/worktree; record its repository-relative handoff identity and
new source revisions when execution begins. No stack or docs preview is running.

Relevant implementation and authoring references:

- `README.md`, `docs/frontend/desktop/installation.md` and
  `docs/frontend/desktop/troubleshooting.md`: local product, desktop availability,
  setup, keys, speech, storage and recovery. Current guides report no signed
  public installer; publication approval and native acceptance remain separate.
- `docs/backend/operations/development.md`, `model-assets.md`, `local-models.md`
  and `docs/frontend/features/model-settings.md`: built self-host startup,
  provider configuration, optional speech, persistence and the loopback boundary.
- `docs/architecture/repository-boundaries.md` and `docs/agents/domain.md`:
  public-safe content, independent builds and deliberate publication. Current
  repository visibility/licensing does not imply source-download availability.
- `.github/workflows/validate-public.yml`, `scripts/ci/validation_policy.py`
  and `scripts/ci/validation.py`: the existing `Validation` check and evidence
  machinery. Follow `SDLC.md`, `PLANS.md` and the PR template.

Existing contributor docs remain authoring references. Do not publish their whole
tree, plans, source files or review evidence. Broader documentation cleanup,
feature guides, custom styling, search and translations stay deferred.

## Progress

- [x] Inspect the spec, task source, documentation boundaries and CI selector.
- [x] Draft two implementation phases and separate publication gates.
- [x] Owner accepted the resolved specification/tooling/plan through `implement`.
- [x] Implementation authorized; issues #279, #280 and #281 published/read back.
- [x] Phase 1: independent four-page site/output guards/CI checks pass bounded review.
- [ ] Phase 2: first-run and browser evidence, reviewed publication preparation.
- [ ] Rendered-content acceptance, authorized publication and canonical checks.
- [ ] Final integration review, final-candidate owner merge approval and handoff.

## Surprises & Discoveries

- There is no existing docs generator or publishing workflow to preserve.
- The current selector reduces only modified eligible `docs/**/*.md` files.
  New files, package manifests, lockfiles, TypeScript and Python/JavaScript
  tooling select `full`. A read-only classification probe on Python 3.12
  confirmed these cases. The host's default Python was too old for this helper;
  use the repository's supported Python 3.12 toolchain for CI-policy checks.
- Even `full` currently installs/builds only the application's frontend; it does
  not validate an independent `docs/user` package. Add its checks to the existing
  workflow during implementation, including future Markdown-only changes.
- The official VitePress stable docs are 1.6.4; the main docs currently describe
  a 2.0 alpha. Its built-in 1.6.4 preview calls `listen(port)` without a loopback
  address, so the proposed local preview uses an explicit loopback static server.

## Decision Log

| Date       | Actor/status   | Decision and rationale                                                                                                                                         |
| ---------- | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-10-05 | Owner decision | Include minimal docs in the initial delivery; unavailable destinations show “Coming soon” until verified.                                                      |
| 2026-10-05 | Agent proposal | Independent `docs/user` package, VitePress 1.6.4 default theme, four reader pages; a separate source directory prevents publishing maintainer material.        |
| 2026-10-05 | Agent proposal | Manual Pages Direct Upload of reviewed output; builds and CI never publish or require Cloudflare credentials. This preserves approval of each external action. |

## Phased implementation

### Phase 1: Build the selected site and validate its output

Requirements: the spec's four-page content, standalone build, static delivery,
availability handling, publication allowlist and basic navigation. Dependency:
accepted spec/plan and authorization for this phase. Owning issue: [#279](https://github.com/raymond-van/animama/issues/279);
phase issue: [#280](https://github.com/raymond-van/animama/issues/280). Starting source:
`f90c080fc343a159cb9d7f9059a35127f871c021` plus the reviewed planning artifacts.

1. Follow `workspace-setup`: inspect remote/base/status, publish and read back the
   accepted public-safe spec in its owning Animama issue, and create/reuse this
   phase's issue. Preserve concurrent edits. Do not expose private coordination
   records. Keep `docs/minimal-user-docs` and one plan PR.
2. Add an independent package at `docs/user/`, its own `package.json` and
   `pnpm-lock.yaml`, and narrow ignores for generated dependencies/cache/output.
   Proposed pins are VitePress 1.6.4 and http-server 14.1.1; verify compatibility
   and lock their resolved dependencies at implementation. Reuse the maintained
   CI Node/pnpm pins, currently Node 24.15.0 and pnpm 10.33.0, rather than adding
   a separate toolchain policy. No application imports, sibling inputs, backend,
   provider keys or external content fetching are allowed for the site build.
3. Use `.vitepress/config.mts` with `srcDir: './pages'`, base `/`, clean URLs,
   strict dead-link handling and the default theme. Author only
   `pages/index.md`, `desktop.md`, `self-host.md` and `troubleshooting.md`.
   Keep package-maintainer instructions outside `pages/`. Any static public
   assets must be explicitly selected inside this site's source root. Inspect
   generated output rather than trusting the source-directory setting alone.
4. Prepare short guidance from the references above; check current implementation
   where needed. Preserve release/source-access caveats, no bundled offline chat
   model, accountless ownership, opt-in speech and non-destructive recovery.
   Use literal reviewed external links only after anonymous destination
   verification; otherwise render “Coming soon” as text without a dummy href.
   Build/CI must never probe canonical external sites to decide availability.
5. Add a small read-only `check` script that verifies generated page/asset
   inventory, internal targets/anchors and unavailable entries without enabled
   links. It must reject plans, maintainer/source files, symlinks and source maps
   in publication output. Use the generator's own broken-link check and avoid
   tests that simply assert every prose sentence. Add only behavior fixtures
   needed to prove a failure detected by newly authored tooling.
6. Extend the existing `Validation` workflow to install, build and check
   `docs/user` using its frozen lock for `full` and `docs` profiles. Include
   Node/pnpm setup for that docs work while leaving application installs under
   their existing conditions. Register the required command receipts in the
   existing evidence machinery and test that contract. Preserve conservative
   classification of added files and executable/config/lock changes as `full`;
   do not label new tooling as docs-only or create a second workflow matrix.
   There are no workflow edits during planning.

The following interfaces are implemented. From the
repository root:

```bash
pnpm --dir docs/user install --frozen-lockfile
pnpm --dir docs/user build
pnpm --dir docs/user check
pnpm --dir docs/user preview
```

`build` runs `vitepress build .`; output is `docs/user/.vitepress/dist`.
`check` examines that output after a successful build. Proposed `preview` runs
the locked `http-server .vitepress/dist -a 127.0.0.1 -p 4175 -c-1 -e html -d false`.
Check the port first; a collision must fail, not stop another preview. Preview
serves only output and needs no provider/account. Verify its routing/404 behavior
and report its actual origin; it is not proof of Cloudflare serving behavior.
The stable generator supports a separate source directory and output root;
pin APIs against the [1.6.4 configuration reference](https://vuejs.github.io/vitepress/v1/reference/site-config).
The preview flags come from [http-server's maintained usage](https://github.com/http-party/http-server/blob/master/README.md).

Meaningful checks and expected evidence:

- Fresh frozen docs install, successful build/check, and inventory showing the
  four reader pages, `404.html` and required static assets only. A build copied
  outside the repository must serve without source/application access.
- `git diff --check`; CI-policy/evidence tests through the supported Python:
  `python3.12 -m unittest discover -s scripts/ci -p 'test_*.py' -v`.
  Record executable/version and results. Run applicable read-only format/lint
  checks for any tooling changed, plus repository-required local pre-push checks;
  fix failures before pushing. New tooling/workflow changes retain hosted full
  validation and cannot use the local-first reduction exemption.
- Record actual hosted `Validation` profile/run separately; it must execute the
  new docs commands. Application checks in that workflow do not substitute for
  docs output checks, and docs checks do not establish native installer readiness.

Complete when the site is independently buildable, content is ready for rendered
review, its publication inventory is checked, and required checks/independent
phase review pass. Publication and owner content acceptance remain pending.

Phase commit proposal: `feat(docs)[p1]: add the minimal user documentation site`.
Issue: #280. Reviewed base: `f90c080fc343a159cb9d7f9059a35127f871c021` plus
intended docs/site/CI/guide/planning files; no unrelated changes. Node 24.15.0,
pnpm 10.33.0, Python 3.12. Initial guard/CI tests failed for intended missing
behavior; implementation passed six guards and 96 CI-policy/evidence tests.
D1-01 root-symlink regression failed before repair, then passed: seven guards.
Frozen install (task-local pnpm store), docs build/check/format and scoped guide
format/Git/Ruff checks pass. Output: five HTML pages, 33 files, 105 links.
Preview contract: loopback-only 4175, clean routes 200, unknown/asset directory
404; preview stopped. Reader prose/configuration uses source/artifact checks,
not sentence-matching tests. No application source or dependencies changed;
full hosted selection remains required for new tooling/workflow files.
Independent targeted Review #2 passes. Commit pending; actual hosted CI pending push.

#### Code Review #1 Findings

Initial independent analysis and read-only checks completed on 2026-10-05.
D1-01 (P2), `docs/user/scripts/check-site.mjs`: the checker rejected child symlinks
but followed a symlink at the publication root, violating the output boundary.
A temporary linked root passed the real build check. Other analysis/checks had
no actionable findings; existing workflow YAML format style is unchanged.

#### Code Review #1 Revisions

D1-01 accepted and reproduced with a failing root-symlink fixture. The checker
now inspects the root with `lstat` and requires an ordinary directory. Seven
behavior tests, actual output check and docs formatting pass. Repair rounds used:
1 of 2. Independent targeted Review #2 rejected symlink and regular-file roots;
ordinary output still passes. No regression findings or prose-matching tests.

### Phase 2: Verify instructions and prepare publication

Requirements: the spec's fresh self-host evidence, browser/keyboard/layout checks,
no-JavaScript readability, safe publication and destination verification.
Dependencies: Phase 1 checks/review passed and authorization for Phase 2. Phase
issue: [#281](https://github.com/raymond-van/animama/issues/281), blocked by #280. Starting source: Phase 1's recorded reviewed commit.

1. Test the built docs at the loopback preview using desktop first (1440×900),
   then a narrow viewport (390×844). Visit each route directly, reload, follow
   nav/anchors, test an unknown route, use keyboard focus/navigation and inspect
   code-block overflow and contrast. Repeat direct visits with JavaScript
   disabled: core prose and ordinary links must remain readable. Check requests,
   cookies and storage for absent hosted API/session/tracking integration;
   distinguish harmless default-theme appearance preference from identity state.
   Use existing browser tools for this small manual acceptance scope; avoid
   introducing a general browser-test platform just for four pages.
2. Perform one meaningful fresh built self-host journey using
   `animama-local-stacks` and the assigned worktree. Read its skill and current
   preparation guide; inspect LFS hydration, active stack labels/mounts and free
   ports before starting. Select a previously unused task-only project and
   disjoint data roots. Never purge or borrow shared state as a setup step.
   Keep the generated task stack record ignored. With a supported clean
   environment, a free base port and that distinct record, the existing interface
   is:

    ```bash
    git lfs pull
    ANIMAMA_WEB_BUILD_MODE=production ./reset.sh --name docs-first-run --base-port <FREE_BASE_PORT> --stack-env-file .animama-docs-first-run.env
    source .animama-docs-first-run.env
    docker compose -p "$COMPOSE_PROJECT_NAME" ps
    ```

    The angle-bracket value is a resolved setup input, not a literal command.
    Record the actual project, source, environment, built-mode URL, image build
    and model readiness. Use external owner-only credentials only if needed;
    neither logs nor evidence may contain them. Test the reader's documented
    built-startup steps, Welcome/AI/Voice setup, starter readiness and arrival in
    the app. Verify only the application port is published on loopback and all
    infrastructure remains private. Confirm storage/backup guidance against the
    generated task roots. A restart must preserve the new task installation;
    this does not require restoring any data. Optional missing speech should
    show the documented unavailable state and never trigger an automatic download.
    No paid request or speech acquisition is necessary for setup verification.
    A successful real chat, physical microphone test or model download needs its
    own supplied inputs/authorization; report those checks as unperformed if so.

3. Correct only proven inaccuracies in the selected pages and rerun affected
   docs checks/browser steps. Missing LFS or service/environment failures are
   separate from documentation defects. If repair is needed, follow supported
   bootstrap/readiness recovery; preserve task data and never repair by resetting
   another installation. If a genuine application defect prevents the documented
   journey, record it and the blocked acceptance rather than silently widening
   this docs implementation into an application fix.
4. Prepare one reviewable draft PR with local/browser/first-run/CI evidence,
   unperformed native/provider checks and rendered pages for owner content
   review. Keep the PR open through any approved publication/backlink updates.
   Exact-candidate content approval may authorize an unmerged source for upload;
   it does not authorize merge. Update the final source/evidence after changes.
5. Prepare the publication record below. Independently verify public product
   home/download readiness when supplied. If live, enable those canonical docs
   backlinks on this same branch, rebuild, rerun affected checks and obtain
   rendered-content approval for that candidate. Otherwise retain “Coming soon”.
   Local cross-site checks may substitute explicit loopback targets inside test
   fixtures; they must not change canonical production links or require another
   checkout to build this site. Publication can wait without losing local work.

Complete the implementation phase when source-based instructions have meaningful
fresh-start evidence, browser checks pass, supported findings are resolved and a
content-review/publication-ready candidate is recorded. Actual provider actions,
canonical acceptance and exact-candidate merge remain separate gates.

Phase commit proposal: `docs(docs)[p2]: verify first-run guidance and prepare publication`.
Issue / commit / first-run source and environment / browser evidence / hosted
evidence / unperformed checks: pending.

#### Code Review #1 Findings

Not run. Review source claims, first-run evidence, standalone output, browser
acceptance and publication preparation at the recorded source. Identify supported
findings with stable IDs; owner content preference remains an explicit human gate.

#### Code Review #1 Revisions

Not run. Record dispositions, targeted fixes and fresh evidence. Repair rounds
used: 0 of 2. Preserve the count if destination activation changes this scope.

## Publication and owner gates

Proposed method: manual Cloudflare Pages Direct Upload of exactly
`docs/user/.vitepress/dist`. No Git integration, auto-deploy hook, deployment CI
or source upload is planned. Direct Upload cannot later switch to Git integration
without a new project; owner review of that tradeoff precedes project creation.
See [Cloudflare Direct Upload](https://developers.cloudflare.com/pages/get-started/direct-upload/).

Before requesting any mutation, complete unaffected local work and read-only
inventory: existing account/project mode, project-name collisions, docs-domain/DNS
state and any current deployment. Proposed project name is `animama-docs` with
production branch `main`; resolve actual identity before presenting a command.
Choose and record a reviewed exact Wrangler version; run its local help to check
syntax. Do not run `@latest`, place tokens in the plan, or implicitly create a
project by using deploy. No provider credentials belong in the site package/CI.

Present each concrete action and its intended effect separately for explicit
approval. Examples below are **future gate templates**, not runnable/currently
authorized operations; replace all placeholders with reviewed inputs:

```text
<PINNED_WRANGLER> pages project create <APPROVED_PROJECT> --production-branch main
<PINNED_WRANGLER> pages deploy docs/user/.vitepress/dist --project-name <APPROVED_PROJECT> --branch <APPROVED_BRANCH> --commit-hash <APPROVED_SOURCE_SHA>
```

Preview upload is publication too. For production, use the project's recorded
production branch explicitly even if the approved source is on the task branch.
Record output inventory/digest, source SHA, toolchain, content approval,
deployment ID/URL and exact approved action. A changed build requires fresh
candidate review. The CLI documents
[project-create and deploy arguments](https://developers.cloudflare.com/workers/wrangler/commands/pages/).

Associating `docs.animama.ai` with that Pages project is another explicit gate.
Present the exact custom-domain operation and any DNS changes it triggers before
execution; do not merely write a CNAME. Cloudflare requires Pages domain
association, and its managed-zone flow may add DNS automatically. Inventory and
preserve existing records; namespace/access/source-visibility changes need their
own authority. See [Pages custom domains](https://developers.cloudflare.com/pages/configuration/custom-domains/).

After an approved upload/domain action, perform anonymous HTTPS checks for `/`,
`/desktop`, `/self-host`, `/troubleshooting`, assets, direct reloads and a genuine 404. Confirm readable content, absence of account/private-repository requirements
and correct backlinks. Local preview success is not canonical deployment success;
Pages' extensionless routing and top-level 404 behavior need provider evidence.
See [Pages serving behavior](https://developers.cloudflare.com/pages/configuration/serving-pages/).

Keep the docs PR open until any approved backlink activation is validated.
Record canonical docs readiness for external consumers to enable their Docs link
only after verification. That external update is outside this repository's plan.
Refresh final integration evidence before requesting owner approval to merge the
exact final head with the ordinary merge method. Merge/content approval does not
authorize further uploads, DNS changes or new projects.

## Final integration review

Perform one independent full initial review of the combined docs/site/tooling and
accepted outcome at the current source; reuse still-valid phase evidence.
Publication-triggered backlink edits get targeted review and affected checks;
do not restart the review budget or repeat unchanged passing checks.

### Code Review #1 Findings

Not run. Record baseline/head, combined acceptance, stable findings, remaining
owner/publication gates and actual `Validation` profile/result.

### Code Review #1 Revisions

Not run. Record verified dispositions and resulting evidence. Repair rounds used:
0 of 2 for final integration. Stop automatic progression if supported blockers
remain after two repairs. Agent readiness does not establish owner acceptance.

## Validation and acceptance

Keep distinct records for exact-source local build/output checks, browser/keyboard
and no-JavaScript evidence, isolated first-run evidence, hosted CI, rendered
content approval, provider actions and canonical HTTPS results. Do not promote
pending/unperformed results to passing or call a draft accepted.

Use the PR template's single source reference:
`Validated revision: <short SHA> · baseline: <short SHA>` with commit links and
dirty-state disclosure when relevant. Link phase issues, the owning spec issue
and this plan at its reviewed revision. Record limitations, branch/worktree
identity, any task stack/preview URL and retained resources. Exact final merge
approval must identify the current candidate and actual required checks.

## Idempotence and recovery

Frozen installs/builds are repeatable and affect only task-local dependencies,
cache and output. Rebuild after source changes; never deploy stale output or
upload the repository root. Stop only preview processes created by this task.

For first-run services, source the trusted task-specific record before
project-scoped commands. Inspect task labels, mounts/consumers and ignored data
before cleanup; preserve evidence and useful state, stop only that named project,
and follow the existing task-stack cleanup guide. Do not purge by default, restore
shared data, remove shared model stores or prune global Docker/Git resources.

After an uncertain Pages action, inspect its outcome before retrying: do not
create a duplicate project or upload a different candidate. Preserve the previous
deployment identity, reviewed output and pre-change DNS values. If publication
fails, retain the local build and report canonical acceptance pending. Rollback,
redeploy, DNS restoration and project/domain deletion each require an explicitly
approved concrete action; no automatic deletion or global cache purge is planned.

## Outcomes & Retrospective

2026-10-05: plan drafted from the proposed scope. No site files, workflow changes,
phase issues, commits, services, uploads, DNS actions or public acceptance have
been delivered by this planning step. Record delivered behavior, remaining gates,
follow-up scope and lessons here as execution proceeds.

2026-10-05: implementation authorized; owning public spec published/read back
and native phase issues #280/#281 established. Worktree/branch/base verified;
no provider action or merge is authorized.
