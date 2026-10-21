# Attribution and Licensing

This optional set packages one derivative ONNX artifact of SenseVoice-Small.

## Upstream Sources

- Model: SenseVoice-Small (`iic/SenseVoiceSmall`, published as
  `FunAudioLLM/SenseVoiceSmall`), Copyright (C) 2023-2028 Alibaba Group,
  licensed under the FunASR Model Open Source License Agreement, version 1.1
  (`https://github.com/modelscope/FunASR/blob/58830eca4012644aac0c3218c3ccc7d98f003fda/MODEL_LICENSE`).
- ONNX conversion: the k2-fsa sherpa-onnx project,
  `csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17`
  (snapshot: `2365baeacb507f821a0c8120fcee3d484dba7a07`).

## Included Derivatives

- `model.onnx` matches the pinned sherpa-onnx snapshot.

## Publication Notes

- Preserve the FunASR licence terms: attribute the source and author and keep
  the model name SenseVoice-Small.
- Do not remove this file when publishing.

Development stacks load this set from the operator's model store. Animama
redistributes it unmodified, with this file, as an optional in-app download
published under `models/sensevoice-small-webgpu/` on `downloads.animama.ai`.
