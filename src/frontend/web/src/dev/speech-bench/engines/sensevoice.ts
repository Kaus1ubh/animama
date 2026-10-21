import {
  CLIENT_SENSEVOICE_MODEL_PATHS,
  CLIENT_SENSEVOICE_WEBGPU_MODEL_URL,
} from "@/lib/speech/client-sensevoice/assets";
import {
  isSenseVoiceLanguage,
  type SenseVoiceModelUrls,
} from "@/lib/speech/client-sensevoice/model";
import type {
  OfflineSttTranscribeResult,
  OfflineSttWorkerRequest,
  OfflineSttWorkerResponse,
} from "@/lib/speech/offline-stt/worker-protocol";

import type { BenchConfig } from "../bench-protocol";
import { BENCH_SAMPLE_RATE, type BenchEngine } from "../bench-runner";

const absolute = (path: string) => new URL(path, self.location.origin).href;

/** A worker request before its id is assigned. */
type Unsent<T> = T extends unknown ? Omit<T, "requestId"> : never;

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
export async function loadSenseVoiceEngine(
  config: BenchConfig,
): Promise<BenchEngine> {
  const worker = new Worker(
    new URL("../../../workers/client-sensevoice-worker.ts", import.meta.url),
    { type: "module", name: "client-sensevoice-worker" },
  );
  let counter = 0;
  // A worker that crashes never replies; fail its pending requests instead.
  let crashed: Error | null = null;
  const failures = new Set<(error: Error) => void>();
  worker.addEventListener("error", (event) => {
    crashed = new Error(event.message || "SenseVoice worker crashed");
    for (const fail of failures) fail(crashed);
  });
  const request = <T>(
    message: Unsent<OfflineSttWorkerRequest<SenseVoiceModelUrls>>,
    transfer: Transferable[] = [],
  ) =>
    new Promise<T>((resolve, reject) => {
      if (crashed) return reject(crashed);
      counter += 1;
      const requestId = `bench-${counter}`;
      const settle = () => {
        worker.removeEventListener("message", onMessage);
        failures.delete(reject);
      };
      const onMessage = (event: MessageEvent<OfflineSttWorkerResponse>) => {
        if (event.data?.requestId !== requestId) return;
        settle();
        if (event.data.ok) resolve(event.data.result as T);
        else reject(new Error(event.data.error.message));
      };
      worker.addEventListener("message", onMessage);
      failures.add(reject);
      worker.postMessage({ ...message, requestId }, transfer);
    });

  await request({
    type: "offline_stt/load",
    backend: config.backend,
    sampleRateHz: BENCH_SAMPLE_RATE,
    modelUrls: modelUrls(config),
  });
  return {
    transcribe: async (audio, set, kind) => {
      const copy = new Float32Array(audio);
      const result = await request<OfflineSttTranscribeResult>(
        {
          type: "offline_stt/transcribe",
          kind,
          jobId: `bench-job-${counter}`,
          runId: "bench",
          turnId: "bench",
          windowId: `bench-window-${counter}`,
          audio: copy,
          sampleRateHz: BENCH_SAMPLE_RATE,
          language: languageForSet(set),
        },
        [copy.buffer],
      );
      return result.text;
    },
  };
}
