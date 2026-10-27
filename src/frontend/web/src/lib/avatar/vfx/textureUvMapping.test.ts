import * as THREE from "three";
import { describe, expect, it } from "vitest";

import {
  baseTextureOf,
  mapTrianglesToImage,
  TextureUvMapping,
} from "./textureUvMapping";

function texture(settings: {
  offset?: [number, number];
  repeat?: [number, number];
  rotation?: number;
  wrap?: THREE.Wrapping;
}): THREE.Texture {
  const result = new THREE.Texture();
  result.offset.set(...(settings.offset ?? [0, 0]));
  result.repeat.set(...(settings.repeat ?? [1, 1]));
  result.rotation = settings.rotation ?? 0;
  result.wrapS = result.wrapT = settings.wrap ?? THREE.RepeatWrapping;
  return result;
}

describe("TextureUvMapping", () => {
  it("leaves UVs on an untransformed texture exactly as they are", () => {
    const mapping = TextureUvMapping.of(texture({}));
    expect(mapping.isTransformed).toBe(false);
    for (const uv of [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
      { x: 0.1234567, y: 0.7654321 },
    ]) {
      expect(mapping.toImage(uv)).toEqual(uv);
    }
  });

  it("applies offset and repeat as three samples them", () => {
    const mapping = TextureUvMapping.of(
      texture({ offset: [0.25, 0.1], repeat: [0.5, 0.5] }),
    );
    expect(mapping.isTransformed).toBe(true);
    const point = mapping.toImage({ x: 0.5, y: 0.5 });
    expect(point.x).toBeCloseTo(0.5);
    expect(point.y).toBeCloseTo(0.35);
  });

  it("follows the texture's rotation", () => {
    const rotated = texture({ rotation: Math.PI / 2 });
    const point = TextureUvMapping.of(rotated).transform({ x: 0.2, y: 0.1 });
    const expected = new THREE.Vector2(0.2, 0.1).applyMatrix3(rotated.matrix);
    expect(point.x).toBeCloseTo(expected.x);
    expect(point.y).toBeCloseTo(expected.y);
  });

  it("uses a texture's own matrix when it is not updated automatically", () => {
    const fixed = texture({});
    fixed.matrixAutoUpdate = false;
    fixed.matrix.setUvTransform(0.5, 0, 1, 1, 0, 0, 0);
    expect(TextureUvMapping.of(fixed).toImage({ x: 0.25, y: 0.5 })).toEqual({
      x: 0.75,
      y: 0.5,
    });
  });

  it.each([
    [THREE.RepeatWrapping, 0.25],
    [THREE.MirroredRepeatWrapping, 0.75],
    [THREE.ClampToEdgeWrapping, 1],
  ])("wraps UVs outside 0–1 (wrap %i)", (wrap, expected) => {
    const mapping = TextureUvMapping.of(texture({ wrap }));
    expect(mapping.toImage({ x: 1.25, y: 0.5 }).x).toBeCloseTo(expected);
  });

  it("wraps the points of one shape by its reference's tile", () => {
    const mapping = TextureUvMapping.of(texture({}));
    // A corner just past the tile edge stays beside its shape...
    expect(
      mapping.toImage({ x: 2.02, y: 0.5 }, { x: 1.98, y: 0.5 }).x,
    ).toBeCloseTo(1.02);
    // ...where on its own it would wrap to the image's other side.
    expect(mapping.toImage({ x: 2.02, y: 0.5 }).x).toBeCloseTo(0.02);
  });

  it("maps triangles whole by their centroids", () => {
    const uv = new THREE.Float32BufferAttribute(
      [0.9, 0.5, 1.2, 0.5, 1.1, 0.7, 0.2, 0.2, 0.3, 0.2, 0.25, 0.3],
      2,
    );
    const corners = mapTrianglesToImage(
      uv,
      [0, 1, 2, 3, 4, 5],
      TextureUvMapping.of(texture({})),
    );
    // The first triangle's centroid (u 1.07) lies past the edge: it moves
    // back one tile as a whole; the second is on the image and unchanged.
    const expected = [
      -0.1, 0.5, 0.2, 0.5, 0.1, 0.7, 0.2, 0.2, 0.3, 0.2, 0.25, 0.3,
    ];
    expect(corners).toHaveLength(expected.length);
    expected.forEach((value, index) =>
      expect(corners[index]).toBeCloseTo(value, 6),
    );
  });

  it("reads the base texture of a mesh's main material", () => {
    const map = new THREE.Texture();
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(), [
      new THREE.MeshBasicMaterial({ map }),
      new THREE.MeshBasicMaterial(),
    ]);
    expect(baseTextureOf(mesh)).toBe(map);
    expect(baseTextureOf(new THREE.Mesh())).toBeNull();
  });
});
