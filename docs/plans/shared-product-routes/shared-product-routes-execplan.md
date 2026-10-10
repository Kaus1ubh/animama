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

- [x] Phase 1: foundations (package, principal move, route inventory, ports, owner
  fix, test harness). Implemented 2026-10-10 in `2e9a02ee` (inventory), `bda5ead5`
  (principal), `2110ad13` (ports), `62f95626` (owner-strict) and `5580c4ec`
  (harness and consumer), with review repairs through `5ed515b2`. The full local
  validation passed on `908e02d5`; the final targeted Code Review #3 passed.
- [x] Phase 2: thin owner-scoped routers. Implemented 2026-10-10: repository ports
  (`940eedd2`), chats (`f1344a45`), memory (`9028884e`), settings (`846acdd5`
  characterization, then `7a18efa6`), profile (`afa396b9`), safety (`91487685`),
  loadouts (`6c155b42`) and runtime capabilities (`b1e6f4d2`). `33870c72` checks
  that the package serves exactly the 45 stage-2 routes. Each family migrated its
  tests in its own commit, so no re-export shims were needed. Review repairs in
  `35c12694`, `9bb0b98f` and `6e8891bf`; `make check-test` passed on `6e8891bf`,
  and the targeted Code Review #2 passed.
- [ ] Phase 3: content routers. Not started.
- [ ] Final integration review and PR. Not started.

## Surprises & Discoveries

Static analysis of `main` at `42d38faf` (2026-10-09), not yet confirmed by running
the app. It still holds at `5993bbee`: the routers, application contracts and
runtime capabilities did not change between the two.

- 200 router routes in `src/backend/animama/server/routers/` plus 5 app-level
  routes (`/health`, `/_desktop/health`, `/_desktop/runtime:quiesce`,
  `/api/telemetry/{signal}` and the asset catch-all), all of which stay local.
  Running the app (2026-10-10), one entry per method: development serves 200,
  including `/health` and the telemetry route. A web root (built and desktop runs)
  adds the GET/HEAD asset catch-all as the last route (202), and desktop credentials
  add four `/_desktop/` routes (206). The inventory classifies all 206: 149 shared
  (45 in stage 2, 84 in stage 3, 19 in stage 4, 1 in stage 5), 36 withheld from
  hosted, 21 local.
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
- Implementation (2026-10-10): the generated SDK carries each handler's docstring
  as its JSDoc, so moved handlers keep their docstrings verbatim. Loadout plan
  routes are POSTs that never write.
- #284 deferred P3-01 (shared package services call synchronous stage ports on the
  event loop) and P3-04 (an unused bounded speech service) to this work.

## Decision Log

- 2026-10-10, agent (implementation):
  - Ports grow with the families. Phase 1 defines `ProductPorts` with read and
    write sessions and the install/503 mechanism. Policy limits, profiles, safety
    resources, settings events and content services are added when their family
    moves, so no port exists without a caller.
  - Write sessions are FastAPI function-scoped (floor raised to 0.121), so a
    consumer's deferred commit completes before the response. Local write sessions
    still commit immediately.
  - Disposition mapping follows the permission table in `contracts/hosted-web.md`.
    Runtime context and bootstrap, owner events, model custody, archive, starter
    provisioning, health, telemetry and the asset catch-all stay local; runtime
    capabilities are shared, as #379 lists them; the desktop controls are withheld
    by `native_features`.
  - The owner-strict fix covers the Anima and Anima-settings routes. Archive, chat
    setup and speech keep their checks until their stages move.
  - Phase 2: handlers take the owner's repositories from
    `ProductPorts.repositories(session)`. The bundle also carries the Anima loadout
    service, which works on the session directly.
  - The display-name edit goes through `update_display_name`. The local ports keep
    installation personalization (the owner's profile memory) and report first-run
    and owner refusals as `ProductRefusal`; reads use the shared repository.
  - Safety preferences load through the user-settings repository in the app layer;
    the crisis table comes from `crisis_resources()`, so an operator-supplied table
    stays the composition's choice.
  - Loadout plans take read sessions because they never write; commits keep write
    sessions.
  - Runtime capabilities: the route asks `runtime_capabilities(session, principal)`.
    The local report moved unchanged to `server/runtime_capabilities.py`; the test
    doubles report the hosted contract.
  - Local-app tests that need a shared route's local behaviour install the local
    ports on their session (`install_local_ports`); the rest use `SessionPorts`.
  - Shared handlers take `repositories`, `policy` or `ports` instead of `session`,
    so direct-call tests pass an explicit bundle
    (`SQLAlchemyProductRepositories(session)`, `TEST_POLICY`). HTTP parameters,
    handler names, operation IDs and the SDK are unchanged, which is what #439's
    "keep its handler names and parameters" protects.
  - The memory-file limit comes from `ProductPolicy`; the local ports read it from
    the app's runtime settings, the same value the global settings held in every
    production entrypoint. User-settings writes report `user_settings_changed`
    after requesting their commit, and the local ports wake the embedding refresh.

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
safety (move its response models into `app/contracts`); loadouts; runtime
capabilities, which #379 lists as shared, behind a capabilities port. For each family:

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
When they move, `server/elevenlabs_service.py` and `server/routers/chat/turn_setup.py`
must drop their nullable-owner checks, as the Phase 1 Anima routes did.

### Phase 1 review record

Code Review #1 Findings (at `6ea88582`):

- P1-01: the inventory and parity test left out the GET/HEAD asset catch-all that
  built and desktop runtimes add as their last route.
- P1-02: session ports took no owner, and a session could open before the principal
  resolved.
- P1-03: `DeferredCommitPorts` committed work the handler never asked to commit.
- P1-04: `access` was derived from the HTTP method; four entries were wrong.
- P1-05: the backend guide, architecture overview, development guide and boundary
  README did not mention the package or its consumer.
- P1-06: runtime capabilities were classified local, but #379 lists them as shared.
- Optional: O-01 classify every capability boolean; O-02 drop the unused re-export and
  alias; O-03 a typed install helper; O-04 run the consumer in-repo and widen it;
  O-05 snapshot operation IDs; O-06 NULL-owner cases for the other Anima routes;
  O-07 record the stage 4/5 owner fixes; O-08 note the write-session constraints.

Code Review #1 Revisions:

- P1-01: the inventory lists the catch-all with a `web_root_only` flag, and the parity
  test covers development, built and desktop apps, one entry per method, with the
  catch-all last.
- P1-02: sessions depend on the principal, and the ports receive it; tests prove no
  session opens without a principal.
- P1-03: the double commits only when asked and documents its limits.
- P1-04: corrected three entries (`get_runtime_json_bundle` to `bytes`, the chat
  and memory-file searches to `read`); `stream_anima_runtime_file` stays `bytes`
  because it serves verified file bytes under the caching policy.
  `access` is provisional until a family moves; a test then binds `read` and
  `write` to the handler's session.
- P1-05: documented the package and consumer.
- P1-06: runtime capabilities are shared in stage 2, behind a capabilities port.
- O-01 to O-04 and O-07 are applied.
- O-05: `pnpm openapi-ts:check` already fails on any operation-ID change.
- O-06: the Phase 2 and 3 isolation tests cover every shared route that takes an
  Anima.
- O-08 is recorded here: a request-scoped `yield` dependency cannot depend on
  `WriteSession` (FastAPI raises `DependencyScopeError`); the write session closes
  before a streaming body runs; and a handler using both sessions opens two.
- Commits: `1ab1d23e` (P1-01, P1-04, P1-06, O-01), `6e6b29de` (P1-02, P1-03, O-02,
  O-03), `264da08d` (O-04) and `908e02d5` (P1-05, O-07, O-08).

Code Review #2 Findings (targeted, at `908e02d5`):

- R2-01: issue #439 did not list the runtime-capabilities family the plan added.
- R2-02: this record claimed four corrected entries, cited no revision commits or
  validation, and Progress still said the review was pending.
- R2-03: the development guide still named only `animama.domain` and `animama.app`
  as the wheel's reusable APIs.

Code Review #2 Revisions:

- R2-01: #439 lists runtime capabilities, behind a capabilities port.
- R2-02: this record and Progress are corrected, with commits and validation below.
- R2-03: the development guide names `animama.product_http` (`5ed515b2`).
- Validation on `908e02d5`: `scripts/ci/local_validate.py --profile full` against
  baseline `5993bbee` passed every step, including backend-full, frontend-source,
  browser-smoke, package-build, isolated-consumers (the installed-wheel product
  consumer among them), baseline-build and compatibility. Review checks also passed:
  the boundary checker, ruff, mypy and the Phase 1 test files.
- Repair rounds used: 2 of 2.

Code Review #3 (final, targeted, at `e9dda06d`): R2-01 to R2-03 are resolved and
the repairs introduced no regression. Result: pass.

### Phase 2 review record

Code Review #1 Findings (at `e9dda06d`):

- P2-01 (blocking): the two-owner and deferred-commit tests exercised 3 of the 14
  loadout routes; the memory test lacked a cross-owner create and never checked
  that the repair commits through the composition.
- P2-02 (blocking): the Memory Manager guide's route map still placed the episode
  listing in `server/routers/memory_manager.py`.
- Optional: O-01 the port dependencies were synchronous, so FastAPI ran them in its
  threadpool; O-02 `memory.py` defined handlers after `__all__` and aliased
  `status`; O-03 two copies of the Anima owner check; O-04 the local ports read
  runtime settings two ways; O-05 nothing checked that the shared repository bundle
  imports no local code; O-06 the consumer check compared the routers with
  themselves; O-07 record the handler-parameter, policy and settings-event
  decisions; O-08 contributor docs did not mention the shared package; O-09 read
  sessions in the test double could write unnoticed; O-10 a per-principal policy;
  O-11 the two port doubles repeated five methods.

Code Review #1 Revisions:

- P2-01: every loadout plan and commit route refuses another owner's Anima with 404
  `anima_not_found` and commits nothing, and every family commits once through the
  composition; the memory test adds a cross-owner create and list and checks the
  repair's commit.
- P2-02: the guide lists the shared episode route, and the manager module's
  docstring names its own routes.
- O-01 to O-06, O-08, O-09 and O-11 are applied. The read-session guard confirmed
  that every loadout plan is read-only. `SERVED_STAGES` in the inventory names the
  stages the package serves, and the consumer asserts that the mounted routes equal
  them.
- O-07 is recorded in the Decision Log.
- O-10 rejected: the memory-file limit is the composition's, not the owner's; a
  per-owner limit can add the principal when one exists.
- Commits: `35c12694` (O-01 to O-06, O-09, O-11), `9bb0b98f` (P2-01) and `6e8891bf`
  (P2-02, O-07, O-08 and this record).
- Validation: `make check-test` passed on `e9dda06d` (3,574 passed, 10 skipped) and
  on `6e8891bf` (3,578 passed, 10 skipped). For each family and again after the
  repairs: ruff, mypy, the boundary checker, the product HTTP and migrated suites,
  the in-repo installed-wheel consumer and `pnpm openapi-ts:check` (no SDK diff).
- Repair rounds used: 1 of 2.

Code Review #2 (targeted, at `6e8891bf`): P2-01 and P2-02 are resolved, and the
applied optional items changed no behaviour. Its non-blocking notes (the backend
README's description of `server/routers/`, this record's commits and validation,
`__all__` in `memory.py`, a note that synchronous port members run on the event
loop, and response bodies in the memory refusals) are applied. Result: pass.

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
