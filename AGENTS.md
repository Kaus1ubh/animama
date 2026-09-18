# Animama Agent Guide

This is the repository-level entrypoint for AI coding agents. Read this first, then read the nearest scoped guide before editing inside a subsystem:

- Backend/FastAPI: `src/backend/AGENTS.md`
- Frontend and Electron shell: `src/frontend/AGENTS.md`

The nested guides are authoritative for their areas. Keep this file focused on
repo-wide workflow, ownership boundaries, and local development conventions.

## Product Shape

Animama is an AI Avatar Desktop Companion app. The normal product loop is the
local installation owner chatting with one Anima and its selected Avatar through `/v1/chats` and
`POST /v1/animas/{anima_id}/chat:sse`, with streamed assistant text,
avatar emotion/gesture updates, memory side effects, voice/TTS integration, and
chat history persisted in `chats` and `chat_messages`.


## Repository Shape

- `src/backend`: FastAPI backend, direct chat runtime, domain/services,
  SQLAlchemy ORM, Alembic integration, workers, and Python package
  source.
- `src/frontend`: Vite React web app,
  Electron desktop shell, generated API client, and public
  runtime assets.
- `docker-compose.yml`: local service graph for Postgres, pgAdmin, backend,
  web development override, and optional `voice`, `memory`, and `dev-tools` profiles.
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

Use the [domain documentation guide](docs/agents/domain.md) to distinguish
current terminology, implemented behavior and architectural decision history.
Read relevant [glossary entries](GLOSSARY.md) and
[ADRs](docs/adr/README.md); surface conflicts
before changing an established meaning or decision. Intent discovery is an
explicitly requested pilot, not a required interview for every task.

## Branches and pull requests

Name new task branches `<type>/<short-kebab-case-task>`. Use the same type in
the PR title, `<type>: <summary>`; an optional scope uses `<type>(<scope>): <summary>`.
Choose the primary purpose of the change:

| Type | Purpose |
| --- | --- |
| `feat` | New user-facing capability |
| `fix` | Bug correction |
| `refactor` | Code restructuring with preserved behavior |
| `chore` | Routine maintenance or mechanical cleanup |
| `docs` | Documentation-only changes |
| `test` | Test coverage or test infrastructure |
| `build` | Dependencies, packaging or build tooling |
| `ci` | CI workflow changes |
| `perf` | Performance improvements |

For example, `fix/chat-reconnect` pairs with `fix: restore chat after reconnect`.
Use `fix` for bugs; classify cleanup as `chore` or `refactor` according to intent.
Do not add an agent-name prefix or rename an existing shared branch just to
match this convention. Matching PR labels are optional, not a prerequisite.
This naming policy grants no additional push, merge or remote-configuration
authority. See [worktree cleanup](docs/backend/operations/development.md#cleaning-up-worktree-stacks)
for the data-preserving handoff workflow.

Use the default [pull request template](.github/pull_request_template.md).
Describe the problem and resulting behavior, then separate local verification
from actual CI and browser evidence. Include the tested commit or working-tree
state, exact commands/results, material environment limits and unperformed checks.

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
  - Backend docs: `docs/backend/README.md`
   - Frontend docs: `docs/frontend/README.md`
4. Prefer existing patterns, helpers, commands, and architecture boundaries over
   introducing parallel paths.

## Accountless Transition

The local composition uses a generated installation owner, FastAPI request boundary,
credential-free React startup, and loopback-only desktop/self-host services.
Its durable contracts are documented in
[backend operations](docs/backend/operations/development.md) and
[local HTTP architecture](docs/frontend/architecture/auth-server.md).
FastAPI serves the production React build and authorizes API/byte traffic.
Development publishes Vite with a closed same-origin proxy to private FastAPI.
Only the selected application service publishes the loopback application port. React starts from `main.local.tsx`, reads backend-owned
installation readiness (requesting bootstrap only for reported repair), and
then supplies the principal through a neutral runtime-owner context. Do not
restore local accounts, account seeding, browser bearer tokens, direct FastAPI
browser configuration, or security-changing
local/hosted mode flags. The native FastAPI launcher binds only to loopback. Both Compose selections
publish the application at `127.0.0.1`. The opt-in
`dev-tools` profile adds only loopback pgAdmin and Dozzle; all other services
stay private. Remote self-host access requires an operator-owned TLS
and authentication boundary, and every admitted request is still the same
installation owner.

## Workspace selection

Use agent judgment based on disruption, conflicting edits and concurrency, not
line count or a formal small/large score. The existing checkout and development
stack are suitable when the work will not interfere with another active task.
Creating test chats or content does not by itself require a separate stack.
Development data is disposable; use the existing `reset.sh --purge` flow when a
reset is needed, after checking the selected project and coordinating with any
task using its data. Do not purge merely as a setup ritual.

Consider a separate worktree and named stack for concurrent edits,
dependency/configuration experiments, migrations or other disruptive work;
use them when they help avoid interference. A worktree does not automatically
need a running stack. Reuse the existing task workspace for follow-ups after inspecting its current branch,
changes and active processes. Never silently switch an occupied checkout,
stash another task's work or stop its services. Record the chosen checkout,
branch and any stack URL in the task handoff when they matter.

Use ordinary Git commands and `reset.sh`. No policy engine, mandatory workspace
helper or workspace registration service is required. Keep cleanup documented
and scoped to the task; consider a helper or skill only after repeated work
demonstrates a concrete need. Existing branch/PR review rules still apply.

## Local Stacks

For the main checkout, preserve the default local application URL:

```bash
./reset.sh
```

Default application URL:

```text
http://localhost:8000  Application (Vite in development; FastAPI in built mode)
```

PostgreSQL stays private. In development FastAPI is private; in built mode
there is no frontend Node service. `ANIMAMA_WEB_BUILD_MODE=production ./reset.sh`
selects the built application; the default `development` selection retains HMR.

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
tools publicly, add them to the application, or package them with Electron/Animama Cloud.

For git worktrees or parallel branch testing, use a named stack and base port:

```bash
./reset.sh --name abc --base-port 8200
source .animama-stack.env
```

The stack record includes the selected `COMPOSE_FILE` graph; source it before
project-scoped follow-up, backup and restore commands.

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
docker compose -p animama-abc logs -f animama-server web
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
- Backend API, persistence, runtime and workers belong under `src/backend`;
  backend documentation belongs under `docs/backend`.
- Browser UI, generated clients and Electron belong under `src/frontend`;
  frontend documentation belongs under `docs/frontend`.
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
updates. Before changing OpenAI platform integrations, verify models, request
fields, streaming behavior, tools, auth assumptions and rate limits against
current official OpenAI documentation. Imported agent skills are optional local
tools, not contributor or build prerequisites.

## Verification

Choose the smallest meaningful verification for the change and state what was
not run.

Run applicable local static checks, tests and builds before pushing a candidate
that triggers CI. Fix local failures first and batch intermediate work where
practical. After changes, rerun affected checks; do not repeat unchanged passing
checks without a reason. Use read-only checks such as `make format-check` to
verify formatting, rather than commands that rewrite files.

Local success does not replace the final clean CI run, Linux/Docker coverage,
isolated package consumers or actual browser acceptance. Record their results
separately and disclose pending/failed/unperformed checks. Follow the
[local-before-push workflow](docs/backend/operations/development.md#local-validation-before-pushing).

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
docker compose -f docker-compose.yml config --quiet
docker compose -f docker-compose.yml -f docker-compose.development.yml config --quiet
```

For user-facing web, avatar, audio, voice, and desktop changes, manual testing
may be required because automated UI coverage is not yet mature.

## Reporting Work

When finishing, summarize the behavior change, list important files touched,
and report validation. Include local stack URLs when you start or modify a
testing stack.
