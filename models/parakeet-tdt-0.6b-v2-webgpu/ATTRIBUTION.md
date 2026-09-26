# Attribution and Licensing

This optional set packages one derivative ONNX artifact for Parakeet ASR.

## Upstream Sources

- Base model family: NVIDIA Parakeet (CC-BY-4.0)
- FP16 encoder source: `ysdede/parakeet-tdt-0.6b-v2-onnx` (snapshot: `db4a768f5795e0f508187a34241fbeeef6ebb0d3`)

## Included Derivatives

- `encoder-model.fp16.onnx` matches the pinned ysdede snapshot.

## Publication Notes

- Preserve upstream licensing and attribution terms.
- Keep model card attribution to NVIDIA and conversion/tooling provenance.
- Do not remove this file when publishing.

Development stacks and operator-mounted self-host installs load this set
directly. The desktop app redistributes it, with this file, only as the
optional `parakeet-stt-webgpu` feature pack after its inventory review.
