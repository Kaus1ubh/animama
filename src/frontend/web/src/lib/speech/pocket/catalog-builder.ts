"use client";

import type { Client } from "@animama/runtime-contracts/sdk";
import { publicResourceUrl } from "@/lib/resource-urls";

import {
  DEFAULT_POCKET_VOICE,
  POCKET_VOICES,
} from "@/lib/speech/pocket/voice-catalog";
import { createLogger } from "@/lib/logger";
import { isPocketTtsSupported } from "@/lib/speech/tts-provider";
import {
  ensurePocketVoiceCloningEncoder,
  POCKET_VOICE_ENCODER_CONTENT_URL,
  type PocketVoiceEncoderOptions,
} from "./voice-cloning-encoder";

const logger = createLogger("PocketVoiceCatalogBuilder");
const DEFAULT_SAMPLE_RATE = 24000;
const DEFAULT_MAX_VOICE_SECONDS = 10;
const VOICE_NAME_BYTES = 32;

type PocketCatalogWorkerSuccessMessage =
  | {
      type: "ready";
      requestId?: string;
    }
  | {
      type: "voice_encoded";
      requestId?: string;
      voiceName?: string;
      embedding?: Float32Array | number[] | ArrayBuffer;
      embeddingShape?: number[];
    };

type PocketCatalogWorkerErrorMessage = {
  type: "error";
  requestId?: string;
  error?: string;
};

type PocketCatalogWorkerMessage =
  | PocketCatalogWorkerSuccessMessage
  | PocketCatalogWorkerErrorMessage
  | {
      type: string;
      requestId?: string;
      error?: string;
      [key: string]: unknown;
    };

type PocketCatalogWorkerPendingRequest = {
  resolve: (message: PocketCatalogWorkerSuccessMessage) => void;
  reject: (error: Error) => void;
};

export type PocketVoiceCatalogSource = {
  voiceName: string;
  file: File;
};

type PocketVoiceCatalogEmbedding = {
  voiceName: string;
  embedding: Float32Array;
  shape: [number, number, number];
};

type EncodeVoiceResponse = {
  voiceName: string;
  embedding: Float32Array;
  embeddingShape: [number, number, number];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isPocketCatalogWorkerSuccessMessage(
  message: PocketCatalogWorkerMessage,
): message is PocketCatalogWorkerSuccessMessage {
  return message.type === "ready" || message.type === "voice_encoded";
}

function toFloat32Array(value: unknown): Float32Array | null {
  if (value instanceof Float32Array) {
    return value;
  }
  if (value instanceof ArrayBuffer) {
    return new Float32Array(value.slice(0));
  }
  if (ArrayBuffer.isView(value)) {
    const view = value as ArrayBufferView<ArrayBufferLike>;
    return new Float32Array(
      view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength),
    );
  }
  if (Array.isArray(value) && value.every((item) => typeof item === "number")) {
    return new Float32Array(value);
  }
  return null;
}

function readVoiceEncodedEmbedding(
  response: Extract<
    PocketCatalogWorkerSuccessMessage,
    { type: "voice_encoded" }
  >,
): Float32Array | null {
  const nestedData = isRecord((response as { data?: unknown }).data)
    ? (response as { data?: Record<string, unknown> }).data
    : null;
  return toFloat32Array(response.embedding ?? nestedData?.embedding);
}

function readVoiceEncodedEmbeddingShape(
  response: Extract<
    PocketCatalogWorkerSuccessMessage,
    { type: "voice_encoded" }
  >,
): [number, number, number] | null {
  const nestedData = isRecord((response as { data?: unknown }).data)
    ? (response as { data?: Record<string, unknown> }).data
    : null;
  const candidate = response.embeddingShape ?? nestedData?.embeddingShape;
  if (!Array.isArray(candidate) || candidate.length !== 3) {
    return null;
  }

  const normalized = candidate.map((value) => Number(value));
  if (normalized.some((value) => !Number.isFinite(value) || value <= 0)) {
    return null;
  }
  return normalized as [number, number, number];
}

function readVoiceEncodedVoiceName(
  response: Extract<
    PocketCatalogWorkerSuccessMessage,
    { type: "voice_encoded" }
  >,
): string {
  const nestedData = isRecord((response as { data?: unknown }).data)
    ? (response as { data?: Record<string, unknown> }).data
    : null;
  const voiceName = response.voiceName ?? nestedData?.voiceName;
  return typeof voiceName === "string" && voiceName.trim().length > 0
    ? voiceName
    : "custom";
}

function getAudioContextCtor(): typeof AudioContext | null {
  if (typeof window === "undefined") return null;
  const runtimeWindow = window as Window &
    typeof globalThis & {
      AudioContext?: typeof AudioContext;
      webkitAudioContext?: typeof AudioContext;
    };
  return runtimeWindow.AudioContext ?? runtimeWindow.webkitAudioContext ?? null;
}

async function decodeAudioFileToMonoFloat32(
  file: File,
  options: {
    targetSampleRate: number;
    maxVoiceSeconds: number;
  },
): Promise<Float32Array> {
  const { targetSampleRate, maxVoiceSeconds } = options;
  const AudioContextCtor = getAudioContextCtor();
  if (!AudioContextCtor) {
    throw new Error("Web Audio API is not supported in this browser.");
  }

  const audioContext = new AudioContextCtor({
    sampleRate: targetSampleRate,
    latencyHint: "interactive",
  });

  try {
    const arrayBuffer = await file.arrayBuffer();
    const audioBuffer = await audioContext.decodeAudioData(
      arrayBuffer.slice(0),
    );
    const monoData = audioBufferToMono(audioBuffer);
    const resampled =
      audioBuffer.sampleRate === targetSampleRate
        ? monoData
        : resampleMonoAudio(monoData, audioBuffer.sampleRate, targetSampleRate);
    const maxSamples = targetSampleRate * maxVoiceSeconds;
    if (resampled.length <= maxSamples) {
      return resampled;
    }
    return resampled.slice(0, maxSamples);
  } finally {
    try {
      await audioContext.close();
    } catch {
      // noop
    }
  }
}

function audioBufferToMono(audioBuffer: AudioBuffer): Float32Array {
  const left = audioBuffer.getChannelData(0);
  if (audioBuffer.numberOfChannels <= 1) {
    return new Float32Array(left);
  }

  const right = audioBuffer.getChannelData(1);
  const monoData = new Float32Array(left.length);
  for (let index = 0; index < left.length; index += 1) {
    monoData[index] = (left[index]! + right[index]!) * 0.5;
  }
  return monoData;
}

function resampleMonoAudio(
  monoData: Float32Array,
  sourceRate: number,
  targetRate: number,
): Float32Array {
  const ratio = sourceRate / targetRate;
  const outputLength = Math.floor(monoData.length / ratio);
  const output = new Float32Array(outputLength);

  for (let index = 0; index < outputLength; index += 1) {
    const sourceIndex = index * ratio;
    const sourceFloor = Math.floor(sourceIndex);
    const sourceCeil = Math.min(sourceFloor + 1, monoData.length - 1);
    const t = sourceIndex - sourceFloor;
    output[index] =
      monoData[sourceFloor]! * (1 - t) + monoData[sourceCeil]! * t;
  }

  return output;
}

function toCatalogFileName(animaName?: string | null): string {
  const trimmed = (animaName ?? "").trim().toLowerCase();
  const slug = trimmed
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return `${slug || "anima"}-voices.bin`;
}

function encodeVoiceName(name: string): Uint8Array {
  const bytes = new TextEncoder().encode(name);
  if (bytes.length >= VOICE_NAME_BYTES) {
    throw new Error(`Voice key "${name}" is too long for the Pocket catalog.`);
  }

  const output = new Uint8Array(VOICE_NAME_BYTES);
  output.set(bytes);
  return output;
}

function serializePocketVoiceCatalog(
  embeddings: PocketVoiceCatalogEmbedding[],
): ArrayBuffer {
  let totalBytes = 4;
  for (const entry of embeddings) {
    totalBytes += VOICE_NAME_BYTES + 8 + entry.embedding.byteLength;
  }

  const buffer = new ArrayBuffer(totalBytes);
  const view = new DataView(buffer);
  let offset = 0;

  view.setUint32(offset, embeddings.length, true);
  offset += 4;

  for (const entry of embeddings) {
    const nameBytes = encodeVoiceName(entry.voiceName);
    new Uint8Array(buffer, offset, VOICE_NAME_BYTES).set(nameBytes);
    offset += VOICE_NAME_BYTES;

    const numFrames = entry.shape[1];
    const embeddingDim = entry.shape[2];
    view.setUint32(offset, numFrames, true);
    offset += 4;
    view.setUint32(offset, embeddingDim, true);
    offset += 4;

    new Float32Array(buffer, offset, entry.embedding.length).set(
      entry.embedding,
    );
    offset += entry.embedding.byteLength;
  }

  return buffer;
}

class PocketCatalogWorkerClient {
  private worker: Worker;
  private terminated = false;
  private pendingRequests = new Map<
    string,
    PocketCatalogWorkerPendingRequest
  >();
  private requestSequence = 0;

  constructor(worker: Worker) {
    this.worker = worker;
    this.worker.onmessage = (
      event: MessageEvent<PocketCatalogWorkerMessage>,
    ) => {
      this.handleWorkerMessage(event.data);
    };
    this.worker.onerror = (event) => {
      const error = new Error(event.message || "Pocket catalog worker failed.");
      for (const pending of this.pendingRequests.values()) {
        pending.reject(error);
      }
      this.pendingRequests.clear();
    };
  }

  async init(): Promise<void> {
    // The worker requires the built-in voice list, even though encoding uses none.
    await this.send("load", {
      voices: POCKET_VOICES.filter((voice) => voice.delivery === "core").map(
        (voice) => voice.id,
      ),
      defaultVoice: DEFAULT_POCKET_VOICE,
      models: { mimi_encoder: POCKET_VOICE_ENCODER_CONTENT_URL },
    });
  }

  async encodeVoice(audio: Float32Array): Promise<EncodeVoiceResponse> {
    const transferred = new Float32Array(audio);
    const response = await this.send("encode_voice", { audio: transferred }, [
      transferred.buffer,
    ]);
    if (response.type !== "voice_encoded") {
      throw new Error("Pocket catalog worker returned an unexpected response.");
    }

    const embedding = readVoiceEncodedEmbedding(response);
    if (!embedding) {
      logger.warn("Catalog", "Pocket catalog worker returned no embedding", {
        responseKeys: Object.keys(response),
      });
      throw new Error("Pocket catalog worker did not return an embedding.");
    }

    const embeddingShape = readVoiceEncodedEmbeddingShape(response);
    if (!embeddingShape) {
      logger.warn(
        "Catalog",
        "Pocket catalog worker returned an invalid embedding shape",
        {
          responseKeys: Object.keys(response),
        },
      );
      throw new Error(
        "Pocket catalog worker returned an invalid embedding shape.",
      );
    }

    return {
      voiceName: readVoiceEncodedVoiceName(response),
      embedding,
      embeddingShape,
    };
  }

  terminate(): void {
    if (this.terminated) return;
    this.terminated = true;
    this.worker.terminate();
    for (const pending of this.pendingRequests.values()) {
      pending.reject(new Error("Pocket catalog worker was terminated."));
    }
    this.pendingRequests.clear();
  }

  private send(
    type: string,
    data: Record<string, unknown>,
    transfer: Transferable[] = [],
  ): Promise<PocketCatalogWorkerSuccessMessage> {
    if (this.terminated)
      return Promise.reject(new Error("Pocket catalog worker was terminated."));
    const requestId = `req-${++this.requestSequence}`;
    return new Promise((resolve, reject) => {
      this.pendingRequests.set(requestId, { resolve, reject });
      this.worker.postMessage({ type, requestId, data }, transfer);
    });
  }

  private handleWorkerMessage(message: PocketCatalogWorkerMessage): void {
    const requestId =
      typeof message.requestId === "string" ? message.requestId : null;
    if (!requestId) return;

    const pending = this.pendingRequests.get(requestId);
    if (!pending) return;

    if (message.type === "error") {
      this.pendingRequests.delete(requestId);
      pending.reject(
        new Error(message.error || "Pocket catalog worker request failed."),
      );
      return;
    }

    if (isPocketCatalogWorkerSuccessMessage(message)) {
      this.pendingRequests.delete(requestId);
      pending.resolve(message);
    }
  }
}

function createPocketCatalogWorkerClient(): PocketCatalogWorkerClient {
  const workerUrl = new URL(
    publicResourceUrl("tts/workers/inference-worker.js"),
    window.location.origin,
  );
  const worker = new Worker(workerUrl, {
    type: "module",
    name: `pocket-catalog-builder-${Math.random().toString(36).slice(2, 8)}`,
  });
  return new PocketCatalogWorkerClient(worker);
}

export async function buildPocketVoiceCatalogFile(
  apiClient: Client,
  args: {
    animaName?: string | null;
    sources: PocketVoiceCatalogSource[];
    encoder?: PocketVoiceEncoderOptions;
  },
): Promise<File> {
  if (!isPocketTtsSupported()) {
    throw new Error(
      "PocketTTS voice catalog generation is not supported in this browser.",
    );
  }

  const sources = args.sources.filter(
    (source) => source.voiceName.trim().length > 0,
  );
  if (sources.length === 0) {
    throw new Error("No Pocket voice catalog sources were provided.");
  }

  const neutralSource = sources.find(
    (source) => source.voiceName === "neutral",
  );
  if (!neutralSource) {
    throw new Error("Pocket voice catalogs must include a neutral voice.");
  }

  await ensurePocketVoiceCloningEncoder(apiClient, args.encoder);
  const signal = args.encoder?.signal;
  signal?.throwIfAborted();
  const workerClient = createPocketCatalogWorkerClient();
  const abort = () => workerClient.terminate();
  signal?.addEventListener("abort", abort, { once: true });
  try {
    await workerClient.init();
    signal?.throwIfAborted();
    const embeddings: PocketVoiceCatalogEmbedding[] = [];

    for (const source of sources) {
      const audio = await decodeAudioFileToMonoFloat32(source.file, {
        targetSampleRate: DEFAULT_SAMPLE_RATE,
        maxVoiceSeconds: DEFAULT_MAX_VOICE_SECONDS,
      });
      signal?.throwIfAborted();
      const encoded = await workerClient.encodeVoice(audio);
      signal?.throwIfAborted();
      embeddings.push({
        voiceName: source.voiceName,
        embedding: encoded.embedding,
        shape: encoded.embeddingShape,
      });
      logger.info("Catalog", "Encoded Pocket catalog voice", {
        voiceName: source.voiceName,
        frames: encoded.embeddingShape[1],
        embeddingDim: encoded.embeddingShape[2],
      });
    }

    const payload = serializePocketVoiceCatalog(embeddings);
    return new File([payload], toCatalogFileName(args.animaName), {
      type: "application/octet-stream",
    });
  } catch (error) {
    // Terminating an in-flight worker rejects its requests; keep cancellation
    // distinct from an encoding failure for callers that have closed the view.
    signal?.throwIfAborted();
    throw error;
  } finally {
    signal?.removeEventListener("abort", abort);
    workerClient.terminate();
  }
}
