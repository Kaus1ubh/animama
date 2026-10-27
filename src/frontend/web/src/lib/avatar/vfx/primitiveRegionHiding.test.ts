import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { PrimitiveRegionHider } from "./primitiveRegionHiding";

/** Corners of each triangle in the geometry's index. */
const triangles = (geometry: THREE.BufferGeometry) => {
  const index = geometry.getIndex()!;
  return Array.from({ length: index.count / 3 }, (_, triangle) =>
    [0, 1, 2].map((corner) => index.getX(triangle * 3 + corner)),
  );
};

describe("PrimitiveRegionHider", () => {
  it("keeps a region hidden until every source releases it", () => {
    const geometry = new THREE.PlaneGeometry(1, 1, 2, 1); // four triangles
    const original = triangles(geometry);
    const hider = new PrimitiveRegionHider();

    expect(hider.hide("a", geometry, [1, 2])).toBe(true);
    expect(hider.hide("b", geometry, [2])).toBe(true);
    const hidden = triangles(geometry);
    expect(hidden[0]).toEqual(original[0]);
    expect(new Set(hidden[1]).size).toBe(1);
    expect(new Set(hidden[2]).size).toBe(1);

    hider.release("a");
    expect(triangles(geometry)[1]).toEqual(original[1]);
    expect(new Set(triangles(geometry)[2]).size).toBe(1);

    hider.release("b");
    expect(triangles(geometry)).toEqual(original);
  });

  it("restores everything at once and ignores triangles out of range", () => {
    const geometry = new THREE.PlaneGeometry(1, 1, 2, 1);
    const original = triangles(geometry);
    const hider = new PrimitiveRegionHider();
    hider.hide("a", geometry, [0, 3, 99, -1]);
    hider.restoreAll();
    expect(triangles(geometry)).toEqual(original);
  });

  it("reports a geometry without an index as not hideable", () => {
    const geometry = new THREE.PlaneGeometry().toNonIndexed();
    expect(new PrimitiveRegionHider().hide("a", geometry, [0])).toBe(false);
  });
});
