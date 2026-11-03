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
Stop, unmount, owner changes, replacement streams, buffered stale events
and one POST attempt. Late transport responses exercise races that cooperative
fetch cancellation can hide.
Every test owns its page and fails unexpected page errors; temporary consumer
files and the browser are removed on completion.

This is mounted package integration coverage, not a complete app journey,
real-provider test, network disconnect test, audio check, or Electron acceptance.

The consumer also mounts `useProductChatSession` with `ChatConversation` and fake
catalog/history responses. Recovery checks cover specific/sanitized guidance,
partial output, token/error in one chunk, errors followed by completion,
non-destructive message restoration, later success ordering, chat switches and
quiet intentional Stop. Memory cue checks cover run filtering, placement on the
reply's last bubble while streaming, after completion and after reload, and
memory cache invalidation. A markdown check serves the page from a routed
origin and confirms that a streamed reply requests only its same-origin image,
showing remote images as alt text. The fixture permits only its explicit
synthetic API paths and never reaches a provider or an installation database.
