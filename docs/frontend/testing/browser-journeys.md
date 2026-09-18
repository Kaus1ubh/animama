# Browser Journeys

The supported local journey is accountless and begins at the application
origin. FastAPI owns production serving and admission; development Vite proxies
application routes while preserving browser metadata. Tests never invent an
owner header or bypass the boundary to reach a separate backend origin.

## Reproducible accountless smoke

After installing locked backend/frontend dependencies, Chromium (`pnpm e2e:install`)
and building the web application (`pnpm build`), run from the repository root:

```bash
uv run --frozen --no-sync python src/frontend/scripts/e2e/run-accountless-smoke.py \
  --evidence /tmp/animama-browser-smoke
```

The evidence directory must not already exist. This runner owns one disposable
`pgvector/pgvector:pg16` container per serving mode, bound to a random loopback
port. `--pg-bin /path/to/bin` instead uses installed PostgreSQL binaries with
pgvector. It starts fresh FastAPI built and Vite development applications,
runs the same installation setup and original Library smoke test, and stops its owned processes
and removes temporary databases/content even on failure. Logs, Playwright reports,
and screenshot attachments remain in the evidence directory.

The fixture generates original structural VRM/VRMA content through the shared
backend test helper and runs production bootstrap without bypassing admission.
This proves bounded first-run and Library rendering with same-origin, bearer-free
API requests. It does not prove real starter animation, avatar rendering, audio,
content acquisition, cache/workspace concurrency, or packaged desktop behavior.
No maintainer `.env` or provider credentials are passed to the owned processes.
The runner filters out the real-avatar pose journey in the same spec.

## Current Automation Status

The active Playwright projects use installation setup and same-origin requests,
without accounts, stored login state, owner headers or browser bearer tokens.
The selected `accountless-*.spec.ts` journeys cover Library, companion selection,
chat Stop/recovery, and creator JSON import/preview. Scene Save uses an ordinary
pointer click and rejects failed typed-content reads through the following reload;
the reloaded item must retain the exact revision returned by Save. Layout checks
cover the Scene, Avatar Effect and Particle creators at desktop, tablet and phone
widths: catalog health and Save must have separate hit targets, and details/Rescan
remain reachable. These are rendered-browser assertions, not CSS string checks.
Older creator journeys remain
unselected until individually reviewed; listing them is not passing evidence.
The separate `local:verify:accountless` API journey covers bootstrap, settings,
starter/custom Animas, private uploads, typed bytes, chat receipts and persistence.

Run these automated Playwright journeys only against a disposable named stack
with deterministic model clients and its own Local content. These runner guards
do not require a separate stack for ordinary manual testing: test chats and
content may use an existing development stack when they will not disrupt another
active task. Follow the [workspace selection rules](../../../AGENTS.md#workspace-selection).
For the automated runner, start from the repository root:

```bash
ANIMAMA_LLM_SKIP=1 ./reset.sh --name browser-a --base-port 8600
source .animama-stack.env
export ANIMAMA_E2E_ALLOW_MUTATIONS=1
cd src/frontend
pnpm e2e:test
```

The runner requires an explicit loopback application origin, a named
`animama-*` project and a non-default Local root from the selected stack record.
`ANIMAMA_E2E_WEB_URL`, `ANIMAMA_E2E_COMPOSE_PROJECT` and
`ANIMAMA_E2E_LOCAL_CONTENT_ROOT` can explicitly describe an equivalent disposable
fixture. They are assertions of ownership, not automatic isolation: never point
them at a personal installation. Setup, companion selection and chats persist in
that fixture. Retain the named stack's database and storage by default for review
or continued work; disposable data does not mean automatic deletion after a run.
Follow [task-scoped cleanup](../../backend/operations/development.md#cleaning-up-worktree-stacks)
to inspect ownership, stop only task-owned services and preserve retained data
before removing a worktree. Purge or storage removal needs a concrete need and
the applicable authorization. The separate reproducible smoke runner above
still removes the temporary databases/content it creates and owns. Do not reuse
account credentials or old auth-state settings; the runner rejects them.

```bash
pnpm e2e:list       # Offline discovery; no application or browser required.
pnpm e2e:check      # Type-check all browser test sources, including inactive ones.
node --test scripts/e2e/*.test.mjs
```

Unexpected browser `pageerror` events fail active tests and remain in the evidence.
The runner records per-project locking, source identity, traces, request failures,
and an exact content ownership ledger under ignored `.animama-e2e/runs/`.
Created catalog items must still be cleaned up using their recorded ID, revision,
logical key and verified files; retaining stack data does not waive this exact
content-ledger cleanup. Failed cleanup remains a failed result; recovery cleanup
must target the same recorded origin/project and owned Local root. Use
`pnpm e2e:cleanup -- RUN_ID` to inspect unresolved items, then
`pnpm e2e:cleanup -- RUN_ID --confirm RUN_ID` with the exact generated ID to
perform recovery. The same isolated-stack environment and consent are required.

Browser coverage uses the existing creator JSON import UI. Portable `.animama /2`
package import/export is covered separately by migration-backed backend tests;
this suite does not claim a package-import browser screen exists. Chat cancellation
uses a controlled pending browser request, followed by actual deterministic backend
chat. Real provider cancellation is tested separately over Uvicorn. Neither is
live provider, audio, physical keyboard or packaged desktop acceptance.

For a separately approved live-provider rehearsal, record the actual Stop click,
text increments before it, browser transport closure and backend cleanup as
separate observations. A closed SSE connection or a restored composer does not
prove that the upstream provider stopped generating or billing. Preserve failed
and interrupted attempts in both the evidence and the request budget; verify saved
messages before claiming a completed turn survived reload.

The active Library pose journey previews the tracked `shy-finger-poke` gesture
on a real sample avatar. It checks a visible canvas, advancing pose time, resolved
skeleton bones, all three current clip events, the eye effect and sparkle scene,
plus protected resource responses. Screenshot and observation attachments retain
the rendering evidence; the known single unresolved sample-avatar bone is allowed.
The brief light-streak event must fire, but its active visibility is outside this
pose check. The test permits only reads and gesture-preview preparation requests;
it does not select an Anima through saved settings, chat, upload or play audio.
Optional Local Mixamo VRMA playback and imported animation acceptance remain
separate. Run this focused check on an already initialized named stack with the
tracked avatar inputs:

```bash
pnpm e2e:test -- --project chromium --no-deps --grep "accountless built-in pose playback"
```

This focused pose check is not part of the generated structural-avatar fixture's
acceptance claim; it requires the real tracked avatar and built-in pose content.

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
  --display-name "Browser Test" \
  --profile-name "Browser Test Updated"
```

After restarting the same named stack with its saved environment, use `--setup existing` and
the same `--profile-name`. That mode requires the custom Anima, chat history,
private file, completed first run, and personalization to have survived. Fresh
named setup first verifies that missing, null, and blank names are rejected;
`--setup` accepts only `name` or `existing`. No additional stack is
needed to verify name validation. Root launch should open the last visited
owned Anima, or Annie on a fresh installation.
Output contains only bounded pass/fail booleans and counts, never principal or
credential values.

## Main-Stack Journey

From the repository root, start or restart the main local stack:

```bash
./reset.sh
```

Open `http://localhost:8000`. An installation whose first run is incomplete
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
cookies, desktop-control credentials, private headers, storage locators, or
principal values. Prefer bounded booleans, counts, response status, and hashes
when proving persistence or token rotation. Do not record private file bodies or
semantic memory contents unless the fixture was created expressly for the run.

Every stateful journey must identify its selected stack and resources it created
before cleanup; automated journeys require the exact named fixture described
above. A display name or guessed ID never grants deletion
authority. If ownership evidence is incomplete, stop and leave the resource for
manual review.

## Troubleshooting

- Use the selected application origin, normally `localhost:8000`; Vite's
  internal container port is not an additional public endpoint.
- In development FastAPI stays private. In built mode FastAPI is the application
  listener and Vite is absent. PostgreSQL stays private in both selections.
- Source the correct stack record before project-scoped inspection or restart;
  it includes the development/production Compose graph.
- If the installation singleton is missing while owner data exists, the stack
  must stay failed closed until a coordinated backup is restored.
