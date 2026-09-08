#!/bin/sh

# Compose installs the full build toolchain before this script selects the
# browser build. Both servers stay private behind the same Hono gateway.
set -eu

case "${ANIMAMA_WEB_BUILD_MODE:-development}" in
  development)
    export NODE_ENV=development VITE_APP_ENV=development
    # The workspace command builds public package artifacts before Vite starts.
    exec pnpm --filter animama-web dev --host 0.0.0.0 --port 5173 --strictPort
    ;;
  production)
    # Compose's development NODE_ENV must not leak into the optimized bundle.
    # Preview is for local comparisons only, not public production deployment.
    export NODE_ENV=production VITE_APP_ENV=production
    pnpm --filter animama-web build
    exec pnpm --filter animama-web exec vite preview --host 0.0.0.0 --port 5173 --strictPort
    ;;
  *)
    printf '%s\n' 'ANIMAMA_WEB_BUILD_MODE must be development or production.' >&2
    exit 2
    ;;
esac
