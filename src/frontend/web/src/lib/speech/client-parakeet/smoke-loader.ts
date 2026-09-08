import * as ort from "onnxruntime-web";
import ortWasmMjsUrl from "onnxruntime-web/ort-wasm-simd-threaded.mjs?url";
import ortWasmUrl from "onnxruntime-web/ort-wasm-simd-threaded.wasm?url";

import type { ParakeetModel } from "parakeet.js";
import { fromUrls } from "parakeet.js";

import { CLIENT_PARAKEET_MODEL_ASSET_PATHS } from "./assets";

export type LoadClientParakeetSmokeModelOptions = {
  backend?: "wasm";
  cpuThreads?: number;
  verbose?: boolean;
};

const ortWasmPaths = {
  // Match the existing bundled ORT pattern used by MicVAD and smart-turn.
  // Public /onnx/ort/*.mjs files fail in Vite dev when ORT appends ?import.
  mjs: ortWasmMjsUrl,
  wasm: ortWasmUrl,
};

export function configureClientParakeetOrt(): void {
  ort.env.wasm.wasmPaths = ortWasmPaths;
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.simd = true;
  ort.env.logLevel = "warning";
}

export async function loadClientParakeetSmokeModel({
  backend = "wasm",
  cpuThreads = 1,
  verbose = false,
}: LoadClientParakeetSmokeModelOptions = {}): Promise<ParakeetModel> {
  configureClientParakeetOrt();

  return fromUrls({
    backend,
    cpuThreads,
    decoderUrl: CLIENT_PARAKEET_MODEL_ASSET_PATHS.decoder,
    enableProfiling: false,
    encoderUrl: CLIENT_PARAKEET_MODEL_ASSET_PATHS.encoder,
    nMels: 128,
    preprocessorBackend: "js",
    preprocessorUrl: CLIENT_PARAKEET_MODEL_ASSET_PATHS.preprocessor,
    tokenizerUrl: CLIENT_PARAKEET_MODEL_ASSET_PATHS.tokenizer,
    verbose,
  });
}
