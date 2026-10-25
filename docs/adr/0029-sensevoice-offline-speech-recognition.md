# 0029: SenseVoice-Small for Japanese, Korean and Chinese offline speech recognition

- Status: accepted (owner, 2026-10-21, gate G1); decisions 1–2 amended by
  [0031](0031-offline-speech-engine-is-the-owners-choice.md)
- Recorded: 2026-10-21
- Retrospective: no
- Original decision date: 2026-10-14 (owner scope decisions D1–D12 during
  intent discovery) and 2026-10-21 (owner model choice and answers to Q1–Q7 at
  gate G1, and the WebGPU graph the same day)
- Decision basis: [issue #509](https://github.com/raymond-van/animama/issues/509),
  its [specification snapshot](../plans/multilingual-speech-recognition/multilingual-speech-recognition-spec.md)
  and [execution plan](../plans/multilingual-speech-recognition/multilingual-speech-recognition-execplan.md)
  (Decision Log, the Phase 2 comparison report and Surprises & Discoveries)

## Context

[ADR 0024](0024-ui-locale-is-the-conversation-language.md) made the UI Locale
the conversation language, but the only offline recognizer, Parakeet TDT 0.6B
v2, understands English only. The desktop app treats the browser's Web Speech
recognition as unavailable, so desktop owners under `ja`, `ko`, `zh-Hans` or
`zh-Hant` could not dictate or use Voice Mode in their own language.

The owner's constraints: recognition stays on the device with no cloud
transcriber (D1); it runs in the existing browser worker on the app's
`onnxruntime-web`, on the CPU (single-thread WASM) and WebGPU paths, with no
native sidecar; the CPU set stays within about 700 MB (D3); SenseVoice's FunASR
Model License is accepted with attribution (D4); and one model serves English
too only if its English WER is within about 1.5 points of Parakeet's (D8).

The Phase 2 comparison ran 75 FLEURS clips per language on the reference Mac
(Apple M5) in the desktop app's Electron 39.8.9:

- **SenseVoice-Small** (sherpa-onnx export): CER 7.6% `ja`, 10.5% `ko`, 8.2%
  Mandarin and 7.7% Cantonese on WASM; English WER 7.9% against Parakeet's
  4.1%. On WASM its real-time factor is 0.15 (final text p90 about 2.1 s);
  on WebGPU final text arrives in about 0.1 s. It fits the existing per-window
  worker protocol with one added field, the language.
- **Nemotron 3.5 ASR** (streaming): CER 15.1–15.7% `ja`, 12.6–12.9% `ko` and
  21.5–21.6% Mandarin across its two chunk sizes, with no Cantonese. With ORT
  1.24 it runs only on WASM: its INT4 export returns empty text on WebGPU and
  is slower than real time on WASM, and its INT8 export fails on WebGPU and
  uses 85–90% of a core in real time. Its first partial text arrives after
  2.2–4.0 s, and streaming needs a stateful session protocol in the worker.

## Decision

1. **The engine follows the conversation language.** English (and an unset or
   unsupported locale) keeps Parakeet. `ja`, `ko`, `zh-Hans` and `zh-Hant` use
   SenseVoice-Small, prompted with the language. `zh-Hant` uses automatic
   language detection, so Mandarin and Cantonese speakers both get text, and
   converts the output to Taiwan-standard Traditional with OpenCC
   (`opencc-js`), whose tables load in the worker on first use.
2. **Routing happens when a session starts.** A locale change applies from the
   next dictation or Voice Mode start. The stored `stt_provider: "parakeet"`
   means offline recognition with either engine and `stt_parakeet_webgpu` is
   the GPU preference for both; neither is renamed. Setup and App Settings
   choose by engine (Browser on the web, SenseVoice, Parakeet), then CPU or
   GPU, with the recommended engine tagged: the browser on the web, the UI
   Locale's offline engine on desktop (owner, 2026-10-24, replacing G1's
   engine-neutral "Offline" labels).
3. **No cloud fallback.** A saved offline choice under a non-English locale
   whose SenseVoice set is missing stops with a "not installed for this
   language" error instead of switching to a browser recognizer, which may
   send audio to a cloud service.
4. **Two runtime download sets, not bundled.** `sensevoice-stt` holds the INT8
   graph, token table and front-end `metadata.json` for the CPU (about 240 MB).
   The optional `sensevoice-stt-webgpu` add-on holds the upstream FP32 graph
   (about 938 MB), because the INT8 graph's quantized operators have no WebGPU
   kernels; it requires the CPU set. Packaged desktop and built self-host
   download both in the app through the backend model-asset service, as
   [ADR 0012](0012-backend-parakeet-model-assets.md) does for Parakeet; the
   build carries their catalog entries and notices, not the weights.
5. **Interim text on WebGPU only**, as for Parakeet; each engine keeps its own
   worker behind one engine-neutral page-side client and worker protocol.

## Alternatives

- **SenseVoice for every language.** Its English WER (7.9%) is 3.8 points worse
  than Parakeet's, beyond D8's tolerance, so Parakeet stays for English.
- **Nemotron 3.5 ASR.** Less accurate in every set, without Cantonese, WASM-only
  in this runtime and costlier in CPU and protocol. Its final text arrives
  0.2–1.0 s sooner on the CPU path, which does not outweigh these. Streaming
  recognition was dropped with it.
- **An FP16 WebGPU graph.** Converting the FP32 graph to FP16 compute left its
  own casts and a `Range` output inconsistent, so sessions failed or WebGPU
  returned empty text. Storing only the weights as FP16 (about 470 MB) worked
  with the same accuracy and latency, but it would be a converted file with no
  upstream source; the owner chose the pinned upstream FP32 graph, as Parakeet's
  sets are upstream files, over that file or an unreviewed third-party upload.
- **Bundling the weights in the installer.** Rejected for runtime downloads,
  matching ADR 0012.
- **A separate provider per model in Settings.** Rejected for one offline
  choice whose description names the model in use.

## Consequences

- Each offline engine's tab in Setup and App Settings offers its sets'
  downloads; the composer's install hint offers only the UI Locale's engine. `SpeechLanguageNotice` asks for the language's download
  instead of warning that recognition is English-only; Pocket TTS keeps its
  English-only notice.
- Runtime capabilities gain `offline_multilingual_speech_enabled` and its CPU
  and GPU set versions, defaulting to off (`local-http` contract major 15); `ANIMAMA_SENSEVOICE_STT_ENABLED`
  switches SenseVoice like `ANIMAMA_PARAKEET_STT_ENABLED`, and
  `ANIMAMA_PARAKEET_SOURCE` keeps its name and selects both engines' sets.
- Smart Turn's forced end-of-turn short replies gain Japanese, Korean and
  Chinese (including Cantonese) entries, compared after one NFKC,
  punctuation-free normalization; hesitation openers are excluded.
- The FunASR Model License 1.1 requires attributing the source and author and
  keeping the model name; its full text ships with the desktop notices, and
  OpenCC's dictionary data (Apache-2.0) joins the JavaScript notices.
- Taiwan accents were not tested: `zh-Hant` was measured on Mainland Mandarin
  audio with references converted to Traditional (gate G0 fallback).
- The hosted Animama Cloud API accepts only model-asset catalog IDs it knows.
  Before Cloud adopts an Animama release whose catalog contains
  `sensevoice-stt` and `sensevoice-stt-webgpu`, it must support or skip them
  and admit `local-http` major 15; if it skips them, hosted Settings shows
  SenseVoice as not available.

## Evidence

- [`lib/speech/offline-stt/routing.ts`](../../src/frontend/web/src/lib/speech/offline-stt/routing.ts):
  engine routing and the missing-language rule.
- [`lib/speech/client-sensevoice/model.ts`](../../src/frontend/web/src/lib/speech/client-sensevoice/model.ts)
  and [`script.ts`](../../src/frontend/web/src/lib/speech/client-sensevoice/script.ts):
  language prompts, decoding and the `zh-Hant` conversion.
- [`models/sensevoice-small/manifest.json`](../../models/sensevoice-small/manifest.json)
  and [`models/sensevoice-small-webgpu/manifest.json`](../../models/sensevoice-small-webgpu/manifest.json):
  the pinned sets.
- [Voice runtime](../frontend/runtime/voice.md#offline-engine-choice)
  and [model setup](../backend/operations/model-assets.md#sensevoice-multilingual-sets):
  current behavior and operation.
