#!/bin/sh

# The development override owns Vite. Production builds are served by FastAPI.
set -eu

if [ "${ANIMAMA_WEB_BUILD_MODE:-development}" != development ]; then
  printf '%s\n' 'The Vite launcher requires ANIMAMA_WEB_BUILD_MODE=development; production uses the base Compose API image.' >&2
  exit 2
fi
export NODE_ENV=development VITE_APP_ENV=development
exec pnpm --filter animama-web dev --host 0.0.0.0 --port 5173 --strictPort
