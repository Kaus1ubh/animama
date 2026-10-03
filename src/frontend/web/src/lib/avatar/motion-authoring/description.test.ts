import { describe, expect, it } from "vitest";

import wave from "./examples/wave-hello.motion.json";
import { parseMotionDescription } from "./description";

const minimal = {
  schema: "animamaMotion/1",
  name: "Nod",
  kind: "oneShot",
  duration: 1,
};

const issuesOf = (value: unknown) => {
  const result = parseMotionDescription(value);
  return result.ok ? [] : result.issues;
};

describe("parseMotionDescription", () => {
  it("accepts the shipped example", () => {
    expect(issuesOf(wave)).toEqual([]);
  });

  it("reports each problem with its path", () => {
    const issues = issuesOf({
      ...minimal,
      duration: -1,
      joints: {
        leftWing: {},
        head: {
          flexion: [
            { t: 0.5, v: 0 },
            { t: 0.4, v: 10 },
          ],
          wobble: [{ t: 0, v: 0 }],
        },
        leftUpperArm: { elevation: [{ t: 0, v: 200 }] },
      },
      expressions: { grin: [{ t: 0, v: 1 }], happy: [{ t: 0, v: "base" }] },
      hands: { left: [{ t: 0, preset: "claw", curl: 120 }] },
      mutedProceduralLayers: ["talkingHands"],
    });
    const paths = issues.map((issue) => issue.path);
    expect(paths).toEqual(
      expect.arrayContaining([
        "duration",
        "joints.leftWing",
        "joints.head.flexion[1].t",
        "joints.head.wobble",
        "joints.leftUpperArm.elevation[0].v",
        "expressions.grin",
        "expressions.happy[0].v",
        "hands.left[0].preset",
        "hands.left[0].curl",
        "mutedProceduralLayers[0]",
      ]),
    );
  });

  it("requires plantFeet false before legs are keyed", () => {
    const legs = { joints: { leftLowerLeg: { flexion: [{ t: 0, v: 10 }] } } };
    expect(issuesOf({ ...minimal, ...legs }).map((i) => i.path)).toEqual([
      "joints.leftLowerLeg",
    ]);
    expect(issuesOf({ ...minimal, ...legs, plantFeet: false })).toEqual([]);
  });

  it("requires matching loop hand shapes", () => {
    const issues = issuesOf({
      ...minimal,
      kind: "loop",
      hands: {
        right: [
          { t: 0, preset: "fist" },
          { t: 1, preset: "open-spread" },
        ],
      },
    });
    expect(issues.map((i) => i.path)).toEqual(["hands.right"]);
  });

  it("requires matching loop ends", () => {
    const issues = issuesOf({
      ...minimal,
      kind: "loop",
      joints: {
        head: {
          rotation: [
            { t: 0, v: 0 },
            { t: 1, v: 5 },
          ],
        },
      },
    });
    expect(issues.map((i) => i.path)).toEqual(["joints.head.rotation"]);
  });
});
