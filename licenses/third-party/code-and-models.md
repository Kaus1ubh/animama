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
| `public/tts/vendor/sentencepiece.js` | Exact Pocket snapshot at intake; embedded WASM exactly matches integrity-verified `@sctg/sentencepiece-js` 1.3.3, npm gitHead `30916b62bae58f8bb9cd038d3b5e449eee4cae6e` | Apache wrapper/Google SentencePiece; Microsoft helper and compiled dependency notices preserved. Removed only three unused example-tokenizer constants/exports on 2026-09-15. Processor and WASM unchanged. |
| Seven Pocket model, tokenizer and voice files | Five ONNX: codexxx `6fbae64699d94f60dde9c3975984b383a6a3d950`; tokenizer/voices: KevinAHM above | Owner elects stricter CC-BY-NC-4.0 for noncommercial use. README CC BY versus dedicated ONNX-LICENSE CC BY-NC disagreement remains disclosed. These assets are not AGPL; replace or obtain permission before commercial use. |
| Nine ONNX Runtime browser files | Integrity-verified `onnxruntime-web` 1.24.2 | MIT and full source-tag v1.24.2 third-party notices. The complete upstream notice file includes optional components; inclusion does not assert every component is in this browser build. |
| Basis transcoder JS/WASM | Exact three.js r182 distribution | Apache-2.0 plus zstd BSD notice. Local README formatting differs. Binomial NOTICE observed at `99f52d63aa6799cbdaecfe977111dc5ec3b31d47` is later license evidence, not the transcoder's build revision. |
| VAD worklet and Silero v5 model | Exact `@ricky0123/vad-web` 0.0.30 package files | ISC worklet and MIT Silero model. |
| Smart Turn CPU model | Exact pinned model `f766f81d3cfdf7737ac64aad813d91bbfd56bf93` | Model card declares BSD-2-Clause. Full text comes from linked Daily/pipecat code; the model repository's LICENSE endpoint returns 404. |
| Parakeet seven-file source subset | istupakov `0bbb45a3365852604aef28b538a8f066f4ccaa85`; ysdede `db4a768f5795e0f508187a34241fbeeef6ebb0d3` | NVIDIA CC BY 4.0 attribution, conversion/INT8/rebuilt-preprocessor changes, and onnx-asr MIT tooling notice. Direct pinned config/vocab files match despite stale producer-manifest hashes. |

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

## Retained imported dashboards

The JSON templates are locally modified derivatives. Their original IDs and
UIDs identify the linked upstreams; the reviewed revisions below are source and
license comparisons, not claims to have recovered the historic import commits.
Raymond Van's local modifications include Animama-specific provisioning and
query/dashboard configuration. Preserve these change notices with the files.

| Local dashboard | Reviewed upstream | Full license |
| --- | --- | --- |
| `observability/grafana/dashboards/animama-fastapi-v2.json` (16110) | blueswen/fastapi-observability `2764dba3e8b9f2ad692eb5377db988414201940d` | [MIT, copyright 2022 Blueswen](blueswen-fastapi-observability-LICENSE.txt) |
| `observability/grafana/dashboards/animama-postgres.json` (9628) | lstn/misc-grafana-dashboards `e18068331e9a54f82766844cad2c7fa098e4a1e0` | [Apache-2.0](lstn-misc-grafana-dashboards-LICENSE.txt) |
| `observability/grafana/dashboards/node-exporter.json` (1860) | rfmoz/grafana-dashboards `99a25cc154c21c4fcbae1aa24352bf1b6764d847` | [Apache-2.0](rfmoz-grafana-dashboards-LICENSE.txt) |

The two templates without recovered redistribution grants were removed. Other
project-specific observability source remains covered by the owner's authorship
review; a Grafana product license is never used as a grant for independent
uploaded dashboard templates.

## Remaining acceptance

This bounded review requires no further owner questionnaire. Retain the
noncommercial Pocket restriction and the disclosed source-build limitations.
Independent candidate builds, actual speech playback, complete generated
runtime dependency notices, and exact source/binary acceptance remain separate
checks before public distribution. Do not change a `pending` release approval
field merely because these source/notice mappings now exist.
