import { describe, expect, it } from "vitest";

import { litSegments, rmsDbfs, segmentZone } from "./level-meter";

describe("level meter", () => {
  it("measures full-scale and silent input", () => {
    expect(rmsDbfs([1, -1, 1, -1])).toBeCloseTo(0);
    expect(rmsDbfs([0, 0, 0])).toBe(-Infinity);
    expect(rmsDbfs([0.1, -0.1])).toBeCloseTo(-20);
  });

  it("lights segments left to right within the -60..0 dB range", () => {
    expect(litSegments(-Infinity, 20)).toBe(0);
    expect(litSegments(-60, 20)).toBe(0);
    expect(litSegments(-30, 20)).toBe(10);
    expect(litSegments(3, 20)).toBe(20);
  });

  it("colours segments green, then yellow, then red", () => {
    const zones = Array.from({ length: 20 }, (_, index) =>
      segmentZone(index, 20),
    );
    expect(zones[0]).toBe("green");
    expect(zones.indexOf("yellow")).toBeGreaterThan(zones.lastIndexOf("green"));
    expect(zones.indexOf("red")).toBeGreaterThan(zones.lastIndexOf("yellow"));
    expect(zones.at(-1)).toBe("red");
  });
});
