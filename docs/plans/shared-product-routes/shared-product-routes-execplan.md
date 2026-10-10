# Share product HTTP routes between compositions

Source agreement: [issue #379](https://github.com/raymond-van/animama/issues/379)
(opened 2026-10-09 at the owner's request) and the owner's dated instruction of
2026-10-09: write the ExecPlan and ADR, then implement stages 1–3.
Authorized scope: Phases 1–3 (issue stages 1–3); the owner approved the plan on 2026-10-10.
Stages 4 (paid utilities) and 5 (chat streaming) are described for orientation
only and are not authorized.

## Purpose and context

Since [#284](https://github.com/raymond-van/animama/pull/284) the local and hosted
compositions serve one React build and must answer the same `/v1` API. The hosted
consumer reuses Animama's services but re-implements every product route, so
behaviour drifts (about 25 differences at the last audit) and each new endpoint
needs a hosted twin. The outcome: product routes live once in a shared HTTP
package that each composition mounts with its own adapters
([ADR 0021](../../adr/0021-shared-product-http-routes.md), accepted). Self-hosted
and desktop behaviour, the public OpenAPI operations and the generated SDK stay
unchanged.

This repository owns the shared package, the local composition and their tests.
The hosted consumer adopts each stage in its own repository and plan; nothing here
imports or depends on Cloud code. Relevant boundaries:
[repository boundaries](../../architecture/repository-boundaries.md),
[hosted contract](../../../contracts/hosted-web.md),
[backend guide](../../../src/backend/AGENTS.md).

Working directory: a task worktree on branch `refactor/shared-product-routes`,
started from `main` at `42d38faf` and rebased onto `5993bbee` (rebase again before
implementation). Planning needs no stack; Phase 3 runs the browser journeys on a
named built stack.

## Progress

- [ ] Phase 1: foundations (package, principal move, route inventory, ports, owner
  fix, test harness). In progress since 2026-10-10.
- [ ] Phase 2: thin owner-scoped routers. Not started.
- [ ] Phase 3: content routers. Not started.
- [ ] Final integration review and PR. Not started.

## Surprises & Discoveries

Static analysis of `main` at `42d38faf` (2026-10-09), not yet confirmed by running
the app. It still holds at `5993bbee`: the routers, application contracts and
runtime capabilities did not change between the two.

- 200 router routes in `src/backend/animama/server/routers/` plus 5 app-level
  routes (`/health`, `/_desktop/health`, `/_desktop/runtime:quiesce`,
  `/api/telemetry/{signal}` and the asset catch-all), all of which stay local.
- Handlers are coupled to the local composition: they construct repositories per
  request (chats, settings, avatar, Anima CRUD), build `FilesystemContentStore`
  (content, typed content, runtime), read the global `settings` object (memory
  entries' file limit, safety, packages) and, for content and runtime, create
  local directories during a request through `initialize_local_runtime`.
  `content_packages.py` and `anima.py` import `animama.logging_config`, which
  shared code may not import.
- Ten nullable-owner checks (`user_id is not None and user_id != principal`), for
  example `anima.py` get/patch/delete (while list filters strictly), three in
  `settings.py`, plus `archive.py`, `chat/turn_setup.py` and
  `elevenlabs_service.py`. Two similar checks in content catalog code are
  intentional (an unbound store means installation scope).
- Tests: 28 overrides of `get_async_session` and 40 of `get_current_principal`
  outside `conftest.py` (the 68 the issue cites); about 320 tests call handlers
  directly with `session=` and `user=`; 17 files set `app.state.local_runtime_paths`
  and 7 set `runtime_settings` on bare apps; two tests monkeypatch router internals.
  There is no multi-owner HTTP composition yet, and settings routes have no HTTP
  tests.
- `tests/test_local_app_composition.py` requires every `/v1` route to depend on
  `get_current_principal` by identity, and SDK function names come from FastAPI's
  default operation IDs (handler name, path and method), so handler names and
  paths are part of the public contract.
- Route order matters: `/v1/animas/creation-options` (local-only) must match before
  `/v1/animas/{anima_id}`.
- #284 deferred P3-01 (shared package services call synchronous stage ports on the
  event loop) and P3-04 (an unused bounded speech service) to this work.

## Decision Log

- 2026-10-09, owner: share product routes; write the ExecPlan and ADR; implement
  stages 1–3; the hosted consumer's C7 acceptance follows.
- 2026-10-09, agent proposal (for owner review): the package is
  `animama.product_http`; ports are one typed `ProductPorts` object; write sessions
  keep commit authority with the composition. See ADR 0021.
- 2026-10-10, owner: approved this plan, ADR 0021 and all five proposed defaults
  below. Implementation of Phases 1–3 may start.
- Owner-approved defaults (2026-10-10; the question, then the decision in brackets):
  1. Anima CRUD routes are not named in #379 [Phase 3, with content].
  2. Model catalog reads (`/v1/model-providers`, `/v1/model-roles`), memory-manager
     run routes and ElevenLabs voice routes [stage 4, because they need model or
     speech ports].
  3. Archive routes have no web caller [stay local-only].
  4. Local content responses send `private, no-cache` without HEAD or Range;
     hosted sends `private, no-store` with both [keep each composition's byte
     delivery policy behind a port; no local behaviour change].
  5. Model-role preferences are stored without validation locally but rejected
     with `model_role_unavailable` in hosted [validate through a model-catalog port
     in stage 4; Phase 2 keeps local behaviour].

## Phased implementation

### Phase 1: Foundations

Requirements: #379 stage 1. Issue: [#438](https://github.com/raymond-van/animama/issues/438).
Starting source: latest `main`.

Changes, each as a separate commit with its tests:

1. **Guards first.** Add `animama/product_http/inventory.py`: one `RouteSpec`
   (method, path, handler name, disposition shared/local/hosted-excluded, stage,
   access class, excluding capability) per route. Tests: the inventory equals the
   ordered route table of `create_local_app`; it agrees with
   `contracts/runtime-capabilities/hosted.json` in both directions (every false
   permission gates at least one excluded route, no shared route is gated by a
   false permission); a route-order snapshot keeps
   `/v1/animas/creation-options` before `/v1/animas/{anima_id}`. All pass on the
   unchanged app; `pnpm openapi-ts:check` stays clean.
2. **Package and principal.** Create `animama.product_http` and move the principal
   resolver protocol and dependency there; `server/deps.py` re-exports the same
   objects so overrides and the composition test keep working. Add the package to
   the shared prefixes of `scripts/repository-boundary/check-python-imports.py`.
3. **Ports.** Define `ProductPorts` (owner read/write sessions with
   composition-owned commit, product policy and limits, profiles, safety resources,
   settings-change events, and a content factory returning catalog, save, typed,
   face-part, package and transition services plus a byte-delivery policy). Add
   `LocalProductPorts` in the local composition, installed by `create_local_app`
   without IO; a missing ports object answers 503 `product_ports_unavailable`.
   If the write port needs FastAPI's function-scoped dependencies, raise the
   `fastapi` floor in `pyproject.toml` accordingly.
4. **Owner-strict visibility.** Tests first: an Anima, setting or chat whose owner
   is not the caller (including a NULL owner) is not found on every shared route;
   then remove the nullable-owner exceptions from routes that become shared.
5. **Test harness.** A bare-app builder that installs ports; a two-owner test
   composition (one database, separate temporary roots, a test-only resolver); a
   deferred-commit session double that mimics consumer commit authority; and an
   installed-wheel consumer (registered with `check-packed-artifacts.py`) that
   mounts the shared routers with local imports blocked, checks the 503 without
   ports and checks inventory parity.

Checks: `make check-test`, the boundary checker, `pnpm openapi-ts:check` (no SDK
diff), the new inventory/consumer tests. Completion: all pass and Code Review #1
for the phase passes within its bound.

### Phase 2: Thin owner-scoped routers

Requirements: #379 stage 2. Issue: [#439](https://github.com/raymond-van/animama/issues/439).
One family per commit, in this order: chats; memory
entries and episodes; settings (add HTTP characterization tests first); profile;
safety (move its response models into `app/contracts`); loadouts. For each family:

- move the routes to `product_http/routes/`, resolving collaborators from the ports;
  keep a temporary re-export in `server/routers/` until its tests migrate;
- migrate that family's session overrides and monkeypatches to the ports object in
  the same commit;
- add two-owner isolation and deferred-commit tests for every route.

Checks per family: its suites, a zero SDK diff, an unchanged route snapshot, the
boundary checker and the installed-wheel consumer. Completion: all families moved,
shims for migrated tests removed, Code Review #1 for the phase passes.

### Phase 3: Content routers

Requirements: #379 stage 3. Issue: [#440](https://github.com/raymond-van/animama/issues/440).
Steps:

1. Content ports: route content construction through the package facade, remove
   request-time directory creation and fix P3-01 (synchronous stage ports run off
   the event loop).
2. Catalog, items, files and previews, with a shared byte-delivery helper that
   keeps each composition's caching policy.
3. Typed content, portrait and face parts.
4. Packages: share the custom package route class, move the package request and
   status models into `app/contracts`, use `animama.logging`.
5. Avatars, moved onto the repository.
6. Anima runtime; then Anima CRUD (subject to open question 1).

Checks: the Phase 2 checks, two-owner isolation for content, runtime and package
stages, and the full `pnpm e2e:test` on a built stack (required for content,
package and Anima changes). Completion: all pass and Code Review #1 for the phase
passes.

### Not authorized: stages 4 and 5

Stage 4 (voice catalogs, speech, web search, model catalog reads, memory-manager
runs) and stage 5 (chat SSE with a turn-guard port, which fixes the hosted
emotional-state and phoneme drift) need separate authorization after Phase 3.

## Final integration review

After Phase 3: one final review of combined acceptance (unchanged local behaviour,
complete route inventory, isolation, SDK stability), reusing valid phase evidence.

## Validation and acceptance

From the repository root: `uv run ruff check`, `make check-test`, the boundary
commands. From `src/frontend`: `pnpm openapi-ts:check`, `pnpm check`,
`pnpm web:test`, and the full `pnpm e2e:test` on a disposable built stack before
merge. Acceptance (from #379): shared routes have one implementation; inventory and
capability contract agree by test; shared routes pass against the local and a
two-owner composition; no shared handler constructs repositories or stores or reads
global settings; self-hosted and desktop behaviour unchanged; docs, ADR 0021 and
`contracts/hosted-web.md` describe the boundary. Hosted adoption is verified in the
consumer's own plan.

## Idempotence and recovery

Each commit keeps the app releasable: moved routes keep their paths, names and
operation IDs, and temporary re-exports keep tests running until migrated. Reverting
a family's commit restores its previous module. No data or schema changes are
planned; if one becomes necessary, it follows the baseline-only migration rule.

## Outcomes & Retrospective

Not started.
