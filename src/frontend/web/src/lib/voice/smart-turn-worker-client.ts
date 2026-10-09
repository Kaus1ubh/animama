import { createLogger } from "@/lib/logger";
import type {
  SmartTurnDisposeRequest,
  SmartTurnDisposeResult,
  SmartTurnLoadRequest,
  SmartTurnLoadResult,
  SmartTurnPredictRequest,
  SmartTurnPredictResult,
  SmartTurnWorkerRequest,
  SmartTurnWorkerResponse,
} from "@/lib/voice/smart-turn-worker-protocol";

const logger = createLogger("SmartTurnWorkerClient");

type PendingRequest<T> = {
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
  startedAtMs: number;
};

let workerInstance: Worker | null = null;
let requestCounter = 0;
const pending = new Map<string, PendingRequest<unknown>>();

function nextRequestId(prefix: string): string {
  requestCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${requestCounter.toString(36)}`;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
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

function ensureTrailingSlash(path: string): string {
  return path.endsWith("/") ? path : `${path}/`;
}

function getWorker(): Worker {
  if (workerInstance) return workerInstance;

  const worker = new Worker(
    new URL("../../workers/smart-turn-worker.ts", import.meta.url),
    {
      type: "module",
      name: "smart-turn-worker",
    },
  );

  worker.addEventListener("message", (event: MessageEvent<unknown>) => {
    const data = event.data as SmartTurnWorkerResponse | undefined;
    if (!data || typeof data.requestId !== "string") {
      return;
    }

    const entry = pending.get(data.requestId);
    if (!entry) {
      logger.debug(
        "Worker",
        "Ignored smart-turn response for unknown request",
        {
          requestId: data.requestId,
        },
      );
      return;
    }

    pending.delete(data.requestId);
    const elapsedMs = Math.round(performance.now() - entry.startedAtMs);

    if (data.ok) {
      logger.info("Worker", "Smart-turn worker request completed", {
        requestId: data.requestId,
        type: data.type,
        elapsedMs,
      });
      entry.resolve(data.result);
      return;
    }

    const error = new Error(
      data.error.message || "Smart-turn worker request failed",
    );
    if (data.error.stack) {
      error.stack = data.error.stack;
    }
    logger.warn("Worker", "Smart-turn worker request failed", {
      requestId: data.requestId,
      type: data.type,
      elapsedMs,
      error: error.message,
    });
    entry.reject(error);
  });

  worker.addEventListener("error", (event) => {
    logger.error("Worker", "Smart-turn worker runtime error", event);
  });

  workerInstance = worker;
  logger.info("Worker", "Created smart-turn worker instance");
  return worker;
}

function postRequest<T>(
  request: SmartTurnWorkerRequest,
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

export async function loadSmartTurnWorker(args: {
  modelUrl: string;
  ortWasmBaseUrl: string;
}): Promise<SmartTurnLoadResult> {
  const resolvedModelUrl = toAbsoluteBrowserUrl(args.modelUrl);
  const resolvedOrtWasmBaseUrl = ensureTrailingSlash(
    toAbsoluteBrowserUrl(args.ortWasmBaseUrl),
  );

  const request: SmartTurnLoadRequest = {
    type: "smart_turn/load",
    requestId: nextRequestId("smart-turn-load"),
    modelUrl: resolvedModelUrl,
    ortWasmBaseUrl: resolvedOrtWasmBaseUrl,
  };

  logger.info("Worker", "Dispatching smart-turn load request", {
    requestId: request.requestId,
    modelUrl: resolvedModelUrl,
    ortWasmBaseUrl: resolvedOrtWasmBaseUrl,
  });

  return await postRequest<SmartTurnLoadResult>(request);
}

export async function predictSmartTurn(args: {
  jobId: string;
  turnId: string;
  audio: Float32Array;
  sampleRateHz: number;
  threshold: number;
}): Promise<SmartTurnPredictResult> {
  const requestId = nextRequestId("smart-turn-predict");
  const audioCopy = new Float32Array(args.audio);

  const request: SmartTurnPredictRequest = {
    type: "smart_turn/predict",
    requestId,
    jobId: args.jobId,
    turnId: args.turnId,
    audio: audioCopy,
    sampleRateHz: args.sampleRateHz,
    threshold: args.threshold,
  };

  logger.info("Worker", "Dispatching smart-turn predict request", {
    requestId,
    jobId: args.jobId,
    turnId: args.turnId,
    samples: audioCopy.length,
    threshold: args.threshold,
  });

  return await postRequest<SmartTurnPredictResult>(request, [audioCopy.buffer]);
}

/**
 * Forget the current `worker` synchronously: reject its requests and stop it.
 * A worker that was already replaced is left alone.
 */
function endWorker(worker: Worker): boolean {
  if (workerInstance !== worker) return false;
  for (const [requestId, entry] of pending.entries()) {
    pending.delete(requestId);
    entry.reject(new Error("Smart-turn worker terminated"));
  }
  worker.terminate();
  workerInstance = null;
  return true;
}

export async function disposeSmartTurnWorker(): Promise<SmartTurnDisposeResult> {
  const worker = workerInstance;
  if (!worker) {
    return { disposed: true };
  }

  const request: SmartTurnDisposeRequest = {
    type: "smart_turn/dispose",
    requestId: nextRequestId("smart-turn-dispose"),
  };

  try {
    const result = await postRequest<SmartTurnDisposeResult>(request);
    return result;
  } catch (error) {
    logger.warn(
      "Worker",
      "Smart-turn dispose request failed; terminating worker",
      {
        error: toErrorMessage(error),
      },
    );
    return { disposed: true };
  } finally {
    if (endWorker(worker))
      logger.info("Worker", "Terminated smart-turn worker instance");
  }
}

/**
 * Session teardown: stop this page's worker now instead of asking it to
 * dispose. A session end also terminates the browser worker, so a dispose
 * reply may never arrive; the next session must start a new worker rather
 * than wait on a dead one.
 */
export function terminateSmartTurnWorker(): void {
  if (workerInstance) endWorker(workerInstance);
}
