import { client as testApiClient } from "@animama/runtime-contracts/default-client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({
  ensure: vi.fn(),
  decode: vi.fn(),
  messages: [] as { type: string; data: Record<string, unknown> }[],
  terminate: vi.fn(),
  created: vi.fn(),
}));
vi.mock("./voice-cloning-encoder", () => ({
  ensurePocketVoiceCloningEncoder: fixture.ensure,
  POCKET_VOICE_ENCODER_CONTENT_URL:
    "/v1/model-assets/pocket-tts-voice-cloning-encoder/content",
}));
vi.mock("@/lib/speech/tts-provider", () => ({
  isPocketTtsSupported: () => true,
}));

import { buildPocketVoiceCatalogFile } from "./catalog-builder";

/** Worker boundary fixture: real catalog serialization, no ONNX or audio network. */
class CatalogWorker {
  onmessage?: (event: { data: unknown }) => void;
  onerror?: (event: { message: string }) => void;
  constructor() {
    fixture.created();
  }
  postMessage(message: {
    type: string;
    requestId: string;
    data: Record<string, unknown>;
  }) {
    fixture.messages.push(message);
    queueMicrotask(() =>
      this.onmessage?.({
        data:
          message.type === "load"
            ? { type: "ready", requestId: message.requestId }
            : {
                type: "voice_encoded",
                requestId: message.requestId,
                embedding: [0.2, 0.4],
                embeddingShape: [1, 1, 2],
              },
      }),
    );
  }
  terminate() {
    fixture.terminate();
  }
}

const sources = () => [
  { voiceName: "neutral", file: new File(["audio"], "sample.wav") },
];

beforeEach(() => {
  fixture.ensure
    .mockReset()
    .mockResolvedValue(
      "/v1/model-assets/pocket-tts-voice-cloning-encoder/content",
    );
  fixture.decode.mockReset().mockResolvedValue({
    sampleRate: 24000,
    numberOfChannels: 1,
    length: 2,
    getChannelData: () => new Float32Array([0.1, 0.2]),
  });
  fixture.messages.length = 0;
  vi.stubGlobal("Worker", CatalogWorker);
  vi.stubGlobal("window", {
    location: { origin: "http://localhost:8000" },
    AudioContext: class {
      decodeAudioData = fixture.decode;
      close = vi.fn(async () => undefined);
    },
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("catalog encoding prerequisite", () => {
  it("checks optional model availability before creating an encoding worker", async () => {
    fixture.ensure.mockRejectedValue(new Error("Download voice cloning"));
    await expect(
      buildPocketVoiceCatalogFile(testApiClient, { sources: sources() }),
    ).rejects.toThrow("Download voice cloning");
    expect(fixture.created).not.toHaveBeenCalled();
  });

  it("passes only the fixed verified encoder URL to the worker", async () => {
    const file = await buildPocketVoiceCatalogFile(testApiClient, {
      sources: sources(),
    });
    expect(file.size).toBeGreaterThan(0);
    expect(fixture.messages[0]).toMatchObject({
      type: "load",
      data: {
        models: {
          mimi_encoder:
            "/v1/model-assets/pocket-tts-voice-cloning-encoder/content",
        },
      },
    });
    expect(fixture.terminate).toHaveBeenCalledOnce();
  });

  it("detaches a disposed operation before encoding or producing a saved clone", async () => {
    const abort = new AbortController();
    fixture.decode.mockImplementationOnce(async () => {
      abort.abort();
      return {
        sampleRate: 24000,
        numberOfChannels: 1,
        length: 2,
        getChannelData: () => new Float32Array([0.1, 0.2]),
      };
    });
    await expect(
      buildPocketVoiceCatalogFile(testApiClient, {
        sources: sources(),
        encoder: { signal: abort.signal },
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(
      fixture.messages.some((message) => message.type === "encode_voice"),
    ).toBe(false);
    expect(fixture.terminate).toHaveBeenCalledOnce();
  });
});
