import type { VRM, VRMHumanBoneName } from "@pixiv/three-vrm";
import { Quaternion } from "three";
import { beforeAll, describe, expect, it } from "vitest";

import { bakeMotion, createMotionEvaluator } from "../../motion-authoring/bake";
import {
  applyCanonicalPose,
  rawBoneWorldPosition,
} from "../../motion-authoring/kinematics";
import { loadTestAvatar } from "../../motion-authoring/testing/includedAvatars";
import {
  angularDistanceDegrees,
  decomposeJointRotation,
  resolveJoint,
} from "../anatomy/anatomy";
import { handShapeRotations } from "../anatomy/handPresets";
import { RELAXED_REST_POSE_ID, getResolvedAvatarPose } from "../catalog";
import { prepareAnimaPoseClipV2 } from "./prepareV2";
import { sampleAnimaPoseClip } from "./sampling";
import type { AnimaPoseClipV2 } from "./schemaV2";

const resolvePose = (id: string) => getResolvedAvatarPose(id);
const base = getResolvedAvatarPose(RELAXED_REST_POSE_ID).humanoid ?? {};

let y0: VRM;
let a1: VRM;
beforeAll(async () => {
  [y0, a1] = await Promise.all([
    loadTestAvatar("AvatarSample_Y_0"),
    loadTestAvatar("AvatarSample_A_1_New"),
  ]);
});

const clip = (overrides: Partial<AnimaPoseClipV2>): AnimaPoseClipV2 => ({
  schema: "animaPoseClip/2.0",
  id: "probe",
  name: "Probe",
  duration: 2,
  basePose: RELAXED_REST_POSE_ID,
  beats: [
    { id: "a", label: "A", time: 0 },
    { id: "b", label: "B", time: 1 },
    { id: "c", label: "C", time: 2 },
  ],
  ...overrides,
});

const rotationOf = (
  sample: ReturnType<ReturnType<typeof prepareAnimaPoseClipV2>["sample"]>,
  bone: VRMHumanBoneName,
) => new Quaternion(...sample.humanoid![bone]!.rotation!);

describe("prepareAnimaPoseClipV2", () => {
  it("arrives at each key with its ease, beat ease or the track default", () => {
    const prepared = prepareAnimaPoseClipV2(
      clip({
        beats: [
          { id: "a", label: "A", time: 0 },
          { id: "b", label: "B", time: 1, ease: "linear" },
          { id: "c", label: "C", time: 2 },
        ],
        expressions: {
          happy: [
            { beat: "a", v: 0 },
            { beat: "b", v: 1 },
            { beat: "c", v: 0, ease: "hold" },
          ],
        },
      }),
      { resolvePose },
    );
    expect(prepared.expressionNames).toEqual(["happy"]);
    expect(prepared.sample(0.25).expressions!.happy).toBeCloseTo(0.25);
    expect(prepared.sample(1.9).expressions!.happy).toBe(1);
    expect(prepared.sample(2).expressions!.happy).toBe(0);
  });

  it("places keys at their beat's time plus their offset", () => {
    const prepared = prepareAnimaPoseClipV2(
      clip({
        expressions: {
          happy: [
            { beat: "a", v: 0, ease: "linear" },
            { beat: "b", dt: -0.5, v: 1, ease: "linear" },
          ],
        },
      }),
      { resolvePose },
    );
    expect(prepared.sample(0.25).expressions!.happy).toBeCloseTo(0.5);
    expect(prepared.sample(0.5).expressions!.happy).toBe(1);
  });

  it("resolves base values and holds the base pose for untracked joints", () => {
    const prepared = prepareAnimaPoseClipV2(
      clip({
        joints: {
          rightUpperArm: {
            elevation: [
              { beat: "a", v: "base" },
              { beat: "b", v: 90 },
            ],
          },
        },
      }),
      { resolvePose },
    );
    const joint = resolveJoint("rightUpperArm")!;
    const baseValues = decomposeJointRotation(
      joint,
      new Quaternion(...base.rightUpperArm!.rotation!),
    );
    const atStart = decomposeJointRotation(
      joint,
      rotationOf(prepared.sample(0), "rightUpperArm"),
    );
    expect(atStart.elevation).toBeCloseTo(baseValues.elevation);
    const atB = decomposeJointRotation(
      joint,
      rotationOf(prepared.sample(1), "rightUpperArm"),
    );
    expect(atB.elevation).toBeCloseTo(90);
    // Unkeyed components hold their base values.
    expect(atB.planeOfElevation).toBeCloseTo(baseValues.planeOfElevation);
    expect(
      angularDistanceDegrees(
        rotationOf(prepared.sample(1), "leftUpperArm"),
        new Quaternion(...base.leftUpperArm!.rotation!),
      ),
    ).toBeLessThan(1e-6);
  });

  it("slerps rotation tracks with the beat's easing", () => {
    const turned = new Quaternion().setFromAxisAngle(
      { x: 0, y: 1, z: 0 } as never,
      Math.PI / 4,
    );
    const prepared = prepareAnimaPoseClipV2(
      clip({
        beats: [
          { id: "a", label: "A", time: 0 },
          { id: "b", label: "B", time: 1, ease: "linear" },
          { id: "c", label: "C", time: 2 },
        ],
        rotations: {
          head: [
            { beat: "a", q: [0, 0, 0, 1] },
            {
              beat: "b",
              q: turned.toArray() as [number, number, number, number],
            },
          ],
        },
      }),
      { resolvePose },
    );
    expect(
      angularDistanceDegrees(
        rotationOf(prepared.sample(0.5), "head"),
        new Quaternion(),
      ),
    ).toBeCloseTo(22.5);
  });

  it("wraps a loop across its seam", () => {
    const prepared = prepareAnimaPoseClipV2(
      clip({
        loop: true,
        expressions: {
          happy: [
            { beat: "a", v: 0, ease: "linear" },
            { beat: "b", v: 1, ease: "linear" },
          ],
        },
      }),
      { resolvePose },
    );
    expect(prepared.sample(1.5).expressions!.happy).toBeCloseTo(0.5);
    expect(prepared.sample(2.25).expressions!.happy).toBeCloseTo(0.25);
  });

  it("fits hand presets to each Avatar and lets finger tracks override them", () => {
    const value = clip({
      hands: { right: [{ beat: "b", preset: "fist", curl: 5 }] },
      joints: { rightIndexDistal: { curl: [{ beat: "b", v: 0 }] } },
    });
    for (const vrm of [y0, a1]) {
      const sample = prepareAnimaPoseClipV2(value, { vrm, resolvePose }).sample(
        1,
      );
      const expected = handShapeRotations(
        vrm,
        "right",
        { preset: "fist", curl: 5 },
        base.rightThumbMetacarpal?.rotation,
      );
      for (const bone of ["rightThumbProximal", "rightMiddleProximal"] as const)
        expect(
          angularDistanceDegrees(rotationOf(sample, bone), expected.get(bone)!),
        ).toBeLessThan(1e-6);
      expect(
        angularDistanceDegrees(
          rotationOf(sample, "rightIndexDistal"),
          new Quaternion(),
        ),
      ).toBeLessThan(1e-6);
    }
  });

  it("plants the feet of each Avatar while the hips move", () => {
    const value = clip({
      plantFeet: true,
      joints: {
        hips: {
          flexion: [
            { beat: "a", v: 0 },
            { beat: "b", v: 12 },
          ],
        },
      },
      hipsPosition: {
        y: [
          { beat: "a", v: 0 },
          { beat: "b", v: -0.04 },
        ],
        x: [
          { beat: "a", v: 0 },
          { beat: "b", v: 0.02 },
        ],
      },
    });
    for (const vrm of [y0, a1]) {
      const prepared = prepareAnimaPoseClipV2(value, { vrm, resolvePose });
      applyCanonicalPose(vrm, prepared.sample(0).humanoid!);
      const rest = rawBoneWorldPosition(vrm, "leftFoot")!.clone();
      applyCanonicalPose(vrm, prepared.sample(1).humanoid!);
      expect(
        rawBoneWorldPosition(vrm, "leftFoot")!.distanceTo(rest),
      ).toBeLessThan(0.002);
    }
  });

  it("holds the base pose's hips offset on untracked axes and for base keys", () => {
    const withOffset = (id: string) =>
      id === "lifted"
        ? {
            schema: "animaPose/1.0",
            id,
            name: id,
            humanoid: { hips: { position: [0, -0.1, 0.02] } },
          }
        : resolvePose(id);
    const prepared = prepareAnimaPoseClipV2(
      clip({
        basePose: "lifted",
        hipsPosition: {
          x: [
            { beat: "a", v: "base" },
            { beat: "b", v: 0.05 },
          ],
        },
      }),
      { resolvePose: withOffset as never },
    );
    expect(prepared.sample(0).humanoid!.hips!.position).toEqual([
      0, -0.1, 0.02,
    ]);
    expect(prepared.sample(1).humanoid!.hips!.position).toEqual([
      0.05, -0.1, 0.02,
    ]);
  });

  it("samples far faster than the 1.0 bake of the same motion", () => {
    const description = {
      schema: "animamaMotion/1" as const,
      name: "Busy",
      kind: "oneShot" as const,
      duration: 3,
      joints: Object.fromEntries(
        (
          [
            "head",
            "neck",
            "chest",
            "spine",
            "rightUpperArm",
            "leftUpperArm",
          ] as const
        ).map((joint, index) => [
          joint,
          {
            [joint.endsWith("UpperArm") ? "elevation" : "flexion"]: Array.from(
              { length: 25 },
              (_, key) => ({ t: key * 0.125, v: 20 + ((key + index) % 2) * 8 }),
            ),
          },
        ]),
      ),
    };
    const baked = bakeMotion(description, a1).clip;
    const v2 = clip({
      duration: 3,
      beats: [{ id: "a", label: "A", time: 0 }],
      joints: Object.fromEntries(
        Object.entries(description.joints).map(([joint, components]) => [
          joint,
          Object.fromEntries(
            Object.entries(components).map(([name, keys]) => [
              name,
              keys.map(({ t, v }) => ({ beat: "a", dt: t, v })),
            ]),
          ),
        ]),
      ),
    });
    const prepared = prepareAnimaPoseClipV2(v2, { vrm: a1, resolvePose });
    const cost = (sample: (t: number) => unknown) => {
      const start = performance.now();
      for (let frame = 0; frame < 120; frame += 1) sample((frame / 120) * 3);
      return performance.now() - start;
    };
    const v1 = cost((t) => sampleAnimaPoseClip(baked, t, resolvePose));
    const v2Cost = cost((t) => prepared.sample(t));
    // Measured about 900× faster on a laptop; 10× leaves room for slow CI.
    expect(v2Cost * 10).toBeLessThan(v1);
  });

  it("matches the motion description's curves for the same keys", () => {
    const description = {
      schema: "animamaMotion/1" as const,
      name: "Probe",
      kind: "oneShot" as const,
      duration: 2,
      joints: {
        rightUpperArm: {
          elevation: [
            { t: 0, v: "base" as const },
            { t: 0.55, v: 108 },
            { t: 1.2, v: 100 },
            { t: 2, v: "base" as const },
          ],
        },
        head: {
          flexion: [
            { t: 0, v: 0 },
            { t: 0.4, v: -5 },
            { t: 1.6, v: 3 },
          ],
        },
      },
      hipsPosition: {
        x: [
          { t: 0, v: 0 },
          { t: 1, v: 0.015 },
          { t: 2, v: 0 },
        ],
      },
      hands: {
        right: [
          { t: 0, preset: "relaxed" as const },
          { t: 0.45, preset: "open-together" as const, spread: 8 },
        ],
      },
      expressions: {
        happy: [
          { t: 0, v: 0 },
          { t: 0.5, v: 0.7 },
          { t: 2, v: 0 },
        ],
      },
    };
    const v2 = clip({
      plantFeet: true,
      beats: [
        { id: "start", label: "Start", time: 0 },
        { id: "raise", label: "Raise", time: 0.5 },
        { id: "settle", label: "Settle", time: 2 },
      ],
      joints: {
        rightUpperArm: {
          elevation: [
            { beat: "start", v: "base" },
            { beat: "raise", dt: 0.05, v: 108 },
            { beat: "raise", dt: 0.7, v: 100 },
            { beat: "settle", v: "base" },
          ],
        },
        head: {
          flexion: [
            { beat: "start", v: 0 },
            { beat: "raise", dt: -0.1, v: -5 },
            { beat: "raise", dt: 1.1, v: 3 },
          ],
        },
      },
      hipsPosition: {
        x: [
          { beat: "start", v: 0 },
          { beat: "raise", dt: 0.5, v: 0.015 },
          { beat: "settle", v: 0 },
        ],
      },
      hands: {
        right: [
          { beat: "start", preset: "relaxed" },
          { beat: "raise", dt: -0.05, preset: "open-together", spread: 8 },
        ],
      },
      expressions: {
        happy: [
          { beat: "start", v: 0 },
          { beat: "raise", v: 0.7 },
          { beat: "settle", v: 0 },
        ],
      },
    });
    const evaluator = createMotionEvaluator(
      { ...description, plantFeet: true },
      base,
      a1,
    );
    const prepared = prepareAnimaPoseClipV2(v2, { vrm: a1, resolvePose });
    for (let t = 0; t <= 2; t += 0.05) {
      const expected = evaluator.humanoid(t);
      const sample = prepared.sample(t);
      for (const [bone, transform] of expected)
        expect(
          angularDistanceDegrees(
            new Quaternion(...transform.rotation!),
            rotationOf(sample, bone),
          ),
        ).toBeLessThan(1e-4);
      expect(sample.expressions!.happy).toBeCloseTo(
        evaluator.expressions(t).happy,
        6,
      );
    }
  });
});
