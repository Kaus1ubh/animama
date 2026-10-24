import { LilToonMaterial } from "@mochiya/three-liltoon";
import { VRMLoaderPlugin, type VRM } from "@pixiv/three-vrm";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { afterEach, describe, expect, it, vi } from "vitest";

import { withEnhancedMToonPatch } from "../enhanced-rendering/mtoonPatch";
import { PlaceholderTexturePlugin } from "../motion-authoring/headlessVrm";
import { readTestAvatarBytes } from "../motion-authoring/testing/includedAvatars";
import {
  installLilToonRenderingWhenLoaded,
  LILTOON_MATERIALS_EXTENSION,
  loadLilToonRuntime,
  setLilToonRuntimeImporterForTesting,
  usesLilToonMaterials,
  withOnDemandLilToon,
  type LilToonRuntime,
} from "./lilToon";

let restoreImporter: (() => void) | null = null;
afterEach(() => {
  restoreImporter?.();
  restoreImporter = null;
});

/** A fake runtime whose calls the test can inspect. */
function fakeRuntime() {
  const material = new THREE.MeshBasicMaterial();
  const calls = { enhanced: 0 };
  const releases: string[] = [];
  const runtime: LilToonRuntime = {
    enhancePlugin: (plugin) => {
      calls.enhanced += 1;
      (plugin as PluginWithMaterials).loadMaterial = (index) =>
        index === 0 ? Promise.resolve(material) : null;
    },
    enableRendering: (renderer) => () => {
      releases.push(String((renderer as unknown as { id: string }).id));
    },
  };
  return { runtime, material, calls, releases };
}

type PluginWithMaterials = VRMLoaderPlugin & {
  loadMaterial?: (index: number) => Promise<THREE.Material> | null;
};

/** A stand-in VRM loader plugin around a glTF JSON document. */
function fakePlugin(json: unknown): PluginWithMaterials {
  return {
    parser: { json },
    beforeRoot: vi.fn(async () => undefined),
    afterRoot: vi.fn(async () => undefined),
  } as unknown as PluginWithMaterials;
}

describe("usesLilToonMaterials", () => {
  it("looks for the extension in extensionsUsed", () => {
    expect(
      usesLilToonMaterials({ extensionsUsed: [LILTOON_MATERIALS_EXTENSION] }),
    ).toBe(true);
    expect(usesLilToonMaterials({ extensionsUsed: ["VRMC_vrm"] })).toBe(false);
    expect(usesLilToonMaterials({})).toBe(false);
    expect(usesLilToonMaterials(null)).toBe(false);
  });
});

describe("withOnDemandLilToon", () => {
  it("never imports lilToon or adds a material hook without the extension", async () => {
    const importer = vi.fn(async () => fakeRuntime().runtime);
    restoreImporter = setLilToonRuntimeImporterForTesting(importer);
    const plugin = withOnDemandLilToon(
      fakePlugin({ extensionsUsed: ["VRMC_vrm"] }),
    );

    await plugin.beforeRoot();
    expect(plugin.loadMaterial).toBeUndefined();
    expect(importer).not.toHaveBeenCalled();
  });

  it("enhances the plugin once the runtime loads, sharing one import", async () => {
    const fake = fakeRuntime();
    const importer = vi.fn(async () => fake.runtime);
    restoreImporter = setLilToonRuntimeImporterForTesting(importer);
    const json = { extensionsUsed: [LILTOON_MATERIALS_EXTENSION] };
    const first = withOnDemandLilToon(fakePlugin(json));
    const second = withOnDemandLilToon(fakePlugin(json));

    await Promise.all([first.beforeRoot(), second.beforeRoot()]);
    expect(importer).toHaveBeenCalledTimes(1);
    expect(fake.calls.enhanced).toBe(2);
    await expect(first.loadMaterial?.(0)).resolves.toBe(fake.material);
  });

  it("keeps the fallback materials when lilToon fails to load, then retries", async () => {
    const fake = fakeRuntime();
    const importer = vi
      .fn<() => Promise<LilToonRuntime>>()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue(fake.runtime);
    restoreImporter = setLilToonRuntimeImporterForTesting(importer);
    const json = { extensionsUsed: [LILTOON_MATERIALS_EXTENSION] };

    const failed = withOnDemandLilToon(fakePlugin(json));
    await expect(failed.beforeRoot()).resolves.toBeUndefined();
    expect(failed.loadMaterial).toBeUndefined();

    const retried = withOnDemandLilToon(fakePlugin(json));
    await retried.beforeRoot();
    await expect(retried.loadMaterial?.(0)).resolves.toBe(fake.material);
  });
});

describe("installLilToonRenderingWhenLoaded", () => {
  it("waits for the runtime, then installs and releases the passes", async () => {
    const fake = fakeRuntime();
    restoreImporter = setLilToonRuntimeImporterForTesting(
      async () => fake.runtime,
    );
    const before = { id: "before" } as unknown as THREE.WebGLRenderer;
    const cancelled = { id: "cancelled" } as unknown as THREE.WebGLRenderer;
    const enable = vi.spyOn(fake.runtime, "enableRendering");

    const releaseBefore = installLilToonRenderingWhenLoaded(before);
    installLilToonRenderingWhenLoaded(cancelled)();
    expect(enable).not.toHaveBeenCalled();

    await loadLilToonRuntime();
    expect(enable).toHaveBeenCalledTimes(1);
    expect(enable).toHaveBeenCalledWith(before);

    const after = { id: "after" } as unknown as THREE.WebGLRenderer;
    const releaseAfter = installLilToonRenderingWhenLoaded(after);
    expect(enable).toHaveBeenLastCalledWith(after);

    releaseBefore();
    releaseAfter();
    expect(fake.releases).toEqual(["before", "after"]);
  });

  it("keeps installing on other renderers when one fails", async () => {
    const fake = fakeRuntime();
    const enable = fake.runtime.enableRendering;
    fake.runtime.enableRendering = (renderer) => {
      if ((renderer as unknown as { id: string }).id === "broken")
        throw new Error("context lost");
      return enable(renderer);
    };
    restoreImporter = setLilToonRuntimeImporterForTesting(
      async () => fake.runtime,
    );
    installLilToonRenderingWhenLoaded({
      id: "broken",
    } as unknown as THREE.WebGLRenderer);
    const release = installLilToonRenderingWhenLoaded({
      id: "working",
    } as unknown as THREE.WebGLRenderer);

    await expect(loadLilToonRuntime()).resolves.toBe(fake.runtime);
    release();
    expect(fake.releases).toEqual(["working"]);
  });
});

/**
 * A one-triangle GLB whose single material carries `extension` (lilToon's
 * authored settings) beside its glTF fallback.
 */
function triangleGlb(extension: Record<string, unknown> | null): ArrayBuffer {
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const json = new TextEncoder().encode(
    JSON.stringify({
      asset: { version: "2.0" },
      ...(extension ? { extensionsUsed: [LILTOON_MATERIALS_EXTENSION] } : {}),
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
      materials: [
        {
          name: "Skin",
          pbrMetallicRoughness: { metallicFactor: 1 },
          ...(extension
            ? { extensions: { [LILTOON_MATERIALS_EXTENSION]: extension } }
            : {}),
        },
      ],
      meshes: [{ primitives: [{ attributes: { POSITION: 0 }, material: 0 }] }],
      nodes: [{ mesh: 0 }],
      scenes: [{ nodes: [0] }],
    }),
  );
  const jsonLength = Math.ceil(json.length / 4) * 4;
  const total = 12 + 8 + jsonLength + 8 + positions.byteLength;
  const glb = new DataView(new ArrayBuffer(total));
  const bytes = new Uint8Array(glb.buffer);
  glb.setUint32(0, 0x46546c67, true);
  glb.setUint32(4, 2, true);
  glb.setUint32(8, total, true);
  glb.setUint32(12, jsonLength, true);
  glb.setUint32(16, 0x4e4f534a, true);
  bytes.fill(0x20, 20, 20 + jsonLength);
  bytes.set(json, 20);
  glb.setUint32(20 + jsonLength, positions.byteLength, true);
  glb.setUint32(24 + jsonLength, 0x004e4942, true);
  bytes.set(new Uint8Array(positions.buffer), 28 + jsonLength);
  return glb.buffer;
}

async function loadMaterial(gltf: ArrayBuffer): Promise<THREE.Material> {
  const loader = new GLTFLoader();
  loader.register((parser) =>
    withEnhancedMToonPatch(withOnDemandLilToon(new VRMLoaderPlugin(parser))),
  );
  const result = await loader.parseAsync(gltf, "");
  let material: THREE.Material | null = null;
  result.scene.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (mesh.isMesh) material = mesh.material as THREE.Material;
  });
  if (!material) throw new Error("No mesh in the test glTF");
  return material;
}

describe("lilToon materials through the real runtime", () => {
  it("replaces a material that carries authored lilToon settings", async () => {
    const material = await loadMaterial(
      triangleGlb({
        specVersion: "1.3",
        shaderVariant: "lilToon",
        properties: { _Color: [0.8, 0.7, 0.9, 1], _UseShadow: 1 },
        textures: {},
      }),
    );
    expect(material).toBeInstanceOf(LilToonMaterial);
    material.dispose();
  });

  it("leaves other materials as glTF materials", async () => {
    const material = await loadMaterial(triangleGlb(null));
    expect(material).toBeInstanceOf(THREE.MeshStandardMaterial);
    material.dispose();
  });
});

/** Add authored lilToon settings to one material of a VRM file's JSON chunk. */
function withLilToonMaterial(bytes: ArrayBuffer, materialIndex: number) {
  const view = new DataView(bytes);
  const jsonLength = view.getUint32(12, true);
  const json = JSON.parse(
    new TextDecoder().decode(new Uint8Array(bytes, 20, jsonLength)),
  ) as {
    extensionsUsed?: string[];
    materials: { extensions?: Record<string, unknown> }[];
  };
  json.extensionsUsed = [
    ...(json.extensionsUsed ?? []),
    LILTOON_MATERIALS_EXTENSION,
  ];
  json.materials[materialIndex]!.extensions = {
    ...json.materials[materialIndex]!.extensions,
    [LILTOON_MATERIALS_EXTENSION]: {
      specVersion: "1.3",
      shaderVariant: "lilToon",
      properties: { _UseShadow: 1 },
      textures: {},
    },
  };
  const encoded = new TextEncoder().encode(JSON.stringify(json));
  const padded = Math.ceil(encoded.length / 4) * 4;
  const rest = new Uint8Array(bytes, 20 + jsonLength);
  const out = new Uint8Array(20 + padded + rest.length);
  const outView = new DataView(out.buffer);
  outView.setUint32(0, 0x46546c67, true);
  outView.setUint32(4, 2, true);
  outView.setUint32(8, out.length, true);
  outView.setUint32(12, padded, true);
  outView.setUint32(16, 0x4e4f534a, true);
  out.fill(0x20, 20, 20 + padded);
  out.set(encoded, 20);
  out.set(rest, 20 + padded);
  return out.buffer;
}

describe("the app's VRM loader chain with lilToon", () => {
  it("loads a VRM whose material carries lilToon settings", async () => {
    const bytes = withLilToonMaterial(
      (await readTestAvatarBytes("Andrew")).slice(0),
      0,
    );
    const loader = new GLTFLoader();
    loader.register((parser) => new PlaceholderTexturePlugin(parser));
    loader.register((parser) =>
      withEnhancedMToonPatch(withOnDemandLilToon(new VRMLoaderPlugin(parser))),
    );
    const gltf = await loader.parseAsync(bytes, "");
    const vrm = (gltf.userData as { vrm?: VRM }).vrm;

    expect(vrm?.humanoid.getRawBoneNode("hips")).toBeTruthy();
    const kinds = new Set<string>();
    vrm!.scene.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      for (const material of [mesh.material].flat()) {
        kinds.add(
          material instanceof LilToonMaterial
            ? "lilToon"
            : (material as { isMToonMaterial?: boolean }).isMToonMaterial
              ? "MToon"
              : material.type,
        );
      }
    });
    // The patched material is lilToon; the rest stay three-vrm’s MToon.
    expect(kinds.has("lilToon")).toBe(true);
    expect(kinds.has("MToon")).toBe(true);
  });
});
