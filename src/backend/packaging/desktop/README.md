# Frozen local backend

The frontend workspace's `desktop:runtime:stage` orchestrates this packaging
directory. It uses the pinned `desktop-build` group and `server` extra in a
separate Python 3.12 environment. Docling/Torch are excluded from core; the
optional document pack uses its own `file-worker` extra and freeze environment.

`animama-runtime.spec` builds a PyInstaller onedir executable. Its entrypoint
delegates to `animama.runtime.cli`. Commands are:

```text
animama-runtime serve --host 127.0.0.1 --port <port>
animama-runtime database provision
animama-runtime database inspect
animama-runtime database bootstrap
animama-runtime content rescan
animama-runtime content audit
animama-runtime worker avatar-cleanup
animama-runtime worker user-files
animama-runtime audit-resources
```

No command accepts a password, provider secret, or content path as an argument.
`serve` rejects non-loopback publication and requires the exact saved
`ANIMAMA_PUBLIC_ORIGIN`, `ANIMAMA_WEB_ROOT`, paired renderer/control credentials
and owned-process start token. FastAPI serves the built UI and product routes
through the same admission boundary as self-host. `content audit`
uses `ANIMAMA_DESKTOP_INCLUDED_ROOT`; it reads the typed starter closure without
a database. `worker user-files` exits 69 with `feature_unavailable` when no pack
is available. After main verifies the installed inventory and OS publisher, it
supplies a fixed helper root/path/digest through the child environment. The CLI
rechecks containment, file type and SHA-256, then uses `os.execve` with
`PYINSTALLER_RESET_ENVIRONMENT=1`. It accepts no arbitrary caller command.

The supervisor supplies a private expected PGDATA, build ID, renderer capability,
desktop control token, immutable Included source array, and writable
Local/data roots. `database provision` can create only the fixed local
`animama` database after the connection's actual PGDATA matches. `inspect` and
`bootstrap` return bounded JSON version/principal reports and fail closed on a
missing installation principal. `serve` exposes token-protected
`/_desktop/health` and `POST /_desktop/runtime:quiesce` only through private
control admission. Readiness includes the exact PID/start token and local HTTP
schema so main verifies its own child before granting renderer access. These
controls are excluded from OpenAPI and absent in self-host composition.
`audit-resources` reports `local_http_schema_version: 1`, matching the
`animama-desktop-runtime/2` resource manifest. See backend operations for inputs.

`animama-document-worker.spec` independently freezes the parser worker.
`document_worker_resources.py` prepares pinned Docling layout/table weights,
tiktoken cache and dependency notices at build time. The entrypoint uses only
`sys._MEIPASS/document-resources`, enables offline Hugging Face/transformers
loading, and disables unbundled OCR. The separate builder at
`src/frontend/desktop/scripts/runtime/document-worker.mjs` requires reviewed
Apple signing configuration before any work; it signs, notarizes, staples and
verifies `Animama Document Worker.app` before auditing conversion. No unsigned
worker development path exists. Actual native build/conversion and size evidence
remain gated until signing credentials and reviewed inputs are supplied.

`archive_feature_pack.py` is a build-only deterministic USTAR writer. It emits
only inventoried regular files after containment/size/hash checks. It is not a
runtime extractor; Electron's bounded zstd/USTAR pipeline owns installation.

`animama.runtime.resources.RESOURCE_INPUTS` is the single map for migrations,
the data-only SQL seeds in `alembic/seeds/`, and frontend-owned manifest inputs.
Source execution knows the checkout layout; frozen execution resolves package resources and fails if one
is missing. Prompts/templates and versioned starter policy also use package
resources. The spec includes the complete Alembic tree: currently the single
`baseline_20260908` revision and its frozen `0001_baseline.sql`, plus any
future forward revisions. Restage after changing these resources. Existing
profiles/backups with a removed pre-release revision need the matching old app
or checkout, or an explicitly disposable fresh profile; bootstrap must not stamp
or silently reset them. `database bootstrap` uses Alembic's Python API
under the existing advisory lock, then applies the same ordered seeds as Compose
reset. Alembic alone owns extension creation; PostgreSQL init scripts are not
packaged. Bootstrap sends intact SQL files to PostgreSQL so
comments and quoted semicolons cannot corrupt the batch.

`stage_content.py` uses the production filesystem scanner and typed resolver,
plus the same starter specs, optional portrait keys, default idle, and loadout
policy as private creation. The core is rescanned after copying. Missing
dependencies, license records, identity collisions, and unsafe files fail the
stage. A development checkout's ignored assets are not silently shipping inputs.
The starter closure must resolve without `sfx/` files and without staging-time
dependency trimming. Required Mixamo animations are ignored user-supplied inputs;
a clean checkout does not yet contain a complete buildable starter closure.
Acquisition/conversion and clean-build acceptance remain outstanding; see the
[Mixamo acquisition guide](../../../../docs/frontend/runtime/mixamo-acquisition.md).
Ignored local copies do not satisfy the tracked-input packaging gate.

`probe_postgres.py` exercises only disposable native loopback data: pgvector,
frozen schema bootstrap twice, principal stability, absence of local account
tables, and a real custom-format backup restored into a second fresh database.
It checks the restored principal, schema head, pgvector version, and exact
owner-scoped marker rows after changing the source database. This does not
replace application upgrade acceptance or back up Local files and credentials.
It generates a temporary password and never writes
credentials to command arguments or reports. It does not touch Compose.
When running `audit-resources` directly, set `ANIMAMA_LOG_TO_FILE=0` and
`ANIMAMA_LOG_TO_CONSOLE=0` to avoid audit-time files inside immutable resources.
The orchestrated stage/audit already sets them.

See [Desktop backend operations](../../../../docs/backend/operations/desktop-runtime.md),
[runtime staging](../../../../docs/frontend/desktop/runtime-staging.md) and the
[maintainer release process](../../../../docs/frontend/desktop/release-process.md)
for build commands, source/licensing review, size budgets, acceptance gates,
and the distinction between a feasibility artifact and a release.
