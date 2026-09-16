---
name: animama-local-stacks
description: Use when starting, resetting, debugging, or reporting local Docker Compose stacks for the Animama repo, especially git worktrees or parallel branch testing. Ensures agents use reset.sh --name/--base-port and project-scoped docker compose commands without disrupting other stacks.
---

# Animama Local Stacks

Use this workflow for local Animama Docker Compose stacks.

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

For a git worktree, use a named stack and base port:

```bash
./reset.sh --name abc --base-port 8200
```

If the worktree directory basename is meaningful, `--base-port` alone can infer
the stack name. For `../animama-worktrees/abc`, this becomes `animama-abc`.

Base port mapping:

```text
application        base
private API label  base + 1
private Vite label base + 2
private PG label   base + 3
pgAdmin            base + 4
Parakeet           base + 5
```

Only the application mapping is published for the core application; the private
labels remain in `.animama-stack.env` for compatibility and port-isolation
checks. Named stack URLs use `animama-<name>.localhost` by default to keep local
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

## Reporting

When starting or debugging a stack, report the stack name, branch/worktree, base
port, build mode and one application URL. Identify the published application
service and confirm PostgreSQL and supporting services remain private. Note whether optional profiles such as `voice` or `memory` were
enabled. Never print provider or desktop-control credentials.
