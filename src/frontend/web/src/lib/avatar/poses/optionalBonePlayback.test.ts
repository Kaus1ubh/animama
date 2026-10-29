import type { VRM, VRMHumanBoneName, VRMPose } from "@pixiv/three-vrm";
import { MathUtils, Quaternion, Vector3 } from "three";
import { describe, expect, it } from "vitest";

import type { AvatarMotionCatalog } from "../motion/AvatarMotionCatalog";
import { loadTestAvatarWithout } from "../testing/withoutHumanBones";
import { angularDistanceDegrees } from "./anatomy/anatomy";
import { applyAnimaPoseToVrm, type AnimaPose } from "./animaPose";
import type { AnimaPoseClipV2 } from "./animaPoseClip";
import { PoseController } from "./PoseController";

/*
 * Poses and fades on a rig without an upper chest: its bend folds into the
 * chest wherever a pose reaches the Avatar, not only in prepared clips.
 */

const rotation = (axis: Vector3, degrees: number) =>
  new Quaternion()
    .setFromAxisAngle(axis, MathUtils.degToRad(degrees))
    .toArray() as [number, number, number, number];

const CHEST = rotation(new Vector3(1, 0, 0), 8);
const UPPER_CHEST = rotation(new Vector3(0, 0, 1), 12);
const FOLDED = new Quaternion(...CHEST).multiply(
  new Quaternion(...UPPER_CHEST),
);

const bentPose: AnimaPose = {
  schema: "animaPose/1.0",
  id: "bent",
  name: "Bent",
  humanoid: {
    chest: { rotation: CHEST },
    upperChest: { rotation: UPPER_CHEST },
  },
};

describe("poses on a rig without an upper chest", () => {
  it("applies the upper chest's rotation through the chest", async () => {
    const vrm = await loadTestAvatarWithout("Andrew", ["upperChest"]);
    const result = applyAnimaPoseToVrm(vrm, bentPose);
    expect(result.skippedHumanoidBones).toEqual([]);
    const chest = vrm.humanoid.getNormalizedPose().chest!.rotation!;
    expect(
      angularDistanceDegrees(new Quaternion(...chest), FOLDED),
    ).toBeLessThan(1e-4);
  });

  /**
   * A controller on a stub rig without an upper chest whose default pose is
   * `bentPose`, and the pose last applied to the rig.
   */
  function fadingController() {
    let applied: VRMPose = {};
    const vrm = {
      humanoid: {
        getNormalizedPose: () => applied,
        getNormalizedBoneNode: (bone: VRMHumanBoneName) =>
          bone === "upperChest" ? null : {},
        resetNormalizedPose: () => {
          applied = {};
        },
        setNormalizedPose: (pose: VRMPose) => {
          applied = pose;
        },
      },
      expressionManager: null,
    } as unknown as VRM;
    const catalog = {
      getPoseIds: () => ["bent"],
      getDefaultPoseIds: () => ["bent"],
      getPose: () => bentPose,
      getResolvedPose: () => bentPose,
    } as unknown as AvatarMotionCatalog;
    const clip: AnimaPoseClipV2 = {
      schema: "animaPoseClip/2.0",
      id: "lean",
      name: "Lean",
      duration: 1,
      beats: [
        { id: "start", label: "Start", time: 0 },
        { id: "end", label: "End", time: 1 },
      ],
      // The clip bends the chest, so the fade starts from a chest of its own.
      joints: { chest: { flexion: [{ beat: "start", v: 15 }] } },
      fadeOut: { duration: 0.2, easing: "linear" },
    };
    const controller = new PoseController(vrm, { motionCatalog: catalog });
    controller.playAnimaPoseClip(clip);
    controller.update(0.5);
    return {
      controller,
      chest: () => new Quaternion(...applied.chest!.rotation!),
      applied: () => applied,
    };
  }

  it("starts the fade to a default pose from the clip's chest, without a jump", () => {
    const { controller, chest } = fadingController();
    const before = chest();
    controller.stopClip();
    controller.update(0.001);
    // The default's upper-chest bend arrives with the fade, not at its start.
    expect(angularDistanceDegrees(chest(), before)).toBeLessThan(0.5);
  });

  it("folds a default pose the clip fades out to", () => {
    const { controller, chest, applied } = fadingController();
    controller.stopClip();
    // Just before the fade ends, the pose is all but the default.
    controller.update(0.1999);
    expect(applied().upperChest).toBeUndefined();
    expect(angularDistanceDegrees(chest(), FOLDED)).toBeLessThan(0.1);
  });
});
