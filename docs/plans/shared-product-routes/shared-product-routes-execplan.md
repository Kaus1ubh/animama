# Share product HTTP routes between compositions

Source agreement: [issue #379](https://github.com/raymond-van/animama/issues/379)
(opened 2026-10-09 at the owner's request), the owner's dated instruction of
2026-10-09 (write the ExecPlan and ADR, then implement stages 1–3) and the owner's
instruction of 2026-10-10 to continue with stages 4 and 5 once this plan's Phase 4
and Phase 5 sections are approved.
Authorized scope: Phases 1–3 (issue stages 1–3), approved 2026-10-10 and delivered
in #429; Phases 4 (paid utilities) and 5 (chat streaming), approved by the owner on
2026-10-10 with the four proposed defaults in the Decision Log.

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

Working directory: Phases 1–3 used a task worktree on branch
`refactor/shared-product-routes`, started from `main` at `42d38faf` and rebased onto
`5993bbee`. Phases 4 and 5 use a new task worktree on branch
`refactor/share-utility-and-chat-routes`, started from `main` at `1ef26b35` (after
#441, #427 and #408 merged). Planning needs no stack; Phases 3 and 5 run the browser
journeys on a named built stack.

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
- [x] Phase 3: content routers. Implemented 2026-10-10: P3-01 (`e4e999af`), the
  content port and byte delivery (`55abd1fb`), content (`a2c4f2a8`), typed content
  (`749beeb5`), packages (`38e0dd40`), Avatars (`a2a91a74`), the Anima runtime
  (`20902271`) and Anima CRUD (`2eaa20e1`); `5f20fbac` mounts all 84 stage-3 routes
  from `ROUTERS` and serves stages 2 and 3. Review repairs in `3604a3fb`, `4d16a25f`
  and the review-record commit; the targeted Code Review #2 passed. Phase checks
  and the full browser journeys on the final candidate are recorded below.
- [x] Final integration review. Its blocking finding is repaired in `213d45f9`,
  whose full local validation passed, and the targeted recheck passed.
- [x] PR #429 merged on 2026-10-10 as `d42eaad9` (ordinary merge commit), after one
  owner-approved full hosted `Validation` run (38082652779, passed). Phase issues
  #438–#440 are closed; #379 stays open for stages 4 and 5.
- [x] Phase 4: paid utilities and catalog reads (18 shared routes; audio isolation
  stays local-only), issue #451. Implemented 2026-10-10 in `0c620591`, `d619b69b`,
  `316c4a8c`, `22f1aa77` and `56b24c0b`; review repairs in `4f4b78c3`.
  `make check-test` passed on `4f4b78c3` and the targeted Code Review #2 passed.
- [x] Phase 5: chat streaming with the chat-turn guard, issue #452. Approved
  2026-10-10. Implemented 2026-10-10: golden transcripts on the unchanged route
  (`3d6dac82`), the move with the guard and stage 5 served (`6061c74a`), guard and
  two-owner tests (`abb956d1`) and docs (`10fbc91f`); review repairs in `1785ef1a`
  and the Code Review #2 note in `69aebcc2`. Code Review #2 (targeted) passed.
- [ ] Final integration review of Phases 4 and 5: review #1 (FI4-01 to FI4-05) is
  repaired in `ed58bca4` and `9bb10549`; the recheck's FI4-03 and FI4-06 in
  `be8e337c`, its final verification is pending.

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
  hosted, 21 local. (After the owner kept audio isolation local in Phase 4: 148
  shared with 18 in stage 4, 36 withheld and 22 local.)
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
- Phase 3: the SDK is ordered by path, so moving a local route within its family
  changes no generated file. Runtime issuance persists a lease, runtime JSON
  bundles and member streaming record drifted files for rescan, package operation
  status can finish an interrupted publication, and content-evidence resolution
  only reads. Local content mutations request several commits (journal steps); a
  deferring composition completes them once, when the write session ends. Local-only
  upload routes (voice catalogs, a stage-4 family, and user files) still resolve
  their staging directory with `initialize_local_runtime` per request.
- #284 deferred P3-01 (shared package services call synchronous stage ports on the
  event loop) and P3-04 (an unused bounded speech service) to this work.

Stages 4 and 5, static analysis of `main` at `1ef26b35` (2026-10-10), after #441
(Particle and Scene effects), #427 (licensed comedy sounds) and #408 (Anthropic
models, which changed chat, compaction and the Memory Manager):

- The inventory still lists 19 stage-4 routes and one stage-5 route; the local app
  serves them from `server/routers/anima.py` (voice-catalog uploads and chat SSE),
  `elevenlabs.py`, `model_provider.py`, `model_configuration.py` (model roles) and
  `memory_manager.py`.
- Couplings: every handler builds SQLAlchemy repositories or ORM queries
  (`avatar_uploads`, `session.get(ORMAnima)`); the Memory Manager and chat read the
  global `settings` and `ANIMAMA_LLM_SKIP`, build credential resolvers and resolve
  model roles through `ModelRoleSettings.for_app(app)`; the voice-catalog upload and
  finalize routes call `initialize_local_runtime` per request (it creates
  directories); the speech helpers read the process credential store, a module-level
  semaphore and a voice-access cache; chat imports `animama.logging_config`, the
  app's session factory and model-client registry, local web-search settings and the
  embeddings-role embedder.
- Chat SSE spans `server/routers/chat/` (about 2,500 lines across nine modules),
  `server/sse_events.py` (frame formatting, emotional-state persistence),
  `server/gruut_text.py` (phonemes), `server/chat_options.py` and parts of
  `server/elevenlabs_service.py` (TTS sessions and finalized speech).
- Two nullable-owner checks remain on these routes: `turn_setup.py` (chat setup) and
  `elevenlabs_service.resolve_anima_elevenlabs_voice` (chat TTS voice).
- Tests: `test_anima_chat_sse.py` (4,759 lines) and eight other chat suites
  monkeypatch about 40 module-level names in `server/routers/chat/*` and
  `server/routers/anima.py`, and replace the app's session factory with fakes.
- Route order: `GET /v1/model-providers` sits between the shared runtime and
  runtime-capability routes, while `GET /v1/model-roles` follows the local model
  configuration routes. `get_model_roles` carries the `model-configuration` tag and
  the speech routes the `elevenlabs` tag; operation tags are part of the OpenAPI
  document.
- What a hosted turn needs from the guard, per the hosted contract and #379: reserve
  before any write or paid work (idempotent by run ID), release when setup fails,
  recheck the owner's session lease while the turn streams, and settle once, even
  after a disconnect. Its denials have their own bodies (`quota_exceeded`,
  `chat_limit_reached`, `message_too_long`, …), so a consumer renders them through
  its own exception handlers; nested model, search, title, compaction and speech
  work reserves before dispatch, and error frames must not expose provider detail.

Phase 5, during implementation (2026-10-10):

- Starlette cancels a streaming body through anyio when the client leaves, and anyio
  re-cancels every later await in that task. The chat stream's `finally` cleanup
  could therefore be cut short, so the title, speech and model tasks it cancelled
  could still be running when the response ended. Settling a lease "after every
  task stopped" needed that cleanup shielded.
- A cancellation landing while the reply was being saved could abort the save, or
  surface after the commit so the turn looked unsaved. The guard tests' stop after
  the save found it, and found that a stop during streaming with the reply already
  saved reached the completion-frame helper before its definition.
- The local route checked the model-client registry before the Anima. The registry
  is now a turn collaborator (`chat_turn`), so a missing registry answers 503 after
  the owner and runtime checks and after admission.
- Title and compaction settings were read from the process settings; they now come
  from the composition's chat policy, locally the app's runtime settings (the same
  values in every production entrypoint). Title generation only reads, so it runs
  on a read session and saves the title in its own write session.
- Dead code went with the move: `stream_finalized_tts_frames`,
  `prepare_finalized_tts_stream` and `resolve_anima_elevenlabs_voice`, and the
  unused emotion parameters of `resolve_realtime_voice_from_preferences`.
- The planned compaction transcript is not recorded: post-reply compaction emits no
  frames, and the compaction suites cover it.
- Phoneme payloads need gruut, which the wheel's `server` extra installs;
  `app/gruut_text.py` returns no payload without it. It logs the reply text at info
  level (pre-existing), which matters once a hosted composition runs it; a separate
  task removes that.
- The chat suites patched about 40 server internals. They now drive the shared
  handler through test ports; the 67 direct calls keep their shape through a test
  wrapper that opens the handler's write session, and the suites keep all 78 tests.
- FastAPI ends function-scoped dependencies after the handler returns and before it
  runs the response. A composition whose commit of the setup session fails there
  discards the response, so settling only in the response left such a turn's lease
  held (P5R-01).

## Decision Log

- 2026-10-10, owner: after #429, continue #379 with stages 4 and 5 from current
  `main` on a new branch; extend this plan with Phase 4 and Phase 5 sections and
  approve them before implementation; keep local behaviour, status codes, bodies,
  operation IDs, the sorted OpenAPI document and the SDK unchanged; no hosted
  `Validation` run, merge or package promotion without the owner's approval.
- 2026-10-10, owner: approved the Phase 4 and Phase 5 sections at `2358264f`,
  including the four defaults below. Phase issues: #451 (Phase 4), #452 (Phase 5).
- 2026-10-10, owner: ElevenLabs audio isolation is not needed in the shared
  package. No client calls `POST /v1/elevenlabs/audio-isolation` (only the generated
  SDK exports it). Removing it would change the OpenAPI document, which the
  package-set compatibility check treats as structural (local-http 5.0.0,
  runtime-contracts 0.5.0, a new major for consumers to admit), so the owner chose to
  keep it local-only: the inventory classifies it `local`, no contract changes, and
  stage 4 has 18 shared routes.
- Proposed defaults for Phases 4 and 5, approved by the owner on 2026-10-10 (the
  question, then the decision in brackets):
  1. How owner default 5 (model-role validation) is applied [shared settings writes
     run the hosted rule, `usable_for_role` over the composition's catalog, when the
     composition's `ModelCatalogPolicy` asks for it; the local policy does not, so
     local writes still store any value].
  2. A composition without ElevenLabs serving the shared speech utilities [it
     refuses through its speech port, for example 503; the routes stay shared, per
     owner default 2].
  3. How often the chat-turn lease is rechecked [at every 50 ms drain poll while the
     model streams and before every frame and step after the reply; an in-flight
     title, compaction or TTS-session call is not interrupted mid-call, so a
     consumer's lease-bound collaborators recheck at dispatch. The local stream is
     not restructured into a producer and consumer].
  4. Error text in chat error frames [a composition's chat policy may replace error
     text with fixed copy and codes outside a safe pattern with a generic code; the
     local policy keeps today's text and codes].
- 2026-10-10, agent (Phase 5 implementation):
  - Setup runs on the handler's function-scoped write session, so a composition
    settles setup writes (a new chat) before the body runs. Stream work (recording,
    episodes, memory tools, the AI notice state, emotional state, titles,
    compaction and voice lookups) opens short-lived owner sessions through the ports
    (`TurnSessions`).
  - A refused admission returns no lease, so only admitted turns settle; `unstarted`
    means admitted with nothing dispatched (this section's guard contract said
    "refused or failed setup").
  - The outcome is read when the lease settles: a saved reply completes the turn
    whatever later optional work did. A reply save that has begun finishes even if
    the turn is cancelled. The stream's cleanup and the settlement each run shielded,
    bounded at five seconds.
  - Chat speech joins `ProductSpeech` (`realtime_session`, `prepare_finalized`,
    `stream_finalized`). The turn passes a voice resolver that looks up the caller's
    Anima voice, owner-strict, in a short read session; the composition calls it
    after its own checks, which keeps the local order of the key, model, voice and
    access checks.
  - `ProductRepositories` gains chat compactions, user-file processing,
    companion-safety state and runtime snapshots, and the Anima repository gains
    `stored_emotional_state` and an owner-checked `record_emotional_state`.
  - The error-text policy of default 4 is `ChatTurnPolicy.public_error_text`. It
    covers `error` frames; speech error frames carry the speech port's own
    messages, which a hosted speech port uses for its denial copy.
  - A stop cancels the turn's background title and speech tasks rather than letting
    an in-flight call finish, as default 3 and this section's risk text expected;
    only compaction, which runs inline, finishes a call in flight (P5R-06). The
    composition's collaborators still recheck their own reservations at dispatch.

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
  - Phase 3: `ProductPorts.content(session, principal)` yields a per-request
    `ProductContent` bundle (catalog, save, typed, face-part, package and runtime
    services and the content store) built only from runtime paths startup
    prepared, and `file_response` delivers verified bytes under the composition's
    caching policy (local: revalidated by ETag or never stored; no Range or HEAD).
    Read content stays open through streamed bodies; write content ends with its
    session. A runtime member that drifted is recorded in a separate write session.
  - Access classes now match behaviour: runtime issuance and package operation
    status are `write`, content evidence is `read`. The runtime JSON bundle takes
    write content because a read can record drift.
  - Avatar queries moved into the Avatar repository (with a domain
    `AvatarNameConflictError`) and the owner's content catalog; Anima CRUD uses the
    Anima, chat-profile, presentation and model-catalog repositories. The shared
    Anima routes mount before the local voice and chat routes, and the local Rescan
    after the shared content routes.
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

### Phase 4: Paid utilities and catalog reads

Gate: stages 4 and 5 needed separate authorization after Phase 3; the owner
approved this section and Phase 5 on 2026-10-10.

Requirements: #379 stage 4, the inventory routes marked stage 4: voice-catalog
uploads (4); ElevenLabs voice cloning, text-to-speech and sound effects (3);
`GET /v1/model-providers` and `GET /v1/model-roles` (2); Memory Manager runs and
approvals (9). Audio isolation stays local-only (owner, 2026-10-10).
Owner default 5 (model-role validation through the model-catalog port) also lands
here. Issue: [#451](https://github.com/raymond-van/animama/issues/451). Starting
source: `main` at `1ef26b35`.

New ports, each added with its family. `LocalProductPorts` implements them from
today's local collaborators; the doubles in `tests/product_http_support.py` implement
them for the two-owner and deferred-commit compositions.

- **Model catalog.** `model_catalog_policy` (the composition's `ModelCatalogPolicy`),
  `model_roles(session)` (a `ModelRoleResolver` over the composition's catalog, user
  settings and operator defaults) and `embedding_refresh_status(session, principal,
  embedding_model_id)`. `EmbeddingRefreshStatus` and its states move to the app
  layer; the local port still reports the app's refresh worker.
- **Memory Manager.** `memory_manager(session, principal)` returns the owner's
  Memory Manager service. The local port keeps today's runtime selection
  (`ANIMAMA_LLM_SKIP`, the OpenAI Agents and Anthropic runtimes, credentials, base
  URL, timeouts); a consumer can wrap each operation with its own admission. The
  shared routes keep the request and response mapping, the error mapping and the
  owner's time zone for Reflection.
- **Speech.** `speech`, a protocol for voice cloning, text-to-speech and sound
  effects, plus the audio upload limit. The local port delegates to
  `server/elevenlabs_service.py`, where credentials, retries, the concurrency
  semaphore and the voice-access cache stay. Phase 5 adds the chat TTS operations.
- **Voice-catalog uploads.** An owner-scoped upload repository on
  `ProductRepositories` (today's `avatar_uploads` queries), the composition's
  `PrivateFileStorage` and upload staging directory (prepared at startup), and the
  size limit and expiry in `ProductPolicy`. Finalize moves into an app service over
  the Phase 3 content services, so no request creates a directory.

Steps, one family per commit with its tests migrated in the same commit, as in
Phases 2 and 3:

1. Model catalog reads. `GET /v1/model-roles` moves beside `GET /v1/model-providers`
   in the shared router (no overlapping paths; the OpenAPI document is sorted and the
   SDK ordered by path, so neither changes), and keeps its `model-configuration` tag.
   Then owner default 5: when the composition's policy asks for it, shared settings
   writes refuse a role preference naming a row that cannot do that role with 422
   `{"code": "model_role_unavailable"}`; the local policy does not ask, so local
   writes are unchanged.
2. Memory Manager runs and approvals.
3. ElevenLabs utilities, keeping the `elevenlabs` tag and today's error bodies;
   audio isolation stays in the local router, after the shared three.
4. Voice-catalog uploads, with request-time directory creation removed.
5. `SERVED_STAGES` becomes `{2, 3, 4}`; the consumer and inventory tests pin the 147
   served routes and the `ROUTERS` order.

Checks per family: its suites; two-owner isolation and deferred-commit tests for
every route (another owner's upload, run, approval or Anima is not found and commits
nothing; owner writes commit once through the composition); the read-session guard
for the GET routes; `pnpm openapi-ts:check` with no SDK diff; the OpenAPI document
unchanged; ruff, mypy, the boundary checker and the in-repo installed-wheel
consumer. Access classes are bound
as each family moves (P1-04): the three speech utilities open no session, so their
class is corrected to match.

Risks and mitigations:

- The Memory Manager GET routes build the whole service, including role resolution;
  the read-session guard shows whether they ever write, and their access changes if
  they do.
- The speech helpers' process-wide state (semaphore, voice-access cache keyed by
  credential generation) must stay in the local adapter, not move into shared code.
- `test_elevenlabs_service.py` and the realtime router tests patch
  `server.elevenlabs_service` internals; they keep testing the local adapter, while
  the route tests use a fake speech port.

Completion: the 18 routes are served from `product_http`, audio isolation is
local-only, owner default 5 is applied,
the checks pass and Code Review #1 for the phase passes within its bound.

### Phase 5: Chat streaming

Requirements: #379 stage 5. `POST /v1/animas/{anima_id}/chat:sse` is served from the
shared package with a chat-turn guard port that the local composition implements as
a no-op. The shared route passes the Anima's stored emotional state and emits the
same SSE frames as local, including phoneme payloads.
`server/routers/chat/turn_setup.py` and `server/elevenlabs_service.py` drop their
nullable-owner checks. Issue: [#452](https://github.com/raymond-van/animama/issues/452).
Depends on Phase 4 (model-role and speech ports).

The chat-turn guard (proposed contract):

- `admit_chat_turn(principal, admission)` returns a `ChatTurnLease`. The route calls
  it after the owner and runtime-revision checks and before any write or paid work
  (setup may create the chat). `admission` carries the Anima, run and chat IDs and
  the parsed request. A composition refuses with its own exceptions (rendered by its
  exception handlers) or a `ProductRefusal`; the local guard admits every turn.
- `lease.check()` returns a `ChatTurnStop` or `None`. The route awaits it at every
  50 ms drain poll while the model streams and before every frame and step after the
  reply (default 3). A stop before the reply is saved cancels the turn's tasks and
  emits an `error` frame with the stop's code and message, then `run.completed`;
  after the reply is saved it skips the remaining optional work and emits
  `run.completed` alone.
- `lease.settle(outcome)` runs exactly once, after every turn task has stopped and
  shielded from cancellation, with `unstarted` (refused or failed setup),
  `completed`, `failed` or `interrupted` (disconnect or a stop).
- The turn's paid collaborators come from `chat_turn(principal, lease)`: the
  model-client registry, the web-search tool, the attachment embedder and the speech
  operations, so a composition can bind them to its reservation. Locally they are
  today's collaborators.

Other ports: a `ChatTurnPolicy` (compaction, title generation and pre-send compaction
settings, the operator safety configuration and the error-text policy of default 4);
stream-time persistence (turn and episode recording, memory tools, the AI notice
state, emotional-state updates, titles and compaction) opens short-lived sessions
through `write_session(principal)` instead of the app's session factory; and
`ProductRepositories` gains what those need (chat compactions, user-file processing,
companion-safety state, runtime snapshots and an owner-scoped emotional-state
update).

Steps, each commit keeping the app releasable:

1. Characterization first: golden SSE transcripts of representative local turns,
   recorded on the unchanged route with a scripted model client: a reply with
   emotion, gesture and memory frames; phoneme payloads with TTS speech enabled;
   realtime and finalized ElevenLabs TTS; a generated title and post-reply
   compaction; the AI notice and the crisis card; an app-layer error; a client
   disconnect (frames sent and tasks stopped). Later steps must reproduce them byte
   for byte.
2. Move the frame formatting (`server/sse_events.py`), gruut phonemization
   (`server/gruut_text.py`), chat option resolution, emotional-state persistence and
   the chat modules (`server/routers/chat/*`) into the shared package, taking their
   collaborators from ports. Logger names may change (O-08).
3. Owner-strict setup: an Anima whose owner is not the caller, including a NULL
   owner, is not found. Chat TTS voice resolution moves to shared code on the
   repositories and becomes owner-strict, so the nullable check in
   `elevenlabs_service.py` goes.
4. The guard: the no-op local guard, and a test guard that refuses, stops before and
   after the reply is saved, and records exactly one settlement for every outcome,
   including a disconnect and a setup failure.
5. Mount the shared route in `ROUTERS` (after the Anima and voice-catalog routes, in
   inventory order), retarget the chat suites' patches of `server.routers.chat`
   internals to test ports, and set `SERVED_STAGES` to `{2, 3, 4, 5}` (148 routes).

Checks: the Phase 4 checks; the golden transcripts unchanged; two-owner isolation for
the chat route (another owner's Anima, chat and runtime revision); deferred-commit
settlement of setup writes; and the full `pnpm e2e:test` on a named built stack,
because chat is the core product loop.

Risks and mitigations:

- Behaviour density: retargeting about 40 patched names could hide a behaviour
  change; the golden transcripts gate every step.
- Session lifetime: setup's one session (closed before the stream) and the factory
  sessions of stream work map to a function-scoped write session and
  `write_session`; chat creation must still commit before the stream starts and the
  reply be recorded when the model finishes.
- Cancellation: disconnect, `GeneratorExit` and task cancellation must still stop
  title, TTS and model tasks; settlement adds one shielded await to the stream's
  `finally`.
- Interruption granularity (default 3): an in-flight title, compaction or TTS-session
  call finishes or times out before a stop takes effect.
- Consumer adoption: the hosted reasoning-effort override, server speech transport
  and turn deadlines remain the consumer's work through these ports, recorded as
  limitations like FI-05.

Completion: the route is shared, the golden transcripts and checks pass, both
nullable-owner checks are gone, and Code Review #1 for the phase passes within its
bound.

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

### Phase 3 review record

Browser journeys before review (full `pnpm e2e:test` on a built stack at
`6c1d46a6`): 37 passed, 1 failed. Releasing a package download's lease in a worker
thread let the client's immediate discard run first and answer 409; `3604a3fb`
restored a synchronous release.

Code Review #1 Findings (at `6c1d46a6`, with `3604a3fb` noted):

- P3R-01 (blocking): every content request built a package-stage coordinator,
  whose constructor creates the staging roots, on the event loop.
- P3R-02 (blocking): the runtime manifest and JSON bundle and the package download
  hard-coded the local caching policy instead of using the composition's delivery.
- P3R-03 (blocking): two-owner and deferred-commit tests missed Avatar face-part and
  portrait writes, cross-owner saves, the owner's chat-profile commit and package
  prepare and commit, and one face-part check used a non-Avatar item.
- Optional: O-01 handlers reached through `content.catalog.mutations.catalog`, and
  item reads needed runtime paths; O-02 the runtime drift path built a full content
  bundle; O-03 `PackageRoute` returned errors inside the write session's scope, so a
  composition saw a normal exit; O-04 docs and a docstring omitted content and
  delivery; O-05 the Avatar catalog loads the visible catalog; O-06 other synchronous
  IO remains on the loop (`has_pending`, a download error path); O-07 the package
  test's per-owner roots could not show stage isolation; O-08 logger names changed;
  O-09 inert session overrides; O-10 read routes were not checked against write
  sessions; O-11 shared byte routes are GET only; O-12 three local store builders.
  Outside the range, `3604a3fb` moved the lease release's state write back onto the
  loop.

Code Review #1 Revisions:

- P3R-01: the local ports build one coordinator per runtime layout and pass it to
  the content services; a test removes the staging root and shows content requests
  never recreate it.
- P3R-02: `ProductPorts` gains `json_response` and `download_response`. The local
  policies live in `product_http/delivery.py` (`encoded_json_response`,
  `PackageDownloadResponse`), and the test doubles never let clients store bytes or
  JSON.
- P3R-03: the typed test saves a real Avatar and refuses another owner's face-part
  reads and writes, portraits and saves naming the owner's item; the owner's
  portrait and correction commit through the composition. The Anima test commits a
  chat model; the package test refuses another owner's prepare and commit.
- The download lease is released in the worker thread that reads the last chunk,
  before the client receives it, and on any other exit by the response; a unit test
  pins the order.
- O-01 (item reads use the repositories), O-02, O-03 (`PackageRoute` raises HTTP
  errors, so the write session sees the failure; responses are unchanged), O-04,
  O-07 (a shared-root stage-service test), O-09, O-10, O-11 and O-12 are applied.
- O-05 and O-06 are deferred: the Avatar catalog's output is unchanged and its
  reads are bounded by the owner's visible catalog; the remaining synchronous IO
  predates this plan. O-08 needs no change; nothing filters on logger names.
- Commits: `3604a3fb` (download discard race), `4d16a25f` (P3R-01, P3R-02, P3R-03,
  the download release, O-01 to O-03, O-07, O-09, O-10, O-12) and `905b5f69` (O-04,
  O-11 and this record).
- Validation at `905b5f69`: `make check-test` passed (3,593 passed, 10 skipped);
  the full `pnpm e2e:test` on a built stack passed (38 of 38); ruff, mypy, the
  boundary checker, the installed-wheel consumer and `pnpm openapi-ts:check` (no
  SDK diff) passed.
- Repair rounds used: 1 of 2.

Code Review #2 (targeted, at `905b5f69`): P3R-01 to P3R-03, the download release and
O-03 are resolved; injected leaks fail each new two-owner check. Its non-blocking
notes are applied: a failed lease release no longer truncates a complete download
(it is logged and the stage stays unreclaimed), the content builder's docstring is
corrected, the last inert session overrides and duplicate store builders are gone,
and this record cites its commits and validation. The first content request still
builds the local coordinator, whose roots startup already created. Result: pass.

### Phase 4 review record

Implementation on `refactor/share-utility-and-chat-routes` from `1ef26b35`: model
catalog reads and owner default 5 (`0c620591`), Memory Manager (`d619b69b`),
ElevenLabs utilities (`316c4a8c`), voice-catalog uploads (`22f1aa77`), and serving
stage 4 with the docs (`56b24c0b`). Audio isolation stays local (owner decision).
`make check-test` on `56b24c0b`: 3,892 passed and 24 failed. All 24 failures came
from Git LFS pointer files in this new worktree (Included VRM, sound and SVG content
was not hydrated). After `git lfs checkout` from the local object cache (no
download), the 24 pass. Ruff, mypy, the boundary checker, the installed-wheel
consumer and `pnpm openapi-ts:check` (no SDK diff) passed.

Code Review #1 Findings (at `56b24c0b`; the OpenAPI document is byte-identical to the
baseline export):

- P4R-01 (blocking): the shared spooler created its staging directory on every
  request (`mkdir(parents=True)`), so a removed staging or data root was recreated
  instead of failing closed; the layout test removed only the derivatives root.
- P4R-02 (blocking): the two-owner and deferred-commit test never sent
  `runs:process-episodes`, and covered owner a's message and Reflection writes only
  through owner b's 404s. `d619b69b`'s message overstated the coverage.
- P4R-03 (blocking): a `ProductRefusal` from the speech port, which its docstring
  allows, answered 500; the Memory Manager port named no refusal type.
- P4R-04: role-preference validation ignored the catalog policy, so a row the
  composition does not offer (the built-in Anthropic row under the default policy)
  was accepted.
- P4R-05: the finalize comment claimed cleanup removes bytes left by a failed
  delete; the cleanup worker never selects finalized rows.
- P4R-06: consumer limitations to record (below).
- Optional: O-01 bind the `speech` access class in the inventory test; O-02 no test
  covered `LocalSpeech` passing the caller's ID; O-03 unused upload exports and a
  duplicated type literal; O-04 the upload PUT built the uploads port twice; O-05
  the hosted contract's port list omitted the embedding refresh status.

Code Review #1 Revisions:

- P4R-01: the spooler no longer creates directories; the local uploads port answers
  503 `{"code": "uploads_unavailable"}` when the staging root is missing. The layout
  test removes the staging root and shows that an upload and an initiate are refused
  without recreating it. A spooler unit test shows that a missing directory stays
  missing (the user-files route still prepares its own through
  `initialize_local_runtime`).
- P4R-02: the two-owner test seeds a pending episode and an Anima with an uncovered
  turn. Owner b's `runs:process-episodes` answers 409 and commits nothing; owner a's
  message, episode processing (with its note approved) and Reflection each commit
  once through the composition.
- P4R-03: `refusal_error` turns a `ProductRefusal` into `{"code": code}` with its
  status. The speech, Memory Manager and profile routes use it, and the speech and
  Memory Manager port docstrings name it. Tests cover both a speech refusal and a
  Memory Manager admission refusal.
- P4R-04: validation also refuses a row that `ModelCatalogPolicy.allows` rejects;
  the test adds the Anthropic row.
- P4R-05: the comment states the cleanup worker's actual behaviour.
- P4R-06, recorded as consumer limitations (like FI-05):
  - Under a deferring composition, the Memory Manager's step commits (create the
    run, then its first message; decide, then resume) collapse into one
    transaction. A later failure then discards the run the local app would keep, and
    the model call runs while the earlier step's row locks are held.
  - Voice-catalog finalize deletes the staged bytes before the deferred commit; a
    retry recovers through the rescan.
  - The read-session guard runs the Memory Manager reads with the deterministic
    runtime; that role resolution only reads is shown by inspection.
- O-01 to O-05 are applied.
- Commit: `4f4b78c3`. Validation on `4f4b78c3`: ruff, the format check, mypy, the
  boundary checker, 322 tests across the Phase 4 and migrated suites, and
  `pnpm openapi-ts:check` (no SDK diff) passed; `make check-test` passed (3,920
  passed, 27 skipped) with the LFS content hydrated.
- Repair rounds used: 1 of 2.

Code Review #2 (targeted, at `4f4b78c3`): P4R-01 to P4R-06 and O-01 to O-05 are
resolved, and the OpenAPI export is still byte-identical to the baseline's. Its one
note (R2-01: the hosted contract and the `ProductRefusal` docstring described the
refusal body as `{"code": code}`, where the body is `detail.code`) is applied.
Result: pass.

### Phase 5 review record

Implementation from `e82d5026`: golden transcripts on the unchanged route
(`3d6dac82`), the move with the guard and stage 5 served (`6061c74a`), guard and
two-owner tests (`abb956d1`) and docs (`10fbc91f`). Validation on `10fbc91f`:
`make check-test` passed (3,935 passed, 27 skipped; the two newest guard tests,
added after its collection, passed separately); ruff, mypy over `src` and `tests`,
the boundary checker (0 forbidden edges), the installed-wheel consumer and
`pnpm openapi-ts:check` (SDK current) passed; the OpenAPI export is byte-identical
to `e82d5026`'s; the full `pnpm e2e:test` on the built stack `animama-sharechat`
serving `10fbc91f` passed 40 of 40 (11.3 min).

Code Review #1 Findings (at `10fbc91f`):

- P5R-01 (blocking): a composition's commit of the setup session runs when FastAPI
  ends the function-scoped write session, after the handler returned. If it raised,
  the response never ran and neither settlement path did, so an admitted lease
  stayed held (a scratch probe with a failing deferred commit: no settlement).
- P5R-02: only the recorder's first wait was shielded. A client leaving while the
  stop or error path waited in the unshielded task stop cancelled the model task a
  second time, which aborted a reply save it had begun; those waits were also
  unbounded. A finished task's error was not retrieved when a stop followed it.
- P5R-03: wording: the outcome docstring still named refused turns; the public error
  text covers `error` frames only, not speech error frames; `check()` runs before
  each drained event (not "about every 50 ms"), and frames drained right after the
  model finishes are not checked; "exactly once" depended on P5R-01.
- P5R-04: the disconnect test asserted no running tasks after the request returned,
  not when the lease settled; the save task had no name.
- P5R-05: a finished incognito turn was marked done only after the final drain, so a
  disconnect during that drain settled it `interrupted`.
- P5R-06: a stop cancels background title and speech tasks; record the deviation
  from default 3.
- P5R-07: the previous-text helper belongs in `app/`; `_LeasedStreamingResponse`
  keeps the body twice; the guard tests import helpers from another test module; a
  Responses continuation retry reloads chat context through the setup session's
  chat manager after that session closed (pre-existing).

Code Review #1 Revisions (`1785ef1a`):

- P5R-01: a function-scoped `TurnHold` dependency, declared before the write
  session, holds the admitted lease and settles it `unstarted` when the request
  fails before its response runs, including a failed setup commit; the handler's
  own settlement path is gone. `DeferredCommitPorts.fail_next_commit` makes the next
  deferred commit roll back and raise, and a test shows the turn settles once.
- P5R-02: stopping the turn's tasks is shielded and bounded at every call site, a
  task already cancelling is not cancelled again, and finished tasks are awaited so
  their errors are retrieved.
- P5R-03: the port docstrings, the chat guide and the hosted contract state the
  check points, the public error text's scope (speech error frames carry the speech
  port's messages, which must be browser-safe) and what each outcome covers.
- P5R-04: the recording lease captures the `direct-chat-*` tasks still running when
  it settles, the save task is named `direct-chat-save`, and the stop, save and
  disconnect tests assert none ran.
- P5R-05: a turn is marked finished as soon as its task returns without an error; a
  test covers an incognito turn.
- P5R-06: recorded in the Decision Log.
- P5R-07: the helper moved to `app/voice_emotional_tone.py`; the shared helpers moved
  to `tests/chat_turn_support.py`; `_body` stays as the typed generator
  `aclose()` needs, with a comment; the continuation retry is a recorded
  limitation below.
- Validation on `1785ef1a`: ruff, the format check, mypy over `src` and `tests`, the
  boundary checker and 551 tests across 25 chat-related suites passed; the guard and
  golden suites passed four repeated runs.
- Repair rounds used: 1 of 2.

Code Review #2 (targeted, at `5689fd8f`): P5R-01 to P5R-07 are resolved with no
regressions (the deferred-commit probe now settles `unstarted`; a stop during a
slowed save now settles `completed` with the reply saved). Notes, applied in
`69aebcc2`:

- A save that has begun finishes only within the five-second cleanup bound; the chat
  guide says so.
- A stop landing while the reply was saving ended the stream without draining the
  reply's queued frames, so the client lost them although the reply was saved and
  the turn settled `completed` (hosted only; the local lease never stops). The stop
  path now drains them before `run.completed`, and a test with a slowed save shows
  the reply text arrives (it fails without the fix).

Result: pass.

Validation after Code Review #2: `make check-test` on `5689fd8f` passed (3,939
passed, 27 skipped). A second full `pnpm e2e:test` on `5689fd8f`, on the same stack
without a purge, passed 38 of 40: both content-sharing journeys failed with
`package_stage_limit`, from package stages the first run had left in that stack's
retained data. On `40994a89` (code `69aebcc2`), with the stack purged first:
`make check-test` passed (3,940 passed, 27 skipped), `pnpm openapi-ts:check` passed
(SDK current), the OpenAPI export is byte-identical to the baseline's, and the full
`pnpm e2e:test` passed 40 of 40 (10.7 min).

Limitations for a consumer adopting the chat route (like FI-05):

- A stop takes effect at the next check; work in flight inside the model task (a
  tool call, web search or pre-send compaction) runs until its own await returns or
  is cancelled with the task.
- The Responses continuation retry reads chat context through the setup session's
  chat manager after that session closed, outside the composition's session
  lifecycle (reads only; unchanged behaviour).
- `settle` and the shielded cleanup are each bounded at five seconds; a slower
  settlement is abandoned, so a composition settles quickly (for example by
  enqueueing).
- Speech error frames carry the speech port's exception messages.
- The voice resolver opens one short read session for the first speech segment or
  the realtime session.
- Server speech transport cannot be expressed through the ports yet: `tts.session`
  frames always carry `transport: "direct"`, and the realtime session response has
  no `transport` or `websocket_url`. A composition without provider credentials
  (`provider_credentials: false`) has no realtime speech through the shared route
  until a shared change adds the contract's server descriptor to that response and
  its frame; finalized `eleven_v3` speech streams through the speech port.
- A hosted reasoning-effort override is the composition's model-client registry's
  work (`chat_turn(...).model_clients`, which may rewrite each request's options);
  the shared route passes the owner's options through.
- A turn deadline is a stop the composition's lease returns from `check()` once it
  passes; work in flight follows the first item.
- A client that stops reading holds the stream at its next frame, so `check()` waits
  until it reads again; a stop or disconnect still stops every task, including the
  provider stream, before the lease settles.

## Final integration review

After Phase 3: one final review of combined acceptance (unchanged local behaviour,
complete route inventory, isolation, SDK stability), reusing valid phase evidence.

Final integration review findings (at `3d273329`):

- FI-01 (blocking): the installed-wheel consumer enumerated an app's route list,
  which newer FastAPI releases keep as nested included routers. Installed without
  the lock, as the packed-artifact check installs it, the consumer found no routes
  and failed.
- FI-02: `fastapi[standard]>=0.121` admits those releases. When the lock moves,
  every walk of an app's route list needs the same change: the inventory test, the
  frozen runtime's chat-route check (`runtime/resources.py`) and several route
  assertions in the composition, wiring and router tests.
- FI-03: ADR 0021's Consequences say direct-call tests keep working because handler
  names and parameters are preserved, and that routes stay byte-for-byte
  compatible. Handlers' Python parameters changed (see the Decision Log) and two
  local route-order changes are recorded; HTTP behaviour, operation IDs, the
  OpenAPI document (sorted) and the SDK are unchanged.
- FI-04: the recorded evidence was for `905b5f69`, not the final candidate.
- FI-05: limitations for a consumer adopting `ROUTERS`: it must also install its
  request-principal resolver; its content port decides Anima package admission;
  four streamed routes (`stream_content_file`, `stream_content_preview_file`,
  `stream_anima_runtime_file`, `download_package_export`) hold the request's read
  session until the body ends; deferred commits collapse local journal steps; three
  GET routes take write sessions; `ROUTERS` order was not pinned by a test.
- FI-06: the overview called the local aggregate "shared" and omitted the ports.

Revisions (`213d45f9`):

- FI-01: the consumer enumerates the shared routers' own routes, and a test pins
  `ROUTERS` to the inventory's order (FI-05's last item).
- FI-05: the hosted contract names the resolver and package-admission setup; the
  other items are recorded limitations for the consumer's adoption.
- FI-06: the overview describes the local app's ports and mixed aggregate.
- FI-02 and FI-03 are recorded limitations; the ADR text is left for the owner.
- FI-04: final-candidate evidence:
  - `make check-test` on `3d273329`: 3,594 passed, 10 skipped.
  - Full `pnpm e2e:test` on a built stack serving `3d273329` (the application code
    of `213d45f9`): 37 of 38 passed. `accountless-effect-template-picker` › "Sidebar
    Effects opens the picker in place" failed once (a sidebar menu item still
    visible after 10 s) and passed in three isolated reruns; this branch changes no
    frontend code. A second full run passed 38 of 38.
  - `scripts/ci/local_validate.py --profile full` on `213d45f9` against baseline
    `5993bbee` passed every step, including backend-full, frontend-source,
    browser-smoke, package-build, isolated-consumers (the installed-wheel product
    consumer on FastAPI 0.143.0 and Starlette 1.7.0, FI-01's case), baseline-build
    and compatibility.

Final integration review #2 (targeted, at `939199f3`): FI-01 is resolved (an
independent installed-wheel run on FastAPI 0.143.0 fails with the old consumer and
passes with the new one), FI-04 to FI-06 are resolved, FI-02 and FI-03 are recorded
limitations, and the record matches the retained evidence. Result: pass.

After Phase 5: one final review of Phases 4 and 5 together (unchanged local
behaviour, the complete inventory served, isolation, the guard contract, SDK
stability), reusing valid phase evidence, with its own repair budget.

Final integration review of Phases 4 and 5 (at `40994a89`, baseline `1ef26b35`):
the OpenAPI export is byte-identical, the route tables in all three modes match
apart from handler modules and the planned `GET /v1/model-roles` move, and an
offline-built wheel installed with FastAPI 0.143.0 and Starlette 1.7.0 serves the
148 shared routes with no local imports. Findings:

- FI4-01 (blocking): the API reference still listed `GET /v1/model-roles` among the
  local-only model-configuration routes, contradicting its own router list and the
  inventory.
- FI4-02 (blocking): the three consumer limitations Phase 5's risk text promised
  (reasoning-effort override, server speech transport, turn deadlines) were not
  recorded, and server transport cannot be expressed through the ports.
- FI4-03: a stopped turn whose task waited on a full bridge (a client that stopped
  reading) left the executor's stream open, so its provider stream could outlive
  settlement; checks also wait while the client is not reading.
- FI4-04: a speech port's `ProductRefusal` lost its code in the chat speech frames
  (`tts_session_setup_failed`, `elevenlabs_stream_setup_failed`), so the browser
  could not apply the contract's decline handling.
- FI4-05: plan record items (Phase 5 progress, later evidence, the pre-decision
  inventory counts, the final evidence).

Revisions:

- FI4-01 (`ed58bca4`): the model-role report moved to the shared model catalog
  section; the capability paragraph names only the local routes.
- FI4-02: recorded in the Phase 5 limitations; server transport needs a later shared
  change to the session response and its frame, for the owner to schedule.
- FI4-03 (`9bb10549`): the turn task closes the executor's stream with `aclosing`
  (the stream is typed as the async generator it is); the docs say checks wait
  while a client is not reading. That closed only the outer stream (see the
  recheck below).
- FI4-04 (`9bb10549`): both frames carry a refusal's code (and the session frame its
  status); the port docstring, the chat guide and the hosted contract say how
  speech declines and admission refusals are reported. A test declines realtime and
  finalized speech and fails without the fix.
- FI4-05: applied in this record.
- Validation on `9bb10549`: ruff, the format check, mypy, the boundary checker and
  557 tests across 26 chat-related suites passed.
- Repair rounds used: 1 of 2.

Code Review #2 (targeted, at `710dc516`): FI4-01, FI4-02 and FI4-05 are resolved,
FI4-04 for the two operations it named, and the OpenAPI export is still
byte-identical. Findings:

- FI4-03 (blocking, not resolved): `stream_prepared_turn` delegated to
  `_stream_fitted_turn` with a plain `async for`, and that inner stream owns the
  provider collector and the cleanup that cancels it. Closing the outer stream left
  it suspended, so the collector still ran when the turn's task ended (a repro with
  the real method). The record and comments claimed the guarantee; the test passed
  only because its stand-in put the cleanup in the outer stream.
- FI4-06: a `ProductRefusal` raised from `stream_finalized` still became
  `elevenlabs_stream_failed`, and the port docstring said `tts.error` carries a
  status, which it has no field for.

Revisions (`be8e337c`): `stream_prepared_turn` closes both delegated streams with
`aclosing`; the regression test runs the real `stream_prepared_turn` over stand-ins
for the two private streams and fails without the fix. A refusal while a segment
streams keeps its code, with a test that fails without the fix, and the docstring
names the status only for the session frame. Validation on `be8e337c`: ruff, the
format check, mypy, the boundary checker and 571 tests across 27 chat-related suites
passed. Repair rounds used: 2 of 2.

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

Phases 4 and 5 add, run locally with output written to files and exit codes checked:
`uv run ruff check`, `uv run mypy` (the configured targets), `make check-test`,
`uv run --no-sync python scripts/repository-boundary/check-python-imports.py`, the
in-repo installed-wheel consumer (`tests/test_product_http_consumer.py`),
`pnpm openapi-ts:check` (no SDK diff), the golden chat transcripts, and the full
`pnpm e2e:test` on a named built stack (distinct `--name` and `--base-port`, torn
down after its last use). Acceptance: all 148 shared routes are served from
`product_http`; `SERVED_STAGES` is `{2, 3, 4, 5}`; the shared chat route passes the
stored emotional state and emits the local frames, including phoneme payloads; the
local guard is a no-op and a test guard proves admission, stops and exactly-once
settlement; no nullable-owner check remains on a shared route. The hosted
`Validation` workflow stays disabled; a hosted run needs the owner's approval.

## Idempotence and recovery

Each commit keeps the app releasable: moved routes keep their paths, names and
operation IDs, and temporary re-exports keep tests running until migrated. Reverting
a family's commit restores its previous module. No data or schema changes are
planned; if one becomes necessary, it follows the baseline-only migration rule.
Phase 5's golden transcripts are recorded before any chat code moves, so a later
step that changes a frame fails before it is committed; reverting the mount commit
returns the local route while keeping the moved helpers. Browser-journey stacks are
named for this task and removed after their last use; no other stack or volume is
touched.

## Outcomes & Retrospective

Delivered (2026-10-10): all five stages of #379. Stages 2 and 3 (129 shared routes)
merged in #429 as `d42eaad9`. Stages 4 and 5 (19 shared routes: 18 paid utilities
and catalog reads, and chat SSE under the chat-turn guard) are served from
`animama.product_http` on `refactor/share-utility-and-chat-routes`, so all 148
shared routes have one implementation; ElevenLabs audio isolation stays local. Local
self-hosted and desktop behaviour, the sorted OpenAPI document and the generated SDK
are unchanged, and golden transcripts of seven local chat turns, recorded before the
move, are reproduced byte for byte. The hosted consumer adopts `ROUTERS`, its ports,
chat-turn guard and speech in its own plan, using the recorded limitations (FI-05,
P4R-06 and the Phase 5 list).

Lessons: test doubles should match the strictest composition (the read-session guard
and the per-owner content tree found real classification and isolation gaps), and
the browser journeys catch timing races that in-process ASGI tests buffer away
(the download discard race). For the chat turn, characterization transcripts
recorded before moving any code made each step checkable, and a guard test double
that stops turns and fails deferred commits found settlement gaps the happy path
never reaches: cleanup cut short by anyio cancellation, saves aborted mid-commit,
a failed setup commit after the handler returned, and a stream left open behind a
full bridge. Journey stacks need a purge between full runs, because retained
package stages count against the stage limit.
