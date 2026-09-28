/**
 * Message contract for the development-only Parakeet benchmark page
 * (`/parakeet-bench.html`). The benchmark compares ONNX Runtime backends and
 * encoder quantizations and measures growing-buffer re-decode cost; it is not
 * part of the product runtime.
 */

export type BenchBackend = "wasm" | "webgpu";
export type BenchEncoderQuant = "int8" | "fp16" | "fp32";

export type BenchClip = {
  id: string;
  /** Reference transcript used for the word error rate. */
  text: string;
  url: string;
};

export type BenchConfig = {
  backend: BenchBackend;
  encoderQuant: BenchEncoderQuant;
  cpuThreads: number;
  encoderUrl: string;
  /** External weights for the fp32 encoder, when it is split. */
  encoderDataUrl: string | null;
  decoderUrl: string;
  tokenizerUrl: string;
  preprocessorUrl: string;
  clips: BenchClip[];
  /** Warm decodes per clip; the median is reported. */
  warmRuns: number;
  /** Growing-buffer prefix lengths, decoded from the longest clip. */
  growingSeconds: number[];
};

/** Median parakeet.js stage timings for the warm runs, in milliseconds. */
export type BenchStageTimings = {
  encodeMs: number;
  /** Token decoder/joint loop (WASM in every configuration). */
  decoderMs: number;
};

export type BenchClipResult = {
  id: string;
  audioSeconds: number;
  firstDecodeMs: number;
  warmDecodeMedianMs: number;
  warmStages: BenchStageTimings;
  /** Audio seconds processed per wall-clock second (parakeet.js "rtf"). */
  realTimeFactor: number;
  wordErrorRate: number;
  text: string;
};

export type BenchGrowingResult = {
  seconds: number;
  fullDecodeMedianMs: number;
  fullStages: BenchStageTimings;
  /**
   * Re-decode of the same buffer after priming parakeet.js' decoder-state cache
   * at the previous buffer length (a guaranteed cache hit), plus the matching
   * mel prefix. This is the best case for reusing the previous preview.
   */
  incrementalDecodeMs: number | null;
  incrementalStages: BenchStageTimings | null;
};

export type BenchResult = {
  config: Omit<BenchConfig, "clips">;
  environment: {
    userAgent: string;
    hardwareConcurrency: number;
    crossOriginIsolated: boolean;
    webgpuAdapter: string | null;
  };
  loadMs: number;
  clips: BenchClipResult[];
  growing: BenchGrowingResult[];
};

export type BenchWorkerRequest = { type: "run"; config: BenchConfig };

export type BenchWorkerResponse =
  | { type: "progress"; message: string }
  | { type: "result"; result: BenchResult }
  | { type: "error"; message: string };
