import { describe, expect, it } from "vitest";
import { Group, Object3D, Vector3 } from "three";

import type { Avatar } from "../Avatar";
import {
  createParticleVFXEffectContainer,
  createParticleVFXEmitterAnchorBindings,
  updateParticleVFXEmitterAnchors,
} from "./emitterAnchors";

function emitter(anchor?: string) {
  class Emitter extends Object3D {
    override type = "ParticleEmitter";
  }
  const object = new Emitter();
  if (anchor) object.userData.animamaParticleAnchor = anchor;
  return object;
}

function fixture() {
  const scene = new Group();
  scene.position.set(4, 2, -1);
  scene.scale.setScalar(1.5);
  const head = new Object3D();
  head.position.set(0, 2, 0);
  const hand = new Object3D();
  hand.position.set(1, 1, 0);
  scene.add(head, hand);
  const avatar = {
    scene,
    vrm: {
      humanoid: {
        getNormalizedBoneNode: (name: string) =>
          name === "head" ? head : name === "leftHand" ? hand : null,
      },
    },
  } as unknown as Avatar;
  return { scene, avatar, head, hand };
}

function localPosition(scene: Group, object: Object3D) {
  return scene.worldToLocal(object.getWorldPosition(new Vector3()));
}

describe("independently anchored particle emitters", () => {
  it("supports a ParticleEmitter resource root and rejects invalid override metadata", () => {
    const { scene, avatar } = fixture();
    const source = emitter("leftHand");
    source.position.x = 0.3;
    const container = createParticleVFXEffectContainer(source);
    const bindings = createParticleVFXEmitterAnchorBindings(container);
    container.position.y = 2;
    scene.add(container);
    updateParticleVFXEmitterAnchors({
      bindings,
      avatar,
      defaultAnchor: "head",
    });
    expect(localPosition(scene, source).x).toBeCloseTo(1.3);
    expect(localPosition(scene, source).y).toBeCloseTo(1);
    source.userData.animamaParticleAnchor = "unknown";
    expect(() => createParticleVFXEmitterAnchorBindings(container)).toThrow(
      "unsupported anchor",
    );
  });

  it("follows distinct bones without accumulating offsets through transformed parents", () => {
    const { scene, avatar, head, hand } = fixture();
    const root = new Group();
    root.position.set(0, 2, 0);
    root.scale.set(2, 1, 1);
    root.rotation.z = Math.PI / 2;
    const inherited = emitter();
    const overridden = emitter("leftHand");
    inherited.position.x = 0.25;
    overridden.position.x = 0.5;
    root.add(inherited, overridden);
    scene.add(root);
    const bindings = createParticleVFXEmitterAnchorBindings(root);
    const update = () =>
      updateParticleVFXEmitterAnchors({
        bindings,
        avatar,
        defaultAnchor: "head",
      });
    update();
    expect(localPosition(scene, inherited).x).toBeCloseTo(0);
    expect(localPosition(scene, inherited).y).toBeCloseTo(2.5);
    const result = localPosition(scene, overridden);
    expect(result.x).toBeCloseTo(1);
    expect(result.y).toBeCloseTo(2);
    hand.position.set(2, 1.5, 0);
    head.position.y = 3;
    root.position.y = 3;
    update();
    update();
    const moved = localPosition(scene, overridden);
    expect(moved.x).toBeCloseTo(2);
    expect(moved.y).toBeCloseTo(2.5);
    expect(localPosition(scene, inherited).y).toBeCloseTo(3.5);
  });

  it("does not let an inherited nested emitter inherit a parent emitter override", () => {
    const { scene, avatar } = fixture();
    const root = new Group();
    root.position.y = 2;
    const parent = emitter("leftHand");
    parent.position.x = 0.2;
    const child = emitter();
    child.position.y = 0.3;
    parent.add(child);
    root.add(parent);
    scene.add(root);
    const bindings = createParticleVFXEmitterAnchorBindings(root);
    updateParticleVFXEmitterAnchors({
      bindings,
      avatar,
      defaultAnchor: "head",
    });
    expect(localPosition(scene, parent).x).toBeCloseTo(1.2);
    expect(localPosition(scene, parent).y).toBeCloseTo(1);
    expect(localPosition(scene, child).x).toBeCloseTo(0.2);
    expect(localPosition(scene, child).y).toBeCloseTo(2.3);
  });
});
