import type { VRM } from "@pixiv/three-vrm";
import type * as THREE from "three";

/**
 * Where a bone sits relative to the humanoid head: an eye bone (or below
 * one), another bone under the head, a spring bone under the head (hair,
 * ears, accessories), the neck (or a bone under it outside the head), or
 * anywhere else (the body below the neck).
 */
export type BoneClass =
  | "eye_left"
  | "eye_right"
  | "head"
  | "spring_head"
  | "neck"
  | "other";

/**
 * A cached {@link BoneClass} lookup for `vrm`'s raw bones. Face part
 * detection weighs skinning by it; the head's measured size
 * (`avatarProportions.ts`) and the review renders (`effects:render`) find the
 * head's vertices with it.
 */
export function createBoneClassifier(
  vrm: VRM,
): (bone: THREE.Object3D | null) => BoneClass {
  const humanoid = vrm.humanoid;
  const head = humanoid?.getRawBoneNode("head") ?? null;
  const neck = humanoid?.getRawBoneNode("neck") ?? null;
  const leftEye = humanoid?.getRawBoneNode("leftEye") ?? null;
  const rightEye = humanoid?.getRawBoneNode("rightEye") ?? null;
  const springs = new Set<THREE.Object3D>();
  vrm.springBoneManager?.joints.forEach((joint) => springs.add(joint.bone));
  const cache = new Map<THREE.Object3D, BoneClass>();
  return (bone) => {
    if (!bone || !head) return "other";
    const cached = cache.get(bone);
    if (cached) return cached;
    let side: BoneClass | null = null;
    let underHead = false;
    let underNeck = false;
    for (let node: THREE.Object3D | null = bone; node; node = node.parent) {
      if (node === leftEye) side ??= "eye_left";
      if (node === rightEye) side ??= "eye_right";
      if (node === head) {
        underHead = true;
        break;
      }
      if (node === neck) underNeck = true;
    }
    const result: BoneClass = underHead
      ? (side ?? (springs.has(bone) ? "spring_head" : "head"))
      : underNeck
        ? "neck"
        : "other";
    cache.set(bone, result);
    return result;
  };
}
