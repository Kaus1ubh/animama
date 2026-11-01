import * as THREE from "three";

import type { Avatar } from "../Avatar";
import type { RuntimePrimitiveBindingEntry } from "../vfx/avatarPrimitiveUtils";
import { appendTriangle } from "./appendTriangle";

/** The morph targets `blink` drives on a mesh. */
export function blinkTargets(avatar: Avatar, mesh: THREE.Object3D): number[] {
  const binds = avatar.vrm!.expressionManager!.getExpression("blink")!
    .binds as unknown as { primitives?: THREE.Object3D[]; index?: number }[];
  return binds
    .filter((bind) => bind.primitives?.includes(mesh))
    .map((bind) => bind.index!);
}

/**
 * Add a strand `above` an eye (its centre in head space) to a test Avatar's
 * face primitive, which blink lowers by `drop` (by default as far as the lid),
 * as a lash or eye line kept inside a converted Avatar's face mesh: `width`
 * across, a thin sliver tall, mapped to `uv`. A negative `above` places it
 * below the eye centre.
 */
export function addBlinkStrand(
  avatar: Avatar,
  face: RuntimePrimitiveBindingEntry,
  eye: THREE.Vector3,
  width: number,
  {
    above = 0.012,
    uv = [
      [0.1, 0.1],
      [0.12, 0.1],
      [0.11, 0.12],
    ],
    drop = 0.02,
  }: {
    above?: number;
    uv?: readonly [[number, number], [number, number], [number, number]];
    drop?: number;
  } = {},
): void {
  const y = eye.y + above;
  const z = eye.z + 0.004;
  appendTriangle({
    avatar,
    binding: face,
    anchor: avatar.vrm!.humanoid.getNormalizedBoneNode("head")!,
    corners: [
      new THREE.Vector3(eye.x - width / 2, y, z),
      new THREE.Vector3(eye.x + width / 2, y, z),
      new THREE.Vector3(eye.x, y + 0.002, z),
    ],
    uv,
    morph: {
      targets: blinkTargets(avatar, face.object),
      offset: new THREE.Vector3(0, -drop, 0),
    },
  });
}
