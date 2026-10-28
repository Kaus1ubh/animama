import * as THREE from "three";

/** A texture coordinate: a mesh UV, or a position on a texture's image. */
export type UvPoint = { x: number; y: number };

const IDENTITY_MATRIX = new THREE.Matrix3();

/**
 * One image coordinate wrapped as the texture samples it: repeat takes the
 * fraction, mirrored repeat flips odd tiles, clamp holds the edge. The tile
 * comes from `reference`, so the corners of one shape wrap together, and a
 * reference already on the image (0–1) leaves the value exactly as it is.
 */
function wrapCoordinate(
  value: number,
  reference: number,
  wrap: THREE.Wrapping | null,
): number {
  if (wrap === null) return value;
  if (wrap === THREE.ClampToEdgeWrapping) {
    return Math.min(1, Math.max(0, value));
  }
  if (reference >= 0 && reference <= 1) return value;
  const tile = Math.floor(reference);
  if (wrap === THREE.MirroredRepeatWrapping && Math.abs(tile) % 2 === 1) {
    return tile + 1 - value;
  }
  return value - tile;
}

/**
 * Where a mesh's UVs land on its texture's image, as three samples it: through
 * the texture's transform (`Texture.matrix`, from `KHR_texture_transform`
 * offset, scale and rotation; three-vrm ports VRM 0's `_MainTex_ST` tiling to
 * the same transform), then wrapped onto the image by `wrapS`/`wrapT` for UVs
 * outside 0–1. Image positions run 0–1 across the image with `y` down from its
 * top edge, like glTF UVs; multiply by the image size for pixels.
 *
 * Face anchors, the surface locator and the face skin's clip all place art
 * through this, so painted effects follow the texture as drawn. A texture
 * without a transform maps every UV inside 0–1 to itself, exactly.
 */
export class TextureUvMapping {
  /** UVs used as they are: no transform and no wrapping. */
  static readonly identity = new TextureUvMapping(null, null, null);

  /** The mapping of `texture` as it is now; identity without one. */
  static of(texture: THREE.Texture | null | undefined): TextureUvMapping {
    if (!texture) return TextureUvMapping.identity;
    // The renderer refreshes the matrix from offset, repeat and rotation
    // before drawing; do the same so a freshly loaded texture is current.
    if (texture.matrixAutoUpdate) texture.updateMatrix();
    return new TextureUvMapping(
      texture.matrix.equals(IDENTITY_MATRIX) ? null : texture.matrix.clone(),
      texture.wrapS,
      texture.wrapT,
    );
  }

  /** Null for an identity transform, which is skipped. */
  private readonly _matrix: THREE.Matrix3 | null;
  /** Null to leave coordinates outside 0–1 as they are. */
  private readonly _wrapS: THREE.Wrapping | null;
  private readonly _wrapT: THREE.Wrapping | null;

  private constructor(
    matrix: THREE.Matrix3 | null,
    wrapS: THREE.Wrapping | null,
    wrapT: THREE.Wrapping | null,
  ) {
    this._matrix = matrix;
    this._wrapS = wrapS;
    this._wrapT = wrapT;
  }

  /** `uv` through the texture's transform, before wrapping. */
  transform(uv: UvPoint): UvPoint {
    const elements = this._matrix?.elements;
    if (!elements) return { x: uv.x, y: uv.y };
    return {
      x: elements[0] * uv.x + elements[3] * uv.y + elements[6],
      y: elements[1] * uv.x + elements[4] * uv.y + elements[7],
    };
  }

  /**
   * Where `uv` lands on the image. A repeating texture wraps it by the tile
   * `reference` (a UV, `uv` itself by default) lands in, so points of one
   * shape (a triangle, an anchor's samples) stay together across a tile edge.
   */
  toImage(uv: UvPoint, reference: UvPoint = uv): UvPoint {
    const point = this.transform(uv);
    const tile = reference === uv ? point : this.transform(reference);
    return {
      x: wrapCoordinate(point.x, tile.x, this._wrapS),
      y: wrapCoordinate(point.y, tile.y, this._wrapT),
    };
  }
}

/**
 * The base colour texture (`map`) of a mesh's main material (the first of an
 * array, as an MToon outline is second), whose layout painted art follows.
 */
export function baseTextureOf(mesh: THREE.Mesh): THREE.Texture | null {
  const material = Array.isArray(mesh.material)
    ? mesh.material[0]
    : mesh.material;
  const map = (material as { map?: unknown } | undefined)?.map;
  return map instanceof THREE.Texture ? map : null;
}

/**
 * Triangles' corners on a texture's image: for each triangle of `vertices`
 * (three vertex indices each), six numbers (three x, y pairs) read from `uv`
 * and mapped through `mapping`, the triangle wrapped whole by its centroid.
 */
export function mapTrianglesToImage(
  uv: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
  vertices: ArrayLike<number>,
  mapping: TextureUvMapping,
): Float32Array {
  const triangleCount = Math.floor(vertices.length / 3);
  const corners = new Float32Array(triangleCount * 6);
  const uvs = [
    { x: 0, y: 0 },
    { x: 0, y: 0 },
    { x: 0, y: 0 },
  ];
  const centroid = { x: 0, y: 0 };
  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    centroid.x = 0;
    centroid.y = 0;
    for (let corner = 0; corner < 3; corner += 1) {
      const vertex = vertices[triangle * 3 + corner]!;
      uvs[corner]!.x = uv.getX(vertex);
      uvs[corner]!.y = uv.getY(vertex);
      centroid.x += uvs[corner]!.x / 3;
      centroid.y += uvs[corner]!.y / 3;
    }
    for (let corner = 0; corner < 3; corner += 1) {
      const point = mapping.toImage(uvs[corner]!, centroid);
      corners[triangle * 6 + corner * 2] = point.x;
      corners[triangle * 6 + corner * 2 + 1] = point.y;
    }
  }
  return corners;
}
