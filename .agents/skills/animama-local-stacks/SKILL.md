---
name: animama-local-stacks
description: Use when starting, resetting, debugging, or reporting local Docker Compose stacks for the Animama repo, especially git worktrees or parallel branch testing. Ensures agents use reset.sh --name/--base-port and project-scoped docker compose commands without disrupting other stacks.
---

# Animama Local Stacks

Use this workflow for local Animama Docker Compose stacks. Follow the workspace
judgment rules in the root AGENTS.md: the existing development stack may be used
for test chats/content when this will not disrupt active work. Separate worktrees
and named stacks are useful for concurrency or disruptive changes, not mandatory
for every mutable test. No workspace helper or formal task score is required.

## Model Prerequisite

Before first startup, run `python3 scripts/models/parakeet.py acquire` explicitly,
or import a verified existing copy. `ANIMAMA_MODEL_ROOT` selects an absolute shared
store root. Reset verifies it offline before changing containers and records the
resolved version; ordinary startup never downloads models. Follow
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
selected `COMPOSE_FILE` graph and `ANIMAMA_WEB_BUILD_MODE`; preserve these for
Compose, backup and restore operations. When running two stacks from one
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
enabled. Never print provider or desktop-control credentials.
