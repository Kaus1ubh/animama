import * as THREE from "three";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createAvatarGltfLoader } from "./avatarGltfLoader";
import { configureAvatarGltfLoader } from "./configureAvatarGltfLoader";
import { loadHeadlessVrm } from "./motion-authoring/headlessVrm";
import { encodeGlb } from "./testing/glb";
import { INDICES, meshoptTriangleGlb, POSITIONS } from "./testing/meshoptGlb";

/** The single triangle mesh of a loaded scene. */
function onlyMesh(scene: THREE.Object3D): THREE.Mesh {
  const meshes: THREE.Mesh[] = [];
  scene.traverse((object) => {
    if ((object as THREE.Mesh).isMesh) meshes.push(object as THREE.Mesh);
  });
  expect(meshes).toHaveLength(1);
  return meshes[0]!;
}

beforeEach(() => {
  // three warns about unknown required extensions; the tests assert outcomes.
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("configureAvatarGltfLoader", () => {
  it("loads a meshopt-compressed file through the Avatar loader", async () => {
    const gltf = await createAvatarGltfLoader().parseAsync(
      meshoptTriangleGlb(),
      "",
    );
    const geometry = onlyMesh(gltf.scene).geometry;
    expect(Array.from(geometry.getAttribute("position").array)).toEqual(
      POSITIONS,
    );
    expect(Array.from(geometry.getIndex()!.array)).toEqual(INDICES);
  });

  it("is what a plain loader lacks for meshopt", async () => {
    await expect(
      new GLTFLoader().parseAsync(meshoptTriangleGlb(), ""),
    ).rejects.toThrow(/setMeshoptDecoder/);
    const gltf = await configureAvatarGltfLoader(new GLTFLoader()).parseAsync(
      meshoptTriangleGlb(),
      "",
    );
    expect(onlyMesh(gltf.scene).geometry.getIndex()!.count).toBe(3);
  });

  it("refuses a file requiring an extension three would skip, naming it", async () => {
    const unknown = meshoptTriangleGlb({
      extensionsUsed: ["EXT_meshopt_compression", "EXT_unknown_test"],
      extensionsRequired: ["EXT_meshopt_compression", "EXT_unknown_test"],
    });
    // three alone draws the file without it.
    await expect(
      new GLTFLoader()
        .setMeshoptDecoder(MeshoptDecoder)
        .parseAsync(unknown, ""),
    ).resolves.toBeTruthy();
    await expect(
      createAvatarGltfLoader().parseAsync(unknown, ""),
    ).rejects.toThrow(/EXT_unknown_test/);
  });

  it("fails a Draco file instead of drawing part of it", async () => {
    // A VRM, so the headless loader would otherwise get as far as the model.
    const draco = encodeGlb({
      asset: { version: "2.0" },
      extensionsUsed: ["VRMC_vrm", "KHR_draco_mesh_compression"],
      extensionsRequired: ["KHR_draco_mesh_compression"],
      extensions: { VRMC_vrm: { specVersion: "1.0" } },
      meshes: [{ primitives: [{ attributes: {} }] }],
    }).buffer as ArrayBuffer;
    // three refuses it before any plugin runs: no Draco decoder is served.
    const refusal = /No DRACOLoader instance/;
    await expect(
      createAvatarGltfLoader().parseAsync(draco, ""),
    ).rejects.toThrow(refusal);
    await expect(loadHeadlessVrm(draco)).rejects.toThrow(refusal);
  });
});
