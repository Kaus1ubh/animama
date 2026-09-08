# Animama Agent Guide

This is the repository-level entrypoint for AI coding agents. Read this first, then read the nearest scoped guide before editing inside a subsystem:

- Backend/FastAPI: `src/backend/AGENTS.md`
- Frontend, frontend server, and Electron shell: `src/frontend/AGENTS.md`

The nested guides are authoritative for their areas. Keep this file focused on
repo-wide workflow, ownership boundaries, and local development conventions.

## Product Shape

Animama is an AI Avatar Desktop Companion app. The normal product loop is the
local installation owner chatting with one anima/avatar through `/v1/chats` and
`POST /v1/animas/{anima_id}/chat:sse`, with streamed assistant text,
avatar emotion/gesture updates, memory side effects, voice/TTS integration, and
chat history persisted in `chats` and `chat_messages`.


## Repository Shape

- `src/backend`: FastAPI backend, direct chat runtime, domain/services,
  SQLAlchemy ORM, Alembic integration, workers, backend docs, and Python package
  source.
- `src/frontend`: Vite React web app, Hono local frontend server,
  Electron desktop shell, frontend docs, generated API client, and public
  runtime assets.
- `docker-compose.yml`: local service graph for Postgres, pgAdmin, backend,
  frontend server, web app, and optional `voice`, `memory`, `obs`, and `dev-tools` profiles.
- `reset.sh`: preferred local stack reset/start script. You have my approval to run this script as needed to restart the local docker containers if needed. Generally, the local dev environment will already be accessible.
- `tests`: backend and integration tests. Frontend manual testing is currently
  important for audio, avatar animation, voice, and desktop behavior.

## Planning and change records

For multi-file changes, runtime refactors, authentication or persistence changes,
record the bounded approach, acceptance criteria and validation in the task or
pull request. Keep the record current so another contributor can resume it.
Use this guide, the scoped guides and checked-in architecture, contract and
operational documentation as the implementation references.

Full execution plans and their approval history are maintained privately. Their
location does not change implementation ownership, and they are never a local
build, runtime or contributor prerequisite. Update durable documentation with
behavior changes. Do not add public stub plans or links that require a private
planning checkout. See [Repository boundaries](docs/architecture/repository-boundaries.md).

## Code Quality

Keep code changes clean, organized, and easy to maintain. Follow established
best practices and core coding principles:

- DRY (Don't Repeat Yourself): reuse existing helpers, abstractions, and
  patterns instead of duplicating logic.
- KISS (Keep It Simple): prefer the simplest design that solves the current
  problem clearly.
- Readable over clever: write code another maintainer can quickly understand;
  avoid obscure shortcuts, surprising control flow, and unnecessary indirection.
- Fail clearly: surface errors with useful context, avoid silent failures, and
  make invalid states explicit.
- Performance awareness: avoid obvious inefficiencies in hot paths and shared
  code, but do not add premature complexity without evidence.
- Secure by default: validate inputs, respect auth and ownership boundaries,
  handle secrets carefully, and treat external data as untrusted.
- Comments and docstrings: add them frequently for public APIs, domain concepts,
  non-obvious decisions, and complex logic; keep them accurate as code changes.
- Documentation updates: update relevant docs when behavior, configuration,
  commands, architecture, or workflows change.

Prefer clear ownership boundaries, focused changes, readable structure, and
solutions that fit the surrounding patterns.

## First Steps

1. Check `git status --short` before editing. Do not revert unrelated dirty or
   untracked files.
2. Identify the touched subsystem and read its scoped `AGENTS.md`.
3. Read the relevant docs entrypoints:
  - Backend docs: `src/backend/docs/README.md`
   - Frontend docs: `src/frontend/docs/README.md`
4. Prefer existing patterns, helpers, commands, and architecture boundaries over
   introducing parallel paths.

## Accountless Transition

The local composition uses a generated installation owner, trusted Hono gateway,
credential-free React startup, and loopback-only desktop/self-host services.
Its durable contracts are documented in
[backend operations](src/backend/docs/operations/development.md) and
[frontend gateway architecture](src/frontend/docs/architecture/auth-server.md).
Hono is the only host-published application service and proxies private FastAPI
and Vite traffic after validating browser metadata and adding its internal
service assertion. React starts from `main.local.tsx`, reads backend-owned
installation readiness (requesting bootstrap only for reported repair), and
then supplies the principal through a neutral runtime-owner context. Do not
restore local accounts, account seeding, browser bearer tokens, direct FastAPI
browser configuration, or security-changing
local/hosted mode flags. Native Hono and FastAPI launchers bind only to
loopback. Default Compose publishes only Hono at `127.0.0.1`. The opt-in
`dev-tools` profile adds only loopback pgAdmin and Dozzle; all other services
stay private. Remote self-host access requires an operator-owned TLS
and authentication boundary, and every admitted request is still the same
installation owner.

## Local Stacks

For the main checkout, preserve the default local application URL:

```bash
./reset.sh
```

Default application URL:

```text
http://localhost:3000  Hono gateway
```

Vite, FastAPI, and PostgreSQL are private Compose services. Do not try to reach
their former host ports.

For browser administration on a trusted development machine:

```bash
./reset.sh --profile dev-tools
```

This enables pgAdmin at `http://localhost:5050` and Dozzle at
`http://localhost:9999`, both bound to `127.0.0.1`. `PGADMIN_PORT` and
`DOZZLE_PORT` override the defaults; `--base-port B` takes precedence and uses
B+4/B+20. Reset reports the resolved URLs. Disable with
`COMPOSE_PROFILES= ./reset.sh`, or preserve other profiles while removing only
`dev-tools`. Neither operation needs `--purge`. Do not forward these privileged
tools publicly, add them to Hono, or package them with Electron/Animama Cloud.

For git worktrees or parallel branch testing, use a named stack and base port:

```bash
./reset.sh --name abc --base-port 8200
source .animama-stack.env
```

That creates an isolated Compose project such as `animama-abc`, writes derived
URLs and ports to `.animama-stack.env`, and sets `ANIMAMA_DESKTOP_WEB_URL` for
Electron commands. From `src/frontend`, source it as:

```bash
source ../../.animama-stack.env
```

Never use bare `docker compose down` or target container names directly for
worktree stacks. `reset.sh` prefixes container names for named stacks, but
agent commands should still use project-scoped Compose service commands, for
example:

```bash
docker compose -p animama-abc ps
docker compose -p animama-abc logs -f animama-server web-server web
```

If the `animama-local-stacks` skill is installed, use it for local stack
startup, debugging, and reporting.

## Ownership Boundaries

- This repository must build, test and run without a Cloud checkout or private
  source. Do not add Cloud imports, sibling path dependencies, symlinks or build
  inputs. Documented hosted HTTP contracts are allowed; private service databases
  are not a local integration surface. Shared reusable code belongs here;
  Cloud consumes reviewed, immutable public artifacts.
- In a workspace containing multiple repositories, read the target repository's
  root and scoped agent guides before editing there; secondary-folder guidance
  may not load automatically. Run commands with an explicit repository working
  directory and keep Git status, commits and pull requests separate. A worktree
  for this repository does not isolate edits in an attached sibling repository.
- Backend API, persistence, runtime, workers, and backend docs belong under
  `src/backend`.
- Browser UI, frontend gateway, generated clients, Electron, and frontend
  docs belong under `src/frontend`.
- Do not hand-edit generated API clients under
  `src/frontend/packages/runtime-contracts/src/generated` or generated TanStack
  Router output. Regenerate the SDK offline through `pnpm openapi-ts`.
- Backend schema/API changes should update backend docs and coordinate frontend
  client regeneration through the frontend guide.
- Local ownership uses the generated installation principal. Shared FastAPI
  routes receive a `RequestPrincipal` from the resolver installed by the local
  composition; tests override that dependency explicitly. Better Auth is
  reserved for the future hosted Animama Cloud composition.

## Documentation

Update docs in the same change when behavior, configuration, architecture,
routes, workflows, or commands change. Use the existing docs information
architecture before adding new pages.

Use `$docs-sync` when asked to audit documentation coverage or propose doc
updates. Use `$openai-knowledge` before changing OpenAI platform integrations,
models, request fields, streaming behavior, tools, auth assumptions, or rate
limit assumptions.

## Verification

Choose the smallest meaningful verification for the change and state what was
not run.

Backend commands from the repo root:

```bash
uv run pytest -q
uv run ruff check
make check-test
```

Frontend commands from `src/frontend`:

```bash
pnpm check
pnpm web:lint
pnpm web:test
pnpm build
pnpm desktop:check
```

Root/local-stack checks:

```bash
bash -n reset.sh
docker compose config --quiet
```

For user-facing web, avatar, audio, voice, and desktop changes, manual testing
may be required because automated UI coverage is not yet mature.

## Reporting Work

When finishing, summarize the behavior change, list important files touched,
and report validation. Include local stack URLs when you start or modify a
testing stack.
