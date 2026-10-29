import type * as THREE from "three";
import type {
  GLTF,
  GLTFLoaderPlugin,
  GLTFParser,
} from "three/examples/jsm/loaders/GLTFLoader.js";

import {
  LILTOON_MATERIALS_EXTENSION,
  usesLilToonMaterials,
} from "./liltoon/lilToon";

/** The MToon extension, which VRM 0 files gain at load (three-vrm). */
const MTOON_EXTENSION = "VRMC_materials_mtoon";

/** The glTF JSON's material list, as far as these hooks read it. */
type GltfMaterialsJson = {
  materials?: { extensions?: Record<string, unknown> }[];
};

/**
 * Draw the lit glTF materials GLTFLoader builds for an Avatar without
 * metalness: plain PBR materials and the glTF fallbacks of authored lilToon
 * materials. The lilToon fallbacks also ignore their meshes' vertex colours.
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
    const material = (this.parser.json as GltfMaterialsJson).materials?.[
      materialIndex
    ];
    if (
      !material?.extensions?.[MTOON_EXTENSION] &&
      materialParams.metalness !== undefined &&
      materialParams.metalness > 0
    ) {
      materialParams.metalness = 0;
    }
    return Promise.resolve();
  }

  /**
   * Vertex colours on a lilToon material's meshes are outline data (baked
   * normals and widths), not the glTF colour multiply GLTFLoader applies, so
   * fallbacks built from such materials ignore them. Other materials keep
   * glTF's colour multiply.
   */
  afterRoot(result: GLTF): Promise<void> {
    if (!usesLilToonMaterials(this.parser.json)) return Promise.resolve();
    const materials = (this.parser.json as GltfMaterialsJson).materials;
    result.scene.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      for (const entry of Array.isArray(mesh.material)
        ? mesh.material
        : [mesh.material]) {
        if ((entry as { isLilToonMaterial?: boolean }).isLilToonMaterial)
          continue;
        const index = this.parser.associations.get(entry)?.materials;
        if (
          index !== undefined &&
          materials?.[index]?.extensions?.[LILTOON_MATERIALS_EXTENSION] &&
          entry.vertexColors
        ) {
          entry.vertexColors = false;
          entry.needsUpdate = true;
        }
      }
    });
    return Promise.resolve();
  }
}
