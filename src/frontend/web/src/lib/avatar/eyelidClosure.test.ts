import {
  VRMExpression,
  VRMExpressionManager,
  VRMExpressionMorphTargetBind,
  type VRM,
} from "@pixiv/three-vrm";
import * as THREE from "three";
import { beforeAll, describe, expect, it } from "vitest";

import { ExpressionController } from "./ExpressionController";
import {
  applyEyelidClosureCorrection,
  DEFAULT_EYELID_CLOSURE_PROFILE,
  VERIFIED_EYELID_CLOSURE_PROFILES,
} from "./eyelidClosure";
import type { IncludedAvatarId } from "./motion-authoring/headlessVrm";
import { loadTestAvatarWithGltf } from "./motion-authoring/testing/includedAvatars";

const ANNIE_SHA256 =
  "37a01dc3368959ac33e459f6ebb147af721a0fa02f6459ee26fd694e95bbcfcc";
const Y0_SHA256 =
  "0b37c351c9414f7d0359ba1daa9a1e2ced1a6acd9ed19990002655ac7d7c16e7";

/** The applied influence of an expression's first morph target bind. */
function morphInfluence(vrm: VRM, name: string): number {
  const bind = vrm.expressionManager!.getExpression(name)!.binds[0];
  if (!(bind instanceof VRMExpressionMorphTargetBind)) {
    throw new Error(`${name} has no morph target bind`);
  }
  return bind.primitives[0]!.morphTargetInfluences![bind.index]! / bind.weight;
}

function setWeights(vrm: VRM, weights: Record<string, number>): void {
  const manager = vrm.expressionManager!;
  for (const expression of manager.expressions) expression.weight = 0;
  for (const [name, weight] of Object.entries(weights)) {
    manager.setValue(name, weight);
  }
  manager.update();
}

/**
 * A one-mesh synthetic face: vertex 0 is an eyelid moved down by blink
 * channels, vertex 1 a mouth corner. `happyMovesEyelid` decides whether the
 * happy morph also closes the eyelid (as VRoid's whole-face Joy does).
 */
function syntheticVrm(options: {
  happyMovesEyelid: boolean;
  happyOverrideBlink?: "none" | "block" | "blend";
}): VRM {
  const names = ["happy", "relaxed", "blink", "blinkLeft", "blinkRight"];
  const eyelidDown = [0, -0.01, 0, 0, 0, 0];
  const targets: Record<string, number[]> = {
    happy: options.happyMovesEyelid
      ? [0, -0.008, 0, 0.004, 0.002, 0]
      : [0, 0, 0, 0.004, 0.002, 0],
    relaxed: [0, -0.002, 0, 0.001, 0, 0],
    blink: eyelidDown,
    blinkLeft: eyelidDown,
    blinkRight: eyelidDown,
  };
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute([0, 1.5, 0.1, 0.02, 1.45, 0.1], 3),
  );
  geometry.morphAttributes.position = names.map(
    (name) => new THREE.Float32BufferAttribute(targets[name]!, 3),
  );
  geometry.morphTargetsRelative = true;
  const mesh = new THREE.Mesh(geometry);
  mesh.updateMorphTargets();

  const manager = new VRMExpressionManager();
  names.forEach((name, index) => {
    const expression = new VRMExpression(name);
    expression.addBind(
      new VRMExpressionMorphTargetBind({
        primitives: [mesh],
        index,
        weight: 1,
      }),
    );
    if (name === "happy" && options.happyOverrideBlink) {
      expression.overrideBlink = options.happyOverrideBlink;
    }
    manager.registerExpression(expression);
  });
  return { expressionManager: manager } as unknown as VRM;
}

describe("verified eyelid closure profiles", () => {
  it("keep happy closing the eyelids more than relaxed", () => {
    for (const { profile } of Object.values(VERIFIED_EYELID_CLOSURE_PROFILES)) {
      expect(profile.happy).toBe(1);
      expect(profile.relaxed).toBeGreaterThan(0);
      expect(profile.relaxed).toBeLessThan(profile.happy);
    }
    expect(DEFAULT_EYELID_CLOSURE_PROFILE.relaxed).toBeLessThan(
      DEFAULT_EYELID_CLOSURE_PROFILE.happy,
    );
  });
});

describe.each([
  ["AvatarSample_A_1_New", ANNIE_SHA256, 0.2164],
  ["AvatarSample_Y_0", Y0_SHA256, 0.1767],
] as [IncludedAvatarId, string, number][])(
  "eyelid closure on %s",
  (id, sha256, k) => {
    let vrm: VRM;
    beforeAll(async () => {
      vrm = (await loadTestAvatarWithGltf(id)).vrm;
      expect(applyEyelidClosureCorrection(vrm, sha256)).toEqual({
        source: "verified",
        profile: { happy: 1, relaxed: k },
      });
    });

    it("scales blink by the eye closure happy and relaxed already add", () => {
      setWeights(vrm, { happy: 0.5, relaxed: 0.5, blink: 0.4 });
      expect(morphInfluence(vrm, "blink")).toBeCloseTo(
        0.4 * (1 - 0.5 - k * 0.5),
        5,
      );
      setWeights(vrm, { happy: 0.9, blink: 0.25 });
      expect(morphInfluence(vrm, "blink")).toBeCloseTo(0.25 * 0.1, 5);
      setWeights(vrm, { happy: 1, relaxed: 1, blink: 1 });
      expect(morphInfluence(vrm, "blink")).toBe(0);
    });

    it("leaves blink unchanged without happy or relaxed", () => {
      setWeights(vrm, { blink: 0.8 });
      expect(morphInfluence(vrm, "blink")).toBeCloseTo(0.8, 5);
      setWeights(vrm, { blinkLeft: 1, sad: 0.6 });
      expect(morphInfluence(vrm, "blinkLeft")).toBeCloseTo(1, 5);
    });

    it("scales each eye's wink channel by the same remaining closure", () => {
      setWeights(vrm, { relaxed: 1, blinkLeft: 0.6, blinkRight: 0.3 });
      expect(morphInfluence(vrm, "blinkLeft")).toBeCloseTo(0.6 * (1 - k), 5);
      expect(morphInfluence(vrm, "blinkRight")).toBeCloseTo(0.3 * (1 - k), 5);
    });

    it("keeps the authored weights while the morphs are corrected", () => {
      setWeights(vrm, { happy: 0.7, blink: 0.45 });
      const manager = vrm.expressionManager!;
      expect(manager.getValue("blink")).toBeCloseTo(0.45, 5);
      expect(manager.getValue("happy")).toBeCloseTo(0.7, 5);
      expect(morphInfluence(vrm, "happy")).toBeCloseTo(0.7, 5);
      // Repeated updates do not compound the correction.
      manager.update();
      manager.update();
      expect(morphInfluence(vrm, "blink")).toBeCloseTo(0.45 * 0.3, 5);
    });

    it("corrects the composed face of the expression controller", () => {
      const controller = new ExpressionController(vrm);
      controller.setClipExpressionPrecedence({
        weight: 1,
        expressions: { happy: 0.9, blink: 0.15 },
      });
      controller.update(1 / 60);
      controller.update(0);
      controller.update(0);
      expect(controller.getValue("blink")).toBeCloseTo(0.15, 5);
      expect(morphInfluence(vrm, "blink")).toBeCloseTo(0.15 * 0.1, 5);

      // An immediate creator write is corrected by the next VRM update.
      controller.setValue("happy", 0.5);
      controller.setValue("blink", 0.6);
      vrm.update(0);
      expect(morphInfluence(vrm, "blink")).toBeCloseTo(0.6 * 0.5, 5);
      controller.dispose();
    });
  },
);

describe("eyelid closure for Avatars without a verified profile", () => {
  it("uses the default profile when happy and relaxed close the eyelids", async () => {
    const { vrm } = await loadTestAvatarWithGltf("AvatarSample_A_1_New");
    expect(applyEyelidClosureCorrection(vrm, null)).toEqual({
      source: "default",
      profile: DEFAULT_EYELID_CLOSURE_PROFILE,
    });
    setWeights(vrm, { happy: 0.5, relaxed: 0.5, blink: 1 });
    expect(morphInfluence(vrm, "blink")).toBeCloseTo(
      1 - 0.5 - DEFAULT_EYELID_CLOSURE_PROFILE.relaxed * 0.5,
      5,
    );
  });

  it("only corrects expressions whose morphs move the eyelids", () => {
    const vrm = syntheticVrm({ happyMovesEyelid: false });
    expect(applyEyelidClosureCorrection(vrm, "not-a-known-digest")).toEqual({
      source: "default",
      profile: { happy: 0, relaxed: DEFAULT_EYELID_CLOSURE_PROFILE.relaxed },
    });
    setWeights(vrm, { happy: 1, blink: 1 });
    expect(morphInfluence(vrm, "blink")).toBe(1);
  });

  it("does nothing for a model without blink", () => {
    const vrm = {
      expressionManager: new VRMExpressionManager(),
    } as unknown as VRM;
    expect(applyEyelidClosureCorrection(vrm, null)).toBeNull();
    expect(applyEyelidClosureCorrection({} as VRM, null)).toBeNull();
  });
});

describe("native overrideBlink", () => {
  it("keeps a declared block without adding the correction", () => {
    const vrm = syntheticVrm({
      happyMovesEyelid: true,
      happyOverrideBlink: "block",
    });
    applyEyelidClosureCorrection(vrm, null);
    setWeights(vrm, { happy: 0.2, blink: 1 });
    expect(morphInfluence(vrm, "blink")).toBe(0);
  });

  it("keeps a declared blend exactly once", () => {
    const vrm = syntheticVrm({
      happyMovesEyelid: true,
      happyOverrideBlink: "blend",
    });
    applyEyelidClosureCorrection(vrm, null);
    setWeights(vrm, { happy: 0.4, blink: 1 });
    expect(morphInfluence(vrm, "blink")).toBeCloseTo(0.6, 5);
  });
});
