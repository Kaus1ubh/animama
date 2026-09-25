# PocketTTS April 2026 checkpoint with mixed precision

Source agreement: [pocket-tts-april-checkpoint-spec.md](pocket-tts-april-checkpoint-spec.md)
(proposal drafted 2026-09-25 from the owner's direction of the same date).
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

- [ ] Phase 1: Offline parity spike. Not started.
- [ ] Phase 2: Assets and worker switch. Not started.
- [ ] Phase 3: Browser and desktop verification, docs, owner listening gate.
      Not started.

## Surprises & Discoveries

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
   - Apply the April text preparation and stopping rules, and temperature 0.3
     (or the owner's choice).
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
