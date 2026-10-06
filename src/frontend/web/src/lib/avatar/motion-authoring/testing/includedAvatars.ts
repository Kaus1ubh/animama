import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { VRM } from "@pixiv/three-vrm";

import {
  INCLUDED_AVATAR_FILES,
  loadHeadlessVrm,
  type IncludedAvatarId,
} from "../headlessVrm";

const avatarDirectory = fileURLToPath(
  new URL("../../../../../../../../content/included/avatars/", import.meta.url),
);

const cache = new Map<IncludedAvatarId, Promise<ArrayBuffer>>();

/** Load a fresh headless copy of an Included Avatar for a test. */
export async function loadTestAvatar(id: IncludedAvatarId): Promise<VRM> {
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
  return loadHeadlessVrm(await bytes);
}
