import { createLogger } from "@/lib/logger";
import { fetchRuntimeCapabilities } from "@/query/runtime-capabilities";
import {
  CLIENT_PARAKEET_MODEL_ASSET_PATHS,
  CLIENT_PARAKEET_WEBGPU_ENCODER_URL,
  PARAKEET_ASSET_ID,
  PARAKEET_WEBGPU_ASSET_ID,
} from "@/lib/speech/client-parakeet/assets";
import {
  holdModelAssetLease,
  type ModelAssetLease,
} from "@/lib/speech/client-parakeet/lease";
import {
  cacheParakeetWebgpuProbe,
  probeParakeetWebgpu,
  resolveParakeetBackend,
  withBackendEncoder,
  type ParakeetBackendReason,
  type ParakeetWebgpuStatus,
} from "@/lib/speech/client-parakeet/webgpu";
import type {
  ClientParakeetBackend,
  ClientParakeetDisposeRequest,
  ClientParakeetDisposeResult,
  ClientParakeetLoadRequest,
  ClientParakeetLoadResult,
  ClientParakeetModelUrls,
  ClientParakeetTranscribeKind,
  ClientParakeetTranscribeRequest,
  ClientParakeetTranscribeResult,
  ClientParakeetWorkerRequest,
  ClientParakeetWorkerResponse,
} from "@/lib/speech/client-parakeet/worker-protocol";

const logger = createLogger("ClientParakeetWorkerClient");

type PendingRequest<T> = {
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
  startedAtMs: number;
};

type LoadClientParakeetWorkerArgs = {
  /** The experimental WebGPU setting; WebGPU is used only when also available. */
  preferWebgpu?: boolean;
  sampleRateHz?: number;
  modelUrls?: Partial<ClientParakeetModelUrls>;
};

type TranscribeClientParakeetWindowArgs = {
  kind?: ClientParakeetTranscribeKind;
  jobId: string;
  runId: string;
  turnId: string;
  windowId: string;
  audio: Float32Array;
  sampleRateHz?: number;
};

const DEFAULT_SAMPLE_RATE_HZ = 16000;
const CLIENT_PARAKEET_IDLE_DISPOSE_MS = 300000;

let workerInstance: Worker | null = null;
/** The ORT build the current worker initialized; switching needs a new worker. */
let workerBackend: ClientParakeetBackend | null = null;
const webgpuStatus = cacheParakeetWebgpuProbe(() =>
  probeParakeetWebgpu({
    encoderUrl: CLIENT_PARAKEET_WEBGPU_ENCODER_URL,
    gpu:
      typeof navigator === "undefined"
        ? undefined
        : (
            navigator as Navigator & {
              gpu?: { requestAdapter: () => Promise<unknown> };
            }
          ).gpu,
    fetch: (url, init) => globalThis.fetch(url, init),
  }),
);
/**
 * Set when WebGPU passed the probe but failed to load; later starts go straight
 * to WASM instead of discarding a warm worker to retry. A status refresh clears it.
 */
let webgpuLoadFailed = false;

export type ClientParakeetBackendState = {
  backend: ClientParakeetBackend;
  reason: ParakeetBackendReason;
  /** WebGPU was selected but failed to load, so WASM is in use. */
  fellBackFromWebgpu: boolean;
};

let lastBackendState: ClientParakeetBackendState | null = null;

/**
 * Use leases on the installed sets the current worker loaded, keyed by asset
 * id. While held, the backend refuses to remove those sets.
 */
const setLeases = new Map<string, Promise<ModelAssetLease>>();
/** Releases still waiting for the backend; never rejects. */
let pendingLeaseReleases: Promise<unknown> = Promise.resolve();
/** How long a removal waits for this page's lease releases to land. */
export const LEASE_RELEASE_WAIT_MS = 2000;

/** Lease exactly `assetIds`, keeping existing leases and releasing others. */
async function leaseLoadedSets(assetIds: readonly string[]): Promise<void> {
  const releases: Promise<void>[] = [];
  for (const [assetId, lease] of setLeases) {
    if (assetIds.includes(assetId)) continue;
    setLeases.delete(assetId);
    releases.push(lease.then((held) => held.release()));
  }
  if (releases.length)
    pendingLeaseReleases = Promise.all([pendingLeaseReleases, ...releases]);
  for (const assetId of assetIds) {
    if (!setLeases.has(assetId))
      setLeases.set(assetId, holdModelAssetLease(assetId));
  }
  await Promise.all(setLeases.values());
}

function releaseSetLeases(): void {
  void leaseLoadedSets([]);
}

/** The backend chosen by the most recent load in this page, if any. */
export function getLastClientParakeetBackendState(): ClientParakeetBackendState | null {
  return lastBackendState;
}

/**
 * Probe WebGPU support and whether this build serves the optional encoder.
 * Cached per page (a missing encoder is rechecked on each call); pass
 * `refresh` after the user changes the environment.
 */
export function getParakeetWebgpuStatus(options?: {
  refresh?: boolean;
}): Promise<ParakeetWebgpuStatus> {
  if (options?.refresh) webgpuLoadFailed = false;
  return webgpuStatus(options?.refresh);
}
let requestCounter = 0;
const pending = new Map<string, PendingRequest<unknown>>();
let idleDisposeTimer: ReturnType<typeof globalThis.setTimeout> | null = null;
let idleDisposePromise: Promise<void> | null = null;

function nextRequestId(prefix: string): string {
  requestCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${requestCounter.toString(36)}`;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function toWorkerRuntimeError(
  event: ErrorEvent | MessageEvent<unknown>,
  fallbackMessage: string,
): Error {
  if ("error" in event && event.error instanceof Error) {
    return event.error;
  }
  if (
    "message" in event &&
    typeof event.message === "string" &&
    event.message
  ) {
    return new Error(event.message);
  }
  return new Error(fallbackMessage);
}

function rejectPendingRequests(error: Error): void {
  const pendingCount = pending.size;
  for (const [requestId, entry] of pending.entries()) {
    pending.delete(requestId);
    entry.reject(error);
    logger.warn("Worker", "Rejected pending client Parakeet request", {
      requestId,
      error: error.message,
    });
  }

  if (pendingCount > 0) {
    logger.warn("Worker", "Rejected pending client Parakeet requests", {
      pendingCount,
      error: error.message,
    });
  }
}

function terminateFailedWorker(
  worker: Worker,
  error: Error,
  reason: string,
): void {
  rejectPendingRequests(error);
  if (workerInstance === worker) {
    worker.terminate();
    workerInstance = null;
    workerBackend = null;
    releaseSetLeases();
    logger.warn("Worker", "Terminated failed client Parakeet worker", {
      reason,
      error: error.message,
    });
  }
}

function clearClientParakeetIdleDisposeTimer(reason: string): void {
  if (idleDisposeTimer === null) return;
  globalThis.clearTimeout(idleDisposeTimer);
  idleDisposeTimer = null;
  logger.info("Worker", "Cleared client Parakeet idle dispose timer", {
    reason,
  });
}

export async function cancelClientParakeetIdleDispose(
  reason: string,
): Promise<void> {
  clearClientParakeetIdleDisposeTimer(reason);
  const pendingDispose = idleDisposePromise;
  if (!pendingDispose) return;

  logger.info("Worker", "Waiting for client Parakeet idle dispose to finish", {
    reason,
  });
  await pendingDispose;
}

/**
 * Dispose this page's worker now if no dictation session uses it (its idle
 * timer is armed), releasing its set leases so a set can be removed. Returns
 * `false` while a session still uses the worker.
 */
export async function disposeIdleClientParakeetWorker(): Promise<boolean> {
  if (idleDisposePromise) {
    await idleDisposePromise;
  } else if (workerInstance) {
    if (idleDisposeTimer === null) return false;
    clearClientParakeetIdleDisposeTimer("model-removal");
    await disposeClientParakeetWorker();
  }
  // Let the backend see the releases before a removal request, but never
  // hold the removal hostage to a slow or unreachable backend.
  let timer: ReturnType<typeof globalThis.setTimeout> | undefined;
  await Promise.race([
    pendingLeaseReleases,
    new Promise((resolve) => {
      timer = globalThis.setTimeout(resolve, LEASE_RELEASE_WAIT_MS);
    }),
  ]);
  globalThis.clearTimeout(timer);
  return true;
}

export function armClientParakeetIdleDispose(reason: string): void {
  clearClientParakeetIdleDisposeTimer(reason);
  idleDisposeTimer = globalThis.setTimeout(() => {
    idleDisposeTimer = null;

    if (idleDisposePromise) {
      logger.info("Worker", "Skipped idle dispose because dispose is active", {
        reason,
      });
      return;
    }

    const disposePromise = (async () => {
      logger.info("Worker", "Disposing idle client Parakeet worker", {
        reason,
        idleMs: CLIENT_PARAKEET_IDLE_DISPOSE_MS,
      });
      try {
        await disposeClientParakeetWorker();
        logger.info("Worker", "Idle client Parakeet worker disposed", {
          reason,
        });
      } catch (error) {
        logger.warn("Worker", "Idle client Parakeet worker dispose failed", {
          reason,
          error: toErrorMessage(error),
        });
      }
    })();

    idleDisposePromise = disposePromise;
    void disposePromise.finally(() => {
      if (idleDisposePromise === disposePromise) {
        idleDisposePromise = null;
      }
    });
  }, CLIENT_PARAKEET_IDLE_DISPOSE_MS);

  logger.info("Worker", "Armed client Parakeet idle dispose timer", {
    reason,
    delayMs: CLIENT_PARAKEET_IDLE_DISPOSE_MS,
  });
}

function toAbsoluteBrowserUrl(path: string): string {
  if (/^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(path)) {
    return path;
  }
  if (typeof window === "undefined") {
    return path;
  }
  try {
    return new URL(path, window.location.origin).toString();
  } catch {
    return path;
  }
}

/**
 * Version the browser/model cache with the set's manifest digest, without
 * exposing store paths or download URLs. Sets are always same-origin.
 */
function pinModelVersion(url: string, assetVersion?: string | null): string {
  if (!assetVersion || typeof window === "undefined") return url;
  const pinned = new URL(url);
  if (pinned.origin !== window.location.origin)
    throw new Error("Speech models must be same-origin.");
  pinned.searchParams.set("v", assetVersion);
  return pinned.toString();
}

function buildModelUrls(
  overrides?: Partial<ClientParakeetModelUrls>,
  assetVersion?: string | null,
): ClientParakeetModelUrls {
  const urls = {
    encoderUrl: toAbsoluteBrowserUrl(
      overrides?.encoderUrl ?? CLIENT_PARAKEET_MODEL_ASSET_PATHS.encoder,
    ),
    decoderUrl: toAbsoluteBrowserUrl(
      overrides?.decoderUrl ?? CLIENT_PARAKEET_MODEL_ASSET_PATHS.decoder,
    ),
    tokenizerUrl: toAbsoluteBrowserUrl(
      overrides?.tokenizerUrl ?? CLIENT_PARAKEET_MODEL_ASSET_PATHS.tokenizer,
    ),
    preprocessorUrl: toAbsoluteBrowserUrl(
      overrides?.preprocessorUrl ??
        CLIENT_PARAKEET_MODEL_ASSET_PATHS.preprocessor,
    ),
  };
  for (const key of Object.keys(urls) as (keyof ClientParakeetModelUrls)[])
    urls[key] = pinModelVersion(urls[key], assetVersion);
  return urls;
}

function getWorker(): Worker {
  if (workerInstance) return workerInstance;

  const worker = new Worker(
    new URL("../../../workers/client-parakeet-worker.ts", import.meta.url),
    {
      type: "module",
      name: "client-parakeet-worker",
    },
  );

  worker.addEventListener("message", (event: MessageEvent<unknown>) => {
    const data = event.data as ClientParakeetWorkerResponse | undefined;
    if (!data || typeof data.requestId !== "string") {
      return;
    }

    const entry = pending.get(data.requestId);
    if (!entry) {
      logger.debug(
        "Worker",
        "Ignored client Parakeet response for unknown request",
        {
          requestId: data.requestId,
        },
      );
      return;
    }

    pending.delete(data.requestId);
    const elapsedMs = Math.round(performance.now() - entry.startedAtMs);

    if (data.ok) {
      logger.info("Worker", "Client Parakeet worker request completed", {
        requestId: data.requestId,
        type: data.type,
        elapsedMs,
      });
      entry.resolve(data.result);
      return;
    }

    const error = new Error(
      data.error.message || "Client Parakeet worker request failed",
    );
    if (data.error.stack) {
      error.stack = data.error.stack;
    }
    logger.warn("Worker", "Client Parakeet worker request failed", {
      requestId: data.requestId,
      type: data.type,
      elapsedMs,
      error: error.message,
    });
    entry.reject(error);
  });

  worker.addEventListener("error", (event) => {
    const error = toWorkerRuntimeError(
      event,
      "Client Parakeet worker runtime error",
    );
    logger.error("Worker", "Client Parakeet worker runtime error", error);
    terminateFailedWorker(worker, error, "runtime_error");
  });

  worker.addEventListener("messageerror", (event) => {
    const error = toWorkerRuntimeError(
      event,
      "Client Parakeet worker message could not be deserialized",
    );
    logger.error("Worker", "Client Parakeet worker message error", error);
    terminateFailedWorker(worker, error, "message_error");
  });

  workerInstance = worker;
  logger.info("Worker", "Created client Parakeet worker instance");
  return worker;
}

function postRequest<T>(
  request: ClientParakeetWorkerRequest,
  transfer?: Transferable[],
): Promise<T> {
  const worker = getWorker();

  return new Promise<T>((resolve, reject) => {
    pending.set(request.requestId, {
      resolve: resolve as (value: unknown) => void,
      reject,
      startedAtMs: performance.now(),
    });

    try {
      if (transfer && transfer.length > 0) {
        worker.postMessage(request, transfer);
      } else {
        worker.postMessage(request);
      }
    } catch (error) {
      pending.delete(request.requestId);
      reject(error);
    }
  });
}

export async function loadClientParakeetWorker({
  preferWebgpu = false,
  sampleRateHz = DEFAULT_SAMPLE_RATE_HZ,
  modelUrls,
}: LoadClientParakeetWorkerArgs = {}): Promise<ClientParakeetLoadResult> {
  const capabilities = await fetchRuntimeCapabilities();
  if (!capabilities.offline_speech_enabled) {
    throw new Error(
      "Install offline speech recognition in Settings to use dictation and Voice Mode.",
    );
  }
  await cancelClientParakeetIdleDispose("load");

  const plan: ReturnType<typeof resolveParakeetBackend> = !preferWebgpu
    ? { backend: "wasm", reason: "setting_off" }
    : webgpuLoadFailed
      ? { backend: "wasm", reason: "load_failed" }
      : resolveParakeetBackend({
          preferWebgpu,
          status: await getParakeetWebgpuStatus(),
        });

  const load = async (
    backend: ClientParakeetBackend,
    reason: ParakeetBackendReason,
  ) => {
    if (workerInstance && workerBackend !== null && workerBackend !== backend) {
      // ORT keeps the WASM build it first loaded, so switching needs a new worker.
      await disposeClientParakeetWorker();
    }
    const resolvedModelUrls = withBackendEncoder(
      buildModelUrls(modelUrls, capabilities.offline_speech_asset_version),
      backend,
      pinModelVersion(
        toAbsoluteBrowserUrl(CLIENT_PARAKEET_WEBGPU_ENCODER_URL),
        capabilities.offline_speech_gpu_asset_version,
      ),
    );
    // Installed sets report a version; lease them before their files load.
    await leaseLoadedSets([
      ...(capabilities.offline_speech_asset_version ? [PARAKEET_ASSET_ID] : []),
      ...(backend === "webgpu" && capabilities.offline_speech_gpu_asset_version
        ? [PARAKEET_WEBGPU_ASSET_ID]
        : []),
    ]);
    const request: ClientParakeetLoadRequest = {
      type: "client_parakeet/load",
      requestId: nextRequestId("client-parakeet-load"),
      backend,
      sampleRateHz,
      modelUrls: resolvedModelUrls,
    };
    logger.info("Worker", "Dispatching client Parakeet load request", {
      requestId: request.requestId,
      backend,
      backendReason: reason,
      sampleRateHz,
      modelUrls: resolvedModelUrls,
    });
    workerBackend = backend;
    return await postRequest<ClientParakeetLoadResult>(request);
  };

  let fellBackFromWebgpu = false;
  let result: ClientParakeetLoadResult;
  try {
    try {
      result = await load(plan.backend, plan.reason);
    } catch (error) {
      if (plan.backend !== "webgpu") throw error;
      logger.warn(
        "Worker",
        "WebGPU Parakeet load failed; falling back to WASM",
        { error: toErrorMessage(error) },
      );
      await disposeClientParakeetWorker();
      webgpuLoadFailed = true;
      fellBackFromWebgpu = true;
      result = await load("wasm", "load_failed");
    }
  } catch (error) {
    // A failed load holds no models, so it must not block their removal.
    releaseSetLeases();
    throw error;
  }
  lastBackendState = {
    backend: result.backend,
    reason: fellBackFromWebgpu ? "load_failed" : plan.reason,
    fellBackFromWebgpu: fellBackFromWebgpu || plan.reason === "load_failed",
  };
  return result;
}

export async function transcribeClientParakeetWindow({
  kind = "final",
  jobId,
  runId,
  turnId,
  windowId,
  audio,
  sampleRateHz = DEFAULT_SAMPLE_RATE_HZ,
}: TranscribeClientParakeetWindowArgs): Promise<ClientParakeetTranscribeResult> {
  const requestId = nextRequestId("client-parakeet-transcribe");
  const audioCopy = new Float32Array(audio);
  const request: ClientParakeetTranscribeRequest = {
    type: "client_parakeet/transcribe",
    requestId,
    kind,
    jobId,
    runId,
    turnId,
    windowId,
    audio: audioCopy,
    sampleRateHz,
  };

  const log = kind === "preview" ? logger.debug : logger.info;
  log("Worker", "Dispatching client Parakeet transcribe request", {
    kind,
    requestId,
    jobId,
    runId,
    turnId,
    windowId,
    sampleRateHz,
    samples: audioCopy.length,
  });

  return await postRequest<ClientParakeetTranscribeResult>(request, [
    audioCopy.buffer,
  ]);
}

export async function disposeClientParakeetWorker(): Promise<ClientParakeetDisposeResult> {
  if (!workerInstance) {
    return { disposed: true };
  }

  const request: ClientParakeetDisposeRequest = {
    type: "client_parakeet/dispose",
    requestId: nextRequestId("client-parakeet-dispose"),
  };

  try {
    return await postRequest<ClientParakeetDisposeResult>(request);
  } catch (error) {
    logger.warn(
      "Worker",
      "Client Parakeet dispose request failed; terminating worker",
      {
        error: toErrorMessage(error),
      },
    );
    return { disposed: true };
  } finally {
    for (const [requestId, entry] of pending.entries()) {
      pending.delete(requestId);
      entry.reject(new Error("Client Parakeet worker terminated"));
    }

    if (workerInstance) {
      workerInstance.terminate();
      workerInstance = null;
      workerBackend = null;
      logger.info("Worker", "Terminated client Parakeet worker instance");
    }
    releaseSetLeases();
  }
}
