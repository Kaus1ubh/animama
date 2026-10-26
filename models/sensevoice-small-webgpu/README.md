---
license: other
license_name: funasr-model-license-1.1
license_link: https://github.com/modelscope/FunASR/blob/58830eca4012644aac0c3218c3ccc7d98f003fda/MODEL_LICENSE
pipeline_tag: automatic-speech-recognition
tags:
  - onnx
  - automatic-speech-recognition
  - sensevoice
  - fp32
  - webgpu
---

# Optional SenseVoice-Small WebGPU Graph

This optional model set contains only the FP32 SenseVoice-Small graph, which
Animama loads on WebGPU because the INT8 graph's quantized operators have no
WebGPU kernels. It pairs with the token table and front-end parameters from
the base `sensevoice-small` set, which is still required.

Source snapshot: `csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17`
at `2365baeacb507f821a0c8120fcee3d484dba7a07`

See `ATTRIBUTION.md` for source attribution and licence terms.
