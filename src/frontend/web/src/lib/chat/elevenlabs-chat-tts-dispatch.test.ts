import { describe, expect, it } from "vitest";

import { buildElevenLabsChatTtsDispatchOptions } from "./elevenlabs-chat-tts-dispatch";

describe("buildElevenLabsChatTtsDispatchOptions", () => {
  it("includes finalized chunking only for Eleven v3", () => {
    expect(
      buildElevenLabsChatTtsDispatchOptions({
        modelId: "eleven_flash_v2_5",
        finalizedChunkingPreference: "paragraph",
      }),
    ).toEqual({
      enabled: true,
      provider: "elevenlabs",
      transport: "auto",
      language_code: null,
      model_id: "eleven_flash_v2_5",
    });

    expect(
      buildElevenLabsChatTtsDispatchOptions({
        modelId: "eleven_v3",
        finalizedChunkingPreference: "paragraph",
      }),
    ).toEqual({
      enabled: true,
      provider: "elevenlabs",
      transport: "auto",
      language_code: null,
      model_id: "eleven_v3",
      finalized_chunking: "paragraph",
    });
  });

  it("defaults invalid Eleven v3 grouping values to sentence", () => {
    expect(
      buildElevenLabsChatTtsDispatchOptions({
        modelId: "eleven_v3",
        finalizedChunkingPreference: "chapter",
      }).finalized_chunking,
    ).toBe("sentence");
  });
});
