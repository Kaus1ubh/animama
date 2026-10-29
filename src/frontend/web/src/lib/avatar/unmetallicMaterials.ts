import type {
  GLTFLoaderPlugin,
  GLTFParser,
} from "three/examples/jsm/loaders/GLTFLoader.js";

/** The MToon extension, which VRM 0 files gain at load (three-vrm). */
const MTOON_EXTENSION = "VRMC_materials_mtoon";

/**
 * Draw the lit glTF materials GLTFLoader builds for an Avatar without
 * metalness: plain PBR materials and the glTF fallbacks of authored lilToon
 * materials.
 *
 * Animama lights Avatars without an environment map, so a metallic surface
 * has nothing to reflect and renders almost black. glTF's `metallicFactor`
 * defaults to 1, so a material that omits it is fully metallic, and Mochiya
 * writes 1 on its lilToon fallbacks. Roughness and every texture stay the
 * file's; the metallic texture no longer has an effect.
 *
 * MToon (including VRM 0 MToon, which three-vrm turns into the MToon
 * extension before materials load) and unlit materials have no metalness, and
 * three-liltoon builds its own materials, so none of them is touched.
 */
export class UnmetallicMaterialsPlugin implements GLTFLoaderPlugin {
  readonly name = "ANIMAMA_unmetallic_materials";
  private readonly parser: GLTFParser;

  constructor(parser: GLTFParser) {
    this.parser = parser;
  }

  extendMaterialParams(
    materialIndex: number,
    materialParams: { metalness?: number },
  ): Promise<void> {
    const material = (
      this.parser.json as {
        materials?: { extensions?: Record<string, unknown> }[];
      }
    ).materials?.[materialIndex];
    if (
      !material?.extensions?.[MTOON_EXTENSION] &&
      materialParams.metalness !== undefined &&
      materialParams.metalness > 0
    ) {
      materialParams.metalness = 0;
    }
    return Promise.resolve();
  }
}
