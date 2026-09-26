---
license: cc-by-4.0
pipeline_tag: automatic-speech-recognition
tags:
  - onnx
  - automatic-speech-recognition
  - parakeet
  - fp16
  - webgpu
---

# Optional Parakeet WebGPU Encoder

This optional model set contains only the FP16 Parakeet TDT 0.6B v2 encoder.
Animama loads it on WebGPU when the experimental "GPU-accelerated offline
speech" setting is on. It pairs with the INT8 decoder, preprocessor and
vocabulary from the base `parakeet-tdt-0.6b-v2` set, which is still required.

Source snapshot: `ysdede/parakeet-tdt-0.6b-v2-onnx` at
`db4a768f5795e0f508187a34241fbeeef6ebb0d3`

See `ATTRIBUTION.md` for source attribution. This set is not part of the
desktop `parakeet-stt` feature pack.
