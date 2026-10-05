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

`site-links.json` records reviewed readiness for the fixed product home and
download URLs. It starts with both unavailable. Keep “Coming soon” as ordinary
text until anonymous verification and content review authorize a literal link;
change the readiness record and affected pages together. A readiness flag is a
reviewed assertion, not a network probe or publication approval.

Before publication, review the rendered pages and run the output check at the
exact candidate. Only `.vitepress/dist` is an upload input. Pages creation,
uploads, custom-domain association, DNS changes and merge each need their own
recorded owner approval. Local output checks do not establish release acceptance
or live-site availability. See the [execution plan](../plans/user-docs-site/user-docs-site-execplan.md)
for browser, fresh-start and publication evidence requirements.
