/// <reference lib="webworker" />

import * as ort from "onnxruntime-web";
import ortJsepMjsUrl from "onnxruntime-web/ort-wasm-simd-threaded.jsep.mjs?url";
import ortJsepWasmUrl from "onnxruntime-web/ort-wasm-simd-threaded.jsep.wasm?url";
import ortWasmMjsUrl from "onnxruntime-web/ort-wasm-simd-threaded.mjs?url";
import ortWasmUrl from "onnxruntime-web/ort-wasm-simd-threaded.wasm?url";

import type { ParakeetModel } from "parakeet.js";
import { fromUrls } from "parakeet.js";

import { createLogger } from "@/lib/logger";
import type {
  ClientParakeetBackend,
  ClientParakeetDisposeRequest,
  ClientParakeetErrorResponse,
  ClientParakeetLoadRequest,
  ClientParakeetModelUrls,
  ClientParakeetTranscribeRequest,
  ClientParakeetWorkerRequest,
  ClientParakeetWorkerResponse,
  ClientParakeetWorkerResponseType,
} from "@/lib/speech/client-parakeet/worker-protocol";

type ReleasableSession = {
  release?: () => Promise<void> | void;
};

type DisposableTensor = {
  dispose?: () => void;
};

type DisposableParakeetModel = ParakeetModel & {
  encoderSession?: ReleasableSession;
  joinerSession?: ReleasableSession;
  resetMelCache?: () => void;
  clearIncrementalCache?: () => void;
  _combState1?: DisposableTensor;
  _combState2?: DisposableTensor;
  _targetTensor?: DisposableTensor;
  _targetLenTensor?: DisposableTensor;
  _encoderFrameTensor?: DisposableTensor;
};

const logger = createLogger("ClientParakeetWorker");
const TARGET_SAMPLE_RATE = 16000;
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

let model: ParakeetModel | null = null;
let loadedModelUrls: ClientParakeetModelUrls | null = null;
let loadedSampleRateHz: number | null = null;
let loadedBackend: ClientParakeetBackend | null = null;
/** ORT loads one WASM build per worker; the client recreates the worker to switch. */
let ortBackend: ClientParakeetBackend | null = null;
let queue: Promise<void> = Promise.resolve();

function postResponse(response: ClientParakeetWorkerResponse): void {
  self.postMessage(response);
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function toErrorStack(error: unknown): string | undefined {
  if (error instanceof Error && typeof error.stack === "string") {
    return error.stack;
  }
  return undefined;
}

function buildErrorResponse(args: {
  type: ClientParakeetWorkerResponseType;
  requestId: string;
  error: unknown;
}): ClientParakeetErrorResponse {
  return {
    type: args.type,
    requestId: args.requestId,
    ok: false,
    error: {
      message: toErrorMessage(args.error),
      ...(toErrorStack(args.error) ? { stack: toErrorStack(args.error) } : {}),
    },
  };
}

function sameModelUrls(
  left: ClientParakeetModelUrls | null,
  right: ClientParakeetModelUrls,
): boolean {
  return (
    left?.encoderUrl === right.encoderUrl &&
    left.decoderUrl === right.decoderUrl &&
    left.tokenizerUrl === right.tokenizerUrl &&
    left.preprocessorUrl === right.preprocessorUrl
  );
}

function ensureModel(): ParakeetModel {
  if (!model) {
    throw new Error("Client Parakeet model has not been loaded.");
  }
  return model;
}

function configureOrt(backend: ClientParakeetBackend): void {
  if (ortBackend && ortBackend !== backend) {
    throw new Error(
      `Client Parakeet worker already initialized ORT for ${ortBackend}; create a new worker to load ${backend}.`,
    );
  }
  ortBackend = backend;
  ort.env.wasm.wasmPaths = backend === "webgpu" ? ortJsepPaths : ortWasmPaths;
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.simd = true;
  ort.env.logLevel = "warning";
}

async function releaseModel(activeModel: ParakeetModel | null): Promise<void> {
  if (!activeModel) return;

  const disposable = activeModel as DisposableParakeetModel;
  try {
    disposable.resetMelCache?.();
    disposable.clearIncrementalCache?.();
    disposable._combState1?.dispose?.();
    disposable._combState2?.dispose?.();
    disposable._targetTensor?.dispose?.();
    disposable._targetLenTensor?.dispose?.();
    disposable._encoderFrameTensor?.dispose?.();
    await disposable.encoderSession?.release?.();
    await disposable.joinerSession?.release?.();
  } catch (error) {
    logger.warn("Dispose", "Failed to release part of Parakeet model", {
      error: toErrorMessage(error),
    });
  }
}

async function handleLoad(request: ClientParakeetLoadRequest): Promise<void> {
  if (
    model &&
    loadedBackend === request.backend &&
    loadedSampleRateHz === request.sampleRateHz &&
    sameModelUrls(loadedModelUrls, request.modelUrls)
  ) {
    postResponse({
      type: "client_parakeet/load_result",
      requestId: request.requestId,
      ok: true,
      result: {
        backend: request.backend,
        modelUrls: request.modelUrls,
        sampleRateHz: request.sampleRateHz,
        loadMs: 0,
        reused: true,
      },
    });
    return;
  }

  if (request.sampleRateHz !== TARGET_SAMPLE_RATE) {
    throw new Error(
      `Client Parakeet requires ${TARGET_SAMPLE_RATE}Hz mono audio, received ${request.sampleRateHz}Hz.`,
    );
  }

  logger.info("Load", "Loading client Parakeet runtime", {
    backend: request.backend,
    modelUrls: request.modelUrls,
    sampleRateHz: request.sampleRateHz,
  });

  await releaseModel(model);
  model = null;
  loadedModelUrls = null;
  loadedSampleRateHz = null;
  loadedBackend = null;

  configureOrt(request.backend);
  const startedAtMs = performance.now();
  model = await fromUrls({
    // Hybrid keeps the INT8 decoder/joint on WASM while the encoder uses WebGPU.
    backend: request.backend === "webgpu" ? "webgpu-hybrid" : "wasm",
    cpuThreads: 1,
    decoderUrl: request.modelUrls.decoderUrl,
    enableProfiling: false,
    encoderUrl: request.modelUrls.encoderUrl,
    nMels: 128,
    preprocessorBackend: "js",
    preprocessorUrl: request.modelUrls.preprocessorUrl,
    tokenizerUrl: request.modelUrls.tokenizerUrl,
    verbose: false,
  });

  if (request.backend === "webgpu") {
    // ORT silently drops a WebGPU provider that fails to start and runs the
    // session on WASM; only an initialized backend defines this own property.
    const device = Object.getOwnPropertyDescriptor(ort.env.webgpu, "device");
    if (!device || !("value" in device) || !device.value) {
      await releaseModel(model);
      model = null;
      throw new Error(
        "WebGPU did not initialize in the Parakeet worker; ONNX Runtime fell back to WASM.",
      );
    }
    // The first WebGPU inference compiles shaders and can take about a second.
    // Pay that during load so the first preview does not look over budget.
    const warmupStartedAtMs = performance.now();
    await model.transcribe(
      new Float32Array(TARGET_SAMPLE_RATE),
      TARGET_SAMPLE_RATE,
      {
        returnConfidences: false,
        returnTimestamps: false,
      },
    );
    logger.info("Load", "Warmed up WebGPU Parakeet runtime", {
      warmupMs: Math.round(performance.now() - warmupStartedAtMs),
    });
  }

  loadedModelUrls = request.modelUrls;
  loadedSampleRateHz = request.sampleRateHz;
  loadedBackend = request.backend;
  const loadMs = Math.round(performance.now() - startedAtMs);

  logger.info("Load", "Client Parakeet runtime ready", {
    backend: request.backend,
    loadMs,
  });

  postResponse({
    type: "client_parakeet/load_result",
    requestId: request.requestId,
    ok: true,
    result: {
      backend: request.backend,
      modelUrls: request.modelUrls,
      sampleRateHz: request.sampleRateHz,
      loadMs,
      reused: false,
    },
  });
}

async function handleTranscribe(
  request: ClientParakeetTranscribeRequest,
): Promise<void> {
  if (request.sampleRateHz !== TARGET_SAMPLE_RATE) {
    throw new Error(
      `Client Parakeet requires ${TARGET_SAMPLE_RATE}Hz mono audio, received ${request.sampleRateHz}Hz.`,
    );
  }
  if (request.audio.length <= 0) {
    throw new Error("Client Parakeet received an empty speech window.");
  }

  const activeModel = ensureModel();
  const startedAtMs = performance.now();
  const result = await activeModel.transcribe(
    request.audio,
    request.sampleRateHz,
    {
      // parakeet.js logs to the console when profiling; skip it for frequent previews.
      enableProfiling: request.kind === "final",
      returnConfidences: false,
      returnTimestamps: false,
    },
  );
  const transcribeMs = Math.round(performance.now() - startedAtMs);
  const text = result.utterance_text.trim();

  // Previews repeat roughly every second while speaking; keep them out of info logs.
  const log = request.kind === "preview" ? logger.debug : logger.info;
  log("Transcribe", "Client Parakeet speech window transcribed", {
    kind: request.kind,
    jobId: request.jobId,
    runId: request.runId,
    turnId: request.turnId,
    windowId: request.windowId,
    samples: request.audio.length,
    transcribeMs,
    textLength: text.length,
    metrics: result.metrics,
  });

  postResponse({
    type: "client_parakeet/transcribe_result",
    requestId: request.requestId,
    ok: true,
    result: {
      jobId: request.jobId,
      runId: request.runId,
      turnId: request.turnId,
      windowId: request.windowId,
      text,
      isFinal: request.kind === "final",
      sampleRateHz: request.sampleRateHz,
      audioSamples: request.audio.length,
      audioDurationMs: Math.round(
        (request.audio.length / request.sampleRateHz) * 1000,
      ),
      transcribeMs,
      metrics: result.metrics ?? null,
    },
  });
}

async function handleDispose(
  request: ClientParakeetDisposeRequest,
): Promise<void> {
  await releaseModel(model);
  model = null;
  loadedModelUrls = null;
  loadedSampleRateHz = null;
  loadedBackend = null;

  logger.info("Dispose", "Disposed client Parakeet runtime");

  postResponse({
    type: "client_parakeet/dispose_result",
    requestId: request.requestId,
    ok: true,
    result: { disposed: true },
  });
}

async function processRequest(
  message: ClientParakeetWorkerRequest,
): Promise<void> {
  if (message.type === "client_parakeet/load") {
    await handleLoad(message);
    return;
  }
  if (message.type === "client_parakeet/transcribe") {
    await handleTranscribe(message);
    return;
  }
  await handleDispose(message);
}

function responseTypeForRequest(
  message: ClientParakeetWorkerRequest,
): ClientParakeetWorkerResponseType {
  if (message.type === "client_parakeet/load") {
    return "client_parakeet/load_result";
  }
  if (message.type === "client_parakeet/transcribe") {
    return "client_parakeet/transcribe_result";
  }
  return "client_parakeet/dispose_result";
}

self.addEventListener("message", (event: MessageEvent<unknown>) => {
  const message = event.data as ClientParakeetWorkerRequest | undefined;

  if (
    !message ||
    typeof message.type !== "string" ||
    typeof message.requestId !== "string"
  ) {
    return;
  }

  queue = queue
    .then(async () => {
      try {
        await processRequest(message);
      } catch (error) {
        logger.error("Worker", "Client Parakeet worker request failed", error);
        logger.warn("Worker", "Client Parakeet worker request context", {
          requestId: message.requestId,
          type: message.type,
          error: toErrorMessage(error),
        });
        postResponse(
          buildErrorResponse({
            type: responseTypeForRequest(message),
            requestId: message.requestId,
            error,
          }),
        );
      }
    })
    .catch((error) => {
      logger.error("Worker", "Client Parakeet worker queue failed", error);
    });
});

export {};
