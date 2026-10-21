# Deliver multilingual offline speech recognition

Source agreement: [spec](multilingual-speech-recognition-spec.md) for issue
#509, accepted by the owner on 2026-10-14 by requesting this plan after the
intent-discovery decisions D1–D12
([brief](https://github.com/raymond-van/animama/issues/509#issuecomment-6171691667)).
Spec questions Q1–Q7 stay open and are decided at gate G1.
Authorized scope: the whole plan (owner instruction to implement, 2026-10-14).
Gate G1 stops work after Phase 2 until the owner records the model decision.
Branch: `feat/multilingual-speech-recognition` in its own worktree, created from
`main` at `b943a908` and fast-forwarded to `0019e280` on 2026-10-14.
Delivery: #509 holds the published spec (2026-10-14T15:53:03Z); phase
sub-issues #535 (Phase 1), #536 (Phase 2), #631 (Phase 3), #632 (Phase 4),
#633 (Phase 5) and #634 (Phase 6), each blocked by the one before. One PR for
the plan; it lists `Closes #N` only for issues it delivers.

## Purpose and context

Offline dictation and Voice Mode understand Japanese, Korean, Mandarin Chinese
and English, choosing the engine by the conversation language (the UI Locale,
ADR 0024). Phases 1–2 measure SenseVoice-Small and Nemotron 3.5 ASR against
Parakeet v2 and stop for the owner's choice (G1). Phases 3–6 ship the chosen
model the way Parakeet ships: a verified asset set downloaded in the app, an
onnxruntime-web worker on the CPU and WebGPU paths, and language-aware settings.

Paths are relative to `src/frontend/web/src/` unless they start with `src/`,
`docs/`, `tests/`, `models/`, `scripts/` or `licenses/`.

| Area | Entry points |
| --- | --- |
| Parakeet engine | `lib/speech/client-parakeet/{assets,client,worker-protocol,webgpu,lease,preview-controller}.ts`, `workers/client-parakeet-worker.ts` (listed in `src/frontend/knip.json`), `parakeet.js` 1.4.4 on the app's `onnxruntime-web` (numThreads 1, SIMD; JSEP for WebGPU) |
| Dictation | `hooks/use-dictation.ts` (`startDictation`, `startParakeetDictation` ~1831, `transcribeParakeetSpeechWindow` ~1543, `normalizeSmartTurnOverrideText` 287), `hooks/voice/mic-vad-runtime.ts` (`VadSttProvider`, line 316), `lib/types/voice-types.ts` (`SttSegmentSource`) |
| Provider and language | `lib/speech/{stt-provider,stt-settings,speech-language}.ts`, `lib/settings/preferences.ts` (`stt_provider`, `stt_parakeet_webgpu`), `ui/settings/SpeechLanguageNotice.tsx` |
| Settings and Setup | `ui/sidebar/ApplicationSettingsModal.tsx` (STT section, `stt-downloads`), `ui/settings/{OfflineSpeechDownloads,VoiceDownloads}.tsx`, `app/local-runtime/setup/{SetupSpeechDownloads,SetupVoiceStep}.tsx`, `ui/main/chat/ChatInterface.tsx` (`speechAvailable`), `query/model-download-coordination.ts`, `query/hooks/useModelAssets.ts` |
| Catalogs | `locales/<locale>/{voice,setup,app,settings}.json`; `src/frontend/i18n/terms.json`; `pnpm i18n:extract`, `i18n:check`, `i18n:status` |
| Capabilities | `src/backend/animama/app/contracts/runtime_capabilities.py`, `server/runtime_capabilities.py`, `product_http/routes/runtime_capabilities.py`, generated SDK (`pnpm openapi-ts`), `contracts/runtime-capabilities/hosted.json`, web fixtures |
| Model assets | `src/backend/animama/server/model_assets.py` (`parakeet_availability`, mounts), `local/http/assets.py` (`MODEL_MOUNT_PATHS`), `server/config.py`, `resources/model-assets.v1.json`, `app/services/model_asset_service.py`, `domain/model_assets.py` |
| Acquisition | `scripts/models/{parakeet,parakeet_webgpu,release_inputs}.py`, `scripts/models/README.md`, `reset.sh` (`resolve_optional_model`), `scripts/local-stack-state-common.sh`, `docker-compose.development.yml`, `web/vite.config.ts` + `web/vite-plugins/local-parakeet-models.ts` |
| Publication and notices | `src/frontend/desktop/scripts/runtime/{optional-inputs,model-publication,release-models}.mjs`, `licenses/third-party/code-and-models.{md,json}`, `licenses/source-review.json`, `desktop/runtime/license-sources.json`, `desktop/runtime/notices/`, `desktop/scripts/runtime/audit.mjs`, `vite.config.ts` `modelNoticeRoots` |
| Turn-taking | `lib/voice/smart-turn-short-utterance-overrides.ts`, Smart Turn and MicVAD workers |
| Benchmark | `web/speech-bench.html`, `dev/speech-bench/*`, `src/frontend/scripts/speech-bench.mjs` (`pnpm speech:bench`), `scripts/speech-eval/` (development-only; built output must not contain it) |

Boundaries:

- Recognition stays in the browser worker; no native sidecar, no cloud (D1).
- Startup and builds never download models; only `scripts/models` and the
  in-app model-asset service do.
- Stored preference values (`stt_provider: "parakeet"`, `stt_parakeet_webgpu`)
  keep their names; no database or Alembic change is expected.
- Test-set audio and evaluation model files stay outside the repository
  (`ANIMAMA_SPEECH_EVAL_ROOT`, default under the per-OS model cache). Common
  Voice data may not be re-hosted.
- Generated SDK and router output are regenerated, never hand-edited.

## Progress

- [x] 2026-10-14 Discovery brief posted to #509; spec drafted and accepted by
      requesting this plan.
- [x] Phase 1 — Benchmark harness, test set and Parakeet baseline (#535):
      review passed 2026-10-20 (three rounds); committed `02f44b3e`.
- [x] Phase 2 — Candidate engines and comparison report (#536): review passed
      2026-10-21 (two rounds); committed `73913350`. G1 recorded 2026-10-21.
- [x] Phase 3 — Multilingual model asset set (#631): review passed 2026-10-21
      (initial review and two repair rounds); committed `abe7dba4`.
- [x] Phase 4 — Engine integration and language routing (#632): review
      passed 2026-10-21 (re-tiered high risk; initial review and two repair
      rounds); committed `5974b113`. App-path transcription moves to the
      Phase 5 smoke check.
- [ ] Phase 5 — Settings, Setup, language notice and turn-taking (#633).
      Implemented and smoke-checked 2026-10-21 (results below); the
      microphone-path short-reply findings go to G4. Review passed with
      non-blocking findings, all addressed (Code Review #1).
- [ ] Phase 6 — Acceptance runs, packaging checks and documentation (#634).
- [ ] Final integration review.

## Surprises & Discoveries

- 2026-10-14: Common Voice moved to Mozilla Data Collective in October 2025.
  Taiwan Mandarin (`zh-TW`, v25.0, about 2.95 GB, CC0) needs an account and
  acceptance of terms that forbid re-hosting, so it cannot be fetched by a
  script. FLEURS (`google/fleurs`, revision `70bb2e84`) is ungated but has no
  Taiwan Mandarin. See gate G0.
- 2026-10-14: `desktop/scripts/runtime/optional-inputs.mjs` (`modelManifest`,
  line 60) accepts only `CC-BY-4.0` model manifests. SenseVoice (FunASR Model
  License v1.1) and Nemotron (OpenMDW-1.1) need that check generalized.
- 2026-10-14: The Smart Turn short-reply normalization is ASCII-only (`\w`
  without the `u` flag) and duplicated in `use-dictation.ts:287`, so any
  Japanese, Korean or Chinese entry would normalize to an empty string.
- 2026-10-14: The Parakeet worker runs on the app's `onnxruntime-web` (1.24.3 in
  the lockfile); the pinned public copy at `/onnx/ort/1.24.2/` serves MicVAD and
  Smart Turn. New engines should share the worker's ORT copy, not add a third.
- 2026-10-14: `SetupVoiceStep.tsx:61` passes `provider="parakeet"` to
  `SpeechLanguageNotice` unconditionally.
- 2026-10-14: FLEURS test clips are 16 kHz mono IEEE-float WAV and mostly long
  read sentences (median 9.5–12.5 s); 1–15 s clips leave 210–331 distinct
  sentences per language, enough for 75.
- 2026-10-20: Peak memory varies up to twofold between identical runs (for
  Parakeet on WASM, 2.3 and 4.5 GB clip-phase peaks), apparently with
  garbage-collection timing; an earlier reading of steady WebGPU growth did not
  repeat. The benchmark therefore also reports the median footprint while
  transcribing, and comparisons use it.
- 2026-10-20: Nemotron 3.5 on the app's onnxruntime-web 1.24 runs only on
  WASM. The onnx-community INT4 export returns empty transcripts on WebGPU but
  correct ones on WASM (where it is slower than real time), and the sherpa INT8
  export fails on WebGPU (`Concat` kernel: "non concat dimensions must match").
  Creating its WebGPU and WASM sessions in parallel also raced ORT's
  initialization ("multiple calls to 'initWasm()'"); the adapter creates them
  one after another.
- 2026-10-20: Nemotron's `zh-TW` language prompt produced only noise on
  Mandarin speech, so `zh-Hant` uses `zh-CN` plus OpenCC conversion, like
  SenseVoice.
- 2026-10-21: SenseVoice's FP32 graph does not convert cleanly to FP16
  compute: `onnxconverter-common` 1.16 and ONNX Runtime 1.23's converter leave
  the graph's own Cast-to-float nodes (layer norms, masks) and a `Range` output
  inconsistent, so sessions fail or WebGPU returns empty text. Storing only the
  weights as FP16 with load-time casts works (470 MB; on WebGPU the same error
  rates and latency as FP32), but it is a converted file with no upstream
  source.
- 2026-10-21: animama-cloud's hosted browser resources accept only the catalog
  IDs they know (`services/hosted-api/src/animama_hosted/content/browser_resources.py`,
  `MODEL_IDS` and the asset loop, plus `artifacts/application.py`). Once Cloud
  repins to an Animama release whose catalog has `sensevoice-stt`, the hosted API
  refuses to start until Cloud supports or skips the new sets; this needs a
  Cloud change before that repin.
- 2026-10-21: The browser runtime cannot read ONNX `metadata_props`, so the
  SenseVoice CPU set carries `metadata.json` (frame stacking, CMVN, prompt ids),
  identical for the INT8 and FP32 graphs apart from the quantizer's key.
- 2026-10-21: SenseVoice marks word starts with SentencePiece `▁` in
  Japanese and Chinese too, so the decoded text read "軍島や 湖で は…" in the
  first app-path run. The benchmark's CER ignores whitespace, so Phases 2 and 4
  never showed it; the decoder now removes spaces beside Chinese or Japanese
  text (the rule transcript joining already used) and keeps Korean spacing.
- 2026-10-14: The desktop app's Electron 39.8.9 runs Chromium 142, while
  Playwright's bundled Chromium is 145, so the benchmark runs in Electron.
- 2026-10-14: Parakeet's WebGPU (FP16 encoder) English WER is 3.8% against 4.1%
  for the INT8 encoder on WASM; WASM decodes at 0.31× real time, so a 10 s
  window waits about 3 s for its final text.

## Decision Log

- 2026-10-14, owner (discovery): D1–D12 as recorded in the spec.
- 2026-10-14, owner: the spec is accepted by requesting the ExecPlan; Q1–Q7
  remain open for G1.
- 2026-10-14, owner: implement the plan (`/implement`). Work proceeds through
  Phase 2 and stops at G1; phase issues for Phases 3–6 are created after G1.
- 2026-10-14, agent (plan): the comparison extends the existing
  development-only `parakeet-bench` page instead of an out-of-repo lab, so the
  harness is reviewable and reusable for later acceptance runs.
- 2026-10-14, agent (plan): every R1 run treats one test clip as one speech
  window. Latency is measured from the moment the last audio sample is
  delivered, with audio paced in real time when interim text or streaming is
  measured, so window and streaming engines are compared on the same basis.
- 2026-10-14, agent (plan): reference transcripts are read from the fetched
  datasets at run time; only clip identifiers, dataset revisions and selection
  rules are tracked.
- 2026-10-14, agent (Phase 1): accuracy and window-engine final latency come
  from `throughput` runs; interim text and streaming final delay come from
  real-time `paced` runs. A streaming engine's throughput final delay is derived
  from its per-chunk timings (`streamTailLatencyMs`, which lets a partial last
  chunk arrive when the audio ends), exact for one serial worker. The `parakeet-bench` page is replaced rather than kept beside
  the new benchmark.

- 2026-10-20, owner: G0 resolved with the fallback; no Common Voice download.
- 2026-10-20, agent (Phase 2): with the G0 fallback, `zh-Hant` reuses the 75
  Mainland Mandarin clips (`sameClipsAs`), and the page converts both the
  engine's output and the Simplified reference to Taiwan Traditional with
  OpenCC (`opencc-js` 1.4.2, `cn2t`); `yue` output is converted the same way
  (revised by Code Review #1). `import-common-voice` and the Common Voice source
  were removed as unused. Real-time paced runs use the first 20 clips of each set; accuracy and
  CPU latency use all 75 in throughput runs. Engines receive the set id as the
  app locale.
- 2026-10-20, agent (Phase 2, Code Review #1): streaming engines receive the
  same 512-sample MicVAD frames as window engines and encode each chunk as soon
  as its mel frames are complete; `streamTailLatencyMs` takes per-frame timings.
  Cantonese is converted to the Taiwan standard like `zh-Hant`, which matches
  the FLEURS Cantonese references and what the app would show under `zh-Hant`
  (D9). `opencc-js` stays a development dependency until Phase 4 uses it.
- 2026-10-21, owner (G1): accepted the Phase 2 recommendation. SenseVoice-Small
  serves `ja`, `ko`, `zh-Hans` and `zh-Hant`, with Cantonese under `zh-Hant`;
  Parakeet stays the English engine (D8 not met: 7.9% against 4.1% WER).
  Nemotron is not pursued. Interim text on WebGPU only. GPU add-on (Q5): a
  WebGPU set, trying an FP16 graph in Phase 3 and falling back to the 938 MB
  FP32 graph. Targets (D10, this test set on the reference Mac): CER at most
  8% `ja`, 11% `ko`, 8.5% `zh-Hans` and `zh-Hant`, Cantonese 8% informative;
  final text p90 at most 2.2 s on WASM and 0.25 s on WebGPU; WebGPU first
  interim p50 at most 0.8 s; English unchanged. Q1 engine-neutral offline
  labels; Q2 Setup offers the SenseVoice set under a non-English locale; Q3 a
  locale change applies from the next start; Q4 no memory limit, medians
  reported; Q6 ADR 0025; Q7 runtime downloads, not bundled.
- 2026-10-21, agent (G1 follow-up): following Parakeet's naming, the sets are
  `models/sensevoice-small/` (asset `sensevoice-stt`, CPU INT8) and
  `models/sensevoice-small-webgpu/` (asset `sensevoice-stt-webgpu`), engine id
  `sensevoice`. Phase 4 item 6 (English default) does not apply.
- 2026-10-21, owner (Q5 follow-up): the WebGPU add-on uses the upstream FP32
  graph (938 MB) as pinned, like Parakeet's upstream-only sets, rather than a
  converted FP16-weight file or an unvetted third-party FP16 upload.
- 2026-10-21, agent (Phase 3): the manifest licence is
  `LicenseRef-FunASR-Model-License-1.1`; the store, desktop input and catalog
  checks take a set's reviewed licence instead of assuming CC BY 4.0. The CPU
  set's default `acquire` reads Animama's objects like Parakeet's
  (`SHARED_MODEL_IDS`); until G2, development uses `--source upstream`.
  `ANIMAMA_PARAKEET_SOURCE` keeps its name and now selects both engines' sets;
  `ANIMAMA_SENSEVOICE_STT_ENABLED` gates SenseVoice like
  `ANIMAMA_PARAKEET_STT_ENABLED`. Runtime capabilities add
  `offline_multilingual_speech_enabled` and its two versions, defaulting to
  off so existing adapters stay valid. Hosted builds do not list the SenseVoice
  sets until Cloud supports them.
- 2026-10-21, agent (Phase 4): both engines share one page-side lifecycle in
  `lib/speech/offline-stt/` (`createOfflineSttClient`: worker, `?v=` pinning,
  leases, idle disposal, WebGPU probe and fallback; the worker protocol
  `offline_stt/*`; the worker runtime; leases, WebGPU selection and the preview
  controller, moved there from `client-parakeet`) instead of a second copy of
  Parakeet's client. `client-parakeet` keeps its exports as a configuration of
  it; `client-sensevoice` adds its assets, model module (promoted from the
  Phase 2 adapter) and client. Each engine keeps its own worker.
- 2026-10-21, agent (Phase 4): the stored `stt_provider: "parakeet"` keeps
  meaning offline recognition, and the dictation hook's provider stays
  `"parakeet"` for either engine, so turn-taking, Smart Turn and stored
  preferences are unchanged; `VadSttProvider` therefore does not change. The
  engine and language come from `routeOfflineSpeech` when a session starts (a
  resumed Voice Mode session keeps them), segments name their engine
  (`SttSegmentSource` gains `"sensevoice"`), and the GPU setting applies to
  both engines.
- 2026-10-21, agent (Phase 4): `zh-Hant` prompts SenseVoice with automatic
  language detection so Cantonese and Mandarin speakers both get text; the
  worker converts Chinese under `zh-Hant` to the Taiwan standard, loading the
  OpenCC tables on first use, so `opencc-js` is again a runtime dependency.
  Transcript joining adds no space beside Chinese or Japanese text. The three
  dictation errors that named Parakeet are engine-neutral, and a missing
  multilingual set has its own message.
- 2026-10-21, agent (Phase 4): the benchmark drops the Nemotron adapter and
  streaming support; its SenseVoice adapter drives the production worker
  (revised by Code Review #1) from the app's model routes, plays `yue` under
  `zh-Hant`, and converts only Simplified references, since the engine already
  writes Traditional script.
- 2026-10-21, agent (Phase 5, Q1/Q2): the Settings choices read "Offline
  (CPU)" and "Offline (WebGPU · Experimental)" and their description names the
  UI Locale's model. Settings lists both engines' sets under the languages they
  serve, the UI Locale's first; Setup and the composer's install hint offer
  only the UI Locale's engine (`routedOnly`). Setup's tab labels and
  description follow that engine, so it no longer shows a language notice.
- 2026-10-21, agent (Phase 5, R5): `SpeechLanguageNotice` asks for the
  language's download when the offline choice is selected under a non-English
  locale and the runtime reports no SenseVoice set, or says the server does not
  provide it where the operator manages models; Pocket TTS keeps its notice.
  The option's own "not installed" reason stays for Parakeet only, so a missing
  SenseVoice set shows one warning. Like dictation, Settings keeps a saved
  offline choice selected rather than displaying a browser recognizer when
  only the language's set is missing; both use `resolveRoutedSttProvider`
  (Code Review #1). A set that is installed but turned off gets the "not
  available on this server" wording instead of a download prompt.
- 2026-10-21, agent (Phase 5, R6): Smart Turn's short replies gain Japanese,
  Korean and Chinese (including Cantonese 唔該 and 係, plus 系, the character
  SenseVoice writes for 係) entries, compared after one shared NFKC,
  punctuation-free normalization. Words that also open a longer turn while the
  speaker thinks are left out: 嗯, 어, ええ, そうだね, そうですね and 아니
  (Code Review #1).

## Owner gates

- **G0 — Taiwan Mandarin test data (Phase 1).** The owner creates a Mozilla Data
  Collective account, accepts the Common Voice terms, downloads Common Voice
  Scripted Speech (latest) Chinese (Taiwan), and gives the agent its local path.
  If declined, `zh-Hant` is measured on FLEURS Mandarin with references
  converted to Traditional, and the report says Taiwan accents were not tested.
  Blocks only the `zh-Hant` accuracy figures.
- **G1 — Model decision (end of Phase 2).** The owner records the chosen model,
  whether it also serves English (D8), the numeric accuracy and latency targets
  (D10), any GPU add-on budget (Q5) and answers to Q1–Q4, Q6 and Q7. Blocks
  Phases 3–6.
- **G2 — Shared-object publication (release).** The owner publishes the new
  set's objects to `downloads.animama.ai` with
  `pnpm --filter animama-desktop models:publish -- --model <id>`. Until then,
  development uses `scripts/models/<engine>.py acquire --source upstream`, and
  packaged or built-mode downloads cannot complete. After publication, drop
  the `--source upstream` hint in `reset.sh` and the SenseVoice spec's
  `acquireArgs` in `optional-inputs.mjs`. Recorded in the PR; does not block
  phase progression.
- **G3 — Windows smoke check.** On the owner's Windows machine, a desktop build
  installs the set and transcribes Japanese on the CPU path.
- **G4 — Live check on the reference Mac.** The owner tries dictation and Voice
  Mode under each non-English locale, with live speech or played clips,
  including one-word replies such as 네 and Cantonese 係 (the Phase 5 smoke
  check misread both from synthetic voices through browser capture).

G2–G4 do not block phase progression; outstanding ones are recorded in the PR.

## Phased implementation

Every phase: tests first where behavior is observable; the phase's checks;
bounded independent review (`sdlc-reviewer`: one full review, at most two repair
rounds) recorded below; commits `<type>(speech)[p#]: <summary>`. New UI strings
get English plus `ja`, `ko`, `zh-Hans` and `zh-Hant` translations using
`src/frontend/i18n/terms.json`, with placeholders preserved.

Review tiers ([SDLC](../../../SDLC.md#review-tiers), added 2026-10-20): Phase 1
standard; Phase 2 high risk (adds the Chinese script converter dependency);
Phase 3 high risk (shared contracts, generated client, packaging and release
inputs); Phase 4 high risk (re-tiered by its Code Review #1: it ships
`opencc-js` in the app and decides whether dictation audio may leave the
device); Phase 5 standard; Phase 6 light, covered by the final integration
review.

### Phase 1 — Benchmark harness, test set and Parakeet baseline (R1)

Dependencies: workspace setup; G0 for the Taiwan Mandarin subset.

Changes:

1. `scripts/speech-eval/` (Python standard library, like `scripts/models`):
   - `testset.json`: dataset name, pinned revision and split, and a seeded,
     deterministic selection of 75 clips per language (en, ja, ko, Mainland
     Mandarin, Taiwan Mandarin; optional Cantonese for D9), 1–15 s long. Clip
     identifiers only.
   - `fetch`: downloads the FLEURS `test` archives and TSVs for `en_us`,
     `ja_jp`, `ko_kr`, `cmn_hans_cn` (and `yue_hant_hk`) at the pinned revision
     into `ANIMAMA_SPEECH_EVAL_ROOT`, verifies their SHA-256, and extracts the
     selected clips plus a `clips.json` with references. `import-common-voice
     <path>` copies the selected clips and references from the owner's local
     Common Voice download; that data has no pinned hash because it is not
     fetched by the tool.
   - `score`: per-language normalization (NFKC; English lowercase and
     punctuation removal; ja/ko/zh punctuation and whitespace removal), CER for
     ja/ko/zh and WER for en by edit distance, p50/p90 latency, real-time
     factor, and a Markdown table for the plan.
2. Development benchmark: generalize `dev/parakeet-bench/*` into a speech
   benchmark with an engine adapter interface (`load`, `transcribeWindow`, and
   optional `pushAudio`/`flush` for streaming engines). Parakeet becomes the
   first adapter. The page loads clips from a local URL, can pace audio in real
   time, records final and first-interim latency, load time and per-clip text,
   and exposes the result object as today. Clips are decoded in the browser
   (Web Audio) and resampled to 16 kHz, so no audio tooling is needed.
3. A runner that drives the page in the reference runtime and writes results
   JSON to the evaluation root. Prefer the desktop renderer; if the harness
   cannot load there, use Chromium of the same major version and record the
   deviation. Memory is sampled over the whole Electron process tree, with the
   method recorded.
4. Parakeet v2 English baseline on CPU and WebGPU.

Checks: `uv run pytest -q tests/test_speech_eval*.py` (selection
determinism, normalization, CER/WER against hand-computed cases),
`uv run ruff check`, `make format-check`, from `src/frontend` `pnpm check`,
`pnpm web:lint`, `pnpm web:test`, `pnpm build` and a scan confirming the built
output contains no benchmark page or strings.

Completion: the test set is tracked; `fetch` and `score` reproduce the Parakeet
baseline on the reference Mac; G0 status recorded.

#### Phase 1 results (2026-10-14)

Changes:

- `scripts/speech-eval/speech_eval.py` (`select`, `fetch`,
  `import-common-voice`, `score`, `root`) and `testset.json`: FLEURS at
  revision `70bb2e84`, pinned TSV and archive hashes, 75 clips per set for
  `en`, `ja`, `ko`, `zh-Hans` and `yue` (643–831 s of audio per set), selected
  per sentence across three duration buckets. `zh-Hant` waits for G0.
- `web/speech-bench.html` and `web/src/dev/speech-bench/*` replace the
  Parakeet-only `parakeet-bench` page: engine adapters (`window` and `stream`
  kinds), `throughput` and real-time `paced` modes, interim text through the
  app's preview controller, one serial engine queue as in the product worker.
- `src/frontend/scripts/speech-bench.mjs` (`pnpm speech:bench`) runs the page in
  a bare Electron 39.8.9 window (Chromium 142.0.7444.265, the desktop app's
  build) through Playwright: a fresh profile per run, a load-only launch for the
  cold load, then a second launch for the warm load and the clips. It serves
  clips to the app origin only and samples the process tree's macOS footprint
  by phase; `speech-bench-electron-main.cjs` is the window shell.
- `knip.json` lists the benchmark entry points.

Reproduce (reference Mac, Apple M5, 24 GB):

```bash
uv run python scripts/speech-eval/speech_eval.py fetch
pnpm --dir src/frontend/web exec vite --port 5179 --strictPort --host 127.0.0.1
pnpm --dir src/frontend -s speech:bench --app http://127.0.0.1:5179 --engine parakeet --backend wasm --mode throughput --sets en
pnpm --dir src/frontend -s speech:bench --app http://127.0.0.1:5179 --engine parakeet --backend webgpu --mode throughput --sets en
pnpm --dir src/frontend -s speech:bench --app http://127.0.0.1:5179 --engine parakeet --backend webgpu --mode paced --sets en
uv run python scripts/speech-eval/speech_eval.py score <results>/parakeet-*.json
```

Parakeet v2 English baseline (75 FLEURS clips, Electron 39.8.9), measured on
2026-10-20 with the final runner (one fresh profile per run, a load-only launch
for the cold load, memory as summed macOS footprint of the second launch):

| Backend | Mode | WER | Final p50 / p90 ms | First interim p50 ms | RTF | Cold / warm load ms | Clip median / peak MB | Peak by process MB |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| wasm | throughput | 4.1% | 2,486 / 4,010 | – | 0.30 | 1,458 / 1,369 | 1,653 / 2,296 | renderer 2,143, GPU 109 |
| webgpu | throughput | 3.8% | 168 / 227 | – | 0.02 | 2,068 / 2,103 | 4,424 / 4,496 | renderer 2,896, GPU 1,555 |
| webgpu | paced, interim | 3.8% | 256 / 422 | 789 | 0.02 | 2,069 / 2,040 | 4,937 / 5,024 | renderer 3,137, GPU 1,842 |

On WASM the app shows no interim text. Loading takes under two seconds, so the
two-second memory sampler often misses it; read the load-phase peak as a lower
bound. Repeated runs differ by a few hundred milliseconds in load time.

Check record (working tree; tree hashes from the `git-workflow` recipe):

| Check | Directory | Tree | Result |
| --- | --- | --- | --- |
| `uv run pytest -q tests/test_speech_eval.py` | root | `de586358` | 21 passed |
| `uv run ruff check scripts/speech-eval tests/test_speech_eval.py` | root | `de586358` | pass |
| `uv run ruff format --check scripts/speech-eval tests/test_speech_eval.py` | root | `de586358` | pass |
| `node --check` on `speech-bench.mjs` and `speech-bench-electron-main.cjs` | `src/frontend` | `de586358` | pass |
| `pnpm exec vitest run src/dev/speech-bench` | `src/frontend/web` | `de586358` | 9 passed |
| `pnpm exec tsc -b --noEmit` | `src/frontend/web` | `de586358` | pass |
| `pnpm exec eslint src/dev/speech-bench` | `src/frontend/web` | `de586358` | pass |
| `pnpm exec prettier --check src/dev/speech-bench speech-bench.html` | `src/frontend/web` | `de586358` | pass |
| `pnpm exec knip` (benchmark files) | `src/frontend` | `2fde40df` | nothing reported |

`2fde40df` differs from `de586358` only by `ignoreBinaries` in `knip.json`.

Earlier on 2026-10-14 (before the repairs, at `0019e280`): `pnpm check`,
`pnpm web:lint`, `pnpm web:test` (vitest and 114 browser tests) and `pnpm build`
passed, and the built `web/dist` contained no `speech-bench` strings. The full
pre-push suite runs once on the final candidate.

G0: the owner chose the fallback on 2026-10-20. `zh-Hant` is measured on the
FLEURS Mainland Mandarin clips with references converted to Traditional by the
same converter as the output; Taiwan accents are not tested.

Records: issue #535; commit `02f44b3e`; evidence: Phase 1 results above.

#### Code Review #1 Findings

Full initial review by an independent `sdlc-reviewer` subagent on 2026-10-14,
working tree at `0019e280` (Phase 2 drafts excluded). Its checks: speech-eval
tests 20 passed, ruff and format pass, benchmark vitest 7 passed, eslint pass,
built `dist` free of benchmark strings, and `score` reproduced the plan table.
Result: blocked.

- **P1-CR1-01 (required)** `bench-runner.ts`: paced window final latency started
  at `max(now, scheduled end)`, so a preview still holding the worker at the end
  of the clip was left out. Streaming measured from the scheduled arrival, so the
  two engine kinds were not compared on the same basis. Reproduced: 260 ms
  reported against 367 ms elapsed.
- **P1-CR1-02 (required)** `speech_eval.py summarize`: results grouped only by
  engine, backend, mode and set, so reruns, paced runs without interim text and
  other runtimes merged silently into one row.
- **P1-CR1-03 (required)** R1 asks for cold and warm load; `loadMs` was neither,
  and Playwright's default Electron profile kept HTTP, code and shader caches
  between runs.
- **P1-CR1-04 (required)** Plan and code text: stale benchmark entry points,
  `import-common-voice` described as hash-verified, a wrong script name, a CORS
  comment that did not match the code, and missing issue reference.
- **P1-CR1-05 (optional)** `streamTailLatencyMs` assumed a full last chunk.
- **P1-CR1-06 (optional)** Clip server sent `Access-Control-Allow-Origin: *` for
  the whole evaluation root; a malformed `%` request crashed the runner.
- **P1-CR1-07 (optional)** A zero-clip run succeeded silently; preview budget
  stops were dropped.
- **P1-CR1-08 (optional)** The Parakeet adapter copies the product worker's load
  options and ignores `models=`; `dispose` was unused; `fetch` downloaded the
  optional Cantonese set by default.

#### Code Review #1 Revisions

- **P1-CR1-01 accepted.** Paced window latency now counts from the scheduled end
  of the audio; new test "counts a preview still running at the end of the audio
  in the final delay" (fails with the old expression).
- **P1-CR1-02 accepted.** A configuration is engine, backend, mode, interim and
  runtime; a repeated clip within one configuration raises an error. Test added.
- **P1-CR1-03 accepted.** The runner gives Electron a fresh temporary profile
  per run (`SPEECH_BENCH_USER_DATA`), and the worker reports `coldLoadMs` and
  `warmLoadMs` (the same load after disposing the first). Baseline re-measured.
- **P1-CR1-04 accepted.** Context table, `import-common-voice` wording, recovery
  text, docstring, CORS comment and Records line corrected.
- **P1-CR1-05 accepted.** `streamTailLatencyMs` takes the audio length and lets
  a partial last chunk arrive when the audio ends; test added (2.2 s case).
- **P1-CR1-06 accepted.** CORS limited to the app origin; URL decoding moved
  inside the guarded block.
- **P1-CR1-07 accepted.** The page fails when no clips match; budget stops and
  preview failures are counted per clip (`interimStops`).
- **P1-CR1-08 partly accepted.** Parakeet now rejects `models=` and releases its
  sessions in `dispose` (used by the warm load); `fetch` skips optional sets
  unless named. Sharing the product worker's load and release code is deferred
  to Phase 4, which replaces that worker with the routed engine module; the
  copy is marked in the adapter.

Repair budget: one of two rounds used.

#### Code Review #2 Findings

Targeted recheck by an independent `sdlc-reviewer` subagent on 2026-10-20,
working tree `3786f449` (baseline `e8c3233a`). It confirmed P1-CR1-01 to 08
resolved (the new tests fail against the old logic; the Electron shell writes
its caches into the scratch profile) and reran `score` against the re-measured
results. Result: blocked.

- **P1-CR2-01 (required)** `bench-worker.ts`: the warm load ran in the same
  worker as the cold load, so peak memory and warm load time measured the
  benchmark's own double load (peak RSS 1,611 → 2,812 MB on WASM throughput).
- **P1-CR2-02 (optional)** The score table had no runtime column.
- **P1-CR2-03 (optional)** "No GPU shader cache" overstates a fresh profile:
  macOS keeps a Metal shader cache outside it, and model files stay in the OS
  file cache.
- **(optional)** `interimStops` was not shown by `score`.

#### Code Review #2 Revisions

- **P1-CR2-01 accepted.** A separate worker in the same renderer still left the
  first load's memory in the process, so the runner now launches Electron twice
  on one fresh profile: a load-only launch (`loadOnly=1`) gives the cold load,
  and the second launch gives the warm load and runs the clips. Memory is
  sampled only in the second launch and split by the page's phase
  (`loadPeakMb`, `peakMb`). RSS swung by 1–2 GB between identical runs because
  it counts shared pages per process, so the sampler now sums macOS
  `footprint` (Activity Monitor's figure) every two seconds and records the
  clip-phase median and peak, with the peak split by Electron process type
  (`peakByProcessMb`). The unused
  Chromium path was removed; the runner targets the reference Mac (D2).
  Baseline re-measured.
- **P1-CR2-02 accepted.** `score` shows the runtime.
- **P1-CR2-03 accepted.** Comments and the plan say "fresh browser profile" and
  no longer claim an empty GPU shader cache.
- **`interimStops` accepted.** Shown as "Interim stops" by `score`.

Repair budget: two of two rounds used.

#### Code Review #3 Findings

Final targeted recheck by an independent `sdlc-reviewer` subagent on
2026-10-20, working tree `f74252fa`. P1-CR2-01 to 03 and the interim-stops note
are resolved: cold and warm loads run in separate launches, memory comes only
from the warm launch, the `footprint` parsing and process-tree logic are
correct and fail per sample, and the plan's table matches the result files and
a rerun of `score`. No regressions. Result: pass.

- **P1-CR3-01 (optional)** A phase with no memory sample was written as `0`.
- **P1-CR3-02 (optional)** Two comments still claimed a fully cold start.
- (non-blocking) The median took the upper middle value for an even sample
  count; the plan's step 3 still named only the renderer and GPU processes.

#### Code Review #3 Revisions

All accepted after the pass: memory figures with no sample are `null` (a short
WebGPU smoke run wrote `null` for the clip phase), the median averages the two
middle samples, and the comments and step 3 describe the fresh profile and the
whole process tree. `node --check` passes on the runner.

### Phase 2 — Candidate engines and comparison report (R1, gate G1)

Dependencies: Phase 1.

Changes:

1. Evaluation-only acquisition of pinned upstream candidate files into the
   evaluation root (not the catalog): SenseVoice-Small int8 ONNX (an export
   with frame stacking and normalization in the graph, or the sherpa-onnx
   export with those steps in JS) and Nemotron 3.5 ASR ONNX (int8; int4 for
   WebGPU if it is the only working export). Record the source, revision,
   licence, and the licence of any community code reused.
2. SenseVoice adapter: 80-bin Kaldi fbank front end in the worker, language
   and text-normalization prompt for the conversation language, greedy CTC
   collapse, token table, tag stripping. Interim text by re-decoding the
   growing window through the existing preview controller.
3. Nemotron adapter: cache-aware streaming encoder fed in chunks (measure 560
   ms and 1.12 s), RNNT greedy decoding, language prompt, partial and final
   text.
4. Chinese script: test a compact OpenCC-derived converter for Simplified →
   Traditional (and the reverse if a model emits Traditional); record its size
   and licence.
5. Run every candidate, language and backend; write the comparison report
   below with every R1 measurement, the Parakeet baseline, failures (with
   evidence) and a recommendation. State the Nemotron worker-protocol cost.

Checks: Phase 1 checks plus adapter unit tests (front-end features against a
fixture, CTC collapse, tag stripping, RNNT greedy decode on a toy graph where
practical, script conversion).

Completion and gate: report recorded; G1 decisions recorded in the Decision
Log. Work stops here until G1. The losing adapter is removed in Phase 4.

#### Phase 2 results (2026-10-20)

Changes:

- `scripts/speech-eval/models.json` pins the evaluation-only candidate files
  (repository, revision, size, SHA-256, licence); `speech_eval.py models`
  fetches them into the evaluation root and writes each set's `metadata.json`
  from the ONNX `metadata_props`, read without loading the graph
  (`onnx_metadata`). The onnx-community export takes its metadata from the
  sherpa 560 ms set.
- `testset.json`: `zh-Hant` reuses the `zh-Hans` clips (`sameClipsAs`) with
  `script: "Hant"` and `referenceScript: "Hans"`; `yue` has `script: "Hant"`.
  `import-common-voice` and the Common Voice source were removed (G0
  fallback).
- `web/src/dev/speech-bench/engines/`: `kaldi-fbank.ts` (Kaldi fbank, 7×6
  frame stacking, CMVN), `sensevoice.ts` (greedy CTC with tag removal),
  `rnnt.ts` (mel chunking with the pre-encode cache, greedy RNNT,
  detokenization), `nemotron.ts` (cache-aware streaming over the sherpa and
  onnx-community contracts), `model-files.ts`; tests for each pure part. The
  adapters are written for this benchmark from the exports' graph inputs,
  outputs and metadata; no sherpa-onnx or FunASR code is copied. They reuse
  `parakeet.js` 1.4.4 (MIT), already an app dependency: its FFT for the fbank
  and its NeMo mel front end (`JsPreprocessor`) for Nemotron.
- `script-conversion.ts` converts `Hant` sets with `opencc-js` 1.4.2 (`cn2t`,
  Simplified to Taiwan standard; MIT and Apache-2.0; a development dependency)
  and records the raw text and converted reference; `score` uses the converted
  reference and rejects a `zh-Hant` result without one. Engines receive the set
  id as the locale. The `cn2t` module is 1.1 MB (452 KB gzipped), so it is not
  compact: Phase 4 should load it on demand under `zh-Hant`, or test a smaller
  character table.
- The runner accepts `--models NAME` for files under the evaluation root and
  records the model set, which `score` uses to keep variants apart.

Reproduce: `uv run python scripts/speech-eval/speech_eval.py models`, then the
run matrix below (one at a time, Vite on port 5179), then
`speech_eval.py score <results>/*-electron-*.json`.

```bash
pnpm -s speech:bench --app http://127.0.0.1:5179 --engine sensevoice --models sensevoice-sherpa --backend wasm --mode throughput --sets en,ja,ko,zh-Hans,zh-Hant,yue
pnpm -s speech:bench --app http://127.0.0.1:5179 --engine sensevoice --models sensevoice-sherpa --backend webgpu --mode throughput --sets en,ja,ko,zh-Hans,zh-Hant,yue
pnpm -s speech:bench --app http://127.0.0.1:5179 --engine nemotron --models nemotron-sherpa-560ms --backend wasm --mode throughput --sets en,ja,ko,zh-Hans,zh-Hant
pnpm -s speech:bench --app http://127.0.0.1:5179 --engine nemotron --models nemotron-sherpa-1120ms --backend wasm --mode throughput --sets en,ja,ko,zh-Hans,zh-Hant
pnpm -s speech:bench --app http://127.0.0.1:5179 --engine sensevoice --models sensevoice-sherpa --backend webgpu --mode paced --sets en,ja,ko,zh-Hans,zh-Hant,yue --limit 20
pnpm -s speech:bench --app http://127.0.0.1:5179 --engine sensevoice --models sensevoice-sherpa --backend wasm --mode paced --sets en,ja,ko,zh-Hans,zh-Hant,yue --limit 20
pnpm -s speech:bench --app http://127.0.0.1:5179 --engine nemotron --models nemotron-sherpa-560ms --backend wasm --mode paced --sets en,ja,ko,zh-Hans,zh-Hant --limit 20
pnpm -s speech:bench --app http://127.0.0.1:5179 --engine nemotron --models nemotron-sherpa-1120ms --backend wasm --mode paced --sets en,ja,ko,zh-Hans,zh-Hant --limit 20
```

After Code Review #1 the four SenseVoice configurations were rerun for `yue`
alone (`--sets yue`), and the `yue` clips were removed from the earlier
SenseVoice result files, whose originals are kept under
`results/superseded-2026-10-20-review/` with the superseded Nemotron runs.

Check record (working tree; tree hashes from the `git-workflow` recipe; logs
under `<evaluation root>/logs/prepush*/`). `601980b4` is the reviewed
candidate; `a83ce6ac` is the candidate after the Code Review #1 repairs, and
later edits touch only this plan.

| Check | Directory | Tree | Result |
| --- | --- | --- | --- |
| `make check-test` (via `heavy-slot.py`) | root | `601980b4` | pass; 4741 passed, 29 skipped |
| `pnpm verify` (via `heavy-slot.py`) | `src/frontend` | `601980b4` | pass; vitest 5336 passed, 1 skipped |
| `pnpm web:test:browser` (via `heavy-slot.py`) | `src/frontend` | `601980b4` | 122 passed |
| `pnpm prettier:check` | `src/frontend` | `601980b4` | pass |
| `uv run pytest -q -p no:xdist tests/test_speech_eval.py` | root | `a83ce6ac` | 25 passed |
| `uv run ruff check` and `ruff format --check` on `scripts/speech-eval` and the test | root | `a83ce6ac` | pass |
| `pnpm exec vitest run src/dev/speech-bench` | `src/frontend/web` | `a83ce6ac` | 26 passed |
| `pnpm exec tsc -b --noEmit`; `pnpm exec eslint --max-warnings=0 src/dev/speech-bench` | `src/frontend/web` | `a83ce6ac` | pass |
| `make check-test` (via `heavy-slot.py`) | root | `a83ce6ac` | pass; 4742 passed, 29 skipped |
| `pnpm verify` (via `heavy-slot.py`) | `src/frontend` | `a83ce6ac` | pass; vitest 5339 passed, 1 skipped |
| `pnpm web:test:browser` (via `heavy-slot.py`) | `src/frontend` | `a83ce6ac` | 122 passed |
| `pnpm prettier:check` | `src/frontend` | `a83ce6ac` | pass |

The first suite run stopped at `make check-test`: mypy rejected two
unparameterized annotations in `tests/test_speech_eval.py`, fixed before the
`601980b4` run.

Records: issue #536; commit `73913350`; evidence: Phase 2 results and the
comparison report below.

#### Code Review #1 Findings

Reviewed working tree `4d29f264` (baseline `02f44b3e`), high-risk tier: one
analysis subagent and one checks subagent.

The checks subagent reran every affected check independently on `4d29f264`
(pytest 24, ruff, mypy, vitest 23, `tsc -b`, ESLint, knip, `node --check`),
confirmed that the built `web/dist` holds no benchmark or OpenCC code, and
checked the `opencc-js` pin, integrity hash and licence: all passed.

- **P2-CR1-01 (blocking).** Nemotron chunks were encoded one delivery late:
  with 560 ms deliveries the last mel frame of a chunk needs 96 samples of the
  next delivery, so each chunk waited 560 ms (or 1.12 s), inflating final and
  first-interim latency. Window engines were paced in MicVAD frames, so the
  comparison was not on the same basis.
- **P2-CR1-02 (blocking).** Recommendation 1 called SenseVoice the fastest on
  both backends, but on WASM Nemotron's final text arrived sooner.
- **P2-CR1-03 (blocking).** `yue` was converted to Hong Kong forms (説, 羣, 着)
  while the FLEURS Cantonese references use Taiwan forms (說, 群, 著); the
  reviewer's rescoring gave 7.7% with the Taiwan standard against 8.6%.
- **P2-CR1-04 (blocking).** The report lacked the Nemotron worker-protocol cost,
  the converter's size, the FLEURS attribution and the licence of reused code.
- **P2-CR1-05 (blocking).** No test covered script conversion, which lived in
  the page script.
- Non-blocking: `opencc-js` was a runtime dependency (both subagents), so
  desktop licence notices would list it; `models` raised a raw
  `FileNotFoundError` when the shared metadata was missing and wrote
  `metadata.json` without an explicit encoding; `score` accepted a `zh-Hant`
  result without a converted reference; stale Progress and recovery text; the
  report did not say SenseVoice runs with inverse text normalization, or that
  first interim counts from the clip's first sample; the 1.12 s paced run was
  missing; the fbank test checks shape rather than reference values; neither
  adapter was compared with the upstream decoder; the OpenCC tables count
  toward clip-phase memory for Traditional sets.

#### Code Review #1 Revisions

- **P2-CR1-01 accepted.** `bench-runner.ts` delivers 512-sample MicVAD frames
  to streaming engines too (`StreamingEngine.chunkSamples` removed;
  `streamTailLatencyMs` takes per-frame timings; a changed partial counts as
  one interim). `nemotron.ts` buffers frames and joins them only when the next
  chunk's mel frames are complete. Runner tests updated. A three-clip smoke run
  gave identical transcripts and final text about 0.4 s sooner; all three
  Nemotron runs were repeated and the 1.12 s paced run added. Transcripts match
  the superseded runs clip for clip (375/375, 375/375, 100/100).
- **P2-CR1-02 accepted.** Recommendations 1 and 4 and the latency notes now
  state that Nemotron returns final text sooner on WASM, at five times the CPU.
- **P2-CR1-03 accepted.** The OpenCC `variant` field was removed; every `Hant`
  set converts to the Taiwan standard. `clips.json` was refreshed with `fetch
  --set zh-Hant --set yue` and the SenseVoice `yue` sets were rerun: CER 7.7% on
  both backends (was 8.6%). The Cantonese target is now 8%.
- **P2-CR1-04 accepted.** The report adds the FLEURS attribution, the
  worker-protocol cost and the converter's size; Phase 2 results state that the
  adapters copy no sherpa-onnx or FunASR code and reuse `parakeet.js` (MIT).
- **P2-CR1-05 accepted.** Conversion moved to `script-conversion.ts` with three
  tests (Simplified unchanged, `zh-Hant` output and reference, `yue` output
  only).
- Non-blocking, accepted: `opencc-js` moved to `devDependencies`; `models`
  raises `EvalError` when the shared metadata is missing and writes UTF-8;
  `score` rejects a missing converted reference (new test); Progress and
  recovery text, `with_itn` and the first-interim definition corrected.
- Non-blocking, deferred to Phase 4 for the chosen engine: reference-value
  fbank fixtures and a few-clip comparison against sherpa-onnx's decoder. The
  end-to-end error rates (7–11%) show the front end is sound, and Nemotron is
  not recommended on several independent grounds. The OpenCC tables' share of
  clip-phase memory for Traditional sets is accepted for a benchmark.

Validation after the revisions: see the Phase 2 check record above.

#### Code Review #2 Findings

Repair round 1 of 2 on working tree `a83ce6ac`, high-risk tier. The analysis
subagent found P2-CR1-01 to P2-CR1-05 and the accepted non-blocking items
resolved; rescoring every current result file reproduced the revised tables,
and the repaired Nemotron runs keep their transcripts while final latency per
encode fell from a median of 2.42 to 1.49 (560 ms) and from 2.12 to 1.18
(1.12 s). The checks subagent reran every affected check on the `a83ce6ac`
code (pytest 25, ruff, mypy, vitest 26, `tsc -b`, ESLint, knip, `node --check`),
found no benchmark or OpenCC code in the rebuilt `web/dist`, and confirmed with
`javascriptLicenses` that `opencc-js` no longer reaches the web or desktop
runtime licence closure (P2-CR1-CK-01 resolved).

- **P2-CR1-R1-01 (non-blocking).** Nemotron's RTF column showed only throughput
  runs, understating real-time CPU use (paced 0.85–0.91 for 560 ms).
- **P2-CR1-R1-02 (non-blocking).** The check record lacked the repaired tree.

#### Code Review #2 Revisions

- **P2-CR1-R1-01 accepted.** The latency table shows paced RTF for Nemotron;
  the latency note and recommendation 4 give the final-text gap per chunk size
  and mode and real-time CPU use of 85–90% of a core. Plan-only.
- **P2-CR1-R1-02 accepted.** The check record now includes the repaired tree.

No blocking finding remains; the phase passes its review.

#### Comparison report

Measured 2026-10-20 and, after Code Review #1, 2026-10-21 on the reference Mac
(Apple M5, 24 GB) in Electron 39.8.9 (Chromium 142) with the app's
onnxruntime-web, using the Phase 1 harness: throughput runs over all 75 clips
per set, real-time paced runs with interim text over the first 20 clips per
set. Candidate files are pinned in `scripts/speech-eval/models.json`
(evaluation only). Test clips and references: FLEURS (Conneau et al., 2022,
Google, CC-BY-4.0), `google/fleurs` revision `70bb2e84`.

Configurations:

- **SenseVoice-Small** (sherpa-onnx export, FunASR Model License 1.1): INT8
  graph (239 MB) on WASM; FP32 graph (938 MB) on WebGPU, because the INT8
  graph's dynamic-quantization operators have no WebGPU kernels. Prompted with
  the set's language and inverse text normalization (`with_itn`), so numbers
  and units come out as digits. Interim text by re-decoding the growing window
  through the app's preview controller.
- **Nemotron 3.5 ASR** (sherpa-onnx INT8 export, OpenMDW-1.1): 560 ms and
  1.12 s chunks on WASM (682 MB per chunk size). No working WebGPU build on ORT
  1.24 (see Surprises & Discoveries). Streams partial text natively.
- **Parakeet v2** (English baseline from Phase 1).

Accuracy (throughput, 75 clips; CER for ja/ko/zh/yue, WER for en; lower is
better):

| Set | SenseVoice WASM / WebGPU | Nemotron 560 ms | Nemotron 1.12 s | Parakeet WASM / WebGPU |
| --- | ---: | ---: | ---: | ---: |
| en | 7.9% / 7.8% | 11.9% | 11.5% | 4.1% / 3.8% |
| ja | 7.6% / 7.2% | 15.7% | 15.1% | – |
| ko | 10.5% / 10.6% | 12.9% | 12.6% | – |
| zh-Hans | 8.2% / 8.1% | 21.5% | 21.6% | – |
| zh-Hant (fallback) | 8.2% / 8.1% | 21.5% | 21.7% | – |
| yue | 7.7% / 7.7% | not supported | not supported | – |

Absolute rates include reference artifacts that affect every engine alike:
FLEURS Korean references carry unspoken Latin glosses such as "(Great
Yarmouth)", and units and numbers differ in form ("70km" against
"70キロメートル"). The ranking, not the absolute figure, is the basis for the
choice. `zh-Hant` reuses the Mainland audio, so it differs from `zh-Hans` only
by conversion; Taiwan accents are untested (G0). `yue` output is converted to
the Taiwan standard, the forms the FLEURS Cantonese references use.

Latency (final text after the last delivered sample, p50 / p90 ms; RTF is
processing time over audio time; first interim from the clip's first sample,
including any leading silence):

| Configuration | Final, throughput | Final, paced with interim | First interim p50 | Interim stops | RTF |
| --- | ---: | ---: | ---: | ---: | ---: |
| SenseVoice WASM | 1,230–1,670 / 2,010–2,129 | 1,292–1,612 / 1,799–2,059 | 781–788 | 11–20 per 20 clips | 0.15 |
| SenseVoice WebGPU | 86–106 / 120–122 | 104–133 / 148–189 | 678–682 | 0 | 0.01 |
| Nemotron 560 ms WASM | 613–686 / 791–851 | 798–1,162 / 1,107–1,696 | 2,156–3,264 | – | 0.79–0.80 (paced 0.85–0.91) |
| Nemotron 1.12 s WASM | 626–822 / 1,089–1,192 | 795–1,132 / 1,082–1,406 | 2,915–4,032 | – | 0.57–0.59 (paced 0.60–0.66) |
| Parakeet WASM (en) | 2,486 / 4,010 | – | – | – | 0.30 |
| Parakeet WebGPU (en) | 168 / 227 | 256 / 422 | 789 | 0 | 0.02 |

Ranges span the sets. On WASM, SenseVoice previews mostly stop at the
controller's 800 ms decode budget, as Parakeet's did, so WASM interim text
covers only the start of longer windows. On the CPU path Nemotron returns final
text sooner than SenseVoice (560 ms chunks: p50 0.5–1.0 s sooner per set in
throughput runs, 0.2–0.8 s paced), because most of each window is already encoded when speech
ends, but it uses five times the CPU (RTF 0.8–0.9 against 0.15) and its first
partial text arrives after 2.2–4.0 s. Nemotron's RTF is higher when paced,
where audio arrives in 32 ms frames.

Load and memory (cold / warm load ms; median / peak footprint MB of the Electron
tree while transcribing):

| Configuration | Load | Memory |
| --- | ---: | ---: |
| SenseVoice WASM | 841 / 731 | 964 / 1,080 |
| SenseVoice WebGPU | 1,808 / 1,862 | 3,977 / 4,382 |
| Nemotron 560 ms WASM | 2,052 / 1,909 | 1,791 / 2,262 |
| Nemotron 1.12 s WASM | 1,785 / 1,656 | 1,796 / 2,325 |
| Parakeet WASM | 1,458 / 1,369 | 1,653 / 2,296 |
| Parakeet WebGPU | 2,068 / 2,103 | 4,424 / 4,496 |

The SenseVoice rows come from the all-set runs; the `yue` reruns measured
834 / 1,110 MB (WASM) and 3,828 / 3,889 MB (WebGPU).

Download: SenseVoice CPU set about 240 MB (D3: within 700 MB); its FP32 WebGPU
graph adds 938 MB (an FP16 conversion, about 470 MB, is untested). Nemotron:
about 682 MB per chunk size, CPU only. A Traditional-script converter adds the
OpenCC tables (1.1 MB, 452 KB gzipped, for `cn2t`) to either choice.

Worker-protocol cost: the app's speech worker is stateless per request
(`load`, `transcribe` a whole window as `preview` or `final`, `dispose`).
SenseVoice fits it with one added field, the language. Nemotron would need a
stateful session protocol: open a session per speech window with its language,
forward every MicVAD frame (or batches) to the worker, emit partial results,
finish or discard the session on a VAD misfire or turn change, and keep the
encoder caches and decoder state per session in the worker. Its partial text
would replace the preview controller for that engine.

Recommendation (agent, for G1):

1. **Choose SenseVoice-Small** for `ja`, `ko`, `zh-Hans` and `zh-Hant`, with
   Cantonese under `zh-Hant` (D9). It is the most accurate candidate in every
   non-English set, about two and a half times as accurate as Nemotron on
   Mandarin, needs the least CPU (RTF 0.15 against 0.8) and the smallest
   download, is the fastest on WebGPU (final text about 0.1 s), and fits the
   existing per-window worker. On WASM its final text p90 (about 2.1 s) is
   about half of Parakeet's English figure today.
2. **Keep Parakeet for English.** SenseVoice's English WER (7.9%) is 3.8 points
   worse than Parakeet's, beyond D8's 1.5-point tolerance.
3. **Interim text on WebGPU only**, as for Parakeet today: first interim about
   0.7 s with no budget stops; on WASM previews stop early and add little.
4. **Do not pursue Nemotron 3.5 now.** It loses on accuracy everywhere (Mandarin
   21.5% CER), has no Cantonese, does not run on WebGPU with ORT 1.24, shows its
   first partial text after 2.2–4.0 s, uses 85–90% of a core in real time and
   needs a stateful worker protocol. Its one advantage, final text 0.2–1.0 s
   sooner on the CPU path, does not outweigh these; on WebGPU a full SenseVoice
   re-decode of a 15 s window takes about 0.1 s.
5. **Proposed numeric targets** (this test set, reference Mac): CER at most 8%
   for `ja`, 11% for `ko`, 8.5% for `zh-Hans` and `zh-Hant` (Cantonese 8%,
   informative); final text p90 at most 2.2 s on WASM and 0.25 s on WebGPU;
   WebGPU first interim p50 at most 0.8 s; English stays on Parakeet's current
   figures.
6. **Spec questions:** Q1 engine-neutral offline labels; Q2 Setup offers the
   SenseVoice set under a non-English locale; Q3 a locale change applies from
   the next start; Q4 no memory limit, report medians; Q5 a WebGPU add-on set
   for the GPU graph, trying FP16 in Phase 3 and falling back to the 938 MB FP32
   graph; Q6 record the choice in ADR 0025; Q7 runtime downloads, not bundled.

### Phase 3 — Multilingual model asset set (R4)

Dependencies: G1 (model, files and asset ID; written `<model-id>` below).

Changes:

1. `models/<model-id>/{manifest.json, README.md, ATTRIBUTION.md}`, plus a GPU
   add-on set if G1 approves one.
2. `scripts/models/<engine>.py` (`acquire`, `verify`, `path`, `root`, `--source
   animama|upstream`) reusing `parakeet.py` primitives; README section;
   `release_inputs.py`.
3. `reset.sh` and `scripts/local-stack-state-common.sh`: resolve the set
   offline with `resolve_optional_model` (missing disables multilingual
   recognition only; failed verification stops the reset) and record its
   directory in the stack record. Development Compose binds the directory and
   sets a `VITE_CLIENT_*_MODEL_DIR`; the Vite plugin and model define serve it
   at a development route.
4. Backend: catalog entry in `resources/model-assets.v1.json` with
   `license_ref`; a mount path in `local/http/assets.py`; availability for the
   new set beside `parakeet_availability`; runtime-capability fields for its
   installed version(s); regenerated SDK; hosted capability fixture.
5. Publication and notices: generalize the licence check in
   `optional-inputs.mjs`; `release-models.mjs` model spec; `code-and-models.md`
   and `.json`; `source-review.json`; `desktop/runtime/license-sources.json`
   and a notice file; `audit.mjs` exclusion from packaged web output;
   `redistribution-review.md`; `.env.example`.

Checks: `uv run pytest -q tests/test_model_assets.py
tests/test_model_asset_sets.py tests/test_runtime_capabilities.py
tests/test_product_http_runtime_capabilities.py tests/test_local_http_assets.py
tests/test_release_model_inputs.py tests/test_local_state_scripts.py` plus a new
`tests/test_<engine>_model_sources.py`; `pnpm openapi-ts:check`;
`pnpm desktop:test`; `bash -n reset.sh`; both `docker compose ... config
--quiet` commands; `uv run ruff check`; `make format-check`.

Completion: `acquire --source upstream`, `verify` and `path` work on the
reference Mac; a fresh `reset.sh` reports the set; the catalog equals the
tracked manifest; capabilities report the installed version.

#### Phase 3 results (2026-10-21)

Changes:

- `models/sensevoice-small/` (INT8 graph, tokens, `metadata.json`, README,
  ATTRIBUTION) and `models/sensevoice-small-webgpu/` (FP32 graph, README,
  ATTRIBUTION), pinned to the sherpa-onnx revision `2365baea`; `.gitattributes`
  keeps the manifests and metadata byte-stable.
- `scripts/models/sensevoice.py` and `sensevoice_webgpu.py` on the shared store;
  `parakeet.py` gains `load_pinned_manifest` and serves Animama objects for any
  published base set. `release_inputs.py` acquires both sets.
- `reset.sh` resolves both sets in development (a missing CPU set sets
  `ANIMAMA_SENSEVOICE_STT_ENABLED=false`; WebGPU sets only warn, through one
  shared helper) and records them; `local-stack-state-common.sh` re-resolves
  both base sets without a record. Development Compose mounts the sets
  read-only for Vite, with the notices folders as fallback.
- Vite resolves every host set through one table (`HOST_MODEL_SETS`) and serves
  SenseVoice at `/__client-sensevoice[-webgpu]-models`; the
  `__CLIENT_SENSEVOICE_MODELS__` define gives the built paths
  `/onnx/models/sensevoice-small[-webgpu]`.
- Backend: catalog entries `sensevoice-stt` and `sensevoice-stt-webgpu` (which
  requires the CPU set), mounts, `sensevoice_availability`, the setting, the
  capability fields and the regenerated SDK; hosted fixtures report them off.
- Desktop: input specs with their licence, the core-web audit, notices
  (`sensevoice-attribution.txt`, the FunASR licence text at FunASR
  `58830eca`), licence sources, the third-party review and source review
  records, and the redistribution review.

Completion evidence: `sensevoice.py acquire --source upstream` and
`sensevoice_webgpu.py acquire` downloaded both sets into a fresh store (about
240 MB and 938 MB) and `verify`/`path` passed; both sets also import offline from the
evaluation copies. The catalog equals the tracked manifests
(`test_packaged_speech_sets_equal_their_tracked_manifests`), and capabilities
report installed versions (`test_asset_store_offline_speech_follows_installs_without_a_restart`).
A fresh development stack (`./reset.sh --name msr --base-port 8900`, removed
afterwards) recorded both SenseVoice directories, Vite answered `HEAD` for
`model.int8.onnx`, `metadata.json`, `tokens.txt` and the WebGPU `model.onnx`
with their manifest sizes, and `/v1/runtime-capabilities` reported
`offline_multilingual_speech_enabled: true` (operator source, no versions).

Check record (working tree; tree hashes from the `git-workflow` recipe; suite
logs under `<evaluation root>/logs/prepush-p3/`; later edits touch only this
plan):

| Check | Directory | Tree | Result |
| --- | --- | --- | --- |
| Phase 3 pytest set: `tests/test_{model_assets,model_asset_sets,parakeet_model_sources,runtime_capabilities,product_http_runtime_capabilities,product_http_inventory,local_http_assets,local_http_admission,model_store,webgpu_model_store,pocket_cloning_model_store,browser_model_store,sensevoice_model_store,release_model_inputs,local_state_scripts,compose_network_boundaries,openapi_export}.py`, `scripts/ci/test_{local_validate,validation_policy}.py` | root | `ce6502ae` | 615 passed, 6 skipped (Windows-only) |
| `uv run ruff check`; `make format-check`; `bash -n` on `reset.sh` and `local-stack-state-common.sh` | root | `ce6502ae` | pass |
| both `docker compose ... config --quiet` commands | root | `ce6502ae` | pass |
| `pnpm openapi-ts:check` | `src/frontend` | `ce6502ae` | SDK current |
| `vitest run` on `localParakeetModels`, `model-notices-vite`, `resource-urls`, `browserRuntimeAssets` | `src/frontend/web` | `ce6502ae` | 38 passed |
| `pnpm test` | `packages/runtime-contracts` | `ce6502ae` | 10 passed |
| `pnpm desktop:test` (via `heavy-slot.py`) | `src/frontend` | `ce6502ae` | 537 passed, 14 skipped |
| `make check-test` (via `heavy-slot.py`) | root | `ce6502ae` | 4769 passed, 29 skipped |
| `pnpm verify` (via `heavy-slot.py`) | `src/frontend` | `ce6502ae` | pass; vitest 5340 passed, 1 skipped |
| `pnpm web:test:browser` (via `heavy-slot.py`) | `src/frontend` | `ce6502ae` | 122 passed |
| `pnpm prettier:check` | `src/frontend` | `ce6502ae` | pass |

Records: issue #631; commit `abe7dba4`; evidence: Phase 3 results.

#### Code Review #1 Findings

Reviewed working tree `5661afd9` (baseline `94a048a2`), high-risk tier: one
analysis subagent and one checks subagent. No blocking findings.

The checks subagent reran every affected check on `5661afd9`: the Phase 3
pytest set plus `scripts/public-release/test_prepare_source.py` (627 passed, 6
Windows-only skips), ruff, mypy, `bash -n`, both Compose configurations (also
with the SenseVoice directories set), offline `verify` of both installed sets,
manifests against the evaluation pins and the checked-in bytes, catalog digests
and URLs, the FunASR licence notice byte-for-byte against upstream `58830eca`,
`openapi-ts:check`, web vitest 38, `tsc -b`, ESLint, runtime-contracts 10,
`pnpm desktop:test` 537, and the licence inventories: all passed. The analysis
subagent confirmed the acceptance items, the metadata against both graphs'
`metadata_props`, reset exit-status handling, read-only mounts, route and mount
prefixes, and attribution under the FunASR licence.

- **P3-CR1-01 (non-blocking).** The missing-set hint in `reset.sh` and the
  publication hint told developers to run `sensevoice.py acquire`, whose
  default source (Animama's objects) returns 404 until G2.
- **P3-CR1-02 (non-blocking).** The Cloud catalog follow-up was recorded only
  as a discovery, not as an outstanding item.
- **P3-CR1-03 (non-blocking).** Operations docs, the root guide and three
  backend comments describe the speech model source as Parakeet-only.
- **P3-CR1-04 (non-blocking).** `parakeet.load_manifest`,
  `parakeet_webgpu.load_manifest` and `pocket_cloning.load_manifest` kept
  copies of the new validator.
- **P3-CR1-05 (non-blocking).** The scripts README claimed `sensevoice.py` has
  every `parakeet.py` option (it has no `root`), and the plan's set sizes
  matched neither the byte totals nor `du`.
- **P3-CR1-CK-01 (non-blocking).** The check record did not name the exact
  pytest set behind its count.
- Pre-existing, not changed: the state script does not keep a reset's
  `*_STT_ENABLED=false` for later Compose commands; current callers do not
  recreate the backend.

#### Code Review #1 Revisions

- **P3-CR1-01 accepted.** `resolve_optional_model` takes optional acquire
  options for its hint, and `reset.sh` passes `--source upstream` for
  SenseVoice; the SenseVoice input spec's `acquireArgs` does the same for the
  publication hint. G2 now says to drop both after publication. Tests: the
  reset test asserts the upstream hint, and a new publication test checks the
  hint with an empty default store.
- **P3-CR1-02 accepted.** Phase 6 item 8 records the Cloud change as an
  outstanding PR item.
- **P3-CR1-03 accepted.** The three backend comments now say speech-to-text
  sets; the docs are added to Phase 6 item 1.
- **P3-CR1-04 accepted.** All three scripts delegate to
  `load_pinned_manifest`, which now precedes them in `parakeet.py`.
- **P3-CR1-05 and P3-CR1-CK-01 accepted.** README and plan wording corrected;
  the check record lists the exact pytest paths.

Repair check record (working tree `aa5f7308` before these records):

| Check | Directory | Tree | Result |
| --- | --- | --- | --- |
| store, release-input, Compose, state-script, model-source, local HTTP asset and catalog tests plus `scripts/voices` | root | `aa5f7308` | 458 passed, 6 skipped |
| `uv run ruff check`; `make format-check`; mypy gate; `bash -n reset.sh` | root | `aa5f7308` | pass |
| `pnpm desktop:test` (via `heavy-slot.py`) | `src/frontend` | `aa5f7308` | 538 passed, 14 skipped |
| `prettier --check` on `desktop/scripts/runtime` and the publication test | `src/frontend/desktop` | `aa5f7308` | pass |

#### Code Review #2 Findings

Repair round 1 recheck of `63f280de` (high-risk tier): P3-CR1-01 to 05 and
P3-CR1-CK-01 resolved; equivalent validator behaviour confirmed; no blocking
regression.

- **P3-CR1-R1-01 (non-blocking).** The new publication test emptied the
  default store only on macOS and Linux; on Windows `resolve_root` reads
  `LOCALAPPDATA`.
- Wording: a short wrapped docstring line in `local/http/assets.py` and the
  size note above.

#### Code Review #2 Revisions

- **P3-CR1-R1-01 accepted.** The test also points `LOCALAPPDATA` at the empty
  home. `vitest run tests/publish-models-r2.test.mjs`: 24 passed; prettier
  check pass.
- Wording fixed; `tests/test_local_http_assets.py`: 107 passed; ruff format
  check pass.

#### Code Review #3 Findings

Repair round 2 recheck of `876c6eb1`: P3-CR1-R1-01 and both wording notes
resolved; no regression. No findings remain; the phase passes its review.

#### Code Review #3 Revisions

None needed.

### Phase 4 — Engine integration and language routing (R2, R3)

Dependencies: Phase 3.

Changes:

1. Production engine module and worker for the chosen model, promoted from the
   Phase 2 adapter (`lib/speech/client-<engine>/`,
   `workers/client-<engine>-worker.ts`, knip entry). Same lifecycle as
   Parakeet: version-pinned same-origin URLs, model-asset leases, idle disposal,
   WebGPU probe and fallback to the CPU with the existing notice, one worker per
   backend.
2. A pure routing function from conversation locale, capabilities and
   preferences to `{engine, languageHint}`; `use-dictation.ts` starts the
   routed engine. The locale is read at start (Q3 per G1). `SttSegmentSource`
   and `VadSttProvider` gain the new engine without renaming stored values.
3. Output processing: tag removal, script conversion per locale, CJK spacing,
   no segment for empty text.
4. Interim text through the preview controller (window engine) or streaming
   partials (Nemotron), within the budget G1 approves; display-only as today.
5. Errors: "speech model for <language> not installed" pointing to its
   download, load and transcription failures surfaced without silent provider
   switches.
6. If G1 makes the model the default for English, English routes to it while
   Parakeet stays selectable (D8).
7. Remove the losing Phase 2 adapter; the benchmark keeps the Parakeet and
   chosen-engine adapters.

Checks: unit tests for routing, output processing, worker protocol and
backend fallback; existing `client-parakeet` and dictation tests;
`pnpm check`, `pnpm web:lint`, `pnpm web:test`, `pnpm build`; the Phase 1
harness run through the production worker for every language on CPU and WebGPU
against the G1 targets.

Completion: dictation and Voice Mode transcribe the test clips in every
language through the app path; targets met or the gap reported to the owner.
(Code Review #1 moved app-path transcription to Phase 5 item 6 and Phase 6;
Phase 4 measures the production worker.)

#### Phase 4 results (2026-10-21)

Changes:

- `lib/speech/offline-stt/`: `worker-client.ts` (`createOfflineSttClient`),
  `worker-protocol.ts` (`offline_stt/*`), `routing.ts` (`routeOfflineSpeech`,
  `offlineSpeechAvailable`), `clients.ts` (both clients and session
  teardown), and `lease.ts`, `webgpu.ts`, `preview-controller.ts` moved from
  `client-parakeet` with engine-neutral names; `workers/offline-stt-worker-runtime.ts`
  holds the ORT setup, WebGPU check and serial request queue both workers use.
- `client-parakeet/client.ts` configures the shared client and keeps its
  exports; its worker uses the shared runtime.
- `client-sensevoice/`: `assets.ts` (model routes from
  `__CLIENT_SENSEVOICE_MODELS__`), `model.ts` (fbank, language prompt, greedy
  CTC, tag removal, `zh-Hant` conversion), `kaldi-fbank.ts`, `script.ts`
  (OpenCC on first use), `client.ts`, and `workers/client-sensevoice-worker.ts`.
- `use-dictation.ts`: the offline path (renamed from the Parakeet path) runs
  the routed engine, sends the language with each window and names the engine
  in segments; `startDictation` checks the routed engine's capability.
  `lib/speech/speech-text.ts` (`joinSpeechText`) joins transcripts in the
  voice buffers and the composer. Five catalogs gain the engine-neutral errors.
- Benchmark: Nemotron, RNNT and streaming removed; SenseVoice runs in the
  production worker, driven over `offline_stt/*`, from the app's routes;
  `speech_eval.py` and `models.json` keep only SenseVoice. `knip.json` lists the
  new worker.

Harness through the production SenseVoice worker (`client-sensevoice-worker.ts`
and its `offline_stt/*` messages, driven from the benchmark worker) and the
development model routes (reference Mac, Electron 39.8.9; results under
`<evaluation root>/results/phase4/`, earlier runs through the model module
alone under `results/phase4/model-module-2026-10-21/`):

| Set | CER/WER WASM / WebGPU | Final p50 / p90 ms, WASM | Final p50 / p90 ms, WebGPU | First interim p50, WebGPU paced |
| --- | ---: | ---: | ---: | ---: |
| en | 7.9% / 7.8% | 1,284 / 2,134 | 88 / 124 | 671 |
| ja | 7.6% / 7.2% | 1,783 / 2,230 | 111 / 131 | 675 |
| ko | 10.5% / 10.6% | 1,870 / 2,412 | 107 / 131 | 674 |
| zh-Hans | 8.2% / 8.1% | 1,494 / 2,299 | 92 / 132 | 676 |
| zh-Hant | 8.2% / 8.2% | 1,408 / 2,139 | 96 / 129 | 673 |
| yue (under `zh-Hant`) | 7.6% / 7.7% | 1,434 / 2,051 | 99 / 129 | 672 |

Against the G1 targets: accuracy (ja 8%, ko 11%, zh 8.5%, Cantonese 8%),
WebGPU final p90 (0.25 s) and WebGPU first interim (0.8 s) are met, with error
rates within 0.1 point of Phase 2's. The automatic language prompt under
`zh-Hant` costs nothing on Mandarin (8.2%) and gives Cantonese 7.6% (7.7% with
the Cantonese prompt in Phase 2). WASM final p90 is 2.05–2.41 s against the
2.2 s target (over it for ja, ko and zh-Hans), measured while other sessions'
test suites ran (load average about 3, earlier 4–5); RTF is 0.15–0.17 against
0.15 in Phase 2 for the same computation, and two earlier runs through the
model module alone gave 2.13–2.45 s and 2.20–2.36 s under similar load. Phase
6's acceptance run repeats it on a quiet machine; if it still misses, the gap
goes to the owner. Memory: WASM median 998 MB, WebGPU about 3.7–4.0 GB, as in
Phase 2.

Front-end and decoder checks deferred from the Phase 2 review:
`kaldi-fbank.test.ts` now compares frames 0, 5 and 22 of a mixed signal with
kaldi-native-fbank 1.22.4 under FunASR's options (equal to two decimals), and
sherpa-onnx 1.13.8's own SenseVoice decoder (`from_sense_voice`, INT8 graph,
ITN on) scores the same sets alike: WER 8.1% en, CER 7.6% ja, 10.6% ko, 8.1%
zh-Hans, against 7.9%, 7.6%, 10.5% and 8.2% for the app; 30 of the first 40
clips are identical, the rest differ by a space or one word.

Check record (working tree; later edits touch only this plan):

| Check | Directory | Tree | Result |
| --- | --- | --- | --- |
| `pnpm verify` (via `heavy-slot.py`; `pnpm check` with `i18n:check`, lint, vitest, build) | `src/frontend` | `ac28421d` | pass; vitest 5346 passed, 1 skipped |
| `pnpm web:test:browser` (via `heavy-slot.py`) | `src/frontend` | `ac28421d` | 122 passed |
| `pnpm prettier:check` | `src/frontend` | `ac28421d` | pass |
| `uv run pytest -q -p no:xdist tests/test_speech_eval.py`; ruff check and format check on `scripts/speech-eval` and the test | root | `ac28421d` | 25 passed; pass |
| Harness runs above (`<evaluation root>/logs/phase4/`) | `src/frontend` | `ac28421d` code | all exit 0 |

Records: issue #632; commit `5974b113`; evidence: Phase 4 results.

#### Code Review #1 Findings

Reviewed working tree `b683fe49` (baseline `abe7dba4`) at the standard tier;
the reviewer re-tiered the phase. It reused the check record, reran knip (no
Phase 4 regressions) and the scoring, and resolved the licence closure.

- **P4-CR1-01 (blocking).** Phase 4 ships `opencc-js` in the app (a `cn2t`
  chunk beside the SenseVoice worker, and an entry in the desktop and hosted
  JavaScript notices) and changes which recognizer receives dictation audio,
  so it is high risk, not standard.
- **P4-CR1-02 (blocking).** With a saved offline choice, a missing SenseVoice
  set and Web Speech available, provider resolution silently started the
  browser's server-based recognizer, against R3, D1 and item 5.
- **P4-CR1-03 (blocking).** The generated notices kept only opencc-js's MIT
  `LICENSE`, not the Apache-2.0 terms of the `opencc-data` tables it bundles.
- **P4-CR1-04 (blocking).** The harness ran the model module in the benchmark
  worker, not the production worker, and the completion item (dictation and
  Voice Mode through the app path) was neither met nor deferred.
- Non-blocking: the Phase 2 deferrals (fbank fixtures, sherpa-onnx parity)
  were unaddressed at `b683fe49`; the record claimed `pnpm check` runs knip;
  the WASM narrative omitted the rerun and misquoted two figures; unused
  Parakeet alias exports; `opencc-js/cn2t` not pre-bundled for development;
  Phase 5 must give SenseVoice the WebGPU fallback notice and idle release;
  `zh-Hant`'s automatic language detection is untested on short replies and
  noise; Phase 6 must update `voice.md`'s Parakeet-only names; nits
  (dependency order, the bench's leftover engine discriminant, the Katakana
  prolonged sound mark ー joining with a space).

#### Code Review #1 Revisions

- **P4-CR1-01 accepted.** Review tiers now list Phase 4 as high risk; the
  full pre-push suite, an independent checks rerun and a recheck of every
  repair follow.
- **P4-CR1-02 accepted.** `offlineLanguageMissing` (routing) stops a saved
  offline choice with "not installed for this language" when the routed
  SenseVoice set is missing, before provider resolution; English is
  unchanged. Unit tests cover it.
- **P4-CR1-03 accepted.** `desktop/runtime/license-sources.json` gains the
  `opencc-dictionary-data` group with `opencc-data-apache-2.0.txt`, opencc-js's
  `THIRD_PARTY_LICENSES.md` reproduced unchanged (source review record added);
  `runtime-packaging.test.mjs` checks it.
- **P4-CR1-04 accepted.** The benchmark's SenseVoice adapter now drives the
  production worker through `offline_stt/*`, and the measurements above were
  repeated through it. App-path transcription through the dictation hook moves
  explicitly to the Phase 5 smoke check (item 6) and Phase 6's acceptance run.
- Non-blocking, accepted: the deferrals are addressed (results above); the
  check record and WASM narrative corrected; unused alias exports removed
  (the Parakeet client test calls `parakeetSttClient`); `opencc-js/cn2t`
  pre-bundled; Phase 5 items 2 and 6 and Phase 6 item 1 extended; dependency
  order, the bench engine type and `Script_Extensions` joining fixed (new test
  case). The bench's own ORT setup and WebGPU check moved into its Parakeet
  adapter, since SenseVoice now runs in the production worker.
- The first full pre-push run after these revisions stopped at
  `scripts/audit-typed-content.sh`, whose retired-vocabulary pattern
  `AssetVersion` matched the new `gpuAssetVersion`; the shared client's
  availability fields are now `version` and `gpuVersion`.

Repair check record (working tree; later edits touch only this plan; logs
under `<evaluation root>/logs/prepush-p4/`):

| Check | Directory | Tree | Result |
| --- | --- | --- | --- |
| `make check-test` (via `heavy-slot.py`, with the typed-content audit) | root | `3c595c6b` | pass; 4769 passed, 29 skipped |
| `pnpm verify` (via `heavy-slot.py`) | `src/frontend` | `3c595c6b` | pass; vitest 5349 passed, 1 skipped |
| `pnpm web:test:browser` (via `heavy-slot.py`) | `src/frontend` | `3c595c6b` | 122 passed |
| `pnpm prettier:check` | `src/frontend` | `3c595c6b` | pass |
| `vitest run tests/runtime-packaging.test.mjs` | `src/frontend/desktop` | `3c595c6b` code | 72 passed |
| Harness through the production worker (`<evaluation root>/logs/phase4/`) | `src/frontend` | `3c595c6b` code, before the rename | all exit 0 |

#### Code Review #2 Findings

Repair round 1 recheck of `a0fa4fce` (high-risk tier): P4-CR1-01 to 04 and the
accepted non-blocking items resolved; the fbank reference values reproduced
independently; no blocking regression. The checks subagent reran `tsc -b`,
vitest on the speech, benchmark, hook, settings, chat and runtime tests (573),
ESLint, `pnpm i18n:check`, knip (no Phase 4 findings), `pnpm desktop:test`
(539), the licence closure and notice (`cmp` identical), the built bundle
(SenseVoice worker and a lazily imported `cn2t` chunk; no benchmark code), the
typed-content audit, `test_speech_eval.py`, `test_model_assets.py`,
`test_prepare_source.py` and the scoring: all pass.

- **P4-CR1-R1-01 (non-blocking).** Plan wording: the Decision Log and Phase 4
  changes still said the benchmark runs the model module, "three earlier
  runs" were two, and Phase 4's completion item did not point to its
  deferral; `model.ts`'s header named the benchmark.
- **P4-CR1-R1-02 (non-blocking).** The benchmark's nested-worker requests had
  no crash handling, and paced previews were sent as finals.

#### Code Review #2 Revisions

- **P4-CR1-R1-01 accepted.** Wording corrected in the Decision Log, changes,
  results and completion item; `model.ts`'s header names only the worker.
- **P4-CR1-R1-02 accepted.** A worker `error` rejects the benchmark's pending
  requests; `BenchEngine.transcribe` takes the decode kind, so previews go to
  the worker as previews. `tsc -b`, `vitest run src/dev/speech-bench` (6),
  ESLint and a two-clip paced WebGPU run through the production worker (first
  interim 671–678 ms, final 84–131 ms) pass.

#### Code Review #3 Findings

Repair round 2 recheck of `b535d205`: P4-CR1-R1-01 and R1-02 resolved; no
regression. Optional: two edited plan lines ran past the 80-column wrap.

#### Code Review #3 Revisions

The two lines were rewrapped (plan only). No findings remain; the phase
passes its review.

### Phase 5 — Settings, Setup, language notice and turn-taking (R4, R5, R6)

Dependencies: Phase 4.

Changes:

1. Replace `speechEngineIsEnglishOnly` for speech-to-text with a check of
   whether the routed engine supports the active locale and is installed.
   `SpeechLanguageNotice` shows nothing when it is, a download prompt when the
   model is missing, and the Pocket TTS notice unchanged. Fix
   `SetupVoiceStep.tsx:61`.
2. Offline speech downloads list the new set (and add-on) with attribution
   (`?raw` import plus its folder in `modelNoticeRoots`); generalize
   `useOfflineSpeechDownloads`, `knownAssetIds` and `installedSpeechSets`;
   `ChatInterface` speech availability follows the routed engine. SenseVoice
   also needs the WebGPU fallback notice and the idle release before removal
   (`senseVoiceSttClient.getLastBackendState()` and `disposeIdle()`), which
   Parakeet already has.
3. Settings labels per Q1 and Setup offers per Q2, as decided at G1; Setup's
   English-only Parakeet description is updated.
4. Translations in all catalogs; `terms.json` gains the model name.
5. Smart Turn: one shared Unicode-aware normalization (remove the duplicate in
   `use-dictation.ts`), localized short replies for `ja`, `ko`, `zh-Hans` and
   `zh-Hant`, and a new test file.
6. Smoke check (D11): the harness plays the ja, ko and zh clips through MicVAD
   and Smart Turn and records speech detection and end-of-turn decisions below.
   It also plays them through the dictation hook's offline path, the first
   app-path transcription of the test clips (Phase 4 measured the production
   worker), with short replies and noise windows under `zh-Hant`'s automatic
   language detection.

Checks: `SpeechLanguageNotice`, `VoiceDownloads`, `stt-settings`,
`ChatSpeechAvailability`, Smart Turn override and model-download coordination
tests; `web/scripts/setup-downloads.browser.test.mjs`; `pnpm i18n:check` and
`pnpm i18n:status`; `pnpm check`, `pnpm web:lint`, `pnpm web:test`,
`pnpm build`; screenshots of each notice state at desktop size and one narrow
width.

Completion: notice, downloads and Setup behave per R4 and R5 under every
locale; smoke-check results recorded.

#### Phase 5 results (2026-10-21)

Changes as listed, plus:

- `lib/speech/offline-stt/clients.ts` maps each engine to its client and set
  ids; `OfflineSpeechDownloads` renders one section per engine (languages,
  model line, attribution), `useOfflineSpeechDownloads(engine)` serves Settings
  and Setup, and SenseVoice's sets get the fallback notice and idle release
  through the shared client. Vite development shows each engine's acquire
  commands instead.
- `SpeechLanguageNotice` reads runtime capabilities; `speechEngineIsEnglishOnly`
  became `ttsEngineIsEnglishOnly` plus `isOfflineSttChoice`. Settings and the
  composer resolve offline availability through `routeOfflineSpeech`; the
  composer's install hint and Setup offer only the routed engine.
- The Settings WebGPU trigger label is now `voice.stt.offlineWebgpu`; one new
  catalog string, `languageNotice.speechToTextUnavailable`, covers
  operator-managed runtimes.
- The SenseVoice decoder removes spaces beside Chinese or Japanese text
  (`closeUnspacedGaps`, shared with transcript joining) and returns no text for
  a window of punctuation alone (see Surprises).

Smoke check (D11), 2026-10-21, on task stack `animama-msr` (Vite development,
host sets for both engines, CPU/WASM). A Playwright harness
(`drafts/phase5_smoke.mjs` and `phase5_smoke_cases.py` in the speech-eval root)
starts headless Chromium with the clip as its fake microphone
(`--use-file-for-fake-audio-capture`; 1 s lead-in, 5 s trailing silence), sets
the UI Locale and the offline choice through `/v1/users/me/settings`, and
presses Voice Mode or Dictate in the composer, so the app's own
`getUserMedia` processing, MicVAD, Smart Turn and dictation hook run. Voice
Mode submissions are read from the `chat:sse` request and aborted in the
browser, so no model provider was called.

| Cases | Result |
| --- | --- |
| FLEURS clips: 3 each for ja, ko, zh-Hans, zh-Hant and 2 Cantonese under zh-Hant, Voice Mode | MicVAD found one voiced segment and SenseVoice produced one window each; every submitted text is the sentence in the locale's script, with recognition errors of the kind the CER measures (for example 群島→軍島). Smart Turn ended all 14 turns (model probability 0.98–0.99, one 0.45 that still crossed the threshold). Final text 0.8–1.6 s after each window. |
| The first clip of each set, dictation | Composer text matched the Voice Mode text (ko differed only in one space). |
| Short replies, macOS voices: はい, ありがとうございます, 네, 감사합니다, 好的, 谢谢, 好的/謝謝/沒問題 (zh-Hant), 唔該, 係 (Cantonese) | Smart Turn's model ended all 11 turns (0.81–0.99), so the new override list was not needed; final text 0.35–0.55 s after each window. Nine texts were right. 네 became "4." and 係 became "はい。" on every run (three each); 감사합니다 once read "감사 합니다." |
| White, pink and 120 Hz noise under zh-Hant | MicVAD rejected all three: no window, no text. |
| Reversed speech under zh-Hant (passes MicVAD) | Reversed Chinese decoded to "." and was submitted; after the punctuation fix nothing is submitted. Reversed English gave "As your what." (a recognizer cannot tell it from speech). |
| An English sentence under zh-Hant | Transcribed in English by automatic language detection. |

The two wrong short replies come from the microphone path, not the decoder:
the same clips through the app's SenseVoice worker in a page (no capture)
give "네." and "系。" (SenseVoice writes Cantonese 係 as 系, which the
Traditional conversion keeps, so the override list includes 系), as does
sherpa-onnx in Python. Browser capture applies
echo cancellation, noise suppression and automatic gain to every engine; the
clips are synthetic voices. G4, the owner's live check, now includes short
replies; if a real 네 still reads as "4.", the follow-up is to examine the
captured window (onset trimming or processing), not the decoder.

Screenshots (speech-eval root, `smoke/screens/`): Setup's Voice step under ja
(1440×900) and zh-Hant (390×844) offering SenseVoice; Settings → Voice under ja
with the set missing (download notice) and installed (no notice), under ko at
390×844 with the set missing, and under English (Parakeet named, no notice).
Missing sets were shown by rewriting the capabilities response in that browser
only. The Pocket TTS notice appears unchanged in the Setup shots.

Check record (working tree; later edits touch only this plan; logs in
`<evaluation root>/logs/p5-*.log`):

| Check | Directory | Tree | Result |
| --- | --- | --- | --- |
| `pnpm verify` (via `heavy-slot.py`; `pnpm check` with `i18n:check`, lint, vitest, build) | `src/frontend` | `7abd637f` | pass; vitest 5366 passed, 1 skipped |
| `node --test --test-concurrency=1 scripts/setup-downloads.browser.test.mjs` (via `heavy-slot.py`) | `src/frontend/web` | `7abd637f` | 23 passed |
| `pnpm i18n:status` | `src/frontend` | catalogs as at `7abd637f` | every translated catalog complete |
| `pnpm prettier:check` | `src/frontend` | `7abd637f` | pass |
| Smoke check and screenshots above | task stack `animama-msr` | working tree before the punctuation fix; the reversed-speech cases reran after it | as recorded |

Records: issue #633; commits —; evidence: Phase 5 results.

#### Code Review #1 Findings

Standard tier, initial review of working tree `b9f4b51a` against `5974b113`
(reusing the check record; no rerun). Acceptance met; no high-risk trigger.
Verdict: pass with non-blocking findings.

- **P5-CR1-01.** The Cantonese 係 entry cannot match SenseVoice's output 系
  (OpenCC `cn2t` keeps it); the plan treated "系。" as correct.
- **P5-CR1-02.** The WebGPU choice's description did not name the model, though
  the Decision Log said both choices do.
- **P5-CR1-03.** The language-aware provider resolution was duplicated in
  `ApplicationSettingsModal` and `use-dictation`, the Settings copy untested.
- **P5-CR1-04.** An installed set turned off by the operator got a download
  prompt.
- **P5-CR1-05.** A loaded asset list without an engine's sets showed
  "Checking…" forever (for example a hosted operator skipping SenseVoice).
- **P5-CR1-06.** そうですね (and, weaker, ええ and 아니) break the plan's own
  rule against hesitation openers.
- **P5-CR1-07.** `docs/frontend/desktop/feature-packs.md` and `installation.md`
  describe the old Parakeet-only UI but were not in Phase 6's list.
- **P5-CR1-08.** Minor: a decoder test case without a space; a stale
  `useModelAssets` comment; one mock client for both engines in
  `VoiceDownloads.test.tsx`; the SenseVoice attribution shown is the CPU set's
  file; a stale Progress entry; `OFFLINE_SPEECH_ASSET_IDS` duplicated the
  per-engine ids.

#### Code Review #1 Revisions

- **P5-CR1-01 accepted.** 系 joins the list with a comment, tested with
  "系。"; the results and Decision Log explain it.
- **P5-CR1-02 accepted.** `webgpuDescription` takes `{{model}}` in all five
  catalogs; `getSttSettingsOptions(options, engine)` passes it (tested).
- **P5-CR1-03 accepted.** `resolveRoutedSttProvider` (`stt-provider.ts`) serves
  dictation and Settings, with tests for ja with the set missing and Web Speech
  present (stays offline, `languageMissing`), ja installed, and English with
  Parakeet missing (falls back as before).
- **P5-CR1-04 accepted.** An installed (version reported) but unavailable set
  gets the "not available on this server" wording (tested).
- **P5-CR1-05 accepted.** `listLoaded` makes an absent set read "Not
  available" (GPU: "unavailable in this build") instead of "Checking…"
  (tested); Phase 6 item 8 notes the hosted effect.
- **P5-CR1-06 accepted.** ええ, そうだね, そうですね and 아니 are removed and
  tested as not ending the turn; 아니요 stays.
- **P5-CR1-07 accepted.** Both guides join Phase 6 item 1.
- **P5-CR1-08 accepted** except the attribution placement: a "こんworld" case,
  the comment, separate per-engine client mocks with a test that a SenseVoice
  removal releases only SenseVoice's idle leases, the Progress entry, and one
  `offline-stt/asset-ids.ts` used by the downloads and the coordination. The
  attribution stays the CPU set's: every install has that set, and its notice
  covers the same model and licence (the add-on's own file ships with it).

Repair check record (working tree; later edits touch only this plan; logs
`<evaluation root>/logs/p5-*-r1.log`): `pnpm verify` (via `heavy-slot.py`) in
`src/frontend` at `ee1d20f7` — pass, vitest 5373 passed, 1 skipped;
`setup-downloads.browser.test.mjs` in `src/frontend/web` at `ee1d20f7` — 23
passed; `pnpm prettier:check` at `ee1d20f7` — pass. The standard tier needs
no recheck; the phase passes its review.

### Phase 6 — Acceptance runs, packaging checks and documentation (R7, acceptance)

Dependencies: Phase 5.

Changes and checks:

1. Documentation: `docs/frontend/runtime/voice.md`,
   `docs/backend/operations/model-assets.md`,
   `docs/backend/architecture/http-api.md`, `scripts/models/README.md`,
   `docs/frontend/architecture/{i18n,content-and-workers}.md`,
   `docs/frontend/desktop/redistribution-review.md`, `contracts/hosted-web.md`,
   `GLOSSARY.md` (Conversation language, Model asset) and, if Q6 is agreed,
   ADR 0025 with a history note in ADR 0024 and the ADR index. Also the
   speech model source and switches in
   `docs/backend/operations/{development,desktop-runtime,local-http-components}.md`,
   `docs/frontend/architecture/auth-server.md` and the root `AGENTS.md` Local
   Stacks section (Phase 3 Code Review #1), the user guides
   `docs/frontend/desktop/feature-packs.md` (the Parakeet-only title and table)
   and `docs/frontend/desktop/installation.md` (Phase 5 Code Review #1), and
   `voice.md`'s references to the
   former `client_parakeet/*` messages, `loadClientParakeetWorker`,
   `createParakeetPreviewController` and `client-parakeet/preview-controller.ts`
   (Phase 4 Code Review #1).
2. Acceptance run of the full test set through the production path on the
   reference Mac, CPU and WebGPU: accuracy, latency, script check, English,
   silence and noise windows, absence of tags.
3. Network inspection during a recorded dictation run with the model
   installed: no outbound requests.
4. Built self-host stack (`ANIMAMA_WEB_BUILD_MODE=production ./reset.sh --name
   <name> --base-port <port>`): download, resume, removal, lease refusal and
   transcription. Needs G2 for downloads from the shared origin; otherwise
   recorded as outstanding.
5. Packaged desktop build on the reference Mac: same checks; `pnpm
   desktop:check`, desktop runtime audit and packaging tests.
6. `pnpm e2e:test:fast` against a disposable built stack.
7. Owner gates G3 and G4 recorded in the PR.
8. Cloud follow-up recorded in the PR as outstanding: animama-cloud must
   support or skip `sensevoice-stt` and `sensevoice-stt-webgpu` before it
   repins to an Animama release with this catalog (Surprises, 2026-10-21).
   If it skips them, hosted Settings shows the SenseVoice section as "Not
   available" and non-English locales get the "not available on this server"
   notice.

Completion: every spec acceptance item is checked or recorded as an outstanding
owner gate.

Records: issue #634; commits —; evidence —.

#### Code Review #1 Findings

Not run.

#### Code Review #1 Revisions

Not run.

## Final integration review

Covers combined acceptance, reusing still-valid phase evidence; findings and
revisions recorded here.

## Validation and acceptance

Spec acceptance criteria map to: R1 report (Phase 2); language runs, script and
silence checks (Phases 4 and 6); Smart Turn (Phase 5); notice (Phase 5);
assets (Phases 3 and 6); network (Phase 6); notices and redistribution (Phase 3
and 6); Windows (G3); live check (G4). Local checks are recorded with exact
commands and results; hosted validation is run only as the owner decides, and
recorded separately from local evidence.

## Idempotence and recovery

- `fetch` and evaluation acquisition verify pinned hashes and can be rerun;
  deleting the evaluation root only costs a re-download.
- Model-set acquisition is atomic and versioned by manifest digest, like
  Parakeet's. A bad set fails verification and is reacquired.
- No database migration: reverting the code leaves installed sets as unused
  files that the model-asset removal action deletes. Preferences keep their
  stored values, so Parakeet users are unaffected by a rollback.
- If G1 changes the model after Phase 3 starts, the unpublished set is replaced
  in place: there are no released installs to migrate.

## Outcomes & Retrospective

Not started.
