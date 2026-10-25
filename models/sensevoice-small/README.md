---
license: other
license_name: funasr-model-license-1.1
license_link: https://github.com/modelscope/FunASR/blob/58830eca4012644aac0c3218c3ccc7d98f003fda/MODEL_LICENSE
pipeline_tag: automatic-speech-recognition
tags:
  - onnx
  - automatic-speech-recognition
  - sensevoice
  - int8
---

# SenseVoice-Small ONNX Weights

This model set contains the INT8 SenseVoice-Small graph, its token table and
its front-end parameters, which Animama uses to transcribe Japanese, Korean,
Mandarin (Simplified and Traditional) and Cantonese offline on the CPU.

Source snapshot: `csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17`
at `2365baeacb507f821a0c8120fcee3d484dba7a07`

`metadata.json` holds the graph's own ONNX `metadata_props` (frame stacking,
CMVN statistics, language and normalization prompt ids), copied unchanged
except for the quantizer's `onnx.infer` key, because the browser runtime
cannot read ONNX metadata.

See `ATTRIBUTION.md` for source attribution and licence terms.
