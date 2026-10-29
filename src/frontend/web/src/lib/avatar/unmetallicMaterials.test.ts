import * as THREE from "three";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createAvatarGltfLoader } from "./avatarGltfLoader";
import { encodeGlb } from "./testing/glb";

/**
 * A one-triangle GLB whose single material is `material`, loaded through the
 * app's Avatar loader.
 */
async function loadMaterial(
  material: Record<string, unknown>,
  extensionsUsed: string[] = [],
): Promise<THREE.Material> {
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const glb = encodeGlb(
    {
      asset: { version: "2.0" },
      ...(extensionsUsed.length ? { extensionsUsed } : {}),
      buffers: [{ byteLength: positions.byteLength }],
      bufferViews: [{ buffer: 0, byteLength: positions.byteLength }],
      accessors: [
        {
          bufferView: 0,
          componentType: 5126,
          count: 3,
          type: "VEC3",
          min: [0, 0, 0],
          max: [1, 1, 0],
        },
      ],
      materials: [material],
      meshes: [{ primitives: [{ attributes: { POSITION: 0 }, material: 0 }] }],
      nodes: [{ mesh: 0 }],
      scenes: [{ nodes: [0] }],
    },
    new Uint8Array(positions.buffer),
  );
  const gltf = await createAvatarGltfLoader().parseAsync(
    glb.buffer.slice(
      glb.byteOffset,
      glb.byteOffset + glb.byteLength,
    ) as ArrayBuffer,
    "",
  );
  let result: THREE.Material | null = null;
  gltf.scene.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (mesh.isMesh) result = mesh.material as THREE.Material;
  });
  if (!result) throw new Error("No mesh in the test glTF");
  return result;
}

afterEach(() => vi.restoreAllMocks());

describe("plain glTF materials on Avatars", () => {
  it.each([
    ["metallicFactor 1", { pbrMetallicRoughness: { metallicFactor: 1 } }],
    // glTF's default metallicFactor is 1.
    ["no metallicFactor", { pbrMetallicRoughness: {} }],
    ["no pbrMetallicRoughness", {}],
    ["metallicFactor 0.4", { pbrMetallicRoughness: { metallicFactor: 0.4 } }],
  ])("draws a material with %s unmetallic", async (_label, definition) => {
    const material = await loadMaterial({ name: "Armor", ...definition });
    expect(material).toBeInstanceOf(THREE.MeshStandardMaterial);
    // Without an environment map, metal reflects nothing and renders black.
    expect((material as THREE.MeshStandardMaterial).metalness).toBe(0);
    // Roughness is the file's.
    expect((material as THREE.MeshStandardMaterial).roughness).toBe(1);
    material.dispose();
  });

  it("leaves MToon materials to MToon", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const material = await loadMaterial(
      {
        name: "Skin",
        pbrMetallicRoughness: { metallicFactor: 1 },
        extensions: { VRMC_materials_mtoon: { specVersion: "1.0" } },
      },
      ["VRMC_materials_mtoon"],
    );
    expect(material).not.toBeInstanceOf(THREE.MeshStandardMaterial);
    expect((material as { isMToonMaterial?: boolean }).isMToonMaterial).toBe(
      true,
    );
    // No `metalness` reached a material that has none.
    expect(
      warn.mock.calls.filter((call) => String(call[0]).includes("metalness")),
    ).toEqual([]);
    material.dispose();
  });
});
