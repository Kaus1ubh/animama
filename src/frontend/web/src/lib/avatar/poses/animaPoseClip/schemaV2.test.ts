import { describe, expect, it } from "vitest";

import { serializeAnimaPoseClipFile } from "./clipVocabulary";
import {
  ANIMA_POSE_CLIP_V2_LIMITS,
  ANIMA_POSE_CLIP_V2_MIN_SPACING,
  parseAnimaPoseClipV2,
  validateAnimaPoseClipV2,
  type AnimaPoseClipV2,
} from "./schemaV2";

/** A small valid clip: raise the right arm at "raise", lower it at "settle". */
const clip = (): AnimaPoseClipV2 => ({
  schema: "animaPoseClip/2.0",
  id: "wave",
  name: "Wave",
  duration: 2,
  basePose: "relaxedRest",
  plantFeet: true,
  beats: [
    { id: "start", label: "Start", time: 0 },
    { id: "raise", label: "Raise", time: 0.5 },
    { id: "settle", label: "Settle", time: 1.8, ease: "easeInOutSine" },
  ],
  joints: {
    rightUpperArm: {
      elevation: [
        { beat: "start", v: "base" },
        { beat: "raise", dt: 0.05, v: 108 },
        { beat: "raise", dt: 0.3, v: 100, tangent: "flat" },
        { beat: "settle", v: "base" },
      ],
    },
  },
  rotations: { jaw: [{ beat: "raise", q: [0.05, 0, 0, 1] }] },
  hipsPosition: { x: [{ beat: "raise", v: 0.015, ease: "linear" }] },
  hands: {
    right: [
      { beat: "start", preset: "relaxed" },
      { beat: "raise", dt: -0.05, preset: "open-together", spread: 8 },
    ],
  },
  expressions: {
    happy: [
      { beat: "raise", v: 0.7 },
      { beat: "settle", v: 0 },
    ],
  },
  contacts: [
    { bone: "rightHand", target: "head", beat: "raise", from: 0, to: 0.2 },
  ],
  events: [{ id: "sparkle", time: 0.5, kind: "sfx", cueId: "sparkle" }],
});

const issuesOf = (value: unknown) => {
  const result = validateAnimaPoseClipV2(value);
  if (result.ok) throw new Error("expected issues");
  return result.issues.map(({ path }) => path);
};

describe("animaPoseClip/2.0 validation", () => {
  it("accepts a valid clip and keeps unknown top-level fields", () => {
    const result = validateAnimaPoseClipV2({ ...clip(), generator: { v: 2 } });
    expect(result.ok).toBe(true);
    expect(result.ok && result.clip).toMatchObject({
      ...clip(),
      generator: { v: 2 },
    });
  });

  it("reports structural problems with their paths", () => {
    // A loosely typed copy, to write invalid values.
    const value = JSON.parse(JSON.stringify(clip()));
    value.joints.rightUpperArm.elevation[1].beat = "missing";
    value.joints.rightUpperArm.elevation[2].v = Number.NaN;
    value.joints.leftKnee = { flexion: [{ beat: "raise", v: 1 }] };
    value.joints.head = { wobble: [{ beat: "raise", v: 1 }] };
    value.rotations.tail = [{ beat: "raise", q: [0, 0, 0, 1] }];
    value.rotations.rightUpperArm = [{ beat: "raise", q: [0, 0, 0, 1] }];
    value.rotations.jaw[0].q = [0, 0, 0, 0];
    value.hands.right[1].preset = "claw";
    value.expressions.happy[0].v = 1.5;
    expect(issuesOf(value)).toEqual(
      expect.arrayContaining([
        "joints.rightUpperArm.elevation[1].beat",
        "joints.rightUpperArm.elevation[2].v",
        "joints.leftKnee",
        "joints.head.wobble",
        "rotations.tail",
        "rotations.rightUpperArm",
        "rotations.jaw[0].q",
        "hands.right[1].preset",
        "expressions.happy[0].v",
      ]),
    );
  });

  it("requires ordered keys inside their beat's neighbours", () => {
    const outside = clip();
    outside.joints!.rightUpperArm.elevation[1].dt = 1.4; // past "settle"
    expect(issuesOf(outside)).toContain("joints.rightUpperArm.elevation[1].dt");

    const misordered = clip();
    misordered.joints!.rightUpperArm.elevation[2].dt = 0.01; // before dt 0.05
    expect(issuesOf(misordered)).toContain(
      "joints.rightUpperArm.elevation[2].dt",
    );

    const early = clip();
    early.hands!.right![0].dt = -0.1; // before 0
    expect(issuesOf(early)).toContain("hands.right[0].dt");
  });

  it("requires unique, ordered beats within the clip", () => {
    const value = clip();
    value.beats[2] = { id: "raise", label: "Again", time: 0.4 };
    expect(issuesOf(value)).toEqual(
      expect.arrayContaining(["beats[2].id", "beats[2].time"]),
    );
    expect(issuesOf({ ...clip(), duration: 0 })).toContain("duration");
  });

  it("solves legs instead of accepting leg tracks while feet are planted", () => {
    const value = clip();
    value.joints!.leftLowerLeg = { flexion: [{ beat: "raise", v: 10 }] };
    value.rotations!.rightFoot = [{ beat: "raise", q: [0, 0, 0, 1] }];
    expect(issuesOf(value)).toEqual(
      expect.arrayContaining(["joints.leftLowerLeg", "rotations.rightFoot"]),
    );
    expect(validateAnimaPoseClipV2({ ...value, plantFeet: false }).ok).toBe(
      true,
    );
  });

  it("bounds the number of keys", () => {
    const keys = Array.from(
      { length: ANIMA_POSE_CLIP_V2_LIMITS.keys + 1 },
      (_, index) => ({ beat: "only", dt: index * 1e-5, v: 0 }),
    );
    expect(
      issuesOf({
        ...clip(),
        beats: [{ id: "only", label: "Only", time: 0 }],
        joints: { head: { flexion: keys } },
        rotations: undefined,
        hipsPosition: undefined,
        hands: undefined,
        expressions: undefined,
        contacts: undefined,
      }),
    ).toContain("$");
  });

  it("throws a readable error from parse", () => {
    expect(() => parseAnimaPoseClipV2({ schema: "animaPoseClip/2.0" })).toThrow(
      /id: Expected a non-empty id/,
    );
  });

  it("rejects names inherited from Object.prototype instead of throwing", () => {
    const value = JSON.parse(JSON.stringify(clip()));
    value.joints.toString = { flexion: [{ beat: "raise", v: 0 }] };
    value.joints.constructor = {};
    value.joints.head = { constructor: [{ beat: "raise", v: 0 }] };
    const raw = JSON.stringify(value).replace(
      '"expressions":{',
      '"expressions":{"__proto__":[{"beat":"raise","v":0.5}],',
    );
    expect(issuesOf(JSON.parse(raw))).toEqual(
      expect.arrayContaining([
        "joints.toString",
        "joints.constructor",
        "joints.head.constructor",
        "expressions.__proto__",
      ]),
    );
  });

  it("keeps saved times apart so a valid clip stays valid once rounded", () => {
    const value = clip();
    value.beats[1].time = 0.0003; // 0.3 ms after "start"
    expect(issuesOf(value)).toContain("beats[1].time");
  });

  it("checks contact bones and keeps contacts inside the clip", () => {
    const value = clip();
    value.contacts = [
      { bone: "rightPalm", target: "head", beat: "raise", from: 0, to: 0.1 },
      { bone: "rightHand", target: "head", beat: "settle", from: 0, to: 0.5 },
    ];
    expect(issuesOf(value)).toEqual(["contacts[0]", "contacts[1]"]);
  });

  it("names the length limit of a long beat label", () => {
    const value = clip();
    value.beats[0].label = "x".repeat(81);
    const result = validateAnimaPoseClipV2(value);
    expect(!result.ok && result.issues[0].message).toMatch(/at most 80/);
  });

  it("stays valid after saving at the minimum spacing", () => {
    const value = clip();
    // The closest a key may sit to "settle", its beat's next neighbour.
    value.joints!.rightUpperArm.elevation[2].dt =
      1.3 - ANIMA_POSE_CLIP_V2_MIN_SPACING + 0.00004;
    expect(validateAnimaPoseClipV2(value).ok).toBe(true);
    const saved = JSON.parse(serializeAnimaPoseClipFile(value));
    expect(validateAnimaPoseClipV2(saved).ok).toBe(true);
  });
});
