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

const repositoryRoot = "../../../../../../../../";
const avatarDirectory = fileURLToPath(
  new URL(`${repositoryRoot}content/included/avatars/`, import.meta.url),
);

/**
 * The test-only VRM 0 model. Both Included Avatars are VRM 1.0, so tests of
 * the VRM 0 conversion paths load this VRoid sample from the repository's
 * test fixtures; it is never packaged or listed as an Avatar.
 */
export const VRM0_FIXTURE_ID = "AvatarSample_Y_0";
const vrm0FixturePath = fileURLToPath(
  new URL(
    `${repositoryRoot}tests/fixtures/vrm/AvatarSample_Y_0.vrm`,
    import.meta.url,
  ),
);

/** An Included Avatar or the VRM 0 test fixture. */
export type TestAvatarId = IncludedAvatarId | typeof VRM0_FIXTURE_ID;

const cache = new Map<TestAvatarId, Promise<ArrayBuffer>>();

/** Load a fresh headless copy of an Included Avatar or the VRM 0 fixture. */
export async function loadTestAvatar(id: TestAvatarId): Promise<VRM> {
  return loadHeadlessVrm(await readTestAvatarBytes(id));
}

/**
 * Load an Included Avatar or the VRM 0 fixture with its glTF and the app's
 * mesh cleanup, for checks that read real primitives (face parts, landmarks).
 */
export async function loadTestAvatarWithGltf(
  id: TestAvatarId,
): Promise<{ vrm: VRM; gltf: GLTF }> {
  return loadHeadlessVrmWithGltf(await readTestAvatarBytes(id), {
    removeUnnecessaryVertices: true,
  });
}

/** Load a fresh headless copy of the VRM 0 test fixture. */
export function loadVrm0Fixture(): Promise<VRM> {
  return loadTestAvatar(VRM0_FIXTURE_ID);
}

/** The SHA-256 of an Included Avatar's VRM file, as Animama identifies it. */
export async function readTestAvatarSha256(
  id: IncludedAvatarId,
): Promise<string> {
  return createHash("sha256")
    .update(new Uint8Array(await readTestAvatarBytes(id)))
    .digest("hex");
}

function testAvatarPath(id: TestAvatarId): string {
  return id === VRM0_FIXTURE_ID
    ? vrm0FixturePath
    : avatarDirectory + INCLUDED_AVATAR_FILES[id];
}

function readTestAvatarBytes(id: TestAvatarId): Promise<ArrayBuffer> {
  let bytes = cache.get(id);
  if (!bytes) {
    bytes = readFile(testAvatarPath(id)).then(
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
