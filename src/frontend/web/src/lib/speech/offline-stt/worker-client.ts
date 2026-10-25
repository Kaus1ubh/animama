/**
 * The page side of an offline speech-to-text engine (Parakeet or SenseVoice):
 * one worker per engine, loaded with the installed sets the runtime
 * capabilities report, pinned with `?v=`, leased while loaded and disposed when
 * idle. WebGPU is tried only when the experimental setting is on and the probe
 * passes; a failed WebGPU load falls back to WASM for the rest of the page.
 */
import type { Client } from "@animama/runtime-contracts/sdk";
import { createLogger } from "@/lib/logger";
import { fetchRuntimeCapabilities } from "@/query/runtime-capabilities";
import {
  createModelAssetLeaseApi,
  holdModelAssetLease,
  type ModelAssetLease,
} from "./lease";
import {
  cacheWebgpuProbe,
  probeWebgpuModel,
  resolveSpeechBackend,
  withWebgpuModel,
  type SpeechBackendReason,
  type WebgpuModelStatus,
} from "./webgpu";
import type {
  OfflineSttBackend,
  OfflineSttDisposeRequest,
  OfflineSttDisposeResult,
  OfflineSttLoadRequest,
  OfflineSttLoadResult,
  OfflineSttModelUrls,
  OfflineSttTranscribeKind,
  OfflineSttTranscribeRequest,
  OfflineSttTranscribeResult,
  OfflineSttWorkerRequest,
  OfflineSttWorkerResponse,
} from "./worker-protocol";

type RuntimeCapabilities = Awaited<ReturnType<typeof fetchRuntimeCapabilities>>;

/** One engine's availability and installed set versions. */
type OfflineSttAvailability = {
  enabled: boolean;
  version?: string | null;
  gpuVersion?: string | null;
};

export type OfflineSttEngineConfig<Urls extends OfflineSttModelUrls> = {
  /** The engine's name in logs and worker errors, e.g. "Parakeet". */
  label: string;
  createWorker: () => Worker;
  availability: (capabilities: RuntimeCapabilities) => OfflineSttAvailability;
  /** The error a start shows when the engine is unavailable, worded for the user. */
  unavailableError: () => Error;
  /** Backend model-asset ids of the CPU set and the optional GPU set. */
  assetIds: { base: string; gpu: string };
  /** The CPU set's files by role, as same-origin paths. */
  modelPaths: Urls;
  /** The role the GPU set's file takes on WebGPU, and that file's path. */
  webgpuModel: { role: keyof Urls; path: string };
};

export type OfflineSttBackendState = {
  backend: OfflineSttBackend;
  reason: SpeechBackendReason;
  /** WebGPU was selected but failed to load, so WASM is in use. */
  fellBackFromWebgpu: boolean;
};

type LoadArgs<Urls extends OfflineSttModelUrls> = {
  /** The experimental WebGPU setting; WebGPU is used only when also available. */
  preferWebgpu?: boolean;
  sampleRateHz?: number;
  modelUrls?: Partial<Urls>;
};

export type TranscribeOfflineSttWindowArgs = {
  kind?: OfflineSttTranscribeKind;
  jobId: string;
  runId: string;
  turnId: string;
  windowId: string;
  audio: Float32Array;
  sampleRateHz?: number;
  /** The conversation language for a multilingual engine. */
  language?: string;
};

type PendingRequest<T> = {
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
  startedAtMs: number;
};

const DEFAULT_SAMPLE_RATE_HZ = 16000;
const IDLE_DISPOSE_MS = 300000;
/** How long a removal waits for this page's lease releases to land. */
export const LEASE_RELEASE_WAIT_MS = 2000;

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

export function createOfflineSttClient<Urls extends OfflineSttModelUrls>(
  engine: OfflineSttEngineConfig<Urls>,
) {
  const name = `client ${engine.label}`;
  const logger = createLogger(`Client${engine.label}WorkerClient`);

  let workerInstance: Worker | null = null;
  /** The ORT build the current worker initialized; switching needs a new worker. */
  let workerBackend: OfflineSttBackend | null = null;
  const webgpuStatus = cacheWebgpuProbe(() =>
    probeWebgpuModel({
      modelUrl: engine.webgpuModel.path,
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
   * Set when WebGPU passed the probe but failed to load; later starts go
   * straight to WASM instead of discarding a warm worker to retry. A status
   * refresh clears it.
   */
  let webgpuLoadFailed = false;
  let lastBackendState: OfflineSttBackendState | null = null;

  /**
   * Use leases on the installed sets the current worker loaded, keyed by asset
   * id. While held, the backend refuses to remove those sets.
   */
  const setLeases = new Map<string, Promise<ModelAssetLease>>();
  /** Releases still waiting for the backend; never rejects. */
  let pendingLeaseReleases: Promise<unknown> = Promise.resolve();

  let requestCounter = 0;
  const pending = new Map<string, PendingRequest<unknown>>();
  let idleDisposeTimer: ReturnType<typeof globalThis.setTimeout> | null = null;
  let idleDisposePromise: Promise<void> | null = null;

  /** Lease exactly `assetIds`, keeping existing leases and releasing others. */
  async function leaseLoadedSets(
    apiClient: Client | null,
    assetIds: readonly string[],
  ): Promise<void> {
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
        setLeases.set(
          assetId,
          holdModelAssetLease(assetId, {
            api: createModelAssetLeaseApi(apiClient!),
          }),
        );
    }
    await Promise.all(setLeases.values());
  }

  function releaseSetLeases(): void {
    void leaseLoadedSets(null, []);
  }

  function nextRequestId(prefix: string): string {
    requestCounter += 1;
    return `${prefix}-${Date.now().toString(36)}-${requestCounter.toString(36)}`;
  }

  function rejectPendingRequests(error: Error): void {
    const pendingCount = pending.size;
    for (const [requestId, entry] of pending.entries()) {
      pending.delete(requestId);
      entry.reject(error);
      logger.warn("Worker", `Rejected pending ${name} request`, {
        requestId,
        error: error.message,
      });
    }

    if (pendingCount > 0) {
      logger.warn("Worker", `Rejected pending ${name} requests`, {
        pendingCount,
        error: error.message,
      });
    }
  }

  /**
   * Forget the current `worker` synchronously: reject its requests, stop it and
   * release the sets it loaded. A worker that was already replaced is left alone.
   */
  function endWorker(worker: Worker, error: Error): boolean {
    if (workerInstance !== worker) return false;
    rejectPendingRequests(error);
    worker.terminate();
    workerInstance = null;
    workerBackend = null;
    releaseSetLeases();
    return true;
  }

  function terminateFailedWorker(
    worker: Worker,
    error: Error,
    reason: string,
  ): void {
    if (!endWorker(worker, error)) return;
    logger.warn("Worker", `Terminated failed ${name} worker`, {
      reason,
      error: error.message,
    });
  }

  function clearIdleDisposeTimer(reason: string): void {
    if (idleDisposeTimer === null) return;
    globalThis.clearTimeout(idleDisposeTimer);
    idleDisposeTimer = null;
    logger.info("Worker", `Cleared ${name} idle dispose timer`, { reason });
  }

  function getWorker(): Worker {
    if (workerInstance) return workerInstance;

    const worker = engine.createWorker();

    worker.addEventListener("message", (event: MessageEvent<unknown>) => {
      const data = event.data as OfflineSttWorkerResponse | undefined;
      if (!data || typeof data.requestId !== "string") {
        return;
      }

      const entry = pending.get(data.requestId);
      if (!entry) {
        logger.debug("Worker", `Ignored ${name} response for unknown request`, {
          requestId: data.requestId,
        });
        return;
      }

      pending.delete(data.requestId);
      const elapsedMs = Math.round(performance.now() - entry.startedAtMs);

      if (data.ok) {
        logger.info("Worker", `${engine.label} worker request completed`, {
          requestId: data.requestId,
          type: data.type,
          elapsedMs,
        });
        entry.resolve(data.result);
        return;
      }

      const error = new Error(
        data.error.message || `Client ${engine.label} worker request failed`,
      );
      if (data.error.stack) {
        error.stack = data.error.stack;
      }
      logger.warn("Worker", `${engine.label} worker request failed`, {
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
        `Client ${engine.label} worker runtime error`,
      );
      logger.error(
        "Worker",
        `Client ${engine.label} worker runtime error`,
        error,
      );
      terminateFailedWorker(worker, error, "runtime_error");
    });

    worker.addEventListener("messageerror", (event) => {
      const error = toWorkerRuntimeError(
        event,
        `Client ${engine.label} worker message could not be deserialized`,
      );
      logger.error(
        "Worker",
        `Client ${engine.label} worker message error`,
        error,
      );
      terminateFailedWorker(worker, error, "message_error");
    });

    workerInstance = worker;
    logger.info("Worker", `Created ${name} worker instance`);
    return worker;
  }

  function postRequest<T>(
    request: OfflineSttWorkerRequest<Urls>,
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

  function buildModelUrls(
    overrides: Partial<Urls> | undefined,
    assetVersion: string | null | undefined,
  ): Urls {
    const urls = { ...engine.modelPaths };
    for (const role of Object.keys(urls) as (keyof Urls)[])
      urls[role] = pinModelVersion(
        toAbsoluteBrowserUrl(overrides?.[role] ?? engine.modelPaths[role]),
        assetVersion,
      ) as Urls[keyof Urls];
    return urls;
  }

  /** The backend chosen by the most recent load in this page, if any. */
  function getLastBackendState(): OfflineSttBackendState | null {
    return lastBackendState;
  }

  /**
   * Probe WebGPU support and whether this build serves the GPU set. Cached per
   * page (a missing set is rechecked on each call); pass `refresh` after the
   * user changes the environment.
   */
  function getWebgpuStatus(options?: {
    refresh?: boolean;
  }): Promise<WebgpuModelStatus> {
    if (options?.refresh) webgpuLoadFailed = false;
    return webgpuStatus(options?.refresh);
  }

  async function cancelIdleDispose(reason: string): Promise<void> {
    clearIdleDisposeTimer(reason);
    const pendingDispose = idleDisposePromise;
    if (!pendingDispose) return;

    logger.info("Worker", `Waiting for ${name} idle dispose to finish`, {
      reason,
    });
    await pendingDispose;
  }

  /**
   * Dispose this page's worker now if no dictation session uses it (its idle
   * timer is armed), releasing its set leases so a set can be removed. Returns
   * `false` while a session still uses the worker.
   */
  async function disposeIdle(): Promise<boolean> {
    if (idleDisposePromise) {
      await idleDisposePromise;
    } else if (workerInstance) {
      if (idleDisposeTimer === null) return false;
      clearIdleDisposeTimer("model-removal");
      await dispose();
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

  function armIdleDispose(reason: string): void {
    clearIdleDisposeTimer(reason);
    idleDisposeTimer = globalThis.setTimeout(() => {
      idleDisposeTimer = null;

      if (idleDisposePromise) {
        logger.info(
          "Worker",
          "Skipped idle dispose because dispose is active",
          {
            reason,
          },
        );
        return;
      }

      const disposePromise = (async () => {
        logger.info("Worker", `Disposing idle ${name} worker`, {
          reason,
          idleMs: IDLE_DISPOSE_MS,
        });
        try {
          await dispose();
          logger.info("Worker", `Idle ${name} worker disposed`, { reason });
        } catch (error) {
          logger.warn("Worker", `Idle ${name} worker dispose failed`, {
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
    }, IDLE_DISPOSE_MS);

    logger.info("Worker", `Armed ${name} idle dispose timer`, {
      reason,
      delayMs: IDLE_DISPOSE_MS,
    });
  }

  async function load(
    apiClient: Client,
    {
      preferWebgpu = false,
      sampleRateHz = DEFAULT_SAMPLE_RATE_HZ,
      modelUrls,
    }: LoadArgs<Urls> = {},
  ): Promise<OfflineSttLoadResult<Urls>> {
    const availability = engine.availability(
      await fetchRuntimeCapabilities(apiClient),
    );
    // Dictation shows this message; worker and transport failures stay English.
    if (!availability.enabled) throw engine.unavailableError();
    await cancelIdleDispose("load");

    const plan: ReturnType<typeof resolveSpeechBackend> = !preferWebgpu
      ? { backend: "wasm", reason: "setting_off" }
      : webgpuLoadFailed
        ? { backend: "wasm", reason: "load_failed" }
        : resolveSpeechBackend({
            preferWebgpu,
            status: await getWebgpuStatus(),
          });

    const loadOn = async (
      backend: OfflineSttBackend,
      reason: SpeechBackendReason,
    ) => {
      if (
        workerInstance &&
        workerBackend !== null &&
        workerBackend !== backend
      ) {
        // ORT keeps the WASM build it first loaded, so switching needs a new worker.
        await dispose();
      }
      const resolvedModelUrls = withWebgpuModel(
        buildModelUrls(modelUrls, availability.version),
        engine.webgpuModel.role,
        backend,
        pinModelVersion(
          toAbsoluteBrowserUrl(engine.webgpuModel.path),
          availability.gpuVersion,
        ),
      );
      // Installed sets report a version; lease them before their files load.
      await leaseLoadedSets(apiClient, [
        ...(availability.version ? [engine.assetIds.base] : []),
        ...(backend === "webgpu" && availability.gpuVersion
          ? [engine.assetIds.gpu]
          : []),
      ]);
      const request: OfflineSttLoadRequest<Urls> = {
        type: "offline_stt/load",
        requestId: nextRequestId(`client-${engine.label}-load`),
        backend,
        sampleRateHz,
        modelUrls: resolvedModelUrls,
      };
      logger.info("Worker", `Dispatching ${name} load request`, {
        requestId: request.requestId,
        backend,
        backendReason: reason,
        sampleRateHz,
        modelUrls: resolvedModelUrls,
      });
      workerBackend = backend;
      return await postRequest<OfflineSttLoadResult<Urls>>(request);
    };

    let fellBackFromWebgpu = false;
    let result: OfflineSttLoadResult<Urls>;
    try {
      try {
        result = await loadOn(plan.backend, plan.reason);
      } catch (error) {
        if (plan.backend !== "webgpu") throw error;
        logger.warn(
          "Worker",
          `WebGPU ${engine.label} load failed; falling back to WASM`,
          { error: toErrorMessage(error) },
        );
        await dispose();
        webgpuLoadFailed = true;
        fellBackFromWebgpu = true;
        result = await loadOn("wasm", "load_failed");
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

  async function transcribe({
    kind = "final",
    jobId,
    runId,
    turnId,
    windowId,
    audio,
    sampleRateHz = DEFAULT_SAMPLE_RATE_HZ,
    language,
  }: TranscribeOfflineSttWindowArgs): Promise<OfflineSttTranscribeResult> {
    const requestId = nextRequestId(`client-${engine.label}-transcribe`);
    const audioCopy = new Float32Array(audio);
    const request: OfflineSttTranscribeRequest = {
      type: "offline_stt/transcribe",
      requestId,
      kind,
      jobId,
      runId,
      turnId,
      windowId,
      audio: audioCopy,
      sampleRateHz,
      ...(language ? { language } : {}),
    };

    const log = kind === "preview" ? logger.debug : logger.info;
    log("Worker", `Dispatching ${name} transcribe request`, {
      kind,
      requestId,
      jobId,
      runId,
      turnId,
      windowId,
      sampleRateHz,
      language,
      samples: audioCopy.length,
    });

    return await postRequest<OfflineSttTranscribeResult>(request, [
      audioCopy.buffer,
    ]);
  }

  async function dispose(): Promise<OfflineSttDisposeResult> {
    const worker = workerInstance;
    if (!worker) {
      return { disposed: true };
    }

    const request: OfflineSttDisposeRequest = {
      type: "offline_stt/dispose",
      requestId: nextRequestId(`client-${engine.label}-dispose`),
    };

    try {
      return await postRequest<OfflineSttDisposeResult>(request);
    } catch (error) {
      logger.warn(
        "Worker",
        `${name} dispose request failed; terminating worker`,
        {
          error: toErrorMessage(error),
        },
      );
      return { disposed: true };
    } finally {
      if (
        endWorker(worker, new Error(`Client ${engine.label} worker terminated`))
      )
        logger.info("Worker", `Terminated ${name} worker instance`);
    }
  }

  /**
   * Session teardown: stop this page's worker now instead of asking it to
   * dispose. A session end also terminates the browser worker, so a dispose
   * reply may never arrive; the next session must start a new worker rather
   * than wait on a dead one.
   */
  function terminate(): void {
    clearIdleDisposeTimer("session_end");
    if (workerInstance)
      endWorker(
        workerInstance,
        new Error(`Client ${engine.label} worker terminated`),
      );
    // Also releases sets leased by a load that has not started its worker.
    releaseSetLeases();
  }

  return {
    load,
    transcribe,
    dispose,
    terminate,
    armIdleDispose,
    cancelIdleDispose,
    disposeIdle,
    getLastBackendState,
    getWebgpuStatus,
  };
}

export type OfflineSttClient = ReturnType<typeof createOfflineSttClient>;
