---
name: animama-local-stacks
description: Use when starting, resetting, debugging, or reporting local Docker Compose stacks for the Animama repo, especially git worktrees or parallel branch testing. Ensures agents use reset.sh --name/--base-port and project-scoped docker compose commands without disrupting other stacks.
---

# Animama Local Stacks

Use this workflow for local Animama Docker Compose stacks. Root
`AGENTS.md#workspace-selection` owns checkout and branch policy. Stack selection
is separate: reuse a stack only when it serves the required revision and testing
will not disrupt active work. Test chats/content alone do not require a new stack.

## Workspace Preparation

Follow `docs/backend/operations/development.md#preparing-a-task-workspace` from
the assigned task worktree. Inspect the checkout, revision and active processes;
reuse the existing task worktree rather than creating another for stack setup.
Keep each worktree's `.venv`, `node_modules` and generated output separate while
using uv/pnpm caches.

Before starting a fresh checkout/worktree, verify tracked Git LFS assets with
`git lfs ls-files`: `-` marks a pointer; `*` marks a hydrated file. Run
`git lfs pull` from that checkout when assets are still pointers, then verify
hydration before starting the stack. Required assets include the starter VRM
avatars under `content/included/avatars/`. Hydrated assets are a prerequisite;
repeating the pull on every restart is unnecessary. See the preparation guide's
“Assets and dependency installation” section.

Keep reusable credentials in an owner-only external file and nonsecret settings
in the ignored worktree `.env`. Select both from the worktree root:

```bash
export COMPOSE_ENV_FILES="$HOME/.config/animama/dev-secrets.env,$PWD/.env"
```

The second file overrides the first; inherited shell values override both. Do
not copy the main checkout's `.env`, source secrets into the shell, or copy
placeholder/blank credential entries from `.env.example` into the second file.
The file selection applies only to Compose; it does not export credentials to
host `uv` commands or native apps. Keep offline unit tests credential-free.
Check existence and permissions without printing values, hashes, resolved
Compose configuration or the full shell environment. For configuration changes,
use a clean environment or selectively unset known overrides; an ordinary
subshell retains its parent's exports. Follow the canonical guide's diagnostic
steps rather than adding enforcement tooling.

## Model Prerequisite

Speech models are optional. Run `python3 scripts/models/parakeet.py acquire` and
`python3 scripts/models/browser_speech.py acquire` to enable dictation and Pocket
TTS/Smart Turn, or import a verified existing copy. `ANIMAMA_MODEL_ROOT` selects an
absolute shared store root. Reset verifies each acquired set offline before
changing containers, warns about missing sets, and records the resolved versions;
ordinary startup never downloads models. Follow
`docs/backend/operations/model-assets.md` for persistent self-host storage/recovery.

## Main Checkout

For the primary repo checkout, keep the default local URLs and ports:

```bash
./reset.sh
```

Expected application URL:

```text
http://localhost:8000  Application
```

Only the selected application service has a host port. Development publishes
Vite with HMR and a closed proxy to private FastAPI. Built self-hosting publishes
FastAPI with baked React assets; it has no frontend Node service. PostgreSQL
stays private. Use `ANIMAMA_WEB_BUILD_MODE=production ./reset.sh` for built mode;
the default is `development`.

## Worktrees

When a worktree needs its own running stack, use a name and base port:

```bash
./reset.sh --name abc --base-port 8200
```

If the worktree directory basename is meaningful, `--base-port` alone can infer
the stack name. For `../animama-worktrees/abc`, this becomes `animama-abc`.

Base port mapping:

```text
application        base
pgAdmin            base + 4 (optional dev-tools)
Dozzle             base + 20 (optional dev-tools)
```

Only the application mapping is published for the core application; PostgreSQL
and supporting services stay private. Named stack URLs use `animama-<name>.localhost` by default to keep local
browser state separate between branches. If that hostname does not resolve
locally, pass `--host localhost` or ask the user to add a hosts entry.

## Stack Env File

`reset.sh` writes `.animama-stack.env` in the checkout/worktree root. Source it
before follow-up commands that need the generated URLs:

```bash
source .animama-stack.env
cd src/frontend
pnpm desktop:dev
```

The file includes `ANIMAMA_PUBLIC_ORIGIN` and sets
`ANIMAMA_DESKTOP_WEB_URL` to the same application origin. It also records the
selected `COMPOSE_FILE` graph, `ANIMAMA_WEB_BUILD_MODE` and normalized absolute
`COMPOSE_ENV_FILES` paths. It never records credential values. Source the trusted
record from the correct checkout in a new terminal to restore the same stack
and environment-file selection for Compose, backup and restore operations. An
empty recorded selection clears an inherited `COMPOSE_ENV_FILES`. To change
configuration, start from a clean environment and rerun reset; sourcing an old
record restores its resolved settings rather than rereading changed `.env` values.
The recorded `ANIMAMA_STACK_REPO_ROOT` lets reset reject a record from another
checkout or explicitly requested named project. When running two stacks from one
checkout, use distinct `--stack-env-file` paths so their records cannot overwrite
each other.

## Docker Commands

Never run bare `docker compose down`, `docker compose up`, or `docker compose
logs` for a worktree stack. Use the project name:

```bash
docker compose -p animama-abc ps
docker compose -p animama-abc logs -f animama-server web
docker compose -p animama-abc exec animama-server alembic current
```

Use service names, not generated container names. `reset.sh` prefixes configured
container names for named stacks; project-scoped commands remain authoritative.

## Readiness and Test Settings

Follow `docs/backend/operations/development.md#application-readiness-and-test-settings`.
Health alone does not prove the starter's typed avatar/Idle/gesture closure.
Inspect installation readiness, catalog diagnostics and the selected Anima's
runtime revision before claiming a usable fixture. Do not fill missing Included
content by copying another task's Local library.

Pointer-only starter avatars can leave healthy services but installation
readiness at `repair_required` with `starter_animas` in `failed_steps`. Restore
the LFS assets first, then retry the supported installation bootstrap/repair
flow once and recheck readiness. If repair remains required, inspect the failed
steps and catalog diagnostics; do not purge the database to repair missing files.

Use the accepted main model `OpenAIResponsesHTTPAgent:gpt-6-luna` and verify
`dispatch_options.reasoning_effort=none` on each test turn. Existing Anima
profiles need explicit model selection. Title generation and Memory Manager
have separate settings; the latter has no configurable reasoning effort. Main
chat memory can be checked without opening the auxiliary manager. Keep deferred
microphone, spoken-reply and upload testing separate from the essential text,
avatar, gesture and memory journey.

## Cleanup

Follow the existing cleanup workflow in `docs/backend/operations/development.md`.
Stop only a task-owned stack; finishing one task does not justify stopping a
shared development stack. Development data is disposable and `reset.sh --purge`
may reset the verified intended stack when needed, after checking active work.
Do not purge by default. Inspect ignored data before removing a worktree and
never globally prune Docker, Git or caches. No new cleanup helper is required.

## Reporting

When starting or debugging a stack, report the stack name, branch/worktree, base
port, build mode and one application URL. Identify the published application
service and confirm PostgreSQL and supporting services remain private. Note whether optional profiles such as `voice` or `memory` were
enabled. Never print provider or desktop-control credentials, their digests, or existing
user memory contents. Distinguish model/asset readiness, health checks, browser
evidence and any unperformed paid or native checks.
