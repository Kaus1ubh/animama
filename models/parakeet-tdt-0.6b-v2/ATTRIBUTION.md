# Attribution and Licensing

This repository packages derivative ONNX artifacts for Parakeet ASR.

## Upstream Sources

- Base model family: NVIDIA Parakeet (CC-BY-4.0)
- INT8 model source: `istupakov/parakeet-tdt-0.6b-v2-onnx` (snapshot: `0bbb45a3365852604aef28b538a8f066f4ccaa85`)
- Rebuilt preprocessor/config/vocabulary source: `ysdede/parakeet-tdt-0.6b-v2-onnx` (snapshot: `db4a768f5795e0f508187a34241fbeeef6ebb0d3`)

## Included Derivatives

- `encoder-model.int8.onnx` and `decoder_joint-model.int8.onnx` match the pinned istupakov snapshot.
- `nemo128.onnx`, `config.json`, and `vocab.txt` match the pinned ysdede snapshot.

## Publication Notes

- Preserve upstream licensing and attribution terms.
- Keep model card attribution to NVIDIA and conversion/tooling provenance.
- Do not remove this file when publishing.

Original producer record generated at: 2026-02-23T20:19:04.614042+00:00.
Animama's subset was reconciled against the pinned public snapshots on
2026-09-03. No FP16 or FP32 models are included. Redistribution approval remains
pending the owner's review of the exact pack inventory.
