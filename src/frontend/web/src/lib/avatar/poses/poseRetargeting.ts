import type { VRM, VRMPose, VRMPoseTransform } from "@pixiv/three-vrm";
import { Quaternion, type Vector3 } from "three";

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

/**
 * Convert between canonical authored rotations and a model's normalized basis.
 * The VRM0 conjugation is its own inverse; use at both read and write boundaries,
 * never on serialized drafts (which remain canonical).
 */
export function convertPoseQuaternionBasis(
  vrm: VRM | null | undefined,
  rotation: Quaternion,
): Quaternion {
  return isVrm0(vrm)
    ? new Quaternion(
        ...retargetVrm1AuthoredQuaternionToVrm0(rotation.toArray()),
      )
    : rotation.clone();
}

/**
 * Convert a VRM1-authored procedural rotation offset into the VRM0 normalized
 * basis in place. Procedural layers multiply these offsets onto normalized
 * bones, so VRM0 needs the same 180-degree Y conjugation as authored poses.
 */
export function retargetVrm1AuthoredQuaternionOffsetToVrm0(
  quaternion: Quaternion,
): Quaternion {
  return quaternion.set(
    -quaternion.x,
    quaternion.y,
    -quaternion.z,
    quaternion.w,
  );
}

/**
 * Convert a VRM1-authored procedural translation offset into the VRM0
 * normalized basis in place (x and z are mirrored by the 180-degree Y basis).
 */
export function retargetVrm1AuthoredPositionOffsetToVrm0(
  position: Vector3,
): Vector3 {
  return position.set(-position.x, position.y, -position.z);
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
