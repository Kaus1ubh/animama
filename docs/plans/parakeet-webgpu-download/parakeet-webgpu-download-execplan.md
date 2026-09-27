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
- [x] Phase 1 (#147, `3fb6708`): `parakeet-stt-webgpu` pack produced and dependency-aware. Review #2 passed; the pack inventory hash (`76101656…`) awaits owner approval before a release build.
- [x] Phase 2 (#148, `69ed94e`): Installed encoder served on desktop and self-host. Review #2 passed; built self-host verified at 200/404.
- [x] Phase 3 (#149, `88542f5`): Experimental download control and status. Review #3 passed; native desktop visual check is Phase 4.
- [ ] Phase 4: Signed candidate and native acceptance (owner-gated).
- [x] Final integration review: passed (optional FI-F1 deferred).

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
  *Superseded for built self-host on 2026-09-26* by owner decision O4 in
  [self-host model downloads](../self-host-model-downloads/self-host-model-downloads-execplan.md)
  (#163): built self-host downloads the encoder in the app through the shared
  model-asset downloader, and only development stacks keep the operator mount.
- **D3: dependency behavior (owner decision, 2026-09-26).**
    - Installing the WebGPU pack requires `parakeet-stt` to be active. The control
      says "Install offline speech first" instead of silently installing both.
    - Removing `parakeet-stt` while the WebGPU pack is installed is refused with a
      blocker that names the dependent pack.
- **Implementation decisions (agent, 2026-09-26, within the accepted outcome).**
    - The dependency is declared in shared app code rather than as a `requires`
      field in the signed pack manifest. The app and its catalog ship together,
      and existing installed manifests (exact-key validated) stay valid.
    - Staging fails when an active pack's inputs are missing, matching the base
      pack; release staging therefore needs the 1.24 GB WebGPU set.
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
4. **Dependency** (implemented as recorded in the Decision Log, 2026-09-26).
    - `featurePackRequires` in `shared/desktop-runtime.ts` declares
      `parakeet-stt-webgpu` → `parakeet-stt`, sealed into the app.
    - `manager.install` fails with `pack_dependency_missing` unless every required
      pack is active.
    - `remove` of a required pack fails with `pack_dependent_installed` and a
      `feature_pack` blocker naming the dependent.
    - At startup a dependent whose requirement is not active is not mounted; it
      reports `failed`/`pack_dependency_missing` and keeps its files.
5. **Staging inputs.** Like the base pack, an active pack whose inputs are
   missing fails staging with an actionable message naming
   `parakeet_webgpu.py acquire`. The release workflow acquires and verifies the
   set.

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

Reviewed the uncommitted Phase 1 tree against baseline `0cf2355` (independent
`sdlc-reviewer`, initial full review). Reviewer checks: pack, input and
packaging tests (127 passed), `desktop:check`, web panel/diagnostics tests,
pytest (39 passed), `make format-check`, `ruff`.

- **P1-F1 (required):** the release workflow never acquires the WebGPU set, so
  release staging would fail; the plan's step 5 no longer matched the code.
- **P1-F2 (required):** the catalog-limit test passed under the old limit of 3.
- P1-F3: plan text differs on the dependency location and removal error code.
- P1-F4: startup mounted a verified dependent even when its requirement was
  inactive.
- P1-F5: confirmed the serialized queue prevents dependency races (no change).
- P1-F6, P1-F7: panel shows Install after a refused removal and lists the pack
  on any device (Phase 3 scope).
- P1-F8: the base Parakeet notice said no FP16 model is redistributed.
- P1-F9: notice edits change the store digest; re-import was undocumented.
- P1-F10: the core inventory changes (already a Phase 4 gate).
- P1-F11: missing mixed staging and WebGPU receipt tests.
- P1-F12: removal docs and troubleshooting lacked the new codes.

#### Code Review #1 Revisions

- P1-F1 accepted: `release-desktop-macos.yml` acquires and verifies
  `parakeet_webgpu.py`; step 5 and the Decision Log record the behavior.
- P1-F2 accepted: a 4-entry catalog now passes the length check and fails only
  the duplicate-ID check; 5 entries fail the length check.
- P1-F3 accepted: plan step 4 and the Decision Log updated.
- P1-F4 accepted: `initialize` leaves a dependent unmounted with
  `pack_dependency_missing`; tested after a base-only update.
- P1-F5: no change needed.
- P1-F6, P1-F7 deferred to Phase 3 (download control and device gating).
- P1-F8 accepted: the base notice scopes its FP16 statement to `parakeet-stt`.
- P1-F9 accepted: `model-assets.md` documents the offline re-import.
- P1-F10: no change; Phase 4 lists the core inventory review.
- P1-F11 accepted: tests for a missing WebGPU set in a selected store and for a
  stale WebGPU receipt.
- P1-F12 accepted: `feature-packs.md` and `troubleshooting.md` updated.

Verification: `vitest run tests/feature-packs.test.ts tests/optional-inputs.test.mjs`
63 passed; full desktop suite 16 files / 313 tests passed; `desktop:check`
and web `tsc -b` passed.

#### Code Review #2 Findings

Targeted recheck of the accepted fixes (same reviewer): all verified, no
regressions, no blockers. Reviewer checks: 3 desktop test files / 129 tests,
`desktop:check`, Prettier on changed files. Non-blocking notes: the owner should
see the staging decision at PR approval (every local stage now needs the WebGPU
set), and the no-store WebGPU staging case relies on the generic loop test.

Result: pass. One repair round remains unused.

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

**Implementation notes (agent, 2026-09-26):**

- No `offline_speech_webgpu_asset_version` capability field: the `HEAD` probe
  decides availability, and the unversioned encoder URL is served `no-cache`
  and revalidated by its SHA-256 ETag. This avoids an OpenAPI/SDK change.
- The built self-host URL comes from Vite's `build` command, not a `Dockerfile`
  variable.

**Evidence:**

- `ANIMAMA_WEB_BUILD_MODE=production ./reset.sh --name webgpu --base-port 8300`
  (`http://animama-webgpu.localhost:8300`), built from this source:
    - With the acquired encoder mounted, `HEAD` on the encoder returned 200 with
      1,238,960,452 bytes, and a missing file returned 404.
    - After recreating `animama-server` without the variable (notices fallback),
      the encoder returned 404.
    - The built client bundle contains `/__client-parakeet-webgpu-models`.
- `docker compose config --quiet` is valid for the base and development files.

#### Code Review #1 Findings

Independent `sdlc-reviewer`, initial review of the uncommitted tree on `3fb6708`.

- **P2-F1 (required):** packaged desktop stamped the WebGPU encoder URL with the
  base pack's `?v=` version. The encoder mount accepts only its own version, so
  the real load returned 404 after a passing probe, and speech fell back to WASM
  for the session. Reproduced with two mount versions.
- P2-F2: `voice.md` still described build-only serving.
- P2-F3: the `assets.ts` docstring was stale.
- P2-F4: a class doc comment sat above the new helper.
- P2-F5: `ANIMAMA_PARAKEET_WEBGPU_ASSET_VERSION` reaches every child, like the
  existing base version; the mount JSON correctly reaches only the HTTP child.
- P2-F6: the new removal-check branch was untested.

#### Code Review #1 Revisions

- **P2-F1 accepted.** `withBackendEncoder` (in `webgpu.ts`) swaps in the
  unversioned absolute encoder URL after base URLs are versioned.
    - Web tests cover WebGPU, WASM and no-encoder builds.
    - The backend test now uses distinct mount versions: the base version 404s,
      the encoder's own version and unversioned requests return 200, and
      unversioned requests are `no-cache`.
- P2-F2, P2-F3 and P2-F4 accepted and fixed.
- P2-F5: no change. Both version variables are non-sensitive and consistent.
- P2-F6 accepted: the removal check returns the WebGPU pack version.

Verification:

- `pytest` asset and capability tests: 113 passed.
- `ruff check` and `ruff format --check` pass.
- Web `client-parakeet` tests: 33 passed. Web `tsc -b` passes.
- `desktop:check` passes.

#### Code Review #2 Findings

Targeted recheck (same reviewer): all accepted fixes verified, no blockers.
Non-blocking P2-R1: a formatter run had reindented all of `voice.md`; it was
reverted to the four-line serving edit. Result: pass; one repair round unused.

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

**Implementation notes (agent, 2026-09-26):**

- The status name stays `model_missing`: the probe already checks the adapter
  first, so it means "adapter present, encoder not installed". A rename to
  `not_installed` would only add churn. `unavailable_in_build` now occurs only
  in a Vite stack with a base-URL override.
- The dependency message names the location, General → Optional feature packs,
  instead of rendering a link. The Settings modal has no deep-link target for a
  single pack control.
- The toggle-on prompt and container wiring are covered by the presentational
  component's tests; the hook-driven container has no render test.

**Evidence:**

- `pnpm check`, `pnpm web:lint`, `pnpm web:test` (317 files / 1919 tests),
  `pnpm build`, `pnpm desktop:check` and desktop vitest (315 tests) passed.
- Built self-host stack rebuilt from this tree, in the in-app browser at a
  desktop viewport:
    - With the encoder mounted, Experimental reads "Available on this device…",
      which replaces the old "Not available in this build yet".
    - Without it, the status shows the operator instructions.
    - No download control appears on self-host.
    - At 600 px wide there is no horizontal overflow.
- The desktop download control is verified by static-render tests only (no
  Electron bridge in a browser). Its native visual check belongs to Phase 4.

#### Code Review #1 Findings

Independent `sdlc-reviewer`, initial review of the uncommitted tree on `69ed94e`.

- **P3-F1 (required):** the dependency message pointed at a nonexistent
  "Settings → Speech" section.
- **P3-F2 (required):** after an interrupted or refused removal (`failed` while
  the version stays active), the control offered a no-op "Retry download".
- **P3-F3 (required):** the plan still specified `not_installed`, a link and a
  new-status test.
- P3-F4: bridge-level errors were not shown in the control.
- P3-F5: the panel's reload warning was missing.
- P3-F6: desktop could briefly show the self-host operator text.
- P3-F7: the container wiring has no render test.
- P3-F8: `update_available` was labelled as a fresh download.
- Docs: `voice.md` omitted that retained files stay removable.

#### Code Review #1 Revisions

- P3-F1 accepted: the message names General → Optional feature packs; no link
  (recorded above).
- P3-F2 accepted: an active catalog version counts as installed; tested.
- P3-F3 accepted: implementation notes above.
- P3-F4, P3-F5, P3-F6 and P3-F8 accepted:
    - the bridge error appears as an alert;
    - the reload warning is shown;
    - desktop shows "not included in this app version" once its pack
      catalog is loaded, and otherwise the operator text (revised in round 2);
    - `update_available` reads "Install compatible version".
- P3-F7 deferred: hook-level rendering needs a DOM test environment that the
  web suite does not use (`environment: "node"`). The native check in Phase 4
  covers the flow.
- Docs accepted.

Verification: web `tsc -b`, ESLint, and settings tests (15 passed).

#### Code Review #2 Findings

Targeted recheck (same reviewer): P3-F1–F5 and P3-F8 verified. **P3-F9
(required):** the P3-F6 "Checking…" text never cleared where the pack bridge is
permanently unavailable (`desktop:dev` external runtime, a failed status call,
or a non-main window), hiding the operator instructions. Non-blocking: the
failure line was hidden after an interrupted removal; plan list indentation.

#### Code Review #2 Revisions

- P3-F9 accepted: removed the "Checking…" branch. Desktop shows "not included
  in this app version" only once its catalog is loaded; otherwise the operator
  text.
- The failure line now shows whenever the pack reports `failed`.
- Plan formatting fixed.

Verification: web `tsc -b`, ESLint, settings tests (15 passed).

#### Code Review #3 Findings

Final targeted recheck: P3-F9 and the failure line verified; plan record
current. Non-blocking: packaged desktop may briefly show the operator text
before its catalog loads (accepted trade-off); the hook's generic alert says
"below". Result: pass.

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

### Final Integration Review #1 Findings

Independent `sdlc-reviewer` on `88542f5` against `b633af1`, reusing phase
evidence. It traced the desktop flow from catalog to load, the removal and
startup paths, self-host, and docs. The base pack is unchanged: inventory
`455b7628…`, and its rebuilt archive `366c26a0…` is byte-identical to the
published v0.1.0 archive. No required findings.

- FI-F1: recovering a retained encoder after reinstalling the base downloads
  it again, while a relaunch reactivates it without downloading.
- FI-F2: a comment overstated ETag revalidation on self-host.
- FI-F3: plan housekeeping (Phase 3 commit, this section, outcomes).

### Final Integration Review #1 Revisions

- FI-F1 deferred: `feature-packs.md` documents the relaunch path. Reactivating
  a retained verified version before downloading is a follow-up.
- FI-F2 and FI-F3 accepted and fixed.

Result: pass. Native desktop acceptance remains Phase 4.

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

**Delivered in Phases 1–3 (agent-ready; owner acceptance pending):**

- **Desktop pack.** `parakeet-stt-webgpu` is a dependency-aware optional pack
  produced from the pinned model store. The release workflow acquires its
  inputs.
- **Serving.** Desktop serves the active encoder through a second verified
  mount; built self-host serves an operator mount. Built apps probe instead of
  reporting `unavailable_in_build`.
- **Settings.** App Settings → Experimental offers the download only on
  WebGPU-capable devices, with size, free space, progress, cancel, retry and
  removal.

**Remaining:**

- The owner reviews the WebGPU pack inventory (`76101656…`) and the changed core
  inventory before a release build.
- Phase 4 native acceptance on a WebGPU Mac, then the next app release.
- FI-F1 follow-up.

**Lessons:**

- Two packs serving related files need separate cache versions. A shared `?v=`
  silently broke the desktop load, and only a two-version test exposed it.
- Formatting docs with the web Prettier config reindents nested lists. Edit
  docs by hand.
