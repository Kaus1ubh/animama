import { describe, expect, it } from "vitest";

import { shouldPreparePocketTts } from "./tts-provider";

const supported = () => true;

describe("shouldPreparePocketTts", () => {
  it("waits for the owner's settings instead of preparing from the defaults", () => {
    // Unread (loading or failed) settings resolve from the defaults.
    expect(shouldPreparePocketTts(false, true, "pocket_tts", supported)).toBe(
      false,
    );
  });

  it("prepares Pocket TTS only when loaded settings turn it on", () => {
    expect(shouldPreparePocketTts(true, true, "pocket_tts", supported)).toBe(
      true,
    );
    expect(shouldPreparePocketTts(true, false, "pocket_tts", supported)).toBe(
      false,
    );
    expect(shouldPreparePocketTts(true, true, "elevenlabs", supported)).toBe(
      false,
    );
    expect(shouldPreparePocketTts(true, true, "pocket_tts", () => false)).toBe(
      false,
    );
  });
});
