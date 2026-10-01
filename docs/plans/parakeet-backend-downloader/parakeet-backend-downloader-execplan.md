# Parakeet as backend model assets, stepped setup and Cloud | Local models

Status: Implementation complete; owner gates G1–G6 pending. All phases authorized.
Source agreement: [raymond-van/animama#221](https://github.com/raymond-van/animama/issues/221)
as read on 2026-10-01 (Status: Proposal; it absorbs all of #220), plus the
owner's [model-configuration amendment](https://github.com/raymond-van/animama/issues/221#issuecomment-5933748408)
of 2026-10-01 and the owner answers of
2026-10-01 recorded in the [Decision Log](#decision-log).
Authorized scope: whole plan (Phases 1–6 and final integration review), approved
by the owner on 2026-10-01, including the WebGPU encoder re-download (D2).
Packaged-app acceptance, screenshot review and live provider checks remain
owner gates G1–G5.

## Purpose and context

After this work:

- **Parakeet installs in place.** On packaged desktop and built self-host, the base
  (CPU) and WebGPU Parakeet sets install, resume, cancel, retry and uninstall
  through the backend model-asset service (`/v1/model-assets`). FastAPI keeps
  its PID and no window reloads. Dictation works after install and offline.
- **Setup is three short steps:** **Welcome** (display name, 18+ confirmation
  and safety link) → **AI** (Cloud | Local model setup with the OpenAI key) →
  **Voice** (offline speech recognition and text-to-speech with the ElevenLabs
  key). Steps have Back/Continue and a progress indicator.
- **App Settings → Models is organized by where models run** (Cloud | Local).
  It adds an OpenRouter preset, capability chips instead of API tags, and the
  OpenAI key on the OpenAI card. The ElevenLabs key also appears in Voice.

The issue and its amendment are the requirements authority (R1–R19). This plan
records how to implement and verify them.

Repository `raymond-van/animama`, worktree
`worktrees/animama/parakeet-backend-downloader-054e4a`, branch
`feat/parakeet-backend-downloader`. Starting revision `3eb23e45` (`main` with
#215 Plan B, #227 live keys and #228). The primary checkout stays on `main`. No
Cloud checkout or private input is needed.

Follow [SDLC](../../../SDLC.md), [PLANS](../../../PLANS.md), the root guide, the
[backend](../../../src/backend/AGENTS.md) and [frontend](../../../src/frontend/AGENTS.md)
guides, and:

- [ADR 0001](../../adr/0001-independent-local-product-and-packaged-sharing.md):
  shared code takes composition inputs;
- [ADR 0008](../../adr/0008-non-overridable-companion-guardrail.md): unchanged;
- [ADR 0010](../../adr/0010-shared-model-object-distribution.md): partly
  superseded by [ADR 0012](../../adr/0012-backend-parakeet-model-assets.md)
  (accepted in Phase 1);
- [ADR 0011](../../adr/0011-application-owned-companion-features-and-composition-catalog-policy.md):
  the hosted composition stays built-in only.

### Current mechanism (revision `3eb23e45`)

| Area | Behavior |
| --- | --- |
| Asset service | `app/services/model_asset_service.py` installs **one file per asset**. It checks free space, streams one staged file with SHA-256, then commits it to `<data_root>/internal/model-assets/<id>/<sha256>`. Progress lives in memory only, and staging is wiped at startup. `adapters/model_assets/http_fetcher.py` allows only `https://downloads.animama.ai`, sends a plain GET and requires `200`, so there is **no resume**. `register_removal_guard` exists, but nothing registers a guard. |
| Catalog | `resources/model-assets.v1.json` (`animama-asset-catalog/1`, strict `id,url,size,sha256,media_type,license_ref`). It has the single-file `parakeet-tdt-0.6b-v2-webgpu-encoder`, 36 Pocket voices and the Mimi encoder. There are **no base Parakeet entries**. |
| Manifests | `models/parakeet-tdt-0.6b-v2/manifest.json`: 7 files (≈661 MB). `models/parakeet-tdt-0.6b-v2-webgpu/manifest.json`: 3 files (`encoder-model.fp16.onnx` ≈1.24 GB plus README and ATTRIBUTION). Objects are already published at `models/<model-id>/<sha>/<path>`. |
| Desktop serving | `supervisor.ts` `environment()`/`backendEnvironment()` pass `ANIMAMA_PARAKEET_STT_ENABLED`, both asset versions and both mount JSON values. `server/local_http.py` turns these into `ModelMount`s, and `local/http/assets.py` serves them at `/onnx/models/parakeet-tdt-0.6b-v2[-webgpu]/` with `?v=` cache pinning. `transitionPack` quiesces the backend, destroys product windows (`main.ts` `quiesceProductWindows`) and restarts the backend. |
| Self-host serving | Built Compose binds `${ANIMAMA_PARAKEET_MODEL_DIR}` into the web root (`/__client-parakeet-models`, no verification). The WebGPU encoder comes from `/v1/model-assets/<id>/content`. Development binds both directories into Vite. `reset.sh` disables STT when the base set is missing. |
| Capabilities | `runtime_capabilities.py` reports `offline_speech_enabled` from the startup flag and `offline_speech_asset_version` from env. The WebGPU version is not reported. |
| Renderer | `VoiceDownloads.tsx` (`OfflineSpeechDownload`, "Model changes briefly reload the app."), `ExperimentalSettings.tsx` (`ParakeetWebgpuDownload` pack, `ParakeetWebgpuAssetDownload` self-host, chosen at build time in `web/vite.config.ts`), `useDesktopFeaturePacks`, `query/model-download-coordination.ts`, `ChatInterface.tsx` (`DesktopFeaturePacksPanel only="parakeet-stt"`). `DesktopCredentialsPanel` blocks while `packs.busy`. |
| Setup | `routes/setup.tsx` is one form. `setup-draft.ts` keeps `{displayName, adultConfirmed}` in localStorage because pack changes replace the renderer. Setup sits outside `SettingsProvider`. `routes/-setup.test.ts` renders statically and has no step or submit coverage. |
| Models | `MODEL_SERVER_TABS` (six server tabs) and `modelApiTag` live in `ui/settings/models/model-configuration-state.ts`. Presets are a Python dict in `app/model_connection_presets.py`. The built-in `gpt-6-luna` exists as both Chat Completions and Responses rows. `hidden` is a global column the seed never sets. `KNOWN_PROVIDER_CREDENTIAL_ENVS` has OPENAI, DEEPSEEK and HF. Plan B app web search (SearXNG/Brave) is configured in `ui/settings/web-search/`. |
| Starters | `local_installation_bootstrap.py` creates starter Animas at startup, before setup, pinning the operator default (`OpenAIResponsesHTTPAgent:gpt-6-luna`) in `anima_chat_profiles.default_model_provider_id`. |
| Smoke | `desktop/scripts/runtime/smoke-macos.mjs` drives the single setup page: OpenAI key save with the PID unchanged, then name, 18+ and Continue to `/a`. It requires `offline_speech_enabled === false` on a fresh profile. |

### Boundaries

- `expanded-included-content` and `document-processing` keep their pack
  lifecycle, archive transport, signing and restart behavior. The
  pack/asset mutual exclusion stays for them.
- The development Compose stack keeps `scripts/models/parakeet.py`, the
  `reset.sh` host mounts and Vite serving (owner decision D4).
- The hosted composition gains no Models controls and no AI step model choice
  (R19). Shared code takes the existing `ModelCatalogPolicy` and
  `runtime-capabilities.model_configuration` inputs.
- The installation owner, admission rules, credential vault format and #227
  delivery contract are unchanged. Model-asset routes keep owner-only
  admission.
- No new API format (Open Responses and Anthropic Messages are deferred).
- The adult confirmation and safety link stay required (issue constraint).
- No Alembic revision. The ORM, `0001_baseline.sql` and generated seeds change
  directly.

## Progress

- [x] Plan: approved by the owner on 2026-10-01.
- [x] Phase 1: backend Parakeet sets — implemented, reviewed (round 1 pass, fixes applied).
- [x] Phase 2: desktop and self-host cutover, pack removal, speech download UI — implemented, reviewed (rounds 1–3; last docs fix verified at the limit). Manual built self-host check pending.
- [x] Phase 3: OpenRouter preset, model metadata and hidden built-ins — implemented, reviewed (rounds 1–2 pass).
- [x] Phase 4: App Settings → Models Cloud | Local and feature-local keys — implemented, reviewed (rounds 1–3; pass). Screenshots pending (G3).
- [x] Phase 5: stepped setup — implemented, reviewed (rounds 1–2 pass). Screenshots taken for G3.
- [x] Phase 6: documentation sweep and final integration review — docs integrated; final review round 1 findings fixed, round 2 pass; manual built self-host and packaged macOS agent passes recorded.
- [ ] Owner gates G1–G6 (see [Validation and acceptance](#validation-and-acceptance)).

## Surprises & Discoveries

- 2026-10-01: The WebGPU set has **3 files**, not seven. The issue's "seven-file
  set" applies to the base set only. Plan: each set is exactly its manifest's
  files.
- 2026-10-01: `docs/backend/operations/model-assets.md` and the shared-model-store
  plan state that Parakeet stays in Electron's pack manager. ADR 0012 supersedes
  that decision, and Phase 6 updates the doc.
- 2026-10-01: Parakeet packs are the only users of the `animama-model-pack/1`
  format (`feature-packs/catalog.ts` model sections, `model-files.ts`, parts of
  `manager.ts`, `release-models.mjs`, `size.mjs`, `model-publication.mjs`).
  `release-policy.mjs` pins the exact four-pack list. Removing the packs leaves
  that code dead, so Phase 2 removes it.
- 2026-10-01: Starter Animas are created at startup, before setup, and pin the
  operator default model. Setting the Chat default in setup alone would not
  change them (see D6).
- 2026-10-01: The pack removal check reports no renderer use for Parakeet; the
  backend has no "model in use" signal today. R5 needs a new lease (Phase 1).
- 2026-10-01: Built self-host serves the base set as unverified static files
  from the web root. Moving it to the asset store adds digest-verified,
  range-capable serving.
- 2026-10-01: `/setup` is outside `SettingsProvider`, and
  `PATCH /v1/users/me/settings` replaces the whole `preferences` object. Setup
  writes must read and merge first, or use a focused route.
- 2026-10-01: `origin/main` advanced from `70ba2c10` to `3eb23e45` (#215 Plan B,
  #228) during planning. The clean worktree was fast-forwarded before planning
  finished.

## Decision Log

Owner decisions (2026-10-01):

- **O1** (issue): move both Parakeet sets to the backend downloader on desktop
  and self-host. Keep the pack manager for the two deferred packs. Absorb #220.
- **O2** (answer): text-to-speech choice and the ElevenLabs key go **inline in
  the Voice step**. The AI step has the OpenAI key.
- **O3** (answer): the development stack **keeps the `reset.sh` host Parakeet
  mount**. Packaged desktop and built self-host use the asset store.
- **O4** (amendment): Cloud | Local in the AI step and App Settings → Models,
  with providers as listed. The app picks the API. API tags leave model rows.
  Built-in OpenAI Chat Completions rows are hidden by default. Keys live with
  their feature and also stay in API Keys. OpenRouter preset. No new API format.
  Hosted composition unchanged. This resolves the AI-step open question.
- **O5** (answer): the model set up in the AI step **becomes the default Chat
  role, and starter Animas follow it**. Animas the owner pinned are never
  rewritten.
- **O6** (answer): chips are **Tools · Context · Web search**, plus Vision when
  known. The Local tab shows size and quantization as secondary text when the
  server reports them.
- **O7** (answer): OpenRouter sends fixed `X-Title: Animama` and
  `HTTP-Referer: https://animama.ai`. The add-model picker filters to
  tool-calling models by default, with a toggle to show all.
- **O8** (answer): setup step order **Welcome → AI → Voice**.

Agent decisions (2026-10-01; the owner may change them at plan review):

- **D2 Set representation.** A catalog entry may carry `files: [{path, url,
  size, sha256}]` and a `manifest_sha256` instead of a single `url/size/sha256`.
  Single-file entries are unchanged. Sets live at
  `<data_root>/internal/model-assets/<id>/<manifest_sha256>/` and activate by
  one directory `os.replace` from staging, as `scripts/models/parakeet.py` does.
  New set ids: `parakeet-stt` and `parakeet-stt-webgpu`. The old
  `parakeet-tdt-0.6b-v2-webgpu-encoder` entry is removed, and startup deletes
  its stored file (development cutover; ADR 0012 records the re-download).
- **D3 Resume.** Staging for set files persists across retries and restarts
  (only orphaned single-file staging is swept). On retry the service rehashes
  the existing partial prefix and requests `Range: bytes=N-`. It accepts `206`
  only with a matching `Content-Range` and total size, and otherwise restarts
  the file from zero on `200`. Single-file assets gain the same path.
- **D4 Use leases.** Renderers that load a Parakeet set renew
  `POST /v1/model-assets/{id}:lease` (owner-admitted, TTL 30 s, renewed every
  10 s, released on unload). A registered removal guard refuses with
  `model_asset_in_use` while a lease is live. A dependency guard refuses
  removing `parakeet-stt` while `parakeet-stt-webgpu` is installed
  (`model_asset_required_by`). Leases are in memory, so a backend restart clears
  them safely.
- **D5 Serving and capabilities.** A `ModelMountSource` port resolves the
  current mount per request: from the asset store on packaged desktop and built
  self-host, and from operator env in development. `LocalAssets` keeps the
  `/onnx/models/<model-id>/` paths and `?v=<manifest_sha256>` pinning.
  `offline_speech_enabled` is the operator flag AND an installed base set.
  Capabilities add `offline_speech_gpu_asset_version`. The renderer invalidates
  runtime capabilities when an asset install or removal settles. Built
  self-host's web-root bind and `VITE_CLIENT_PARAKEET_MODEL_BASE_URL` are
  removed. Built clients use the FastAPI paths, and Vite dev keeps the operator
  paths.
- **D6 Starters follow the setup model.** `POST /v1/runtime/onboarding:complete`
  gains an optional `chat_model_provider_id`. In one transaction the backend
  validates that it is usable, stores it as `preferences.chat.default_model_provider_id`,
  and repins starter Animas whose model still equals the one they were created
  with. Before onboarding completes, no owner pin can exist, so this satisfies
  O5. Afterwards, Animas keep their own model, as App Settings already states.
  Repinning onboarded starters on every later default change is not proposed.
- **D7 Credential gate.** With Parakeet off packs, the `DesktopCredentialsPanel`
  `packs.busy` gate and the setup draft's "could not be retained" block are
  removed. The setup draft stays in localStorage (it now also holds the current
  step) because a failed key delivery can still fall back to a restart. The
  unsaved-key guard moves to step navigation: Continue and Back on a step with
  unsaved key edits prompt to save or discard.
- **D8 Web search chip.** "Built-in" when the model's requestable native tools
  include `web_search`; "App search" when the model supports tools and app web
  search is configured; otherwise no chip.
- **D9 OpenRouter model list.** A backend route reads OpenRouter's public
  `/api/v1/models` (fixed origin, response size and time bounded, no key) and
  returns `id, name, context_length, supported_parameters`. The renderer
  searches and filters it, and adding a model prefills capabilities (`tools`
  and `structured_outputs`), which the probe can override.
- **D10 Hidden built-ins.** The generated seed inserts `hidden = true` for
  built-in Chat Completions chat rows (embedding rows stay visible). Existing
  databases keep their state until reset, consistent with the
  development-reset policy. `modelOptionDetail`'s API suffix is removed from
  pickers, and the API appears only in the Info panel.
- **D11 Feature-local keys.** `DesktopCredentialsPanel` takes a `providers`
  filter. The OpenAI card, the Voice settings TTS group, the AI step and the
  Voice step render the filtered panel against the same vault state. API Keys
  keeps the full panel.

## Phased implementation

Phase issues (sub-issues of #221, created 2026-10-01): Phase 1 #229, Phase 2
#230, Phase 3 #231, Phase 4 #232, Phase 5 #233, Phase 6 #234. Plan commit
`afd52e18`. Commit subjects use `<type>(<scope>)[p#]: <summary>`.

### Phase 1: Backend Parakeet sets

Requirements: R2, R3, R4, R5 (backend part), and ADR 0012 accepted. Depends on
the approved plan.

Changes (`src/backend/animama`, `tests/`):

1. ADR 0012 status → accepted. ADR 0010 header gains
   `Status: accepted; items 2, 8 (Parakeet clause), 3 (built self-host) and 9
   (setup draft, GPU visibility) superseded by 0012`. Update the ADR index.
2. `domain/model_assets.py`: add set descriptors (D2), strict parsing, free
   space = remaining bytes + margin, and per-file progress aggregated to set
   progress.
3. `resources/model-assets.v1.json`: add `parakeet-stt` and
   `parakeet-stt-webgpu` derived from the manifests, and remove the encoder
   entry. Extend `tests/test_model_assets.py` so each set equals its manifest
   exactly (paths, sizes, digests and URLs), and record the license refs
   against `licenses/source-review.json`.
4. `adapters/model_assets/http_fetcher.py`: optional `start` offset, `206` and
   `Content-Range` validation, and a fallback to `200`.
5. `filesystem_store.py`: persistent per-set staging, prefix rehash, an atomic
   directory commit that removes previous digests, `is_installed` for sets
   (every file present with exact size), and removal of obsolete ids at startup.
6. `model_asset_service.py`: install, cancel and remove for sets, the lease
   registry and two removal guards (D4), and a `ModelMountSource` adapter (D5).
7. `server/model_assets.py`, `server/routers/model_assets.py`: the lease route
   and set fields in the schema (`files_total`, `files_verified` and an
   optional `version`).
8. `server/local_http.py`, `local/http/assets.py`: resolve mounts through the
   source per request. Setting `ANIMAMA_PARAKEET_SOURCE=asset-store|operator`
   is a composition input with default `asset-store` for packaged and built
   compositions; Compose development sets `operator`.
9. `server/routers/runtime_capabilities.py`: live values (D5).
10. Regenerate the SDK (`pnpm openapi-ts`, offline).

Tests first (TDD): resume (stub server with 206, 200 fallback, wrong
`Content-Range`, a digest mismatch after resume), "a partial set is never
installed" (kill mid-file and after N-1 files), atomic activation, capability
flip without a restart (install → `offline_speech_enabled` true, remove →
false), lease refusal and expiry, the CPU-blocked-by-GPU guard, serving 404
before install and 200/206 after with `?v` pinning, and operator source
unchanged.

Checks: `uv run pytest -q`, `uv run ruff check`, `make check-test`,
`make format-check`.
Completion: checks pass, review #1 has no unresolved blockers, and the phase
commit is recorded.

Results (2026-10-01), delegated implementation integrated and reviewed here:

- Catalog sets `parakeet-stt` (7 files) and `parakeet-stt-webgpu` (3 files,
  `requires: ["parakeet-stt"]`), `manifest_sha256` = SHA-256 of the manifest
  bytes (as `scripts/models/parakeet.py`), `license_ref` `CC-BY-4.0`. The
  encoder entry is removed and pruned at startup.
- Staging at `staging/model-assets/<id>/<version>/<path>` survives restarts and
  is rehashed on reopen; activation is one directory `os.replace`.
- Lease routes: `POST /v1/model-assets/{id}:lease` with `{lease_id}`
  (8–128 `[A-Za-z0-9_-]`) → `{asset_id, lease_id, ttl_seconds, expires_at}`;
  `DELETE /v1/model-assets/{id}/leases/{lease_id}` → 204, idempotent. Leasing
  an uninstalled asset → `409 model_asset_not_installed`. ≤ 32 leases per asset.
- Schema adds `files_total`, `files_verified`, `version`, `requires`;
  `media_type` is nullable (null for sets); `content_url` only for installed
  single files. Capabilities add `offline_speech_gpu_asset_version`.
- **Deviation (recorded per P1-R1-F2):** `ANIMAMA_PARAKEET_SOURCE` defaults to
  `operator` in every composition so the existing desktop mount JSON and
  development serving keep working until Phase 2, which sets `asset-store`
  for packaged desktop and built self-host. With `asset-store`, operator mount
  JSON is refused.
- Release scripts: `model-publication.mjs` `catalogFileReferences()` checks a
  set lists its manifest's complete inventory.
- Known interim break until Phase 2: the web client still requests the removed
  encoder id (P1-R1-F3).
- Checks (implementer, before review fixes): `timeout 1500 uv run --no-sync
  pytest -q` 3031 passed, 7 skipped; `make check-test` pass; `ruff check`,
  `make format-check`, import-boundary script pass; `pnpm desktop:test` 401
  passed; `pnpm check` and `pnpm openapi-ts:check` pass; affected web test
  files 52 passed. Not run in this phase: full `pnpm web:test`, `pnpm build`,
  Compose config checks.

#### Code Review #1 Findings

Reviewed the working tree against `afd52e18` (sdlc-reviewer, initial round).
Targeted backend suites 222 passed; ruff, format, import boundary,
`openapi-ts:check`, `pnpm check`, release-model desktop tests (36) pass.
Result: pass, no blockers.

- **P1-R1-F1 (minor):** `install()` ignored a requirement that is mid-removal,
  so a WebGPU install could start after the base set passed the dependency
  guard but before its directory was deleted.
- **P1-R1-F2 (minor):** the `operator` default for `ANIMAMA_PARAKEET_SOURCE`
  deviates from Phase 1 step 8 without a plan record.
- **P1-R1-F3 (minor until Phase 2):** built self-host's WebGPU download and
  `docs/frontend/runtime/voice.md` still use the removed encoder id.
- **P1-R1-F4 (nit):** untested paths: reinstall over an incomplete leftover
  version directory; dependency guard while the dependent downloads; cancel
  during commit.
- **P1-R1-F5 (nit):** small filesystem calls on the event loop; a cancel
  during prefix rehash leaves a staged file to GC.
- **P1-R1-F6 (nit):** tests import private helpers from another test module.

#### Code Review #1 Revisions

- **F1 accepted, fixed:** a requirement in `_removing` counts as missing. New
  test `test_a_dependent_cannot_start_while_its_requirement_is_being_removed`
  failed before the fix and passes after.
- **F2 accepted:** recorded above, and Phase 2 step 2 sets `asset-store`.
- **F3 accepted, deferred to Phase 2** (client asset ids, Vite config and
  voice docs) before the PR.
- **F4 partly accepted:** added
  `test_a_requirement_cannot_be_removed_while_its_dependent_downloads` and
  `test_reinstall_replaces_an_incomplete_leftover_version_directory` (both
  pass). Cancel during commit is not separately tested: commit runs in one
  blocking call that cancel cannot interrupt mid-rename.
- **F5 declined:** bounded `lstat` calls and one-time prune are acceptable at
  this scale; noted for future profiling.
- **F6 declined:** a nit; the helpers stay with the set tests they describe.
- Checks after fixes: set, asset and source suites 88 passed; `ruff check`
  and format check pass. Repair budget: a targeted round-2 recheck of F1 and
  F4 remains; one further round reserved.

#### Code Review #2 (targeted recheck)

Reviewed `4ec1d705` (sdlc-reviewer, repair round 1, shared with Phase 3).
Result: pass. P1-R1-F1 fix and F4 tests verified deterministic and exercising the claimed paths. The integrated SDK is current, no merge artifacts;
targeted suites 47 passed and the four regression tests passed five
consecutive runs. A later `make check-test` found mypy errors in the fix
(cache-key type annotation and a test helper type); both were corrected and
the chain rerun: `timeout 2400 make check-test` → 3066 passed, 7 skipped
(audit, format, ruff, mypy clean). One repair round remains.

### Phase 2: Desktop and self-host cutover

Requirements: R1, R5 (renderer), R6, R7, the #220 download UI items and the
pack-removal acceptance. Depends on Phase 1.

Changes:

1. Desktop main: remove Parakeet from `feature-pack-releases.json`,
   `source-manifest.json`, `size-budgets.json`, `feature-pack.schema.json`,
   `feature-packs.mjs`, `optional-inputs.mjs`, `feature-pack-build.ts`,
   `measure.mjs`, `release-policy.mjs` (pack list), `catalog.ts`
   `MODEL_PACK_IDS`, and `shared/desktop-runtime.ts` `featurePackIds/Requires`.
   Delete the model-pack-only code (`model-files.ts`, model sections of
   `catalog.ts`/`manager.ts`, `release-models.mjs`/`size.mjs` pack paths). Keep
   `download.ts`, `extract.ts`, `signature.ts`, `files.ts` and signing.
   `release-models.mjs`/`model-publication.mjs` publish Parakeet objects as
   asset-catalog consumers (the `parakeet-tdt-0.6b-v2` special case becomes a
   catalog reference).
2. `supervisor.ts`: drop the Parakeet env and mount JSON. The backend gets
   `ANIMAMA_PARAKEET_SOURCE=asset-store`, and built Compose sets the same
   (Phase 1 keeps `operator` as the default). Backend `domain/feature_packs.py` and
   `desktop_control.py` lose the Parakeet ids and versions.
3. Compose built: remove the web-root Parakeet bind and the Dockerfile base URL.
   `reset.sh` stops disabling STT for built mode (capabilities are live) but
   keeps development verification and mounts. Update
   `test_compose_network_boundaries.py`/`test_local_state_scripts.py`.
4. `web/vite.config.ts`: build mode uses the FastAPI `/onnx/models/...` paths
   for both sets (desktop and self-host). Serve mode keeps operator paths.
   Remove the `pack` encoder source and the old encoder asset id in
   `client-parakeet/assets.ts` and `docs/frontend/runtime/voice.md` (P1-R1-F3).
5. Renderer: one `OfflineSpeechDownloads` component on `useModelAssets` for
   desktop and built self-host: the "Offline speech recognition (Parakeet)"
   block with a CPU download that shows its size, and a nested "GPU
   acceleration" add-on that is always visible, says it requires the CPU model,
   and has a disabled action with a reason (base missing, no WebGPU adapter,
   unavailable in this build). Remove the "briefly reloads" copy, pack
   coordination for Parakeet, `ParakeetWebgpuDownload`, and the `ChatInterface`
   pack panel (it reuses the new component). The Parakeet client acquires and
   releases the use lease (D4) and invalidates capabilities on settle (D5).
   Remove the `DesktopCredentialsPanel` `packs.busy` gate (D7).
6. Tests: `VoiceDownloads.test.tsx` (CPU before, during and after install; GPU
   prerequisite, no-adapter and unavailable states; in-use removal message;
   CPU removal blocked by GPU), `ExperimentalSettings.test.tsx`,
   `model-download-coordination.test.ts`, desktop `feature-packs.test.ts`,
   `runtime-supervisor.test.ts`, `optional-inputs.test.mjs`,
   `release-models.test.mjs`, `runtime-packaging.test.mjs`. Delete
   `model-pack-*.test.ts`.

Checks: backend checks, `pnpm check`, `pnpm web:lint`, `pnpm web:test` (the
known flaky voice-clone compact picker test, #226, is noted, not a
regression), `pnpm build`, `pnpm desktop:check`, `pnpm desktop:test`,
`bash -n reset.sh`, and both `docker compose ... config --quiet` commands from
the root guide.
Manual: a built self-host stack (`./reset.sh --name pbd --base-port 8200` with
`ANIMAMA_WEB_BUILD_MODE=production`). Install the CPU set, interrupt the
download (stop the backend mid-download), restart and observe the resumed
byte count, dictate, then run offline with the network disabled. Repeat for
GPU on a WebGPU-capable browser. The packaged no-restart check is owner gate G1.
Completion: checks pass, review #1 has no unresolved blockers, the phase
commit is recorded, and no `parakeet` remains in pack artifacts
(`rg -n parakeet src/frontend/desktop/runtime`).

Results (2026-10-01), delegated implementation reviewed here:

- Desktop: Parakeet removed from the pack catalog, schema, release inputs,
  release policy (two packs), `shared/desktop-runtime.ts`, supervisor env;
  `featurePackRequires`, `model-files.ts` and model-pack tests deleted.
  Publication takes Parakeet objects only from the backend asset catalog.
  `active.json` drops unknown pack ids on read (previously startup failed with
  `pack_state_invalid`). Startup removes retired `parakeet-stt*` pack and
  download directories by exact id (agent decision; the plan's assumption that
  existing cleanup removed them was wrong — about 1.9 GB on affected machines).
- Backend: `ANIMAMA_PARAKEET_SOURCE` defaults to `asset-store`; development
  Compose sets `operator`. Mount JSON and Parakeet pack-version settings
  removed. `LocalAssets(web_root, *, mount_source=None)`.
- Compose/reset: built mode has no web-root Parakeet bind and never resolves
  host sets; development unchanged.
- Vite/client: one `__CLIENT_PARAKEET_MODELS__` define (`asset-store` in
  builds, `operator` in serve); `?v` pinning per set from capability versions.
  Lease helper `lib/speech/client-parakeet/lease.ts` (acquire before load,
  renew 10 s, stop after `model_asset_not_installed`/`not_found`, bounded
  release before removal); idle worker disposed before removal.
- Renderer: `OfflineSpeechDownloads` replaces pack and duplicate GPU blocks
  (`ExperimentalSettings.tsx` deleted; provider selection unchanged), used in
  Voice settings, setup and chat. Copy: "Offline speech recognition
  (Parakeet)"; GPU add-on "Requires the CPU model and a WebGPU-capable
  device."; reasons "GPU acceleration is unavailable in this build.", "WebGPU
  is not available in this browser or on this device.", "Download the CPU
  model first."; refusals "Speech recognition is in use. Close dictation and
  Voice Mode to remove it." and "Remove GPU acceleration first."; operator
  off: "Offline speech recognition is turned off on this server."; Vite dev
  shows acquire commands. `packs.busy` credential gate removed.
- Licensing (agent decision): Parakeet notices stay in the packaged app's
  licence bundle (`desktop/runtime/notices`, `license-sources.json` groups
  "Downloadable Parakeet speech model (CPU)" / "(GPU acceleration)"), with
  app-shipped wording updated. **Known limitation:** the built self-host image
  ships no third-party licence bundle, so the onnx-asr MIT text is not
  available there (also true before this change); each installed set carries
  its README and CC BY attribution. Published `models/*/ATTRIBUTION.md` still
  says "desktop feature pack"; changing it needs a republish (not done).
- `rg -n parakeet src/frontend/desktop/runtime` matches only
  `license-sources.json` and the two app-shipped attribution notices.
- Surprise: Phase 1 had broken three browser fixtures (missing
  `files_total`/`files_verified`), which is why the #226 voice-clone test was
  failing; fixed here.
- Checks after round-1 fixes: `timeout 2400 make check-test` 3070 passed, 7
  skipped; `pnpm check`, `pnpm web:lint`, `pnpm desktop:check` pass;
  `pnpm web:test` 359 files / 2359 tests, browser 3/3, 4/4, 16/16; `pnpm build`
  pass; `pnpm desktop:test` 22 files / 377 tests; `bash -n reset.sh` and both
  compose config commands pass; prettier/ruff format clean on changed files.
- Manual built self-host resume/offline check: pending (see Validation).

#### Code Review #1 Findings

Reviewed the working tree against `70498f6a` (sdlc-reviewer, initial).
Targeted backend 278 passed, web 183 passed, desktop 376 passed.

- **P2-R1-F1 (blocking):** the `operator` default made built compositions
  outside Compose (image `docker run`, native launcher) report offline speech
  that nothing served.
- **P2-R1-F2 (minor):** lease release raced the removal request.
- **P2-R1-F3 (minor):** removed settings still documented.
- **P2-R1-F4 (minor):** test-only `LocalAssets` mount params, stale docstring,
  unreachable `unavailable_in_build`.
- **P2-R1-F5 (minor):** built `reset.sh` still verified an unused host set.
- **P2-R1-F6 (minor):** client lease wiring, idle disposal and capability
  refetch untested.
- **P2-R1-F7 (nit):** refused leases renewed forever.
- **P2-R1-F8 (nit):** no dev GPU guidance; no explanation when the operator
  disables offline speech.

#### Code Review #1 Revisions

All accepted and fixed (details in Results): F1 default `asset-store` with
`test_built_composition_defaults_to_the_asset_store` (red before the fix);
F2 bounded release await (`LEASE_RELEASE_WAIT_MS`, tested); F3 docs; F4
cleanup; F5 `test_built_reset_never_resolves_host_parakeet_sets`; F6 new
`client.test.ts` (7 tests) and a browser test for capability refetch (a node
unit test is not possible with static rendering); F7 tested; F8 copy above.

#### Code Review #2 (targeted recheck)

Reviewed the working tree (repair round 1). F1–F8 and both decisions verified.
**P2-R2-F1 (blocking, docs):** `http-api.md` and `model-assets.md` still
stated `operator` as the default and described Parakeet packs. Non-blocking: a
renewal in flight could re-create a lease after release; `.env.example`
implied a Compose-ignored setting.

Revisions: docs corrected; `.env.example` comment states Compose fixes the
value; `lease.release()` now waits for the in-flight renewal (new test, red
before the fix). Client-parakeet vitest 47 passed; `pnpm check`, `pnpm
web:lint` pass.

#### Code Review #3 (targeted recheck)

Reviewed the working tree (repair round 2 of 2). Lease fix and the two docs
passages verified. **P2-R3-F1 (blocking, docs):** two older lines in
`model-assets.md` still named a Parakeet desktop pack.

Revision at the repair limit: both lines corrected by the implementing agent
and verified by `grep` (no remaining Parakeet pack statements in the two
files); no further review round remains, so the final integration review
covers it.

### Phase 3: OpenRouter preset, model metadata and hidden built-ins

Requirements: R14, R16 (backend), R19 (backend). Independent of Phases 1–2.

Changes (`src/backend/animama`, `tests/`, compose):

1. `app/model_connection_presets.py`: an `openrouter` preset (cloud,
   `https://openrouter.ai/api/v1`, suggested `OPENROUTER_API_KEY`, Chat
   Completions compatibility), plus a preset `request_headers` field applied by
   `connection_sdk.py` for that preset only (O7).
2. `credential_store.py`: add `OPENROUTER_API_KEY` to
   `KNOWN_PROVIDER_CREDENTIAL_ENVS`. Update the env-name error message in
   `model_configuration_service.py` and the compose pass-through.
3. The OpenRouter model-list route (D9), owner-only, local composition only.
4. Generated seed and `0001_baseline.sql`: hidden built-in Chat Completions
   chat rows (D10). Update `tests/test_model_provider_catalog.py`.
5. Catalog schema: expose `structured_output_transport` where the chips need it
   (only if required by D8).

Tests: preset listing, headers sent only for OpenRouter (respx), the key
allowlist accepting `OPENROUTER_API_KEY`, the model-list parsing, bounds and
failure mapping, a stubbed end-to-end OpenRouter chat turn through Chat
Completions, the hidden seed default with in-use visibility preserved, and
hosted policy routes absent.
Checks: backend checks plus `pnpm openapi-ts` regeneration.

Results (2026-10-01): implemented in an isolated worktree from `afd52e18` on
local branch `feat/p3-openrouter`, commits `c208bc78` (phase) and `aad32460`
(review fix), integrated onto the plan branch after Phase 1.

- Preset `openrouter` with a `request_headers` field applied in
  `connection_sdk.py` after the omitted-header logic; `OPENROUTER_API_KEY`
  allowlisted; compose pass-through.
- `GET /v1/model-connection-presets/openrouter/models` returns `{models: [...]}`
  (fixed URL, no key, no redirects, 10 s, 8 MiB, ≤ 2000 models, 10-minute cache
  of successes only; upstream failures → `502 openrouter_models_unavailable`).
- Built-in `OpenAIHTTPAgent` chat rows are seeded `hidden` (insert-only).
  `0001_baseline.sql` needed no change; seeds live in `alembic/seeds`.
- Step 5 skipped: model-connection rows already expose
  `structured_output_transport`.
- Implementer checks: `make check-test` 3014 passed, 7 skipped; `ruff check`,
  `make format-check`, import-boundary script, `pnpm check`,
  `pnpm openapi-ts:check` pass.
- Phase 4 notes: no `openrouter` provider logo yet; frontend tabs do not list
  the preset until Phase 4.

#### Code Review #1 Findings

Reviewed `c208bc78` against `afd52e18` (sdlc-reviewer, initial round). Targeted
tests 96 passed; ruff, format, import boundary and `openapi-ts:check` pass.
Result: pass, no blockers.

- **P3-R1-F1 (minor):** the Chat Completions client cache key
  `(connection.id, base_url, timeout)` omits the preset, so after a preset
  change a cached client keeps sending (or omitting) the attribution headers
  until restart.
- **P3-R1-F2 (nit):** function-local import in `builtin_hidden_by_default`
  without an explanation.
- **P3-R1-F3 (nit):** OpenRouter preset sets the default `reasoning_mode`
  explicitly.

#### Code Review #1 Revisions

- **F1 accepted, fixed** in `aad32460`: the cache key includes
  `connection.preset`. New test
  `test_changing_a_connection_preset_rebuilds_its_cached_client` failed before
  the fix and passes after. Targeted suites (OpenRouter, live credentials,
  model client registry, catalog) 95 passed; ruff and format pass.
- **F2 accepted, comment only:** moving the import to module level causes a
  circular import (verified: collection fails), so the import stays local with
  a comment.
- **F3 declined:** the explicit value documents intent; no behavior impact.
- Repair budget: one targeted recheck (round 2) of F1/F2 remains to run with
  the integrated branch; one further round reserved.

#### Code Review #2 (targeted recheck)

Reviewed `4ec1d705` (sdlc-reviewer, repair round 1, shared with Phase 1).
Result: pass. P3-R1-F1 fix verified (same id/base URL/timeout, preset-only change); F2 circular import confirmed. The integrated SDK is current, no merge artifacts;
targeted suites 47 passed and the four regression tests passed five
consecutive runs. A later `make check-test` found mypy errors in the fix
(cache-key type annotation and a test helper type); both were corrected and
the chain rerun: `timeout 2400 make check-test` → 3066 passed, 7 skipped
(audit, format, ruff, mypy clean). One repair round remains.

### Phase 4: App Settings → Models Cloud | Local and feature-local keys

Requirements: R12, R13, R15, R16 (UI), the API-switch copy (scope 13) and R19
(UI). Depends on Phase 3.

Changes (`src/frontend/web/src/ui/settings/models/`, `DesktopCredentialsPanel`,
`ApplicationSettingsModal.tsx`, `ChatInterface.tsx`):

1. Replace `MODEL_SERVER_TABS` with `MODEL_LOCATION_TABS` (cloud: openai,
   deepseek, huggingface, openrouter, custom-cloud; local: ollama, lmstudio,
   llamacpp, vllm, custom-local). Connected providers render first as cards
   with status ("Key set", "Key missing", "Running at …", "Not reachable") and
   models. "Add …" entries reuse `ModelConnectionForm`, Detect and probe.
   OpenAI shows a Recommended tag and a key field (D11).
2. Model rows: remove `modelApiTag`. Add chips (O6, D8). Info panel and
   `OwnerModelDialog` show "API: Responses" or "API: Chat Completions".
3. The OpenRouter add-model picker: search, a "Tool calling only" toggle on by
   default, and capability prefill (D9).
4. Voice → Text-to-Speech shows the ElevenLabs key next to the provider (D11).
5. API-switch dialog copy in user terms ("continues in a new chat"), and the
   matching quick-chat toast.
6. Tests: `model-configuration-state.test.ts` (tabs, connected-first order,
   chips, no API tag), new component tests for the location tabs, OpenAI card
   key sync with API Keys, the OpenRouter picker filter and search, and the
   hosted composition hiding the section. `DesktopCredentialsPanel.test.tsx`
   covers the provider filter.

Checks: frontend checks. Browser check against the dev stack at desktop and
narrow widths, with screenshots saved for G3.

Results (2026-10-01): implemented in an isolated worktree from `aad32460` on
local branch `feat/p4-models-ui`: `cd03c6d2` (phase), `547d24ef` (round-1
fixes), `16ab9787` (round-2 fix); integrated onto the plan branch after Phase 2.

- Cloud | Local tabs; custom connections classified by base URL (loopback,
  RFC1918/link-local/ULA, `.local`, single-label hosts, `.lan`, `.home.arpa`,
  `.internal`, `*.ts.net`, 100.64.0.0/10 → Local; otherwise Cloud). Connected
  cards first, then "Add a provider"; after saving, the tab switches to the
  connection's tab.
- Local card status via `useConnectionReachability` (existing available-models
  route, 30 s stale, no retry, no refetch on focus).
- Key status shared through the TanStack Query cache (`desktopCredentials`
  keys, status only); `DesktopCredentialsPanel` gains `providers` and
  `description` props; OpenAI card and Voice → ElevenLabs reuse it.
- Chips Tools · Context · Built-in search / App search (via
  `webSearchAvailability`; App search requires configured app search) ·
  Vision; embeddings show "Embeddings". Info panel names the API; pickers do
  not. Visible same-name rows on one connection: the non-Responses row gets
  " (alternate)" (agent decision for P4-R1-F1; owner may revise at G3).
- Hidden rows behind "Show N hidden models" with per-row Show.
- OpenRouter picker: search, "Tool calling only" on by default, prefill, 502
  fallback to manual entry.
- API-switch copy: "{model} keeps conversations differently, so this chat
  continues in a new chat." Quick-chat toast equivalent.
- Not delivered: Local size/quantization (the listing returns only ids; O6
  applies "when the server reports them"); OpenRouter logo (letter fallback).
- Checks after round-1 fixes: `pnpm check`, `pnpm web:lint` exit 0;
  `pnpm web:test` 360 files / 2415 tests, node 3/3, 4/4, browser 14/14 pass;
  `pnpm build` pass; prettier on changed files clean. Screenshots (G3) not yet
  taken.

#### Code Review #1 Findings

Reviewed `cd03c6d2` against `aad32460` (sdlc-reviewer, initial). Targeted
vitest 129 passed; check and lint pass. Result: pass, no blockers.

- **P4-R1-F1 (medium):** unhidden duplicate built-in rows look identical in
  pickers and Default models.
- **P4-R1-F2 (low):** single-label, `.lan`, `.home.arpa`, `.internal` and
  Tailscale hosts classified as Cloud.
- **P4-R1-F3 (low):** web search chip duplicates `webSearchAvailability`.
- **P4-R1-F4 (low):** reachability refetches on every window focus.
- **P4-R1-F5 (minor):** per-card `role="status"` and per-keystroke picker
  announcements.
- **P4-R1-F6 (minor):** docs overstated that only the Info panel names the API.
- **P4-R1-F7 (minor):** chat picker search value included the provider row id.
- Test gaps noted (SSR-only component tests; interactions untested).

#### Code Review #1 Revisions

All seven accepted and fixed in `547d24ef` (details in Results). Test gaps
partly addressed with pure-helper tests; interaction tests need a DOM test
environment the web package does not have (declined for this plan).

#### Code Review #2 (targeted recheck)

Reviewed `547d24ef` (repair round 1). F1–F7 verified. **P4-R2-F1 (blocking):**
the picker's live region used `empty:hidden`, removing it from the
accessibility tree, so a later "No models match" might not be announced.

Revision: fixed in `16ab9787` (`sr-only` while empty), with a test that failed
before the fix; models vitest 68 passed, check and lint pass.

#### Code Review #3 (targeted recheck)

Reviewed `16ab9787` (repair round 2 of 2). Result: pass, no findings.

### Phase 5: Stepped setup

Requirements: R8–R11, R17, R18, the Welcome step's adult confirmation, and the
setup copy. Depends on Phases 2 and 4.

Changes:

1. `routes/setup.tsx`: split into `SetupWelcomeStep`, `SetupAiStep` and
   `SetupVoiceStep` with a progress indicator ("Step 2 of 3", `aria-current`),
   Back/Continue, focus on each step heading, and `role="status"` for status
   text. Only Welcome gates on name and 18+. AI and Voice offer "Skip for now".
   Downloads keep running across steps and after finishing.
2. AI step: Cloud | Local. Cloud has "Use OpenAI (Recommended)" with the key
   field, which completes the step, plus other cloud providers through the
   shared form. Local detects Ollama, LM Studio and llama.cpp and picks a
   model; with nothing found it shows one install-guidance line and "Set up
   later". The chosen model is sent with onboarding completion (D6). The
   hosted composition never reaches this step.
3. Voice step: the Phase 2 Parakeet block, and Text-to-Speech on/off, provider
   (built-in voices or ElevenLabs) and the ElevenLabs key (O2). TTS
   preferences are written by read-merge-write of user settings at Finish.
4. Backend (D6): extend onboarding completion, with tests for default
   assignment, starter repinning, a pinned starter left unchanged, and an
   invalid or unusable model refused.
5. `setup-draft.ts`: holds the step and nonsecret values. Remove the
   draft-unavailable block and the download gates (D7). The unsaved-key guard
   applies to step navigation.
6. Copy: one sentence of purpose per section, with details behind
   disclosures, consistent with App Settings.
7. `smoke-macos.mjs` and `smoke-policy.mjs`: Welcome → AI (key save, PID
   unchanged, "Saved.") → Voice → Finish → `/a`. Keep the fresh-profile
   `offline_speech_enabled === false` check.
8. Tests: `routes/-setup.test.ts` becomes interactive (step navigation,
   per-step gating, Back keeps values, skip paths, the unsaved-key prompt, and
   submit payload with and without a model).

Checks: all frontend and backend checks plus `pnpm desktop:test`. Browser check
of setup on a fresh dev stack at desktop and narrow widths, with screenshots
for G3.

Results (2026-10-01), delegated implementation reviewed here:

- Setup: Welcome ("What should Animama call you?", unchanged 18+ copy,
  decline path and safety link) → AI ("Choose your AI") → Voice ("Set up
  voice"), "Step N of 3" with a step list (`aria-current="step"`), focus to
  each step's `h1`, Back/Continue, "Skip for now" on AI and Voice, Finish.
  Components live in `web/src/app/local-runtime/setup/` (the runtime
  boundary forbids `src/ui` importing local-runtime).
- AI step: Cloud (OpenAI card with key on desktop, server-key copy on
  self-host; "Use another cloud provider" uses the shared connect form and
  `OwnerModelDialog`, with the OpenRouter picker) | Local (detect Ollama,
  LM Studio, llama.cpp; add a model; "No local server found. Install and
  start Ollama, LM Studio or llama.cpp, then search again." and "Set up
  later"). One "Model for new Animas" choice; the model is sent only after
  an explicit choice in this session. Hosted shows no model choice.
- Unsaved-key prompt (Keep editing / Discard / Save key) covers the OpenAI
  and ElevenLabs panels and the inline connect form; Finish waits for saves.
- Voice step: offline speech block; Text-to-Speech on/off, "Built-in voices"
  or ElevenLabs, ElevenLabs key inline on desktop; preferences written by
  fresh read-merge-write at Finish. Voice cloning left setup.
- Backend (D6): onboarding accepts optional `chat_model_provider_id`
  (whitespace-only → 422). In the onboarding transaction it validates the
  model like new-Anima creation, merges `preferences.chat.default_model_provider_id`
  under a `user_settings` row lock, and repins starters whose receipt is
  `ready` and whose model still equals the operator default
  (`ANIMAMA_DEFAULT_MODEL_PROVIDER_ID`, what bootstrap uses), marking
  `metadata.source = "onboarding_chat_model"`. Unusable → `422
  chat_model_unavailable`, nothing applied; replay applies nothing. Settings
  and model queries are invalidated after success.
- Draft holds step, name, adult confirmation, Cloud/Local, chosen model and
  TTS choices; never keys.
- Smoke: `smoke-macos.mjs` follows Welcome → AI (key save, "Saved.", PID
  unchanged) → Voice → Finish → `/a`; `smoke-policy.mjs` adds `setup_steps`.
- Deviation: self-host ElevenLabs copy is one line ("Uses the ElevenLabs key
  set on this server (ELEVENLABS_API_KEY).") because the browser has no signal
  for whether the server key exists.
- Checks after round-1 fixes: `make check-test` 3082 passed, 7 skipped;
  `make format-check`, `pnpm check`, `pnpm web:lint`, `pnpm desktop:check`,
  `pnpm build` pass; `pnpm web:test` 361 files / 2422 tests, node 3/3, 4/4,
  browser 25/25 (setup 15); `pnpm desktop:test` 377; prettier clean on
  changed files.
- Browser evidence: development stack `animama-p5`
  (`http://animama-p5.localhost:8300`); 10 screenshots (desktop 1440×900 and
  narrow 390×844 for each step and AI sub-view) kept outside the repository
  for owner review (G3). Desktop key panels and the prompt need Electron to
  capture.

#### Code Review #1 Findings

Reviewed the working tree against `aa12e975` (sdlc-reviewer, initial).
Targeted backend 75 passed, web 176 passed; a scratch browser probe
reproduced F1.

- **P5-R1-F1 (blocking):** a key typed into the inline other-cloud connect
  form was discarded on Continue/Back/Skip without a prompt, and its save
  was not counted as busy.
- Non-blocking: settings cache not refreshed after onboarding; an already
  configured OpenAI key auto-pinned a Chat preference; whitespace-only model
  id treated as omitted; no `user_settings` row lock; self-host copy named
  environment variables at length (owner-facing copy note added by the
  implementing agent).

#### Code Review #1 Revisions

All accepted and fixed (details in Results): connect form reports a dirty key
and exposes `{save, discard}`; new browser test (red before the fix);
query invalidation; explicit-choice rule with a browser test; schema strip →
422 with a parametrized test; row lock; shorter server-key copy.

#### Code Review #2 (targeted recheck)

Reviewed the working tree (repair round 1). Result: pass, no blockers.
Verified the form refactor keeps App Settings behaviour, the explicit-choice
detection cannot misfire on load or refetch, invalidation, 422 and copy.
Targeted backend 11 passed, web 113 passed, setup browser tests 15/15.
Non-blocking: **P5-R2-F1** a prompt Save on an incomplete connect form failed
silently; **P5-R2-F2** the row-lock comment overstated protection against
unlocked settings saves.

Revisions: F1 fixed with an error ("Your key wasn't saved. Complete the
details on this step, or discard the key.") and a browser test that failed
before the fix; F2 comment corrected. Setup browser tests 16/16; `pnpm
check`, `pnpm web:lint`, ruff pass. One repair round remains unused.

### Phase 6: Documentation and final integration

Docs: `docs/frontend/desktop/feature-packs.md`, `runtime-staging.md`,
`releases.md`, `overview.md`, `installation.md`, `release-process.md`,
`redistribution-review.md`, `troubleshooting.md`, `src/frontend/desktop/README.md`,
`docs/frontend/runtime/voice.md`, `docs/backend/operations/model-assets.md`,
`docs/backend/operations/desktop-runtime.md`,
`docs/frontend/architecture/auth-server.md`,
`docs/frontend/features/model-settings.md`, `docs/backend/model-catalog.md`
(OpenRouter), `docs/backend/operations/local-models.md`, and the chat docs for
the switch dialog. Add or correct glossary entries ("feature pack" scope,
"model asset set") if they become misleading.

Then: final independent integration review, the full local check suite, the
packaged macOS build from the worktree with the real profile moved aside and
restored (or with the owner's go-ahead), and the PR via the template.

Results (2026-10-01):

- Docs sweep (delegated in an isolated worktree from `aa12e975`, integrated as
  `9c3c763f`): 21 files, including feature packs (new "Speech model
  downloads" section), troubleshooting, runtime staging, releases, release
  process, redistribution review, overview, platforms, keyboard shortcuts,
  desktop README, `src/frontend/AGENTS.md`, voice, chat (switch dialog),
  auth-server, content-and-workers, local HTTP components, desktop runtime,
  development, model assets, GLOSSARY ("Feature pack" narrowed, "Model asset"
  added) and the licence table wording. ADR 0010 untouched; ADR 0012 matches
  the code.
- Installation and setup docs (`bcd8d210`): three setup steps, keys by
  feature, offline speech CPU model, storage and offline wording.
- Final-review fixes (`be3719e5`): built-in chat models always use Responses
  (the add-model API select is removed, per amendment decision 2); App
  Settings server-key copy shortened; lease sentence scoped to Parakeet;
  `.env.example` comment corrected; one test file formatted.
- Full local suite on `bcd8d210`: `make check-test` 3082 passed, 7 skipped
  (audit, format, ruff, mypy clean); `bash -n reset.sh` and both compose
  config commands pass; `pnpm check`, `pnpm web:lint`, `pnpm build`,
  `pnpm desktop:check`, `pnpm openapi-ts:check` pass; `pnpm web:test` 361
  files / 2422 tests, node 3/3 and 4/4, browser 26/26 (the #226 voice-clone
  test passes); `pnpm desktop:test` 22 files / 377 tests. After `be3719e5`:
  models vitest 68 passed, client-parakeet 47, `pnpm check` and
  `pnpm web:lint` pass.
- Manual built self-host check (FI-R1-F1), task stack `animama-p5` restarted
  in production mode (`ANIMAMA_WEB_BUILD_MODE=production ./reset.sh --name
  p5 --base-port 8300`):
  - Setup Voice step: CPU "631 MB download"; GPU add-on disabled with
    "Download the CPU model first."
  - CPU set downloaded from `downloads.animama.ai`; the backend container was
    restarted at 271 MB staged; staging survived; the next install resumed at
    269,381,145 bytes (not zero) and completed (`version` = manifest digest).
  - Without a backend restart, capabilities reported `offline_speech_enabled:
    true` and the digest; `HEAD /onnx/models/parakeet-tdt-0.6b-v2/vocab.txt?v=…`
    → 200 `private, max-age=31536000, immutable`; a ranged encoder request →
    206.
  - GPU set started from the UI; backend restarted at 328 MB staged; the UI
    showed "Retry download"; Retry resumed at 322,772,597 bytes and
    completed.
  - Guards: `DELETE parakeet-stt` with GPU installed → 409
    `model_asset_required_by`; with a live lease, `DELETE parakeet-stt-webgpu`
    → 409 `model_asset_in_use`; after release, removal succeeded and the GPU
    version left capabilities live.
  - UI removal of the CPU model (two-step confirm) → not installed,
    `offline_speech_enabled: false`, serving 404.
  - The backend container start time stayed `18:42:32Z` with 0 restarts
    across GPU completion, GPU removal and CPU removal (only the two
    deliberate interruption restarts occurred).
  - Not exercised: dictation with real audio (no microphone in the agent
    browser) — owner gate G6. UI notes: the first frame after Retry shows
    "Downloading 0%" until the first poll; a state changed outside the page
    appears after a reload.
- App Settings → Models screenshot on the built stack captured for G3.
- Agent-run packaged macOS pass (2026-10-01) on the unsigned development app
  built from `be3719e5` (`pnpm desktop:mac:build`), fresh profile; the
  owner's profile was moved aside and restored, and fake keys only were used.
  Driven with a Playwright Electron script modelled on `smoke-macos.mjs`
  (which needs a signed DMG). All 10 checks passed; the FastAPI PID stayed the
  same and no window reloaded throughout:
  - Welcome gating, 18+ checkbox and safety link; AI step Cloud | Local with
    OpenAI Recommended; fake-key save showed "Saved." in 61 ms; Local showed
    the no-server guidance with "Set up later".
  - Voice step: CPU 631 MB, GPU disabled with "Download the CPU model first.";
    CPU download about 30 s to Installed (7/7 files), capabilities turned on
    live; Finish reached Annie's chat with first run complete.
  - App Settings → Voice: GPU set installed (1.24 GB, about 48 s); CPU
    removal disabled with "Remove GPU acceleration first."; GPU and CPU
    removals in about 50 ms each, capabilities updated live; a cancelled CPU
    download returned to not installed with no partial files.
  - App Settings → Models: Cloud | Local tabs, OpenAI "Key set", chips and
    "Show 1 hidden model"; Local lists Ollama, LM Studio, llama.cpp, vLLM and
    Custom.
  - No fake-key value in any of 1,934 test-profile files or diagnostic
    reports.
  - Not covered: microphone dictation and network-off use (G6), forced
    network failure for resume (covered on built self-host above), a detected
    local server, real provider keys (G2, G4), narrow-width screenshots.
  - 18 screenshots kept outside the repository for G3.

## Final integration review

### Final Review #1 Findings

Reviewed `bcd8d210` against `3eb23e45` (sdlc-reviewer, initial). Cross-phase
seams, hosted composition, companion safety, ADRs, glossary and leftovers
verified; SDK current; ruff clean. Result: blocking evidence gap only.

- **FI-R1-F1 (blocking, evidence):** the planned manual built self-host check
  was pending and not covered by an owner gate.
- **FI-R1-F2 (minor):** the built-in add-model form still offered an API
  select, against amendment decision 2.
- **FI-R1-F3 (minor):** Phase 6 record missing; stale "proposed" ADR line.
- **FI-R1-F4 (nit):** `webgpu.test.ts` not Prettier-formatted.
- **FI-R1-F5 (nit):** lease docs sentence too broad; stale `.env.example`
  comment.

### Final Review #1 Revisions

- F1: manual built self-host check run (Phase 6 Results); real-audio
  dictation added as owner gate G6.
- F2, F4, F5: fixed in `be3719e5`.
- F3: Phase 6 record added; ADR line corrected.

### Final Review #2 (targeted recheck)

Reviewed `be3719e5` (repair round 1). Result: pass. F2, F4, F5 and the copy
change verified; models vitest 68 passed; `pnpm check` and Prettier pass.
Non-blocking: `model-settings.md` still described the old card wording
(corrected); no component test asserts that a new built-in model is saved as
Responses (the draft default and save body were verified by reading; the web
package has no DOM test environment for that dialog). One repair round
remains unused.

## Validation and acceptance

Commands (from the root guide), run per phase as applicable and in full before
the PR:

```bash
uv run pytest -q
uv run ruff check
make check-test
make format-check
bash -n reset.sh
```

From `src/frontend`: `pnpm check`, `pnpm web:lint`, `pnpm web:test`,
`pnpm build`, `pnpm desktop:check`, `pnpm desktop:test`. Compose config
validation follows the root guide. No hosted CI runs on PRs, so local evidence
is the only evidence. The PR states every check run and not run.

Acceptance maps to the issue's checklist. Owner gates (not phases):

- **G1** Fresh packaged macOS profile: setup shows Welcome, AI and Voice.
  Completing only the required fields reaches the app. The AI step completes
  through OpenAI, through a detected local server and by skipping. A CPU and a
  GPU install, cancel, retry and removal complete without a backend PID change
  or window reload. Dictation works after install and with the network off.
- **G2** Live OpenRouter chat with the owner's key (the owner enters it).
- **G3** Owner review of setup, speech download and Models copy, with
  screenshots at desktop and narrow widths.
- **G4** Live ElevenLabs key edit from Voice, reflected in API Keys (the owner
  enters it).
- **G5** Exact-candidate merge approval.
- **G6** Dictation with real audio after install and with the network off,
  on built self-host and packaged desktop (agents cannot drive a microphone).

## Idempotence and recovery

- Set installs are restartable. Partial files stay in staging and resume.
  A corrupted partial fails its digest and restarts that file. Activation is one
  directory rename, so a crash leaves either the old state or the new state.
- Removing an obsolete encoder entry is idempotent. Models are re-downloadable
  and user data is untouched.
- The seed change affects only fresh or reset databases. Existing visibility is
  preserved.
- Onboarding completion with a model is one transaction. A retry after success
  is refused by the existing first-run check, so nothing is applied twice.
- Pack removal is a development cutover. Startup drops retired ids from
  `active.json` and deletes the retired Parakeet pack and download directories
  by exact id; a failure is logged and never blocks startup.

## Outcomes & Retrospective

Delivered (candidate on `feat/parakeet-backend-downloader`):

- Parakeet base and WebGPU sets install, resume, cancel and uninstall in
  place through the backend model-asset service on packaged desktop and built
  self-host, with live capabilities, use leases and the base-required-by-GPU
  guard. The Parakeet feature packs and the model-pack format are gone; the
  two deferred packs are unchanged. ADR 0012 records the decision.
- Setup is Welcome → AI → Voice, with Cloud | Local model setup, keys by
  feature, offline speech and Text-to-Speech in Voice; the chosen model
  becomes the Chat default and the starter Animas follow it.
- App Settings → Models is organized by Cloud | Local with capability chips,
  an OpenRouter preset and picker, hidden built-in Chat Completions rows and
  the OpenAI key on its card.

Remaining: owner gates G1 (packaged acceptance on a fresh profile, partly
pre-checked by the agent pass), G2, G3 (copy and screenshots, including the
agent decisions on " (alternate)" and the server-key wording), G4, G5 and G6.
Recorded limitations: no Local size/quantization (listings return ids only),
no OpenRouter logo, the built self-host image ships no third-party licence
bundle, and the published WebGPU `ATTRIBUTION.md` still mentions a desktop
feature pack (changing it needs a republish).

Lessons: parallel phase work in isolated worktrees saved time but needed SDK
regeneration and one conflict resolution on integration; fixtures that omit
newly required schema fields can silently disable browser tests (the #226
symptom), so schema changes should be followed by the browser suites, not just
unit tests.
