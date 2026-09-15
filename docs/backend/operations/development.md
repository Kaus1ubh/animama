# Development And Operations

> `reset.sh` publishes one loopback
> application service: FastAPI serving React in built mode, or Vite forwarding
> application routes to private FastAPI in development. PostgreSQL and other
> infrastructure remain private. Opt-in `dev-tools` adds loopback pgAdmin/Dozzle.
> One migration-generated principal owns local data; no account is required.
> FastAPI validates browser metadata and derives ownership from completed bootstrap.

This page collects backend-local commands and operational guidance. Run commands
from the repository root unless a command says otherwise.

## Install

```bash
make sync
```

This uses
`uv sync --extra server --extra voice --extra viz --extra realtime --extra encrypt --all-packages --group dev`.
It intentionally excludes the file-worker parser stack. Run the worker with
`--extra file-worker` when testing the parser directly on the host.

## Shared Backend Package

The backend wheel contains both the public local implementation and reusable
`animama.domain`/`animama.app` APIs. Shared imports receive owner IDs, policy, and
storage/model ports explicitly and cannot import local composition or read
installation state. Verify the transitive import graph and build the wheel:

```bash
uv run --no-sync python scripts/repository-boundary/check-python-imports.py
uv build --wheel
```

The animation manifest and VFX catalog keep their canonical sources at
`src/frontend/web/src/assets/vrm/animations/manifest.json` and
`src/frontend/web/src/assets/effects/vfx/catalog.json`. The generated copies in
`src/backend/animama/resources/` are packaged into the wheel and frozen runtime;
shared code accesses them through `importlib.resources`, without walking source
directories or importing desktop helpers. After changing a canonical JSON file:

```bash
uv run --no-sync python src/backend/packaging/shared_catalogs.py --write
```

The Hatch build hook checks byte equality and rejects missing inputs or stale
copies during wheel and editable builds. Docker copies the hook and canonical
inputs before dependency installation. Keep the copies committed and do not
edit them independently. The repository's packed-artifact check installs the
wheel outside this checkout and runs
`scripts/repository-boundary/consumers/backend.py`, exercising two independent
owners through real shared bootstrap/chat services with fake ports.

## Run The API

Common local development command:

```bash
uv run python -m animama.server.native_entrypoint
```

When running Vite directly on port 8000, start the backend separately with
`ANIMAMA_LOCAL_API_PORT=8001 uv run python -m animama.server.native_entrypoint`.
Keep `ANIMAMA_PUBLIC_ORIGIN=http://localhost:8000`; Vite proxies to
`http://127.0.0.1:8001` by default (`ANIMAMA_API_PROXY_TARGET` overrides it).
Compose configures its private proxy target automatically.

This supported native launcher validates `ANIMAMA_LOCAL_BIND_HOST` and refuses
non-loopback values before starting Uvicorn. It uses application port 8000 by
default; `ANIMAMA_LOCAL_API_PORT` changes the port. Set `ANIMAMA_PUBLIC_ORIGIN`
to the exact browser origin, and `ANIMAMA_WEB_ROOT` to an absolute built React
root when serving the UI here. An unset/blank web root leaves frontend serving
to development Vite. No gateway credential is required.

`python -m animama.server.compose_entrypoint` binds container port 8000. Built
Compose publishes that application port on loopback; development keeps it
private and publishes Vite. All supported launchers use the reviewed bounded
HTTP/WebSocket transport described in [Local HTTP components](local-http-components.md).

## Database

Run database bootstrap (migrations followed by idempotent catalog seeds):

```bash
uv run python -m animama.server.db_bootstrap
```

For a schema-only operation, run migrations directly:

```bash
uv run alembic upgrade head
```

Create a new migration after model changes:

```bash
uv run alembic revision --autogenerate -m "describe change"
```

The local Alembic graph owns extension creation and the complete accountless
schema and contains no hosted identity tables. Animama Cloud uses a separate
migration history and app composition.

Alembic revision `baseline_20260908` is the frozen current local schema in
`alembic/versions/0001_baseline.sql`. The baseline creates installation settings
and generates one UUIDv4 owner; it never imports live ORM metadata. Keep the
baseline fixed and use reviewed forward revisions for subsequent model changes.

A database or backup stamped with an unsupported pre-baseline revision needs
its matching checkout, or an explicit reset of disposable development data. `alembic upgrade head` cannot bridge this
boundary, and `alembic stamp` must not be used to pretend an old schema matches.
Ordinary startup does not reset a database.

Ordinary `./reset.sh` retains the database and owner; it does not resolve an
unknown old revision. `./reset.sh --purge` is broader than a database reset:
it also deletes Local content and private data, so do not use it when those
files must survive. For a database-only reset, stop this stack's application
writers, recreate only its application database, and then run the ordinary
bootstrap/reset workflow. Verify the exact Compose project and database first.
The replacement database generates a new owner and loses its chats, settings,
memory and live Anima definitions. Preserved Local files can be rescanned under
the new installation owner; private upload bytes alone do not restore their
removed database records. Preserve a coordinated backup with the old checkout
whenever any of that state is worth retaining.

Post-schema SQL seeds live under `alembic/seeds/`; they are separate from the
one-time revisions in `alembic/versions/`. The optional pgAdmin service reads
its server registration from `alembic/pgadmin-servers.json`.
`01-seed-model-providers.sql` idempotently upserts the built-in model-provider
catalog after Alembic creates its table; `02-seed-avatars.sql` retains the
idempotent avatar seed policy. `reset.sh` invokes
`python -m animama.server.db_bootstrap --quiet` in its one-shot backend container.
The same shared service runs native and packaged bootstrap, holding an advisory
lock across Alembic and the ordered seed files. PostgreSQL has no application
init-script mount: extensions belong to Alembic, and these data-only seeds run
after the schema exists. Accountless installation bootstrap and the content
rescan remain later reset steps. See the
[data model](../architecture/data-model.md) for the current schema contract.

## Embedded Desktop Runtime

The macOS desktop supervisor uses the same accountless backend and migrations,
packaged as `animama-runtime`. It starts its own private native PostgreSQL and
FastAPI processes without Compose. This does not change the main development
stack at `http://localhost:8000`. Native acceptance uses the exact staged core
and owned child; signed release, minimum-OS, clean-machine and user acceptance
are separate gates.
The canonical operator reference is [Embedded desktop operations](desktop-runtime.md),
with [user recovery guidance](../../frontend/desktop/troubleshooting.md).

The frozen command surface includes `database provision`, `database inspect`,
`database bootstrap`, `serve`, `content rescan`, and `worker avatar-cleanup`.
The separate `worker user-files` command returns `feature_unavailable` without
the verified optional pack. With it, the command rechecks the fixed helper path
and executable digest before delegating to its independently frozen process.
No credentials are passed in argv and core never imports Docling as a fallback.

The supervisor supplies these additional private settings:

| Setting                                 | Contract                                                                                     |
| --------------------------------------- | -------------------------------------------------------------------------------------------- |
| `ANIMAMA_DESKTOP_PGDATA`                | Expected owned data directory; database commands compare `SHOW data_directory` before writes |
| `ANIMAMA_DESKTOP_CONTROL_TOKEN`         | Per-launch secret for private desktop readiness, separate from the renderer capability         |
| `ANIMAMA_DESKTOP_RENDERER_CAPABILITY`  | Distinct per-launch renderer admission cookie, installed only by main                          |
| `ANIMAMA_PUBLIC_ORIGIN`, `ANIMAMA_WEB_ROOT` | Saved loopback application origin and verified packaged React root                       |
| `ANIMAMA_PROCESS_START_TOKEN`         | Fresh child UUID returned with its PID in private readiness                                   |
| `ANIMAMA_PARAKEET_MODEL_MOUNT_JSON`    | Optional bounded verified desktop model inventory                                             |
| `ANIMAMA_DESKTOP_BUILD_ID`              | Expected staged build ID, returned in private readiness                                      |
| `ANIMAMA_INCLUDED_CONTENT_SOURCES_JSON` | Bounded ordered array of immutable `{id, version, root, pack_id}` sources; core first        |
| `ANIMAMA_LOCAL_CONTENT_ROOT`            | Explicit writable Local root; valid only with Included source configuration                  |
| `ANIMAMA_USER_FILE_PROCESSING_ENABLED`  | Desktop sets true only for an active verified document pack; self-host default is true       |
| `ANIMAMA_DOCUMENT_WORKER_INSTANCE_ID`   | Expected worker instance for capability heartbeat matching                                   |
| `ANIMAMA_DOCUMENT_PACK_VERSION`         | Opaque active document-pack version for private removal checks                               |
| `ANIMAMA_PARAKEET_STT_ENABLED`          | Desktop sets true only for a verified Parakeet mount; self-host default is true              |
| `ANIMAMA_PARAKEET_ASSET_VERSION`        | Opaque version for same-origin model caching; null for ordinary development assets           |
| `ANIMAMA_DOCLING_ARTIFACTS_PATH`        | Worker-only fixed packaged Docling model directory                                           |

`ANIMAMA_DATA_ROOT` still holds private files. Included roots must already exist,
be absolute, contain no symlink ancestors, and be disjoint from each other and
the writable roots. Initialization neither creates nor write-probes them.
Core has ID `core` and no pack ID; the only optional Included source is the
`expanded-included-content` pack. Source configuration is supplied by
main, never a renderer or an arbitrary uploaded manifest. Only Local is watched.
When these settings are absent, the existing Docker root behavior is preserved.

Database bootstrap retains the advisory lock across packaged Alembic migrations
(including extension creation) and idempotent SQL seeds. It reports actual
PostgreSQL, pgvector, previous/current schema heads, seed versions, and the principal. An
existing installation-settings table without its principal fails closed.
Desktop provisioning can create only the fixed `animama` database at a verified
loopback cluster. Backend readiness is not accepted until its build, schema,
and principal agree with the supervisor and Included reconciliation succeeded.
Private `/_desktop/feature-packs/{id}:removal-check` covers references, leases,
content operations, and running document jobs. Every private control requires
the separate token. Pack changes destroy product windows and show independent
recovery before `POST /_desktop/runtime:quiesce` closes admission and drains
active work. A bounded `runtime_busy` response blocks pointer changes. FastAPI
restarts on the same saved origin; the supervisor verifies the exact child PID,
start token, build, schema and principal before recreating product windows.
Failed transitions restore the prior configuration. See the
[capability API](../architecture/http-api.md#optional-runtime-capabilities).

The document pack is executable release code: a macOS Developer ID identity,
pinned Team ID/requirement, and notarization profile are required even when
testing the unsigned core app. Inventory and OS publisher verification precede
every worker launch. Build prerequisites and commands live in the
[staging guide](../../frontend/desktop/runtime-staging.md).

The macOS user-data root is `~/Library/Application Support/Animama`. Quit the app
before backing up its database, encrypted vault, `content/local`, and `data`
together. The vault's OS encryption may require the original login keychain;
copying a vault alone does not guarantee recovery on another machine. Verified
custom-format dumps in `backups/pre-migration` protect upgrades but are not a
full filesystem/vault backup. Snapshot retention keeps the newest snapshot,
all failed or interrupted attempts and unknown entries; it may prune older known-successful
snapshots after two distinct successful app launches. Retry and provider
restarts do not advance that count. Never delete the database,
vault, or principal to work around a startup error. Retry preserves all three.
See the [desktop guide](../../frontend/desktop/overview.md) for
saved-port and stale-child recovery, paths, logs, and provider-key changes.

## Self-Hosted Local Roots

The self-host/development composition remains the Docker web stack, optionally
opened through unpackaged `desktop:dev`. Packaged desktop uses the separate
owned lifecycle above. Docker typed content is rooted at
`ANIMAMA_CONTENT_ROOT`; private non-portable files are rooted at the disjoint
`ANIMAMA_DATA_ROOT`. Docker mounts these logical paths as:

```text
/var/lib/animama/content/included  read-only application content
/var/lib/animama/content/local     read-write managed/inspectable content
/var/lib/animama/data              read-write private user files
```

The default checkout stores the writable directories at `content/local` and
`data`. Named stacks use `.animama-stacks/<compose-project>/...`, so two local
stacks never share state. `reset.sh` creates the allowlisted typed directories
under Included/Local plus `data/staging/{uploads,imports,exports}` and
`data/internal/{operations,runtime,derivatives,reconciliation}`. It passes the
host UID/GID to FastAPI and worker containers, so service-created Local files
remain inspectable and writable by the host operator.

After Alembic, post-schema catalog seeds, and accountless installation
bootstrap, reset performs one authoritative catalog scan. Bootstrap and every
later scan first recover unfinished Local mutations under the source lock.
During normal operation, a watcher marks changed sources `scan_required` and
schedules authoritative reconciliation after a quiet window. Use the
authenticated `POST /v1/content:rescan` route to reconcile manual host changes
immediately.

A normal run preserves PostgreSQL and files:

```bash
./reset.sh
./reset.sh --name feature-a --base-port 8200
```

The destructive path is explicit and stack-scoped. It prints every target,
refuses custom host-path overrides, removes only the selected Compose volumes
and derived Local/private roots, then starts a clean installation:

```bash
./reset.sh --purge
./reset.sh --name feature-a --base-port 8200 --purge
```

No account, email, password, or session is created. A purge creates the
installation principal in the migration and runs idempotent owner bootstrap;
an ordinary run preserves both the database principal and local content.

### Compare the production browser build

Set this non-secret option in the repository-root `.env`:

```dotenv
ANIMAMA_WEB_BUILD_MODE=production
```

The built Docker target compiles optimized React assets and copies them to
`/opt/animama/web`. FastAPI serves those files and the API from the same
loopback application origin; no Node or Vite server runs in this graph.
The existing browser Parakeet directory is a separate read-only static mount.
This selects build delivery, without adding accounts or network authentication.

Apply the selection with an ordinary reset, which preserves state:

```bash
./reset.sh
```

For a named stack, retain its explicit `--name` and `--base-port`. Reset selects
the matching Compose files and waits for the actual published application.
Source `.animama-stack.env` before later project-scoped Compose commands so
those commands use the same graph. A cold image build takes longer than HMR.
Built assets do not apply source edits live; rebuild the selected backend image
with `./reset.sh --build animama-server` after changing them.

To return to development/HMR, set `ANIMAMA_WEB_BUILD_MODE=development` and run
an ordinary reset. This selects the development override: Vite owns the public
listener and proxies a closed route set to private FastAPI, preserving original
browser request metadata. Neither switch needs a purge. The tracked `.env.example`
default remains development; root `.env` survives either reset mode.

Application inspectors default off. Opt in with
`VITE_ENABLE_DEBUG_PANEL=true` only when running the development build; normal
production and `embedded-desktop` builds exclude debug imports even with this
input. This does not disable browser DevTools or the separate pgAdmin/Dozzle
profile. Preserve the existing `COMPOSE_PROFILES` selection during a restart.

For comparable loading measurements, warm one browser profile, then open new
tabs with **Disable cache unchecked**. Fingerprinted build JS/CSS should come
from cache without a server request, although HAR may still contain a row for
each file. Record a separate run with **Disable cache checked**. HTML remains
revalidated, the complete runtime manifest is gzip-compressed with a fresh
lease, and private avatar/content files still perform authorization-aware
revalidation. Do not remove those checks to improve the request count.
After rebuilding, ordinary navigation loads current HTML/fingerprints. An old
tab that requests a removed chunk gets a real 404 and an explicit **Reload
page** recovery action; save work first. No purge or cache deletion is required.

### Backup and restore

Back up PostgreSQL, `content/local`, and `data` as one consistency unit:

```bash
./scripts/backup-local.sh
./scripts/backup-local.sh --output /safe/backup/directory
```

The script validates the selected Compose project, quiesces currently running
application services while PostgreSQL stays available, creates a custom-format
database dump plus Local/data archives and SHA-256 inventory, then restarts only
the services it stopped. The default output is the ignored `backups/`
directory. Included content, browser/HTTP caches, model caches, environment
secrets are intentionally excluded. The
PostgreSQL dump includes `installation_settings`, so restoring it preserves the
installation principal and every existing owner ID.

For a named stack, either name it directly or source/pass its generated env:

```bash
./scripts/backup-local.sh --name abc
./scripts/backup-local.sh --stack-env-file .animama-stack.env
```

Restore is explicit and destructive to the selected live state:

```bash
./scripts/restore-local.sh backups/animama-animama-YYYYMMDDTHHMMSSZ.tar.gz --confirm
./scripts/restore-local.sh BACKUP.tar.gz --name abc --confirm
```

Restore verifies archive paths and checksums, quiesces application services,
retains the current database/Local/data in
`backups/restore-rollbacks/<stack>-<timestamp>`, replaces the selected state,
runs `alembic upgrade head` while application services are stopped, requires
the restored installation principal, performs an
authoritative Content rescan, and restarts the prior services. If migration,
principal validation, or rescan fails after replacement begins, application
services remain stopped and the rollback bundle is reported. Use an application
version compatible with the dump and matching Included files. Copy deployment
secrets separately through a secret manager; a backup intentionally does not
contain `.env` or API keys.

Browser memory and ordinary HTTP caches are disposable. Clearing them only
causes the next preview/remount to fetch from FastAPI again.

### Factory reset and ownership recovery

Users never need to re-clone the repository to reset an installation. A normal
`./reset.sh` preserves state. `./reset.sh --purge` prints and removes only the
selected stack's PostgreSQL volumes, Local files and private data, then starts
a fresh installation and principal. Self-host startup requires no application
token. Existing gateway-token files confer no authority and are never read by
the application.

If `installation_settings` is missing or its principal is malformed while
owner-scoped rows still exist, do not generate a replacement. FastAPI and the
restore rescan fail closed. Restore a coordinated database/filesystem backup or
the reported pre-restore rollback bundle. Only an explicit full purge may
create a different installation and principal.

### Custom roots, permissions, and disk full

Set `ANIMAMA_LOCAL_CONTENT_HOST_PATH` and `ANIMAMA_DATA_HOST_PATH` before
startup to use custom host locations. They must be distinct from each other and
Included, mounted on a filesystem that supports atomic rename, and writable by
the configured `HOST_UID:HOST_GID`. `reset.sh --purge` deliberately refuses
custom roots; remove them only with an explicit operator-managed procedure.
Pass the same environment or `--stack-env-file` to backup/restore.

If files appear owned by another account, stop the stack, verify the exact
configured roots, and correct only those roots to the host UID/GID before
restart. Never recursively change ownership of the checkout root or `/`.

On disk-full or interrupted Save, Delete, or Import, publication journals and
original-file backups remain recovery authority. Free space, restart if needed,
then run Rescan and inspect catalog diagnostics. Recovery keeps a committed
mutation and restores an uncommitted one before admitting files. A lost Save or
Import response can be retried with the identical operation ID and request to
obtain the original success; replay never repeats a write after later edits or
deletion. Delete has no client retry key and keeps its expected-revision behavior.

`content_recovery_conflict` means a later manual edit prevents safe restoration.
Stop other writers and preserve the current files, the exact
`data/internal/operations/mutation-*.json` journal, and its
`content/local/.animama-mutations/<journal-id>/` originals. Copy manual edits to
a separate safe location before restoring affected paths to their recorded
pre-mutation state. For a path originally absent, preserve the new file outside
the Local entry. Run Rescan again to finish recovery, then reapply desired
manual edits and rescan. Do not delete journals or backups to suppress the error;
unreadable or missing recovery evidence requires deliberate operator repair.

Private user files, mutation receipts, active staging, and original-file backups
are not generic cache-cleanup targets. Preserve PostgreSQL, Local, and private
data together when backing up an interrupted installation.
Size free space for the incoming file/package, validation spool, and a
coordinated backup or restore rollback.

## Self-Hosted Local Boundary

The local composition has exactly one migration-generated installation
principal and no local account system or built-in network authentication.
The native FastAPI launcher rejects non-loopback bindings. Built Compose
publishes FastAPI at `127.0.0.1`; development publishes Vite and keeps FastAPI
private. The explicit `dev-tools` profile adds only pgAdmin and Dozzle on literal
loopback; PostgreSQL and other infrastructure use private-network connectivity. The rendered Compose preflight rejects wider bindings, unexpected
ports/services, and occupied ports outside this project before stopping the stack.

Remotely reachable self-hosting requires TLS and authentication in an
operator-owned VPN, tunnel or reverse proxy before the loopback application.
FastAPI validates the exact configured public Host and Origin, but Animama
cannot verify the outer authentication policy. Every admitted request acts as
the same installation owner. External identity headers never establish a
principal or create additional local users.

The accountless local UI and its Compose/reset and HTTP boundary are
runnable. There is no account
claim/adoption command, API-key provisioning script, or data-preserving
migration from development accounts. A full purge creates a new principal;
an ordinary restart retains it and opens the completed product journey.

The frozen `0001_baseline.sql` includes `chats.openai_previous_response_id`,
the scoped `memory_entries` tree, append-only `memory_entry_versions`, their
`version` and `description` columns, and the Avatar identity/Anima schema.
Fresh databases receive these through Alembic, not dynamic ORM metadata
creation. Databases from the earlier pre-public reset-shape iterations require
the fresh-reset boundary described above; current schema changes must use
forward revisions rather than editing the baseline or adding ad hoc tables.

The current baseline creates the neutral Content Catalog, typed
`anima_loadouts`/`anima_content_bindings`, and
`anima_runtime_snapshots.admitted_item_revisions` directly. It contains no
release/blob/upload transition tables or `anima_runtime_file_memberships`.
Runtime snapshots freeze selected catalog item revisions for chat and authorize
files through their canonical `content_catalog_files` registrations. Historical
stepwise-upgrade fixtures are replaced by fresh-install, final-schema-equivalence
and bootstrap-idempotency coverage.

## Synthetic Context Seed

Use `scripts/seed_synthetic_context.py` to create repeatable local markdown
memory files, with an optional visible synthetic chat for the installation
owner and an owned Anima. This is useful when testing `/a/memories?tab=uploads`,
`POST /v1/memory/debug/search-memory-files`, `POST /v1/files/debug/search`, and
live `search_memory_files` or `search_uploaded_files` behavior without manually
chatting first.

To seed only user-level memory files, no anima ID is needed:

```bash
uv run python scripts/seed_synthetic_context.py \
  --user-id USER_ID \
  --memory-only \
  --prefix memory-search-demo
```

To also create a visible synthetic chat, pass an owned anima ID:

```bash
uv run python scripts/seed_synthetic_context.py \
  --user-id USER_ID \
  --anima-id ANIMA_ID \
  --prefix memory-search-demo
```

The script writes user-scope memory files at `profile.md`,
`notes/projects.md`, and `notes/preferences.md` through
`MemoryEntryService.put_file_by_path(...)`. Existing files at those paths are
updated by version. It creates or reuses a deterministic chat ID derived from
`--prefix`; if that chat already has visible messages, reruns skip chat seeding
unless `--append-chat` is supplied. `--anima-id` is only required when chat
seeding is enabled.

## Memory Manager Tracing

Live Memory Manager invocations use the OpenAI Agents SDK's built-in tracing.
Each SDK invocation creates its own trace with workflow name
`Animama memory manager`; all invocations for one manager conversation share
the Memory Manager run ID as their trace group ID. Trace metadata is limited to
the manager run ID, runtime name, and model name.

Generation and tool input/output payloads are excluded with
`trace_include_sensitive_data=False`. This keeps user messages, memory file
contents and paths, and patch diffs out of normal trace payloads while retaining
agent, generation, tool, timing, and lifecycle spans. There is intentionally no
Animama setting to opt into sensitive payload capture.

Tracing is enabled by default when the SDK has an OpenAI API key. To disable all
Agents SDK tracing for a local or deployed process, set the SDK's native global
opt-out before starting the API:

```bash
export OPENAI_AGENTS_DISABLE_TRACING=1
```

Organizations operating under OpenAI Zero Data Retention must keep tracing
disabled because the Agents SDK tracing service is unavailable under ZDR.

To verify a normal local run:

1. Configure `OPENAI_API_KEY`, ensure `OPENAI_AGENTS_DISABLE_TRACING` is unset,
   and start the API.
2. Send two messages in the same Memory Manager run and approve or reject one
   proposed diff.
3. Open the [OpenAI Traces dashboard](https://platform.openai.com/traces), find
   workflow `Animama memory manager`, and confirm that the separate invocation
   traces share the manager run ID as their group.
4. Confirm agent, generation, and tool lifecycle spans are present but the user
   message, memory content, and patch diff are absent.

The SDK batch processor exports in the background every few seconds and flushes
at process exit. The request path does not call `flush_traces()`, so a completed
invocation may take a short time to appear in the dashboard.

## Synthetic Documentation Upload Files

Use `scripts/generate_synthetic_docs.py` to combine current non-plan backend and
frontend documentation into a searchable Markdown, PDF, or DOCX file. The
artifacts are local fixtures for exercising the normal upload, processing,
debug-search, and attached `search_uploaded_files` flow. The script does not
upload or process the generated file.

Run it without selection flags for interactive prompts:

```bash
uv run python scripts/generate_synthetic_docs.py
```

For repeatable automation, provide both choices explicitly:

```bash
uv run python scripts/generate_synthetic_docs.py \
  --format pdf \
  --size large
```

The `xxsmall`, `xsmall`, `small`, `large`, and `full` presets currently select
approximately 0.04 MB, 0.08 MB, 0.17 MB, 0.33 MB, and 0.67 MB of UTF-8 source
text. `xxsmall` and `xsmall` are curated to remain about one quarter and one
half the size of `small`. `full` includes every Markdown file below
`docs/backend` and `docs/frontend` except files below a `plans`
directory. Artifact sizes vary by format. Output defaults to the ignored
`artifacts/synthetic-user-files` directory; use `--output-dir PATH` to override
it. Rerunning the same format and preset atomically replaces its prior artifact.

## Offline OpenAPI Export

The local HTTP boundary deliberately hides FastAPI documentation at
`/openapi.json`. Export the local composition deterministically without a
running stack:

```bash
uv run python -m animama.server.export_openapi --output /tmp/animama-openapi.json
```

The exporter writes atomically. The frontend `pnpm openapi-ts` wrapper manages
its own temporary schema, passes it to the generator, and removes it on success
or failure; normal client generation should use that wrapper.

## Tests

Backend tests live in `tests/`. The test suite uses pytest and testcontainers
for PostgreSQL/pgvector.

```bash
make test
make test-q
make test-v
make test-cov
```

Direct pytest is also used often:

```bash
uv run pytest -q
```

Useful focused examples:

```bash
uv run pytest -q tests/test_direct_chat_turn_executor.py tests/test_direct_chat_model_clients.py tests/test_model_client_registry.py
uv run pytest -q tests/test_anima_chat_sse.py tests/test_anima_sse_events.py
uv run pytest -q tests/test_anima_chat_profile.py tests/test_anima_loadouts_api.py
uv run pytest -q tests/test_memory_files.py tests/test_memory_files_api.py
uv run pytest -q tests/test_user_file_uploads.py tests/test_user_file_processing.py tests/test_user_file_worker.py
uv run pytest -q tests/test_emotions.py
```

The PostgreSQL-backed sparse Starter scale fixture is opt-in because it creates
2,000 Animas and measures relation, WAL, write-time, and query-plan evidence:

```bash
ANIMAMA_RUN_ASSET_SCALE_BENCHMARK=1 \
  uv run pytest -q -s tests/test_anima_loadouts.py
```

Use the first two commands when changing `chat:sse`, direct-turn persistence,
model-client stream events, OpenAI adapter finality, route-owned completion,
or SSE formatting.

## Load Testing

The checked-in Locust scenarios use the public accountless application origin. Each
simulated user asks the installation bootstrap to converge, resolves a current
catalog-backed Anima specification, and then exercises creation or the current
`chat:sse` path. The browser-facing origin defaults to
`http://localhost:8000`; override it only with another loopback application origin:

```bash
ANIMAMA_LLM_SKIP=1 ./reset.sh
LOADTEST_ANIMAMA_ORIGIN=http://localhost:8000 \
  PYTHONPATH=. uv run python -m locust -f tests/loadtest/locustfile.py
```

`ANIMAMA_LLM_SKIP=1` gives the running backend deterministic local model
clients, so chat load checks do not call a provider. The workload never creates
credentials, sends bearer or test-user headers, or targets a private container endpoint.
Use a named stack's generated `ANIMAMA_PUBLIC_ORIGIN` for isolated runs.

## Lint, Format, And Types

```bash
make lint
make mypy
make format-check
make check
make check-test
```

`make check-test` is the broad local verification target when a backend change
touches behavior and time allows.

## Runtime Snapshot Diagnostics

`GET /v1/animas/{anima_id}/runtime` persists one owner-scoped snapshot for the
effective loadout revision. Structured logs may include bounded outcome and
count fields, but must not include usernames, filenames, semantic selectors,
catalog/file IDs, storage locators, URLs, or other owner/resource identifiers.

Runtime file authorization distinguishes success, unknown or expired revision,
foreign membership, missing file, and storage failure. Chat setup uses the same
persisted snapshot and returns `runtime_remount_required` before model work when
the issued revision is no longer usable. Frontend diagnostics use bounded safe
reasons for preload/fetch failure, autoplay blocking, catalog disposal, and
explicit route remount.

## Workers

Creator content has no staged object/finalization cleanup worker. Direct Save
uses bounded adjacent temporary files and descriptor-last publication. Save,
Delete, and Import share a catalog-owned transaction and recoverable filesystem
journal. Immutable original success results live in
`content_mutation_receipts`; journals live under `data/internal/operations` and
originals under `content/local/.animama-mutations`. The startup/explicit
reconciler is:

```bash
uv run python -m animama.server.content_cli
```

It resolves committed or interrupted journals before scanning readable
Included/Local files through the one Content Kind registry, recomputes exact
digests and dependencies, and marks malformed or missing entries inert. A
recovery conflict stops admission while retaining both versions. `reset.sh`
invokes the containerized form after Alembic and
principal setup. Runtime/preview leases are internal database state and are
cleaned by their owning application lifecycle rather than an object-delete
outbox.

Avatar upload cleanup remains only for the retained non-content staging record:

```bash
uv run python -m animama.workers.avatar_upload_cleanup
```

User-file processing:

```bash
uv run --extra file-worker python -m animama.workers.user_file_processing
```

Workers need the same database configuration as the API.

## Docker Compose

`docker-compose.yml` includes PostgreSQL, pgAdmin, the anima server, the
user-file parser worker, frontend services, voice/profile services, and optional
observability services. The optional `obs` profile retains its local
`observability/` configuration so self-host installations can use it without a
Cloud checkout. Core startup does not require that profile. Local logging and
shared instrumentation remain available independently. No object-storage service
is required. Check active
profiles and environment variables before assuming every service starts by
default.

The `dev-tools` profile is the only infrastructure publication exception:
pgAdmin and Dozzle can be reached through localhost browser ports as described
below. Other observability services stay private even with `obs` enabled. Do
not add extra host ports for the private API, PostgreSQL or other infrastructure.
Only the selected application listener is published.

### Local administration tools

On the main checkout, enable the two development tools without deleting data:

```bash
./reset.sh --profile dev-tools
```

| Tool | Default URL | Private connection |
| --- | --- | --- |
| pgAdmin | `http://localhost:5050` | PostgreSQL at `postgres:5432` |
| Dozzle | `http://localhost:9999` | Local Docker socket for container logs |

Both host bindings are fixed to `127.0.0.1`; there is no bind-address override.
The application remains at `http://localhost:8000`; neither tool is routed
through the product application or receives its desktop credentials. Open pgAdmin's configured server to
inspect the existing database, and select an Animama container in Dozzle to
view logs. Any pgAdmin/database credentials are infrastructure settings, not
Animama accounts. Saved pgAdmin preferences remain in `pgadmin-data`.

Set `PGADMIN_PORT`/`DOZZLE_PORT` in root `.env` or the environment to choose other
ports. The script reports and writes the effective tool URLs/ports to
`.animama-stack.env` only while enabled. With `--base-port B`, the application uses B,
pgAdmin B+4, and Dozzle B+20, taking precedence over inherited port overrides.
For example, `./reset.sh --name feature-a --base-port 8200 --profile dev-tools`
uses ports 8200, 8204, and 8220. Use the reported localhost admin URLs even when
the application uses a named `.localhost` hostname. An occupied or invalid
port fails preflight before stopping containers; choose another port rather
than killing an unidentified listener.

You can retain `COMPOSE_PROFILES=dev-tools` in `.env`, or source the generated
stack environment before the next restart. Additional `--profile` selections
are combined with the current profiles. `obs` alone does not start either tool.
To disable all optional profiles explicitly on the main stack:

```bash
COMPOSE_PROFILES= ./reset.sh
```

If other profiles should remain, remove only `dev-tools`, for example
`COMPOSE_PROFILES=obs ./reset.sh`. Omitting the CLI flag alone does not disable
an inherited or `.env` profile. Also remove the persisted selection if future
fresh-shell starts should stay disabled. Reset stops this project's old tools
even when their profile is no longer active, closes their host listeners, and
preserves volumes, the principal, chats and files. Re-enabling restores
pgAdmin's saved state. Neither direction requires `--purge`, nor changes the
production/development build selection. Inspect only the intended project:

```bash
docker compose -p animama --profile dev-tools ps
docker compose -p animama --profile dev-tools logs --tail 50 pgadmin dozzle
```

These are privileged operator tools for a trusted development machine. pgAdmin
can modify the database, logs may contain private content, and Dozzle's Docker
socket is privileged access: a read-only filesystem mount does not make Docker
API operations read-only. Do not forward them through public/shared proxies or
tunnels, enable extra container-control permissions, or include them in
Electron bundles or hosted deployments. Loopback limits network
reachability; it is not a replacement for authentication on a shared host.

### Backend file logs

Local runs using the root `.env` and Docker Compose share the repository-root
`.animama-logs/` directory. Compose mounts it at `/var/log/animama`;
`reset.sh` prepares that directory and clears today's log during reset.
Daily files use `YYYY-MM-DD.log` names and are ignored by Git and Docker builds.

### Optional document worker

The current checked-in `animama-file-worker` service is commented out. A normal
reset starts the core stack but does not start document processing:

```bash
./reset.sh
```

Enable/configure the private worker service deliberately when testing parsing,
or run the host worker with the same database and private-file roots. Capability
`enabled: true` allows durable queuing but is not evidence that a worker is
running: inspect `GET /v1/runtime-capabilities` and project-scoped service state.
For named worktree stacks, use the named reset command and logs, for example:

```bash
./reset.sh --name abc --base-port 8200
docker compose -p animama-abc logs -f animama-server
```

The backend Dockerfile has separate final targets. `animama-server` installs the
server extra and intentionally omits Docling/parser dependencies. The
`animama-file-worker` target installs the full `docling` package and resolves
PyTorch through uv's explicit CPU-only `pytorch-cpu` index, avoiding CUDA
runtime packages in the worker image. Backend images copy the backend package,
migrations/init SQL, and shared animation/VFX catalogs. The server image also
receives the React output from a frontend build stage. The Docker context admits
those frontend build inputs while excluding desktop assets, installed dependencies
and private local files. Dependency or image changes are not built automatically by
plain `./reset.sh`; after restoring/configuring that service, rebuild it
explicitly when needed:

```bash
docker compose -p animama build animama-file-worker
./reset.sh --build animama-file-worker
```

The file worker requires the same database URL and `ANIMAMA_DATA_ROOT` mount as
the API. It reads installation-owned originals through the private filesystem port;
no R2/S3/MinIO endpoint, credentials, or bucket are required. User-file worker
tuning variables include
`ANIMAMA_USER_FILE_MAX_PROCESS_BYTES`,
`ANIMAMA_USER_FILE_PROCESSING_POLL_SECONDS`,
`ANIMAMA_USER_FILE_PROCESSING_BATCH_SIZE`,
`ANIMAMA_USER_FILE_PROCESSING_LEASE_SECONDS`,
`ANIMAMA_USER_FILE_PROCESSING_MAX_ATTEMPTS`,
`ANIMAMA_USER_FILE_DOCLING_TIMEOUT_SECONDS`,
`ANIMAMA_USER_FILE_DOCLING_ENABLE_OCR`,
`ANIMAMA_USER_FILE_DOCLING_DO_TABLE_STRUCTURE`, and
`ANIMAMA_USER_FILE_DOCLING_ACCELERATOR`. The commented Compose example gives the file worker
to `ANIMAMA_FILE_WORKER_CPUS=4.0` and `ANIMAMA_FILE_WORKER_MEMORY=4g`. Docling
CPU inference defaults to `ANIMAMA_USER_FILE_DOCLING_NUM_THREADS=4`, table
structure mode defaults to `ANIMAMA_USER_FILE_DOCLING_TABLE_MODE=fast`, and
startup warm-up defaults to `ANIMAMA_USER_FILE_DOCLING_WARMUP=true`. Docling
chunk sizing is controlled by `ANIMAMA_USER_FILE_CHUNK_MAX_TOKENS` and
`ANIMAMA_USER_FILE_CHUNK_TOKENIZER_MODEL`.

The worker records a heartbeat every five seconds; the API reports it stale
after twenty seconds. It also renews its running job lease independently of a
long parser call. Stop prevents further claims, preserves queued jobs, and
removes only that instance's heartbeat. The current baseline includes the
heartbeat table. Apply `alembic upgrade head` on a supported database before
starting an updated worker; old removed revisions require the explicit reset
boundary above. In the main stack,
use `docker compose -p animama exec animama-server alembic upgrade head`.

Memory filesystem content size is controlled by
`ANIMAMA_MEMORY_FILE_MAX_BYTES`, default `32768` bytes. This limit applies to
the UTF-8 byte length of each markdown memory file entry written through
`/v1/memory/entries`.

The main checkout keeps the default local application URL:

```bash
./reset.sh
```

This starts the default Compose project with `animama-server`, `postgres` and
the selected optional services. Development also starts `web` for Vite. Both
build modes retain one application URL:

```text
http://localhost:8000  local application
```

Only the selected application service is published on loopback. PostgreSQL
stays private, as does FastAPI when Vite owns the development listener.

### Parallel Worktree Dev Environments

Use this flow when testing multiple branches side by side. Each worktree gets a
separate Compose project, one loopback application port, network, and data volumes.

1. Create the branch and worktree from the main checkout:

```bash
git switch main
git pull
git branch feat/abc
git worktree add ../anima-worktrees/abc feat/abc
```

2. Pick an unused base port for that worktree. It assigns exactly one host
   endpoint:

```text
base + 0  loopback application
```

3. Start or reset the stack from the worktree root:

```bash
cd ../anima-worktrees/abc
./reset.sh --name abc --base-port 8200
```

The stack name becomes the Compose project `animama-abc`, so containers,
networks, and named volumes are isolated from the main checkout and other
worktrees. `reset.sh` also sets `ANIMAMA_CONTAINER_NAME_PREFIX=animama-abc-`
for named stacks so container names do not collide with the main checkout. The
base port assigns only the public application port; internal services retain fixed
Compose names and container ports:

```text
http://animama-abc.localhost:8200  local application
```

`reset.sh` writes `.animama-stack.env` in the checkout/worktree root with the
derived Compose project, selected Compose files, container-name prefix,
application port/public origin, private roots and `ANIMAMA_DESKTOP_WEB_URL`.
It contains no credentials or host database URL. Source it before
follow-up commands that need the generated stack settings:

```bash
source .animama-stack.env
```

From `src/frontend`, source the same file with:

```bash
source ../../.animama-stack.env
```

If `--base-port` is provided without `--name`, non-main worktree directories
infer the stack name from the directory basename. For example,
`../anima-worktrees/abc` becomes `animama-abc`. The main checkout directory
named `animama` keeps the default project name unless `--name` is provided.

Named stacks default to `animama-<name>.localhost` to keep browser state
separate between branches. If your local resolver does not handle
`*.localhost`, add a hosts entry or pass `--host localhost`, accepting that
localhost-scoped cookies can overlap between stacks.

Useful examples:

```bash
./reset.sh --name avatar --base-port 8200
./reset.sh --name runtime --base-port 8300 --build animama-server
COMPOSE_PROFILES=memory ./reset.sh --name memory --base-port 8400
```

Use project-scoped Docker commands after startup. Do not use bare
`docker compose down` while parallel stacks are running.

```bash
docker compose -p animama-abc ps
docker compose -p animama-abc logs -f animama-server
docker compose -p animama-abc down
```

For desktop shell testing against a worktree, source the generated env file
before launching Electron so `ANIMAMA_DESKTOP_WEB_URL` points at the worktree's
application origin:

```bash
cd src/frontend
source ../../.animama-stack.env
pnpm desktop:dev
```

Do not source that web-URL override for packaged desktop artifacts. Packaged
mode rejects `ANIMAMA_DESKTOP_WEB_URL` and starts its own runtime. Use an explicit
development runtime/data override only for unpackaged supervised tests; see
`docs/frontend/desktop/platforms.md`.

### Cleaning Up Worktree Stacks

When a worktree branch is no longer needed, tear down its Compose project before
removing the git worktree. From the worktree root:

```bash
source .animama-stack.env
docker compose -p "$COMPOSE_PROJECT_NAME" down -v --remove-orphans --rmi local
```

This removes that stack's containers, networks, named volumes, and locally built
Compose images. It does not remove shared pulled base images such as Postgres or
Node.

If `.animama-stack.env` is not available, pass the project name directly:

```bash
docker compose -p animama-abc down -v --remove-orphans --rmi local
```

Then remove the worktree from the main checkout:

```bash
cd /path/to/animama
git worktree remove ../anima-worktrees/abc
git worktree prune
```

If the branch is done, delete it after the worktree is removed:

```bash
git branch -d feat/abc
```

Use `git branch -D feat/abc` only when intentionally deleting an unmerged branch.
Avoid bare `docker compose down -v` while parallel stacks are running; always
target the intended Compose project with `-p`.

## Common Environment Variables

Core:

- `ANIMAMA_PUBLIC_ORIGIN` (exact public browser origin for HTTP admission)
- `ANIMAMA_WEB_ROOT` (absolute built React root; unset/blank for Vite development)
- `ANIMAMA_DESKTOP_RENDERER_CAPABILITY`, `ANIMAMA_DESKTOP_CONTROL_TOKEN`
  (paired private desktop inputs; absent in normal self-host)
- `ANIMAMA_PARAKEET_MODEL_MOUNT_JSON` (optional verified desktop model inventory)
- `ANIMAMA_DATABASE_URL`
- `ANIMAMA_DATABASE_POOL_SIZE`
- `ANIMAMA_DATABASE_MAX_OVERFLOW`
- `ANIMAMA_DATABASE_POOL_TIMEOUT_SECONDS`
- `ANIMAMA_DATABASE_POOL_RECYCLE_SECONDS`
- `ANIMAMA_DATABASE_POOL_PRE_PING`
- `ANIMAMA_LOCAL_BIND_HOST` and `ANIMAMA_LOCAL_API_PORT` (supported native
  FastAPI launcher only; Compose ignores them)
- `ANIMAMA_LLM_SKIP`
- `ANIMAMA_MODEL_CLIENT_TIMEOUT_SECONDS`
- `DEEPSEEK_API_KEY`
- `ANIMAMA_OPENAI_RESPONSES_COMPACTION_THRESHOLD_TOKENS`
- `ANIMAMA_DEFAULT_MODEL_PROVIDER_ID`
- `ANIMAMA_CHAT_TITLE_GENERATION_PROVIDER`
- `ANIMAMA_CHAT_TITLE_GENERATION_MODEL`
- `ANIMAMA_CHAT_TITLE_GENERATION_TIMEOUT_SECONDS`
- `ANIMAMA_CHAT_TITLE_GENERATION_REASONING_EFFORT`
- `ANIMAMA_CHAT_COMPACTION_ENABLED`
- `ANIMAMA_CHAT_COMPACTION_THRESHOLD_TOKENS`
- `ANIMAMA_CHAT_COMPACTION_PROVIDER`
- `ANIMAMA_CHAT_COMPACTION_MODEL`

Model providers:

- OpenAI provider keys/settings
- Gemini provider keys/settings
- LiteLLM provider settings where supported

Content storage:

- `ANIMAMA_CONTENT_ROOT` and `ANIMAMA_DATA_ROOT`
- `ANIMAMA_INCLUDED_CONTENT_HOST_PATH`
- `ANIMAMA_LOCAL_CONTENT_HOST_PATH`
- `ANIMAMA_DATA_HOST_PATH`
- content/package/file byte limits documented by the Content Kind registry and
  server configuration

Voice:

- ElevenLabs API key/settings
- `ANIMAMA_ENABLE_VOICE`
- realtime TTS intermediary settings

Check `server/config.py` for exact names and defaults before adding new
environment usage.

## Adding A Route

1. Put the route in the closest existing router or a new router under
   `server/routers/`.
2. Use `get_current_principal` for every local product route. Only the internal
   `/health` readiness probe is unauthenticated.
3. Prefer app services and repository ports for persistence.
4. Keep Pydantic request/response schemas near the router or established schema
   module.
5. Filter by `RequestPrincipal.id` through retained `user_id`/`owner_user_id`
   ownership columns.
6. Add tests for auth, ownership, success, and error behavior.
7. Include the router through `server/routers/__init__.py` if it is new.

## Adding Runtime Behavior

1. Model durable state in domain/app/ORM as needed.
2. Put direct chat orchestration in `app/chat` and use-case behavior in app
   services; keep HTTP delivery concerns in route helpers.
3. Emit supported typed SSE events for observable behavior.
4. Preserve the durable chat-run lifecycle, single-active-run enforcement,
   cancellation, and request-local cleanup.
5. Preserve incognito, memory-disabled, and suppressed-response options.
6. Add focused tests around direct chat, SSE events, and persistence side effects.

## Updating Docs

For backend behavior, update files in `docs/backend/` alongside code changes.
