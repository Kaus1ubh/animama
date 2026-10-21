// @vitest-environment happy-dom
// A page origin, so the client pins same-origin model URLs with `?v=`.
import { client as testApiClient } from "@animama/runtime-contracts/default-client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { OfflineSttWorkerRequest } from "@/lib/speech/offline-stt/worker-protocol";

const fixture = vi.hoisted(() => ({
  requests: [] as OfflineSttWorkerRequest[],
  leases: [] as string[],
  webgpu: "unsupported" as string,
  capabilities: {
    offline_speech_enabled: true,
    offline_speech_asset_version: "parakeet-version",
    offline_speech_gpu_asset_version: null,
    offline_multilingual_speech_enabled: true,
    offline_multilingual_speech_asset_version: "base-version",
    offline_multilingual_speech_gpu_asset_version: "gpu-version" as
      | string
      | null,
  },
}));

vi.mock("@/query/runtime-capabilities", () => ({
  fetchRuntimeCapabilities: async () => fixture.capabilities,
}));
vi.mock("@/lib/speech/offline-stt/lease", async (original) => ({
  ...(await original<typeof import("@/lib/speech/offline-stt/lease")>()),
  holdModelAssetLease: async (assetId: string) => {
    fixture.leases.push(assetId);
    return { assetId, release: async () => {} };
  },
}));
vi.mock("@/lib/speech/offline-stt/webgpu", async (original) => ({
  ...(await original<typeof import("@/lib/speech/offline-stt/webgpu")>()),
  cacheWebgpuProbe: () => async () => fixture.webgpu,
}));

/** Answers like the real worker and records what it was asked. */
class FakeWorker {
  private listeners = new Map<string, ((event: unknown) => void)[]>();
  addEventListener(type: string, listener: (event: unknown) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  postMessage(request: OfflineSttWorkerRequest) {
    fixture.requests.push(request);
    const result =
      request.type === "offline_stt/load"
        ? { backend: request.backend, modelUrls: request.modelUrls }
        : request.type === "offline_stt/transcribe"
          ? { text: "こんにちは" }
          : { disposed: true };
    queueMicrotask(() =>
      this.listeners.get("message")?.forEach((listener) =>
        listener({
          data: {
            requestId: request.requestId,
            type: request.type,
            ok: true,
            result,
          },
        }),
      ),
    );
  }
  terminate() {}
}

async function senseVoice() {
  return (await import("./client")).senseVoiceSttClient;
}

const pinned = (url: string) => new URL(url).searchParams.get("v");
const path = (url: string) => new URL(url).pathname;

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal("Worker", FakeWorker);
  fixture.requests = [];
  fixture.leases = [];
  fixture.webgpu = "unsupported";
  fixture.capabilities.offline_multilingual_speech_enabled = true;
});

describe("the SenseVoice client", () => {
  it("loads the CPU set at its own version and leases only that set", async () => {
    const client = await senseVoice();
    const result = await client.load(testApiClient);

    expect(fixture.leases).toEqual(["sensevoice-stt"]);
    expect(result.backend).toBe("wasm");
    const urls = result.modelUrls;
    expect(path(urls.modelUrl)).toBe(
      "/onnx/models/sensevoice-small/model.int8.onnx",
    );
    expect(path(urls.tokensUrl)).toBe(
      "/onnx/models/sensevoice-small/tokens.txt",
    );
    expect(path(urls.metadataUrl)).toBe(
      "/onnx/models/sensevoice-small/metadata.json",
    );
    expect(Object.values(urls).map(pinned)).toEqual([
      "base-version",
      "base-version",
      "base-version",
    ]);
  });

  it("runs the GPU set's graph on WebGPU with the CPU set's tables", async () => {
    fixture.webgpu = "available";
    const client = await senseVoice();
    const { modelUrls } = await client.load(testApiClient, {
      preferWebgpu: true,
    });

    expect(fixture.leases).toEqual(["sensevoice-stt", "sensevoice-stt-webgpu"]);
    expect(path(modelUrls.modelUrl)).toBe(
      "/onnx/models/sensevoice-small-webgpu/model.onnx",
    );
    expect(pinned(modelUrls.modelUrl)).toBe("gpu-version");
    expect(pinned(modelUrls.tokensUrl)).toBe("base-version");
  });

  it("refuses to start when the multilingual sets are not installed", async () => {
    fixture.capabilities.offline_multilingual_speech_enabled = false;
    const client = await senseVoice();

    await expect(client.load(testApiClient)).rejects.toThrow();
    expect(fixture.requests).toEqual([]);
  });

  it("sends the conversation language with each window", async () => {
    const client = await senseVoice();
    await client.load(testApiClient);
    await client.transcribe({
      jobId: "job",
      runId: "run",
      turnId: "turn",
      windowId: "window",
      audio: new Float32Array(1600),
      language: "ja",
    });

    expect(fixture.requests.at(-1)).toMatchObject({
      type: "offline_stt/transcribe",
      language: "ja",
    });
  });
});
