import type { VRM, VRMHumanBoneName, VRMPose } from "@pixiv/three-vrm";
import { Quaternion, Vector3 } from "three";
import { beforeAll, describe, expect, it } from "vitest";

import {
  applyCanonicalPose,
  rawBoneWorldPosition,
} from "../../motion-authoring/kinematics";
import {
  VRM0_FIXTURE_ID,
  loadTestAvatar,
  loadVrm0Fixture,
} from "../../motion-authoring/testing/includedAvatars";
import {
  angularDistanceDegrees,
  decomposeJointRotation,
  resolveJoint,
} from "../anatomy/anatomy";
import { CanonicalSkeleton, avatarScale } from "../anatomy/arms";
import { handShapeRotations } from "../anatomy/handPresets";
import { RELAXED_REST_POSE_ID, getResolvedAvatarPose } from "../catalog";
import { prepareAnimaPoseClipV2 } from "./prepareV2";
import { createAnimaPoseClipProgram } from "./program";
import {
  validateAnimaPoseClipV2,
  type AnimaPoseClipContact,
  type AnimaPoseClipV2,
} from "./schemaV2";

const resolvePose = (id: string) => getResolvedAvatarPose(id);
const base = getResolvedAvatarPose(RELAXED_REST_POSE_ID).humanoid ?? {};

let y0: VRM;
let a1: VRM;
beforeAll(async () => {
  [y0, a1] = await Promise.all([
    loadVrm0Fixture(),
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
});

/**
 * Distance between a contact's point and its target on the skinned rig, the
 * way the motion checks measure it: raw bone positions, frames carried from
 * each bone's rest, and the offset scaled to the Avatar.
 */
function skinnedMiss(
  vrm: VRM,
  humanoid: VRMPose,
  contact: AnimaPoseClipContact,
): number {
  const skeleton = new CanonicalSkeleton(vrm);
  const bone = contact.bone as VRMHumanBoneName;
  const target = contact.target as VRMHumanBoneName;
  const worldRotation = (name: VRMHumanBoneName) =>
    vrm.humanoid.getRawBoneNode(name)!.getWorldQuaternion(new Quaternion());
  applyCanonicalPose(vrm, {});
  const boneRest = worldRotation(bone).invert();
  const targetRest = worldRotation(target).invert();
  applyCanonicalPose(vrm, humanoid);
  const effector = skeleton
    .pointOffset(bone, contact.point)!
    .clone()
    .applyQuaternion(worldRotation(bone).multiply(boneRest))
    .add(rawBoneWorldPosition(vrm, bone)!);
  const goal = skeleton
    .pointOffset(target, contact.targetPoint)!
    .clone()
    .add(
      new Vector3(...(contact.offset ?? [0, 0, 0])).multiplyScalar(
        avatarScale(skeleton),
      ),
    )
    .applyQuaternion(worldRotation(target).multiply(targetRest))
    .add(rawBoneWorldPosition(vrm, target)!);
  return effector.distanceTo(goal);
}

const ARMS = [
  "leftUpperArm",
  "leftLowerArm",
  "rightUpperArm",
  "rightLowerArm",
] as const;

/** The largest rotation of any arm bone between consecutive samples. */
function largestArmStep(
  sample: (time: number) => VRMPose,
  times: readonly number[],
): number {
  let largest = 0;
  let previous: VRMPose | null = null;
  for (const time of times) {
    const pose = sample(time);
    if (previous)
      for (const bone of ARMS)
        largest = Math.max(
          largest,
          angularDistanceDegrees(
            new Quaternion(...pose[bone]!.rotation!),
            new Quaternion(...previous[bone]!.rotation!),
          ),
        );
    previous = pose;
  }
  return largest;
}

const steps = (from: number, to: number, step: number) =>
  Array.from(
    { length: Math.round((to - from) / step) + 1 },
    (_, index) => from + index * step,
  );

const parsed = (value: unknown): AnimaPoseClipV2 => {
  const result = validateAnimaPoseClipV2(value);
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.clip;
};

/** Joint keys that hold one arm pose from `beat` on. */
const heldArm = (
  side: "left" | "right",
  beat: string,
  [elevation, planeOfElevation, rotation, flexion]: readonly number[],
) => ({
  [`${side}UpperArm`]: {
    elevation: [{ beat, v: elevation }],
    planeOfElevation: [{ beat, v: planeOfElevation }],
    rotation: [{ beat, v: rotation }],
  },
  [`${side}LowerArm`]: { flexion: [{ beat, v: flexion }] },
});

/** A right palm near the chin: 1.7–2.9 cm off it on the Included Avatars. */
const CHIN_ARM = [65, 90, 60, 140] as const;
/** The chin contact, solved with `solve` (unsolved for null). */
const chinContact = (
  solve: AnimaPoseClipContact["solve"] | null = {},
): AnimaPoseClipContact => ({
  bone: "rightHand",
  point: "palm",
  target: "head",
  offset: [0, -0.02, 0.1],
  beat: "hold",
  from: 0.2,
  to: 1,
  ...(solve ? { solve } : {}),
});

/** Raise the right palm to the chin, hold it there and lower it again. */
const chinClip = (contact: AnimaPoseClipContact) => {
  const raise = (index: number) => [
    { beat: "start", v: "base" },
    { beat: "hold", v: CHIN_ARM[index] },
    { beat: "release", v: CHIN_ARM[index] },
    { beat: "end", v: "base" },
  ];
  return parsed({
    schema: "animaPoseClip/2.0",
    id: "chin",
    name: "Chin",
    duration: 2.4,
    basePose: RELAXED_REST_POSE_ID,
    beats: [
      { id: "start", label: "Start", time: 0 },
      { id: "hold", label: "Hold", time: 0.6 },
      { id: "release", label: "Release", time: 1.8 },
      { id: "end", label: "End", time: 2.4 },
    ],
    joints: {
      rightUpperArm: {
        elevation: raise(0),
        planeOfElevation: raise(1),
        rotation: raise(2),
      },
      rightLowerArm: { flexion: raise(3) },
    },
    contacts: [contact],
  });
};

describe.each([VRM0_FIXTURE_ID, "AvatarSample_A_1_New"] as const)(
  "solved contacts on %s",
  (id) => {
    const vrmOf = () => (id === VRM0_FIXTURE_ID ? y0 : a1);

    it("lands a solved palm on the chin that the authored arm misses", () => {
      const vrm = vrmOf();
      const contact = chinContact();
      const clip = chinClip(contact);
      const solved = prepareAnimaPoseClipV2(clip, { vrm, resolvePose });
      const authored = prepareAnimaPoseClipV2(clip, {
        vrm,
        resolvePose,
        solveContacts: false,
      });
      for (const time of [0.8, 1.2, 1.6]) {
        expect(
          skinnedMiss(vrm, authored.sample(time).humanoid!, contact),
        ).toBeGreaterThan(0.015);
        expect(
          skinnedMiss(vrm, solved.sample(time).humanoid!, contact),
        ).toBeLessThan(0.015);
      }
      // Only the right upper arm and elbow change, and only in the window.
      const inside = solved.sample(1.2).humanoid!;
      const unsolved = authored.sample(1.2).humanoid!;
      for (const bone of Object.keys(unsolved) as VRMHumanBoneName[])
        if (bone !== "rightUpperArm" && bone !== "rightLowerArm")
          expect(inside[bone], bone).toEqual(unsolved[bone]);
      for (const time of [0.3, 0.64, 1.76, 2.1])
        expect(solved.sample(time)).toEqual(authored.sample(time));
    });

    it("plays the authored arms when solving is off or the clip has no solve", () => {
      const vrm = vrmOf();
      const clip = chinClip(chinContact());
      const unsolvedClip = chinClip(chinContact(null));
      expect(unsolvedClip.contacts![0].solve).toBeUndefined();
      const off = prepareAnimaPoseClipV2(clip, {
        vrm,
        resolvePose,
        solveContacts: false,
      });
      const plain = prepareAnimaPoseClipV2(unsolvedClip, { vrm, resolvePose });
      const program = createAnimaPoseClipProgram(clip, {
        vrm,
        resolvePose,
        solveContacts: false,
      });
      for (const time of steps(0, 2.4, 0.1)) {
        expect(off.sample(time)).toEqual(plain.sample(time));
        expect(program.sample(time).sample).toEqual(plain.sample(time));
      }
      // The default program solves.
      expect(
        createAnimaPoseClipProgram(clip, { vrm, resolvePose }).sample(1.2)
          .sample,
      ).not.toEqual(plain.sample(1.2));
    });

    it("blends in and out without a step over 1° per frame", () => {
      const vrm = vrmOf();
      const clip = chinClip(chinContact({ blendIn: 0.3, blendOut: 0.3 }));
      const solved = prepareAnimaPoseClipV2(clip, { vrm, resolvePose });
      const authored = prepareAnimaPoseClipV2(clip, {
        vrm,
        resolvePose,
        solveContacts: false,
      });
      // The arm holds still from 0.6 to 1.8 s; the ramps lie inside that.
      const frames = steps(0.6, 1.8, 1 / 60);
      const sample = (time: number) => solved.sample(time).humanoid!;
      expect(largestArmStep(sample, frames)).toBeLessThan(1);
      expect(
        largestArmStep((time) => authored.sample(time).humanoid!, frames),
      ).toBeLessThan(1e-9);
      // The ramps do move the arm: half-way through each, it is half-solved.
      const correction = angularDistanceDegrees(
        rotationOf(solved.sample(1.2), "rightUpperArm"),
        rotationOf(authored.sample(1.2), "rightUpperArm"),
      );
      expect(correction).toBeGreaterThan(2);
      for (const time of [0.65, 1.75])
        expect(
          angularDistanceDegrees(
            rotationOf(solved.sample(time), "rightUpperArm"),
            rotationOf(authored.sample(time), "rightUpperArm"),
          ),
        ).toBeGreaterThan(correction / 4);
    });

    it("blends a loop's solved window across the seam", () => {
      const vrm = vrmOf();
      const contact = {
        ...chinContact({ blendIn: 0.3 }),
        beat: "start",
        from: 0,
        to: 0.5,
      };
      const clip = parsed({
        schema: "animaPoseClip/2.0",
        id: "chin-loop",
        name: "Chin Loop",
        duration: 2,
        loop: true,
        basePose: RELAXED_REST_POSE_ID,
        beats: [{ id: "start", label: "Start", time: 0 }],
        joints: heldArm("right", "start", CHIN_ARM),
        contacts: [contact],
      });
      const solved = prepareAnimaPoseClipV2(clip, { vrm, resolvePose });
      const authored = prepareAnimaPoseClipV2(clip, {
        vrm,
        resolvePose,
        solveContacts: false,
      });
      expect(
        skinnedMiss(vrm, solved.sample(0).humanoid!, contact),
      ).toBeLessThan(0.015);
      // The ramp before the window wraps to the end of the cycle.
      expect(solved.sample(1.65)).toEqual(authored.sample(1.65));
      const inRamp = skinnedMiss(vrm, solved.sample(1.85).humanoid!, contact);
      expect(inRamp).toBeLessThan(
        skinnedMiss(vrm, authored.sample(1.85).humanoid!, contact) - 0.003,
      );
      expect(inRamp).toBeGreaterThan(0.003);
      expect(
        largestArmStep(
          (time) => solved.sample(time).humanoid!,
          steps(1.5, 2.5, 1 / 60),
        ),
      ).toBeLessThan(1);
      // A loop's last frame is almost fully solved.
      const program = createAnimaPoseClipProgram(clip, { vrm, resolvePose });
      expect(
        skinnedMiss(
          vrm,
          program.sample(0, { atEnd: true }).sample.humanoid!,
          contact,
        ),
      ).toBeLessThan(0.015);
    });

    it("chains claps 0.2 s apart on one side, continuously", () => {
      const vrm = vrmOf();
      // The palms of Excited Triple Clap's clap pose, 2.0–2.2 cm apart. A
      // clap is one-sided: the right palm meets the left one.
      const clap = [47, 72, 43, 83] as const;
      const palms = (from: number, to: number): AnimaPoseClipContact => ({
        bone: "rightHand",
        point: "palm",
        target: "leftHand",
        targetPoint: "palm",
        beat: "clap",
        from,
        to,
        solve: {},
      });
      const clip = parsed({
        schema: "animaPoseClip/2.0",
        id: "clap",
        name: "Clap",
        duration: 2,
        basePose: RELAXED_REST_POSE_ID,
        beats: [
          { id: "start", label: "Start", time: 0 },
          { id: "clap", label: "Clap", time: 1 },
        ],
        joints: {
          ...heldArm("left", "start", clap),
          ...heldArm("right", "start", clap),
        },
        contacts: [palms(0, 0.05), palms(0.25, 0.3)],
      });
      const solved = prepareAnimaPoseClipV2(clip, { vrm, resolvePose });
      const authored = prepareAnimaPoseClipV2(clip, {
        vrm,
        resolvePose,
        solveContacts: false,
      });
      const [first, second] = clip.contacts!;
      for (const [time, contact] of [
        [1.02, first],
        [1.27, second],
      ] as const) {
        expect(
          skinnedMiss(vrm, authored.sample(time).humanoid!, contact),
        ).toBeGreaterThan(0.015);
        expect(
          skinnedMiss(vrm, solved.sample(time).humanoid!, contact),
        ).toBeLessThan(0.015);
      }
      // The left arm stays as authored; the shortened ramps meet between the
      // claps, at the authored pose.
      for (const time of steps(0.7, 1.6, 0.05))
        for (const bone of ["leftUpperArm", "leftLowerArm"] as const)
          expect(solved.sample(time).humanoid![bone]).toEqual(
            authored.sample(time).humanoid![bone],
          );
      for (const bone of ARMS)
        expect(
          angularDistanceDegrees(
            rotationOf(solved.sample(1.15), bone),
            rotationOf(authored.sample(1.15), bone),
          ),
        ).toBeLessThan(1e-6);
      expect(
        largestArmStep(
          (time) => solved.sample(time).humanoid!,
          steps(0.7, 1.6, 1 / 240),
        ),
      ).toBeLessThan(1);
    });
  },
);

describe("solved contacts on unusual rigs", () => {
  it("plays the authored arms on a rig without arm bones", () => {
    const armless = {
      meta: y0.meta,
      humanoid: {
        getNormalizedBoneNode: (bone: VRMHumanBoneName) =>
          /(UpperArm|LowerArm)$/.test(bone)
            ? null
            : y0.humanoid.getNormalizedBoneNode(bone),
      },
    } as unknown as VRM;
    const clip = chinClip(chinContact());
    const unsolved = chinClip(chinContact(null));
    const prepared = prepareAnimaPoseClipV2(clip, {
      vrm: armless,
      resolvePose,
    });
    const plain = prepareAnimaPoseClipV2(unsolved, {
      vrm: armless,
      resolvePose,
    });
    for (const time of steps(0, 2.4, 0.2))
      expect(prepared.sample(time)).toEqual(plain.sample(time));
  });

  it("does not solve without an Avatar", () => {
    const clip = chinClip(chinContact());
    const unsolved = chinClip(chinContact(null));
    expect(prepareAnimaPoseClipV2(clip, { resolvePose }).sample(1.2)).toEqual(
      prepareAnimaPoseClipV2(unsolved, { resolvePose }).sample(1.2),
    );
  });
});
