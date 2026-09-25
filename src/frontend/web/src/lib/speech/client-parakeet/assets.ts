declare const __CLIENT_PARAKEET_MODEL_BASE_URL__: string | undefined;
declare const __CLIENT_PARAKEET_WEBGPU_MODEL_BASE_URL__:
  | string
  | null
  | undefined;

const DEFAULT_CLIENT_PARAKEET_MODEL_BASE_URL =
  "/onnx/models/parakeet-tdt-0.6b-v2";

export const CLIENT_PARAKEET_MODEL_BASE_URL = (
  typeof __CLIENT_PARAKEET_MODEL_BASE_URL__ === "string" &&
  __CLIENT_PARAKEET_MODEL_BASE_URL__
    ? __CLIENT_PARAKEET_MODEL_BASE_URL__
    : DEFAULT_CLIENT_PARAKEET_MODEL_BASE_URL
).replace(/\/$/, "");

export const CLIENT_PARAKEET_MODEL_ASSET_PATHS = {
  attribution: `${CLIENT_PARAKEET_MODEL_BASE_URL}/ATTRIBUTION.md`,
  config: `${CLIENT_PARAKEET_MODEL_BASE_URL}/config.json`,
  decoder: `${CLIENT_PARAKEET_MODEL_BASE_URL}/decoder_joint-model.int8.onnx`,
  encoder: `${CLIENT_PARAKEET_MODEL_BASE_URL}/encoder-model.int8.onnx`,
  preprocessor: `${CLIENT_PARAKEET_MODEL_BASE_URL}/nemo128.onnx`,
  readme: `${CLIENT_PARAKEET_MODEL_BASE_URL}/README.md`,
  tokenizer: `${CLIENT_PARAKEET_MODEL_BASE_URL}/vocab.txt`,
} as const;

/**
 * Optional experimental WebGPU encoder, served only by local Vite development
 * stacks. `null` means this build does not serve it.
 */
export const CLIENT_PARAKEET_WEBGPU_ENCODER_URL: string | null =
  typeof __CLIENT_PARAKEET_WEBGPU_MODEL_BASE_URL__ === "string" &&
  __CLIENT_PARAKEET_WEBGPU_MODEL_BASE_URL__
    ? `${__CLIENT_PARAKEET_WEBGPU_MODEL_BASE_URL__.replace(/\/$/, "")}/encoder-model.fp16.onnx`
    : null;
