import { optionalModelResourceUrl } from "@/lib/resource-urls";

declare const __CLIENT_SENSEVOICE_MODELS__: ClientSenseVoiceModels | undefined;

/**
 * Where this build serves the SenseVoice sets, as for Parakeet: `asset-store`
 * (packaged desktop and built self-host download them in the app and FastAPI
 * serves them) or `operator` (Vite development serves the host's verified sets).
 */
type ClientSenseVoiceModels = {
  source: "asset-store" | "operator";
  baseUrl: string;
  webgpuBaseUrl: string;
};

/** Backend model-asset ids of the base (CPU) and WebGPU SenseVoice sets. */
export const SENSEVOICE_ASSET_ID = "sensevoice-stt";
export const SENSEVOICE_WEBGPU_ASSET_ID = "sensevoice-stt-webgpu";

const DEFAULT_CLIENT_SENSEVOICE_MODELS: ClientSenseVoiceModels = {
  source: "asset-store",
  baseUrl: "/onnx/models/sensevoice-small",
  webgpuBaseUrl: "/onnx/models/sensevoice-small-webgpu",
};

const selectedModels: ClientSenseVoiceModels =
  typeof __CLIENT_SENSEVOICE_MODELS__ === "object" &&
  __CLIENT_SENSEVOICE_MODELS__
    ? __CLIENT_SENSEVOICE_MODELS__
    : DEFAULT_CLIENT_SENSEVOICE_MODELS;
const models: ClientSenseVoiceModels =
  selectedModels.source === "asset-store"
    ? {
        ...selectedModels,
        baseUrl: optionalModelResourceUrl(
          "sensevoice-small",
          "",
          selectedModels.baseUrl,
        ),
        webgpuBaseUrl: optionalModelResourceUrl(
          "sensevoice-small-webgpu",
          "",
          selectedModels.webgpuBaseUrl,
        ),
      }
    : selectedModels;

const base = models.baseUrl.replace(/\/$/, "");

/** The CPU set's files by role. */
export const CLIENT_SENSEVOICE_MODEL_PATHS = {
  modelUrl: `${base}/model.int8.onnx`,
  tokensUrl: `${base}/tokens.txt`,
  metadataUrl: `${base}/metadata.json`,
};

/**
 * The optional WebGPU set's FP32 graph. A HEAD probe decides availability, so
 * an uninstalled set is simply a 404.
 */
export const CLIENT_SENSEVOICE_WEBGPU_MODEL_URL = `${models.webgpuBaseUrl.replace(/\/$/, "")}/model.onnx`;
