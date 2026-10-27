import type { VRM } from "@pixiv/three-vrm";
import * as THREE from "three";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Avatar } from "./Avatar";
import { resolveAmbientForces } from "./avatarSettings";
import {
  loadTestAvatarWithGltf,
  type TestAvatarId,
} from "./motion-authoring/testing/includedAvatars";
import {
  SpringBonePhysicsController,
  springsTunedWithoutAmbientForces,
} from "./spring-bone/SpringBonePhysicsController";

type SpringPhysicsAvatar = {
  _installSpringPhysics(vrm: VRM, gltf: GLTF): void;
};

/** A loaded model, as a Mochiya conversion when `mochiya` is set. */
async function loadModel(id: TestAvatarId, mochiya = false) {
  const { vrm, gltf } = await loadTestAvatarWithGltf(id);
  if (mochiya) {
    const json = gltf.parser.json as { extensionsUsed?: string[] };
    json.extensionsUsed = [
      ...(json.extensionsUsed ?? []),
      "MOCHIYA_avatar_composition",
    ];
  }
  vrm.scene.updateMatrixWorld(true);
  return { vrm, gltf };
}

/** An Avatar holding the model with spring physics, as `Avatar.load` installs it. */
async function springAvatar(id: TestAvatarId, mochiya = false) {
  const { vrm, gltf } = await loadModel(id, mochiya);
  const avatar = new Avatar(new THREE.PerspectiveCamera());
  avatar.vrm = vrm;
  avatar.sourceGltf = gltf;
  (avatar as unknown as SpringPhysicsAvatar)._installSpringPhysics(vrm, gltf);
  const joints = [...vrm.springBoneManager!.joints];
  const rest = joints.map((joint) => joint.bone.quaternion.clone());
  return {
    avatar,
    vrm,
    joints,
    /**
     * How far any spring joint has turned from rest: the largest quaternion
     * component difference (`angleTo` turns float noise into ~1e-3 rad).
     */
    deviation: () =>
      Math.max(
        ...joints.flatMap((joint, index) => {
          const now = joint.bone.quaternion.toArray();
          const atRest = rest[index]!.toArray();
          return now.map((value, axis) => Math.abs(value - atRest[axis]!));
        }),
      ),
  };
}

/** Swing and carry the model so its springs lag behind. */
function sway(vrm: VRM, frames: number, update: () => void) {
  for (let frame = 0; frame < frames; frame += 1) {
    vrm.scene.position.x += 0.02;
    vrm.scene.rotation.y += 0.05;
    update();
  }
}

afterEach(() => vi.restoreAllMocks());

describe("resolveAmbientForces", () => {
  it("keeps the file's Automatic choice and forces the rest", () => {
    expect(resolveAmbientForces("automatic", true)).toBe(true);
    expect(resolveAmbientForces("automatic", false)).toBe(false);
    expect(resolveAmbientForces("on", false)).toBe(true);
    expect(resolveAmbientForces("off", true)).toBe(false);
    expect(resolveAmbientForces("springs_off", true)).toBe(false);
  });
});

describe("Avatar wind setting", () => {
  it.each([
    ["Andrew", false, true],
    ["Andrew", true, false],
    ["AvatarSample_A_1_New", false, true],
  ] as const)(
    "Automatic keeps today's ambient forces (%s, Mochiya %s)",
    async (id, mochiya, ambientForces) => {
      // Gusts draw random numbers; both runs must draw the same ones.
      vi.spyOn(Math, "random").mockReturnValue(0.5);
      const subject = await springAvatar(id, mochiya);
      const today = await loadModel(id, mochiya);
      const controller = new SpringBonePhysicsController(today.vrm, {
        sourceGltf: today.gltf,
        ambientForces: !springsTunedWithoutAmbientForces(
          today.gltf.parser.json,
        ),
      });

      expect(
        subject.avatar.springBonePhysicsController!.getSnapshot().ambientForces,
      ).toBe(ambientForces);
      sway(subject.vrm, 20, () => subject.avatar.updateModel(1 / 60));
      sway(today.vrm, 20, () => {
        controller.update(1 / 60);
        today.vrm.update(1 / 60);
      });
      const todayJoints = [...today.vrm.springBoneManager!.joints];
      subject.joints.forEach((joint, index) => {
        expect(joint.bone.quaternion.toArray()).toEqual(
          todayJoints[index]!.bone.quaternion.toArray(),
        );
      });
      controller.dispose();
    },
  );

  it("switches wind and updraft live", async () => {
    const { avatar } = await springAvatar("Andrew");
    const ambient = () =>
      avatar.springBonePhysicsController!.getSnapshot().ambientForces;
    expect(avatar.springMode).toBe("automatic");
    expect(ambient()).toBe(true);
    avatar.setSpringMode("off");
    expect(ambient()).toBe(false);
    avatar.setSpringMode("on");
    expect(ambient()).toBe(true);
    avatar.setSpringMode("springs_off");
    expect(ambient()).toBe(false);

    const converted = (await springAvatar("Andrew", true)).avatar;
    expect(converted.ambientForces).toBe(false);
    converted.setSpringMode("on");
    expect(converted.ambientForces).toBe(true);
  });

  // Pins the installed three-vrm: `VRM.update` steps the springs and
  // `springBoneManager.reset` returns them to rest. An upgrade that changes
  // either fails here.
  it("holds every spring at rest with Springs off, then resumes", async () => {
    const { avatar, vrm, deviation } = await springAvatar("Andrew");
    const frames = (count: number) =>
      sway(vrm, count, () => avatar.updateModel(1 / 60));

    frames(30);
    expect(deviation()).toBeGreaterThan(0.01);

    avatar.setSpringMode("springs_off");
    expect(deviation()).toBeLessThan(1e-6);
    frames(30);
    expect(deviation()).toBeLessThan(1e-6);

    avatar.setSpringMode("automatic");
    frames(30);
    expect(deviation()).toBeGreaterThan(0.01);
  });
});
