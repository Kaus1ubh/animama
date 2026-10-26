import { describe, expect, it } from "vitest";

import { chatTtsDispatchOptions } from "./chat-tts-dispatch";

describe("chatTtsDispatchOptions", () => {
  it.each(["pocket_tts", "browser"] as const)(
    "names the client voice %s so the prompt keeps the reply speakable",
    (provider) => {
      expect(
        chatTtsDispatchOptions({
          provider,
          elevenLabsModelId: null,
          geminiModelId: null,
        }),
      ).toEqual({ tts: { enabled: true, provider } });
    },
  );

  it("asks the server to speak ElevenLabs and Gemini replies", () => {
    expect(
      chatTtsDispatchOptions({
        provider: "elevenlabs",
        elevenLabsModelId: "eleven_v4_turbo",
        geminiModelId: null,
      })?.tts,
    ).toMatchObject({
      enabled: true,
      provider: "elevenlabs",
      model_id: "eleven_v4_turbo",
    });
    expect(
      chatTtsDispatchOptions({
        provider: "gemini",
        elevenLabsModelId: null,
        geminiModelId: "gemini-3.8-flash-tts",
      })?.tts,
    ).toMatchObject({
      enabled: true,
      provider: "gemini",
      model_id: "gemini-3.8-flash-tts",
    });
  });

  it("sends nothing while speech is off", () => {
    expect(
      chatTtsDispatchOptions({
        provider: null,
        elevenLabsModelId: null,
        geminiModelId: null,
      }),
    ).toBeUndefined();
  });
});
