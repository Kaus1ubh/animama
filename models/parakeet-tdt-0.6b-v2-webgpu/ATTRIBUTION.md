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

Development stacks load this set from the operator's model store. Animama
redistributes it unmodified, with this file, in the optional
`parakeet-stt-webgpu` desktop feature pack and as an in-app download for
built self-host installs, published under `models/parakeet-tdt-0.6b-v2-webgpu/`
on `downloads.animama.ai`.
