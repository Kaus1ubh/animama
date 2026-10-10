import { client as testApiClient } from "@animama/runtime-contracts/default-client";
import { afterEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("@animama/runtime-contracts/sdk", async (original) => ({
  ...(await original<typeof import("@animama/runtime-contracts/sdk")>()),
  getModelAssetV1ModelAssetsAssetIdGet: api.get,
}));
vi.mock("./audio/PCMPlayerWorklet.js", () => ({
  PCMPlayerWorklet: class {
    initPromise = Promise.resolve();
    addEventListener() {}
  },
}));
import { createPocketTTS } from "./createPocketTTS";

afterEach(() => vi.unstubAllGlobals());

describe("Pocket generation worker configuration", () => {
  it("warms up with the fixed optional encoder URL without requesting or installing it", async () => {
    const sent: { type: string; data: unknown }[] = [];
    vi.stubGlobal("window", {
      isSecureContext: true,
      AudioContext: class {
        audioWorklet = {};
      },
    });
    vi.stubGlobal(
      "Worker",
      class {
        onmessage?: (event: { data: unknown }) => void;
        postMessage(message: {
          type: string;
          requestId: string;
          data: unknown;
        }) {
          sent.push(message);
          queueMicrotask(() =>
            this.onmessage?.({
              data: { type: "ready", requestId: message.requestId },
            }),
          );
        }
      },
    );
    const core = createPocketTTS(testApiClient);
    await core.init();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      type: "load",
      data: {
        models: {
          mimi_encoder:
            "/v1/model-assets/pocket-tts-voice-cloning-encoder/content",
        },
      },
    });
    expect(api.get).not.toHaveBeenCalled();
  });

  it("keeps ordinary speech ready if optional encoder loading fails", async () => {
    api.get.mockResolvedValue({
      data: {
        id: "pocket-tts-voice-cloning-encoder",
        status: "installed",
      },
    });
    vi.stubGlobal("window", {
      isSecureContext: true,
      AudioContext: class {
        audioWorklet = {};
      },
    });
    vi.stubGlobal(
      "Worker",
      class {
        onmessage?: (event: { data: unknown }) => void;
        postMessage(message: { type: string; requestId: string }) {
          queueMicrotask(() =>
            this.onmessage?.({
              data:
                message.type === "encode_voice"
                  ? {
                      type: "error",
                      requestId: message.requestId,
                      error: "Encoder content is unavailable.",
                    }
                  : { type: "ready", requestId: message.requestId },
            }),
          );
        }
      },
    );
    const core = createPocketTTS(testApiClient);
    await core.init();
    await expect(
      core.encodeVoiceFromFloat32(new Float32Array([0.1])),
    ).rejects.toThrow("Encoder content is unavailable");
    expect(core.getStatus().phase).toBe("ready");
  });
});
