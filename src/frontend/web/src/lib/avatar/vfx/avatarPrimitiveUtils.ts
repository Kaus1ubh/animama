import * as THREE from "three";

import type { Avatar } from "../Avatar";
import { buildRuntimePrimitiveBindings } from "../vrmEditorInspection";

export type RuntimePrimitiveBindingEntry = ReturnType<
  typeof buildRuntimePrimitiveBindings
>["entries"][number];

export type PrimitiveVertexRange = {
  start: number;
  count: number | null;
};

export type CollectedPrimitiveData = {
  indexed: boolean;
  orderedVertexIndices: number[];
  orderedPoints: THREE.Vector3[];
  pointsByIndex: Map<number, THREE.Vector3>;
  uniqueVertexIndices: number[];
};

/** Disjoint sets of vertex indices, for splitting a primitive into islands. */
export class UnionFind {
  private readonly _parent = new Map<number, number>();

  add(value: number): void {
    if (!this._parent.has(value)) {
      this._parent.set(value, value);
    }
  }

  find(value: number): number {
    if (!this._parent.has(value)) {
      this._parent.set(value, value);
      return value;
    }
    // Iterative, so long chains on large primitives cannot overflow the stack.
    let root = value;
    for (let parent = this._parent.get(root)!; parent !== root; ) {
      root = parent;
      parent = this._parent.get(root)!;
    }
    for (let node = value; node !== root; ) {
      const next = this._parent.get(node)!;
      this._parent.set(node, root);
      node = next;
    }
    return root;
  }

  union(a: number, b: number): void {
    const rootA = this.find(a);
    const rootB = this.find(b);
    if (rootA !== rootB) {
      this._parent.set(rootB, rootA);
    }
  }
}

export function collectPrimitiveData(args: {
  avatar: Avatar;
  binding: RuntimePrimitiveBindingEntry;
  anchorObject: THREE.Object3D;
}): CollectedPrimitiveData | null {
  const geometry = args.binding.object.geometry;
  if (!(geometry instanceof THREE.BufferGeometry)) {
    return null;
  }

  const position = geometry.getAttribute("position");
  if (!(position instanceof THREE.BufferAttribute) || position.itemSize < 3) {
    return null;
  }

  const order = readPrimitiveVertexOrder(args.avatar, args.binding);
  const meshObject = args.binding.object;

  meshObject.updateWorldMatrix(true, false);
  args.anchorObject.updateWorldMatrix(true, false);

  if (order.indexed) {
    const orderedVertexIndices = order.vertices;
    const uniqueVertexIndices = Array.from(new Set(orderedVertexIndices));
    const pointsByIndex = buildPointMap({
      anchorObject: args.anchorObject,
      meshObject,
      position,
      vertexIndices: uniqueVertexIndices,
    });
    const orderedPoints = orderedVertexIndices
      .map((vertexIndex) => pointsByIndex.get(vertexIndex)?.clone() ?? null)
      .filter((value): value is THREE.Vector3 => value !== null);
    return {
      indexed: true,
      orderedVertexIndices,
      orderedPoints,
      pointsByIndex,
      uniqueVertexIndices,
    };
  }

  const uniqueVertexIndices = order.vertices;
  const pointsByIndex = buildPointMap({
    anchorObject: args.anchorObject,
    meshObject,
    position,
    vertexIndices: uniqueVertexIndices,
  });
  const orderedPoints = uniqueVertexIndices
    .map((vertexIndex) => pointsByIndex.get(vertexIndex)?.clone() ?? null)
    .filter((value): value is THREE.Vector3 => value !== null);
  return {
    indexed: false,
    orderedVertexIndices: uniqueVertexIndices,
    orderedPoints,
    pointsByIndex,
    uniqueVertexIndices,
  };
}

/**
 * A primitive's triangle corners as vertex indices, in draw order: its index
 * range within the mesh (or, unindexed, its vertex range), so a mesh that
 * holds several primitives yields only this one's.
 */
export function readPrimitiveVertexOrder(
  avatar: Pick<Avatar, "sourceGltf">,
  binding: RuntimePrimitiveBindingEntry,
): { indexed: boolean; vertices: number[] } {
  const geometry = binding.object.geometry;
  const range = resolvePrimitiveVertexRange(avatar, binding);
  const index = geometry.getIndex();
  const total = index
    ? index.count
    : (geometry.getAttribute("position")?.count ?? 0);
  const start = Math.max(0, range?.start ?? 0);
  const maxCount = total - start;
  const count =
    range?.count === null || range?.count === undefined
      ? maxCount
      : Math.max(0, Math.min(range.count, maxCount));
  const vertices = Array.from({ length: Math.max(0, count) }, (_, offset) =>
    index ? index.getX(start + offset) : start + offset,
  );
  return { indexed: index !== null, vertices };
}

export function resolvePrimitiveVertexRange(
  avatar: Pick<Avatar, "sourceGltf">,
  binding: RuntimePrimitiveBindingEntry,
): PrimitiveVertexRange | null {
  const geometry = binding.object.geometry;
  if (!(geometry instanceof THREE.BufferGeometry)) {
    return null;
  }

  const materials = Array.isArray(binding.object.material)
    ? binding.object.material
    : null;
  const groups = geometry.groups;
  if (!materials || groups.length === 0) {
    return readDrawRange(geometry);
  }

  const associations = avatar.sourceGltf?.parser.associations;
  const matchingGroups = groups.filter((group) => {
    if (
      typeof group.materialIndex !== "number" ||
      group.materialIndex < 0 ||
      group.materialIndex >= materials.length
    ) {
      return false;
    }
    const material = materials[group.materialIndex] ?? null;
    if (!(material instanceof THREE.Material)) return false;
    const mapping = associations?.get(material);
    return mapping?.materials === binding.materialIndex;
  });

  if (matchingGroups.length === 1) {
    return {
      start: matchingGroups[0].start,
      count: matchingGroups[0].count,
    };
  }

  if (
    binding.primitiveIndex >= 0 &&
    binding.primitiveIndex < groups.length &&
    Number.isFinite(groups[binding.primitiveIndex]?.count)
  ) {
    const group = groups[binding.primitiveIndex];
    return {
      start: group.start,
      count: group.count,
    };
  }

  return readDrawRange(geometry);
}

export function readVertexPosition(
  meshObject: THREE.Mesh,
  position: THREE.BufferAttribute,
  vertexIndex: number,
  target: THREE.Vector3,
): THREE.Vector3 {
  target.fromBufferAttribute(position, vertexIndex);
  if (meshObject instanceof THREE.SkinnedMesh) {
    meshObject.applyBoneTransform(vertexIndex, target);
  }
  return target;
}

function buildPointMap(args: {
  anchorObject: THREE.Object3D;
  meshObject: THREE.Mesh;
  position: THREE.BufferAttribute;
  vertexIndices: number[];
}): Map<number, THREE.Vector3> {
  const map = new Map<number, THREE.Vector3>();
  const point = new THREE.Vector3();
  args.vertexIndices.forEach((vertexIndex) => {
    readVertexPosition(args.meshObject, args.position, vertexIndex, point);
    args.meshObject.localToWorld(point);
    args.anchorObject.worldToLocal(point);
    map.set(vertexIndex, point.clone());
  });
  return map;
}

function readDrawRange(
  geometry: THREE.BufferGeometry,
): PrimitiveVertexRange | null {
  const { start, count } = geometry.drawRange;
  if (!Number.isFinite(start) || start < 0) return null;
  if (!Number.isFinite(count) || count <= 0) return null;
  return { start, count };
}
