# Desktop troubleshooting and recovery

These instructions describe the embedded macOS runtime. Signed release and
clean-machine acceptance are still pending; see [Installation](installation.md)
for the current platform status. They do not reset a Compose development stack.

## First response to a startup error

Record the displayed error code and what happened immediately before it. Use
**Open Logs**, fix the cause, then use **Retry** if offered. Retry repeats startup
without resetting ownership or erasing data. **Open Backups** appears when a
migration snapshot is relevant. **Quit** stops Animama's owned services.

Logs are under `~/Library/Application Support/Animama/runtime/logs`; `main.log`
records desktop startup, and the same directory holds child-service logs.
`backend_start_failed` is a category, not the cause: inspect the relevant recent
backend log before deciding on a repair.

| Error or symptom                                                                                    | Safe next action                                                                                                                                                              |
| --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `gateway_port_in_use`                                                                               | Close the known application using the saved port, then Retry. Do not change `runtime/state.json` merely to get another origin.                                                |
| `previous_runtime_running`, `owned_services_stop_failed`                                            | Quit the previous Animama instance or restart the Mac if necessary. Never kill processes by name or use a stale PID file as authority.                                        |
| `runtime_manifest_invalid`, `runtime_file_invalid`                                                  | Reinstall a complete compatible Animama build, preserving data. Never edit hashes or signature checks.                                                                        |
| `packaged_runtime_override_rejected`                                                                | Launch normally without development web-URL, runtime/data or sandbox override variables. Do not use them to bypass packaged isolation.                                        |
| `secure_storage_unavailable`                                                                        | Unlock the macOS login keychain and Retry. There is no plaintext fallback.                                                                                                    |
| `vault_unreadable`, `vault_missing_for_database`                                                    | Preserve both database and vault. Restore a matching backup/keychain with support; simply re-entering provider keys does not restore the database password.                   |
| `legacy_profile_conflict`, `legacy_profile_invalid`                                                 | Preserve both old `Anima` and new `Animama` trees. Do not merge them; ask for a reviewed recovery procedure.                                                                  |
| `unsupported_postgresql_major`, `postgres_ownership_mismatch`                                       | Stop. The app owns a specific PostgreSQL 16 cluster; pointing it at another database or replacing its binaries is not an upgrade.                                             |
| `database_initialization_incomplete`, `database_version_mismatch`, `installation_principal_missing` | Preserve data and inspect the bootstrap logs. Never generate a replacement owner over existing owner-scoped rows.                                                             |
| `database_schema_mismatch`                                                                          | The profile schema differs from this build (often an edited development baseline). Retry cannot fix it. Development: quit, then `pnpm desktop:mac:reset` archives it.         |
| `content_startup_failed`                                                                            | Inspect the backend log for the reconciliation error. A constraint failure on a development profile needs `pnpm desktop:mac:reset`; otherwise fix it and Retry.               |
| `pre_migration_backup_failed`                                                                       | Check disk space and logs. No migration was started; retry only after the snapshot can be verified.                                                                           |
| `migration_failed`, `migration_recovery_required`, `migration_journal_invalid`                      | Preserve the current database and snapshot. Retry the same intended version only after resolving the cause; do not reset, auto-restore or downgrade.                          |
| `backend_start_failed`, `backend_readiness_mismatch`, `runtime_command_failed`                      | Inspect recent child logs; check for a complete matching app and adequate disk space. Escalate repeated errors rather than deleting state.                                    |
| `pack_in_use`, `pack_cleanup_pending`, `pack_download_failed`                                       | Follow [Feature packs](feature-packs.md#remove-safely). Do not erase directories or change download hashes.                                                                   |
| `pack_dependent_installed`, `pack_dependency_missing`                                               | Remove the GPU speech encoder before offline speech; install offline speech first.                                                                                            |
| `pack_signature_invalid`, `pack_file_invalid`, `pack_catalog_incompatible`                          | Stop using those pack files. Use only the app's compatible install/repair controls; if blocked, preserve evidence and contact support. Never run an unsigned document worker. |

## Application listener and renderer access

The app's saved `127.0.0.1` URL is private to its approved Electron renderers;
it is not a browser login page or a LAN server. A request without the renderer
capability or with a hostile origin is rejected by FastAPI. Do not share capability cookies, internal headers or private ports.

If the normal main window cannot load after a restart, quit and reopen the
complete app through Finder. Main generates separate fresh renderer and control
credentials each launch. These are not the durable installation principal and
are never copied from another installation. Repeated capability/readiness failures
need logs and a matching build, not disabled origin checks or deleted ownership.

### A page fails after a build or update

The **Reload page** action requests current app files and warns that unsaved
page changes may be lost. It never reloads automatically in a loop. HTML is
revalidated while fingerprinted application JS/CSS is cached; an obsolete
chunk URL returns 404 instead of an HTML document. If reloading fails again,
quit and reopen the complete matching app, then use a reviewed reinstall if
necessary. Preserve local data; neither clearing the database nor deleting the
installation principal repairs an incomplete app bundle.

Application debug panels and inspector targets are deliberately absent in
production, including embedded desktop, regardless of saved preferences or a
development flag. Use the runtime logs and recovery controls to investigate production failures.

## Microphone and speech

Open the `.app` through Finder, start a microphone-dependent feature and inspect
System Settings → Privacy & Security → Microphone. Allow Animama when prompted.
An automation launch or generated-audio test does not verify physical microphone
permission or capture. If there is no prompt or entry, record the app build,
launch method and displayed state; do not reset the privacy database blindly.

Offline dictation requires the Parakeet pack; PocketTTS and microphone permission
do not. Check pack status, selected input/output devices and mute/volume settings.
Remote TTS also requires its configured provider and connectivity, and chat a
reachable model connection. PiP
is visual-only; the main renderer owns audio. See [Keyboard shortcuts](keyboard-shortcuts.md)
for native hook permissions and [Feature packs](feature-packs.md) for installation.

## Model connections and chat errors

A failed turn shows a notice beside your message naming the connection that
failed. Connection key changes report their failures in App Settings → Models.

| Error or symptom                                                   | Safe next action                                                                                                                                                                                                                         |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "Animama couldn't reach … Is … running at …?"                      | Start the server and load the model, or correct the connection's base URL in App Settings → Models. The app reaches local servers at `127.0.0.1`.                                                                                        |
| "The conversation is too long for …" (category `context_exceeded`) | Send a shorter message, choose a model with a larger context window, or have the server load the model with a larger window and record that window on the model.                                                                         |
| `connection_credentials_full` (the 32-key limit)                   | Remove the key from a connection you no longer use, then retry. Nothing was saved or sent.                                                                                                                                              |
| `credential_connection_invalid`, `credential_changes_invalid`      | Main refused a malformed key change (a variable outside `ANIMAMA_CONNECTION_<ID>_API_KEY`, more than eight changes, or one target twice). Nothing changed; reopen Settings and retry, and report repeated failures with the app version. |

DeepSeek, Hugging Face and Gemini keys saved by earlier builds are dropped when
the vault loads; they never make it `vault_unreadable`. Re-enter such a key on a
model connection.

[Local model servers](../../backend/operations/local-models.md) covers starting
Ollama, LM Studio, llama.cpp or vLLM, setting their context windows and further
checks.

## Update failures

A failed check or download leaves the current app available. Retry the offered
action after resolving network or disk problems. A changed candidate requires
a fresh check. An active pack operation or incompatible in-use content can
block an update; do not clear those guards by deleting files.

Downloading is not permission to install. **Restart to install** first stops
local services. `update_install_timeout` is an uncertain installer state: services
remain stopped, so Quit and reopen or use a reviewed reinstall. Do not resume
writes or downgrade while replacement may be in progress. A replacement validates
its manifest before database work. An older app is safe only if the database
has not advanced beyond it; ask for help when uncertain.

## Backups and recovery

Migration snapshots live under
`~/Library/Application Support/Animama/backups/pre-migration`. Startup creates
a verified custom-format database dump before changing an existing schema.
Retry reuses the original snapshot. After two distinct successful app launches,
older known-successful snapshots may be pruned; the newest, failed/interrupted,
and unrecognized snapshots stay. Provider restarts and Retry are not new launches.

These dumps are **not full backups**: they omit Local files, uploads, the vault
and macOS keychain. Quit Animama and wait for its services to stop before a
coordinated backup of the whole `~/Library/Application Support/Animama` tree.
Keep the matching app version and protect the backup as private data. Encryption
may require the original OS account/keychain; moving the directory alone is not
a tested cross-machine migration. There is no supported one-click full backup,
restore or reset UI yet. Developers who explicitly choose fresh setup can use
the [desktop reset commands](platforms.md#reset-desktop-data-for-fresh-setup),
which archive the old profile before launching a new one.

Restore is an operator-assisted procedure after preserving the current closed
state. Never restore automatically after a failed migration; newer data may be
lost. Do not run Compose `reset.sh`, `backup-local.sh` or `restore-local.sh`
against desktop data. Removing/reinstalling `Animama.app` leaves the data tree
alone; uninstalling the bundle is not a data reset.

## What to send for support

Share the app version/build, macOS version, CPU architecture, error code,
approximate time, recent action and a short reviewed log excerpt. Mention
whether this was a packaged app or an unpackaged development run. Redaction is
defensive, not permission to share all logs: remove personal content and paths.
Never attach `vault.bin`, database dumps, the whole profile, provider keys,
authorization headers or capability cookies. Keep backups locally while the
maintainer proposes a specific recovery procedure.
