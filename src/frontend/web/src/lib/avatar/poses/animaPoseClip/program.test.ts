import { describe, expect, it } from "vitest";

import {
  animaPoseClipHasPose,
  parseAnimaPoseClip,
  UnsupportedAnimaPoseClipFormatError,
  unsupportedAnimaPoseClipFormatMessage,
} from "./parseClip";
import { createAnimaPoseClipProgram } from "./program";
import type { AnimaPoseClipV2 } from "./schemaV2";

/** A retired `animaPoseClip/1.0` clip. */
const v1 = {
  schema: "animaPoseClip/1.0",
  id: "nod",
  name: "Nod",
  duration: 1,
  poses: { rest: { expressions: { happy: 0 } } },
  poseKeyframes: [{ time: 0, pose: "rest" }],
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

describe("parseAnimaPoseClip", () => {
  it("returns a clip it already parsed instead of validating it again", () => {
    const parsed = parseAnimaPoseClip(v2);
    expect(parsed).not.toBe(v2);
    expect(parseAnimaPoseClip(parsed)).toBe(parsed);
  });

  it("rejects a retired 1.0 clip and any other schema", () => {
    expect(() => parseAnimaPoseClip(v1)).toThrow(
      UnsupportedAnimaPoseClipFormatError,
    );
    expect(() => parseAnimaPoseClip(v1)).toThrow(
      unsupportedAnimaPoseClipFormatMessage("animaPoseClip/1.0"),
    );
    expect(() => parseAnimaPoseClip({ ...v2, schema: "other/1" })).toThrow(
      unsupportedAnimaPoseClipFormatMessage("other/1"),
    );
    expect(() => parseAnimaPoseClip(null)).toThrow(
      unsupportedAnimaPoseClipFormatMessage(null),
    );
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

  it("wraps a loop to its start, but can still sample its last frame", () => {
    const program = createAnimaPoseClipProgram(
      {
        ...v2,
        loop: true,
        beats: [
          { id: "start", label: "Start", time: 0 },
          { id: "smile", label: "Smile", time: 1, ease: "linear" },
        ],
      },
      { resolvePose },
    );
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
