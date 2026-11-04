import { isNonNullObject } from "@/lib/records";

export type PocketTtsDebugLatencySummary = {
  count: number;
  lastMs: number | null;
  avgMs: number | null;
  p95Ms: number | null;
  maxMs: number | null;
};

export type PocketTtsWorkerDebugSnapshot = {
  workerId: string;
  name: string;
  kind: string;
  status: string;
  createdAtMs: number | null;
  updatedAtMs: number | null;
  threadId: string | null;
  messagesSent: number;
  messagesReceived: number;
  pendingRequestCount: number;
  inflightRequestCount: number;
  currentTaskType: string | null;
  currentTaskGenerationId: string | null;
  currentTaskElapsedMs: number | null;
  lastMessageType: string | null;
  lastRequestType: string | null;
  lastError: string | null;
  requestLatency: PocketTtsDebugLatencySummary;
  generateStartLatency: PocketTtsDebugLatencySummary;
};

export type PocketTtsWorkerRegistryDebug = {
  totalWorkers: number;
  activeWorkers: number;
  workers: PocketTtsWorkerDebugSnapshot[];
  updatedAtMs: number | null;
};

export type PocketTtsOrtSessionDebug = {
  name: string;
  status: string;
  modelUrl: string | null;
  updatedAtMs: number | null;
  lastError: string | null;
};

export type PocketTtsOrtRuntimeDebug = {
  runtimeId: string;
  runtimeName: string;
  provider: string | null;
  version: string | null;
  wasm: {
    crossOriginIsolated: boolean | null;
    simd: boolean | null;
    numThreads: number | null;
    wasmPaths: string | null;
  };
  graphOptimizationLevel: string | null;
  state: string;
  stage: string | null;
  lastError: string | null;
  updatedAtMs: number | null;
  sessions: PocketTtsOrtSessionDebug[];
};

export type PocketTtsCoreDebugStatusReader = {
  getDebugStatus?: () => {
    workerRegistry?: PocketTtsWorkerRegistryDebug;
    onnxRuntimes?: PocketTtsOrtRuntimeDebug[];
  };
};

const INITIAL_WORKER_REGISTRY_DEBUG_VALUE: PocketTtsWorkerRegistryDebug = {
  totalWorkers: 0,
  activeWorkers: 0,
  workers: [],
  updatedAtMs: null,
};

export const INITIAL_WORKER_REGISTRY_DEBUG: PocketTtsWorkerRegistryDebug =
  INITIAL_WORKER_REGISTRY_DEBUG_VALUE;

export function createInitialOrtRuntimeDebug(
  runtimeId = "pocket-tts",
  runtimeName = "Pocket TTS",
): PocketTtsOrtRuntimeDebug {
  return {
    runtimeId,
    runtimeName,
    provider: null,
    version: null,
    wasm: {
      crossOriginIsolated: null,
      simd: null,
      numThreads: null,
      wasmPaths: null,
    },
    graphOptimizationLevel: null,
    state: "idle",
    stage: null,
    lastError: null,
    updatedAtMs: null,
    sessions: [],
  };
}

const INITIAL_ONNX_RUNTIME_DEBUG_VALUE: PocketTtsOrtRuntimeDebug[] = [
  createInitialOrtRuntimeDebug(),
];

export const INITIAL_ONNX_RUNTIME_DEBUG: PocketTtsOrtRuntimeDebug[] =
  INITIAL_ONNX_RUNTIME_DEBUG_VALUE;

function toFiniteNumberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function toNullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function toNullableBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function parseLatencySummary(value: unknown): PocketTtsDebugLatencySummary {
  const input = isNonNullObject(value) ? value : {};
  return {
    count:
      typeof input.count === "number" && Number.isFinite(input.count)
        ? Math.max(0, Math.floor(input.count))
        : 0,
    lastMs: toFiniteNumberOrNull(input.lastMs),
    avgMs: toFiniteNumberOrNull(input.avgMs),
    p95Ms: toFiniteNumberOrNull(input.p95Ms),
    maxMs: toFiniteNumberOrNull(input.maxMs),
  };
}

function parseWorkerDebugSnapshot(
  value: unknown,
): PocketTtsWorkerDebugSnapshot | null {
  if (!isNonNullObject(value)) return null;
  const workerId = toNullableString(value.workerId);
  const name = toNullableString(value.name);
  const kind = toNullableString(value.kind);
  if (!workerId || !name || !kind) return null;

  return {
    workerId,
    name,
    kind,
    status: typeof value.status === "string" ? value.status : "unknown",
    createdAtMs: toFiniteNumberOrNull(value.createdAtMs),
    updatedAtMs: toFiniteNumberOrNull(value.updatedAtMs),
    threadId: toNullableString(value.threadId),
    messagesSent:
      typeof value.messagesSent === "number" &&
      Number.isFinite(value.messagesSent)
        ? Math.max(0, Math.floor(value.messagesSent))
        : 0,
    messagesReceived:
      typeof value.messagesReceived === "number" &&
      Number.isFinite(value.messagesReceived)
        ? Math.max(0, Math.floor(value.messagesReceived))
        : 0,
    pendingRequestCount:
      typeof value.pendingRequestCount === "number" &&
      Number.isFinite(value.pendingRequestCount)
        ? Math.max(0, Math.floor(value.pendingRequestCount))
        : 0,
    inflightRequestCount:
      typeof value.inflightRequestCount === "number" &&
      Number.isFinite(value.inflightRequestCount)
        ? Math.max(0, Math.floor(value.inflightRequestCount))
        : 0,
    currentTaskType: toNullableString(value.currentTaskType),
    currentTaskGenerationId: toNullableString(value.currentTaskGenerationId),
    currentTaskElapsedMs: toFiniteNumberOrNull(value.currentTaskElapsedMs),
    lastMessageType: toNullableString(value.lastMessageType),
    lastRequestType: toNullableString(value.lastRequestType),
    lastError: toNullableString(value.lastError),
    requestLatency: parseLatencySummary(value.requestLatency),
    generateStartLatency: parseLatencySummary(value.generateStartLatency),
  };
}

export function parseWorkerRegistryDebug(
  value: unknown,
): PocketTtsWorkerRegistryDebug | null {
  if (!isNonNullObject(value)) return null;

  const workers = Array.isArray(value.workers)
    ? value.workers
        .map((worker) => parseWorkerDebugSnapshot(worker))
        .filter(
          (worker): worker is PocketTtsWorkerDebugSnapshot => worker !== null,
        )
    : [];

  return {
    totalWorkers:
      typeof value.totalWorkers === "number" &&
      Number.isFinite(value.totalWorkers)
        ? Math.max(0, Math.floor(value.totalWorkers))
        : workers.length,
    activeWorkers:
      typeof value.activeWorkers === "number" &&
      Number.isFinite(value.activeWorkers)
        ? Math.max(0, Math.floor(value.activeWorkers))
        : workers.length,
    workers,
    updatedAtMs: toFiniteNumberOrNull(value.updatedAtMs),
  };
}

function parseOrtSessionDebug(value: unknown): PocketTtsOrtSessionDebug | null {
  if (!isNonNullObject(value)) return null;
  const name = toNullableString(value.name);
  if (!name) return null;
  return {
    name,
    status: typeof value.status === "string" ? value.status : "unknown",
    modelUrl: toNullableString(value.modelUrl),
    updatedAtMs: toFiniteNumberOrNull(value.updatedAtMs),
    lastError: toNullableString(value.lastError),
  };
}

export function parseOrtRuntimeDebug(
  value: unknown,
): PocketTtsOrtRuntimeDebug | null {
  if (!isNonNullObject(value)) return null;
  const runtimeId = toNullableString(value.runtimeId);
  const runtimeName = toNullableString(value.runtimeName);
  if (!runtimeId || !runtimeName) return null;

  const wasm = isNonNullObject(value.wasm) ? value.wasm : {};
  const sessions = Array.isArray(value.sessions)
    ? value.sessions
        .map((session) => parseOrtSessionDebug(session))
        .filter(
          (session): session is PocketTtsOrtSessionDebug => session !== null,
        )
    : [];

  return {
    runtimeId,
    runtimeName,
    provider: toNullableString(value.provider),
    version: toNullableString(value.version),
    wasm: {
      crossOriginIsolated: toNullableBoolean(wasm.crossOriginIsolated),
      simd: toNullableBoolean(wasm.simd),
      numThreads: toFiniteNumberOrNull(wasm.numThreads),
      wasmPaths: toNullableString(wasm.wasmPaths),
    },
    graphOptimizationLevel: toNullableString(value.graphOptimizationLevel),
    state: typeof value.state === "string" ? value.state : "unknown",
    stage: toNullableString(value.stage),
    lastError: toNullableString(value.lastError),
    updatedAtMs: toFiniteNumberOrNull(value.updatedAtMs),
    sessions,
  };
}

export function mergeOrtRuntimeDebugList(
  prev: PocketTtsOrtRuntimeDebug[],
  nextRuntime: PocketTtsOrtRuntimeDebug,
): PocketTtsOrtRuntimeDebug[] {
  const nextByName = new Map(
    nextRuntime.sessions.map((session) => [session.name, session]),
  );
  const prevMatch =
    prev.find((item) => item.runtimeId === nextRuntime.runtimeId) ?? null;
  const mergedSessions = prevMatch
    ? [
        ...prevMatch.sessions
          .filter((session) => !nextByName.has(session.name))
          .map((session) => ({ ...session })),
        ...nextRuntime.sessions.map((session) => ({ ...session })),
      ]
    : nextRuntime.sessions.map((session) => ({ ...session }));

  const mergedRuntime: PocketTtsOrtRuntimeDebug = {
    ...(prevMatch ??
      createInitialOrtRuntimeDebug(
        nextRuntime.runtimeId,
        nextRuntime.runtimeName,
      )),
    ...nextRuntime,
    wasm: {
      ...(prevMatch?.wasm ?? createInitialOrtRuntimeDebug().wasm),
      ...nextRuntime.wasm,
    },
    sessions: mergedSessions,
  };

  const withoutMatch = prev.filter(
    (item) => item.runtimeId !== nextRuntime.runtimeId,
  );
  return [...withoutMatch, mergedRuntime];
}

export function getInitialCoreDebugState(
  core: PocketTtsCoreDebugStatusReader,
): {
  workerRegistryDebug: PocketTtsWorkerRegistryDebug;
  onnxRuntimeDebug: PocketTtsOrtRuntimeDebug[];
} {
  if (typeof core.getDebugStatus !== "function") {
    return {
      workerRegistryDebug: INITIAL_WORKER_REGISTRY_DEBUG,
      onnxRuntimeDebug: INITIAL_ONNX_RUNTIME_DEBUG,
    };
  }
  try {
    const status = core.getDebugStatus() ?? {};
    const workerRegistryDebug =
      parseWorkerRegistryDebug(status.workerRegistry) ??
      INITIAL_WORKER_REGISTRY_DEBUG;
    const onnxRuntimeDebug = Array.isArray(status.onnxRuntimes)
      ? status.onnxRuntimes
          .map((runtime) => parseOrtRuntimeDebug(runtime))
          .filter(
            (runtime): runtime is PocketTtsOrtRuntimeDebug => runtime !== null,
          )
      : [];
    return {
      workerRegistryDebug,
      onnxRuntimeDebug:
        onnxRuntimeDebug.length > 0
          ? onnxRuntimeDebug
          : INITIAL_ONNX_RUNTIME_DEBUG,
    };
  } catch {
    return {
      workerRegistryDebug: INITIAL_WORKER_REGISTRY_DEBUG,
      onnxRuntimeDebug: INITIAL_ONNX_RUNTIME_DEBUG,
    };
  }
}
