import { describe, expect, it } from "vitest";

import {
  DEFAULT_ANIMAMA_PREFERENCES,
  DEFAULT_ELEVENLABS_V3_FINALIZED_CHUNKING,
  mergePreferences,
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

describe("safety preferences", () => {
  it("merges a partial safety patch without dropping the other safety choice", () => {
    const merged = mergePreferences(
      { safety: { crisis_resource_region: "GB", reminder_hours: 2 } },
      { safety: { reminder_hours: 1 } },
    );
    expect(merged.safety).toEqual({
      crisis_resource_region: "GB",
      reminder_hours: 1,
    });
  });
});
