import * as THREE from "three";

import type { Avatar } from "../Avatar";
import { selectFaceIsland } from "./AvatarFaceTextureAnchors";
import {
  collectPrimitiveData,
  withoutTriangles,
  type RuntimePrimitiveBindingEntry,
} from "./avatarPrimitiveUtils";
import type { AvatarFaceLandmarksSnapshot } from "./landmark-types";
import { mapTrianglesToImage, TextureUvMapping } from "./textureUvMapping";

/**
 * How far each clip triangle grows, in texture pixels (its edges move about
 * 1–1.5 px): enough that filtering at full resolution samples tinted texels
 * at the island's edge. Lower mipmap levels can still blend across it.
 */
const CLIP_DILATION_PX = 1.5;
/** A sliver triangle's corners move at most this many dilations outward. */
const CLIP_MAX_CORNER_SHIFT = 3;

/** One face skin primitive drawing on the texture image being clipped. */
export type FaceSkinClipSource = {
  entry: RuntimePrimitiveBindingEntry;
  /** Its own texture showing that image, whose transform maps its UVs. */
  texture: THREE.Texture;
  /**
   * `createFaceVertexFilter`'s test for a primitive that also holds neck or
   * body vertices; null for a head-skinned one, all of whose triangles count.
   */
  keepVertex: ((vertex: number) => boolean) | null;
  /** Its eye-line and lash part `regions` (triangle numbers), left out. */
  regions: ReadonlySet<number>;
};

/**
 * The face skin's own triangles on one texture image, for clipping whole-face
 * art to the face's region of the texture: six numbers (three image x, y
 * pairs, 0–1) per triangle, all wound the same way so overlapping triangles
 * (mirrored UV halves) add up under the non-zero rule instead of cancelling.
 *
 * Each primitive first loses its eye-line and lash regions, by number, so the
 * result is the same whether an eye effect hides them at the time. It then
 * keeps its face island and the islands outside the face's outline
 * (`selectFaceIsland`): an inner mouth, teeth or eyes inside the outline are
 * left out, VRoid's ears kept. A primitive that also holds the neck or body
 * keeps only the triangles whose corners all pass its `keepVertex` (the
 * island's, should none pass). `complete` is whether every triangle of every
 * primitive was kept, as on a VRoid face: the clip then removes nothing the
 * face's own texture shows.
 */
export function collectFaceSkinClipTriangles(args: {
  avatar: Avatar;
  anchorObject: THREE.Object3D | null;
  landmarks: AvatarFaceLandmarksSnapshot | null;
  sources: readonly FaceSkinClipSource[];
}): { triangles: Float32Array; complete: boolean } {
  const parts: Float32Array[] = [];
  let complete = true;
  // A primitive that cannot be read leaves the art unclipped, as before.
  const unclipped = { triangles: new Float32Array(), complete: true };
  for (const source of args.sources) {
    const geometry = source.entry.object.geometry;
    const uv = geometry.getAttribute("uv");
    const position = geometry.getAttribute("position");
    if (
      !(uv instanceof THREE.BufferAttribute) ||
      !(position instanceof THREE.BufferAttribute)
    ) {
      return unclipped;
    }
    const all = collectPrimitiveData({
      avatar: args.avatar,
      binding: source.entry,
      anchorObject: args.anchorObject ?? source.entry.object,
    });
    if (!all) return unclipped;
    const primitiveData = withoutTriangles(all, source.regions);
    const island = args.landmarks
      ? selectFaceIsland({
          primitiveData,
          position,
          uv,
          landmarks: args.landmarks,
          withOuterIslands: true,
        })
      : primitiveData.orderedVertexIndices;
    let kept = island;
    const keep = source.keepVertex;
    if (keep) {
      kept = [];
      for (let offset = 0; offset + 2 < island.length; offset += 3) {
        const corners = island.slice(offset, offset + 3);
        if (corners.every(keep)) kept.push(...corners);
      }
      if (kept.length === 0) kept = island;
    }
    complete &&= kept.length === all.orderedVertexIndices.length;
    const corners = mapTrianglesToImage(
      uv,
      kept,
      TextureUvMapping.of(source.texture),
    );
    windPositive(corners);
    parts.push(corners);
  }
  const triangles = new Float32Array(
    parts.reduce((sum, part) => sum + part.length, 0),
  );
  let offset = 0;
  for (const part of parts) {
    triangles.set(part, offset);
    offset += part.length;
  }
  return { triangles, complete };
}

/** Reorder each triangle's corners to one winding: a positive signed area. */
function windPositive(corners: Float32Array): void {
  for (let base = 0; base + 5 < corners.length; base += 6) {
    const area =
      (corners[base + 2]! - corners[base]!) *
        (corners[base + 5]! - corners[base + 1]!) -
      (corners[base + 4]! - corners[base]!) *
        (corners[base + 3]! - corners[base + 1]!);
    if (area >= 0) continue;
    const x = corners[base + 2]!;
    const y = corners[base + 3]!;
    corners[base + 2] = corners[base + 4]!;
    corners[base + 3] = corners[base + 5]!;
    corners[base + 4] = x;
    corners[base + 5] = y;
  }
}

/**
 * Clip triangles in a texture's pixels, each grown about its centroid so its
 * edges move out about {@link CLIP_DILATION_PX}: seams between triangles and
 * at the island's edge then stay covered. A sliver's corners move at most
 * {@link CLIP_MAX_CORNER_SHIFT} dilations; a degenerate triangle is dropped.
 */
export function dilateClipTriangles(
  triangles: Float32Array,
  size: { width: number; height: number },
): Float32Array {
  const out = new Float32Array(triangles.length);
  let written = 0;
  const xs = [0, 0, 0];
  const ys = [0, 0, 0];
  for (let base = 0; base + 5 < triangles.length; base += 6) {
    for (let corner = 0; corner < 3; corner += 1) {
      xs[corner] = triangles[base + corner * 2]! * size.width;
      ys[corner] = triangles[base + corner * 2 + 1]! * size.height;
    }
    const cx = (xs[0]! + xs[1]! + xs[2]!) / 3;
    const cy = (ys[0]! + ys[1]! + ys[2]!) / 3;
    const doubleArea = Math.abs(
      (xs[1]! - xs[0]!) * (ys[2]! - ys[0]!) -
        (xs[2]! - xs[0]!) * (ys[1]! - ys[0]!),
    );
    const perimeter =
      Math.hypot(xs[1]! - xs[0]!, ys[1]! - ys[0]!) +
      Math.hypot(xs[2]! - xs[1]!, ys[2]! - ys[1]!) +
      Math.hypot(xs[0]! - xs[2]!, ys[0]! - ys[2]!);
    const reach = Math.max(
      ...[0, 1, 2].map((corner) =>
        Math.hypot(xs[corner]! - cx, ys[corner]! - cy),
      ),
    );
    if (doubleArea <= 0 || reach <= 0) continue;
    // Growing the inradius r (2 × area / perimeter) by d scales the triangle
    // by about 1 + d / r.
    const inradius = doubleArea / perimeter;
    const scale = Math.min(
      1 + CLIP_DILATION_PX / inradius,
      1 + (CLIP_MAX_CORNER_SHIFT * CLIP_DILATION_PX) / reach,
    );
    for (let corner = 0; corner < 3; corner += 1) {
      out[written++] = cx + (xs[corner]! - cx) * scale;
      out[written++] = cy + (ys[corner]! - cy) * scale;
    }
  }
  return out.slice(0, written);
}

/** Add pixel triangles to a path (a `Path2D` or a context's current path). */
export function traceClipTriangles(
  path: Pick<CanvasPath, "moveTo" | "lineTo" | "closePath">,
  triangles: Float32Array,
): void {
  for (let base = 0; base + 5 < triangles.length; base += 6) {
    path.moveTo(triangles[base]!, triangles[base + 1]!);
    path.lineTo(triangles[base + 2]!, triangles[base + 3]!);
    path.lineTo(triangles[base + 4]!, triangles[base + 5]!);
    path.closePath();
  }
}

/**
 * The clip as a `Path2D` of pixel triangles, built once so each composite
 * redraw clips with it instead of tracing every triangle again.
 */
export function createClipPath(triangles: Float32Array): Path2D {
  const path = new Path2D();
  traceClipTriangles(path, triangles);
  return path;
}
