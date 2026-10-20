import type { VRMHumanBoneName, VRMPose } from "@pixiv/three-vrm";
import { Euler, MathUtils, Quaternion, Vector3 } from "three";
import { describe, expect, it } from "vitest";

import {
  applyCanonicalPose,
  rawBoneWorldPosition,
} from "../../motion-authoring/kinematics";
import {
  VRM0_FIXTURE_ID,
  loadTestAvatar,
} from "../../motion-authoring/testing/includedAvatars";
import { PlantedLegSolver } from "./legs";

const FEET: VRMHumanBoneName[] = [
  "leftFoot",
  "rightFoot",
  "leftToes",
  "rightToes",
];

describe("PlantedLegSolver", () => {
  it.each([VRM0_FIXTURE_ID, "AvatarSample_A_1_New", "Andrew"] as const)(
    "keeps %s's feet planted while the hips lean, shift and crouch",
    async (id) => {
      const vrm = await loadTestAvatar(id);
      applyCanonicalPose(vrm, {});
      const rest = FEET.map((bone) => rawBoneWorldPosition(vrm, bone)!.clone());
      const at = (bone: VRMHumanBoneName) => rawBoneWorldPosition(vrm, bone)!;
      const legLength = (side: "left" | "right") =>
        at(`${side}UpperLeg`).distanceTo(at(`${side}LowerLeg`)) +
        at(`${side}LowerLeg`).distanceTo(at(`${side}Foot`));
      const lengths = { left: legLength("left"), right: legLength("right") };
      const solver = new PlantedLegSolver(vrm);
      const motions: [Euler, Vector3][] = [
        [new Euler(MathUtils.degToRad(12), 0, 0), new Vector3(0, -0.03, 0.02)],
        [
          new Euler(0, MathUtils.degToRad(15), MathUtils.degToRad(-6)),
          new Vector3(0.03, -0.01, 0),
        ],
        [
          new Euler(MathUtils.degToRad(-8), 0, 0),
          new Vector3(-0.02, -0.08, -0.03),
        ],
      ];
      for (const [rotation, offset] of motions) {
        const hips = new Quaternion().setFromEuler(rotation);
        const pose: VRMPose = {
          hips: {
            rotation: hips.toArray() as [number, number, number, number],
            position: offset.toArray() as [number, number, number],
          },
        };
        for (const [bone, value] of Object.entries(solver.solve(hips, offset)))
          pose[bone as VRMHumanBoneName] = {
            rotation: value.toArray() as [number, number, number, number],
          };
        applyCanonicalPose(vrm, pose);
        // A rig whose rest legs are straight (Andrew's) cannot follow a hip
        // that moves past its leg's length: that foot stays as close as the
        // straightened leg reaches.
        FEET.forEach((bone, index) => {
          const side = bone.startsWith("left") ? "left" : "right";
          const outOfReach = Math.max(
            0,
            at(`${side}UpperLeg`).distanceTo(rest[index % 2]) - lengths[side],
          );
          expect(at(bone).distanceTo(rest[index])).toBeLessThan(
            0.001 + outOfReach,
          );
        });
      }
    },
  );
});
