# Troubleshooting

Start with the displayed error, your app version and the last action you took.
Keep your data while investigating; reinstalling or restarting is not a reason
to delete it.

## Startup

In desktop, choose **Open Logs**, address the cause and use **Retry** when
offered. Retry repeats startup without erasing ownership or data. Desktop logs
live under the data folder's `runtime/logs`; `main.log` records app startup.

Quit another Animama instance before retrying a port or previous-runtime error.
On Windows, open Animama normally rather than as administrator. If a packaged
runtime is damaged, preserve your data and use a complete compatible approved
installer; do not bypass integrity checks.

For self-hosting, inspect the selected project's service state and logs from
the checkout root. Source its generated stack record first:

```bash
source .animama-stack.env
docker compose -p "$COMPOSE_PROJECT_NAME" ps
docker compose -p "$COMPOSE_PROJECT_NAME" logs --tail 100 animama-server
```

If a large asset is still a Git LFS pointer, run `git lfs pull` before rebuilding.
Use the [built-mode startup command](./self-host.md#start-the-built-app) for the
ordinary self-hosted app. Preserve existing volumes and files.

## AI cannot reply

Check the selected Chat model in **App Settings → Models**, then use **Test
model**. Remote providers need a valid configured key and connectivity. Desktop
keys are saved in the app; self-host keys come from the server environment.

For local AI, confirm the server is running and its model is loaded. Desktop
normally connects to `127.0.0.1`; Docker presets use `host.docker.internal` to
reach the host. Check the served context window when long conversations fail.
Offline speech downloads do not provide an offline chat model.

## Microphone and speech

Confirm the right microphone is selected and allow Animama to use it. On macOS,
launch the app through Finder and check **Privacy & Security → Microphone**. On
Windows, check **Privacy & security → Microphone**, including **Let desktop apps
access your microphone**.

For offline dictation or Voice Mode, finish the speech recognition download in
**App Settings → Voice**. A missing speech model does not disable ordinary text
chat. Built self-hosting downloads this model in the app; acquiring a host
Parakeet set does not install it there. Pocket TTS and Smart Turn in a self-host
build need the optional browser speech assets acquired before building.

## Backups and recovery

Desktop data lives at `~/Library/Application Support/Animama` on macOS and
`%LOCALAPPDATA%\Animama` on Windows. Quit the app and wait for its services to
stop before backing up the complete folder. On Windows, include `Local State`.
Database migration snapshots alone omit Local files, uploads and the vault.
Secure-storage recovery can require the original macOS keychain or Windows
account; copying a folder is not a guaranteed cross-machine migration.

Self-hosting uses its own database volume, `content/local` and `data`. Use
`./scripts/backup-local.sh` from the correct checkout to back them up together.
Keep secrets and downloaded model assets separately. These Compose scripts do
not back up desktop data.

Preserve the current closed state before seeking help with restore, downgrade or
a vault error. Do not delete the vault, edit runtime state or purge a database as
a default repair.

## Safe support information

Share the app version, operating system, CPU architecture, error code, approximate
time and recent action. Include only a short log excerpt you have reviewed for
personal content, keys and private paths. Never attach provider keys,
authorization headers, cookies, `vault.bin`, database dumps or the whole profile.
