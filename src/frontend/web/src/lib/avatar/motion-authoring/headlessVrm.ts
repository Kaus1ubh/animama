import { VRMLoaderPlugin, VRMUtils, type VRM } from "@pixiv/three-vrm";
import { Texture } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type {
  GLTF,
  GLTFLoaderPlugin,
} from "three/examples/jsm/loaders/GLTFLoader.js";

import { canonicalizeCustomPresetExpressions } from "../vrmExpressionPresets";

/** Included Avatars used for motion authoring checks: Andrew and Annie. */
export const INCLUDED_AVATAR_FILES = {
  Andrew: "Andrew.vrm",
  AvatarSample_A_1_New: "AvatarSample_A_1_New.vrm",
} as const;

export type IncludedAvatarId = keyof typeof INCLUDED_AVATAR_FILES;

/**
 * Textures are irrelevant to kinematics and cannot decode outside a browser,
 * so every texture resolves to an empty placeholder.
 */
class PlaceholderTexturePlugin implements GLTFLoaderPlugin {
  readonly name = "ANIMAMA_placeholder_textures";
  loadTexture(): Promise<Texture> {
    return Promise.resolve(new Texture());
  }
}

/**
 * Load a VRM without a browser, matching the app's post-load orientation and
 * expression canonicalization. Meshes and skeletons are real; textures are not.
 */
export async function loadHeadlessVrm(bytes: ArrayBuffer): Promise<VRM> {
  return (await loadHeadlessVrmWithGltf(bytes)).vrm;
}

/**
 * Load a VRM headlessly and keep its glTF, whose parser associations give live
 * primitives their glTF indices. `removeUnnecessaryVertices` matches the app's
 * `Avatar.load` geometry for checks that read mesh primitives.
 */
export async function loadHeadlessVrmWithGltf(
  bytes: ArrayBuffer,
  options: { removeUnnecessaryVertices?: boolean } = {},
): Promise<{ vrm: VRM; gltf: GLTF }> {
  const loader = new GLTFLoader();
  loader.register(() => new PlaceholderTexturePlugin());
  loader.register((parser) => new VRMLoaderPlugin(parser));
  const gltf = await loader.parseAsync(bytes, "");
  if (options.removeUnnecessaryVertices) {
    VRMUtils.removeUnnecessaryVertices(gltf.scene);
  }
  const vrm = (gltf.userData as { vrm?: VRM }).vrm;
  if (!vrm) throw new Error("The file is not a VRM: no VRM extension found.");
  VRMUtils.rotateVRM0(vrm);
  canonicalizeCustomPresetExpressions(vrm);
  vrm.scene.updateMatrixWorld(true);
  return { vrm, gltf };
}
