import { getI18n } from "react-i18next";
import { WordedError } from "@/lib/errors/apiError";
import {
  CLIENT_PARAKEET_MODEL_ASSET_PATHS,
  CLIENT_PARAKEET_WEBGPU_ENCODER_URL,
  PARAKEET_ASSET_ID,
  PARAKEET_WEBGPU_ASSET_ID,
} from "@/lib/speech/client-parakeet/assets";
import type { ClientParakeetModelUrls } from "@/lib/speech/client-parakeet/worker-protocol";
import { createOfflineSttClient } from "@/lib/speech/offline-stt/worker-client";

/** Offline English speech recognition: Parakeet TDT 0.6B v2. */
const parakeet = createOfflineSttClient<ClientParakeetModelUrls>({
  label: "Parakeet",
  createWorker: () =>
    new Worker(
      new URL("../../../workers/client-parakeet-worker.ts", import.meta.url),
      { type: "module", name: "client-parakeet-worker" },
    ),
  availability: (capabilities) => ({
    enabled: capabilities.offline_speech_enabled,
    version: capabilities.offline_speech_asset_version,
    gpuVersion: capabilities.offline_speech_gpu_asset_version,
  }),
  unavailableError: (downloadsEnded) =>
    new WordedError(
      getI18n().getFixedT(
        null,
        "app",
      )(
        downloadsEnded
          ? "dictation.errors.offlineSpeechEnded"
          : "dictation.errors.offlineSpeechMissing",
      ),
    ),
  assetIds: { base: PARAKEET_ASSET_ID, gpu: PARAKEET_WEBGPU_ASSET_ID },
  modelPaths: {
    encoderUrl: CLIENT_PARAKEET_MODEL_ASSET_PATHS.encoder,
    decoderUrl: CLIENT_PARAKEET_MODEL_ASSET_PATHS.decoder,
    tokenizerUrl: CLIENT_PARAKEET_MODEL_ASSET_PATHS.tokenizer,
    preprocessorUrl: CLIENT_PARAKEET_MODEL_ASSET_PATHS.preprocessor,
  },
  // WebGPU runs the GPU set's FP16 encoder with the CPU set's INT8 decoder.
  webgpuModel: { role: "encoderUrl", path: CLIENT_PARAKEET_WEBGPU_ENCODER_URL },
});

/** The Parakeet client, for code that handles either offline engine. */
export const parakeetSttClient = parakeet;
export const transcribeClientParakeetWindow = parakeet.transcribe;
export const disposeIdleClientParakeetWorker = parakeet.disposeIdle;
export const getLastClientParakeetBackendState = parakeet.getLastBackendState;
export const getParakeetWebgpuStatus = parakeet.getWebgpuStatus;
