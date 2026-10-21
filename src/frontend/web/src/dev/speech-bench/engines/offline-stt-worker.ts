import type {
  OfflineSttLoadResult,
  OfflineSttModelUrls,
  OfflineSttTranscribeResult,
  OfflineSttWorkerRequest,
  OfflineSttWorkerResponse,
} from "@/lib/speech/offline-stt/worker-protocol";

import { BENCH_SAMPLE_RATE, type BenchEngine } from "../bench-runner";

/** A worker request before its id is assigned. */
type Unsent<T> = T extends unknown ? Omit<T, "requestId"> : never;

/**
 * Drive one of the app's offline speech workers over its own message protocol
 * (`offline_stt/*`): load the given model files on `backend`, then transcribe
 * each clip as a final window in the set's language.
 */
export async function loadOfflineSttWorkerEngine<
  TModelUrls extends OfflineSttModelUrls,
>({
  worker,
  label,
  backend,
  modelUrls,
  languageForSet,
}: {
  worker: Worker;
  label: string;
  backend: "wasm" | "webgpu";
  modelUrls: TModelUrls;
  /** The language sent with a set's windows; `undefined` sends none. */
  languageForSet: (set: string) => string | undefined;
}): Promise<BenchEngine> {
  let counter = 0;
  // A worker that crashes never replies; fail its pending requests instead.
  let crashed: Error | null = null;
  const failures = new Set<(error: Error) => void>();
  worker.addEventListener("error", (event) => {
    crashed = new Error(event.message || `${label} worker crashed`);
    for (const fail of failures) fail(crashed);
  });
  const request = <T>(
    message: Unsent<OfflineSttWorkerRequest<TModelUrls>>,
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

  const loaded = await request<OfflineSttLoadResult<TModelUrls>>({
    type: "offline_stt/load",
    backend,
    sampleRateHz: BENCH_SAMPLE_RATE,
    modelUrls,
  });
  // The worker falls back to WASM when WebGPU fails; never report that as WebGPU.
  if (loaded.backend !== backend)
    throw new Error(`${label} loaded on ${loaded.backend}, not ${backend}.`);
  return {
    transcribe: async (audio, set, kind) => {
      const copy = new Float32Array(audio);
      const language = languageForSet(set);
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
          ...(language ? { language } : {}),
        },
        [copy.buffer],
      );
      return result.text;
    },
  };
}
