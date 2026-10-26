import { getI18n } from "react-i18next";
import { WordedError } from "@/lib/errors/apiError";
import {
  CLIENT_SENSEVOICE_MODEL_PATHS,
  CLIENT_SENSEVOICE_WEBGPU_MODEL_URL,
  SENSEVOICE_ASSET_ID,
  SENSEVOICE_WEBGPU_ASSET_ID,
} from "@/lib/speech/client-sensevoice/assets";
import type { SenseVoiceModelUrls } from "@/lib/speech/client-sensevoice/model";
import { createOfflineSttClient } from "@/lib/speech/offline-stt/worker-client";

/**
 * Offline Japanese, Korean and Chinese (Mandarin and Cantonese) speech
 * recognition: SenseVoice-Small.
 */
export const senseVoiceSttClient = createOfflineSttClient<SenseVoiceModelUrls>({
  label: "SenseVoice",
  createWorker: () =>
    new Worker(
      new URL("../../../workers/client-sensevoice-worker.ts", import.meta.url),
      { type: "module", name: "client-sensevoice-worker" },
    ),
  availability: (capabilities) => ({
    enabled: capabilities.offline_multilingual_speech_enabled ?? false,
    version: capabilities.offline_multilingual_speech_asset_version,
    gpuVersion: capabilities.offline_multilingual_speech_gpu_asset_version,
  }),
  unavailableError: () => {
    const t = getI18n().getFixedT(null, "app");
    return new WordedError(t("dictation.errors.languageSpeechMissing"));
  },
  assetIds: { base: SENSEVOICE_ASSET_ID, gpu: SENSEVOICE_WEBGPU_ASSET_ID },
  modelPaths: CLIENT_SENSEVOICE_MODEL_PATHS,
  // WebGPU runs the GPU set's FP32 graph with the CPU set's tokens and metadata.
  webgpuModel: { role: "modelUrl", path: CLIENT_SENSEVOICE_WEBGPU_MODEL_URL },
});
