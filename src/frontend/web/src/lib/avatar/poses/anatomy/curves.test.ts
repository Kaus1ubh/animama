import { describe, expect, it } from "vitest";

import { ScalarTrack, type ResolvedKey } from "./curves";

const key = (
  t: number,
  v: number,
  extra: Partial<ResolvedKey> = {},
): ResolvedKey => ({
  t,
  v,
  tangent: "auto",
  ease: "smooth",
  ...extra,
});

const slope = (track: ScalarTrack, t: number, side: -1 | 1) => {
  const h = 1e-4;
  return side < 0
    ? (track.evaluate(t) - track.evaluate(t - h)) / h
    : (track.evaluate(t + h) - track.evaluate(t)) / h;
};

describe("ScalarTrack", () => {
  it("passes through keys and holds outside them", () => {
    const track = new ScalarTrack([key(0.5, 10), key(1, 30)], null);
    expect(track.evaluate(0)).toBe(10);
    expect(track.evaluate(0.5)).toBe(10);
    expect(track.evaluate(1)).toBe(30);
    expect(track.evaluate(2)).toBe(30);
  });

  it("keeps velocity continuous through an auto key on a rising run", () => {
    const track = new ScalarTrack([key(0, 0), key(0.4, 40), key(1, 100)], null);
    const left = slope(track, 0.4, -1);
    const right = slope(track, 0.4, 1);
    expect(left).toBeGreaterThan(50);
    expect(Math.abs(left - right)).toBeLessThan(1);
  });

  it("stops at peaks and flat keys without overshooting", () => {
    const track = new ScalarTrack(
      [
        key(0, 0),
        key(0.5, 50),
        key(1, 20),
        key(1.5, 60, { tangent: "flat" }),
        key(2, 100),
      ],
      null,
    );
    expect(Math.abs(slope(track, 0.5, 1))).toBeLessThan(0.1);
    expect(Math.abs(slope(track, 1.5, 1))).toBeLessThan(0.1);
    for (let t = 0; t <= 0.5; t += 0.01)
      expect(track.evaluate(t)).toBeLessThanOrEqual(50 + 1e-9);
  });

  it("arrives at each key with that key's ease", () => {
    const track = new ScalarTrack(
      [
        key(0, 0),
        key(1, 10, { ease: "linear" }),
        key(2, 20, { ease: "hold" }),
        key(3, 30, { ease: "easeInOutSine" }),
      ],
      null,
    );
    expect(track.evaluate(0.25)).toBeCloseTo(2.5);
    expect(track.evaluate(1.9)).toBe(10);
    expect(track.evaluate(2)).toBe(20);
    expect(track.evaluate(2.5)).toBeCloseTo(25);
    expect(track.evaluate(2.25)).toBeCloseTo(
      20 + (10 * (1 - Math.cos(Math.PI / 4))) / 2,
    );
  });

  it("wraps a loop without a seam", () => {
    const track = new ScalarTrack([key(0, 0), key(0.5, 10), key(1, 0)], 1);
    expect(track.evaluate(0)).toBeCloseTo(track.evaluate(1));
    expect(Math.abs(slope(track, 1, -1) - slope(track, 1, 1))).toBeLessThan(1);
    const offset = new ScalarTrack([key(0.2, 5), key(0.7, -5)], 1);
    expect(offset.evaluate(0.05)).toBeCloseTo(offset.evaluate(1.05));
    expect(Math.abs(slope(offset, 1, -1) - slope(offset, 1, 1))).toBeLessThan(
      1,
    );
  });

  it("keeps a loop's closing key with its own value and ease", () => {
    const linear = new ScalarTrack(
      [key(0, 0), key(1, 1, { ease: "linear" })],
      1,
    );
    expect(linear.evaluate(0.25)).toBeCloseTo(0.25);
    expect(linear.evaluate(1.25)).toBeCloseTo(0.25);
    const held = new ScalarTrack(
      [key(0, 0), key(0.5, 1), key(1, 0, { ease: "hold" })],
      1,
    );
    expect(held.evaluate(0.75)).toBe(1);
    expect(held.evaluate(1)).toBe(0);
  });
});
