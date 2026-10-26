/// <reference lib="webworker" />

import type {
  BenchConfig,
  BenchEngineId,
  BenchLoadResult,
  BenchWorkerRequest,
  BenchWorkerResponse,
} from "./bench-protocol";
import {
  BENCH_SAMPLE_RATE,
  runClip,
  type BenchClock,
  type BenchEngine,
} from "./bench-runner";
import { loadParakeetEngine } from "./engines/parakeet";
import { loadSenseVoiceEngine } from "./engines/sensevoice";

const ENGINES: Record<
  BenchEngineId,
  (config: BenchConfig) => Promise<BenchEngine>
> = {
  parakeet: loadParakeetEngine,
  sensevoice: loadSenseVoiceEngine,
};

const clock: BenchClock = {
  now: () => performance.now(),
  sleepUntil: (timeMs) =>
    new Promise((resolve) =>
      setTimeout(resolve, Math.max(0, timeMs - performance.now())),
    ),
};

let config: BenchConfig | null = null;
let engine: BenchEngine | null = null;

function post(response: BenchWorkerResponse): void {
  self.postMessage(response);
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

/** Load the engine, check the backend and run one warm-up decode. */
async function timedLoad(
  next: BenchConfig,
): Promise<{ engine: BenchEngine; ms: number }> {
  const startedAt = performance.now();
  const loaded = await ENGINES[next.engine](next);
  // One second of silence compiles kernels before the first measured clip.
  await runClip(loaded, new Float32Array(BENCH_SAMPLE_RATE), "en", {
    mode: "throughput",
    interim: false,
    clock,
  });
  return { engine: loaded, ms: performance.now() - startedAt };
}

async function load(next: BenchConfig): Promise<BenchLoadResult> {
  const loaded = await timedLoad(next);
  config = next;
  engine = loaded.engine;
  return {
    loadMs: loaded.ms,
    environment: {
      userAgent: navigator.userAgent,
      hardwareConcurrency: navigator.hardwareConcurrency,
      crossOriginIsolated: self.crossOriginIsolated === true,
      webgpuAdapter: await describeWebgpuAdapter(),
    },
  };
}

async function handle(request: BenchWorkerRequest): Promise<void> {
  if (request.type === "load") {
    post({ type: "loaded", result: await load(request.config) });
    return;
  }
  if (!config || !engine)
    throw new Error("Load an engine before running clips.");
  // The set id names the language; the engine routes it as the app does.
  const timing = await runClip(engine, request.audio, request.clip.set, {
    mode: config.mode,
    interim: config.interim,
    clock,
  });
  post({
    type: "clip_result",
    result: { set: request.clip.set, id: request.clip.id, ...timing },
  });
}

self.addEventListener("message", (event: MessageEvent<BenchWorkerRequest>) => {
  handle(event.data).catch((error: unknown) =>
    post({
      type: "error",
      message: error instanceof Error ? error.message : String(error),
    }),
  );
});

export {};
