/// <reference lib="webworker" />

import * as ort from "onnxruntime-web";
import ortJsepMjsUrl from "onnxruntime-web/ort-wasm-simd-threaded.jsep.mjs?url";
import ortJsepWasmUrl from "onnxruntime-web/ort-wasm-simd-threaded.jsep.wasm?url";
import ortWasmMjsUrl from "onnxruntime-web/ort-wasm-simd-threaded.mjs?url";
import ortWasmUrl from "onnxruntime-web/ort-wasm-simd-threaded.wasm?url";

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

const ENGINES: Record<
  BenchEngineId,
  (config: BenchConfig) => Promise<BenchEngine>
> = {
  parakeet: loadParakeetEngine,
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

/** Same ORT setup as the product worker: one thread, SIMD, JSEP for WebGPU. */
function configureOrt(backend: BenchConfig["backend"]): void {
  ort.env.wasm.wasmPaths =
    backend === "webgpu"
      ? { mjs: ortJsepMjsUrl, wasm: ortJsepWasmUrl }
      : { mjs: ortWasmMjsUrl, wasm: ortWasmUrl };
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.simd = true;
  ort.env.logLevel = "warning";
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

/** ORT silently runs on WASM when WebGPU fails; refuse to report that as WebGPU. */
function assertWebgpuInitialized(): void {
  const device = Object.getOwnPropertyDescriptor(ort.env.webgpu, "device");
  if (!device || !("value" in device) || !device.value) {
    throw new Error(
      "WebGPU did not initialize; ONNX Runtime fell back to WASM.",
    );
  }
}

/** Load the engine, check the backend and run one warm-up decode. */
async function timedLoad(
  next: BenchConfig,
): Promise<{ engine: BenchEngine; ms: number }> {
  const startedAt = performance.now();
  const loaded = await ENGINES[next.engine](next);
  if (next.backend === "webgpu") assertWebgpuInitialized();
  // One second of silence compiles kernels before the first measured clip.
  await runClip(loaded, new Float32Array(BENCH_SAMPLE_RATE), "en", {
    mode: "throughput",
    interim: false,
    clock,
  });
  return { engine: loaded, ms: performance.now() - startedAt };
}

async function load(next: BenchConfig): Promise<BenchLoadResult> {
  configureOrt(next.backend);
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
  const timing = await runClip(engine, request.audio, request.clip.language, {
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
