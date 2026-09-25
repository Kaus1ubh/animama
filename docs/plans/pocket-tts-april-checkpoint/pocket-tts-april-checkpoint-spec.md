# PocketTTS April 2026 checkpoint with mixed precision

Status: Agreed
Owner decision: 2026-09-25, the owner directed moving PocketTTS to the
`english_2026-04` checkpoint with mixed precision (FP32 for the flow head and
Mimi decoder, INT8 for the main flow LM). The owner approved the spec, the
ExecPlan and the recommended defaults below on 2026-09-25.

## Problem and intended users

PocketTTS is the local alternative to ElevenLabs. It currently runs Kyutai's
January 2026 English checkpoint, with all three generation graphs in dynamic
INT8 (`flow_lm_main`, `flow_lm_flow`, `mimi_decoder`). Kyutai's
`english_2026-04` checkpoint handles short sentences and voice cloning better.
The two small graphs most directly shape the waveform: the per-frame flow head
and the Mimi decoder. Quantizing them costs audible quality for little size
saving. The local installation owner benefits from better local speech without
a paid provider.

## Goals, scope and non-goals

Included:

- Replace the January Pocket ONNX inputs with the `english_2026-04` bundle from
  `KevinAHM/pocket-tts-onnx` at a pinned revision, using:
  - `flow_lm_main_int8.onnx`
  - FP32 `flow_lm_flow.onnx`
  - FP32 `mimi_decoder.onnx`
  - FP32 `text_conditioner.onnx` (its INT8 twin is bit-identical in weights)
  - FP32 `mimi_encoder.onnx`
  - the tokenizer, `bos_before_voice.npy` and `bundle.json`
- Replace the January `voices.bin` built-in voices with Kyutai's precomputed
  `english_2026-04` voice states, at a pinned revision, for the same voice names
  (`cosette`, `jean`, `fantine`), so existing voice preferences keep working.
- Make the browser worker follow the April runtime contract: prepend the BOS row
  to cloned-voice embeddings, initialize state from the bundle manifest, and use
  the April text-preparation and EOS rules.
- Update acquisition, verification, packaging, license notices, tests and docs.

Non-goals:

- The newer `english_2026-09` checkpoint (no published ONNX export) and other
  languages.
- WebGPU and multi-threaded WASM ([raymond-van/animama#128](https://github.com/raymond-van/animama/issues/128)).
- Anima-specific voice files: uploaded catalogs, the legacy per-Anima path and
  the catalog builder. The owner excluded these on 2026-09-25.
- Relaxing the owner's noncommercial election for Pocket assets.
- Keeping the January checkpoint as a selectable runtime option.

## Required behavior

- PocketTTS loads the April graphs and speaks with the selected built-in voice
  (`cosette`, `jean` or `fantine`). A saved preference for any of these names
  still resolves.
- A custom voice encoded from an audio file in Anima settings uses the April
  encoder, with the BOS row prepended before conditioning.
- Generation stops at end of speech without clipped endings or long trailing
  silence, including for short inputs of four words or fewer.
- Acquisition verifies every new file by size and SHA-256 and stores it in a new
  content-addressed model directory. An existing January store is left intact.
- Missing or mismatched assets fail with a clear error, as today. The app never
  silently falls back to January files.

## Constraints

- Offline, reproducible acquisition from pinned Hugging Face revisions only. No
  gated repository and no token (`kyutai/pocket-tts-without-voice-cloning` is
  ungated).
- Licensing:
  - The ONNX weights are CC BY 4.0 (`KevinAHM/pocket-tts-onnx` `onnx/LICENSE`,
    corrected from CC BY-NC).
  - The `cosette` and `jean` source voices are CC BY-NC 4.0.
  - The existing noncommercial election remains. Notices and the license
    inventory must describe the new sources exactly.
- Size: PocketTTS loads about 192 MB at startup, up from about 127 MB (FP32 flow
  and decoder, plus three voice states of about 6–7 MB each). The lazily loaded
  encoder adds about 40 MB, down from 73 MB. Total on disk is about 232 MB, up
  from 200 MB.
- Latency: time to first audio and real-time factor must not regress beyond the
  budget in the acceptance criteria on an Apple Silicon Mac in single-threaded
  WASM.
- Desktop: Pocket remains a core component. The packaged runtime inventory and
  audit must accept the new file set.

## Acceptance criteria

- [ ] Acquiring browser speech from a clean model root downloads and verifies
      the new file set. The Python and frontend asset tests pass with the new
      counts and hashes.
- [ ] In the development web app, each built-in voice produces speech for a
      short (≤4 words), a medium and a multi-sentence reply. A Parakeet
      transcript of each result matches the input text, allowing only
      punctuation and case differences and at most one word error per sentence.
- [ ] A custom voice encoded from a 10-second clip produces intelligible speech.
- [ ] Time to first audio and real-time factor are recorded before and after.
      Real-time factor stays below 1.0 (faster than real time) and time to first
      audio grows by no more than 25% on the reference machine.
- [ ] The packaged desktop build audit passes and PocketTTS speaks in the
      packaged app.
- [ ] Owner listening gate: the owner compares January and April output for the
      same texts and voices and accepts the April quality and temperature
      choice.

## Open questions and decisions

Decisions accepted by the owner on 2026-09-25 (recommended defaults):

1. **Voice source.** Use Kyutai's precomputed KV-cache voice states rather than
   re-deriving 1024-dim embeddings. These are what the reference ONNX runtime
   uses with INT8 precision, and they also skip the voice-conditioning pass for
   built-in voices. The alternative is to encode source audio ourselves into the
   existing `voices.bin` format.
2. **Voice set.** Keep exactly `cosette`, `jean` and `fantine` (about 19 MB).
   Adding `alba`, `marius` and `javert` (CC BY / CC0 sources) would add about
   18 MB more.
3. **Temperature.** Default to 0.3, Kyutai's human-eval-tuned value for
   `english_2026-04`. The current worker uses 0.7. Confirm at the listening
   gate.
4. **Encoder precision.** Use FP32 `mimi_encoder` (40 MB, lazily loaded), as
   the reference runtime does. The INT8 encoder (21 MB) has no published quality
   validation.

Risk: Kyutai re-uploaded the April voice states on 2026-05-04, after the ONNX
export (2026-04-21). Phase 1 verifies that the pinned states match the exported
graphs before any product change.

## Spec

This document until publication. After publication, the owning issue is
authoritative and this file is a snapshot.

## ExecPlan

[pocket-tts-april-checkpoint-execplan.md](pocket-tts-april-checkpoint-execplan.md)

## Delivery links

Pending workspace setup.
