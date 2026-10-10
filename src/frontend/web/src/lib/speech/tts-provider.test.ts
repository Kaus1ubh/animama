import { describe, expect, it } from "vitest";

import { canFallBackToPocketTts, shouldPreparePocketTts } from "./tts-provider";

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

describe("canFallBackToPocketTts", () => {
  const declined = {
    provider: "elevenlabs" as const,
    audioStarted: false,
    audioEnded: false,
    pocketSupported: true,
  };

  it("moves a silent ElevenLabs run to Pocket TTS", () => {
    expect(canFallBackToPocketTts(declined)).toBe(true);
  });

  it("keeps the failure path where Pocket TTS cannot run", () => {
    expect(
      canFallBackToPocketTts({ ...declined, pocketSupported: false }),
    ).toBe(false);
  });

  it("never speaks a reply twice or after its speech ended", () => {
    expect(canFallBackToPocketTts({ ...declined, audioStarted: true })).toBe(
      false,
    );
    expect(canFallBackToPocketTts({ ...declined, audioEnded: true })).toBe(
      false,
    );
  });

  it("switches only runs that speak with ElevenLabs", () => {
    expect(canFallBackToPocketTts({ ...declined, provider: null })).toBe(false);
    expect(
      canFallBackToPocketTts({ ...declined, provider: "pocket_tts" }),
    ).toBe(false);
    expect(canFallBackToPocketTts({ ...declined, provider: "browser" })).toBe(
      false,
    );
  });
});
