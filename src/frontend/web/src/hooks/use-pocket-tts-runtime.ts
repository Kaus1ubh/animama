"use client";

import type { Client } from "@animama/runtime-contracts/sdk";
import { useProductApiClient } from "@animama/product-ui";

import { useMemo, useSyncExternalStore } from "react";

import {
  INITIAL_ONNX_RUNTIME_DEBUG,
  INITIAL_WORKER_REGISTRY_DEBUG,
  getInitialCoreDebugState,
  mergeOrtRuntimeDebugList,
  parseOrtRuntimeDebug,
  parseWorkerRegistryDebug,
} from "@/hooks/pocket-tts-runtime-debug";
import { createLogger } from "@/lib/logger";
import {
  POCKET_TTS_DEFAULT_GAIN,
  mapNormalizedVolumeToPocketGain,
} from "@/lib/speech/pocket/audio/volume.js";
import { createPocketTTS } from "@/lib/speech/pocket/createPocketTTS";
import { pocketSpeechText } from "@/lib/speech/pocket-speech-text";
import { isPocketTtsSupported } from "@/lib/speech/tts-provider";

const logger = createLogger("PocketTTSRuntime");

export type PocketTtsPhase =
  | "idle"
  | "loading"
  | "ready"
  | "generating"
  | "stopped"
  | "error";

export type PocketTtsMetrics = {
  ttfbMs: number | null;
  rtfx: number | null;
  rtfEma: number;
  edgeOptimizationApplied: boolean;
  underruns: number;
  bufferLevelMs: number;
};
export type {
  PocketTtsDebugLatencySummary,
  PocketTtsOrtRuntimeDebug,
  PocketTtsOrtSessionDebug,
  PocketTtsWorkerDebugSnapshot,
  PocketTtsWorkerRegistryDebug,
} from "@/hooks/pocket-tts-runtime-debug";
import type {
  PocketTtsOrtRuntimeDebug,
  PocketTtsWorkerRegistryDebug,
} from "@/hooks/pocket-tts-runtime-debug";
import {
  setPocketPcmRun,
  tapPocketPlayer,
  type PocketPlayerLike,
} from "@/lib/speech/pocket-pcm-tap";

export type PocketTtsCoreEventName =
  | "state_changed"
  | "model_status"
  | "voices_loaded"
  | "voice_encoded"
  | "audio_chunk"
  | "generation_started"
  | "generation_finished"
  | "playback_started"
  | "playback_ended"
  | "error"
  | "debug_worker_status"
  | "ort_debug_status";

export type PocketTtsCoreEvent = {
  detail?: unknown;
};

export type PocketTtsCoreEventListener = (event: PocketTtsCoreEvent) => void;

type PocketTtsCoreLike = {
  init: () => Promise<void>;
  generate: (
    text: string,
    opts?: {
      voice?: string;
      animaId?: string;
      animaVoiceKey?: string;
      preservePlayback?: boolean;
      endStream?: boolean;
    },
  ) => Promise<{ generationId: string }>;
  stop: () => void;
  destroy?: () => Promise<void>;
  endPlaybackStream?: () => void;
  preloadAnimaVoices?: (animaRef: string) => Promise<{
    available?: boolean;
    voices?: string[];
    animaId?: string | null;
    catalogCacheKey?: string | null;
  }>;
  setVoice: (voiceName: string) => void;
  encodeVoiceFromFile: (
    file: File,
    options?: { signal?: AbortSignal },
  ) => Promise<{ voiceName: string }>;
  getVoices: () => string[];
  getAudioContext?: () => AudioContext | null;
  setVolume?: (volume: number) => void;
  getStatus: () => {
    phase?: string;
    generationId?: string | null;
    currentVoice?: string | null;
  };
  getMetrics: () => PocketTtsMetrics;
  getDebugStatus?: () => {
    workerRegistry?: PocketTtsWorkerRegistryDebug;
    onnxRuntimes?: PocketTtsOrtRuntimeDebug[];
  };
  addEventListener: (
    eventName: PocketTtsCoreEventName,
    handler: PocketTtsCoreEventListener,
  ) => void;
  removeEventListener: (
    eventName: PocketTtsCoreEventName,
    handler: PocketTtsCoreEventListener,
  ) => void;
};

type GeneratePocketTtsArgs = {
  voice?: string;
  animaId?: string;
  animaVoiceKey?: string;
  /** Presence requires this exact mounted catalog; no worker fallback is allowed. */
  assertAnimaCatalogActive?: () => void;
  signal?: AbortSignal;
  preservePlayback?: boolean;
  endStream?: boolean;
  /** The chat run the audio belongs to, so lip-sync can follow it. */
  runId?: string;
};

/**
 * The vendored worker's model setup stages, in order. Their status texts are
 * its only stage signal; other texts (such as the cloning encoder) are not steps.
 */
const POCKET_LOADING_STAGES = [
  "Loading ONNX Runtime...",
  "Loading models...",
  "Loading ONNX sessions...",
  "Loading tokenizer...",
  "Loading voices...",
] as const;

/** How many setup steps `loadingStep` counts up to. */
export const POCKET_LOADING_STEP_COUNT = POCKET_LOADING_STAGES.length;

type PocketTtsRuntimeState = {
  ready: boolean;
  phase: PocketTtsPhase;
  /** 1-based model setup step while the model loads; null otherwise. */
  loadingStep: number | null;
  voices: string[];
  currentVoice: string;
  hasCustomVoice: boolean;
  isEncodingVoice: boolean;
  voiceUploadStatus: string;
  metrics: PocketTtsMetrics;
  error: string | null;
  crossOriginIsolated: boolean;
  workerRegistryDebug: PocketTtsWorkerRegistryDebug;
  onnxRuntimeDebug: PocketTtsOrtRuntimeDebug[];
};

const INITIAL_METRICS: PocketTtsMetrics = {
  ttfbMs: null,
  rtfx: null,
  rtfEma: 0,
  edgeOptimizationApplied: false,
  underruns: 0,
  bufferLevelMs: 0,
};

function getCrossOriginIsolated(): boolean {
  if (typeof window === "undefined") return false;
  return window.crossOriginIsolated === true;
}

let runtimeState: PocketTtsRuntimeState = {
  ready: false,
  phase: "idle",
  loadingStep: null,
  voices: [],
  currentVoice: "",
  hasCustomVoice: false,
  isEncodingVoice: false,
  voiceUploadStatus: "",
  metrics: INITIAL_METRICS,
  error: null,
  crossOriginIsolated: getCrossOriginIsolated(),
  workerRegistryDebug: INITIAL_WORKER_REGISTRY_DEBUG,
  onnxRuntimeDebug: INITIAL_ONNX_RUNTIME_DEBUG,
};

const DISABLED_RUNTIME_STATE: PocketTtsRuntimeState = {
  ready: false,
  phase: "idle",
  loadingStep: null,
  voices: [],
  currentVoice: "",
  hasCustomVoice: false,
  isEncodingVoice: false,
  voiceUploadStatus: "",
  metrics: INITIAL_METRICS,
  error: null,
  crossOriginIsolated: getCrossOriginIsolated(),
  workerRegistryDebug: INITIAL_WORKER_REGISTRY_DEBUG,
  onnxRuntimeDebug: INITIAL_ONNX_RUNTIME_DEBUG,
};

const subscribers = new Set<() => void>();
let pocketCore: PocketTtsCoreLike | null = null;
let initPromise: Promise<void> | null = null;
let coreListenersAttached = false;
let pocketRuntimeGain = POCKET_TTS_DEFAULT_GAIN;

function subscribeDisabled(): () => void {
  return () => {};
}

function getDisabledSnapshot(): PocketTtsRuntimeState {
  return DISABLED_RUNTIME_STATE;
}

function subscribe(listener: () => void): () => void {
  subscribers.add(listener);
  return () => {
    subscribers.delete(listener);
  };
}

function getSnapshot(): PocketTtsRuntimeState {
  return runtimeState;
}

function notifySubscribers() {
  for (const listener of subscribers) {
    listener();
  }
}

function updateState(
  updater: (prev: PocketTtsRuntimeState) => PocketTtsRuntimeState,
) {
  runtimeState = updater(runtimeState);
  notifySubscribers();
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function normalizePhase(value: unknown): PocketTtsPhase {
  if (value === "loading") return "loading";
  if (value === "ready") return "ready";
  if (value === "generating") return "generating";
  if (value === "stopped") return "stopped";
  if (value === "error") return "error";
  return "idle";
}

function getOrCreateCore(apiClient: Client): PocketTtsCoreLike {
  if (!pocketCore) {
    pocketCore = createPocketTTS(apiClient) as PocketTtsCoreLike;
    pocketCore.setVolume?.(pocketRuntimeGain);
  }
  if (!coreListenersAttached) {
    attachCoreListeners(pocketCore);
    const coreDebugState = getInitialCoreDebugState(pocketCore);
    updateState((prev) => ({
      ...prev,
      ...coreDebugState,
    }));
    coreListenersAttached = true;
  }
  return pocketCore;
}

function attachCoreListeners(core: PocketTtsCoreLike) {
  core.addEventListener("state_changed", (event) => {
    if (core !== pocketCore) return;
    const detail = isRecord(event.detail) ? event.detail : {};
    const nextPhase = normalizePhase(detail.phase);
    const status = core.getStatus();
    updateState((prev) => ({
      ...prev,
      phase: nextPhase,
      ready: nextPhase === "ready" || nextPhase === "generating",
      currentVoice:
        typeof status.currentVoice === "string"
          ? status.currentVoice
          : prev.currentVoice,
      metrics: core.getMetrics(),
    }));
  });

  core.addEventListener("model_status", (event) => {
    if (core !== pocketCore) return;
    const detail = isRecord(event.detail) ? event.detail : {};
    const stage = POCKET_LOADING_STAGES.indexOf(
      detail.text as (typeof POCKET_LOADING_STAGES)[number],
    );
    if (detail.status === "loading" && stage < 0) return;
    updateState((prev) => ({
      ...prev,
      loadingStep: detail.status === "loading" ? stage + 1 : null,
    }));
  });

  core.addEventListener("voices_loaded", (event) => {
    if (core !== pocketCore) return;
    const detail = isRecord(event.detail) ? event.detail : {};
    const voices = Array.isArray(detail.voices)
      ? detail.voices.filter(
          (voice): voice is string => typeof voice === "string",
        )
      : [];
    const defaultVoice =
      typeof detail.defaultVoice === "string" ? detail.defaultVoice : "";

    updateState((prev) => ({
      ...prev,
      voices,
      currentVoice: defaultVoice || prev.currentVoice,
      error: null,
    }));
  });

  core.addEventListener("voice_encoded", (event) => {
    if (core !== pocketCore) return;
    const detail = isRecord(event.detail) ? event.detail : {};
    const voiceName =
      typeof detail.voiceName === "string" ? detail.voiceName : "custom";
    updateState((prev) => ({
      ...prev,
      hasCustomVoice: true,
      currentVoice: voiceName,
      voiceUploadStatus: "Custom voice encoded successfully.",
      error: null,
    }));
  });

  core.addEventListener("audio_chunk", () => {
    if (core !== pocketCore) return;
    updateState((prev) => ({
      ...prev,
      metrics: core.getMetrics(),
    }));
  });

  core.addEventListener("generation_finished", () => {
    if (core !== pocketCore) return;
    updateState((prev) => ({
      ...prev,
      metrics: core.getMetrics(),
    }));
  });

  core.addEventListener("debug_worker_status", (event) => {
    if (core !== pocketCore) return;
    const detail = parseWorkerRegistryDebug(event.detail);
    if (!detail) return;
    updateState((prev) => ({
      ...prev,
      workerRegistryDebug: detail,
    }));
  });

  core.addEventListener("ort_debug_status", (event) => {
    if (core !== pocketCore) return;
    const detail = parseOrtRuntimeDebug(event.detail);
    if (!detail) return;
    updateState((prev) => ({
      ...prev,
      onnxRuntimeDebug: mergeOrtRuntimeDebugList(prev.onnxRuntimeDebug, detail),
    }));
  });

  core.addEventListener("error", (event) => {
    if (core !== pocketCore) return;
    const detail = isRecord(event.detail) ? event.detail : {};
    const message =
      typeof detail.error === "string" ? detail.error : "PocketTTS error";

    updateState((prev) => ({
      ...prev,
      error: message,
      phase: "error",
      ready: false,
      isEncodingVoice: false,
    }));
  });
}

function createAbortError(): Error {
  const error = new Error("PocketTTS generation aborted.");
  error.name = "AbortError";
  return error;
}

function waitForGenerationToSettle(
  core: PocketTtsCoreLike,
  generationId: string,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let settled = false;

    const cleanup = () => {
      core.removeEventListener("state_changed", handleStateChanged);
      core.removeEventListener("error", handleError);
      signal?.removeEventListener("abort", handleAbort);
    };

    const finish = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    };

    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };

    const handleStateChanged = (event: PocketTtsCoreEvent) => {
      const detail = isRecord(event.detail) ? event.detail : {};
      const phase = normalizePhase(detail.phase);
      const eventGenerationId =
        typeof detail.generationId === "string" ? detail.generationId : null;
      if (phase === "generating") {
        return;
      }
      if (!eventGenerationId || eventGenerationId === generationId) {
        finish();
      }
    };

    const handleError = (event: PocketTtsCoreEvent) => {
      const detail = isRecord(event.detail) ? event.detail : {};
      const eventGenerationId =
        typeof detail.generationId === "string" ? detail.generationId : null;
      if (eventGenerationId && eventGenerationId !== generationId) {
        return;
      }
      const message =
        typeof detail.error === "string"
          ? detail.error
          : "PocketTTS generation failed.";
      fail(new Error(message));
    };

    const handleAbort = () => {
      try {
        core.stop();
      } catch {
        // noop
      }
      fail(createAbortError());
    };

    core.addEventListener("state_changed", handleStateChanged);
    core.addEventListener("error", handleError);

    if (signal) {
      if (signal.aborted) {
        handleAbort();
        return;
      }
      signal.addEventListener("abort", handleAbort, { once: true });
    }

    const status = core.getStatus();
    if (status.phase !== "generating" && status.generationId !== generationId) {
      finish();
    }
  });
}

export async function warmupPocketTtsRuntime(apiClient: Client): Promise<void> {
  if (!isPocketTtsSupported()) {
    const message = "PocketTTS is not supported in this browser.";
    updateState((prev) => ({
      ...prev,
      ready: false,
      phase: "error",
      error: message,
    }));
    throw new Error(message);
  }

  if (runtimeState.ready && runtimeState.phase !== "error") {
    return;
  }

  const core = getOrCreateCore(apiClient);
  if (initPromise) {
    return initPromise;
  }

  updateState((prev) => ({
    ...prev,
    phase: prev.phase === "generating" ? prev.phase : "loading",
    loadingStep: null,
    error: null,
  }));

  initPromise = core
    .init()
    .then(() => {
      if (pocketCore !== core) throw createAbortError();
      const status = core.getStatus();
      updateState((prev) => ({
        ...prev,
        ready: true,
        phase: normalizePhase(status.phase),
        loadingStep: null,
        voices: core.getVoices(),
        currentVoice:
          typeof status.currentVoice === "string"
            ? status.currentVoice
            : prev.currentVoice,
        metrics: core.getMetrics(),
        error: null,
      }));
    })
    .catch((error) => {
      if (pocketCore !== core) throw createAbortError();
      const message = toErrorMessage(error);
      logger.error("Warmup", "PocketTTS warmup failed", error);
      updateState((prev) => ({
        ...prev,
        ready: false,
        phase: "error",
        loadingStep: null,
        error: message,
      }));
      throw error;
    })
    .finally(() => {
      if (pocketCore === core) initPromise = null;
    });

  return initPromise;
}

export async function setPocketTtsVoice(
  apiClient: Client,
  voiceName: string,
): Promise<void> {
  if (!voiceName.trim()) return;
  await warmupPocketTtsRuntime(apiClient);
  const core = getOrCreateCore(apiClient);
  core.setVoice(voiceName);
  updateState((prev) => ({
    ...prev,
    currentVoice: voiceName,
    error: null,
  }));
}

export async function preloadPocketTtsAnimaVoices(
  apiClient: Client,
  animaRef: string,
): Promise<void> {
  const normalizedAnimaRef = animaRef.trim();
  if (!normalizedAnimaRef) return;

  await warmupPocketTtsRuntime(apiClient);
  const core = getOrCreateCore(apiClient);
  if (typeof core.preloadAnimaVoices !== "function") {
    return;
  }

  try {
    await core.preloadAnimaVoices(normalizedAnimaRef);
  } catch (error) {
    logger.warn("Preload", "Failed to preload Pocket anima voices", {
      animaRef: normalizedAnimaRef,
      error: toErrorMessage(error),
    });
    throw error;
  }
}

export async function encodePocketTtsVoiceFromFile(
  apiClient: Client,
  file: File,
  options?: { signal?: AbortSignal },
): Promise<{ voiceName: string }> {
  if (!file) {
    throw new Error("No voice file provided.");
  }

  options?.signal?.throwIfAborted();
  await warmupPocketTtsRuntime(apiClient);
  options?.signal?.throwIfAborted();
  const core = getOrCreateCore(apiClient);

  updateState((prev) => ({
    ...prev,
    isEncodingVoice: true,
    voiceUploadStatus: "Encoding voice sample...",
    error: null,
  }));

  try {
    const result = await core.encodeVoiceFromFile(file, options);
    updateState((prev) => ({
      ...prev,
      isEncodingVoice: false,
      hasCustomVoice: true,
      currentVoice: result.voiceName,
      voiceUploadStatus: "Custom voice encoded successfully.",
      error: null,
    }));
    return result;
  } catch (error) {
    const message = toErrorMessage(error);
    updateState((prev) => ({
      ...prev,
      isEncodingVoice: false,
      voiceUploadStatus: `Voice upload failed: ${message}`,
      error: message,
    }));
    throw error;
  }
}

export async function generatePocketTtsText(
  apiClient: Client,
  text: string,
  args?: GeneratePocketTtsArgs,
): Promise<void> {
  // Pocket reads digits and symbols poorly and cannot perform tags.
  const spoken = pocketSpeechText(text);
  if (!spoken) {
    // Playback drops such chunks before queueing; if one arrives anyway, still
    // end the stream it was meant to end.
    if (args?.endStream === true) endPocketTtsRuntimeStream();
    return;
  }

  args?.assertAnimaCatalogActive?.();
  await warmupPocketTtsRuntime(apiClient);
  const core = getOrCreateCore(apiClient);

  if (args?.assertAnimaCatalogActive) {
    args.assertAnimaCatalogActive();
    const catalog = args.animaId?.trim()
      ? await core.preloadAnimaVoices?.(args.animaId.trim())
      : null;
    args.assertAnimaCatalogActive();
    // The vendored worker otherwise falls back silently to its current voice.
    // Both supported legacy catalogs and named clones contain neutral.
    if (!catalog?.available || !catalog.voices?.includes("neutral")) {
      throw new Error(
        "The selected PocketTTS voice could not be loaded. Reload its content to retry.",
      );
    }
  }

  if (args?.voice?.trim()) {
    core.setVoice(args.voice.trim());
    updateState((prev) => ({
      ...prev,
      currentVoice: args.voice!.trim(),
    }));
  }

  if (args?.signal?.aborted) {
    throw createAbortError();
  }

  // Warm-up created the core's player; one recreated after a reset is tapped
  // here before its first run.
  tapPocketPlayer(
    (core as unknown as { player?: PocketPlayerLike | null }).player,
  );
  setPocketPcmRun(args?.runId ?? null);
  const { generationId } = await core.generate(spoken, {
    ...(args?.voice?.trim() ? { voice: args.voice.trim() } : {}),
    ...(args?.animaId?.trim() ? { animaId: args.animaId.trim() } : {}),
    ...(args?.animaVoiceKey?.trim()
      ? { animaVoiceKey: args.animaVoiceKey.trim() }
      : {}),
    ...(typeof args?.preservePlayback === "boolean"
      ? { preservePlayback: args.preservePlayback }
      : {}),
    ...(typeof args?.endStream === "boolean"
      ? { endStream: args.endStream }
      : {}),
  });

  await waitForGenerationToSettle(core, generationId, args?.signal);
}

export function stopPocketTtsRuntime() {
  if (!pocketCore) return;
  try {
    pocketCore.stop();
  } catch (error) {
    logger.warn("Stop", "Failed to stop PocketTTS runtime", {
      error: toErrorMessage(error),
    });
  }
}

export function endPocketTtsRuntimeStream() {
  if (!pocketCore) return;
  if (typeof pocketCore.endPlaybackStream !== "function") return;
  try {
    pocketCore.endPlaybackStream();
  } catch (error) {
    logger.warn("Stop", "Failed to notify PocketTTS stream end", {
      error: toErrorMessage(error),
    });
  }
}

export function getPocketTtsRuntimeAudioContext(): AudioContext | null {
  if (!pocketCore) return null;
  if (typeof pocketCore.getAudioContext !== "function") return null;
  try {
    return pocketCore.getAudioContext() ?? null;
  } catch (error) {
    logger.warn("Audio", "Failed to read PocketTTS audio context", {
      error: toErrorMessage(error),
    });
    return null;
  }
}

export function setPocketTtsRuntimeVolume(volume: number) {
  pocketRuntimeGain = mapNormalizedVolumeToPocketGain(volume);
  if (!pocketCore) return;
  try {
    pocketCore.setVolume?.(pocketRuntimeGain);
  } catch (error) {
    logger.warn("Audio", "Failed to update PocketTTS volume", {
      error: toErrorMessage(error),
      volume,
      gain: pocketRuntimeGain,
    });
  }
}

export function subscribePocketTtsCoreEvent(
  apiClient: Client,
  eventName: PocketTtsCoreEventName,
  handler: PocketTtsCoreEventListener,
): () => void {
  const core = getOrCreateCore(apiClient);
  core.addEventListener(eventName, handler);
  return () => {
    core.removeEventListener(eventName, handler);
  };
}

type UsePocketTtsRuntimeResult = PocketTtsRuntimeState & {
  warmup: () => Promise<void>;
  preloadAnimaVoices: (animaRef: string) => Promise<void>;
  setVoice: (voiceName: string) => Promise<void>;
  encodeVoiceFromFile: (
    file: File,
    options?: { signal?: AbortSignal },
  ) => Promise<{ voiceName: string }>;
  generateAndWait: (
    text: string,
    args?: GeneratePocketTtsArgs,
  ) => Promise<void>;
  stop: () => void;
  destroy?: () => Promise<void>;
  endStream: () => void;
  setVolume: (volume: number) => void;
  getAudioContext: () => AudioContext | null;
  onCoreEvent: (
    eventName: PocketTtsCoreEventName,
    handler: PocketTtsCoreEventListener,
  ) => () => void;
};

export function usePocketTtsRuntime(
  enabled: boolean = true,
): UsePocketTtsRuntimeResult {
  const apiClient = useProductApiClient();
  const state = useSyncExternalStore(
    enabled ? subscribe : subscribeDisabled,
    enabled ? getSnapshot : getDisabledSnapshot,
    enabled ? getSnapshot : getDisabledSnapshot,
  );

  const actions = useMemo(
    () => ({
      warmup: warmupPocketTtsRuntime.bind(null, apiClient),
      preloadAnimaVoices: preloadPocketTtsAnimaVoices.bind(null, apiClient),
      setVoice: setPocketTtsVoice.bind(null, apiClient),
      encodeVoiceFromFile: encodePocketTtsVoiceFromFile.bind(null, apiClient),
      generateAndWait: generatePocketTtsText.bind(null, apiClient),
      stop: stopPocketTtsRuntime,
      endStream: endPocketTtsRuntimeStream,
      setVolume: setPocketTtsRuntimeVolume,
      getAudioContext: getPocketTtsRuntimeAudioContext,
      onCoreEvent: subscribePocketTtsCoreEvent.bind(null, apiClient),
    }),
    [apiClient],
  );

  return {
    ...state,
    ...actions,
  };
}

/** End private voice catalogs and workers; downloaded public model bytes remain cached. */
export function disposePocketTtsRuntime(): void {
  const core = pocketCore;
  pocketCore = null;
  initPromise = null;
  coreListenersAttached = false;
  runtimeState = { ...DISABLED_RUNTIME_STATE };
  notifySubscribers();
  try {
    core?.stop();
  } finally {
    void core?.destroy?.().catch(() => {});
  }
}
