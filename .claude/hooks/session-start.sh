#!/bin/bash
# Install backend and frontend dependencies for Claude Code on the web sessions
# so offline checks and tests run without setup. Local sessions are untouched.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"

# Commit as the repository owner instead of the cloud session's default identity.
git config user.name "Raymond Van"
git config user.email "raymondxvan@gmail.com"

# Same dependency set as `make sync`.
make sync

cd src/frontend
pnpm install --prefer-offline
