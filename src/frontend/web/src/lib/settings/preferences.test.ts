import { describe, expect, it } from "vitest";

import {
  DEFAULT_ANIMAMA_PREFERENCES,
  DEFAULT_ELEVENLABS_V3_FINALIZED_CHUNKING,
  isParakeetWebgpuPreferred,
  mergePreferences,
  normalizeThemeSetting,
  resolveElevenLabsV3FinalizedChunking,
  toElevenLabsV3FinalizedChunking,
} from "./preferences";

describe("ElevenLabs v3 finalized chunking preferences", () => {
  it("defaults and coerces saved audio grouping values", () => {
    expect(DEFAULT_ELEVENLABS_V3_FINALIZED_CHUNKING).toBe("paragraph");
    expect(resolveElevenLabsV3FinalizedChunking(undefined)).toBe("paragraph");
    expect(resolveElevenLabsV3FinalizedChunking("paragraph")).toBe("paragraph");
    expect(toElevenLabsV3FinalizedChunking("chapter")).toBeNull();
  });

  it("persists and restores the saved grouping value through preference merge", () => {
    const merged = mergePreferences(DEFAULT_ANIMAMA_PREFERENCES, {
      speech: {
        tts_elevenlabs_v3_finalized_chunking: "paragraph",
      },
    });

    expect(merged.speech?.tts_elevenlabs_v3_finalized_chunking).toBe(
      "paragraph",
    );
  });
});

describe("theme and appearance preferences", () => {
  it("keeps supported modes and maps retired custom themes to light", () => {
    expect(normalizeThemeSetting("system")).toBe("system");
    expect(normalizeThemeSetting("dark")).toBe("dark");
    expect(normalizeThemeSetting("custom")).toBe("light");
    expect(normalizeThemeSetting("anima")).toBe("light");
    expect(normalizeThemeSetting("sepia")).toBeNull();
  });

  it("merges one colour override without dropping the mode's others", () => {
    const merged = mergePreferences(
      { appearance: { dark: { accent: "#ff6600", background: "#000000" } } },
      { appearance: { dark: { accent: "#00ff00" } } },
    );
    expect(merged.appearance).toEqual({
      dark: { accent: "#00ff00", background: "#000000" },
    });
  });

  it("removes an override when patched to undefined", () => {
    const merged = mergePreferences(
      { appearance: { light: { accent: "#ff6600" } } },
      { appearance: { light: { accent: undefined } } },
    );
    expect(JSON.parse(JSON.stringify(merged))).toEqual({
      appearance: { light: {} },
    });
  });
});

describe("isParakeetWebgpuPreferred", () => {
  it("is off unless the experimental setting is explicitly true", () => {
    expect(isParakeetWebgpuPreferred(null)).toBe(false);
    expect(isParakeetWebgpuPreferred(DEFAULT_ANIMAMA_PREFERENCES)).toBe(false);
    // Saved preferences are untyped JSON, so a string must not enable it.
    expect(
      isParakeetWebgpuPreferred({
        speech: { stt_parakeet_webgpu: "true" as unknown as boolean },
      }),
    ).toBe(false);
    expect(
      isParakeetWebgpuPreferred({ speech: { stt_parakeet_webgpu: true } }),
    ).toBe(true);
  });
});
