import type { Avatar } from "../Avatar";

/**
 * Remove a loaded test Avatar's humanoid eye bones, raw and normalized, as a
 * model rigged without them.
 */
export function removeEyeBones(avatar: Avatar): void {
  const humanoid = avatar.vrm!.humanoid as unknown as {
    _rawHumanBones: { humanBones: Record<string, unknown> };
    _normalizedHumanBones: { humanBones: Record<string, unknown> };
  };
  for (const rig of [humanoid._rawHumanBones, humanoid._normalizedHumanBones]) {
    delete rig.humanBones.leftEye;
    delete rig.humanBones.rightEye;
  }
}
