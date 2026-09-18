---
license: cc-by-4.0
pipeline_tag: automatic-speech-recognition
tags:
  - onnx
  - automatic-speech-recognition
  - parakeet
  - int8
---

# Canonical Parakeet ONNX Weights

This release input contains only the two INT8 inference models, the rebuilt
`nemo128.onnx` preprocessor, vocabulary, and configuration used by Animama.

Source baseline: `istupakov/parakeet-tdt-0.6b-v2-onnx`
Target snapshot: `ysdede/parakeet-tdt-0.6b-v2-onnx` at
`db4a768f5795e0f508187a34241fbeeef6ebb0d3`

See `ATTRIBUTION.md` for source attribution and
[the upstream provenance manifest](https://huggingface.co/ysdede/parakeet-tdt-0.6b-v2-onnx/blob/db4a768f5795e0f508187a34241fbeeef6ebb0d3/provenance/manifest.json)
for the producer's record. That producer manifest describes a larger repository;
Animama ships only the files listed above.
