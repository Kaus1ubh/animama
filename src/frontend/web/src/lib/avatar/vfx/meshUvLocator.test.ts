import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { MeshUvLocator } from "./meshUvLocator";
import { TextureUvMapping } from "./textureUvMapping";

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

  it("finds image points through the texture's transform", () => {
    // The texture shows u 0..1 on the image's right half (offset and repeat).
    const texture = new THREE.Texture();
    texture.offset.set(0.5, 0);
    texture.repeat.set(0.5, 1);
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1, 4, 4));
    const locator = MeshUvLocator.create(mesh, TextureUvMapping.of(texture))!;

    // Image x 0.625 is u 0.25, x −0.25 on the plane.
    const point = locator.toWorld({ x: 0.625, y: 0.75 })!;
    expect(point.x).toBeCloseTo(-0.25);
    expect(point.y).toBeCloseTo(0.25);
  });

  it("finds image points on UVs laid out past 0–1 on a repeating texture", () => {
    const geometry = new THREE.PlaneGeometry(1, 1, 4, 4);
    const uv = geometry.getAttribute("uv");
    for (let i = 0; i < uv.count; i += 1) uv.setX(i, uv.getX(i) * 0.5 + 1.25);
    const texture = new THREE.Texture();
    texture.wrapS = THREE.RepeatWrapping;
    const locator = MeshUvLocator.create(
      new THREE.Mesh(geometry),
      TextureUvMapping.of(texture),
    )!;

    // u 1.375 (x −0.25 on the plane) repeats at image x 0.375.
    const point = locator.toWorld({ x: 0.375, y: 0.5 })!;
    expect(point.x).toBeCloseTo(-0.25);
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
