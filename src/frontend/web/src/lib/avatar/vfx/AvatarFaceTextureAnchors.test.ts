import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";

import type { Avatar } from "../Avatar";
import { appendTriangle } from "../testing/appendTriangle";
import { loadedTestAvatar } from "../testing/loadedTestAvatar";
import { buildRuntimePrimitiveBindings } from "../vrmEditorInspection";

const loadedAnnie = () => loadedTestAvatar("AvatarSample_A_1_New");

/** Add a small triangle centred on `center` to Annie's face skin primitive. */
function addFaceTriangle(avatar: Avatar, center: THREE.Vector3): void {
  const faceKey = avatar.getFaceLandmarksSnapshot()!.faceBindingKey!;
  const binding = buildRuntimePrimitiveBindings(avatar).entries.find(
    (entry) => entry.bindingKey === faceKey,
  )!;
  const { x, y, z } = center;
  appendTriangle({
    avatar,
    binding,
    anchor: avatar.vrm!.humanoid.getNormalizedBoneNode("head")!,
    corners: [
      new THREE.Vector3(x - 0.002, y - 0.002, z),
      new THREE.Vector3(x + 0.002, y - 0.002, z),
      new THREE.Vector3(x, y + 0.002, z),
    ],
    // A far corner of the texture, away from the face.
    uv: [
      [0.97, 0.97],
      [0.99, 0.97],
      [0.98, 0.99],
    ],
  });
}

describe("AvatarFaceTextureAnchors", () => {
  it("keeps anchors on the face skin's own UV island", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const expected = (await loadedAnnie()).getFaceTextureAnchorsSnapshot();

    // A stray island at each eye's centre, as a VRChat face mesh carries its
    // eye sockets: the nearest surface to the seeds of the eye regions.
    const avatar = await loadedAnnie();
    const { left, right } = avatar.getFaceLandmarksSnapshot()!.eyes;
    for (const eye of [left!, right!]) {
      const { x, y, z } = eye.centerLocal;
      addFaceTriangle(avatar, new THREE.Vector3(x, y, z));
    }
    await avatar.setFacePartCorrections(null);

    expect(avatar.getFaceTextureAnchorsSnapshot()).toEqual(expected);
  });

  it("does not take a small island at the seed for the face", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const expected = (await loadedAnnie()).getFaceTextureAnchorsSnapshot();

    // A separately unwrapped patch at the point between the eyes, just behind
    // the face front (so the face bounds stay): nearest to the seed, but it
    // spans neither eye.
    const avatar = await loadedAnnie();
    const { left, right } = avatar.getFaceLandmarksSnapshot()!.eyes;
    const seed = new THREE.Vector3()
      .addVectors(
        new THREE.Vector3().copy(left!.projectedFrontLocal),
        new THREE.Vector3().copy(right!.projectedFrontLocal),
      )
      .multiplyScalar(0.5);
    addFaceTriangle(avatar, seed.setZ(seed.z - 0.0005));
    await avatar.setFacePartCorrections(null);

    expect(avatar.getFaceTextureAnchorsSnapshot()).toEqual(expected);
  });
});
