import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SmartTurnWorkerRequest } from "./smart-turn-worker-protocol";

const fixture = vi.hoisted(() => ({
  workers: [] as {
    terminated: boolean;
    requests: string[];
    terminate(): void;
    emit(type: string, event: unknown): void;
  }[],
  /** Requests stay unanswered, as when the worker is about to be terminated. */
  holdReplies: false,
}));

/** Answers like the real worker until it is terminated. */
class FakeWorker {
  terminated = false;
  requests: string[] = [];
  private listeners = new Map<string, ((event: unknown) => void)[]>();
  constructor() {
    fixture.workers.push(this);
  }
  addEventListener(type: string, listener: (event: unknown) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  postMessage(request: SmartTurnWorkerRequest) {
    this.requests.push(request.type);
    if (this.terminated || fixture.holdReplies) return;
    const result =
      request.type === "smart_turn/load"
        ? { modelUrl: request.modelUrl }
        : { disposed: true };
    queueMicrotask(() =>
      this.listeners.get("message")?.forEach((listener) =>
        listener({
          data: {
            requestId: request.requestId,
            type: `${request.type}_result`,
            ok: true,
            result,
          },
        }),
      ),
    );
  }
  terminate() {
    this.terminated = true;
  }
  emit(type: string, event: unknown) {
    this.listeners.get(type)?.forEach((listener) => listener(event));
  }
}

const predict = (smartTurn: typeof import("./smart-turn-worker-client")) =>
  smartTurn.predictSmartTurn({
    jobId: "job",
    turnId: "turn",
    audio: new Float32Array(16),
    sampleRateHz: 16_000,
    threshold: 0.5,
  });

const load = (smartTurn: typeof import("./smart-turn-worker-client")) =>
  smartTurn.loadSmartTurnWorker({
    modelUrl: "https://app.example.test/smart-turn.onnx",
    ortWasmBaseUrl: "https://app.example.test/ort/",
  });

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal("Worker", FakeWorker);
  fixture.workers = [];
  fixture.holdReplies = false;
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("a worker that stops answering", () => {
  it("fails its requests when the worker errors and starts a new worker next time", async () => {
    const smartTurn = await import("./smart-turn-worker-client");
    await load(smartTurn);
    fixture.holdReplies = true;
    const predicting = predict(smartTurn);
    fixture.workers[0].emit("error", { message: "worker script failed" });
    await expect(predicting).rejects.toThrow("failed");
    expect(fixture.workers[0].terminated).toBe(true);
    fixture.holdReplies = false;
    await expect(load(smartTurn)).resolves.toBeDefined();
    expect(fixture.workers).toHaveLength(2);
  });

  it("fails a prediction that never answers", async () => {
    vi.useFakeTimers();
    const smartTurn = await import("./smart-turn-worker-client");
    await load(smartTurn);
    fixture.holdReplies = true;
    const settled = expect(predict(smartTurn)).rejects.toThrow("timed out");
    await vi.advanceTimersByTimeAsync(smartTurn.SMART_TURN_PREDICT_TIMEOUT_MS);
    await settled;
  });

  it("fails a load that never answers and replaces the worker", async () => {
    vi.useFakeTimers();
    const smartTurn = await import("./smart-turn-worker-client");
    fixture.holdReplies = true;
    const settled = expect(load(smartTurn)).rejects.toThrow("timed out");
    await vi.advanceTimersByTimeAsync(smartTurn.SMART_TURN_LOAD_TIMEOUT_MS);
    await settled;
    expect(fixture.workers[0].terminated).toBe(true);
    fixture.holdReplies = false;
    await expect(load(smartTurn)).resolves.toBeDefined();
    expect(fixture.workers).toHaveLength(2);
  });

  it("still stops a worker that never answers its dispose request", async () => {
    vi.useFakeTimers();
    const smartTurn = await import("./smart-turn-worker-client");
    await load(smartTurn);
    fixture.holdReplies = true;
    const disposing = smartTurn.disposeSmartTurnWorker();
    await vi.advanceTimersByTimeAsync(smartTurn.SMART_TURN_DISPOSE_TIMEOUT_MS);
    await expect(disposing).resolves.toEqual({ disposed: true });
    expect(fixture.workers[0].terminated).toBe(true);
  });
});

describe("ending a session", () => {
  it("terminates the worker at once so the next session loads a new one", async () => {
    const smartTurn = await import("./smart-turn-worker-client");
    await load(smartTurn);
    smartTurn.terminateSmartTurnWorker();
    expect(fixture.workers[0].terminated).toBe(true);
    await expect(load(smartTurn)).resolves.toEqual({
      modelUrl: "https://app.example.test/smart-turn.onnx",
    });
    expect(fixture.workers).toHaveLength(2);
  });

  it("settles work a terminated worker can no longer answer", async () => {
    const smartTurn = await import("./smart-turn-worker-client");
    await load(smartTurn);
    fixture.holdReplies = true;
    const predicting = smartTurn.predictSmartTurn({
      jobId: "job",
      turnId: "turn",
      audio: new Float32Array(16),
      sampleRateHz: 16_000,
      threshold: 0.5,
    });
    const disposing = smartTurn.disposeSmartTurnWorker();
    // The session's resource scope stops the browser worker before any reply.
    fixture.workers[0].terminate();
    smartTurn.terminateSmartTurnWorker();
    await expect(predicting).rejects.toThrow("terminated");
    await expect(disposing).resolves.toEqual({ disposed: true });
    fixture.holdReplies = false;
    await expect(load(smartTurn)).resolves.toBeDefined();
    expect(fixture.workers).toHaveLength(2);
    expect(fixture.workers[1].requests).toEqual(["smart_turn/load"]);
  });
});
