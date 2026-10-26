import * as THREE from "three";

import type { Avatar } from "../Avatar";
import {
  resolvePrimitiveVertexRange,
  type RuntimePrimitiveBindingEntry,
} from "../vfx/avatarPrimitiveUtils";

/**
 * Append one triangle, a separate island, to a test Avatar's primitive, the
 * way a VRChat Avatar keeps extra parts (an inner mouth, an eye dome, a
 * second eye layer) in the same primitive as the face or the iris. On a mesh
 * with several material groups the triangle joins the primitive's group.
 *
 * `corners` are points in `anchor`'s space (the face landmarks' head space)
 * and `uv` the texture coordinate of each corner. Other attributes copy
 * vertex 0 and morph targets leave the triangle in place, so skinning at rest
 * and expressions keep it where it was put. The mesh must be at its bind pose
 * with relative morph targets, as a loaded VRM is.
 */
export function appendTriangle(args: {
  avatar: Avatar;
  binding: RuntimePrimitiveBindingEntry;
  anchor: THREE.Object3D;
  corners: readonly [THREE.Vector3, THREE.Vector3, THREE.Vector3];
  uv: readonly [[number, number], [number, number], [number, number]];
}): void {
  const { anchor, corners, uv } = args;
  const mesh = args.binding.object;
  const geometry = mesh.geometry;
  const range = resolvePrimitiveVertexRange(args.avatar, args.binding);
  const vertexCount = geometry.getAttribute("position").count;
  anchor.updateWorldMatrix(true, false);
  mesh.updateWorldMatrix(true, false);
  const positions = corners.map((corner) =>
    mesh.worldToLocal(anchor.localToWorld(corner.clone())),
  );

  const extend = (
    attribute: THREE.BufferAttribute,
    values: (corner: number) => readonly number[],
  ) => {
    const array = new (attribute.array.constructor as new (
      length: number,
    ) => THREE.TypedArray)(attribute.array.length + attribute.itemSize * 3);
    array.set(attribute.array);
    for (let corner = 0; corner < 3; corner += 1) {
      array.set(
        values(corner),
        attribute.array.length + corner * attribute.itemSize,
      );
    }
    return new THREE.BufferAttribute(
      array,
      attribute.itemSize,
      attribute.normalized,
    );
  };
  const template = (attribute: THREE.BufferAttribute) =>
    Array.from(attribute.array.slice(0, attribute.itemSize));

  for (const [name, attribute] of Object.entries(geometry.attributes)) {
    if (!(attribute instanceof THREE.BufferAttribute)) {
      throw new Error(`Attribute ${name} is interleaved`);
    }
    if (
      (name === "position" || name === "uv") &&
      (!(attribute.array instanceof Float32Array) || attribute.normalized)
    ) {
      // Quantized values would silently truncate the placed corners.
      throw new Error(`Attribute ${name} is not plain float`);
    }
    const values =
      name === "position"
        ? (corner: number) => positions[corner].toArray()
        : name === "uv"
          ? (corner: number) => uv[corner]
          : () => template(attribute);
    geometry.setAttribute(name, extend(attribute, values));
  }
  if (Object.keys(geometry.morphAttributes).length > 0) {
    if (!geometry.morphTargetsRelative) {
      throw new Error("The test mesh's morph targets are not relative");
    }
    const morphAttributes = geometry.morphAttributes as Record<
      string,
      (THREE.BufferAttribute | THREE.InterleavedBufferAttribute)[]
    >;
    for (const [name, targets] of Object.entries(morphAttributes)) {
      morphAttributes[name] = targets.map((target) => {
        if (!(target instanceof THREE.BufferAttribute)) {
          throw new Error(`Morph attribute ${name} is interleaved`);
        }
        return extend(target, () => new Array(target.itemSize).fill(0));
      });
    }
  }
  const index = geometry.getIndex();
  if (!index) throw new Error("The test mesh is not indexed");
  const indices = Array.from(index.array);
  const group = geometry.groups.find((entry) => entry.start === range?.start);
  const at = group ? group.start + group.count : indices.length;
  indices.splice(at, 0, vertexCount, vertexCount + 1, vertexCount + 2);
  for (const entry of geometry.groups) {
    if (entry === group) entry.count += 3;
    else if (entry.start >= at) entry.start += 3;
  }
  geometry.setIndex(indices);
}
