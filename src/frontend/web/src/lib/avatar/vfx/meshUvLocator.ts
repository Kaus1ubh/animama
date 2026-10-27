import * as THREE from "three";

import { mapTrianglesToImage, TextureUvMapping } from "./textureUvMapping";

/** Grid cells per side of the UV index. */
const GRID = 32;

const scratchTriangle = new THREE.Triangle();
const scratchPoint = new THREE.Vector3();
const scratchClosest = new THREE.Vector3();
const scratchBarycoord = new THREE.Vector3();
const scratchA = new THREE.Vector3();
const scratchB = new THREE.Vector3();
const scratchC = new THREE.Vector3();

/**
 * Map texture coordinates back onto a mesh's current surface. Face-surface
 * art is placed on the texture's image; this finds where an image point is
 * drawn, so the creator can put handles on it. Triangles are indexed once in a
 * grid over their corners on the image (UVs through the texture's
 * {@link TextureUvMapping}, each triangle wrapped whole); positions are read
 * through `Mesh.getVertexPosition`, so skinning and morphs apply. The geometry
 * is borrowed, never changed.
 */
export class MeshUvLocator {
  private readonly _mesh: THREE.Mesh;
  private readonly _triangles: Uint32Array;
  /** Each triangle's corners on the image: six numbers per triangle. */
  private readonly _corners: Float32Array;
  private readonly _cells: number[][];
  private readonly _min = new THREE.Vector2(Infinity, Infinity);
  private readonly _size = new THREE.Vector2();

  /**
   * Null when the mesh has no UVs. `mapping` is the texture's; points are
   * plain UVs without one.
   */
  static create(
    mesh: THREE.Mesh,
    mapping: TextureUvMapping = TextureUvMapping.identity,
  ): MeshUvLocator | null {
    const uv = mesh.geometry?.getAttribute("uv");
    if (!uv || uv.itemSize < 2 || uv.count < 3) return null;
    return new MeshUvLocator(mesh, uv, mapping);
  }

  private constructor(
    mesh: THREE.Mesh,
    uv: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
    mapping: TextureUvMapping,
  ) {
    this._mesh = mesh;
    const index = mesh.geometry.getIndex();
    const count = index ? index.count : uv.count;
    const group = mesh.geometry.groups[0];
    // A multi-material primitive keeps its own range; the whole geometry otherwise.
    const start = mesh.geometry.groups.length === 1 && group ? group.start : 0;
    const end =
      mesh.geometry.groups.length === 1 && group
        ? Math.min(count, group.start + group.count)
        : count;
    const triangles: number[] = [];
    for (let offset = start; offset + 2 < end; offset += 3) {
      triangles.push(
        index ? index.getX(offset) : offset,
        index ? index.getX(offset + 1) : offset + 1,
        index ? index.getX(offset + 2) : offset + 2,
      );
    }
    this._triangles = Uint32Array.from(triangles);
    this._corners = mapTrianglesToImage(uv, this._triangles, mapping);
    const max = new THREE.Vector2(-Infinity, -Infinity);
    for (let i = 0; i < this._corners.length; i += 2) {
      this._min.x = Math.min(this._min.x, this._corners[i]!);
      this._min.y = Math.min(this._min.y, this._corners[i + 1]!);
      max.x = Math.max(max.x, this._corners[i]!);
      max.y = Math.max(max.y, this._corners[i + 1]!);
    }
    this._size.set(
      Math.max(1e-6, max.x - this._min.x),
      Math.max(1e-6, max.y - this._min.y),
    );
    this._cells = Array.from({ length: GRID * GRID }, () => []);
    for (let t = 0; t < this._triangles.length / 3; t += 1) {
      const base = t * 6;
      const xs = [base, base + 2, base + 4].map((i) => this._corners[i]!);
      const ys = [base + 1, base + 3, base + 5].map((i) => this._corners[i]!);
      const [x0, y0] = this._cell(Math.min(...xs), Math.min(...ys));
      const [x1, y1] = this._cell(Math.max(...xs), Math.max(...ys));
      for (let y = y0; y <= y1; y += 1)
        for (let x = x0; x <= x1; x += 1) this._cells[y * GRID + x]!.push(t);
    }
  }

  /**
   * World position of `uv`, a point on the image, on the mesh's current
   * surface. A point outside every triangle uses the nearest point of the
   * nearest nearby triangle.
   */
  toWorld(
    uv: { x: number; y: number },
    target = new THREE.Vector3(),
  ): THREE.Vector3 | null {
    if (!Number.isFinite(uv.x) || !Number.isFinite(uv.y)) return null;
    const [cellX, cellY] = this._cell(uv.x, uv.y);
    scratchPoint.set(uv.x, uv.y, 0);
    let best = -1;
    let bestDistance = Infinity;
    let foundRing = GRID;
    // Search outward ring by ring; a triangle in the next ring can still be
    // nearer than the first one found, so one more ring is checked.
    for (let ring = 0; ring < GRID && ring <= foundRing + 1; ring += 1) {
      if (best >= 0) foundRing = Math.min(foundRing, ring - 1);
      for (let y = cellY - ring; y <= cellY + ring; y += 1) {
        for (let x = cellX - ring; x <= cellX + ring; x += 1) {
          if (x < 0 || y < 0 || x >= GRID || y >= GRID) continue;
          if (Math.max(Math.abs(x - cellX), Math.abs(y - cellY)) !== ring)
            continue;
          for (const t of this._cells[y * GRID + x]!) {
            this._uvTriangle(t);
            scratchTriangle.closestPointToPoint(scratchPoint, scratchClosest);
            const distance = scratchClosest.distanceToSquared(scratchPoint);
            if (distance < bestDistance) {
              bestDistance = distance;
              best = t;
            }
          }
        }
      }
    }
    if (best < 0) return null;
    this._uvTriangle(best);
    scratchTriangle.closestPointToPoint(scratchPoint, scratchClosest);
    scratchTriangle.getBarycoord(scratchClosest, scratchBarycoord);
    const [a, b, c] = this._vertices(best);
    this._mesh.getVertexPosition(a, scratchA);
    this._mesh.getVertexPosition(b, scratchB);
    this._mesh.getVertexPosition(c, scratchC);
    target
      .set(0, 0, 0)
      .addScaledVector(scratchA, scratchBarycoord.x)
      .addScaledVector(scratchB, scratchBarycoord.y)
      .addScaledVector(scratchC, scratchBarycoord.z);
    this._mesh.updateWorldMatrix(true, false);
    return target.applyMatrix4(this._mesh.matrixWorld);
  }

  private _vertices(triangle: number): [number, number, number] {
    const base = triangle * 3;
    return [
      this._triangles[base]!,
      this._triangles[base + 1]!,
      this._triangles[base + 2]!,
    ];
  }

  private _uvTriangle(triangle: number): void {
    const base = triangle * 6;
    const corners = this._corners;
    scratchTriangle.a.set(corners[base]!, corners[base + 1]!, 0);
    scratchTriangle.b.set(corners[base + 2]!, corners[base + 3]!, 0);
    scratchTriangle.c.set(corners[base + 4]!, corners[base + 5]!, 0);
  }

  private _cell(u: number, v: number): [number, number] {
    const clamp = (value: number) =>
      Math.min(GRID - 1, Math.max(0, Math.floor(value * GRID)));
    return [
      clamp((u - this._min.x) / this._size.x),
      clamp((v - this._min.y) / this._size.y),
    ];
  }
}
