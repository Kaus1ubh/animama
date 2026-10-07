import * as THREE from "three";
import { describe, expect, it } from "vitest";

import type { Avatar } from "./Avatar";
import { resolveHumanoidAnchorObject } from "./humanoidAnchors";
import { resolveParticleVFXAnchorLocalPosition } from "./particle-vfx/runtime";

/** An avatar whose humanoid has only the named normalized bones. */
function avatarWith(bones: Record<string, THREE.Object3D>) {
  const scene = new THREE.Group();
  scene.position.set(1, 0, -2);
  for (const bone of Object.values(bones)) scene.add(bone);
  return {
    scene,
    vrm: {
      humanoid: {
        getNormalizedBoneNode: (name: string) => bones[name] ?? null,
      },
    },
  } as unknown as Avatar;
}

const at = (x: number, y: number, z: number) => {
  const object = new THREE.Object3D();
  object.position.set(x, y, z);
  return object;
};

describe("resolveHumanoidAnchorObject", () => {
  it("returns the requested bone when the humanoid has it", () => {
    const chest = at(0, 1.2, 0);
    const resolved = resolveHumanoidAnchorObject(
      avatarWith({ chest }),
      "chest",
    );
    expect(resolved).toMatchObject({
      requestedAnchor: "chest",
      resolvedAnchor: "chest",
      boneName: "chest",
      fellBack: false,
    });
    expect(resolved?.object).toBe(chest);
  });

  it("walks the fallback chain for optional bones", () => {
    const spine = at(0, 1, 0);
    const resolved = resolveHumanoidAnchorObject(
      avatarWith({ spine, hips: at(0, 0.9, 0) }),
      "chest",
    );
    expect(resolved).toMatchObject({ boneName: "spine", fellBack: true });
    expect(resolved?.object).toBe(spine);
  });

  it("uses the avatar scene for the root and when no candidate exists", () => {
    const avatar = avatarWith({});
    expect(resolveHumanoidAnchorObject(avatar, "root")).toMatchObject({
      resolvedAnchor: "root",
      boneName: null,
      object: avatar.scene,
      fellBack: false,
    });
    expect(resolveHumanoidAnchorObject(avatar, "leftHand")).toMatchObject({
      requestedAnchor: "leftHand",
      resolvedAnchor: "root",
      object: avatar.scene,
      fellBack: true,
    });
  });

  it("returns null before an avatar is loaded", () => {
    expect(
      resolveHumanoidAnchorObject({ scene: null, vrm: null }, "head"),
    ).toBeNull();
  });
});

describe("particle anchors on the shared resolver", () => {
  const transform = {
    offset: { x: 0.1, y: 0, z: 0 },
    depthOffset: 0.2,
    rotation: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
  };

  it("positions at the bone in scene space plus the offset", () => {
    const avatar = avatarWith({ head: at(0, 1.4, 0.05) });
    expect(
      resolveParticleVFXAnchorLocalPosition({
        avatar,
        anchor: "head",
        transform,
      }),
    ).toEqual({
      requestedAnchor: "head",
      resolvedAnchor: "head",
      boneName: "head",
      position: { x: 0.1, y: 1.4, z: expect.closeTo(0.25) },
      warning: null,
    });
  });

  it("keeps its fallback and root warnings", () => {
    const avatar = avatarWith({ neck: at(0, 1.3, 0) });
    expect(
      resolveParticleVFXAnchorLocalPosition({ avatar, anchor: "head" }),
    ).toMatchObject({
      resolvedAnchor: "head",
      boneName: "neck",
      position: { x: 0, y: 1.3, z: 0 },
      warning: 'Particle VFX anchor "head" fell back to VRM bone "neck".',
    });
    expect(
      resolveParticleVFXAnchorLocalPosition({
        avatar: avatarWith({}),
        anchor: "rightFoot",
        transform,
      }),
    ).toEqual({
      requestedAnchor: "rightFoot",
      resolvedAnchor: "root",
      boneName: null,
      position: { x: 0.1, y: 0, z: expect.closeTo(0.2) },
      warning:
        'Particle VFX anchor "rightFoot" could not resolve a VRM bone and fell back to root.',
    });
    expect(
      resolveParticleVFXAnchorLocalPosition({
        avatar: avatarWith({}),
        anchor: "root",
      }),
    ).toMatchObject({ resolvedAnchor: "root", warning: null });
  });
});
