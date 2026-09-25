/// <reference lib="webworker" />

import * as ort from "onnxruntime-web";
import ortJsepMjsUrl from "onnxruntime-web/ort-wasm-simd-threaded.jsep.mjs?url";
import ortJsepWasmUrl from "onnxruntime-web/ort-wasm-simd-threaded.jsep.wasm?url";
import ortWasmMjsUrl from "onnxruntime-web/ort-wasm-simd-threaded.mjs?url";
import ortWasmUrl from "onnxruntime-web/ort-wasm-simd-threaded.wasm?url";

import type { ParakeetModel } from "parakeet.js";
import { fromUrls } from "parakeet.js";

import type {
  BenchClip,
  BenchClipResult,
  BenchConfig,
  BenchGrowingResult,
  BenchResult,
  BenchStageTimings,
  BenchWorkerRequest,
  BenchWorkerResponse,
} from "./bench-protocol";
import { decodePcm16Wav, median, wordErrorRate } from "./bench-metrics";

const SAMPLE_RATE = 16000;

function post(response: BenchWorkerResponse): void {
  self.postMessage(response);
}

function progress(message: string): void {
  post({ type: "progress", message });
}

async function describeWebgpuAdapter(): Promise<string | null> {
  const gpu = (
    navigator as Navigator & {
      gpu?: {
        requestAdapter: () => Promise<{
          info?: { vendor?: string; architecture?: string };
        } | null>;
      };
    }
  ).gpu;
  if (!gpu) return null;
  const adapter = await gpu.requestAdapter();
  if (!adapter) return "navigator.gpu present, no adapter";
  const info = adapter.info;
  return (
    [info?.vendor, info?.architecture].filter(Boolean).join(" / ") || "adapter"
  );
}

async function loadClip(clip: BenchClip): Promise<Float32Array> {
  const response = await fetch(clip.url);
  if (!response.ok) {
    throw new Error(`Clip ${clip.id} failed to load: HTTP ${response.status}`);
  }
  return decodePcm16Wav(await response.arrayBuffer(), SAMPLE_RATE);
}

type TimedTranscribe = {
  ms: number;
  text: string;
  encodeMs: number;
  decoderMs: number;
};

async function timeTranscribe(
  model: ParakeetModel,
  audio: Float32Array,
  options: Parameters<ParakeetModel["transcribe"]>[2] = {},
): Promise<TimedTranscribe> {
  const startedAt = performance.now();
  const result = await model.transcribe(audio, SAMPLE_RATE, {
    enableProfiling: true,
    returnConfidences: false,
    returnTimestamps: false,
    ...options,
  });
  return {
    ms: performance.now() - startedAt,
    text: result.utterance_text.trim(),
    encodeMs: result.metrics?.encode_ms ?? Number.NaN,
    decoderMs: result.metrics?.decode_ms ?? Number.NaN,
  };
}

function medianStages(runs: TimedTranscribe[]): BenchStageTimings {
  return {
    encodeMs: median(runs.map((run) => run.encodeMs)),
    decoderMs: median(runs.map((run) => run.decoderMs)),
  };
}

async function timeRuns(
  model: ParakeetModel,
  audio: Float32Array,
  count: number,
): Promise<TimedTranscribe[]> {
  const runs: TimedTranscribe[] = [];
  for (let run = 0; run < count; run += 1) {
    runs.push(await timeTranscribe(model, audio));
  }
  return runs;
}

async function runBenchmark(config: BenchConfig): Promise<BenchResult> {
  ort.env.wasm.wasmPaths =
    config.backend === "webgpu"
      ? { mjs: ortJsepMjsUrl, wasm: ortJsepWasmUrl }
      : { mjs: ortWasmMjsUrl, wasm: ortWasmUrl };
  ort.env.wasm.numThreads = config.cpuThreads;
  ort.env.wasm.simd = true;
  ort.env.logLevel = "warning";

  const webgpuAdapter = await describeWebgpuAdapter();
  progress(`Loading ${config.backend} / ${config.encoderQuant} encoder…`);
  const loadStartedAt = performance.now();
  const model = await fromUrls({
    backend: config.backend === "webgpu" ? "webgpu-hybrid" : "wasm",
    cpuThreads: config.cpuThreads,
    decoderUrl: config.decoderUrl,
    enableProfiling: false,
    encoderUrl: config.encoderUrl,
    encoderDataUrl: config.encoderDataUrl,
    filenames: config.encoderDataUrl
      ? {
          encoder: "encoder-model.onnx",
          decoder: "decoder_joint-model.int8.onnx",
        }
      : undefined,
    nMels: 128,
    preprocessorBackend: "js",
    preprocessorUrl: config.preprocessorUrl,
    tokenizerUrl: config.tokenizerUrl,
    verbose: false,
  });
  const loadMs = performance.now() - loadStartedAt;

  const clipAudio = new Map<string, Float32Array>();
  for (const clip of config.clips) {
    clipAudio.set(clip.id, await loadClip(clip));
  }

  const clips: BenchClipResult[] = [];
  for (const clip of config.clips) {
    const audio = clipAudio.get(clip.id)!;
    progress(`Decoding ${clip.id}…`);
    const first = await timeTranscribe(model, audio);
    const warm = await timeRuns(model, audio, config.warmRuns);
    const audioSeconds = audio.length / SAMPLE_RATE;
    const warmDecodeMedianMs = median(warm.map((run) => run.ms));
    clips.push({
      id: clip.id,
      audioSeconds,
      firstDecodeMs: first.ms,
      warmDecodeMedianMs,
      warmStages: medianStages(warm),
      realTimeFactor: audioSeconds / (warmDecodeMedianMs / 1000),
      wordErrorRate: wordErrorRate(clip.text, first.text),
      text: first.text,
    });
  }

  const longest = [...clipAudio.values()].reduce((a, b) =>
    b.length > a.length ? b : a,
  );
  const growing: BenchGrowingResult[] = [];
  let previousSeconds = 0;
  for (const seconds of config.growingSeconds) {
    const samples = Math.min(longest.length, Math.round(seconds * SAMPLE_RATE));
    if (samples < seconds * SAMPLE_RATE * 0.9) break;
    const buffer = longest.subarray(0, samples);
    progress(`Growing buffer ${seconds}s…`);
    model.resetMelCache();
    model.clearIncrementalCache();
    const full = await timeRuns(model, buffer, config.warmRuns);

    let incremental: TimedTranscribe | null = null;
    if (previousSeconds > 0) {
      // parakeet.js reuses decoder state only when the cached prefix length
      // equals this call's prefixSeconds, so prime the cache at that prefix.
      const incrementalOptions = {
        incremental: { cacheKey: "grow", prefixSeconds: previousSeconds },
        prefixSamples: Math.round(previousSeconds * SAMPLE_RATE),
      };
      await timeTranscribe(model, buffer, incrementalOptions);
      incremental = await timeTranscribe(model, buffer, incrementalOptions);
    }
    growing.push({
      seconds,
      fullDecodeMedianMs: median(full.map((run) => run.ms)),
      fullStages: medianStages(full),
      incrementalDecodeMs: incremental?.ms ?? null,
      incrementalStages: incremental
        ? { encodeMs: incremental.encodeMs, decoderMs: incremental.decoderMs }
        : null,
    });
    previousSeconds = seconds;
  }

  const { clips: _clips, ...configSummary } = config;
  void _clips;

  return {
    config: configSummary,
    environment: {
      userAgent: navigator.userAgent,
      hardwareConcurrency: navigator.hardwareConcurrency,
      crossOriginIsolated: self.crossOriginIsolated === true,
      webgpuAdapter,
    },
    loadMs,
    clips,
    growing,
  };
}

self.addEventListener("message", (event: MessageEvent<BenchWorkerRequest>) => {
  if (event.data?.type !== "run") return;
  runBenchmark(event.data.config)
    .then((result) => post({ type: "result", result }))
    .catch((error: unknown) =>
      post({
        type: "error",
        message: error instanceof Error ? error.message : String(error),
      }),
    );
});

export {};
