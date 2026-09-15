# Electron Desktop App Implementation Guide

Animama Desktop is the primary local application. It opens without credentials;
one migration-generated installation principal owns local Animas, chats,
memories, settings, content, and files. Local use has no hosted account
connection. Hosted identity and deployment are separate future work.

Use the [runtime architecture](../../docs/frontend/desktop/overview.md),
[staging and audit guide](../../docs/frontend/desktop/runtime-staging.md), and
[maintainer release process](../../docs/frontend/desktop/release-process.md) as the durable
implementation and acceptance references. Embedded macOS supervision, optional
packs, guarded updates, backups, signing and installed-artifact smoke tooling are
implemented. The signed/notarized core candidate was independently verified on
2026-09-04, but no accepted public release exists. Fresh-profile/native acceptance,
a real forward upgrade and explicit publication approval remain required.
Windows packaging is deferred. The [installation](../../docs/frontend/desktop/installation.md),
[feature-pack](../../docs/frontend/desktop/feature-packs.md), and
[recovery](../../docs/frontend/desktop/troubleshooting.md) guides describe current supported use.
Use [Releases](../../docs/frontend/desktop/releases.md) for the detailed signing/publisher reference.

## Two Development Paths

Unpackaged `pnpm desktop:dev` loads the existing local application origin from
`ANIMAMA_DESKTOP_WEB_URL`, defaulting to `http://localhost:8000`. It does not
start services. Use the main stack when it is already available; a new Compose
stack is not needed for every desktop check. Source a named stack's
`../../.animama-stack.env` only when deliberately targeting that existing stack.

Packaged builds always use embedded services. For unpackaged supervised tests,
`ANIMAMA_DESKTOP_DEV_RUNTIME_ROOT` may point at a complete audited stage, with
`ANIMAMA_DESKTOP_DEV_USER_DATA` selecting isolated durable test data.
Packaged builds reject all these overrides, the external web URL, and the
sandbox-disable switch. See [Platform builds](../../docs/frontend/desktop/platforms.md).

## Embedded Startup

```text
Electron main: identity/path -> single-instance lock -> recovery page
  -> manifest/pack verification -> encrypted vault -> saved application-port preflight
  -> owned PostgreSQL -> backup/migrations/bootstrap -> optional verified worker
  -> FastAPI on the saved port -> private exact-child/source-reconciliation readiness
  -> install HttpOnly renderer capability -> React
```

FastAPI serves the packaged SPA, HTTP/SSE, WebSockets and protected bytes at
one saved loopback origin. PostgreSQL has a separate private loopback port.
Readiness verifies the exact owned process ID/start token, runtime/build, local
HTTP schema, Alembic head and installation principal before any renderer cookie
or navigation. Quitting quiesces requests and stops only retained child handles.

The backend reuses the same accountless bootstrap and owner-scoped services as
Compose. Electron does not invent another local identity, authenticate against
an online service, or bundle Better Auth. React may read the non-secret
principal for caches and drafts, never the renderer/control credentials.

## Ownership Of Code

| Area                                                  | Responsibility                                                                                 |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `desktop/src/main-process/runtime/`                   | Paths, manifests, vault, processes, PGDATA, migrations, readiness, recovery, guarded IPC       |
| `desktop/src/main-process/feature-packs/`             | Catalog-bound download, strict extraction, inventory/signature verification, atomic activation |
| `desktop/src/main-process/updates/`                   | Stable public feed policy, consent, disk/pack preflight, native updater adapter                |
| `desktop/scripts/runtime/release-macos.mjs`           | Audited candidate packaging; publication is a separate gated command                           |
| `desktop/src/main-process/runtime/product-windows.ts` | Product-document destruction, remembered routes and request gating                             |
| `src/backend/animama/local/http/`                     | Exact Host/Origin, metadata, CSRF, capability, static/model delivery and quiescence            |
| `shared/desktop-runtime.ts`                           | Serializable API version 2 runtime and credential contracts                                    |
| `web/src/ui/settings/DesktopCredentialsPanel.tsx`     | Optional setup/settings key entry and status, no readback                                      |
| `web/src/ui/settings/DesktopFeaturePacksPanel.tsx`    | Bounded main-window pack controls and affected-content labels                                  |
| `src/backend/animama/runtime/`                        | Frozen CLI and packaged resources                                                              |
| `src/backend/animama/server/local_runtime.py`         | Immutable Included source configuration and writable local roots                               |

Shared React features still use the neutral runtime-owner context. Electron
imports stay out of browser modules; neither renderer IPC nor API responses
expose arbitrary filesystem paths, process commands, or stored keys.

## Security And Recovery

Every desktop window keeps context isolation, sandboxing, web security, and
Node integration disabled. A host-only, HttpOnly, SameSite=Strict capability
cookie is installed in `persist:animama` after owned readiness and before
loading React. FastAPI validates the matching capability and exact request
authority, rejects client identity assertions, and resolves the installation
owner internally. Desktop controls require their separate credential and
remain inaccessible to ordinary renderer requests.

Runtime IPC validates registered live top-level callers. Recovery has only
status/Retry/Open Logs/Open Backups/Quit access; provider controls require the main window
at the application origin. The vault uses Electron safeStorage after Electron readiness
and fails closed without encryption. Saving/removing a key first quiesces work,
then updates the vault and restarts
FastAPI and the installed document worker, leaving PostgreSQL and the owner
intact. A busy drain preserves the prior key and retains a bounded provider
failure through `credentials.list` when the replacement window opens Settings.
The Settings modal itself does not survive product-window recreation. If the
key was saved before a restart failure, Retry uses the saved value; successful
readiness clears that restart failure. No error record contains the key or
changes the vault format. Pack methods accept only catalog IDs. Pack changes additionally check
references/leases, dispose renderer contexts, atomically switch versions, and
roll back on restart failure. Update IPC accepts zero-argument status, check,
download, and restart operations only from the main window. A downloaded update
does not install on normal Quit; explicit Restart first stops owned services.

The document pack is independently frozen and signed executable code. Every
install/launch verifies its inventory and the pinned OS publisher; no unsigned
worker exception exists. Data-only Parakeet and expanded Included packs cannot
execute binaries. The renderer never chooses a download URL, path, hash,
version, destination, or command. See [Runtime staging](../../docs/frontend/desktop/runtime-staging.md)
for exact artifact production, approval gates, and development fixture catalogs.

On macOS, durable data lives in `~/Library/Application Support/Animama`.
Immutable application resources are separate. Startup errors preserve user data
and show bounded safe error codes. Never clear an error by deleting the vault,
PGDATA, or ownership row. Back up the database, vault, Local content, and private
data together with the app closed. Premigration dumps are verified, with retries
preserving the original snapshot. After two successful app launches, retention
keeps the newest snapshot and all failed/interrupted attempts. Dumps do not
contain files, the vault, or OS keychain and do not replace a complete backup.

See [Desktop overview](../../docs/frontend/desktop/overview.md) for paths, legacy migration,
stale-process recovery, provider settings, and logging.

## Commands And Verification

From `src/frontend`:

```sh
pnpm desktop:dev
pnpm check
pnpm web:test
pnpm desktop:test
pnpm desktop:build
pnpm desktop:runtime:stage -- --platform darwin --arch arm64
pnpm desktop:runtime:audit -- --platform darwin --arch arm64
pnpm desktop:mac
```

Only run the final package step after a successful complete stage/audit.
Windows native packaging is Phase 5; Linux packaging is outside this plan.
Existing shell dev workflows are not proof of either native package.

The user-verification gate requires the real macOS app to launch with no
development servers, preserve the same principal and origin across restarts,
chat with both starters, play PocketTTS, retain native window behavior, protect
credentials, recover from collisions, and stop its owned children. Component
probes and recovery-only launches do not satisfy that gate.
