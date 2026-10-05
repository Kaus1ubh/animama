# Minimal Animama user documentation site

Status: Published snapshot, 2026-10-05.
Authority: [issue #279](https://github.com/raymond-van/animama/issues/279), captured
at its 2026-10-05T17:40:54Z revision. The issue is authoritative.
Owner decision: the 2026-10-05 `implement` invocation authorizes the resolved
specification and both implementation phases, including standalone VitePress
1.6.4 and explicit loopback preview. Rendered-content acceptance, publication
and exact-candidate merge remain separate gates.

## Problem and intended users

New desktop and self-host users need a short public guide to installation, first
setup and common problems. Existing documentation primarily serves contributors
and operators, and there is no user docs publishing site or generator configured.
Make a small useful entrypoint without turning the existing docs tree into a
public site or requiring a full documentation rewrite.

## Goals, scope and non-goals

Build and publish a static user documentation site at
`https://docs.animama.ai/`, from content and build configuration owned entirely
by this repository. The public site must build without any other checkout.

Include four short pages: Overview, Desktop getting started, Self-host quick start,
and Troubleshooting. Retain existing contributor/architecture docs and use them
as source references when preparing these pages. Publish the selected reader
pages and required site assets only; exclude plans, contributor guides, source
code, evidence directories and private information from the output.

Defer comprehensive feature documentation, the broader writing/styling cleanup,
custom themes, search, translations and Cloud usage instructions. Do not include
Cloud infrastructure, account operations or private service implementation.
Publishing desktop releases and making the source repository public are separate
decisions; this site must not assume either has happened.

## Required behavior

### Initial navigation and content

| Page                    | Minimum useful content                                                                                                                                                                                                                          |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Overview                | Explain the AI avatar companion, define Anima/Avatar briefly, distinguish the local desktop app from self-hosting, and direct readers to the two getting-started pages and desktop download entry.                                              |
| Desktop getting started | State installer availability and supported macOS/Windows targets; explain installation and the Welcome/AI/Voice setup flow, accountless local ownership, an external provider or local model-server requirement, and optional speech downloads. |
| Self-host quick start   | State required source access, Docker Compose, Git LFS and Python prerequisites; cover asset hydration, built-mode startup, the loopback application URL, provider configuration and optional speech, with a brief data/backup note.             |
| Troubleshooting         | Cover startup retry/logs, AI provider or local-server connectivity, microphone/speech problems, where local data lives, and safe support information. Keep destructive recovery out of the default steps.                                       |

The desktop guide must make clear that there is no bundled offline chat model;
offline speech does not make a remote chat provider work offline. Distinguish
the local installation owner from an Animama Cloud account.

The self-host quick start targets an existing source checkout on the reader's
own machine. If source acquisition is not publicly available, say so explicitly
and show “Coming soon” for a public source/download entry rather than linking
to an inaccessible repository. Do not invent a container registry distribution.
Document the supported built startup, currently
`ANIMAMA_WEB_BUILD_MODE=production ./reset.sh`, separately from development HMR.
Include `git lfs pull` and preserve PostgreSQL/data rather than recommending a
purge as setup or troubleshooting. Remote access requires an operator-owned TLS
and authentication boundary; this initial guide must not direct readers to
publish the local application or database ports to the Internet.

Use existing implementation/documentation as the content basis:

- [Product and source startup](../../../README.md).
- [Desktop installation](../../frontend/desktop/installation.md) and
  [troubleshooting](../../frontend/desktop/troubleshooting.md).
- [Self-host operations](../../backend/operations/development.md),
  [model assets](../../backend/operations/model-assets.md),
  [local model servers](../../backend/operations/local-models.md), and
  [model settings](../../frontend/features/model-settings.md).

These are authoring references, not automatically published pages. Check selected
instructions against the current source and validate the actual first-run flow
before claiming it works. Do not copy private planning history into reader docs.

### Site and destination behavior

Pages have clear titles, shared navigation, working internal links, readable
code blocks and a useful 404. Direct links and reloads work in production output.
Core prose and ordinary links remain readable without JavaScript.

Link to `https://animama.ai/download` and the product home only after those
destinations are verified. An unavailable external destination shows “Coming soon”
without a dummy href. Do not link to repository-only guides unless their anonymous
access is verified; include the needed short instructions in the published page
instead. Preview checks may use explicit local targets without representing them
as live canonical sites.

Current desktop documents report no signed public release. Preserve accurate
availability messaging until an approved installer is publicly verified; build
tooling or an HTTP 200 response alone does not establish release acceptance.

## Constraints

- Content and site build remain in Animama, independent of private source,
  backend services, Cloud artifacts and provider credentials.
- Cloudflare Pages serves static output outside the app's authenticated origin.
  Add no hosted API calls, account/session integration, application cookies,
  analytics or third-party tracking.
- Keep build dependencies locked. With them installed, local build and preview
  require no Cloudflare account, application stack or external content fetch.
- Use semantic headings, accessible navigation, keyboard focus and readable
  contrast. Check desktop and narrow layouts; code blocks must not widen the page.
- Content publication is deliberate. Owner review of rendered content and explicit
  approval of each Pages/DNS action, with exact commands/provider actions presented
  beforehand, remain separate from code review and merge.

## Acceptance criteria

- [ ] The owner has reviewed the specification and rendered reader content.
- [ ] The four pages and 404 build reproducibly from this repository alone and
      pass local link and accessibility checks.
- [ ] Desktop target, availability, setup, model and speech statements match current
      documented/source behavior and identify unverified release acceptance.
- [ ] The self-host instructions pass a meaningful fresh-start check using an
      isolated environment; record exact source/environment and limitations.
      Preserve the loopback and data boundaries.
- [ ] Navigation, direct visits, reloads and keyboard use work at desktop and narrow
      viewports; no enabled link depends on unavailable private repository access.
- [ ] Inspect output and browser traffic to confirm the publication allowlist,
      absence of private material, and absence of hosted API/session integration.
- [ ] Following explicit publication approval, the canonical HTTPS docs pages render.
      Record public deployment evidence separately from local preview evidence.

## Open questions and decisions

Accepted implementation default: put the selected Markdown content and an independent
docs build under `docs/user/`, using a pinned stable VitePress release and its
default theme. No generator exists to preserve. VitePress provides a Markdown
[static documentation generator](https://vitepress.dev/guide/what-is-vitepress)
and documents [Cloudflare Pages deployment](https://vitepress.dev/guide/deploy#platform-guides).
The generator and four-page outline are accepted defaults for this delivery. Detailed dependency versions and build commands belong in execution.

No additional product question blocks implementation. Destination availability and
fresh-start evidence are implementation/publication checks, not assumptions.

## Spec

The authoritative [owning issue](https://github.com/raymond-van/animama/issues/279)
is captured above. Public issue content must remain
self-contained and must not require private records or a sibling checkout.

## ExecPlan

[Execution plan](user-docs-site-execplan.md), accepted for execution on 2026-10-05. It covers the docs build, selected content, verification and separately
approved publication; implementation is underway.

## Delivery links

- Owning Animama issue: [#279](https://github.com/raymond-van/animama/issues/279).
  Phases: [#280](https://github.com/raymond-van/animama/issues/280) and
  [#281](https://github.com/raymond-van/animama/issues/281). PR pending.
- Task branch: `docs/minimal-user-docs`, starting revision
  `f90c080fc343a159cb9d7f9059a35127f871c021`. No stack was started.
