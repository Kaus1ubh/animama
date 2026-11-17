#!/bin/bash
# Install backend and frontend dependencies for Claude Code on the web sessions
# so offline checks and tests run without setup. Local sessions are untouched.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"

# Commit under the identity the cloud environment supplies, if it supplies one;
# otherwise the session's default identity is used.
if [ -n "${ANIMAMA_GIT_USER_NAME:-}" ] && [ -n "${ANIMAMA_GIT_USER_EMAIL:-}" ]; then
  git config user.name "$ANIMAMA_GIT_USER_NAME"
  git config user.email "$ANIMAMA_GIT_USER_EMAIL"
fi

# Same dependency set as `make sync`.
make sync

cd src/frontend
pnpm install --prefer-offline
