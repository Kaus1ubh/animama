# Animama

Animama is an AI avatar desktop companion. Chat with a companion, customize its
avatar and behavior, and keep conversations and content in your own local
installation. The application is accountless and uses a FastAPI backend with a
React interface and Electron desktop shell.

The desktop target is macOS 15 or later on Apple silicon. No signed public
release is available yet. Single-owner self-hosting is supported through Docker
Compose; Windows and Linux packaging are not supported release targets.

## Run from source

Install Docker with Compose and Git LFS, and hydrate the checkout assets with
`git lfs pull`. Then start the development stack from the repository root:

```bash
./reset.sh
```

Open `http://localhost:8000`. Vite serves the development interface with hot reload
and proxies application requests to private FastAPI. For the built self-hosted
application, where FastAPI serves React directly:

```bash
ANIMAMA_WEB_BUILD_MODE=production ./reset.sh
```

Both modes keep the application on loopback and PostgreSQL private. Remote
self-host access requires an operator-owned authentication and TLS boundary.
See [development and operations](docs/backend/operations/development.md) for
provider configuration, optional services, isolated stacks, backup and recovery.
Desktop development and packaging use the separate
[desktop build guide](docs/frontend/desktop/platforms.md).

## Documentation and checks

- [Backend](docs/backend/README.md): APIs, persistence, content and operations.
- [Frontend](docs/frontend/README.md): React, avatars, audio and desktop behavior.
- [Architecture](docs/architecture/deployment-topology.md): desktop, self-host and development serving.
- [Contributor and agent guide](AGENTS.md): ownership, workflow and validation.
- [Security](SECURITY.md): reporting and supported-version expectations.

Run `make help` for backend tasks and use the documented `pnpm` commands from
`src/frontend` for frontend checks. Local builds and tests require no private
Cloud checkout or hosted account. Discover is discontinued; existing typed
`.animama` import/export remains local.

## Copyright and licensing

Copyright (c) 2026 Raymond Van. All rights reserved.

The working repository is proprietary. Its original source, documentation and
project-authored assets are not currently offered under an open-source license.
See [LICENSE](LICENSE) for third-party and prior-license exceptions. Source
publication is being prepared separately; that preparation grants no additional
rights to the current checkout.
