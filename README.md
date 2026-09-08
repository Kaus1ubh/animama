# Animama

Animama is an AI Avatar Desktop Companion app with a FastAPI backend (`src/backend/animama/`, `src/backend/docs/`) and a Vite/Electron frontend (`src/frontend/`, `src/frontend/docs/`).

The primary product is an accountless local desktop app. Its embedded macOS
runtime is implemented, but no signed public release is available yet. Windows
packaging is deferred; Compose remains a separate development/self-host path.

- [Desktop installation and availability](src/frontend/docs/desktop/installation.md)
- [Desktop development/builds](src/frontend/docs/desktop/platforms.md)
- [Manual release process](src/frontend/docs/desktop/release-process.md)
- [Backend development and self-host operations](src/backend/docs/operations/development.md)

## Development and validation

Start with [the agent/contributor guide](AGENTS.md), the
[backend docs](src/backend/docs/README.md) and
[frontend docs](src/frontend/docs/README.md). No private planning repository is
required to build or maintain the local application.

The portable-product CI workflow checks shared import boundaries, tooling,
frontend/gateway/desktop regression suites, and wheel/npm consumers installed
outside the checkout. It uses no application credentials or hosted service,
and neither signs nor publishes artifacts. PostgreSQL-backed backend acceptance,
local setup/chat/persistence, physical audio/avatar behavior and native release
journeys remain separate checks in the scoped guides. A passing portability
workflow does not grant licensing or release approval.

## Copyright and licensing

Copyright (c) 2026 Raymond Van. All rights reserved.

Animama's original source code, documentation, and project-authored assets are
proprietary and are not offered under an open-source license. See [LICENSE](LICENSE)
for the notice and its third-party and prior-license exceptions. Dependencies
and separately licensed materials retain their own licenses. A possible future
open-source release does not grant permission to reuse the current source.
