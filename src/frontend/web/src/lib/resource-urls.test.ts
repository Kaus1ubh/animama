import { afterEach, describe, expect, it, vi } from "vitest";
import { optionalModelResourceUrl, publicResourceUrl } from "./resource-urls";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("application resource lifetime", () => {
  it("keeps existing local asset and optional-download routes", () => {
    vi.stubEnv("BASE_URL", "/");
    expect(publicResourceUrl("tts/workers/inference-worker.js")).toBe(
      "/tts/workers/inference-worker.js",
    );
    expect(
      optionalModelResourceUrl(
        "pocket-tts-voice-cloning",
        "mimi_encoder.onnx",
        "/v1/model-assets/encoder/content",
      ),
    ).toBe("/v1/model-assets/encoder/content");
  });

  it("keeps runtime-created workers and optional model URLs bound to the open artifact", () => {
    const first = "/_animama/static/" + "a".repeat(64) + "/";
    const model =
      "/_animama/models/pocket-tts-voice-cloning/" + "b".repeat(64) + "/";
    vi.stubEnv("BASE_URL", first);
    vi.stubGlobal("__ANIMAMA_LAZY_RESOURCE_PREFIXES__", {
      "pocket-tts-voice-cloning": model,
    });
    expect(publicResourceUrl("/tts/audio/pcm-processor.worklet.js")).toBe(
      first + "tts/audio/pcm-processor.worklet.js",
    );
    expect(
      optionalModelResourceUrl(
        "pocket-tts-voice-cloning",
        "mimi_encoder.onnx",
        "/v1/model-assets/encoder/content",
      ),
    ).toBe(model + "mimi_encoder.onnx");
  });
});
