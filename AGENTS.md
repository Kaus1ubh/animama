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

Follow [SDLC.md](SDLC.md) for the change lifecycle and [SPECS.md](SPECS.md) for
specification authoring. Most changes use an issue, task branch, PR, checks and
owner-approved merge. Tiny incidental corrections may omit the issue. Require an
ExecPlan for substantial, uncertain or risky work; routine changes need an issue
with acceptance and a brief approach. File count or duration alone is not a trigger.
Keep the record current so another contributor can resume it. Read the
[repository setup contract](SDLC.md#repository-setup) before using a lifecycle
skill. This established setup is the workflow authority; repair missing or
inconsistent prerequisites before dependent work instead of choosing a fallback.
Preserve every explicit verification gate in an existing plan; skill
creation does not complete the separately gated skill pilot.
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
invocable interview for unresolved intent, not a required interview for every task.

## Branches and pull requests

Name new task branches `<type>/<short-kebab-case-task>` and PR titles
`<type>: <summary>`. Scope belongs in commit subjects: use
`<type>(<scope>): <summary>` when the affected area is clear, with a short,
lowercase kebab-case scope such as `chat`, `models` or `workflow`. Omit the scope
when no meaningful area is defined; do not invent one. Commits associated with
an ExecPlan phase use `<type>(<scope>)[p#]: <summary>`, for example
`feat(chat)[p1]: persist the selected chat`. Without a meaningful scope, use
`<type>[p#]: <summary>`. Keep one branch and PR per plan in each affected
repository; phase markers belong only in commit subjects.
Choose the primary purpose of the change:

| Type       | Purpose                                    |
| ---------- | ------------------------------------------ |
| `feat`     | New user-facing capability                 |
| `fix`      | Bug correction                             |
| `refactor` | Code restructuring with preserved behavior |
| `chore`    | Routine maintenance or mechanical cleanup  |
| `docs`     | Documentation-only changes                 |
| `test`     | Test coverage or test infrastructure       |
| `build`    | Dependencies, packaging or build tooling   |
| `ci`       | CI workflow changes                        |
| `perf`     | Performance improvements                   |

For example, `fix/chat-reconnect` pairs with PR title `fix: restore chat after reconnect`
and commit subject `fix(chat): restore chat after reconnect`.
Use `fix` for bugs; classify cleanup as `chore` or `refactor` according to intent.
Do not add an agent-name prefix or rename an existing shared branch just to
match this convention. Matching PR labels are optional, not a prerequisite.
This naming policy grants no additional push, merge or remote-configuration
authority. See [worktree cleanup](docs/backend/operations/development.md#cleaning-up-worktree-stacks)
for the data-preserving handoff workflow.

Use the default [pull request template](.github/pull_request_template.md).
Its Spec section links the authoritative issue. Its ExecPlan section states
that a private plan is retained, without exposing its path, or explains why
no plan is required.
Describe the problem and resulting behavior, then separate local verification
from actual CI and browser evidence. Include the tested commit or working-tree
state, exact commands/results, material environment limits and unperformed checks.
Default to an ordinary merge commit after owner approval of the exact candidate.
Squash or rebase needs an explicit exception; a default method grants no merge
authority. Follow [review and merge evidence](SDLC.md#ci-and-merge-evidence).

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

Use the checkout assigned to the task. Before editing, verify its absolute Git
root, branch or detached HEAD, source revision, dirty state and any recorded task
workspace. Reuse an existing task worktree for implementation, validation, review
and follow-ups; workspace setup or a new phase does not require another worktree.
Preserve an existing task branch. For a detached task worktree, create the branch
at its verified current HEAD when implementation is authorized. Investigate
mismatches before switching directories, branches or the selected revision.

Create another worktree only for an identified isolation need, such as conflicting
concurrent edits or disruptive experiments, or an explicit request. A worktree does
not automatically need a running stack. Never silently switch an occupied checkout,
stash another task's work or stop its services. Record the chosen checkout,
branch, starting revision and any stack URL in the task handoff when they matter.

Use ordinary Git commands and `reset.sh`. No policy engine, mandatory workspace
helper or workspace registration service is required. Keep cleanup documented
and scoped to the task; consider a helper or skill only after repeated work
demonstrates a concrete need. Existing branch/PR review rules still apply.

## Local Stacks

Before first startup, acquire the pinned shared Parakeet inputs with
`python3 scripts/models/parakeet.py acquire` and
`python3 scripts/models/browser_speech.py acquire` (or import verified existing copies).
`reset.sh` verifies the selected `ANIMAMA_MODEL_ROOT` offline and records its
resolved immutable directory; it never downloads models or silently creates an
empty mount. See [model setup](docs/backend/operations/model-assets.md).

Follow the [workspace preparation workflow](docs/backend/operations/development.md#preparing-a-task-workspace)
for ordinary Git worktrees, dependencies and credentials. Keep reusable secrets
in an owner-only external file and worktree `.env` files nonsecret; select them
with `COMPOSE_ENV_FILES` (secrets first, worktree configuration second). Never
copy a main checkout's `.env` or log credential values/digests. Inherited shell
values override file settings, so use a clean environment for configuration
changes and the generated stack record for resuming the same stack.

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

The stack record includes the selected `COMPOSE_FILE` graph and normalized
`COMPOSE_ENV_FILES` paths; source the trusted record from the correct checkout
before project-scoped follow-up, backup and restore commands. It records no
credential values.

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
current official OpenAI documentation. Agent skills are optional local
tools, not contributor or build prerequisites.

## Verification

Choose the smallest meaningful verification for the change and state what was
not run.

Run applicable local static checks, tests and builds before pushing a candidate
that triggers CI. Fix local failures first and batch intermediate work where
practical. After changes, rerun affected checks; do not repeat unchanged passing
checks without a reason. Use read-only checks such as `make format-check` to
verify formatting, rather than commands that rewrite files.

Run expensive checks locally before pushing. For explicitly allowlisted routine
changes, a fresh exact-source Linux receipt reviewed by the repository owner can
replace selected hosted work under the local-first validation policy. This is an
owner-reviewed local assertion, not independent CI evidence. Agents may prepare
receipts but must never impersonate the owner's review. Documentation-only changes
need no receipt; high-risk or uncertain changes, persistent `ci:full`, manual runs
and release callers retain full hosted validation.

Record local evidence and the actual hosted `Validation` scope separately, with
pending/failed/unperformed checks. Source, baseline, environment and freshness
requirements are in the [local-before-push workflow](docs/backend/operations/development.md#local-validation-before-pushing).
A deferred draft is not acceptance, and reduced validation does not establish
real avatar/audio fidelity, native release acceptance or publication approval.

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
export ANIMAMA_PARAKEET_MODEL_DIR="$(python3 scripts/models/parakeet.py path)"
export ANIMAMA_BROWSER_MODEL_DIR="$(python3 scripts/models/browser_speech.py path)"
docker compose -f docker-compose.yml config --quiet
docker compose -f docker-compose.yml -f docker-compose.development.yml config --quiet
```

For user-facing web, avatar, audio, voice, and desktop changes, manual testing
may be required because automated UI coverage is not yet mature.

## Reporting Work

When finishing, summarize the behavior change, list important files touched,
and report validation. Include local stack URLs when you start or modify a
testing stack.
