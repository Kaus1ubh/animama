# Synthetic VRMA loader fixture

`synthetic-hips.vrma` is original Animama test data attributed to Raymond Van,
created from the literal values in `generate.mjs`. It contains one hips node and
two translation keyframes (height 1 to 1.25 over one second), with no mesh,
texture, audio, external resource, or motion-capture data. It is not copied from
Mixamo or another animation library. It follows the same project-owned source
license treatment as its generator; the working repository remains proprietary.

Regenerate it with `node src/frontend/web/tests/fixtures/vrma/generate.mjs` from
the repository root. Its GLB bytes are small and checked in directly, outside
the public runtime assets and Git LFS rules. Tests load these bytes through the
real Three.js and VRM animation loaders and verify the decoded track and cache
lifetime. The fixture is not a replacement starter gesture or a native avatar
playback acceptance test.
