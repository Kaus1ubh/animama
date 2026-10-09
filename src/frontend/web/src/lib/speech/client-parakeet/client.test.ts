import { client as testApiClient } from "@animama/runtime-contracts/default-client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ClientParakeetWorkerRequest } from "./worker-protocol";

const fixture = vi.hoisted(() => ({
  events: [] as string[],
  workers: [] as { terminated: boolean; terminate(): void }[],
  /** Requests stay unanswered, as when the worker is about to be terminated. */
  holdReplies: false,
  failLoads: false,
  webgpu: "unsupported" as string,
  releaseDelayMs: 0,
  capabilities: {
    offline_speech_enabled: true,
    offline_speech_asset_version: "base-version",
    offline_speech_gpu_asset_version: "gpu-version" as string | null,
  },
}));

vi.mock("@/query/runtime-capabilities", () => ({
  fetchRuntimeCapabilities: async () => fixture.capabilities,
}));
vi.mock("@/lib/speech/client-parakeet/lease", async (original) => ({
  ...(await original<typeof import("@/lib/speech/client-parakeet/lease")>()),
  holdModelAssetLease: async (assetId: string) => {
    fixture.events.push(`lease:${assetId}`);
    return {
      assetId,
      release: () =>
        new Promise<void>((resolve) =>
          setTimeout(() => {
            fixture.events.push(`release:${assetId}`);
            resolve();
          }, fixture.releaseDelayMs),
        ),
    };
  },
}));
vi.mock("@/lib/speech/client-parakeet/webgpu", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/lib/speech/client-parakeet/webgpu")
  >()),
  cacheParakeetWebgpuProbe: () => async () => fixture.webgpu,
}));

/** Answers worker requests like the real worker, recording their order. */
class FakeWorker {
  /** A terminated worker never answers again, like a real one. */
  terminated = false;
  private listeners = new Map<string, ((event: unknown) => void)[]>();
  constructor() {
    fixture.workers.push(this);
  }
  addEventListener(type: string, listener: (event: unknown) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  postMessage(request: ClientParakeetWorkerRequest) {
    fixture.events.push(
      request.type === "client_parakeet/load"
        ? `load:${request.backend}`
        : request.type,
    );
    if (this.terminated || fixture.holdReplies) return;
    const failed =
      request.type === "client_parakeet/load" &&
      (fixture.failLoads || request.backend === "webgpu");
    const data = failed
      ? {
          requestId: request.requestId,
          type: request.type,
          ok: false,
          error: { message: "load failed" },
        }
      : {
          requestId: request.requestId,
          type: request.type,
          ok: true,
          result:
            request.type === "client_parakeet/load"
              ? { backend: request.backend, modelUrls: request.modelUrls }
              : { disposed: true },
        };
    queueMicrotask(() =>
      this.listeners.get("message")?.forEach((listener) => listener({ data })),
    );
  }
  terminate() {
    this.terminated = true;
  }
}

async function client() {
  return await import("./client");
}

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal("Worker", FakeWorker);
  fixture.events = [];
  fixture.workers = [];
  fixture.holdReplies = false;
  fixture.failLoads = false;
  fixture.webgpu = "unsupported";
  fixture.releaseDelayMs = 0;
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("client Parakeet set leases", () => {
  it("leases the installed CPU set before loading it", async () => {
    const parakeet = await client();
    await parakeet.loadClientParakeetWorker(testApiClient);
    expect(fixture.events).toEqual(["lease:parakeet-stt", "load:wasm"]);
  });

  it("leases the GPU set only for a WebGPU load", async () => {
    fixture.webgpu = "available";
    const parakeet = await client();
    // The fake worker fails WebGPU loads, so the client falls back to WASM
    // and releases the GPU lease it no longer needs.
    await parakeet.loadClientParakeetWorker(testApiClient, {
      preferWebgpu: true,
    });
    expect(fixture.events.slice(0, 3)).toEqual([
      "lease:parakeet-stt",
      "lease:parakeet-stt-webgpu",
      "load:webgpu",
    ]);
    expect(fixture.events.at(-1)).toBe("load:wasm");
    await vi.waitFor(() =>
      expect(fixture.events).toContain("release:parakeet-stt-webgpu"),
    );
    expect(
      fixture.events.filter((event) => event === "lease:parakeet-stt-webgpu"),
    ).toHaveLength(1);
  });

  it("leases nothing when sets come from an operator (no versions)", async () => {
    fixture.capabilities = {
      ...fixture.capabilities,
      offline_speech_asset_version: null as unknown as string,
      offline_speech_gpu_asset_version: null,
    };
    const parakeet = await client();
    await parakeet.loadClientParakeetWorker(testApiClient);
    expect(fixture.events).toEqual(["load:wasm"]);
    fixture.capabilities = {
      ...fixture.capabilities,
      offline_speech_asset_version: "base-version",
      offline_speech_gpu_asset_version: "gpu-version",
    };
  });

  it("releases its leases when the load fails", async () => {
    fixture.failLoads = true;
    const parakeet = await client();
    await expect(
      parakeet.loadClientParakeetWorker(testApiClient),
    ).rejects.toThrow("load failed");
    await vi.waitFor(() =>
      expect(fixture.events).toContain("release:parakeet-stt"),
    );
  });
});

describe("disposing an idle worker before removal", () => {
  it("refuses while a dictation session uses the worker", async () => {
    const parakeet = await client();
    await parakeet.loadClientParakeetWorker(testApiClient);
    await expect(parakeet.disposeIdleClientParakeetWorker()).resolves.toBe(
      false,
    );
    expect(fixture.events).not.toContain("release:parakeet-stt");
  });

  it("disposes an idle worker and waits for its lease releases", async () => {
    const parakeet = await client();
    await parakeet.loadClientParakeetWorker(testApiClient);
    parakeet.armClientParakeetIdleDispose("test");
    fixture.releaseDelayMs = 50;
    await expect(parakeet.disposeIdleClientParakeetWorker()).resolves.toBe(
      true,
    );
    expect(fixture.events.at(-1)).toBe("release:parakeet-stt");
  });

  it("stops waiting for a slow release after its bound", async () => {
    vi.useFakeTimers();
    const parakeet = await client();
    await parakeet.loadClientParakeetWorker(testApiClient);
    parakeet.armClientParakeetIdleDispose("test");
    fixture.releaseDelayMs = 60_000;
    const disposed = parakeet.disposeIdleClientParakeetWorker();
    await vi.advanceTimersByTimeAsync(parakeet.LEASE_RELEASE_WAIT_MS);
    await expect(disposed).resolves.toBe(true);
    expect(fixture.events).not.toContain("release:parakeet-stt");
  });
});

describe("ending a session", () => {
  it("terminates the worker at once so the next session loads a new one", async () => {
    const parakeet = await client();
    await parakeet.loadClientParakeetWorker(testApiClient);
    parakeet.terminateClientParakeetWorker();
    expect(fixture.workers[0].terminated).toBe(true);
    await vi.waitFor(() =>
      expect(fixture.events).toContain("release:parakeet-stt"),
    );
    await parakeet.loadClientParakeetWorker(testApiClient);
    expect(fixture.workers).toHaveLength(2);
    expect(fixture.workers[1].terminated).toBe(false);
  });

  it("settles work a terminated worker can no longer answer", async () => {
    const parakeet = await client();
    await parakeet.loadClientParakeetWorker(testApiClient);
    fixture.holdReplies = true;
    const transcribing = parakeet.transcribeClientParakeetWindow({
      jobId: "job",
      runId: "run",
      turnId: "turn",
      windowId: "window",
      audio: new Float32Array(16),
    });
    const disposing = parakeet.disposeClientParakeetWorker();
    // The session's resource scope stops the browser worker before any reply.
    fixture.workers[0].terminate();
    parakeet.terminateClientParakeetWorker();
    await expect(transcribing).rejects.toThrow("terminated");
    await expect(disposing).resolves.toEqual({ disposed: true });
    fixture.holdReplies = false;
    await expect(
      parakeet.loadClientParakeetWorker(testApiClient),
    ).resolves.toMatchObject({ backend: "wasm" });
    expect(fixture.workers).toHaveLength(2);
  });

  it("cancels the idle timer so it cannot stall the next session's load", async () => {
    vi.useFakeTimers();
    const parakeet = await client();
    await parakeet.loadClientParakeetWorker(testApiClient);
    parakeet.armClientParakeetIdleDispose("test");
    fixture.workers[0].terminate();
    parakeet.terminateClientParakeetWorker();
    await vi.advanceTimersByTimeAsync(300_000);
    await expect(
      parakeet.loadClientParakeetWorker(testApiClient),
    ).resolves.toMatchObject({ backend: "wasm" });
    expect(fixture.events).not.toContain("client_parakeet/dispose");
  });
});
