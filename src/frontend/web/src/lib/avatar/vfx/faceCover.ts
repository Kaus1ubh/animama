import * as THREE from "three";

/**
 * How far in front of a point on the face skin another surface may lie and
 * still cover it, as a share of the distance between the eyes. Eye dots, eye
 * shapes and eye meshes lie within a few millimetres of the skin.
 */
const FACE_COVER_MAX_DEPTH = 0.1;
/** A surface closer than this (m) lies on the skin, not over it. */
const FACE_COVER_MIN_DEPTH = 1e-5;

/** One triangle's corners, in the face anchors' head space. */
export type FaceCoverTriangle = readonly [
  THREE.Vector3,
  THREE.Vector3,
  THREE.Vector3,
];

/** An extent in the front view (head-space x and y). */
export type FaceCoverExtent = {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
};

/**
 * Surfaces lying just in front of the face skin, which hide art painted on
 * the skin under them: eyes, eye dots or a mouth modelled in the face mesh
 * outside the face's own UV island, and the eye mesh parts. Hair, which hangs
 * further out and moves, is not among them.
 *
 * Built once with the face texture anchors; {@link covers} tells whether a
 * point on the face lies under one of them, looking along the face's front
 * axis (the head's z axis, toward `frontSign`).
 */
export class FaceCover {
  /** Nine numbers per triangle: its corners. */
  private readonly _corners: Float32Array;
  /** Four numbers per triangle: its x and y extent (min x, max x, min y, max y). */
  private readonly _extents: Float32Array;
  private readonly _frontSign: 1 | -1;
  private readonly _front: THREE.Vector3;
  private readonly _maxDepth: number;
  /** The distance between the eyes (m), which scales the cover's depth. */
  readonly eyeSpacing: number;
  private readonly _ray = new THREE.Ray();
  private readonly _hit = new THREE.Vector3();
  private readonly _a = new THREE.Vector3();
  private readonly _b = new THREE.Vector3();
  private readonly _c = new THREE.Vector3();

  /**
   * `eyeSpacing` (m) scales how far in front a covering surface may lie;
   * triangles whose outline misses `near` (the face's extent in the front
   * view) are left out, as no face point can lie under them.
   */
  constructor(args: {
    triangles: Iterable<FaceCoverTriangle>;
    frontSign: 1 | -1;
    eyeSpacing: number;
    near: FaceCoverExtent;
  }) {
    const corners: number[] = [];
    const extents: number[] = [];
    for (const triangle of args.triangles) {
      const [a, b, c] = triangle;
      const minX = Math.min(a.x, b.x, c.x);
      const maxX = Math.max(a.x, b.x, c.x);
      const minY = Math.min(a.y, b.y, c.y);
      const maxY = Math.max(a.y, b.y, c.y);
      if (
        maxX < args.near.minX ||
        minX > args.near.maxX ||
        maxY < args.near.minY ||
        minY > args.near.maxY
      ) {
        continue;
      }
      corners.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
      extents.push(minX, maxX, minY, maxY);
    }
    this._corners = Float32Array.from(corners);
    this._extents = Float32Array.from(extents);
    this._frontSign = args.frontSign;
    this._front = new THREE.Vector3(0, 0, args.frontSign);
    this.eyeSpacing = args.eyeSpacing;
    this._maxDepth = args.eyeSpacing * FACE_COVER_MAX_DEPTH;
  }

  /** The number of triangles kept. */
  get triangleCount(): number {
    return this._extents.length / 4;
  }

  /**
   * The same cover, keeping only the triangles whose outline meets `extent`:
   * cheaper to test many points within it.
   */
  within(extent: FaceCoverExtent): FaceCover {
    const corners = this._corners;
    const triangles: FaceCoverTriangle[] = [];
    for (let at = 0; at < this.triangleCount; at += 1) {
      const point = (corner: number) =>
        new THREE.Vector3().fromArray(corners, at * 9 + corner * 3);
      triangles.push([point(0), point(1), point(2)]);
    }
    return new FaceCover({
      triangles,
      frontSign: this._frontSign,
      eyeSpacing: this.eyeSpacing,
      near: extent,
    });
  }

  /** Whether a surface lies in front of `point` (head space), close enough to cover it. */
  covers(point: THREE.Vector3): boolean {
    this._ray.set(point, this._front);
    const corners = this._corners;
    const extents = this._extents;
    for (let at = 0; at < extents.length / 4; at += 1) {
      if (
        point.x < extents[at * 4]! ||
        point.x > extents[at * 4 + 1]! ||
        point.y < extents[at * 4 + 2]! ||
        point.y > extents[at * 4 + 3]!
      ) {
        continue;
      }
      this._a.fromArray(corners, at * 9);
      this._b.fromArray(corners, at * 9 + 3);
      this._c.fromArray(corners, at * 9 + 6);
      if (
        !this._ray.intersectTriangle(
          this._a,
          this._b,
          this._c,
          false,
          this._hit,
        )
      ) {
        continue;
      }
      const depth = this._hit.sub(point).dot(this._front);
      if (depth > FACE_COVER_MIN_DEPTH && depth <= this._maxDepth) return true;
    }
    return false;
  }
}
