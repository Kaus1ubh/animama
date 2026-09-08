# Embedded desktop backend operations

This is the macOS desktop composition of the same accountless backend used by
the local Compose stack. Electron supervises private PostgreSQL 16, the frozen
FastAPI application, upload cleanup and an optional independently frozen document
worker. Hono runs inside Electron main and serves the production React files;
there is no Vite server or external Python/Node installation in the installed app.
Signed release acceptance remains pending. Windows native packaging is deferred.

For end-user instructions use [Installation](../../../frontend/docs/desktop/installation.md)
and [Troubleshooting](../../../frontend/docs/desktop/troubleshooting.md). For
native builds use [Runtime staging](../../../frontend/docs/desktop/runtime-staging.md).

## Identity and service boundary

The `baseline_20260908` accountless baseline generates one durable
`installation_settings.installation_principal_id`. Bootstrap requires it;
the supervisor never fabricates a replacement when owner data already exists.
Existing `user_id`/`owner_user_id` columns retain that owner value. Backend
bootstrap idempotently ensures settings, profile and starters without overwriting
edits or deleted starter receipts. No local password or hosted identity is involved.

Hono alone accepts renderer application traffic: HTTP, SSE, WebSockets and
private bytes. It checks the exact authority, browser metadata and per-launch
HttpOnly renderer capability, strips client identity headers and asserts the
installation principal to FastAPI with a private service token. FastAPI and
PostgreSQL bind to separate loopback ports; direct browser requests are not a
supported path. Private `/_desktop` readiness/removal routes are never proxied.

The supervisor compares readiness against the exact app build, Alembic head,
principal and Included reconciliation. It retains child handles and stops only
its own processes. An occupied port or PID record does not establish ownership.
Provider changes and pack activation can restart consumers while preserving
PostgreSQL, the owner and saved Hono origin.

## Roots, secrets and private bytes

All paths below are relative to `~/Library/Application Support/Animama`:

| Path                     | Responsibility                                                                                 |
| ------------------------ | ---------------------------------------------------------------------------------------------- |
| `postgres/16/data`       | Private PostgreSQL cluster; database commands verify `SHOW data_directory`.                    |
| `secrets/vault.bin`      | OS-encrypted database password and configured provider keys; requires matching secure storage. |
| `runtime/state.json`     | Stable gateway port, not an authentication credential.                                         |
| `runtime/processes.json` | Owned-process evidence, never authority to kill a discovered process.                          |
| `runtime/logs`           | Redacted main and child diagnostics; review before sharing.                                    |
| `content/local`          | Writable typed library.                                                                        |
| `data`                   | Private uploads, staging and other non-portable application data.                              |
| `packs`, `downloads`     | Verified optional versions and bounded resumable downloads.                                    |
| `backups/pre-migration`  | Verified database snapshots and migration journals, not full backups.                          |

Core Included content is mounted read-only from the application's runtime
resources. Optional expanded Included content comes from an immutable verified
pack. Every catalog item/byte retains its exact source-mount identity. Roots
must be disjoint absolute paths without symlink ancestors. Only Local is watched;
the backend never creates or write-probes an Included root. React receives
registered byte descriptors, not arbitrary host paths or object-store URLs.

The gateway/control tokens and renderer capability are generated in main memory
for each app launch; they are not persisted in the vault or restored from a Compose
token file. The principal persists in PostgreSQL. Loss of per-launch tokens is
handled by a normal relaunch; a missing/unreadable vault alongside PGDATA fails
closed because its database password cannot be silently regenerated.

## Supervisor environment and frozen CLI

These are private composition inputs, not end-user configuration switches:

| Input                                                                                                             | Contract                                                                                                 |
| ----------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `ANIMAMA_DATABASE_URL`, `ANIMAMA_DESKTOP_PGDATA`                                                                  | Supervisor-owned loopback connection and expected cluster path. Never pass the password in argv or logs. |
| `ANIMAMA_INTERNAL_GATEWAY_TOKEN`                                                                                  | In-memory Hono/FastAPI assertion secret; the installed CLI supplies it to the local app factory.         |
| `ANIMAMA_DESKTOP_CONTROL_TOKEN`, `ANIMAMA_DESKTOP_BUILD_ID`                                                       | Separate private readiness credential and expected build.                                                |
| `ANIMAMA_INCLUDED_CONTENT_SOURCES_JSON`                                                                           | Ordered bounded `{id, version, root, pack_id}` sources, core first.                                      |
| `ANIMAMA_LOCAL_CONTENT_ROOT`, `ANIMAMA_DATA_ROOT`                                                                 | Writable Local and private-data roots.                                                                   |
| `ANIMAMA_PARAKEET_STT_ENABLED`, `ANIMAMA_PARAKEET_ASSET_VERSION`                                                  | Verified speech pack availability and exact asset version.                                               |
| `ANIMAMA_USER_FILE_PROCESSING_ENABLED`                                                                            | Whether the verified document pack is active; false in core alone.                                       |
| `ANIMAMA_DOCUMENT_WORKER_INSTANCE_ID`, `ANIMAMA_DOCUMENT_PACK_VERSION`                                            | Expected heartbeat instance and active version for lifecycle checks.                                     |
| `ANIMAMA_DOCUMENT_WORKER_EXECUTABLE`, `ANIMAMA_DOCUMENT_WORKER_ROOT`, `ANIMAMA_DOCUMENT_WORKER_EXECUTABLE_SHA256` | Fixed, verified helper delegation inputs; not browser-supplied.                                          |
| `ANIMAMA_DOCLING_ARTIFACTS_PATH`                                                                                  | Worker-only bundled model location.                                                                      |

The packaged `animama-runtime` command parser is in `animama/runtime/cli.py`:

| Command                                | Use                                                                                                                    |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `--version`, `audit-resources`         | Inspect frozen version/resources. The orchestrated audit disables runtime log files.                                   |
| `database provision`                   | Create only the fixed desktop database after owned `initdb`.                                                           |
| `database inspect`                     | Read versions, schema and principal from the verified owned cluster.                                                   |
| `database bootstrap`                   | Hold the bootstrap lock across packaged migrations (which own extensions) and idempotent seeds.                         |
| `serve --host 127.0.0.1 --port <port>` | Start private FastAPI under the supervisor's environment; non-loopback is rejected.                                    |
| `content rescan`                       | Reconcile registered roots for the required installation owner.                                                        |
| `content audit`                        | Resolve the actual starter closure at `ANIMAMA_DESKTOP_INCLUDED_ROOT`.                                                 |
| `worker avatar-cleanup`                | Owned upload cleanup process.                                                                                          |
| `worker user-files`                    | Delegate only to the fixed verified helper; absent inputs return `feature_unavailable`, never a core Docling fallback. |

These operations are not a recipe for connecting a second process to live
desktop data. Use the supervisor and documented stage/audit commands. Keep
resource inspection and mutation separate, and preserve ownership/manifest checks
for any support action. Build details are in the [packaging README](../../packaging/desktop/README.md).

## Optional worker and content transitions

`GET /v1/runtime-capabilities` separates availability from document-worker
liveness (`disabled`, `starting`, `ready`, `stale`). The worker renews its own
heartbeat every five seconds; a missing matching heartbeat becomes stale after
twenty seconds. Enabled work can queue durably while starting/stale. Disabled
processing rejects new process requests before enqueue; originals and existing
indexed chunks remain. See [User files](../features/user-files.md).

Pack removal checks running document leases, Anima/content references, preview
leases and content operations before and after quiescing. An atomic pointer
switch is followed by reconciliation/readiness; failure rolls back the previous
mount. Queued jobs remain for reinstallation. Desktop model/tokenizer resources
are packaged offline; remote provider stages still need their configured service.
The signed worker is verified on installation and every launch, even with an
unsigned development core. No unsigned-helper or arbitrary-path fallback exists.

## Migration snapshots and recovery

The single frozen `baseline_20260908` baseline replaces 13 unreleased
revisions. This one-time development consolidation deliberately has no forward
upgrade from those removed revision IDs. Preserve an old profile and its matching
app/checkout if its data matters; use a separate disposable fresh profile for
current native validation. Do not relabel an old database with `alembic stamp`,
automatically purge it, or treat its snapshot as restore-compatible with the new
history. Future supported schema changes use forward migrations from this fixed
baseline. See [Database operations](development.md#database) for the reset and
Local/private-file boundary.

Before upgrading an existing schema, the supervisor runs bundled `pg_dump` in
custom format, verifies the archive with `pg_restore --list`, fsyncs and publishes
it atomically. A retry reuses the original dump. After two distinct successful
app launches on the new head, older known-successful snapshots can be pruned;
the newest, failed/interrupted and unknown entries remain. Consumer restarts
and Retry do not count as launches. The native stage audit separately restores
a dump into a disposable database and verifies owner, schema and rows; that is
not a signed application-upgrade or full-profile recovery test.

Snapshots omit Local files, uploads, vault and keychain. Quit before a coordinated
backup of the complete data tree, preserving the matching app/version and OS
encryption context. Cross-machine vault recovery and a full desktop restore UI
are not established. Never delete PGDATA, replace the principal, merge conflicting
legacy profiles, or auto-restore/downgrade after migration failure. Preserve the
current state and use the [recovery guide](../../../frontend/docs/desktop/troubleshooting.md).

## Compose and intentional remote self-hosting

Without desktop source overrides, Compose retains `ANIMAMA_CONTENT_ROOT`
(`included`/`local`) and the separate `ANIMAMA_DATA_ROOT`; host bind mounts use
`ANIMAMA_INCLUDED_CONTENT_HOST_PATH`, `ANIMAMA_LOCAL_CONTENT_HOST_PATH` and
`ANIMAMA_DATA_HOST_PATH`. Its persistent mode-0600 `ANIMAMA_INTERNAL_TOKEN_FILE`
is different from the desktop's in-memory token. The existing Compose backup,
restore and reset scripts apply to their selected Compose project, not desktop
PGDATA or the encrypted vault. See [Development](development.md#self-hosted-local-roots).

Default self-host publication is loopback Hono only; other services stay private.
Intentional remote access requires an operator-owned TLS and authentication
boundary such as an authenticated tunnel or reverse proxy. Every admitted request
is still the same installation owner. Do not bind the native app to the LAN,
publish FastAPI directly, add local multi-user accounts or treat the desktop
runtime as the future hosted Cloud composition. Operators must configure the
gateway's trusted boundary deliberately, not bypass Host/Origin protections.
