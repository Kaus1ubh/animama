import type { VRMHumanBoneName } from "@pixiv/three-vrm";
import { Quaternion } from "three";

import type { HandShapeKey } from "./description";

/**
 * Sample a hand-shape track. Each key is a held shape: the hand blends between
 * neighbouring keys with ease-in-out, so it settles on every key (hand keys
 * have no tangent option). Outside its keys the track holds the nearest shape;
 * in a loop it blends from the last key back to the first across the seam.
 */
export function sampleHandShapes(
  keys: readonly HandShapeKey[],
  shapes: readonly Map<VRMHumanBoneName, Quaternion>[],
  time: number,
  loopDuration: number | null = null,
): Map<VRMHumanBoneName, Quaternion> {
  const lastIndex = keys.length - 1;
  if (loopDuration !== null && lastIndex > 0) {
    const wrapped = ((time % loopDuration) + loopDuration) % loopDuration;
    const first = keys[0].t;
    const last = keys[lastIndex].t;
    if (wrapped < first || wrapped >= last) {
      const span = first + loopDuration - last;
      if (span <= 0) return shapes[lastIndex];
      const elapsed =
        wrapped >= last ? wrapped - last : wrapped + loopDuration - last;
      return blendShapes(shapes[lastIndex], shapes[0], elapsed / span);
    }
    time = wrapped;
  }
  if (time <= keys[0].t) return shapes[0];
  if (time >= keys[lastIndex].t) return shapes[lastIndex];
  let index = 0;
  while (keys[index + 1].t <= time) index += 1;
  const span = keys[index + 1].t - keys[index].t;
  return blendShapes(
    shapes[index],
    shapes[index + 1],
    (time - keys[index].t) / span,
  );
}

function blendShapes(
  from: Map<VRMHumanBoneName, Quaternion>,
  to: Map<VRMHumanBoneName, Quaternion>,
  progress: number,
): Map<VRMHumanBoneName, Quaternion> {
  const eased = -(Math.cos(Math.PI * progress) - 1) / 2;
  const result = new Map<VRMHumanBoneName, Quaternion>();
  for (const [bone, rotation] of from) {
    const target = to.get(bone);
    result.set(
      bone,
      target ? rotation.clone().slerp(target, eased) : rotation.clone(),
    );
  }
  return result;
}
