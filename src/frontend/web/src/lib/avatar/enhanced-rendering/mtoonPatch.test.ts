import { afterEach, describe, expect, it } from "vitest";
import { VRMLoaderPlugin } from "@pixiv/three-vrm";
import type { GLTFParser } from "three/examples/jsm/loaders/GLTFLoader.js";

import { useEnhancedRenderingStore } from "./enhancedRendering";
import { withEnhancedMToonPatch } from "./mtoonPatch";

type Json = {
  materials: { name: string; extensions?: Record<string, unknown> }[];
  extensions?: Record<string, unknown>;
  extensionsUsed?: string[];
};
type Mtoon = Record<string, unknown>;

const NAMES = [
  "N00_000_00_Face_00_SKIN (Instance)",
  "N00_000_00_Tops_01_CLOTH (Instance)",
  "N00_000_00_EyeIris_00_EYE (Instance)",
];

/** A VRM 1.0 glTF: materials already carry `VRMC_materials_mtoon`. */
function vrm1Json(): Json {
  return {
    materials: NAMES.map((name) => ({
      name,
      extensions: {
        VRMC_materials_mtoon: {
          shadeColorFactor: [1, 1, 1],
          shadingShiftFactor: 1,
          outlineWidthMode: "worldCoordinates",
        },
      },
    })),
  };
}

/** A VRM 0.x glTF: MToon lives in `extensions.VRM.materialProperties`. */
function vrm0Json(): Json {
  return {
    materials: NAMES.map((name) => ({ name })),
    extensions: {
      VRM: {
        materialProperties: NAMES.map((name) => ({
          name,
          shader: "VRM/MToon",
          floatProperties: { _OutlineWidthMode: 1, _OutlineWidth: 0.1 },
          vectorProperties: {},
          textureProperties: {},
          keywordMap: {},
          tagMap: {},
        })),
      },
    },
  };
}

/** Run three-vrm's material pre-pass with the patch, as a load would. */
async function patch(enhanced: boolean, json: Json): Promise<Mtoon[]> {
  useEnhancedRenderingStore.setState({ enabled: enhanced });
  const plugin = withEnhancedMToonPatch(
    new VRMLoaderPlugin({ json } as unknown as GLTFParser),
  );
  await plugin.materialsV0CompatPlugin.beforeRoot();
  return json.materials.map(
    (material) => material.extensions?.VRMC_materials_mtoon as Mtoon,
  );
}

describe("withEnhancedMToonPatch", () => {
  afterEach(() => useEnhancedRenderingStore.setState({ enabled: true }));

  it("leaves MToon parameters untouched with classic rendering", async () => {
    const json = vrm1Json();
    await patch(false, json);
    expect(json.materials).toEqual(vrm1Json().materials);
  });

  it("retunes VRoid skin and cloth and leaves eyes flat", async () => {
    const [face, cloth, iris] = await patch(true, vrm1Json());
    expect(face).toMatchObject({
      shadingShiftFactor: 0.6,
      outlineWidthMode: "screenCoordinates",
    });
    expect(face!.shadeColorFactor).not.toEqual([1, 1, 1]);
    expect(cloth).toMatchObject({
      shadingShiftFactor: -0.1,
      outlineWidthMode: "screenCoordinates",
    });
    expect(iris).toEqual(
      vrm1Json().materials[2]!.extensions!.VRMC_materials_mtoon,
    );
  });

  it("patches VRM 0.x materials after three-vrm converts them", async () => {
    const [face] = await patch(true, vrm0Json());
    expect(face).toMatchObject({
      shadingShiftFactor: 0.6,
      outlineWidthMode: "screenCoordinates",
    });
    const [classic] = await patch(false, vrm0Json());
    expect(classic!.outlineWidthMode).toBe("worldCoordinates");
  });
});
