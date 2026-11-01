# Dependency patches

`@vitejs/plugin-react@6.0.1` releases a successfully unmounted root when React
Three Fiber emits a second empty commit. Without this patch, Fast Refresh's
helper Map retains the old canvas, renderer, and avatar textures. Failed roots
remain available for recovery, and every DevTools callback is still forwarded.

Each patch is version-scoped in `package.json` and hashed in `pnpm-lock.yaml`;
commit all three together. Docker copies this directory before installing
dependencies. Production bundles do not include the Fast Refresh runtime.

`pnpm web:test` runs the installed-runtime regression tests. When upgrading the
plugin, check the upstream empty-root handling and rerun these tests before
removing or rebasing the patch. See issue
[#45](https://github.com/raymond-van/animama/issues/45).

The `@mochiya/three-liltoon@0.1.9` patch makes three changes:

- It draws lilToon's opaque surface and outline passes without blending when
  their blend state replaces the target exactly (colour One/Zero; alpha One
  with Zero or One-minus-source-alpha). Those shaders write alpha 1, so the
  pixels are unchanged, and unblended draws let Animama's depth pre-pass cover
  them (the main saving on an Apple M5) and tile-based GPUs skip hidden
  surfaces.
- It keeps one morph-weight texture per mesh instead of one per material; a
  material shared by meshes with different morph-target counts otherwise
  reallocates its texture on every draw.
- It guards the 12 places the generated vertex shaders normalize the
  spherical-harmonics direction, which the web lighting ABI leaves at zero, so
  lilToon's environment-lit shadows are defined on every GPU.

`web/src/lib/avatar/liltoon/threeLilToonPatch.test.ts` runs the installed
package. When upgrading, check which of the three upstream now handles, drop
those parts and rerun the tests. See issue
[#752](https://github.com/raymond-van/animama/issues/752).
