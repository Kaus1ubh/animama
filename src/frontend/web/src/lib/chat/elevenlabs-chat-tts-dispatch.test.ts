import { describe, expect, it } from "vitest";

import { buildElevenLabsChatTtsDispatchOptions } from "./elevenlabs-chat-tts-dispatch";

describe("buildElevenLabsChatTtsDispatchOptions", () => {
  it("includes finalized chunking only for Eleven v4", () => {
    expect(
      buildElevenLabsChatTtsDispatchOptions({
        modelId: "eleven_v4_turbo",
        finalizedChunkingPreference: "paragraph",
      }),
    ).toEqual({
      enabled: true,
      provider: "elevenlabs",
      transport: "auto",
      language_code: null,
      model_id: "eleven_v4_turbo",
    });

    expect(
      buildElevenLabsChatTtsDispatchOptions({
        modelId: "eleven_v4",
        finalizedChunkingPreference: "paragraph",
      }),
    ).toEqual({
      enabled: true,
      provider: "elevenlabs",
      transport: "auto",
      language_code: null,
      model_id: "eleven_v4",
      finalized_chunking: "paragraph",
    });
  });

  it("defaults invalid Eleven v4 grouping values to sentence", () => {
    expect(
      buildElevenLabsChatTtsDispatchOptions({
        modelId: "eleven_v4",
        finalizedChunkingPreference: "chapter",
      }).finalized_chunking,
    ).toBe("sentence");
  });
});
