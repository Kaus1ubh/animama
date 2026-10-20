import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { VRM } from "@pixiv/three-vrm";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";

import {
  INCLUDED_AVATAR_FILES,
  loadHeadlessVrm,
  loadHeadlessVrmWithGltf,
  type IncludedAvatarId,
} from "../headlessVrm";

const avatarDirectory = fileURLToPath(
  new URL("../../../../../../../../content/included/avatars/", import.meta.url),
);

const cache = new Map<IncludedAvatarId, Promise<ArrayBuffer>>();

/** Load a fresh headless copy of an Included Avatar for a test. */
export async function loadTestAvatar(id: IncludedAvatarId): Promise<VRM> {
  return loadHeadlessVrm(await readTestAvatarBytes(id));
}

/**
 * Load an Included Avatar with its glTF and the app's mesh cleanup, for checks
 * that read real primitives (face parts, landmarks).
 */
export async function loadTestAvatarWithGltf(
  id: IncludedAvatarId,
): Promise<{ vrm: VRM; gltf: GLTF }> {
  return loadHeadlessVrmWithGltf(await readTestAvatarBytes(id), {
    removeUnnecessaryVertices: true,
  });
}

/** The SHA-256 of an Included Avatar's VRM file, as Animama identifies it. */
export async function readTestAvatarSha256(
  id: IncludedAvatarId,
): Promise<string> {
  return createHash("sha256")
    .update(new Uint8Array(await readTestAvatarBytes(id)))
    .digest("hex");
}

function readTestAvatarBytes(id: IncludedAvatarId): Promise<ArrayBuffer> {
  let bytes = cache.get(id);
  if (!bytes) {
    bytes = readFile(avatarDirectory + INCLUDED_AVATAR_FILES[id]).then(
      (file) =>
        file.buffer.slice(
          file.byteOffset,
          file.byteOffset + file.byteLength,
        ) as ArrayBuffer,
    );
    cache.set(id, bytes);
  }
  return bytes;
}
