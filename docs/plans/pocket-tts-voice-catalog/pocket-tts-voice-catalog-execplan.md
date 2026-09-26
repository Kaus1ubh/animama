# PocketTTS voice catalog with a grouped selector

Source agreement: [pocket-tts-voice-catalog-spec.md](pocket-tts-voice-catalog-spec.md),
Agreed 2026-09-26 (owner requested this plan after reviewing the draft). The
spec's requirement IDs (R1–R25) are authoritative; this plan does not redefine
them. Source issue:
[raymond-van/animama#142](https://github.com/raymond-van/animama/issues/142).
Authorized scope: the whole plan (owner invoked implementation on 2026-09-26).
Work stops at the explicit gates G1, G2 and G3.

Workspace: branch `feat/pocket-tts-voice-catalog` in its own worktree, from
baseline `410425e`. `origin/main` has since gained only unrelated desktop-smoke
fixes (`b633af1`).

## Purpose and context

After this work:

- PocketTTS ships a curated core set of about 15–20 voices.
- A curated catalog of about 40–50 more voices can be sampled and downloaded
  one at a time.
- The Anima settings selector groups voices by gender, marks recommended voices,
  shows accent tags and separates installed voices from downloadable ones.
- Optional voices download through a new backend-owned asset downloader. Later
  work can reuse it for the Parakeet models, the PocketTTS models and #144.

Working directory is the repository root unless stated. Baseline: `410425e`
(`main`, 2026-09-26).

### Orientation

Line numbers are at the baseline.

| Area | Files and facts |
| --- | --- |
| Core acquisition | `scripts/models/browser_speech.py`: `POCKET_VOICE_LICENSES` 41-46, `expected_source()` 53-71 (hard-coded Hugging Face repo, revision and path), exact 13-file check at 95, three hash-bound notices 49-50. Downloads go through `scripts/models/parakeet.py` (`DOWNLOAD_HOSTS` 44-51 is a Hugging Face allowlist; staging then atomic rename at 397-458). The store directory is `browser-speech/<manifest digest>/`. |
| Runtime inventory | `models/browser-runtime/manifest.json` (24 entries). `src/frontend/scripts/browser-runtime-assets.mjs` hard-codes `RUNTIME_FILE_COUNT = 24` and `MODEL_FILE_COUNT = 13` (27-28). Vite serves and copies `/onnx/...` (`web/vite-plugins/browser-runtime-assets.ts`). Built web and desktop bake these files into the web root. |
| Worker | `src/frontend/web/public/tts/workers/inference-worker.js` (Git LFS; run `git lfs pull` in a fresh worktree). `PREDEFINED_VOICE_NAMES` at 37 is hard-coded. `loadPredefinedVoiceStates()` 1520-1547 fetches `/onnx/models/pocket-tts/voices/<name>.safetensors`. It posts `voices_loaded` (1386-1425). `set_voice` 1104-1123 rejects unknown names. State parsing uses `parseSafetensors` and `stateArraysFromVoiceState` in `pocket-runtime.js`. |
| Voice list and fallback | `PocketTTSCore.js:564-572` and `use-pocket-tts-runtime.ts:276-293` carry voices as `string[]`. `use-tts-playback.ts:745-784`: an unknown voice triggers `warnOnceForRun` (519-529), which is keyed per run, so the toast repeats on every reply. |
| Preferences | `voice-preferences.ts`: `tts_pocket_anima_voice` (Anima settings) overrides `tts_pocket_voice` (App settings; read-only in the UI today). Both live in untyped JSONB `preferences` (`orm/settings.py:20,31`; `server/routers/settings.py`). |
| Selector | `web/src/ui/main/header/AnimaSettingsModal.tsx` 398-421 uses Radix `Select`. `ui/components/select.tsx` already exports `SelectGroup`, `SelectLabel` and `SelectSeparator`. |
| Backend serving | `local/http/assets.py`: `LocalAssets`, the Parakeet `ModelMount` and `_model_response` (Range/ETag, 374-413); the static catch-all is registered last (`local/http/composition.py:89-94`). Dev Vite proxies only `^/v1`, `/health` and `/api/telemetry` (`web/vite-plugins/local-api-proxy.ts:42-47`), so downloaded assets must be served under `/v1`. Routers are registered in `server/routers/__init__.py`. |
| Writable store | `server/config.py` `animama_data_root`; `server/local_runtime.py:84-115` defines `data/internal/...`. Desktop: `<userData>/data` (`desktop/src/main-process/runtime/supervisor.ts`). Compose: `/var/lib/animama/data`, a writable bind. `animama-network` is a non-internal bridge, so egress exists. |
| Desktop packs | `desktop/src/main-process/feature-packs/` (Electron main): `download.ts` (resume, exact length, SHA-256), `manager.ts` (staging, rename, rollback), `catalog.ts` (R2 URL rules). Distribution: `release-policy.json` `base_url: https://downloads.animama.ai/desktop`, bucket `animama-releases`. Size caps: `desktop/runtime/size-budgets.json`. |
| Licences | `licenses/third-party/code-and-models.{json,md}` (group `browser-pocket`), `licenses/source-review.json`, `desktop/runtime/license-sources.json`, and `desktop/runtime/notices/pocket-tts-attribution.txt`. That notice is hash-bound in the browser speech manifest, so editing it changes the store digest. No in-app notice view exists. `web/src/ui/settings/AboutSettings.tsx` is the About section. |
| Tests | `tests/test_browser_model_store.py`, `tests/test_local_http_assets.py`, `tests/test_compose_network_boundaries.py`, `web/tests/speech/pocketRuntime.test.ts`, `web/tests/browserRuntimeAssets.test.ts`, `desktop/tests/feature-packs.test.ts`, `desktop/tests/runtime-packaging.test.mjs`. |

### Upstream facts (checked 2026-09-26)

- **Kyutai precomputed states.** `kyutai/pocket-tts-without-voice-cloning`
  @`4e1e0a3e611c51c0b4ed8174fc10f32a54644303`,
  `languages/english_2026-04/embeddings/<name>.safetensors`. Each holds six
  layers of `self_attn/cache` `[2,1,T,16,64]` float32 plus an `offset`. These
  are voice-conditioned flow-LM caches, not encoder embeddings. Per-voice
  source licences vary (#130 plan).
- **VCTK source clips.** The `kyutai/tts-voices` model repository @`323332d33f997de8394f24a193e1a76df720e01a` has a `vctk/` folder with 318
  entries. Each speaker has `pNNN_023.wav`, `pNNN_023_enhanced.wav` and an
  older-checkpoint `.safetensors` embedding, which is not usable for April.
  Kyutai's built-in voices use the `_enhanced.wav` clips. Only `vctk/` is in
  scope; the donation folders are excluded.
- **Encoding recipe (validated in #130 Phase 1).** Resample to 24 kHz mono,
  run the FP32 `mimi_encoder`, prepend `bos_before_voice.npy`, run the
  voice-conditioning pass through INT8 `flow_lm_main`, then export the
  per-layer cache and offset. A recomputed `fantine` matched Kyutai's state
  with cosine ≥ 0.9987. That scratch harness was not checked in.

## Progress

- [ ] Phase 1 (#150): Candidate inventory, encoding and screening tools, listening page.
      Ends at gate **G1**, owner curation.
- [ ] Phase 2 (#151): Shared backend asset downloader. Independent of G1.
- [ ] Phase 3 (#152): Curated assets, manifests and licences. Needs G1. R2 publication
      is gate **G2**.
- [ ] Phase 4 (#153): Runtime voice catalog and grouped selector. Needs Phases 2 and 3.
- [ ] Phase 5 (#154): Notices, inventory, size, docs and surface verification. Ends at
      gate **G3**, owner acceptance.

## Surprises & Discoveries

- 2026-09-26: no in-app licence or notice view exists. Desktop stages
  `THIRD_PARTY_NOTICES.txt`, but nothing opens it. R23 therefore needs a new
  surface (see D6).
- 2026-09-26: the installation-wide `tts_pocket_voice` has no UI setter; only
  Anima settings choose a voice. R16 and R18 still check both fields.
- 2026-09-26: a concurrent #144 plan (`feat/parakeet-webgpu-download`, draft)
  delivers the 1.24 GB WebGPU encoder as a desktop feature pack. On
  self-host it proposes an operator mount, and leaves server-side download
  open (its D2). This fits D3's boundary, since large bundles use packs. If
  #144 later chooses server-side download on self-host, it can adopt this
  plan's downloader. Neither plan edits the other's files. The shared touch
  points (`docs/backend/operations/model-assets.md`, `local/http/assets.py`)
  need a rebase check before merge.
- 2026-09-26: VCTK speaker gender and accent are not in `kyutai/tts-voices`.
  They come from VCTK's `speaker-info.txt` (see Phase 1).

## Decision Log

- **D1.** 2026-09-26, owner. The spec decisions: sources, set sizes, 75% female,
  R2 `animama-releases`, a shared downloader, auto-download, notices only.
- **D2.** 2026-09-26, owner delegated to the agent. Removal is refused while a
  voice is in use (R18). Downloaded voices sit outside the core inventory and
  caps (R25).
- **D3.** 2026-09-26, agent. The downloader lives in the backend (not Electron
  main), so desktop and self-host share one implementation. Desktop already
  runs the same FastAPI with its data root under `userData`. The feature pack
  downloader stays in Electron for bundles that need a service switch. Phase 2
  ports its proven verification rules (exact length, full-file SHA-256, staging
  then rename, no partial visibility) rather than sharing TypeScript code across
  the process boundary.
- **D4.** 2026-09-26, agent. The pinned catalog is packaged backend data under
  `src/backend/animama/resources/`, so the Docker image and the frozen desktop
  backend both carry it. The frontend reads voice metadata from the API. It
  never keeps a second copy.
- **D5.** 2026-09-26, agent. Samples are downloader assets too, fetched,
  verified and cached by the backend. The browser never contacts R2, which
  preserves the loopback boundary and the desktop CSP.
- **D6.** 2026-09-26, agent proposal; owner may override at plan review. There
  is no notice view, so the plan adds a read-only **Acknowledgements** entry in
  App Settings → About. It lists core voice credits and the credits of
  installed downloaded voices, generated from the catalog. This keeps credit
  out of the selector, per the owner's "notices only" choice.
- **D7.** 2026-09-26, agent. Voice-authoring tools use a `voice-tools` uv
  dependency group (onnxruntime, soundfile, safetensors and a pinned Parakeet
  ONNX ASR wrapper). It is not installed in the runtime image or the frozen
  backend.

## Phased implementation

### Phase 1: Candidate inventory, tools and listening page

Requirements: R1–R3 and R5. Dependencies: an acquired browser speech store and
Parakeet store (`python3 scripts/models/browser_speech.py acquire`,
`python3 scripts/models/parakeet.py acquire`).

Intended changes:

1. **`scripts/voices/` (new):**
   - `sources.json`: pinned inputs.
     - The Kyutai states repo and revision.
     - `kyutai/tts-voices` @`323332d3…`, with `vctk/pNNN_023_enhanced.wav`
       paths and SHA-256.
     - The VCTK `speaker-info.txt` (gender, age, accent) from a pinned, hashed
       source. If no pinned copy is reachable without the full corpus, record
       the labels manually in the inventory, marked as such.
     - Each candidate's licence evidence.
   - `inventory.py`: builds `docs/plans/pocket-tts-voice-catalog/voice-inventory.json`
     and a Markdown summary. Each record has the ID, source, revision, hash,
     licence, gender, accent and a `status` (`candidate`, `excluded:<reason>`).
     The Kyutai voices `cosette`, `jean`, `giovanni`, `lola`, `juergen` and
     `rafael` are `excluded`. VCTK speakers already used by Kyutai's states are
     deduplicated, keeping Kyutai's state.
   - `encode.py`: pinned clip → state `.safetensors`, using the recipe above
     with the same ONNX files as the core store. Deterministic: fixed trimming,
     a CPU provider, one thread.
   - `screen.py`: renders the six #130 prompts with fixed seeds at temperature
     0.3 through the shipped graphs. It records Parakeet lenient WER, peak and
     clipping ratio, leading and trailing silence, and RMS noise-floor
     estimates. It writes `screen-results.json`, ranked per gender.
   - `listening_page.py`: writes a static HTML page and WAVs to an ignored
     output directory (default under the OS cache, overridable). The page shows
     the top N per gender (default 30 female and 12 male) with metadata, scores
     and checkboxes for core, catalog and recommended. It exports the selection
     as JSON for the Phase 3 input.
2. Add the `voice-tools` dependency group to `pyproject.toml` (D7).
3. Tests (`tests/test_voice_tools.py`):
   - the inventory rejects NC or unknown licences and duplicate IDs;
   - the encoder reproduces `eve` and one more Kyutai VCTK voice from its
     source clip within tolerance (cosine ≥ 0.998 per layer; recorded);
   - determinism: encoding twice yields identical bytes.

   Mark the ONNX-dependent tests to skip clearly when the stores are absent.

Checks: `uv run pytest -q tests/test_voice_tools.py`, `uv run ruff check`, and
a full `screen.py` run with the results summarized here.

Completion: the inventory covers every candidate and the screening results are
recorded. The encoder tolerance is met and recorded, or Phase 1 stops and
reports if it is not. The listening page opens locally.

**Gate G1 (owner):** listen, then choose the core set, the catalog, the
recommended voices and whether `eve` stays default. Record a dated decision with
counts and the gender split. If the female pool is short (R3), the owner decides
the balance.

Results, issue and commits: _pending_.

#### Code Review #1 Findings

_Pending._

#### Code Review #1 Revisions

_Pending._

### Phase 2: Shared backend asset downloader

Requirements: R8–R12. Dependencies: none (it can run in parallel with Phase 1
and G1). It uses a local fixture server in tests.

Intended changes (backend, following `src/backend/AGENTS.md` layering):

1. **Domain and service.**
   - An `AssetDescriptor` has an ID, URL, size, SHA-256, media type and
     licence reference.
   - An `AssetState` is `not_installed`, `downloading(bytes, total)`,
     `installed` or `failed(reason)`.
   - An app service with a store port handles install, state, remove and path.
2. **Store adapter.**
   - Installed files go to `<data_root>/internal/model-assets/<asset_id>/<sha256>`.
   - Staging goes to `<data_root>/staging/model-assets/`.
   - Stream to staging, enforce exact length, verify SHA-256, fsync, then
     rename atomically.
   - On mismatch, delete the file and fail with `asset_hash_invalid`.
   - Downloads are single-flight per asset. A process-wide lock prevents
     concurrent installs of the same asset.
   - At startup, discard leftover staging files.
3. **HTTP client.**
   - Use httpx with a host allowlist derived from the catalog's pinned base URL
     (`downloads.animama.ai`). Follow no redirects and apply timeouts.
   - Tests may allow `127.0.0.1` only through an explicit test-only setting,
     mirroring the feature-pack fixture rule.
   - URLs come only from the packaged manifest (R11); request bodies carry
     asset IDs, never URLs.
4. **Routes** under `/v1/model-assets` (served in dev through the Vite proxy):
   - `GET /v1/model-assets`: a state list.
   - `POST /v1/model-assets/{asset_id}:install`: idempotent; returns 202 with
     the state.
   - `DELETE /v1/model-assets/{asset_id}`.
   - `GET /v1/model-assets/{asset_id}/content`: Range/ETag, reusing
     `_model_response`; 404 unless installed.

   Consumers can veto removal through a guard hook, which Phase 4 uses for R18.
5. **Manifest schema** `animama-asset-catalog/1`, a packaged resource, with a
   validation test. Phase 2 ships an empty production catalog plus test
   fixtures.
6. **Docs:** `docs/backend/architecture/http-api.md` covers the routes, and a
   short section in `docs/backend/operations/model-assets.md` explains the pack
   versus downloader boundary (D3), the store location and recovery (delete the
   asset directory; the service reinstalls it on demand).

Checks:
- New `tests/test_model_assets.py` covers:
  - a verified install;
  - a wrong size and a wrong hash leave nothing;
  - an interrupted stream and a cancelled install leave nothing;
  - an unknown ID or disallowed host is refused;
  - concurrent installs are single-flight;
  - removal, and a removal refused by the guard;
  - content Range requests;
  - restart persistence.
- Also run `uv run pytest -q`, `uv run ruff check`, `make check-test`, the
  import-boundary check, and `pnpm openapi-ts` (then `pnpm check`) for the
  regenerated client.

Completion: all of the above pass and review is complete.

Results, issue and commits: _pending_.

#### Code Review #1 Findings

_Pending._

#### Code Review #1 Revisions

_Pending._

### Phase 3: Curated assets, manifests and licences

Requirements: R4, R6, R7, R13, R24 and core-set parts of R25. Dependencies: G1
and the Phase 1 tools.

Intended changes:

1. **Voice catalog resource.** Add
   `src/backend/animama/resources/pocket-voices.json`, generated from the G1
   selection.
   - It lists every shipped voice: ID, display name, gender, accent tags,
     recommended flag, delivery `core|optional`, licence and attribution text.
   - Each optional voice references its state asset and sample asset in the
     Phase 2 catalog (URL, size, SHA-256).
   - The default voice is recorded here.
2. **R2 layout (proposed).** Objects go under
   `https://downloads.animama.ai/voices/pocket/english_2026-04/`:
   - `states/<voice>-<sha16>.safetensors`
   - `samples/<voice>-<sha16>.ogg` (Opus, about 8 s, the same prompt for every
     voice)

   The names are content-addressed and immutable.
3. **Core set.**
   - Kyutai-sourced core voices keep their Hugging Face pins.
   - Self-encoded core voices are fetched from R2. Extend `browser_speech.py`:
     a per-file `source.kind` of `huggingface` or `release`, and add
     `downloads.animama.ai` to the allowlist for `release` sources only.
   - Update the exact-count checks (13, 24) to the new counts.
   - Update the manifests and `pocket-tts-attribution.txt`. Editing the notice
     changes the store digest, which is expected; the new directory is created
     beside the old one.
4. **Licences.** Add one record per shipped or hosted voice and sample to
   `licenses/third-party/code-and-models.{json,md}`, `license-sources.json` and
   `source-review.json`. Add a test that rejects a catalog entry without a
   record, or with an NC or unknown licence (R24).
5. **Publication input.** A script produces the exact upload set (states and
   samples) plus a checksum list in an ignored output directory.

**Gate G2 (owner):** publishing to `animama-releases` and confirming that
`downloads.animama.ai` publicly serves the objects are owner actions. Agents
prepare the upload set and verify the served bytes afterwards. They do not
publish. Until G2, Phase 4 development uses the local fixture server.

Checks:
- `python3 scripts/models/browser_speech.py acquire` then `verify` (real
  downloads after G2);
- `uv run pytest -q tests/test_browser_model_store.py tests/test_voice_tools.py`
  and the new licence test;
- `pnpm verify:tts-assets` and `web/tests/browserRuntimeAssets.test.ts` with the
  new counts.

Completion: the manifests, catalog and licence records match the G1 decision.
After G2, every hosted object's served SHA-256 matches.

Results, issue and commits: _pending_.

#### Code Review #1 Findings

_Pending._

#### Code Review #1 Revisions

_Pending._

### Phase 4: Runtime voice catalog and grouped selector

Requirements: R14–R22. Dependencies: Phases 2 and 3 (a fixture catalog is
enough before G2).

Intended changes:

1. **Backend voice routes.**
   - `GET /v1/pocket-voices`: the catalog merged with install state, a state
     URL (the core `/onnx/...` path or `/v1/model-assets/<id>/content`) and a
     sample URL.
   - `POST /v1/pocket-voices/{voice}:install`: delegates to the downloader and
     installs the sample on first play.
   - `DELETE /v1/pocket-voices/{voice}`: the R18 guard. It queries
     `user_settings` and `anima_settings` preferences for `tts_pocket_voice` and
     `tts_pocket_anima_voice`, and returns 409 with the Anima IDs and names that
     use the voice.
2. **Worker.**
   - Replace `PREDEFINED_VOICE_NAMES` with a voice list (name → state URL) sent
     at init and on catalog change.
   - Load optional states lazily through the existing two-entry LRU.
   - `voices_loaded` reports installed names. `set_voice` on a not-installed
     voice returns a typed `voice_not_installed` result, not a generic error.
3. **Controller and hooks.**
   - Carry voice metadata (not bare strings) through `PocketTTSCore` and
     `use-pocket-tts-runtime`.
   - Add a `usePocketVoiceCatalog` query with install and remove mutations.
4. **Fallback (R16, R17).** In `use-tts-playback.ts`, when the resolved voice is
   a catalog voice that is not installed:
   - use the default voice;
   - trigger install;
   - show one notice per app session (a session-scoped key replaces the per-run
     key for this reason);
   - retry on a later reply or on the browser `online` event.

   Unknown non-catalog names use the default with the same one-per-session
   notice.
5. **Selector** (`AnimaSettingsModal`):
   - `SelectGroup` Female and Male (female first, matching the set's balance),
     recommended voices first, each with accent tags.
   - An "Available to download" section per group with play-sample and download
     controls and progress.
   - Remove on downloaded voices, with the 409 reason shown.
   - The "Use application default" and "Custom (uploaded)" options are
     unchanged.
   - The Radix `Select` may not host inline buttons accessibly. If so, use the
     existing popover/list pattern and record the choice here.

Checks:
- Unit tests for:
  - the worker voice-list handling (`pocketRuntime`/worker tests);
  - the fallback notice once per session and retry;
  - selector grouping and ordering;
  - the remove refusal message.
- Backend route tests, including the 409 guard.
- `pnpm check`, `pnpm web:lint`, `pnpm web:test`, `pnpm build`, `uv run pytest -q`.
- Browser verification on a task stack at desktop size, then a narrow layout:
  grouping, sample playback, download, speaking with the downloaded voice
  without a reload, the auto-download path, and the offline notice. Simulate
  offline by blocking the fixture or R2 host.

Completion: automated checks pass. Browser evidence is recorded with the stack
URL and revision.

Results, issue and commits: _pending_.

#### Code Review #1 Findings

_Pending._

#### Code Review #1 Revisions

_Pending._

### Phase 5: Notices, inventory, size, docs and verification

Requirements: R23, R25 and the combined acceptance.

Intended changes:

1. **Acknowledgements (D6).**
   - A read-only list in App Settings → About: core voice credits and the
     credits of each installed optional voice, from `GET /v1/pocket-voices`.
   - Removal updates it.
   - Desktop's staged `THIRD_PARTY_NOTICES.txt` gains the core voices through
     the existing licence staging.
2. **Desktop inventory and size.**
   - The catalog resource is part of the core inventory.
   - `desktop:runtime:stage` and `desktop:runtime:audit` must pass. Record the
     download and installed sizes against the 750 MiB and 1.5 GiB caps, with no
     size exception.
   - Downloaded assets live under `userData/data` and are not audited as core.
3. **Docs.** Update:
   - `docs/frontend/runtime/voice.md` (voice catalog, fallback and selector);
   - `docs/backend/operations/model-assets.md` (the core voice count, release
     sources and the downloader store);
   - `docs/frontend/desktop/redistribution-review.md`;
   - `src/frontend/AGENTS.md` if its Pocket notes are stale;
   - `GLOSSARY.md`, if review finds "core voice" or "optional voice" ambiguous.

**Gate G3 (owner):**
- A packaged desktop app (`pnpm desktop:mac`, unsigned) and a built self-host
  stack each complete sample, download, speak, restart persistence and removal
  against the published R2 objects.
- Owner listening acceptance of the shipped set, as spec acceptance requires.

Agents run and record these checks where the environment allows. The owner
confirms them.

Checks:
- `pnpm desktop:check`, `pnpm desktop:test`, `desktop:runtime:stage` and
  `desktop:runtime:audit`, `pnpm desktop:mac`;
- the Compose config checks from `AGENTS.md`;
- the full backend and frontend suites.

Results, issue and commits: _pending_.

#### Code Review #1 Findings

_Pending._

#### Code Review #1 Revisions

_Pending._

## Final integration review

Covers the combined spec acceptance using still-valid phase evidence. Review
focus:
- no URL or host outside the pinned catalog is reachable;
- no partial asset is ever served;
- R18 guard coverage of both preference levels;
- licence records for every hosted object;
- the size record;
- docs accuracy.

_Pending._

## Validation and acceptance

The spec's acceptance criteria map to phases as follows:

| Spec acceptance | Phase and evidence |
| --- | --- |
| Inventory and no NC/unknown voices | P1 inventory, P3 licence test |
| Encoder reproducibility | P1 tests |
| Owner listening acceptance | G1 and G3 |
| Downloader behavior | P2 tests |
| Selector | P4 browser evidence |
| Sample, download and speak on both surfaces | P4 browser and G3 packaged/self-host |
| Auto-download and offline notice | P4 tests and browser |
| Removal guard | P2 and P4 tests |
| Notices | P5 rendered Acknowledgements |
| Acquisition, inventory, docs and size | P3 and P5 commands |

Local evidence, hosted `Validation` results and owner gates are recorded
separately. None is marked passed without its evidence.

## Idempotence and recovery

- The Phase 1 tools write only to ignored output directories. Re-running them
  is safe, and pinned inputs make results reproducible.
- Core acquisition creates a new digest directory, leaving old stores intact.
  Roll back by checking out the previous manifest.
- Downloader: a failed install leaves only staging files, which are removed at
  startup. Delete `<data_root>/internal/model-assets/<asset_id>/` to force a
  reinstall. Never edit an installed file in place.
- R2 objects are content-addressed and never overwritten. A bad object is
  replaced by a new name in a new release manifest.
- The database is reset for this development cycle. No preference migration is
  needed (spec non-goal).

## Outcomes & Retrospective

_Pending._
