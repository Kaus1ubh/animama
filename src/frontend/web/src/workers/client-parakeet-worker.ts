/// <reference lib="webworker" />

import type { ParakeetModel } from "parakeet.js";
import { fromUrls } from "parakeet.js";

import { createLogger } from "@/lib/logger";
import type { ClientParakeetModelUrls } from "@/lib/speech/client-parakeet/worker-protocol";
import type {
  OfflineSttBackend,
  OfflineSttLoadRequest,
  OfflineSttLoadResult,
  OfflineSttTranscribeRequest,
  OfflineSttTranscribeResult,
} from "@/lib/speech/offline-stt/worker-protocol";

import {
  TARGET_SAMPLE_RATE,
  assertSampleRate,
  configureOrt,
  serveOfflineSttRequests,
  toErrorMessage,
  webgpuInitialized,
} from "./offline-stt-worker-runtime";

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

const LABEL = "Parakeet";
const logger = createLogger("ClientParakeetWorker");

let model: ParakeetModel | null = null;
let loadedModelUrls: ClientParakeetModelUrls | null = null;
let loadedSampleRateHz: number | null = null;
let loadedBackend: OfflineSttBackend | null = null;

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

async function unload(): Promise<void> {
  await releaseModel(model);
  model = null;
  loadedModelUrls = null;
  loadedSampleRateHz = null;
  loadedBackend = null;
}

async function load(
  request: OfflineSttLoadRequest<ClientParakeetModelUrls>,
): Promise<OfflineSttLoadResult<ClientParakeetModelUrls>> {
  const summary = {
    backend: request.backend,
    modelUrls: request.modelUrls,
    sampleRateHz: request.sampleRateHz,
  };
  if (
    model &&
    loadedBackend === request.backend &&
    loadedSampleRateHz === request.sampleRateHz &&
    sameModelUrls(loadedModelUrls, request.modelUrls)
  ) {
    return { ...summary, loadMs: 0, reused: true };
  }

  assertSampleRate(request.sampleRateHz, LABEL);
  logger.info("Load", "Loading client Parakeet runtime", summary);

  await unload();
  configureOrt(request.backend, LABEL);
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
    if (!webgpuInitialized()) {
      await unload();
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
  return { ...summary, loadMs, reused: false };
}

async function transcribe(
  request: OfflineSttTranscribeRequest,
): Promise<OfflineSttTranscribeResult> {
  assertSampleRate(request.sampleRateHz, LABEL);
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

  return {
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
  };
}

serveOfflineSttRequests<ClientParakeetModelUrls>({
  label: LABEL,
  load,
  transcribe,
  dispose: async () => {
    await unload();
    logger.info("Dispose", "Disposed client Parakeet runtime");
    return { disposed: true };
  },
});

export {};
