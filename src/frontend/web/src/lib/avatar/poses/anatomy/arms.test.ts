import type { VRM, VRMHumanBoneName, VRMPose } from "@pixiv/three-vrm";
import { MathUtils, Quaternion, Vector3 } from "three";
import { beforeAll, describe, expect, it } from "vitest";

import {
  applyCanonicalPose,
  rawBoneWorldPosition,
} from "../../motion-authoring/kinematics";
import {
  VRM0_FIXTURE_ID,
  loadTestAvatar,
} from "../../motion-authoring/testing/includedAvatars";
import { RELAXED_REST_POSE_ID, getResolvedAvatarPose } from "../catalog";
import {
  JOINT_DEFINITIONS,
  angularDistanceDegrees,
  composeJointRotation,
  decomposeJointRotation,
  resolveJoint,
  type Side,
} from "./anatomy";
import {
  ArmReachSolver,
  CONTACT_REFERENCE_HEIGHT,
  CanonicalSkeleton,
  SOFT_REACH,
  SkeletonPose,
  avatarScale,
  contactSolveWeight,
  contactTargetPosition,
  fitContactSolveRamps,
  solveArmContacts,
  type ArmContactSolve,
} from "./arms";

/** The VRM 0 test fixture and both Included Avatars. */
const AVATARS = [VRM0_FIXTURE_ID, "AvatarSample_A_1_New", "Andrew"] as const;
type AvatarId = (typeof AVATARS)[number];
const vrms = new Map<AvatarId, VRM>();
/** Rest height of each rig's head bone above its feet, in metres. */
const HEAD_HEIGHT: Record<AvatarId, number> = {
  AvatarSample_Y_0: 1.242,
  AvatarSample_A_1_New: 1.265,
  Andrew: 1.46,
};

beforeAll(async () => {
  for (const id of AVATARS) vrms.set(id, await loadTestAvatar(id));
});

type Joints = Record<string, Record<string, number>>;

/** Relaxed rest with a turned, bent torso and head so targets are not at rest. */
const BODY: Joints = {
  spine: { flexion: 8 },
  chest: { rotation: 6 },
  head: { flexion: 10, lateralFlexion: 5 },
};

/** Canonical pose: relaxed rest, `BODY`, then `joints`, with the hips shifted. */
function posed(joints: Joints): VRMPose {
  const pose: VRMPose = {
    ...(getResolvedAvatarPose(RELAXED_REST_POSE_ID).humanoid ?? {}),
  };
  for (const [id, values] of Object.entries({ ...BODY, ...joints }))
    pose[id as VRMHumanBoneName] = {
      rotation: composeJointRotation(
        resolveJoint(id)!,
        values,
      ).toArray() as Tuple4,
    };
  pose.hips = { ...pose.hips, position: [0.01, -0.02, 0.015] };
  return pose;
}

type Tuple4 = [number, number, number, number];

/**
 * Declared contacts near natural authored arms: 2–5 cm away on Annie and the
 * VRM 0 fixture, 6–9 cm on Andrew, who is taller with longer arms.
 */
const SCENARIOS: {
  name: string;
  joints: Joints;
  contact: Omit<ArmContactSolve, "weight">;
}[] = [
  {
    name: "palm onto the chin",
    joints: {
      rightUpperArm: { elevation: 65, planeOfElevation: 90, rotation: 60 },
      rightLowerArm: { flexion: 140 },
    },
    contact: {
      bone: "rightHand",
      point: "palm",
      target: "head",
      offset: [0, 0, 0.08],
    },
  },
  {
    name: "palm onto the hips",
    joints: {
      leftUpperArm: { elevation: 55, planeOfElevation: 10, rotation: -80 },
      leftLowerArm: { flexion: 90 },
    },
    contact: {
      bone: "leftHand",
      point: "palm",
      target: "hips",
      offset: [0.14, 0, 0],
    },
  },
  {
    name: "palm onto the other forearm",
    joints: {
      rightUpperArm: { elevation: 25, planeOfElevation: 100, rotation: -70 },
      rightLowerArm: { flexion: 115 },
      leftUpperArm: { elevation: 45, planeOfElevation: 70, rotation: -60 },
      leftLowerArm: { flexion: 125 },
    },
    contact: {
      bone: "leftHand",
      point: "palm",
      target: "rightLowerArm",
      offset: [-0.12, 0.03, 0],
    },
  },
  {
    name: "index tip onto the brow",
    joints: {
      rightUpperArm: { elevation: 55, planeOfElevation: 90, rotation: 80 },
      rightLowerArm: { flexion: 140 },
      rightIndexProximal: { curl: 10 },
    },
    contact: {
      bone: "rightIndexDistal",
      point: "tip",
      target: "head",
      offset: [-0.03, 0.09, 0.08],
    },
  },
  {
    name: "wrist joint onto the hip",
    joints: {
      leftUpperArm: { elevation: 55, planeOfElevation: 10, rotation: -80 },
      leftLowerArm: { flexion: 90 },
    },
    contact: {
      bone: "leftHand",
      point: "joint",
      target: "hips",
      offset: [0.16, 0.05, -0.02],
    },
  },
  {
    name: "wrist (the default point) onto the other forearm",
    joints: {
      rightUpperArm: { elevation: 25, planeOfElevation: 100, rotation: -70 },
      rightLowerArm: { flexion: 115 },
      leftUpperArm: { elevation: 45, planeOfElevation: 70, rotation: -60 },
      leftLowerArm: { flexion: 125 },
    },
    contact: {
      bone: "leftHand",
      target: "rightLowerArm",
      offset: [-0.1, 0.05, 0],
    },
  },
  {
    // A clap is one-sided: the right palm meets the left one.
    name: "palm onto the other palm (a clap)",
    joints: {
      leftUpperArm: { elevation: 47, planeOfElevation: 72, rotation: 43 },
      leftLowerArm: { flexion: 83 },
      rightUpperArm: { elevation: 47, planeOfElevation: 72, rotation: 43 },
      rightLowerArm: { flexion: 83 },
    },
    contact: {
      bone: "rightHand",
      point: "palm",
      target: "leftHand",
      targetPoint: "palm",
    },
  },
];

/**
 * Contacts on both arms where each target rides on the other upper arm or
 * forearm. (Clips may not solve a mutual pair onto the other hand or its
 * fingers: each hand would chase the other.)
 */
const MUTUAL: {
  name: string;
  joints: Joints;
  contacts: Omit<ArmContactSolve, "weight">[];
}[] = [
  {
    name: "arms crossed, hands on the upper arms",
    joints: {
      leftUpperArm: { elevation: 35, planeOfElevation: 70, rotation: 0 },
      leftLowerArm: { flexion: 125 },
      rightUpperArm: { elevation: 50, planeOfElevation: 70, rotation: -20 },
      rightLowerArm: { flexion: 125 },
    },
    contacts: [
      {
        bone: "leftHand",
        point: "palm",
        target: "rightUpperArm",
        offset: [-0.15, 0, 0.04],
      },
      {
        bone: "rightHand",
        point: "palm",
        target: "leftUpperArm",
        offset: [0.15, 0, 0.04],
      },
    ],
  },
];

const sideOf = (bone: string): Side =>
  bone.startsWith("left") ? "left" : "right";

type Rig = {
  vrm: VRM;
  skeleton: CanonicalSkeleton;
  pose: SkeletonPose;
  solvers: Record<Side, ArmReachSolver>;
  scale: number;
};

function rig(id: AvatarId): Rig {
  const vrm = vrms.get(id)!;
  const skeleton = new CanonicalSkeleton(vrm);
  return {
    vrm,
    skeleton,
    pose: new SkeletonPose(skeleton),
    solvers: {
      left: new ArmReachSolver(skeleton, "left"),
      right: new ArmReachSolver(skeleton, "right"),
    },
    scale: avatarScale(skeleton),
  };
}

/** Distance from a contact's point to its target on the evaluated pose. */
function miss(
  { pose, scale }: Rig,
  contact: Omit<ArmContactSolve, "weight">,
): number {
  const effector = pose.contactPoint(
    contact.bone,
    contact.point,
    new Vector3(),
  )!;
  const target = contactTargetPosition(pose, contact, scale, new Vector3())!;
  return effector.distanceTo(target);
}

/** The pose with the evaluated pose's arm rotations written back. */
function withSolvedArms(pose: VRMPose, solved: SkeletonPose): VRMPose {
  const result = { ...pose };
  for (const side of ["left", "right"] as const)
    for (const bone of [`${side}UpperArm`, `${side}LowerArm`] as const)
      result[bone] = {
        rotation: solved.localRotation(bone)!.toArray() as Tuple4,
      };
  return result;
}

/** Joint values that leave a component's hard range, as messages. */
function hardLimitViolations(pose: SkeletonPose, sides: Side[]): string[] {
  const violations: string[] = [];
  for (const side of sides)
    for (const type of ["upperArm", "lowerArm"] as const) {
      const id = `${side}${type === "upperArm" ? "UpperArm" : "LowerArm"}`;
      const values = decomposeJointRotation(
        resolveJoint(id)!,
        pose.localRotation(id as VRMHumanBoneName)!.clone(),
      );
      for (const [name, component] of Object.entries(
        JOINT_DEFINITIONS[type].components,
      )) {
        const [low, high] = component.hard;
        if (values[name] < low - 1e-6 || values[name] > high + 1e-6)
          violations.push(`${id}.${name} = ${values[name].toFixed(1)}`);
      }
    }
  return violations;
}

/**
 * Signed angle (degrees) of the elbow about the shoulder→effector axis,
 * measured from `reference`: how the elbow swivels around that axis.
 */
function swivel(
  pose: SkeletonPose,
  side: Side,
  effector: Vector3,
  reference: Vector3,
): number {
  const shoulder = pose.position(`${side}UpperArm`)!;
  const axis = effector.clone().sub(shoulder).normalize();
  const project = (vector: Vector3) =>
    vector.addScaledVector(axis, -vector.dot(axis));
  project(reference);
  const elbow = project(
    pose.position(`${side}LowerArm`)!.clone().sub(shoulder),
  );
  return MathUtils.radToDeg(
    Math.atan2(
      new Vector3().crossVectors(reference, elbow).dot(axis),
      reference.dot(elbow),
    ),
  );
}

describe("CanonicalSkeleton", () => {
  it.each(AVATARS)(
    "matches %s's skinned rig: joints, rest scale and contact points",
    (id) => {
      const { vrm, skeleton, pose, scale } = rig(id);
      expect(scale * CONTACT_REFERENCE_HEIGHT).toBeCloseTo(HEAD_HEIGHT[id], 2);

      applyCanonicalPose(vrm, {});
      const restRotations = new Map(
        skeleton.bones.map((bone) => [
          bone,
          vrm.humanoid
            .getRawBoneNode(bone)!
            .getWorldQuaternion(new Quaternion()),
        ]),
      );
      const canonical = posed(SCENARIOS[2].joints);
      applyCanonicalPose(vrm, canonical);
      const frames = skeleton.frames(canonical);
      expect(frames.size).toBe(skeleton.bones.length);
      for (const [bone, frame] of frames) {
        expect(
          rawBoneWorldPosition(vrm, bone)!.distanceTo(frame.position),
        ).toBeLessThan(1e-5);
        // Canonical world rotation = raw world rotation from its rest.
        const raw = vrm.humanoid
          .getRawBoneNode(bone)!
          .getWorldQuaternion(new Quaternion())
          .multiply(restRotations.get(bone)!.clone().invert());
        expect(angularDistanceDegrees(raw, frame.rotation)).toBeLessThan(1e-3);
      }

      pose.setPose(canonical);
      for (const side of ["left", "right"] as const) {
        const palm = skeleton.pointOffset(`${side}Hand`, "palm")!;
        const middle = skeleton.restOffset(`${side}MiddleProximal`)!;
        const depth = 0.3 * middle.length();
        expect(palm.x).toBeCloseTo(0.5 * middle.x, 9);
        expect(palm.y).toBeCloseTo(0.5 * middle.y - depth, 9);
        expect(palm.z).toBeCloseTo(0.5 * middle.z, 9);
        // The palm surface is 1.5–2.5 cm below the wrist-to-knuckle line.
        expect(depth).toBeGreaterThan(0.015);
        expect(depth).toBeLessThan(0.025);
        expect(skeleton.pointOffset(`${side}IndexDistal`, "tip")).toEqual(
          skeleton
            .restOffset(`${side}IndexDistal`)!
            .clone()
            .multiplyScalar(0.8),
        );
        expect(skeleton.pointOffset(`${side}IndexIntermediate`, "tip")).toEqual(
          skeleton.restOffset(`${side}IndexDistal`),
        );
        // The tip of a non-last segment is the next joint.
        expect(
          pose
            .contactPoint(`${side}IndexIntermediate`, "tip", new Vector3())!
            .distanceTo(pose.position(`${side}IndexDistal`)!),
        ).toBeLessThan(1e-9);
      }
      expect(() => skeleton.pointOffset("leftIndexDistal", "palm")).toThrow(
        /hand bone/,
      );
      expect(() => skeleton.pointOffset("leftHand", "tip")).toThrow(
        /finger bone/,
      );
    },
  );
});

describe("contactSolveWeight", () => {
  const window = { start: 1, end: 2, blendIn: 0.2, blendOut: 0.4 };

  it("holds inside the window and eases in and out with smootherstep", () => {
    const weight = (t: number) => contactSolveWeight(window, t, 4, false);
    expect(weight(0.7)).toBe(0);
    expect(weight(0.8)).toBeCloseTo(0, 12);
    expect(weight(0.9)).toBeCloseTo(0.5, 9);
    expect(weight(1)).toBe(1);
    expect(weight(1.5)).toBe(1);
    expect(weight(2.2)).toBeCloseTo(0.5, 9);
    expect(weight(2.4)).toBeCloseTo(0, 12);
    expect(weight(2.5)).toBe(0);
    // Smootherstep ramps start and end flat (a linear ramp would be 5% off).
    expect(weight(0.81)).toBeLessThan(0.002);
    expect(weight(0.99)).toBeGreaterThan(0.998);
    expect(weight(2.02)).toBeGreaterThan(0.998);
    expect(weight(2.38)).toBeLessThan(0.002);
    let previous = 0;
    for (let t = 0.8; t <= 1; t += 0.01) {
      expect(weight(t)).toBeGreaterThanOrEqual(previous - 1e-12);
      previous = weight(t);
    }
  });

  it("wraps ramps across a loop's seam and clamps one-shots", () => {
    const early = { start: 0.05, end: 0.3, blendIn: 0.2, blendOut: 0.1 };
    expect(contactSolveWeight(early, 1.95, 2, true)).toBeCloseTo(0.5, 9);
    expect(contactSolveWeight(early, 1.95, 2, false)).toBe(0);
    const late = { start: 1.5, end: 1.95, blendIn: 0.1, blendOut: 0.2 };
    expect(contactSolveWeight(late, 0.05, 2, true)).toBeCloseTo(0.5, 9);
    expect(contactSolveWeight(late, 0.05, 2, false)).toBe(0);
    // Past the end of a one-shot: held at the clip's last moment.
    expect(contactSolveWeight(late, 3, 2, false)).toBe(
      contactSolveWeight(late, 2, 2, false),
    );
  });

  it("switches instantly without a ramp", () => {
    const sharp = { start: 1, end: 2, blendIn: 0, blendOut: 0 };
    expect(contactSolveWeight(sharp, 0.999, 3, false)).toBe(0);
    expect(contactSolveWeight(sharp, 1, 3, false)).toBe(1);
    expect(contactSolveWeight(sharp, 2.001, 3, false)).toBe(0);
  });
});

describe("fitContactSolveRamps", () => {
  it("shortens overlapping ramps to meet midway and keeps the input", () => {
    const windows = [
      { id: "second", start: 0.5, end: 0.6, blendIn: 0.15, blendOut: 0.15 },
      { id: "first", start: 0.2, end: 0.3, blendIn: 0.15, blendOut: 0.15 },
    ];
    const fitted = fitContactSolveRamps(windows, 1, false);
    expect(fitted.map(({ id }) => id)).toEqual(["second", "first"]);
    expect(fitted[1].blendOut).toBeCloseTo(0.1, 12);
    expect(fitted[0].blendIn).toBeCloseTo(0.1, 12);
    // Unpaired ramps keep their length; the input is not changed.
    expect(fitted[1].blendIn).toBe(0.15);
    expect(fitted[0].blendOut).toBe(0.15);
    expect(windows[0].blendIn).toBe(0.15);
    // Chained claps: the weight returns to zero between them, never overlapping.
    for (let t = 0; t <= 1; t += 0.005) {
      const [second, first] = fitted.map((window) =>
        contactSolveWeight(window, t, 1, false),
      );
      expect(Math.min(first, second)).toBe(0);
    }
  });

  it("lets a long ramp take what a short neighbour leaves", () => {
    const [before, after] = fitContactSolveRamps(
      [
        { start: 0, end: 0.3, blendIn: 0, blendOut: 0.15 },
        { start: 0.4, end: 0.6, blendIn: 0.02, blendOut: 0 },
      ],
      1,
      false,
    );
    expect(before.blendOut).toBeCloseTo(0.08, 12);
    expect(after.blendIn).toBe(0.02);
  });

  it("pairs the last window with the first across a loop's seam", () => {
    const [only] = fitContactSolveRamps(
      [{ start: 0.1, end: 0.9, blendIn: 0.15, blendOut: 0.15 }],
      1,
      true,
    );
    expect(only.blendIn).toBeCloseTo(0.1, 12);
    expect(only.blendOut).toBeCloseTo(0.1, 12);
  });
});

describe.each(AVATARS)("ArmReachSolver on %s", (id) => {
  it.each(SCENARIOS)("lands the $name", ({ joints, contact }) => {
    const avatar = rig(id);
    const { vrm, skeleton, pose, solvers, scale } = avatar;
    const side = sideOf(contact.bone);
    const canonical = posed(joints);
    pose.setPose(canonical);
    const before = miss(avatar, contact);
    // The authored arm is close but off its contact.
    expect(before).toBeGreaterThan(0.01);
    expect(before).toBeLessThan(0.1);

    const errors = solveArmContacts(
      pose,
      solvers,
      [{ ...contact, weight: 1 }],
      scale,
    );
    expect(errors[side]).toBeLessThan(1e-6);
    expect(miss(avatar, contact)).toBeLessThan(0.005);
    expect(hardLimitViolations(pose, [side])).toEqual([]);
    // The collarbone, wrist and fingers keep their authored local rotations.
    for (const bone of [
      `${side}Shoulder`,
      `${side}Hand`,
      `${side}IndexProximal`,
    ] as const)
      expect(
        angularDistanceDegrees(
          pose.localRotation(bone)!.clone(),
          new Quaternion(...(canonical[bone]?.rotation ?? [0, 0, 0, 1])),
        ),
      ).toBeLessThan(1e-6);

    // The skinned rig agrees: measure on raw bones the way the checks do.
    applyCanonicalPose(vrm, {});
    const rest = (bone: VRMHumanBoneName) =>
      vrm.humanoid.getRawBoneNode(bone)!.getWorldQuaternion(new Quaternion());
    const effectorRest = rest(contact.bone);
    const targetRest = rest(contact.target);
    applyCanonicalPose(vrm, withSolvedArms(canonical, pose));
    const fromRest = (bone: VRMHumanBoneName, restRotation: Quaternion) =>
      vrm.humanoid
        .getRawBoneNode(bone)!
        .getWorldQuaternion(new Quaternion())
        .multiply(restRotation.clone().invert());
    const effector = skeleton
      .pointOffset(contact.bone, contact.point)!
      .clone()
      .applyQuaternion(fromRest(contact.bone, effectorRest))
      .add(rawBoneWorldPosition(vrm, contact.bone)!);
    const target = skeleton
      .pointOffset(contact.target, contact.targetPoint)!
      .clone()
      .add(new Vector3(...(contact.offset ?? [0, 0, 0])).multiplyScalar(scale))
      .applyQuaternion(fromRest(contact.target, targetRest))
      .add(rawBoneWorldPosition(vrm, contact.target)!);
    expect(effector.distanceTo(target)).toBeLessThan(0.015);
  });

  it.each(SCENARIOS)(
    "returns the authored arm for the authored effector ($name)",
    ({ joints, contact }) => {
      const { pose, solvers } = rig(id);
      const side = sideOf(contact.bone);
      pose.setPose(posed(joints));
      const authored = pose.contactPoint(
        contact.bone,
        contact.point,
        new Vector3(),
      )!;
      const solver = solvers[side];
      const atAuthored = solver.solve(pose, contact, authored, 1);
      const unweighted = solver.solve(
        pose,
        contact,
        authored.clone().add(new Vector3(0.2, -0.1, 0.3)),
        0,
      );
      for (const result of [atAuthored, unweighted]) {
        expect(
          angularDistanceDegrees(
            result.upperArm,
            pose.localRotation(`${side}UpperArm`)!.clone(),
          ),
        ).toBeLessThan(0.01);
        expect(
          angularDistanceDegrees(
            result.lowerArm,
            pose.localRotation(`${side}LowerArm`)!.clone(),
          ),
        ).toBeLessThan(0.01);
      }
    },
  );

  it.each(SCENARIOS)(
    "keeps the elbow's swivel for a small correction ($name)",
    ({ joints, contact }) => {
      const { pose, solvers } = rig(id);
      const side = sideOf(contact.bone);
      pose.setPose(posed(joints));
      const authored = pose.contactPoint(
        contact.bone,
        contact.point,
        new Vector3(),
      )!;
      // Read the swivel against a reference perpendicular to the arm's
      // shoulder→effector axis, where the reading is well conditioned.
      const axis = authored
        .clone()
        .sub(pose.position(`${side}UpperArm`)!)
        .normalize();
      const reference = [
        new Vector3(1, 0, 0),
        new Vector3(0, 1, 0),
        new Vector3(0, 0, 1),
      ]
        .sort((a, b) => Math.abs(a.dot(axis)) - Math.abs(b.dot(axis)))[0]
        .projectOnPlane(axis)
        .normalize();
      const swivelBefore = swivel(pose, side, authored, reference.clone());
      for (const nudge of [
        new Vector3(0.02, 0, 0),
        new Vector3(0, -0.02, 0),
        new Vector3(0, 0.01, 0.02),
      ]) {
        const target = authored.clone().add(nudge);
        const result = solvers[side].solve(pose, contact, target, 1);
        const solved = new SkeletonPose(pose.skeleton).setPose(posed(joints));
        solved.setLocalRotation(`${side}UpperArm`, result.upperArm);
        solved.setLocalRotation(`${side}LowerArm`, result.lowerArm);
        const reached = solved.contactPoint(
          contact.bone,
          contact.point,
          new Vector3(),
        )!;
        expect(reached.distanceTo(target)).toBeLessThan(1e-4);
        expect(
          Math.abs(
            swivel(solved, side, reached, reference.clone()) - swivelBefore,
          ),
        ).toBeLessThan(1);
      }
    },
  );

  it.each(SCENARIOS)(
    "moves continuously as the weight ramps ($name)",
    ({ joints, contact }) => {
      const { pose, solvers, scale } = rig(id);
      const side = sideOf(contact.bone);
      pose.setPose(posed(joints));
      const target = contactTargetPosition(
        pose,
        contact,
        scale,
        new Vector3(),
      )!;
      const authored = pose.contactPoint(
        contact.bone,
        contact.point,
        new Vector3(),
      )!;
      const span = authored.distanceTo(target);
      let previous: {
        upper: Quaternion;
        lower: Quaternion;
        at: Vector3;
      } | null = null;
      const steps = 200;
      for (let step = 0; step <= steps; step += 1) {
        const weight = step / steps;
        const result = solvers[side].solve(pose, contact, target, weight);
        const solved = new SkeletonPose(pose.skeleton).setPose(posed(joints));
        solved.setLocalRotation(`${side}UpperArm`, result.upperArm);
        solved.setLocalRotation(`${side}LowerArm`, result.lowerArm);
        const at = solved.contactPoint(
          contact.bone,
          contact.point,
          new Vector3(),
        )!;
        expect(
          at.distanceTo(authored.clone().lerp(target, weight)),
        ).toBeLessThan(1e-5);
        if (previous) {
          expect(at.distanceTo(previous.at)).toBeLessThan(
            (span / steps) * 1.01,
          );
          expect(
            angularDistanceDegrees(previous.upper, result.upperArm),
          ).toBeLessThan(0.2);
          expect(
            angularDistanceDegrees(previous.lower, result.lowerArm),
          ).toBeLessThan(0.2);
        }
        previous = {
          upper: result.upperArm.clone(),
          lower: result.lowerArm.clone(),
          at,
        };
      }
    },
  );

  it("clamps unreachable targets without NaN", () => {
    const { pose, solvers } = rig(id);
    const { joints, contact } = SCENARIOS[0];
    pose.setPose(posed(joints));
    const shoulder = pose.position("rightUpperArm")!.clone();
    const flexion = JOINT_DEFINITIONS.lowerArm.components.flexion.hard;
    for (const target of [
      shoulder.clone().add(new Vector3(-0.3, 0.4, 2)),
      shoulder.clone(),
      pose.position("rightLowerArm")!.clone(),
    ]) {
      const result = solvers.right.solve(pose, contact, target, 1);
      for (const value of [
        ...result.upperArm.toArray(),
        ...result.lowerArm.toArray(),
      ])
        expect(Number.isFinite(value)).toBe(true);
      expect(Number.isFinite(result.error)).toBe(true);
      const { flexion: solvedFlexion } = decomposeJointRotation(
        resolveJoint("rightLowerArm")!,
        result.lowerArm,
      );
      expect(solvedFlexion).toBeGreaterThanOrEqual(flexion[0] - 1e-6);
      expect(solvedFlexion).toBeLessThanOrEqual(flexion[1] + 1e-6);
    }
    // Out of reach: the arm extends toward the target and reports the miss.
    const far = shoulder.clone().add(new Vector3(-0.3, 0.4, 2));
    const result = solvers.right.solve(pose, contact, far, 1);
    const solved = new SkeletonPose(pose.skeleton).setPose(posed(joints));
    solved.setLocalRotation("rightUpperArm", result.upperArm);
    solved.setLocalRotation("rightLowerArm", result.lowerArm);
    const reached = solved.contactPoint(
      contact.bone,
      contact.point,
      new Vector3(),
    )!;
    expect(
      MathUtils.radToDeg(
        reached.clone().sub(shoulder).angleTo(far.clone().sub(shoulder)),
      ),
    ).toBeLessThan(0.01);
    expect(result.error).toBeCloseTo(far.distanceTo(reached), 6);
    expect(result.error).toBeGreaterThan(1.4);
  });

  describe("soft reach", () => {
    /** The right palm with the elbow bent `flexion` degrees, arm forward. */
    const reaching = (flexion: number): Joints => ({
      rightUpperArm: { elevation: 80, planeOfElevation: 80, rotation: 40 },
      rightLowerArm: { flexion, supination: 30 },
    });
    const palm = { bone: "rightHand", point: "palm" } as const;

    /**
     * Peak angular speed of the upper arm and elbow, degrees per unit of
     * weight, as the weight ramps 0→1 in `steps` equal steps.
     */
    function peakSpeed(
      pose: SkeletonPose,
      solver: ArmReachSolver,
      target: Vector3,
      steps: number,
    ): number {
      let peak = 0;
      let previous = solver.solve(pose, palm, target, 0);
      previous = {
        ...previous,
        upperArm: previous.upperArm.clone(),
        lowerArm: previous.lowerArm.clone(),
      };
      for (let step = 1; step <= steps; step += 1) {
        const result = solver.solve(pose, palm, target, step / steps);
        peak = Math.max(
          peak,
          angularDistanceDegrees(previous.upperArm, result.upperArm) * steps,
          angularDistanceDegrees(previous.lowerArm, result.lowerArm) * steps,
        );
        previous.upperArm.copy(result.upperArm);
        previous.lowerArm.copy(result.lowerArm);
      }
      return peak;
    }

    it.each([20, 60, 90])(
      "keeps the elbow's speed bounded past full reach (elbow at %s°)",
      (flexion) => {
        const { pose, solvers } = rig(id);
        pose.setPose(posed(reaching(flexion)));
        const effector = pose.contactPoint("rightHand", "palm", new Vector3())!;
        const shoulder = pose.position("rightUpperArm")!.clone();
        for (const beyond of [0.1, 0.25]) {
          const target = effector
            .clone()
            .sub(shoulder)
            .setLength(beyond)
            .add(effector)
            .add(new Vector3(0, 0.05, 0));
          // A bounded speed converges as the steps get finer; a hard clamp at
          // full reach has a square-root singularity whose peak keeps growing
          // (about √10 times per tenfold refinement).
          const coarse = peakSpeed(pose, solvers.right, target, 400);
          const fine = peakSpeed(pose, solvers.right, target, 4000);
          expect(fine).toBeLessThan(coarse * 1.2);
          const { error } = solvers.right.solve(pose, palm, target, 1);
          expect(Number.isFinite(error)).toBe(true);
          // 25 cm past the authored palm is beyond every one of these arms.
          if (beyond > 0.2) expect(error).toBeGreaterThan(0.05);
        }
      },
    );

    it("lands a target at full reach within the soft reach's shortfall", () => {
      const { pose, solvers } = rig(id);
      pose.setPose(posed(reaching(40)));
      const effector = pose.contactPoint("rightHand", "palm", new Vector3())!;
      const shoulder = pose.position("rightUpperArm")!.clone();
      // Push outward until the arm cannot reach farther: full reach.
      const along = effector.clone().sub(shoulder).normalize();
      const reachOf = (distance: number) => {
        const target = along.clone().multiplyScalar(distance).add(shoulder);
        return (
          target.distanceTo(shoulder) -
          solvers.right.solve(pose, palm, target, 1).error
        );
      };
      const full = reachOf(2);
      for (const short of [0, 0.01, 0.03, 0.05]) {
        const target = along
          .clone()
          .multiplyScalar(full - short)
          .add(shoulder);
        const { error } = solvers.right.solve(pose, palm, target, 1);
        if (short >= SOFT_REACH) expect(error).toBeLessThan(1e-6);
        else expect(error).toBeLessThanOrEqual(SOFT_REACH / Math.E + 1e-4);
      }
    });

    it("returns a nearly straight authored arm unchanged at zero weight", () => {
      const { pose, solvers } = rig(id);
      pose.setPose(posed(reaching(4)));
      const effector = pose.contactPoint("rightHand", "palm", new Vector3())!;
      const target = effector.clone().add(new Vector3(0.1, 0.05, 0.2));
      const authored = pose.localRotation("rightLowerArm")!.clone();
      const still = solvers.right.solve(pose, palm, target, 0);
      expect(angularDistanceDegrees(still.lowerArm, authored)).toBeLessThan(
        1e-6,
      );
      // Continuous from there: a tiny weight barely moves the elbow.
      const nudged = solvers.right.solve(pose, palm, target, 1e-6);
      expect(angularDistanceDegrees(nudged.lowerArm, authored)).toBeLessThan(
        0.01,
      );
    });
  });

  it("converges mutual contacts: crossed arms", () => {
    const avatar = rig(id);
    const { pose, solvers, scale } = avatar;
    for (const { joints, contacts } of MUTUAL) {
      pose.setPose(posed(joints));
      expect(
        Math.max(...contacts.map((contact) => miss(avatar, contact))),
      ).toBeGreaterThan(0.01);
      solveArmContacts(
        pose,
        solvers,
        contacts.map((contact) => ({ ...contact, weight: 1 })),
        scale,
      );
      for (const contact of contacts)
        expect(miss(avatar, contact)).toBeLessThan(0.01);
      expect(hardLimitViolations(pose, ["left", "right"])).toEqual([]);
    }
  });

  it("pins a partial weight once, also when mutual contacts re-solve", () => {
    const avatar = rig(id);
    const { pose, scale, solvers } = avatar;
    const { joints, contacts } = MUTUAL[0];
    pose.setPose(posed(joints));
    const authored = contacts.map(
      (contact) =>
        pose.contactPoint(contact.bone, contact.point, new Vector3())!,
    );
    const weight = 0.6;
    solveArmContacts(
      pose,
      solvers,
      contacts.map((contact) => ({ ...contact, weight })),
      scale,
    );
    contacts.forEach((contact, index) => {
      const target = contactTargetPosition(
        pose,
        contact,
        scale,
        new Vector3(),
      )!;
      const pinned = authored[index].clone().lerp(target, weight);
      expect(
        pose
          .contactPoint(contact.bone, contact.point, new Vector3())!
          .distanceTo(pinned),
      ).toBeLessThan(0.005);
    });
  });

  it("solves the arm a target rides on first", () => {
    const avatar = rig(id);
    const { pose, solvers, scale } = avatar;
    const { joints, contact } = SCENARIOS[2];
    // The right arm reaches for the chin while the left palm rests on it.
    const chin = {
      ...SCENARIOS[0].contact,
      weight: 1,
    };
    pose.setPose(posed(joints));
    solveArmContacts(pose, solvers, [{ ...contact, weight: 1 }, chin], scale);
    expect(miss(avatar, chin)).toBeLessThan(0.005);
    expect(miss(avatar, contact)).toBeLessThan(0.005);
  });
});
