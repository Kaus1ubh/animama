/**
 * Message contract for the development-only speech recognition benchmark
 * (`/speech-bench.html`, issue #509). The benchmark runs offline recognizers
 * through onnxruntime-web in a worker, as the app does, and reports raw text
 * and timings. `scripts/speech-eval/speech_eval.py score` computes error rates
 * from the result. It is not part of the product runtime.
 */

export type BenchEngineId = "parakeet";
export type BenchBackend = "wasm" | "webgpu";
/**
 * `throughput` decodes each clip as one finished speech window, back to back.
 * `paced` delivers audio in real time, so interim text and the final-text delay
 * behave as they would while someone speaks.
 */
export type BenchMode = "throughput" | "paced";

export type BenchClip = {
  set: string;
  id: string;
  language: string;
  url: string;
};

export type BenchConfig = {
  engine: BenchEngineId;
  backend: BenchBackend;
  mode: BenchMode;
  /** Produce interim text while paced audio arrives. */
  interim: boolean;
  /** Base URL of the engine's model files; `null` uses the app's own route. */
  modelBaseUrl: string | null;
  /** Base URL of GPU-only model files; `null` uses the app's own route. */
  gpuModelBaseUrl: string | null;
};

export type BenchClipResult = {
  set: string;
  id: string;
  audioSeconds: number;
  text: string;
  /** From the last delivered audio sample to the final text. */
  finalLatencyMs: number;
  /** Engine processing time for the final text (real-time factor input). */
  processingMs: number;
  /** From the first audio sample to the first non-empty interim text. */
  firstInterimMs: number | null;
  interimCount: number;
  /** Interim previews stopped by the decode budget or failed, for one clip. */
  interimStops: number;
};

type BenchEnvironment = {
  userAgent: string;
  hardwareConcurrency: number;
  crossOriginIsolated: boolean;
  webgpuAdapter: string | null;
};

/** One worker's model load plus a warm-up decode of a second of silence. */
export type BenchLoadResult = {
  loadMs: number;
  environment: BenchEnvironment;
};

/**
 * One page run. The runner launches a load-only run on a fresh profile first,
 * reporting its `loadMs` as the cold load and this run's as the warm load.
 */
export type BenchResult = Omit<
  BenchConfig,
  "modelBaseUrl" | "gpuModelBaseUrl"
> &
  BenchLoadResult & { clips: BenchClipResult[] };

export type BenchWorkerRequest =
  | { type: "load"; config: BenchConfig }
  | {
      type: "run";
      clip: Omit<BenchClip, "url">;
      audio: Float32Array;
    };

export type BenchWorkerResponse =
  | { type: "loaded"; result: BenchLoadResult }
  | { type: "clip_result"; result: BenchClipResult }
  | { type: "error"; message: string };
