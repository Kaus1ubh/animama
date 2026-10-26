/**
 * Parakeet's model files by role. The worker speaks the shared offline
 * speech-to-text protocol (`@/lib/speech/offline-stt/worker-protocol`).
 *
 * `wasm` loads the INT8 encoder and decoder; `webgpu` replaces the encoder with
 * the GPU set's FP16 encoder and keeps the INT8 decoder on WASM.
 */
export type ClientParakeetModelUrls = {
  encoderUrl: string;
  decoderUrl: string;
  tokenizerUrl: string;
  preprocessorUrl: string;
};
