import { fromUrls } from "parakeet.js";

import {
  CLIENT_PARAKEET_MODEL_ASSET_PATHS,
  CLIENT_PARAKEET_WEBGPU_ENCODER_URL,
} from "@/lib/speech/client-parakeet/assets";

import type { BenchConfig } from "../bench-protocol";
import { BENCH_SAMPLE_RATE, type WindowEngine } from "../bench-runner";

const absolute = (path: string) => new URL(path, self.location.origin).href;

/**
 * Parakeet TDT 0.6B v2 (English only) from the app's own model routes, loaded
 * with the product worker's options: the INT8 encoder on WASM, or the FP16
 * encoder on WebGPU with the INT8 decoder kept on WASM.
 */
export async function loadParakeetEngine(
  config: BenchConfig,
): Promise<WindowEngine> {
  if (config.modelBaseUrl || config.gpuModelBaseUrl) {
    throw new Error(
      "Parakeet loads from the app's own model routes; omit models=.",
    );
  }
  const model = await fromUrls({
    backend: config.backend === "webgpu" ? "webgpu-hybrid" : "wasm",
    cpuThreads: 1,
    decoderUrl: absolute(CLIENT_PARAKEET_MODEL_ASSET_PATHS.decoder),
    enableProfiling: false,
    encoderUrl: absolute(
      config.backend === "webgpu"
        ? CLIENT_PARAKEET_WEBGPU_ENCODER_URL
        : CLIENT_PARAKEET_MODEL_ASSET_PATHS.encoder,
    ),
    nMels: 128,
    preprocessorBackend: "js",
    preprocessorUrl: absolute(CLIENT_PARAKEET_MODEL_ASSET_PATHS.preprocessor),
    tokenizerUrl: absolute(CLIENT_PARAKEET_MODEL_ASSET_PATHS.tokenizer),
    verbose: false,
  });
  return {
    kind: "window",
    transcribe: async (audio) => {
      const result = await model.transcribe(audio, BENCH_SAMPLE_RATE, {
        returnConfidences: false,
        returnTimestamps: false,
      });
      return result.utterance_text.trim();
    },
  };
}
