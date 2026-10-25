import { PerspectiveCamera } from "three";

import { Avatar } from "../Avatar";
import {
  loadTestAvatarWithGltf,
  type TestAvatarId,
} from "../motion-authoring/testing/includedAvatars";

/**
 * An Avatar holding a real Included VRM (or the VRM 0 fixture), as
 * `Avatar.load` leaves it: face parts, landmarks and texture anchors built,
 * identified by `vrmSha256` for face part corrections.
 */
export async function loadedTestAvatar(
  id: TestAvatarId,
  vrmSha256 = "c".repeat(64),
): Promise<Avatar> {
  const { vrm, gltf } = await loadTestAvatarWithGltf(id);
  const avatar = new Avatar(new PerspectiveCamera());
  avatar.vrm = vrm;
  avatar.sourceGltf = gltf;
  (avatar as unknown as { _vrmSha256: string })._vrmSha256 = vrmSha256;
  await avatar.setFacePartCorrections(null);
  return avatar;
}
