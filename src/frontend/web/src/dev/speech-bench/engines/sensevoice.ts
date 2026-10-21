import {
  CLIENT_SENSEVOICE_MODEL_PATHS,
  CLIENT_SENSEVOICE_WEBGPU_MODEL_URL,
} from "@/lib/speech/client-sensevoice/assets";
import {
  isSenseVoiceLanguage,
  type SenseVoiceModelUrls,
} from "@/lib/speech/client-sensevoice/model";
import type { BenchConfig } from "../bench-protocol";
import type { BenchEngine } from "../bench-runner";
import { loadOfflineSttWorkerEngine } from "./offline-stt-worker";

const absolute = (path: string) => new URL(path, self.location.origin).href;

/**
 * The language SenseVoice is prompted with for a test set: the set's app
 * locale, except that Cantonese clips play under `zh-Hant`, where the app
 * serves Cantonese.
 */
function languageForSet(set: string) {
  const language = set === "yue" ? "zh-Hant" : set;
  if (!isSenseVoiceLanguage(language))
    throw new Error(`SenseVoice has no language for the ${set} set`);
  return language;
}

function modelUrls(config: BenchConfig): SenseVoiceModelUrls {
  const base = config.modelBaseUrl;
  // `models=` serves the evaluation root's export: both graphs side by side.
  if (base)
    return {
      modelUrl: `${base}/${config.backend === "webgpu" ? "model.onnx" : "model.int8.onnx"}`,
      tokensUrl: `${base}/tokens.txt`,
      metadataUrl: `${base}/metadata.json`,
    };
  return {
    modelUrl: absolute(
      config.backend === "webgpu"
        ? CLIENT_SENSEVOICE_WEBGPU_MODEL_URL
        : CLIENT_SENSEVOICE_MODEL_PATHS.modelUrl,
    ),
    tokensUrl: absolute(CLIENT_SENSEVOICE_MODEL_PATHS.tokensUrl),
    metadataUrl: absolute(CLIENT_SENSEVOICE_MODEL_PATHS.metadataUrl),
  };
}

/**
 * SenseVoice-Small through the app's own worker and message protocol
 * (`offline_stt/*`), from the app's model routes or `models=`.
 */
export function loadSenseVoiceEngine(
  config: BenchConfig,
): Promise<BenchEngine> {
  return loadOfflineSttWorkerEngine({
    worker: new Worker(
      new URL("../../../workers/client-sensevoice-worker.ts", import.meta.url),
      { type: "module", name: "client-sensevoice-worker" },
    ),
    label: "SenseVoice",
    backend: config.backend,
    modelUrls: modelUrls(config),
    languageForSet,
  });
}
