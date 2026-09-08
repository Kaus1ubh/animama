import { describe, expect, it } from "vitest";

import { normalizeSoundEffectDocument } from "./soundEffectDocument";

describe("soundEffectDocument", () => {
  it("normalizes the bounded playback default", () => {
    expect(
      normalizeSoundEffectDocument({
        name: " Ding ",
        description: " cue ",
        volume: 0.755,
        filename: "ding.ogg",
      }),
    ).toEqual({
      name: "Ding",
      description: "cue",
      volume: 0.76,
      filename: "ding.ogg",
    });
  });

  it("rejects values outside the server budget", () => {
    expect(() =>
      normalizeSoundEffectDocument({
        name: "Ding",
        description: "",
        volume: 3,
        filename: null,
      }),
    ).toThrow("invalid_sound_effect_volume");
  });
});
