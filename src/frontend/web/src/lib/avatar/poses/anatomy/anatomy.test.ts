import type { VRM, VRMHumanBoneName } from "@pixiv/three-vrm";
import { Quaternion, Vector3 } from "three";
import { beforeAll, describe, expect, it } from "vitest";

import {
  JOINT_DEFINITIONS,
  JOINT_IDS,
  angularDistanceDegrees,
  composeJointRotation,
  decomposeJointRotation,
  resolveJoint,
  type JointId,
} from "./anatomy";
import { adjustHandQuaternion } from "./handPresets";
import {
  applyCanonicalPose,
  rawBoneWorldPosition,
} from "../../motion-authoring/kinematics";
import { loadTestAvatar } from "../../motion-authoring/testing/includedAvatars";

const avatars: Record<string, VRM> = {};

beforeAll(async () => {
  avatars.vrm0 = await loadTestAvatar("AvatarSample_Y_0");
  avatars.vrm1 = await loadTestAvatar("AvatarSample_A_1_New");
});

/** Pose one joint and report how a downstream bone moved in world space. */
function displacement(
  vrm: VRM,
  jointId: JointId,
  values: Record<string, number>,
  tip: VRMHumanBoneName,
  context: Record<string, Record<string, number>> = {},
): Vector3 {
  const pose = (extra: Record<string, number> | null) => {
    const entries: Record<
      string,
      { rotation: [number, number, number, number] }
    > = {};
    for (const [id, contextValues] of Object.entries({
      ...context,
      ...(extra ? { [jointId]: extra } : {}),
    })) {
      const joint = resolveJoint(id)!;
      const q = composeJointRotation(joint, contextValues);
      for (const bone of joint.bones)
        entries[bone] = {
          rotation: q.toArray() as [number, number, number, number],
        };
    }
    return entries;
  };
  applyCanonicalPose(vrm, pose(context[jointId] ?? null));
  const before = rawBoneWorldPosition(vrm, tip)!;
  applyCanonicalPose(vrm, pose(values));
  return rawBoneWorldPosition(vrm, tip)!.sub(before);
}

describe.each(["vrm0", "vrm1"])("anatomical directions on %s", (key) => {
  const vrm = () => avatars[key];
  const hanging = {
    leftUpperArm: { elevation: 0 },
    rightUpperArm: { elevation: 0 },
  };

  it("bends the spine and head forward, sideways and around", () => {
    expect(
      displacement(vrm(), "chest", { flexion: 20 }, "head").z,
    ).toBeGreaterThan(0.02);
    expect(
      displacement(vrm(), "chest", { lateralFlexion: 15 }, "head").x,
    ).toBeGreaterThan(0.02);
    expect(
      displacement(vrm(), "head", { rotation: 30 }, "leftEye").x,
    ).toBeGreaterThan(0.005);
    expect(
      displacement(vrm(), "head", { flexion: -20 }, "leftEye").y,
    ).toBeGreaterThan(0.002);
  });

  it.each(["left", "right"] as const)(
    "raises the %s arm in its plane",
    (side) => {
      const lateral = side === "left" ? 1 : -1;
      const hand = `${side}Hand` as VRMHumanBoneName;
      const arm = `${side}UpperArm` as JointId;
      const side90 = displacement(
        vrm(),
        arm,
        { elevation: 90, planeOfElevation: 0 },
        hand,
        hanging,
      );
      expect(side90.x * lateral).toBeGreaterThan(0.2);
      expect(side90.y).toBeGreaterThan(0.2);
      const forward = displacement(
        vrm(),
        arm,
        { elevation: 90, planeOfElevation: 90 },
        hand,
        hanging,
      );
      expect(forward.z).toBeGreaterThan(0.3);
      const overhead = displacement(
        vrm(),
        arm,
        { elevation: 170 },
        hand,
        hanging,
      );
      expect(overhead.y).toBeGreaterThan(0.8);
    },
  );

  it.each(["left", "right"] as const)(
    "bends the %s elbow, wrist and forearm anatomically",
    (side) => {
      const hand = `${side}Hand` as VRMHumanBoneName;
      const hangingArm = { [`${side}UpperArm`]: { elevation: 0 } };
      // With the arm hanging, elbow flexion brings the hand forward and up.
      const elbow = displacement(
        vrm(),
        `${side}LowerArm` as JointId,
        { flexion: 90 },
        hand,
        hangingArm,
      );
      expect(elbow.z).toBeGreaterThan(0.15);
      expect(elbow.y).toBeGreaterThan(0.15);
      // Forearm at 90° with a supinated palm faces up; wrist flexion then lifts the fingers.
      const finger = `${side}MiddleDistal` as VRMHumanBoneName;
      const bent = {
        ...hangingArm,
        [`${side}LowerArm`]: { flexion: 90, supination: 90 },
      };
      expect(
        displacement(
          vrm(),
          `${side}Hand` as JointId,
          { flexion: 60 },
          finger,
          bent,
        ).y,
      ).toBeGreaterThan(0.03);
      // Pronated palm faces down; flexion lowers the fingers.
      const pronated = {
        ...hangingArm,
        [`${side}LowerArm`]: { flexion: 90, supination: -90 },
      };
      expect(
        displacement(
          vrm(),
          `${side}Hand` as JointId,
          { flexion: 60 },
          finger,
          pronated,
        ).y,
      ).toBeLessThan(-0.03);
    },
  );

  it.each(["left", "right"] as const)(
    "moves the %s leg anatomically",
    (side) => {
      const lateral = side === "left" ? 1 : -1;
      const foot = `${side}Foot` as VRMHumanBoneName;
      expect(
        displacement(vrm(), `${side}UpperLeg` as JointId, { flexion: 45 }, foot)
          .z,
      ).toBeGreaterThan(0.2);
      expect(
        displacement(
          vrm(),
          `${side}UpperLeg` as JointId,
          { abduction: 30 },
          foot,
        ).x * lateral,
      ).toBeGreaterThan(0.15);
      expect(
        displacement(vrm(), `${side}LowerLeg` as JointId, { flexion: 60 }, foot)
          .z,
      ).toBeLessThan(-0.15);
      const toes = `${side}Toes` as VRMHumanBoneName;
      expect(
        displacement(
          vrm(),
          `${side}Foot` as JointId,
          { dorsiflexion: 20 },
          toes,
        ).y,
      ).toBeGreaterThan(0.01);
      expect(
        displacement(
          vrm(),
          `${side}UpperLeg` as JointId,
          { rotation: 40 },
          toes,
        ).x * lateral,
      ).toBeGreaterThan(0.02);
    },
  );

  it.each(["left", "right"] as const)(
    "shrugs and protracts the %s shoulder",
    (side) => {
      const hand = `${side}Hand` as VRMHumanBoneName;
      expect(
        displacement(
          vrm(),
          `${side}Shoulder` as JointId,
          { elevation: 20 },
          hand,
        ).y,
      ).toBeGreaterThan(0.02);
      expect(
        displacement(
          vrm(),
          `${side}Shoulder` as JointId,
          { protraction: 15 },
          hand,
        ).z,
      ).toBeGreaterThan(0.02);
    },
  );
});

describe("finger joints", () => {
  it.each(["left", "right"] as const)(
    "match the Hands tool's Curl and Spread on the %s hand",
    (side) => {
      for (const digit of ["index", "middle", "ring", "little"] as const) {
        const id = `${side}${digit[0].toUpperCase()}${digit.slice(1)}Proximal`;
        const joint = resolveJoint(id)!;
        const curl = adjustHandQuaternion(
          new Quaternion(),
          side,
          digit,
          "curl",
          40,
        );
        expect(
          angularDistanceDegrees(
            composeJointRotation(joint, { curl: 40 }),
            curl,
          ),
          id,
        ).toBeLessThan(1e-4);
      }
      // The tool's index Spread fans 0.65° toward the thumb per degree.
      const spread = adjustHandQuaternion(
        new Quaternion(),
        side,
        "index",
        "spread",
        20,
      );
      const splay = composeJointRotation(
        resolveJoint(`${side}IndexProximal`)!,
        { splay: 13 },
      );
      expect(angularDistanceDegrees(splay, spread)).toBeLessThan(1e-4);
      const thumb = adjustHandQuaternion(
        new Quaternion(),
        side,
        "thumb",
        "curl",
        30,
      );
      expect(
        angularDistanceDegrees(
          composeJointRotation(resolveJoint(`${side}ThumbProximal`)!, {
            curl: 30,
          }),
          thumb,
        ),
      ).toBeLessThan(1e-4);
    },
  );

  it.each(["vrm0", "vrm1"])("curls fingers toward the palm on %s", (key) => {
    for (const side of ["left", "right"] as const) {
      const tip = `${side}IndexDistal` as VRMHumanBoneName;
      expect(
        displacement(
          avatars[key],
          `${side}IndexProximal` as JointId,
          { curl: 70 },
          tip,
        ).y,
      ).toBeLessThan(-0.02);
    }
  });
});

describe("joint composition", () => {
  it("round-trips values through decomposition for every joint", () => {
    for (const id of JOINT_IDS) {
      const joint = resolveJoint(id)!;
      const definition = JOINT_DEFINITIONS[joint.type];
      const values = Object.fromEntries(
        Object.entries(definition.components).map(
          ([name, component], index) => [
            name,
            component.soft[0] +
              (component.soft[1] - component.soft[0]) * (0.3 + 0.15 * index),
          ],
        ),
      );
      const q = composeJointRotation(joint, values);
      const recomposed = composeJointRotation(
        joint,
        decomposeJointRotation(joint, q),
      );
      expect(angularDistanceDegrees(q, recomposed), id).toBeLessThan(1e-3);
    }
  });

  it("mirrors right-side joints", () => {
    const left = composeJointRotation(resolveJoint("leftUpperArm")!, {
      elevation: 60,
      planeOfElevation: 30,
      rotation: 20,
    });
    const right = composeJointRotation(resolveJoint("rightUpperArm")!, {
      elevation: 60,
      planeOfElevation: 30,
      rotation: 20,
    });
    expect(right.toArray()).toEqual(
      new Quaternion(left.x, -left.y, -left.z, left.w).toArray(),
    );
  });

  it("rejects unknown joints", () => {
    expect(resolveJoint("leftWing")).toBeNull();
    expect(resolveJoint("tail")).toBeNull();
  });

  it("represents any rotation exactly, using auxiliary components where needed", () => {
    let seed = 7;
    const random = () =>
      ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
    for (const id of JOINT_IDS) {
      const joint = resolveJoint(id)!;
      for (let sample = 0; sample < 20; sample += 1) {
        const rotation = new Quaternion(
          random(),
          random(),
          random(),
          2,
        ).normalize();
        const values = decomposeJointRotation(joint, rotation);
        expect(
          angularDistanceDegrees(composeJointRotation(joint, values), rotation),
        ).toBeLessThan(1e-6);
      }
    }
  });

  it("decomposes near given values without jumping branches", () => {
    const joint = resolveJoint("leftLowerArm")!;
    const near = { flexion: 30, supination: 175, deviation: 0 };
    const rotation = composeJointRotation(joint, {
      flexion: 30,
      supination: 185,
      deviation: 0,
    });
    const values = decomposeJointRotation(joint, rotation, near);
    expect(values.supination).toBeCloseTo(185);
    expect(values.flexion).toBeCloseTo(30);
    expect(
      angularDistanceDegrees(composeJointRotation(joint, values), rotation),
    ).toBeLessThan(1e-6);
  });
});
