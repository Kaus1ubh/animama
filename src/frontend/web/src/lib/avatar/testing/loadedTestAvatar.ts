import type { VRM } from "@pixiv/three-vrm";
import { PerspectiveCamera } from "three";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";

import { Avatar } from "../Avatar";
import { prepareLoadedVrm } from "../prepareLoadedVrm";
import {
  loadTestAvatarWithGltf,
  type TestAvatarId,
} from "../motion-authoring/testing/includedAvatars";

/**
 * An Avatar holding a real Included VRM (or the VRM 0 fixture), as
 * `Avatar.load` leaves it: the shared load-time installs run, face parts,
 * landmarks and texture anchors built, identified by `vrmSha256` for face part
 * corrections.
 */
export async function loadedTestAvatar(
  id: TestAvatarId,
  vrmSha256 = "c".repeat(64),
): Promise<Avatar> {
  const { vrm, gltf } = await loadTestAvatarWithGltf(id);
  return prepareTestAvatar(vrm, gltf, vrmSha256);
}

/**
 * Run `Avatar.load`'s load-time corrections on an already-loaded model: the
 * shared installs, face-part detection, landmarks and texture anchors.
 */
export async function prepareTestAvatar(
  vrm: VRM,
  gltf: GLTF,
  vrmSha256: string,
): Promise<Avatar> {
  const avatar = new Avatar(new PerspectiveCamera());
  avatar.vrm = vrm;
  avatar.sourceGltf = gltf;
  (avatar as unknown as { _vrmSha256: string })._vrmSha256 = vrmSha256;
  const { arkitFace, restPose } = prepareLoadedVrm(vrm, { vrmSha256 });
  (avatar as unknown as { _arkitFace: typeof arkitFace })._arkitFace =
    arkitFace;
  (avatar as unknown as { _restPose: typeof restPose })._restPose = restPose;
  await avatar.setFacePartCorrections(null);
  return avatar;
}
