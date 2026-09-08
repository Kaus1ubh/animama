export function nowPerfMs() {
  if (
    typeof performance !== "undefined" &&
    typeof performance.now === "function"
  ) {
    return performance.now();
  }
  return Date.now();
}

export function createLatencySummary(samples) {
  if (!Array.isArray(samples) || samples.length === 0) {
    return {
      count: 0,
      lastMs: null,
      avgMs: null,
      p95Ms: null,
      maxMs: null,
    };
  }

  const numeric = samples.filter(
    (value) => Number.isFinite(value) && value >= 0,
  );
  if (numeric.length === 0) {
    return {
      count: 0,
      lastMs: null,
      avgMs: null,
      p95Ms: null,
      maxMs: null,
    };
  }

  let sum = 0;
  let max = Number.NEGATIVE_INFINITY;
  for (const value of numeric) {
    sum += value;
    if (value > max) {
      max = value;
    }
  }

  const sorted = [...numeric].sort((a, b) => a - b);
  const p95Index = Math.min(
    sorted.length - 1,
    Math.floor(sorted.length * 0.95),
  );

  return {
    count: numeric.length,
    lastMs: numeric[numeric.length - 1] ?? null,
    avgMs: sum / numeric.length,
    p95Ms: sorted[p95Index] ?? null,
    maxMs: Number.isFinite(max) ? max : null,
  };
}

export function createInitialOrtSessionDebug() {
  return {
    mimi_encoder: {
      name: "mimi_encoder",
      status: "idle",
      modelUrl: null,
      updatedAtMs: null,
      lastError: null,
    },
    text_conditioner: {
      name: "text_conditioner",
      status: "idle",
      modelUrl: null,
      updatedAtMs: null,
      lastError: null,
    },
    flow_lm_main: {
      name: "flow_lm_main",
      status: "idle",
      modelUrl: null,
      updatedAtMs: null,
      lastError: null,
    },
    flow_lm_flow: {
      name: "flow_lm_flow",
      status: "idle",
      modelUrl: null,
      updatedAtMs: null,
      lastError: null,
    },
    mimi_decoder: {
      name: "mimi_decoder",
      status: "idle",
      modelUrl: null,
      updatedAtMs: null,
      lastError: null,
    },
  };
}

export function createInitialPocketTtsCoreDebugState({ workerName }) {
  return {
    worker: {
      workerId: "pocket-tts/inference",
      name: workerName,
      kind: "pocket-tts-inference",
      status: "idle",
      createdAtMs: null,
      updatedAtMs: null,
      threadId: workerName,
      messagesSent: 0,
      messagesReceived: 0,
      pendingRequestCount: 0,
      inflightRequestCount: 0,
      currentTaskType: null,
      currentTaskGenerationId: null,
      currentTaskElapsedMs: null,
      lastMessageType: null,
      lastRequestType: null,
      lastError: null,
      requestLatency: createLatencySummary([]),
      generateStartLatency: createLatencySummary([]),
    },
    ortRuntime: {
      runtimeId: "pocket-tts",
      runtimeName: "Pocket TTS",
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
      sessions: createInitialOrtSessionDebug(),
    },
  };
}
