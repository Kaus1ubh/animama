# Retained code, speech models and dashboard notices

This source review covers the exact files and SHA-256 values in
[code-and-models.json](code-and-models.json). It preserves original third-party
terms while Animama's working source remains proprietary. A later license
transition for Raymond Van's own code must retain these exceptions and notices.
It is a preparation record, not signed-binary or public-release acceptance.

## Browser and speech runtime

| Files / family | Reviewed source | Preserved terms and changes |
| --- | --- | --- |
| Pocket browser integration, including shared `speech/audio/PCMPlayerWorklet.js` | KevinAHM/pocket-tts-web `3cf6daa623e2b09992c972cab32568ee8679a154` | Apache-2.0 upstream portions; Raymond Van's local integrations, worker lifecycle, debug support and shared playback retain the repository license. Prominent file headers identify adaptation. |
| `public/tts/workers/pocket-runtime.js` | KevinAHM/pocket-tts-onnx reference runtime `pocket_tts_onnx.py` at `58a6d00cf13d239b6748cb0769f35c580a8f606c` | Apache-2.0 code. Raymond Van's JavaScript port of its state, voice-state and generation-limit rules; the file header identifies the adaptation. |
| `scripts/voices/pocket_onnx.py` | KevinAHM/pocket-tts-onnx reference runtime `pocket_tts_onnx.py` at `58a6d00cf13d239b6748cb0769f35c580a8f606c`, via the worker rules in `pocket-runtime.js` | Apache-2.0 code. Raymond Van's Python port of the voice-conditioning, sampling and stopping rules, used offline to encode and screen voices; the file docstring identifies the adaptation. |
| `public/tts/vendor/sentencepiece.js` | Exact Pocket snapshot at intake; embedded WASM exactly matches integrity-verified `@sctg/sentencepiece-js` 1.3.3, npm gitHead `30916b62bae58f8bb9cd038d3b5e449eee4cae6e` | Apache wrapper/Google SentencePiece; Microsoft helper and compiled dependency notices preserved. Removed only three unused example-tokenizer constants/exports on 2026-09-15. Processor and WASM unchanged. |
| Pocket model, tokenizer, metadata and 38 voice files | Kyutai Pocket TTS english_2026-04. Export, tokenizer and metadata: KevinAHM/pocket-tts-onnx `58a6d00cf13d239b6748cb0769f35c580a8f606c`. 14 precomputed voice states: kyutai/pocket-tts-without-voice-cloning `4e1e0a3e611c51c0b4ed8174fc10f32a54644303`. 24 Animama-encoded VCTK voice states from kyutai/tts-voices `323332d33f997de8394f24a193e1a76df720e01a` clips, published at `downloads.animama.ai` (`scripts/voices`). | All CC BY 4.0: Kyutai publishes the model and its precomputed states under CC BY 4.0, and the Animama-encoded states derive from Kyutai-enhanced CSTR VCTK Corpus recordings (University of Edinburgh). The recordings behind `bill_boerst`, `caro_davy` (Voice-Zero, LibriVox), `javert` and `marius` (Unmute voice donations) are CC0. `pocket-tts-attribution.txt` names every voice and its source. Commercial use is permitted with attribution; Kyutai's model-card prohibited-use terms still apply. These assets are not AGPL. Animama's desktop release policy separately records a noncommercial distribution basis. |
| Nine ONNX Runtime browser files | Integrity-verified `onnxruntime-web` 1.24.2 | MIT and full source-tag v1.24.2 third-party notices. The complete upstream notice file includes optional components; inclusion does not assert every component is in this browser build. |
| Basis transcoder JS/WASM | Exact three.js r182 distribution | Apache-2.0 plus zstd BSD notice. Local README formatting differs. Binomial NOTICE observed at `99f52d63aa6799cbdaecfe977111dc5ec3b31d47` is later license evidence, not the transcoder's build revision. |
| VAD worklet and Silero v5 model | Exact `@ricky0123/vad-web` 0.0.30 package files | ISC worklet and MIT Silero model. |
| Smart Turn CPU model | Exact pinned model `f766f81d3cfdf7737ac64aad813d91bbfd56bf93` | Model card declares BSD-2-Clause. Full text comes from linked Daily/pipecat code; the model repository's LICENSE endpoint returns 404. |
| Parakeet seven-file source subset | istupakov `0bbb45a3365852604aef28b538a8f066f4ccaa85`; ysdede `db4a768f5795e0f508187a34241fbeeef6ebb0d3` | NVIDIA CC BY 4.0 attribution, conversion/INT8/rebuilt-preprocessor changes, and onnx-asr MIT tooling notice. Direct pinned config/vocab files match despite stale producer-manifest hashes. |
| Parakeet WebGPU FP16 encoder | ysdede `db4a768f5795e0f508187a34241fbeeef6ebb0d3` | NVIDIA CC BY 4.0 attribution for the upstream FP16 ONNX conversion, redistributed unmodified in the optional `parakeet-stt-webgpu` desktop pack and, with its attribution and README, under the R2 `models/` prefix for in-app self-host downloads. The built web app shows the attribution beside that download. |

Full texts and attribution are in
[`src/frontend/desktop/runtime/notices`](../../src/frontend/desktop/runtime/notices/).
The desktop license-source inventory references these texts, so normal runtime
staging carries them into its generated notice bundle. Final packaging must
still inspect the generated inventory and the exact binary/optional-pack
contents. Source notices alone do not prove a packaged release contains them.

SentencePiece wrapper authors are recorded upstream as devilyouwei, Jan Kaul
and Ronan Le Meillat. The reviewed wrapper source at
`ed260044938b4ee7b35d45c2e03dd19e7a47e5b0` pins Google SentencePiece
`d8f741853847553169444afc12c00f4bbff3e9ce`. Preserve abseil, Darts-clone, esaxx,
protobuf-lite, Emscripten and Microsoft helper notices alongside the wrapper
license. The original Emscripten compiler version is not recorded; the reviewed
1.3.3 npm binary match establishes the retained WASM artifact, not a reproducible
compiler receipt. No unused embedded Meta/other example tokenizer datasets
remain in the distributed wrapper.

## Local Whisper feature extractor

`src/frontend/web/src/lib/voice/smart-turn/local-whisper-feature-extractor.mjs`
explicitly adapts Transformers.js 3.8.1 (Apache-2.0). Its P2FFT math also derives
from fft.js (MIT, copyright Fedor Indutny 2017), as identified in the upstream
Transformers math source. Both full license texts and a change notice are in the
runtime notice directory. The local file preserves its source pointers and
identifies Raymond Van's fixed-window/integration changes.

## Retired imported dashboards

The optional local observability stack and its dashboard sources are no longer
part of this repository. Their upstream MIT and Apache-2.0 license texts remain
as historical credits; they do not describe active application dependencies.
The application does not require a separate monitoring checkout to build or run.

## Remaining acceptance

This bounded review requires no further owner questionnaire. Retain the
Pocket attribution notices and the disclosed source-build limitations.
Independent candidate builds, actual speech playback, complete generated
runtime dependency notices, and exact source/binary acceptance remain separate
checks before public distribution. Do not change a `pending` release approval
field merely because these source/notice mappings now exist.
