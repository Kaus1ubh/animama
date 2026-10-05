# User documentation site

This independent package publishes only the four reader pages in `pages/` and
VitePress's required static assets. Contributor documentation and delivery plans
are authoring references, not site inputs. No application build, running stack,
other checkout or provider account is needed.

Use Node 24.15.0 and pnpm 10.33.0, matching repository CI. From the repository root:

```bash
pnpm --dir docs/user install --frozen-lockfile
pnpm --dir docs/user test
pnpm --dir docs/user build
pnpm --dir docs/user check
pnpm --dir docs/user format:check
pnpm --dir docs/user preview
```

The preview binds to `127.0.0.1:4175`, serves clean URLs, disables directory
listings and has no provider access. Check that the port is free before starting;
do not stop an unrelated process. Stop your preview with Ctrl-C.

`check` audits `.vitepress/dist` without network requests or modifying output.
It rejects extra pages, source/plans, source maps, symlinks, broken internal
targets, remote runtime assets and unverified external navigation. Behavior
fixtures test those failures. The existing `Validation` workflow installs,
tests, builds and checks this package for its `docs` and `full` profiles.
Executable/configuration/lock changes and new files still require full validation.

`site-links.json` records reviewed readiness for `https://animama.ai/` and
`https://animama.ai/download`. Both destinations are verified and linked; a live
download page does not establish installer availability. Keep “Coming soon” for
unavailable installers. Change the readiness record and affected pages together
and rerun build/check. A readiness flag is a reviewed assertion, not a network
probe or publication approval.

## Publication readiness

Only `.vitepress/dist` is an upload input. Obtain owner acceptance of the rendered
content at the recorded source SHA, then record the checked output inventory,
SHA-256 digest and toolchain. Changed source or output needs fresh review.

Cloudflare's cookie-free Web Analytics/RUM may be injected by the provider on
`docs.animama.ai`. Advertising and cross-site trackers, hosted API/session
integration and application cookies remain prohibited. Keep source builds free
of embedded analytics scripts or credentials; verify actual provider injection
and privacy behavior separately on the canonical site after approved publication.

First inventory the account, existing Pages projects/deployments and domain/DNS
state read-only. Resolve the proposed `animama-docs` name and Direct Upload mode.
Direct Upload projects cannot later switch to Git integration without a new
project. Keep operator credentials outside this package and CI.

Each command below is a separate approval template. Create only if the reviewed
inventory confirms the project does not exist; never let deploy create it implicitly:

```text
pnpm dlx wrangler@4.147.0 pages project create <APPROVED_PROJECT> --production-branch main
```

After separate approval, upload the exact reviewed output:

```text
pnpm dlx wrangler@4.147.0 pages deploy docs/user/.vitepress/dist --project-name <APPROVED_PROJECT> --branch main --commit-hash <APPROVED_SOURCE_SHA> --commit-dirty=false
```

`main` selects production even when the approved source remains on the task
branch. Preview uploads also require approval. Present custom-domain association
and every DNS effect separately before acting; Pages association can create a
managed-zone record. Preserve existing DNS and previous deployment identity.

After approved publication, anonymously verify HTTPS `/`, `/desktop`,
`/self-host`, `/troubleshooting`, required assets and an unknown-route 404.
Record deployment identity and results. Local checks do not establish live-site
availability or native release acceptance. See the
[execution plan](../plans/user-docs-site/user-docs-site-execplan.md) for remaining
verification and approval gates.
