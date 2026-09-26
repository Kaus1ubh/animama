# Expanded PocketTTS core voices with a grouped selector

Source agreement: [pocket-tts-voice-catalog-spec.md](pocket-tts-voice-catalog-spec.md),
Agreed 2026-09-26 and revised at gate G1 the same day (D11). The spec's
requirement IDs are authoritative; this plan does not redefine them. R8–R18
were withdrawn at G1. Source issue:
[raymond-van/animama#142](https://github.com/raymond-van/animama/issues/142).
Authorized scope: the whole plan (owner invoked implementation on 2026-09-26).
Work stops at the explicit gates G1, G2 and G3.

Workspace: branch `feat/pocket-tts-voice-catalog` in its own worktree, from
baseline `410425e`. `origin/main` has since gained only unrelated desktop-smoke
fixes (`b633af1`).

## Purpose and context

After this work:

- PocketTTS ships 38 curated core voices: 27 female and 11 male, with 14
  recommended and `eve` the default.
  - 14 are Kyutai precomputed states.
  - 24 are VCTK voices we encode reproducibly and publish to the
    `animama-releases` R2 bucket.
- The Anima settings selector groups voices by gender, marks recommended
  voices and shows accent tags.
- A saved voice that no longer exists falls back to the default with one
  notice per session.

The shared asset downloader first planned as Phase 2 now lives in
[raymond-van/animama#151](https://github.com/raymond-van/animama/issues/151)
(draft PR [raymond-van/animama#162](https://github.com/raymond-van/animama/pull/162)).
Its Phase 2 record below is kept as delivery history.

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

- [x] Phase 1 (#150): Candidate inventory, encoding and screening tools, listening page.
      Complete: `a297da5`, Review #2 passed, gate **G1** passed 2026-09-26 (D11).
- [x] Phase 2: Shared backend asset downloader. Reviewed and complete, then
      split out at G1 (D11) to #151 / PR #162 (`dc2a433`). Removed from this
      branch in `4123951`.
- [ ] Phase 3 (#152): Shipped voice assets, acquisition and licences.
      Agent work complete (`22c571b`, Review #2 passed); waiting on gate **G2**,
      the owner publishing to R2.
- [ ] Phase 4 (#153): Data-driven worker voice list, grouped selector and
      stale-voice notice.
- [ ] Phase 5 (#154): Inventory, size, docs and verification. Ends at gate
      **G3**, owner acceptance.

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
- **D7.** 2026-09-26, agent; revised the same day during Phase 1. Voice
  tools are one uv script (`scripts/voices/voices.py`) with inline (PEP 723)
  dependencies and its own `voices.py.lock`. The dependencies are numpy,
  scipy, onnxruntime, sentencepiece and onnx-asr. The originally planned
  `voice-tools` dependency group was dropped: adding it re-resolved the shared
  `uv.lock` and moved Linux `file-worker`'s `transformers` from 5.8.1 to
  5.17.0, an unrelated change. The script environment leaves the backend lock,
  runtime image and frozen backend untouched.
- **D8.** 2026-09-26, agent, from Phase 1 evidence. Of the 23 non-shipped
  Kyutai voices, 14 remain candidates, not the spec's "17 licensed". With
  the four shipped voices, 18 Kyutai voices are candidates.
  - `daan` has no source recording in Kyutai's model card, so R1 excludes it
    as an unknown licence.
  - `javert` and `marius` come from `voice-donations/`, which the owner
    excluded (spec decisions), so they are excluded too. They can be restored
    at G1 if the owner wants them.
  - Kyutai's four precomputed Voice-Zero states (`bill_boerst`, `caro_davy`,
    `peter_yearsley`, `stuart_bell`, CC0) remain candidates. They belong to
    the Kyutai set the owner selected in discovery; the Voice-Zero exclusion
    applies to encoding new voices from that dataset.
  - The remaining candidates are the four shipped voices plus `alba`, `anna`,
    `charles`, `eponine`, `estelle`, `fantine`, `george`, `michael`, `paul`
    and `vera`, plus the Voice-Zero four.
- **D9.** 2026-09-26, agent, from Phase 1 evidence. The encoder does not trim
  its input. Kyutai's `eve` state has 133 positions: BOS plus
  `ceil(10.497 s × 12.5)` = 132 frames of the full, untrimmed `p361_023`
  clip. Trimming would therefore diverge from Kyutai's recipe, so R5's
  "trim" step is intentionally a no-op. The reproduction tolerance is a
  per-layer cosine ≥ 0.998. The shipped INT8 `flow_lm_main` differs slightly
  from Kyutai's reference model, which puts every reproduced voice at
  0.99865–0.99873. The unenhanced clip only reaches 0.989, so the tolerance
  separates a correct recipe from a wrong source.
- **D10.** 2026-09-26, agent. VCTK accents are raw dataset tokens
  (`NorthernIrish`, `SouthAfrican`, `NewZealand`, `Unknown`). Five
  manual-label candidates have no accent. Phase 3 maps these tokens to display
  tags (for example "Northern Irish") and omits the tag for `Unknown` or a
  missing value.
- **D11.** 2026-09-26, owner, gate G1. After listening, the owner selected 38
  voices and made them all core, with no optional catalog: "Didn't like
  enough voices, let's just make them all core."
  - `eve` stays the default.
  - `javert` and `marius` are restored as recommended voices, reversing their
    D8 exclusion.
  - The downloader lost its consumer, so the owner chose to split it into its
    own PR, to merge with a first consumer (#151 / #162).
  - The selection is recorded in `scripts/voices/selection.json`.
  - Consequences:
    - D2, D4, D5 and D6 are superseded, since there is no removal guard,
      backend voice catalog, samples or in-app credits list;
    - the static notices cover every shipped voice (R23);
    - R8–R18 are withdrawn in the spec.
- **D12.** 2026-09-26, agent. Voice metadata (display name, gender, accent
  tag, recommended flag, order) is one tracked frontend module, generated from
  `selection.json` and the inventory. The UI reads it, and it sends the voice
  list to the worker at init. A test checks that its IDs equal the voice files
  in the browser speech manifest, so the two cannot drift. There is no backend
  API, because every voice is a static core asset. Self-encoded VCTK voices
  get agent-proposed given names, recorded in the selection file, which the
  owner can rename in review.

## Phased implementation

### Phase 1: Candidate inventory, tools and listening page

Requirements: R1–R3 and R5. Dependencies: an acquired browser speech store and
Parakeet store (`python3 scripts/models/browser_speech.py acquire`,
`python3 scripts/models/parakeet.py acquire`).

Intended changes (as delivered; see D7):

1. **`scripts/voices/` (new).** Run with `uv run scripts/voices/voices.py <command>`.
   - `sources.json`: the pinned inputs and each Kyutai voice's recording,
     licence, VCTK speaker or manual gender label, and any exclusion reason.
     `pin` adds the upstream size and SHA-256 of every file at the pinned
     revisions. It also extracts VCTK's `speaker-info.txt` from the
     11.7 GB DataShare archive using HTTP range reads of the ZIP directory and
     one member, and records its SHA-256.
   - `pocket_onnx.py`: an offline port of the worker's April runtime. It
     encodes a voice state (resample, Mimi encoder, BOS, INT8 voice
     conditioning, sliced cache plus offset) and renders a prompt with a seeded
     generator, one CPU thread, and the worker's EOS tail and frame limit.
   - `voices.py` commands:
     - `fetch` verifies downloads into an untracked work directory,
       `<model root>/../voice-tools`.
     - `encode` writes states and their hashes; `encode --check` reproduces
       Kyutai's VCTK states.
     - `screen` covers six prompts per voice: Parakeet INT8 lenient WER through
       onnx-asr, EOS, clipping, leading and trailing silence, and noise floor.
     - `inventory` writes `voice-inventory.{json,md}` beside this plan.
     - `listen` writes the static curation page with an exportable selection.
2. Tests (`tests/test_voice_tools.py`) cover:
   - speaker-info parsing;
   - candidate building (licence exclusions, VCTK deduplication, missing
     metadata);
   - ZIP member extraction through range reads;
   - the host allowlist;
   - WER, quality flags and ranking;
   - the listening page's selection controls;
   - byte-stable safetensors output.

   ONNX reproduction and determinism run through the script environment and
   are recorded under Phase 1 results.

Checks: `uv run pytest -q tests/test_voice_tools.py`, `uv run ruff check`,
`encode --check`, and a full `screen` run with the results summarized here.

Completion: the inventory covers every candidate and the screening results are
recorded. The encoder tolerance is met and recorded, or Phase 1 stops and
reports if it is not. The listening page opens locally.

**Gate G1 (owner):** listen, then choose the core set, the catalog, the
recommended voices and whether `eve` stays default. Record a dated decision with
counts and the gender split. If the female pool is short (R3), the owner decides
the balance.

#### Phase 1 results (2026-09-26)

Issue #150. Starting revision `0f9823c`. Environment: Apple Silicon macOS;
uv script environment from `voices.py.lock` (onnxruntime 1.30.0 on CPU, one
thread); the verified browser speech and Parakeet stores.

- **Pinning** (`voices.py pin`): 27 Kyutai states and 106 VCTK
  `_enhanced.wav` clips pinned with their Hugging Face LFS SHA-256.
  `speaker-info.txt` (110 speakers, 4,028 bytes, SHA-256 `ee6447ed…`) was
  extracted through range reads of the 11.7 GB archive.
- **Fetch:** 133 files verified in about 69 s.
- **`encode --check`:** all 12 Kyutai VCTK voices reproduced, with per-voice
  minimum cosine 0.99865–0.99873 against tolerance 0.998. A non-enhanced clip
  scores 0.989 (D9).
- **`encode`:** 94 VCTK candidates in about 70 s. Three full runs produced
  identical SHA-256 for every state. Hashes are tracked in
  `scripts/voices/encoded-state-hashes.json`; a changed hash fails unless
  `--rehash` is passed.
- **Inventory:** 121 records, 112 candidates and 9 excluded (`cosette`,
  `jean`, `daan`, `giovanni`, `lola`, `juergen`, `rafael`, `javert`,
  `marius`). Candidates are 62 female and 50 male.
- **Screen:** six prompts × 112 voices, about 22 min. Two number prompts from
  the first trial were replaced, because Parakeet writes digits ("$42.50") and
  that inflates WER without reflecting speech.
  - 97 voices score mean lenient WER 0.
  - Clean voices (no flags): 57 of 62 female and 46 of 50 male. So 75% female
    at any agreed size is feasible.
  - Flags: 4 lead-silence, 3 clipping, 1 noisy, and 1 unintelligible prompt
    (`vctk-p282`, "Pie there.").
  - Every render reached EOS. Leading silence is about 0.7 s for every voice,
    so its flag threshold is 1.2 s.
- **Listening page:** `voices.py listen` shows all screened voices, ranked,
  with per-gender selection counts. The selection persists in the browser
  and exports as JSON. Served locally for G1.
- **Checks:**
  - `uv run --no-sync pytest -q tests/test_voice_tools.py`: 20 passed.
  - `uv run --no-sync ruff check scripts/voices tests/test_voice_tools.py`: clean.
  - `ruff format --check`: clean.
  - `uv run --no-sync mypy tests/test_voice_tools.py`: clean.
  - `uv lock --script scripts/voices/voices.py --check`: current.

#### Code Review #1 Findings

Independent reviewer (read-only). Source: Phase 1 working tree on `0f9823c`.
Checks rerun: `pytest` 14 passed, ruff and format clean, the script lock
current, and `encode --check --only eve` at 0.99871.

The runtime port was verified against the worker: conditioning, the EOS
tail, the frame limit, decode partitioning and the state export format all
match.

Required fixes:
- **P1-R1-F1.** `encode --check` could pass without a valid comparison. NaN
  from a shape mismatch was ignored by `min()`, an unknown `--only` passed,
  and offsets were never compared.
- **P1-R1-F2.** Encoded-state hashes were untracked, and a rerun silently
  replaced them.
- **P1-R1-F3.** The plan did not record the no-trim recipe, the 14-voice
  Kyutai set (`daan`, donations, Voice-Zero), or the tolerance rationale.
- **P1-R1-F4.** A `pocket_onnx.py` docstring still referenced the dropped
  dependency group.

Optional:
- **P1-R1-F5.** Unbalanced parentheses in VCTK regions; raw accent tokens.
- **P1-R1-F6.** The listening page's defaults were too small, and it lacked
  per-gender counts, persistence and checkbox labels.
- **P1-R1-F7.** Cached screen results were reused after the prompts or seed
  changed.
- **P1-R1-F8.** The ZIP64 path was untested, and the locator search was
  fragile.
- **P1-R1-F9.** Network errors escaped as tracebacks, and a docstring
  overstated its validation.
- **P1-R1-F10.** `render` handled only plain, single-chunk prompts, with no
  guard, and parity helpers were untested.

#### Code Review #1 Revisions

All ten were verified and accepted.

- **F1, fixed.**
  - `pocket_onnx.compare_states` raises on differing tensors, shapes, dtypes
    or offsets, and on a non-finite cosine.
  - `check_reproduction` fails when the selection is empty or contains an
    unknown voice.
  - Tests: the structural-difference test and the empty-selection test.
    `encode --check --only nope` now errors.
- **F2, fixed.**
  - Tracked `encoded-state-hashes.json`; `record_state_hash` refuses a
    changed hash without `--rehash`.
  - The inventory records `encoded_state_sha256`.
  - Tested, and three runs gave identical hashes.
- **F3, fixed.** D8 and D9 added, and results recorded above.
- **F4, fixed.** Docstring corrected.
- **F5, fixed.** Parentheses are stripped anywhere in the region, with a test;
  accent display mapping is deferred to Phase 3 (D10).
- **F6, fixed.** The page shows all screened voices by default, with
  per-gender counts, `localStorage` persistence and `aria-label`s.
- **F7, fixed.** Screening stores its parameters and refuses to mix results
  with different ones unless `--force` is passed.
- **F8, fixed.** The locator is read at the fixed position before the classic
  record, and a forced-ZIP64 test was added.
- **F9, fixed.** HTTP, redirect and network errors become `VoiceToolError`,
  and the docstring was corrected.
- **F10, fixed.** `render` rejects digits, symbols and prompts over one
  50-token chunk. The worker limit helpers are unit-tested.

#### Code Review #2 Findings

This was a targeted recheck. It verified each of F1–F10 as resolved,
including:
- tracked, inventory and work-directory hashes agree for all 94 voices;
- `--only nope` errors;
- the ZIP64 test runs;
- the regions are fixed.

Checks:
- pytest: 20 passed;
- ruff, format, mypy and the script lock: all clean;
- `encode --check --only eve`: 0.99871.

Result: **pass**. Optional residuals:
- **P1-R2-F1.** A forced partial re-screen could keep old renders under new
  parameters.
- **P1-R2-F2.** A rejected state still replaced the work file.
- **P1-R2-F3.** The `render` guard does not cover every normalisation case,
  such as abbreviations, `:`/`;`/`+` and non-ASCII text.
- **Recovery text.** The recovery section and the `voices.py` docstring
  ignored the tracked outputs.

#### Code Review #2 Revisions

- **P1-R2-F1, fixed.** A changed parameter set with `--force` clears all
  voices before re-screening.
- **P1-R2-F2, fixed.** Encoded states are written to `.partial` and moved
  into place only after the hash check passes.
- **Recovery text, fixed.** Both the recovery section and the docstring now
  describe the tracked outputs.
- **P1-R2-F3, deferred to Phase 3.** The sample prompt will be chosen as
  plain words and short punctuation. Phase 3's sample renderer must reject
  text that the worker would normalise differently.

Review budget used: the initial review and one repair round. Phase 1 agent
work is complete; gate G1 remains.

Gate G1: pending the owner's selection.

### Phase 2: Shared backend asset downloader

> Moved at G1 (D11) to #151 / draft PR #162. The record below documents its
> implementation and reviews, and those reviews count toward #162.

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

#### Phase 2 results (2026-09-26)

Issue #151. Starting revision `0f9823c`. A delegated implementation agent
worked in the same worktree as Phase 1, on disjoint files.

- **Layered implementation.**
  - `domain/model_assets.py`: catalog schema `animama-asset-catalog/1`,
    descriptors, state, vetoes, and `PRODUCTION_ASSET_HOSTS =
    {downloads.animama.ai}`.
  - `app/ports` and `app/services/model_asset_service.py`: single-flight
    background install per asset, cancellation that waits for in-flight IO,
    and removal guards.
  - `adapters/model_assets/`:
    - The filesystem store writes `<data_root>/internal/model-assets/<id>/<sha256>`
      from private staging, with fsync and atomic rename; staging is purged at
      startup.
    - The httpx fetcher follows no redirects, requires an exact 200 and
      rechecks the allowlist.
  - `server/`: one service per app, created at startup and cancelled at
    shutdown.
  - Routes under `/v1/model-assets`. Content uses the existing Range/ETag
    logic, extracted from `local/http/assets.py` as `verified_file_response`.
- **Empty production catalog:** `resources/model-assets.v1.json`. Phase 3
  fills it.
- **Deviations:**
  - Tests use `httpx.MockTransport` behind the production allowlist instead
    of a loopback fixture server. No test-only host allowance exists anywhere,
    which is stricter than planned.
  - Implementation preceded the tests (TDD exception). It was compensated by
    mutation checks: disabling the hash check, staging cleanup, redirect
    refusal, idempotent install or guard veto each fails the tests.
- **Checks:**
  - `uv run pytest -q tests/test_model_assets.py`: 30 passed.
  - `uv run pytest -q`: 1962 passed, 7 skipped. A first run failed 2 tests
    because a composition test stubs `local_runtime_paths`; the data root now
    comes from settings, which is the same path on desktop and Compose.
  - `uv run ruff check src tests` and `ruff format --check`: clean.
  - mypy: clean for the new modules.
  - The import-boundary script reports `forbidden_edges: 0`.
  - `pnpm openapi-ts` regenerated the client; `pnpm openapi-ts:check` reports
    it current, and `pnpm check` passes.

#### Code Review #1 Findings

Independent reviewer (read-only), on the working tree over `0f9823c`.
Checks rerun:
- asset and local-HTTP tests: 132 passed;
- ruff and format: clean;
- mypy on the 9 modules plus tests: clean;
- import boundary: 0 forbidden edges;
- the SDK: current.

It verified atomic install, no partial visibility, cancellation, the size and
SHA-256 bound, redirect and host enforcement, path safety, auth and CSRF
admission, the refactor, layering, desktop packaging of the catalog, and the
Phase 4 fit.

Result: **pass**, with no blocking findings. Optional findings:

- **P2-R1-F1.** An install that races a removal can hit OSError and return a
  generic 500.
- **P2-R1-F2.** `aiter_bytes` decodes `Content-Encoding`, so the size bound
  applies after decompression.
- **P2-R1-F3.** The host allowlist ignores an explicit non-default port.
- **P2-R1-F4.** The plan named a loopback fixture, but tests use
  `MockTransport`.
- **P2-R1-F5.** The store re-derives the staging and internal roots instead
  of taking the local runtime paths.
- **P2-R1-F6.** `wait()` and `catalog` have no production caller yet.
- **P2-R1-F7.** A file that vanishes after the lookup returns the shared
  `{"error":"not_found"}` body.

#### Code Review #1 Revisions

- **F1, fixed.**
  - A per-asset removing marker is held from cancellation through the guards
    to deletion, and always cleared in `finally`.
  - `:install` and a second DELETE return 409 `model_asset_busy` while it is
    held.
  - OSError during removal returns `failed`/`asset_store_failed`.
  - Tests: the concurrent-install test and the store-error test.
- **F2, fixed.** A non-identity `content-encoding` is rejected before the body
  is read, and raw bytes are streamed, so size and hash apply to the wire
  bytes. A gzip case is added.
- **F3, fixed.** Ports other than 443 are rejected in both the catalog and the
  fetcher, with tests.
- **F7, fixed.** `verified_file_response` takes an optional `not_found`. The
  content route returns 404 `model_asset_not_installed`; the Parakeet and
  static 404 shapes are unchanged. Covered by a test.
- **F4: accepted as a record change.** Captured under Deviations above.
- **F5: rejected.** The reviewer confirmed that settings and
  `resolve_local_runtime_paths` resolve the same data root on desktop
  (`ANIMAMA_DATA_ROOT=<userData>/data`) and on Compose.
- **F6: deferred.** Phase 4 reads `catalog`, and `wait()` supports the tests.
  If neither is used by the end of Phase 4, remove them then.

#### Code Review #2 Findings

This was a targeted recheck of F1, F2, F3 and F7: all resolved, with no
regressions. The reviewer confirmed:
- the removing marker is cleared on every path, including cancellation;
- a download from before the removal is awaited before the rmtree;
- LocalAssets 404s are unchanged;
- the docs are accurate.

Checks:
- asset and local-HTTP tests: 139 passed;
- ruff, format and mypy: clean;
- import boundary: 0.

Result: **pass**. The implementer also ran `pnpm openapi-ts:check` (current)
and `pnpm check` (pass). The coordinator ran the full
`uv run --no-sync pytest -q`: 1975 passed, 7 skipped.

Review budget used: the initial review and one repair round. Phase 2 is
complete.

### Phase 3: Shipped voice assets, acquisition and licences

Requirements: R3–R7 and R23–R25. Issue #152. Dependencies: G1 (done).

Intended changes:

1. **Selection record.**
   - Add `scripts/voices/selection.json`, holding the 38 IDs, the default, the
     14 recommended voices, the display names and the order.
   - In `sources.json`, restore `javert` and `marius` (the D11 exception) and
     screen both so the inventory is complete.
   - The inventory gains a `shipped` flag.
2. **Publication set.**
   - A `voices.py publish-set` command copies the 24 selected self-encoded
     states into an untracked upload directory. Each is named
     `pocket-tts/voices/english_2026-04/<name>-<sha16>.safetensors`
     (immutable, content-addressed).
   - It verifies every file against `encoded-state-hashes.json` and writes a
     checksum list.
3. **Core acquisition.**
   - `models/browser-speech/manifest.json` lists 38 voice states:
     - Kyutai states keep their Hugging Face `source`;
     - self-encoded states get
       `source: {kind: "release", url: "https://downloads.animama.ai/pocket-tts/voices/english_2026-04/<file>"}`.
   - `browser_speech.py` validates both source kinds. It allows
     `downloads.animama.ai` only for `release` sources, and replaces the
     exact-13 check with the derived count (47 model files).
   - The store target stays `models/pocket-tts/voices/<id>.safetensors`.
   - Update `models/browser-runtime/manifest.json`, the counts in
     `browser-runtime-assets.mjs` (24 to 58 runtime files, 13 to 47 model
     files), `.dockerignore` if it lists voice files, and the affected tests.
4. **Licences and notices.**
   - `pocket-tts-attribution.txt` lists every shipped voice with its source
     recording and licence. Kyutai states name their Kyutai source; VCTK states
     name the VCTK speaker and the Kyutai-enhanced clip.
   - Update `licenses/third-party/code-and-models.{json,md}`,
     `license-sources.json` and `source-review.json` for the new files and for
     the `scripts/voices` port of the Apache-2.0 reference runtime.
   - Add a test that fails if a manifest voice has no licence record or an
     NC/unknown licence (R24).
5. **Local development before G2.** `browser_speech.py acquire --offline
   --import-from <upload dir + kyutai states>` builds the new store without
   network. Phase 4 develops against it.

**Gate G2 (owner).** Upload the publication set to `animama-releases` under
the manifest paths. Agents prepare and verify; they do not publish. After the
upload, the agent runs a real `browser_speech.py acquire` into a fresh root
and confirms every hash. Nothing that makes acquisition depend on these
objects merges before that.

Checks:
- `uv run --no-sync pytest -q tests/test_browser_model_store.py tests/test_voice_tools.py`
  and the licence test;
- `pnpm verify:tts-assets` and `web/tests/browserRuntimeAssets.test.ts`;
- `ruff`;
- offline import acquire and verify, then a real acquire after G2.

#### Phase 3 results (2026-09-26)

Issue #152. Starting revision `d872eb5`.

- **Selection.** `scripts/voices/selection.json` records the G1 set: 38
  voices (27 female, 11 male), 14 recommended, default `eve`. The owner
  approved the agent-proposed names for the 24 VCTK voices on 2026-09-26.
  - `javert` and `marius` were restored in `sources.json` and screened: WER 0,
    with `javert` flagged for leading silence.
  - The inventory now has `shipped` and `shipped_id`.
- **`voices.py release`.** Implemented as one command (the plan called it
  `publish-set`); `inventory` refreshes the inventory separately.
  - It verifies every input: encoded states against
    `encoded-state-hashes.json`, and Kyutai states against the pins.
  - It rebuilds the untracked upload and import directories before writing any
    tracked file.
  - It then regenerates the browser speech manifest's voice entries, the
    runtime manifest's voice entries, the licence `external_files`, the voice
    section of `pocket-tts-attribution.txt` and `voice-catalog.ts` (D12).
- **Acquisition.**
  - `parakeet.py` gains `RELEASE_HOSTS = {downloads.animama.ai}`, used only for
    entries with a `release` source; redirects stay within the same host set.
  - `browser_speech.py` derives the expected voice files from
    `selection.json`. Each voice must match its reviewed source: Kyutai's
    Hugging Face path, or the release URL `<id>-<sha256[:16]>.safetensors`
    bound to the entry hash. The exact-count check is derived: 8 bundle files,
    38 voices and Smart Turn make 47.
  - Runtime counts are 58 and 47.
- **Upload set:** 24 files, 158 MB, plus `SHA256SUMS`, under
  `pocket-tts/voices/english_2026-04/`.
- **Offline acquisition:** `browser_speech.py acquire --offline --import-from`
  the staged directory, then `verify`, succeed.
- **Licences.** Every shipped voice file is CC BY 4.0: Kyutai publishes its
  states under CC BY 4.0, and the encoded states derive from CC BY 4.0 VCTK.
  The recordings behind four voices are CC0, and the notice lists each
  recording's licence. `code-and-models.{json,md}` and `license-sources.json`
  are updated, and `pocket_onnx.py` is recorded as an Apache-2.0 port.
  `licenses/source-review.json` is release-candidate evidence refreshed by
  `scripts/public-release`; it is not updated here (#130 did the same).
- **Checks:**
  - `uv run --no-sync pytest -q tests/test_voice_tools.py tests/test_browser_model_store.py`:
    48 passed.
  - The reviewer ran `tests/test_model_store.py` and
    `tests/test_webgpu_model_store.py`: no Parakeet regression.
  - Ruff check and format, and mypy on the tests: clean.
  - `pnpm verify:tts-assets`: 58 files.
  - `browserRuntimeAssets.test.ts`: 13 passed.
- **Merge safety (G2).** After this manifest merges, every online acquisition
  (CI full validation, local receipts, desktop release, `reset.sh` on a fresh
  root) needs the published objects. The PR must not merge until the owner has
  uploaded the set under the exact manifest keys and a real `acquire` into a
  fresh root has verified every hash. Until then, hosted model-input failures
  are expected-pending, not passes, and offline-import evidence is not
  acquisition acceptance.

#### Code Review #1 Findings

Independent reviewer, on the working tree over `d872eb5`. Phase 4 edits
appeared mid-review and were excluded; the lesson is to pin a revision per
review.

Confirmed sound:
- **Release host security:** host, port, digest and redirect binding are
  correct, and the Parakeet default path is unchanged.
- **Byte-for-byte consistency:** the upload set, both manifests, the licence
  records and the pins all agree.
- **Notice:** `voice_notice` regenerates the checked-in section exactly.

Checks: 105 passed and 6 skipped across four suites; ruff and format clean;
`verify` OK; `verify:tts-assets` 58; runtime asset tests 13 passed.

Required:
- **P3-R1-F1.** The R24 test trusted the manifest's own `license` field; a
  hand-edited CC BY-NC voice could pass.
- **P3-R1-F2.** The inventory still showed `javert` and `marius` as excluded
  and unscreened, and it had no `shipped` flag.
- **P3-R1-F3.** The notice dropped the Kyutai repository licence (CC BY 4.0)
  and labelled four redistributed Kyutai states CC0.

Optional:
- **P3-R1-F4.** The licence-basis prose cited sources that don't ship.
- **P3-R1-F5.** `release` wrote tracked files before validating inputs and
  staging.
- **P3-R1-F6.** No format check on voice IDs.
- **P3-R1-F7.** A rename after G2 forces a re-upload.
- **P3-R1-F8.** Record deviations: the `release` name, `source-review.json`
  and `licenses/README.md`.

#### Code Review #1 Revisions

- **F1, fixed.** The test now checks against `sources.json`:
  - VCTK voices must be CC BY 4.0;
  - Kyutai voices need a permitted, non-excluded recording and the repository
    licence;
  - the generated notice section must be contained verbatim.
- **F2, fixed.** Inventory regenerated: 114 candidates and 7 excluded, with
  38 marked shipped.
- **F3, fixed.**
  - `sources.json` `kyutai_states.license` is CC BY 4.0, and the Kyutai
    manifest entries use it.
  - The notice restores "Repository license: CC BY 4.0 (the published
    states)" and lists each recording's licence.
  - The licence records now say every file is CC BY 4.0 and the four
    recordings are CC0.
- **F4, fixed.** The licence-basis prose names only shipped sources.
- **F5, fixed.** `release` verifies all inputs (including Kyutai hashes) and
  rebuilds the work directories before any tracked write.
- **F6, fixed.** IDs must match `[a-z0-9_]{1,64}` in both `voices.py` and
  `browser_speech.py`, with a test.
- **F7, accepted as a record.** The owner approved the names before G2, so
  IDs are frozen from here. A later rename needs a new upload.
- **F8, recorded** in the results above; `licenses/README.md` moves to Phase 5
  docs.

#### Code Review #2 Findings

Targeted recheck, pinned to `22c571b`. F1–F6 are resolved, and F7 and F8
were accepted as records.
- The reviewer confirmed its cosette scenario now fails the licence test.
- The upload set matches the committed manifest byte for byte.

Checks:
- four suites: 106 passed, 6 skipped;
- ruff and format: clean;
- `verify` OK.

Result: **pass**. Optional notes:
- `22c571b` includes the generated `voice-catalog.ts`, which Phase 4 review
  covers.
- `browser_speech.shipped_voices`' ID check has no direct test.

Phase 3 agent work is complete (`22c571b`). Gate **G2** remains: the owner
uploads the set, then the agent runs a real acquire into a fresh root.

### Phase 4: Data-driven voice list, grouped selector and stale-voice notice

Requirements: R19–R22. Issue #153. Dependencies: Phase 3's local store.

Intended changes:

1. **Metadata module.** `web/src/lib/speech/pocket/voice-catalog.ts` is
   generated by `voices.py` and checked in. It holds the ordered voices (ID,
   display name, gender, accent tag, recommended) and the default. A test
   checks its IDs equal the manifest's voice files.
2. **Worker.**
   - Replace `PREDEFINED_VOICE_NAMES` with the list received in the load
     message.
   - The load path fetches `<id>.safetensors` for the listed voices.
   - Parse and expand lazily, keeping today's two-entry LRU for expanded
     states. Loading all 38 files eagerly (about 265 MB) is avoided: the list
     is known up front and each file is fetched on first use.
   - `voices_loaded` reports the list. `set_voice` behaves as today.
3. **Selector** (`AnimaSettingsModal`):
   - `SelectGroup` Female and Male, each labelled, recommended voices first
     with a marker, then the rest in catalog order;
   - accent tag as secondary text;
   - "Use application default" and "Custom (uploaded)" unchanged.
4. **Stale voice (R22).** In `use-tts-playback.ts`, the unknown-voice warning
   uses a session-scoped key, so it shows once per app session. The fallback
   to the default voice is unchanged.

Checks:
- unit tests for the metadata and manifest match, selector grouping and
  ordering, worker voice-list handling, and the once-per-session notice;
- `pnpm check`, `pnpm web:lint`, `pnpm web:test`, `pnpm build`;
- browser verification on a task stack at desktop size, then a narrow layout:
  grouping, recommended first, accent tags, and each source kind speaking.

#### Phase 4 results (2026-09-26)

Issue #153. Starting revision `22c571b`.

- **Worker** (`inference-worker.js`).
  - The hard-coded `PREDEFINED_VOICE_NAMES` is gone. The load message carries
    `voices` and `defaultVoice`, validated by the new `resolveBuiltInVoices` in
    `pocket-runtime.js`.
  - Only the default state loads at startup. Others are fetched on first use
    through `ensureBuiltInVoice`, which deduplicates concurrent loads.
  - At most four other compact states stay cached; the default and current
    voices are never evicted.
  - `voices_loaded` reports the full list, and `set_voice` loads on demand.
- **Core and factory.** `PocketTTSCore` passes `voices` and `defaultVoice`;
  `createPocketTTS` supplies them from `voice-catalog.ts`.
- **Selector** (`AnimaSettingsModal`).
  - `groupPocketVoices` builds labelled groups: Female, Male, and "Other
    voices" as a fallback for an unexpected reported ID.
  - The shared `SelectItem` gains a `hint` slot, shown in the list but not in
    the trigger, for "Recommended · accent".
  - Status copy uses display names (`pocketVoiceLabel`).
- **Stale voice.** The new pure `resolvePocketFallbackVoice` resolves the
  voice.
  - An unknown saved voice uses the catalog default (previously the worker's
    current voice) with a session-scoped notice.
  - The custom-voice notice stays per run.
  - `use-tts-playback` applies the notice scope.
- **Licence records.** Hashes refreshed for the three edited Pocket code files.
- **Checks:**
  - `pnpm check` and `pnpm web:lint`: pass.
  - `pnpm web:test`: 318 files and 1921 tests passed, before the label helper
    was added.
  - Speech tests: 30 passed after it.
  - Prettier: clean.
- **Browser evidence** (task stack `animama-pvc`,
  `http://animama-pvc.localhost:8600`, development mode):
  - Desktop 1024×768: 38 voices in Female and Male groups, recommended first,
    accent hints, the trigger showing only the name. Selecting Noah persisted
    the override, and the status reads "Anima override is active: Noah."
  - Mobile 375×812: the list is readable and the hints fit.
  - A standalone worker on the stack's served assets loaded in 1.6 s with only
    `eve` fetched, then synthesized "Hello there, how are you today?" with
    `noah` (1.68 s), `harriet` (1.60 s) and `caro_davy` (2.56 s). This covers
    both release-hosted-style and Kyutai states.
  - Not browser-exercised: a spoken reply in a real chat turn, which needs a
    paid model call, and the stale-voice toast (covered by unit test). Owner
    listening happens at G3.

#### Code Review #1 Findings

_Pending._

#### Code Review #1 Revisions

_Pending._

### Phase 5: Inventory, size, docs and verification

Requirements: R23, R25 and the combined acceptance. Issue #154.

Intended changes:
1. **Desktop runtime.** `desktop:runtime:stage` and `desktop:runtime:audit`
   pass. Record the core download and installed size against the 750 MiB and
   1.5 GiB caps; exceeding a cap stops for an owner decision. The staged
   `THIRD_PARTY_NOTICES.txt` includes every voice.
2. **Docs.** Update:
   - `docs/frontend/runtime/voice.md` (voice list, selector, stale-voice
     notice);
   - `docs/backend/operations/model-assets.md` (voice count, release-hosted
     states, the `scripts/voices` workflow);
   - `docs/frontend/desktop/redistribution-review.md`;
   - `src/frontend/AGENTS.md` if its Pocket notes are stale.

**Gate G3 (owner).** In the running app, the owner accepts the shipped voices
and selector. The agent first verifies the packaged desktop app
(`pnpm desktop:mac`, unsigned) and a built self-host stack with the store
acquired from the published objects.

Checks:
- `pnpm desktop:check`, `pnpm desktop:test`, runtime stage and audit,
  `pnpm desktop:mac`;
- the Compose config checks;
- the full backend and frontend suites.

Results, issue and commits: _pending_.

#### Code Review #1 Findings

_Pending._

#### Code Review #1 Revisions

_Pending._

## Final integration review

This review covers the combined spec acceptance, reusing still-valid phase
evidence. Focus:
- every shipped voice is licensed, recorded and credited;
- acquisition accepts only pinned hosts and hashes;
- the metadata, manifest and worker lists agree;
- the size record;
- docs accuracy.

_Pending._

## Validation and acceptance

| Spec acceptance | Phase and evidence |
| --- | --- |
| Inventory and no NC/unknown voices | P1 inventory, P3 licence test |
| Reproducible encoding | P1 `encode --check` and tracked hashes |
| Owner curation | G1 (D11) |
| Selector | P4 browser evidence |
| Stale-voice notice | P4 test |
| Notices | P3 notice file, P5 staged notices |
| Acquisition, packaging and size | P3 acquire after G2, P5 stage and audit |
| Owner acceptance | G3 |

Local evidence, hosted `Validation` results and owner gates are recorded
separately. None is marked passed without its evidence.

## Idempotence and recovery

- The Phase 1 tools write working files only to the untracked work directory.
  They also update tracked records: `pin` updates `sources.json`, `encode`
  updates `encoded-state-hashes.json`, and `inventory` updates
  `voice-inventory.{json,md}`. Re-running them is safe: pinned inputs make
  results reproducible, and `encode` refuses a changed state hash unless
  `--rehash` is passed.
- Core acquisition creates a new digest directory, leaving old stores intact.
  Roll back by checking out the previous manifest.
- R2 objects are content-addressed and never overwritten. A bad object is
  replaced by a new name in a new manifest.
- The database is reset for this development cycle. No preference migration is
  needed (spec non-goal).

## Outcomes & Retrospective

_Pending._
