import { describe, expect, it } from "vitest";
import {
  SPEECH_ALLOWANCE_EXHAUSTED,
  isSpeechAllowanceExhausted,
} from "@animama/product-ui/chat";

describe("speech allowance frames", () => {
  it("recognizes the exhausted voice allowance on either speech error frame", () => {
    expect(SPEECH_ALLOWANCE_EXHAUSTED).toBe("speech_allowance_exhausted");
    for (const type of ["tts.session.error", "tts.error"]) {
      expect(
        isSpeechAllowanceExhausted({
          type,
          run_id: "run-1",
          provider: "elevenlabs",
          code: "speech_allowance_exhausted",
          error: "This month's voice allowance is used up.",
        }),
      ).toBe(true);
    }
  });

  it("leaves every other speech error, and partial frames, to the failure path", () => {
    for (const frame of [
      { type: "tts.error", code: "elevenlabs_stream_failed" },
      { type: "tts.session.error", code: null, status_code: 503 },
      { type: "tts.session.error", error: "speech_allowance_exhausted" },
      { type: "tts.error", details: { code: "speech_allowance_exhausted" } },
      {},
      null,
      undefined,
      "speech_allowance_exhausted",
    ]) {
      expect(isSpeechAllowanceExhausted(frame)).toBe(false);
    }
  });
});
