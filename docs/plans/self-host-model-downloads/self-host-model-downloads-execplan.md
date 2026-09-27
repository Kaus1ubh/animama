# In-app model downloads for built self-host

Source agreement: [raymond-van/animama#163](https://github.com/raymond-van/animama/issues/163)
as published (read 2026-09-26), consuming the downloader spec
[#151](https://github.com/raymond-van/animama/issues/151) and draft
[#162](https://github.com/raymond-van/animama/pull/162).
Authorized scope: Phases 1–3, authorized by the owner on 2026-09-26, after
owner decisions O1–O8 the same day. Phase 4 needs separate authorization.
Phase 4 publishes to R2 and has its own owner gate. Nothing in this plan
authorizes publishing an app release.

## Purpose and context

Built self-host serves the experimental Parakeet WebGPU encoder only when the
operator acquires it on the host and mounts it through
`ANIMAMA_PARAKEET_WEBGPU_MODEL_DIR` (decision D2 in the
[WebGPU plan](../parakeet-webgpu-download/parakeet-webgpu-download-execplan.md)).
Draft #162 adds the missing server-side path: a backend downloader that
installs pinned, SHA-256-verified assets from `downloads.animama.ai` into
`<data_root>/internal/model-assets/<id>/<sha256>` and serves them from
`/v1/model-assets/{id}/content`.

After this work:

- On a built self-host stack, App Settings → Advanced → Experimental offers the
  encoder download when the browser has a WebGPU adapter. The control shows the
  download size and free space, with progress, cancel, retry and remove.
- The backend verifies size and SHA-256 before the file becomes visible. The
  existing `HEAD` probe then returns 200 and the toggle reports available.
- The encoder is published once to R2 under a versionless, content-addressed
  `models/` prefix. The prefix is create-only, anonymously verified and
  covered by a bucket lock rule.
- Packaged desktop is unchanged. It keeps the `parakeet-stt-webgpu` feature pack.

The encoder is `encoder-model.fp16.onnx`: 1,238,960,452 bytes, SHA-256
`ad8bb0acaec339c32ffbdedb869bd60f7103d0f6c00e56c7a2c2ab57df7462a2`, from
`ysdede/parakeet-tdt-0.6b-v2-onnx@db4a768f`, CC-BY-4.0. Its tracked manifest is
`models/parakeet-tdt-0.6b-v2-webgpu/manifest.json`.

### Orientation

Commands run from the repository root unless stated.

| Area                 | Files                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Downloader (#162)    | `src/backend/animama/domain/model_assets.py` (catalog schema `animama-asset-catalog/1`, host allowlist, failure reasons), `app/services/model_asset_service.py`, `app/ports/model_assets.py`, `adapters/model_assets/{filesystem_store,http_fetcher}.py`, `server/model_assets.py` (composition), `server/routers/model_assets.py`, `server/schemas/model_asset.py`, `resources/model-assets.v1.json` (empty), `tests/test_model_assets.py` |
| Request boundary     | `src/backend/animama/local/http/admission.py`: GET and HEAD under `/v1` are safe methods; mutations need `x-animama-csrf: 1`. `local/http/assets.py` serves the web root and the desktop model mounts.                                                                                                                                                                                                                                 |
| Client probe         | `src/frontend/web/src/lib/speech/client-parakeet/{assets,webgpu,client}.ts` (`CLIENT_PARAKEET_WEBGPU_ENCODER_URL`, `probeParakeetWebgpu`, `withBackendEncoder`); `web/vite.config.ts` (`__CLIENT_PARAKEET_WEBGPU_MODEL_BASE_URL__`)                                                                                                                                                                                                    |
| Settings UI          | `src/frontend/web/src/ui/settings/ExperimentalSettings.tsx` and its test. The desktop-only `ParakeetWebgpuDownload` shows the control pattern to follow.                                                                                                                                                                                                                                                                             |
| Self-host            | `docker-compose.yml` (WebGPU mount at `/opt/animama/web/__client-parakeet-webgpu-models`; data root `${ANIMAMA_DATA_HOST_PATH:-./data}` at `/var/lib/animama/data`), `docker-compose.development.yml`, `reset.sh`, `Dockerfile` (web builder copies `models/`), `scripts/backup-local.sh`                                                                                                                                              |
| R2 publication       | `src/frontend/desktop/scripts/runtime/publish-r2.mjs` (create-only signed PUT, anonymous hash verification), `release-scan.mjs` and `scan-release-candidate.mjs` (gitleaks plus private-text scan, `.onnx` excluded from gitleaks but byte-searched), `desktop/tests/{publish-r2,release-scan}.test.mjs`, `docs/frontend/desktop/releases.md` (R2 operator setup)                                                                    |
| Model store          | `scripts/models/parakeet_webgpu.py` (`acquire`, `verify`, `path`), `models/parakeet-tdt-0.6b-v2-webgpu/{manifest.json,ATTRIBUTION.md,README.md}`                                                                                                                                                                                                                                                                                      |
| Licensing            | `licenses/third-party/code-and-models.md` (the encoder row currently says "redistributed unmodified only in the optional `parakeet-stt-webgpu` desktop pack"), `licenses/source-review.json` (`parakeet-webgpu-source`), `src/frontend/desktop/runtime/license-sources.json`                                                                                                                                                         |
| Generated SDK        | `src/frontend/packages/runtime-contracts/src/generated/*`. Regenerate with `pnpm openapi-ts` from `src/frontend`; never hand-edit.                                                                                                                                                                                                                                                                                                    |
| Docs                 | `docs/backend/operations/model-assets.md`, `docs/backend/architecture/http-api.md` (#162 section), `docs/frontend/runtime/voice.md`, `docs/frontend/desktop/releases.md`, the WebGPU plan's D2 record                                                                                                                                                                                                                                 |

Facts that shape the design (inspected 2026-09-26 at `origin/main` `2064540`
and `origin/feat/model-asset-downloader` `dc2a433`):

- `git merge-tree` merges #162 into current `main` without conflicts. #162 and
  #161 both change `local/http/assets.py`: #162 extracts
  `verified_file_response`, and #161 adds the WebGPU mount.
- #162's catalog entry has one file per asset (`id`, `url`, `size`, `sha256`,
  `media_type`, `license_ref`). It has no grouping, no free-space field and no
  pre-install space check.
- The fetcher accepts only `https://downloads.animama.ai` on the default port.
  It follows no redirects, requires an exact 200 and refuses any
  `Content-Encoding` other than identity. The read timeout is 60 s per chunk,
  and there is no resume: a retry starts the download again.
- The content route already answers `HEAD` with 404 while an asset is not
  installed or is downloading. The current probe therefore works unchanged if
  the encoder URL points at that route.
- The same FastAPI and catalog run on desktop. Any catalog entry is also
  listed by desktop's `/v1/model-assets`.
- The built image ships no third-party notices for the encoder. Today its
  attribution reaches self-host through the operator-mounted directory.
- `scripts/backup-local.sh` archives the whole data root. Without an exclusion,
  every backup would include the 1.24 GB encoder.
- `publish-r2.mjs` hard-codes the `desktop/v<version>/` key layout and the
  stable feed flow. Its `put` and `verify` closures are the reusable parts.
- R2 accepts a single PUT of up to 5 GiB, so the encoder needs no multipart
  upload.

### Boundaries

In scope: #163 as published.

Excluded:

- Desktop feature-pack delivery, its catalog and its pack inventory review.
- Enabling WebGPU by default.
- Moving base Parakeet or browser speech to the downloader (see O5).
- #144 Phase 4 (signed desktop candidate).
- Publishing an app release.

## Progress

- [x] Owner decisions O1–O8 (2026-09-26): O1 merge #162; O2 per-file hash
  layout; O4 option A; O3 and O5–O8 as recommended.
- [x] Phases 1–3 authorized (2026-09-26). Workspace: branch
  `feat/self-host-model-downloads` from `main` `4e5f663`.
- [x] Phase 1 (#173, `54b33dd`): Downloader adopted, extended and cataloged.
  Review #2 passed.
- [x] Phase 2 (#174, `4086c2a`): Create-only model publication command with a
  scan gate. Review #2 passed. The model-set scan has also passed (see Phase 3);
  publication remains Phase 4.
- [x] Phase 3 (#175, `eb05b80`): Built self-host serving and Experimental
  download control. Review #2 passed after one repair round.
- [x] `main` `bf9fe3f` merged into the branch (`9bc8aac`, no conflicts).
- [x] Final Integration Review #1 of Phases 1–3 on `9bc8aac`: pass.
- [x] Owner decision (2026-09-27): fix `ATTRIBUTION.md` (FI-F2); hold the PR
  merge until Phase 4. Notice fixed, pack version bumped, approval pending.
- [ ] Owner approval of the `parakeet-stt-webgpu` 0.1.1 inventory `9f3cd0b9…`
  before the next desktop release build.
- [x] Phase 4 steps 1–3 (owner, 2026-09-27): `models/` bucket lock rule added
  and the model set published.
- [x] Phase 4 step 4 (agent, 2026-09-27): live built self-host acceptance on
  `ef9066d`, except the manual items below.
- [ ] Owner manual checks: live previews with a microphone; a browser without a
  WebGPU adapter.
- [ ] Merge approval of the exact candidate (held until Phase 4 by the owner).

## Surprises & Discoveries

- 2026-09-26: the built self-host image has no copy of the encoder attribution.
  If the operator mount is retired, the attribution must be delivered another
  way (O8).
- 2026-09-26: `backup-local.sh` would archive downloaded model assets (O6).
- 2026-09-26: desktop FastAPI would list any catalog entry. The client, not the
  catalog, decides which platforms offer the download (Phase 3).

## Decision Log

Proposed by the agent on 2026-09-26. On 2026-09-26 the owner chose to merge
#162 (O1), asked that the encoder never be re-uploaded (O2 revised), chose
option A for O4, and accepted the remaining recommendations (O2, O3, O5–O8).
Withdrawn alternatives are kept for context.

- **O1: adopting #162 (owner decision, 2026-09-26: merge it).** Merge `origin/feat/model-asset-downloader`
  into this branch with an ordinary merge commit as Phase 1's first commit.
  This keeps the reviewed commit `dc2a433` and its review record unchanged.
  When this plan's PR opens, close #162 as superseded by it, and let the PR
  close #151.

  Alternative not chosen: rebase and merge #162 on its own first. This contradicts the
  owner's 2026-09-26 choice to merge the downloader together with a consumer.

- **O2: R2 layout (owner decision, 2026-09-26).** Address every file by its own hash,
  `models/<model-id>/<file-sha256>/<file-name>`. For the encoder that is
  `models/parakeet-tdt-0.6b-v2-webgpu/ad8bb0ac…62a2/encoder-model.fp16.onnx`.
  `ATTRIBUTION.md`, `README.md` and `manifest.json` are published the same
  way, each under its own hash.
    - The encoder is uploaded exactly once. A notice or manifest edit publishes
      only that small file under a new hash, and the encoder URL in the catalog
      never changes.
    - Before uploading, the command asks the bucket (a signed S3 `HEAD`)
      whether the key exists. An existing object is never uploaded again, so a
      retry or later run never re-sends 1.24 GB; it is still verified by an
      anonymous download.
    - Every object is created once with
      `Cache-Control: public, max-age=31536000, immutable`, as under `desktop/v`.
    - R2 has no directory listing, so "beside the weights" had no practical
      value. The attribution is still published with the set, and it also
      ships in the app (O8).

  The earlier proposal (one directory per manifest digest) is withdrawn: it
  forced a 1.24 GB re-upload for any notice change.

- **O3: bucket lock (owner decision, 2026-09-26).** Before the first upload, the owner adds a
  bucket lock rule with indefinite retention on the prefix `models/` in the
  Cloudflare dashboard. `desktop/v` stays as it is. The publish command cannot
  confirm lock rules with the object-scoped token, so the owner's confirmation
  is a recorded Phase 4 gate.

- **O4: operator mount (owner decision, 2026-09-26: option A).** Today a built self-host stack gets the
  encoder only one way: the operator runs `parakeet_webgpu.py acquire` on the
  host, `reset.sh` records `ANIMAMA_PARAKEET_WEBGPU_MODEL_DIR`, and
  `docker-compose.yml` bind-mounts that directory into the container. After
  this plan the app can download the encoder itself. The question is whether
  built self-host keeps the host mount as a second way in.
    - **A. Drop it for built self-host (chosen).** Remove one bind mount
      from `docker-compose.yml`. The in-app download is the only path, so there
      is one URL, one status and one UI. Development stacks keep the mount
      unchanged; they use the host model store and never need the download.
      Cost: a built self-host host that cannot reach `downloads.animama.ai`
      cannot enable WebGPU, and an operator who already acquired the encoder
      on the host downloads it again once, into the data root.
    - **B. Keep it as an offline override (not chosen).** When the mount is present, the
      backend reports the encoder as installed from it and serves it at the
      same URL; the UI shows "Provided by the operator" and no Remove button.
      Cost: a second source inside the downloader, and extra states and tests,
      for an experimental feature.

- **O5: base Parakeet and browser speech (owner decision, 2026-09-26).** Out of scope, with a
  follow-up issue.
    - Browser speech assets are a BuildKit input copied into `dist` at build
      time; they are not runtime files.
    - Base Parakeet is required at stack startup (`reset.sh` verification, web
      root mount). Downloading it in the app changes first-run behavior for
      every self-host user and needs its own UX and R2 publication.
    - Once proven by the encoder, the same catalog and layout can carry them.

- **O6: store location and limits (owner decision, 2026-09-26).**
    - Use #162's store beneath the existing data root bind mount
      (`${ANIMAMA_DATA_HOST_PATH}/internal/model-assets`). There is no new
      volume and no quota.
    - Add `free_bytes` for the store's filesystem to the list response, and
      `required_free_bytes` (size + 64 MiB) to each asset.
    - Refuse to start an install when free space is below the requirement,
      before any bytes are fetched.
    - Exclude `internal/model-assets` and `staging/model-assets` from
      `backup-local.sh`. They are re-downloadable. After a restore the asset
      shows "not installed".
    - `reset.sh --purge` already removes them with the rest of the data root.

- **O7: download source (owner decision, 2026-09-26).** The R2 `models/` mirror only, with no
  Hugging Face fallback. Hugging Face serves through redirects to other CDN
  hosts, which #162 deliberately refuses. A fallback would widen the host
  allowlist and redirect policy, a security change, for little benefit: the
  R2 objects are pinned to the same bytes.

- **O8: licensing and attribution (owner decision, 2026-09-26).**
    - **Shared review.** Extend the existing `parakeet-webgpu-source` review. The
      bytes, upstream revision and CC-BY-4.0 attribution are identical to the
      desktop pack's. Update the `code-and-models.md` row to name the R2
      `models/` mirror and self-host downloads. The owner still reviews the
      changed licensing records in the PR.
    - **Attribution ships in the app.** The built web output includes the tracked
      `ATTRIBUTION.md` (the web builder already copies `models/`). The
      Experimental control links to it.
    - **The catalog lists only the encoder**, with `license_ref: "CC-BY-4.0"`.
      The R2 directory also carries the notices for anyone downloading directly.

  Alternative not chosen, closer to the #163 wording ("plus its attribution files"): add
  catalog entries for `ATTRIBUTION.md` and `README.md`, installed together
  with the encoder. #162 has no grouping, so the UI or service would have to
  install and remove three assets as one.

- **FI-F2: attribution notice (owner decision, 2026-09-27).** Fix the tracked
  `ATTRIBUTION.md` so it names both redistribution channels, and hold the PR
  merge until Phase 4 publishes the objects.
    - The notice now says development stacks use the operator's model store and
      Animama redistributes the file unmodified in the desktop pack and as a
      self-host download under `models/parakeet-tdt-0.6b-v2-webgpu/`.
    - Its SHA-256 is now `2efaf55f…dc24b` (887 bytes); the manifest digest is
      `760221af…55df4`. The encoder, its catalog entry and URL are unchanged.
    - The `parakeet-stt-webgpu` payload changed, so, per the pack release rules
      ("changed payloads need a new pack version and review"), its version is
      now `0.1.1` and `approved_inventory_sha256` is `null`. The new inventory
      digest is `9f3cd0b927f70facf7caac57c32eda41dd24855c0d026ed9a7c2ffa6e878b1de`
      (computed with `feature-pack-build`'s `inventoryPack`, which reproduces
      the previously approved `76101656…` for the old set). Until the owner
      records it, a release build reports the pack as
      `redistribution_review_required` instead of shipping it. The desktop
      notice `parakeet-webgpu-attribution.txt` is unchanged; it stays accurate.
      The bump costs existing desktop users no extra download: v0.1.1 set no
      `app_versions`/`release_tag` for the pack, so the next app release would
      offer a pack update anyway.
    - Local model stores need the new set:
      `python3 scripts/models/parakeet_webgpu.py acquire --offline --import-from DIRECTORY`
      with the current notices and the existing encoder; the old version stays.
- **Implementation decisions (agent, within the accepted outcome).**
    - The encoder asset ID is `parakeet-tdt-0.6b-v2-webgpu-encoder`.
    - Phase 2 decides whether an object exists with a signed S3 `HEAD`, not an
      anonymous public request (2026-09-26, after review finding N2). A public
      404 can be stale right after an upload or from a cached 404, and would
      have re-sent the encoder; the bucket's answer is authoritative. Public
      verification still follows for every object.
    - The client selects the encoder source with a build define: `pack` for
      embedded desktop, `model-asset` for `vite build` (built self-host) and
      `operator` for Vite serve without a base-URL override (`null` with
      one). The download control appears only for
      `model-asset`. Desktop FastAPI still lists the entry, but its client
      never offers it.
    - No removal guard. The worker keeps a loaded session's weights in memory.
      After removal the client refreshes its probe, and the next load uses WASM.

## Phased implementation

Default delivery: this branch, `feat/self-host-model-downloads`, and one PR
for the plan, with one issue per authorized phase under #163. Commit subjects
use `<type>(<scope>)[p#]: <summary>`, for example
`feat(models)[p1]: report free space for model assets`.

### Phase 1: Downloader adopted, extended and cataloged

**Requirements:** #163 "Merge #162", "Catalog entries", and the store and
free-space questions (O1, O6); #151 R8–R12.

**Issue:** #173.

**Starting source:** `origin/main` `4e5f663` plus
`origin/feat/model-asset-downloader` `dc2a433`.

**Changes:**

1. **Adopt #162.** Run `git merge --no-ff origin/feat/model-asset-downloader`,
   then rerun its tests on the merged tree before changing anything.
2. **Free space.**
    - The store reports free bytes for its filesystem (`shutil.disk_usage` on
      the installed root's nearest existing ancestor).
    - `PyModelAssetList` gains `free_bytes`, and `PyModelAssetState` gains
      `required_free_bytes`.
    - `install` refuses before staging when free space is below the
      requirement, reporting failure reason `asset_insufficient_space`. The
      reason never carries a path.
3. **Catalog.** Add the encoder entry to `resources/model-assets.v1.json`:
    - `url`: `https://downloads.animama.ai/models/parakeet-tdt-0.6b-v2-webgpu/<encoder-sha256>/encoder-model.fp16.onnx`
    - `size` and `sha256` from the tracked manifest
    - `media_type`: `application/octet-stream`
    - `license_ref`: `CC-BY-4.0`

   Add a test that binds the entry to the tracked manifest: equal size and
   hash, and a URL directory equal to that hash. A manifest change then cannot
   leave the catalog stale.
4. **Backups.** Exclude the model-asset store and its staging from
   `scripts/backup-local.sh`. Say so in the backup docs.
5. **SDK.** From `src/frontend`, run `pnpm openapi-ts` and commit the
   regenerated client.
6. **Docs.** Update the #162 section of `docs/backend/architecture/http-api.md`
   (free space, the new failure reason), and the store and backup notes in
   `docs/backend/operations/model-assets.md`.

**Checks:**

- `uv run pytest -q tests/test_model_assets.py tests/test_local_http_assets.py tests/test_local_app_composition.py`
- `uv run pytest -q`
- `uv run ruff check` and `uv run ruff format --check`
- `scripts/repository-boundary/check-python-imports.py`
- `bash -n scripts/backup-local.sh` and `uv run pytest -q tests/test_local_state_scripts.py`,
  extended to assert the store is absent from the data archive
- From `src/frontend`: `pnpm openapi-ts:check` and `pnpm check`

**Completion:** the merged downloader passes its original tests. The new tests
pass: free space, refusal for insufficient space, the catalog bound to the
manifest, and the backup exclusion. The SDK is current. Until Phase 4, the
catalog URL answers 404, so a live install fails as `asset_download_failed`.
This is expected, and the phase does not merge on its own.

**Implementation notes (agent, 2026-09-26):**

- `main` advanced to `4e5f663` (v0.1.1 release) before work started; the branch
  was fast-forwarded and #162 merged cleanly (`509e4e0`).
- Free space that cannot be measured refuses an install as `asset_store_failed`
  and lists `free_bytes: null`.
- Restore rollback bundles also omit model assets. Restore wipes the data root
  before extracting, so assets are gone after any restore anyway.
- The worktree venv had been created with Python 3.14, which changes OpenAPI
  422 phrases. It was rebuilt with `uv sync --python 3.12.13`, the CI pin, and
  all Python evidence below is from 3.12.13.

**Evidence (Python 3.12.13, working tree before the phase commit):**

- `uv run pytest -q`: 1961 passed, 7 skipped.
- `uv run ruff check`: clean. `uv run ruff format --check src tests`: clean.
- `uv run python scripts/repository-boundary/check-python-imports.py`:
  `forbidden_edges: 0`.
- `bash -n` on `backup-local.sh` and `restore-local.sh`: ok.
- From `src/frontend`: `pnpm openapi-ts:check` current (17 files); `pnpm check`
  exit 0.
- Not applicable: live download (the R2 object is published in Phase 4).

**Commits:** plan `4666d9e`; merge of #162 `509e4e0`; phase commit `54b33dd`.

#### Code Review #1 Findings

Independent `sdlc-reviewer`, initial review of the uncommitted tree on `509e4e0`.

- **P1-F1 (required):** the regenerated SDK changed four unrelated 422
  descriptions (`Unprocessable Entity` → `Unprocessable Content`) because the
  venv ran Python 3.14.4; CI regenerates under 3.12.13, so `sdk-freshness`
  would fail.
- P1-F2 (optional): the unmeasurable-free-space branch had no test or API doc.
- P1-F3 (optional): `free_bytes` was optional in the schema although always set.
- P1-F4 (optional): a traceback per list call while measurement fails; a
  per-asset space check can admit concurrent installs whose total exceeds free
  space.

Checked without defects: idempotence and busy behavior, `required_free_bytes`
sizing, security of failure codes and the unchanged host allowlist, the catalog
binding, desktop composition, tar exclusions (bsdtar and GNU tar), merge
integration and docs.

#### Code Review #1 Revisions

- **P1-F1 accepted.** Venv rebuilt on 3.12.13; SDK regenerated; the generated
  diff now contains only model-asset hunks. Full checks rerun (see Evidence).
- P1-F2 accepted: explicit `if free is None` branch, test
  `test_unmeasurable_free_space_refuses_install`, API doc updated.
- P1-F3 accepted: `free_bytes: int | None` is required and nullable.
- P1-F4: logging accepted (warning without traceback). The aggregate check for
  concurrent installs is deferred: the catalog has one entry, and a mid-download
  `ENOSPC` still fails cleanly as `asset_store_failed` with staging discarded.

#### Code Review #2 Findings

Targeted recheck (same reviewer): P1-F1 to P1-F4 verified, no regressions, no
new findings. Result: pass; one repair round used.

### Phase 2: Create-only model publication command with a scan gate

**Issue:** #174.

**Requirements:** #163 "R2 layout for versionless model objects" (O2, O3),
with the release scan's handling of ONNX files.

**Changes:**

1. **Shared R2 primitives.** Extract the signed create-only PUT and the
   anonymous verification from `publishR2` into `r2-objects.mjs` in the same
   directory. `publishR2`'s behavior and tests stay unchanged.
2. **`publish-models-r2.mjs`**, exposed as the desktop package script
   `models:publish`:
    - `--model parakeet-tdt-0.6b-v2-webgpu`. The only allowed IDs are those
      with a tracked manifest and a catalog entry.
    - It resolves the verified local set offline with
      `python3 scripts/models/<model>.py path`, then rehashes every manifest
      file.
    - It requires a passing scan receipt for exactly those files and hashes.
    - For each file (the manifest's files plus `manifest.json`), it first
      checks `models/<model-id>/<file-sha256>/<file>` with a signed S3 `HEAD`.
      An existing object is never re-uploaded.
    - Otherwise it uploads the file create-only (`If-None-Match: *`), signed
      with its SHA-256, with an immutable `Cache-Control` and a content type
      from its suffix.
    - It then downloads each object anonymously through
      `https://downloads.animama.ai`, requesting identity encoding. It checks
      for a 200 with no `Content-Encoding`, an exact `Content-Length` and the
      SHA-256, which are the same conditions the #162 fetcher enforces.
    - A retry accepts only byte-identical existing objects; a differing object
      stops publication for inspection.
    - `--dry-run` prints the planned keys and hashes without reading
      credentials. Credentials come only from the existing
      `ANIMAMA_R2_*` environment variables, and their values are never printed.
    - `--confirm-publication` is required for any upload.
3. **Scan gate.** Run `scanCandidate` (gitleaks plus private-text byte search)
   over a staged directory holding the model set and its notices. Add a
   `release:scan` option or a thin `models:scan` entry that writes the receipt
   next to the staged set. The ONNX file stays excluded from gitleaks and
   included in the private-text byte search, as for release candidates.
4. **Docs.** In `docs/frontend/desktop/releases.md` → R2 operator setup, add
   the `models/` prefix, its lock rule and the model publish procedure. In
   `docs/backend/operations/model-assets.md`, describe how a catalog entry is
   bound to a published object.

**Checks:**

- `pnpm --filter animama-desktop exec vitest run tests/publish-r2.test.mjs tests/release-scan.test.mjs tests/publish-models-r2.test.mjs`,
  where the last file is new. Every network call is mocked. Cover
  keys and headers, 412 followed by matching verification, a differing
  object, compressed or wrong-length public responses, a missing receipt or a
  hash mismatch, and credentials never appearing in errors.
- `pnpm desktop:check`
- A dry run against the real local store:
  `pnpm --filter animama-desktop models:publish --model parakeet-tdt-0.6b-v2-webgpu --dry-run`

**Completion:** mocked tests pass, including an existing encoder object that
is verified and skipped without a PUT. The dry run lists four keys, each under
its own file hash. No request reaches R2 in this
phase.

**Implementation notes (agent, 2026-09-26):**

- `r2-objects.mjs` holds the shared credentials, signed `HEAD`/`PUT`, public
  `GET` and anonymous verification; `publish-r2.mjs` imports them unchanged in
  behavior.
- `optional-inputs.mjs` exports its model-store helpers, and the new
  `resolveModelInputs` is shared with pack staging.
- Commands (from `src/frontend/desktop`): `pnpm models:stage --model ID`,
  `pnpm release:scan --candidate release/models/ID`, then
  `pnpm models:publish --model ID --dry-run | --confirm-publication`. The
  candidate directory is fixed; the existing scan is reused unchanged.
- Transfer timeouts scale with size (about 99 minutes for the encoder).

**Evidence (working tree before the phase commit):**

- From `src/frontend`: `pnpm --filter animama-desktop test` 17 files, 330
  tests passed; `pnpm desktop:check` exit 0;
  `pnpm --filter animama-desktop prettier:check` flags only the pre-existing,
  unchanged `scripts/runtime/review-packet.mjs` and `runtime/license-sources.json`.
- `node --check` passes for the publish commands (also covered by tests).
- Real store: `models:stage` staged four files; the dry run listed
  `ATTRIBUTION.md` (`393d5928…`), `README.md` (`4f23ceb4…`),
  `encoder-model.fp16.onnx` (`ad8bb0ac…62a2`, 1,238,960,452 bytes) and
  `manifest.json` (`59867d06…`), each under its own hash, matching the catalog.
- `models:publish --confirm-publication` without a scan exits 1 before reading
  credentials or using the network.
- Not run: the gitleaks scan (no pinned binary installed locally; installing
  one needs owner approval) and any R2 request. Both belong to Phase 4.

#### Code Review #1 Findings

Independent `sdlc-reviewer`, initial review of the uncommitted tree on `54b33dd`.

- **P2-F1 (required):** `publish-r2.mjs` imported `publicGet` and still
  declared its own, a `SyntaxError` under plain Node that would break desktop
  release publication; vitest hid it, and the full desktop suite failed one
  packaging test.
- **P2-F2 (required):** tests did not record PUT attempts, so a re-sent
  encoder would still pass; the 412 path and PUT headers were untested.
- **P2-F3 (required):** `models:stage --candidate .` would recursively replace
  an arbitrary directory.
- N1: filesystem errors with host paths could be printed. N2: a stale public
  404 could still re-send the encoder; the fixed 20-minute timeout needs about
  8.3 Mbit/s. N3: identity encoding for notices is sound. N4: duplicated
  projection. N5: credentials read before the scan check.

#### Code Review #1 Revisions

- P2-F1 accepted: duplicate removed; `publicGet` sends `headers` only when
  given; tests run `node --check` on the three publish commands.
- P2-F2 accepted: `fakeR2` records every PUT and answers signed `HEAD`s; tests
  cover PUT headers, zero PUTs for a bucket-held encoder behind a stale public
  404 (first run and rerun), and the 412 path with matching and differing
  bytes.
- P2-F3 accepted: `--candidate` removed; the directory is fixed.
- N1, N2, N4, N5 accepted: generic message for filesystem errors; signed
  `HEAD` existence check and size-scaled timeouts; `shape` helper; scan checked
  before credentials. N3: no change.

#### Code Review #2 Findings

Targeted recheck (same reviewer): all fixes verified, no regressions. Result:
pass; one repair round used. Non-blocking follow-ups applied: plan wording for
the signed `HEAD` (recorded above), a leftover test comment removed. The shared
"run pnpm desktop:release:scan" hint in `verifyScanReceipt` was left unchanged;
`models:stage` prints the exact `--candidate` scan command instead.

### Phase 3: Built self-host serving and Experimental download control

**Issue:** #175, blocked by #173.

**Requirements:** #163 "Serving and probe", "Self-host settings UI",
"Operator mount" (O4), "Docs", and the attribution part of O8.

**Changes:**

1. **Build define.** Replace `__CLIENT_PARAKEET_WEBGPU_MODEL_BASE_URL__` with
   the full encoder URL and a source (`pack`, `model-asset`, `operator` or
   none):
    - `vite build` (built self-host): `/v1/model-assets/parakeet-tdt-0.6b-v2-webgpu-encoder/content`.
    - Embedded desktop and Vite serve: unchanged URLs.

   `probeParakeetWebgpu` and `withBackendEncoder` keep their behavior. The
   probe's `HEAD` is a safe method under the admission rules.
2. **Hook.** Add `useModelAsset(id)`, built on the generated SDK:
    - it reads state (including `free_bytes`);
    - `install` calls `:install`, and `cancel` and `remove` call DELETE;
    - it polls once a second only while the asset is downloading;
    - when the asset settles as installed or removed, it refreshes
      `getParakeetWebgpuStatus({ refresh: true })`.
3. **UI.** `ParakeetWebgpuSetting` renders a self-host control when the source
   is `model-asset`. It reuses the desktop control's layout and wording where
   they apply:
    - The control is shown only when the probe found an adapter and the asset
      is not installed, or when it is installed or failed, so that removal and
      retry stay reachable.
    - It shows the size and free space, a progress bar with Cancel,
      "Retry download" after a failure, and a two-step "Remove GPU encoder".
    - There is no app reload; the next dictation or Voice Mode start loads it.
    - It replaces the operator text for `model_missing`.
    - It links to the bundled attribution.

   Desktop and development behavior is unchanged.
4. **Attribution (O8).** The web build copies the tracked `ATTRIBUTION.md` (and
   `README.md`) for the encoder into `dist` at a stable path. This covers
   built self-host only.
5. **Retire the built mount (O4).** Remove the WebGPU bind mount from
   `docker-compose.yml`. `reset.sh` keeps resolving and recording the
   directory for development stacks. Update `tests/test_compose_network_boundaries.py`
   or the equivalent Compose tests.
6. **Docs.**
    - `docs/frontend/runtime/voice.md`: the serving and probe paragraph and the
      status table.
    - `docs/backend/operations/model-assets.md`: the optional WebGPU encoder
      section, which currently says self-host never downloads it.
    - The WebGPU plan's D2 record: add a dated note that #163 supersedes D2 for
      built self-host, without rewriting the history.
    - `licenses/third-party/code-and-models.md` and the source review records.

**Checks:**

- From `src/frontend`: `pnpm web:test`, including `ExperimentalSettings.test.tsx`
  with the self-host states:
    - no adapter: no control;
    - not installed: size and free space shown;
    - downloading: progress and Cancel;
    - failed: Retry;
    - installed: Remove, with the probe refreshed;
    - insufficient space: a message, with Download disabled.
- Also `client-parakeet` tests for each source's URL, and the build-define tests.
- `pnpm check`, `pnpm web:lint`, `pnpm build`; confirm the built bundle
  contains the model-asset URL and no `/__client-parakeet-webgpu-models`
  reference.
- `uv run pytest -q` (Compose tests)
- `bash -n reset.sh`
- `docker compose -f docker-compose.yml config --quiet` and the development
  combination, with the model variables exported as in AGENTS.md.
- **Pre-publication built stack.** Run
  `ANIMAMA_WEB_BUILD_MODE=production ./reset.sh --name selfhost-dl --base-port 8400`,
  then check in the browser at desktop viewport:
    - no encoder: `HEAD` returns 404, and Experimental shows the download with
      size and free space;
    - an attempted download reports failure until Phase 4, then Retry works;
    - with a copy of the verified encoder placed at
      `<data>/internal/model-assets/parakeet-tdt-0.6b-v2-webgpu-encoder/<sha256>`
      and the backend restarted: `HEAD` returns 200, the toggle reports
      available, a live preview works, and Remove returns to not installed.
    - Then check a narrower layout for regressions.

**Completion:** checks pass, and the built stack shows every state except a
live download. Record that stack's URL here.

**Commits:** phase commit `eb05b80`.

**Status (2026-09-27):** complete. Review #2 passed after one repair round.
The built stack `animama-selfhost-dl` (http://animama-selfhost-dl.localhost:8400)
was used for the browser evidence.

**Evidence (before the `main` merge):** `pnpm check` exit 0; `pnpm web:test`
1927 passed, 1 failed (`app-version.test.ts`, then failing on `main`, fixed by
#179 and passing after the merge); `pnpm build` bundle holds the model-asset URL and attribution,
no mount path; Compose tests 122 passed; compose config ok. Browser (built
stack, desktop and tablet widths): download offered with size and free space;
an unpublished object fails as `asset_download_failed` with Retry; a seeded
verified encoder serves 200 with the SHA-256 ETag and reports available;
two-step removal returns to not installed without reload. Not done: live
preview with a microphone; a browser without a WebGPU adapter (unit-tested).

#### Code Review #1 Findings

Independent `sdlc-reviewer`, initial review of the uncommitted tree on `4086c2a`.

- **P3-F1 (required):** `getParakeetWebgpuStatus` caches the probe for the
  page and only the Settings modal refreshes it, so a download that finishes
  after Settings closes keeps WASM until reload. Fix: do not cache a
  `model_missing` result (or refresh in `loadClientParakeetWorker` when
  WebGPU is preferred); add a unit test.
- **P3-F2 (required):** `webgpu.ts` comments (lines 17-18, 59-61) still
  describe the operator mount for self-host.
- **P3-F3 (required):** no test for the Vite-serve `operator` define or the
  override `null`; no test that an asset status change refreshes the probe.
- N1: the tracked `ATTRIBUTION.md` has an outdated sentence about
  operator-mounted self-host; editing it changes the manifest digest and the
  reviewed desktop pack inventory. **Owner decision needed before Phase 4**,
  because Phase 4 publishes that file permanently.
- N2: record deviations: attribution is inlined via `?raw` (not copied to
  `dist`), `README.md` not bundled; licensing JSON records unchanged.
- N3–N9 (optional): duplication with the desktop control; double probe on
  mount; misleading text if the asset list fails; exhaustive failure-text
  typing and size-mismatch wording; status line during download; voice.md
  "preview" wording; indeterminate progress when total is unknown.

#### Code Review #1 Revisions

- **P3-F1 accepted.** `cacheParakeetWebgpuProbe` (in `webgpu.ts`) caches the
  probe per page but probes again after a `model_missing` result, so the next
  dictation or Voice Mode start sees an encoder installed while Settings was
  closed. `getParakeetWebgpuStatus` uses it; `refresh` still resets the
  load-failure flag. Unit tests cover the recheck, the cached settled result,
  `refresh` and a shared in-flight probe.
- **P3-F2 accepted.** `webgpu.ts` comments describe pack, model-asset and
  development delivery.
- **P3-F3 accepted in part.** Tests now cover the Vite-serve `operator` define
  and the base-URL override `null`. The Settings effect that refreshes the probe
  on an asset status change is not unit-tested: the web tests have no DOM
  renderer, and the load path no longer depends on that effect (P3-F1). The
  built-stack check observed the refresh (install and removal changed the
  status without a reload).
- N1: surfaced to the owner (the `ATTRIBUTION.md` wording must be decided
  before Phase 4 publishes it).
- N2 recorded: the attribution is inlined into the bundle with `?raw` and shown
  as compact text; `README.md` is not bundled (it holds no attribution terms).
  The licensing JSON records are unchanged; the owner's licensing review of the
  PR decides whether they should name the R2 channel.
- N5, N6, N7, N8, N9 accepted: a self-host message when the asset list is
  unavailable; failure text typed against the generated reason union, with
  separate size-mismatch wording; a downloading status line; voice.md says
  "Vite development"; an indeterminate progress bar without a total.
- N3 (shared presentational piece) and N4 (one extra probe on mount): no change;
  the data models differ and the extra probe is one `HEAD`.

Verification: from `src/frontend/web`,
`pnpm exec vitest run src/ui/settings src/lib/speech/client-parakeet tests/localParakeetModels.test.ts`
101 passed; eslint clean on changed files; `pnpm check` exit 0.

#### Code Review #2 Findings

Targeted recheck (same reviewer): P3-F1 to P3-F3 and N5 to N9 verified, no
regressions. Result: pass; one repair round used. Non-blocking follow-ups
applied: the self-host "download unavailable" message no longer flashes while
the asset list is loading (it shows "Checking the GPU speech encoder…"), and
this status record was updated.

**Pre-Phase 4 scan (owner approved the scanner, 2026-09-27):** the pinned
gitleaks 8.30.1 darwin_arm64 archive matched its pinned SHA-256
(`b40ab0ae…b6a5`). `pnpm release:scan --candidate release/models/parakeet-tdt-0.6b-v2-webgpu`
passed: 4 files, 0 findings, canary detected, the ONNX file excluded from
gitleaks and byte-searched for private text. The dry run reports a passing
receipt. Nothing was uploaded. A change to `ATTRIBUTION.md` (N1) would require
restaging and rescanning.

### Phase 4: R2 publication and built self-host acceptance (owner-gated)

**Gate:** each step needs explicit owner approval in chat at the time. The
owner holds the R2 credentials. The agent never requests, reads or prints them.

1. **Bucket lock (owner, dashboard).** The owner adds the `models/` lock rule
   (O3) and confirms it here, with the date.
2. **Scan.** Done: after the FI-F2 notice fix the set was restaged and
   rescanned (2026-09-27, pass, 4 files, 0 findings). The receipt stays valid
   while the staged files are unchanged; restage and rescan after any change.
3. **Publish (owner-run or owner-approved).** With the owner's credentials in
   their own environment, run:

   `pnpm --filter animama-desktop models:publish --model parakeet-tdt-0.6b-v2-webgpu --confirm-publication`

   Record the four keys, whether each was uploaded or already present, and the
   anonymous verification result.
4. **Built self-host acceptance.** On a stack built from the final candidate,
   with a WebGPU-capable browser and no operator mount:
    - Experimental offers the download with size and free space.
    - The download completes, and the file is served only after verification.
    - Cancel mid-download leaves nothing staged; Retry succeeds.
    - The toggle reports available, and live previews work.
    - Remove returns the status to not installed.
    - A browser without a WebGPU adapter (for example, WebGPU disabled) sees no
      download control.
5. **Desktop.** Confirm that desktop checks pass and that the embedded build
   still points at the pack URL. The pack's notice changed (FI-F2): the owner
   records the `0.1.1` inventory digest before the next desktop release build;
   #144 Phase 4 still owns native pack acceptance.
6. **Merge.** The owner approves the exact PR candidate after steps 1–4.

**Completion:** the #163 acceptance items are recorded with evidence, and the
catalog URL downloads anonymously with matching hashes. Merging still needs
separate exact-candidate approval.

**Results (2026-09-27):**

- **Steps 1–3 (owner).** The owner added the `models/` lock rule and published
  the set with `models:publish --confirm-publication`.
- **Publication verified anonymously** (identity encoding): all four objects
  return 200 with the exact `Content-Length`, no `Content-Encoding`,
  `Cache-Control: public, max-age=31536000, immutable` and suffix content
  types; `ATTRIBUTION.md` (`2efaf55f…`), `README.md` (`4f23ceb4…`) and
  `manifest.json` (`760221af…`) match their keys by SHA-256. The encoder was
  verified through the app's own install (below).
- **Step 4, built self-host** (`animama-selfhost-dl`, rebuilt from `ef9066d`,
  empty store, in-app browser with a WebGPU adapter, desktop width):
    - Experimental offered "1.2 GB download · 435 GB free on the server".
    - Download started; progress reached 0.35 after about 5 s with a
      `.part` file in `staging/model-assets`; the status line read
      "Downloading the GPU speech encoder…".
    - Cancel returned to not installed, with 0 files staged or installed and
      the content route at 404.
    - Download again: the content route stayed 404 while downloading (66%),
      then the asset installed; the setting reported "Available on this
      device" without a reload.
    - The installed file is 1,238,960,452 bytes with SHA-256 `ad8bb0ac…62a2`
      (recomputed on disk), mode `0600`; the route served 200 with that ETag.
      This also verifies the published encoder object.
    - Two-step removal returned to not installed; 0 files remain; route 404.
- **Not performed here:** live previews and the WebGPU worker actually loading
  the encoder (the in-app browser blocks the microphone), and a browser without
  a WebGPU adapter (unit-tested only). These are owner manual checks.
- **Step 5.** Desktop checks pass (`pnpm --filter animama-desktop test` 331,
  `pnpm check`); the embedded define is still `pack`. The `0.1.1` inventory
  approval remains before the next desktop release build.

#### Code Review #1 Findings

No code changed in this phase; no review required.

## Final integration review

Scope: the authorized Phases 1–3. Phase 4 code or notice changes get Phase 4
Code Review #1 and continue this final-scope round count (one repair round
remains unused here) rather than starting a fresh count.

**Candidate evidence on `9bc8aac` (Python 3.12.13, 2026-09-27):**

- `uv run pytest -q` 1961 passed, 7 skipped; `uv run ruff check` and
  `ruff format --check src tests` clean; import boundary `forbidden_edges: 0`.
- From `src/frontend`: `pnpm check`, `pnpm web:lint`, `pnpm build`,
  `pnpm desktop:check` exit 0; `pnpm web:test` 317 files, 1934 tests passed;
  `pnpm --filter animama-desktop test` 17 files, 331 passed;
  `pnpm openapi-ts:check` current.
- `bash -n reset.sh`; `docker compose config --quiet` for base and development.
- Built stack `animama-selfhost-dl` rebuilt from `9bc8aac`: encoder `HEAD` 404,
  asset `not_installed` with free space, Experimental shows
  "1.2 GB download · 436 GB free on the server" and the download button.

### Final Integration Review #1 Findings

Independent `sdlc-reviewer` on `9bc8aac` (baseline `main` `bf9fe3f`): pass.
Catalog, publication keys and the client URL and asset ID agree; the `main`
merge left Phase 3 intact; docs are consistent; desktop pack behavior is
unchanged.

- FI-F1 (required, record only): this plan's progress, commits and evidence
  were stale for the integrated candidate.
- FI-F2 (owner decision, gates Phase 4): the tracked `ATTRIBUTION.md` says
  self-host loads an operator-mounted set and desktop redistributes the file
  only in the pack. The self-host panel shows it, and Phase 4 would publish it
  permanently. Editing it changes the manifest digest and the next desktop pack
  inventory (fresh owner approval), requires reimporting store copies with
  `acquire --offline --import-from`, and a restage and rescan; the encoder URL
  and catalog do not change. v0.1.1 already published the current file under
  `desktop/v0.1.1/`.
- FI-F3 (optional): the client asset ID was not bound to the catalog by a test.

### Final Integration Review #1 Revisions

- FI-F1 accepted: progress, commits, evidence and this section updated.
- FI-F2 accepted per the owner decision (2026-09-27): notice fixed, manifest
  and license hash updated, pack version `0.1.1` with approval pending, model
  store reimported, set restaged and rescanned. This is final-scope repair
  round 1. Checks: `uv run pytest -q` 1961 passed, 7 skipped; `pnpm web:test`
  1934 passed; `pnpm --filter animama-desktop test` 331 passed; `pnpm check`
  exit 0; dry run lists the new notice and manifest keys, the unchanged encoder
  key, and a passing scan.

### Final Integration Review #2 Findings

Targeted recheck (same reviewer) of the FI-F2 fix on the tree over `261553f`:
pass. Hashes, manifest, license record and the new inventory digest were
independently recomputed (the method reproduces the old approved `76101656…`);
the version bump with a `null` approval follows `runtime-staging.md`; no other
license record needs a change. Optional follow-ups applied: the
`runtime-staging.md` sentence about active packs, a dated pointer in the WebGPU
plan, and the no-extra-download note above. One final-scope repair round
remains.
- FI-F3 accepted: `tests/localParakeetModels.test.ts` asserts the built define's
  asset ID exists in the packaged catalog.

## Validation and acceptance

The acceptance criteria are those of #163:

- On a built self-host stack with a WebGPU-capable browser and no operator
  mount, Experimental offers the encoder with size and free space.
- The download is verified before it is served.
- Cancel and retry work.
- After install the toggle reports available and live previews work.
- Removal returns the status to not installed.
- Without a WebGPU adapter, no download is offered.
- The R2 objects download anonymously and match the catalog hashes, and the
  bucket lock covers `models/`.
- Desktop pack behavior is unchanged.

Required checks:

- `uv run pytest -q`, `uv run ruff check`
- From `src/frontend`: `pnpm openapi-ts:check`, `pnpm check`, `pnpm web:lint`,
  `pnpm web:test`, `pnpm build`, `pnpm desktop:check`
- The Compose config checks and `bash -n reset.sh`
- A built self-host browser check

Record local evidence, hosted `Validation` and browser evidence separately.

## Idempotence and recovery

- **Merging #162** is a normal merge commit. It can be reverted without
  touching #161.
- **Interrupted downloads** leave only staging files, which are discarded at
  service start. Retry restarts the download. A failed install leaves nothing
  servable.
- **Publication.** Uploads are create-only, and a rerun verifies existing
  objects byte for byte. A differing object stops publication. Objects under
  the lock cannot be deleted or replaced: a corrected file has a new hash and
  so a new key. Unchanged files, including the encoder, are never re-uploaded.
  Never overwrite in place.
- **Wrong or unwanted objects.** If an object was published without the lock
  and must be withdrawn, delete it and purge its exact URL from Cloudflare's
  cache, as documented for `desktop/v`.
- **Reverting the UI** restores `model_missing` text for self-host. Installed
  files stay in the data root until the operator removes
  `internal/model-assets`.
- **Retiring the mount** is reversible by restoring the Compose bind mount.
  Development stacks are unaffected either way.

## Outcomes & Retrospective

Pending.
