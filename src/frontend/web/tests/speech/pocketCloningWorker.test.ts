import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => vi.unstubAllGlobals());

describe("Pocket worker encoder URL boundary", () => {
  it.each([
    "https://example.com/mimi.onnx",
    "/onnx/models/pocket-tts/mimi_encoder.onnx",
    "/v1/model-assets/another-model/content",
  ])(
    "rejects an unapproved encoder route before requesting any models: %s",
    async (encoderUrl) => {
      vi.resetModules();
      const worker = {
        location: {
          href: "http://localhost:8000/tts/workers/inference-worker.js",
        },
        onmessage: undefined as
          | ((event: { data: unknown }) => Promise<void>)
          | undefined,
      };
      const postMessage = vi.fn();
      const fetch = vi.fn();
      vi.stubGlobal("self", worker);
      vi.stubGlobal("postMessage", postMessage);
      vi.stubGlobal("fetch", fetch);
      await import("../../public/tts/workers/inference-worker.js");
      await worker.onmessage?.({
        data: {
          type: "load",
          requestId: "load-test",
          data: {
            voices: ["eve", "azelma"],
            defaultVoice: "eve",
            models: { mimi_encoder: encoderUrl },
          },
        },
      });
      expect(postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "error",
          requestId: "load-test",
          error: expect.stringContaining("verified model-asset"),
        }),
      );
      expect(fetch).not.toHaveBeenCalled();
    },
  );
});
