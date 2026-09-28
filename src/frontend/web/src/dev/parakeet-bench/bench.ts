/**
 * Development-only Parakeet benchmark page. Open `/parakeet-bench.html` on a
 * Vite development stack. Query parameters:
 *
 * - `backend`: `wasm` (default) or `webgpu`
 * - `encoder`: `int8` (default, the shipped model), `fp16` or `fp32`
 * - `threads`: WASM threads (default 1, matching the product worker)
 * - `spike`: base URL serving non-shipped encoder files (fp16/fp32)
 * - `clips`: base URL serving `clips.json` (`[{ id, text, url }]`) and WAVs
 * - `runs`: warm decodes per clip (default 3)
 *
 * Clips and spike files are local measurement inputs and are never committed.
 * Results are rendered as JSON and exposed as `window.__parakeetBenchResult`.
 */
import { CLIENT_PARAKEET_MODEL_ASSET_PATHS } from "@/lib/speech/client-parakeet/assets";

import type {
  BenchBackend,
  BenchClip,
  BenchConfig,
  BenchEncoderQuant,
  BenchResult,
  BenchWorkerResponse,
} from "./bench-protocol";

declare global {
  interface Window {
    __parakeetBenchResult?: BenchResult | { error: string };
  }
}

const output = document.getElementById("output")!;
const status = document.getElementById("status")!;

function trimSlash(url: string): string {
  return url.replace(/\/$/, "");
}

function encoderUrls(
  quant: BenchEncoderQuant,
  spikeBaseUrl: string | null,
): { encoderUrl: string; encoderDataUrl: string | null } {
  if (quant === "int8") {
    return {
      encoderUrl: new URL(
        CLIENT_PARAKEET_MODEL_ASSET_PATHS.encoder,
        location.href,
      ).href,
      encoderDataUrl: null,
    };
  }
  if (!spikeBaseUrl) {
    throw new Error(`encoder=${quant} requires a spike=<base URL> parameter`);
  }
  return quant === "fp16"
    ? {
        encoderUrl: `${spikeBaseUrl}/encoder-model.fp16.onnx`,
        encoderDataUrl: null,
      }
    : {
        encoderUrl: `${spikeBaseUrl}/encoder-model.onnx`,
        encoderDataUrl: `${spikeBaseUrl}/encoder-model.onnx.data`,
      };
}

function oneOf<T extends string>(
  value: string | null,
  allowed: readonly T[],
  fallback: T,
  name: string,
): T {
  const resolved = value ?? fallback;
  if (!(allowed as readonly string[]).includes(resolved)) {
    throw new Error(`${name} must be one of ${allowed.join(", ")}`);
  }
  return resolved as T;
}

function positiveInteger(value: string | null, fallback: number, name: string) {
  const resolved = value === null ? fallback : Number(value);
  if (!Number.isInteger(resolved) || resolved < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
  return resolved;
}

async function buildConfig(params: URLSearchParams): Promise<BenchConfig> {
  const backend = oneOf<BenchBackend>(
    params.get("backend"),
    ["wasm", "webgpu"],
    "wasm",
    "backend",
  );
  const encoderQuant = oneOf<BenchEncoderQuant>(
    params.get("encoder"),
    ["int8", "fp16", "fp32"],
    "int8",
    "encoder",
  );
  const spike = params.get("spike");
  const clipsBase = params.get("clips");
  if (!clipsBase) {
    throw new Error("Missing clips=<base URL serving clips.json>");
  }
  const clipsBaseUrl = trimSlash(clipsBase);
  const manifestResponse = await fetch(`${clipsBaseUrl}/clips.json`);
  if (!manifestResponse.ok) {
    throw new Error(
      `clips.json failed to load: HTTP ${manifestResponse.status}`,
    );
  }
  const manifest = (await manifestResponse.json()) as BenchClip[];
  const absolute = (path: string) => new URL(path, location.href).href;

  return {
    backend,
    encoderQuant,
    cpuThreads: positiveInteger(params.get("threads"), 1, "threads"),
    ...encoderUrls(encoderQuant, spike ? trimSlash(spike) : null),
    decoderUrl: absolute(CLIENT_PARAKEET_MODEL_ASSET_PATHS.decoder),
    tokenizerUrl: absolute(CLIENT_PARAKEET_MODEL_ASSET_PATHS.tokenizer),
    preprocessorUrl: absolute(CLIENT_PARAKEET_MODEL_ASSET_PATHS.preprocessor),
    clips: manifest.map((clip) => ({
      ...clip,
      url: `${clipsBaseUrl}/${clip.url}`,
    })),
    warmRuns: positiveInteger(params.get("runs"), 3, "runs"),
    growingSeconds: [1, 3, 6, 12],
  };
}

function finish(result: BenchResult | { error: string }): void {
  window.__parakeetBenchResult = result;
  output.textContent = JSON.stringify(result, null, 2);
  status.textContent = "error" in result ? `Failed: ${result.error}` : "Done";
  console.info("[ParakeetBench]", JSON.stringify(result));
}

async function main(): Promise<void> {
  if (!import.meta.env.DEV) {
    status.textContent =
      "The Parakeet benchmark runs only on a development server.";
    return;
  }
  const config = await buildConfig(new URLSearchParams(location.search));
  const worker = new Worker(new URL("./bench-worker.ts", import.meta.url), {
    type: "module",
    name: "parakeet-bench-worker",
  });
  worker.addEventListener(
    "message",
    (event: MessageEvent<BenchWorkerResponse>) => {
      const message = event.data;
      if (message.type === "progress") {
        status.textContent = message.message;
        return;
      }
      finish(
        message.type === "result" ? message.result : { error: message.message },
      );
      worker.terminate();
    },
  );
  worker.addEventListener("error", (event) => {
    finish({ error: event.message || "Benchmark worker failed" });
    worker.terminate();
  });
  worker.postMessage({ type: "run", config });
}

main().catch((error: unknown) =>
  finish({ error: error instanceof Error ? error.message : String(error) }),
);
