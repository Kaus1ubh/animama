import { describe, expect, it } from "vitest";

import { ResolutionGovernor } from "../scripts/landing-stage/quality";

/** Feed `seconds` of frames taking `frame` seconds each; the last change. */
function run(
  governor: ResolutionGovernor,
  clock: { now: number },
  seconds: number,
  frame: number,
) {
  let changed: number | null = null;
  for (let elapsed = 0; elapsed < seconds; elapsed += frame) {
    clock.now += frame;
    changed = governor.sample(clock.now, frame) ?? changed;
  }
  return changed;
}

describe("landing page resolution", () => {
  it("starts at the screen's own ratio, at most 2", () => {
    expect(new ResolutionGovernor(3).ratio).toBe(2);
    expect(new ResolutionGovernor(1).ratio).toBe(1);
  });

  it("steps down after a slow window and holds while it settles", () => {
    const governor = new ResolutionGovernor(2);
    const clock = { now: 0 };
    expect(run(governor, clock, 2.1, 1 / 30)).toBe(1.5);
    // Still slow, but the next judgement waits for the change to settle.
    expect(run(governor, clock, 2.5, 1 / 30)).toBeNull();
    expect(run(governor, clock, 3, 1 / 30)).toBe(1.25);
  });

  it("steps back up only after a long run of quick frames", () => {
    const governor = new ResolutionGovernor(2);
    const clock = { now: 0 };
    run(governor, clock, 2.1, 1 / 30);
    expect(run(governor, clock, 7, 1 / 60)).toBeNull();
    expect(run(governor, clock, 6, 1 / 60)).toBe(2);
  });

  it("ignores hitches and the quiet time after a load", () => {
    const governor = new ResolutionGovernor(2);
    const clock = { now: 0 };
    expect(run(governor, clock, 3, 0.25)).toBeNull();
    governor.settle(clock.now);
    expect(run(governor, clock, 2.5, 1 / 30)).toBeNull();
    expect(governor.ratio).toBe(2);
  });

  it("stops at the lowest step", () => {
    const governor = new ResolutionGovernor(1);
    const clock = { now: 0 };
    expect(run(governor, clock, 2.1, 1 / 20)).toBe(0.75);
    expect(run(governor, clock, 10, 1 / 20)).toBeNull();
    expect(governor.ratio).toBe(0.75);
  });
});
