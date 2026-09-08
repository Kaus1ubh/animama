/// <reference lib="webworker" />

import * as ort from "onnxruntime-web";
import ortWasmMjsUrl from "onnxruntime-web/ort-wasm-simd-threaded.mjs?url";
import ortWasmUrl from "onnxruntime-web/ort-wasm-simd-threaded.wasm?url";

import { createLogger } from "@/lib/logger";
import {
  DEFAULT_WHISPER_TINY_EN_CONFIG,
  TARGET_SMART_TURN_SAMPLES,
  createLocalWhisperFeatureExtractor,
  prepareSmartTurnAudioWindow,
} from "@/lib/voice/smart-turn/local-whisper-feature-extractor.mjs";
import type {
  SmartTurnDisposeRequest,
  SmartTurnDisposeResponse,
  SmartTurnErrorResponse,
  SmartTurnLoadRequest,
  SmartTurnLoadResponse,
  SmartTurnPredictRequest,
  SmartTurnPredictResponse,
  SmartTurnWorkerResponseType,
} from "@/lib/voice/smart-turn-worker-protocol";

const logger = createLogger("SmartTurnWorker");

const TARGET_SAMPLE_RATE = 16000;
const TARGET_FEATURE_SHAPE: [number, number, number] = [1, 80, 800];
const ortWasmPaths = {
  // ORT dynamically imports this module, so Vite must resolve it as a bundled URL.
  // Public /onnx/ort/*.mjs files fail in dev when ORT appends ?import.
  mjs: ortWasmMjsUrl,
  wasm: ortWasmUrl,
};

let session: ort.InferenceSession | null = null;
let featureExtractor: ReturnType<
  typeof createLocalWhisperFeatureExtractor
> | null = null;
let loadedModelUrl: string | null = null;

function postResponse(
  response:
    | SmartTurnLoadResponse
    | SmartTurnPredictResponse
    | SmartTurnDisposeResponse
    | SmartTurnErrorResponse,
): void {
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
  type: SmartTurnWorkerResponseType;
  requestId: string;
  error: unknown;
}): SmartTurnErrorResponse {
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

function assertFeatureShape(
  dims: readonly number[],
): asserts dims is [number, number, number] {
  if (dims.length !== 3) {
    throw new Error(`Unexpected smart-turn feature rank: ${dims.length}`);
  }
  if (
    dims[0] !== TARGET_FEATURE_SHAPE[0] ||
    dims[1] !== TARGET_FEATURE_SHAPE[1] ||
    dims[2] !== TARGET_FEATURE_SHAPE[2]
  ) {
    throw new Error(
      `Unexpected smart-turn feature shape: [${dims.join(", ")}], expected [${TARGET_FEATURE_SHAPE.join(", ")}]`,
    );
  }
}

function toNumberDims(dims: readonly number[] | readonly bigint[]): number[] {
  return dims.map((value) => Number(value));
}

function ensureSession(): ort.InferenceSession {
  if (!session) {
    throw new Error("Smart-turn model session has not been loaded");
  }
  return session;
}

function ensureFeatureExtractor() {
  if (!featureExtractor) {
    throw new Error("Local whisper feature extractor has not been loaded");
  }
  return featureExtractor;
}

function getFirstScoreFromOutputMap(
  outputMap: Awaited<ReturnType<ort.InferenceSession["run"]>>,
): number {
  const firstOutput = Object.values(outputMap)[0];
  const outputData = firstOutput?.data;
  const firstScore =
    outputData && typeof (outputData as ArrayLike<number>)[0] === "number"
      ? Number((outputData as ArrayLike<number>)[0])
      : Number.NaN;

  if (!Number.isFinite(firstScore)) {
    throw new Error("Smart-turn ONNX output tensor missing or invalid");
  }

  return firstScore;
}

async function handleLoad(request: SmartTurnLoadRequest): Promise<void> {
  if (session && featureExtractor && loadedModelUrl === request.modelUrl) {
    postResponse({
      type: "smart_turn/load_result",
      requestId: request.requestId,
      ok: true,
      result: {
        modelUrl: request.modelUrl,
      },
    });
    return;
  }

  logger.info("Load", "Loading smart-turn runtime", {
    modelUrl: request.modelUrl,
    ortWasmBaseUrl: request.ortWasmBaseUrl,
  });

  ort.env.wasm.wasmPaths = ortWasmPaths;
  ort.env.wasm.numThreads = 1;
  ort.env.logLevel = "warning";

  session = await ort.InferenceSession.create(request.modelUrl, {
    executionProviders: ["wasm"],
    graphOptimizationLevel: "all",
    executionMode: "sequential",
  });

  featureExtractor = createLocalWhisperFeatureExtractor({
    ...DEFAULT_WHISPER_TINY_EN_CONFIG,
  });

  loadedModelUrl = request.modelUrl;

  logger.info("Load", "Smart-turn runtime ready", {
    modelUrl: request.modelUrl,
  });

  postResponse({
    type: "smart_turn/load_result",
    requestId: request.requestId,
    ok: true,
    result: {
      modelUrl: request.modelUrl,
    },
  });
}

async function handlePredict(request: SmartTurnPredictRequest): Promise<void> {
  if (request.sampleRateHz !== TARGET_SAMPLE_RATE) {
    throw new Error(
      `Smart-turn requires ${TARGET_SAMPLE_RATE}Hz mono audio, received ${request.sampleRateHz}Hz`,
    );
  }

  const activeSession = ensureSession();
  const extractor = ensureFeatureExtractor();
  const startMs = performance.now();

  const preprocessStartMs = performance.now();
  const { normalizedAudio, paddedLeadingSamples, truncatedLeadingSamples } =
    prepareSmartTurnAudioWindow(request.audio, TARGET_SMART_TURN_SAMPLES);

  const extracted = await extractor.extract(normalizedAudio, {
    maxLength: TARGET_SMART_TURN_SAMPLES,
  });

  if (!(extracted.data instanceof Float32Array)) {
    throw new Error(
      "Local whisper feature extraction did not return Float32 feature data",
    );
  }

  const dims = toNumberDims(extracted.dims as readonly number[]);
  assertFeatureShape(dims);

  const preprocessMs = Math.round(performance.now() - preprocessStartMs);
  const ortInput = new ort.Tensor("float32", extracted.data, dims);

  const inferenceStartMs = performance.now();
  const outputMap = await activeSession.run({ input_features: ortInput });
  const probability = getFirstScoreFromOutputMap(outputMap);

  const inferenceMs = Math.round(performance.now() - inferenceStartMs);
  const latencyMs = Math.round(performance.now() - startMs);

  const prediction = probability > request.threshold ? 1 : 0;
  const decision = prediction === 1 ? "end_turn" : "continue";

  postResponse({
    type: "smart_turn/predict_result",
    requestId: request.requestId,
    ok: true,
    result: {
      jobId: request.jobId,
      turnId: request.turnId,
      prediction,
      decision,
      probability,
      threshold: request.threshold,
      latencyMs,
      preprocessMs,
      inferenceMs,
      paddedLeadingSamples,
      truncatedLeadingSamples,
      inputSamples: TARGET_SMART_TURN_SAMPLES,
      inputShape: [dims[0], dims[1], dims[2]],
    },
  });
}

async function handleDispose(request: SmartTurnDisposeRequest): Promise<void> {
  try {
    if (session && typeof session.release === "function") {
      await session.release();
    }
  } finally {
    session = null;
    featureExtractor = null;
    loadedModelUrl = null;
  }

  logger.info("Lifecycle", "Disposed smart-turn runtime");

  postResponse({
    type: "smart_turn/dispose_result",
    requestId: request.requestId,
    ok: true,
    result: { disposed: true },
  });
}

self.addEventListener("message", (event: MessageEvent<unknown>) => {
  const message = event.data as
    | SmartTurnLoadRequest
    | SmartTurnPredictRequest
    | SmartTurnDisposeRequest
    | undefined;

  if (
    !message ||
    typeof message.type !== "string" ||
    typeof message.requestId !== "string"
  ) {
    return;
  }

  const process = async () => {
    if (message.type === "smart_turn/load") {
      await handleLoad(message);
      return;
    }
    if (message.type === "smart_turn/predict") {
      await handlePredict(message);
      return;
    }
    if (message.type === "smart_turn/dispose") {
      await handleDispose(message);
    }
  };

  process().catch((error) => {
    const responseType: SmartTurnWorkerResponseType =
      message.type === "smart_turn/load"
        ? "smart_turn/load_result"
        : message.type === "smart_turn/predict"
          ? "smart_turn/predict_result"
          : "smart_turn/dispose_result";

    logger.error("Worker", "Smart-turn worker request failed", error);
    logger.warn("Worker", "Smart-turn worker request context", {
      requestId: message.requestId,
      type: message.type,
      error: toErrorMessage(error),
    });

    postResponse(
      buildErrorResponse({
        type: responseType,
        requestId: message.requestId,
        error,
      }),
    );
  });
});

export {};
