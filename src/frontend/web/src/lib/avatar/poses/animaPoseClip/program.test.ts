import { describe, expect, it } from "vitest";

import { animaPoseClipHasPose, parseAnyAnimaPoseClip } from "./anyClip";
import { createAnimaPoseClipProgram } from "./program";
import type { AnimaPoseClip } from "./schema";
import type { AnimaPoseClipV2 } from "./schemaV2";

const v1: AnimaPoseClip = {
  schema: "animaPoseClip/1.0",
  id: "nod",
  name: "Nod",
  duration: 1,
  loop: true,
  poses: {
    rest: {
      humanoid: { head: { rotation: [0, 0, 0, 1] } },
      expressions: { happy: 0 },
    },
    down: {
      humanoid: { head: { rotation: [0.1305, 0, 0, 0.9914] } },
      expressions: { happy: 1 },
    },
  },
  poseKeyframes: [
    { time: 0, pose: "rest" },
    { time: 1, pose: "down" },
  ],
};

const v2: AnimaPoseClipV2 = {
  schema: "animaPoseClip/2.0",
  id: "smile",
  name: "Smile",
  duration: 1,
  beats: [
    { id: "start", label: "Start", time: 0 },
    { id: "smile", label: "Smile", time: 0.5 },
  ],
  expressions: {
    happy: [
      { beat: "start", v: 0 },
      { beat: "smile", v: 1 },
    ],
  },
};

describe("parseAnyAnimaPoseClip", () => {
  it("returns a clip it already parsed instead of validating it again", () => {
    for (const value of [v1, v2]) {
      const parsed = parseAnyAnimaPoseClip(value);
      expect(parsed).not.toBe(value);
      expect(parseAnyAnimaPoseClip(parsed)).toBe(parsed);
    }
  });
});

describe("animaPoseClipHasPose", () => {
  it("counts only tracks with keys as moving the body or face", () => {
    const effectOnly = { ...v2, expressions: undefined };
    expect(animaPoseClipHasPose(v2)).toBe(true);
    expect(animaPoseClipHasPose({ ...effectOnly, joints: {} })).toBe(false);
    expect(
      animaPoseClipHasPose({
        ...effectOnly,
        joints: { head: { flexion: [{ beat: "smile", v: 5 }] } },
      }),
    ).toBe(true);
  });
});

describe("createAnimaPoseClipProgram", () => {
  const resolvePose = () => null;

  it("samples a 1.0 clip and lists the expressions it keys", () => {
    const program = createAnimaPoseClipProgram(v1, { resolvePose });
    expect(program.hasPose).toBe(true);
    expect(program.expressionNames).toEqual(["happy"]);
    expect(program.sample(0.5).sample.expressions?.happy).toBeCloseTo(0.5);
    // A loop wraps to its start, but its last frame can still be sampled.
    expect(program.sample(1).sample.expressions?.happy).toBeCloseTo(0);
    expect(
      program.sample(0, { atEnd: true }).sample.expressions?.happy,
    ).toBeCloseTo(1);
  });

  it("samples a prepared 2.0 clip", () => {
    const program = createAnimaPoseClipProgram(v2, { resolvePose });
    expect(program.hasPose).toBe(true);
    expect(program.expressionNames).toEqual(["happy"]);
    expect(program.sample(0.5).sample.expressions?.happy).toBeCloseTo(1);
    expect(program.sample(0, { atEnd: true }).sample.expressions?.happy).toBe(
      1,
    );
  });

  it("reports a 2.0 base pose it cannot resolve", () => {
    const program = createAnimaPoseClipProgram(
      { ...v2, basePose: "missing" },
      { resolvePose },
    );
    expect(program.sample(0).diagnostics.missingPoseRefs).toEqual(["missing"]);
  });
});
