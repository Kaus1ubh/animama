import { describe, expect, it } from "vitest";
import { QuarksLoader } from "three.quarks";

import compatibilityValid from "./fixtures/compatibility-valid.json";
import compatibilityAdvancedValid from "./fixtures/compatibility-advanced-valid.json";

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
});
