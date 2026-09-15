# Anima Backend Docs

This directory is the current documentation entry point for the FastAPI backend in
`src/backend/animama`.

## What This Backend Does

The backend owns the HTTP API, owner event SSE, persistence, and direct chat
orchestration layer for Animama's AI Avatar Desktop Companion app. It stores
animas, anima chat profiles, model-provider catalog rows, chats, settings,
avatars, archives, user-file uploads, searchable file chunks, the neutral
Content Catalog, revisioned per-Anima loadouts, and voice metadata. Included
and Local content bytes live in the canonical `content/` library. It compiles
exact Gesture and Reaction dependency closures into request-scoped runtime
snapshots and serves registered bytes through one authenticated local route.

The normal product path is request-local direct chat:
`POST /v1/animas/{anima_id}/chat:sse` loads one anima/avatar, resolves a
anima chat profile and model-provider catalog row, invokes a shared direct
model client, emits the supported request-scoped SSE frames, derives avatar
emotion/gesture events, and writes history to `chats` and `chat_messages`.
Provider streams are consumed behind the model-client boundary; raw upstream
events are logged and summarized internally instead of being forwarded as public
SSE frames. The old public graph dispatch surface, backend agent API, graph
runtime, and runner stack are retired.

The frontend lives in `src/frontend`. The backend is intentionally separate: it
exposes API routes and realtime event streams, while the frontend handles the
browser UI, client-side STT, avatar rendering, and most realtime audio UX.

## Docs Map

- [Architecture overview](architecture/overview.md): package layout, boundaries,
  dependency flow, app startup, configuration, and auth.
- [Local content storage and self-hosted trust](architecture/local-content-storage.md):
  approved Included/Local/private-data layout, creator and manual-file
  lifecycle, single-owner operator boundary, direct byte delivery, degraded-runtime policy, and
  reset/backup boundary for the local-storage cutover.
- [HTTP and realtime API](architecture/http-api.md): routers, endpoint groups,
  auth expectations, dispatch, SSE, and retired realtime surfaces.
- [Data model](architecture/data-model.md): ORM entities, relationships,
  migrations, and database conventions.
- [Direct chat SSE runtime](runtime/chat.md): supported `chat:sse` endpoint,
  direct model-client chat flow, primary-derived emotion updates, SSE frames,
  side effects, cleanup, and unsupported graph behavior.
- [Model clients and providers](runtime/model-client-providers.md): shared direct
  model clients, catalog provider rows, prompt-only maintenance calls, and chat
  persistence.
- [Adding AI model support](runtime/adding-ai-models.md): end-to-end model
  integration map and contributor workflow for adding catalog rows, compatible
  vendors, provider clients, public capabilities, seed data, frontend exposure,
  and verification.
- [Model catalog](model-catalog.md): supported provider/model pairs exposed by
  `/v1/model-providers`.
- [Memory](features/memory.md): retired anima block-memory surfaces, current
  scoped markdown memory entry tree, anima identity prompt assembly, seeded
  user profile entries, and the remaining filesystem integration phases.
- [User files](features/user-files.md): installation-owned uploads, parser worker,
  chunk storage, debug search, and current MVP limits.
- [Local User Profile](features/user-profiles-and-usernames.md): required private
  display-name personalization for the generated installation principal, with
  nullable bootstrap placeholders before setup.
- [Typed content and future marketplace](features/typed-content-and-marketplace.md):
  editable catalog domains, dependency safety, prepared runtime mounts, and
  the separate boundary to later immutable publication.
- [Custom animas and typed content](features/custom-animas-and-content.md):
  catalog-backed Anima loadouts, reviewed changes, and chat runtime revision
  fencing.
- [Voice and speech](integrations/voice-and-speech.md): ElevenLabs, retired
  server-side STT, and retired LiveKit integration points.
- [Development and operations](operations/development.md): local commands,
  migrations, tests, workers, and deployment guidance.
- [Local HTTP components](operations/local-http-components.md): FastAPI
  admission, static assets, telemetry, bounded transport and private drain
  behavior used by the desktop and self-host compositions.
- [Embedded desktop backend](operations/desktop-runtime.md): owned native
  services, frozen CLI, private environment, mounts, vault/token distinctions,
  migration snapshots and the separate Compose boundary.

Retired public dispatch, graph, sessionful realtime, and agent-management
implementation details remain available through git history; active docs do not
preserve unmounted executable surfaces.

## Architecture, contracts and operations

The local product and these durable guides belong in `animama`; see
[Repository boundaries](../../../docs/architecture/repository-boundaries.md).
Full execution plans and their approval history are privately retained, including
plans for local features. They are not prerequisites for contributors or local
builds. Implementation ownership remains with the repositories described in the
boundary document.

- [Development and operations](operations/development.md): local startup,
  generated installation owner, loopback application origin, administration tools, migration
  procedures and recovery.
- [Data model](architecture/data-model.md) and
  [HTTP API](architecture/http-api.md): current schema and request contracts.
- [Local content storage](architecture/local-content-storage.md) and
  [Custom Animas and typed content](features/custom-animas-and-content.md):
  Included/Local custody, safe mutation, source revisions and live creation.
- [Desktop operations](operations/desktop-runtime.md): embedded services,
  readiness, mounts, capability/worker boundaries and recovery. Packaging inputs
  are documented in [Desktop backend packaging](../packaging/desktop/README.md).
- [Memory](features/memory.md) and
  [Memory Manager and episodic memory](features/memory-manager-and-episodic-memory.md):
  persisted memory, approval rules, runtime boundaries and maintenance behavior.
- [User files](features/user-files.md): local uploads, processing and search.
- [Discover public contracts](../../../docs/architecture/discover-contract-ownership.md):
  proposed optional online client/portable-package boundaries. The identifiers
  remain unratified; no Discover feature completion is implied.

## Important Source Files

- `server/app.py`: FastAPI app factory, middleware, routers, startup/shutdown.
- `server/config.py`: environment-driven backend settings.
- `server/deps.py`: request-principal resolution, DB sessions, and embedders.
- `server/request_principal.py`: composition-injected HTTP/WebSocket principal
  resolver protocol and neutral dependency accessor.
- `local/http/`: local admission, the bootstrap-owned principal resolver,
  transport deadlines, built assets, telemetry and private quiescence.
- `server/local_http.py`: trusted environment/settings to HTTP configuration.
- `local/installation_principal.py`, `local/installation_repository.py`, and
  `local/installation_model.py`: installation-only identity persistence.
- `local/database.py`: local database configuration and app-owned sessions.
- `server/local_installation_bootstrap.py`: local-only principal/defaults
  orchestrator and bounded repair state.
- `app/services/owner_bootstrap_service.py`: reusable explicit-owner bootstrap
  over neutral ports.
- `server/routers/`: HTTP and SSE routes.
- `server/sse_events.py`: shared SSE event formatting and side-effect sinks.
- `server/routers/chat/`: direct avatar companion chat SSE orchestration,
  model-client turn setup, request-local SSE bridge mechanics, short-lived
  session adapters, TTS/title/compaction helpers, and cleanup.
- `server/routers/user_files.py`: installation-owned file upload, processing, and
  debug search endpoints.
- `server/routers/content.py`: neutral catalog list/detail, Rescan, deletion,
  package import/export, and registered-byte delivery.
- `server/routers/typed_content.py`: typed product List/Get/Save/Preview APIs.
- `server/routers/anima_loadouts.py`: typed loadout read and family-specific
  plan/commit commands.
- `server/routers/anima_runtime.py`: exact per-Anima runtime closure and
  revision fencing used by prepared browser mounts.
- `server/content_startup.py`: startup scan and reconciliation of Included and
  Local filesystem entries.
- `adapters/content_store/`: containment-safe Included/Local filesystem reads,
  writes, staging, and scanning.
- `server/user_file_storage.py`: opaque private locators and containment-safe
  local storage compatibility helpers.
- `app/chat/`: direct chat memory context reads, OpenAI-compatible prompt
  assembly, request options, and turn execution.
- `app/model_clients/`: provider-neutral model-client contracts, `MC*` stream
  event types, event sanitization, and compact stream-event summaries.
- `app/services/`: use-case services over repository ports.
- `app/ports/`: repository, unit-of-work, and model-provider protocols.
- `app/contracts/`: neutral schemas reused by mappers and HTTP delivery.
- `resources/catalogs.py`: source-independent access to packaged shared catalogs.
- `logging.py`: shared logger adapters without local handler configuration.
- `domain/`: framework-free dataclasses and event types.
- `adapters/`: SQLAlchemy repositories, domain/ORM mappers, and model clients,
  including packaged OpenAI Chat Completions and Responses adapters.
- `orm/`: SQLAlchemy async models.
- `workers/`: maintenance and processing background workers such as avatar
  cleanup and user-file parsing.

## Backend Conventions

Keep domain and application code independent from FastAPI and SQLAlchemy where
reasonable. New HTTP routes should usually call an app service through dependency
injection instead of reaching straight into ORM models. Some legacy routes still
use ORM sessions directly; do not copy that pattern unless the surrounding router
already does it and a small local change is safer.

Normal chat is request-local and stateless from the FastAPI process's
perspective. `chat:sse` runs a direct model-client turn for one request and
tears request-local work down after completion, cancellation, or error. Shared
model clients are app-scoped and closed only at app shutdown.

The local application is accountless. `create_local_app` installs a
`RequestPrincipalResolver`, and protected routes depend on
`get_current_principal`. Admission stays closed until startup completes
bootstrap for the migration-owned principal. The resolver accepts only
server-owned admission state, never a browser identity assertion. Tests use
explicit fixture bootstrap and principal dependency overrides. The
generated installation principal remains the owner value in existing `user_id`
and `owner_user_id` columns.
