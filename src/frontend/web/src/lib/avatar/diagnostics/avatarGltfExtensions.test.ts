import { describe, expect, it } from "vitest";

import fixture from "@/lib/content/fixtures/package-capabilities.json";

import {
  LOADABLE_GLTF_EXTENSIONS,
  UNDECODED_GLTF_EXTENSIONS,
  unloadableGltfExtensions,
} from "./avatarGltfExtensions";

describe("unloadableGltfExtensions", () => {
  it("accepts required extensions the loaders can load", () => {
    expect(
      unloadableGltfExtensions({
        extensionsUsed: ["VRMC_vrm", "EXT_meshopt_compression"],
        extensionsRequired: [
          "EXT_meshopt_compression",
          "EXT_texture_webp",
          "KHR_mesh_quantization",
          "MOCHIYA_materials_liltoon",
        ],
      }),
    ).toEqual([]);
  });

  it("names each required extension the runtime cannot load, once", () => {
    expect(
      unloadableGltfExtensions({
        extensionsUsed: ["KHR_texture_basisu", "EXT_unknown_test"],
        extensionsRequired: [
          "KHR_texture_basisu",
          "EXT_unknown_test",
          "KHR_texture_basisu",
        ],
      }),
    ).toEqual(["KHR_texture_basisu", "EXT_unknown_test"]);
  });

  it("names Draco when it is only used, since three cannot skip it", () => {
    expect(
      unloadableGltfExtensions({
        extensionsUsed: ["KHR_draco_mesh_compression"],
      }),
    ).toEqual(["KHR_draco_mesh_compression"]);
    expect(
      unloadableGltfExtensions({
        extensionsUsed: ["KHR_draco_mesh_compression"],
        extensionsRequired: ["KHR_draco_mesh_compression"],
      }),
    ).toEqual(["KHR_draco_mesh_compression"]);
  });

  it("ignores an unknown extension a file only uses, and malformed lists", () => {
    expect(
      unloadableGltfExtensions({ extensionsUsed: ["EXT_unknown_test"] }),
    ).toEqual([]);
    expect(
      unloadableGltfExtensions({
        extensionsUsed: "KHR_draco_mesh_compression",
        extensionsRequired: [1, null],
      }),
    ).toEqual([]);
  });
});

describe("the glTF extension lists", () => {
  it("are package validation's: loadable plus undecoded (shared fixture)", () => {
    expect(
      [...LOADABLE_GLTF_EXTENSIONS, ...UNDECODED_GLTF_EXTENSIONS].sort(),
    ).toEqual(fixture.gltfExtensions.accepted);
    expect([...UNDECODED_GLTF_EXTENSIONS].sort()).toEqual(
      fixture.gltfExtensions.undecoded,
    );
  });
});
