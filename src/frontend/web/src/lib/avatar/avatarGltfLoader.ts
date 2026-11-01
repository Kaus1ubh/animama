import { VRMLoaderPlugin } from "@pixiv/three-vrm";
import { VRMAnimationLoaderPlugin } from "@pixiv/three-vrm-animation";
import type * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

import { configureAvatarGltfLoader } from "./configureAvatarGltfLoader";
import { withEnhancedMToonPatch } from "./enhanced-rendering/mtoonPatch";
import { withOnDemandLilToon } from "./liltoon/lilToon";
import { UnmetallicMaterialsPlugin } from "./unmetallicMaterials";

/**
 * The glTF loader for Avatar VRM and VRMA files, with the shared decoders and
 * extension check (`configureAvatarGltfLoader`). With `lilToon` false, a
 * file's authored lilToon materials load as their glTF fallbacks (the Simple
 * material setting) and three-liltoon is never imported.
 */
export function createAvatarGltfLoader({
  manager,
  lilToon = true,
}: {
  manager?: THREE.LoadingManager;
  lilToon?: boolean;
} = {}): GLTFLoader {
  const loader = configureAvatarGltfLoader(new GLTFLoader(manager));
  loader.register((parser) => {
    const plugin = new VRMLoaderPlugin(parser);
    // lilToon is imported only for files that declare authored lilToon materials.
    return withEnhancedMToonPatch(
      lilToon ? withOnDemandLilToon(plugin) : plugin,
    );
  });
  loader.register((parser) => new VRMAnimationLoaderPlugin(parser));
  loader.register((parser) => new UnmetallicMaterialsPlugin(parser));
  return loader;
}
