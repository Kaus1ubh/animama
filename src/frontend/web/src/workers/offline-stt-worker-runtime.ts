/// <reference lib="webworker" />
/**
 * Shared runtime for the offline speech-to-text workers (Parakeet and
 * SenseVoice): the app's ONNX Runtime copy, the WebGPU initialization check and
 * one serial request queue, so a preview in flight delays the final that
 * follows it instead of racing it.
 */

import * as ort from "onnxruntime-web";
import ortJsepMjsUrl from "onnxruntime-web/ort-wasm-simd-threaded.jsep.mjs?url";
import ortJsepWasmUrl from "onnxruntime-web/ort-wasm-simd-threaded.jsep.wasm?url";
import ortWasmMjsUrl from "onnxruntime-web/ort-wasm-simd-threaded.mjs?url";
import ortWasmUrl from "onnxruntime-web/ort-wasm-simd-threaded.wasm?url";

import { createLogger } from "@/lib/logger";
import type {
  OfflineSttBackend,
  OfflineSttDisposeResult,
  OfflineSttLoadRequest,
  OfflineSttLoadResult,
  OfflineSttModelUrls,
  OfflineSttTranscribeRequest,
  OfflineSttTranscribeResult,
  OfflineSttWorkerRequest,
  OfflineSttWorkerResponse,
  OfflineSttWorkerResponseType,
} from "@/lib/speech/offline-stt/worker-protocol";

export const TARGET_SAMPLE_RATE = 16000;

const ortWasmPaths = {
  // ORT dynamically imports this module, so Vite must resolve it as a bundled URL.
  // Public /onnx/ort/*.mjs files fail in dev when ORT appends ?import.
  mjs: ortWasmMjsUrl,
  wasm: ortWasmUrl,
};
// The WebGPU execution provider ships only in ORT's JSEP build.
const ortJsepPaths = {
  mjs: ortJsepMjsUrl,
  wasm: ortJsepWasmUrl,
};

/** ORT loads one WASM build per worker; the client recreates the worker to switch. */
let ortBackend: OfflineSttBackend | null = null;

export function configureOrt(backend: OfflineSttBackend, label: string): void {
  if (ortBackend && ortBackend !== backend) {
    throw new Error(
      `Client ${label} worker already initialized ORT for ${ortBackend}; create a new worker to load ${backend}.`,
    );
  }
  ortBackend = backend;
  ort.env.wasm.wasmPaths = backend === "webgpu" ? ortJsepPaths : ortWasmPaths;
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.simd = true;
  ort.env.logLevel = "warning";
}

/**
 * ORT silently drops a WebGPU provider that fails to start and runs the
 * session on WASM; only an initialized backend defines this own property.
 */
export function webgpuInitialized(): boolean {
  const device = Object.getOwnPropertyDescriptor(ort.env.webgpu, "device");
  return Boolean(device && "value" in device && device.value);
}

export function assertSampleRate(sampleRateHz: number, label: string): void {
  if (sampleRateHz !== TARGET_SAMPLE_RATE) {
    throw new Error(
      `Client ${label} requires ${TARGET_SAMPLE_RATE}Hz mono audio, received ${sampleRateHz}Hz.`,
    );
  }
}

export function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

/** A worker's engine: it loads, transcribes and releases its own model. */
export type OfflineSttWorkerEngine<Urls extends OfflineSttModelUrls> = {
  label: string;
  load: (
    request: OfflineSttLoadRequest<Urls>,
  ) => Promise<OfflineSttLoadResult<Urls>>;
  transcribe: (
    request: OfflineSttTranscribeRequest,
  ) => Promise<OfflineSttTranscribeResult>;
  dispose: () => Promise<OfflineSttDisposeResult>;
};

const RESPONSE_TYPES = {
  "offline_stt/load": "offline_stt/load_result",
  "offline_stt/transcribe": "offline_stt/transcribe_result",
  "offline_stt/dispose": "offline_stt/dispose_result",
} as const satisfies Record<
  OfflineSttWorkerRequest["type"],
  OfflineSttWorkerResponseType
>;

/** Answer the page's requests one at a time with `engine`. */
export function serveOfflineSttRequests<Urls extends OfflineSttModelUrls>(
  engine: OfflineSttWorkerEngine<Urls>,
): void {
  const logger = createLogger(`Client${engine.label}Worker`);
  let queue: Promise<void> = Promise.resolve();

  async function process(
    message: OfflineSttWorkerRequest<Urls>,
  ): Promise<OfflineSttWorkerResponse> {
    switch (message.type) {
      case "offline_stt/load":
        return {
          type: "offline_stt/load_result",
          requestId: message.requestId,
          ok: true,
          result: await engine.load(message),
        };
      case "offline_stt/transcribe":
        return {
          type: "offline_stt/transcribe_result",
          requestId: message.requestId,
          ok: true,
          result: await engine.transcribe(message),
        };
      default:
        return {
          type: "offline_stt/dispose_result",
          requestId: message.requestId,
          ok: true,
          result: await engine.dispose(),
        };
    }
  }

  self.addEventListener("message", (event: MessageEvent<unknown>) => {
    const message = event.data as OfflineSttWorkerRequest<Urls> | undefined;
    if (
      !message ||
      !(message.type in RESPONSE_TYPES) ||
      typeof message.requestId !== "string"
    ) {
      return;
    }

    queue = queue
      .then(async () => {
        try {
          self.postMessage(await process(message));
        } catch (error) {
          logger.error(
            "Worker",
            `Client ${engine.label} worker request failed`,
            error,
          );
          logger.warn(
            "Worker",
            `Client ${engine.label} worker request context`,
            {
              requestId: message.requestId,
              type: message.type,
              error: toErrorMessage(error),
            },
          );
          self.postMessage({
            type: RESPONSE_TYPES[message.type],
            requestId: message.requestId,
            ok: false,
            error: {
              message: toErrorMessage(error),
              ...(error instanceof Error && typeof error.stack === "string"
                ? { stack: error.stack }
                : {}),
            },
          } satisfies OfflineSttWorkerResponse);
        }
      })
      .catch((error) => {
        logger.error(
          "Worker",
          `Client ${engine.label} worker queue failed`,
          error,
        );
      });
  });
}
