import type { VRM, VRMPose, VRMPoseTransform } from "@pixiv/three-vrm";

import {
  cloneVRMPoseTransform,
  isVRMHumanBoneName,
  type AnimaPose,
} from "./animaPose";
import type { AnimaPoseClipSample } from "./animaPoseClip";

type QuaternionTuple = NonNullable<VRMPoseTransform["rotation"]>;

export function isVrm0(vrm: VRM | null | undefined): boolean {
  return vrm?.meta?.metaVersion === "0";
}

export function retargetPoseForVrm0(pose: AnimaPose): AnimaPose {
  return {
    ...pose,
    ...(pose.parent ? { parent: pose.parent } : {}),
    ...(pose.humanoid
      ? { humanoid: retargetVRMPoseForVrm0(pose.humanoid) }
      : {}),
    ...(pose.expressions ? { expressions: { ...pose.expressions } } : {}),
  };
}

export function retargetClipSampleForVrm0(
  sample: AnimaPoseClipSample,
): AnimaPoseClipSample {
  return {
    ...(sample.humanoid
      ? { humanoid: retargetVRMPoseForVrm0(sample.humanoid) }
      : {}),
    ...(sample.expressions ? { expressions: { ...sample.expressions } } : {}),
  };
}

function retargetVRMPoseForVrm0(pose: VRMPose): VRMPose {
  const retargetedPose: VRMPose = {};
  for (const boneName of Object.keys(pose).filter(isVRMHumanBoneName)) {
    const transform = pose[boneName];
    if (!transform) continue;
    retargetedPose[boneName] = retargetTransformForVrm0(transform);
  }
  return retargetedPose;
}

function retargetTransformForVrm0(
  transform: VRMPoseTransform,
): VRMPoseTransform {
  const nextTransform = cloneVRMPoseTransform(transform);
  if (nextTransform.position) {
    nextTransform.position = [
      -nextTransform.position[0],
      nextTransform.position[1],
      -nextTransform.position[2],
    ];
  }
  if (nextTransform.rotation) {
    nextTransform.rotation = retargetVrm1AuthoredQuaternionToVrm0(
      nextTransform.rotation,
    );
  }
  return nextTransform;
}

function retargetVrm1AuthoredQuaternionToVrm0(
  rotation: QuaternionTuple,
): QuaternionTuple {
  // Conjugating by a 180-degree Y rotation converts VRM1 +Z-forward authored
  // rotations into the VRM0 -Z-forward normalized basis.
  return [-rotation[0], rotation[1], -rotation[2], rotation[3]];
}
