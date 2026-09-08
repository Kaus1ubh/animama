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
http://localhost:3000  Hono gateway
```

Vite, FastAPI, and PostgreSQL are private Compose services and have no host
application ports.

## Worktrees

For a git worktree, use a named stack and base port:

```bash
./reset.sh --name abc --base-port 8200
```

If the worktree directory basename is meaningful, `--base-port` alone can infer
the stack name. For `../animama-worktrees/abc`, this becomes `animama-abc`.

Base port mapping:

```text
gateway            base
private API label  base + 1
private Vite label base + 2
private PG label   base + 3
pgAdmin            base + 4
Parakeet           base + 5
```

Only the gateway mapping is published for the core application; the private
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
`ANIMAMA_DESKTOP_WEB_URL` to the same Hono gateway.

## Docker Commands

Never run bare `docker compose down`, `docker compose up`, or `docker compose
logs` for a worktree stack. Use the project name:

```bash
docker compose -p animama-abc ps
docker compose -p animama-abc logs -f animama-server web-server web
docker compose -p animama-abc exec animama-server alembic current
```

Use service names, not generated container names. The compose file intentionally
does not set `container_name`.

## Reporting

When starting or debugging a stack, report the stack name, branch/worktree, base
port, and one Hono application URL. State that FastAPI, Vite, and PostgreSQL are
private. Note whether optional profiles such as `voice`, `memory`, or `obs` were
enabled. Never print the internal gateway token or installation principal.
