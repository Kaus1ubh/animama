import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";

import type { Avatar } from "../Avatar";
import { appendTriangle } from "../testing/appendTriangle";
import { loadedTestAvatar } from "../testing/loadedTestAvatar";
import { buildRuntimePrimitiveBindings } from "../vrmEditorInspection";
import { baseTextureOf } from "./textureUvMapping";

const loadedAnnie = () => loadedTestAvatar("Annie");

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

  describe("on a transformed face texture", () => {
    /** The face skin's mesh, whose base texture the anchors follow. */
    const faceMesh = (avatar: Avatar) => {
      const faceKey = avatar.getFaceLandmarksSnapshot()!.faceBindingKey!;
      return buildRuntimePrimitiveBindings(avatar).entries.find(
        (entry) => entry.bindingKey === faceKey,
      )!.object;
    };
    /** Every anchor and cleanup region, in a fixed order. */
    const regions = (avatar: Avatar) => {
      const { anchors, flatten } = avatar.getFaceTextureAnchorsSnapshot()!;
      return [
        anchors.undereye.left,
        anchors.undereye.right,
        anchors.blush.left,
        anchors.blush.right,
        anchors.mouth.center,
        flatten.sample.center,
        flatten.eyes.left,
        flatten.eyes.right,
        flatten.mouth.center,
      ].map((region) => region!);
    };

    it("places anchors where the texture's offset and repeat draw them", async () => {
      vi.spyOn(console, "info").mockImplementation(() => {});
      const expected = regions(await loadedAnnie());

      // The face's art packed into a quarter of an atlas by its transform.
      const avatar = await loadedAnnie();
      const texture = baseTextureOf(faceMesh(avatar))!;
      texture.offset.set(0.5, 0.25);
      texture.repeat.set(0.5, 0.5);
      await avatar.setFacePartCorrections(null);

      regions(avatar).forEach((region, index) => {
        const before = expected[index]!;
        expect(region.uv.u).toBeCloseTo(0.5 + before.uv.u * 0.5, 6);
        expect(region.uv.v).toBeCloseTo(0.25 + before.uv.v * 0.5, 6);
        expect(region.referenceSizeUv.width).toBeCloseTo(
          Math.max(0.01, before.referenceSizeUv.width * 0.5),
          6,
        );
        expect(region.referenceSizeUv.height).toBeCloseTo(
          Math.max(0.01, before.referenceSizeUv.height * 0.5),
          6,
        );
      });
    });

    it("wraps face UVs laid out past 0–1 on a repeating texture", async () => {
      vi.spyOn(console, "info").mockImplementation(() => {});
      const expected = regions(await loadedAnnie());

      // The same layout one tile to the right.
      const avatar = await loadedAnnie();
      const mesh = faceMesh(avatar);
      const uv = mesh.geometry.getAttribute("uv");
      for (let i = 0; i < uv.count; i += 1) uv.setX(i, uv.getX(i) + 1);
      baseTextureOf(mesh)!.wrapS = THREE.RepeatWrapping;
      await avatar.setFacePartCorrections(null);

      regions(avatar).forEach((region, index) => {
        expect(region.uv.u).toBeCloseTo(expected[index]!.uv.u, 5);
        expect(region.uv.v).toBe(expected[index]!.uv.v);
        expect(region.referenceSizeUv.width).toBeCloseTo(
          expected[index]!.referenceSizeUv.width,
          5,
        );
      });
    });
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
