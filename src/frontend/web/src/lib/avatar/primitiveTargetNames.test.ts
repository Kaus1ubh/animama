import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createAvatarGltfLoader } from "./avatarGltfLoader";
import { configureAvatarGltfLoader } from "./configureAvatarGltfLoader";
import { resolveMeshTargetNames } from "./primitiveTargetNames";
import { encodeGlb } from "./testing/glb";

type Primitive = { targets?: number; names?: unknown };
type MeshSpec = { primitives: Primitive[]; names?: string[] };

/** A glTF mesh definition with `targets` morph targets per primitive. */
function meshDef({ primitives, names }: MeshSpec) {
  return {
    primitives: primitives.map(({ targets = 2, names: primitiveNames }) => ({
      attributes: { POSITION: 0 },
      targets: Array.from({ length: targets }, () => ({ POSITION: 1 })),
      ...(primitiveNames === undefined
        ? {}
        : { extras: { targetNames: primitiveNames } }),
    })),
    ...(names ? { extras: { targetNames: names } } : {}),
  };
}

/**
 * A synthetic GLB whose meshes are one triangle per primitive, sharing one
 * morph displacement. Each mesh gets a node; `instances` adds that many more
 * nodes for the first mesh, which three loads as clones.
 */
function morphGlb(meshes: MeshSpec[], instances = 0): ArrayBuffer {
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const displacement = new Float32Array([0, 0, 0.1, 0, 0, 0, 0, 0, 0]);
  const bin = new Uint8Array(positions.byteLength + displacement.byteLength);
  bin.set(new Uint8Array(positions.buffer), 0);
  bin.set(new Uint8Array(displacement.buffer), positions.byteLength);
  const nodes = [
    ...meshes.map((_, mesh) => ({ mesh })),
    ...Array.from({ length: instances }, () => ({ mesh: 0 })),
  ];
  const vec3 = (bufferView: number) => ({
    bufferView,
    componentType: 5126,
    count: 3,
    type: "VEC3",
  });
  return encodeGlb(
    {
      asset: { version: "2.0" },
      scenes: [{ nodes: nodes.map((_, index) => index) }],
      nodes,
      meshes: meshes.map(meshDef),
      accessors: [
        { ...vec3(0), min: [0, 0, 0], max: [1, 1, 0] },
        { ...vec3(1), min: [0, 0, 0], max: [0, 0, 0.1] },
      ],
      bufferViews: [
        { buffer: 0, byteOffset: 0, byteLength: positions.byteLength },
        {
          buffer: 0,
          byteOffset: positions.byteLength,
          byteLength: displacement.byteLength,
        },
      ],
      buffers: [{ byteLength: bin.byteLength }],
    },
    bin,
  ).buffer as ArrayBuffer;
}

/** Each loaded mesh's morph-target dictionary, in scene order. */
function dictionaries(scene: THREE.Object3D): Record<string, number>[] {
  const found: Record<string, number>[] = [];
  scene.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (mesh.isMesh) found.push({ ...mesh.morphTargetDictionary });
  });
  return found;
}

/** What three names targets it finds no names for. */
const UNNAMED = { "0": 0, "1": 1 };

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("resolveMeshTargetNames", () => {
  it("reports a mesh without morph targets", () => {
    expect(
      resolveMeshTargetNames(meshDef({ primitives: [{ targets: 0 }] })),
    ).toEqual({ source: "none", names: [] });
    expect(resolveMeshTargetNames(null)).toEqual({ source: "none", names: [] });
  });

  it("keeps mesh-level names, which three applies itself", () => {
    expect(
      resolveMeshTargetNames(
        meshDef({ names: ["a", "b"], primitives: [{ names: ["x", "y"] }] }),
      ),
    ).toEqual({ source: "mesh", names: ["a", "b"] });
  });

  it("takes the names every named primitive stores alike", () => {
    expect(
      resolveMeshTargetNames(
        meshDef({ primitives: [{ names: ["a", "b"] }, { names: ["a", "b"] }] }),
      ),
    ).toEqual({ source: "primitives", names: ["a", "b"] });
    // A primitive without names shares the mesh's targets, so it takes them.
    expect(
      resolveMeshTargetNames(
        meshDef({ primitives: [{ names: ["a", "b"] }, {}, { targets: 0 }] }),
      ),
    ).toEqual({ source: "primitives", names: ["a", "b"] });
  });

  it("refuses lists that disagree or do not fit the targets", () => {
    const mismatched = { source: "mismatched", names: [] };
    for (const primitives of [
      [{ names: ["a", "b"] }, { names: ["a", "c"] }],
      [{ names: ["a", "b"] }, { names: ["a", "b", "c"], targets: 3 }],
      [{ names: ["a"] }],
      [{ names: ["a", 2] }],
      [{ names: ["a", "b"] }, { targets: 3 }],
    ])
      expect(resolveMeshTargetNames(meshDef({ primitives }))).toEqual(
        mismatched,
      );
  });

  it("reports targets named nowhere", () => {
    expect(
      resolveMeshTargetNames(meshDef({ primitives: [{}, { names: "a" }] })),
    ).toEqual({ source: "unnamed", names: [] });
  });
});

describe("Avatar loaders and per-primitive morph-target names", () => {
  const perPrimitive: MeshSpec = {
    primitives: [{ names: ["まばたき", "あ"] }, { names: ["まばたき", "あ"] }],
  };

  it("name targets that only the primitives name, on every instance", async () => {
    const glb = morphGlb([perPrimitive], 1);
    // three alone reads mesh-level names only.
    const plain = await new GLTFLoader().parseAsync(glb, "");
    expect(dictionaries(plain.scene)).toEqual([
      UNNAMED,
      UNNAMED,
      UNNAMED,
      UNNAMED,
    ]);
    const named = { まばたき: 0, あ: 1 };
    for (const loader of [
      createAvatarGltfLoader(),
      configureAvatarGltfLoader(new GLTFLoader()),
    ]) {
      const gltf = await loader.parseAsync(glb, "");
      // Two primitives on the mesh's node and on its cloned instance.
      expect(dictionaries(gltf.scene)).toEqual([named, named, named, named]);
    }
    expect(warn).not.toHaveBeenCalled();
  });

  it("leave mesh-level names as three applies them", async () => {
    const glb = morphGlb([
      {
        names: ["blink", "aa"],
        primitives: [{ names: ["x", "y"] }, { names: ["x", "y"] }],
      },
    ]);
    const plain = await new GLTFLoader().parseAsync(glb, "");
    const gltf = await createAvatarGltfLoader().parseAsync(glb, "");
    expect(dictionaries(gltf.scene)).toEqual(dictionaries(plain.scene));
    expect(dictionaries(gltf.scene)).toEqual([
      { blink: 0, aa: 1 },
      { blink: 0, aa: 1 },
    ]);
  });

  it("leave disagreeing lists unnamed and warn once", async () => {
    const glb = morphGlb([
      { primitives: [{ names: ["a", "b"] }, { names: ["a", "c"] }] },
      { primitives: [{ names: ["a"] }] },
      perPrimitive,
    ]);
    const gltf = await createAvatarGltfLoader().parseAsync(glb, "");
    expect(dictionaries(gltf.scene)).toEqual([
      UNNAMED,
      UNNAMED,
      UNNAMED,
      { まばたき: 0, あ: 1 },
      { まばたき: 0, あ: 1 },
    ]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toMatch(/morph targets differently/);
    expect(warn.mock.calls[0]?.[1]).toMatchObject({ meshes: 2 });
  });
});
