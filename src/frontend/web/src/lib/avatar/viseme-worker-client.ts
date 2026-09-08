import { createLogger } from "@/lib/logger";
import type {
  VisemeWorkerBuildRequest,
  VisemeWorkerBuildResult,
  VisemeWorkerResponse,
} from "./viseme-worker-protocol";

const logger = createLogger("VisemeWorkerClient");

type PendingRequest = {
  resolve: (result: VisemeWorkerBuildResult) => void;
  reject: (error: unknown) => void;
  startedAtMs: number;
};

let workerInstance: Worker | null = null;
let requestCounter = 0;
const pending = new Map<string, PendingRequest>();

function getWorker(): Worker {
  if (workerInstance) return workerInstance;
  const worker = new Worker(
    new URL("../../workers/viseme-worker.ts", import.meta.url),
    {
      type: "module",
      name: "viseme-worker",
    },
  );

  worker.addEventListener("message", (event: MessageEvent<unknown>) => {
    const data = event.data as VisemeWorkerResponse | undefined;
    if (
      !data ||
      data.type !== "build_viseme_assets_from_raw_result" ||
      typeof data.requestId !== "string"
    ) {
      return;
    }
    const entry = pending.get(data.requestId);
    if (!entry) {
      logger.debug(
        "Worker",
        "Ignored response for unknown viseme worker request",
        {
          requestId: data.requestId,
        },
      );
      return;
    }
    pending.delete(data.requestId);
    const elapsedMs = Math.round(performance.now() - entry.startedAtMs);
    if (data.ok) {
      logger.info("Worker", "Viseme worker request completed", {
        requestId: data.requestId,
        elapsedMs,
        workerElapsedMs: data.result.workerElapsedMs,
        mode: data.result.buildMode,
        frameCount: data.result.segment.frameCount,
        durationMs: data.result.segment.durationMs,
      });
      entry.resolve(data.result);
      return;
    }
    const error = new Error(
      data.error?.message || "Viseme worker request failed",
    );
    if (data.error?.stack) {
      error.stack = data.error.stack;
    }
    logger.warn("Worker", "Viseme worker request failed", {
      requestId: data.requestId,
      elapsedMs,
      error: error.message,
    });
    entry.reject(error);
  });

  worker.addEventListener("error", (event) => {
    logger.error("Worker", "Viseme worker error", event);
  });

  workerInstance = worker;
  logger.info("Worker", "Created viseme worker instance");
  return worker;
}

function nextRequestId(): string {
  requestCounter += 1;
  return `viseme-${Date.now().toString(36)}-${requestCounter.toString(36)}`;
}

export async function buildVisemeAssetsFromRaw(
  args: Omit<VisemeWorkerBuildRequest, "type" | "requestId">,
): Promise<VisemeWorkerBuildResult> {
  const worker = getWorker();
  const requestId = nextRequestId();
  const request: VisemeWorkerBuildRequest = {
    type: "build_viseme_assets_from_raw",
    requestId,
    ...args,
  };

  logger.info("Worker", "Dispatching viseme worker request", {
    requestId,
    runId: args.runId,
    mode: args.mode,
    hasPhonemizedText: Array.isArray(args.phonemizedText),
    phonemizedWordCount: Array.isArray(args.phonemizedText)
      ? args.phonemizedText.length
      : 0,
    hasTokenizedText: Boolean(args.tokenizedText?.trim()),
    targetDurationSec: args.targetDurationSec ?? null,
    hasAnchor: Boolean(args.anchor),
  });

  return new Promise<VisemeWorkerBuildResult>((resolve, reject) => {
    pending.set(requestId, {
      resolve,
      reject,
      startedAtMs: performance.now(),
    });
    try {
      worker.postMessage(request);
    } catch (error) {
      pending.delete(requestId);
      reject(error);
    }
  });
}

export function terminateVisemeWorker(): void {
  if (!workerInstance) return;
  for (const [requestId, entry] of pending.entries()) {
    pending.delete(requestId);
    entry.reject(new Error("Viseme worker terminated"));
  }
  workerInstance.terminate();
  workerInstance = null;
  logger.info("Worker", "Terminated viseme worker instance");
}
