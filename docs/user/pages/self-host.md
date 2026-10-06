# Self-host quick start

This guide starts from an existing Animama source checkout on your own computer.
**Public source download: Coming soon.** Source publication is a separate
decision; no public source download or container registry distribution is
available through this guide.

## Requirements

Install Docker with Docker Compose, Git LFS, and Python 3.11 or newer for the
startup and model scripts. Run the following commands from the checkout
root. Initial image builds, dependencies and optional model acquisition need
Internet access.

## Start the built app

Hydrate the checkout's large assets before building:

```bash
git lfs pull
```

For optional Pocket TTS and Smart Turn, acquire the browser speech set before
the build. Skip this command if you do not want those features:

```bash
python3 scripts/models/browser_speech.py acquire
```

Start the built web application:

```bash
ANIMAMA_WEB_BUILD_MODE=production ./reset.sh
```

Open `http://localhost:8000`. The built app serves its interface and API from
the same loopback origin. The default `./reset.sh` starts the development
interface with hot reload instead. A normal reset preserves the database and
files; do not use `--purge` for setup or troubleshooting.

The first-run Welcome, AI and Voice flow creates a single installation owner
without a login. Follow the [setup steps](./desktop.md#first-setup), with the
provider configuration below for self-hosting.

## Configure AI

Use a remote provider or a separately running local model server. There is no
bundled offline chat model.

For the built-in OpenAI connection, the self-hosted app reads the server's
`OPENAI_API_KEY`. Keep the actual key in an owner-only environment file outside
the checkout, for example `~/.config/animama/dev-secrets.env`, with a private
parent directory and file permissions `600`. Keep checkout `.env` entries
nonsecret; omit key entries entirely so they do not override the external file.
Select the files before starting or restarting:

```bash
export COMPOSE_ENV_FILES="$HOME/.config/animama/dev-secrets.env,$PWD/.env"
ANIMAMA_WEB_BUILD_MODE=production ./reset.sh
```

Create the nonsecret `.env` file if you use this two-file configuration. Read
`.env.example` for available settings. Do not overwrite an existing secrets
file or put a key in a command line, URL or repository. Inherited shell values
take precedence over the selected files.

For local AI, start the server and load a model on the host. In **App Settings →
Models → Local**, the Compose presets use `host.docker.internal` to reach it;
`127.0.0.1` inside the backend container refers to that container. Use **Test
model** to check the selected model and context window. Configure the server to
be reachable from Docker without exposing it publicly.

For other remote connections, set their key environment variable on the server.
Custom `ANIMAMA_CONNECTION_<NAME>_API_KEY` values belong in a separate owner-only
file selected by an absolute `ANIMAMA_CONNECTION_KEYS_FILE` path in `.env`.
The Models card reports whether its chosen variable is set.

## Speech, data and access

Built self-hosting installs offline speech recognition from **App Settings →
Voice** into application data; it does not use a host Parakeet model set.
Missing optional speech assets disable only their features. Startup verifies
acquired assets locally and does not download them.

The default checkout keeps writable content in `content/local`, private files in
`data`, and PostgreSQL in its Docker volume. Back them up together:

```bash
./scripts/backup-local.sh
```

The ignored `backups/` output excludes secrets and downloaded model assets. Keep
those separately, and protect backups as private data. For startup logs and safe
recovery, see [Troubleshooting](./troubleshooting.md).

The application binds to loopback; PostgreSQL stays private. Remote access
requires an operator-owned TLS and authentication boundary. Do not publish the
application or database ports directly to the Internet. Every admitted request
still acts as the same installation owner; this is not a multi-user server.
