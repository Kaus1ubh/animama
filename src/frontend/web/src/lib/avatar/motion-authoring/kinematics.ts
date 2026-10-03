import type { VRM, VRMHumanBoneName, VRMPose } from "@pixiv/three-vrm";
import { Vector3 } from "three";

import { retargetClipSampleForVrm0 } from "../poses/poseRetargeting";

/**
 * Pose a headless VRM with a canonical-basis normalized pose, the same way
 * playback does: VRM 0 conversion, normalized pose, then transfer to raw bones.
 * Bones absent from `pose` return to the normalized T-pose.
 */
export function applyCanonicalPose(vrm: VRM, pose: VRMPose): void {
  const runtimePose =
    vrm.meta.metaVersion === "0"
      ? (retargetClipSampleForVrm0({ humanoid: pose }).humanoid ?? {})
      : pose;
  vrm.humanoid.resetNormalizedPose();
  vrm.humanoid.setNormalizedPose(runtimePose);
  vrm.humanoid.update();
  vrm.scene.updateMatrixWorld(true);
}

/** World position of a raw (skinned) humanoid bone, or null when absent. */
export function rawBoneWorldPosition(
  vrm: VRM,
  bone: VRMHumanBoneName,
): Vector3 | null {
  const node = vrm.humanoid.getRawBoneNode(bone);
  return node ? node.getWorldPosition(new Vector3()) : null;
}

/** Height of the hips above the feet at rest, used to normalize distances. */
export function avatarScale(vrm: VRM): number {
  applyCanonicalPose(vrm, {});
  const hips = rawBoneWorldPosition(vrm, "hips");
  const foot = rawBoneWorldPosition(vrm, "leftFoot");
  if (!hips || !foot) throw new Error("The Avatar has no hips or feet.");
  return hips.y - foot.y;
}
