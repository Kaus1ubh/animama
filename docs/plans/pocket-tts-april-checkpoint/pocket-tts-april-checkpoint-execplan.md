# PocketTTS April 2026 checkpoint with mixed precision

Source agreement: [raymond-van/animama#130](https://github.com/raymond-van/animama/issues/130)
as published on 2026-09-25 (snapshot: [spec](pocket-tts-april-checkpoint-spec.md)).
Phase issues: #131 (p1), #132 (p2), #133 (p3). Branch
`feat/pocket-tts-april-checkpoint` from `5630ad8`.
Authorized scope: the owner approved the plan and Phases 1–3 with the
recommended defaults on 2026-09-25.

## Purpose and context

This plan moves PocketTTS from Kyutai's January 2026 English checkpoint to
`english_2026-04`, with the precision below. Built-in voices come from Kyutai's
precomputed April voice states.

| Graph | Precision |
| --- | --- |
| `flow_lm_main` | INT8 |
| `flow_lm_flow` | FP32 |
| `mimi_decoder` | FP32 |
| `text_conditioner` | FP32 |
| `mimi_encoder` | FP32 |

After this work, the worker speaks with the April graphs, preserves the
`cosette`/`jean`/`fantine` voice names, and follows the April runtime contract.
Acquisition and packaging verify the new pinned file set.

### Orientation

Commands run from the repository root unless stated.

| Area | Files |
| --- | --- |
| Worker | `src/frontend/web/public/tts/workers/inference-worker.js`: model URLs 13-21, state shapes 1658-1737, `initState` 1739, voice conditioning `getOrBuildVoiceConditionedBaseState` 1900-1937, text path 1976-2011, AR loop 2013-2186, `prepareText` 961-1004, `parseVoicesBin` 1533 |
| Core | `src/frontend/web/src/lib/speech/pocket/core/PocketTTSCore.js` (model URLs 206-212), `createPocketTTS.ts` |
| Voice selection | `use-tts-playback.ts:746-751`, `voice-preferences.ts`, `AnimaSettingsModal.tsx:382-402` |
| Acquisition | `models/browser-speech/manifest.json`; `scripts/models/browser_speech.py` (`POCKET_ONNX`/`POCKET_OTHER` 26-33, `expected_source` 40-56, exact-count check at 80); downloads through `scripts/models/parakeet.py` `acquire` |
| Runtime inventory | `models/browser-runtime/manifest.json` (19 entries), `src/frontend/scripts/browser-runtime-assets.mjs` (count 92, model match 216-244) |
| Tests | `tests/test_browser_model_store.py` (count 8 at 56, 83), `src/frontend/web/tests/browserRuntimeAssets.test.ts` (count 19) |
| Licensing | `licenses/third-party/code-and-models.{json,md}`, `licenses/source-review.json`, `src/frontend/desktop/runtime/license-sources.json`, `src/frontend/desktop/runtime/notices/pocket-tts-*.txt` |
| Packaging | `.dockerignore:195-202`, desktop `audit.mjs` (reuses `resolveBrowserRuntimeAssets`) |
| Docs | `docs/backend/operations/model-assets.md` ("eight", "19"), `docs/frontend/runtime/voice.md` (120, 813, 830-834), `docs/frontend/architecture/content-and-workers.md:48`, `docs/frontend/features/emotional-voice-catalog.md`, `src/frontend/AGENTS.md:229` |

### Upstream facts (research 2026-09-25)

- **Bundle source.** `KevinAHM/pocket-tts-onnx` revision
  `58a6d00cf13d239b6748cb0769f35c580a8f606c`, `onnx/english_2026-04/`
  ("Add v2 bundles", 2026-04-21).
- **Graph interfaces are unchanged from January.** `flow_lm_main` still has 18
  states and emits `conditioning`, `eos_logit` and the `out_state_*` outputs.
  `flow_lm_flow` takes c/s/t/x. `text_conditioner` maps token IDs to
  `[1,seq,1024]`. `mimi_encoder` maps audio to 1024-dim `latents`, with the
  speaker projection inside the graph. `mimi_decoder` has 56 states. The
  tokenizer is byte-identical to January's.
- **`bundle.json`** (schema 2) carries the state manifests with fill rules:
  - flow LM: `cache` is filled with NaN, `current_end` is an empty `[0]`, and
    `step` starts at 0;
  - Mimi: `bool` `first` flags are ones, everything else zeros or empty.
  - Today's worker fills everything with zeros, including the Mimi `first` flags.
- **BOS row.** `bos_before_voice.npy` is `(1,1,1024)` float32. Prepend it once
  to a cloned-voice embedding before the voice-conditioning pass. It is never
  added to text.
- **April text preparation.**
  - `\n` and `\r` become spaces, and a double space collapses once.
  - No short-input space padding, and semicolons are kept.
  - Capitalization and the trailing period are unchanged.
- **April stopping rules.**
  - Frames after EOS: 5 frames when the text has 4 words or fewer, otherwise 3.
  - Maximum frames per chunk: `ceil((tokens/3 + 2) * 12.5)`.
  - EOS fires at `eos_logit > -4.0` (unchanged).
  - 50-token chunks, with each chunk restarting from the voice state.
- **Temperature.** Kyutai's `english_2026-04.yaml` uses 0.3 ("Human evals
  preferred this model at 0.3"). The reference ONNX runtime still uses 0.7.
  `lsd_steps` is 1.
- **Voice states.**
  - Source: `kyutai/pocket-tts-without-voice-cloning` (ungated, CC BY 4.0) at
    revision `4e1e0a3e611c51c0b4ed8174fc10f32a54644303`, path
    `languages/english_2026-04/embeddings/<name>.safetensors`.
  - Content: six layers of `self_attn/cache` `[2,1,T,16,64]` float32 plus an
    `offset` int64 (T = BOS + prompt frames, 126 for alba).
  - These files were re-uploaded on 2026-05-04, after the ONNX export. They are
    checkpoint-specific; January states and embeddings do not transfer.
- **Voice source licenses.** `cosette` (Expresso) and `jean` (EARS) are CC BY-NC
  4.0; `fantine` (VCTK) is CC BY 4.0.
- **ONNX weights license.** `onnx/LICENSE` is CC BY 4.0 (sha256
  `fe7b4ce8…`), corrected from CC BY-NC.
- **Known upstream issue.** Kyutai issue #175 reports garbled cloned speech
  after about 8 s at default settings. Our 50-token chunks with a per-chunk
  voice reset bound each generation well below that length.

## Progress

- [x] Phase 1: Offline parity spike. Complete 2026-09-25 (#131); mixed profile
      accepted, voice states compatible. Results below.
- [x] Phase 2: Assets and worker switch. Complete 2026-09-25 (#132); Review #2
      passed after one repair round.
- [ ] Phase 3: Browser and desktop verification, docs, owner listening gate.
      Agent verification complete 2026-09-25 (#133). The owner listening gate
      and packaged-app speech remain outstanding.

## Surprises & Discoveries

- 2026-09-25, Phase 1: the `current_end` state inputs must stay empty float32
  `[0]`. The graph rejects any other length, and voice states do not include
  them.
- 2026-09-25, Phase 1: zero-filled initial state gave bit-identical output to
  the manifest fills (NaN cache, true Mimi `first` flags). The worker still
  initializes from the manifest so it follows the bundle contract.
- 2026-09-25, Phase 1: April reads raw digits correctly. The worker's existing
  text normalization (numbers, abbreviations, whitespace, trailing period,
  capitalization) is a superset of the April text preparation, so text
  preparation is unchanged.
- 2026-09-25, Phase 1: the reference runtime stops before generating the
  latent at the stop step. The worker now stops at `eosStep + N - 1`, which
  keeps the same number of frames and guarantees a final decode.

- 2026-09-25: Uploaded Anima catalogs never reach the worker in practice.
  `PyAnimaResponse.pocket_voice_catalog_url` is never set by the backend. The
  catalog builder has no callers, and no legacy
  `/onnx/models/pocket-tts/animas/*` catalogs are tracked. Custom cloned voices
  are memory-only. Voice migration is therefore limited to the built-in voices.
- 2026-09-25: The worker initializes Mimi `first` flags to false and the KV
  caches to zeros. The April reference initializes them to true and NaN. This
  must be corrected as part of the switch.

## Decision Log

- 2026-09-25, owner: move to `english_2026-04` rather than adding FP32 parts to
  the January checkpoint.
- 2026-09-25, owner: investigate multi-threaded WASM separately in
  [raymond-van/animama#128](https://github.com/raymond-van/animama/issues/128).
- 2026-09-25, owner: approved the plan and its recommended defaults:
  - use the precomputed voice states;
  - keep three voices;
  - set temperature to 0.3;
  - use the FP32 encoder;
  - have the worker read state manifests from the shipped `bundle.json` instead
    of hardcoded shape tables.
- 2026-09-25, owner: Anima-specific voice files are out of scope (the
  catalog-builder, uploaded catalogs and the legacy per-Anima path are
  unchanged).

## Phased implementation

### Phase 1: Offline parity spike

Outcome: evidence that the pinned April graphs and voice states work together
in our chosen precision, and baseline numbers. No product change.

Steps:

1. In a scratch directory outside the repository, download the pinned April
   files and the three pinned voice states. Also download the reference runtime
   `pocket_tts_onnx.py` from the pinned bundle revision.
2. Use onnxruntime on CPU, single-threaded, to synthesize a fixed text set with
   each voice:
   - (a) the reference runtime's all-INT8 profile;
   - (b) the planned mixed profile;
   - (c) the January files (the current worker behavior, reproduced through the
     reference runtime at its January revision `4bd665d`).
   Use temperature 0.3 and 0.7 with fixed seeds. The text set covers ≤4 words, a
   medium sentence, a three-sentence paragraph, numbers and a question.
3. Check that each pinned voice state loads into the 1000-slot cache and yields
   intelligible speech. Encode a CC0 voice sample with the April encoder, with
   BOS prepended, and confirm that cloning works.
4. Transcribe each output with Parakeet (or a CPU ASR run by the same script)
   and record word error, duration and real-time factor per profile.

#### Phase 1 results (2026-09-25)

Environment: Apple M5, native onnxruntime 1.30 CPU, one intra-op thread.
Browser WASM is slower, so read the speed numbers as ratios. All 13 downloads
matched the Hugging Face sizes and SHA-256 (the `bundle.json` git blob ID).

The text set was the six prompts below, each voiced by `cosette`, `jean` and
`fantine`:

- "Hi there!"
- "Okay, sounds good."
- a weather sentence
- a three-sentence paragraph
- "It costs 42 dollars and 50 cents."
- "Can you remind me at 7:30 tomorrow morning?"

Parakeet TDT 0.6B v2 transcribed each output. "Lenient" WER normalizes number
formats on both sides.

| Profile | Temp | Strict WER | Lenient WER | Mean RTF | First audio |
| --- | --- | --- | --- | --- | --- |
| A: April all-INT8 | 0.3 | 0.145 | 0.026 | 0.130 | 40 ms |
| A: April all-INT8 | 0.7 | 0.216 | 0.074 | | |
| B: April mixed (planned) | 0.3 | 0.130 | 0.012 | 0.138 | 43 ms |
| B: April mixed (planned) | 0.7 | 0.162 | 0.020 | | |
| C: January (current) | 0.7 | 0.182 | 0.050 | 0.131 | 41 ms |

- **Profile B** had no real errors. Its remaining misses are transcription
  artefacts ("to morrow", "730", "cost"). Profile A at 0.7 turned "Hi there!"
  into "Hide it." (`jean`), and January produced "Hey there." and "to day".
- **All profiles:** nothing ran to the frame limit, and there was no silence or
  garbling.
- **Speed:** B is about 6% slower per frame than January. A precomputed voice
  state loads in about 10 ms; January's voice-conditioning pass took about
  31 ms.
- **Voice states:** compatible with the pinned graphs. Each file holds a
  per-layer `cache` `[2,1,T,16,64]` and an `offset` of T (126 for `cosette` and
  `jean`, 133 for `fantine`). That is the January prompt length plus one BOS
  row, so BOS is already included. A `fantine` state recomputed from Kyutai's
  VCTK source with our FP32 encoder, BOS and INT8 main graph matched the pinned
  state (cosine ≥ 0.9987, 1.2–5.1% relative error per layer).
- **Cloning:** a 10 s clip encodes to `[1,125,1024]` in 0.66 s, and both test
  texts transcribe perfectly. Without the BOS row the same clip produces
  unintelligible audio, so BOS is mandatory.
- **Leading silence:** April `jean` has 0.56–0.6 s before the weather sentence.
  `fantine` has about 0.3 s in every profile.

Scratch harness, WAVs and the paired January/April listening index were kept
outside the repository for the Phase 3 owner gate.

Completion: the mixed profile is intelligible for all voices. It is not worse
than all-INT8 on word error. The voice-state revision is confirmed compatible,
and results are summarized in this plan. WAVs stay in scratch for the owner's
listening gate. If the pinned states are incompatible, stop and return to the
owner. The fallback is encoding the Kyutai source audio into our embedding
format.

### Phase 2: Assets and worker switch

Outcome: the app acquires, verifies, serves, packages and runs the April file
set.

1. **Acquisition.** Update the model manifest and `browser_speech.py`:
   - eleven Pocket files: five ONNX, `tokenizer.model`, `bos_before_voice.npy`,
     `bundle.json`, and a `voices/` group of three `.safetensors` files. With
     Smart Turn, the store holds twelve files (up from eight) and the runtime
     inventory 23 entries (up from 19);
   - exact sources, sizes and hashes;
   - no `voices.bin`.
   Update the fixed-count checks and tests by TDD: the tests assert the new
   inventory first.
2. **Runtime inventory.** Update `models/browser-runtime/manifest.json` and
   `browser-runtime-assets.mjs` counts and model matching, plus
   `browserRuntimeAssets.test.ts`.
3. **Worker.**
   - Load `bundle.json`. Initialize flow LM and Mimi state from its manifests,
     including the NaN, empty and ones fills. Delete the hardcoded state tables.
   - Load the built-in voices as KV-cache states: parse safetensors, copy the
     cache into a NaN-filled 1000-slot tensor, and set `step` from `offset`.
     These states replace the voice-conditioning pass for built-in voices.
   - Prepend the BOS row to encoded custom voices before conditioning. The
     Anima catalog paths are out of scope and stay unchanged.
   - Apply the April stopping rules and temperature 0.3. Text preparation is
     unchanged; see Surprises & Discoveries.
   - Keep the public message protocol (`load`, `generate`, `encode_voice`,
     `set_voice`, `voices_loaded`) and the voice names unchanged.
   - Update the model URLs in `PocketTTSCore.js`.
4. **Pure-function tests.** Extract the new pure helpers into a small ES module
   imported by the worker, with Vitest coverage:
   - safetensors parsing;
   - state-manifest initialization;
   - text preparation;
   - the frames-after-EOS and maximum-frames rules.
   The worker is a static public script, so keep the module beside it under
   `public/tts/workers/`.
5. **Licensing.**
   - Replace `pocket-tts-onnx-license.txt` with the pinned CC BY 4.0 `onnx/LICENSE`.
   - Update the attribution notice, the inventory JSON and Markdown, the
     license sources and the source review for the new revisions and the voice
     sources' licenses.
   - Keep the noncommercial election.
6. **Checks:**

   ```bash
   uv run pytest -q tests/test_browser_model_store.py tests/test_pocket_voice_catalog.py
   uv run ruff check
   python3 scripts/models/browser_speech.py acquire
   ```

   Then, from `src/frontend`:

   ```bash
   pnpm check && pnpm web:lint && pnpm web:test && pnpm build && pnpm desktop:check
   ```

Recovery: the new content-addressed store directory leaves the January store
intact, so reverting the commit restores January behavior after `acquire`.

#### Phase 2 results (2026-09-25)

Changes:

- **Acquisition:** twelve pinned files in `models/browser-speech/manifest.json`
  and `scripts/models/browser_speech.py`, with per-file licenses. The runtime
  inventory is 23 files. `.dockerignore` lists the new public paths.
- **Worker:**
  - The new `pocket-runtime.js` module holds the pure helpers:
    manifest state, safetensors voice states, BOS, `.npy` parsing and
    generation limits.
  - `inference-worker.js` reads `bundle.json` and checks that its manifests
    match the sessions' state inputs.
  - It loads built-in voices as precomputed states and prepends BOS for
    embedding voices.
  - It uses temperature 0.3, frames after EOS of 5 or 3, and a per-chunk
    `ceil((tokens/3+2)*12.5)` frame bound. It flushes pending audio when that
    bound is reached without EOS.
  - `PocketTTSCore.js` no longer duplicates the worker's model URLs.
- **Licensing:**
  - Rewrote the Pocket attribution and ONNX license notices (pinned CC BY 4.0
    text) and updated the manifest notice hashes.
  - Updated `license-sources.json`, `code-and-models.{json,md}`, the browser
    code attribution for `pocket-runtime.js`, `licenses/README.md` and
    `redistribution-review.md`.
  - The noncommercial basis now rests on the `cosette` and `jean` source
    voices.
  - Kept the release-policy field `pocket_tts_onnx_license: "CC-BY-NC-4.0"`.
    Its value still holds, and renaming it would change the release-policy
    schema. `licenses/source-review.json` is refreshed at release review.
- **Docs:** file counts and the Pocket asset description in `model-assets.md`,
  `voice.md`, `content-and-workers.md` and `src/frontend/AGENTS.md`.

Local validation:

| Check | Result |
| --- | --- |
| `python3 scripts/models/browser_speech.py acquire` (real downloads) | Passed; all hashes verified |
| `python3 scripts/models/browser_speech.py verify` | Passed |
| `uv run pytest -q tests/test_browser_model_store.py` | 18 passed |
| `uv run ruff check`; `ruff format --check` on the changed Python | Clean |
| `pnpm check`; `pnpm web:lint` | Passed |
| `pnpm web:test` | 298 files, 1788 tests passed, including 9 new `pocketRuntime` tests |
| `pnpm verify:tts-assets` | 23 files, 324,742,733 bytes |
| `pnpm build` | Passed |
| `pnpm desktop:check`; `pnpm desktop:test` | 303 tests passed |
| `python3 -m unittest discover -s scripts/public-release -p 'test_*.py'` | 12 OK |
| Prettier on the changed web files | Clean |

The repository-wide `prettier:check` still flags 11 files that this change does
not touch.

Browser smoke test: Chromium browser pane, `vite preview` of the build, direct
worker, single-threaded WASM because the page is not cross-origin isolated.

| Measure | Result |
| --- | --- |
| Model and voice load | 1.1 s |
| Real-time speed factor | 1.37–1.88× (RTF 0.53–0.73) |
| Time to first audio | 213–333 ms |
| NaNs and errors | None |
| Leading silence | `jean` 0.35 s, `fantine` 0.33 s |

The run covered all three voices, a two-word prompt and a three-sentence
paragraph (10 s of audio).

#### Code Review #1 Findings

Independent reviewer (`sdlc-reviewer`), initial round. Reviewed source: the
staged Phase 2 index on top of `d21db6f`.

- **R1-F1 (required):** `docs/frontend/desktop/runtime-staging.md:87,130`
  still said 19 runtime assets and eight model files.
- **R1-F2 (optional, performance):** the worker expanded all three built-in
  voices into full 1000-slot states at load. That keeps about 147 MB resident
  (49 MB each) and bypasses the two-entry conditioned-state LRU.
- **R1-F3 (optional, fail-clearly):** `stateArraysFromVoiceState` accepted a
  missing `cache`, a missing `offset`, or an `offset` that does not match the
  cached positions. `parseSafetensors` did not check byte length against the
  declared shape.
- **R1-N1 (optional):** loading zero built-in voices still reported ready.
- **R1-N2 (optional):** `.dockerignore` dropped the January payload names, so
  legacy copies in an older checkout would enter the build context and fail the
  built-inventory check.

The reviewer verified the remaining areas without defects:

- safetensors, cache-copy, `.npy` and BOS math against the real files;
- the stop logic, including the final `isLast` flush;
- ORT tensor reuse under the `wasm` execution provider;
- manifest validation, voice message paths, hashes, licensing and boundaries.

#### Code Review #1 Revisions

All five findings were accepted:

- **R1-F1:** updated both counts to 23 and twelve.
- **R1-F2:** built-in voices keep their parsed compact tensors (about 6 MB
  each). They expand into full state on first use through the existing LRU,
  keyed `legacy:<voice>`.
- **R1-F3:** `stateArraysFromVoiceState` now requires `cache`, and `offset`
  equal to the cached positions. `parseSafetensors` rejects shape and byte
  mismatches. Four new Vitest cases, written first and seen failing, now pass
  (13 in the file).
- **R1-N1:** the load now fails with "No built-in Pocket voices could be
  loaded".
- **R1-N2:** the January names are ignored again, under a comment.

`code-and-models.json` hashes were refreshed for the two changed worker files.

Verification:

- `pnpm exec vitest run tests/speech tests/browserRuntimeAssets.test.ts`: 30
  passed.
- `pnpm build`: passed.
- Browser re-smoke:
  - worker load 0.75 s;
  - `cosette` and `fantine` at 1.9–2.2× real time, first audio 181–222 ms,
    final `isLast` set;
  - custom voice encoded to `[1,125,1024]` and spoke 3.5 s with BOS.

Repair rounds used: 1 of 2.

#### Code Review #2 Findings

Targeted recheck of the Review #1 revisions by the same reviewer. Result:
**pass**.

- R1-F1, R1-F2, R1-F3, R1-N1 and R1-N2 are fixed.
- The inventory hashes match the working files.
- The real pinned voice files pass the stricter validation.
- Tests: 26 passed in `pocketRuntime` and `browserRuntimeAssets`.

- **R2-N1 (optional):** voice-state shape and offset mismatches now surface
  on the voice's first generation, as a clear generation error, rather than at
  load. Deferred: the inputs are hash-pinned and verified before serving, so
  earlier validation would add load-time cost for no practical benefit.

### Phase 3: Browser and desktop verification, docs, owner gate

1. Restart this worktree's stack with `./reset.sh --name ptts --base-port <free>`
   after acquisition.
2. In the browser pane, drive the worker directly for every voice across the
   Phase 1 text set:
   - measure time to first audio and real-time factor;
   - check that the audio is not silent;
   - transcribe with the in-app Parakeet runtime and compare against the text.
   Then run a normal chat reply with PocketTTS selected and check avatar
   lip-sync.
3. Encode a custom voice from a 10-second clip and speak with it.
4. Run the packaged desktop build and audit (`pnpm desktop:check` and the
   runtime audit), and confirm that PocketTTS speaks in the packaged app.
5. Update the docs listed in Orientation. Describe current behavior: the new
   file set, the counts and the voice-state format.
6. **Owner listening gate.** Provide paired January and April samples for the
   same texts and voices (from Phase 1), at temperatures 0.3 and 0.7. The owner
   accepts quality and confirms the temperature before the PR is marked ready.

#### Phase 3 results (2026-09-25)

Source: `899bdcd`, with this plan update. Stack `animama-ptts` (development
mode, base port 8400) serves the application at `http://localhost:8400`. Only
`web` publishes a port; PostgreSQL and the server stay private.

**Browser ASR round trip.** The browser pane previewed the build at
`127.0.0.1:4199`, and the January baseline (the same build with the
`d21db6f` worker and January store files swapped in) was served at `:4198`.
Each ran the 6 × 3 Phase 1 text and voice set through the worker directly.
Audio was posted to a local receiver and transcribed with Parakeet TDT 0.6B v2.

- **April passes:** every sample stays within one word error per sentence,
  with one exception. `fantine` "7:30 tomorrow" transcribes as "seven thirty
  to morrow". That is a transcription split of "tomorrow" (two tokens), and
  January produces the identical transcript.
- **Remaining April misses:**
  - `cosette` "Hi there!" → "Okay there." (January identical);
  - `cosette` "costs" → "cost";
  - `jean` "today" → "to day" (January identical).
- **No regression:** April matches or improves on January for every clip.

**Speed.** Both runs used single-threaded WASM without throttling:

| | January | April |
| --- | --- | --- |
| Mean real-time factor | 2.28× (every clip at least 1.9×) | 2.25× (every clip at least 1.93×) |
| Time to first audio, excluding the first prompt | about 170 ms | 177 ms mean |
| Time to first audio, first prompt per voice | 488–588 ms | 163 ms mean |

- **Budget:** met. Speed is well below RTF 1.0, and first audio is within +25%
  of January.
- **First prompt:** January pays for voice conditioning on each voice's first
  use. April's precomputed states avoid that.
- **Hidden pane:** repeated runs while the browser pane was hidden slowed
  both profiles equally (0.35–0.43×), so they are excluded as environmental.

**Custom voice.** A 10 s clip encoded to `[1,125,1024]`, and generation with
BOS produced 3.5 s of speech. Phase 1 showed that cloned audio without BOS is
unintelligible.

**In-app chat.** In the `animama-ptts` app, the TTS provider was set to
PocketTTS and two replies were sent to Annie (model `gpt-5.6-luna`). A
`Worker.prototype.postMessage` tap on the second reply recorded:

- `set_voice cosette`, then `generate` of the reply text;
- first audio chunk 330 ms after `generate`;
- 3-frame then 12-frame audio chunks, and a final chunk with `isLast`;
- `generation_finished` with 5.92 s of audio at 2.0× real time;
- `build_viseme_assets_from_raw` requests for lip-sync;
- a speaking avatar in the screenshot, and no errors.

**Desktop packaging:**

| Step | Result |
| --- | --- |
| `pnpm desktop:runtime:stage -- --platform darwin --arch arm64` | Passed; run with a task-owned `UV_CACHE_DIR` because the shared `/private/tmp/animama-uv-cache` had a partially deleted `pluggy` wheel |
| `pnpm desktop:runtime:audit -- --platform darwin --arch arm64` | OK: 5,344 files, none missing or unexpected; core download 430,329,452 of 786,432,000 bytes; installed 1,029,281,251 of 1,610,612,736 bytes; native backup restore preserved |
| `pnpm desktop:mac` | Built the unsigned `release/mac/Animama.app`; runtime inventory OK; contains the eleven April Pocket files |

**Not performed:**

- **Speech in the packaged app.** Launching the packaged app would use the
  owner's real Application Support profile, and native acceptance calls for a
  separate macOS account.
- **Multi-threaded WASM:** tracked in #128.

**Owner gates outstanding:**

1. Listening acceptance and temperature confirmation. Paired January, April
   0.3 and April 0.7 clips, plus cloned samples, are on a local listening page
   (scratch, outside the repository).
2. PocketTTS speech in the packaged app on a disposable profile.

## Final integration review

Pending.

## Validation and acceptance

See the spec's acceptance criteria. Record the exact commands, results and the
machine. Keep local, browser and desktop evidence separate.

## Idempotence and recovery

- `browser_speech.py acquire` is idempotent and content-addressed. Old stores
  are not deleted.
- The worker change is a single revertible commit series. There is no
  persistent data migration: voice preferences keep the same names, and custom
  voices are memory-only.

## Outcomes & Retrospective

Pending.
