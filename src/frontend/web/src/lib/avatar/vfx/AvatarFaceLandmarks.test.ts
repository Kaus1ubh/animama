import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";

import type { Avatar } from "../Avatar";
import { appendTriangle } from "../testing/appendTriangle";
import { loadedTestAvatar } from "../testing/loadedTestAvatar";
import { buildRuntimePrimitiveBindings } from "../vrmEditorInspection";

const loadedAnnie = () => loadedTestAvatar("AvatarSample_A_1_New");

/**
 * Annie with a triangle added to the left eye's iris primitive, centred on
 * `center` (given the eye's centre) with `halfSize` in x and y.
 */
async function withIrisTriangle(args: {
  center: (eye: THREE.Vector3) => THREE.Vector3;
  halfSize: (eyeSize: THREE.Vector3) => THREE.Vector2;
  uv: readonly [[number, number], [number, number], [number, number]];
}): Promise<Avatar> {
  const avatar = await loadedAnnie();
  const eye = avatar.getFaceLandmarksSnapshot()!.eyes.left!;
  const binding = buildRuntimePrimitiveBindings(avatar).entries.find(
    (entry) => entry.bindingKey === eye.bindingKey,
  )!;
  const { x, y, z } = args.center(new THREE.Vector3().copy(eye.centerLocal));
  const half = args.halfSize(new THREE.Vector3().copy(eye.boundsLocal.size));
  appendTriangle({
    avatar,
    binding,
    anchor: avatar.vrm!.humanoid.getNormalizedBoneNode("head")!,
    corners: [
      new THREE.Vector3(x - half.x, y - half.y, z),
      new THREE.Vector3(x + half.x, y - half.y, z),
      new THREE.Vector3(x, y + half.y, z),
    ],
    uv: args.uv,
  });
  await avatar.setFacePartCorrections(null);
  return avatar;
}

/** A texture region on the iris texture's right half, larger than the iris. */
const LARGE_UV: [[number, number], [number, number], [number, number]] = [
  [0.55, 0.95],
  [0.95, 0.95],
  [0.75, 0.05],
];

describe("AvatarFaceLandmarks eyes", () => {
  it("skips an island wider than the distance between the eyes", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const expected = (await loadedAnnie()).getFaceLandmarksSnapshot()!.eyes;

    // A dome around the left eyeball, centred on its bone as some VRChat eye
    // meshes have: nearer to the bone than the iris, but wider than two eyes.
    const plain = await loadedAnnie();
    const bone = plain.vrm!.humanoid.getNormalizedBoneNode("leftEye")!;
    const head = plain.vrm!.humanoid.getNormalizedBoneNode("head")!;
    const bonePoint = head.worldToLocal(
      bone.getWorldPosition(new THREE.Vector3()),
    );
    const domed = await withIrisTriangle({
      center: () => bonePoint,
      halfSize: () => new THREE.Vector2(0.06, 0.06),
      uv: [
        [0.7, 0.9],
        [0.72, 0.9],
        [0.71, 0.92],
      ],
    });

    expect(domed.getFaceLandmarksSnapshot()!.eyes).toEqual(expected);
  });

  it("takes the iris texture from the eye layer with the most texture", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const expected = (await loadedAnnie()).getFaceLandmarksSnapshot()!.eyes;

    // A layer over the whole left iris, just in front of it, mapped to a
    // larger texture area than the iris island: the eye's painted art.
    const layered = await withIrisTriangle({
      center: (eye) => eye.setZ(eye.z + 0.002),
      halfSize: (size) => new THREE.Vector2(size.x * 0.4, size.y * 0.4),
      uv: LARGE_UV,
    });
    const eyes = layered.getFaceLandmarksSnapshot()!.eyes;

    expect(eyes.left!.centerLocal).toEqual(expected.left!.centerLocal);
    expect(eyes.left!.textureRect).toEqual({
      x: expect.closeTo(0.55, 6),
      y: expect.closeTo(0.05, 6),
      width: expect.closeTo(0.4, 6),
      height: expect.closeTo(0.9, 6),
    });
    expect(eyes.right).toEqual(expected.right);
  });

  it("does not take a small stretched patch for the iris art", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const expected = (await loadedAnnie()).getFaceLandmarksSnapshot()!.eyes;

    // A gloss-like patch a fraction of the iris's size, mapped to the same
    // large texture area: not a layer of the whole eye.
    const glossed = await withIrisTriangle({
      center: (eye) => eye.setZ(eye.z + 0.002),
      halfSize: () => new THREE.Vector2(0.002, 0.002),
      uv: LARGE_UV,
    });

    expect(glossed.getFaceLandmarksSnapshot()!.eyes).toEqual(expected);
  });
});
