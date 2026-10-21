/**
 * Development-only speech recognition benchmark (issue #509). Open
 * `/speech-bench.html` on a Vite development server, or run it through
 * `pnpm speech:bench` (`src/frontend/scripts/speech-bench.mjs`). Query
 * parameters:
 *
 * - `engine`: `parakeet` (default), `sensevoice` or `nemotron`
 * - `backend`: `wasm` (default) or `webgpu`
 * - `mode`: `throughput` (default) or `paced` (real-time audio delivery)
 * - `interim`: `1` or `0`; defaults to `1` when paced
 * - `clips`: base URL serving `clips.json` and the audio it lists (required)
 * - `sets`: comma-separated set ids to run (default: every set)
 * - `limit`: clips per set
 * - `models`, `gpuModels`: base URLs of engine files the app does not serve
 * - `loadOnly`: `1` loads the model and stops (the runner's cold-load launch)
 *
 * Clips come from `scripts/speech-eval/speech_eval.py fetch`; they are decoded
 * and resampled to 16 kHz mono here, then transcribed one at a time in a
 * worker. Sets scored in Traditional script get the engine's output converted
 * with OpenCC, as the app would for `zh-Hant`. Results render as JSON and are
 * exposed as `window.__speechBenchResult`.
 */
import type {
  BenchBackend,
  BenchClip,
  BenchClipResult,
  BenchConfig,
  BenchEngineId,
  BenchMode,
  BenchResult,
  BenchWorkerRequest,
  BenchWorkerResponse,
} from "./bench-protocol";
import { BENCH_SAMPLE_RATE } from "./bench-runner";
import { inSetScript } from "./script-conversion";

declare global {
  interface Window {
    __speechBenchResult?: BenchResult | { error: string };
    /** Read by the runner to split peak memory into load and clip phases. */
    __speechBenchPhase?: "loading" | "clips";
  }
}

const output = document.getElementById("output")!;
const status = document.getElementById("status")!;

function oneOf<T extends string>(
  params: URLSearchParams,
  name: string,
  allowed: readonly T[],
): T {
  const value = params.get(name) ?? allowed[0];
  if (!(allowed as readonly string[]).includes(value)) {
    throw new Error(`${name} must be one of ${allowed.join(", ")}`);
  }
  return value as T;
}

const trimSlash = (url: string) => url.replace(/\/$/, "");

function buildConfig(params: URLSearchParams): BenchConfig {
  const mode = oneOf<BenchMode>(params, "mode", ["throughput", "paced"]);
  const interim = params.get("interim");
  const models = params.get("models");
  const gpuModels = params.get("gpuModels");
  return {
    engine: oneOf<BenchEngineId>(params, "engine", [
      "parakeet",
      "sensevoice",
      "nemotron",
    ]),
    backend: oneOf<BenchBackend>(params, "backend", ["wasm", "webgpu"]),
    mode,
    interim: interim === null ? mode === "paced" : interim === "1",
    modelBaseUrl: models ? trimSlash(models) : null,
    gpuModelBaseUrl: gpuModels ? trimSlash(gpuModels) : null,
  };
}

async function loadClipList(params: URLSearchParams): Promise<BenchClip[]> {
  const base = params.get("clips");
  if (!base) throw new Error("Missing clips=<base URL serving clips.json>");
  const response = await fetch(`${trimSlash(base)}/clips.json`);
  if (!response.ok) {
    throw new Error(`clips.json failed to load: HTTP ${response.status}`);
  }
  const sets = params.get("sets")?.split(",").filter(Boolean);
  const limit = Number(params.get("limit") ?? Infinity);
  const perSet = new Map<string, number>();
  return ((await response.json()) as BenchClip[])
    .filter((clip) => !sets || sets.includes(clip.set))
    .filter((clip) => {
      const count = perSet.get(clip.set) ?? 0;
      perSet.set(clip.set, count + 1);
      return count < limit;
    })
    .map((clip) => ({ ...clip, url: `${trimSlash(base)}/${clip.url}` }));
}

/** Decode any browser-supported audio to 16 kHz mono samples. */
async function decodeClip(url: string): Promise<Float32Array> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} failed: HTTP ${response.status}`);
  const context = new OfflineAudioContext(1, 1, BENCH_SAMPLE_RATE);
  const buffer = await context.decodeAudioData(await response.arrayBuffer());
  const mono = new Float32Array(buffer.length);
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const samples = buffer.getChannelData(channel);
    for (let index = 0; index < mono.length; index += 1) {
      mono[index] += samples[index] / buffer.numberOfChannels;
    }
  }
  return mono;
}

type BenchWorker = {
  request: (
    request: BenchWorkerRequest,
    transfer?: Transferable[],
  ) => Promise<BenchWorkerResponse>;
  terminate: () => void;
};

function startWorker(onError: (message: string) => void): BenchWorker {
  const worker = new Worker(new URL("./bench-worker.ts", import.meta.url), {
    type: "module",
    name: "speech-bench-worker",
  });
  worker.addEventListener("error", (event) =>
    onError(event.message || "Benchmark worker failed"),
  );
  return {
    request: (request, transfer = []) =>
      new Promise((resolve) => {
        worker.addEventListener(
          "message",
          (event: MessageEvent<BenchWorkerResponse>) => resolve(event.data),
          { once: true },
        );
        worker.postMessage(request, transfer);
      }),
    terminate: () => worker.terminate(),
  };
}

async function loadIn(worker: BenchWorker, config: BenchConfig) {
  const loaded = await worker.request({ type: "load", config });
  if (loaded.type !== "loaded") {
    throw new Error(loaded.type === "error" ? loaded.message : "Load failed");
  }
  return loaded.result;
}

function finish(result: BenchResult | { error: string }): void {
  window.__speechBenchResult = result;
  output.textContent = JSON.stringify(result, null, 2);
  status.textContent = "error" in result ? `Failed: ${result.error}` : "Done";
}

async function main(): Promise<void> {
  if (!import.meta.env.DEV) {
    status.textContent =
      "The speech benchmark runs only on a development server.";
    return;
  }
  const params = new URLSearchParams(location.search);
  const config = buildConfig(params);
  const clips = await loadClipList(params);
  if (clips.length === 0) {
    throw new Error("No clips match sets= and limit=; check the set ids.");
  }
  const worker = startWorker((message) => finish({ error: message }));
  window.__speechBenchPhase = "loading";
  status.textContent = `Loading ${config.engine} on ${config.backend}…`;
  const load = await loadIn(worker, config);
  window.__speechBenchPhase = "clips";
  const {
    modelBaseUrl: _models,
    gpuModelBaseUrl: _gpuModels,
    ...summary
  } = config;
  void _models;
  void _gpuModels;
  if (params.get("loadOnly") === "1") {
    worker.terminate();
    finish({ ...summary, ...load, clips: [] });
    return;
  }

  const results: BenchClipResult[] = [];
  for (const [index, clip] of clips.entries()) {
    status.textContent = `${index + 1}/${clips.length} ${clip.set}/${clip.id}`;
    const audio = await decodeClip(clip.url);
    const response = await worker.request(
      {
        type: "run",
        clip: { set: clip.set, id: clip.id },
        audio,
      },
      [audio.buffer],
    );
    if (response.type !== "clip_result") {
      throw new Error(
        response.type === "error" ? response.message : "Run failed",
      );
    }
    results.push(inSetScript(clip, response.result));
  }
  worker.terminate();
  finish({ ...summary, ...load, clips: results });
}

main().catch((error: unknown) =>
  finish({ error: error instanceof Error ? error.message : String(error) }),
);
