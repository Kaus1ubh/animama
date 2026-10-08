import * as THREE from "three";

import type { AvatarVFXManipulationPlacement } from "./placement-guide-types";

/** PlaneGeometry vertices in image order: top-left, top-right, bottom-right, bottom-left. */
const IMAGE_CORNER_VERTICES = [0, 1, 3, 2] as const;

type Corners = AvatarVFXManipulationPlacement["corners"];

/** A manipulation placement from four image-order world corners. */
export function quadManipulationPlacement(args: {
  label: string;
  mirrored: boolean;
  corners: Corners;
  rotationSense: 1 | -1;
}): AvatarVFXManipulationPlacement {
  return {
    ...args,
    center: args.corners
      .reduce((sum, corner) => sum.add(corner), new THREE.Vector3())
      .multiplyScalar(0.25),
  };
}

/** The image-order world corners of a PlaneGeometry under `matrix`. */
export function planeImageCorners(
  geometry: THREE.BufferGeometry,
  matrix: THREE.Matrix4,
): Corners {
  const position = geometry.getAttribute("position");
  return IMAGE_CORNER_VERTICES.map((index) =>
    new THREE.Vector3()
      .fromBufferAttribute(position, index)
      .applyMatrix4(matrix),
  ) as Corners;
}
