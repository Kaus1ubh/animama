import {
  CLIENT_PARAKEET_MODEL_ASSET_PATHS,
  CLIENT_PARAKEET_WEBGPU_ENCODER_URL,
} from "@/lib/speech/client-parakeet/assets";

import type { BenchConfig } from "../bench-protocol";
import type { BenchEngine } from "../bench-runner";
import { loadOfflineSttWorkerEngine } from "./offline-stt-worker";

const absolute = (path: string) => new URL(path, self.location.origin).href;

/**
 * Parakeet TDT 0.6B v2 (English only) through the app's own worker and message
 * protocol (`offline_stt/*`), from the app's model routes: the INT8 encoder on
 * WASM, or the FP16 encoder on WebGPU with the INT8 decoder kept on WASM.
 */
export function loadParakeetEngine(config: BenchConfig): Promise<BenchEngine> {
  if (config.modelBaseUrl || config.gpuModelBaseUrl) {
    throw new Error(
      "Parakeet loads from the app's own model routes; omit models=.",
    );
  }
  return loadOfflineSttWorkerEngine({
    worker: new Worker(
      new URL("../../../workers/client-parakeet-worker.ts", import.meta.url),
      { type: "module", name: "client-parakeet-worker" },
    ),
    label: "Parakeet",
    backend: config.backend,
    modelUrls: {
      encoderUrl: absolute(
        config.backend === "webgpu"
          ? CLIENT_PARAKEET_WEBGPU_ENCODER_URL
          : CLIENT_PARAKEET_MODEL_ASSET_PATHS.encoder,
      ),
      decoderUrl: absolute(CLIENT_PARAKEET_MODEL_ASSET_PATHS.decoder),
      tokenizerUrl: absolute(CLIENT_PARAKEET_MODEL_ASSET_PATHS.tokenizer),
      preprocessorUrl: absolute(CLIENT_PARAKEET_MODEL_ASSET_PATHS.preprocessor),
    },
    // Parakeet v2 is English only and takes no language.
    languageForSet: () => undefined,
  });
}
