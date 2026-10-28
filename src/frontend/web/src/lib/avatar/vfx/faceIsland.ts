import * as THREE from "three";

import { UnionFind } from "./avatarPrimitiveUtils";

/**
 * Which triangles of a face primitive belong to the face's own UV island, as
 * a keep flag per triangle, or null when no island qualifies (every triangle
 * is then kept).
 *
 * Triangles join when they share a vertex, or vertices with equal position
 * and UV (a split that is no texture seam). The face's island is the one
 * nearest `seed` (a point between the eyes) among the islands whose front-view
 * extent (x and y) spans both `eyes`, and it must come within half the eyes'
 * spacing of the seed. Without such an island (a face unwrapped in two
 * halves, beside a scalp island that spans the eyes from behind) null is
 * returned.
 *
 * `withIslands` adds the islands outside the face island's outline (`outer`:
 * VRoid's ears, unwrapped apart from the face, or a neck below it) or inside
 * it (`inner`: an inner mouth, teeth, eyes or brows); by default only the face
 * island is kept.
 *
 * A VRoid face skin is one primitive for the face alone, so this is (nearly)
 * all of it. An Avatar converted from VRChat often keeps its face, neck, inner
 * mouth and more in one primitive over one texture, and a low-poly Avatar its
 * whole body: projecting a point onto the nearest triangle there can land on
 * another part of the texture, so anchors and whole-face art keep to the
 * face's island.
 *
 * `corners` holds three vertex indices per triangle and `pointOf` gives each
 * vertex's position in the face anchor's space (the landmarks' head space).
 */
export function findFaceIslandTriangles(args: {
  corners: readonly number[];
  pointOf: (vertex: number) => THREE.Vector3 | undefined;
  position: THREE.BufferAttribute;
  uv: THREE.BufferAttribute;
  seed: THREE.Vector3;
  eyes: readonly [THREE.Vector3, THREE.Vector3];
  withIslands?: "outer" | "inner";
}): boolean[] | null {
  const { corners, pointOf, position, uv, seed, eyes } = args;
  const vertices = Array.from(new Set(corners));
  const islands = new UnionFind();
  const vertexByKey = new Map<string, number>();
  for (const vertexIndex of vertices) {
    islands.add(vertexIndex);
    const key = [
      position.getX(vertexIndex),
      position.getY(vertexIndex),
      position.getZ(vertexIndex),
      uv.getX(vertexIndex),
      uv.getY(vertexIndex),
    ].join(",");
    const twin = vertexByKey.get(key);
    if (twin === undefined) vertexByKey.set(key, vertexIndex);
    else islands.union(twin, vertexIndex);
  }
  for (let offset = 0; offset + 2 < corners.length; offset += 3) {
    islands.union(corners[offset]!, corners[offset + 1]!);
    islands.union(corners[offset]!, corners[offset + 2]!);
  }

  const extents = new Map<number, THREE.Box2>();
  for (const vertexIndex of vertices) {
    const point = pointOf(vertexIndex);
    if (!point) continue;
    const root = islands.find(vertexIndex);
    let extent = extents.get(root);
    if (!extent) {
      extent = new THREE.Box2().makeEmpty();
      extents.set(root, extent);
    }
    extent.expandByPoint(new THREE.Vector2(point.x, point.y));
  }
  const eyePoints = eyes.map((eye) => new THREE.Vector2(eye.x, eye.y));
  const spanning = new Set(
    Array.from(extents)
      .filter(([, extent]) =>
        eyePoints.every((eye) => extent.containsPoint(eye)),
      )
      .map(([root]) => root),
  );

  const triangle = new THREE.Triangle();
  const closest = new THREE.Vector3();
  let faceIsland: number | null = null;
  let bestDistanceSq = Infinity;
  for (let offset = 0; offset + 2 < corners.length; offset += 3) {
    const a = pointOf(corners[offset]!);
    const b = pointOf(corners[offset + 1]!);
    const c = pointOf(corners[offset + 2]!);
    if (!a || !b || !c) continue;
    const root = islands.find(corners[offset]!);
    if (!spanning.has(root)) continue;
    triangle.set(a, b, c).closestPointToPoint(seed, closest);
    const distanceSq = closest.distanceToSquared(seed);
    if (distanceSq < bestDistanceSq) {
      bestDistanceSq = distanceSq;
      faceIsland = root;
    }
  }
  const reach = eyes[0].distanceTo(eyes[1]) / 2;
  if (faceIsland === null || bestDistanceSq > reach * reach) return null;

  const outline = extents.get(faceIsland)!;
  const outside = (extent: THREE.Box2 | undefined) =>
    !extent ||
    extent.min.x <= outline.min.x ||
    extent.min.y <= outline.min.y ||
    extent.max.x >= outline.max.x ||
    extent.max.y >= outline.max.y;
  const keep = (root: number) => {
    if (root === faceIsland) return true;
    if (!args.withIslands) return false;
    return outside(extents.get(root)) === (args.withIslands === "outer");
  };
  const flags: boolean[] = [];
  for (let offset = 0; offset + 2 < corners.length; offset += 3) {
    flags.push(keep(islands.find(corners[offset]!)));
  }
  return flags;
}
