# Ship Included effect art as WebP derivatives

Source agreement: raymond-van/animama#655 (filed 2026-10-22). The issue is the
spec; this plan does not restate it. Owner decisions on its open questions are
recorded in the Decision Log (2026-10-22).
Authorized scope: none yet. The owner reviews this plan before Phase 1 starts.
Merge, release, publication and the Cloud repin keep their separate approvals.

## Purpose and context

Included effect art ships as 421 PNG files (54.6 MB) and is byte-copied into
every packaged form of the product. This plan converts the art to WebP while
packaging the desktop runtime and the hosted catalog seed, keeping the PNG files
in Git as the editable masters. A measurement on the 2026-10-22 tree put the
converted size at about 13.5 MB (q90, alpha exact). The issue records the
per-area table and the lowest-fidelity files.

Starting source: `main` at `4354978f`, branch `perf/included-effect-webp`.

### How Included content ships today

Paths are from the repository root.

- **Desktop staging.** `pnpm desktop:runtime:stage` runs
  `src/backend/packaging/desktop/stage_content.py`, which does four things:
  - It lists tracked files with `git ls-files content/included` and calls
    `starter_inventory(included, allowed_paths=…)`
    (`src/backend/animama/runtime/starter_content.py`). That call resolves the
    starter and library closures, hashes every file and looks up each file's
    licence.
  - It byte-copies each file into `runtime/content/included-core` or
    `pack-inputs/expanded-included-content`, together with
    `licenses/inventory.json`.
  - It re-runs `starter_inventory` on the staged core and requires the same entries.
  - It writes `starter-content-inventory.json` (built from the source) and
    `included-core/inventory.json` (built from the staged copy).

  `src/frontend/desktop/scripts/runtime/audit.mjs` then runs the frozen backend
  `content audit` on the staged core. `licenses.mjs` builds licence records from
  the source inventory.
- **Hosted catalog seed.** `scripts/package-sets/catalog_seed.py`
  `prepare_seed` runs `starter_inventory` on the source snapshot and byte-copies
  each file to `catalog-seed/included/…`. `verify_catalog_seed` checks the copied
  bytes against the inventory. It also requires the `included/` files to equal
  the inventory's files plus exactly one `included/licenses/inventory.json`.
  `scripts/repository-boundary/consumers/catalog_seed.py` re-resolves the
  inventory from the seed bytes alone.
- **Cloud.** The hosted API verifies the seed the same way
  (`animama_hosted/artifacts/application.py`): file rows need at least `path`,
  `sha256`, `size_bytes` and `license`, extra keys are allowed, and there is
  exactly one licence file. Cloud runs the Included scanner from the Animama
  wheel, so it picks up changes to the scanner when it repins.
- **Self-host and development** bind-mount or copy `content/included` as it is.
  By decision they keep serving the PNG masters.
- **Licence lookup.**
  - `starter_inventory.file_license` matches each file path against the `glob`
    rules in `content/included/licenses/inventory.json`, taking the first match.
  - `FilesystemContentStore._with_distribution` matches the entry locator and
    every file path the same way to decide distribution.
  - 65 rules name `.png` explicitly, and `vfx/scene/**/*.png` precedes the
    catch-all `**/*`, so a renamed `.webp` would silently get another rule's
    licence.
- **Signatures.** `content_kind_registry.py` checks file signatures by extension.
  A `.png` holding WebP bytes fails `invalid_png_header`, so derivatives must be
  renamed and every descriptor reference rewritten.
- **Descriptor fields that name images:**
  - `files[].path` in all effect descriptors;
  - `definition.art.image` and `definition.art.otherEyeImage` in Avatar Effects;
  - `image` in Scene items and tiles;
  - `images[].url` (and the cosmetic `textures[].name`) in Quarks `particle.json`.
- **Scene stickers.** These are Vite build assets, not packaged content:
  - `src/frontend/web/src/lib/scene-vfx/stickers.ts` loads
    `content/included/resources/scene-vfx/stickers/*.png` through
    `import.meta.glob(…, { query: "?url" })`;
  - it requires `STICKER_FILE = /\.png$/`;
  - it hands stickers to effects as `${id}.png` with `type: "image/png"`.
- **Recorded third-party hashes.** `licenses/third-party/art-particles.json`
  records byte-for-byte PNG hashes for CC0 particle textures. `effects.test.mjs`
  checks them, and `licenses/third-party/art-NOTICES.md` describes them. The
  CodeManu `spark-pop-6x5.png` carries a CC BY 4.0 change notice.
- **Revision identity.** `FilesystemContentStore._entry_revision` hashes each
  file's path, role, media type, size and digest. Converted items therefore get
  new `revision_sha256` values, a new `effective_revision` and new
  revision-named URLs (one cache miss per client, ADR 0028). Item identities,
  loadouts and starter receipts are unchanged.

### Boundaries

- No change to the authoring tools (`effects:assets`, Promote to Included,
  `effects check`) or to the PNG masters in Git.
- No change to self-host or development serving of packaged content.
- Avatar VRM textures, docs, skills, brand and desktop icons are out of scope.
- Cloud work is limited to a repin with its own approval and record. This plan
  expects no Cloud code change and verifies that claim (Phase 2).

## Progress

- [x] Phase 1: Converter and derivative-aware licence lookup. Reviews #1 and
  #2 passed (one repair round). Committed as `perf(content)[p1]`.
- [x] Phase 2: Desktop staging and hosted seed ship converted art. Reviews #1
  and #2 passed (one repair round). Committed as `perf(content)[p2]`.
- [ ] Phase 3: Third-party licence records describe the shipped derivatives. Not started.
- [ ] Phase 4: Scene stickers built as WebP. Not started.
- [ ] Final integration review. Not started.
- [ ] Owner gate: visual check on a packaged desktop build (both Included Avatars).
- [ ] Owner gate: Cloud repin to the merged commit (Cloud record, separate approval).

## Surprises & Discoveries

- 2026-10-22, during planning: the hosted seed and Cloud allow exactly one
  licence file under `included/licenses/`. A separate `derivatives.json` would
  fail both verifiers. The derivation record therefore goes inside the staged
  copy of `licenses/inventory.json` (Phase 1, R3).
- 2026-10-22, during planning: Cloud's seed row check allows extra keys, so
  adding `derived_from` to inventory file rows needs no Cloud code change.
- 2026-10-22, during planning: the 38 PNGs in
  `vfx/particle/particle-vfx/textures` (6.2 MB) back the Particle creator's
  built-in texture library (`editor/textureManifest.ts`). That library names
  `*.png` and fetches `/effects/vfx/particle-vfx/textures/…`, which desktop does
  not alias (`copyBuildAliases: false`, `/effects/vfx` is a no-fallback prefix in
  `local/http/assets.py`). Phase 2 must establish what packaged desktop and hosted
  builds actually serve at those URLs before relying on them.
- 2026-10-22, Phase 1: no content descriptor lists those 38 library PNGs, so the
  starter inventory never ships them as content. Converting them made the
  scanner admit each `.webp` as a new standalone item. The converter therefore
  re-encodes only files that a descriptor's `files[].path` lists. Nine library
  textures have byte-identical copies inside Quarks effects
  (`poof-smoke`, `energy-wave-charge`, `fireflies`). Those copies are content
  and do convert. This changes what the CC0 decision covers; see Phase 3.
- 2026-10-22, Phase 1: libwebp method 6 took 179 s for the 379 effect PNGs;
  method 4 took 2.6 s for 4% more bytes (14.7 MB against 14.1 MB). On the
  tracked tree at `4354978f` the converter turns 338 descriptor-owned PNGs
  (42.47 MB) into 13.18 MB of WebP in 2.8 s; the rest stay PNG.
- 2026-10-22, Phase 1: two masters (`particle-vfx/textures/heart-v2.png`,
  `star-v2.png`) carry a PNG gAMA of 0.45455, the sRGB-equivalent value, so
  dropping it on re-encoding changes nothing visible. Neither ships as content.

## Decision Log

- 2026-10-22, owner: ship WebP q90 derivatives produced at packaging time and
  keep the PNG masters in Git (#655).
- 2026-10-22, owner: convert only in desktop staging and the hosted catalog
  seed. Development and self-host keep serving the PNG masters, and the visual
  check runs on a packaged desktop build.
- 2026-10-22, owner: Scene stickers are in scope as the last phase, through a
  Vite build step.
- 2026-10-22, owner: a derivative's licence is looked up through its recorded
  PNG master path. The inventory rules are not rewritten.
- 2026-10-22, owner: convert the CC0 particle textures too, and record each
  WebP derivative's hash beside the PNG hash.
- 2026-10-22, agent proposal (accepted with the plan): encode with Pillow 12
  (libwebp 1.6.0, locked in `uv.lock`) in the Python packaging step. Encoder
  settings: lossy quality 90, `alpha_quality=100`, `method=6`, `exact=True`.
  Face-surface art uses lossless WebP with `exact=True`.
- 2026-10-22, agent proposal: Scene stickers (Phase 4) are encoded by sharp
  0.34.5, already a frontend dependency, inside the Vite build. Sticker bytes
  are not in any inventory, so they need not match Pillow's output byte for byte.
- 2026-10-22, owner (revises the CC0 decision after the Phase 1 discovery): the
  38 CC0 library textures stay PNG web assets. Phase 3 records WebP hashes for
  the nine converted Quarks copies and updates the notices and the
  "unmodified copies" provenance text.
- 2026-10-22, agent (Phase 1, within the accepted outcome): use libwebp
  `method=4` instead of 6, because 6 cost about 70 times the time for 4% smaller
  files. Quality 90 and exact alpha are unchanged.
- 2026-10-22, agent (Phase 1): convert only descriptor-owned files, and never
  files whose licence rule sets a `distribution` restriction. Restricted bytes
  are recognised by digest, so they keep their master bytes.

## Phased implementation

### Phase 1: Converter and derivative-aware licence lookup

Review tier: high risk. It changes licence resolution and distribution
decisions, which shared packaging and Cloud verification rely on.

Requirements: #655 R1, R3 and R5. Dependencies: none.

Intended changes:

1. Add `src/backend/animama/runtime/included_derivatives.py` with a pure function:

   ```python
   def convert_included_tree(source: Path, destination: Path, paths: Iterable[str]) -> DerivativeMap
   ```

   - **Copy.** Copy each listed source path into `destination`.
   - **Choose files.** Re-encode eligible PNGs, meaning `.png` files under `vfx/`
     and not on the exception list.
   - **Encode.** Encode each eligible PNG as `.webp` with the Decision Log
     settings.
     - Face-surface art laid over a part's UV layout gets lossless WebP. Such an
       Avatar Effect has `definition.attachment.kind == "face_surface"` and
       `area == "full"` (6 Included effects on 2026-10-22). Decal areas such
       as `blush`, `undereye` and `mouth` take centred art and stay lossy.
     - A file stays PNG when its WebP is not smaller.
     - Encoding is deterministic: identical inputs give identical bytes.
   - **Rewrite descriptors.** Rewrite every descriptor field listed under
     Purpose and context for each renamed file. Rewritten JSON keeps its key
     order and is written with two-space indentation, so it is reproducible.
     Unchanged descriptors stay byte-identical.
   - **Fail loudly.** Raise with the file named when:
     - a descriptor names an image that does not exist after conversion;
     - a renamed image is still referenced by its old name;
     - Pillow cannot decode a master.
   - **Return the map.** Return a `DerivativeMap`: derivative path → master
     `{path, sha256, size_bytes}`.
   - **Fast reruns.** Encode on a thread pool (Pillow releases the GIL while
     encoding). At method 4 the whole tree converts in about 3 s, so no cache
     is needed.
   - Keep the exception list as a small constant in the module, with a comment
     giving each entry's reason. It starts empty; the visual gate may add to it.

2. Record derivatives inside the converted tree's own `licenses/inventory.json`.
   - Rewrite the staged copy with a new top-level `derivatives` object, keyed by
     derivative path, whose values are the master record.
   - Keep `rules` byte-identical in meaning (same order and content). The source
     file in Git is never edited.
   - Write the staged copy with the same JSON formatting as rewritten descriptors.

3. Add one helper, used by both licence lookups, that maps a path to its
   licensing path (the master path when a derivative is recorded):
   - `starter_inventory.file_license` and its distribution checks use it;
   - `FilesystemContentStore._license_inventory` / `_with_distribution` use it.
     It reads `derivatives` from the same file as `rules`;
   - a tree without `derivatives` behaves exactly as today.

4. Make each `starter_inventory` file row for a derivative carry
   `derived_from: {path, sha256, size_bytes}`. Its `license` is the master's
   record.

Checks (from the repository root):

- New `tests/test_included_derivatives.py`:
  - Converting a small fixture tree renames and rewrites every field kind, keeps
    unchanged files byte-identical, and is byte-identical across two runs.
  - Transparent pixels keep their RGB (the edge bleed): decode the derivative
    and compare RGB where alpha is 0 against the master.
  - Alpha is exact: the maximum alpha difference is 0.
  - A file whose WebP is not smaller stays PNG.
  - Surface art is lossless (decoded pixels are equal).
  - A dangling or stale reference raises with the file named.
- A licence-parity test runs the converter on the real `content/included` into a
  temporary directory and calls `starter_inventory` on it. It checks that every
  derivative row's `license` equals what its master resolves to in the source
  inventory. It also checks that no derivative resolves only through the `**/*`
  fallback unless its master did.
- A distribution-parity test checks that `FilesystemContentStore.scan` on the
  converted tree reports the same per-entry distribution and provenance as on
  the source tree.
- `uv run pytest -q tests/test_included_derivatives.py tests/test_starter_content_closure.py tests/test_included_content_integrity.py tests/test_included_content_catalog.py`
- `uv run ruff check` and `make format-check`.

Completion: all checks pass. The converter's measured output size for the real
tree and its run time are recorded below.

Recovery: the module is unused until Phase 2. Reverting the phase commit
restores the old behaviour with no data or packaging change.

Results: on the tracked tree at `4354978f`, 338 descriptor-owned PNGs
(42.47 MB) become 13.18 MB of WebP in about 3 s. The 41 PNGs that stay PNG are
the 38 creator library textures, `ellipsis-sheet.png` and the two
`queasy-waves` images (WebP not smaller).

Check record (repository root, Python 3.12.13, Pillow 12.0.0, libwebp 1.6.0):

| Check | Result | Tree |
| --- | --- | --- |
| `uv run --no-sync pytest -q tests/test_included_derivatives.py tests/test_content_portability.py tests/test_included_content_catalog.py tests/test_included_content_integrity.py tests/test_local_content_store.py tests/test_non_portable_packages.py tests/test_runtime_content_catalog_completeness.py tests/test_starter_content_closure.py` | 86 passed | `637e695e` |
| `ruff check`, `ruff format --check`, `mypy` (touched files), `scripts/repository-boundary/check-python-imports.py` | clean, 0 forbidden edges | `637e695e` |
| `python3 scripts/heavy-slot.py -- make check-test` | exit 0; 4736 passed, 29 skipped | `637e695e` |
| Review #1 checks agent: the same pytest set, `ruff check`, `ruff format --check`, full `mypy`, import boundary; converter run twice on the real tree | all pass; 338 derivatives, byte-identical runs | `6d74943c` |

Phase commits: _pending_ (`perf(content)[p1]: …`).

#### Code Review #1 Findings

Reviewed source: working tree `6d74943c` against `4354978f`; high-risk tier,
one analysis agent and one checks agent; initial review.

- **P1-F1 (required).** The bare-name rewrite rule could rename a reference to
  a same-directory PNG that stayed PNG when another file beneath had the same
  basename and converted. The descriptor then named missing art and staging
  would silently exclude the effect. Reproduced on a fixture; the real tree
  was not affected.
- **P1-F2 (optional).** A malformed `derivatives` record makes the store drop
  every licence rule, silently at runtime.
- **P1-F3 (optional).** The destination was created before descriptor
  validation, so a stale-reference failure left a partial tree.
- **P1-F4 (optional).** `derived_from` indexed `sha256` and `size_bytes`
  without validation (`KeyError` instead of a named error).
- **P1-F5 (test).** The real-tree test's fallback assertion could never fail,
  and distribution and provenance parity ran only on the fixture.
- **P1-F6 (records).** Issue R1 said method 6; plan text described sorted-key
  serialisation, a process pool and a cache that the code does not use.
- **P1-F7 (Phase 2 gate).** Byte identity was shown only within one machine;
  lossy libwebp output can differ between arm64 and x86_64.
- **P1-F8 (docs).** `docs/backend/architecture/local-content-storage.md`
  described distribution as rule-only.
- Verified without findings:
  - dependency direction;
  - path safety of derivative records;
  - imported packages cannot inject derivatives (they scan as Local);
  - restricted art is never converted;
  - UV-layout art is lossless;
  - masters carry no colour-management chunks.

#### Code Review #1 Revisions

- **P1-F1 accepted.** A bare name is rewritten only when no file of that name
  sits beside the JSON. A rewritten `files[].path` must name a shipped file, or
  conversion raises with the JSON and value named. New test
  `test_a_bare_name_beside_its_descriptor_is_never_rewritten_to_missing_art`.
- **P1-F2 rejected.** It keeps the store's existing convention for a malformed
  inventory. Staged inventories are produced only by the converter, and
  `starter_inventory` (staging, `content audit`, seed verification) raises on
  the same input, so a corrupt record cannot ship unnoticed.
- **P1-F3 accepted.** All descriptors are rewritten and validated before the
  destination is created.
- **P1-F4 accepted.** `parse_inventory_derivatives` now requires a lowercase
  sha256 and a non-negative integer size. Two new malformed-record cases.
- **P1-F5 accepted.** Removed the vacuous assertion. The real-tree test now also
  compares `FilesystemContentStore.scan` provenance (including distribution) for
  every entry.
- **P1-F6 accepted.** Plan text now matches the code. Issue R1 is updated to
  method 4, with the reason.
- **P1-F7 accepted as a Phase 2 check.** Phase 2 stages on macOS arm64 and in a
  Linux container and compares the derivative bytes and inventory ids.
- **P1-F8 accepted.** One paragraph added to `local-content-storage.md`.
- Verification: `pytest tests/test_included_derivatives.py` gives 16 passed;
  `ruff check` and `ruff format` are clean. A targeted recheck (Code Review #2)
  follows.

#### Code Review #2 Findings

Targeted recheck of tree `c3dbb706` (repair round 1 of 2), high-risk tier.

- **Revisions verified.**
  - P1-F1, F3, F4, F5, F6 and F8 are fixed. A reproduction of the P1-F1
    scenario now keeps `flat.png`, and a bare `files[].path` matching only
    deeper art raises before any output is written.
  - The P1-F2 rejection is sound: every packaging path calls
    `starter_inventory`, which raises on a malformed record.
- **No blocking findings.**
- **P1-R2-F1 (optional).** A bare name in a field other than `files[].path`
  (such as a Scene item `image`) with no file beside the JSON, but matching
  deeper converted art, is rewritten without an error. Its input was already
  a broken reference.
- **P1-R2-F2 (optional, cosmetic).** A Quarks `textures[].name` can become
  `.webp` when only one of two same-named textures converts. The
  `images[].url` values stay correct.
- **P1-R2-F3 (optional, test).** The malformed-record tests do not list every
  rejected form (uppercase or short sha256, negative or bool size). The code
  rejects all of them.
- Checks rerun independently on `c3dbb706`, all exit 0:
  - targeted pytest: 89 passed;
  - `ruff check` and `ruff format --check`;
  - full `mypy`: 857 files, no issues;
  - import boundary: 0 forbidden edges.

Result: pass.

#### Code Review #2 Revisions

- **P1-R2-F1 rejected.** The reference was already broken before conversion,
  and the scanner reports it as a descriptor diagnostic either way. Packaged
  `files[]` integrity, which decides what ships, is enforced.
- **P1-R2-F2 accepted with no change.** `textures[].name` is cosmetic; Quarks
  binds textures by image uuid.
- **P1-R2-F3 rejected.** Optional coverage of rejections the reviewer verified
  directly.
- Repair budget used: 1 of 2.

### Phase 2: Desktop staging and hosted seed ship converted art

Review tier: high risk. It changes packaging and release inputs.

Requirements: #655 R2, R4 and R5. Dependencies: Phase 1.

Intended changes:

1. `src/backend/packaging/desktop/stage_content.py`:
   - convert the tracked snapshot into a temporary tree with
     `convert_included_tree`;
   - map `allowed` through the `DerivativeMap`;
   - run `starter_inventory` once on the converted tree, then copy from it;
   - keep the re-verify of the staged core.

   The result: `starter-content-inventory.json`, `included-core/inventory.json`
   and the staged `licenses/inventory.json` all describe the shipped `.webp`
   paths and digests. Remove the temporary tree on success and on failure.
2. `src/frontend/desktop/scripts/runtime/licenses.mjs`: confirm that licence
   records and notices come from the converted inventory. Each derivative's
   provenance should name its master (through `derived_from`) where the record
   format shows provenance.
3. `scripts/package-sets/catalog_seed.py` `prepare_seed`: convert the snapshot
   the same way before calling `starter_inventory`, and copy from the converted
   tree.
   - `verify_catalog_seed` keeps its single-licence-file rule.
   - The repository-boundary consumer must pass unchanged, because it reads
     `derivatives` from the seed's own `licenses/inventory.json`.
4. Find out what packaged builds serve at the legacy `/effects/vfx/…` URLs:
   - in a staged desktop runtime and in the hosted web build, with and without
     `copyBuildAliases`;
   - covering the Particle creator's built-in texture library
     (`textureManifest.ts`) and `AVATAR_PARTICLE_VFX_CATALOG`
     (`/effects/vfx/quark/<stem>/particle.json`).

   Fix any consumer that names `.png` from a build-time manifest while the
   packaged build serves converted bytes. Either resolve the name through the
   served descriptor, or keep that file PNG with a recorded reason. Record the
   findings under Surprises & Discoveries.
5. Record the shipped size of Included effect art before and after, from the
   staged inventory.

Checks:

- `pnpm desktop:runtime:stage`, `pnpm desktop:runtime:audit` (from
  `src/frontend`, through the heavy-job slot):
  - zero starter diagnostics;
  - `core_content_inventory_id` equals the verified staged inventory.
- The packaged smoke journey `starter-chat-and-typed-bytes` passes on the
  staged runtime.
- `uv run --no-sync python scripts/package-sets/build.py build …` and `… validate …`
  pass, as documented in `scripts/package-sets/README.md`. The
  repository-boundary consumer resolves both starters from the seed.
- Cloud compatibility, read-only:
  - run the Cloud hosted-API seed verification against the new seed from a Cloud
    checkout, or confirm by test that the row and file-set checks accept it;
  - record the result;
  - make no Cloud commit in this plan.
- Staging the same source twice produces identical inventory ids, and staging
  on macOS arm64 and in a Linux container produces the same derivative bytes
  (P1-F7). If the platforms differ, record it and scope reproducibility to
  each build platform.
- `uv run pytest -q` (Included and packaging tests) and `uv run ruff check`.

Completion:

- The staged runtime and the seed contain WebP effect art.
- Every verifier passes.
- Sizes and the legacy-URL findings are recorded.

Recovery: staging and seed preparation write only to their output directories.
On failure they leave no partial tree; rerun after the fix. Reverting the phase
commit returns staging to byte copies.

Results:

- **Desktop staging.** It converts the tracked snapshot into a scratch tree
  (removed on exit) and resolves and copies from it. On `darwin-arm64` the
  staged core ships 338 derivatives. Its effect images total 13.21 MB, against
  42.51 MB of masters; `included-core` is 57 MB in total. The audit's
  re-resolution matches the manifest.
- **Hosted seed.** `prepare_seed` converts the same way. The seed's
  re-resolution from its own bytes equals the manifest inventory.
- **Cloud.** Its hosted-API seed verification (`_seed` in
  `animama_hosted/artifacts/application.py` at Cloud `9affbe1f`, loaded
  read-only) accepts a converted seed with 340 WebP files. No Cloud code change
  is needed.
- **Legacy `/effects/...` URLs.** Neither the desktop (`embedded-desktop`) nor
  the hosted (`--mode hosted`) web build copies them
  (`copyBuildAliases: !embeddedDesktop && mode !== "hosted"`). The audit rejects
  alias copies in the desktop runtime. Only self-host built mode copies them,
  from the PNG masters. So no packaged build serves a `.png` URL that converted
  content would miss, and no consumer change is needed.
- **Licence records.** `licenses.mjs` groups content licence records by licence
  id. Derivatives carry their masters' licence, so the desktop notices are
  unchanged, and `derived_from` stays in `starter-content-inventory.json`.
- **P1-F7: cross-platform bytes.** Encoding the 338 masters with Pillow 12.0.0 /
  libwebp 1.6.0 gave identical sha256 for every file on macOS arm64 and in
  `python:3.12-slim` containers on `linux/arm64` and `linux/amd64`.

Check record:

| Check | Result | Tree |
| --- | --- | --- |
| `uv run --no-sync pytest -q tests/test_included_derivative_packaging.py tests/test_included_derivatives.py tests/test_starter_content_closure.py` | 40 passed | `3e22cc59` |
| `ruff check` and `ruff format --check` on `src/backend tests scripts/package-sets`; `mypy` on the new test and `stage_content.py` | clean | `3e22cc59` |
| `python3 scripts/heavy-slot.py -- bash p2-desktop.sh`: `pnpm desktop:runtime:stage`, then `desktop:runtime:audit` (`--platform darwin --arch arm64`), then `pnpm desktop:test -- runtime-packaging` | stage exit 0 (263 s), "Annie + Andrew: zero content diagnostics"; audit exit 0; 71 tests passed | working tree before docs-only edits to `contracts/hosted-web.md` and the packaging README |
| Cloud `_seed` probe on a converted seed (read-only) | accepted | `3e22cc59` |
| Container encode comparison (macOS arm64, linux/arm64, linux/amd64) | 0 of 338 differ | masters at `4354978f` |
| `python3 scripts/heavy-slot.py -- make check-test` | exit 0; 4741 passed, 29 skipped | `3e22cc59` |

Package-set `build`/`validate` needs an exact commit, so it runs in the final
pre-push suite on the committed candidate.


Phase commits: _pending_ (`perf(content)[p2]: …`).

#### Code Review #1 Findings

Reviewed source: working tree `bc6a969a` against `6580cfa8`; high-risk tier,
one analysis agent and one checks agent; initial review.

The checks agent reran the following on `bc6a969a`, all exit 0:

- targeted pytest: 52 passed;
- `ruff check` and `ruff format --check` (`src/backend tests scripts/package-sets`);
- full `mypy`: 858 files;
- the import boundary;
- `starter_inventory` on the staged `included-core`: id matches, 338 derivatives.

The analysis agent rebuilt the seed twice: byte-identical, `verify_catalog_seed`
passes, and the repository-boundary consumer passes.

- **P2-F1 (required, security).** The converter copied tracked symlinks and hard
  links as ordinary files. Both consumers now read only the converted tree, so
  the scanner's and `starter_inventory`'s link rejection no longer applied, and
  a link's outside target could ship. Reproduced with a probe.
- **P2-F2 (required, diagnostics).** The staging blocker report compared
  source-tree names with the renamed `allowed` set and listed all 338 converted
  masters as missing inputs. Reproduced (339 entries).
- **P2-F3 (optional, test).** The temp-directory assertion could never fail,
  and `check=True` hid the script's stderr.
- **P2-F4 (optional).** The seed containment check accepted either root for
  every file instead of each file's own root.
- **P2-F5 (optional, docs).** The contract implied all effect art is WebP;
  three effect PNGs and any restricted or exception art keep their bytes.
- **P2-F6 (optional, docs).** `runtime-staging.md` did not mention the
  conversion.
- Verified without findings:
  - consistency of the two staged inventories;
  - temp-tree cleanup on every failure path;
  - seed manifest size (1.9 MB of 4 MiB);
  - Cloud compatibility;
  - no remaining `.png` consumer in packaged builds apart from stickers
    (Phase 4).

#### Code Review #1 Revisions

- **P2-F1 accepted.** `convert_included_tree` refuses any input, including
  `licenses/inventory.json`, that is not a contained, unlinked regular file.
  It reuses `starter_content.regular_content_path` (renamed from the private
  `_regular_path`) and raises `IncludedDerivativeError` before writing anything.
  New tests cover a symlink and a hard link.
- **P2-F2 accepted.** `stage()` receives the tracked source names for the
  blocker inspection. New test
  `test_a_staging_blocker_names_only_the_missing_input` (one missing VRM, one
  blocker).
- **P2-F3 accepted.** Removed the assertion; the stage test now reports stderr
  on failure.
- **P2-F4 accepted.** Each seed file is checked against its own root: Included
  bytes against the converted tree, notices against the snapshot.
- **P2-F5 and P2-F6 accepted.** The contract wording and one sentence in
  `runtime-staging.md`.
- Verification on the repaired tree, all clean:
  - targeted pytest: 43 passed;
  - `ruff check` and `ruff format`;
  - full `mypy`;
  - the import boundary.

  A targeted recheck (Code Review #2) follows.

#### Code Review #2 Findings

Targeted recheck of tree `bcdba818` (repair round 1 of 2), high-risk tier.

- **Revisions verified.** P2-F1 to P2-F6 are fixed. A link probe covered:
  - a symlinked or hard-linked master;
  - a symlinked descriptor directory;
  - a symlinked, hard-linked or missing licence inventory;
  - a `../` path.

  All seven were refused with nothing written. The blocker test tells the old
  and new behaviour apart.
- **No blocking findings.**
- **P2-R2-F1 (optional, docs).** "Other files keep their tracked bytes" missed
  rewritten descriptors and the staged licence inventory.
- **P2-R2-F2 (observation).** Staging now stops on any tracked link or
  deleted tracked file under `content/included`, even outside the starter
  closure, and names the file.
- Checks rerun independently on `bcdba818`, all exit 0:
  - pytest on the packaging, derivatives, starter closure, integrity and
    local-store tests: 66 passed;
  - `ruff check` and `ruff format --check`;
  - full `mypy`;
  - the import boundary.

Result: pass.

#### Code Review #2 Revisions

- **P2-R2-F1 accepted (trivial).** The contract now says descriptors naming
  converted art are rewritten. Verified by reading.
- **P2-R2-F2 accepted with no change.** Refusing tracked links and missing
  tracked inputs is the intended strictness, and the message names the file.
- Repair budget used: 1 of 2.


### Phase 3: Third-party licence records describe the shipped derivatives

Review tier: standard. It is licence-record and notice text plus one test
change, and it does not touch packaging code.

Requirements: #655 constraints on recorded hashes and notices.
Dependencies: Phase 2, so that the recorded hashes are the final encoder output.

Intended changes:

1. `licenses/third-party/art-particles.json`: for each recorded CC0 texture, add
   the WebP derivative's path, size and sha256 next to the existing PNG record.
   Generate these with the Phase 1 converter. Do not type them by hand.
2. `licenses/third-party/art-NOTICES.md`:
   - state that the PNG masters are kept and the shipped files are WebP
     derivatives;
   - update the CodeManu `spark-pop-6x5` change notice to mention lossy WebP
     re-encoding when that file ships converted.
3. `licenses/README.md` and the provenance text that says retained artwork uses
   PNG: describe PNG masters with WebP derivatives.
4. `src/frontend/web/scripts/effects.test.mjs`:
   - check the recorded WebP hashes against converter output, through a small
     Node wrapper that calls the Python converter, or a checked fixture produced
     by it;
   - keep the PNG byte-for-byte checks.

Checks: `pnpm -s web:test` (the effects tests) from `src/frontend`;
`uv run pytest -q tests/test_included_derivatives.py`.

Completion: every recorded CC0 derivative hash matches the converter output,
and the notices describe what ships.

Recovery: text and test change only; revert the phase commit.

Check record: _pending_.

Phase commits: _pending_ (`docs(licenses)[p3]: …` and `test(effects)[p3]: …`, or one `chore(licenses)[p3]: …`).

#### Code Review #1 Findings

_Pending._

#### Code Review #1 Revisions

_Pending._

### Phase 4: Scene stickers built as WebP

Review tier: high risk. It changes the web build.

Requirements: #655 scope (stickers), decision 2. Dependencies: none on Phases
1–3; it lands last by decision.

Intended changes:

1. Add a Vite plugin (`src/frontend/web/vite-plugins/`) for production builds
   only (`apply: "build"`), so development keeps serving the PNG masters. When
   it sees `resources/scene-vfx/stickers/*.png?url`, it emits a WebP asset
   instead of the PNG:
   - sharp settings: lossy quality 90, `alphaQuality: 100`, `effort: 6`,
     `exactAlpha`/`exact` preserved;
   - it falls back to the PNG when the WebP is not smaller.
2. `src/frontend/web/src/lib/scene-vfx/stickers.ts`:
   - derive each sticker's extension and media type from its resolved URL
     instead of assuming `.png` and `image/png`;
   - `STICKER_FILE` accepts the emitted names;
   - a saved Scene effect that copies a sticker keeps a name that matches its
     bytes (`docs/frontend/runtime/scene-vfx.md` requires matching extensions).
3. Update `stickers.json` and the sticker docs where they promise PNG in
   shipped builds.

Checks (from `src/frontend`):

- `pnpm verify`.
- A build-output assertion: the built `dist` holds 42 sticker assets as WebP
  and no sticker PNGs.
- `pnpm web:test:browser` for the Scene effect creator's sticker paths.
- `pnpm e2e:test:fast` against a disposable built stack, because stickers are
  user-facing web assets.

Completion:

- Production builds (hosted, desktop, self-host built mode) serve WebP stickers.
- Development serves PNG.
- Saving a Scene effect with a sticker round-trips.

Recovery: removing the plugin restores PNG stickers. Saved Scene effects keep
whichever bytes they copied, under matching extensions.

Check record: _pending_.

Phase commits: _pending_ (`perf(web)[p4]: …`).

#### Code Review #1 Findings

_Pending._

#### Code Review #1 Revisions

_Pending._

## Final integration review

Covers combined acceptance against #655, Phase 3 if it skipped its own review,
and the consistency of the staged inventory, the seed and the licence records.
It reuses still-valid phase evidence. After its repairs, the full pre-push suite
runs once on the final candidate:

- `uv run pytest -q`, `uv run ruff check` and `make check-test`;
- `pnpm verify` and `pnpm web:test:browser`;
- desktop runtime stage, audit and smoke;
- package-set build and validate.

Its results go in the PR.

## Validation and acceptance

The #655 acceptance criteria apply. In summary:

- Desktop audit and smoke, package-set validate and Cloud seed verification pass
  on converted output.
- Every shipped effect file resolves to its master's licence.
- No descriptor references a missing member.
- Conversion is reproducible.
- The shipped size is recorded.

Owner gates, recorded here and in the PR rather than as phases:

- **Visual check.** Run on a packaged desktop build with both Included Avatars,
  using the checklist in #655:
  - the ink and screentone marks;
  - flipbook shimmer;
  - edge halos on dark and light Scenes;
  - face-surface seams;
  - additive and mipmapped particle fringes;
  - Scene banding and tile seams;
  - silhouette edges.

  Any failure goes on the converter's exception list (PNG or lossless WebP) and
  re-runs the affected checks.
- **Cloud repin.** Repin to the merged commit, recorded in the Cloud repository
  with its own approval. Until then, hosted keeps the previous seed.

## Idempotence and recovery

- **Masters are never touched.** The converter never writes to
  `content/included`; it writes only to a fresh destination. Re-running staging or
  seed preparation from the same commit gives byte-identical output and inventory
  ids.
- **Bad derivatives.** If a derivative is wrong after release, add the file to
  the exception list. The next build ships its PNG master, and clients take one
  cache miss for that item.
- **Revisions change.** Revision changes are one-way but harmless: items keep
  their identities, and saved loadouts and exported packages stay valid.
- **No migration.** No database or persisted data is migrated.

## Outcomes & Retrospective

_Pending._
