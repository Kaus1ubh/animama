# Architecture Overview

The backend is a FastAPI application plus application-layer direct chat
building blocks. The FastAPI layer resolves an owner principal, loads persisted anima
state, resolves anima chat profiles and model-provider catalog rows, invokes
shared model clients, streams direct chat events, and persists side effects. The
old graph runtime, graph node runners, backend agent API, and public
`dispatch:sse` route are retired.

## Package Layout

- `server/`: delivery and local-composition layer. Contains the separately named
  local FastAPI app factory, request-principal resolver seam, installation
  bootstrap, routers, direct chat SSE orchestration, Content Catalog delivery,
  owner event SSE helpers, local upload helpers, persistence
  sinks/subscribers, and telemetry.
- `domain/`: pure dataclasses and enums for animas, content catalog entries,
  chats, model providers, settings, and runtime events.
- `app/ports/`: protocols for repositories, unit-of-work boundaries, and model
  providers.
- `app/contracts/`: neutral Pydantic schemas consumed by shared mappers. The
  matching `server/schemas/` modules reexport the same types for HTTP routes.
- `app/services/`: use-case services for animas, editable content, exact
  runtime closures, chats, model provider catalog access, title generation,
  compaction, and settings. These operate on domain objects and ports.
- `app/chat/`: direct chat memory context reads, OpenAI-compatible prompt
  assembly, request options, `DirectChatTurnExecutor`, and direct-turn helpers
  for model stream collection, provider state, response formatting, and
  persistence payloads.
- `app/model_clients/`: provider-neutral direct model-client contracts, `MC*`
  stream-event types, event sanitization, and compact event summaries.
- `adapters/`: concrete implementations. The containment-safe content
  filesystem store, SQLAlchemy repositories, ORM/domain mappers, and direct
  model-client adapters live here. OpenAI Chat Completions and Responses
  adapters are split into request, stream-event, final/usage, and client
  lifecycle modules.
- `orm/`: shared SQLAlchemy 2.0 async models, without installation registration.
- `local/`: installation principal, repository, and model; gateway token
  validation; local database engine/session ownership. Alembic and local app
  bootstrap register and compose these explicitly.
- `resources/`: packaged animation/VFX catalogs usable without checkout paths.
- `logging.py`: logger adapters with no configuration side effects. The local
  composition configures handlers through `logging_config.py`.
- `workers/`: maintenance background processes such as staged upload cleanup.

## Dependency Direction

The preferred dependency flow is:

```text
server routers -> app services -> app ports -> adapters/orm
server routers -> app chat/model_clients -> adapters/model_clients
domain <- app/services
domain <- app/chat
```

Domain objects should not import FastAPI, SQLAlchemy, or server modules.
Application services should depend on protocols in `app/ports`. Adapters satisfy
those protocols using SQLAlchemy or provider SDKs. The server layer wires the
pieces together.

All transitive dependencies of `domain/` and `app/` are checked by
`scripts/repository-boundary/check-python-imports.py`. They cannot reach local
installation state, FastAPI composition/configuration, migration/frozen runtime
helpers, logging configuration, or private service modules. Ports carry owner
IDs, storage access, and policy explicitly. `OwnerBootstrapService` uses
caller-supplied defaults and ports; the local bootstrap orchestrator resolves
the installation principal before invoking it.

Some routes still use ORM models directly. For new behavior, prefer the
service, mapper, repository, and unit-of-work patterns unless the local router
already has a small legacy path and changing it would create extra risk.

## Layer Rules

- Domain objects are pure business objects. They do not serialize themselves and
  do not perform I/O.
- Ports use domain dataclasses in their method signatures and avoid framework
  imports.
- Services group related repository calls and call the unit of work once on
  success. They should not import FastAPI, SQLAlchemy sessions, or provider SDKs.
- Mappers under `adapters/mappers/` translate schema to domain and domain to
  ORM. Keep Pydantic and SQLAlchemy types at the edge.
- Tests can use `adapters/repositories/inmemory.py` for fast service and port
  tests where a real database is not needed.

## Direct Chat Concepts

Normal product chat is profile-first rather than graph-first:

- `anima_chat_profiles.default_model_provider_id` stores the anima's
  default catalog row.
- `model_providers` stores active provider/model rows, capabilities, lifecycle
  state, and pricing metadata.
- `DirectChatTurnExecutor` validates the selected provider, opens required
  anima identity context, assembles one OpenAI-compatible `DirectChatPrompt`,
  calls the shared direct model client, parses the main structured response,
  emits domain events, and persists the turn through `ChatManager`.
- `server/routers/chat/turn_setup.py` builds request-local direct-turn
  dependencies before the SSE stream starts; `sse_runtime.py` owns bridge,
  drain, and frame mechanics; `session_services.py` owns short-lived database
  session adapters for final persistence and memory tool execution.
- Direct model clients under `adapters/model_clients/` may hold reusable SDK or
  HTTP resources, but all user/anima/chat/run state is supplied by the
  direct chat executor. Provider adapters receive a narrow `ModelClientRequest`
  with the selected provider, assembled `DirectChatPrompt`, provider options,
  and continuation cursor.
- Provider adapters emit ordered `ModelClientDelta` values. Public text/final
  deltas feed the chat turn; `MC*` event deltas record provider lifecycle,
  finish, usage, assistant phase, native tool, and unknown-event observations for
  logs and compact metadata.

New anima writes do not create ingress nodes, graph JSON, durable backend
agent rows, or `chat_runtime` metadata.

## FastAPI Application

`server/app.py::create_local_app` creates the local app:

- title: `Animama Local Server`
- version: `0.1.0`
- global telemetry middleware from `server/telemetry.py`
- `/health`
- all `/v1/...` routers through `server/routers/__init__.py`

Startup performs process-level setup:

- validates the supported native launcher's loopback-only bind setting
- requires the migration-generated installation principal
- loads the private Hono/FastAPI token and installs the gateway principal
  resolver before readiness
- reconciles local content and idempotently ensures the private profile,
  settings, `profile.md`, and configured Starter Animas
- reconfigures logging
- initializes the app-scoped direct model-client registry
- starts the Included and Local Content Catalog watcher
- optionally loads legacy default anima configuration
- initializes optional voice provider state when `ANIMAMA_ENABLE_VOICE` is set

The app owns a lazy `local.database.LocalDatabase`, or an explicitly injected
`session_factory`. Request dependencies, startup scans, and streaming chat
resolve sessions from that app. Engines are created on the serving event loop;
cross-loop reuse before disposal fails clearly. Shutdown closes app-owned
database resources and model clients. An injected factory remains owned by its
caller. There is no process-global request session factory.

## Configuration

`server/config.py` is the local backend settings source. Shared services receive
policy values or ports from their composition. Important local settings include:

- database URL and PostgreSQL fallback variables
- default model names and provider configuration
- ElevenLabs configuration
- readable `ANIMAMA_CONTENT_ROOT` and private `ANIMAMA_DATA_ROOT` settings
- `ANIMAMA_LOCAL_BIND_HOST` for the supported native loopback launcher;
  Compose uses a separate private-network entrypoint
- private `ANIMAMA_INTERNAL_TOKEN_FILE` used only by Hono and FastAPI
- user-file, content, Avatar, and voice size limits
- avatar upload limits and cleanup intervals
- local/test flags such as `ANIMAMA_LLM_SKIP`

The app builds settings with Pydantic settings. Avoid reading environment
variables ad hoc from routes unless the configuration is truly route-local.

## Local Principal Boundary

The local application has no signup, sign-in, password, session, JWT, or API
key. The `baseline_20260908` baseline creates one canonical UUIDv4
`installation_principal_id`; that durable, non-secret ID owns all local rows.
Existing `user_id` and `owner_user_id` names remain in shared product code.

Protected routes depend on `server/deps.py::get_current_principal`, which
delegates to the `RequestPrincipalResolver` installed by the application
composition. The local factory starts fail-closed, then installs
`local.gateway_principal.LocalGatewayPrincipalResolver` after startup loads the private token and
migration-owned principal. HTTP and WebSocket product traffic requires both
matching Hono headers; missing or wrong tokens fail generically, and a principal
mismatch is forbidden. Unit and API tests use FastAPI dependency overrides; no
production auth bypass exists.

This local factory, bootstrap orchestrator, runtime APIs, environment contract,
and migration graph are not a hosted mode. Better Auth may return only in a
separately composed Animama Cloud service with its own database, BFF/app
factory, and resolver. Reusable domain services and repository ports receive
an explicit owner ID and do not read `installation_settings`.

The shared consumer in `scripts/repository-boundary/consumers/backend.py`
bootstraps both a local-shaped owner and an opaque hosted-shaped owner using
fake ports, then exercises real Anima/Chat services and direct streaming turns.
The artifact check runs that consumer from an installed wheel while rejecting
local imports and checkout-resolved modules. It proves shared API reuse without
adding a hosted application or changing provider request/stream behavior.

## Runtime Ownership

Normal chat is request-local and stateless from the FastAPI process's
perspective. `server/routers/chat/chat_sse.py` resolves the selected catalog
model provider, prepares a direct model-client turn through
`server/routers/chat/turn_setup.py`, fans current-run events through
`server/routers/chat/sse_runtime.py` and `server/sse_events.py`, and closes
request-local resources when the stream completes or closes. The route owns the
single public `run.completed` SSE frame after success-side effects such as TTS,
title generation, and compaction. Shared model clients live on the app and close
on shutdown. The old public `dispatch:sse` graph route is retired.

The former process-local anima engine, `AnimaRuntime`, graph runner stack,
public graph dispatch SSE route, and sessionful notification WebSocket paths
have been retired. Normal chat is horizontally scalable from the API process's
perspective.

## Realtime Delivery

The backend emits direct chat events through a request-local bridge owned by the
active `chat:sse` stream. Current consumers include:

- SSE chat formatting
- request-local emotional-state persistence

Account-level notifications are separate from normal chat requests.
`GET /v1/events:sse` remains mounted as an authenticated reserved stream and
currently emits heartbeat comments only.

The request-local stream bridge is scoped to the current chat turn. Clients
should treat realtime events as delivery signals rather than the only source of
durable state.

## Telemetry

`server/telemetry.py` installs request/response telemetry middleware. Direct
chat uses domain events such as `USER_RESPONSE`, `EMOTION_UPDATE`,
`AVATAR_GESTURE_REQUESTED`, `ERROR`, and `DROP`. The public `run.completed`
SSE frame is route-owned rather than emitted by the app-layer executor.

When adding new runtime behavior, prefer emitting typed runtime events instead
of adding route-specific side channels.
