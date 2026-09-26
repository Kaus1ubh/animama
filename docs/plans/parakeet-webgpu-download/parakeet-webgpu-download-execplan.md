# Optional Parakeet WebGPU encoder download

Source agreement: [raymond-van/animama#144](https://github.com/raymond-van/animama/issues/144)
as published, plus the owner instruction dated 2026-09-26 to ship WebGPU after
the v0.1.0 R2 preview, in a later app release.
Authorized scope: Phases 1–3, authorized by the owner on 2026-09-26. Phase 4
needs separate authorization. Nothing in this plan authorizes publishing a release.

## Purpose and context

The experimental **GPU-accelerated offline speech (WebGPU)** toggle runs the
Parakeet encoder on the GPU and shows live preview transcripts (#111). It needs
one extra file: the fp16 encoder `encoder-model.fp16.onnx` (1,238,960,452 bytes,
SHA-256 `ad8bb0ac…62a2`, from `ysdede/parakeet-tdt-0.6b-v2-onnx@db4a768f`,
CC-BY-4.0). WebGPU reuses the base set's INT8 decoder, preprocessor and
vocabulary. Today only Vite development serves the encoder; built self-host and
packaged desktop builds compile its URL to `null`, so the toggle reports
`unavailable_in_build`.

After this work:

- Packaged desktop offers the encoder as an optional feature pack,
  `parakeet-stt-webgpu`, downloaded through the existing verified pack path
  (catalog-pinned SHA-256, resumable download, staged extraction, atomic
  activation, removal leases). It is published with an app release under
  `desktop/v<version>/` like `parakeet-stt`.
- It is offered only when a WebGPU adapter exists. App Settings → Experimental
  shows a download control with size and required free space, progress, cancel,
  retry and remove. Devices without WebGPU never see or download it.
- Built self-host serves an operator-mounted encoder from FastAPI's web root
  when present. The existing `HEAD` probe then reports `available`; otherwise the
  panel reports "not installed" instead of `unavailable_in_build`.
- The base `parakeet-stt` pack inventory and CPU behavior are unchanged.

The v0.1.0 R2 preview (2026-09-26) shipped without this pack. Because a signed
app seals its pack catalog, the WebGPU pack first becomes downloadable in the
first app release built after this plan lands (v0.1.1 or later).

### Orientation

Commands run from `src/frontend` unless stated. Relevant code:

| Area            | Files                                                                                                                                                                                                                                                                                                                                                                                             |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pack identity   | `shared/desktop-runtime.ts` (`featurePackIds`), `desktop/runtime/feature-pack.schema.json`, `desktop/runtime/feature-pack-releases.json`, `desktop/runtime/size-budgets.json`, `desktop/runtime/source-manifest.json`, `desktop/runtime/license-sources.json`, `desktop/scripts/runtime/release-policy.mjs` (sorted-ID check), `src/backend/animama/domain/feature_packs.py` (`FEATURE_PACK_IDS`) |
| Pack production | `desktop/scripts/runtime/optional-inputs.mjs` (stages pinned inputs), `feature-packs.mjs` (per-ID input paths), `feature-pack-build.ts` (per-pack file allowlist, inventory, budgets, catalog), `src/backend/packaging/desktop/archive_feature_pack.py`, `measure.mjs`, `review-packet.mjs`                                                                                                       |
| Pack runtime    | `desktop/src/main-process/feature-packs/catalog.ts` (catalog limit of 3 entries, `requiredFreeBytes`), `manager.ts`, `download.ts`, `extract.ts`; `runtime/supervisor.ts` (backend environment, removal checks, transitions); `runtime/ipc.ts` (fallback ID list)                                                                                                                                 |
| Backend serving | `src/backend/animama/local/http/assets.py` (`PARAKEET_MOUNT`, `ModelMount`, `_model_response`), `server/config.py` (`ANIMAMA_PARAKEET_MODEL_MOUNT_JSON`), `server/local_http.py`, `server/routers/desktop_control.py` (removal check), `server/routers/runtime_capabilities.py`                                                                                                                   |
| Client          | `web/vite.config.ts` (`__CLIENT_PARAKEET_WEBGPU_MODEL_BASE_URL__`), `web/src/lib/speech/client-parakeet/{assets,webgpu,client}.ts`, `web/src/ui/settings/ExperimentalSettings.tsx`, `web/src/hooks/useDesktopFeaturePacks.ts`, `web/src/ui/settings/DesktopFeaturePacksPanel.tsx`                                                                                                                 |
| Self-host       | `docker-compose.yml`, `Dockerfile`, `docker-compose.development.yml`, `reset.sh`                                                                                                                                                                                                                                                                                                                  |
| Model store     | `scripts/models/parakeet_webgpu.py` (acquire/verify/path), `models/parakeet-tdt-0.6b-v2-webgpu/{manifest.json,ATTRIBUTION.md,README.md}`                                                                                                                                                                                                                                                          |
| Licensing       | `licenses/third-party/code-and-models.{json,md}`, `licenses/source-review.json`, `desktop/runtime/license-sources.json`                                                                                                                                                                                                                                                                           |
| Docs            | `docs/frontend/desktop/feature-packs.md`, `docs/frontend/runtime/voice.md`, `docs/backend/operations/model-assets.md`, `scripts/models/README.md`                                                                                                                                                                                                                                                 |

Facts that shape the design:

- No pack-to-pack dependency concept exists (catalog, manager, schema and UI).
- `loadPackCatalog` rejects catalogs with more than 3 entries.
- `MAX_PACK_BYTES` is 2 GiB, which fits the encoder.
  `requiredFreeBytes` (archive + 2 × installed + 64 MiB) is about 3.8 GB.
- The backend has one model mount slot, at `/onnx/models/parakeet-tdt-0.6b-v2/`.
- fp16 weights compress poorly, so the archive will be close to 1.24 GB.

### Boundaries

In scope: the requirements in #144.

Excluded, as in #144:

- Enabling WebGPU by default.
- Changing `parakeet-stt` contents or its approved inventory.
- WASM threads (#128).
- Chrome Web Speech on hosted web.
- Electron decoder-loop performance.
- Publishing a release (a separate owner-gated action).

## Progress

- [x] Owner review of this plan (2026-09-26): D1–D4 decided; Phases 1–3 authorized.
- [ ] Phase 1 (#147): `parakeet-stt-webgpu` pack produced and dependency-aware.
- [ ] Phase 2 (#148): Installed encoder served on desktop and self-host.
- [ ] Phase 3 (#149): Experimental download control and status.
- [ ] Phase 4: Signed candidate and native acceptance (owner-gated).
- [ ] Final integration review.

## Surprises & Discoveries

- 2026-09-26: `models/parakeet-tdt-0.6b-v2-webgpu/manifest.json` already pins the
  encoder and `scripts/models/parakeet_webgpu.py` already acquires and verifies
  it into the shared model store. Pack staging can reuse it as `parakeet.py` is
  reused for the base pack.
- 2026-09-26: nothing under `licenses/` or `desktop/runtime/` records the WebGPU
  set yet. Its inventory and license entries are new review inputs.

## Decision Log

Proposed by the agent on 2026-09-26; owner decisions are dated.

- **D1: separate pack with a declared dependency (owner decision, 2026-09-26).**
  `parakeet-stt-webgpu` is its own pack whose catalog entry declares
  `requires: ["parakeet-stt"]`. An add-on inside `parakeet-stt` would force every
  offline-speech user to download 1.24 GB more, or change the approved base
  inventory. A separate pack keeps the base unchanged and removal independent.
- **D2: self-host uses an operator mount (owner decision, 2026-09-26).** Serve an operator-provided
  `ANIMAMA_PARAKEET_WEBGPU_MODEL_DIR`, verified at startup by `reset.sh`, as the
  dev stack already does. A server-side download would add a new network path,
  storage management and progress API for an experimental feature.
- **D3: dependency behavior (owner decision, 2026-09-26).**
    - Installing the WebGPU pack requires `parakeet-stt` to be active. The control
      says "Install offline speech first" instead of silently installing both.
    - Removing `parakeet-stt` while the WebGPU pack is installed is refused with a
      blocker that names the dependent pack.
- **D4: release timing (owner decision, 2026-09-26).** v0.1.0 was published
  without WebGPU. The pack ships with the next app release, and its inventory
  hash needs owner review before that release is built.

## Phased implementation

Default delivery: one branch `feat/parakeet-webgpu-download` and one PR for the
plan, with one issue per authorized phase under #144.

### Phase 1: `parakeet-stt-webgpu` pack produced and dependency-aware

**Requirements:** #144 "Packaged desktop", "Pack inventory".

**Changes:**

1. **Pack identity.** Add `parakeet-stt-webgpu` to:
    - `featurePackIds`, the schema enum and the `ipc.ts` fallback list;
    - `release-policy.mjs`'s sorted-ID check;
    - the backend `FEATURE_PACK_IDS`;
    - the panel names and descriptions.

    In `feature-pack-releases.json`, add `release_status: "active"`, version
    `0.1.0`, `approved_inventory_sha256: null` (a review gate) and
    `license_refs: ["parakeet-webgpu-input"]`.

    Add size budgets (download and installed, about 1.30 GB each, final values
    from the measured archive). Raise the catalog entry limit from 3 to 4.

2. **Inputs.** Extend `optional-inputs.mjs` to stage the encoder via
   `python3 scripts/models/parakeet_webgpu.py path --offline`, verify it against
   the tracked manifest, and add `ATTRIBUTION.md` and a pack review note.

    `feature-pack-build.ts` gets an exact file allowlist for this pack
    (`encoder-model.fp16.onnx` plus notices).

3. **Licensing.** Add a `parakeet-webgpu-input` license source (CC-BY-4.0
   attribution to the upstream NVIDIA model and the ysdede ONNX export). Record it
   in `licenses/third-party/code-and-models.{json,md}` and `source-review.json`,
   and generate its notice text.
4. **Dependency.**
    - Add an optional `requires` array to the pack schema and the catalog entry.
    - `catalog.ts` validates that it names known packs, with no cycles.
    - `manager.install` fails with `pack_dependency_missing` unless every required
      pack is active.
    - `remove` of a required pack fails with a `dependent_pack_installed` blocker.
    - Activation order at startup keeps the required pack first.
5. **Staging without the input.** A missing WebGPU input does not fail staging
   for development builds. For a release build (`active` status), it fails with
   an actionable message naming `parakeet_webgpu.py acquire`, like the base pack.

**Checks:**

- `pnpm desktop:check`
- `pnpm --filter animama-desktop exec vitest run`: `feature-packs`,
  `optional-inputs`, `runtime-packaging`, `runtime-ipc`, `release-scan`, plus new
  dependency tests for install refusal, removal blocker, catalog validation and
  a 4-entry catalog.
- `uv run pytest -q tests/test_webgpu_model_store.py`
- `uv run ruff check`

A local `pnpm desktop:runtime:stage` must produce
`parakeet-stt-webgpu-0.1.0-data-only.tar.zst` with a report state of
`redistribution_review_required` until the owner records the inventory hash.

**Completion:** checks pass, the staged pack round-trips through
build/extract/verify, and the base pack's inventory hash is unchanged
(`455b7628…`).

**Gate:** the owner reviews the pack inventory and records
`approved_inventory_sha256` before any release build. This is not needed for
Phases 2–3.

#### Code Review #1 Findings

Pending.

#### Code Review #1 Revisions

Pending.

### Phase 2: Installed encoder served on desktop and self-host

**Requirements:** #144 "Packaged desktop" serving, "Built self-host", and the
404-when-absent approach step.

**Changes:**

1. **Backend.**
    - Generalize `ModelMount` to a small set of named mounts.
    - Add `/onnx/models/parakeet-tdt-0.6b-v2-webgpu/`, configured by
      `ANIMAMA_PARAKEET_WEBGPU_MODEL_MOUNT_JSON`, with the same inventory-only,
      size, link-count, ETag and `?v=` checks. It returns 404 when not configured.
    - Add `offline_speech_webgpu_asset_version` to runtime capabilities.
    - Extend the `desktop_control` removal check with the new pack ID.
2. **Supervisor.** When `parakeet-stt-webgpu` is active, pass its mount JSON and
   asset version. Pack transitions already restart the backend.
3. **Client build define.**
    - Embedded desktop: `__CLIENT_PARAKEET_WEBGPU_MODEL_BASE_URL__` becomes
      `/onnx/models/parakeet-tdt-0.6b-v2-webgpu`.
    - Self-host `dist` build: it becomes `/__client-parakeet-webgpu-models`, set in
      the `Dockerfile` beside the base URL.
    - The value is never `null` in built modes. The `HEAD` probe decides
      availability.
4. **Self-host Compose.** In `docker-compose.yml`, mount
   `${ANIMAMA_PARAKEET_WEBGPU_MODEL_DIR}` read-only at
   `/opt/animama/web/__client-parakeet-webgpu-models`. The fallback is the tracked
   notices directory, which contains no encoder and so serves 404, following the
   development override.

    `reset.sh` already resolves and records the optional directory offline; it
    exports it for the built selection too.

**Checks:**

- `uv run pytest -q tests/test_local_http_assets.py tests/test_local_http_wiring.py tests/test_runtime_capabilities.py tests/test_compose_network_boundaries.py`
- `uv run ruff check`
- `pnpm --filter animama-desktop exec vitest run tests/runtime-supervisor.test.ts`
- `pnpm web:test` (`localParakeetModels.test.ts` with updated build defines)
- `pnpm build`
- `docker compose -f docker-compose.yml config --quiet`, with and without the
  variable
- `bash -n reset.sh`

**Manual checks:**

- `ANIMAMA_WEB_BUILD_MODE=production ./reset.sh --name webgpu --base-port 8300`
  with the acquired encoder: `HEAD` on the encoder URL returns 200 and the toggle
  reports available.
- Without the encoder: 404 and "not installed".

**Completion:** all checks pass, and the built self-host stack shows both states.

#### Code Review #1 Findings

Pending.

#### Code Review #1 Revisions

Pending.

### Phase 3: Experimental download control and status

**Requirements:** #144 "Download control", "Status", and approach steps 3–5.

**Changes:**

1. **Status.** Split `unavailable_in_build` in `webgpu.ts`:
    - `not_installed` when the adapter exists and the encoder returns 404.
        - On desktop, it's downloadable when the catalog lists the pack.
        - On self-host, the text says the operator mounts it.
    - `unsupported` stays for no `navigator.gpu` or no adapter.

    `unavailable_in_build` remains only for a truly `null` URL (Vite with an
    explicit override).

2. **Download control.** `ExperimentalSettings.tsx`, via `useDesktopFeaturePacks`:
    - It shows a download icon button beside the toggle only when a WebGPU adapter
      exists, the pack is available and it isn't installed.
    - It shows the download size and required free space from the catalog.
    - It supports progress, cancel, retry after failure, and remove with
      confirmation, reusing `DesktopFeaturePacksPanel` patterns.
    - When `parakeet-stt` is missing, it shows "Install offline speech first" with
      a link to that pack's control (D3).
3. **Toggle.** Turning the toggle on without the encoder opens the download
   prompt instead of silently falling back. After install or removal, the probe
   refreshes (`getParakeetWebgpuStatus({ refresh: true })`).
4. **Docs.** Update `docs/frontend/desktop/feature-packs.md`,
   `docs/frontend/runtime/voice.md`, `docs/backend/operations/model-assets.md`
   and `scripts/models/README.md` to describe the current behavior.

**Checks:**

- `pnpm check`, `pnpm web:lint`, `pnpm web:test`, including:
    - the new `ExperimentalSettings` tests: hidden without an adapter, size text,
      progress, cancel, retry, remove, the dependency message, and the toggle
      prompt;
    - `webgpu.test.ts` for the new status.
- `pnpm build`
- `pnpm desktop:check`

**Browser checks:**

- Desktop viewport in the dev stack against a stubbed desktop bridge.
- A narrower layout for regressions.

**Completion:** checks pass, and the browser evidence covers the visible states.

#### Code Review #1 Findings

Pending.

#### Code Review #1 Revisions

Pending.

### Phase 4: Signed candidate and native acceptance (owner-gated)

**Requirements:** #144 acceptance on a WebGPU-capable Mac. This phase needs
separate owner authorization, and it overlaps the next app release.

**Steps:**

1. The owner reviews and records the pack inventory hash (Phase 1 gate) and any
   changed core inventory.
2. Bump the app version (at least 0.1.1).
3. Follow `docs/frontend/desktop/release-process.md`: stage, audit,
   `desktop:dist:mac`, `desktop:release:scan`, then the fresh-profile smoke.
4. **Native acceptance** on a WebGPU-capable Mac:
    - The button shows the correct size.
    - Download is verified before activation.
    - Cancel and quit resume.
    - After install the toggle reports available and live previews work.
    - Removal restores final-only behavior.
    - Removing `parakeet-stt` is blocked while WebGPU is installed.
    - Without WebGPU (or with the adapter unavailable), the control never appears.
5. Publication (preview or stable) follows the release runbook under its own
   approval. The pack uploads with the app under `desktop/v<version>/`.

**Gates:**

- the owner's inventory approval
- the owner's publication approval
- physical GPU acceptance, which agents cannot perform

#### Code Review #1 Findings

Not applicable unless code changes are needed.

## Final integration review

After Phases 1–3, review the combined behavior against every #144 acceptance
item, reusing valid phase evidence. Confirm the base pack's inventory hash and
CPU dictation behavior are unchanged.

## Validation and acceptance

#144's acceptance criteria are authoritative. Evidence expected:

| Criterion                                          | Evidence                                                                                   |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Desktop download, verify, resume, activate, remove | Phase 1 tests and Phase 4 native acceptance                                                |
| Never offered without WebGPU                       | Phase 3 tests and Phase 4 native check                                                     |
| Self-host available and not-installed states       | Phase 2 manual built-stack check                                                           |
| Base inventory and CPU behavior unchanged          | Inventory hash `455b7628…` and existing tests                                              |
| Repository checks                                  | `pnpm check`, `web:lint`, `web:test`, `build`, `desktop:check`, `uv run pytest -q`, `ruff` |

## Idempotence and recovery

- **Pack install** reuses the manager's resumable partial download and staged
  commit. A failed or cancelled install leaves the previous state and a
  resumable `.partial` file.
- **Staging** rebuilds packs from the verified model store and never modifies
  it. A missing encoder input is an actionable failure, not a partial pack.
- **Self-host:** removing the mount returns the stack to "not installed"
  without data changes.
- **Published pack objects** are immutable under the R2 lock. A changed pack
  archive needs a new app version, never a replaced object.

## Outcomes & Retrospective

Not started.
