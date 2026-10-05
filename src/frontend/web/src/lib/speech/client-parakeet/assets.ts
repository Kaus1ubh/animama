declare const __CLIENT_PARAKEET_MODELS__: ClientParakeetModels | undefined;

/**
 * Where this build serves the Parakeet sets: `asset-store` (packaged desktop
 * and built self-host; the app downloads sets through the backend model-asset
 * service and FastAPI serves them) or `operator` (Vite development serves the
 * host's verified sets; the app offers no downloads).
 */
export type ClientParakeetModels = {
  source: "asset-store" | "operator";
  baseUrl: string;
  webgpuBaseUrl: string;
};

/** Backend model-asset ids of the base (CPU) and WebGPU Parakeet sets. */
export const PARAKEET_ASSET_ID = "parakeet-stt";
export const PARAKEET_WEBGPU_ASSET_ID = "parakeet-stt-webgpu";

const DEFAULT_CLIENT_PARAKEET_MODELS: ClientParakeetModels = {
  source: "asset-store",
  baseUrl: "/onnx/models/parakeet-tdt-0.6b-v2",
  webgpuBaseUrl: "/onnx/models/parakeet-tdt-0.6b-v2-webgpu",
};

const selectedModels: ClientParakeetModels =
  typeof __CLIENT_PARAKEET_MODELS__ === "object" && __CLIENT_PARAKEET_MODELS__
    ? __CLIENT_PARAKEET_MODELS__
    : DEFAULT_CLIENT_PARAKEET_MODELS;
export const CLIENT_PARAKEET_MODELS: ClientParakeetModels =
  selectedModels.source === "asset-store"
    ? {
        ...selectedModels,
        baseUrl: optionalModelResourceUrl(
          "parakeet-tdt-0.6b-v2",
          "",
          selectedModels.baseUrl,
        ),
        webgpuBaseUrl: optionalModelResourceUrl(
          "parakeet-tdt-0.6b-v2-webgpu",
          "",
          selectedModels.webgpuBaseUrl,
        ),
      }
    : selectedModels;

/** Whether this build installs Parakeet sets in the app. */
export const PARAKEET_DOWNLOADS_OFFERED =
  CLIENT_PARAKEET_MODELS.source === "asset-store";

const base = CLIENT_PARAKEET_MODELS.baseUrl.replace(/\/$/, "");

export const CLIENT_PARAKEET_MODEL_ASSET_PATHS = {
  attribution: `${base}/ATTRIBUTION.md`,
  config: `${base}/config.json`,
  decoder: `${base}/decoder_joint-model.int8.onnx`,
  encoder: `${base}/encoder-model.int8.onnx`,
  preprocessor: `${base}/nemo128.onnx`,
  readme: `${base}/README.md`,
  tokenizer: `${base}/vocab.txt`,
} as const;

/**
 * The optional WebGPU set's FP16 encoder. A HEAD probe decides availability,
 * so an uninstalled set is simply a 404.
 */
export const CLIENT_PARAKEET_WEBGPU_ENCODER_URL = `${CLIENT_PARAKEET_MODELS.webgpuBaseUrl.replace(/\/$/, "")}/encoder-model.fp16.onnx`;
import { optionalModelResourceUrl } from "@/lib/resource-urls";
