import { describe, expect, it } from "vitest";

import { buildGeminiChatTtsDispatchOptions } from "./gemini-chat-tts-dispatch";

describe("buildGeminiChatTtsDispatchOptions", () => {
  it("asks the server to speak each sentence with the chosen Gemini model", () => {
    expect(
      buildGeminiChatTtsDispatchOptions({ modelId: "gemini-3.8-flash-tts" }),
    ).toEqual({
      enabled: true,
      provider: "gemini",
      transport: "auto",
      language_code: null,
      model_id: "gemini-3.8-flash-tts",
      finalized_chunking: "sentence",
    });
  });
});
