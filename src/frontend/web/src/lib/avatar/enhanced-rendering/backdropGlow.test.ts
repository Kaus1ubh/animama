import { describe, expect, it } from "vitest";

import {
  CHAT_CANVAS_GRADE,
  averageOpaqueColor,
  backdropGlow,
  chatCanvasFilter,
} from "./backdropGlow";

/** The rgba() colour and alpha inside a `drop-shadow(...)` glow. */
function glowColor(glow: string | null) {
  const match = glow?.match(
    /^drop-shadow\(0 0 6px rgba\((\d+), (\d+), (\d+), ([\d.]+)\)\)$/,
  );
  if (!match) throw new Error(`Not a glow: ${glow}`);
  const [, r, g, b, a] = match.map(Number);
  return { r, g, b, a };
}

describe("backdrop glow", () => {
  it("has no glow when the backdrop is unknown", () => {
    expect(backdropGlow(null)).toBeNull();
    expect(chatCanvasFilter(null)).toBe(CHAT_CANVAS_GRADE);
  });

  it("keeps the soft white glow on light backdrops", () => {
    expect(backdropGlow([255, 255, 255])).toBe(
      "drop-shadow(0 0 6px rgba(255, 255, 255, 0.55))",
    );
    expect(backdropGlow([235, 215, 240])).toBe(
      "drop-shadow(0 0 6px rgba(255, 255, 255, 0.55))",
    );
  });

  it("gives dark backdrops a faint glow tinted with their colour", () => {
    const navy = glowColor(backdropGlow([20, 30, 70]));
    expect(navy.a).toBeLessThanOrEqual(0.2);
    // Bluer than it is red, and well short of white.
    expect(navy.b).toBeGreaterThan(navy.r);
    expect(navy.r).toBeLessThan(128);
    expect(backdropGlow([0, 0, 0])).toBe(
      "drop-shadow(0 0 6px rgba(77, 77, 77, 0.2))",
    );
  });

  it("strengthens and whitens the glow as the backdrop brightens", () => {
    const dark = glowColor(backdropGlow([40, 40, 40]));
    const mid = glowColor(backdropGlow([140, 140, 140]));
    const light = glowColor(backdropGlow([210, 210, 210]));
    expect(dark.a).toBeLessThan(mid.a);
    expect(mid.a).toBeLessThan(light.a);
    expect(dark.r).toBeLessThan(mid.r);
    expect(mid.r).toBeLessThan(light.r);
  });

  it("follows the grade with the glow in the chat filter", () => {
    expect(chatCanvasFilter([255, 255, 255])).toBe(
      `${CHAT_CANVAS_GRADE} drop-shadow(0 0 6px rgba(255, 255, 255, 0.55))`,
    );
  });
});

describe("averageOpaqueColor", () => {
  it("averages pixels weighted by their opacity", () => {
    const pixels = new Uint8ClampedArray([
      255, 0, 0, 255, 0, 0, 255, 255, 0, 255, 0, 0,
    ]);
    expect(averageOpaqueColor(pixels)).toEqual([128, 0, 128]);
  });

  it("has no colour for fully transparent pixels", () => {
    expect(averageOpaqueColor(new Uint8ClampedArray(8))).toBeNull();
  });
});
