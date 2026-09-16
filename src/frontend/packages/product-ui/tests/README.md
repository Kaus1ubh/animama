# Mounted chat package checks

From `src/frontend`, run `pnpm packages:build`, then `pnpm packages:test`.
The product-ui tests require the workspace's pinned Playwright Chromium:
`pnpm exec playwright install chromium`. To run just this family after building,
use `pnpm --filter @animama/product-ui test`.

The suite copies only the built product-ui and runtime-contracts distributions
and package manifests into a temporary consumer, reuses installed third-party
dependencies, and bundles its own React mount. Build metadata verifies that both
Animama packages resolve to the copied distributions, without web or package
source imports. No new test-only dependencies are installed.

Chromium executes the real React hook and generated SDK against an injected,
controllable Fetch/ReadableStream transport. Checks cover incremental text,
Stop, unmount, owner changes, replacement streams, buffered stale events, error
and incomplete-stream recovery, and one POST attempt. The intentionally late
transport responses exercise races that cooperative fetch cancellation can hide.
Every test owns its page and fails unexpected page errors; temporary consumer
files and the browser are removed on completion.

This is mounted package integration coverage, not a complete app journey,
real-provider test, network disconnect test, audio check, or Electron acceptance.
