# Browser Journeys

The supported local journey is accountless and begins at the application
origin. FastAPI owns production serving and admission; development Vite proxies
application routes while preserving browser metadata. Tests never invent an
owner header or bypass the boundary to reach a separate backend origin.

## Current Automation Status

The checked-in Playwright projects under `e2e/` predate the accountless cutover
and remain quarantined historical test code. Their setup project, stored-state
fixture, and credential-era journey names do not describe a supported workflow
and must not be used to test the current stack. The supported Phase 5 journey
runs through the real application origin and covers installation bootstrap, first run,
settings, starter and custom Animas, private uploads, typed preview bytes,
profile edits, chat SSE, receipts, and restart persistence.

The currently supported automated frontend checks are:

```bash
cd src/frontend
pnpm check
pnpm web:lint
pnpm web:test
pnpm desktop:check
```

The bounded application smoke test accepts only the configured origin:

```bash
source ../../.animama-stack.env
pnpm local:smoke:accountless -- --origin "$ANIMAMA_PUBLIC_ORIGIN"
```

It never reads or prints the installation principal or desktop-control credentials.

For a new isolated stack started with deterministic local model clients, run
the complete setup journey:

```bash
ANIMAMA_LLM_SKIP=1 ./reset.sh --name browser-a --base-port 8600
source .animama-stack.env
cd src/frontend
pnpm local:verify:accountless -- \
  --origin "$ANIMAMA_PUBLIC_ORIGIN" \
  --setup name \
  --display-name "Phase Five" \
  --profile-name "Phase Five Updated"
```

After restarting the same named stack with its saved environment, use `--setup existing` and
the same `--profile-name`. That mode requires the custom Anima, chat history,
private file, completed first run, and personalization to have survived. Fresh
named setup first verifies that missing, null, and blank names are rejected;
the retired `--setup skip` mode is no longer accepted. No additional stack is
needed to verify name validation. Root launch should open the last visited
owned Anima, or Annie on a fresh installation.
Output contains only bounded pass/fail booleans and counts, never principal or
credential values.

## Main-Stack Journey

From the repository root, start or restart the main local stack:

```bash
./reset.sh
```

Open `http://localhost:3000`. An installation whose first run is incomplete
shows `/setup`; a nonblank private display name is required and there is no Skip.
After completion, `/a` resolves to the last visited owned Anima's chat, or Annie
on a fresh installation. A normal restart must retain
the completed state, local display name, Animas, chats, content, and files.

Use `./reset.sh --purge` only when a fresh installation is required. Purge
deletes the selected local database and writable roots, creates a new
installation principal, and returns to first-run setup. It is not an account
recovery operation.

For a parallel worktree, use an isolated name and application port:

```bash
./reset.sh --name browser-a --base-port 8600
source .animama-stack.env
```

Open the generated `ANIMAMA_PUBLIC_ORIGIN`. Do not use the main stack's URL,
data roots, or bare Compose commands for a named stack.

## Required Observations

For a fresh accountless check:

1. Confirm the page loads from the application origin and never redirects to a credential screen.
2. Confirm blank names cannot continue, then complete setup with a non-sensitive
   test display name and confirm Annie opens at `/a/$animaId`.
3. Create an Anima and open its chat surface.
4. Load an Avatar portrait or another private byte through a same-origin `/v1`
   URL without an Authorization header.
5. Edit Personalization and confirm the response contains only the private
   display name, and that it cannot be cleared.
6. Restart with `./reset.sh`, reopen the same origin, and confirm setup does not
   return, local state remains, and root launch opens the last visited Anima.
7. Confirm the user menu has no account-management or logout control.

Boundary-negative behavior is covered by the FastAPI admission and real Uvicorn
transport tests. Hostile Host/Origin, cross-site Fetch Metadata, missing mutation
CSRF and missing Electron renderer capability fail safely. Forged owner headers
never change ownership. Ordinary renderer requests cannot use desktop controls.

## Evidence Safety

Screenshots, traces, videos, logs, and attachments must not contain API keys,
cookies, desktop-control credentialss, private headers, storage locators, or
principal values. Prefer bounded booleans, counts, response status, and hashes
when proving persistence or token rotation. Do not record private file bodies or
semantic memory contents unless the fixture was created expressly for the run.

Every stateful journey must identify the exact named stack and resources it
created before cleanup. A display name or guessed ID never grants deletion
authority. If ownership evidence is incomplete, stop and leave the resource for
manual review.

## Troubleshooting

- Use the selected application origin, normally `localhost:3000`; Vite's
  internal container port is not an additional public endpoint.
- In development FastAPI stays private. In built mode FastAPI is the application
  listener and Vite is absent. PostgreSQL stays private in both selections.
- Source the correct stack record before project-scoped inspection or restart;
  it includes the development/production Compose graph.
- If the installation singleton is missing while owner data exists, the stack
  must stay failed closed until a coordinated backup is restored.
