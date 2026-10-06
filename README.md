# Animama

Animama is an AI avatar desktop companion. Chat with a companion, customize its
avatar and behavior, and keep conversations and content in your own local
installation. The application is accountless and uses a FastAPI backend with a
React interface and Electron desktop shell.

The desktop targets are macOS 15 or later on Apple silicon and Windows 11 on
x64. No signed public release is available yet. Single-owner self-hosting is
supported through Docker Compose; Linux packaging is not a supported release
target.

## Run from source

Starter companions use the shipped authored gestures and reactions and need no
Mixamo animations. The [optional Local installer](docs/frontend/runtime/mixamo-acquisition.md)
can add your converted Mixamo motions to your ignored library. Download and
conversion remain manual.

Install Docker with Compose, Git LFS and Python 3.11 or newer. Hydrate the
remaining checkout assets with `git lfs pull`, then start development from the
repository root. The speech model acquisition is optional: without Parakeet,
dictation reports offline speech as not installed; without the browser speech
set, Pocket TTS and Smart Turn are unavailable.

```bash
python3 scripts/models/parakeet.py acquire
python3 scripts/models/browser_speech.py acquire
./reset.sh
```

Open `http://localhost:8000`. Vite serves the development interface with hot reload
and proxies application requests to private FastAPI. For the built self-hosted
application, where FastAPI serves React directly:

```bash
ANIMAMA_WEB_BUILD_MODE=production ./reset.sh
```

Model acquisition verifies exact sizes and hashes; subsequent startup is offline
and does not download models. See [model setup and recovery](docs/backend/operations/model-assets.md)
for importing an existing copy, custom persistent storage and sharing across worktrees.

Both modes keep the application on loopback and PostgreSQL private. Remote
self-host access requires an operator-owned authentication and TLS boundary.
See [development and operations](docs/backend/operations/development.md) for
provider configuration, optional services, isolated stacks, backup and recovery.
Desktop development and packaging use the separate
[desktop build guide](docs/frontend/desktop/platforms.md).

## Documentation and checks

- [User guides](https://docs.animama.ai/): desktop setup, self-hosting and troubleshooting.
- [Development lifecycle](SDLC.md): issues, planning, validation, review and merge.
- [Specifications](SPECS.md) and [execution plans](PLANS.md): repository-owned planning and evidence.
- [Shared language](GLOSSARY.md): common domain meanings for humans and agents.
- [Architecture decisions](docs/adr/README.md): choices, rationale and history.
- [Backend](docs/backend/README.md): APIs, persistence, content and operations.
- [Frontend](docs/frontend/README.md): React, avatars, audio and desktop behavior.
- [Architecture](docs/architecture/deployment-topology.md): desktop, self-host and development serving.
- [Contributor and agent guide](AGENTS.md): ownership, workflow and validation.
- [Security](SECURITY.md): reporting and supported-version expectations.

Run `make help` for backend tasks and use the documented `pnpm` commands from
`src/frontend` for frontend checks. Local builds and tests require no private
Cloud checkout or hosted account.

## Copyright and licensing

Copyright (c) 2026 Raymond Van. All rights reserved.

The working repository is proprietary. Its original source, documentation and
project-authored assets are not currently offered under an open-source license.
See [LICENSE](LICENSE) for third-party and prior-license exceptions. Source
publication is being prepared separately; that preparation grants no additional
rights to the current checkout.

The [source licensing review](licenses/README.md) records third-party exceptions
and remaining publication gates. The [clean snapshot tools](scripts/public-release/README.md)
prepare a separate review copy without exporting development history or changing
this checkout's license.
