import {
  createInitialPocketTtsCoreDebugState,
  createLatencySummary,
  nowPerfMs,
} from "./PocketTTSDebugSupport.js";

export class PocketTTSDebugTracker {
  constructor({
    workerName,
    emitEvent,
    hasWorker,
    getPendingRequestCount,
  } = {}) {
    this._emitEvent = typeof emitEvent === "function" ? emitEvent : null;
    this._hasWorker = typeof hasWorker === "function" ? hasWorker : () => false;
    this._getPendingRequestCount =
      typeof getPendingRequestCount === "function"
        ? getPendingRequestCount
        : () => 0;

    const initial = createInitialPocketTtsCoreDebugState({ workerName });
    this._worker = initial.worker;
    this._ortRuntime = initial.ortRuntime;

    this._workerRequestMeta = new Map();
    this._workerRequestLatencySamples = [];
    this._generateStartLatencySamples = [];
    this._workerCurrentTaskStartedAtMs = null;
  }

  getDebugStatus() {
    const nowMs = nowPerfMs();
    const currentTaskElapsedMs =
      typeof this._workerCurrentTaskStartedAtMs === "number"
        ? Math.max(0, nowMs - this._workerCurrentTaskStartedAtMs)
        : null;

    const worker = {
      ...this._worker,
      currentTaskElapsedMs,
      requestLatency: {
        ...this._worker.requestLatency,
      },
      generateStartLatency: {
        ...this._worker.generateStartLatency,
      },
    };

    const sessions = Object.values(this._ortRuntime.sessions).map(
      (session) => ({
        ...session,
      }),
    );

    const ort = {
      ...this._ortRuntime,
      wasm: {
        ...this._ortRuntime.wasm,
      },
      sessions,
    };

    return {
      workerRegistry: {
        totalWorkers: this._hasWorker() ? 1 : 0,
        activeWorkers: this._hasWorker() ? 1 : 0,
        workers: this._hasWorker() ? [worker] : [],
        updatedAtMs: Date.now(),
      },
      onnxRuntimes: [ort],
    };
  }

  markWorkerCreated({ threadId, createdAtMs } = {}) {
    this._worker.createdAtMs =
      typeof createdAtMs === "number" && Number.isFinite(createdAtMs)
        ? createdAtMs
        : Date.now();
    if (typeof threadId === "string" && threadId.length > 0) {
      this._worker.threadId = threadId;
    }
    this._worker.updatedAtMs = Date.now();
  }

  clearPendingRequestMeta() {
    this._workerRequestMeta.clear();
    this._syncWorkerCounts();
  }

  setWorkerLastError(message) {
    this._worker.lastError =
      typeof message === "string" && message.length > 0 ? message : null;
    this._worker.updatedAtMs = Date.now();
  }

  clearWorkerLastError() {
    this._worker.lastError = null;
    this._worker.updatedAtMs = Date.now();
  }

  getWorkerCurrentTaskType() {
    return this._worker.currentTaskType;
  }

  setWorkerStatus(status, extra = {}) {
    this._worker = {
      ...this._worker,
      status,
      ...extra,
      updatedAtMs: Date.now(),
    };
    this._emitWorkerStatus();
  }

  setWorkerCurrentTask(taskType, generationId = null) {
    this._worker.currentTaskType = taskType;
    this._worker.currentTaskGenerationId = generationId;
    this._workerCurrentTaskStartedAtMs = nowPerfMs();
    this._worker.status = "busy";
    this._worker.updatedAtMs = Date.now();
    this._emitWorkerStatus();
  }

  clearWorkerCurrentTask(taskType = null) {
    if (taskType && this._worker.currentTaskType !== taskType) {
      return;
    }
    this._worker.currentTaskType = null;
    this._worker.currentTaskGenerationId = null;
    this._workerCurrentTaskStartedAtMs = null;
    this._worker.status = this._hasWorker() ? "ready" : "idle";
    this._worker.updatedAtMs = Date.now();
    this._emitWorkerStatus();
  }

  recordWorkerRequestSent(type, requestId, opts = {}) {
    if (!requestId) return;
    const expectsReply =
      opts.awaitResponse === true ||
      type === "generate" ||
      type === "set_voice" ||
      type === "load" ||
      type === "encode_voice";

    this._worker.messagesSent += 1;
    this._worker.lastMessageType = `tx:${type}`;
    this._worker.lastRequestType = type;
    this._worker.updatedAtMs = Date.now();

    if (expectsReply) {
      this._workerRequestMeta.set(requestId, {
        type,
        sentAtMs: nowPerfMs(),
        generationId: opts.generationId || null,
      });
    }

    if (type === "load") {
      this.setWorkerCurrentTask("load");
      return;
    }
    if (type === "generate") {
      this.setWorkerCurrentTask("generate", opts.generationId || null);
      return;
    }

    this._emitWorkerStatus();
  }

  recordWorkerIncoming(messageType) {
    this._worker.messagesReceived += 1;
    this._worker.lastMessageType = `rx:${messageType}`;
    this._worker.updatedAtMs = Date.now();
    this._emitWorkerStatus();
  }

  recordWorkerReply(requestId, messageType) {
    if (!requestId) return;
    const meta = this._workerRequestMeta.get(requestId);
    if (!meta) return;
    this._workerRequestMeta.delete(requestId);

    const latencyMs = nowPerfMs() - meta.sentAtMs;
    if (meta.type === "generate" && messageType === "generation_started") {
      this._pushLatencySample(this._generateStartLatencySamples, latencyMs);
      this._worker.generateStartLatency = createLatencySummary(
        this._generateStartLatencySamples,
      );
      this._emitWorkerStatus();
      return;
    }

    this._pushLatencySample(this._workerRequestLatencySamples, latencyMs);
    this._worker.requestLatency = createLatencySummary(
      this._workerRequestLatencySamples,
    );
    this._emitWorkerStatus();
  }

  updateOrtRuntime(nextRuntime) {
    if (!nextRuntime || typeof nextRuntime !== "object") return;

    const nextSessions = Array.isArray(nextRuntime.sessions)
      ? nextRuntime.sessions
      : null;

    if (nextSessions) {
      const mergedSessions = { ...this._ortRuntime.sessions };
      for (const session of nextSessions) {
        if (!session || typeof session !== "object") continue;
        const name = typeof session.name === "string" ? session.name : null;
        if (!name) continue;
        mergedSessions[name] = {
          ...mergedSessions[name],
          ...session,
        };
      }
      this._ortRuntime.sessions = mergedSessions;
    }

    const nextWasm =
      nextRuntime.wasm && typeof nextRuntime.wasm === "object"
        ? nextRuntime.wasm
        : null;
    if (nextWasm) {
      this._ortRuntime.wasm = {
        ...this._ortRuntime.wasm,
        ...nextWasm,
      };
    }

    this._ortRuntime = {
      ...this._ortRuntime,
      ...nextRuntime,
      sessions: this._ortRuntime.sessions,
      wasm: this._ortRuntime.wasm,
      updatedAtMs: Date.now(),
    };

    this._emitOrtStatus();
  }

  _syncWorkerCounts() {
    this._worker.pendingRequestCount = this._getPendingRequestCount();
    this._worker.inflightRequestCount = this._workerRequestMeta.size;
    this._worker.updatedAtMs = Date.now();
  }

  _emitWorkerStatus() {
    this._syncWorkerCounts();
    const snapshot = this.getDebugStatus();
    this._emit("debug_worker_status", snapshot.workerRegistry);
  }

  _emitOrtStatus() {
    const snapshot = this.getDebugStatus();
    const runtime = snapshot.onnxRuntimes[0] || null;
    if (!runtime) return;
    this._emit("ort_debug_status", runtime);
  }

  _emit(eventName, detail) {
    if (!this._emitEvent) return;
    this._emitEvent(eventName, detail);
  }

  _pushLatencySample(target, latencyMs, maxSamples = 120) {
    if (!Number.isFinite(latencyMs) || latencyMs < 0) return;
    target.push(latencyMs);
    if (target.length > maxSamples) {
      target.splice(0, target.length - maxSamples);
    }
  }
}
