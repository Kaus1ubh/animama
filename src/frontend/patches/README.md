# Dependency patches

`@vitejs/plugin-react@6.0.1` releases a successfully unmounted root when React
Three Fiber emits a second empty commit. Without this patch, Fast Refresh's
helper Map retains the old canvas, renderer, and avatar textures. Failed roots
remain available for recovery, and every DevTools callback is still forwarded.

The patch is version-scoped in `package.json` and hashed in `pnpm-lock.yaml`.
Commit all three together. Docker copies this directory before installing
dependencies. Production bundles do not include the Fast Refresh runtime.

`pnpm web:test` runs the installed-runtime regression tests. When upgrading the
plugin, check the upstream empty-root handling and rerun these tests before
removing or rebasing the patch. See issue
[#45](https://github.com/raymond-van/animama/issues/45).
