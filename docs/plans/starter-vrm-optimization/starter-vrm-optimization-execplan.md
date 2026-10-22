# Smaller starter Avatars and the new Andrew

Source agreement: https://github.com/raymond-van/animama/issues/656 (snapshot:
[starter-vrm-optimization-spec.md](starter-vrm-optimization-spec.md)), agreed
2026-10-22. On that date the owner:
- chose WebP q90, sparse morph targets and the validator change;
- supplied the R7 metadata;
- chose to adopt the new Andrew export.

On 2026-10-22 the owner accepted the spec and this plan with defaults O2–O4,
and decided O6: no Gesture retuning.
Authorized scope: Phases 1–4, the final integration review and the PR. G1 and
merge stay with the owner.

Workspace: Git worktree `worktrees/animama/vrm-avatar-optimization-957dce`,
branch `perf/starter-vrm-optimization`, based on `origin/main` at `4354978f`.
Parent issue #656. No phase issues are needed: one repository and one assignee.
Task stack for the e2e run and G1: Compose project `animama-svo`, built mode,
`http://animama-svo.localhost:8900` (`./reset.sh --name svo --base-port 8900`).

## Purpose and context

Shrink the two Included starter Avatars from 18.5 MB (Annie) and 15.6 MB (Andrew)
to about 4.7 MB each. Both take the owner's full-rights licence metadata, and
Andrew becomes the owner's revised model.

- **Annie must look and behave exactly as today.**
- **The new Andrew must work as well as the old one.** He has a new outfit and
  re-rigged hair, and is about 10 cm shorter, so his portrait, motion-check
  results and Andrew-specific test measurements are redone.
- **The backend must accept** the sparse morph data the new files use.

Relevant code and records:

- **Backend validator:** `src/backend/animama/app/services/content_gltf.py`.
  - `validate_vrm_stream` (line 164) and `_validate_gltf_structure` (around line 500)
    call `_validate_accessors` (line 722).
  - `_validate_accessors` rejects any `sparse` accessor and requires a
    `bufferView`.
  - Its returned layouts are read only by VRMA animation validation
    (`_validate_animation`). VRM validation does not read accessor data.
  - Tests are in `tests/test_content_gltf.py`.
- **Content packages:** the capability allowlist in
  `content_package_capabilities.py` already accepts `EXT_texture_webp`. Sparse is
  core glTF and needs no capability.
- **Browser loader:** `Avatar.ts` uses GLTFLoader with the VRM plugins. three.js
  expands sparse accessors and decodes WebP natively, so no loader change is
  needed. The headless loader `lib/avatar/motion-authoring/headlessVrm.ts`
  (`loadHeadlessVrmWithGltf`) is the reference for the equivalence check.
- **Digest records:**
  - Annie's entry in `VERIFIED_EYELID_CLOSURE_PROFILES`
    (`src/frontend/web/src/lib/avatar/eyelidClosure.ts:53`) and its test;
  - `licenses/third-party/art-vroid-review.json` (sha256 and embedded meta per
    file);
  - `content/included/licenses/inventory.json` (rules for both files);
  - `licenses/third-party/art-NOTICES.md` (Annie at line 48, Andrew at line 74);
  - `licenses/source-review.json` (basis text for both files);
  - `content/included/README.md` (lines 55 and 99);
  - `docs/frontend/desktop/redistribution-review.md`, if it repeats the terms.
- **Andrew-specific measurements:** these tests and data name Andrew and hold
  values measured on the old model:
  - `motion-authoring/testing/included-clip-sample-baseline.json`, with its test
    `includedClipBaseline.test.ts`;
  - in `poses/anatomy/`: `arms.test.ts` (Andrew's arm reach and contact
    distances), `handPresets.test.ts` (fitted-hand digests) and
    `handOffsets.test.ts`;
  - `vfx/faceParts.test.ts` (expected face parts);
  - `eyelidClosure.test.ts` (Andrew uses the default profile);
  - `includedGestures.test.ts`, `beatEditing.test.ts` and
    `pose-creator-store.v2.test.ts`.

  On the backend, the starter and presentation tests name Andrew's portrait
  and files.
- **New Andrew source:** the owner's 2026-10-22 VRoid Studio 2.14.0 export,
  SHA-256 `c06314f155dcd51e144cb19d1a4474b6523893a41f47275b0a01e1d02d2a01e9`,
  16,952,868 bytes. It passes the current backend validator.
  - **Unchanged from the old Andrew:** the 14 preset expressions, 57 morph-target
    names, spring group names `Hair` and `TopsUpperArm`, 22 colliders, bone
    lookAt and 54 humanoid bones. The material names keep VRoid's `_SKIN`,
    `_CLOTH` and `_HAIR` suffixes, so the MToon retune still applies.
  - **Changed** (measured 2026-10-22 from node translations, rest pose, head
    joint height, old → new):

    | Measure | Old | New |
    |---|---|---|
    | Hips | 1.020 m | 0.940 m |
    | Head | 1.602 m | 1.504 m |
    | Shoulder span | 0.309 m | 0.292 m |
    | Leg | 0.887 m | 0.812 m |

  - **Also changed:** a tie and new top, trouser and shoe materials (17
    materials instead of 16), re-rigged hair joints, and different spring and
    expression bind data.
- **Portrait coordination:** a separate task is upgrading the portrait generator
  to 512 px with the chat canvas look, and will regenerate both Included
  portraits. Phase 4 makes Andrew's portrait with whichever generator is on
  `main` at that time. Both tasks touch
  `content/included/appearances/avatar-portraits/app-avatar-model-andrew-v1.*`
  and its licence records, so whichever merges second rebases and regenerates.
- **Face-part overrides:** stored per owner, item and Avatar revision
  (`avatar_face_part_override_repo.py`). The service assumes Included revisions
  never change (`avatar_face_parts_service.py:161`).
- **Measured inputs:** the 2026-10-21 and 2026-10-22 investigation produced
  these sizes, Andrew / Annie:

  | Variant | Size |
  |---|---|
  | Original | 15.6 / 18.5 MB |
  | WebP q90, dense morphs | 9.3 / 9.2 MB (passes the current validator) |
  | WebP q90, sparse morphs | 4.7 / 4.7 MB (rejected only for `sparse`) |

  Renders of the face, torso, full body and back scored 47–56 dB PSNR against
  the originals. A three-vrm headless load matched the originals' meshes, morph
  data, expressions, bones and springs.
- **Tool dependency:** vrm-transform (`mrxz/vrm-transform`, MIT, commit
  `c2aebe13`, not published to npm) supplies VRM 1.0 extension classes for
  glTF-Transform. Without them, glTF-Transform silently drops `VRMC_*` data.
  Its `pruneMorphTargets` must never run: Animama registers every morph target
  as a user-addressable expression (`morphTargetExpressions.ts`).

Boundaries: Animama repository only. Cloud receives the files through its normal
Animama repin, which this plan does not perform. No new runtime loader or
decoder. User uploads are out of scope.

## Progress

- [x] Gate G0: owner accepted the spec and plan with O2–O4 (2026-10-22).
- [x] Phase 1: validator accepts bounded sparse accessors (`01b6ca19`).
- [x] Phase 2: checked-in optimizer and verifier tool (`942310d6`).
- [x] Phase 3: regenerated starter files with metadata and licence records
  (`faa29944` source export, `e7b5c7fd`).
- [x] Phase 4: the new Andrew verified (portrait, motion checks recorded,
  re-measured tests) (`e7b5c7fd`).
- [ ] Gate G1: owner visual check in the running app.
- [ ] Final integration review, full pre-push suite, full `pnpm e2e:test`.

## Surprises & Discoveries

From the investigation (2026-10-21 to 2026-10-22):

- **Lossy PNG flag:** sharp's PNG `effort` option silently enables palette
  quantization, which is lossy. Lossless PNG needs `palette: false` and no
  `effort` or `quality`.
- **Stock glTF-Transform breaks VRMs:** its `optimize` and `quantize` drop
  `VRMC_*` extensions, prune MToon-only textures and, in one test, the skins.
- **Sparse rejected:** the backend validator rejects sparse accessors with the
  error reason `vrm_invalid_structure`.
- **All-zero morph targets (2026-10-22, Phase 1):** glTF stores an all-zero
  morph target as an accessor with no buffer view and no sparse data. Both
  glTF-Transform's `sparse()` and the Phase 2 tool produce 58 of them per
  starter. The spec's R3 sentence, that an accessor without a base view reads
  as zeros, covers this. The validator accepts them on the VRM path, capped so
  their expanded size shares the 100 MiB binary limit.
- **Unchecked WebP texture sources (2026-10-22, Phase 1):** the validator did
  not range-check `EXT_texture_webp` sources. Phase 1 adds the check, because the
  new files rely on that extension.
- **WebP in the headless loader (2026-10-22, Phase 2):** loading a WebP-textured
  VRM in Node failed with `self is not defined`. GLTFLoader's built-in WebP
  plugin runs before the headless placeholder texture plugin and decodes through
  browser APIs. Every Vitest suite that loads the Included Avatars would break,
  so `headlessVrm.ts` now resolves WebP and AVIF texture sources in
  `beforeRoot`.
- **New Andrew export:** the owner's new export is a revised model, not a
  metadata-only re-export. It is about 10 cm shorter, with a new outfit and hair
  rig; see Purpose and context.

## Decision Log

- **2026-10-22, owner:** WebP q90 colour textures, lossless WebP normal and data
  textures, sparse morph targets, and bounded validator support. No 1024 px
  downscale.
- **2026-10-22, owner:** use the full-rights metadata from the new exports (R7).
  Keep Annie's current model, which includes the 2026-10-16 hair-underside fix.
- **2026-10-22, owner:** adopt the new Andrew export, with a new portrait and the
  R8 checks.
- **2026-10-22, owner:** accepted the spec and plan with these defaults:
  - O2: do not carry old-revision face-part corrections forward.
  - O3: thumbnail as a JPEG of at most 1024 px.
  - O4: vendor only the vrm-transform extension classes.
- **2026-10-22, owner (O6):** no Gesture retuning for the new Andrew. The
  Included Gestures are shared and were not retuned for the old Andrew; the new
  Andrew's proportions are closer to Annie's. The motion checks are recorded for
  reference only.

- **2026-10-22, agent (supersedes the vendoring part of O4):** the tool edits the
  GLB in place instead of vendoring vrm-transform's extension classes (about
  2,350 lines). The tool's only operations are image re-encoding, sparse
  accessors and a meta swap, so a JSON-preserving rewrite keeps every VRM
  extension, index and name by construction. It also needs no new dependency or
  licence record. sharp is already a frontend dependency.

- **2026-10-22, agent (R7 wording):** Annie is recorded as the pixiv preset
  with owner-authored embedded metadata, not as an owner-authored model. That is
  the accurate provenance, and the preset conditions still govern her
  components. Her embedded meta follows the owner's export exactly, so it no
  longer links the preset terms; the repository records keep them.

- **2026-10-22, agent (R5):** the optimizer does not run the Python backend
  validator itself; it is a Node tool. The pytest
  `test_included_avatars_pass_the_vrm_validator` runs `validate_vrm_stream` on
  every shipped Included Avatar instead, and the tool documentation tells
  authors to run the validator.

## Phased implementation

### Phase 1: validator accepts bounded sparse accessors

Review tier: **high risk.** This is security-sensitive parsing of untrusted
uploads, shared by Avatar save, the Local folder catalog, Anima creation and
package import.

Requirements: R3. Starting source: the task branch at the accepted plan revision.

Steps (TDD, in `tests/test_content_gltf.py`, then `content_gltf.py`):

1. Add failing tests with small synthetic GLBs, built with the file's
   `_vrm_document` and `_glb_source` helpers:
   - **Accepted:**
     - a morph-target accessor with no `bufferView` plus valid `sparse` data;
     - a sparse accessor with a base `bufferView`.
   - **Rejected,** with the existing reasons (`*_invalid_structure` or
     `*_binary_range`):
     - sparse count of 0, or greater than the accessor's count;
     - an index component type other than unsigned byte, short or int;
     - indices not strictly increasing, or not below the accessor's count;
     - an index or value range outside its buffer view or the binary chunk;
     - a missing or out-of-range index or value buffer view;
     - a byteOffset misaligned for its component size.
   - **Unchanged:** a VRMA containing any sparse accessor is still rejected.
2. Implement:
   - `_validate_accessors` takes an `allow_sparse` flag. Only the VRM path sets
     it.
   - For a sparse accessor, check:
     - the base `bufferView` when present, as today;
     - the indices and values ranges with the same alignment and bounds
       helpers;
     - the indices themselves, reading each once from the binary chunk.
   - Return no layout for an accessor without a base view. The VRMA path never
     sees one, because sparse stays rejected there.
3. Keep every existing size and count limit. Add no new limit unless a test
   shows a gap.

Checks:

```bash
timeout 900 uv run pytest -q tests/test_content_gltf.py
uv run ruff check src/backend/animama/app/services/content_gltf.py tests/test_content_gltf.py
timeout 1200 uv run pytest -q tests/test_content_gltf.py tests/test_product_http_typed_content.py tests/test_content_package_cross_installation.py tests/test_creation_content_admission.py
```

Because this phase is high risk, the full pre-push suite runs before its review:
`python3 scripts/heavy-slot.py -- make check-test`.

Completion: all new and existing validator tests pass; the review finds no
supported blocker.

Recovery: revert the phase commit. No data or files depend on it until Phase 3.

Check record (2026-10-22). Backend checks use `uv run --no-sync` from the root.

- Red first: the new sparse tests failed 5 of 28 before the change.
- `pytest -q tests/test_content_gltf.py`: 29 passed. This covers:
  - sparse accessors accepted with and without a base view;
  - 12 malformed cases rejected;
  - zero-filled accessors accepted, with the expanded-size cap;
  - WebP texture source range;
  - VRMA still rejects sparse.
- `pytest -q tests/test_content_gltf.py tests/test_product_http_typed_content.py tests/test_content_package_cross_installation.py tests/test_creation_content_admission.py`:
  50 passed.
- `ruff check`, `ruff format --check` and `mypy` on the touched files: clean.
  The first `make check-test` attempt found four mypy `bytearray` argument
  errors in the new tests; these are fixed.
- Generated sparse files that the old validator rejected now pass
  `validate_vrm_stream`.
- The full pre-push suite runs once on the combined Phase 1–4 tree; see Final
  integration review.

Commits: `01b6ca19 perf(content)[p1]: validate bounded sparse accessors in VRM files`.

#### Code Review #1 Findings

Reviewed: the uncommitted tree on 4354978f, Phase 1 files, high-risk tier.
The reviewer reran `pytest -q tests/test_content_gltf.py` (31 passed), `mypy`
and `ruff`, all clean.

- **F1, blocking:** the expanded-size cap counted only accessors without a
  buffer view.
  - *Memory:* sparse accessors with a base view escaped it. Three.js copies the
    base for each one, and many can share one base, one indices view and one
    values view.
  - *Time:* indices were scanned before any cap. 1024 accessors sharing 1M
    indices took 31 s to validate in a 5.9 MiB file, and loaders would allocate
    about 1 GiB.
  - *Shipped files:* unaffected, because none of their sparse accessors has a
    base view.
- **Non-blocking:**
  - `target` on sparse views is not rejected.
  - A `byteOffset` without a `bufferView` is accepted.
  - Sparse matrix accessors pass the validator but fail cleanly in three.js.
  - The shared `EXT_texture_webp` source check also applies to VRMA.
  - Test gaps: missing indices, out-of-range values view, misaligned values,
    indices past their view, and no test of the cumulative cap.
  - The Included Avatar test would skip silently if the glob found nothing.


#### Code Review #1 Revisions

- **F1, fixed:** every sparse or zero-filled accessor now adds its expanded
  size to one running total. The total is checked before its indices are
  scanned, which also bounds the scan at about 100M indices. New test
  `test_vrm_validator_caps_the_combined_size_of_sparse_accessors`: three
  base-view sparse accessors share their views under a lowered limit.
- **Non-blocking:**
  - Added a `missing-indices` rejection case and a non-empty guard on the
    Included Avatar glob.
  - Declined `target`, the stray `byteOffset` and sparse matrices: they need no
    bound and loaders handle them safely.
  - The VRMA `EXT_texture_webp` source check is an intended hardening; the spec's
    "VRMA validation is unchanged" refers to sparse acceptance.
- **Verification:** `pytest -q tests/test_content_gltf.py` 33 passed; `ruff`
  and `mypy` clean.
- **Repair rounds:** 1 of 2 used.

#### Code Review #2 Findings

Recheck of F1 (repair round 1, high-risk tier): **pass**, with no regressions.
- The reviewer reran `pytest -q tests/test_content_gltf.py` (33 passed), `mypy`
  and `ruff`, all clean.
- The attack scenario of 1024 accessors sharing 1M-index views is now rejected
  with `vrm_structure_limit` at about the 105th accessor; 64 accessors under
  the limit are still accepted.
- VRMA and dense paths are unchanged.


### Phase 2: checked-in optimizer and verifier

Review tier: **high risk.** It adds build tooling whose output is shipped
content, and it changes the headless loader that motion-authoring tests use.

Requirements: R1, R2, R5. Depends on G0 (O3).

Changes (as implemented; see the Decision Log on in-place editing):

- **`src/frontend/web/scripts/vrm-optimize.mjs`** (`pnpm -s vrm:optimize`) has
  three commands:
  - `<source> --out <file> [--meta <json>]` optimizes, then verifies its own
    output before writing it;
  - `verify <source> <optimized> [--meta <json>]`;
  - `compare <source> <optimized> --out <dir> [--min-psnr 45]` renders the
    face, torso, body and back with the app's MToon patch in SwiftShader
    Chromium and reports PSNR.
- **`scripts/vrm-optimize/glb.mjs`:** GLB read and write, dense accessor
  expansion (stride and sparse), and an aligned binary builder.
- **`scripts/vrm-optimize/optimize.mjs`:**
  - refuses non-VRM-1.0 files, external buffers and unlisted extensions;
  - classifies images by texture slot: colour slots (base colour, emissive,
    MToon shade multiply, matcap, rim multiply) become WebP q90 with
    alpha-quality 100; every other slot becomes lossless WebP;
  - keeps the original encoding when WebP is larger;
  - re-encodes the thumbnail as a JPEG q85 of at most 1024 px;
  - stores a float morph accessor sparsely when smaller, with no data at all
    when it is all zeros;
  - swaps the meta while keeping `thumbnailImage`;
  - rebuilds only the buffer views.
- **`scripts/vrm-optimize/verify.mjs`:** the JSON must match after normalizing
  buffer storage, image encoding and the expected meta. Every accessor's values
  must match (floats compare numerically), and every image must keep its size
  (the thumbnail may only shrink). The CLI then compares a three-vrm headless
  load summary of both files: meshes, morph names, expressions, bones and
  spring joints.
- **`scripts/vrm-optimize/compare/`:** the render page.
- **`src/lib/avatar/motion-authoring/headlessVrm.ts`:** the placeholder texture
  plugin resolves WebP and AVIF texture sources in `beforeRoot` (see
  Discoveries), with `headlessVrm.test.ts`.
- **Tests and docs:** `scripts/vrm-optimize.test.mjs` is added to
  `test:source:unit`. `docs/frontend/runtime/vrm-optimization.md` documents
  usage and forbidden operations.
- **Backend validation of the shipped files** moves to Phase 3 as a pytest that
  runs `validate_vrm_stream` on every Included Avatar.

Checks: unit tests for texture-slot classification and the refusal paths, run
with the web vitest command scoped to the new folder; `pnpm check`;
`pnpm web:lint`; the verifier run on a fixture.

Completion: running the tool on the two current files reproduces the measured
sizes (about 4.7 MB) and the verifier passes.

Recovery: the tool is offline-only, so revert its commit.

Check record (2026-10-22). Frontend commands run from `src/frontend/web`.

- `node --test scripts/vrm-optimize.test.mjs`: 5 passed. They cover:
  - colour textures become WebP and data textures stay pixel-identical;
  - sparse and all-zero morph targets;
  - meta and thumbnail;
  - the verifier passes clean output and catches a changed value;
  - VRM 0 and meshopt files are refused.
- Red first: `vitest run src/lib/avatar/motion-authoring/headlessVrm.test.ts`
  failed with `self is not defined`, then 1 passed after the `beforeRoot` fix.
- `pnpm check` (from `src/frontend`): clean after replacing a TypeScript
  parameter property that `erasableSyntaxOnly` rejects. `pnpm web:lint`: clean.
- **Optimizing Annie** (`pnpm -s vrm:optimize`): 18.48 → 4.27 MB, verified.
  `validate_vrm_stream` passes. `compare` scores face 51.1, torso 47.2, body
  51.9 and back 51.6 dB.
- **Determinism:** rerunning on Andrew's source gives the identical SHA-256
  (`926f7f86…`).

Commits: `942310d6 perf(avatars)[p2]: add a VRM optimizer that keeps every expression`.

#### Code Review #1 Findings

Reviewed: the uncommitted tree on 4354978f, Phase 2 files, high-risk tier.
The reviewer reran `node --test scripts/vrm-optimize.test.mjs` (5 passed) and
the headless vitest (1 passed), and ran the tool on Annie's source. The output
was byte-identical to the shipped file, and `verify` behaved correctly with and
without `--meta`.

- **F1, blocking:** data textures with alpha were not stored losslessly, and
  the verifier could not tell.
  - sharp 0.34.5's lossless WebP zeroes the colour under fully transparent
    pixels.
  - `compareVrm` compared only image sizes.
  - The shipped files are unaffected, because their data images have no alpha.
- **F2, blocking:** the CLI accepted unknown options and `--help` was broken.
  - The reviewer ran with the typo `--mta`; it exited 0 and kept the source's
    licence meta.
  - `--help` exited 1 with "needs a value".
- **Non-blocking:**
  - An existing `EXT_texture_webp` fallback `source` was dropped, and the
    normalization hid the removal.
  - The thumbnail check allowed an un-downscaled thumbnail.
  - The R5 validator deviation was not logged.
  - Doc wording overclaimed preservation of unknown extensions and understated
    what changes; the page was missing from the README index.
  - Images that carry a `uri` crashed with a TypeError.
  - Undeclared extensions were not refused.
  - `compare` had no `pageerror` early exit.
  - The tamper test mutated the shared buffer.
  - Observation for G1: lossy WebP fills the colour under transparent pixels in
    MASK cutout textures, so hair edges might look slightly lighter.
  - The headless loader change was confirmed safe.



#### Code Review #1 Revisions

- **F1, fixed:** a data image is converted only if the WebP decodes to the same
  RGBA pixels; otherwise the original is kept. `compareVrm` now requires
  identical pixels for every data-role image.
- **F2, fixed:** `parseArgs` accepts only each command's options (`out`/`meta`,
  `meta`, `out`/`min-psnr`), rejects values that look like flags, and treats
  `--help` as a flag. `pnpm -s vrm:optimize x --out y --mta z` now fails with
  "Unknown option --mta", and `--help` prints the usage.
- **Non-blocking fixes:**
  - A texture's fallback `source` is kept unless it is the converted image, and
    the verifier compares `webpFallback`.
  - The thumbnail must be at most `min(source, 1024)` px.
  - The R5 deviation is in the Decision Log.
  - The docs are corrected and listed in `docs/frontend/README.md`.
  - Images without a `bufferView` are refused clearly, and every `extensions`
    key in the document is checked against the allowlist.
  - `compareVrm` raises a clear error for non-VRM-1.0 input.
  - `compare` races the readiness wait against `pageerror`.
  - The tamper test copies its buffer.
  - The G1 observation is noted for the owner check.
- **New tests:**
  - a padded RGBA data texture keeps its PNG, and a forced lossless WebP of it
    is reported as `data image 1 pixels differ`;
  - an existing fallback is kept;
  - CLI option errors and `--help`.
- **Verification:**
  - `node --test scripts/vrm-optimize.test.mjs` 8 passed.
  - Both shipped files regenerate byte-identically: `15081670…` and `926f7f86…`.
  - CLI typo and `--help` behave as described.
- **Repair rounds:** 1 of 2 used.

#### Code Review #2 Findings

Recheck of F1, F2 and the non-blocking items taken (repair round 1,
high-risk tier): **pass**, with no regressions.
- The reviewer reran `node --test scripts/vrm-optimize.test.mjs` (8 passed)
  and the CLI typo and `--help` cases.
- An RGBA data texture now stays PNG, with 0 differing bytes.
- Undeclared Draco, image URIs and non-VRM inputs are refused clearly.
- Annie regenerates byte-identically (`15081670…`).

One new minor note: a thumbnail over 1024 px whose JPEG is not smaller would
have been kept and then refused by the verifier. It is fixed: an oversized
thumbnail is always downscaled. That trivial repair was verified with the unit
tests (8 passed) and a byte-identical regeneration of Annie.


### Phase 3: regenerated starter files and licence records

Review tier: **high risk.** It changes shipped Included content and licence
records.

Requirements: R1, R2, R4, R5, R6, R7. Depends on Phases 1 and 2.

Steps:

1. **Sources:**
   - Annie: the current `content/included/avatars/AvatarSample_A_1_New.vrm`.
   - Andrew: the owner's new export. Confirm its SHA-256 matches the value in
     Purpose and context, then commit it unoptimized over `Andrew.vrm` in this
     phase's first commit, so the source is in history (R5).
   - Write the R7 meta JSON for each into the tool's input folder in the
     repository.
2. **Generate:**
   - run `pnpm -s vrm:optimize` with `--meta` for both;
   - run `--verify` against each source;
   - run the backend validator;
   - render both files and compare them to their sources.

   Record the sizes, SHA-256 values and PSNR in this plan.
3. **Replace the LFS files.** The file names stay the same, because Included
   display names derive from the file stem.
4. **Digest and licence records:**
   - Annie's eyelid profile key moves to her new SHA-256, and its test follows.
   - Update `art-vroid-review.json` (sha256 and embedded meta), the inventory
     rules, `art-NOTICES.md`, `source-review.json` and
     `docs/frontend/desktop/redistribution-review.md` where it states the
     terms. Both Avatars become owner-authored VRoid models with the R7
     settings, and Andrew's entry describes the revised model.
   - Keep the Annie hair-recolour note in `art-NOTICES.md`, updated to the new
     hash.
   - `content/included/README.md` describes the files and the tool.
5. **O2:** document in the face-part documentation that corrections saved
   against an earlier Included revision must be saved again. Done in
   `docs/frontend/runtime/avatar-vfx.md` during the final integration repairs.
6. **Tests:** run the licence, Included-content and starter tests:

   ```bash
   timeout 1200 uv run pytest -q tests/test_included_content_integrity.py tests/test_included_content_catalog.py tests/test_starter_content_closure.py tests/test_content_portability.py tests/test_anima_starters.py tests/test_anima_presentations.py
   ```

   Also run the eyelid vitest and a starter Anima package export and import
   through the existing package tests. Andrew-specific frontend tests may fail
   here; Phase 4 owns them, so record them as expected failures in the check
   record.

Completion: R1, R2, R4, R5 and R7 have evidence; Annie's tests pass.

Recovery: restore the previous LFS objects and records from the phase's parent
commit. Installations pick up the restored revision on their next catalog sync.

Check record (2026-10-22):

- **Sources:**
  - Annie: the repository file at `4354978f` (SHA-256 `1119bfc6…`).
  - Andrew: the owner's export (SHA-256 `c06314f1…`, 16,952,868 bytes).
- **Meta:** the R7 meta files in `scripts/vrm-optimize/included-meta/` match
  both exports' `VRMC_vrm.meta`, excluding `thumbnailImage`.
- **Results:**

  | File | Source | Shipped | SHA-256 | Face / torso / body / back PSNR |
  |---|---|---|---|---|
  | `AvatarSample_A_1_New.vrm` | 18.48 MB | 4.27 MB | `15081670b379842b584062c541680472bbbe0a11a19d5aff4cb59a86f88e3fc9` | 51.1 / 47.2 / 51.9 / 51.6 dB |
  | `Andrew.vrm` | 16.95 MB | 4.99 MB | `926f7f86eccd8dd60566ae6cbd208d5a151b555a9d6c0db34c8d653f66a64f63` | 51.8 / 46.3 / 49.2 / 47.1 dB |

  Each file has 56 sparse and 58 all-zero morph accessors and passes
  `--verify` and `validate_vrm_stream`. Package capability derivation (`_gltf`)
  returns `VRMC_vrm/1.0` for both.
- **Records updated:**
  - the Annie eyelid profile key;
  - `art-vroid-review.json` (sha256, embedded meta, condition, owner edit,
    status; Andrew's portrait sha256);
  - `source-review.json` (basis and conditions, mirrored from the review);
  - `inventory.json` (provenance);
  - `art-NOTICES.md`, `content/included/README.md` and
    `docs/frontend/desktop/redistribution-review.md`.
- **New test:** `test_included_avatars_pass_the_vrm_validator`, 2 passed.
- **Backend tests:**
  - `pytest -q tests/test_included_content_integrity.py tests/test_included_content_catalog.py tests/test_starter_content_closure.py tests/test_content_portability.py tests/test_anima_starters.py tests/test_anima_presentations.py scripts/public-release/test_prepare_source.py`:
    92 passed.
  - `pytest -q tests/test_content_package_*.py scripts/package-sets/test_hosted_application.py`:
    343 passed.

Commits:
- `faa29944 chore(avatars)[p3]: record the owner's revised Andrew export`, the R5
  source commit; it leaves the records describing the old model until the next
  commit.
- `e7b5c7fd perf(avatars)[p3-p4]: ship optimized starter Avatars and the revised
  Andrew`.

The `tests/test_content_gltf.py` Included-Avatar tests were held back from the
Phase 1 commit because they need the optimized files.

#### Code Review #1 Findings

Reviewed: the uncommitted tree on 4354978f, Phase 3 files, high-risk tier.

What the reviewer verified independently:
- the SHA-256 values and sizes (Andrew 4,990,940 and Annie 4,266,712 bytes);
- the embedded meta against R7 and the records;
- the portrait hash;
- no old digests outside the plans;
- the source-review mirroring;
- `--verify` of both files against their sources;
- byte-identical regeneration.

The reviewer also reran the targeted pytest set (69 passed) and the eyelid
vitest (15 passed).

- **F1, blocking:** two sections of `art-vroid-review.json` were stale.
  - `conflict_analysis.owner_evidence` still said Annie's authors list only
    pixiv.
  - `owner_confirmation` had no 2026-10-22 entry. Its 2026-09-15 scope ("retain
    other license settings") and its `andrew_starter` entry described models
    that are no longer shipped.
- **Non-blocking:**
  - 107 effect-template thumbnail entries in `source-review.json` still
    mirrored Annie's old condition, and the template README called Annie
    "unmodified".
  - The records call Annie a pixiv preset with owner metadata rather than
    owner-authored; record that choice.
  - The R7 meta drops the preset links from Annie's embedded meta (owner
    awareness only).
  - The Included Avatar test does not guard the file names or the 5 MB cap.
  - R5 commit order is still to do.



#### Code Review #1 Revisions

- **F1, fixed:**
  - `owner_evidence` now records the authors discrepancy as history before
    2026-10-22.
  - A new `owner_confirmation.starter_metadata_and_andrew_revision` entry
    (2026-10-22) records Annie's metadata replacement and the adopted Andrew
    export with its SHA-256. Its scope supersedes the 2026-09-15 "retain other
    license settings" and is not a relicense or publication approval.
  - `review_date` is now 2026-10-22.
- **Non-blocking:**
  - The 107 effect-template entries now mirror Annie's current condition and
    basis, and the template README no longer says "unmodified".
  - Added `test_included_avatars_are_the_two_starters` and a 5,000,000-byte size
    assertion.
  - Annie's wording is recorded in the Decision Log.
  - R5 is handled in the commit sequence.
- **Verification:** `pytest -q tests/test_content_gltf.py tests/test_included_content_integrity.py tests/test_starter_content_closure.py scripts/public-release/test_prepare_source.py`
  80 passed; `ruff` and `mypy` clean.
- **Repair rounds:** 1 of 2 used.

#### Code Review #2 Findings

Recheck of F1 and the non-blocking items taken (repair round 1, high-risk
tier): **pass**, with no regressions.
- The reviewer reran the 80-test pytest set (passed) and `ruff`, and confirmed
  the 107 entries mirror Annie's condition.
- The old condition text no longer appears outside the plans, and the shipped
  VRM hashes are unchanged.


### Phase 4: the new Andrew verified

Review tier: **high risk.** It changes shipped starter content and the measured
expectations that guard Gesture quality.

Requirements: R8. Depends on Phase 3.

Steps:

1. **Reference record:** before switching any test data, run the motion checks
   (`pnpm -s animation check <clip> --json`, from `src/frontend/web`) over every
   Included Gesture, Pose and Reaction on the old Andrew, at Phase 3's parent
   commit. Then run them on the new Andrew. Record per-clip FAIL and WARN
   counts for both in this plan, plus the list of new FAILs.
2. **No retuning (O6):** do not edit Gestures, Poses or Reactions. The table is
   reference evidence for the PR.
3. **Re-measure Andrew-specific expectations** on the new model:
   - Andrew's samples in the Included clip baseline, re-recorded with the
     baseline's documented re-record procedure for Andrew only. Annie's samples
     must not change.
   - Arm, hand-preset and hand-offset values.
   - Expected face parts.
   - The eyelid test. If happy or relaxed no longer closes the eyelids with the
     default profile, add a measured profile for the new digest.

   Record each changed expectation with its old and new values and the reason.
4. **Portrait:** capture Andrew's portrait with the generator on `main` at the
   time, using its debug route or script. Write
   `app-avatar-model-andrew-v1.webp` and its `.meta.json` with that generator's
   size and versions, and update `portrait_sha256` in `art-vroid-review.json`.
   If the portrait upgrade has merged, use its new generator and file
   conventions.
5. **Effects:** run `pnpm -s effects check` for a face-painted Avatar Effect and
   a particle effect on both Avatars to confirm face-part anchors and
   attachment.
6. **Spring bones:** load the new Andrew and confirm that the spring semantic
   classifier still labels the `Hair` and `TopsUpperArm` chains as before.

Checks: the touched vitest files, `includedClipBaseline.test.ts`,
`includedGestures.test.ts`, the effects tests,
`timeout 1200 uv run pytest -q tests/test_anima_presentations.py tests/test_starter_content_closure.py`,
`pnpm check` and `pnpm web:lint`.

Gate G1 (owner): on a task stack (`./reset.sh --name svo --base-port 8900`)
with the built application, check that:

- Annie looks unchanged in chat;
- the new Andrew looks right in chat, the Library and Create Anima;
- a sample of Andrew's Gestures and Reactions plays correctly, including
  hand-to-face contacts and `Fcl_*` expressions;
- an Avatar Effect painted on the face renders correctly on both Avatars.

Tear the stack down after G1.

Completion: R8 has evidence and G1 has passed.

Recovery: revert Phase 4 together with Phase 3's Andrew changes to return to the
old Andrew. Annie's changes and Phases 1–2 can stay.

Check record (2026-10-22):

- **Motion checks**, Andrew's own FAIL findings only, over every Included
  Gesture, Pose and Reaction that parses (320 clips). Reference record, no
  retuning (O6):

  | Model | Clips with a FAIL | FAIL findings | WARN findings |
  |---|---|---|---|
  | Old Andrew | 24 | 52 | 17 |
  | New Andrew | 23 | 46 | 19 |
  | Annie (current) | 1 | 2 | 1 |

  Newly failing on the new Andrew: `big-x-batsu`. No longer failing:
  `detective-squint` and `hands-behind-head-relax`. `KNOWN_ANDREW_FAILURES` in
  `includedGestures.test.ts` follows: `big-x-batsu` is added and
  `detective-squint` removed. `hands-behind-head-relax` still fails a
  canonical range check computed from Andrew's solved arm (Andrew is the first
  Avatar), so it stays listed. The batch script and JSON are kept outside the repository with the
  task's drafts.
- **Re-measured expectations**, old → new, all from the new model:
  - `arms.test.ts`: head height 1.46 → 1.367 m; contact misses before solving
    are now 5–9 cm (comments updated).
  - `handPresets.test.ts`: Andrew's seven digests re-recorded. `relaxed` is
    unchanged; the others change with his smaller hands.
  - `faceParts.test.ts`: the same parts, re-indexed. The face mesh node is
    149 → 144 and hair is 151 → 146. Signal detection agrees with name
    detection, at confidence 0.6–0.9.
  - `includedClipBaseline`: Andrew's 145 clip samples re-recorded after his old
    samples were dropped. `UPDATE_CLIP_BASELINE=1` confirmed Annie's samples are
    unchanged, and the diff touches no Annie line.
  - Eyelids: the default profile still closes the new Andrew's eyes. The
    existing test passes, and no measured profile is added.
- `vitest run src/lib/avatar`: 66 files, 1232 passed, 1 skipped.
- **Portrait:** captured headlessly on the real GPU (ANGLE Metal) with the
  current generator (renderer 1, preset 2, 512 px). It was canonicalized to
  256 px by `canonicalize_avatar_portrait`, SHA-256 `be9eb950…`, and the meta
  file is unchanged. A recapture of Annie with the same setup differs from her
  shipped portrait by about 12/255 on average, from framing and lighting, so
  the setup matches the generator rather than reproducing old bytes.
- **Effects:**
  - `pnpm -s effects check content/included/vfx/avatar/blush`: PASS on both
    Avatars; the painted face texture works with WebP.
  - `pnpm -s effects check …/particle/quark/aroma-ribbons`: passed. Its WARNs
    are art-level and identical on both Avatars.
- **Spring classifier:** old Andrew 90 joints (hair 48, cloth 42), new 85
  (hair 43, cloth 42), no unmapped joints or warnings. Annie 34 (hair 24,
  cloth 6, chest 4).

Commits: `e7b5c7fd`, combined with Phase 3, because the new Andrew file and his
re-measured expectations must change together to keep the tests green.

#### Code Review #1 Findings

Reviewed: the uncommitted tree on 4354978f, Phase 4 files, high-risk tier.
The reviewer reran
`vitest run src/lib/avatar/motion-authoring src/lib/avatar/poses/anatomy src/lib/avatar/vfx/faceParts.test.ts src/lib/avatar/eyelidClosure.test.ts`
(689 passed, 1 skipped) and `animation check` on the three changed known-failure
clips. Result: pass, no blocking findings.

- **N1:** the record called the remaining `hands-behind-head-relax` failure
  shared. It is a canonical range finding computed from Andrew's solved arm,
  because Andrew is the first Avatar.
- **N2:** the baseline re-record procedure did not cover an Avatar whose model
  changes under the same id.
- **N3:** one hair tip touches the new portrait's top edge (4 pixels); left to
  G1.

Verified:
- Annie's baseline samples are identical.
- The known-failures semantics still hold.
- The re-measured values match bone measurements: head 0.938×, hands smaller,
  shoulders narrower.
- The face parts are only re-indexed.
- Portrait alpha and framing are correct, and `portrait_sha256` matches.


#### Code Review #1 Revisions

- **N1:** the record now says the failure is computed from Andrew.
- **N2:** the `includedClipBaseline.test.ts` doc comment now says to delete
  the changed Avatar's samples first; prettier clean.
- **N3:** no change; it goes to G1.
- **Repair rounds:** none needed; the edits are trivial (wording only).


## Final integration review

Interim evidence: `python3 scripts/heavy-slot.py -- make check-test` passed on
tree `1c361531` (4745 passed, 29 skipped; format, lint and mypy clean). That
tree predates the Phase 1 F1 fix, the Phase 3 test additions and the Phase 2
repairs, so the final candidate reruns the full suite.

Covers combined acceptance R1–R8 and the interaction between the validator and
the shipped files. After its repairs, run once on the final candidate:

```bash
python3 scripts/heavy-slot.py -- make check-test
cd src/frontend && python3 ../../scripts/heavy-slot.py -- pnpm verify && pnpm prettier:check && python3 ../../scripts/heavy-slot.py -- pnpm web:test:browser
cd src/frontend && python3 ../../scripts/heavy-slot.py -- pnpm e2e:test
```

The full `e2e:test` is required because starter Anima content changes. Results go
in the PR.


### Final integration review findings

Reviewed: committed HEAD `e7b5c7fd` on baseline `4354978f`. Result: **pass**,
no blocking findings. The review ran no checks, per policy. It confirmed:
- the validator accepts exactly the optimizer's sparse and zero-filled layout;
- the shipped bytes, embedded meta and records agree;
- digests appear only where expected;
- loaders handle WebP;
- no boundary changes and no leftovers.

Non-blocking:
- **N1:** plan records were stale (progress, commits, stack).
- **N2:** the O2 documentation step had no outcome.
- **N3:** regeneration steps lived only in the plan.
- **N4:** `COLOUR_WEBP`, `DATA_WEBP` and `assertSupported` were exported but
  unused.
- **N5:** the O4, R5 and R7-wording deviations need disclosing to the owner in
  the PR.
- **N6:** `faa29944` is inconsistent by design.

### Final integration revisions

- **N1:** records updated.
- **N2:** `avatar-vfx.md` now says the owner saves a correction again after an
  Included revision changes, for example a re-encode.
- **N3:** `vrm-optimization.md` gains "Regenerating the Included Avatars" with
  the source commits and the command.
- **N4:** the three are module-private.
- **N5:** to be disclosed in the PR.
- **N6:** no action.

These are trivial repairs (wording and export removal). Verification:
`node --test scripts/vrm-optimize.test.mjs` 8 passed; prettier and eslint clean
on `optimize.mjs`.

## Validation and acceptance

The spec's acceptance criteria apply. Evidence:

- **Phase 1:** validator tests.
- **Phase 2:** the verifier output and sizes.
- **Phase 3:**
  - the backend validator on the shipped files;
  - the PSNR table;
  - the digest and licence record comparison;
  - the package round trip.
- **Phase 4:** the old and new Andrew motion-check tables, the re-measured
  expectations with reasons, and the portrait files.
- **Final candidate:** the full pre-push suite and the full e2e run.
- **G1:** the owner's visual check, recorded in the PR.

The Cloud repin is a separate deployment outcome.

## Idempotence and recovery

- **The tool is deterministic for fixed inputs and dependency versions.**
  Rerunning it on the sources reproduces the files; Phase 3 records the
  expected SHA-256 values.
- **The sources stay in Git history.** Annie's is at `0a9b3549`. Andrew's old
  model is at `42ffbed4`, and his new source export is in Phase 3's first
  commit.
- **Reverting is safe.** Each phase reverts independently in reverse order.
  Phase 1 can stay even if Phases 3–4 are reverted.

## Outcomes & Retrospective

_Pending._
