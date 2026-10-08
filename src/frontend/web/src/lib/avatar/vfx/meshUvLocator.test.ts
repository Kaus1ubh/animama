import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { MeshUvLocator } from "./meshUvLocator";

describe("MeshUvLocator", () => {
  it("maps UV points onto the mesh's current world surface", () => {
    // PlaneGeometry maps u 0..1 to x −0.5..0.5 and v 0..1 to y −0.5..0.5.
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1, 4, 4));
    mesh.position.set(0, 1.5, 0.2);
    mesh.updateMatrixWorld(true);
    const locator = MeshUvLocator.create(mesh)!;

    const point = locator.toWorld({ x: 0.25, y: 0.75 })!;
    expect(point.x).toBeCloseTo(-0.25);
    expect(point.y).toBeCloseTo(1.75);
    expect(point.z).toBeCloseTo(0.2);
  });

  it("uses the nearest surface point for UVs outside the layout", () => {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1));
    const locator = MeshUvLocator.create(mesh)!;
    const point = locator.toWorld({ x: 1.2, y: 0.5 })!;
    expect(point.x).toBeCloseTo(0.5);
    expect(point.y).toBeCloseTo(0);
  });

  it("follows morph targets", () => {
    const geometry = new THREE.PlaneGeometry(1, 1);
    const moved = geometry.getAttribute("position").clone();
    for (let i = 0; i < moved.count; i += 1) moved.setZ(i, 0.1);
    geometry.morphAttributes.position = [moved];
    geometry.morphTargetsRelative = false;
    const mesh = new THREE.Mesh(geometry);
    mesh.updateMorphTargets();
    mesh.morphTargetInfluences![0] = 1;
    const point = MeshUvLocator.create(mesh)!.toWorld({ x: 0.5, y: 0.5 })!;
    expect(point.z).toBeCloseTo(0.1);
  });

  it("is unavailable without UVs", () => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3),
    );
    expect(MeshUvLocator.create(new THREE.Mesh(geometry))).toBeNull();
  });
});
