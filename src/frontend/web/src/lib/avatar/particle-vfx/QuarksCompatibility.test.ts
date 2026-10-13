import { describe, expect, it } from "vitest";
import type { Object3D } from "three";
import { QuarksLoader } from "three.quarks";

import compatibilityValid from "./fixtures/compatibility-valid.json";
import compatibilityAdvancedValid from "./fixtures/compatibility-advanced-valid.json";
import { cloneParticleVFXPrefab } from "./quarksClone";

type OrbitBehavior = {
  type: string;
  axis: { x: number; y: number; z: number };
};

/** Each emitter's OrbitOverLife axes, in traversal order. */
function orbitAxes(object: Object3D): number[][] {
  const axes: number[][] = [];
  object.traverse((child) => {
    const system = (child as { system?: { behaviors: OrbitBehavior[] } })
      .system;
    for (const behavior of system?.behaviors ?? []) {
      if (behavior.type === "OrbitOverLife")
        axes.push([behavior.axis.x, behavior.axis.y, behavior.axis.z]);
    }
  });
  return axes;
}

describe("Three.quarks backend compatibility fixture", () => {
  it("is consumed by the real runtime deserializer", () => {
    const object = new QuarksLoader().parse(compatibilityValid);
    const emitters: string[] = [];
    object.traverse((child) => {
      if (child.type === "ParticleEmitter") emitters.push(child.uuid);
    });

    expect(object.type).toBe("Group");
    expect(emitters).toEqual(["fixture-emitter"]);
  });

  it("preserves emitter anchors through real parsing, cloning, and serialization", () => {
    const json = structuredClone(compatibilityValid);
    Object.assign(json.object.children[0]!, {
      userData: { animamaParticleAnchor: "leftHand", custom: "preserve" },
    });
    const object = new QuarksLoader().parse(json);
    const clone = object.clone(true);
    expect(clone.children[0]?.userData).toEqual({
      animamaParticleAnchor: "leftHand",
      custom: "preserve",
    });
    const reopened = new QuarksLoader().parse(clone.toJSON());
    expect(reopened.children[0]?.userData.animamaParticleAnchor).toBe(
      "leftHand",
    );
  });

  it("consumes every creator render mode, shape, generator, and behavior", () => {
    const object = new QuarksLoader().parse(compatibilityAdvancedValid);
    const renderModes: number[] = [];
    object.traverse((child) => {
      if (child.type !== "ParticleEmitter") return;
      const emitter = child as typeof child & {
        system: { renderMode: number };
      };
      renderModes.push(emitter.system.renderMode);
    });

    expect(renderModes).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("keeps an OrbitOverLife axis when an instance is cloned from the prefab", () => {
    const json = structuredClone(compatibilityAdvancedValid);
    for (const node of json.object.children) {
      for (const behavior of node.ps.behaviors as { type: string }[]) {
        if (behavior.type === "OrbitOverLife")
          Object.assign(behavior, { axis: [0, 0, 1] });
      }
    }
    const prefab = new QuarksLoader().parse(json);
    expect(orbitAxes(prefab)).toEqual([[0, 0, 1]]);

    const instance = cloneParticleVFXPrefab(prefab);

    expect(orbitAxes(instance)).toEqual([[0, 0, 1]]);
    // The instance owns its axis; changing it leaves the prefab alone.
    const [first] = orbitAxes(instance);
    expect(first).toBeDefined();
    instance.traverse((child) => {
      const system = (child as { system?: { behaviors: OrbitBehavior[] } })
        .system;
      for (const behavior of system?.behaviors ?? [])
        if (behavior.type === "OrbitOverLife") behavior.axis.x = 1;
    });
    expect(orbitAxes(prefab)).toEqual([[0, 0, 1]]);
  });

  it("clones a lone emitter prefab with its orbit axis", () => {
    const json = structuredClone(compatibilityAdvancedValid);
    const emitter = json.object.children.find((node) =>
      (node.ps.behaviors as { type: string }[]).some(
        (behavior) => behavior.type === "OrbitOverLife",
      ),
    );
    if (!emitter) throw new Error("Fixture lacks an OrbitOverLife emitter.");
    for (const behavior of emitter.ps.behaviors as { type: string }[]) {
      if (behavior.type === "OrbitOverLife")
        Object.assign(behavior, { axis: [1, 0, 0] });
    }
    const prefab = new QuarksLoader().parse({ ...json, object: emitter });

    expect(orbitAxes(cloneParticleVFXPrefab(prefab))).toEqual([[1, 0, 0]]);
  });

  it("keeps an emitter's prewarm when an instance is cloned", () => {
    const json = structuredClone(compatibilityAdvancedValid);
    for (const node of json.object.children)
      Object.assign(node.ps, { prewarm: true, looping: true });
    const prefab = new QuarksLoader().parse(json);
    const prewarms = (object: typeof prefab) => {
      const values: boolean[] = [];
      object.traverse((child) => {
        const system = (child as { system?: { prewarm?: boolean } }).system;
        if (child.type === "ParticleEmitter") values.push(!!system?.prewarm);
      });
      return values;
    };
    expect(prewarms(prefab).every(Boolean)).toBe(true);

    expect(prewarms(cloneParticleVFXPrefab(prefab)).every(Boolean)).toBe(true);
  });

  it("applies a texture's colour space from the manifest", () => {
    const json = {
      ...structuredClone(compatibilityValid),
      // One inline white pixel keeps the parse free of image fetches.
      images: [
        {
          uuid: "fixture-image",
          url: {
            data: [255, 255, 255, 255],
            width: 1,
            height: 1,
            type: "Uint8Array",
          },
        },
      ],
      textures: [
        { uuid: "fixture-texture", image: "fixture-image", colorSpace: "srgb" },
      ],
      materials: [
        { ...compatibilityValid.materials[0], map: "fixture-texture" },
      ],
    };
    const colorSpaces: string[] = [];
    new QuarksLoader().parse(json).traverse((child) => {
      const map = (
        child as { system?: { material?: { map?: { colorSpace: string } } } }
      ).system?.material?.map;
      if (map) colorSpaces.push(map.colorSpace);
    });

    expect(colorSpaces).toEqual(["srgb"]);
  });
});
