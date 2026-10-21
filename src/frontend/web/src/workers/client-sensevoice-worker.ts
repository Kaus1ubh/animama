/// <reference lib="webworker" />

import { createLogger } from "@/lib/logger";
import {
  isSenseVoiceLanguage,
  loadSenseVoiceModel,
  type SenseVoiceModel,
  type SenseVoiceModelUrls,
} from "@/lib/speech/client-sensevoice/model";
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

const LABEL = "SenseVoice";
const logger = createLogger("ClientSenseVoiceWorker");

let model: SenseVoiceModel | null = null;
let loaded: { backend: OfflineSttBackend; urls: SenseVoiceModelUrls } | null =
  null;

async function unload(): Promise<void> {
  const active = model;
  model = null;
  loaded = null;
  try {
    await active?.release();
  } catch (error) {
    logger.warn("Dispose", "Failed to release the SenseVoice session", {
      error: toErrorMessage(error),
    });
  }
}

async function load(
  request: OfflineSttLoadRequest<SenseVoiceModelUrls>,
): Promise<OfflineSttLoadResult<SenseVoiceModelUrls>> {
  const summary = {
    backend: request.backend,
    modelUrls: request.modelUrls,
    sampleRateHz: request.sampleRateHz,
  };
  assertSampleRate(request.sampleRateHz, LABEL);
  const urls = request.modelUrls;
  if (
    model &&
    loaded?.backend === request.backend &&
    (Object.keys(urls) as (keyof SenseVoiceModelUrls)[]).every(
      (role) => loaded?.urls[role] === urls[role],
    )
  ) {
    return { ...summary, loadMs: 0, reused: true };
  }

  logger.info("Load", "Loading client SenseVoice runtime", summary);
  await unload();
  configureOrt(request.backend, LABEL);
  const startedAtMs = performance.now();
  model = await loadSenseVoiceModel(urls, request.backend);

  if (request.backend === "webgpu") {
    if (!webgpuInitialized()) {
      await unload();
      throw new Error(
        "WebGPU did not initialize in the SenseVoice worker; ONNX Runtime fell back to WASM.",
      );
    }
    // Compile the WebGPU shaders during load, not on the first preview.
    await model.transcribe(new Float32Array(TARGET_SAMPLE_RATE), "en");
  }

  loaded = { backend: request.backend, urls };
  const loadMs = Math.round(performance.now() - startedAtMs);
  logger.info("Load", "Client SenseVoice runtime ready", {
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
    throw new Error("Client SenseVoice received an empty speech window.");
  }
  const language = request.language ?? "";
  if (!isSenseVoiceLanguage(language)) {
    throw new Error(`Client SenseVoice has no language for "${language}".`);
  }
  if (!model) throw new Error("Client SenseVoice model has not been loaded.");

  const startedAtMs = performance.now();
  const text = await model.transcribe(request.audio, language, request.kind);
  const transcribeMs = Math.round(performance.now() - startedAtMs);

  // Previews repeat roughly every second while speaking; keep them out of info logs.
  const log = request.kind === "preview" ? logger.debug : logger.info;
  log("Transcribe", "Client SenseVoice speech window transcribed", {
    kind: request.kind,
    language,
    jobId: request.jobId,
    runId: request.runId,
    turnId: request.turnId,
    windowId: request.windowId,
    samples: request.audio.length,
    transcribeMs,
    textLength: text.length,
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
    metrics: null,
  };
}

serveOfflineSttRequests<SenseVoiceModelUrls>({
  label: LABEL,
  load,
  transcribe,
  dispose: async () => {
    await unload();
    logger.info("Dispose", "Disposed client SenseVoice runtime");
    return { disposed: true };
  },
});

export {};
