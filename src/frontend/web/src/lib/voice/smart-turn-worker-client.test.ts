import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SmartTurnWorkerRequest } from "./smart-turn-worker-protocol";

const fixture = vi.hoisted(() => ({
  workers: [] as {
    terminated: boolean;
    requests: string[];
    terminate(): void;
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
}

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
  vi.unstubAllGlobals();
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
